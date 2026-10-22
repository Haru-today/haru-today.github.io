/**
 * Anonymous, read-only LABDAM trial release diagnostics.
 * No Cloudflare credentials, OAuth calls, member requests, writes or response
 * bodies in logs. Only HTTP status, response headers and a fixed health marker.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const TRIAL = "https://labdam-free-approval.jleegenomics.workers.dev";
const PAGES = "https://haru-today.github.io";
export const CASES = Object.freeze([
  { name: "Worker readiness", origin: TRIAL, path: "/healthz", status: 200, type: "ready" },
  { name: "Public login", origin: TRIAL, path: "/login.html", status: 200, type: "public" },
  { name: "Public pending page", origin: TRIAL, path: "/pending.html", status: 200, type: "public" },
  { name: "Public LABDAM brand", origin: TRIAL, path: "/", status: 200, type: "public" },
  { name: "Private REPODAM home", origin: TRIAL, path: "/labinsight/", status: 303, type: "redirect" },
  { name: "Private REPODAM report", origin: TRIAL, path: "/labinsight/report.html", status: 303, type: "redirect" },
  { name: "Private REPODAM script", origin: TRIAL, path: "/labinsight/app.js", status: 401, type: "deny" },
  { name: "Private account API", origin: TRIAL, path: "/api/me", status: 401, type: "deny" },
  { name: "Public Caffeine Atlas", origin: PAGES, path: "/caffeine-atlas/", status: 200, type: "public" },
  { name: "Public poster analyzer", origin: PAGES, path: "/caffeine-atlas/caffeine-sensitivity-app/analyzer.html", status: 200, type: "public" },
  { name: "Public Caffeine privacy", origin: PAGES, path: "/caffeine-atlas/privacy.html", status: 200, type: "public" },
  { name: "Public Caffeine terms", origin: PAGES, path: "/caffeine-atlas/terms.html", status: 200, type: "public" }
]);

function loginRedirect(location) {
  try {
    const url = new URL(location, TRIAL);
    return url.origin === TRIAL && url.pathname === "/" && url.hash === "#login";
  } catch (_) { return false; }
}

export async function auditTrialAnonymous(fetchImpl = fetch) {
  const results = [];
  for (const entry of CASES) {
    let actual = null, detail = "none", ok = false;
    try {
      const response = await fetchImpl(entry.origin + entry.path, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(8000)
      });
      actual = response.status;
      ok = actual === entry.status;
      if (entry.type === "ready") {
        // Inspect only the fixed, non-identifying readiness marker. Never log
        // response bodies, email, tokens, cookies or Cloudflare errors.
        let readiness = false;
        if (ok) {
          try {
            const body = await response.json();
            readiness = body?.service === "labdam-free-auth" && body?.readiness === "bindings-present";
          } catch (_) { /* invalid health JSON */ }
        }
        if (ok && !readiness) detail = "readiness-marker-missing";
        ok = ok && readiness && /no-store/i.test(response.headers.get("Cache-Control") || "");
        if (!ok && detail === "none") detail = "not-ready";
      } else if (entry.type === "redirect") {
        ok = ok && loginRedirect(response.headers.get("Location")) &&
          /no-store/i.test(response.headers.get("Cache-Control") || "");
        if (!ok) detail = "redirect-or-cache-policy";
      } else if (entry.type === "deny") {
        ok = ok && /no-store/i.test(response.headers.get("Cache-Control") || "");
        if (!ok) detail = "access-control-or-cache-policy";
      } else if (!ok) {
        detail = "public-resource-unavailable";
      }
      // Never read response bodies of application, member or public pages.
      if (entry.type !== "ready") {
        try { await response.body?.cancel(); } catch (_) { /* no body */ }
      }
    } catch (_) {
      detail = "network-error";
    }
    results.push({ name: entry.name, path: entry.path, expected: entry.status, actual, ok, detail });
  }
  return { ok: results.every(x => x.ok), results };
}

async function main() {
  const report = await auditTrialAnonymous();
  for (const item of report.results) {
    const status = item.actual == null ? "NETWORK" : String(item.actual);
    console.log((item.ok ? "PASS" : "FAIL") + " HTTP " + status +
      " expected " + item.expected + " " + item.name + " " + item.path +
      (item.ok ? "" : " [" + item.detail + "]"));
  }
  if (!report.ok) {
    console.error("Trial audit failed: see HTTP statuses above. This does NOT roll back an already deployed Worker.");
    console.error("If /healthz is 503, verify the Worker has all required OAuth secrets and D1/ASSETS bindings in Cloudflare.");
    process.exitCode = 1;
  } else {
    console.log("Anonymous Worker gate and Caffeine Atlas public QR audit passed. Real Google OAuth remains unverified.");
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(() => { console.error("Trial audit could not complete."); process.exitCode = 1; });
}
