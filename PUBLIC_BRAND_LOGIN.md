# LABDAM homepage and REPODAM service login

The canonical public LABDAM homepage is https://haru-today.github.io/.
The Worker host serves REPODAM. Its root, /index.html and /login are legacy aliases for /login.html?next=/labinsight/; they no longer display the older duplicate LABDAM portal. Existing /#login bookmarks still reach REPODAM login.

Anonymous protected HTML redirects to the dedicated /login.html with a validated next destination. Scripts, fonts, data, APIs and non-HTML resources remain denied (401); pending/rejected members remain denied (403), and HTML goes to /pending.html. No REPODAM home or private application source is made public.

The dedicated login checks the minimal session-status endpoint. Existing approved sessions resume the validated destination; pending/rejected sessions go to the approval page. The explicit switch=1 link allows another Google account without a redirect loop. Reports are cleared only on explicit account switch/logout, using the existing scoped keys.

OAuth callback URI, Google client, D1 binding, cookie attributes, administrator approval and application IDs are unchanged. Unsafe return targets fall back to /labinsight/. Logout and expired sessions return to /login.html, while LABDAM home links use the canonical public URL. Caffeine Atlas retains its public URLs and QR destinations.

Release from a separately reviewed immutable Worker commit. Rollback source: aab3aeb8b9557fcff3f2827e95e8b724a0718695. Do not merge this source-snapshot branch into public homepage main; main release configuration pins it explicitly.