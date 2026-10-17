# Scanner beta release checklist

The scanner source repository is public and GitHub private vulnerability reporting
is enabled. Source visibility does not authorize a GitHub release asset or npm
publication. For each future release, record exact scope, reviewer, date, source
commit and archive checksum. The review items below are not assertions that every
operational acceptance check has passed. Keep the package private.

- [ ] Founder approves separate public repository name/account/organization and access.
- [ ] Founder approves public copyright/author/historical credit, commit identity,
      profile linkage and provenance. Existing private repository/history remain intact.
- [ ] Review every PUBLIC_FILES.json path/hash and final generated commit diff;
      no private website, infrastructure, operator tools, internal docs, credentials,
      logs, source maps, caches, databases, Git history or unrelated source included.
- [ ] MIT is byte-for-byte unchanged; author credit and bundled third-party notices
      preserved. No ownership transfer or new contributor agreement is implied.
- [ ] Review four-record catalog sources, exact scopes, review identity/dates and
      uncertainties. Approve narrow beta claims; no monitoring/repair/health guarantees.
- [ ] Scanner advisories rechecked, clean frozen-lockfile source install verified,
      lint/typecheck/tests/build/benchmark/package checks and offline bundle installation
      passed for the exact release tree. Document skipped/unsupported platforms.
- [ ] Human tests macOS/Ubuntu first-run and sanitized feedback workflow; Windows
      remains unverified until exercised. Do not invent tester participation.
- [ ] Confidential email handling/replies and backup responder verified. GitHub private
      reporting is enabled; verify its availability and confidential handling for each release.
- [ ] Review pinned least-privilege scanner-only CI, actual job names and required
      branch checks; verify enforcement/bypasses on the chosen account plan.
- [ ] Replace all candidate/pending URL wording only with approved actual release
      details. Source/license visibility approval is separate from release asset approval.
- [ ] Founder explicitly authorizes exact source publication, initial commit identity,
      repository visibility and any GitHub tag/release asset as separate scoped actions.
- [ ] Preserve original private history and private review/approval evidence. Never
      copy the private .git directory or rewrite attribution to meet this checklist.

After publication only: verify public contents, links, issue/reporting intake and
release checksum. Any unexpected sensitive disclosure stops distribution and enters
private incident handling; deletion cannot undo prior copies. Public source
availability does not establish a published release or successful
operational acceptance; verify current merge protection rather than assuming it.
