# REPODAM private-source transition

Status: preparation only. `Haru-today/labinsight` remains public until the checks below are complete. `Haru-today/haru-today.github.io` and the LABDAM homepage remain public. Making a repository private cannot recall copies or forks already made while it was public.

## Deployment access

The existing manual release checks out the app from another repository. A public repository's default `GITHUB_TOKEN` cannot read a different private app repository. A dedicated **read-only deploy key for `Haru-today/labinsight` only** was prepared and its SSH access verified on 2026-10-23. Its private part is stored only in the portal's **labdam-trial** environment as **LABINSIGHT_SOURCE_DEPLOY_KEY**; the temporary local private key was removed. It cannot push, grant account permissions or read other private repositories. Deploy keys have no built-in expiry: revoke and replace this key when access changes or a leak is suspected.

The release workflow passes the key only to the pinned source checkout, with strict SSH host verification and `persist-credentials: false`. A missing/invalid key must fail at checkout before building or deploying. A fine-grained **LABINSIGHT_SOURCE_TOKEN** with **Contents: read** restricted to the app repository can be used instead; it falls back to the existing job token while source is public. Never paste credentials into chat, issues, workflow files or command arguments. Do not reuse a Cloudflare or broad personal token.

## Before the visibility change

1. Confirm the dedicated read-only source secret is present, then run the existing manual release using the pinned, reviewed app commit. Confirm SSH checkout, deployment and anonymous gate probes pass.
2. Confirm the account plan supports the desired branch protections for a private repository. GitHub Free protection and CodeQL availability can differ between public and private repositories. Do not purchase a plan or enable paid security features implicitly. Keep local/CI secret scanning, dependency auditing and browser tests available independently.
3. Confirm collaborators, GitHub App installations, native build workflows and local clone access. The app currently publishes `/docs` as its project Pages site; making it private on GitHub Free can unpublish that site. Publish the reviewed, data-free `/labinsight/` handoffs in this public homepage repository first. Nine files are copied byte-for-byte from the reviewed app `docs` snapshot, including the existing opt-in cleanup and cache-retirement scripts. No protected input forms, application code or health records are copied. Recheck the live legacy paths after the actual visibility change because the app's project Pages site takes precedence until it is unpublished.
4. Review the source/license publication policy. The current package metadata says MIT and there is no root LICENSE file; do not promise confidentiality or legal exclusivity based on repository settings alone.
5. Preserve the current deployment and immutable rollback pins. Change only the app repository's visibility after the owner approves the prepared transition.

### Free-plan tradeoffs

[GitHub's branch-protection documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches) limits private-repository branch protection to Pro or higher plans. On Free, making the app private therefore loses the platform enforcement of its current PR and required-check rules. Continuing to run CI and following a manual PR process does not provide equivalent enforcement.

[Private CodeQL scanning](https://docs.github.com/en/code-security/reference/code-scanning/troubleshoot-analysis-errors/private-repository-enablement) requires an eligible organization and GitHub Code Security; a personal Pro upgrade alone does not preserve hosted private CodeQL scanning. Gitleaks, package audits and browser tests remain separate checks. Review private Actions minutes, artifact storage and spending limits before a visibility change. Never enable a paid plan, paid security product or extra spend implicitly. Record account-specific security observations privately, not in this public repository.

## After the visibility change

Verify anonymous source access is denied, approved development tools still fetch, and the manual release still builds the exact app commit. Recheck homepage 200, Google login entry, protected HTML 303, protected JS/API 401 and the Pages handoffs. Keep the operator's 2FA/passkey and recovery codes under their own control; API results that omit 2FA status do not prove it is enabled.
