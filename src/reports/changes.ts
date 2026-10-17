import type { ChangesReport } from '../types/changes.ts';

export function formatChangesJson(report: ChangesReport): string { return JSON.stringify(report, null, 2); }

export function formatChangesTerminal(report: ChangesReport, coverageOnly = false): string {
  return [
    'PatchWRK API Changes (offline catalog)',
    `Catalog version: ${report.catalogVersion}; provider: ${report.provider ?? 'all'}`,
    `Changes: ${report.changes.length}`,
    ...(report.catalogCoverage ? [
      `Catalog coverage: ${report.catalogCoverage.recordCount} curated records; no live monitoring`,
      `Sources retrieved: ${report.catalogCoverage.oldestRetrievalAt ?? 'unknown'} to ${report.catalogCoverage.newestRetrievalAt ?? 'unknown'}`,
      ...report.catalogCoverage.providers.map((provider) => `${provider.provider}: ${provider.records} records; last retrieved ${provider.lastRetrievedAt ?? 'unknown'}; reviewed ${provider.lastReviewedAt ?? 'unknown'}`),
    ] : []),
    ...(coverageOnly ? [] : report.changes).flatMap(({ record, classification }) => [
      `${record.provider} ${record.id}: ${JSON.stringify(record.title)}`,
      `  Classification: ${classification.category}; declared: ${classification.declaredCategory}; verification: ${classification.verificationStatus}`,
      `  Published: ${record.publicationDate ?? 'unknown'}; effective: ${record.effectiveDate ?? 'unknown'}; retirement: ${record.retirementDate ?? 'unknown'}`,
      `  Official source: ${JSON.stringify(record.officialSourceUrl ?? 'unknown')}`,
      ...record.provenance.sources.map((source) => `  Source reference: ${JSON.stringify(source.url)}`),
    ]),
    ...report.warnings.map((warning) => `Warning: ${warning}`),
  ].join('\n');
}
