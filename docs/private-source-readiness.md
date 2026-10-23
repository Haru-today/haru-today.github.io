# REPODAM private-source transition

Status: preparation only. `Haru-today/labinsight` remains public until the checks below are complete. `Haru-today/haru-today.github.io` and the LABDAM homepage remain public. Making a repository private cannot recall copies or forks already made while it was public.

## Deployment access

The existing manual release checks out the app from another repository. A public repository's default `GITHUB_TOKEN` cannot read a different private app repository. Add **LABINSIGHT_SOURCE_TOKEN** to the **labdam-trial** environment in the portal repository, using a fine-grained token restricted to `Haru-today/labinsight` with **Contents: read** and a limited expiry. An equivalently restricted GitHub App installation token is also suitable. Never paste the token into a chat, issue, workflow file or command argument. Do not reuse a Cloudflare token or a broad personal token.

The release workflow checks read access to the exact pinned app commit and passes this credential only to the source checkout with `persist-credentials: false`. It falls back to the existing job token while the source is public. A missing/expired private-source credential must fail before building or deploying.

## Before the visibility change

1. Confirm the dedicated read-only source secret is present, then run the existing manual release using the pinned, reviewed app commit. Confirm the deployment and anonymous gate probes pass.
2. Confirm the account plan supports the desired branch protections for a private repository. GitHub Free protection and CodeQL availability can differ between public and private repositories. Do not purchase a plan or enable paid security features implicitly. Keep local/CI secret scanning, dependency auditing and browser tests available independently.
3. Confirm collaborators, GitHub App installations, native build workflows, local clone access and any public app Pages site. The app's legacy Pages handoffs already exist in the separate homepage repository; preserve those URLs and the online approval flow.
4. Review the source/license publication policy. The current package metadata says MIT and there is no root LICENSE file; do not promise confidentiality or legal exclusivity based on repository settings alone.
5. Preserve the current deployment and immutable rollback pins. Change only the app repository's visibility after the owner approves the prepared transition.

## After the visibility change

Verify anonymous source access is denied, approved development tools still fetch, and the manual release still builds the exact app commit. Recheck homepage 200, Google login entry, protected HTML 303, protected JS/API 401 and the Pages handoffs. Keep the operator's 2FA/passkey and recovery codes under their own control; API results that omit 2FA status do not prove it is enabled.
