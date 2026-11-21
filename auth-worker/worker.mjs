/**
 * 随手账本 OAuth refresh-token broker (Cloudflare Worker + KV).
 * Only refresh credentials are stored here. Ledger data stays in the browser and Google Drive.
 * All OAuth client secrets and the encryption key are configured as Cloudflare secrets.
 */
const SCOPE = "openid email https://www.googleapis.com/auth/drive.file";
const SESSION_DAYS = 120;
const SESSION_TTL = SESSION_DAYS * 24 * 60 * 60;
const TEMP_TTL = 600;
const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function unb64url(value) {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}
function randomToken() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}
async function digest(value) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
async function encryptionKey(env) {
  const raw = unb64url(env.TOKEN_ENCRYPTION_KEY);
  if (raw.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must encode 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(text, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(env), new TextEncoder().encode(text)),
  );
  return b64url(iv) + "." + b64url(ciphertext);
}
async function unseal(sealed, env) {
  const [nonce, ciphertext] = String(sealed).split(".");
  if (!nonce || !ciphertext) throw new Error("Invalid encrypted session");
  const data = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64url(nonce) },
    await encryptionKey(env),
    unb64url(ciphertext),
  );
  return new TextDecoder().decode(data);
}
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (origin !== env.APP_ORIGIN) return {};
  return {
    "Access-Control-Allow-Origin": env.APP_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}
