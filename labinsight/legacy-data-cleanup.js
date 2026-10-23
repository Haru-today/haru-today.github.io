"use strict";
// Opt-in cleanup for the RETIRED public Pages origin only.
// Do not include this file in the private Worker bundle or run it automatically.
// Never inspect, render, transmit or log stored medical values.
(function () {
  const button = document.getElementById("clearOldLabInsight");
  const status = document.getElementById("cleanupStatus");
  if (!button || !status) return;

  const keys = [
    "labinsight-latest-report",
    "labinsight-carepath-session-v1",
    "labinsight-demo-bookings-v2",
    "labinsight-bookings"
  ];
  const retiredScope = new URL("/labinsight/", window.location.origin).href;
  let busy = false;

  button.addEventListener("click", async function () {
    if (busy) return;
    if (!window.confirm("이 브라우저의 이전 REPODAM 임시 검사 결과, 예약 체험 기록, 앱 캐시를 삭제할까요? 삭제 후에는 복구할 수 없습니다.")) return;
    busy = true;
    button.disabled = true;
    status.textContent = "선택한 REPODAM 데이터의 삭제 상태를 확인 중입니다.";
    let errors = 0;
    try {
      for (const storeName of ["sessionStorage", "localStorage"]) {
        try {
          const store = window[storeName];
          for (const key of keys) {
            try { store.removeItem(key); } catch (_) { errors++; }
          }
        } catch (_) { errors++; }
      }

      // The same origin also hosts Caffeine Atlas; delete NO unrelated caches.
      try {
        if ("caches" in window) {
          for (const name of await window.caches.keys()) {
            if (name.startsWith("labinsight-app-")) {
              if (!(await window.caches.delete(name))) errors++;
            }
          }
        }
      } catch (_) { errors++; }

      // Never unregister Caffeine Atlas or other app workers on this origin.
      try {
        if ("serviceWorker" in navigator) {
          for (const registration of await navigator.serviceWorker.getRegistrations()) {
            if (registration.scope === retiredScope) {
              if (!(await registration.unregister())) errors++;
            }
          }
        }
      } catch (_) { errors++; }

      status.textContent = errors ?
        "일부 항목을 삭제하지 못했습니다. 브라우저의 사이트 데이터 설정에서 이전 REPODAM 데이터를 확인해 주세요. 사이트 전체 삭제 시 다른 서비스 데이터도 지워질 수 있습니다." :
        "이 탭의 이전 REPODAM 임시 기록과 이 브라우저에서 접근 가능한 REPODAM 캐시·등록을 정리했습니다. 다른 탭·기기·브라우저의 기록은 별도로 확인해 주세요.";
    } finally {
      busy = false;
      button.disabled = false;
    }
  });
})();
