import type { ChangeCatalogRepository, ChangesReport } from '../types/changes.ts';
import { LocalChangeCatalog, validateCatalog } from './catalog.ts';
import { classifyChange } from './classification.ts';
import { parseProvider } from './validation.ts';
import { providerIds } from '../types/changes.ts';

export async function listChanges(repository: ChangeCatalogRepository = new LocalChangeCatalog(), provider?: string): Promise<ChangesReport> {
  const filter = provider === undefined ? null : parseProvider(provider);
  const catalog = validateCatalog(await repository.load());
  return {
    schemaVersion: 1, status: 'offline-catalog', catalogVersion: catalog.catalogVersion,
    provider: filter,
    catalogCoverage: {
      recordCount: catalog.changes.length, liveMonitoring: false,
      providers: providerIds.map((provider) => {
        const records = catalog.changes.filter((change) => change.provider === provider);
        const retrieved = records.flatMap((change) => change.provenance.sources.map((source) => source.retrievedAt)).filter((value): value is string => value !== null).sort();
        const reviewed = records.map((change) => change.lastReviewedAt).filter((value): value is string => value !== null).sort();
        return { provider, records: records.length, lastRetrievedAt: retrieved.at(-1) ?? null, lastReviewedAt: reviewed.at(-1) ?? null };
      }),
      oldestRetrievalAt: catalog.changes.flatMap((change) => change.provenance.sources.map((source) => source.retrievedAt)).filter((value): value is string => value !== null).sort().at(0) ?? null,
      newestRetrievalAt: catalog.changes.flatMap((change) => change.provenance.sources.map((source) => source.retrievedAt)).filter((value): value is string => value !== null).sort().at(-1) ?? null,
    },
    changes: catalog.changes.filter((change) => filter === null || change.provider === filter)
      .map((record) => ({ record, classification: classifyChange(record) })),
    warnings: [
      'Local offline catalog; no live retrieval or continuous updates.',
      'Verification metadata is a human attestation, not proof of source authenticity.',
      'No compatibility-risk conclusions are produced.',
      ...(catalog.changes.some((change) => change.verification.status !== 'verified') ? ['Catalog includes unverified or illustrative records.'] : []),
    ],
  };
}
