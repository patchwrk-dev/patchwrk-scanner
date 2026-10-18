# Contributing to PatchWRK Scanner

This is an experimental public beta. Use the
[scanner repository](https://github.com/patchwrk-dev/patchwrk-scanner) for contributions.

Use Node 24/pnpm 11.25.0 and a trusted source checkout. Run frozen-lockfile install
with scripts disabled, then lint, typecheck, test, build, benchmark and package checks.
Changes must preserve read-only/offline behavior, schema versions, strict runtime
validation, tenant-independent scanner logic and partial-coverage disclosure.
Never execute scanned code, install target dependencies or upload source.

Discuss broad work before implementation. Use a fork/branch and
PR explaining the concrete problem, behavior, focused synthetic tests and limits.
Do not submit build artifacts, secrets, private reports or unrelated project source.
No change authorizes publishing, deploying, billing or production credential use.

Provider definitions need authoritative SDK evidence. Catalog records need exact
provider-controlled sources, identifiers/version scope, dates, a named actual reviewer
and uncertainty. Synthetic fixtures are illustrative, not verified announcements.
Do not invent compatibility conclusions or silently improve benchmark labels.
Keep SDK declarations, lockfile evidence, remote versions and runtime behavior separate.

Dependency changes need demonstrated need, reviewed frozen lockfile/advisories and
appropriate regression/security checks. Do not add install/publish lifecycle hooks.
The existing esbuild build policy/override requires review, not unrestricted script
execution. Package inventories are allowlists, not broad globs.

Use [FEEDBACK.md](FEEDBACK.md) and prepared issue forms for non-sensitive reports;
use [SECURITY.md](SECURITY.md) for vulnerabilities. Preserve MIT ownership and third-party
notices. Contributions follow existing license terms; no CLA or legal agreement is
invented here. Support is best effort with no guaranteed response or backports.

CI verifies Ubuntu 24.04 and `macos-latest` with Node 24. Ubuntu is pinned to avoid
an unreviewed OS change when `ubuntu-latest` migrates. The Linux check deliberately
keeps the name `verify (ubuntu-latest)` so existing required checks remain valid;
its actual runner is `ubuntu-24.04`. Keep those check names stable unless repository
owners separately coordinate a ruleset update. Actions are pinned to reviewed full
commit SHAs with Node 24 runtimes; preserve read-only workflow permissions and
`persist-credentials: false`.
