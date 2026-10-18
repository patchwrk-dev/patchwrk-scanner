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
