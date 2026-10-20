import { createHash } from 'node:crypto';
import { validateSavedScan } from '../history/validation.ts';
import { canonicalJson } from '../reports/context.ts';
import { maxHtmlBytes } from '../artifacts/filesystem.ts';
import type { SavedScan } from '../types/history.ts';
import type { ReportBlock } from '../types/reporting.ts';
import type { ScanComparison, ComparisonContext, AssessmentEvidence, AssessmentComparison } from '../types/comparison.ts';

const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const rows = (block: ReportBlock, label: string) => block.rows.filter((row) => row.label === label).map((row) => row.value);
const ordered = (values: unknown[]) => values.map(canonicalJson).sort();
const section = (record: SavedScan, kind: 'scope' | 'integrations' | 'findings' | 'limitations') => record.snapshot.sections.find((s) => s.kind === kind)!.blocks;
const budget = (record: SavedScan) => ordered(section(record, 'scope').flatMap((b) => b.rows.filter((r) => /^(?:Scan|Module|Assessment) budget:/u.test(r.label))));
function context(record: SavedScan): ComparisonContext {
  return { scanId: record.scanId, projectId: record.projectId, savedAt: record.savedAt, envelopeSchema: record.schemaVersion,
    projectionSchema: record.snapshot.schemaVersion, metadata: record.snapshot.metadata, complete: record.snapshot.complete,
    coverage: record.snapshot.coverage, scope: section(record, 'scope'), notices: record.snapshot.notices,
    limitations: section(record, 'limitations'), integrations: record.identities.integrations.length, assessments: record.identities.findings.length };
}
function evidenceFingerprint(blocks: ReportBlock[]): string {
  return digest(ordered(blocks.map((b) => ({ rows: b.rows.filter((r) => !['Finding reference', 'Existing machine status'].includes(r.label)),
    notes: [...b.notes].sort(), finding: b.finding ? { ...b.finding, actions: [...b.finding.actions].sort(), references: [...b.finding.references].sort(), moreReferences: b.finding.moreReferences, uncertainty: [...b.finding.uncertainty].sort() } : null }))));
}
function assessments(record: SavedScan): Map<string, AssessmentEvidence[]> {
  const blocks = new Map<string, ReportBlock>();
  for (const block of section(record, 'findings').filter((b) => b.finding)) {
    const references = rows(block, 'Finding reference');
    if (references.length !== 1 || blocks.has(references[0]!)) throw new Error('Comparison requires unambiguous saved finding references.');
    blocks.set(references[0]!, block);
  }
  const groups = new Map<string, AssessmentEvidence[]>();
  for (const identity of record.identities.findings) {
    const evidence = blocks.get(identity.reference)!;
    const definition = rows(evidence, 'Original client definition'); const manifest = rows(evidence, 'Definition manifest');
    // Positional hashes are not persistent identities. Require corroborating unique saved scope.
    const clientScope = identity.clientReference === null && definition.length === 0 ? ['integration-fallback']
      : identity.clientReference !== null && definition.length === 1 && manifest.length === 1 && ![...definition, ...manifest].some((v) => /withheld|unknown/iu.test(v))
        ? [identity.clientReference, definition[0], manifest[0]] : ['unmatchable', record.scanId, identity.reference];
    const key = canonicalJson([identity.provider, identity.packageName, identity.changeId, identity.scope, identity.category, clientScope]);
    const group = groups.get(key) ?? []; group.push({ identity, evidence }); groups.set(key, group);
  }
  for (const group of groups.values()) group.sort((a, b) => a.identity.reference < b.identity.reference ? -1 : a.identity.reference > b.identity.reference ? 1 : 0);
  return groups;
}

