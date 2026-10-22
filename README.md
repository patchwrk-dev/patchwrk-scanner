# PatchWRK Scanner

Find third-party API/SDK integration evidence in JavaScript and TypeScript projects.
Review evidence-backed historical assessments, visual reports and saved scan differences.

**Free, MIT-licensed experimental beta.** Offline, read-only and manually initiated.
No account, API credentials, source upload, target code execution or automatic repair.

**Get PatchWRK → Run Scan → View Results → Review History → Compare Scans**

## Download prebuilt Scanner

**Requires Node.js 24 (`>=24 <25`)** — the archive includes compiled JavaScript and
runtime libraries, not Node itself. Select version 24 from the [official Node.js downloads](https://nodejs.org/en/download).
The CLI has macOS/Ubuntu test coverage; Windows security is **unverified**. Commands
below use a macOS/Linux POSIX shell with `curl` and `tar`.

[Download Scanner v0.1.0](https://github.com/patchwrk-dev/patchwrk-scanner/releases/download/v0.1.0/patchwrk-scanner-0.1.0.tgz) ·
[Download checksum](https://github.com/patchwrk-dev/patchwrk-scanner/releases/download/v0.1.0/patchwrk-scanner-0.1.0.tgz.sha256) ·
[Experimental prerelease notes](https://github.com/patchwrk-dev/patchwrk-scanner/releases/tag/v0.1.0)

Use the named `.tgz` release asset, **not** GitHub's automatic “Source code” archives.
No cloning, npm install, pnpm or TypeScript compilation is required. This is a
manual download/extraction workflow, not one-click installation. npm/Marketplace
installation is not offered by this project.

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
  installation, telemetry or uploads. Network is needed to download the archive only.
- Use stable checkouts/private output locations. Symlinks/hardlinks and credential
  paths are excluded; portable path checks are not a hostile-filesystem sandbox.
- HTML/history omit absolute target paths, raw arguments and source snippets, but
  filenames and allowed metadata can still be sensitive. Raw terminal/JSON reports
  may contain paths; review/sanitize before voluntarily sharing.
- Interrupted writes may leave files or locks. Inspect privately before retrying;
  never automate lock cleanup. Local records are validated, not authenticated.

MIT © 2026 Jovan Simon; [LICENSE](LICENSE) and [ownership provenance](PUBLIC_PROVENANCE.md)
remain intact. The archive includes third-party licenses/notices. For confidential
vulnerabilities use [SECURITY.md](SECURITY.md), not public issues. Best-effort beta
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
and [beta testing guide](BETA_TESTING.md).

Free Scanner offers manual discovery, historical assessments, terminal/JSON/HTML,
opt-in local history and manual comparison. **PatchWRK Cloud is planned and unavailable.**
There is no continuous monitoring, automatic provider-change intelligence, AI repair,
automated migration verification, automatic GitHub PRs or Cloud-hosted dashboards.

## VS Code extension — upcoming, not publicly available

Planned public installation experience: search **PatchWRK Scanner** in VS Code
Extensions → Install → open a project → click the PatchWRK icon → Run Scan → review
reports, history and comparisons. This is **not a current installation method**.
Use the verified GitHub archive above until an extension is published and verified.
No Marketplace badge or install link is provided. [Required genuine screenshot assets](docs/SCANNER_REPORTS.md#screenshot-assets--pending-approval)
are documented; no approved captures are available in this update.

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
and experimental limitations remain unchanged. See [CONTRIBUTING.md](CONTRIBUTING.md).
