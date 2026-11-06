# Shadowrocket X / Instagram 去广告

小火箭（Shadowrocket）配置与脚本，用来删掉 **X（Twitter）** 和 **Instagram** 信息流里的推广内容，同时保留原有的国内外分流规则。

配套的 YouTube / Twitch / Reddit 去广告脚本也放在本仓库。

---

## 这是什么

X 时间线里的广告（比如首页那条 Kalshi）不是独立域名，而是 **GraphQL 响应体里的推广条目**，用 `DOMAIN-SUFFIX,xxx,REJECT` 永远拦不到。唯一能删掉它的位置是 `http-response` 脚本：把响应体里的推广节点摘掉再交还渲染。

本项目做三件事：

| 层 | 做法 |
|---|---|
| 域名层 | 拦掉 `ads-twitter.com` / `ads-api.twitter.com` / `analytics.twitter.com` 等埋点域 |
| 接口层 | `api.x.com/1.1/ads/`、`/1.1/live_pipeline/` 直接 `reject-dict` |
| 响应体层 | 脚本解析 `graphql/<hash>/HomeTimeline` 等接口 JSON，删推广条目前返回 |

---

## 快速开始

### 方式一：模块叠加（推荐，不动你现有配置）

小火箭 → **配置 → 模块 → 右上角 + → 从文件导入**，选择仓库里的 [X-AdBlock.sgmodule](X-AdBlock.sgmodule)。

也可以直接填远程地址：

```
https://raw.githubusercontent.com/xiaoyinge/Shadowrocket-X-AdBlock/main/X-AdBlock.sgmodule
```

模块里的 MITM 用的是 `hostname = %APPEND% ...`，只会**追加**域名，不会覆盖你原有配置的 MITM。

### 方式二：整份配置

```
https://raw.githubusercontent.com/xiaoyinge/Shadowrocket-X-AdBlock/main/sr-x-adblock.conf
```

配置基于 [sr-cnip.conf](sr-cnip.conf)（国内直连、国外代理）合成，并把 `update-url` 注释掉，防止自动更新覆盖脚本与 MITM。

---

## 必做：开启 HTTPS 解密

不装证书、不开解密，脚本一次都不会触发 —— 这是 90% “规则不生效” 的真正原因。

1. 小火箭 → **配置** → 当前配置后面的 ⓘ → **HTTPS 解密**
2. **证书** → **生成新的 CA 证书** → **安装证书**
3. iOS 设置 → 已下载描述文件 → 安装
4. iOS 设置 → 通用 → 关于本机 → **证书信任设置** → 打开 Shadowrocket
5. 回到该配置的 ⓘ 页，确认「HTTPS 解密」处于开启状态

> 注意：小火箭的**设置页里没有**「重写」「脚本」这两个开关，它们挂在「配置」和「模块」上，别在设置页里找。

---

## 另一个坑：QUIC

X 客户端会尝试 HTTP/3（QUIC 走 UDP）。UDP 如果不走代理，脚本拿不到 body。

小火箭 → **设置 → UDP**，让 UDP 走**代理**而不是直连/拒绝。QUIC 失败后会自动回落 HTTP/2。

---

## 验证是否生效

1. 配置 → 模块，确认「X / Instagram 去广告」是开启状态
2. 配置 ⓘ → HTTPS 解密，确认已开启
3. 首页连上节点，刷 X 首页
4. 看请求记录，应出现 `graphql/<hash>/HomeTimeline`，点开详情能看到脚本 **X-AdBlock**
5. 有记录但广告还在 → X 换了字段名，见下方「排障」
6. 没有记录 → 卡在 MITM 或 QUIC，回到上面两节

---

## 脚本做了什么

### [x_ads.js](x_ads.js)

- **双环境兼容**：Loon 的全局 `$response/$done` 和 Shadowrocket 的 `window.$response/window.$done` 都认
- **幂等守卫**：X 的 GraphQL 一条响应会分多次 emit，旧脚本会在已经删干净的 JSON 上反复重跑直到报错。现在按 body 指纹去重，同一份 body 只处理一次
- **推广位检测**：`entryId=promoted-*` / `promotedMetadata` / `adMetadataContainer` / `__typename=PromotedTweet` / `legacy.promoted_status_id_str` / `promotedStatus`
- **轮播广告**：`TimelineTimelineModule + displayType:Carousel` 那种两格视频广告整块删
- **推荐位**：`who-to-follow` / 推荐用户 / 推广趋势
- **cursor 保护**：分页 cursor 永不删除，删了整页翻不动
- **去重**：同页重复 `rest_id` 只留第一条，且只对 `tweet-*` 时间线 entry 生效，不误伤内嵌媒体数组

### [ig_ads.js](ig_ads.js)

- `ad_id` / `is_ad` / `ad_metadata` 媒体
- `stories_netego` / `bloks_netego` 推荐位（**对象键形式删的是键**，早期版本只遍历数组所以删不掉）
- `suggested_users`

### 其它

