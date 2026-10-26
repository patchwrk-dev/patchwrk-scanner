# VS Code extension — PatchWRK Scanner

Free API Compatibility Scanner for supported third-party API integrations and evidence-backed compatibility reports.
The Scanner engine is open source under MIT.

Inspect supported integration evidence, review historical
compatibility findings and keep manual scan results locally. No PatchWRK
account, API credentials, separate Scanner installation or source compilation needed.

Available publicly in the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=PatchWRK.patchwrk-scanner-local)
as **PatchWRK: API Compatibility Scanner**, published by **PatchWRK**
(extension ID `PatchWRK.patchwrk-scanner-local`). Available for **macOS Apple Silicon (`darwin-arm64`)**
on the normal release channel. Current public version: **0.2.5**, with no Marketplace Preview designation.

## What you can do

- Start a genuine manual scan with **Run Scan** in the PatchWRK sidebar.
- Discover supported Stripe, OpenAI, Anthropic, Shopify and Twilio SDK evidence.
- Review evidence-backed assessments from a small offline catalog: four historical
  Stripe/OpenAI records, not comprehensive or continuously updated API coverage.
- Open **Visual HTML Reports** with source references, uncertainty and expandable evidence.
- Explicitly enable **Local Scan History**, then save and reopen privacy-filtered snapshots.
- **Compare Scans** to review recorded differences without rescanning or editing snapshots.

There is no overall health score. Unknown or absent findings do not establish
compatibility; an affected finding is not production runtime verification.

## Install and run

Verified configuration: **VS Code 1.137.0 on macOS arm64**, with its embedded
**Node.js 24** extension host. The manifest minimum is 1.137.0; a compatible Node 24
host is also required. Other editor versions, operating systems and Cursor have not
been certified. Remote, virtual and web workspaces are unsupported.

