/*
 * LABDAM + LabInsight login gateway. PRE-DEPLOYMENT ONLY.
 * LABDAM home / and all LabInsight routes share one Cloudflare Access session.
 * Caffeine Atlas is an independent, NO-LOGIN public GitHub Pages service.
 * Do not disable or redirect the symposium QR: /caffeine-atlas/ stays public
 * at https://haru-today.github.io/caffeine-atlas/ outside this Worker.
 */
const PREFIXES = Object.freeze(["/labinsight/"]);
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
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
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


function jsonResponse(status, body) {
  return securityHeaders(new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json; charset=utf-8" }
  }));
}

const PROTECTED_ROOT_FILES = new Set([
  "/index.html", "/account.html", "/privacy.html", "/terms.html",
  "/robots.txt", "/favicon.svg", "/assets/portal-redesign.css"
]);

function recognizedProtectedRoute(pathname) {
  if (pathname === "/" || pathname === "/labinsight" ||
      pathname === "/api/session" || PROTECTED_ROOT_FILES.has(pathname)) return true;
  return PREFIXES.some(prefix => pathname.startsWith(prefix));
}

async function handleRequest(request, env, options = {}) {
  const url = new URL(request.url);
  const method = request.method;
  if (!["GET", "HEAD"].includes(method)) {
    return statusResponse(405, "허용되지 않는 요청입니다.");
  }
  // Cloudflare owns the login cookie and logout endpoint. Nothing in this
  // Worker mints a token, captures passwords, or trusts unsigned headers.
  if (url.pathname === "/logout") {
    const team = trustedTeamDomain(env?.TEAM_DOMAIN);
    if (!team) return statusResponse(503, "로그인 서비스가 아직 설정되지 않았습니다.");
    return securityHeaders(Response.redirect(team + "/cdn-cgi/access/logout", 302));
  }

  // Never serve, sign, proxy or authenticate Caffeine Atlas here. The public
  // GitHub Pages app runs independently and is NOT a protected Worker bundle.
  if (!recognizedProtectedRoute(url.pathname)) {
    return statusResponse(404, "요청한 페이지가 없습니다.");
  }

  let identity;
  try {
    identity = await verifyAccessJwt(request, env, options);
  } catch (err) {
    return statusResponse(err instanceof AuthError ? err.status : 503,
      err instanceof AuthError ? err.message : "인증 확인 중 오류가 발생했습니다.");
  }

  if (url.pathname === "/api/session") {
    if (method !== "GET") return jsonResponse(405, { ok: false, code: "METHOD_NOT_ALLOWED" });
    return jsonResponse(200, { authenticated: true, email: identity.email });
  }
  if (url.pathname === "/labinsight") {
    return securityHeaders(Response.redirect(new URL("/labinsight/", url.origin).href, 302));
  }
  if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") {
    return statusResponse(503, "로그인 서비스가 아직 배포되지 않았습니다.");
  }

  // The / path is a real protected LABDAM homepage, never a redirect to an
  // unprotected github.io origin. assets.run_worker_first=true is required.
  try {
    return securityHeaders(await env.ASSETS.fetch(request));
  } catch (_) {
    return statusResponse(503, "서비스를 불러올 수 없습니다.");
  }
}

export default { fetch: handleRequest };
export { handleRequest, verifyAccessJwt };
