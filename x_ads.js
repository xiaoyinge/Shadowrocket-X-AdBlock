/*
 * X (Twitter) 去广告  —  http-response 脚本
 * 兼容: Loon(全局 $response/$done) 与 Shadowrocket(window.$response/window.$done)
 *
 * 处理内容:
 *   1. 同一次请求只处理一遍 (GraphQL 多段指令会把同一 JSON 重复剖开, 旧版在这里把自己搞成死循环)
 *   2. 删推广推文: entryId=promoted-*, promotedMetadata / promoted_metadata / adMetadataContainer
 *   3. 删 "Who to follow" / 推荐用户 / 推荐趋势模块
 *   4. 保留 cursor 分页项、会话模块、正常推文
 *   5. 同页重复推文(rest_id 重复)只留第一条
 */
(function () {
  'use strict';

  var OPT = {
    removePromoted: true,
    removeWhoToFollow: true,
    removePromotedTrends: true,
    /*
     * 救援开关: 若删减后 X 出现「帖子暂时无法载入」/ 时间线空白, 把 SAFE_MODE 设为 true
     * true  = 只删带 promotedMetadata 的推文, 不碰轮播/推荐位/去重 (最小侵入)
     * false = 完整清理 (默认)
     */
    safeMode: false,
    removeCarouselAdModules: true,   // 轮播模块里只要有广告位就整块删（HomeTimeline 的 Carousel 基本都是广告/推荐位）
    dedupeTweets: true,
    debug: false
  };

  var AD_TYPENAMES = {
    PromotedTweet: 1, PromotedTrend: 1, PromotedContent: 1, PromotedMetadata: 1,
    AdMetadataContainer: 1, AdFormats: 1, AdvertiserBrand: 1,
    TimelinePromotedContent: 1, TimelinePromptContent: 1, AdsEntries: 1
  };

  var WHO_TYPENAMES = {
    UserRecommendation: 1, TimelineUserModule: 1, WhoToFollow: 1,
    PeopleToFollow: 1, FollowRecommendations: 1
  };

  var CURATION_TYPENAMES = {
    TimelineCursor: 1, TimelineTimelineCursor: 1, TimelineClearCache: 1,
    TimelineTerminateTimeline: 1, TimelineTimelineTerminateTimeline: 1
  };

  /* ---------- 运行时环境适配 ---------- */
  var resp = (typeof $response !== 'undefined' && $response) ? $response
    : (typeof window !== 'undefined' && window.$response ? window.$response : null);
  var finish = (typeof $done === 'function') ? $done
    : (typeof window !== 'undefined' && typeof window.$done === 'function' ? window.$done : null);

  if (!finish) { return; }

  /*
   * 关键: 不能回 $done({}) / $done({body:null})
   * 小火箭把空对象当成"响应体为空", 原 body 被丢掉, App 侧表现为
   * "帖子暂时无法载入"。任何"不改动"的分支都必须把原 body 原样交回。
   */
  /*
   * 只回 body, 绝不回 headers。
   * 原响应头里带 content-encoding: gzip 和 content-length(压缩后长度),
   * 而我们交给 App 的是解压后的明文 JSON —— 带上原 header 后
   * App 会按 gzip 去解一段明文, 解不开 => "帖子暂时无法载入"。
   * $done({}) 在小火箭里会被当成空响应, 同样丢 body, 所以也禁用。
   */
  var raw = resp ? resp.body : null;

  /*
   * 三种"没东西可改"的情况:
   *   a) body 压根没给到脚本 (max-size 超限 / 未 require)
   *   b) body 为空串
   *   c) body 非字符串
   * 此时必须回 $done({}) —— 表示"不修改, 原样放行"。
   * 绝不能回 {body:null}, 那会被当成空响应, App 显示"帖子无法载入"。
   */
  function passRaw() { finish({}); }
  function pass(body) { finish({ body: (body === undefined) ? raw : body }); }

  if (raw === null || raw === undefined || raw === '') { passRaw(); return; }
  if (typeof raw !== 'string') { passRaw(); return; }

  /* ---------- 幂等守卫: 同一份 body 只处理一次 ---------- */
  var MARK = '__xads_processed__';
  var G = (typeof globalThis !== 'undefined') ? globalThis
    : (typeof window !== 'undefined' ? window : this);
  if (!G.__xads_seen) { try { G.__xads_seen = {}; } catch (e) { G.__xads_seen = {}; } }
  var fp = 'p' + raw.length + '_' + raw.charCodeAt(0) + '_' + raw.charCodeAt(Math.min(64, raw.length - 1)) +
           '_' + raw.slice(-32);
  if (G.__xads_seen[fp]) { pass(); return; }
  G.__xads_seen[fp] = 1;

  var json;
  try { json = JSON.parse(raw); } catch (e) { pass(); return; }
  if (!json || typeof json !== 'object') { pass(); return; }

  var stats = { promoted: 0, whoToFollow: 0, trends: 0, dup: 0 };

  function tn(obj) { return (obj && typeof obj === 'object' && typeof obj.__typename === 'string') ? obj.__typename : ''; }

  function hasPromoted(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (obj.promotedMetadata || obj.promoted_metadata || obj.adMetadataContainer) return true;
    if (obj.isPromoted === true || obj.promoted === true) return true;
    if (obj.promotedStatus && obj.promotedStatus !== 'NONE') return true;
    var t = tn(obj);
    if (t && AD_TYPENAMES[t]) return true;
    return false;
  }

  function entryIdOf(node) {
    var v = node.entryId || node.entry_id || '';
    return typeof v === 'string' ? v : '';
  }

  function itemContentOf(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
    if (node.itemContent) return node.itemContent;
    if (node.item && node.item.itemContent) return node.item.itemContent;
    if (node.content && node.content.itemContent) return node.content.itemContent;
    return null;
  }

  /* 递归下探 tweet 结果体 */
  function tweetResultOf(node) {
    var ic = itemContentOf(node);
    if (!ic) return null;
    var tr = ic.tweet_results;
    if (!tr || !tr.result) return null;
    var r = tr.result;
    if (r.tweet) return r.tweet;
    return r;
  }

  function isPromotedEntry(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false;

    var id = entryIdOf(node);
    if (id && /promoted/i.test(id)) return true;

    if (hasPromoted(node)) return true;
    if (hasPromoted(node.content)) return true;
    if (hasPromoted(node.item)) return true;

    var ic = itemContentOf(node);
    if (hasPromoted(ic)) return true;

    var c = node.content;
    if (c && typeof c === 'object') {
      if (c.clientEventInfo && typeof c.clientEventInfo === 'object') {
        var el = c.clientEventInfo.element;
        if (typeof el === 'string' && /promoted|ad_?break|sponsor/i.test(el)) return true;
      }
      if (c.displayType === 'Carousel' && tn(c) === 'TimelineTimelineModule') {
        var items = (c.content && c.content.moduleItems) || c.items || [];
        if (Array.isArray(items) && items.length) {
          var adCount = 0;
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (hasPromoted(it) || hasPromoted(it && it.item) || hasPromoted(tweetResultOf(it)) ||
                hasPromoted(it && it.item && it.item.itemContent)) adCount++;
          }
          if (adCount > 0 && (OPT.removeCarouselAdModules || adCount >= Math.ceil(items.length / 2))) return true;
        }
      }
    }

    var r = tweetResultOf(node);
    if (r) {
      if (hasPromoted(r)) return true;
      if (r.core && hasPromoted(r.core)) return true;
      if (r.legacy && hasPromoted(r.legacy)) return true;
      if (r.rest_id && r.legacy && r.legacy.promoted_status_id_str) return true;
    }
    return false;
  }

  function isWhoToFollowEntry(node) {
    if (!node || typeof node !== 'object') return false;
    var id = entryIdOf(node);
    if (id && /(who|people)-to-follow|follow-rec|user-rec|suggested[-_]?(users|follows)/i.test(id)) return true;

    var c = node.content;
    if (!c || typeof c !== 'object') return false;

    var t = tn(c);
    if (t && WHO_TYPENAMES[t]) return true;

    var inner = c.content || {};
    var cei = inner.clientEventInfo;
    if (cei && typeof cei === 'object' && typeof cei.element === 'string' &&
        /who_to_follow|follow_rec|user_rec/i.test(cei.element)) return true;

    if (typeof id === 'string' && /-user-?\d+$/i.test(id) && t === 'TimelineTimelineModule') return true;
    return false;
  }

  function isPromotedTrends(node) {
    if (!node || typeof node !== 'object') return false;
    var id = entryIdOf(node);
    if (id && /trends?-?(sponsor|promoted|ad)/i.test(id)) return true;
    var c = node.content;
    if (c && typeof c === 'object') {
      var t = tn(c);
      if (t === 'TimelineTimelineModule' && c.displayType === 'Carousel') {
        var cei = (c.content || {}).clientEventInfo;
        if (cei && typeof cei.element === 'string' && /trend/i.test(cei.element) && /promoted|ad/i.test(cei.element)) return true;
      }
    }
    return false;
  }

  /* cursor 永不删, 删了整页分页就断 */
  function isCuration(node) {
    if (!node || typeof node !== 'object') return false;
    var t = tn(node);
    if (t && CURATION_TYPENAMES[t]) return true;
    var id = entryIdOf(node);
    if (/^cursor-/i.test(id)) return true;
    var c = node.content;
    if (c && typeof c === 'object') {
      var ct = tn(c);
      if (ct && CURATION_TYPENAMES[ct]) return true;
      if (c.entryType === 'TimelineTimelineCursor') return true;
    }
    return false;
  }

  function shouldDrop(node) {
    if (isCuration(node)) return false;
    if (OPT.safeMode) {
      /* 救援模式: 只按 promotedMetadata / promoted-* entryId 精确删, 其余一律不动 */
      var sid = entryIdOf(node);
      if (OPT.removePromoted && /promoted/i.test(sid)) { stats.promoted++; return true; }
      if (OPT.removePromoted && hasPromoted(tweetResultOf(node))) { stats.promoted++; return true; }
      return false;
    }
    if (OPT.removePromoted && isPromotedEntry(node)) { stats.promoted++; return true; }
    if (OPT.removeWhoToFollow && isWhoToFollowEntry(node)) { stats.whoToFollow++; return true; }
    if (OPT.removePromotedTrends && isPromotedTrends(node)) { stats.trends++; return true; }
    return false;
  }

  var seenIds = Object.create(null);

  function restIdOf(node) {
    var r = tweetResultOf(node);
    if (r && typeof r.rest_id === 'string') return r.rest_id;
    var ic = itemContentOf(node);
    if (ic) {
      var rr = ic.tweet_results;
      if (rr && rr.result && typeof rr.result.rest_id === 'string') return rr.result.rest_id;
    }
    return '';
  }

  function prune(node) {
    if (Array.isArray(node)) {
      for (var i = node.length - 1; i >= 0; i--) {
        var child = node[i];
        if (shouldDrop(child)) { node.splice(i, 1); continue; }
        prune(child);
      }
      /* 正向去重: 只留第一次出现的推文 */
      if (!OPT.safeMode && OPT.dedupeTweets && node.length > 1) {
        var ids = [];
        for (var j = 0; j < node.length; j++) {
          var eid = entryIdOf(node[j]);
          if (!/^tweet-/i.test(eid)) continue;   /* 只对时间线 entry 去重, 不碰内嵌引用/媒体数组 */
          var id = restIdOf(node[j]);
          if (id) ids.push([j, id]);
        }
        for (var k = ids.length - 1; k >= 0; k--) {
          if (seenIds[ids[k][1]]) { stats.dup++; node.splice(ids[k][0], 1); }
          else { seenIds[ids[k][1]] = 1; }
        }
      }
      return;
    }
    if (node && typeof node === 'object') {
      for (var key in node) {
        if (Object.prototype.hasOwnProperty.call(node, key)) prune(node[key]);
      }
    }
  }

  prune(json);

  if (OPT.debug) {
    try {
      console.log('[x_ads] ' + JSON.stringify(stats) + ' ' + (G.__xads_free ? G.__xads_free() : ''));
    } catch (e) {}
  }

  var out;
  try { out = JSON.stringify(json); } catch (e) { pass(); return; }
  if (!out || out === raw) { pass(); return; }
  pass(out);
})();
