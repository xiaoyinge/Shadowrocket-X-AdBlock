// X-Probe：只记日志，不改任何请求/响应。用于确认 X 的时间线请求到底有没有发出来、有没有命中插件。
// 对应插件：X-Probe.plugin

var finished = false;
function finish(v) {
  if (finished) return;
  finished = true;
  try { if (typeof $done === "function") $done(v); } catch (e) {}
}
function say(msg) {
  try { console.log("[X-Probe] " + msg); } catch (e) {}
}

try {
  var url = (typeof $request !== "undefined" && $request && $request.url) ? String($request.url) : "";
  var method = (typeof $request !== "undefined" && $request && $request.method) ? String($request.method) : "?";

  // 只打印关键片段，避免日志刷屏
  var short = url
    .replace(/^https?:\/\//, "")
    .replace(/\?.*$/, "")
    .slice(0, 120);

  say(method + " " + short);

  // 单独高亮时间线/推广相关，方便在日志里一眼看到
  if (/Timeline|TweetDetail|Conversation|Search|UserTweets/i.test(url)) {
    say(">>> 时间线类请求命中: " + short);
  }
  if (/promoted|ads-api|jot\/client_event|live_pipeline/i.test(url)) {
    say(">>> 广告/埋点类请求命中: " + short);
  }

  // 原样放行
  finish({});
} catch (e) {
  finish({});
} finally {
  if (!finished) finish({});
}
