/*
 * 从 sr-cnip.conf 合成 sr-x-adblock.conf:
 *   - ad-twitter 域名 REJECT 插在 GEOIP,CN,DIRECT 之前
 *   - 追加 [Script] 段 (X / Instagram)
 *   - MITM hostname 追加 X/IG 域名, 且排除 *.googlevideo.com (分片是加密流, 解密纯烧 CPU)
 *   - 去掉会 302 整站的 google.cn 重写 (它会把 Google 请求改写成不可用地址)
 */
const fs = require('fs');
const path = require('path');
const R = __dirname;
const SRC = path.join(R, 'sr-cnip.conf');
const OUT = path.join(R, 'sr-x-adblock.conf');
const OUT_LOCAL = path.join(R, 'sr-x-adblock-local.conf');
const OUT_MOD = path.join(R, 'X-AdBlock.sgmodule');

const RAW_REPO = process.env.RAW_REPO || 'https://raw.githubusercontent.com/USER/REPO/main/shadowrocket';
const X_ID = 'U0hsbkFuVXRt';

/*
 * X / Twitter 主域必须显式 PROXY。
 * 日志实证: chat-ws.x.com 解析到国内 IP, 命中 GEOIP,CN,DIRECT 走了直连,
 * 而基线 sr-cnip.conf 里一条 X 规则都没有, 全靠 FINAL 兜底 —— 一旦 DNS 给国内 IP 就失控。
 * 这几条必须放在 GEOIP,CN,DIRECT 之前。
 */
const X_PROXY_RULES = [
  '# ---- X / Twitter 强制走代理 (早于 GEOIP,CN,DIRECT) ----',
  'DOMAIN-SUFFIX,x.com,PROXY',
  'DOMAIN-SUFFIX,twitter.com,PROXY',
  'DOMAIN-SUFFIX,twimg.com,PROXY',
  'DOMAIN-SUFFIX,t.co,PROXY',
  'DOMAIN-SUFFIX,instagram.com,PROXY',
  'DOMAIN-SUFFIX,cdninstagram.com,PROXY',
  'DOMAIN-SUFFIX,fbcdn.net,PROXY'
];

