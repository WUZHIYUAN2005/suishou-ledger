/* Optional Google OAuth refresh-token bridge for Suishou Ledger.
   Does not store Google client secrets, refresh tokens or ledger contents. */
(() => {
  "use strict";
  const URL_KEY = "__suishou_auth_backend_v1";
  const SESSION_KEY = "__suishou_auth_device_session_v1";
  const FRAGMENT = "cloud-auth=";
  let timer;
  let refreshing = null;
  let connectedViaBackend = false;
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const cleanUrl = (value) => {
    try {
      const u = new URL(String(value).trim());
      if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || u.pathname !== "/")
        throw new Error("invalid backend");
      return u.origin;
    } catch {
      throw new Error("请输入有效的 HTTPS 后端网址，例如 https://xxxx.workers.dev");
    }
  };
  const backend = () => {
    try { return cleanUrl(localStorage.getItem(URL_KEY) || ""); } catch { return ""; }
  };
  const session = () => localStorage.getItem(SESSION_KEY) || "";
  function message(text, isError = false) {
    const slot = $("#long-google-status");
    if (slot) {
      slot.textContent = text;
      slot.style.color = isError ? "var(--expense,#b64258)" : "var(--muted,#5a5a70)";
    }
  }
  async function request(path, body, bearer) {
    const base = backend();
    if (!base) throw new Error("请先填写并保存安全后端网址");
    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(), 16000);
    try {
      const response = await fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
        },
        mode: "cors",
        body: JSON.stringify(body || {}),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || "授权服务不可用");
        error.status = response.status;
        error.reauthorize = data.reauthorize === true;
        throw error;
      }
      return data;
    } finally {
      clearTimeout(handle);
    }
  }
  async function renew() {
    if (refreshing) return refreshing;
    const active = session();
    if (!active) return;
    refreshing = (async () => {
      try {
        message("正在自动恢复 Google Drive 连接…");
        const result = await request("/api/token", {}, active);
        if (active !== session()) return;
        if (!result.access_token || !Number.isFinite(Number(result.expires_in))) throw new Error("令牌响应无效");
        if (typeof window.__suishouCloudActivate !== "function")
          throw new Error("账本授权接口尚未加载");
        window.__suishouCloudActivate(result.access_token, result.expires_in);
        connectedViaBackend = true;
        message("已启用自动续期；下次打开会尝试自动恢复连接");
        clearTimeout(timer);
        timer = setTimeout(() => void renew(), Math.max(60000, (Number(result.expires_in) - 300) * 1000));
      } catch (error) {
        if (error.status === 401) {
          localStorage.removeItem(SESSION_KEY);
          connectedViaBackend = false;
          message("长期授权已过期，请重新登录一次", true);
        } else {
          message("暂时无法自动续期：" + error.message + "。本地账目仍然安全。", true);
          clearTimeout(timer);
          timer = setTimeout(() => void renew(), 60000);
        }
      }
    })();
    try { await refreshing; } finally { refreshing = null; }
  }
  async function loginResponse() {
    if (!location.hash.startsWith("#" + FRAGMENT)) return false;
    const oneTimeCode = decodeURIComponent(location.hash.slice(FRAGMENT.length + 1));
    // Never let the one-time code be retained in browser history, logs, or screenshots.
    history.replaceState(null, "", location.pathname + location.search + "#overview");
    try {
      message("正在完成 Google 长期授权…");
      if (!/^[A-Za-z0-9_-]{43}$/.test(oneTimeCode)) throw new Error("回调验证码无效");
      const data = await request("/api/exchange", { code: oneTimeCode });
      if (!/^[A-Za-z0-9_-]{43}$/.test(data.session || "")) throw new Error("会话凭证无效");
      localStorage.setItem(SESSION_KEY, data.session);
      await renew();
    } catch (error) {
      message("授权未完成：" + error.message, true);
      alert("Google 长期授权未完成：" + error.message + "。原有本地账目没有修改。");
    }
    return true;
  }
  async function stopLongSession() {
    const token = session();
    localStorage.removeItem(SESSION_KEY);
    clearTimeout(timer);
    connectedViaBackend = false;
    if (token) {
      try { await request("/api/logout", {}, token); } catch (error) {
        console.warn("Remote session revocation failed; revoke the app in Google account settings if needed");
      }
    }
    message("已停止长期连接");
  }
  function section() {
    const root = [...document.querySelectorAll(".management-section")]
      .find((node) => node.querySelector("h3")?.textContent.trim() === "Google Drive");
    if (!root || $("#suishou-long-auth", root)) return;
    const host = document.createElement("div");
    host.id = "suishou-long-auth";
    host.style.cssText = "margin-top:14px;padding:13px;border:1px solid var(--inner-rim);border-radius:17px;background:var(--surface)";
    const title = document.createElement("h4");
    title.textContent = "长期登录 · 自动刷新 Google 授权";
    title.style.cssText = "font-size:.9rem;margin:0 0 7px;font-weight:680";
    const note = document.createElement("p");
    note.style.cssText = "font-size:.8rem;line-height:1.5;margin:4px 0 10px;color:var(--muted)";
    note.textContent = "需要先部署私有安全后端。后端只保存加密刷新令牌，不会保存你的账单；未启用前不影响上面的原连接方式。";
    const label = document.createElement("label");
    label.textContent = "我的安全后端 HTTPS 地址";
    label.style.cssText = "display:block;font-size:.8rem;margin:0 0 7px;color:var(--muted)";
    const input = document.createElement("input");
    input.type = "url";
    input.placeholder = "https://xxxx.workers.dev";
    input.value = backend();
    input.autocomplete = "off";
    input.spellcheck = false;
    input.style.cssText = "width:100%;margin-top:5px;padding:10px 11px;border:1px solid var(--rim);border-radius:12px;background:var(--inset);color:var(--ink);font:inherit";
    label.append(input);
    const buttons = document.createElement("div");
    buttons.className = "action-row";
    buttons.style.marginTop = "8px";
    const connect = document.createElement("button");
    connect.className = "glass-button";
    connect.type = "button";
    const face1 = document.createElement("span");face1.className = "glass-face";face1.textContent = "启用长期授权";
    connect.append(face1);
    connect.addEventListener("click", () => {
      try {
        const addr = cleanUrl(input.value);
        if (!addr) throw Error("未填写地址");
        if (!confirm("将前往你的私人授权后端，通过 Google 登录并允许访问由随手账本创建的 Drive 文件。确定继续吗？"))return;
        localStorage.setItem(URL_KEY, addr);
        location.assign(addr + "/auth/start");
      } catch (error) { message(error.message, true); }
    });
    const disconnect = document.createElement("button");
    disconnect.className = "glass-button";
    disconnect.type = "button";
    const face2 = document.createElement("span");face2.className = "glass-face";face2.textContent = "撤销本设备长期授权";
    disconnect.append(face2);
    disconnect.addEventListener("click", async () => {
      if (!confirm("这会撤销本设备保存的长期 Google 授权，但不删除任何账单。确定继续？"))return;
      await stopLongSession();
      location.reload();
    });
    const status = document.createElement("p");
    status.id = "long-google-status";
    status.setAttribute("role","status");
    status.style.cssText = "font-size:.8rem;margin:8px 0 0;color:var(--muted);overflow-wrap:anywhere";
    status.textContent = session() ? "本设备存在长期授权，将在打开账本时自动续期" : "未设置长期授权，仍可继续使用上面的普通连接";
    buttons.append(connect, disconnect);
    host.append(title,note,label,buttons,status);
    root.append(host);
  }
  const observer = new MutationObserver(() => section());
  const mount = () => {
    const root = $("#root");
    if (root) observer.observe(root, { childList: true, subtree: true });
    section();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once:true });
  else mount();
  (async () => {
    if (!(await loginResponse()) && session()) await renew();
  })();
  window.addEventListener("focus", () => {
    // Resume refresh when iOS wakes an installed PWA after a long sleep.
    if (connectedViaBackend && session()) {
      clearTimeout(timer);
      timer = setTimeout(() => void renew(), 1000);
    } else if (session()) {
      void renew();
    }
  });
  // Stop from the original in-app Google Drive "停止同步" button also invalidates the long session.
  document.addEventListener("click", (event) => {
    const el = event.target.closest?.("button");
    if (el && el.textContent.trim() === "停止同步" && session()) {
      void stopLongSession();
    }
  }, true);
})();