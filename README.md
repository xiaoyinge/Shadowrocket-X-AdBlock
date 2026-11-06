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

## 排障

| 现象 | 原因 | 处理 |
|---|---|---|
| 完全没有 `HomeTimeline` 请求记录 | HTTPS 解密没开 | 见「必做：开启 HTTPS 解密」 |
| 有请求记录但没有脚本名 | 配置没编译 / MITM 不含域名 | 点「编译配置」；检查 MITM 是否含 `*.x.com` |
| 脚本名在但响应体没变 | X 改了字段名 | 改 `x_ads.js` 里的 `AD_TYPENAMES` |
| 广告时有时无 | UDP 走了直连，X 用 HTTP/3 | 设置 → UDP 走代理 |
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
