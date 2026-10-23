# Security policy

Use GitHub **Security → Report a vulnerability**, or the published operator contact jleegenomics@gmail.com, for confidential reports. Never put credentials, real member data or health reports in public issues or test artifacts.

The public homepage and GitHub Pages handoffs must remain public. Protected REPODAM input, report and application scripts are bundled behind the approval Worker; never copy them into the public Pages source. Retain existing immutable release pins, synthetic approval tests and post-deployment checks.

Third-party improvements require review of licensing, maintenance, security and necessity. Pin approved dependencies and Actions, keep required notices, and preserve LABDAM/REPODAM identity and colors. Dependency update PRs must pass the existing checks; they must not merge or deploy automatically.

See `docs/private-source-readiness.md` for the app source's planned private transition. Do not change this homepage repository to private as part of that transition.
