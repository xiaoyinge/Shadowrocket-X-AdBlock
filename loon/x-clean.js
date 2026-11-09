/**
 * X（Twitter）去广告 —— Loon / Surge / Quantumult X 通用脚本
 * 触发：http-response，requires-body=true
 * 由插件 X-Optimize.plugin 调用，$argument 为插件参数对象（可能是 null）
 *
 * v2 修订（修「帖子无法载入」）：
 *  1. 全程 try/catch，任何异常都放行原始响应，绝不吞掉 $done
 *  2. 递归改为深度上限 + 迭代栈，避免深 JSON 触发 RangeError
 *  3. 超大 body（> 3MB）直接放行，避免脚本超时被掐断
 *  4. 只在确实删到东西时才回写 body，否则原样放行
 */

var arg = (typeof $argument === "object" && $argument) ? $argument : {};

var OPT = {
  enableAds: arg.enable_ads !== false,
  hideRecs: arg.hide_recs === true,
  debug: arg.debug === true
};

var MAX_DEPTH = 60;

/* ---------------- 入口 ---------------- */
try {
  main();
} catch (e) {
  log("脚本异常，已放行原始响应：" + e);
  finish({});
}

function main() {
  var url = ($request && $request.url) || "";
  var raw = null;
  try {
    raw = (typeof $response !== "undefined" && $response) ? $response.body : null;
  } catch (e) {
    raw = null;
  }

  if (!OPT.enableAds || typeof raw !== "string") {
    finish({});
    return;
  }

  // 过大响应不处理，避免超时导致加载失败
  if (raw.length > 3 * 1024 * 1024) {
    log("响应过大（" + raw.length + "），跳过");
    finish({});
    return;
  }

  var data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    finish({});
    return;
  }

  var removed = 0;
  try {
    removed = cleanAll(data) + cleanTrends(data);
  } catch (e) {
    log("清洗异常，放行原始响应：" + e);
    finish({});
    return;
  }

  if (!removed) {
    finish({});
    return;
  }

  var out;
  try {
    out = JSON.stringify(data);
    // 二次校验：回写内容必须仍可解析
    JSON.parse(out);
  } catch (e) {
    log("序列化失败，放行原始响应：" + e);
    finish({});
    return;
  }

  log("移除推广 " + removed + " 项 (" + String(url).split("?")[0] + ")");
  finish({ body: out });
}

/* ---------------- 清洗 ---------------- */

function cleanAll(root) {
  var n = 0;
  eachNode(root, function (node) {
    var list = node.instructions;
    if (list && list.length) n += cleanInstructions(list);
  });
  return n;
}

function cleanInstructions(list) {
  var n = 0;
  for (var i = 0; i < list.length; i++) {
    var ins = list[i];
    if (!ins || typeof ins !== "object") continue;
    if (ins.entries && ins.entries.length !== undefined) n += dropAds(ins.entries);
    if (ins.moduleItems && ins.moduleItems.length !== undefined) n += dropAds(ins.moduleItems);
  }
  return n;
}

function dropAds(arr) {
  if (!arr || arr.length === undefined) return 0;
  var removed = 0;
  for (var i = arr.length - 1; i >= 0; i--) {
    var entry = arr[i];
    if (!entry || typeof entry !== "object") continue;

    var content = entry.content;
    var inner = (content && content.items && content.items.length !== undefined) ? content.items : null;
    if (inner) {
      var kept = [];
      for (var k = 0; k < inner.length; k++) {
        var item = inner[k];
        if (isAdEntry(item)) { removed++; continue; }
        if (OPT.hideRecs && isRecEntry(item)) { removed++; continue; }
        kept.push(item);
      }
      content.items = kept;
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
  return !!(c.item || c.itemContent || (c.items && c.items.length));
}

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
    if (typeof ic.displayType === "string" && /^promoted/i.test(ic.displayType)) return true;
  }

  var cei = entry.item && entry.item.clientEventInfo;
  if (cei && typeof cei.element === "string" && /promoted/i.test(cei.element)) return true;

  return false;
}

var REC_RE = /^(who-to-follow|connect-tab-|simcluster-|recap-|tweet-recommendation|peoplemodule|preview_module|user_recommendation)/;

function isRecEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  var id = entry.entryId || entry.itemId || "";
  return typeof id === "string" && REC_RE.test(id);
}

function cleanTrends(root) {
  var n = 0;
  eachNode(root, function (node) {
    var trends = node.trends;
    if (!trends || trends.length === undefined) return;
    var kept = [];
    for (var i = 0; i < trends.length; i++) {
      var t = trends[i];
      var promoted = t && (t.promotedMetadata || (t.trendMetadata && t.trendMetadata.promotedMetadata));
      if (promoted) { n++; continue; }
      kept.push(t);
    }
    if (kept.length !== trends.length) node.trends = kept;
  });
  return n;
}

/* ---------------- 迭代遍历（不递归，防爆栈）---------------- */

function eachNode(root, fn) {
  var stack = [{ node: root, depth: 0 }];
  var guard = 0;
  while (stack.length) {
    if (++guard > 200000) { log("节点数超限，提前结束遍历"); return; }
    var cur = stack.pop();
    var node = cur.node;
    if (!node || typeof node !== "object") continue;
    if (cur.depth > MAX_DEPTH) continue;

    fn(node);

    if (node.length !== undefined) {
      for (var i = node.length - 1; i >= 0; i--) stack.push({ node: node[i], depth: cur.depth + 1 });
      continue;
    }
    var keys = Object.keys(node);
    for (var k = keys.length - 1; k >= 0; k--) stack.push({ node: node[keys[k]], depth: cur.depth + 1 });
  }
}

function log(msg) {
  try { console.log("[X-Optimize] " + msg); } catch (e) {}
}

function finish(v) {
  try {
    if (typeof $done === "function") $done(v);
  } catch (e) {}
}
