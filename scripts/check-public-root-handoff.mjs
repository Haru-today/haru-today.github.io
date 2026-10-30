/**
 * Live read-only anonymous probe for the public LABDAM search entry.
 * Never authenticates, accesses account data, posts, or logs HTML/cookies.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const ROOT = "https://labdam.kr";
const LEGACY = "https://haru-today.github.io";
const WORKER = "https://labdam-free-approval.jleegenomics.workers.dev";
export const CHECKS = [
  { path: "/", origin: ROOT, status: 200, kind: "root-home" },
  { path: "/", origin: LEGACY, status: 301, kind: "legacy-redirect" },
  { path: "/caffeine-atlas/", origin: LEGACY, status: 301, kind: "legacy-redirect" },
  { path: "/caffeine-atlas/?audit=qr", origin: LEGACY, status: 301, kind: "legacy-redirect" },
  { path: "/labinsight/app.js", origin: LEGACY, status: 301, kind: "legacy-redirect" },
  { path: "/labinsight/", origin: ROOT, status: 200, kind: "labinsight-handoff" },
  { path: "/labinsight/app.js", origin: ROOT, status: 404, kind: "gone" },
  { path: "/caffeine-atlas/", origin: ROOT, status: 200, kind: "caffeine" },
  { path: "/caffeine-atlas/caffeine-sensitivity-app/analyzer.html", origin: ROOT, status: 200, kind: "caffeine" },
  { path: "/", origin: WORKER, status: 303, kind: "worker-login" },
  { path: "/labinsight/", origin: WORKER, status: 303, kind: "worker-login" },
  { path: "/labinsight/app.js", origin: WORKER, status: 401, kind: "worker-deny" },
  { path: "/login.html", origin: WORKER, status: 200, kind: "public-login" }
];
// Accept only the known visible headings and non-executable WebSite metadata.
// Keep the old heading during a Pages deployment transition.
function validHomepageContent(html) {
  const headings = [...html.matchAll(/<h1(?:\s+id="hero-title")?\s*>([\s\S]*?)<\/h1\s*>/gi)];
  if (headings.length !== 1 || (html.match(/<h1\b/gi) || []).length !== 1) return false;
  const heading = headings[0][1];
  if (!/^(?:[^<>]*|[^<>]*<em>[^<>]*<\/em>[^<>]*)$/i.test(heading)) return false;
  const text = heading.replace(/<\/?em>/gi, '').replace(/\s+/g, ' ').trim();
  if (!['검진 결과, 내 결과지 기준으로 보세요', '더 나은 질문을 위한 작은 시작.'].includes(text)) return false;
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b([^>]*)>/gi)];
  if ((html.match(/<script\b/gi) || []).length !== scripts.length || scripts.length > 1) return false;
  if (scripts.length === 1) {
    if (!/^\s+type="application\/ld\+json"\s*$/i.test(scripts[0][1]) || scripts[0][3].trim()) return false;
    try {
      const data = JSON.parse(scripts[0][2]);
      const expected = {'@context': 'https://schema.org', '@type': 'WebSite', name: '랩담', alternateName: 'LABDAM', url: ROOT + '/'};
      if (!data || Array.isArray(data) || JSON.stringify(Object.keys(data).sort()) !== JSON.stringify(Object.keys(expected).sort()) ||
          Object.keys(expected).some(key => data[key] !== expected[key]) ||
          (scripts[0][2].match(/"(?:@context|@type|name|alternateName|url)"\s*:/g) || []).length !== 5) return false;
    } catch (_) { return false; }
  }
  return !/<(?:form|input)\b/i.test(html);
}

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
        ok = validHomepageContent(html) &&
          html.includes('name="robots" content="index,follow"') &&
          html.includes('rel="canonical" href="https://labdam.kr/"') &&
          !/noindex/i.test(response.headers.get("X-Robots-Tag") || "") &&
          html.includes('href="' + WORKER + '/labinsight/"') &&
          !html.includes('/labinsight/app.js');
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
      } else if (ok && x.kind === "legacy-redirect") {
        let location = null;
        try { location = new URL(response.headers.get("Location"), LEGACY); } catch (_) {}
        const expected = new URL(x.path, ROOT);
        ok = location?.origin === ROOT && location?.pathname === expected.pathname && location?.search === expected.search;
        if (!ok) detail = "legacy-redirect-mismatch";
      } else if (ok && x.kind === "worker-login") {
        let location = null;
        try { location = new URL(response.headers.get("Location"), WORKER); } catch (_) {}
        ok = location?.origin === WORKER && location?.pathname === "/login.html" && location?.searchParams.get("next") === "/labinsight/" &&
          /no-store/i.test(response.headers.get("Cache-Control") || "");
        if (!ok) detail = "worker-login-redirect-mismatch";
      } else if (ok && x.kind === "worker-deny") {
        ok = /no-store/i.test(response.headers.get("Cache-Control") || "") &&
          /noindex/i.test(response.headers.get("X-Robots-Tag") || "");
        if (!ok) detail = "worker-cache-policy-mismatch";
      } else if (ok && x.kind === "public-login") {
        ok = /noindex/i.test(response.headers.get("X-Robots-Tag") || "");
        if (!ok) detail = "worker-login-indexable";
      }
      if (!["root-home", "labinsight-handoff", "public-brand"].includes(x.kind)) {
        try { await response.body?.cancel(); } catch (_) { /* no body */ }
      }
      if (ok) detail = "ok";
    } catch (_) { detail = "network-error"; }
    results.push({ origin: x.origin === ROOT ? "pages" : x.origin === LEGACY ? "legacy" : "worker", path: x.path, expected: x.status, status, ok, detail });
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
