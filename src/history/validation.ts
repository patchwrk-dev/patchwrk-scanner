import ts from 'typescript';
import { createHash, randomUUID } from 'node:crypto';
import type { SavedScan, HistoryProject } from '../types/history.ts';
import type { ReportView } from '../types/reporting.ts';
import type { CompatibilityScanReport } from '../types/compatibility.ts';
import { canonicalJson } from '../reports/context.ts';
import { isOfficialUrl } from '../changes/sources.ts';
import { providerIds, changeCategories } from '../types/changes.ts';

export const historyLimits = { maxRecordBytes: 32 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024, maxEntries: 10_000, maxNodes: 100_000, maxDepth: 64 } as const;
export function invalid(): never { throw new Error('Invalid, corrupt, unsafe or unsupported history data.'); }
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value)) invalid();
  return value;
}
function obj(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || Object.keys(descriptors).some((key) => ![...required, ...optional].includes(key) || !('value' in descriptors[key]!))) invalid();
  return value as Record<string, unknown>;
}
function str(value: unknown): string {
  if (typeof value !== 'string' || value.length > 10_000 || /(?:(?:^|[\s"'(])\/(?![\s/])|[A-Za-z]:\\|\\\\|-----BEGIN .*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}|\bgh[pousr]_[A-Za-z0-9]{25,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}|\bsk_(?:live|test)_[A-Za-z0-9]+)/u.test(value)
    || [...value].some((c) => (c.charCodeAt(0) < 32 && c !== '\n' && c !== '\t') || c.charCodeAt(0) === 127)) invalid();
  return value;
}
function number(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(); return value as number; }
function bool(value: unknown): void { if (typeof value !== 'boolean') invalid(); }
function hash(value: unknown): void { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) invalid(); }
function timestamp(value: unknown): void { const text = str(value); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text) invalid(); }
function array(value: unknown): unknown[] { if (!Array.isArray(value) || value.length > 10_000 || Object.keys(value).length !== value.length || Object.keys(value).some((key) => !/^(?:0|[1-9]\d*)$/u.test(key))) invalid(); return value; }
function strings(value: unknown): void { array(value).forEach(str); }
function rows(value: unknown): void { array(value).forEach((item) => { const row = obj(item, ['label', 'value']); str(row.label); str(row.value); }); }
function choice(value: unknown, values: readonly string[]): string { const text = str(value); if (!values.includes(text)) invalid(); return text; }
function structure(value: unknown): void {
  const pending: [unknown, number][] = [[value, 0]]; let nodes = 0;
  while (pending.length) {
    const [item, depth] = pending.pop()!;
    if (++nodes > historyLimits.maxNodes || depth > historyLimits.maxDepth) invalid();
    if (typeof item === 'string') str(item);
    else if (item !== null && typeof item === 'object') {
      const proto = Object.getPrototypeOf(item);
      if (proto !== Object.prototype && !(Array.isArray(item) && proto === Array.prototype)) invalid();
      if (Object.getOwnPropertySymbols(item).length) invalid();
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
        if (['__proto__', 'constructor', 'prototype'].includes(key) || !('value' in descriptor)) invalid();
        if (Array.isArray(item) && key === 'length') continue;
        pending.push([descriptor.value, depth + 1]);
        if (pending.length > historyLimits.maxNodes) invalid();
      }
    } else if (item !== null && typeof item !== 'boolean' && (typeof item !== 'number' || !Number.isFinite(item))) invalid();
  }
}

