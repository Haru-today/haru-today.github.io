# LABDAM public brand and protected REPODAM

LABDAM / and /index.html are public, read-only brand pages. The header login link opens the homepage login section. Google OAuth remains server-side and existing accounts and approval records are reused.

REPODAM HTML, scripts, styles, data files, account pages and administration APIs require the existing session and approval checks. Anonymous HTML requests return to /?next=...#login; approved OAuth callbacks return to the original safe destination. Pending and rejected applicants can browse the brand page but cannot enter REPODAM. Logout returns to the brand login section.

Only the exact brand page, favicon, portal stylesheet, portal-session.js and brand policy pages are public. Arbitrary /assets paths and private app resources are never allowlisted. The minimal /api/session-status response contains no identity, profile, CSRF token or health information, uses no-store and varies by Cookie. Public brand browsing does not require working OAuth credentials or D1.

Browsing the homepage preserves temporary reports. Explicit login/account switching removes only known REPODAM health/demo keys before OAuth starts; failure blocks navigation. Unrelated browser settings are untouched. The legacy /login.html remains a compatibility entry, while primary navigation and logout use the brand homepage.
