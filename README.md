# PatchWRK Scanner — experimental GitHub beta

PatchWRK Scanner finds static third-party SDK evidence in JavaScript and TypeScript.
It is **read-only and offline**: no API keys, telemetry, uploads, provider requests,
execution of scanned code, dependency installation in targets, repairs or monitoring.
The scanner source is public. No GitHub release asset or npm publication is announced here.
MIT licensed; Node.js **24** required. macOS/Ubuntu tested; Windows security unverified.

Use it before reviewing a dependency upgrade or investigating an integration: find
supported SDK evidence, inspect recorded versions and compare it with a small local
catalog. Findings guide review; they do not establish production breakage or health.

**Detection:** Stripe, OpenAI, Anthropic, Shopify and Twilio SDKs. **Compatibility
catalog:** four historical Stripe/OpenAI records; no curated changes for the other
three providers. Detection support does not imply complete API-change coverage.

[Install from source](#build-from-reviewed-public-source) · [First scan](#first-scan) ·
[Actual synthetic demo](#reproduce-a-synthetic-finding) · [HTML reports](#visual-html-reports) · [Feedback](FEEDBACK.md) ·
[Confidential security reporting](SECURITY.md)

## Build from reviewed public source

Obtain an exact reviewed commit from the public
[PatchWRK Scanner repository](https://github.com/patchwrk-dev/patchwrk-scanner).
Install Git, Node.js **24** and pnpm **11.25.0** first; verify `node --version`
and `pnpm --version`. If either is missing, use the official
[Node.js download instructions](https://nodejs.org/en/download) and
[pnpm installation instructions](https://pnpm.io/installation), selecting those versions.
The commands below assume a POSIX shell on macOS or Linux.

```sh
git clone https://github.com/patchwrk-dev/patchwrk-scanner.git
cd patchwrk-scanner
git rev-parse HEAD
```

Review the selected commit before installing. Inside that checkout:

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
node dist/index.js scan /absolute/path/to/authorized-checkout
node dist/index.js scan /absolute/path/to/authorized-checkout --json
node dist/index.js changes --coverage
```

These examples use the source build above. Once an approved offline archive is
available, substitute `node ./patchwrk-local/node_modules/patchwrk-scanner/dist/index.js`
from its installation directory. Replace the example path with your authorized
checkout; do not install dependencies or run scripts in that scan target.
Directory defaults to the working
directory; `--help` lists bounded scan/module options. Invalid input exits 1. A valid
report exits 0 **even with partial coverage or an affected finding**; exit status is
not a compatibility/security gate. Inspect `coverage.complete`, warnings and limits.

## Visual HTML reports

Generate a self-contained local dashboard alongside the existing terminal or JSON report:

```sh
node dist/index.js scan ./my-project --html ./report.html
node dist/index.js scan ./my-project --json --html ./report-json.html
```

Choose a **new `.html` file in an existing stable, non-symlink directory**. Existing
files are never overwritten, and no browser opens automatically. In Chrome, use
File → Open File to view the report. No server, account or network connection is needed.

The dashboard prioritizes existing findings, source references, uncertainty and
manual next steps. Expand technical details for full assessment evidence, coverage,
provenance and fingerprints. Attention counts Affected + Potential risk; Unknown is
shown separately and still requires review. Affected is historical applicability,
not proven runtime failure; no known finding is not a compatibility guarantee.
HTML omits absolute target/output paths, raw arguments and source snippets; review
remaining root-relative labels and metadata privately before sharing.

See [the report guide](docs/SCANNER_REPORTS.md) for status meanings, privacy, CSP,
output errors and residual filesystem/interrupted-write limits. Terminal/JSON output
and detection stay unchanged. HTML alone does not enable history; no comparison, monitoring or repair is added.

## Reproduce a synthetic finding

After the source build, run:

```sh
node scripts/demo.mjs
```

This copies the existing `openai-typescript-retired-model` benchmark fixture into
an isolated `.cache/` directory and scans it without installing its dependencies or
executing its code. Its synthetic manifest declares `openai: 4.0.0`; `index.ts:1`
initializes a client and references `text-davinci-003`. No credentials are needed.
The demo retains local raw reports; review paths before sharing them. The demo
script is available in source, not in the unpublished offline package.

Actual scanner-generated terminal excerpt (directory and other lines omitted):

```text
PatchWRK Scanner
Integrations: 1
openai (openai)
  Declared: "4.0.0"; resolved: "unknown" ("package.json", dependencies)
  "index.ts":1 client-initialization
  "index.ts":1 esm-import
Compatibility: 2 assessments (offline catalog 3)
openai (openai) "openai.gpt-4-0314.retirement": Not affected by this change
  Evidence level: supported-version-evidence; scope: documented-configuration-applicability
openai (openai) "openai.text-davinci-003.retirement": Affected
  Evidence level: supported-version-evidence; scope: documented-configuration-applicability
```

Actual JSON excerpt (selected assessment fields; not the full report):

```json
{
  "assessment": {
    "changeId": "openai.text-davinci-003.retirement",
    "status": "affected",
    "evidenceLevel": "supported-version-evidence",
    "scope": "documented-configuration-applicability",
    "unknowns": [
      "Remote API version is unknown; SDK versions do not establish it.",
      "Use of documented endpoints, methods, or symbols has not been established."
    ]
  }
}
```

The provider was detected, but the SDK's installed version remains unknown: a
manifest declaration is not an installation. `affected` means the observed model
matches this historical record, not that a running application was tested or found
broken. The other model record's non-applicability is not a health guarantee. Read
all coverage warnings, unknowns and limitations in the full report.

Common input errors exit 1 with guidance: a missing directory cannot be accessed;
`..` traversal is refused (use a direct path); unknown commands suggest `--help`.
Successful report generation exits 0 even when findings or incomplete coverage exist.

## Offline archive (not yet published)

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

Preparing to test the beta? Read the
[developer testing guide](https://github.com/patchwrk-dev/patchwrk-scanner/blob/main/BETA_TESTING.md)
for synthetic scenarios, optional feedback and participation boundaries.

[Feedback guidance](FEEDBACK.md) describes optional sanitized reports; source users
can use the bug, missing-provider and useful-finding templates in
[GitHub Issues](https://github.com/patchwrk-dev/patchwrk-scanner/issues/new/choose),
or contact support@patchwrk.dev.
Never submit raw private reports/source, credentials or personal paths. There is no
telemetry or automatic feedback upload. Sharing a report is voluntary and manual.

Use [SECURITY.md](SECURITY.md) for confidential vulnerabilities. GitHub private
vulnerability reporting is enabled; use the confidential reporting link in that
policy. Current v0.x support is best effort: no guaranteed
backports, response SLA or remediation dates. See [CONTRIBUTING.md](CONTRIBUTING.md)
and [PUBLIC_PROVENANCE.md](PUBLIC_PROVENANCE.md). Existing MIT ownership attribution
is preserved; this source snapshot does not claim to include all private history.

## Future vision: PatchWRK Cloud (planned)

**PatchWRK — The AI maintenance engineer for APIs.**

**Your APIs change. Your code stays ready.**

PatchWRK Cloud is planned around third-party API compatibility and maintenance:
API Discovery, API Change Intelligence, Code Impact Analysis, AI Repair,
Automated Verification, and GitHub Pull Requests. **Impact Intelligence** is the
intended differentiator: connecting reviewed API changes to code evidence and
explaining applicability, impact and uncertainty.

**Cloud is not available today.** Future API migration fixes would require isolated
verification and human review. No release dates or autonomous repair outcomes are
promised.

The available Scanner remains an offline, read-only experimental beta. It does not
continuously monitor services, generate repairs, execute scanned code or open pull
requests. Its supported patterns, limited catalog, uncertainty and security boundaries
above remain unchanged.

## Local history — unpublished Phase B candidate

This development branch adds explicit local history for review; Phase B is not yet
merged or advertised as publicly available. Plain scans and HTML-only scans still
create no history. Initialize a private directory, then supply its project UUID:

```sh
node dist/index.js history init --directory ./my-history --json
node dist/index.js scan ./my-project --history-dir ./my-history --project-id PROJECT_UUID
node dist/index.js history list --directory ./my-history --html ./new-history-list.html
node dist/index.js history show SCAN_UUID --directory ./my-history --html ./new-historical-report.html
node dist/index.js history delete SCAN_UUID --directory ./my-history
```

Deletion/pruning preview by default and require `--apply` to unlink records. No
automatic history, browser opening, rescanning, deletion, telemetry or Cloud sync.
[The history guide](docs/SCANNER_HISTORY.md) documents storage, bounds, strict parsing,
privacy, original evidence, age/keep-last selection and filesystem/interruption risks.
