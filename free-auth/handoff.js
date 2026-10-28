/* Browser-only handoff. No report contents leave the browser. */
(function () {
  "use strict";
  const OLD = "https://labdam-free-approval.jleegenomics.workers.dev";
  const NEXT = "https://repodam.labdam.kr";
  const KEYS = ["labinsight-latest-report", "labinsight-carepath-session-v1", "labinsight-demo-bookings-v2"];
  const MAX = 200000;
  const LABS = ["ast","alt","ggtp","glucose","hba1c","totalChol","triglyceride","hdl","ldl",
    "creatinine","egfr","uricAcid","hemoglobin","wbc","platelet"];
  const reportKeys = new Set([...LABS,"gender","age","height","weight","bpSys","bpDia","bmi","reportSchemaVersion","referenceRanges","provenance"]);
  const bookingKeys = new Set(["id","hospitalId","hospital","department","packageName","date","time","demo","status","createdAt","updatedAt"]);
  const object = v => !!v && typeof v === "object" && !Array.isArray(v);
  const keysOnly = (v, allowed) => object(v) && Object.keys(v).every(k => allowed.has(k));
  const numeric = v => v === null || v === "" || (typeof v === "number" && Number.isFinite(v) && v >= 0) ||
    (typeof v === "string" && /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v) &&
      Number.isFinite(Number(v)) && Number(v) >= 0);
  function validRange(v) {
    return v === null || (keysOnly(v, new Set(["min","max","unit"])) && numeric(v.min) && numeric(v.max) &&
      (v.unit === undefined || (typeof v.unit === "string" && v.unit.length <= 40)));
  }
  function validReport(v) {
    if (!keysOnly(v, reportKeys)) return false;
    return Object.entries(v).every(([k,x]) => {
      if (k === "gender") return ["male","female","unknown"].includes(x);
      if (k === "provenance") return ["sample","manual"].includes(x);
      if (k === "reportSchemaVersion") return Number.isInteger(x) && x >= 1 && x <= 4;
      if (k === "referenceRanges") return object(x) &&
        Object.entries(x).every(([id,range]) => LABS.includes(id) && validRange(range));
      return numeric(x);
    });
  }
  function validCare(v) {
    if (!keysOnly(v, new Set(["version","records"])) || v.version !== 1 ||
        !Array.isArray(v.records) || v.records.length > 12) return false;
    const recKeys = new Set(["id","date","laboratory","note","values"]);
    return v.records.every(r => keysOnly(r,recKeys) && typeof r.id === "string" &&
      typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
      typeof r.laboratory === "string" && r.laboratory.length <= 60 &&
      typeof r.note === "string" && r.note.length <= 200 && object(r.values) &&
      Object.entries(r.values).every(([id,val]) => LABS.includes(id) &&
        keysOnly(val,new Set(["value","unit","range"])) && numeric(val.value) &&
        typeof val.unit === "string" && val.unit.length <= 40 && validRange(val.range)));
  }
  function validBookings(v) {
    return Array.isArray(v) && v.length <= 100 && v.every(b =>
      keysOnly(b,bookingKeys) && Object.entries(b).every(([k,x]) =>
        k === "demo" ? x === true : k === "status" ? ["requested","confirmed","completed","cancelled"].includes(x) : typeof x === "string"));
  }
  function bounded(value, depth = 0) {
    if (depth > 8) return false;
    if (value === null || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "string") return value.length <= 256 && !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
    if (Array.isArray(value)) return value.length <= 100 && value.every(x => bounded(x, depth + 1));
    if (!value || typeof value !== "object") return false;
    const entries = Object.entries(value);
    return entries.length <= 50 && entries.every(([key, v]) =>
      /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) &&
      !["constructor","prototype","__proto__"].includes(key) && bounded(v, depth + 1));
  }
  function valid(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    const names = Object.keys(data);
    if (!names.length || names.some(k => !KEYS.includes(k))) return false;
    try {
      return names.every(k => {
        if (typeof data[k] !== "string" || data[k].length > MAX) return false;
        const parsed = JSON.parse(data[k]);
        if (!bounded(parsed)) return false;
        if (k === KEYS[0]) return validReport(parsed);
        if (k === KEYS[1]) return validCare(parsed);
        return validBookings(parsed);
      });
    } catch (_) { return false; }
  }
  async function identity(nonce) {
    const response = await fetch("/api/migration-identity?nonce=" + nonce, {credentials: "same-origin", cache: "no-store", redirect:"error"});
    if (!response.ok) throw Error("login required");
    const data = await response.json();
    if (!data || typeof data.id !== "string" || !/^[a-f0-9]{64}$/.test(data.id)) throw Error("bad identity");
    return data.id;
  }
  function randomNonce() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, "0")).join("");
  }
  if (location.origin === OLD && ["/labinsight/", "/labinsight/index.html"].includes(location.pathname)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "이 탭의 결과를 새 주소로 가져가기";
    button.addEventListener("click", () => {
      const records = {};
      try {
        for (const key of KEYS) {
          const value = sessionStorage.getItem(key);
          if (value !== null) records[key] = value;
        }
        if (!valid(records)) throw Error("missing or incompatible data");
      } catch (_) {
        alert("이 탭에 옮길 수 있는 결과가 없거나 형식을 확인할 수 없습니다. 기존 결과는 그대로 있습니다.");
        return;
      }
      if (!confirm("이 탭의 결과가 현재 계정의 것인지 확인해 주세요. 결과를 새 주소의 새 탭에만 복사하며 기존 탭의 결과는 지우지 않습니다. 새 주소에서 먼저 같은 Google 계정으로 로그인하고 복사 후 새 탭을 열어 둬야 합니다.")) return;
      if (button.disabled) return;
      button.disabled = true;
      const nonce = randomNonce();
      const popup = window.open(NEXT + "/labinsight/handoff.html#" + nonce, "_blank");
      if (!popup) { button.disabled = false; alert("팝업이 차단되어 이전을 시작하지 못했습니다."); return; }
      let phase = "waiting", expired = false;
      const timeout = setTimeout(() => {
        expired = true;
        window.removeEventListener("message", receive);
        button.disabled = false;
        if (phase !== "done") alert("복사 완료를 확인하지 못했습니다. 기존 탭의 결과는 그대로 있습니다.");
      }, 120000);
      async function receive(event) {
        const m = event.data;
        if (event.origin !== NEXT || event.source !== popup || !m || m.nonce !== nonce) return;
        if (expired) return;
        if ((phase === "sent" && ["repodam-done", "repodam-failed"].includes(m.type)) ||
            (phase === "waiting" && m.type === "repodam-failed")) {
          phase = "done"; button.disabled = false; clearTimeout(timeout); window.removeEventListener("message", receive);
          alert(m.type === "repodam-done" ? "새 탭으로 복사했습니다. 새 탭을 열어 두세요. 기존 탭의 결과도 그대로 있습니다." : "복사하지 못했습니다. 기존 탭의 결과는 그대로 있습니다.");
          return;
        }
        if (phase !== "waiting" || m.type !== "repodam-ready" || typeof m.id !== "string" || !/^[a-f0-9]{64}$/.test(m.id)) return;
        phase = "checking";
        try {
          if (await identity(nonce) !== m.id) throw Error("account mismatch");
          if (expired) return;
          phase = "sent";
          popup.postMessage({type: "repodam-copy", nonce, records}, NEXT);
        } catch (_) {
          if (expired) return;
          popup.postMessage({type: "repodam-failed", nonce}, NEXT);
          phase = "done"; button.disabled = false; clearTimeout(timeout); window.removeEventListener("message", receive);
          alert("계정 또는 저장된 결과를 확인할 수 없어 복사하지 않았습니다.");
        }
      }
      window.addEventListener("message", receive);
    });
    fetch("/api/handoff-status", {credentials:"same-origin", cache:"no-store"})
      .then(r => r.ok ? r.json() : {enabled:false})
      .then(x => { const main = document.querySelector("main"); if (x.enabled === true && main) main.prepend(button); })
      .catch(() => {});
  }
  if (location.origin === NEXT && location.pathname === "/labinsight/handoff.html") {
    const status = document.getElementById("status");
    const nonce = location.hash.slice(1);
    const parent = window.opener;
    history.replaceState(null, "", location.pathname);
    if (!parent || !/^[a-f0-9]{64}$/.test(nonce)) {
      status.textContent = "이전 요청을 확인할 수 없습니다. 기존 리포담 탭에서 다시 시작해 주세요.";
      return;
    }
    let used = false, expired = false, readyId = null;
    const timeout = setTimeout(() => {
      expired = true;
      window.removeEventListener("message", receive);
      window.opener = null;
      if (!used) status.textContent = "이전 요청이 만료됐습니다. 기존 탭에서 다시 시작해 주세요.";
    }, 120000);
    async function receive(event) {
      const m = event.data;
      if (used || expired || event.origin !== OLD || event.source !== parent || !m || m.nonce !== nonce ||
          !["repodam-copy", "repodam-failed"].includes(m.type)) return;
      used = true;
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
      if (m.type !== "repodam-copy" || !valid(m.records)) {
        window.opener = null;
        status.textContent = "복사할 결과를 확인하지 못했습니다. 기존 탭의 결과는 그대로 있습니다.";
        return;
      }
      const written = [];
      try {
        if (!readyId || await identity(nonce) !== readyId) throw Error("account changed");
        // Never overwrite results already present in this destination tab.
        for (const key of Object.keys(m.records)) {
          if (sessionStorage.getItem(key) !== null) throw Error("destination exists");
        }
        for (const key of Object.keys(m.records)) {
          sessionStorage.setItem(key, m.records[key]);
          written.push(key);
        }
        status.textContent = "결과를 복사했습니다. 리포담을 여는 중입니다.";
        parent.postMessage({type:"repodam-done", nonce}, OLD);
        window.opener = null;
        location.replace("/labinsight/");
      } catch (_) {
        for (const key of written) try { sessionStorage.removeItem(key); } catch (_) {}
        parent.postMessage({type:"repodam-failed", nonce}, OLD);
        window.opener = null;
        status.textContent = "복사하지 못했습니다. 기존 탭의 결과는 그대로 있습니다.";
      }
    }
    window.addEventListener("message", receive);
    identity(nonce).then(id => { if (!expired && !used) { readyId = id; parent.postMessage({type: "repodam-ready", nonce, id}, OLD); } })
      .catch(() => {
        if (!expired && !used) parent.postMessage({type:"repodam-failed", nonce}, OLD);
        window.opener = null; status.textContent = "새 주소에서 같은 Google 계정으로 로그인한 뒤 기존 탭에서 다시 시작해 주세요.";
      });
  }
})();
