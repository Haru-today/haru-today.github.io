/*
 * Assemble only published web assets for protected hosting.
 * No bookings, patient/genetic records or server data files are accessed.
 * This script never deploys anything.
 */
import { copyFile, mkdir, readFile, writeFile, stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "dist");
const lab = resolve(process.env.LABINSIGHT_SOURCE || join(here, "../../labinsight"));
const caffeine = resolve(process.env.CAFFEINE_SOURCE || join(here, "../../caffeine-atlas"));
const labOut = join(dist, "labinsight");
const cafOut = join(dist, "caffeine-atlas");
const cafAppOut = join(cafOut, "caffeine-sensitivity-app");

const labFiles = [
  "index.html", "checkup.html", "report.html", "hospitals.html",
  "styles.css", "app.js", "ocr-review.js", "reference-ranges.js",
  "hospital-data.js", "runtime-config.js", "manifest.webmanifest"
];
const cafFiles = [
  "index.html", "analyzer.html", "board.html", "board-write.html",
  "app.js", "styles.css"
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
  let html = text.replace(
    /<meta\s+name=["']robots["']\s+content=["'][^"']+["']\s*\/?>/i, ""
  );
  const marker = '<meta name="robots" content="noindex,nofollow">';
  if (!html.includes("<head>")) throw new Error("Expected valid HTML head.");
  return html.replace("<head>", "<head>\n  " + marker);
}

function protectedLinkRewrite(text) {
  // The public LABDAM portal remains accessible; the two service links do not.
  return text
    .replaceAll("https://haru-today.github.io/caffeine-atlas/", "/caffeine-atlas/")
    .replaceAll("https://haru-today.github.io/labinsight/", "/labinsight/")
    .replaceAll('hidden data-disabled-feature="account"', "")
    .replaceAll("회원 안내", "내 계정")
    .replaceAll("구축 방식 보기", "내 계정 확인");
}

function protectCaffeineBrowserApp(source) {
  // This transformation exists only in the protected deployment bundle.
  // Never ship a signed credential or the direct Google Apps Script URL.
  let output = protectedLinkRewrite(source);
  const endpoint = /var GOOGLE_SHEETS_ENDPOINT = "https:\/\/script\.google\.com\/macros\/s\/[^"]+\/exec";/;
  if (!endpoint.test(output)) throw new Error("Cannot identify legacy Caffeine Atlas endpoint.");
  output = output.replace(endpoint, 'var GOOGLE_SHEETS_ENDPOINT = "/api/caffeine-atlas";');
  const start = output.indexOf("function requestEndpointStatus(parameters) {");
  const end = output.indexOf("function verifyBatchEndpointSupport()", start);
  if (start < 0 || end < 0) throw new Error("Cannot identify JSONP receipt transport.");
  const secureStatus = [
    "function requestEndpointStatus(parameters) {",
    '    return fetch(GOOGLE_SHEETS_ENDPOINT + "?" + parameters, {',
    '      method: "GET", credentials: "same-origin", cache: "no-store"',
    '    }).then(function (response) {',
    '      if (!response.ok) throw new Error("인증된 저장 서버에 연결할 수 없습니다.");',
    '      return response.json();',
    '    });',
    "  }",
    "",
    "  "
  ].join("\n");
  output = output.slice(0, start) + secureStatus + output.slice(end);
  const oldMode = 'mode: "no-cors",';
  const oldType = '"Content-Type": "text/plain;charset=utf-8"';
  if (!output.includes(oldMode) || !output.includes(oldType)) {
    throw new Error("Cannot identify insecure POST transport.");
  }
  output = output.replace(oldMode, 'credentials: "same-origin",');
  output = output.replace(oldType, '"Content-Type": "application/json;charset=utf-8"');
  if (output.includes("https://script.google.com/macros/")) {
    throw new Error("Public Apps Script URL still present in the protected bundle.");
  }
  return output;
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
  if (!existsSync(join(lab, "index.html")) || !existsSync(join(caffeine, "index.html"))) {
    throw new Error("Expected sibling public-source checkouts for both services.");
  }
  await mkdir(labOut, { recursive: true });
  await mkdir(cafAppOut, { recursive: true });

  for (const file of labFiles) {
    const source = join(lab, file);
    const dest = join(labOut, file);
    assertInside(lab, source);
    if (!existsSync(source)) throw new Error("Missing public source file: " + file);
    await (file.endsWith(".html") ?
      publicTextCopy(source, dest, text => preventIndexing(protectedLinkRewrite(text))) :
      file.endsWith(".js") ?
        publicTextCopy(source, dest, protectedLinkRewrite) :
        copyFile(source, dest));
  }
  await copyCuratedAssets(join(lab, "icons"), join(labOut, "icons"),
    new Set(["icon.svg", "icon-192.png", "icon-512.png"]));

  // Disable offline service-worker caching so logout cannot leave a usable
  // app shell on this NEW protected origin. Existing native apps are separate.
  await writeFile(join(labOut, "service-worker.js"),
    'self.addEventListener("install",e=>e.waitUntil(self.skipWaiting()));\n' +
    'self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));\n');

  await publicTextCopy(join(caffeine, "index.html"), join(cafOut, "index.html"),
    source => preventIndexing(protectedLinkRewrite(source)));
  for (const file of cafFiles) {
    const source = join(caffeine, "caffeine-sensitivity-app", file);
    const dest = join(cafAppOut, file);
    assertInside(caffeine, source);
    if (!existsSync(source)) throw new Error("Missing public source file: " + file);
    await publicTextCopy(source, dest,
      text => file.endsWith(".html") ?
        preventIndexing(protectedLinkRewrite(text)) :
        file === "app.js" ? protectCaffeineBrowserApp(text) : protectedLinkRewrite(text));
  }
  // The source repository's account.html contains a NONFUNCTIONAL email/
  // password sign-in mockup. It MUST NEVER ship as a login page. Instead
  // include the verified session-status page backed by /api/session.
  await copyFile(join(here, "account.html"), join(cafAppOut, "account.html"));
  await copyCuratedAssets(join(caffeine, "caffeine-sensitivity-app/assets"),
    join(cafAppOut, "assets"), new Set([
      "caffeine-atlas-logo-simple.svg", "caffeine-atlas-logo-wordmark.png",
      "caffeine-atlas-logo.svg", "hero-caffeine-genetics.png",
      "labinsight-icon.png", "personal-health-atlas-logo.png",
      "caffeine-atlas-batch-template.xlsx"
    ]));
  await copyCuratedAssets(join(caffeine, "caffeine-sensitivity-app/vendor"),
    join(cafAppOut, "vendor"), new Set(["xlsx.full.min.js"]));

  await writeFile(join(dist, "robots.txt"), "User-agent: *\nDisallow: /\n");
  const expected = [
    "labinsight/index.html", "labinsight/checkup.html",
    "caffeine-atlas/index.html", "caffeine-atlas/caffeine-sensitivity-app/analyzer.html",
    "caffeine-atlas/caffeine-sensitivity-app/account.html"
  ];
  for (const file of expected) {
    if (!(await stat(join(dist, file))).isFile()) throw new Error("Missing required asset " + file);
  }
  console.log("Prepared public web shell for protected hosting, NOT deployed.");
}

run().catch(err => { console.error(err.message); process.exitCode = 1; });
