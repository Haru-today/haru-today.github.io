/*
 * Fail-closed static asset packager for Workers Free.
 * LABDAM and LabInsight only; Caffeine Atlas is a separate public site.
 * No API/health data, Google credentials, patient information or OAuth keys.
 */
import { copyFile, mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, "dist");
const portal = resolve(process.env.LABDAM_SOURCE || join(here, ".."));
const lab = resolve(process.env.LABINSIGHT_SOURCE || join(here, "../../labinsight"));
const labOutput = join(output, "labinsight");

const labFiles = [
  "index.html", "checkup.html", "report.html", "hospitals.html",
  "styles.css", "app.js", "ocr-review.js", "reference-ranges.js",
  "hospital-data.js", "runtime-config.js", "manifest.webmanifest"
];
const authPages = ["login.html", "pending.html", "account.html", "admin.html", "membership-privacy.html"];

function guarded(root, rel) {
  const full = resolve(root, rel);
  const r = relative(root, full);
  if (r.startsWith("..") || r.startsWith("/") || r === "") {
    throw new Error("Unsafe source path: " + rel);
  }
  return full;
}
function noIndex(html) {
  let s = html.replace(/<meta\s+name=["']robots["']\s+content=["'][^"']*["']\s*\/?>/i, "");
  if (!s.includes("<head>")) throw new Error("Invalid HTML head");
  return s.replace("<head>", '<head>\n<meta name="robots" content="noindex,nofollow">');
}
function rewritePaths(text) {
  return text
    .replaceAll("https://haru-today.github.io/labinsight/", "/labinsight/")
    .replace(/https:\/\/haru-today\.github\.io\/(?!caffeine-atlas\/)/g, "/")
    .replace(/(href|src)=(["'])\/caffeine-atlas\//g,
      '$1=$2https://haru-today.github.io/caffeine-atlas/');
}
function portalHtml(src) {
  const text = noIndex(rewritePaths(src));
  const anchor = '<a class="nav-cta" href="#contact">';
  if (!text.includes(anchor)) throw new Error("Cannot safely add LABDAM account navigation");
  return text.replace(anchor, '<a href="/account.html">내 계정</a>\n        ' + anchor);
}
function labHtml(src) {
  const text = noIndex(rewritePaths(src));
  const anchor = '<a class="nav-cta"';
  if (!text.includes(anchor)) throw new Error("Cannot safely add LabInsight account navigation");
  return text.replace(anchor, '<a href="./account.html">내 계정</a>' + anchor);
}
async function copy(sourceRoot, rel, target, transform) {
  const path = guarded(sourceRoot, rel);
  if (!existsSync(path)) throw new Error("Missing source: " + rel);
  const content = await readFile(path, "utf8");
  await writeFile(target, transform ? transform(content) : content);
}
async function copyIcons() {
  const from = guarded(lab, "icons");
  if (!existsSync(from)) throw new Error("Missing LabInsight icons");
  const allowed = new Set(["icon.svg", "icon-192.png", "icon-512.png"]);
  await mkdir(join(labOutput, "icons"), { recursive: true });
  for (const e of await readdir(from, { withFileTypes: true })) {
    if (e.isFile() && allowed.has(e.name)) {
      await copyFile(guarded(from, e.name), join(labOutput, "icons", e.name));
    }
  }
}
async function build() {
  if (existsSync(output)) throw new Error("dist exists; refusing unsafe overwrite");
  if (!existsSync(guarded(portal, "index.html")) || !existsSync(guarded(lab, "index.html"))) {
    throw new Error("LABDAM or LabInsight source checkout missing");
  }
  await mkdir(join(output, "assets"), { recursive: true });
  await mkdir(labOutput, { recursive: true });
  for (const file of ["index.html", "privacy.html", "terms.html"]) {
    await copy(portal, file, join(output, file),
      file === "index.html" ? portalHtml : s => noIndex(rewritePaths(s)));
  }
  await copyFile(guarded(portal, "favicon.svg"), join(output, "favicon.svg"));
  await copyFile(guarded(portal, "assets/portal-redesign.css"),
    join(output, "assets", "portal-redesign.css"));

  for (const page of authPages) {
    await copy(here, page, join(output, page));
  }
  for (const file of labFiles) {
    const dest = join(labOutput, file);
    if (file.endsWith(".html")) {
      await copy(lab, file, dest, labHtml);
    } else if (file.endsWith(".js")) {
      await copy(lab, file, dest, rewritePaths);
    } else {
      await copyFile(guarded(lab, file), dest);
    }
  }
  await copy(here, "account.html", join(labOutput, "account.html"));
  await copyIcons();
  // Never leave private LabInsight resources in offline CacheStorage after logout.
  await writeFile(join(labOutput, "service-worker.js"),
    'self.addEventListener("install", e => e.waitUntil(self.skipWaiting()));\n' +
    'self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));\n');
  await writeFile(join(output, "robots.txt"), "User-agent: *\nDisallow: /\n");
  const expected = [
    "index.html", "login.html", "pending.html", "account.html", "admin.html", "membership-privacy.html",
    "privacy.html", "terms.html", "favicon.svg", "robots.txt",
    "assets/portal-redesign.css", "labinsight/index.html",
    "labinsight/checkup.html", "labinsight/report.html",
    "labinsight/account.html", "labinsight/reference-ranges.js"
  ];
  for (const file of expected) {
    if (!(await stat(join(output, file))).isFile()) throw new Error("Invalid static output: " + file);
  }
  if (existsSync(join(output, "caffeine-atlas"))) {
    throw new Error("Public Caffeine Atlas must not be packaged behind login");
  }
  console.log("Built LABDAM + LabInsight gated assets only (not deployed).");
}
build().catch(e => { console.error(e.message); process.exitCode = 1; });
