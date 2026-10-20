import { createHash } from 'node:crypto';
import { scanWithCompatibility } from '../compatibility/index.ts';
import type { CompatibilityScanOptions } from '../compatibility/index.ts';
import { LocalChangeCatalog, validateCatalog } from '../changes/catalog.ts';
import { providers } from '../providers/index.ts';
import type { ReportMetadata } from '../types/reporting.ts';

declare const PATCHWRK_VERSION: string;
declare const PATCHWRK_BUILD: string;

/** Object keys are sorted recursively; array order is preserved after catalog validation. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function captureReportContext(directory: string, options: CompatibilityScanOptions) {
  const startedAt = new Date().toISOString();
  const catalog = validateCatalog(await (options.catalog ?? new LocalChangeCatalog()).load());
  // Metadata and assessments use exactly the same snapshot, even if disk changes.
  const scan = await scanWithCompatibility(directory, { ...options, catalog: { load: async () => catalog } });
  const finishedAt = new Date().toISOString();
  const metadata: ReportMetadata = {
    scannerVersion: typeof PATCHWRK_VERSION === 'undefined' ? null : PATCHWRK_VERSION,
    buildFingerprint: typeof PATCHWRK_BUILD === 'undefined' ? null : PATCHWRK_BUILD,
    catalogVersion: catalog.catalogVersion,
    catalogFingerprint: createHash('sha256').update(canonicalJson(catalog)).digest('hex'),
    catalogRecordCount: catalog.changes.length,
    providers: providers.map((provider) => ({ id: provider.id, name: provider.name, records: catalog.changes.filter((change) => change.provider === provider.id).length })),
    startedAt, finishedAt, generatedAt: new Date().toISOString(),
  };
  return { scan, metadata };
}
