/*
 * Reddit 去广告 — Shadowrocket / Loon http-response 脚本
 * 目标: shreddit graphql / gateway.reddit.com / *.reddit.com/*.json
 * 移除: isPromoted / promoted / adMetadata / is_sponsored 命中的列表项
 * 保留: cursor 分页、community 信息、正常帖子
 */
(function () {
  var body = $response && $response.body;
  if (typeof body !== 'string' || body === '') { $done({}); return; }

  var json;
  try { json = JSON.parse(body); } catch (e) { $done({}); return; }

  // 广告标记可能落在包装层之外: 老 API 在 o.data, shreddit 在 o.thing / o.node
  function flagged(c) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
    if (c.promoted === true || c.isPromoted === true || c.is_promoted === true) return true;
    if (c.is_sponsored === true || c.isSponsored === true) return true;
    if (c.adMetadata && typeof c.adMetadata === 'object') return true;
    if (c.ad_metadata && typeof c.ad_metadata === 'object') return true;
    if (typeof c.promotedStatus === 'string' && /promoted|sponsored/i.test(c.promotedStatus)) return true;
    return false;
  }

  function isAd(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    if (flagged(o)) return true;
    var wrap = ['data', 'thing', 'node', 'post'];
    for (var i = 0; i < wrap.length; i++) {
      if (o[wrap[i]] && flagged(o[wrap[i]])) return true;
    }
    return false;
  }

  function prune(node) {
    if (Array.isArray(node)) {
      for (var i = node.length - 1; i >= 0; i--) {
        if (isAd(node[i])) { node.splice(i, 1); continue; }
        prune(node[i]);
      }
      return;
    }
    if (node && typeof node === 'object') {
      for (var k in node) {
        if (Object.prototype.hasOwnProperty.call(node, k)) prune(node[k]);
      }
    }
  }

  prune(json);
  $done({ body: JSON.stringify(json) });
})();
