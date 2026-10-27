# Product health monitoring

Two proposed workflows become scheduled only after founder-approved merge into main. No release, deployment, dependency-update or settings writes are permitted. Both use `contents: read`, pinned actions and disposable Ubuntu 24.04 runners with Node 24. No secrets, external notification services, customer source or telemetry are needed.

| Workflow | Schedule (America/Chicago) | Timeout |
| --- | --- | --- |
| Product public availability | `7,37 * * * *` — minutes 7 and 37 hourly | 5 minutes |
| Scheduled Scanner regression | `23 3 * * *` — daily 03:23 | 15 minutes |

Both also permit manual `workflow_dispatch`; neither introduces a push or PR trigger. Existing required CI checks remain unchanged. Scheduled runs use the default branch; schedules may be delayed, dropped or disabled after public-repository inactivity. Timezones observe daylight saving time. See [GitHub schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

First execution cannot have an exact date until the merge time is known: availability is the next local :07 or :37 after merge/registration; regression is the next local 03:23. For example, a merge on October 27, 2026 at 14:00 CDT targets October 27 at 14:07 CDT (19:07 UTC) and October 28 at 03:23 CDT (08:23 UTC). These are expected slots, not execution guarantees.

## Public availability

The dependency-free probe checks homepage, documentation, privacy, security, the official Marketplace installation page and Gallery platform metadata. Expected normal-channel platforms are Linux x64 v0.2.6, macOS Intel x64 v0.2.6 and macOS Apple Silicon ARM64 v0.2.5. Windows remains unsupported. The official installation link is https://marketplace.visualstudio.com/items?itemName=PatchWRK.patchwrk-scanner-local.

The honest descriptive monitoring user-agent avoids the default urllib filtering previously observed as Cloudflare 1010. A 403 remains ACCESS_BLOCKED and fails the job for investigation; it is not asserted to be an outage or treated as healthy. Confirm another legitimate client/vantage before declaring downtime. Genuine HTTP failures, invalid/missing content or identity/platform drift are never silently healthy. Historical prerelease records do not change the current normal-channel classification.

Requests use fixed public HTTPS endpoints, bounded responses/timeouts/retries and same-origin redirects only. The Gallery query is read-only. No response bodies or raw exceptions appear in summaries. The job summary contains safe per-check classifications; every non-PASS causes a failed run. This is single-vantage availability/content monitoring, not an uptime SLA or installed-editor acceptance.

## Regression coverage and boundaries

Daily regression uses the frozen lockfile with install scripts disabled, then lint, typecheck, Scanner tests, benchmark, build, package checks and synthetic public candidate verification. Outputs are disposable runner files; no packages are published or uploaded. It does not modify dependencies or execute customer projects.

The two separately reviewed extension-source and installed-editor templates remain deferred. They require private source/provenance and approved native-runner prerequisites; they are not part of this public PR. Daily source/package tests do not establish genuine installed-extension or graphical acceptance. Existing supported-platform evidence remains unchanged.

## GitHub-native failure reporting and operator procedure

A nonzero exit produces a failed Actions run; availability results appear in its job summary. No issues, mail, webhooks or repository mutations are performed. Configure GitHub Actions web/email failure notifications in the responsible user's existing GitHub account. Scheduled notification ownership follows the workflow/cron actor, so confirm the actual recipient after merge rather than assuming every watcher is notified. See [GitHub notifications](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs).

Founder is the proposed primary; a backup and delivery verification remain required. No 24/7 response guarantee is established. After approved merge, inspect a manual run and two scheduled availability runs, then the first daily regression. Verify notification delivery using a separately approved benign failure test, not a real production outage or secret. Notification preferences and delivery have not been tested by this PR.

Review daily for missing availability heartbeat over 90 minutes and regression heartbeat over 26 hours. Human/calendar review is required because a disabled monitor cannot alert on itself. Review existing CodeQL analyses, Dependabot errors and security alerts through authorized GitHub views; they are not copied into public health summaries.

Credible integrity/privacy exposure is P0. Independently confirmed outage or genuine required security regression is P1 and blocks affected release. Single-client filtering, queued infrastructure jobs, updater errors or missed heartbeat are P2 investigation items. Cosmetic drift is P3. Preserve evidence and route incidents to the founder; never bypass required checks or automatically deploy/withdraw releases.

## Activation and cost

Merge requires separate founder approval and green existing required CI. No custom schedule runs from this PR branch. Dispatch after merge, verify expected slots/results and owner delivery, and record evidence. Keep CodeQL, Dependabot, secret protection and branch rules unchanged. Standard public hosted runners require no new paid service; no paid runner or new credential is introduced. Approximately 1,440 availability starts per 30 days plus 30 daily regression starts are expected, before manual runs/retries. Task 096 recovery, ownership and complete platform monitoring requirements remain outstanding.
