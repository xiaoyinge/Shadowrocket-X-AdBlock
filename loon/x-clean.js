/**
 * X（Twitter）去广告 —— Loon / Surge / Quantumult X 通用脚本
 * 触发：http-response，requires-body=true
 * 由插件 X-Optimize.plugin 调用，$argument 为插件参数对象（可能是 null）
 */

var arg = (typeof $argument === "object" && $argument) ? $argument : {};

var OPT = {
  enableAds: arg.enable_ads !== false,   // 清理推广内容
  hideRecs: arg.hide_recs === true,      // 顺带隐藏"推荐关注"模块
  debug: arg.debug === true
};

var url = ($request && $request.url) || "";
var raw = (typeof $response !== "undefined" && $response && typeof $response.body === "string")
  ? $response.body
  : null;


function run() {
  var data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    log("响应非 JSON，跳过：" + e.message);
    finish({});
    return;
  }

  var removed = cleanAll(data) + cleanTrends(data);

  if (!removed) {
    finish({});
    return;
  }

  log("移除推广内容 " + removed + " 项 (" + url.split("?")[0] + ")");
  finish({ body: JSON.stringify(data) });
}

// 任意层级的 instructions（Timeline / 搜索 / 详情 / 列表 / 通知 / 书签通用）
function cleanAll(root) {
  var n = 0;
  walk(root, function (node) {
    var list = node.instructions;
    if (Array.isArray(list)) n += cleanInstructions(list);
  });
  return n;
}

function cleanInstructions(list) {
  var n = 0;
  for (var i = 0; i < list.length; i++) {
    var ins = list[i];
    if (!ins || typeof ins !== "object") continue;
    if (Array.isArray(ins.entries)) n += dropAds(ins.entries);
    if (Array.isArray(ins.moduleItems)) n += dropAds(ins.moduleItems);
  }
  return n;
}

// 删除广告项；会话/模块容器只清内部 items，容器空了才整体删除
function dropAds(arr) {
  var removed = 0;
  for (var i = arr.length - 1; i >= 0; i--) {
    var entry = arr[i];
    if (!entry || typeof entry !== "object") continue;

    var inner = (entry.content && Array.isArray(entry.content.items)) ? entry.content.items : null;
    if (inner) {
      var kept = [];
      for (var k = 0; k < inner.length; k++) {
        var item = inner[k];
        if (isAdEntry(item)) { removed++; continue; }
        if (OPT.hideRecs && isRecEntry(item)) { removed++; continue; }
        kept.push(item);
      }
      entry.content.items = kept;
      if (kept.length === 0) { arr.splice(i, 1); removed++; continue; }
    }

    if (isAdEntry(entry)) { arr.splice(i, 1); removed++; continue; }
    if (OPT.hideRecs && isRecEntry(entry) && !hasContent(entry)) { arr.splice(i, 1); removed++; }
  }
  return removed;
}

function hasContent(entry) {
  var c = entry.content;
  if (!c || typeof c !== "object") return false;
  return !!(c.item || c.itemContent || (Array.isArray(c.items) && c.items.length));
}

// 条目自身是广告：推广推文、推广账号、推广趋势、广告模块
function isAdEntry(entry) {
  if (!entry || typeof entry !== "object") return false;

  var id = typeof entry.entryId === "string" ? entry.entryId
    : typeof entry.itemId === "string" ? entry.itemId : "";
  if (id && /promoted/i.test(id)) return true;

  var ics = [];
  if (entry.content && entry.content.itemContent) ics.push(entry.content.itemContent);
  if (entry.item && entry.item.itemContent) ics.push(entry.item.itemContent);
  if (entry.itemContent) ics.push(entry.itemContent);
  for (var i = 0; i < ics.length; i++) {
    var ic = ics[i];
    if (!ic || typeof ic !== "object") continue;
    if (ic.promotedMetadata) return true;
    if (/^promoted/i.test(ic.displayType || "")) return true;
  }

  var meta = entry.item && entry.item.clientEventInfo;
  if (meta && meta.element && /promoted/i.test(meta.element)) return true;

  return false;
}

var REC_RE = /^(who-to-follow|connect-tab-|simcluster-|recap-|tweet-recommendation|peoplemodule|preview_module|user_recommendation)/;

function isRecEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  var id = entry.entryId || entry.itemId || "";
  return typeof id === "string" && REC_RE.test(id);
}

// 趋势/探索页的推广趋势
function cleanTrends(root) {
  var n = 0;
  walk(root, function (node) {
    if (!Array.isArray(node.trends)) return;
    var kept = [];
    for (var i = 0; i < node.trends.length; i++) {
      var t = node.trends[i];
      var promoted = t && (t.promotedMetadata || (t.trendMetadata && t.trendMetadata.promotedMetadata));
      if (promoted) { n++; continue; }
      kept.push(t);
    }
    if (kept.length !== node.trends.length) node.trends = kept;
  });
  return n;
}

function walk(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  if (Array.isArray(node)) {
    for (var i = 0; i < node.length; i++) walk(node[i], fn);
    return;
  }
  var keys = Object.keys(node);
  for (var k = 0; k < keys.length; k++) walk(node[keys[k]], fn);
}

function log(msg) {
  try { console.log("[X-Optimize] " + msg); } catch (e) {}
}

function finish(v) {
  try { if (typeof $done === "function") $done(v); } catch (e) {}
}

/* ---------------- 入口（放在末尾，确保上面的常量已初始化）---------------- */
if (!OPT.enableAds || !raw) {
  finish({});
} else {
  run();
}
