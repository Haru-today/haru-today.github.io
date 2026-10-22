"use strict";
(function () {
  const byId = id => document.getElementById(id);
  const start = byId("portalGoogleStart"), account = byId("portalAccountLink");
  if (!start || !account) return;
  const nextInput = new URLSearchParams(location.search).get("next");
  let next = "/";
  if (typeof nextInput === "string" && nextInput.length <= 350 &&
      nextInput.startsWith("/") && !nextInput.startsWith("//") && !/[\r\n\\]/.test(nextInput)) {
    const target = new URL(nextInput, location.origin);
    if (target.origin === location.origin && (target.pathname === "/" ||
        target.pathname.startsWith("/labinsight/") || ["/account.html", "/admin.html"].includes(target.pathname))) next = target.pathname + target.search;
  }
  start.href = "/auth/start?next=" + encodeURIComponent(next);
  start.addEventListener("click", event => {
    // An explicit account switch discards only this service's previous records.
    // Merely browsing the public brand homepage never deletes a report.
    try {
      for (const storage of [sessionStorage, localStorage]) {
        for (const key of ["labinsight-latest-report", "labinsight-carepath-session-v1",
          "labinsight-demo-bookings-v2", "labinsight-bookings"]) storage.removeItem(key);
      }
    } catch (_) {
      event.preventDefault();
      byId("portalSessionStatus").textContent = "기존 임시 검사결과를 지우지 못했습니다. 브라우저 사이트 데이터를 삭제한 뒤 다시 시도해 주세요.";
    }
  });
  (async function refresh() {
    try {
      const response = await fetch("/api/session-status", {
        credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error("Session unavailable");
      const session = await response.json();
      if (!session.authenticated) return;
      const approved = session.status === "approved";
      account.href = "/account.html";
      account.textContent = "내 계정";
      start.hidden = true;
      const action = byId("portalMemberAction");
      action.hidden = false;
      action.href = approved ? (next === "/" ? "/labinsight/" : next) : "/pending.html";
      action.textContent = approved ? "리포담 들어가기 →" : "승인 상태 확인하기 →";
      byId("portalSessionTitle").textContent = approved ? "로그인되어 있어요" : "계정의 승인 상태를 확인해 주세요";
      byId("portalSessionText").textContent = approved
        ? "다시 로그인하지 않고 리포담을 이용할 수 있어요."
        : "랩담 홈페이지는 계속 둘러볼 수 있어요. 리포담은 관리자 승인 후 이용할 수 있습니다.";
    } catch (_) {
      byId("portalSessionStatus").textContent = "로그인 상태를 확인하지 못했습니다. 서비스를 열면 계정 상태를 다시 확인합니다.";
    }
  })();
})();
