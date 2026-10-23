# VS Code extension — publication pending

PatchWRK Scanner is a free experimental beta. The desktop extension is locally
tested, **not yet publicly available through Marketplace**. Publisher creation is
founder-observed; final publishing authority and release acceptance remain pending.
Final acceptance is incomplete: a rapid consecutive installed-test sequence lost
the active local-history association; investigation is pending. No release-ready
claim is made. Continue using the verified [no-build GitHub archive](../README.md#quick-start--run-a-scan).
There is no working Marketplace install badge or public extension download here.

## Tested local experience

Open an authorized local project → PatchWRK sidebar → Run Scan → View Report →
explicitly enable local history → save scans → reopen or compare saved evidence.
Reports open inside VS Code. No separate Scanner, Node installation, npm/pnpm or
compilation is required when the editor supplies the compatible embedded Node 24
runtime. Tested configuration: macOS arm64, VS Code 1.137.0. Other platforms,
Cursor and remote/virtual/web workspaces are not supported or certified by this test.
An unanswered Reports Only/history choice can appear in the notification bell.
History is opt-in and needs an approved private directory outside open projects.
Two saved scans are needed for comparison; report-only scans are not saved retroactively.

The bundled Scanner discovers supported Stripe, OpenAI, Anthropic, Shopify and
Twilio SDK evidence in JavaScript/TypeScript. Compatibility coverage is limited to
four historical Stripe/OpenAI catalog records. Unknown/no finding does not guarantee
compatibility or application health. Comparison does not prove repairs or lineage.

## Privacy and limits

Manual, offline, read-only scanning. No target code execution, dependency installation,
source upload, telemetry, continuous monitoring, automatic repair or mandatory
PatchWRK account. Editor/Marketplace services have their own network behavior.
Reports omit absolute paths, raw arguments and snippets; allowed filenames and
metadata may still be sensitive. History remains local, explicit and immutable.
Cancellation may leave files or locks; inspect before manually retrying. No automatic
retry, lock cleanup or deletion. Stable checkouts are required; filesystem guards
are not a sandbox against hostile concurrent changes.

See [security](../SECURITY.md), [beta feedback](../BETA_TESTING.md),
[history](SCANNER_HISTORY.md) and [report limitations](SCANNER_REPORTS.md).
Use sanitized [Issues](https://github.com/patchwrk-dev/patchwrk-scanner/issues)
or [Discussions](https://github.com/patchwrk-dev/patchwrk-scanner/discussions);
report vulnerabilities through the private process in SECURITY.md.

## Genuine screenshots — pending

Required release assets: actual installed sidebar, real report, History Dashboard,
and comparison, captured using approved synthetic fixtures and labeled as synthetic
demonstration data with genuine local execution. No fabricated screenshot or user
scan is substituted. Images will be added only after capture and founder approval.

## Planned PatchWRK Pro

PatchWRK Pro is a planned paid API maintenance agent: Monitor → Detect → Analyze →
Repair → Test → Approve, using official provider sources. These services are not
available in this extension. No current monitoring, AI repair, automatic migration
verification or repair pull request is advertised.

MIT attribution and the existing CLI distribution remain unchanged. Public engine
source is this repository; the unpublished extension adapter source has not been
exported here. A public adapter-source location is still a release decision.
