# Local scan history — unpublished Phase B candidate

This local development branch implements opt-in history for founder review. Phase B
is not advertised as merged or publicly available. Use Node 24 and the reviewed build.
No account, database, new dependency, telemetry or network connection is required.

## Explicit directory and project identity

History is disabled by default. There is no implicit home-directory location,
`--save-history` shortcut, persistent enablement flag, scheduler or Cloud sync.
Initialize a dedicated private directory (its parent must already exist):

```sh
node dist/index.js history init --directory ./my-history --json
```

The returned project UUID is an explicit grouping chosen by you, not proof of Git
identity or repository authenticity. One project belongs to each directory; use a
different initialized directory for another project. No target path or Git remote
is registered. Newly created directories use mode 0700, files mode 0600. Existing
directories must be empty, private, owned by your account and non-symlinked; Scanner
does not silently chmod existing locations. Use a non-synced private location.

Saving requires both flags on each manually initiated scan:

```sh
node dist/index.js scan ./my-project --history-dir ./my-history --project-id PROJECT_UUID
node dist/index.js scan ./my-project --history-dir ./my-history --project-id PROJECT_UUID --json --html ./new-live-report.html
```

No scanned source is executed or modified. The explicitly selected history location
may be inside a target, but a separate location is recommended. Init is separate;
scans never automatically initialize a directory. Existing terminal/JSON stdout is
unchanged. An explicit save prints `History saved: SCAN_UUID` to stderr; this receipt
is not an error or a compatibility verdict. Plain scans and HTML-only scans create
no history and retain existing stderr behavior.

## What is stored

An immutable `project.json` marker contains schema 1 and the random project UUID.
Each `<scan-uuid>.json` has independent saved-envelope schema 1: scan/project UUID,
local save timestamp, the privacy-filtered Phase A view with original scan timestamps,
Scanner version/build identity (or explicit unknown), catalog revision/fingerprint,
coverage/unknowns and structured integration/finding identities. Change-record and
client references are opaque SHA-256 hashes; references may change when source
positions/aliases change. No comparison is implemented or fix inferred.

There is no raw source, absolute target path, raw argv, environment value, client
variable name or credential field in generated records. Only the existing privacy
projection is retained; source/configuration values withheld by Phase A stay withheld.
Root-relative filenames and permitted version metadata can still be sensitive;
private inspection is required. Imported records are untrusted and strictly parsed;
schema validation is not a signature or evidence that Scanner genuinely produced a
file. Do not edit records or rely on them as current compatibility evidence.

## List and reopen without rescanning

```sh
node dist/index.js history list --directory ./my-history --json
node dist/index.js history list --directory ./my-history --html ./new-history-list.html
node dist/index.js history show SCAN_UUID --directory ./my-history --json
node dist/index.js history show SCAN_UUID --directory ./my-history --html ./new-historical-report.html
```

Listing shows scan dates, providers, attention/unknown counts, recorded completeness
and readability. JSON listing contains summaries; show JSON contains the full saved
privacy-filtered envelope. Missing/corrupt/unsafe records fail clearly; listing
reports corrupt record UUIDs and counts of unknown entries without exposing their
filenames or contents. Unknown/corrupt files remain untouched.

The static listing HTML is generated only to an explicit new destination. There
is no persistent index or automatically followed file link. Its reopen command is
a redacted equivalent; supply your own history location and a new HTML destination.
Reopened reports state **historical snapshot, not current compatibility**, preserve
original timestamps/catalog identity and do not require the original project or
current catalog. No automatic browser launch occurs. Open explicitly with Chrome
File → Open File. All HTML uses escaping, restrictive hashed-CSS CSP and no scripts,
external assets, telemetry or uploads. Manually following official documentation
links can leave a report, as in Phase A.

## Delete and prune: preview first

