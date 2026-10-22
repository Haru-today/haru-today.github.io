/**
 * Retention planning only. NO Cloudflare/D1 imports, SQL, mutation, network
 * requests or live member data. NOT referenced by the production Worker.
 *
 * These ages are examples for an operator decision, NOT agreed retention limits.
 * Values are synthetic unless explicitly supplied by local tests.
 */
const DAY_SECONDS = 86400;
const INTEGER_SECONDS = n => Number.isSafeInteger(n) && n >= 0;
const VALID_DAYS = n => Number.isSafeInteger(n) && n > 0 && n <= 3650;

export function previewRetention(rows, options = {}) {
  if (!Array.isArray(rows)) throw new TypeError('Only an array of synthetic rows is supported');
  const {
    nowSeconds, pendingDays, rejectedDays
  } = options;
  if (!INTEGER_SECONDS(nowSeconds) || !VALID_DAYS(pendingDays) || !VALID_DAYS(rejectedDays)) {
    throw new TypeError('Operator must supply nowSeconds, pendingDays and rejectedDays explicitly');
  }
  const totals = {
    scanned: 0, pending: 0, rejected: 0, approved: 0, administrators: 0,
    pendingCandidates: 0, rejectedCandidates: 0, skippedUnreliable: 0
  };
  // No email, name, google_sub, IP, purpose, notes or per-member output.
  for (const row of rows) {
    totals.scanned++;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      totals.skippedUnreliable++;
      continue;
    }
    if (row.role === 'admin') {
      totals.administrators++;
      continue;
    }
    if (row.role !== 'member') {
      totals.skippedUnreliable++;
      continue;
    }
    if (row.status === 'approved') {
      totals.approved++;
      continue;
    }
    if (row.status === 'pending') {
      totals.pending++;
      // Existing D1 schema: created_at and updated_at are Unix seconds.
      // Do not assume a missing, negative, future or malformed timestamp.
      if (!INTEGER_SECONDS(row.created_at) || !INTEGER_SECONDS(row.updated_at) ||
          row.created_at > row.updated_at || row.updated_at > nowSeconds) {
        totals.skippedUnreliable++;
        continue;
      }
      if (nowSeconds - row.updated_at >= pendingDays * DAY_SECONDS) totals.pendingCandidates++;
      continue;
    }
    if (row.status === 'rejected') {
      totals.rejected++;
      // Use review time, NOT creation date, for rejected applicants.
      if (!INTEGER_SECONDS(row.reviewed_at) || row.reviewed_at > nowSeconds ||
          !INTEGER_SECONDS(row.created_at) || row.created_at > row.reviewed_at) {
        totals.skippedUnreliable++;
        continue;
      }
      if (nowSeconds - row.reviewed_at >= rejectedDays * DAY_SECONDS) totals.rejectedCandidates++;
      continue;
    }
    totals.skippedUnreliable++;
  }
  return {
    ...totals,
    candidateTotal: totals.pendingCandidates + totals.rejectedCandidates,
    examplesOnly: true,
    days: { pending: pendingDays, rejected: rejectedDays },
    disclaimer: '계획용 추산으로 실제 계정 조회·삭제·보유기간 적용을 수행하지 않습니다.'
  };
}
