# PatchWRK Scanner

**Free API Compatibility Scanner — available now.**
Find third-party API/SDK integration evidence in JavaScript and TypeScript projects.
Review evidence-backed historical assessments, visual reports and saved scan differences.

The **Scanner engine is open source under MIT**. Scans are offline, read-only and manually initiated.
No account, API credentials, source upload, target code execution or automatic repair.

**Get PatchWRK → Run Scan → View Results → Review History → Compare Scans**

## Install for VS Code — recommended

[**Install for VS Code**](https://marketplace.visualstudio.com/items?itemName=PatchWRK.patchwrk-scanner-local)

The public extension is **PatchWRK: API Compatibility Scanner**,
published by **PatchWRK**, extension ID `PatchWRK.patchwrk-scanner-local`.
It uses the normal release channel with no Marketplace Preview designation.

| Platform | Marketplace target | Public version |
| --- | --- | --- |
| Linux x64 | `linux-x64` | 0.2.6 |
| macOS Intel x64 | `darwin-x64` | 0.2.6 |
| macOS Apple Silicon | `darwin-arm64` | 0.2.5 |

Requires VS Code **1.137.0+** with embedded **Node.js major 24**. A separate
system Node installation does not replace the extension-host runtime requirement.
Windows is not yet supported; no Windows package is offered.
Cursor, Linux ARM64 and Alpine are unverified.
Remote, virtual and web workspaces are unsupported.

Linux x64 and macOS Intel passed native automated installed-editor acceptance
on Ubuntu 24.04.5 x64 and macOS 15.7.9 x64 respectively, with VS Code 1.143.1
and embedded Node 24.21.0. This covers activation, synthetic scans, reports,
consented local history, restart persistence, comparison and security checks;
it does not establish compatibility with every OS/editor version. Separate human
graphical/native-folder-picker review was not performed for these two platforms.
macOS Apple Silicon retains the previously founder-verified v0.2.5 release.

Choose Install on the Marketplace page, open an authorized stable local project,
then click the PatchWRK icon → **Run Scan** → **Reports Only** for a first report.
No clone, npm/pnpm, compilation, separate Scanner or separate Node installation is
needed for a compatible extension host. Enable optional history only after reviewing
and confirming its private directory outside all open projects. Two saved scans are
needed to compare; reports-only scans are not saved retroactively.

[Extension guide and privacy limits](docs/VSCODE_EXTENSION.md).
This repository publishes the Scanner engine; a public source location for the
VS Code extension adapter has not been verified. MIT licensing alone does not
establish that all extension source is publicly hosted.
The verified standalone CLI remains available below; its version is independent of
the extension version. PatchWRK Pro is an upcoming paid API maintenance platform, not yet available.

## Download prebuilt Scanner

**Requires Node.js 24 (`>=24 <25`)** — the archive includes compiled JavaScript and
runtime libraries, not Node itself. Select version 24 from the [official Node.js downloads](https://nodejs.org/en/download).
The CLI has macOS/Ubuntu test coverage; Windows security is **unverified**. Commands
below use a macOS/Linux POSIX shell with `curl` and `tar`.

[Download Scanner v0.1.0](https://github.com/patchwrk-dev/patchwrk-scanner/releases/download/v0.1.0/patchwrk-scanner-0.1.0.tgz) ·
[Download checksum](https://github.com/patchwrk-dev/patchwrk-scanner/releases/download/v0.1.0/patchwrk-scanner-0.1.0.tgz.sha256) ·
[CLI v0.1.0 prerelease notes](https://github.com/patchwrk-dev/patchwrk-scanner/releases/tag/v0.1.0)

Use the named `.tgz` release asset, **not** GitHub's automatic “Source code” archives.
No cloning, npm install, pnpm or TypeScript compilation is required. This is a
manual download/extraction workflow, not one-click installation. npm installation is not offered. VS Code users can use the Marketplace link above.

In a new directory, download both assets (or save them using the links above):

```sh
mkdir patchwrk-scanner-beta && cd patchwrk-scanner-beta
node --version  # must show v24.x
curl -fLO https://github.com/patchwrk-dev/patchwrk-scanner/releases/download/v0.1.0/patchwrk-scanner-0.1.0.tgz
curl -fLO https://github.com/patchwrk-dev/patchwrk-scanner/releases/download/v0.1.0/patchwrk-scanner-0.1.0.tgz.sha256
```

Verify before extracting. On macOS:

```sh
shasum -a 256 -c patchwrk-scanner-0.1.0.tgz.sha256
```

On Linux, use `sha256sum -c patchwrk-scanner-0.1.0.tgz.sha256` instead.
Expected archive SHA-256:

```text
af240d14973c8416bb18bcd6b75ed8cad3e4404598f1663d88987f7f2665132d
```

**Stop on a checksum mismatch.** A checksum proves matching bytes, not publisher
identity if both the asset and expected checksum are compromised. Use trusted release
evidence. Extract only into a new destination; do not overwrite an installation:

```sh
mkdir scanner
tar -xzf patchwrk-scanner-0.1.0.tgz -C scanner
node scanner/package/dist/index.js --help
```

## Quick Start — run a scan

Stay in `patchwrk-scanner-beta` for the following commands. Replace the example
project path with a stable checkout you own or are authorized to inspect. Quote
paths containing spaces; do not scan filesystem roots or use `..` traversal.

```sh
node scanner/package/dist/index.js scan /absolute/path/to/project
node scanner/package/dist/index.js scan /absolute/path/to/project --json
```

Terminal and JSON results separate observed evidence, declarations and unknowns.
Exit 0 means the report was generated, **not** that the application is compatible or
healthy. Affected, unknown and partial-coverage findings can all return 0. Invalid
commands/paths return 1 with guidance. Do not install or run anything in the target.

## Visual Reports

Generate an optional self-contained HTML dashboard:

```sh
node scanner/package/dist/index.js scan /absolute/path/to/project --html ./report.html
```

Open `report.html` yourself using Chrome **File → Open File** (or your browser's file
opener). On macOS, `open ./report.html` uses your default browser. Scanner never opens
it automatically. Choose a **new** `.html` destination in an existing stable directory;
existing reports are never overwritten.

Inspect findings, file/line references, recorded scope, uncertainty and expandable
technical evidence. “Affected” describes applicability to a historical catalog record,
not a tested runtime failure. There is no overall health score. See the
[report and privacy guide](docs/SCANNER_REPORTS.md).

## Local Scan History

History is **off by default**. Initialize a separate private directory outside your
project; its parent must exist. Keep it non-synced and owned by your account:

```sh
node scanner/package/dist/index.js history init --directory ./history --json
```

Copy the returned `projectId` into `PROJECT_UUID` below. Saving requires **both flags
on every scan**; there is no persistent enablement flag or automatic history creation:

```sh
node scanner/package/dist/index.js scan /absolute/path/to/project --history-dir ./history --project-id PROJECT_UUID
```

Run that command again manually when you want another snapshot. For a comparison,
you need two saved scans; a previous reports-only scan is not saved retroactively.
List the saved IDs and generate a history dashboard:

```sh
node scanner/package/dist/index.js history list --directory ./history --json
node scanner/package/dist/index.js history list --directory ./history --html ./history.html
node scanner/package/dist/index.js history show SCAN_UUID --directory ./history --html ./historical-report.html
```

Replace `SCAN_UUID` with an actual listed ID. Open the HTML files manually as above.
Reopening reads the immutable saved evidence without rescanning. Snapshots retain
original timestamps/catalog identity; they are **not live compatibility information**.
Deletion previews by default and requires explicit `--apply`; no automatic retention
or deletion. See the [history guide](docs/SCANNER_HISTORY.md).

## Compare Scans

Choose two IDs from the same initialized history directory:

```sh
node scanner/package/dist/index.js history compare BEFORE_SCAN_UUID AFTER_SCAN_UUID --directory ./history --html ./comparison.html
```

Open `comparison.html` manually. The CLI respects **argument order**: select the
older original scan as BEFORE and the newer as AFTER. It does not reorder your IDs.
Comparison neither modifies snapshots nor rescans or repairs source. Clock order,
missing findings and reduced uncertainty do not prove source lineage or improvement.
Terminal/`--json` output is also available; [comparison limits](docs/SCANNER_HISTORY.md#local-comparison)
remain explicit.

## Supported API providers

| SDK discovery | Compatibility catalog |
| --- | --- |
| Stripe, OpenAI | Four narrow historical records in total |
| Anthropic, Shopify, Twilio | Discovery supported; no curated compatibility changes |

Supported discovery does not mean comprehensive coverage. No live provider changes
are fetched during scans. Review each record's sources/dates and unknowns; an old
migration recommendation may itself be outdated.

## Security and privacy

- Offline, read-only target scanning: no provider calls, source execution, dependency
  installation, telemetry or uploads. Downloads and editor/Marketplace services have their own network behavior.
- Use stable checkouts/private output locations. Symlinks/hardlinks and credential
  paths are excluded; portable path checks are not a hostile-filesystem sandbox.
- HTML/history omit absolute target paths, raw arguments and source snippets, but
  filenames and allowed metadata can still be sensitive. Raw terminal/JSON reports
  may contain paths; review/sanitize before voluntarily sharing.
- Interrupted writes may leave files or locks. Inspect privately before retrying;
  never automate lock cleanup. Local records are validated, not authenticated.

MIT © 2026 Jovan Simon; [LICENSE](LICENSE) and [ownership provenance](PUBLIC_PROVENANCE.md)
remain intact. The archive includes third-party licenses/notices. For confidential
vulnerabilities use [SECURITY.md](SECURITY.md), not public issues. Best-effort
support, no SLA. [Issues](https://github.com/patchwrk-dev/patchwrk-scanner/issues/new/choose),
[questions](https://github.com/patchwrk-dev/patchwrk-scanner/discussions) and
[sanitized feedback](FEEDBACK.md) use existing GitHub channels; no automatic collection.

## Known limitations

Static analysis can miss dynamic imports, wrappers, ambiguous links and unresolved
runtime configuration. Manifest/lockfile evidence does not prove deployed versions;
SDK and remote API versions are separate. Only reliable npm lockfile v2/v3 direct
entries establish recorded resolution; pnpm/Yarn/Bun locks remain unsupported.
Traversal/AST budgets may yield partial results and are not hard parser CPU/heap
isolation. Empty or unknown results are not compatibility passes. Read the
[detailed discovery/assessment limits](docs/SCANNER_REPORTS.md#detection-and-compatibility-limits)
and [developer onboarding guide](BETA_TESTING.md).

Free Scanner offers manual discovery, historical assessments, terminal/JSON/HTML,
opt-in local history and manual comparison. **PatchWRK Pro is an upcoming paid API maintenance platform, not yet available.**
Official provider monitoring, impact analysis, AI-assisted repairs, scoped testing and
developer-approved pull requests are planned.
There is no continuous monitoring, automatic provider-change intelligence, AI repair,
automated migration verification, automatic GitHub PRs or Cloud-hosted dashboards.

## Build from reviewed public source

**Contributors only; not required to use the prebuilt Scanner.** Install Git,
Node.js **24** and pnpm **11.25.0** ([pnpm installation](https://pnpm.io/installation)).
Review the chosen public source commit before installing maintainer dependencies:

```sh
git clone https://github.com/patchwrk-dev/patchwrk-scanner.git
cd patchwrk-scanner
git rev-parse HEAD
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
node dist/index.js --help
```

Source setup may download build dependencies. Do not run these commands in the
scan target or enable lifecycle scripts indiscriminately. The ordinary npm dry-run
package is not the self-contained GitHub bundle. Package privacy, license, security
and technical limitations remain unchanged. See [CONTRIBUTING.md](CONTRIBUTING.md).