```sh
node dist/index.js history delete SCAN_UUID --directory ./my-history --json
node dist/index.js history delete SCAN_UUID --directory ./my-history --apply --json
node dist/index.js history prune --directory ./my-history --project-id PROJECT_UUID --keep-last 20 --older-than-days 90 --json
node dist/index.js history prune --directory ./my-history --project-id PROJECT_UUID --keep-last 20 --older-than-days 90 --apply --json
```

Without `--apply`, selected IDs are previewed and no records deleted. At least one
retention criterion is required; integers are 0–1,000,000. With both criteria, only
records older than the age threshold **and** outside the most recent N valid records
are selected. A single supplied criterion applies alone. Equal save timestamps use
UUID sorting; timestamps are local wall-clock values, not attested chronology.
Future timestamps fail pruning closed. Policies are not persisted or scheduled.

Apply revalidates current records, directory/file identity and content. Preview is
not a reservation across invocations. Only validated UUID files for the selected
project can be unlinked; arbitrary paths, wildcards, recursive deletion, symlinked/
hardlinked records and unknown/corrupt entries are never deletion targets. Output
reports selected, actually deleted and failed IDs; partial failures return 1. Local
unlink is not secure erasure or deletion from backups. The project marker is retained.

## Bounds, coordination and failure limits

Read limits: 32 MiB per record, 256 MiB total file sizes per directory listing/save,
10,000 directory entries, nesting 64 and 100,000 structured nodes. Strings are bounded
to 10,000 characters and arrays to 10,000 entries. Rendering/output remains capped at
32 MiB. There is no automatic eviction or paid scan quota. Ordinary scanning remains
available without history when a history budget is reached. Large directories may
require targeted deletion of a known valid UUID rather than a full listing.

Safe reads verify owner/permissions, regular files, single links, ancestor/path/opened
descriptor identity, size and timestamps before/after bounded UTF-8 reads. Strict
validation rejects duplicate/escaped-equivalent JSON keys, unsafe prototype keys,
unknown fields/schemas, malformed UUIDs/dates/statuses/URLs and inconsistent counts.
Corrupt or partial JSON is not promoted into findings. No target code or JSON is
executed; parsing is bounded but not a hard process CPU/heap sandbox.

Mutations use a fail-fast private `.history-lock` directory to coordinate cooperating
writers and enforce storage bounds. There are no retries or automatic stale-lock
deletions. If an interrupted process leaves a lock, stop and privately confirm no
writer is active and inspect the directory before manually removing that exact empty
lock directory. Do not automate recovery or delete arbitrary files. Listings report
busy/changed directories rather than claiming a consistent snapshot during writes.

Writes are exclusive, fsynced and checked; no overwrite is possible through the CLI.
An interrupted write can leave an incomplete UUID record, which later reads reject
and pruning leaves alone. No automatic cleanup is attempted. Init may leave a newly
created directory or marker if interrupted. A requested change may already have
occurred when later cleanup fails: inspect outcomes and the private directory before
retrying. Deletion receipts preserve actual successful IDs if a later unlink fails.

As with scanning/Phase A, portable Node path checks cannot eliminate hostile
concurrent ancestor replacement or guarantee atomic pathname deletion. Use stable,
private, owned directories, not attacker-controlled concurrent trees. Detection of
observed changes fails closed, but this is not an OS filesystem sandbox. Encryption
or secure erasure is not supplied; OS/disk protections and independent backups matter.

Combined HTML/history output is not an atomic multi-file transaction. All content is
prepared before writes; HTML is written first. If history subsequently fails, exit 1
states that HTML was saved and the record may be incomplete; no success JSON is emitted.
No earlier valid output is deleted to compensate. A full or invalid history directory
never causes silent deletion, guessing or a compatibility pass.

Local history is a free manual evidence feature. It adds no continuous monitoring,
refreshed provider intelligence, advanced impact analysis, repair, customer-patch
verification, GitHub repair PR, hosted/team sync, account or billing capability.
Cloud remains planned and unavailable. Phase C comparison requires separate work.
