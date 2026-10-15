/*
 * LABDAM / LabInsight: Google OAuth + Cloudflare Workers Free + D1.
 * Free and approval-only. No Cloudflare Access, subscriptions, or card billing.
 * Caffeine Atlas stays an independent public GitHub Pages service.
 * Authentication must ALWAYS execute before the protected ASSETS binding.
 */
const SESSION_SECONDS = 7 * 24 * 3600;
const OAUTH_SECONDS = 600;
const GOOGLE_TIMEOUT_MS = 10_000;
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const COOKIE_SESSION = "__Host-labdam_session";
const COOKIE_OAUTH = "__Host-labdam_oauth_state";
const MAX_REASON = 240;
const textEncoder = new TextEncoder();

class LoginError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const nowSecs = (opts) => opts.now ?? Math.floor(Date.now() / 1000);
const tokenRandom = (bytes = 32) => {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map(n => n.toString(16).padStart(2, "0")).join("");
};
async function digest(text) {
  const bytes = await crypto.subtle.digest("SHA-256", textEncoder.encode(text));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, "0")).join("");
}
function encodeUrl(bytes) {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function pkceChallenge(verifier) {
  return encodeUrl(new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(verifier))));
}
function validOrigin(env) {
  const value = env?.AUTH_ORIGIN;
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search ||
        url.hash || url.pathname !== "/" || url.origin !== value.replace(/\/$/, "")) return null;
    return url.origin;
  } catch (_) { return null; }
}
function configured(env) {
  if (!env?.DB || typeof env.DB.prepare !== "function" ||
      !validOrigin(env) ||
      typeof env.GOOGLE_CLIENT_ID !== "string" || !/^[A-Za-z0-9_.-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID) ||
      typeof env.GOOGLE_CLIENT_SECRET !== "string" || env.GOOGLE_CLIENT_SECRET.length < 12 ||
      typeof env.RATE_LIMIT_SECRET !== "string" || env.RATE_LIMIT_SECRET.length < 32) {
    throw new LoginError(503, "무료 로그인 서비스가 아직 설정되지 않았습니다.");
  }
}
function safetyHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Vary", "Cookie");
  return new Response(response.body, {
    status: response.status, statusText: response.statusText, headers
  });
}
function simple(status, message) {
  return safetyHeaders(new Response(message, {
    status, headers: { "Content-Type": "text/plain; charset=utf-8" }
  }));
}
function json(status, data) {
  return safetyHeaders(new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json; charset=utf-8" }
  }));
}
function redirect(path, origin, status = 303) {
  return safetyHeaders(Response.redirect(origin + path, status));
}
function cookieMap(request) {
  const out = new Map();
  for (const entry of (request.headers.get("Cookie") || "").split(";")) {
    const idx = entry.indexOf("=");
    if (idx > 0) out.set(entry.slice(0, idx).trim(), entry.slice(idx + 1).trim());
  }
  return out;
}
function putCookie(response, name, value, maxAge) {
  const h = new Headers(response.headers);
  h.append("Set-Cookie", name + "=" + value + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
}
function safeNext(value) {
  if (typeof value !== "string" || value.length > 350 ||
      !value.startsWith("/") || value.startsWith("//") || /[\r\n\\]/.test(value)) return "/";
  try {
    const u = new URL(value, "https://example.test");
    if (u.origin !== "https://example.test") return "/";
    if (u.pathname === "/" || u.pathname.startsWith("/labinsight/") ||
        u.pathname === "/account.html" || u.pathname === "/admin.html") {
      return u.pathname + u.search;
    }
  } catch (_) { /* bad path */ }
  return "/";
}
function bytesOf(segment) {
  if (!/^[a-zA-Z0-9_-]+$/.test(segment)) throw new LoginError(401, "Google 인증 정보가 올바르지 않습니다.");
  const raw = atob(segment.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - segment.length % 4) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function decodedJson(segment) {
  try { return JSON.parse(new TextDecoder().decode(bytesOf(segment))); }
  catch (_) { throw new LoginError(401, "Google 인증 정보가 올바르지 않습니다."); }
}
async function googleIdentity(idToken, nonce, env, opts) {
  const parts = typeof idToken === "string" ? idToken.split(".") : [];
  if (parts.length !== 3 || idToken.length > 12000) throw new LoginError(401, "Google 인증에 실패했습니다.");
  const header = decodedJson(parts[0]), payload = decodedJson(parts[1]);
  const now = nowSecs(opts);
  if (!header || !payload || typeof header !== "object" || typeof payload !== "object" ||
      Array.isArray(header) || Array.isArray(payload) ||
      header.alg !== "RS256" || typeof header.kid !== "string" ||
      !/^[A-Za-z0-9_-]{3,200}$/.test(header.kid) ||
      !["accounts.google.com", "https://accounts.google.com"].includes(payload.iss) ||
      payload.aud !== env.GOOGLE_CLIENT_ID ||
      (payload.azp != null && payload.azp !== env.GOOGLE_CLIENT_ID) ||
      payload.nonce !== nonce || payload.email_verified !== true ||
      typeof payload.sub !== "string" || !/^[0-9]{6,36}$/.test(payload.sub) ||
      typeof payload.email !== "string" || payload.email.length > 254 ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email) ||
      !Number.isSafeInteger(payload.exp) || payload.exp <= now ||
      !Number.isSafeInteger(payload.iat) || payload.iat > now + 60) {
    throw new LoginError(401, "Google 계정 인증 내용이 올바르지 않습니다.");
  }
  let keys;
  try {
    const response = await (opts.googleFetch || fetch)(GOOGLE_JWKS_URL, {
      redirect: "manual", signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS)
    });
    // workerd rejects the unsupported error redirect mode at request construction time. Explicitly
    // reject any 3xx instead of following a response to an untrusted host.
    if (response.status >= 300 && response.status < 400) throw new Error("Google key endpoint redirect blocked");
    if (!response.ok) throw new Error("Google public signing keys unavailable");
    keys = (await response.json()).keys;
  } catch (_) { throw new LoginError(503, "Google 인증 키를 확인할 수 없습니다."); }
  const key = Array.isArray(keys) && keys.find(k =>
    k.kid === header.kid && k.kty === "RSA" && k.use === "sig" &&
    (!k.alg || k.alg === "RS256"));
  if (!key) throw new LoginError(401, "인증 서명 키가 일치하지 않습니다.");
  try {
    const imported = await crypto.subtle.importKey("jwk", key,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", imported,
      bytesOf(parts[2]), textEncoder.encode(parts[0] + "." + parts[1]));
    if (!valid) throw new LoginError(401, "Google 인증 서명 확인에 실패했습니다.");
  } catch (error) {
    if (error instanceof LoginError) throw error;
    throw new LoginError(401, "Google 인증 서명을 확인할 수 없습니다.");
  }
  return {
    sub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    // A verified third-party address may no longer belong to this Google
    // account. Only Google-hosted addresses may bootstrap an administrator.
    emailAuthoritative: payload.email.toLowerCase().endsWith("@gmail.com") ||
      (typeof payload.hd === "string" && /^[a-z0-9.-]+$/i.test(payload.hd) &&
       payload.email.toLowerCase().endsWith("@" + payload.hd.toLowerCase())),
    name: typeof payload.name === "string" ? payload.name.trim().slice(0, 80) : ""
  };
}
async function throttle(request, env, now) {
  // A hashed network identifier limits accidental/automated OAuth state creation.
  // Raw IP addresses are never stored.
  const ip = (request.headers.get("CF-Connecting-IP") || "unknown").slice(0, 100);
  const actorHash = await digest(env.RATE_LIMIT_SECRET + ":" + ip);
  const windowStart = Math.floor(now / 3600) * 3600;
  await env.DB.prepare(
    "INSERT INTO login_throttle(actor_hash,window_start,attempts) VALUES (?,?,1) " +
    "ON CONFLICT(actor_hash) DO UPDATE SET attempts=CASE WHEN window_start<? THEN 1 ELSE attempts+1 END," +
    "window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END"
  ).bind(actorHash, windowStart, windowStart, windowStart).run();
  const record = await env.DB.prepare("SELECT attempts FROM login_throttle WHERE actor_hash=?")
    .bind(actorHash).first();
  if (!record || record.attempts > 20) throw new LoginError(429, "잠시 후 다시 시도해 주세요.");
}
async function oauthStart(request, env, origin, opts) {
  const now = nowSecs(opts);
  await throttle(request, env, now);
  const state = tokenRandom(), verifier = tokenRandom(40), nonce = tokenRandom(24);
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  await env.DB.prepare(
    "INSERT INTO oauth_states(state_hash,code_verifier,nonce,next_path,expires_at) VALUES (?,?,?,?,?)"
  ).bind(await digest(state), verifier, nonce, next, now + OAUTH_SECONDS).run();
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  const params = {
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: origin + "/auth/callback",
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
    prompt: "select_account"
  };
  for (const [k, v] of Object.entries(params)) authorization.searchParams.set(k, v);
  const out = safetyHeaders(Response.redirect(authorization.toString(), 302));
  return putCookie(out, COOKIE_OAUTH, state, OAUTH_SECONDS);
}
async function oauthCallback(request, env, origin, opts) {
  const url = new URL(request.url), now = nowSecs(opts);
  const state = url.searchParams.get("state");
  const fromCookie = cookieMap(request).get(COOKIE_OAUTH);
  if (typeof state !== "string" || !/^[a-f0-9]{64}$/.test(state) ||
      state !== fromCookie || url.searchParams.get("error")) {
    throw new LoginError(400, "Google 로그인 요청을 확인할 수 없습니다. 다시 신청해 주세요.");
  }
  const code = url.searchParams.get("code");
  if (typeof code !== "string" || code.length < 4 || code.length > 4096) {
    throw new LoginError(400, "Google 승인 코드가 없습니다.");
  }
  // Consume the state BEFORE exchanging the code: one use only, including
  // if Google returns a network error. D1 DELETE RETURNING is atomic.
  const stored = await env.DB.prepare(
    "DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? RETURNING code_verifier,nonce,next_path"
  ).bind(await digest(state), now).first();
  if (!stored) throw new LoginError(400, "로그인 요청이 만료되었거나 이미 사용됐습니다.");
  const params = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: origin + "/auth/callback",
    grant_type: "authorization_code",
    code_verifier: stored.code_verifier
  });
  // Keep a strict separation of request transport failure, rejected
  // response and JSON parsing. This must not log request details or secrets.
  let response;
  try {
    response = await (opts.googleFetch || fetch)(GOOGLE_TOKEN_URL, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(), redirect: "manual", signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS)
    });
  } catch (error) {
    console.warn("LABDAM_OAUTH_TOKEN_FETCH_FAILURE",
      error instanceof TypeError ? "type_error" : "other");
    throw new LoginError(503, "Google 로그인 연결에 실패했습니다. 다시 시도해 주세요.");
  }
  if (response.status >= 300 && response.status < 400) {
    // Preserve the original no-redirect security property without unsupported
    // automatic redirect handling: never send a Google authorization code to Location.
    console.warn("LABDAM_OAUTH_TOKEN_REJECTED", response.status, "redirect_blocked");
    throw new LoginError(503, "Google 로그인 연결에 실패했습니다. 다시 시도해 주세요.");
  }
  if (!response.ok) {
    // Only log Google error categories from a fixed allowlist. Do NOT emit
    // the provider response, description, OAuth code/state, token or secrets.
    let category = "provider_error";
    try {
      const failure = await response.json();
      const code = failure && !Array.isArray(failure) && failure.error;
      if (typeof code === "string" && [
        "invalid_client", "invalid_grant", "invalid_request",
        "unauthorized_client", "access_denied", "unsupported_grant_type"
      ].includes(code)) category = code;
    } catch (_) { /* Malformed provider response remains provider_error. */ }
    console.warn("LABDAM_OAUTH_TOKEN_REJECTED", response.status, category);
    throw new LoginError(503, "Google 로그인 연결에 실패했습니다. 다시 시도해 주세요.");
  }
  let googleToken;
  try {
    googleToken = await response.json();
  } catch (_) {
    console.warn("LABDAM_OAUTH_TOKEN_JSON_FAILURE", response.status);
    throw new LoginError(503, "Google 로그인 연결에 실패했습니다. 다시 시도해 주세요.");
  }
  const identity = await googleIdentity(googleToken?.id_token, stored.nonce, env, opts);
  const bootstrap = typeof env.BOOTSTRAP_ADMIN_EMAIL === "string" &&
    env.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase() === identity.email &&
    identity.emailAuthoritative;
  // Profile refresh and session issuance share one D1 transaction. A concurrent
  // review cannot split them; a failed session insert leaves no partial signup.
  const rawSession = tokenRandom(32), csrf = tokenRandom(32);
  const issued = await env.DB.batch([env.DB.prepare(
    "INSERT INTO members(google_sub,email,display_name,status,role,created_at,updated_at) " +
    "VALUES (?,?,?,?,?,?,?) ON CONFLICT(google_sub) DO UPDATE SET " +
    "email=excluded.email,display_name=excluded.display_name,updated_at=excluded.updated_at"
  ).bind(identity.sub, identity.email, identity.name,
    bootstrap ? "approved" : "pending", bootstrap ? "admin" : "member", now, now),
  env.DB.prepare(
    "INSERT INTO sessions(token_hash,google_sub,csrf_token,expires_at,created_at) VALUES (?,?,?,?,?)"
  ).bind(await digest(rawSession), identity.sub, csrf, now + SESSION_SECONDS, now),
  env.DB.prepare(
    "SELECT google_sub,email,display_name,status,role FROM members WHERE google_sub=?"
  ).bind(identity.sub)]);
  const member = issued[2].results?.[0];
  if (!member) throw new LoginError(503, "가입 신청 상태를 저장할 수 없습니다.");
  const destination = member.status === "approved" ? safeNext(stored.next_path) : "/pending.html";
  let out = redirect(destination, origin);
  out = putCookie(out, COOKIE_OAUTH, "", 0);
  return putCookie(out, COOKIE_SESSION, rawSession, SESSION_SECONDS);
}
async function currentSession(request, env, opts) {
  const token = cookieMap(request).get(COOKIE_SESSION);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const member = await env.DB.prepare(
    "SELECT s.csrf_token,s.expires_at,m.google_sub,m.email,m.display_name,m.status,m.role,m.purpose " +
    "FROM sessions s JOIN members m ON s.google_sub=m.google_sub " +
    "WHERE s.token_hash=? AND s.expires_at>?"
  ).bind(await digest(token), nowSecs(opts)).first();
  return member || null;
}
function validCsrf(request, member, origin) {
  const source = request.headers.get("Origin");
  const supplied = request.headers.get("X-CSRF-Token");
  if (source !== origin || typeof supplied !== "string" || supplied.length !== 64 ||
      typeof member?.csrf_token !== "string" || member.csrf_token.length !== 64) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < 64; i++) mismatch |= supplied.charCodeAt(i) ^ member.csrf_token.charCodeAt(i);
  return mismatch === 0;
}
function isHtmlRoute(path) {
  return path === "/" || path === "/index.html" || path === "/account.html" ||
    path === "/admin.html" || path === "/admin" || path === "/labinsight" ||
    path.endsWith(".html") || path.endsWith("/");
}
function privatePath(path) {
  if (path === "/" || path === "/index.html" || path === "/account.html" ||
      path === "/privacy.html" || path === "/terms.html" || path === "/favicon.svg" ||
      path === "/assets/portal-redesign.css" || path === "/admin.html" ||
      path === "/admin" || path === "/labinsight" || path === "/api/me" ||
      path === "/api/admin/applications" || path === "/api/admin/review" ||
      path === "/api/application" || path === "/api/account/delete" || path === "/auth/logout") return true;
  return path.startsWith("/labinsight/");
}
async function jsonBody(request) {
  if (!(request.headers.get("Content-Type") || "").startsWith("application/json")) {
    throw new LoginError(415, "JSON 요청만 허용됩니다.");
  }
  if (Number(request.headers.get("Content-Length") || 0) > 4096) {
    throw new LoginError(413, "요청이 너무 큽니다.");
  }
  // Content-Length is optional/untrusted. Bound bytes while reading so a
  // streamed oversized body cannot exhaust a free Worker's memory.
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) {
          await reader.cancel();
          throw new LoginError(413, "요청이 너무 큽니다.");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const body = new TextDecoder().decode(bytes);
  try {
    const data = JSON.parse(body);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("invalid_object");
    return data;
  }
  catch (_) { throw new LoginError(400, "잘못된 요청입니다."); }
}
async function applicationUpdate(request, env, member, now) {
  const data = await jsonBody(request);
  if (member.status !== "pending") return json(403, { ok: false, code: "NOT_PENDING" });
  if (typeof data.purpose !== "string" || data.purpose.length > MAX_REASON ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(data.purpose)) {
    return json(400, { ok: false, code: "BAD_PURPOSE" });
  }
  await env.DB.prepare(
    "UPDATE members SET purpose=?,updated_at=? WHERE google_sub=? AND status='pending'"
  ).bind(data.purpose.trim(), now, member.google_sub).run();
  return json(200, { ok: true, status: "pending" });
}
async function adminList(env) {
  const data = await env.DB.prepare(
    "SELECT google_sub,email,display_name,status,role,purpose,created_at,updated_at,reviewed_at " +
    "FROM members WHERE role='member' ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_at DESC LIMIT 500"
  ).all();
  return json(200, { ok: true, members: data.results || [] });
}
async function adminReview(request, env, admin, now) {
  const data = await jsonBody(request);
  if (typeof data.google_sub !== "string" || !/^[0-9]{6,36}$/.test(data.google_sub) ||
      !["approved", "rejected", "pending"].includes(data.status)) {
    return json(400, { ok: false, code: "INVALID_REVIEW" });
  }
  // Purge server sessions BEFORE a downgrade or re-approval from rejected.
  // Initial pending -> approved keeps its session (no second Google sign-in).
  // D1 batch is transactional: concurrent reviews/logins cannot interleave
  // between deletion and the status change, and either failure rolls back both.
  const changes = await env.DB.batch([env.DB.prepare(
    "DELETE FROM sessions WHERE google_sub=? AND EXISTS (" +
    "SELECT 1 FROM members WHERE google_sub=? AND role='member' " +
    "AND (status='rejected' OR ?!='approved'))"
  ).bind(data.google_sub, data.google_sub, data.status),
  // Admins are deliberately immutable through the member approval endpoint.
  env.DB.prepare(
    "UPDATE members SET status=?,updated_at=?,reviewed_at=?,reviewed_by=? " +
    "WHERE google_sub=? AND role='member' RETURNING google_sub"
  ).bind(data.status, now, now, admin.google_sub, data.google_sub)]);
  if (!changes[1].results?.length) return json(404, { ok: false, code: "NOT_MEMBER" });
  // Revoked sessions cannot be revived by a later approval. Previously opened
  // pages and downloaded reports cannot be remotely removed.
  return json(200, { ok: true, google_sub: data.google_sub, status: data.status });
}