const AD_RULES = [
  '# ================= X / Twitter =================',
  'DOMAIN-SUFFIX,ads-twitter.com,REJECT',
  'DOMAIN-SUFFIX,ads-api.twitter.com,REJECT-DROP',
  'DOMAIN-SUFFIX,ads.twitter.com,REJECT',
  'DOMAIN-SUFFIX,analytics.twitter.com,REJECT-DROP',
  'DOMAIN-SUFFIX,ads.x.com,REJECT',
  'DOMAIN-SUFFIX,ads-api.x.com,REJECT-DROP',
  'DOMAIN-SUFFIX,tellapart.com,REJECT-DROP',
  'DOMAIN-SUFFIX,scribe.twitter.com,REJECT-DROP',
  '',
  '# ================= Google 广告 (doubleclick 是重连大户) =================',
  '# 日志实证: 单次 30s 会话内 googleads.g.doubleclick-cn.net 重连 12~26 次',
  '# 用 REJECT-DROP 静默丢包: App 等 TCP 超时后放弃, 不再快速重连',
  '# 日志实证(18:18): doubleclick 12 次 -> 1 次, 但 sentry/ads-api 因用 REJECT 仍各重连 4 次',
  '# 故将所有纯遥测类也改为 REJECT-DROP',
  'DOMAIN-SUFFIX,doubleclick.net,REJECT-DROP',
  'DOMAIN-SUFFIX,doubleclick-cn.net,REJECT-DROP',
  'DOMAIN-SUFFIX,doubleclick.com,REJECT-DROP',
  'DOMAIN-SUFFIX,g.doubleclick.net,REJECT-DROP',
  'DOMAIN-SUFFIX,googlesyndication.com,REJECT',
  'DOMAIN-SUFFIX,googleadservices.com,REJECT',
  'DOMAIN-SUFFIX,google-analytics.com,REJECT',
  'DOMAIN-SUFFIX,googletagmanager.com,REJECT',
  'DOMAIN-SUFFIX,googletagservices.com,REJECT',
  'DOMAIN-SUFFIX,adservice.google.com,REJECT',
  'DOMAIN-SUFFIX,pagead2.googlesyndication.com,REJECT',
  'DOMAIN-SUFFIX,firebaselogging-pa.googleapis.com,REJECT-DROP',
  'DOMAIN-SUFFIX,firebaseinstallations.googleapis.com,REJECT-DROP',
  '',
  '# ================= 遥测 / 崩溃上报 =================',
  'DOMAIN-SUFFIX,ingest.us.sentry.io,REJECT-DROP',
  'DOMAIN-SUFFIX,app-measurement.com,REJECT-DROP',
  'DOMAIN-SUFFIX,app-analytics-services.com,REJECT-DROP',
  'DOMAIN-SUFFIX,crashlyticsreports-pa.googleapis.com,REJECT-DROP',
  '',
  '# ================= 通用广告联盟 =================',
  'DOMAIN-SUFFIX,amazon-adsystem.com,REJECT',
  'DOMAIN-SUFFIX,adsrvr.org,REJECT',
  'DOMAIN-SUFFIX,adnxs.com,REJECT',
  'DOMAIN-SUFFIX,scorecardresearch.com,REJECT',
  'DOMAIN-SUFFIX,moatads.com,REJECT',
  'DOMAIN-SUFFIX,taboola.com,REJECT',
  'DOMAIN-SUFFIX,outbrain.com,REJECT',
  'DOMAIN-SUFFIX,criteo.com,REJECT',
  'DOMAIN-SUFFIX,criteo.net,REJECT',
  'DOMAIN-SUFFIX,adcolony.com,REJECT',
  'DOMAIN-SUFFIX,applovin.com,REJECT',
  'DOMAIN-SUFFIX,unityads.unity3d.com,REJECT',
  'DOMAIN-SUFFIX,vungle.com,REJECT',
  'DOMAIN-SUFFIX,chartboost.com,REJECT',
  'DOMAIN-SUFFIX,ironsrc.com,REJECT',
  'DOMAIN-SUFFIX,supersonicads.com,REJECT',
  'DOMAIN-SUFFIX,inmobi.com,REJECT',
  'DOMAIN-SUFFIX,startapp.com,REJECT',
  'DOMAIN-SUFFIX,mintegral.com,REJECT',
  'DOMAIN-SUFFIX,pangle.io,REJECT'
];

const X_PATTERN = '^https?:\\/\\/(api\\.(twitter|x)\\.com|((www|mobile|m)\\.)?(x|twitter)\\.com)\\/' +
  '(i\\/api\\/)?graphql\\/[-_A-Za-z0-9]+\\/(' +
  'HomeTimeline|HomeLatestTimeline|HomeTimelineUrt|SearchTimeline|UserTweets|UserTweetsAndReplies|' +
  'UserMedia|TweetDetail|BookmarkSearchTimeline|Bookmarks|Likes|' +
  'ListLatestTweetsTimeline|ListTweetsTimeline|CommunityTweetsTimeline|CommunityMediaTimeline|' +
  'ConnectTabTimeline|GenericTimelineById|ViewerTimeline|TimelineHome|TimelineHomeLatest|' +
  'HomeTimelineV2|HomeLatestTimelineV2|ViewerHomeTimeline)' +
  '(\\?|$)';

const IG_PATTERN = '^https?:\\/\\/(i|www)\\.instagram\\.com\\/(api\\/v1\\/(feed|discover|clips|explore|tags)\\/|(api\\/)?graphql)';

/*
 * MITM 只放脚本真正要读 body 的域名。
 * *.twimg.com / *.cdninstagram.com / *.fbcdn.net 是图片视频 CDN:
 *   - 脚本根本不处理它们 (pattern 只匹配 graphql)
 *   - 解密加密视频分片会让播放器无限重试 (日志里 147 条 video-s.twimg.com 就是这样来的)
 *   - 还会拖慢图片加载、增加耗电
 */
/*
 * 只解密 api 子域。
 * 日志实证(q2 16:36): 把 x.com / twitter.com 主域也解密后,
 * App 内嵌 WebView 的 authenticate_web_view 证书链失败 -> 登录态降级
 * -> 不请求 HomeTimeline -> "帖子无法载入"。
 * 脚本只需要 api.x.com 的 graphql, 主域一条都不能碰。
 */
