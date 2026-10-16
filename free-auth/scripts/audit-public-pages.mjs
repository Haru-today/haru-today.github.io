/*
 * Read-only, cookie-free check of the legacy public GitHub Pages paths.
 * DRY RUN by default: an exposed private page is printed but does not fail CI
 * until an operator has completed the separate, reviewed cutover.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const PAGES_ORIGIN="https://haru-today.github.io";
export const LEGACY_PROTECTED_PATHS=Object.freeze([
  "/",
  "/assets/portal-redesign.css",
  "/labinsight/",
  "/labinsight/index.html",
  "/labinsight/checkup.html",
  "/labinsight/report.html",
  "/labinsight/hospitals.html",
  "/labinsight/styles.css",
  "/labinsight/app.js",
  "/labinsight/ocr-review.js",
  "/labinsight/reference-ranges.js",
  "/labinsight/hospital-data.js",
  "/labinsight/runtime-config.js",
  "/labinsight/service-worker.js",
  "/labinsight/manifest.webmanifest",
  "/labinsight/icons/icon.svg",
  "/labinsight/icons/icon-192.png",
  "/labinsight/icons/icon-512.png"
]);
export const PUBLIC_CAFFEINE_PATHS=Object.freeze([
  "/caffeine-atlas/",
  "/caffeine-atlas/caffeine-sensitivity-app/analyzer.html",
  "/caffeine-atlas/privacy.html",
  "/caffeine-atlas/terms.html"
]);

function stateFor(kind,status) {
  if(kind==="protected"){
    if(status>=200&&status<300)return "EXPOSED";
    if([401,403,404,410].includes(status))return "CLOSED";
    return "REVIEW";
  }
  return status>=200&&status<300?"PUBLIC":"REVIEW";
}
export async function auditPublicPages(fetchImpl=fetch) {
  const targets=[
    ...LEGACY_PROTECTED_PATHS.map(path=>({path,kind:"protected"})),
    ...PUBLIC_CAFFEINE_PATHS.map(path=>({path,kind:"caffeine"}))
  ];
  const results=new Array(targets.length);
  let index=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(index<targets.length){
      const i=index++,target=targets[i];
      try{
        const response=await fetchImpl(PAGES_ORIGIN+target.path,{
          method:"GET",credentials:"omit",redirect:"manual",cache:"no-store",
          headers:{"Cache-Control":"no-cache"},signal:AbortSignal.timeout(7000)
        });
        const status=response.status;
        if(response.body){try{await response.body.cancel();}catch(_){}}
        results[i]={...target,status,state:stateFor(target.kind,status)};
      }catch(_){
        results[i]={...target,status:null,state:"REVIEW"};
      }
    }
  }));
  return {
    results,
    cutoverReady:results.every(item=>item.kind==="protected"?
      item.state==="CLOSED":item.state==="PUBLIC")
  };
}
async function main(){
  const flags=new Set(process.argv.slice(2));
  if([...flags].some(flag=>!["--require-cutover","--json"].includes(flag))){
    process.stderr.write("Usage: node free-auth/scripts/audit-public-pages.mjs [--json] [--require-cutover]\n");
    process.exitCode=2;return;
  }
  const report=await auditPublicPages();
  if(flags.has("--json")){
    process.stdout.write(JSON.stringify(report,null,2)+"\n");
  }else{
    for(const item of report.results)console.log(
      item.state.padEnd(8),String(item.status??"NETWORK").padEnd(7),PAGES_ORIGIN+item.path
    );
    console.log("PUBLIC PAGES CUTOVER:",report.cutoverReady?"READY":"NOT READY / REVIEW REQUIRED");
  }
  if(flags.has("--require-cutover")&&!report.cutoverReady)process.exitCode=1;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  main().catch(()=>{process.stderr.write("Public pages audit failed.\n");process.exitCode=2;});
}