async function deleteMemberAccount(env, member) {
  // An admin cannot accidentally erase the sole bootstrap administrator.
  // A D1 foreign-key cascade removes all outstanding sessions for this member.
  if (member.role !== "member") return json(403, { ok: false, code: "ADMIN_PROTECTED" });
  const removed = await env.DB.prepare(
    "DELETE FROM members WHERE google_sub=? AND role='member' RETURNING google_sub"
  ).bind(member.google_sub).first();
  if (!removed) return json(404, { ok: false, code: "ACCOUNT_NOT_FOUND" });
  return putCookie(json(200, { ok: true, code: "ACCOUNT_DELETED" }),
    COOKIE_SESSION, "", 0);
}
async function purgeExpiredRecords(env, now) {
  // Daily, bounded-scope free-D1 maintenance. Membership application/approval
  // decisions are NEVER swept as part of ephemeral session-state cleanup.
  await env.DB.prepare("DELETE FROM oauth_states WHERE expires_at<=?").bind(now).run();
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(now).run();
  await env.DB.prepare("DELETE FROM login_throttle WHERE window_start<?").bind(now - 86400).run();
}

function privateAssets(env) {
  if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") {
    throw new LoginError(503, "보호된 홈페이지가 아직 배포되지 않았습니다.");
  }
}
async function assetFor(request, env, targetPath) {
  privateAssets(env);
  const u = new URL(request.url);
  u.pathname = targetPath;
  u.search = "";
  return safetyHeaders(await env.ASSETS.fetch(new Request(u.toString(), { method: request.method })));
}
async function handleRequest(request, env, opts = {}) {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  const origin = validOrigin(env);
  if (!origin || url.origin !== origin) return simple(503, "허용된 로그인 서비스 주소가 설정되지 않았습니다.");
  try {
    if (path === "/healthz" && method === "GET") {
      return json(200, { service: "labdam-free-auth", deployment: "configured-externally" });
    }
    if (path === "/login" && method === "GET") return redirect("/login.html", origin);
    if (path === "/login.html" && ["GET", "HEAD"].includes(method)) {
      return await assetFor(request, env, "/login.html");
    }
    if (path === "/membership-privacy.html" && ["GET", "HEAD"].includes(method)) {
      return await assetFor(request, env, "/membership-privacy.html");
    }
    if (path === "/pending.html" && ["GET", "HEAD"].includes(method)) {
      return await assetFor(request, env, "/pending.html");
    }
    if (path === "/auth/start" && method === "GET") {
      configured(env);
      return await oauthStart(request, env, origin, opts);
    }
    if (path === "/auth/callback" && method === "GET") {
      configured(env);
      return await oauthCallback(request, env, origin, opts);
    }
    if (!privatePath(path)) return simple(404, "요청한 페이지가 없습니다.");
    if (!["GET", "HEAD", "POST"].includes(method)) return simple(405, "허용되지 않는 요청입니다.");
    configured(env);
    const member = await currentSession(request, env, opts);
    if (!member) {
      if (method === "GET" && isHtmlRoute(path) && !path.startsWith("/api/")) {
        return redirect("/login.html?next=" + encodeURIComponent(safeNext(path + url.search)), origin);
      }
      return json(401, { ok: false, code: "LOGIN_REQUIRED" });
    }
    if (path === "/api/me" && method === "GET") {
      return json(200, {
        authenticated: true, email: member.email, name: member.display_name,
        status: member.status, role: member.role,
        purpose: member.status === "pending" ? member.purpose : undefined,
        csrf: member.csrf_token
      });
    }
    if (path === "/auth/logout" && method === "POST") {
      if (!validCsrf(request, member, origin)) return json(403, { ok: false, code: "CSRF" });
      const token = cookieMap(request).get(COOKIE_SESSION);
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await digest(token)).run();
      return putCookie(redirect("/login.html", origin), COOKIE_SESSION, "", 0);
    }
    if (path === "/api/application" && method === "POST") {
      if (!validCsrf(request, member, origin)) return json(403, { ok: false, code: "CSRF" });
      return await applicationUpdate(request, env, member, nowSecs(opts));
    }
    if (path === "/api/account/delete" && method === "POST") {
      if (!validCsrf(request, member, origin)) return json(403, { ok: false, code: "CSRF" });
      return await deleteMemberAccount(env, member);
    }
    if (member.status !== "approved") {
      if (method === "GET" && isHtmlRoute(path)) return redirect("/pending.html", origin);
      return json(403, { ok: false, code: "AWAITING_ADMIN_APPROVAL" });
    }
    if (path === "/api/admin/applications" || path === "/api/admin/review" ||
        path === "/admin" || path === "/admin.html") {
      if (member.role !== "admin") return json(403, { ok: false, code: "ADMIN_ONLY" });
      if (path === "/api/admin/applications" && method === "GET") return await adminList(env);
      if (path === "/api/admin/review" && method === "POST") {
        if (!validCsrf(request, member, origin)) return json(403, { ok: false, code: "CSRF" });
        return await adminReview(request, env, member, nowSecs(opts));
      }
      if (path === "/admin" && method === "GET") return redirect("/admin.html", origin);
      if (path === "/admin.html" && ["GET", "HEAD"].includes(method)) return await assetFor(request, env, path);
      return json(405, { ok: false, code: "METHOD_NOT_ALLOWED" });
    }
    if (method !== "GET" && method !== "HEAD") return simple(405, "허용되지 않는 요청입니다.");
    if (path === "/labinsight") return redirect("/labinsight/", origin);
    return await assetFor(request, env, path);
  } catch (error) {
    // Fail closed and never leak tokens, DB schema or email to the browser.
    const response = error instanceof LoginError
      ? simple(error.status, error.message)
      : simple(503, "서비스를 잠시 이용할 수 없습니다.");
    return path === "/auth/callback"
      ? putCookie(response, COOKIE_OAUTH, "", 0) : response;
  }
}
export default {
  fetch: handleRequest,
  scheduled: async (_controller, env) => { if (env?.DB) await purgeExpiredRecords(env, Math.floor(Date.now() / 1000)); }
};
export { handleRequest, googleIdentity, safeNext, purgeExpiredRecords };
