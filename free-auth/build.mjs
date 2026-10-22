/*
 * Fail-closed static asset packager for Workers Free.
 * LABDAM and REPODAM only; Caffeine Atlas is a separate public site.
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
  "index.html", "checkup.html", "report.html", "hospitals.html", "carepath.html",
  "styles.css", "app.js", "carepath.js", "carepath-data.js", "ocr-review.js", "reference-ranges.js",
  "hospital-data.js", "runtime-config.js", "manifest.webmanifest"
];
// Older reviewed snapshots predate this optional module. New reports must
// carry the module inside the same approval-protected static bundle.
if (existsSync(join(lab, "supplement-guidance.js"))) {
  labFiles.push("supplement-guidance.js");
}
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
function protectedPolicyHtml(src, kind) {
  let html = noIndex(rewritePaths(src));
  const start = '<main class="shell">';
  if (!html.includes(start)) throw new Error("Cannot locate LABDAM policy content");
  const notice = kind === "privacy"
    ? '<section class="section" aria-label="회원가입 데이터 처리"><h2>회원가입·로그인 정보 처리</h2>' +
      '<p>LABDAM과 REPODAM은 Google 계정 인증 후 관리자 승인제로 운영합니다. 회원가입 심사를 위해 Google 계정 식별자, 이메일, 표시 이름, 선택적으로 입력한 가입 목적, 승인 상태 및 세션 해시값을 Cloudflare D1에 처리합니다. 건강검진 입력값은 회원가입 데이터베이스에 저장하지 않습니다.</p>' +
      '<p>LABDAM·REPODAM 회원가입의 개인정보처리자는 <strong>이정민</strong>이며 개인정보 문의는 <a href="mailto:jleegenomics@gmail.com">jleegenomics@gmail.com</a>으로 접수할 수 있습니다. 운영자·문의처 안내는 2026년 10월 22일 갱신했습니다.</p>' +
      '<p>승인 대기·승인 회원의 가입 철회와 세션 삭제는 계정 페이지에서 제공합니다. 개인정보 보호책임자 지정, 회원정보 보유정책·외부 처리 등 남은 사항은 정식 운영 전에 확정해야 합니다. 자세한 내용은 <a href="/membership-privacy.html">회원가입 개인정보 처리 안내</a>를 확인하세요.</p></section>'
    : '<section class="section" aria-label="회원 승인 정책"><h2>LABDAM 회원 승인 방식</h2>' +
      '<p>LABDAM과 REPODAM은 Google 계정으로 가입을 신청하고 관리자 승인을 받아야 이용할 수 있습니다. 이메일 인증만으로는 승인되지 않으며, 관리자는 접근 승인을 거절하거나 철회할 수 있습니다. 회원가입 및 개인정보 처리에 관해서는 <a href="/membership-privacy.html">회원가입 개인정보 안내</a>를 참고하세요.</p>' +
      '<p>Caffeine Atlas는 이 로그인 정책과 무관하며 누구나 별도 승인 없이 이용할 수 있습니다.</p></section>';
  html = html.replace(start, start + "\n" + notice);
  if (kind === "privacy") {
    html = html.replace('운영 주체의 법적 명칭·책임자 및 전용 연락 창구,', '개인정보 보호책임자 지정과 서비스별 운영 절차,')
      .replace('현재 서비스 전용 개인정보 담당자, 연락 수단 및 실명 확인 절차는 확정되지 않았습니다.',
        'LABDAM·REPODAM 회원가입의 운영자·문의처는 위 회원가입 안내를 확인하세요. 개인정보 보호책임자 지정·본인 확인 절차 및 Caffeine Atlas의 별도 운영 절차는 최종 확인이 필요합니다.');
    const older = "포털에는 이름·검사값 입력란이 없습니다.";
    const revised = "포털 자체에는 건강검진 수치 입력란이 없지만, 승인제 회원가입 과정에서 이메일·이름 등 계정 정보를 처리합니다.";
    if (!html.includes(older)) throw new Error("Legacy portal privacy wording has changed; review required");
    html = html.replace(older, revised);
  }
  return html;
}
function labHtml(src) {
  const text = noIndex(rewritePaths(src));
  const anchor = '<a class="nav-cta"';
  if (!text.includes(anchor)) throw new Error("Cannot safely add REPODAM account navigation");
  return text.replace(anchor, '<a href="./account.html">내 계정</a>' + anchor);
}
function protectedLabScript(src) {
  const text = rewritePaths(src);
  const ready = 'if (cache) cache.textContent = "오프라인 준비 완료";';
  const waiting = 'if (cache) cache.textContent = "오프라인 캐시 대기";';
  if (!text.includes(ready) || !text.includes(waiting)) {
    throw new Error("REPODAM cache status changed; review protected online-only wording");
  }
  return text.replace(ready, 'if (cache) cache.textContent = "승인 확인을 위해 온라인 연결 필요";')
    .replace(waiting, 'if (cache) cache.textContent = "온라인 연결 상태를 확인해 주세요";');
}
async function copy(sourceRoot, rel, target, transform) {
  const path = guarded(sourceRoot, rel);
  if (!existsSync(path)) throw new Error("Missing source: " + rel);
  const content = await readFile(path, "utf8");
  await writeFile(target, transform ? transform(content) : content);
}
async function copyIcons() {
  const from = guarded(lab, "icons");
  if (!existsSync(from)) throw new Error("Missing REPODAM icons");
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
    throw new Error("LABDAM or REPODAM source checkout missing");
  }
  await mkdir(join(output, "assets"), { recursive: true });
  await mkdir(labOutput, { recursive: true });
  for (const file of ["index.html", "privacy.html", "terms.html"]) {
    await copy(portal, file, join(output, file),
      file === "index.html" ? portalHtml : s => protectedPolicyHtml(s, file === "privacy.html" ? "privacy" : "terms"));
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
      await copy(lab, file, dest, file === "app.js" ? protectedLabScript : rewritePaths);
    } else {
      await copyFile(guarded(lab, file), dest);
    }
  }
  await copy(here, "account.html", join(labOutput, "account.html"));
  await copyIcons();
  // Never leave private REPODAM resources in offline CacheStorage after logout.
  await writeFile(join(labOutput, "service-worker.js"),
    'self.addEventListener("install", e => e.waitUntil(self.skipWaiting()));\n' +
    'self.addEventListener("activate", e => e.waitUntil(\n' +
    '  Promise.all([self.clients.claim(), caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key))))])\n' +
    '));\n');
  await writeFile(join(output, "robots.txt"), "User-agent: *\nDisallow: /\n");
  const expected = [
    "index.html", "login.html", "pending.html", "account.html", "admin.html", "membership-privacy.html",
    "privacy.html", "terms.html", "favicon.svg", "robots.txt",
    "assets/portal-redesign.css", "labinsight/index.html",
    "labinsight/checkup.html", "labinsight/report.html", "labinsight/carepath.html",
    "labinsight/carepath.js", "labinsight/carepath-data.js",
    "labinsight/account.html", "labinsight/reference-ranges.js"
  ];
  for (const file of expected) {
    if (!(await stat(join(output, file))).isFile()) throw new Error("Invalid static output: " + file);
  }
  if (existsSync(join(output, "caffeine-atlas"))) {
    throw new Error("Public Caffeine Atlas must not be packaged behind login");
  }
  console.log("Built LABDAM + REPODAM gated assets only (not deployed).");
}
build().catch(e => { console.error(e.message); process.exitCode = 1; });
