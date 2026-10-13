# LABDAM shared login gateway — implementation staging

**Status (2026-10-13): CODE REVIEW ONLY; NOT DEPLOYED. No login requirement is active on existing GitHub Pages service URLs.**

LABDAM = Personal Health Atlas, the ONE public integrated portal. LabInsight
and Caffeine Atlas remain the only two services. This folder provides
authentication infrastructure and is **not a fourth website**.

## Intended experience

1. Anyone can view the public LABDAM brand homepage.
2. Choosing either service opens ONE protected host with two paths:
   - https://PROTECTED-HOST-TO-CONFIGURE/labinsight/
   - https://PROTECTED-HOST-TO-CONFIGURE/caffeine-atlas/
3. Cloudflare Access authenticates the visitor. Recommended first launch:
   approved email addresses and an email one-time passcode; a Google identity
   provider may be configured separately.
4. A single Cloudflare Access application protects the whole hostname, so
   one login covers both services.
5. Cloudflare Access forwards a Cf-Access-Jwt-Assertion. The Worker checks
   its **RS256 signature, issuer, audience, expiry and human subject** before
   responding with even a single HTML, JS, CSS or image asset.
6. /logout uses the Cloudflare Access logout endpoint. Logging out does not
   automatically erase downloaded reports, browser sessionStorage or
   externally saved records. Preserve the apps' existing deletion controls.

Official references:
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- https://developers.cloudflare.com/workers/static-assets/binding/

## CRITICAL: old public URLs bypass the new login

Currently these are publicly accessible GitHub Pages applications:

- https://haru-today.github.io/labinsight/
- https://haru-today.github.io/caffeine-atlas/
- https://haru-today.github.io/caffeine-atlas/caffeine-sensitivity-app/analyzer.html

A JavaScript-only login screen or a gateway at another domain cannot
restrict these old URLs. Changing only the index redirect is insufficient
because the subpages and assets would remain directly accessible. After
the protected host is verified, disable publishing of the two old GitHub
Pages projects (or otherwise make ALL old app files inaccessible).
Keep the LABDAM portal public.

**This PR DOES NOT deploy or claim to enforce login on production.** It
does not configure identity-provider accounts, DNS, secrets, cloud resources,
a user database, or any existing users' passwords.

## Operator launch checklist — do not post credentials in GitHub

- [ ] Verify ownership of a real domain. PROTECTED-HOST-TO-CONFIGURE is a
  placeholder, not an owned or live LABDAM host.
- [ ] Create one Cloudflare Zero Trust Access self-hosted application that
  covers the entire protected hostname, with email OTP or Google IdP,
  an explicit allow policy, and no Everyone or Bypass policy.
- [ ] Note your Access team domain and unique application AUD. Configure
  Worker TEAM_DOMAIN (example https://team.cloudflareaccess.com) and
  ACCESS_AUD via environment secret settings; do not commit personal keys.
- [ ] With reviewed local source checkouts, build static web shells:
      LABINSIGHT_SOURCE=/path/to/labinsight
      CAFFEINE_SOURCE=/path/to/caffeine-atlas
      node auth-gateway/build.mjs
  No patient, research or operational data must be supplied.
- [ ] Verify CI and negative JWT tests before deployment. The Wrangler
  worker asset configuration has run_worker_first=true: every static asset
  requires signed and authorized identity.
- [ ] Deploy manually after Access policy review with Wrangler, for example:
      npx wrangler deploy --config auth-gateway/wrangler.jsonc
  There is NO automatic production deployment.
- [ ] Test anonymous and disallowed users are rejected for BOTH homepages,
  direct subpages, HTML, JS, CSS, image and report routes. Verify one
  approved account may use both after a single login.
- [ ] Caffeine Atlas Google Apps Script / Sheets endpoints also require
  separately authenticated, authorized backend controls. Protecting the
  website does NOT secure a publicly writable API. Do not accept real
  identifiable research/health data until backend auth, lawful consent,
  retention and deletion have been verified.
- [ ] Native LabInsight desktop/Capacitor apps are independent of this
  web-only gateway; old standalone installations cannot be remotely
  disabled by switching web hosting.
- [ ] Once protected routing is verified, change the public LABDAM two
  service buttons to the real host, then disable BOTH old public GitHub
  Pages project publications. Recheck deep links (not only index pages).
- [ ] Implement account lifecycle, verified support/contact, logout
  behavior, data ownership, privacy disclosures and deletion procedures.
  Authentication alone does not certify clinical or legal compliance.

## Files and tests

- worker.mjs: deny-by-default signing-key and token validation.
- wrangler.jsonc: static assets binding, always Worker first.
- build.mjs: whitelisted web shells; no server-side data files.
- verify-bundle.test.cjs: disallow sensitive files and indexable pages.
- tests/auth-gateway.test.cjs: JWT spoofing, expiry, issuer, audience,
  algorithm confusion, missing identity, logout and outage tests.
- .github/workflows/auth-gateway-ci.yml: non-deploy tests and build checks.

The protected LabInsight staging bundle includes a cache-free service worker
to prevent offline loading of protected web pages. The existing production
service worker, OCR, booking demo, reporting, session deletion and native
apps are untouched.

Local review commands (Node 22):

    node --test tests/auth-gateway.test.cjs
    node --check auth-gateway/worker.mjs

After supplying paths to public source checkouts and building:

    node --test auth-gateway/verify-bundle.test.cjs

This workflow does not inspect, store or transmit actual health/genetic records.