/** Independent bounded parser: never imports/evaluates records or silently accepts duplicate keys. */
export function parseHistory(text: string): unknown {
  if (Buffer.byteLength(text, 'utf8') > historyLimits.maxRecordBytes) invalid();
  let depth = 0; let quoted = false; let escaped = false;
  for (const c of text) {
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{' || c === '[') { if (++depth > historyLimits.maxDepth) invalid(); }
    else if (c === '}' || c === ']') depth--;
  }
  let value: unknown; try { value = JSON.parse(text); } catch { invalid(); }
  structure(value);
  const pending: ts.Node[] = [ts.parseJsonText('history.json', text)]; let visited = 0;
  while (pending.length) {
    const node = pending.pop()!; if (++visited > 400_000) invalid();
    if (ts.isObjectLiteralExpression(node)) {
      const keys = new Set<string>();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name) || keys.has(property.name.text)) invalid();
        keys.add(property.name.text);
      }
    }
    ts.forEachChild(node, (child) => { pending.push(child); });
  }
  return value;
}
export function validateProject(value: unknown): HistoryProject {
  structure(value); const project = obj(value, ['schemaVersion', 'projectId']);
  if (project.schemaVersion !== 1) invalid(); uuid(project.projectId);
  return structuredClone(project) as unknown as HistoryProject;
}
const labels = ['Affected', 'Potential risk', 'Unknown', 'Not affected by this change', 'No known finding within supported coverage', 'Unknown / partial coverage'];
function block(value: unknown): void {
  const b = obj(value, ['title', 'rows', 'notes'], ['status', 'sourceUrl', 'finding']); str(b.title); rows(b.rows); strings(b.notes);
  if (b.status !== undefined) choice(b.status, labels);
  if (b.sourceUrl !== undefined) {
    const url = str(b.sourceUrl);
    if (!providerIds.some((id) => isOfficialUrl(id, url)) || new URL(url).search) invalid();
  }
  if (b.finding !== undefined) {
    const f = obj(b.finding, ['provider', 'title', 'explanation', 'references', 'moreReferences', 'uncertainty', 'actions']);
    str(f.provider); str(f.title); str(f.explanation); strings(f.references); number(f.moreReferences); strings(f.uncertainty); strings(f.actions);
  }
}
function snapshot(value: unknown): ReportView {
  const view = obj(value, ['schemaVersion', 'metadata', 'complete', 'stats', 'notices', 'coverage', 'sections']);
  if (view.schemaVersion !== 1) invalid(); bool(view.complete); strings(view.notices); rows(view.coverage);
  const m = obj(view.metadata, ['scannerVersion', 'buildFingerprint', 'catalogVersion', 'catalogFingerprint', 'catalogRecordCount', 'providers', 'startedAt', 'finishedAt', 'generatedAt']);
  if (m.scannerVersion !== null && !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/u.test(str(m.scannerVersion))) invalid();
  if (m.buildFingerprint !== null) hash(m.buildFingerprint); hash(m.catalogFingerprint);
  if (!/^[1-9]\d{0,8}$/u.test(str(m.catalogVersion))) invalid(); number(m.catalogRecordCount);
  [m.startedAt, m.finishedAt, m.generatedAt].forEach(timestamp);
  const ids = new Set<string>();
  array(m.providers).forEach((item) => { const p = obj(item, ['id', 'name', 'records']); const id = choice(p.id, providerIds); if (ids.has(id)) invalid(); ids.add(id); str(p.name); number(p.records); });
  if (ids.size !== providerIds.length) invalid();
  array(view.stats).forEach((item) => { const stat = obj(item, ['label', 'value']); str(stat.label); number(stat.value); });
  const kinds = ['scope', 'integrations', 'findings', 'attention', 'actions', 'limitations']; const seen = new Set<string>();
  array(view.sections).forEach((item) => { const section = obj(item, ['kind', 'title', 'blocks']); const kind = choice(section.kind, kinds); if (seen.has(kind)) invalid(); seen.add(kind); str(section.title); array(section.blocks).forEach(block); });
  if (seen.size !== kinds.length) invalid();
  return view as unknown as ReportView;
}
export function validateSavedScan(value: unknown): SavedScan {
  structure(value);
  const record = obj(value, ['schemaVersion', 'scanId', 'projectId', 'savedAt', 'identities', 'snapshot']);
  if (record.schemaVersion !== 1) invalid(); uuid(record.scanId); uuid(record.projectId); timestamp(record.savedAt);
  const identities = obj(record.identities, ['integrations', 'findings']); const seen = new Set<string>();
  const packages = ['stripe', 'openai', '@anthropic-ai/sdk', '@shopify/shopify-api', 'twilio'];
  array(identities.integrations).forEach((item) => { const i = obj(item, ['provider', 'packageName']); const provider = choice(i.provider, providerIds); const name = choice(i.packageName, packages); if (packages[providerIds.indexOf(provider as typeof providerIds[number])] !== name) invalid(); const key = `${provider}:${name}`; if (seen.has(key)) invalid(); seen.add(key); });
  const references = new Set<string>();
  array(identities.findings).forEach((item) => {
    const f = obj(item, ['provider', 'packageName', 'changeId', 'reference', 'clientReference', 'recordFingerprint', 'status', 'scope', 'category']);
    choice(f.provider, providerIds); choice(f.packageName, packages); if (!seen.has(`${str(f.provider)}:${str(f.packageName)}`)) invalid();
    if (!/^[a-z0-9][a-z0-9.-]{0,159}$/u.test(str(f.changeId))) invalid(); hash(f.reference); hash(f.recordFingerprint); if (f.clientReference !== null) hash(f.clientReference);
    if (references.has(f.reference as string)) invalid(); references.add(f.reference as string);
    choice(f.status, ['affected', 'potentially-affected', 'unknown', 'not-affected-by-this-change']);
    choice(f.scope, ['documented-version-applicability', 'documented-configuration-applicability']); choice(f.category, changeCategories);
  });
  const view = snapshot(record.snapshot);
  const findings = identities.findings as SavedScan['identities']['findings'];
  const stats = [view.stats[0]?.label === 'Files scanned' ? view.stats[0].value : -1, seen.size, findings.filter((f) => ['affected', 'potentially-affected'].includes(f.status)).length, findings.filter((f) => f.status === 'unknown').length];
  if (view.stats.length !== 4 || view.stats.some((item, index) => item.value !== stats[index] || item.label !== ['Files scanned', 'Supported integrations', 'Assessments requiring attention', 'Unknown assessments'][index])) invalid();
  const assessmentBlocks = view.sections.find((s) => s.kind === 'findings')!.blocks.filter((b) => b.finding !== undefined);
  if (assessmentBlocks.length !== findings.length) invalid();
  const statusLabels = { affected: 'Affected', 'potentially-affected': 'Potential risk', unknown: 'Unknown', 'not-affected-by-this-change': 'Not affected by this change' };
  for (const f of findings) {
    const b = assessmentBlocks.find((b) => b.rows.some((r) => r.label === 'Finding reference' && r.value === f.reference));
    if (!b || b.status !== statusLabels[f.status]) invalid();
    if (b.sourceUrl && !isOfficialUrl(f.provider as typeof providerIds[number], b.sourceUrl)) invalid();
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > historyLimits.maxRecordBytes) invalid();
  return structuredClone(record) as unknown as SavedScan;
}
export function buildSavedScan(scan: CompatibilityScanReport, view: ReportView, projectId: string): SavedScan {
  const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
  const findings = view.sections.find((s) => s.kind === 'findings')!.blocks;
  return validateSavedScan({ schemaVersion: 1, scanId: randomUUID(), projectId: uuid(projectId), savedAt: new Date().toISOString(),
    identities: { integrations: scan.integrations.map((i) => ({ provider: i.provider, packageName: i.packageName })),
      findings: scan.compatibility.assessments.map((a, index) => ({ provider: a.provider, packageName: a.packageName, changeId: a.changeId,
        reference: findings[index]!.rows.find((r) => r.label === 'Finding reference')!.value,
        clientReference: a.client ? digest(a.client.definition.id) : null, recordFingerprint: digest(a.changeRecord), status: a.status, scope: a.scope, category: a.category })) }, snapshot: view });
}