1. Open [Install for VS Code](https://marketplace.visualstudio.com/items?itemName=PatchWRK.patchwrk-scanner-local)
   and choose **Install**, or find the exact extension ID in VS Code Extensions.
   Confirm publisher **PatchWRK**. No clone, npm/pnpm installation or build step.
   For a separately supplied, reviewed VSIX, use Extensions → … → **Install from VSIX**.
2. Open a stable, authorized local JavaScript/TypeScript project. Trust only a project
   you are authorized to inspect. Click the official PatchWRK **P** in the Activity Bar.
3. Click **Run Scan**. Choose **Reports Only** for the simplest first scan, or explicitly
   enable local history. Find an unanswered choice in VS Code's notification bell.
4. Review the real report and its limitations. **Latest Report** reopens it without rescanning.

Scans run only when explicitly requested. No source/configuration code is executed,
target dependencies installed, source uploaded, provider requests made, or telemetry
collected by PatchWRK. Editor/Marketplace services have their own network behavior.

## History and comparison

Enabling history requires selecting an existing parent **outside all open projects**
and confirming the exact new private directory. Only then is a project UUID created.
Both directory and project UUID are supplied to the existing Scanner. A reports-only
scan is not saved retroactively. No implicit home storage or Cloud synchronization.

Run two explicitly saved scans, then open **Scan History** or a recent record to
reopen saved evidence. Compare Scans asks for two records, orders them by validated
original UTC timestamps, and passes older → newer to Scanner. Equal timestamps use
ascending UUID order, disclosed in title/status; invalid metadata refuses comparison.
Time order does not prove source lineage, an improvement or a repair. Records are immutable.

The approved directory/project association persists in local editor state across
restarts. Reopening the sidebar may read opted-in saved records; it does not start
a scan or silently initialize replacement storage. Missing/invalid retained storage
is refused. This is not a new cross-window coordination or crash-safety guarantee.
New scan reports use Free Scanner branding. Existing saved HTML and recorded notices
can retain historical wording; reopening does not rewrite original snapshots.
Different Scanner/build/catalog fingerprints or partial coverage can make comparison
inconclusive; fewer findings do not prove a repair.

Choose **Configure Local History** for guided setup. It explains optional local
snapshots and opens VS Code’s native folder picker. Select an existing parent
folder, or create one in the picker where your operating system supports it.
The final confirmation shows both the chosen parent and the dedicated new history
subfolder where future successful scans will be saved. Choose **Create History**
only after reviewing that exact path; Cancel leaves the association unchanged.
You never create snapshot files manually. No Cloud account or source upload.

Configure Local History also lets you **Disable History** without deleting saved
snapshots or forgetting the approved location. Reports Only scans then save no new
snapshots; existing History and Compare remain available. To resume saving, choose
**Enable History** and confirm the retained directory. It must still be accessible,
private and associated with the original project; missing storage is not recreated.
Native picker new-folder controls vary by platform; no custom folder-creation UI
or automatic scan is added. Interrupted initialization can leave a directory; inspect
it rather than automatically retrying or moving storage.

Delete Snapshot previews the selected record and requires explicit modal confirmation.
No automatic deletion, retention scheduler or secure-erasure claim.

## Privacy and safety

Target scanning is offline and read-only. HTML omits absolute target/output paths,
raw arguments and source snippets. Filenames, identifiers, timestamps and approved
metadata can still be sensitive: review reports and snapshots privately before sharing.
See [Privacy and safety](#privacy-and-safety), [Support](#support) and the [Scanner security policy](https://github.com/patchwrk-dev/patchwrk-scanner/blob/main/SECURITY.md).

Reports open in script-disabled panels with restrictive CSP and an extension-only
contrast correction for readable dark text on branded light surfaces. Saved HTML
and findings stay unchanged. The sidebar uses only a small local, nonce-authorized
script with restricted messages; no external fonts/assets or network bridge.

Cancel operation safely abandons pending choices or terminates the active worker.
An old editor notification may remain visible: dismiss it; late answers cannot start
work. Cancellation may leave a completed/incomplete report, snapshot or lock. Inspect
storage before manually retrying. No automatic retry, overwrite or lock cleanup.

Portable filesystem checks require stable checkouts and do not sandbox hostile
concurrent mutation. Parser budgets are not hard CPU isolation. Local snapshots are
validated, not authenticated. Full independent screen-reader and runtime network
observation are not certified. Support is best effort with no SLA.

## Scanner and Pro boundaries

These are free local Scanner capabilities. PatchWRK Pro is an upcoming paid API maintenance platform and is not yet available. Its intended
workflow is Monitor → Detect → Analyze → Repair → Test → Approve; none of those
planned maintenance services is activated by this extension.
This extension does not add automatic API monitoring, proactive alerts, advanced
Impact Intelligence, AI repairs, automatic migrations, automated verification, developer-approved repair pull requests, hosted history, authentication or billing.

[Bundled Scanner source](https://github.com/patchwrk-dev/patchwrk-scanner) ·
[Scanner CLI — GitHub Releases](https://github.com/patchwrk-dev/patchwrk-scanner/releases/tag/v0.1.0) ·
[Issues](https://github.com/patchwrk-dev/patchwrk-scanner/issues) ·
[Questions](https://github.com/patchwrk-dev/patchwrk-scanner/discussions)

The public repository contains the Scanner engine. A public source location for
the VS Code extension adapter has not been verified; do not infer complete
extension source availability from the engine link or MIT licensing.

The extension includes reviewed report-presentation inputs beyond the standalone
CLI v0.1.0 source/archive baseline. Bundled PUBLIC_PROVENANCE identifies those
inputs; no single public source commit containing every current adapter/reporting
input is claimed. Extension and CLI versions and release channels are independent.

## Support

Report sanitized bugs through [GitHub Issues](https://github.com/patchwrk-dev/patchwrk-scanner/issues/new/choose), ask questions in [Discussions](https://github.com/patchwrk-dev/patchwrk-scanner/discussions), and report vulnerabilities through the [private security process](https://github.com/patchwrk-dev/patchwrk-scanner/security/advisories/new) or security@patchwrk.dev. Never post credentials, private source or raw sensitive reports. Best effort, no SLA.

MIT © 2026 Jovan Simon. See the [MIT license](https://github.com/patchwrk-dev/patchwrk-scanner/blob/main/LICENSE), included third-party notices
and bundled library licenses. The bundled Scanner includes the reviewed reporting refinements described in the
included CHANGELOG.md; the separately published CLI v0.1.0 archive remains a distinct
distribution. Extension and CLI version numbers are independent.