- [youtube_ads.js](youtube_ads.js)：删 `/youtubei/v1/{player,next,browse,search}` 响应里的 `adPlacements/adSlots/playerAds` 等字段，保留 `streamingData`
- [twitch_ads.js](twitch_ads.js)：删 m3u8 里 `CLASS="twitch-stitched-ad"` 的 DATERANGE 块与覆盖分片
- [reddit_ads.js](reddit_ads.js)：兼容老 API `isPromoted` 与 shreddit `promotedStatus` 两种位置

---

## 小火箭返回格式

在 Shadowrocket 里脚本拿到的响应对象是 `window.$response`，结束用 `window.$done(...)`：

```javascript
// 修改并返回
window.$done({ body: JSON.stringify(json) });

// 不改动，原样放行
window.$done({});
```

`[Script]` 段里 `requires-body=1` 必须写，否则脚本拿到空 body；`max-size=0` 表示不限大小。

---

## 仓库结构

```
.
├── x_ads.js                  X 去广告脚本
├── ig_ads.js                 Instagram 去广告脚本
├── youtube_ads.js            YouTube
├── twitch_ads.js             Twitch
├── reddit_ads.js             Reddit
├── X-AdBlock.sgmodule        模块（raw 地址版）
├── X-AdBlock-local.sgmodule  模块（裸文件名版）
├── X-AdBlock-http.sgmodule   模块（本机 HTTP 托管版）
├── sr-cnip.conf              上游基线配置
├── sr-x-adblock.conf         整份配置（raw 地址版）
├── sr-x-adblock-local.conf   整份配置（裸文件名版）
├── sr-x-adblock-http.conf    整份配置（本机 HTTP 托管版）
├── build-x-conf.js           由 sr-cnip.conf 生成上面几份
├── validate.py               配置语法校验
├── serve.js                  本机静态服务（调试用）
└── test/                     脚本单元测试
```

重新生成配置：

```bash
RAW_REPO=https://raw.githubusercontent.com/xiaoyinge/Shadowrocket-X-AdBlock/main node build-x-conf.js
python validate.py sr-x-adblock.conf
```

---

## 测试

```bash
node test/x.js      # X：18 项，含小火箭环境 / 幂等 / 轮播广告
node test/ig.js     # Instagram：6 项
node test/run.js    # YouTube / Twitch / Reddit：19 项
python validate.py sr-x-adblock.conf
```

```text
x_ads:  18 passed, 0 failed
ig_ads:  6 passed, 0 failed
RESULT: 19 passed, 0 failed
错误: 0 / 警告: 0
```

---

## 故障：打开 X 提示「帖子暂时无法载入」

这是脚本把响应吞了。两个原因，都已在当前版本修掉：

| 原因 | 说明 | 修复 |
|---|---|---|
| `$done({})` 的语义 | 小火箭把空对象当作「响应体为空」，原 body 被丢弃，App 侧就是「帖子暂时无法载入」 | 所有「不改动」分支改成 `$done({ status, headers, body: 原body })` 原样回传 |
| `max-size=0` | 写成 0 时响应体可能拿不到/被截断 | 改为 `max-size=-1`（不限） |

自检：`node test/x.js` 有一项 `所有分支都回流 body（不被吞）`，7 种输入（正常/已清理/空串/非 JSON/数组/空对象/无广告）逐个验证不会吞响应。

---

## 实测日志复核（2026-11-06 15:56）

用收到的 proxy.db / dns.db 核对了 62 条连接 + 55 条 DNS 记录，发现三处问题，已修。

### 1. 广告域漏网：`ads-api.x.com`

日志原文：

```
https://ads-api.x.com/12/measurement/dcm_local_id   ->  FINAL,PROXY
```

配置里只有 `ads-api.twitter.com`，没有 `.x.com` 版本，所以每次都走代理去拉广告测量。已补：

```ini
DOMAIN-SUFFIX,ads-api.x.com,REJECT
```

### 2. 广告域被判成国内直连

`googleads.g.doubleclick-cn.net:443 -> GEOIP,CN,DIRECT` —— 因为解析到 `114.250.64.42`（国内 IP），命中 `GEOIP,CN,DIRECT` 就直连了。上游 sr-cnip 里根本没有 doubleclick 相关规则。已补 4 条 REJECT，放在 `GEOIP,CN,DIRECT` 之前。

### 3. DNS 空转 40+ 次

`lb._dns-sd._udp.44.235.39.100.in-addr.arpa` 在 30 秒里被查了 **40 多次**，全部返回空，`elapsed=0`。原因是 `dns-server` 只写了两个公共 DoH，内网反向解析被丢给它们，秒失败秒重试。已改成：

```ini
dns-server = system, https://dns.alidns.com/dns-query, https://doh.pub/dns-query
```

### 4. 遥测域

`o30969.ingest.us.sentry.io`、`app-analytics-services.com`、`crashlyticsreports-pa.googleapis.com` 都在跑。注意 `sentry.io` 不能整域拦——上游第 186 行有 `disney.my.sentry.io,PROXY`，会冲突。所以只拦 X 的 ingest 子域。