/*
 * 关键: 绝不要把 x.com / twitter.com 主域放进 MITM。
 * 日志实证(4 份对照):
 *   关解密 -> chat-ws.x.com 存在, 帖子正常
 *   开解密 -> chat-ws.x.com 完全消失, viewer.json 重试 3 次, HomeTimeline 从不发出
 * chat-ws.x.com 是 wss:// WebSocket, 小火箭 MITM 无法正确代理 Upgrade 握手,
 * 连接建不起来 -> App 卡在初始化 -> "帖子无法载入"。
 * 时间线走 api.x.com 的 graphql, 只解密它即可。
 */
const MITM_ADD = [
  'api.x.com', 'api.twitter.com',
  'i.instagram.com'
];
const MITM_APPEND = ['api.x.com', 'api.twitter.com', 'i.instagram.com'];

const lines = fs.readFileSync(SRC, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);

// 找段边界
const idxGeoip = lines.findIndex(l => l.trim() === 'GEOIP,CN,DIRECT');
const idxFinal = lines.findIndex(l => /^FINAL,/.test(l.trim()));
if (idxGeoip < 0) throw new Error('sr-cnip.conf 里没有 GEOIP,CN,DIRECT');
if (idxFinal < 0) throw new Error('sr-cnip.conf 里没有 FINAL');

// URL Rewrite 段内容(去掉 google.cn 302) 与 MITM
const iRewrite = lines.findIndex(l => l.trim() === '[URL Rewrite]');
const iMitm = lines.findIndex(l => l.trim() === '[MITM]');
if (iRewrite < 0 || iMitm < 0) throw new Error('sr-cnip.conf 缺 [URL Rewrite] 或 [MITM]');

// 上游 sr-cnip.conf 第 20 行带行内 // 注释: 'DOMAIN-SUFFIX,ampproject.org,PROXY //  Google AMP issue#237'
// 小火箭会把整段当策略名, 该条规则直接失效 —— 这里清掉策略后面跟的行内注释
const rulePart = lines.slice(0, idxGeoip).map(l => l
  .replace(/,(PROXY|DIRECT|REJECT|REJECT-DICT|REJECT-ARRAY)\s*\/\/.*$/, ',$1')
  // update-url 留着的话, 上游 sr_cnip.conf 一更新就会把 X 脚本和 MITM 整份覆盖掉
  // update-url 指向本仓库: 手机端点「更新」即可同步新版本, 不会被上游覆盖
  .replace(/^update-url\s*=.*$/, 'update-url = ' + RAW_REPO + '/sr-x-adblock.conf')
  // DNS 日志实证: lb._dns-sd._udp.*.in-addr.arpa 被反复发给公共 DoH, 全部返回空并秒重试 40+ 次
  // system 放最前面, 内网 arpa/Bonjour 反查交给系统 DNS
  .replace(/^dns-server\s*=.*$/, 'dns-server = system, https://dns.alidns.com/dns-query, https://doh.pub/dns-query'));
const tailNote = '# Made with Love from https://github.com/Johnshall/Shadowrocket-ADBlock-Rules-Forever';