function responseJSON(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...corsHeaders(request, env) },
  });
}
function redirect(url) {
  return new Response(null, { status: 302, headers: { Location: url, ...SECURITY_HEADERS } });
}
function assertOrigin(request, env) {
  if (request.headers.get("Origin") !== env.APP_ORIGIN) {
    throw Object.assign(new Error("Untrusted app origin"), { status: 403 });
  }
}
function requireSettings(env) {
  for (const key of [
    "AUTH_KV", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY",
    "OWNER_EMAIL", "WORKER_BASE_URL", "APP_ORIGIN", "APP_RETURN_URL",
  ]) {
    if (!env[key]) throw Object.assign(new Error("Worker setup incomplete: " + key), { status: 503 });
  }
  const callback = new URL("/auth/callback", env.WORKER_BASE_URL).href;
  if (!env.WORKER_BASE_URL.startsWith("https://") || !env.APP_RETURN_URL.startsWith(env.APP_ORIGIN + "/")) {
    throw Object.assign(new Error("Invalid Worker / app URL configuration"), { status: 503 });
  }
  return callback;
}
async function tokenRequest(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(payload),
      signal: controller.signal,
    });
    const result = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error("Google token exchange failed"), {
      status: result.error === "invalid_grant" ? 401 : 502,
      errorCode: result.error || "token_error",
    });
    return result;
  } finally {
    clearTimeout(timer);
  }
}
async function withSession(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  if (!match) throw Object.assign(new Error("Not connected"), { status: 401 });
  const key = "session:" + await digest(match[1]);
  const record = await env.AUTH_KV.get(key, "json");
  if (!record?.secret || record.email !== env.OWNER_EMAIL.toLowerCase()) {
    throw Object.assign(new Error("Session expired"), { status: 401 });
  }
  return { key, record };
}
async function start(request, env, callback) {
  const verifier = randomToken();
  const state = randomToken();
  await env.AUTH_KV.put("state:" + await digest(state), JSON.stringify({ verifier }), {
    expirationTtl: TEMP_TTL,
  });
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: callback,
    response_type: "code",
    scope: SCOPE,
    state,
    code_challenge: await digest(verifier),
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });
  return redirect("https://accounts.google.com/o/oauth2/v2/auth?" + params);
}
async function callback(request, env, callbackUrl) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!code || !/^[\w-]{43}$/.test(state)) throw Object.assign(new Error("Invalid callback"), { status: 400 });
  const stateKey = "state:" + await digest(state);
  const saved = await env.AUTH_KV.get(stateKey, "json");
  if (!saved?.verifier) throw Object.assign(new Error("Authorization expired; please connect again"), { status: 400 });
  await env.AUTH_KV.delete(stateKey);
  const tokens = await tokenRequest({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: callbackUrl,
    code_verifier: saved.verifier,
    grant_type: "authorization_code",
  });
  if (!tokens.access_token || !tokens.refresh_token) {
    throw Object.assign(new Error("Google did not issue offline access; revoke previous permission and try again"), { status: 400 });
  }
  // Verify account ownership with Google's authenticated userinfo endpoint.
  const identityResult = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: "Bearer " + tokens.access_token },
  });
  if (!identityResult.ok) throw Object.assign(new Error("Could not verify Google account"), { status: 502 });
  const user = await identityResult.json();
  if (user.email_verified !== true || String(user.email || "").toLowerCase() !== env.OWNER_EMAIL.toLowerCase()) {
    throw Object.assign(new Error("This Google account is not approved for the private ledger"), { status: 403 });
  }
  const session = randomToken();
  const key = "session:" + await digest(session);
  await env.AUTH_KV.put(key, JSON.stringify({
    email: String(user.email).toLowerCase(),
    secret: await seal(tokens.refresh_token, env),
    created: Date.now(),
  }), { expirationTtl: SESSION_TTL });
  const exchange = randomToken();
  await env.AUTH_KV.put("exchange:" + await digest(exchange), await seal(JSON.stringify({ session, access_token: tokens.access_token, expires_in: Number(tokens.expires_in) || 3600 }), env), { expirationTtl: TEMP_TTL });
  // The one-time code is in the URL fragment: the hosting server never receives it.
  return redirect(env.APP_RETURN_URL.split("#")[0] + "#cloud-auth=" + encodeURIComponent(exchange));
}
async function exchange(request, env) {
  assertOrigin(request, env);
  const json = await request.json().catch(() => ({}));
  const code = json?.code;
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(code)) {
    return responseJSON({ error: "Invalid login code" }, 400, request, env);
  }
  const key = "exchange:" + await digest(code);
  const stored = await env.AUTH_KV.get(key);
  if (!stored) return responseJSON({ error: "Login code expired; reconnect" }, 401, request, env);
  await env.AUTH_KV.delete(key);
  const credential = JSON.parse(await unseal(stored, env));
  return responseJSON({ ...credential, session_expires_in: SESSION_TTL }, 200, request, env);
}
async function refresh(request, env) {
  assertOrigin(request, env);
  const { key, record } = await withSession(request, env);
  let google;
  try {
    google = await tokenRequest({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: await unseal(record.secret, env),
      grant_type: "refresh_token",
    });
  } catch (err) {
    if (err.errorCode === "invalid_grant") {
      await env.AUTH_KV.delete(key);
      return responseJSON({ error: "Google authorization expired; connect again", reauthorize: true }, 401, request, env);
    }
    throw err;
  }
  if (!google.access_token || !(Number(google.expires_in) > 0)) {
    throw Object.assign(new Error("Google did not return a usable access token"), { status: 502 });
  }
  if (google.refresh_token) record.secret = await seal(google.refresh_token, env);
  await env.AUTH_KV.put(key, JSON.stringify(record), { expirationTtl: SESSION_TTL });
  return responseJSON({ access_token: google.access_token, expires_in: Number(google.expires_in) }, 200, request, env);
}
async function logout(request, env) {
  assertOrigin(request, env);
  const { key, record } = await withSession(request, env);
  // Revocation intentionally applies to only this device's Google refresh token.
  const refreshToken = await unseal(record.secret, env);
  await env.AUTH_KV.delete(key);
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // The local session is already invalid. Users can revoke permissions in Google account settings.
  }
  return responseJSON({ ok: true }, 200, request, env);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return responseJSON({ status: "ok", service: "suishou-ledger-auth" }, 200, request, env);
    }
    try {
      const callbackUrl = requireSettings(env);
      if (url.pathname.startsWith("/api/") && request.method === "OPTIONS") {
        assertOrigin(request, env);
        return new Response(null, { status: 204, headers: { ...SECURITY_HEADERS, ...corsHeaders(request, env) } });
      }
      if (url.pathname === "/auth/start" && request.method === "GET") {
        return await start(request, env, callbackUrl);
      }
      if (url.pathname === "/auth/callback" && request.method === "GET") {
        return await callback(request, env, callbackUrl);
      }
      if (url.pathname === "/api/exchange" && request.method === "POST") return await exchange(request, env);
      if (url.pathname === "/api/token" && request.method === "POST") return await refresh(request, env);
      if (url.pathname === "/api/logout" && request.method === "POST") return await logout(request, env);
      return responseJSON({ error: "Not found" }, 404, request, env);
    } catch (err) {
      const status = [400, 401, 403, 503].includes(err.status) ? err.status : 502;
      // Never include OAuth codes, credentials, tokens, or Google payloads in responses.
      return responseJSON({ error: err.message && !/token exchange/i.test(err.message) ? err.message : "Google authorization temporarily unavailable" },
        status, request, env);
    }
  },
};