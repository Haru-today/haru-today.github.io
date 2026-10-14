/*
 * LABDAM protected-service gateway (deployment-ready component, NOT live).
 * A Cloudflare Access application authenticates visitors; this Worker validates
 * its signed token before returning even a single static service asset.
 * Original public GitHub Pages service URLs must be retired after cutover.
 */
const PREFIXES = Object.freeze(["/labinsight/", "/caffeine-atlas/"]);
const KEY_CACHE_MS = 5 * 60 * 1000;
const keyCache = new Map();

class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function securityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Vary", "Cookie");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function statusResponse(status, message) {
  return securityHeaders(new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  }));
}

function trustedTeamDomain(value) {
  if (typeof value !== "string") return null;
  const v = value.replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(v)) return null;
  return v.toLowerCase();
}

function decodeSegment(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new AuthError(401, "유효하지 않은 인증 정보입니다.");
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
  } catch (_) {
    throw new AuthError(401, "유효하지 않은 인증 정보입니다.");
  }
}

function parseTokenPart(value) {
  try {
    const result = JSON.parse(new TextDecoder().decode(decodeSegment(value)));
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new TypeError("JWT part must be an object");
    }
    return result;
  } catch (_) {
    throw new AuthError(401, "유효하지 않은 인증 정보입니다.");
  }
}

async function fetchSigningKey(teamDomain, kid, fetcher = fetch) {
  const cacheKey = teamDomain + "|" + kid;
  const now = Date.now();
  if (fetcher === fetch) {
    const existing = keyCache.get(cacheKey);
    if (existing && existing.expiresAt > now) return existing.jwk;
  }
  let response;
  try {
    response = await fetcher(teamDomain + "/cdn-cgi/access/certs", {
      method: "GET",
      redirect: "error"
    });
  } catch (_) {
    throw new AuthError(503, "인증 서버를 일시적으로 확인할 수 없습니다.");
  }
  if (!response.ok) {
    throw new AuthError(503, "인증 서버를 일시적으로 확인할 수 없습니다.");
  }
  let body;
  try { body = await response.json(); }
  catch (_) { throw new AuthError(503, "인증 키 정보가 유효하지 않습니다."); }

  if (!Array.isArray(body.keys)) {
    throw new AuthError(503, "인증 키 정보가 유효하지 않습니다.");
  }
  const jwk = body.keys.find(key =>
    key.kid === kid && key.kty === "RSA" &&
    (key.alg == null || key.alg === "RS256") &&
    (key.use == null || key.use === "sig") &&
    typeof key.n === "string" && typeof key.e === "string"
  );
  if (!jwk) throw new AuthError(401, "유효하지 않은 인증 정보입니다.");
  if (fetcher === fetch) {
    if (keyCache.size > 12) keyCache.clear();
    keyCache.set(cacheKey, { jwk, expiresAt: now + KEY_CACHE_MS });
  }
  return jwk;
}

/** Reject unsigned, expired, wrong-audience and service-account JWTs. */
async function verifyAccessJwt(request, env, options = {}) {
  const teamDomain = trustedTeamDomain(env?.TEAM_DOMAIN);
  const audience = env?.ACCESS_AUD;
  if (!teamDomain || typeof audience !== "string" || !/^[a-f0-9]{32,128}$/i.test(audience)) {
    throw new AuthError(503, "로그인 서비스가 아직 설정되지 않았습니다.");
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new AuthError(401, "서비스 이용을 위해 로그인이 필요합니다.");
  if (token.length > 8192) throw new AuthError(401, "유효하지 않은 인증 정보입니다.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError(401, "유효하지 않은 인증 정보입니다.");

  const header = parseTokenPart(parts[0]);
  const payload = parseTokenPart(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string" ||
      !/^[a-zA-Z0-9_-]{4,256}$/.test(header.kid)) {
    throw new AuthError(401, "유효하지 않은 인증 정보입니다.");
  }
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== teamDomain || !aud.includes(audience) ||
      !Number.isSafeInteger(payload.exp) || payload.exp <= now ||
      (payload.nbf != null && (!Number.isSafeInteger(payload.nbf) || payload.nbf > now)) ||
      !Number.isSafeInteger(payload.iat) || payload.iat > now + 60 ||
      payload.type !== "app" ||
      typeof payload.sub !== "string" || payload.sub.trim().length === 0) {
    throw new AuthError(401, "유효하지 않은 인증 정보입니다.");
  }

  const jwk = await fetchSigningKey(teamDomain, header.kid, options.fetcher);
  let key;
  try {
    key = await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false, ["verify"]
    );
  } catch (_) {
    throw new AuthError(503, "인증 키 정보를 사용할 수 없습니다.");
  }
  const signed = new TextEncoder().encode(parts[0] + "." + parts[1]);
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, decodeSegment(parts[2]), signed
  );
  if (!verified) throw new AuthError(401, "유효하지 않은 인증 정보입니다.");
  return Object.freeze({
    subject: payload.sub,
    email: typeof payload.email === "string" && payload.email.length <= 254
      ? payload.email.trim().toLowerCase() : ""
  });
}