/** Pure bounded comparison of validated schema-1 records. Never reads targets or current catalog. */
export function compareSavedScans(beforeInput: SavedScan, afterInput: SavedScan): ScanComparison {
  const before = validateSavedScan(beforeInput); const after = validateSavedScan(afterInput);
  if (before.projectId !== after.projectId) throw new Error('Comparison requires the same explicit project UUID; cross-project comparison is unsupported.');
  const warnings: string[] = [];
  const bm = before.snapshot.metadata; const am = after.snapshot.metadata;
  if (before.scanId === after.scanId) warnings.push('The same saved scan was selected twice; this is not evidence of a separate manual scan.');
  if (Date.parse(bm.startedAt) >= Date.parse(am.startedAt)) warnings.push('Original timestamps are equal or reversed; command position defines before/after and arguments were not reordered.');
  if (Date.parse(before.savedAt) >= Date.parse(after.savedAt)) warnings.push('Save timestamps are equal or reversed; wall clocks do not prove scan chronology.');
  if (!bm.scannerVersion || !am.scannerVersion || !bm.buildFingerprint || !am.buildFingerprint) warnings.push('Scanner version/build identity is unknown; detection context comparability is inconclusive.');
  if (bm.scannerVersion !== am.scannerVersion || bm.buildFingerprint !== am.buildFingerprint) warnings.push('Scanner version or build fingerprint differs; detection changes cannot be isolated from source evidence changes.');
  if (bm.catalogVersion !== am.catalogVersion || bm.catalogFingerprint !== am.catalogFingerprint || bm.catalogRecordCount !== am.catalogRecordCount || digest(bm.providers) !== digest(am.providers)) warnings.push('Catalog revision, fingerprint or provider coverage differs; recorded assessments are not recalculated and source-only attribution is inconclusive.');
  if (!before.snapshot.complete || !after.snapshot.complete) warnings.push('At least one scan has incomplete coverage; absence of evidence cannot establish removal or resolution.');
  const requiredCoverage = ['Discovery coverage', 'Module coverage', 'Assessment coverage', 'Assessments truncated', 'Evidence display truncated'];
  const completeCoverage: Record<string, string> = { 'Discovery coverage': 'Eligible scope analyzed', 'Module coverage': 'Indexed scope analyzed', 'Assessment coverage': 'Supported candidates displayed', 'Assessments truncated': 'false', 'Evidence display truncated': 'false' };
  for (const [name, record] of [['Before', before], ['After', after]] as const) {
    if (requiredCoverage.some((label) => record.snapshot.coverage.filter((r) => r.label === label).length !== 1)) warnings.push(`${name} coverage metadata is incomplete or ambiguous; comparison is inconclusive.`);
    if (record.snapshot.coverage.some((r) => Object.hasOwn(completeCoverage, r.label) && completeCoverage[r.label] !== r.value)) warnings.push(`${name} coverage records partial, truncated or unsupported scope; comparison is inconclusive.`);
    if (record.identities.integrations.some((i) => section(record, 'integrations').filter((b) => b.title.endsWith(` · ${i.packageName}`)).length !== 1)) warnings.push(`${name} integration evidence projection is absent or ambiguous.`);
    if (record.snapshot.coverage.some((r) => /truncated/iu.test(r.label) && r.value !== 'false') || section(record, 'findings').some((b) => (b.finding !== undefined && (rows(b, 'Evidence display complete').length !== 1 || rows(b, 'Evidence display complete')[0] !== 'true')) || (b.finding?.moreReferences ?? 0) > 0)) warnings.push(`${name} saved evidence is truncated or its display completeness is unknown.`);
  }
  if (digest(ordered(before.snapshot.coverage)) !== digest(ordered(after.snapshot.coverage))) warnings.push('Recorded coverage differs; missing findings may reflect different supported or displayed scope.');
  if (!budget(before).length || !budget(after).length || digest(budget(before)) !== digest(budget(after))) warnings.push('Effective resource budgets differ or are absent; scan scope comparability is inconclusive.');
  const integrations: ScanComparison['integrations'] = [];
  const integrationMap = (record: SavedScan) => new Map(record.identities.integrations.map((i) => [canonicalJson([i.provider, i.packageName]), i]));
  const bi = integrationMap(before); const ai = integrationMap(after);
  for (const key of [...new Set([...bi.keys(), ...ai.keys()])].sort()) {
    const i = bi.get(key) ?? ai.get(key)!;
    const blocks = (r: SavedScan) => section(r, 'integrations').filter((b) => b.title.endsWith(` · ${i.packageName}`));
    const b = bi.has(key) ? blocks(before) : []; const a = ai.has(key) ? blocks(after) : [];
    integrations.push({ ...i, category: !bi.has(key) ? 'new' : !ai.has(key) ? 'missing' : 'unchanged', evidenceChanged: evidenceFingerprint(b) !== evidenceFingerprint(a), before: b, after: a });
  }
  const bg = assessments(before); const ag = assessments(after); const result: AssessmentComparison[] = [];
  for (const key of [...new Set([...bg.keys(), ...ag.keys()])].sort()) {
    const b = bg.get(key) ?? []; const a = ag.get(key) ?? []; const left = b[0]; const right = a[0];
    let category: AssessmentComparison['category']; let reason: string;
    if (b.length > 1 || a.length > 1 || key.includes('"unmatchable"')) { category = 'inconclusive'; reason = 'Client scope is missing or ambiguous; no transition is asserted.'; }
    else if (!left) { category = 'new'; reason = 'Newly recorded assessment; not a newly announced provider change.'; }
    else if (!right) { category = 'missing'; reason = 'Assessment no longer recorded; this does not prove a fix or runtime removal.'; }
    else if (left.identity.recordFingerprint !== right.identity.recordFingerprint) { category = 'inconclusive'; reason = 'The embedded historical record fingerprint changed; statuses are shown without asserting a like-for-like transition.'; }
    else { category = left.identity.status === right.identity.status ? 'unchanged' : 'changed'; reason = 'Matched unique saved client/integration scope and historical record fingerprint; observed statuses only, not runtime verification.'; }
    const uncertainty = category === 'inconclusive' || !left || !right ? 'inconclusive' : left.identity.status !== 'unknown' && right.identity.status === 'unknown' ? 'increased' : left.identity.status === 'unknown' && right.identity.status !== 'unknown' ? 'reduced' : 'unchanged';
    result.push({ key: digest(key), category, reason, uncertainty, evidenceChanged: evidenceFingerprint(b.map((x) => x.evidence)) !== evidenceFingerprint(a.map((x) => x.evidence)), before: b, after: a });
  }
  if (result.some((r) => r.category === 'new' || r.category === 'missing')) warnings.push('Unmatched assessments remain separate; source movement or changed client scope cannot be distinguished from new/missing evidence.');
  if (result.some((r) => r.category === 'inconclusive')) warnings.push('Some assessment identities or historical records cannot be matched conclusively.');
  const comparison: ScanComparison = { schemaVersion: 1, before: context(before), after: context(after), inconclusive: warnings.length > 0, warnings,
    limitations: ['Saved snapshots are historical, privacy-filtered and not authenticated. No project was rescanned or code executed.',
      'Matching positional source references cannot prove persistent client identity, runtime behavior, a repair or application health.',
      'Absence can reflect unsupported discovery, withheld/truncated evidence, source movement, options, Scanner build or catalog changes; it never proves a fix.',
      'Uncertainty increased/reduced describes only transitions into/out of Unknown, not compatibility improvement. Partial coverage is reported separately.',
      'Command position defines older/newer roles. Any source edits were manual or external; PatchWRK performed no repair.',
      'Saved evidence omits raw arguments, API declaration values and source text; equal displayed scope cannot establish identical runtime inputs.'],
    integrations, assessments: result };
  if (Buffer.byteLength(JSON.stringify(comparison), 'utf8') > maxHtmlBytes) throw new Error('Comparison exceeds the 32 MiB output limit.');
  return comparison;
}
