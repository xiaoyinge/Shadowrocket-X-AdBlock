/*
 * Instagram 信息流去广告  —  http-response 脚本
 * 兼容: Loon(全局 $response/$done) 与 Shadowrocket(window.$response/window.$done)
 * 覆盖: feed/timeline, reels_media, explore, clips, tags, graphql
 * 移除: ad_id / is_ad / ad_metadata 媒体, stories_netego / bloks_netego 推荐位, suggested_users
 * 幂等: 同一份 body 只处理一次 (GraphQL 分多次 emit 时, 旧版会把自己反复剖开重来)
 */
(function () {
  'use strict';

  var OPT = {
    removeAds: true,
    removeNetego: true,
    removeSuggestedUsers: true,
    debug: false
  };

  var resp = (typeof $response !== 'undefined' && $response) ? $response
    : (typeof window !== 'undefined' && window.$response ? window.$response : null);
  var finish = (typeof $done === 'function') ? $done
    : (typeof window !== 'undefined' && typeof window.$done === 'function' ? window.$done : null);
  if (!finish) { return; }

  /* 空对象会被小火箭当成"响应体为空", 导致 App 侧帖子/图片加载失败; 一律原样回传 */
  /* 只回 body, 不回 headers: 原 header 的 content-encoding=gzip 会让 App 解压明文失败 */
  function pass(body) {
    finish({ body: (body === undefined) ? raw : body });
  }

  var raw = resp ? resp.body : null;
  if (raw === null || raw === undefined || raw === '' || typeof raw !== 'string') { pass(); return; }

  var G = (typeof globalThis !== 'undefined') ? globalThis
    : (typeof window !== 'undefined' ? window : this);
  if (!G.__igads_seen) { try { G.__igads_seen = {}; } catch (e) { G.__igads_seen = {}; } }
  var fp = 'p' + raw.length + '_' + raw.charCodeAt(0) + '_' + raw.slice(-32);
  if (G.__igads_seen[fp]) { pass(); return; }
  G.__igads_seen[fp] = 1;

  var json;
  try { json = JSON.parse(raw); } catch (e) { pass(); return; }
  if (!json || typeof json !== 'object') { pass(); return; }

  var stats = { ads: 0, netego: 0, suggested: 0 };

  var NETEGO_KEYS = { stories_netego: 1, bloks_netego: 1 };
  var SUGGESTED_KEYS = { suggested_users: 1, suggestedUsers: 1 };

  function pickMedia(o) {
    if (!o || typeof o !== 'object') return null;
    return o.media_or_ad || o.media || o.media_or_ad_item || null;
  }

  function isAd(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    var cands = [o, pickMedia(o), o.explore_item, o.item, o.reel, o.story];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
      if (c.ad_id !== undefined && c.ad_id !== null) return true;
      if (c.adId !== undefined && c.adId !== null) return true;
      if (c.is_ad === true || c.isAd === true) return true;
      if (c.ad_metadata || c.adMetadata) return true;
      if (typeof c.injected_by === 'string' && /ad/i.test(c.injected_by)) return true;
      if (typeof c.tracking_token === 'string' && c.drk_ad_id) return true;
    }
    return false;
  }

  function isNetego(o) {
    if (!o || typeof o !== 'object') return false;
    return !!(o.stories_netego || o.bloks_netego || o.netego_type || o.netegoType);
  }

  function isSuggested(o) {
    if (!o || typeof o !== 'object') return false;
    return !!(o.suggested_users || o.suggestedUsers || o.suggested_user);
  }

  function shouldDrop(o) {
    if (OPT.removeAds && isAd(o)) { stats.ads++; return true; }
    if (OPT.removeNetego && isNetego(o)) { stats.netego++; return true; }
    if (OPT.removeSuggestedUsers && isSuggested(o)) { stats.suggested++; return true; }
    return false;
  }

  function prune(node) {
    if (Array.isArray(node)) {
      for (var i = node.length - 1; i >= 0; i--) {
        if (shouldDrop(node[i])) { node.splice(i, 1); continue; }
        prune(node[i]);
      }
      return;
    }
    if (node && typeof node === 'object') {
      for (var k in node) {
        if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
        /* 对象键形式的推荐位: 直接删键, 不是数组元素就删不到 */
        if (OPT.removeNetego && NETEGO_KEYS[k]) { try { delete node[k]; stats.netego++; } catch (e) {} continue; }
        if (OPT.removeSuggestedUsers && SUGGESTED_KEYS[k]) { try { delete node[k]; stats.suggested++; } catch (e) {} continue; }
        prune(node[k]);
      }
    }
  }

  prune(json);

  if (OPT.debug) { try { console.log('[ig_ads] ' + JSON.stringify(stats)); } catch (e) {} }

  var out;
  try { out = JSON.stringify(json); } catch (e) { pass(); return; }
  if (out === raw) { pass(); return; }
  pass(out);
})();
