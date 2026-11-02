# Hosted acceptance — local preparation, not executed

Initial candidate target: standard GitHub-hosted **ubuntu-24.04 / Linux x64**,
JavaScript Action **Node24**, existing public `patchwrk-dev/patchwrk-scanner`
repository. No larger/self-hosted runner, cache/artifact service, secret, npm install
or target-code build is required by the qualification job.

The first bounded gate is one **trusted producer-branch push** qualification job,
five-minute timeout. It tests the reviewed local Action from a checkout pinned to
that approved push SHA; this is not permission to use PR-local code for untrusted
input. The inactive workflow and trusted fixture helpers must undergo their own
exact public-file review before any commit/push. No workflow_dispatch is performed
or assumed available from a new non-default-branch workflow.

The existing public CI may also run on that push: two standard Linux/macOS jobs,
15-minute timeouts each. First-push total configured ceiling is therefore **35
runner-minutes**, not five. Standard hosted runners in a public repository are free
under GitHub's published billing policy; reverify visibility, labels and policy
before execution. No private included-compute balance or paid runner is assumed.
Do not modify budgets, upgrade or retry failed jobs automatically.

Required first-gate evidence:

1. Actual runner-selected Node24 executable/version, Linux/x64 and run/commit URL.
2. Real `uses:` execution, GitHub output/summary file handling, five-provider inert
   fixture, minimized JSON and status. No source/path/synthetic secret sentinel
   leaks; fixture hashes unchanged and execution canary absent.
3. Native CLI exit 0 complete, 2 genuine partial coverage, 1 invalid input/error.
   Expected negatives must be asserted by the trusted harness, not globally
   continue-on-error or accepted failures. No compatibility-health guarantee.
4. Worker deadline termination; no token passed into worker, target dependency
   install, target script/config execution, scan-time provider request or upload.
5. Check permissions: contents:read only, persisted checkout credentials false,
   submodules/LFS off, no secrets, deployments, comments or writes.

First gate alone does not establish remote SHA-pinned consumer invocation,
workflow_dispatch registration, genuine PR/fork policies, manual GitHub job
cancellation or private-repository behavior. Those require separately approved
bounded events using the then-known trusted Action SHA. Fork workflows use
pull_request, never pull_request_target or a local Action/harness from an untrusted
checkout. Do not execute tests/build scripts supplied by a PR. Respect GitHub fork
approval policies without changing repository settings. No private support claim
without private-hosted acceptance and current billing safeguards.

No prior released Action SHA exists for tested rollback. On failure, stop the
qualification; cancel only an approved test run if needed, and later disable/remove
only this new workflow through a separately approved change. Preserve existing CI,
monitoring, releases and evidence. Do not force-reset branches or delete resources
automatically. No release, mutable tag, Marketplace listing or broad support claim
follows from hosted tests; publication requires separate founder authorization.
