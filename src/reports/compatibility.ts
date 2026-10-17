import type { CompatibilitySummary } from '../types/compatibility.ts';

const labels = {
  affected: 'Affected', 'potentially-affected': 'Potentially affected',
  'not-affected-by-this-change': 'Not affected by this change', unknown: 'Unknown',
};

export function formatCompatibilityTerminal(summary: CompatibilitySummary): string {
  return [
    `Compatibility: ${summary.assessments.length} assessments (offline catalog ${summary.catalogVersion})`,
    `Compatibility coverage: ${summary.coverage.complete ? 'supported candidates displayed' : 'partial scan, assessment, or evidence display coverage'}`,
    ...summary.apiVersionDeclarations.map((input) => `User-declared API version: ${input.provider}=${JSON.stringify(input.version)} (not runtime verified)`),
    ...summary.assessments.flatMap((assessment) => [
      `${assessment.provider} (${assessment.packageName}) ${JSON.stringify(assessment.changeId)}: ${labels[assessment.status]}`,
      `  Evidence level: ${assessment.evidenceLevel}; scope: ${assessment.scope}`,
      ...(assessment.client ? [
        `  Original client: ${JSON.stringify(assessment.client.definition.file)}:${assessment.client.definition.line}`,
        `  Resolved manifest: ${JSON.stringify(assessment.client.manifestResolution.manifest)} (${assessment.client.manifestResolution.status}, ${assessment.client.manifestResolution.basis})`,
        ...assessment.client.limitations.map((limitation) => `  Client limitation: ${limitation}`),
      ] : []),
      `  Official source: ${JSON.stringify(assessment.officialSourceUrl ?? 'unknown')}`,
      `  Source verification: ${assessment.verification.status}; provenance: ${assessment.provenance.kind}; reviewed: ${JSON.stringify(assessment.lastReviewedAt)}`,
      ...assessment.configurationEvidence.map((evidence) => `  Observed source configuration: ${JSON.stringify(evidence.file)}:${evidence.line} ${evidence.scope} ${evidence.kind}; ${evidence.status} ${JSON.stringify(evidence.value)}`),
      ...assessment.configurationEvaluation.rationale.map((reason) => `  Configuration comparison: ${JSON.stringify(reason)}`),
      ...assessment.provenance.sources.map((source) => `  Source provenance: ${JSON.stringify(source.url)}; retrieved: ${JSON.stringify(source.retrievedAt)}`),
      ...assessment.facts.sdkDeclarations.map((evidence) => `  Observed SDK metadata: ${JSON.stringify(evidence.file)} ${evidence.section}; declared ${JSON.stringify(evidence.version)}; recorded ${JSON.stringify(evidence.resolvedVersion)}`),
      ...assessment.locations.map((location) => `  Observed location: ${JSON.stringify(location.file)}:${location.line} ${location.type}`),
      ...assessment.inferred.rationale.map((reason) => `  Inferred comparison: ${JSON.stringify(reason)}`),
      ...assessment.unknowns.map((unknown) => `  Unknown: ${JSON.stringify(unknown)}`),
      ...assessment.limitations.map((limitation) => `  Limitation: ${limitation}`),
    ]),
    ...summary.warnings.map((warning) => `Warning: ${warning}`),
    ...summary.limitations.map((limitation) => `Limitation: ${limitation}`),
  ].join('\n');
}
