/*
 * Twitch 去广告 — Shadowrocket / Loon http-response 脚本
 * 目标: *.ttvnw.net 的 m3u8 播放列表
 * 原理: Twitch 用 SSAI 把广告切片直接拼进播放列表, 靠 {#EXT-X-DATERANGE ... CLASS="twitch-stitched-ad-*"} 标记
 *       删掉标记块 + 其覆盖的 EXTINF/分片 URI, 播放器就会跳过广告段
 * 保留: 直播本体分片、EXT-X-MAP、ENDLIST、所有非广告 DATERANGE
 */
(function () {
  var body = $response && $response.body;
  if (typeof body !== 'string' || body === '') { $done({}); return; }

  // 只有播放列表才处理
  if (body.indexOf('#EXTM3U') === -1) { $done({}); return; }

  var isAdRange = function (s) {
    return /^#EXT-X-DATERANGE:/.test(s) && /CLASS="twitch-stitched-ad/i.test(s);
  };
  var isAnyRange = function (s) { return /^#EXT-X-DATERANGE:/.test(s); };
  var isEnd = function (s) { return /^#EXT-X-ENDLIST/.test(s); };
  // 广告块的真实边界: Twitch 用 END-ON-NEXT=YES, 实际结束于 #EXT-X-DISCONTINUITY
  var isBoundary = function (s) {
    return isAnyRange(s) || isEnd(s) || /^#EXT-X-DISCONTINUITY/.test(s) || /^#EXTM3U/.test(s);
  };

  var lines = body.split(/\r?\n/);
  var out = [];
  var skipping = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var t = line.trim();

    if (isAdRange(t)) { skipping = true; continue; }

    if (skipping) {
      if (isBoundary(t)) {
        skipping = false;
        out.push(line);
      }
      continue;
    }
    out.push(line);
  }

  var res = out.join('\n');
  if (res === body) { $done({}); return; }
  $done({ body: res });
})();
