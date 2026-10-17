# PatchWRK Scanner — experimental GitHub beta candidate

PatchWRK Scanner finds static third-party SDK evidence in JavaScript and TypeScript.
It is **read-only and offline**: no API keys, telemetry, uploads, provider requests,
execution of scanned code, dependency installation in targets, repairs or monitoring.
This is a local release candidate; no public repository or release is announced here.
MIT licensed; Node.js **24** required. macOS/Ubuntu tested; Windows security unverified.

## Install a reviewed offline archive

Use only a maintainer-approved GitHub release asset after publication is separately
authorized. No release URL exists yet. Do not use `npx patchwrk` or a registry/global
install: the npm name is unpublished by this project. Verify the archive SHA-256
against the separately authenticated maintainer value before installing.

```sh
node --version
# macOS; Linux can use sha256sum instead
shasum -a 256 patchwrk-scanner-0.1.0.tgz
npm install --offline --ignore-scripts --no-audit --no-fund --package-lock=false --no-save --prefix ./patchwrk-local ./patchwrk-scanner-0.1.0.tgz
node ./patchwrk-local/node_modules/patchwrk-scanner/dist/index.js --help
```

The archive bundles its runtime libraries and license notices. Empty-cache installation
needs no registry or GitHub access once obtained. A checksum alone does not prove
publisher identity unless its expected value came from a trusted source. Verify the
approved release version/checksum; do not silently replace delivered archives.

## Build from reviewed public source

After a separately approved source publication, obtain its exact reviewed commit
from the maintainer's public repository (name/URL still pending founder approval).
Inside that scanner checkout, use Node 24 and pnpm 11.25.0:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
node dist/index.js --help
node dist/index.js changes --coverage --json
```

Source installation downloads trusted tool/runtime dependencies unless cached;
normal scanning never uses the network. Build tooling may require its platform
binary; resolve failures through the reviewed esbuild policy rather than enabling
all lifecycle scripts. The ordinary six-file npm dry-run package has external runtime
dependencies; use the separate bundled beta archive for offline first-run.
The manifest stays `private: true`; GitHub source/asset distribution does not authorize npm.

## First scan

Choose a stable checkout you own or are authorized to inspect. Use an absolute path
or a relative path without `..`; quote spaces. Never scan filesystem roots or an
actively changing hostile tree. No target build, install, configuration or scripts
need to run.

```sh
node ./patchwrk-local/node_modules/patchwrk-scanner/dist/index.js scan /absolute/path/to/authorized-checkout
node ./patchwrk-local/node_modules/patchwrk-scanner/dist/index.js scan /absolute/path/to/authorized-checkout --json
node ./patchwrk-local/node_modules/patchwrk-scanner/dist/index.js changes --coverage
```

For source builds, substitute `node dist/index.js`. Directory defaults to the working
directory; `--help` lists bounded scan/module options. Invalid input exits 1. A valid
report exits 0 **even with partial coverage or an affected finding**; exit status is
not a compatibility/security gate. Inspect `coverage.complete`, warnings and limits.

## Supported evidence and limitations

Supported SDK identities: Stripe (`stripe`), OpenAI (`openai`), Anthropic
(`@anthropic-ai/sdk`), Shopify (`@shopify/shopify-api`) and Twilio (`twilio`).
Literal imports/requires, direct clients, simple exports/re-exports and bounded
static links are supported. Dynamic imports, factories, runtime injection, aliases,
ambiguous modules and complex wrappers can be missed or uncertain. Hidden,
credential, generated, dependency, vendor and fixture paths are excluded. Symlinks
and hardlinks are skipped. Node filesystem checks are not a hostile-filesystem sandbox.

Only reliable same-directory npm lockfile v2/v3 direct entries establish recorded
exact SDK resolution. pnpm/Yarn/Bun/workspace locks remain unsupported. Manifest
declarations do not prove installed versions; resolved lockfile metadata does not
prove deployed runtime. SDK and remote API versions are separate. Stripe account/
SDK defaults remain unresolved; exact observed overrides are scoped. Model configuration
is supported only on recognized OpenAI request paths; image/Assistants and dynamic
models can remain unknown. No source configuration is executed or evaluated.

Reports use scanner schema 2, compatibility schema 1 and module-analysis schema 1.
Terminal output summarizes; JSON preserves scoped facts, declarations, inference,
source URLs, exact change IDs, uncertainty, coverage and limitations. `affected`
means conditional applicability to a specific catalog record, not actual breakage;
`not-affected-by-this-change` is not overall health. Review `unknown` and
`potentially-affected` rather than treating them as passes.

Catalog revision 3 has four narrow historical records: Stripe SDK 8 request-option
rename, exact SDK 12 constructor-alias removal, and OpenAI text-davinci-003 / gpt-4-0314
retirements. Other announcements are not continuously retrieved. Three supported
providers have no curated changes. Read each record's evidence/date and migration
limits; an old recommended replacement can itself retire. No production compatibility
or comprehensive security guarantee is made.

Two pinned public provider samples detected 2/2 expected provider/repository pairs,
with 1/3 lockfile-resolved declarations. This convenience sample is not population
accuracy evidence. Twelve synthetic fixtures measured 100% precision/87.5% recall,
including known misses; those are different measurements. Parser CPU/memory are not
hard bounded by AST limits; use external OS isolation/resource limits when required.

## Feedback, support and security

[Feedback guidance](FEEDBACK.md) describes optional sanitized reports; source users
can use the prepared bug, missing-provider and useful-finding templates once Issues
are enabled on the approved public repository. Until then use support@patchwrk.dev.
Never submit raw private reports/source, credentials or personal paths. There is no
telemetry or automatic feedback upload. Sharing a report is voluntary and manual.

Use [SECURITY.md](SECURITY.md) for confidential vulnerabilities. GitHub private
reporting is not assumed enabled. Current v0.x support is best effort: no guaranteed
backports, response SLA or remediation dates. See [CONTRIBUTING.md](CONTRIBUTING.md)
and [PUBLIC_PROVENANCE.md](PUBLIC_PROVENANCE.md). Existing MIT ownership attribution
is preserved; this source snapshot does not claim to include all private history.
