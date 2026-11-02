# PatchWRK Free Scanner Action — local candidate, not published

Read-only offline JS/TS API SDK discovery and four historical Stripe/OpenAI
compatibility records. Five-family discovery includes Anthropic, Shopify and
Twilio, without catalog coverage for those three. No live provider monitoring,
AI repairs, automatic pull requests or compatibility/production-health guarantee.

## Status and installation

Local implementation only. Initial support target is **GitHub-hosted Ubuntu/Linux
x64, Node 24 action runtime**, pending hosted acceptance. macOS local unit tests
with injected host values are not Linux/hosted qualification. Windows, ARM64,
self-hosted runners, containers, GHES and other runner configurations are not
qualified. The VS Code releases remain independently accepted and unchanged.

After founder-approved publication, pin the Action by exact reviewed public SHA:
`patchwrk-dev/patchwrk-scanner/action@FULL_REVIEWED_ACTION_COMMIT_SHA`.
That placeholder is not runnable or a released version. GitHub Marketplace listing
is not required for SHA-pinned use and is not prepared/authorized here.

[Manual/push workflow template](examples/manual-push.yml.example) and
[PR template](examples/pull-request.yml.example) are inactive examples. Keep the
reviewed checkout pin, `permissions: contents: read`, `persist-credentials: false`,
submodules/LFS disabled, and GitHub-hosted isolated runner. Do not pass secrets or
use `pull_request_target`. Never use a local Action or install/build code from an
untrusted PR as part of this scan. For PR runs, the default checkout merge ref is
the scanned tree; a report is not a claim about a different head/base commit.

## Contract

Input `path`: relative subdirectory inside `GITHUB_WORKSPACE`, default `.`. No
absolute paths, `..`, backslashes, symlink traversal or arbitrary command/options.
Scanner default budgets stay fixed. Worker deadline is 75 seconds, heap limit
512 MiB; workflow example timeout is five minutes. Caller may need more time for
checkout/platform startup. Node worker has empty environment and no inherited
Node arguments. No target scripts, dependency install, config execution or network
transport occurs during scanning. Scanning requires an otherwise stable checkout;
it is not a sandbox against another hostile concurrently running job/process.

Terminal: human-readable completion/discovery/status counts on stderr and one
privacy-minimized JSON result on stdout. Action outputs `status` and `result`
(single-line JSON), plus a minimized job summary. JSON contains fixed provider
counts, catalog version, engine source commit, per-change status/count and coverage
flags. No filenames, paths, source text, API keys, package declaration strings or
raw diagnostics. The Action-specific schema is version 1; existing Scanner schema
2 and assessment semantics are unchanged. Repeated client assessments are grouped
by provider/change/status, with their count preserved. This is a findings summary,
not a source-level triage report. To inspect source locations use the local Scanner.

Exit status: **0** completed scan (including findings/unknown assessments), **2**
partial coverage, **1** runtime/input/worker/output failure. A failed scan does not
publish a report/health conclusion. A partial scan publishes clearly marked data
and fails the step. Unknown version evidence can exist in a completed static scan;
completion does not mean compatibility. Consumers must not turn absence of
findings into an automatic safety claim. Cancellation ends the action/worker;
report destinations are runner command files outside the workspace. No persistent
history, report cache or automatic artifact upload is added.

GitHub checkout already places source on a GitHub runner. The engine makes no
additional source upload to PatchWRK or providers; this is not “source never leaves
your laptop.” GitHub retains job logs/summary under its repository policies;
public run output can be public. No telemetry SDK, external API or token input.
The caller's checkout needs contents read; the Action itself does not call GitHub
or need token access. GitHub creates job contexts/credentials independently; a
workflow author must not grant elevated permissions or use secrets with untrusted
input. Do not use a shared/self-hosted runner to claim fork isolation.

## Build and tests

The pinned engine snapshot is in `engine-source.json` (public commit
8fa08313e65b4d313460936e606d2f3f92979c16). Build verifies every pinned file and rejects
extra engine TypeScript modules. It fails on the dirty private source tree.
Locally the reviewed public tree is isolated at `.cache/three-platform-action`:

```sh
PATCHWRK_ENGINE_SOURCE=.cache/three-platform-action node action/scripts/build.mjs
node --test action/test/*.test.mjs
```

For a future public source checkout with that reviewed engine content the default
source root is its repository root. Tooling uses the existing tsup/esbuild and
TypeScript/semver dependencies; no consumer install. `dist/worker.mjs` bundles
TypeScript and semver; only Node builtins remain external. The upstream optional
source-map-support debugging hook is replaced with an inert hook so no optional
module can resolve from the target. No scan rule or security assertion is changed.
License notices accompany distribution. Preserve `dist/manifest.json`, engine pins
and build recipe as one review unit. A bundle/hash beside itself is not independent
trust: consumer trust comes from the reviewed immutable Action commit. Never claim
adjacent hashes authenticate a mutable download.

Before any commit/push, review the exact public-only file list and explicit bundled
output exception. No private extension/operational source may enter that PR. Hosted
qualification, audits and founder publication approval remain required.

## Support and rollback

Sanitized bugs: https://github.com/patchwrk-dev/patchwrk-scanner/issues
Private vulnerabilities: https://github.com/patchwrk-dev/patchwrk-scanner/security/advisories/new
or security@patchwrk.dev. Do not share private source, credentials or raw reports.
Founder owns best-effort triage. Consumer rollback is pinning an approved previous
SHA or disabling/removing this one job; do not mutate unrelated workflows, grant
permissions or create repair PRs. No prior Action release exists to claim as a
verified rollback version. Initial recovery is disabling the new scan job.