const SAVE_API_PATH = "/api/caffeine-atlas";
const MAX_SHEET_REQUEST_BYTES = 2 * 1024 * 1024;

function jsonResponse(status, obj) {
  return securityHeaders(new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json; charset=utf-8" }
  }));
}

function sheetsConfig(env) {
  const endpoint = env?.CAFFEINE_APPS_SCRIPT_URL;
  const secret = env?.CAFFEINE_ATLAS_WRITE_HMAC_KEY;
  if (typeof endpoint !== "string" ||
      !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/.test(endpoint) ||
      typeof secret !== "string" || secret.length < 32) return null;
  return { endpoint, secret };
}

async function sheetSignature(secret, payload, timestamp, nonce) {
  const data = String(timestamp) + "." + nonce + "." + JSON.stringify(payload);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return [...signed].map(byte => byte.toString(16).padStart(2, "0")).join("");
}


function permittedStorageReader(identity, env) {
  // Only an explicitly approved, Cloudflare-verified email can call the
  // Sheets API. A missing list denies ALL access (including receipt GETs).
  const raw = env?.STORAGE_WRITER_EMAILS;
  if (typeof raw !== "string" || !raw.trim()) return { valid: false, allowed: false };
  const entries = raw.split(",").map(email => email.trim().toLowerCase());
  if (!entries.length || entries.length > 50 || entries.some(email =>
    !/^[a-z0-9.!#$%&'*+/=?^_\`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email) || email.length > 254
  )) return { valid: false, allowed: false };
  return { valid: true, allowed: entries.includes(identity.email || "") };
}

async function callSheetBackend(request, env, options = {}, identity) {
  const writer = permittedStorageReader(identity || {}, env);
  if (!writer.valid) return jsonResponse(503, { ok: false, code: "STORAGE_POLICY_NOT_CONFIGURED" });
  if (!writer.allowed) return jsonResponse(403, { ok: false, code: "STORAGE_NOT_AUTHORIZED" });
  const config = sheetsConfig(env);
  if (!config) return jsonResponse(503, { ok: false, code: "STORAGE_NOT_CONFIGURED" });
  const url = new URL(request.url);
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID().replace(/-/g, "").toLowerCase();
  const backendFetch = options.apiFetch || fetch;
  let body;
  let backendUrl = config.endpoint;
  let method = request.method;

  if (method === "GET") {
    const action = url.searchParams.get("action") || "capabilities";
    const requestId = url.searchParams.get("requestId") || "";
    if (!["capabilities", "saveStatus"].includes(action) ||
        (action === "saveStatus" && !/^[a-f0-9]{32}$/.test(requestId))) {
      return jsonResponse(400, { ok: false, code: "INVALID_ACTION" });
    }
    const payload = "GET:" + action + ":" + requestId;
    const signature = await sheetSignature(config.secret, payload, timestamp, nonce);
    const qs = new URLSearchParams({ action, timestamp: String(timestamp), nonce, signature });
    if (action === "saveStatus") qs.set("requestId", requestId);
    backendUrl = config.endpoint + "?" + qs.toString();
  } else if (method === "POST") {
    const origin = request.headers.get("Origin");
    if (origin !== url.origin) return jsonResponse(403, { ok: false, code: "ORIGIN_REQUIRED" });
    if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
      return jsonResponse(415, { ok: false, code: "JSON_REQUIRED" });
    }
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_SHEET_REQUEST_BYTES) {
      return jsonResponse(413, { ok: false, code: "PAYLOAD_TOO_LARGE" });
    }
    let payload;
    try { payload = JSON.parse(raw); } catch (_) { return jsonResponse(400, { ok: false, code: "INVALID_JSON" }); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        (payload.action && payload.action !== "batchSave") ||
        !/^[a-f0-9]{32}$/.test(payload.requestId) ||
        (payload.action === "batchSave" && (!Array.isArray(payload.rows) ||
          payload.rows.length < 1 || payload.rows.length > 200)) ||
        (payload.action !== "batchSave" && payload.consent !== true)) {
      return jsonResponse(400, { ok: false, code: "INVALID_PAYLOAD" });
    }
    const signature = await sheetSignature(config.secret, payload, timestamp, nonce);
    body = JSON.stringify({ payload, auth: { timestamp, nonce, signature } });
  } else return jsonResponse(405, { ok: false, code: "METHOD_NOT_ALLOWED" });

  try {
    const response = await backendFetch(backendUrl, {
      method,
      redirect: "follow",
      headers: method === "POST" ? { "Content-Type": "text/plain; charset=utf-8" } : undefined,
      body
    });
    if (!response.ok) return jsonResponse(502, { ok: false, code: "STORAGE_UNAVAILABLE" });
    const text = await response.text();
    if (text.length > 16384) return jsonResponse(502, { ok: false, code: "INVALID_STORAGE_RESPONSE" });
    let result;
    try { result = JSON.parse(text); }
    catch (_) { return jsonResponse(502, { ok: false, code: "INVALID_STORAGE_RESPONSE" }); }
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      return jsonResponse(502, { ok: false, code: "INVALID_STORAGE_RESPONSE" });
    }
    // Whitelist response fields. Never mirror Google Spreadsheet IDs or secrets.
    const safe = {};
    for (const k of ["ok", "code", "state", "savedCount", "action", "batchId", "version", "capabilities"]) {
      if (Object.prototype.hasOwnProperty.call(result, k)) safe[k] = result[k];
    }
    return jsonResponse(200, safe);
  } catch (_) {
    return jsonResponse(502, { ok: false, code: "STORAGE_UNAVAILABLE" });
  }
}

