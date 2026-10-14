/*
 * Assemble a private, access-protected LABDAM portal and LabInsight web shell.
 * This builds artifacts ONLY; it never deploys a site or accesses health data.
 * The public Caffeine Atlas QR demo is intentionally excluded.
 */
import { copyFile, mkdir, readFile, writeFile, stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "dist");
const portal = resolve(process.env.LABDAM_SOURCE || join(here, ".."));
const lab = resolve(process.env.LABINSIGHT_SOURCE || join(here, "../../labinsight"));
const labOut = join(dist, "labinsight");
const portalFiles = ["index.html", "privacy.html", "terms.html"];
const labFiles = [
  "index.html", "checkup.html", "report.html", "hospitals.html",
  "styles.css", "app.js", "ocr-review.js", "reference-ranges.js",
  "hospital-data.js", "runtime-config.js", "manifest.webmanifest"
];

function assertInside(root, file) {
  const rel = relative(root, file);
  if (rel === "" || rel.startsWith("..") || rel.startsWith("/")) {
    throw new Error("Invalid source path");
  }
}

async function publicTextCopy(src, dst, transform = null) {
  const txt = await readFile(src, "utf8");
  await writeFile(dst, transform ? transform(txt) : txt);
}

function preventIndexing(text) {
  const html = text.replace(
    /<meta\s+name=["']robots["']\s+content=["'][^"']+["']\s*\/?>/i, ""
  );
  const marker = '<meta name="robots" content="noindex,nofollow">';
  if (!html.includes("<head>")) throw new Error("Expected valid HTML head.");
  return html.replace("<head>", "<head>\n  " + marker);
}

function protectedLinkRewrite(text) {
  // LABDAM and LabInsight become same-origin protected pages. The independent
  // public Caffeine Atlas URL is NEVER rewritten behind Access.
  return text
    .replaceAll("https://haru-today.github.io/labinsight/", "/labinsight/")
    .replace(/https:\/\/haru-today\.github\.io\/(?!caffeine-atlas\/)/g, "/")
    .replace(/(href|src)=(["'])\/caffeine-atlas\//g,
      '$1=$2https://haru-today.github.io/caffeine-atlas/');
}

function protectedPortalHtml(text) {
  let html = preventIndexing(protectedLinkRewrite(text));
  // The visitor can inspect their verified session from both protected sites.
  const marker = '<a class="nav-cta" href="#contact">';
  if (!html.includes(marker)) throw new Error("Portal navigation anchor not found");
  html = html.replace(marker, '<a href="/account.html">내 계정</a>\n        ' + marker);
  return html;
}

function protectedLabInsightHtml(text) {
  const output = protectedLinkRewrite(text);
  const target = '<a class="nav-cta"';
  if (!output.includes(target)) throw new Error("LabInsight account navigation anchor missing");
  return preventIndexing(output.replace(target, '<a href="./account.html">내 계정</a>' + target));
}

async function copyCuratedAssets(from, to, allowed) {
  if (!existsSync(from)) throw new Error("Required public assets directory absent: " + from);
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (!entry.isFile() || !allowed.has(entry.name)) continue;
    const src = join(from, entry.name);
    assertInside(from, src);
    await copyFile(src, join(to, entry.name));
  }
}

async function run() {
  if (existsSync(dist)) {
    throw new Error("Output directory already exists; refusing to overwrite: " + dist);
  }
  if (!existsSync(join(portal, "index.html")) || !existsSync(join(lab, "index.html"))) {
    throw new Error("Expected LABDAM and LabInsight checked-out sources.");
  }

  await mkdir(dist, { recursive: true });
  await mkdir(join(dist, "assets"), { recursive: true });
  await mkdir(labOut, { recursive: true });
  for (const file of portalFiles) {
    const src = join(portal, file);
    assertInside(portal, src);
    if (!existsSync(src)) throw new Error("Missing LABDAM source: " + file);
    await publicTextCopy(src, join(dist, file), file === "index.html"
      ? protectedPortalHtml : text => preventIndexing(protectedLinkRewrite(text)));
  }
  await copyFile(join(portal, "favicon.svg"), join(dist, "favicon.svg"));
  await copyFile(join(portal, "assets", "portal-redesign.css"),
    join(dist, "assets", "portal-redesign.css"));
  await copyFile(join(here, "account.html"), join(dist, "account.html"));

  for (const file of labFiles) {
    const source = join(lab, file);
    const dest = join(labOut, file);
    assertInside(lab, source);
    if (!existsSync(source)) throw new Error("Missing LabInsight source: " + file);
    await (file.endsWith(".html") ?
      publicTextCopy(source, dest, protectedLabInsightHtml) :
      file.endsWith(".js") ? publicTextCopy(source, dest, protectedLinkRewrite) :
      copyFile(source, dest));
  }
  await copyFile(join(here, "account.html"), join(labOut, "account.html"));
  await copyCuratedAssets(join(lab, "icons"), join(labOut, "icons"),
    new Set(["icon.svg", "icon-192.png", "icon-512.png"]));

  // Never cache a private PWA shell after logout in the protected origin.
  await writeFile(join(labOut, "service-worker.js"),
    'self.addEventListener("install",e=>e.waitUntil(self.skipWaiting()));\n' +
    'self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));\n');

  await writeFile(join(dist, "robots.txt"), "User-agent: *\nDisallow: /\n");
  const expected = [
    "index.html", "account.html", "privacy.html", "terms.html",
    "favicon.svg", "assets/portal-redesign.css", "robots.txt",
    "labinsight/index.html", "labinsight/checkup.html", "labinsight/report.html",
    "labinsight/account.html", "labinsight/reference-ranges.js"
  ];
  for (const file of expected) {
    if (!(await stat(join(dist, file))).isFile()) {
      throw new Error("Missing protected web asset: " + file);
    }
  }
  // Strong guard against accidental inclusion of the independent public app.
  if (existsSync(join(dist, "caffeine-atlas"))) {
    throw new Error("Caffeine Atlas MUST NOT ship in an authenticated bundle.");
  }
  console.log("Prepared private LABDAM + LabInsight assets only. NOT deployed.");
}

run().catch(err => { console.error(err.message); process.exitCode = 1; });
