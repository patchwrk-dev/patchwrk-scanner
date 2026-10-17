# Security policy — PatchWRK Scanner experimental beta

Current v0.x experimental versions have best-effort support only. No guaranteed
backports, response times or remediation dates. No third-party audit/certification
or production compatibility guarantee is claimed.

GitHub private vulnerability reporting is **enabled** for this public repository.
Use [Report a vulnerability](https://github.com/patchwrk-dev/patchwrk-scanner/security/advisories/new)
to submit a confidential report with version/hash, platform, impact and a minimal
synthetic reproduction. Do not put security findings in public issues.

Alternatively, contact **security@patchwrk.dev**. Inbound Cloudflare forwarding was
founder-verified; it is not end-to-end encrypted. First agree a secure transfer method
for sensitive details. Never attach credentials, private source or raw scan reports
to either reporting channel.

Scanner execution is offline/read-only. It does not execute target code, install
its dependencies, load repository config, upload contents or fetch provider changes.
Hidden/credential paths, generated dependencies, symlinks and hardlinks are excluded;
resource and AST budgets disclose partial coverage. Portable filesystem checks do not
isolate hostile concurrent mutation or impose hard parser CPU/memory limits. Scan a
stable checkout, using OS-level isolation when required. Windows is unverified.

Reports omit credential fields/source excerpts, but filenames, identifiers and
allowed metadata may themselves be sensitive. Review/sanitize before voluntary sharing.
An empty report, exit 0 or narrow non-applicability never establishes repository health.
Third-party source/dependency advisories must be reviewed before each release.

This repository contains scanner dependencies only. The existing private
website's development dependencies are not included; exclusion is not remediation
of any private-repository alert. Do not test third-party systems without permission.
