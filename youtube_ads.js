/*
 * YouTube 去广告 — Shadowrocket / Loon http-response 脚本
 * 目标: youtubei/v1/{player,next,browse,search,reel_item_watch}
 * 移除: adPlacements / adSlots / playerAds 等顶层广告字段
 *       以及 promoted* / adSlot* / displayAd* 等广告渲染器对象
 * 保留: streamingData、playbackTracking、所有正常 videoRenderer
 */
(function () {
  var body = $response && $response.body;
  if (typeof body !== 'string' || body === '') { $done({}); return; }

  var json;
  try { json = JSON.parse(body); } catch (e) { $done({}); return; }

  // 顶层广告字段: 整个键删掉
  var AD_KEYS = {
    adPlacements: 1, adSlots: 1, playerAds: 1,
    adBreakHeartbeatParams: 1, adBreakParams: 1, adParams: 1,
    clientSideAdEndpoint: 1, offlineAdBreakParams: 1,
    adSafetyReason: 1, adSignalsInfo: 1, serveAdParams: 1,
    playerAdParams: 1, adMetadata: 1
  };

  // 广告渲染器: 含该键的对象整个丢弃
  var AD_RENDERERS = {
    adSlotRenderer: 1, displayAdRenderer: 1,
    promotedSparklesWebRenderer: 1, promotedSparklesTextRenderer: 1,
    promotedSparklesTextSearchRenderer: 1,
    promotedVideoRenderer: 1, compactPromotedVideoRenderer: 1,
    searchPyvRenderer: 1, adThumbnailRenderer: 1,
    brandVideoRenderer: 1, inFeedAdLayoutRenderer: 1,
    adSlotAndLayoutMetadataRenderer: 1, adDisplayRenderer: 1
  };

  function isAdNode(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    for (var k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k) && AD_RENDERERS[k] && v[k]) return true;
    }
    return false;
  }

  function prune(node) {
    if (Array.isArray(node)) {
      for (var i = node.length - 1; i >= 0; i--) {
        if (isAdNode(node[i])) { node.splice(i, 1); continue; }
        prune(node[i]);
      }
      return;
    }
    if (node && typeof node === 'object') {
      for (var k in node) {
        if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
        if (AD_KEYS[k]) { delete node[k]; continue; }
        prune(node[k]);
      }
    }
  }

  prune(json);
  $done({ body: JSON.stringify(json) });
})();