async function handleRequest(request, env, options = {}) {
  const url = new URL(request.url);
  const isSaveApi = url.pathname === SAVE_API_PATH;
  const isSessionApi = url.pathname === "/api/session";
  if (!["GET", "HEAD"].includes(request.method) && !(isSaveApi && request.method === "POST")) {
    return statusResponse(405, "허용되지 않는 요청입니다.");
  }
  if (url.pathname === "/") {
    return securityHeaders(Response.redirect("https://haru-today.github.io/", 302));
  }
  if (url.pathname === "/logout") {
    const team = trustedTeamDomain(env?.TEAM_DOMAIN);
    if (!team) return statusResponse(503, "로그인 서비스가 아직 설정되지 않았습니다.");
    return securityHeaders(Response.redirect(team + "/cdn-cgi/access/logout", 302));
  }
  if (!isSaveApi && !isSessionApi && !PREFIXES.some(p => url.pathname.startsWith(p)) &&
      !["/labinsight", "/caffeine-atlas"].includes(url.pathname)) {
    return statusResponse(404, "요청한 페이지가 없습니다.");
  }

  let identity;
  try {
    identity = await verifyAccessJwt(request, env, options);
  } catch (err) {
    return statusResponse(err instanceof AuthError ? err.status : 503,
      err instanceof AuthError ? err.message : "인증 확인 중 오류가 발생했습니다.");
  }

  if (isSessionApi) {
    if (request.method !== "GET") return jsonResponse(405, { ok: false, code: "METHOD_NOT_ALLOWED" });
    // An authenticated visitor can read only their own identity and
    // whether the operator has explicitly approved cloud storage.
    const writer = permittedStorageReader(identity, env);
    return jsonResponse(200, {
      authenticated: true,
      email: identity.email,
      storageAllowed: writer.valid && writer.allowed
    });
  }
  if (isSaveApi) {
    if (request.method === "HEAD") return statusResponse(405, "허용되지 않는 요청입니다.");
    return callSheetBackend(request, env, options, identity);
  }

  if (url.pathname === "/labinsight" || url.pathname === "/caffeine-atlas") {
    return securityHeaders(Response.redirect(new URL(url.pathname + "/", url.origin).href, 302));
  }
  if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") {
    return statusResponse(503, "보호된 서비스가 아직 배포되지 않았습니다.");
  }
  // Every file — JS, HTML, CSS, image — is requested through this Worker.
  try {
    return securityHeaders(await env.ASSETS.fetch(request));
  } catch (_) {
    return statusResponse(503, "서비스를 불러올 수 없습니다.");
  }
}

export default { fetch: handleRequest };
export { handleRequest, verifyAccessJwt };
