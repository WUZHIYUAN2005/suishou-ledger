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
- 卡片封面保存在当前浏览器的 IndexedDB。账本 JSON 备份和 Google Drive 同步继续覆盖账单、卡片资料及订阅。
