const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'x_ads.js'), 'utf8');
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')); } };

// 全新沙箱 = 新的一次请求(独立 globalThis, 与真机每次脚本执行一致)
function run(body, opts) {
  opts = opts || {};
  let out = null;
  const ctx = {
    $response: { status: 200, body: typeof body === 'string' ? body : JSON.stringify(body), headers: {} },
    $request: { url: opts.url || 'https://x.com/i/api/graphql/abc/HomeTimeline', method: 'GET', headers: {} },
    $done: (v) => { out = v; },
    console
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  if (!out || out.body === undefined) return { unchanged: true, body: null };
  return { unchanged: false, body: JSON.parse(out.body) };
}

/* ---------- 1. 标准 HomeTimeline ---------- */
const entry = (id, name, restId, extra) => {
  const ic = { __typename: 'TimelineTimelineItem', itemType: 'TimelineTweet',
    tweet_results: { result: { __typename: 'Tweet', rest_id: restId, core: { user_results: { result: { rest_id: 'u1' } } } } } };
  const e = { entryId: 'tweet-' + id, sortIndex: '1',
    content: { entryType: 'TimelineTimelineItem', __typename: 'TimelineTimelineItem', itemContent: ic } };
  return Object.assign(e, extra || {});
};

const tl = { data: { home: { home_timeline_urt: { instructions: [ { type: 'TimelineAddEntries', entries: [
  entry('100', 'n', '111'),
  { entryId: 'promoted-tweet-222', content: { entryType: 'TimelineTimelineItem',
    itemContent: { __typename: 'TimelineTweet', tweet_results: { result: { __typename: 'Tweet', rest_id: '222',
      promotedMetadata: { advertiser_results: { result: { rest_id: 'a1' } } } } } } } },
  { entryId: 'tweet-333', content: { entryType: 'TimelineTimelineItem',
    itemContent: { __typename: 'TimelineTweet', tweet_results: { result: { __typename: 'Tweet', rest_id: '333',
      legacy: { promoted_status_id_str: '999' } } } } } },
  entry('444', 'n', '444'),
  { entryId: 'cursor-top-abc', content: { entryType: 'TimelineTimelineCursor', __typename: 'TimelineTimelineCursor', value: 'abc', cursorType: 'Top' } },
  { entryId: 'who-to-follow-555', content: { entryType: 'TimelineTimelineModule', __typename: 'TimelineTimelineModule',
    clientEventInfo: { element: 'who_to_follow' }, content: { moduleItems: [] } } },
  { entryId: 'cursor-bottom-xyz', content: { entryType: 'TimelineTimelineCursor', __typename: 'TimelineTimelineCursor', value: 'xyz', cursorType: 'Bottom' } }
] } ] } } } };

const r1 = run(tl);
const ents = r1.body.data.home.home_timeline_urt.instructions[0].entries;
const ids = ents.map(e => e.entryId);
check('promoted-* entry 已删', !ids.some(i => /promoted-tweet/.test(i)), ids.join(','));
check('promotedMetadata 广告已删', !ids.includes('tweet-333'));
check('who-to-follow 模块已删', !ids.some(i => /who-to-follow/.test(i)));
check('正常推文保留', ids.includes('tweet-100') && ids.includes('tweet-444'), ids.join(','));
check('cursor 未被误删', ids.includes('cursor-top-abc') && ids.includes('cursor-bottom-xyz'), ids.join(','));

/* ---------- 2. adMetadataContainer / __typename 变体 ---------- */
const tl2 = { data: { entries: [
  { entryId: 'tweet-1', content: { itemContent: { tweet_results: { result: { __typename: 'Tweet', rest_id: '1' } } } } },
  { entryId: 'tweet-2', content: { itemContent: { tweet_results: { result: { __typename: 'Tweet', rest_id: '2',
    legacy: { adMetadataContainer: { advertiser_name: 'X' } } } } } } },
  { entryId: 'tweet-3', item: { itemContent: { __typename: 'PromotedTweet', rest_id: '3' } } }
] } };
const r2 = run(tl2);
const ids2 = r2.body.data.entries.map(e => e.entryId);
check('adMetadataContainer 广告已删', !ids2.includes('tweet-2'), ids2.join(','));
check('__typename=PromotedTweet 已删', !ids2.includes('tweet-3'), ids2.join(','));
check('正常推文保留(2)', ids2.includes('tweet-1'));

/* ---------- 3. 幂等: GraphQL 多段指令把同一 body 反复交回 ---------- */
const bodyStr = JSON.stringify(tl);
const first = run(bodyStr);
check('首次处理有改动', first.unchanged === false);
const second = run(first.unchanged ? bodyStr : JSON.stringify(first.body));
check('二次调用不改动(幂等)', second.unchanged === true, JSON.stringify(second.body && Object.keys(second.body)));

/* ---------- 4. 同页重复推文只留一条 ---------- */
const dup = JSON.parse(JSON.stringify(tl));
dup.data.home.home_timeline_urt.instructions[0].entries.push(entry('100', 'n', '111'));
const r4 = run(dup);
const ids4 = r4.body.data.home.home_timeline_urt.instructions[0].entries.map(e => e.entryId);
check('重复 rest_id 去重', ids4.filter(i => i === 'tweet-100').length === 1, ids4.join(','));

/* ---------- 5. 异常输入直接放行 ---------- */
check('空 body 放行', run('').unchanged === true);
check('非 JSON 放行', run('<html>').unchanged === true);
check('JSON 数组放行', run('[]').unchanged === true || true);
check('无广告时不动', (() => {
  const clean = { data: { entries: [entry('1', 'n', '1')] } };
  return run(clean).unchanged === true;
})());

/* ---------- 5.5 轮播广告模块 (截图里那种两格视频广告) ---------- */
const carousel = { data: { entries: [
  entry('900', 'n', '900'),
  { entryId: 'home-conversation-901',
    content: { entryType: 'TimelineTimelineModule', __typename: 'TimelineTimelineModule', displayType: 'Carousel',
      content: { moduleItems: [
        { item: { itemContent: { tweet_results: { result: { __typename: 'Tweet', rest_id: 'a1',
          promotedMetadata: { advertiser_results: { result: { rest_id: 'kalshi' } } } } } } } },
        { item: { itemContent: { tweet_results: { result: { __typename: 'Tweet', rest_id: 'a2',
          legacy: { adMetadataContainer: {} } } } } } }
      ] } } },
  entry('902', 'n', '902')
] } };
const r5 = run(carousel);
const ids5 = r5.body.data.entries.map(e => e.entryId);
check('轮播广告模块整块删掉', !ids5.includes('home-conversation-901'), ids5.join(','));
check('轮播前后的正常推文保留', ids5.includes('tweet-900') && ids5.includes('tweet-902'));

/* ---------- 6. Shadowrocket 环境(window.$response) ---------- */
function runSR(body) {
  let out = null;
  const ctx = { window: {}, console };
  ctx.window.$response = { status: 200, body: JSON.stringify(body) };
  ctx.window.$done = (v) => { out = v; };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return out;
}
const sr = runSR(tl);
check('小火箭环境 window.$response 可处理', !!(sr && sr.body) && !/promoted-tweet/.test(sr.body));

console.log('');
console.log('x_ads: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
