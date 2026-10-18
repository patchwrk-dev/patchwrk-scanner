# Optional developer feedback

Use the [GitHub issue forms](https://github.com/patchwrk-dev/patchwrk-scanner/issues/new/choose)
for non-sensitive feedback, or contact support@patchwrk.dev. Feedback is voluntary;
the scanner has no telemetry, automatic uploads or participant enrollment.

1. Confirm permission to scan the target; start with a stable non-sensitive checkout.
2. Record scanner version/archive hash, Node/OS, command flags, expected behavior,
   coverage/analysis completeness and warnings. Replace personal/absolute paths.
3. Reproduce with a minimal locally authored inert snippet, manifest and synthetic
   lock metadata when relevant. Include expected versus actual provider/change ID,
   status and evidence. Never supply runnable private source or real API keys.
4. Classify feedback: installation problem, false positive, missed integration,
   unsupported pattern, incorrect/version-resolution gap, missing provider,
   compatibility-assessment problem, feature request, unclear guidance or useful finding.
5. Review/redact before manually sharing. Public issues are permanently observable;
   do not assume a private report is harmless because credentials were omitted.

For useful findings, share what action/understanding changed and which uncertainty
remained; don't claim observed production breakage from static findings alone.
For missing providers, include official SDK/docs URLs and synthetic expected patterns,
not a private repository. Maintainers triage reproducibility/scope, request sanitized
clarification and track decisions without demanding raw reports or personal details.

Security issue? Stop public submission and use security@patchwrk.dev as described in
[SECURITY.md](SECURITY.md). No confidential content in issue titles or attachments.
Maintainers should remove accidental disclosures promptly through provider procedures;
removal cannot undo copies. No response SLA or new retention policy is asserted.

Use the bug form for installation, detection, version and compatibility problems;
the provider form for a new SDK; and the feature form for a scoped improvement.
For installation problems include the failing command, Node/pnpm/OS versions and
sanitized error text. Never attach an unreviewed install log, environment variables
or raw reports. For assessment problems include the exact change ID, expected scope,
actual status and relevant official source. No account or API credential is needed.

## Beta testing feedback template

For the first voluntary round, follow the
[testing guide](https://github.com/patchwrk-dev/patchwrk-scanner/blob/main/BETA_TESTING.md).
This is a prepared template, not a request to collect feedback before the founder
opens the round. Post overall feedback in General Discussions; use the existing
Issue forms for actionable bugs, provider requests or features, and Q&A for questions.
All answers are optional. Use only sanitized, invented examples; public GitHub posts
and profile identities are visible to others. Never attach raw sensitive reports.

```text
Scanner commit/version, Node/pnpm and OS (optional; no personal paths):
1. Was installation successful? If not, which command and sanitized error?
2. Which supported providers were present (names only; no repository/customer identity)?
3. Did the scanner identify the expected integrations?
4. Were findings incorrect or missing? Include a synthetic example and change ID if relevant.
5. Were results and uncertainty understandable?
6. Would you use PatchWRK again? Why or why not?
7. What improvement would provide the most value?
```

Do not provide API keys, credentials, private source, real customer data or repository
access. For confidential vulnerabilities use [SECURITY.md](SECURITY.md) instead.