### 日志证明的另一件事

62 条连接里**没有一条 `api.x.com/graphql/*/HomeTimeline`**，全是 `flow/viewer.json`、`grokAccountJwtQuery`、`xLegacySubscriptionsInventoryQuery` 这类启动接口，加上大量 `video-s.twimg.com` 视频分片。

这说明：**X 首页时间线根本没走到脚本**。不是脚本没删干净，是那个请求压根没出现——大概率是你打开 App 后卡在「帖子暂时无法载入」，时间线接口没成功发起。先按上面修完配置、确认能正常刷新，再看广告。

---

## 导入后怎么让它生效

小火箭**没有「编译配置」这个按钮**，长按/点击配置文件弹出的是：使用配置 / 编辑配置 / 编辑纯文本 / 预览 / 更新 / 重新命名。

| 操作 | 作用 | 什么时候用 |
|---|---|---|
| **使用配置** | 切换成这份配置，重新加载规则 | 刚导入后必点 |
| **更新** | 按配置里的 `update-url` 重新下载 | 我更新了脚本/规则，想同步 |
| **编辑配置** | UI 改 MITM、URL 重写、脚本、HTTPS 解密 | 改局部设置 |
| **预览** | 只看不含 MITM/脚本的规则部分 | 核对规则 |

所以：**重新导入 → 点「使用配置」即可**，不用找编译按钮。

本仓库配置里的 `update-url` 指向自己：

```ini
update-url = https://raw.githubusercontent.com/xiaoyinge/Shadowrocket-X-AdBlock/main/sr-x-adblock.conf
```

以后我推了新版本，你在手机上点 **更新** 就能同步，不会再被上游 `sr_cnip.conf` 覆盖。

---

## 故障：开启 HTTPS 解密后「帖子暂时无法载入」，关闭就正常

根因在脚本的返回格式，**不是 MITM，也不是规则**。

| 写法 | 小火箭的行为 | 结果 |
|---|---|---|
| `$done({})` | 当作「响应体为空」 | 原 body 被丢弃 → 帖子无法载入 |
| `$done({ status, headers, body })` | 原 header 带 `content-encoding: gzip` 和压缩后的 `content-length`，但我们给的是**解压后的明文** | App 按 gzip 解明文 → 失败 |
| `$done({ body })` ✅ | 只替换 body，header 由运行时自行处理 | 正常 |

所以脚本里所有出口（包括「不改动」的直通分支）一律只回 `{ body }`：

```javascript
function pass(body) {
  finish({ body: (body === undefined) ? raw : body });
}
```

回归测试锁死了这条：`test/x.js` 有一项 `任何分支都不回传 headers`。

## 故障：某些 X 子域走直连（`chat-ws.x.com -> GEOIP,CN,DIRECT`）

基线 `sr-cnip.conf` 里**一条 X 规则都没有**，全靠 `FINAL,PROXY` 兜底。一旦某个子域（如 `chat-ws.x.com`）的 DNS 返回国内 IP，`GEOIP,CN,DIRECT` 就会抢先命中，请求直接出隧道。

现已显式加规则，且顺序严格为 REJECT → PROXY → GEOIP：

```ini
DOMAIN-SUFFIX,ads-api.x.com,REJECT      # 454
DOMAIN-SUFFIX,x.com,PROXY               # 468
DOMAIN-SUFFIX,twitter.com,PROXY
DOMAIN-SUFFIX,twimg.com,PROXY
GEOIP,CN,DIRECT                         # 477
FINAL,PROXY                             # 478
```

---

## 排障

| 现象 | 原因 | 处理 |
|---|---|---|
| 完全没有 `HomeTimeline` 请求记录 | HTTPS 解密没开 | 见「必做：开启 HTTPS 解密」 |
| 有请求记录但没有脚本名 | 配置没编译 / MITM 不含域名 | 点「编译配置」；检查 MITM 是否含 `*.x.com` |
| 脚本名在但响应体没变 | X 改了字段名 | 改 `x_ads.js` 里的 `AD_TYPENAMES` |
| 广告时有时无 | UDP 走了直连，X 用 HTTP/3 | 设置 → UDP 走代理 |
| 打开 X 提示「帖子暂时无法载入」 | 脚本回 `$done({})` 吞了响应 | 更新到最新脚本；见上一节 |
| 配完规则全失效 | 行内 `//` 注释被当成策略名 | 用本仓库生成的配置，已清掉 |

---

## 已知限制

- X 的 GraphQL 响应结构是半稳定契约，App 大版本更新可能改字段名
- 走 WebSocket / 流式增量下发的内容**不经过** `http-response`，脚本覆盖不到（当前 X 主时间线仍是 HTTP GraphQL）
- 广告由服务端按 `ads` 参数注入，本项目是**本地渲染层过滤**，请求里仍会带推广数据

---

## 致谢

基线分流配置来自 [Johnshall/Shadowrocket-ADBlock-Rules-Forever](https://github.com/Johnshall/Shadowrocket-ADBlock-Rules-Forever)。

## 许可

MIT
