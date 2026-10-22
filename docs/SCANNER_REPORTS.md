# Local HTML reports

Generate an optional self-contained report from a reviewed Scanner build. Use Node
24 and the existing Scanner dependencies. No account or API key is needed.

```sh
node dist/index.js scan ./my-project --html ./report.html
node dist/index.js scan ./my-project --json --html ./report-with-json.html
```

The destination must be a **new `.html` file in an existing stable non-symlink
directory**. Use an absolute or direct relative path without `..`; quote spaces.
No directory is created automatically. The CLI never opens a browser. To preview,
use Chrome's File → Open File (Command-O on macOS) and select the report. No server
or website publication is necessary.

Scanning remains offline and read-only. Only the explicitly selected report file
is created; prefer a private location outside the target. An explicitly selected
HTML location inside the target is allowed after scanning finishes. Source,
manifests, lockfiles and configuration are not modified. With `--json --html`,
stdout retains the existing schema-2 JSON without artifact metadata or messages.
Without `--json`, stdout retains the existing terminal report.

## Read the result

The dashboard uses Overview → Findings → Recommended actions →
Detected integrations → Technical details. Overview shows files, integrations,
assessments requiring attention and unknown counts. **Attention** counts existing
Affected + Potential risk assessments; Unknown is a separate count and still needs
review. These are recorded assessment counts, not incidents or a health score.
Affected is red, potential risk amber, unknown and scoped exclusions neutral. Green
is used only for “Report generated,” never compatibility.

Finding cards keep their status, source references, important uncertainty and
relevant manual actions visible. Full existing assessment evidence and provenance
remain in native keyboard-operable `<details>` disclosures. Fingerprints, timestamps,
resource ceilings, full scope and long limitations are under Technical details.
Critical scan warnings and coverage/truncation indicators remain visible without
expansion. Before printing, expand the evidence sections you need and inspect print
preview; behavior in an actual browser still requires manual acceptance.

Supported
source/manifest references and declaration versus recorded SDK evidence explain
what was found. Historical records show status, category, evidence scope, version/
configuration evaluation, official documentation and recorded manual review dates.

| Label | Meaning |
| --- | --- |
| Affected | Conditional applicability to this documented historical record; not confirmed runtime failure. A record can be nonbreaking. |
| Potential risk | Existing `potentially-affected` evidence: incomplete, conflicting or conditional. No new severity classification. |
| Unknown | Insufficient evidence; not a pass. |
| Not affected by this change | Exclusion from this specific change, not overall compatibility. |
| No known finding within supported coverage | No matched assessment for a detected integration, with complete recorded coverage; limited catalog scope still applies. Partial coverage is labeled unknown instead. |

Investigate source locations, actual installed/deployed versions and dynamic
configuration. Review historical official guidance and check that a suggested
replacement is still appropriate before choosing and manually testing a migration.
Scanner generated no patch and verified no repair. Exit 0 means report generation
succeeded, including unknown, affected or partial findings; it is not a release gate.

## Privacy and output safety

HTML intentionally omits absolute target/output paths, raw arguments, source
snippets, client variable names, configuration values and user-supplied API-version
values. The invocation is labeled **redacted equivalent**, not an exact command.
Unsafe source labels and quoted warning details are withheld with an omission
notice. Root-relative source labels and permitted numeric SDK versions can still
be sensitive; inspect privately before sharing. This is a minimized projection,
not a complete JSON export or an assurance that arbitrary filenames are secret-free.
Normal terminal/JSON output retains its existing sensitive-data caveats.

All displayed text is escaped. CSS is embedded with a SHA-256 CSP; scripts, images,
fonts, forms and automatic network requests are prohibited. Source locations are
inert text. Validated official documentation links leave the local report only if
you follow them manually. Generating HTML alone does not save history or compare scans.
No telemetry, upload or browser storage is added. Explicit opt-in history and local
comparison are available in the experimental Scanner beta and described in
[the history guide](SCANNER_HISTORY.md).

Existing destinations, including symlinks/hardlinks/directories, are refused. Files
are created exclusively with mode 0600, descriptor/ancestor identity checks and
fsync. No overwrite flag exists. Portable Node filesystem checks cannot eliminate
hostile concurrent ancestor replacement. Use a stable private directory. A failed
or interrupted write can leave an incomplete file, including an empty file created
through an ancestor swapped during creation; the CLI reports failure and does not
delete a potentially replaced path. Inspect privately and choose a new filename.
This is no-clobber creation, not crash-atomic publication or filesystem sandboxing.

Requested artifact failure exits 1 with stderr and no success stdout. Rendering
limits are 32 MiB for input string content/output, nesting 64 and 100,000 structured
nodes. Oversized optional reports fail explicitly rather than hiding findings;
ordinary terminal/JSON functionality and existing scan budgets remain available.

## Metadata and scope

Trusted builds embed package version and a SHA-256 fingerprint of Scanner source,
catalog, lock/package metadata and build configuration/tool inputs. The fingerprint
identifies build inputs, not the final executable bytes, authenticity or proof of a
detection-algorithm change. Source execution reports unknown version/build identity.
Finding references hash the provider/package/change and original static client ID
and manifest scope; they are deterministic for unchanged evidence, not durable
cross-scan client identities. Line/alias changes may change them. Generating a report
does not compare scans or detect fixes; the separate
[local comparison command](SCANNER_HISTORY.md#local-comparison) preserves matching
uncertainties and never proves a fix.
Scan start/finish and HTML generation timestamps are local UTC wall-clock values,
not externally attested ordering. The catalog fingerprint hashes the same validated
snapshot used by assessments, with recursively sorted object keys and preserved
normalized array order. Catalog revision remains separate from schema version.

Discovery supports selected Stripe, OpenAI, Anthropic, Shopify and Twilio JS/TS SDK
patterns. The bundled catalog contains four historical Stripe/OpenAI records, not
continuous intelligence. Unknown runtime behavior, unsupported patterns, unresolved
defaults, graph/assessment/display limits and static filesystem limitations remain.
Read-only local visual explanation is a free Scanner feature. Continuous provider
monitoring, advanced Impact Intelligence, AI repairs, customer-patch verification
and GitHub repair PRs remain planned Cloud capabilities and are unavailable.

## Detection and compatibility limits


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


## Screenshot assets — pending approval

No approved editor screenshots are included in this documentation update. Do not substitute stock imagery, reconstructed interfaces or fabricated findings. Required captures:

| View | Required genuine evidence |
| --- | --- |
| PatchWRK sidebar | Official icon, actual project/readiness and actions |
| Run Scan | Real action and scan completion; no artificial delay or staged spinner |
| API Compatibility Report | Actual findings, source references and uncertainty |
| Scan History | Real opted-in snapshots with original timestamps and historical notices |
| Compare Scans | Actual saved pair, direction, recorded changes and uncertainty |

Label each caption **Synthetic demonstration fixture; genuine local Scanner execution** where applicable. Record extension/Scanner versions, artifact checksum, fixture provenance, capture date and any crop/redaction. Exclude private paths, credentials and unrelated windows. Use only founder-approved images captured from the actual installed interface. The VS Code extension is not yet publicly available; screenshots must not imply Marketplace installation exists.
