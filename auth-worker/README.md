# 随手账本 · 长期 Google Drive 授权后端

这是一个 **Cloudflare Worker + KV** 的可选 OAuth 授权后端。它只保存经过 AES-GCM 加密的 Google Refresh Token；**账单、订阅和卡包内容不会上传到这个 Worker**，仍然直接在浏览器与自己的 Google Drive 之间同步。

网页原有 Google Drive Token 模式保留。**未配置 Worker 前不需要启用新的授权模式**。

## 一、准备

1. 有自己的 Cloudflare 账户，且能够创建 Worker 和 KV。
2. Google Cloud 项目已启用 Google Drive API；现有 OAuth 客户端属于 **Web application**（网页应用）。
3. Google Auth Platform → Audience：希望消除测试模式的 7 天授权期限，应先评估能否将应用发布为 **In production**。此步骤与 Worker 自动续期是不同的事情；发布状态不会自动产生 Refresh Token。
4. 现有 OAuth 客户端的 Client ID、Client Secret 只在 Cloudflare 后端中配置。**禁止提交 Client Secret、Refresh Token 或 TOKEN_ENCRYPTION_KEY 到 GitHub，也不要在聊天中分享。**

官方流程：https://developers.google.com/identity/protocols/oauth2/web-server

## 二、配置 Cloudflare Worker

在电脑 VS Code 的终端进入本仓库的 auth-worker 目录，执行：

```powershell
cd auth-worker
npx wrangler login
npx wrangler kv namespace create AUTH_KV
```

记录命令返回的 KV namespace ID，替换 `wrangler.toml` 里的 `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`。

将 `WORKER_BASE_URL` 改成你自己的 Worker 实际地址，例如：
`https://suishou-ledger-auth.<你的Cloudflare子域名>.workers.dev`。

注意：请确认这个地址与 Cloudflare 实际分配的网址完全一致。部署后的 Worker 路由是：
- `GET /health`：健康检查
- `GET /auth/start`：从浏览器开始 Google 授权
- `GET /auth/callback`：OAuth 授权码回调
- `POST /api/exchange`：换取本设备的会话凭证
- `POST /api/token`：用加密 Refresh Token 换取短期 Access Token
- `POST /api/logout`：撤销本设备的长期授权

## 三、修改 Google Cloud OAuth 客户端

进入 https://console.cloud.google.com/auth/clients ，编辑现有 **Web application** OAuth Client。

在 **Authorized redirect URIs**（已获授权的重定向 URI）增加：

```text
https://<你的Worker完整域名>/auth/callback
```

请填写真实域名，不要照抄尖括号；必须与 `WORKER_BASE_URL` 对应。

保留原本的 JavaScript 已获授权来源：
`https://wuzhiyuan2005.github.io`。

## 四、把密钥保存在 Cloudflare Secrets

在 `auth-worker` 目录运行：

```powershell
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put OWNER_EMAIL
npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

这四项按提示**逐项在你本机终端输入**，不要粘贴进 GitHub。OWNER_EMAIL 必须填写你登录 Google Drive 使用的 Gmail 地址。

生成 32 字节加密密钥的方法（在电脑上安装了 Node.js 的终端执行）：

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

将输出值用于 `TOKEN_ENCRYPTION_KEY`。不要更换已经使用的密钥，否则旧的加密 Refresh Token 将无法解密，需要重新登录。

随后部署：

```powershell
npx wrangler deploy
```

浏览器访问 `https://<你的Worker域名>/health`，预期可看到 `{"status":"ok","service":"suishou-ledger-auth"}`。

如果部署前 Wrangler 报缺少 Secrets，可先在 Cloudflare Dashboard 的 Worker 设置中填写这些秘密变量，再重新部署；请勿把真正的秘密写到公共 `wrangler.toml`。

## 五、让随手账本开启长期连接

在当前使用账本的浏览器打开：

https://wuzhiyuan2005.github.io/suishou-ledger/cloud.html

点击“Google Drive 同步”或进入“数据管理与备份”，在 Google Drive 分区内找到 **长期登录 · 自动刷新 Google 授权**。

输入 Worker 的真实 HTTPS 地址，点击“启用长期授权”，按 Google 页面完成一次授权。返回账本后，浏览器只保存随机生成的本设备会话凭证；Google Refresh Token 在 Worker KV 中加密存储。

后续每次打开网页，只要本设备的会话未被删除/撤销、Google 授权有效且 Worker 可访问，网页将尝试自动恢复 Google Drive 连接。令牌接近过期时会尝试自动续期。

**注意：** iOS 主屏幕 PWA、Safari、Chrome 使用的网页存储可能不互通，因此它们可能需要各授权一次。授权在 Google 侧失效、测试模式 7 天过期、KV 会话过期或网络不可用时仍需重新连接。

## 六、安全与恢复

- 这个 Worker 必须使用你自己部署的网址；不要把别人的 Worker 地址填进账本。
- 本地只有**随机会话凭证**，不会保存 Client Secret 或 Google Refresh Token。丢失该凭证，需要重新 Google 登录。
- 会话凭证本身具有敏感性，应避免安装不可信浏览器插件。新凭证不使用 `suishou-ledger.` 前缀，防止出现在现有的通用本地备份中。
- Worker 使用 `drive.file` 权限，而不是整个 Google Drive 的完全权限。
- 目前会话有效期为最长 120 天，活跃使用会延长该有效期；不能保证永不重新登录。
- “撤销本设备长期授权”会删除本地会话并请求 Worker 撤销 Google Refresh Token，不会删除账本数据。
- 恢复备份前，先使用网页“导出 JSON 备份”；此后端不提供云端数据版本历史替代品。
