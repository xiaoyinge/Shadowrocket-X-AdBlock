const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'ig_ads.js'), 'utf8');
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')); } };

function run(body, sr) {
  let out = null;
  let ctx;
  if (sr) { ctx = { window: {}, console }; ctx.window.$response = { status: 200, body: JSON.stringify(body) }; ctx.window.$done = v => out = v; }
  else { ctx = { $response: { status: 200, body: JSON.stringify(body) }, $done: v => out = v, console }; }
  vm.createContext(ctx); vm.runInContext(SRC, ctx);
  return out && out.body ? JSON.parse(out.body) : null;
}

const feed = { items: [
  { media_or_ad: { id: 'm1', code: 'c1' } },
  { media_or_ad: { id: 'ad1', ad_id: 'A1', injected_by: 'ad' } },
  { media_or_ad: { id: 'm2', code: 'c2' }, is_ad: true },
  { stories_netego: { id: 'n1' } },
  { media_or_ad: { id: 'm3', code: 'c3' } }
] };
const r = run(feed);
check('feed 广告已删', !r.items.some(i => (i.media_or_ad || {}).ad_id || i.is_ad), JSON.stringify(r.items.map(i => (i.media_or_ad || {}).id)));
check('netego 已删', !r.items.some(i => i.stories_netego));
check('正常媒体保留', r.items.length === 2 && r.items[0].media_or_ad.id === 'm1' && r.items[1].media_or_ad.id === 'm3');

const r2 = run({ data: { suggested_users: { users: [] }, x: { media: { id: 'ok' } } } });
check('suggested_users 已删', !r2.data.suggested_users && r2.data.x.media.id === 'ok');

const first = run(feed);
check('幂等: 二次处理不再改动', run(first) === null || JSON.stringify(run(first)) === JSON.stringify(first));

const srRun = run(feed, true);
check('小火箭 window.$response 环境可用', !!srRun && srRun.items.length === 2);

console.log('');
console.log('ig_ads: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
