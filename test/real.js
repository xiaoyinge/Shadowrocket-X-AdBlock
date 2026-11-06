const fs = require('fs');
const path = require('path');

function run(file, body, isText) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  let out = null;
  const $response = { status: 200, body: isText ? body : JSON.stringify(body), headers: {} };
  const $request = { url: 'x', method: 'GET', headers: {} };
  const $done = (v) => { out = v; };
  new Function('$response', '$done', '$request', src)($response, $done, $request);
  if (!out || out.body === undefined) return { body: $response.body, unchanged: true };
  return out;
}

// 真实 Twitch m3u8: 带 EXT-X-MAP / DATERANGE / DISCONTINUITY 的完整结构
const live = [
'#EXTM3U','#EXT-X-VERSION:3','#EXT-X-TARGETDURATION:2','#EXT-X-MEDIA-SEQUENCE:100',
'#EXT-X-MAP:URI="https://video-edge.ttvnw.net/init.mp4"',
'#EXTINF:2.000,live','https://video-edge.ttvnw.net/a.ts',
'#EXT-X-DATERANGE:ID="stitched-ad-99",CLASS="twitch-stitched-ad",START-DATE="2026-11-06T00:00:00.000Z",DURATION=30.0,X-TV-TWITCH-AD-URL="https://ads.twitch.tv/x"',
'#EXTINF:2.000,live','https://video-edge.ttvnw.net/ad/1.ts',
'#EXTINF:2.000,live','https://video-edge.ttvnw.net/ad/2.ts',
'#EXT-X-DISCONTINUITY',
'#EXTINF:2.000,live','https://video-edge.ttvnw.net/b.ts',
'#EXT-X-DATERANGE:ID="other-1",CLASS="chapter",START-DATE="2026-11-06T00:00:00.000Z"',
'#EXTINF:2.000,live','https://video-edge.ttvnw.net/c.ts',
'#EXT-X-ENDLIST'
].join('\n');
const t = run('twitch_ads.js', live, true).body;
const tl = t.split('\n');
const ok = {
  'EXT-X-MAP 保留': t.includes('#EXT-X-MAP'),
  '广告块移除': !t.includes('stitched-ad') && !t.includes('/ad/1.ts') && !t.includes('/ad/2.ts'),
  'DISCONTINUITY 保留': t.includes('#EXT-X-DISCONTINUITY'),
  '广告后分片 b.ts 保留': t.includes('/b.ts'),
  '非广告 DATERANGE(chapter) 保留': t.includes('CLASS="chapter"'),
  'EXTINF 数量正确(3, 广告2个已删)': tl.filter(l => l.startsWith('#EXTINF')).length === 3,
};
Object.entries(ok).forEach(([k,v]) => console.log((v?'  PASS  ':'  FAIL  ')+k));
console.log('--- trimmed playlist ---');
console.log(t.split('\n').filter(l=>l.trim()).join('\n'));