let mitmHosts = [];
for (let i = iMitm + 1; i < lines.length; i++) {
  const l = lines[i].trim();
  if (!l || /^#/.test(l)) continue;
  const m = l.match(/^hostname\s*=\s*(.+)$/i);
  if (m) mitmHosts = m[1].split(',').map(s => s.trim()).filter(Boolean);
}
// 补 X/IG; 顺手摘掉 *.googlevideo.com —— 视频分片是加密流, 解密纯耗电且脚本不处理它
mitmHosts = mitmHosts.filter(h => !/googlevideo\.com$/i.test(h.replace(/^\*\./, '')));
for (const h of MITM_ADD) if (!mitmHosts.includes(h)) mitmHosts.push(h);

const out = [];
out.push('# Shadowrocket: sr-cnip + X / Instagram 去广告  (generated ' + new Date().toISOString().slice(0, 19) + ')');
out.push('# 生成来源: sr-cnip.conf  +  x_ads.js / ig_ads.js');
out.push(...rulePart);
out.push('');
out.push(...AD_RULES);
  out.push('');
  out.push(...X_PROXY_RULES);
out.push('');
out.push('GEOIP,CN,DIRECT');
out.push('FINAL,PROXY');
out.push('');
out.push('[URL Rewrite]');
out.push('# 只拦显式的广告接口; live_pipeline 是 X 的实时流, 返回空 dict 会让 App 无限重连');
out.push('^https?:\\/\\/api\\.(twitter|x)\\.com\\/1\\.1\\/ads\\/ - reject-dict');
out.push('');
out.push('[Script]');
out.push('# 脚本托管: 二选一');
out.push('#   a) 本地: script-path=x_ads.js   (小火箭 Scripts 目录放 x_ads.js)');
out.push('#   b) 远端: 换成你自己的 raw 地址');
out.push('X-AdBlock = type=http-response, pattern=' + X_PATTERN + ', requires-body=1, max-size=1048576, script-path=' + RAW_REPO + '/x_ads.js, timeout=30');
out.push('IG-AdBlock = type=http-response, pattern=' + IG_PATTERN + ', requires-body=1, max-size=1048576, script-path=' + RAW_REPO + '/ig_ads.js, timeout=30');
out.push('');
out.push('[MITM]');
out.push('hostname = ' + mitmHosts.join(','));
out.push('h2 = true');
out.push('');
out.push(tailNote);
out.push('');

fs.writeFileSync(OUT, out.join('\n'), 'utf8');
console.log('wrote ' + OUT + '  lines=' + out.length + '  mitm=' + mitmHosts.length);

// 本地方案: 不依赖 GitHub, js 直接放小火箭 Scripts 目录
const local = out.map(l =>
  l.replace(/script-path=https:\/\/raw\.githubusercontent\.com\/USER\/REPO\/main\/shadowrocket\/x_ads\.js/, 'script-path=x_ads.js')
   .replace(/script-path=https:\/\/raw\.githubusercontent\.com\/USER\/REPO\/main\/shadowrocket\/ig_ads\.js/, 'script-path=ig_ads.js'));
fs.writeFileSync(OUT_LOCAL, local.join('\n'), 'utf8');
console.log('wrote ' + OUT_LOCAL);

/*
 * 小火箭「模块」(.sgmodule): 不改配置文件, 用 %APPEND% 往当前配置上叠加
 * 这才是新版小火箭里没有「重写/脚本」全局开关时的正确挂载方式
 */
const mod = [];
mod.push('#!name=X / Instagram 去广告');
mod.push('#!desc=删 X(Twitter) 与 Instagram 信息流里的推广推文/推荐位/轮播广告; 需在 设置 > HTTPS解密 里为本配置开启解密并安装信任 CA');
mod.push('#!system=ios');
mod.push('');
mod.push('[Rule]');
mod.push(...AD_RULES);
mod.push('');
mod.push(...X_PROXY_RULES);
mod.push('');
mod.push('[URL Rewrite]');
mod.push('^https?:\\/\\/api\\.(twitter|x)\\.com\\/1\\.1\\/ads\\/ - reject-dict');
mod.push('^https?:\\/\\/api\\.(twitter|x)\\.com\\/1\\.1\\/live_pipeline\\/ - reject-dict');
mod.push('');
mod.push('[Script]');
mod.push('X-AdBlock = type=http-response, pattern=' + X_PATTERN + ', requires-body=1, max-size=-1, script-path=' + RAW_REPO + '/x_ads.js');
mod.push('IG-AdBlock = type=http-response, pattern=' + IG_PATTERN + ', requires-body=1, max-size=-1, script-path=' + RAW_REPO + '/ig_ads.js');
mod.push('');
mod.push('[MITM]');
mod.push('hostname = %APPEND% ' + MITM_APPEND.join(', '));
mod.push('');
fs.writeFileSync(OUT_MOD, mod.join('\n'), 'utf8');
console.log('wrote ' + OUT_MOD + '  lines=' + mod.length);

// 本地脚本版模块
const modLocal = mod.map(l =>
  l.replace(/script-path=.*\/shadowrocket\/x_ads\.js$/, 'script-path=x_ads.js')
   .replace(/script-path=.*\/shadowrocket\/ig_ads\.js$/, 'script-path=ig_ads.js'));
fs.writeFileSync(path.join(R, 'X-AdBlock-local.sgmodule'), modLocal.join('\n'), 'utf8');
console.log('wrote X-AdBlock-local.sgmodule');

/*
 * HTTP 托管模式: 脚本地址指到本机 node serve.js (默认 :8088)
 * 小火箭「配置 > i > 脚本 URL」会把它们下载到应用自己的沙盒里, 不需要手动放文件
 */
const LAN = process.env.LAN_IP || '192.168.1.104';
const HTTP_BASE = 'http://' + LAN + ':' + (process.env.HTTP_PORT || '8088');
const swapTo = (line, base) => line
  .replace(/script-path=[^,]+\/x_ads\.js/, 'script-path=' + base + '/x_ads.js')
  .replace(/script-path=[^,]+\/ig_ads\.js/, 'script-path=' + base + '/ig_ads.js');
const httpOut = out.map(l => swapTo(l, HTTP_BASE));
fs.writeFileSync(path.join(R, 'sr-x-adblock-http.conf'), httpOut.join('\n'), 'utf8');
console.log('wrote sr-x-adblock-http.conf  base=' + HTTP_BASE);

const modHttp = mod.map(l => swapTo(l, HTTP_BASE));
fs.writeFileSync(path.join(R, 'X-AdBlock-http.sgmodule'), modHttp.join('\n'), 'utf8');
console.log('wrote X-AdBlock-http.sgmodule');

/*
 * 最终版: 完全剔除 X 的去广告脚本与 MITM。
 * 保留少量安全无副作用的广告/遥测域 REJECT（这些不影响 App 加载）。
 * 额外加 X 加速规则。
 */
const fin = [];
fin.push('# Shadowrocket: sr-cnip 基线 + X 加速优化 (无 MITM/无脚本)');
fin.push('# 生成来源: sr-cnip.conf + build-x-conf.js');
fin.push('# 说明: X 官方 App 的 api.x.com 被 MITM 会拆散 h2 会话导致无法加载,');
fin.push('#       故本配置不启用任何 X 解密与脚本, 只在域名层做拦截与加速。');
fin.push(...rulePart);
fin.push('');
fin.push(...AD_RULES);
fin.push('');
fin.push(...X_PROXY_RULES);
fin.push('');
fin.push('# ---- X 加速: 媒体 CDN 与 API 同出口, 避免会话 IP 漂移触发风控 ----');
fin.push('DOMAIN-SUFFIX,pscp.tv,PROXY');
fin.push('DOMAIN-SUFFIX,periscope.tv,PROXY');
fin.push('DOMAIN-SUFFIX,grok.com,PROXY');
fin.push('DOMAIN-SUFFIX,grok.x.ai,PROXY');
fin.push('');
fin.push('GEOIP,CN,DIRECT');
fin.push('FINAL,PROXY');
fin.push('');
fs.writeFileSync(path.join(R, 'sr-x-fast.conf'), fin.join('\n'), 'utf8');
console.log('wrote sr-x-fast.conf');


/*
 * 最小 MITM 模块: 用 - 排除语法避开长连接/媒体子域。
 * 手册: [MITM] hostname 支持前缀 - 排除特定主机名, 如 -*.example.com
 * 只解密 api.x.com, 其余全部排除。
 */
const modMin = [];
modMin.push('#!name=X 去广告 (仅 GraphQL)');
modMin.push('#!desc=只解密 api.x.com 的 GraphQL 响应; 显式排除 chat-ws/video/pbs/abs 等长连接与媒体子域, 避免拆散 App 的 h2 会话。模块规则优先于配置文件。');
modMin.push('#!system=ios');
modMin.push('#!author=xiaoyinge');
modMin.push('#!homepage=' + RAW_REPO + '/README.md');
modMin.push('');
modMin.push('[Rule]');
modMin.push(...AD_RULES);
modMin.push('');
modMin.push(...X_PROXY_RULES);
modMin.push('');
modMin.push('[URL Rewrite]');
modMin.push('^https?:\\/\\/api\\.(twitter|x)\\.com\\/1\\.1\\/ads\\/ - reject-dict');
modMin.push('');
modMin.push('[Script]');
modMin.push('X-AdBlock = type=http-response, pattern=' + X_PATTERN + ', requires-body=1, max-size=1048576, timeout=30, script-path=' + RAW_REPO + '/x_ads.js');
modMin.push('');
modMin.push('# chat-ws.x.com 是 wss:// WebSocket, 被 MITM 拆散后时间线永不加载');
modMin.push('[MITM]');
modMin.push('hostname = %APPEND% api.x.com, api.twitter.com');
modMin.push('');
fs.writeFileSync(path.join(R, 'X-AdBlock-min.sgmodule'), modMin.join('\n'), 'utf8');
console.log('wrote X-AdBlock-min.sgmodule');


/*
 * App 可用版: X 官方 App 的 api.x.com 一旦被 MITM, h2 会话会被拆散,
 * 时间线请求永远发不出(4 份日志实证)。这份配置不碰 X 的 MITM 与脚本,
 * 只做域名层拦截, 保证 App 正常工作。
 */
const appOut = [];
appOut.push('# Shadowrocket: sr-cnip + 广告域名拦截 (X App 可用版, 不解密 X)');
appOut.push('# 生成来源: sr-cnip.conf + build-x-conf.js');
appOut.push(...rulePart);
appOut.push('');
appOut.push(...AD_RULES);
appOut.push('');
appOut.push(...X_PROXY_RULES);
appOut.push('');
appOut.push('GEOIP,CN,DIRECT');
appOut.push('FINAL,PROXY');
appOut.push('');
appOut.push('[MITM]');
appOut.push('hostname = *.google.cn');
appOut.push('');
fs.writeFileSync(path.join(R, 'sr-x-appsafe.conf'), appOut.join('\n'), 'utf8');
console.log('wrote sr-x-appsafe.conf');


/*
 * 分级排查配置: 出问题时逐级启用, 定位到底哪一层打断了 X 的时间线
 *   sr-x-1-rules.conf   只加广告拦截规则, 不碰 MITM/脚本  <- 第 1 步
 *   sr-x-2-script.conf  第 1 步确认没问题后, 加 MITM(通配) + 只挂 HomeTimeline 脚本  <- 第 2 步
 *   sr-x-adblock.conf   完整版
 */
const mkConf = (name, opts) => {
  const o = [];
  o.push('# Shadowrocket: ' + name);
  o.push('# 生成来源: sr-cnip.conf + build-x-conf.js');
  o.push(...rulePart);
  o.push('');
  o.push(...AD_RULES);
  o.push('');
  o.push(...X_PROXY_RULES);
  o.push('');
  o.push('GEOIP,CN,DIRECT');
  o.push('FINAL,PROXY');
  if (opts.rewrite) {
    o.push('');
    o.push('[URL Rewrite]');
    o.push('^https?:\\/\\/api\\.(twitter|x)\\.com\\/1\\.1\\/ads\\/ - reject-dict');
  }
  if (opts.script) {
    o.push('');
    o.push('[Script]');
    o.push('X-AdBlock = type=http-response, pattern=' + opts.script + ', requires-body=1, max-size=-1, script-path=' + RAW_REPO + '/x_ads.js');
  }
  if (opts.mitm) {
    o.push('');
    o.push('[MITM]');
    o.push('hostname = ' + opts.mitm.join(','));
  }
  o.push('');
  fs.writeFileSync(path.join(R, name), o.join('\n'), 'utf8');
  console.log('wrote ' + name);
};

const CORE_PATTERN = '^https?:\\/\\/api\\.x\\.com\\/graphql\\/[-_A-Za-z0-9]+\\/(HomeTimeline|HomeLatestTimeline)(\\?|$)';

mkConf('sr-x-1-rules.conf', {});
mkConf('sr-x-2-script.conf', {
  rewrite: true,
  script: CORE_PATTERN,
  mitm: ['*.google.cn', 'api.x.com']
});

console.log('X_ID(ref)=' + X_ID);
