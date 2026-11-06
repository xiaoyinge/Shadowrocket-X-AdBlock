const fs = require('fs');
const path = require('path');

function run(file, body, isText) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  let out = null;
  const $response = { status: 200, body: isText ? body : JSON.stringify(body), headers: {} };
  const $request = { url: 'https://x/y', method: 'GET', headers: {} };
  const $done = (v) => { out = v; };
  new Function('$response', '$done', '$request', src)($response, $done, $request);
  // $done({}) 表示未改动, 原样放行
  if (!out || out.body === undefined) return { body: $response.body, unchanged: true };
  return out;
}

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')); } };

console.log('[YouTube] youtube_ads.js — player 响应');
const player = {
  adPlacements: [{ adPlacementRenderer: { renderer: { instreamVideoAdRenderer: {} } } }],
  adSlots: [{ adSlotRenderer: { adSlotMetadata: {} } }],
  playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
  adBreakHeartbeatParams: 'xxx',
  streamingData: { adaptiveFormats: [{ itag: 137 }, { itag: 251 }] },
  playbackTracking: { videostatsPlaybackUrl: { baseUrl: 'https://s.youtube.com/api/stats/playback' } },
  videoDetails: { videoId: 'dQw4w9WgXcQ', title: 'test' }
};
const p = JSON.parse(run('youtube_ads.js', player).body);
check('adPlacements 已删除', !('adPlacements' in p));
check('adSlots 已删除', !('adSlots' in p));
check('playerAds 已删除', !('playerAds' in p));
check('adBreakHeartbeatParams 已删除', !('adBreakHeartbeatParams' in p));
check('streamingData 保留', p.streamingData && p.streamingData.adaptiveFormats.length === 2);
check('playbackTracking 保留', !!(p.playbackTracking && p.playbackTracking.videostatsPlaybackUrl));
check('videoDetails 保留', p.videoDetails && p.videoDetails.videoId === 'dQw4w9WgXcQ');

console.log('[YouTube] youtube_ads.js — next 响应');
const next = {
  contents: { twoColumnWatchNextResults: { results: { results: { contents: [
    { videoRenderer: { videoId: 'v1' } },
    { adSlotRenderer: { adSlot: { adSlotMetadata: {} } } },
    { promotedSparklesWebRenderer: { title: 'ad' } },
    { compactVideoRenderer: { videoId: 'v2' } },
    { searchPyvRenderer: { ads: [] } }
  ] } } } }
};
const n = JSON.parse(run('youtube_ads.js', next).body);
const items = n.contents.twoColumnWatchNextResults.results.results.contents;
check('广告渲染器全部移除', items.length === 2, JSON.stringify(items.map(i => Object.keys(i)[0])));
check('正常 videoRenderer 保留', items[0].videoRenderer.videoId === 'v1');
check('正常 compactVideoRenderer 保留', items[1].compactVideoRenderer.videoId === 'v2');

console.log('[Twitch] twitch_ads.js — m3u8');
const m3u8 = [
  '#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:2',
  '#EXTINF:2.000,live', 'https://video.ttvnw.net/live/seg1.ts',
  '#EXT-X-DATERANGE:ID="ad-1",START-DATE="2026-11-06T00:00:00Z",CLASS="twitch-stitched-ad-abc"',
  '#EXTINF:2.000,live', 'https://video.ttvnw.net/ad/ad1.ts',
  '#EXTINF:2.000,live', 'https://video.ttvnw.net/ad/ad2.ts',
  '#EXT-X-DISCONTINUITY',
  '#EXTINF:2.000,live', 'https://video.ttvnw.net/live/seg2.ts',
  '#EXT-X-ENDLIST'
].join('\n');
const t = run('twitch_ads.js', m3u8, true).body;
check('广告 DATERANGE 已移除', t.indexOf('twitch-stitched-ad') === -1);
check('广告分片已移除', t.indexOf('/ad/ad1.ts') === -1 && t.indexOf('/ad/ad2.ts') === -1);
check('正常分片保留', t.indexOf('/live/seg1.ts') !== -1 && t.indexOf('/live/seg2.ts') !== -1);
check('ENDLIST 保留', t.indexOf('#EXT-X-ENDLIST') !== -1);
check('非广告 DATERANGE 不被误删', (() => {
  const keep = '#EXTM3U\n#EXT-X-DATERANGE:ID="x",CLASS="other"\n#EXTINF:2,live\nhttps://a/b.ts\n';
  return run('twitch_ads.js', keep, true).body.indexOf('CLASS="other"') !== -1;
})());

console.log('[Reddit] reddit_ads.js');
const reddit = { data: { children: [
  { kind: 't3', data: { id: 'p1', title: 'real post' } },
  { kind: 't3', data: { id: 'ad1', isPromoted: true, adMetadata: {} } },
  { kind: 't3', data: { id: 'ad2', promoted: true } },
  { kind: 't1', data: { id: 'c1', body: 'comment' } }
] } };
const r = JSON.parse(run('reddit_ads.js', reddit).body);
const kids = r.data.children;
check('广告项已移除', kids.length === 2, JSON.stringify(kids.map(k => k.data.id)));
check('正常帖保留', kids[0].data.id === 'p1');
check('评论保留', kids[1].data.id === 'c1');

const shreddit = { data: { elements: [
  { thing: { id: 't3_a', isPromoted: false } },
  { thing: { id: 't3_b', isPromoted: true } },
  { thing: { id: 't3_c', promotedStatus: 'PROMOTED' } }
] } };
const s = JSON.parse(run('reddit_ads.js', shreddit).body);
check('shreddit 广告已移除', s.data.elements.length === 1 && s.data.elements[0].thing.id === 't3_a', JSON.stringify(s.data.elements.map(e => e.thing.id)));

console.log('');
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
