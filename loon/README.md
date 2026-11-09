# Loon 插件：X（Twitter）去广告 · 网络优化

一个 Loon 插件，移除 X 时间线 / 评论区 / 搜索页 / 趋势页里的推广内容，
拦截广告投放域名与 Jot 埋点上报，顺带减少一部分无效流量。

## 订阅地址

插件（Loon → 配置 → 插件 → 添加）：

```
https://cdn.jsdelivr.net/gh/xiaoyinge/Shadowrocket-X-AdBlock@main/loon/X-Optimize.plugin
```

脚本（插件 `[Script]` 段已内置此地址）：

```
https://cdn.jsdelivr.net/gh/xiaoyinge/Shadowrocket-X-AdBlock@main/loon/x-clean.js
```

## 安装

1. 添加插件：Loon → 配置 → 插件 → 右上角 + → 粘贴上面的插件地址。
2. 首次生效需要 MitM：按提示安装证书，并在
   「设置 → 通用 → 关于本机 → 证书信任设置」中打开 Loon 的开关。
3. 插件设置里可分别开关：去信息流广告 / 隐藏推荐关注 / 拦截 Jot 埋点 / 脚本超时。

## 三层拦截

- **Rule**：`ads-api.x.com`、`ads.x.com`、`ads-api.twitter.com`、`ads-twitter.com`、
  `analytics.x.com` 等投放与统计域名直接 REJECT。这些域名不承载正文和媒体，拒绝不影响浏览。
- **Rewrite**：`/jot/client_event`、`/live_pipeline/events` 本地返回 `{}`，
  断掉埋点上报和随之而来的重试流量。
- **Script**：对 `/i/api/graphql/<queryId>/<QueryName>` 的响应做结构化清洗，覆盖
  `HomeTimeline`、`HomeLatestTimeline`、`TweetDetail`、`SearchTimeline`、
  `UserTweets`、`UserMedia`、`NotificationsTimeline`、`Bookmarks`、`Guide` 等。

判定依据只有三个可靠字段：`entryId` 含 `promoted`、`itemContent.promotedMetadata` 存在、
`displayType` 以 `promoted` 开头。不匹配推文正文，正文里出现 "promoted" 字样的正常推文不会被误删。
会话/模块容器只清内部 items，容器空了才整体删除，避免数组错位造成界面空白。

## 可选：网络优化

插件里的 `[General]` 是「追加」语义，不会覆盖主配置，默认注释掉了。
需要就取消 `X-Optimize.plugin` 中 `[General]` 段的注释：

- `dns-server` / `doh-server`：换用低延迟 DNS
- `real-ip`：让 X 的 CDN 域名直连真实 IP，减少一次 DNS 往返
- `bypass-tun`：把局域网段排除出 TUN，避免内网访问变慢

## 已知限制

- 只处理 GraphQL 结构化广告位。X 若把广告做成原生推文（不带 `promotedMetadata`），需新样本适配。
- 开了 MitM 会解密这几个域名，公共 Wi-Fi 下请自行评估；范围仅限
  `x.com,twitter.com,api.x.com,api.twitter.com`。

## License

MIT