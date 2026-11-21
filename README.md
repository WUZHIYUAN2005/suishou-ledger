# 随手账本

React 记账网页，包含总览、账单、统计、订阅和卡包。

## 本地预览

在项目目录运行 `python -m http.server 4173`，然后打开 [随手账本](http://localhost:4173/)。仓库已有构建产物，预览时可直接启动静态服务器。

修改 `src/` 后，使用 pnpm 11 安装依赖并更新静态文件：

```sh
pnpm install --frozen-lockfile
pnpm run build
```

## 部署与数据

- 发布时保留原网站地址及 `index.html`、`cloud.html` 入口。浏览器会从原网站来源读取现有账目、储值卡、订阅和主题设置。
- 构建将 React、样式和两张界面图片内嵌到 `index.html` 与 `cloud.html`，并生成带版本标识的 `sw.js`。保留旧版 `assets/ledger-app.*`，供尚在使用上一个网页缓存的浏览器过渡。
- Google Drive 沿用已有的 OAuth 配置和版本 1 同步格式。真实授权需要从已配置的网页来源打开。
- 云端同步面板可在当前浏览器设置自动或手动备份。自动备份需要网页处于前台且授权有效。更改备份位置会移动同一个 Drive 文件，网页只列出当前授权可访问的私人文件夹，也可新建文件夹。
- 卡片封面保存在当前浏览器的 IndexedDB。账本 JSON 备份和 Google Drive 同步继续覆盖账单、卡片资料及订阅。

## 可选：Google Drive 长期授权与自动续期

仓库现在包含 [私有 OAuth 后端](./auth-worker/README.md) 和 [浏览器授权桥接模块](./auth-client.js)。它采用 Cloudflare Worker + KV 保存加密 Refresh Token，网页只保存本设备随机会话凭证。未部署 Worker 前，原来的 Google Drive Token 登录方式保持可用。

**部署前务必阅读后端目录的说明。** 需要自行配置 Worker、KV、Google OAuth 客户端重定向 URI 及 Cloudflare Secrets。请勿将 Client Secret、Refresh Token、加密密钥上传到 GitHub。
