/**
 * Live read-only anonymous probe for the public LABDAM search entry.
 * Never authenticates, accesses account data, posts, or logs HTML/cookies.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const ROOT = "https://haru-today.github.io";
const WORKER = "https://labdam-free-approval.jleegenomics.workers.dev";
export const CHECKS = [
  { path: "/", origin: ROOT, status: 200, kind: "root-home" },
  { path: "/labinsight/", origin: ROOT, status: 200, kind: "labinsight-handoff" },
  { path: "/labinsight/app.js", origin: ROOT, status: 404, kind: "gone" },
  { path: "/caffeine-atlas/", origin: ROOT, status: 200, kind: "caffeine" },
  { path: "/caffeine-atlas/caffeine-sensitivity-app/analyzer.html", origin: ROOT, status: 200, kind: "caffeine" },
  { path: "/", origin: WORKER, status: 200, kind: "public-brand" },
  { path: "/labinsight/", origin: WORKER, status: 303, kind: "worker-login" },
  { path: "/labinsight/app.js", origin: WORKER, status: 401, kind: "worker-deny" },
  { path: "/login.html", origin: WORKER, status: 200, kind: "public-login" }
];
export async function inspectPublicEntry(fetchImpl = fetch) {
  const results = [];
  for (const x of CHECKS) {
    let status = null, ok = false, detail = "status-mismatch";
    try {
      const response = await fetchImpl(x.origin + x.path, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(10000)
      });
      status = response.status;
      ok = status === x.status;
      if (ok && x.kind === "root-home") {
        const html = await response.text();
        ok = html.includes('검진 결과, 내 결과지 기준으로 보세요') &&
          html.includes('name="robots" content="noindex,nofollow"') &&
          html.includes('href="' + WORKER + '/"') &&
          !html.includes('/labinsight/app.js') &&
          !/<(?:script|form|input)\b/i.test(html);
        if (!ok) detail = "public-root-home-mismatch";
      } else if (ok && x.kind === "labinsight-handoff") {
        const html = await response.text();
        ok = html.includes('href="' + WORKER + '/labinsight/"') &&
          html.includes('noindex,nofollow') &&
          !/<(?:form|input|script)\b/i.test(html);
        if (!ok) detail = "old-labinsight-app-still-exposed";
      } else if (ok && x.kind === "public-brand") {
        const html = await response.text();
        ok = html.includes('id="portalAccountLink"') && html.includes('id="portalGoogleStart"') &&
          !/<(?:form|input)\b/i.test(html) && !html.includes('/labinsight/app.js');
        if (!ok) detail = "public-brand-login-missing";
      } else if (ok && x.kind === "worker-login") {
        let location = null;
        try { location = new URL(response.headers.get("Location"), WORKER); } catch (_) {}
        ok = location?.origin === WORKER && location?.pathname === "/" && location?.hash === "#login" &&
          /no-store/i.test(response.headers.get("Cache-Control") || "");
        if (!ok) detail = "worker-login-redirect-mismatch";
      } else if (ok && x.kind === "worker-deny") {
        ok = /no-store/i.test(response.headers.get("Cache-Control") || "");
        if (!ok) detail = "worker-cache-policy-mismatch";
      }
      if (!["root-home", "labinsight-handoff", "public-brand"].includes(x.kind)) {
        try { await response.body?.cancel(); } catch (_) { /* no body */ }
      }
      if (ok) detail = "ok";
    } catch (_) { detail = "network-error"; }
    results.push({ origin: x.origin === ROOT ? "pages" : "worker", path: x.path, expected: x.status, status, ok, detail });
  }
  return { ok: results.every(x => x.ok), results };
}
async function main() {
  // Retry GET only: GitHub Pages can briefly serve the former root after deployment.
  for (let attempt = 1; attempt <= 6; attempt++) {
    const audit = await inspectPublicEntry();
    console.log("Public search-entry check", attempt + "/6");
    for (const r of audit.results) {
      console.log(r.ok ? "PASS" : "FAIL", r.origin, r.path, "HTTP", r.status ?? "NETWORK",
        "expected", r.expected, r.ok ? "" : "[" + r.detail + "]");
    }
    if (audit.ok) {
      console.log("PASS: public LABDAM homepage is live with the approved-user login entry, REPODAM protected; legacy REPODAM app inaccessible, Caffeine Atlas public.");
      return;
    }
    if (attempt === 6) {
      console.error("Public Pages auth handoff is not verified; see safe HTTP status checks above.");
      process.exitCode = 1;
      return;
    }
    await new Promise(r => setTimeout(r, 10000));
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(() => { console.error("Read-only public entry audit failed."); process.exitCode = 1; });
}
