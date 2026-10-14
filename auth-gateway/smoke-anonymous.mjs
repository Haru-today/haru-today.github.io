#!/usr/bin/env node
/**
 * Read-only, unauthenticated deployment smoke test.
 * Never sends credentials, real health data, or genetic data.
 * Requires a verified target host, e.g. PROTECTED_BASE_URL=https://...workers.dev
 * Does not verify authorized navigation; that still requires manual browser QA.\n * Caffeine Atlas is intentionally NOT a protected-host probe.
 */
const target = process.env.PROTECTED_BASE_URL || "";
let origin;
try {
  const url = new URL(target);
  if (url.protocol !== "https:" || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/" ||
      !/^([a-z0-9-]+\.)+(workers\.dev|example\.com|labdam\.com)$/i.test(url.hostname) ||
      url.hostname === "haru-today.github.io") {
    throw new Error("Only a verified HTTPS protected host at its root is allowed");
  }
  origin = url.origin;
} catch (_) {
  console.error("PROTECTED_BASE_URL must be an explicit, validated HTTPS protected Worker host.");
  process.exit(2);
}

const probes = [
  "/",
  "/index.html",
  "/account.html",
  "/privacy.html",
  "/terms.html",
  "/favicon.svg",
  "/assets/portal-redesign.css",
  "/labinsight/",
  "/labinsight/checkup.html",
  "/labinsight/report.html",
  "/labinsight/app.js",
  "/labinsight/styles.css",
  "/labinsight/account.html",
  "/api/session"
];
const acceptable = new Set([301, 302, 303, 307, 308, 401, 403, 503]);

let failed = 0;
for (const path of probes) {
  try {
    const result = await fetch(origin + path, {
      method: "GET", redirect: "manual",
      headers: { "Cache-Control": "no-store" },
      signal: AbortSignal.timeout(8000)
    });
    if (!acceptable.has(result.status)) {
      failed++;
      console.error("FAIL " + path + ": anonymous response " + result.status + ", expected login redirect/denial.");
    } else {
      console.log("PASS " + path + ": anonymous " + result.status);
    }
    await result.body?.cancel().catch(() => {});
  } catch (error) {
    failed++;
    console.error("FAIL " + path + ": request could not be verified (" + error.name + ")");
  }
}
console.log("Anonymous-only smoke test: " + (probes.length-failed) + " passed, " + failed + " failed.");
if (failed) process.exitCode = 1;
