import { changeCategories, providerIds } from '../types/changes.ts';
import type { ApiChange, ProviderId } from '../types/changes.ts';
import { isOfficialUrl, safeHttpsUrl } from './sources.ts';

export function invalid(field: string): never {
  // Do not echo untrusted field values, content, or URLs in errors.
  throw new Error(`Invalid change data: ${field}.`);
}

/** Reject accessors, custom prototypes, prototype keys, holes, and excessive depth. */
export function assertJsonData(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  if (depth > 24 || ++budget.nodes > 100_000) invalid('structure limit');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string') {
    if (value.length > 10_000) invalid('string size');
    return;
  }
  if (typeof value !== 'object' || !value) invalid('JSON value');
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !(Array.isArray(value) && prototype === Array.prototype)) invalid('prototype');
  if (Object.getOwnPropertySymbols(value).length) invalid('symbol keys');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || !('value' in descriptor)) invalid('unsafe property');
    if (Array.isArray(value) && key === 'length') continue;
    if (Array.isArray(value) && (!/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length)) invalid('extended array');
    assertJsonData(descriptor.value as unknown, depth + 1, budget);
  }
  if (Array.isArray(value) && Object.keys(descriptors).length !== value.length + 1) invalid('sparse or extended array');
}

export function record(value: unknown, fields: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== fields.length || fields.some((key) => !Object.hasOwn(result, key))) invalid(`${field} fields`);
  return result;
}

function text(value: unknown, field: string, max = 10_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max
    || [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code === 127 || (code < 32 && code !== 9 && code !== 10);
    })) invalid(field);
  return value;
}

function nullableText(value: unknown, field: string, max = 10_000): string | null {
  return value === null ? null : text(value, field, max);
}

function choice<T extends string>(value: unknown, choices: readonly T[], field: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) invalid(field);
  return value as T;
}

function list<T>(value: unknown, field: string, validate: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 100) invalid(field);
  return value.map(validate);
}

export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function date(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !isDate(value)) invalid(field);
  return value;
}

function timestamp(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    || !isDate(value.slice(0, 10))) invalid(field);
  const normalized = value.includes('.') ? value : value.replace('Z', '.000Z');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) invalid(field);
  return value;
}

export function isSemver(value: string): boolean {
  const match = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(value);
  return !!match && (!match[1] || match[1].split('.').every((part) => !/^0\d+$/u.test(part)));
}

/** Intentionally bounded grammar; no guessed interpretation of arbitrary ranges. */
export function isSemverRange(value: string): boolean {
  if (value === '*') return true;
  if (value.length > 256 || !value.trim() || value.trim() !== value) return false;
  return value.split(' || ').every((group) => group.split(' ').every((part) => {
    const match = /^(?:\^|~|>=|<=|>|<|=)?(.+)$/u.exec(part);
    return !!match?.[1] && isSemver(match[1]);
  }));
}

function url(value: unknown, field: string): string {
  const result = text(value, field, 2048);
  if (!safeHttpsUrl(result)) invalid(field);
  return result;
}

export function parseProvider(value: unknown): ProviderId {
  return choice(value, providerIds, 'provider');
}

export function validateChange(input: unknown): ApiChange {
  assertJsonData(input);
  const item = record(input, [
    'provider', 'id', 'title', 'description', 'officialSourceUrl', 'publicationDate',
    'effectiveDate', 'retirementDate', 'category', 'affectedSdks', 'affectedApiVersions',
    'targets', 'migrationInstructions', 'evidence', 'provenance', 'verification', 'lastReviewedAt',
  ], 'record');
  const provider = parseProvider(item.provider);
  const id = text(item.id, 'id', 160);
  if (!/^[a-z][a-z0-9]*(?:[.:_-][a-z0-9]+)*$/u.test(id)) invalid('id');
  const officialSourceUrl = item.officialSourceUrl === null ? null : url(item.officialSourceUrl, 'officialSourceUrl');
  if (officialSourceUrl && !isOfficialUrl(provider, officialSourceUrl)) invalid('official source authority');
  const provenance = record(item.provenance, ['kind', 'sources', 'notes'], 'provenance');
  const verification = record(item.verification, ['status', 'method', 'reviewer'], 'verification');
  const result: ApiChange = {
    provider, id, title: text(item.title, 'title', 300), description: text(item.description, 'description'),
    officialSourceUrl,
    publicationDate: date(item.publicationDate, 'publicationDate'),
    effectiveDate: date(item.effectiveDate, 'effectiveDate'), retirementDate: date(item.retirementDate, 'retirementDate'),
    category: choice(item.category, changeCategories, 'category'),
    affectedSdks: list(item.affectedSdks, 'affectedSdks', (value) => {
      const sdk = record(value, ['packageName', 'versionRange'], 'SDK');
      const packageName = text(sdk.packageName, 'packageName', 214);
      if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(packageName)) invalid('packageName');
      const versionRange = nullableText(sdk.versionRange, 'SDK versionRange', 256);
      if (versionRange !== null && !isSemverRange(versionRange)) invalid('SDK versionRange');
      return { packageName, versionRange };
    }),
    affectedApiVersions: list(item.affectedApiVersions, 'affectedApiVersions', (value) => {
      const api = record(value, ['scheme', 'versions', 'versionRange'], 'API versions');
      const scheme = choice(api.scheme, ['date', 'semver', 'opaque'] as const, 'API version scheme');
      const versions = list(api.versions, 'API versions', (version) => {
        const result = text(version, 'API version', 128);
        if ((scheme === 'date' && !isDate(result)) || (scheme === 'semver' && !isSemver(result))) invalid('API version');
        return result;
      });
      const versionRange = nullableText(api.versionRange, 'API versionRange', 256);
      if (versionRange !== null) {
        if (scheme === 'opaque') invalid('opaque API range');
        if (scheme === 'semver' && !isSemverRange(versionRange)) invalid('API semver range');
        if (scheme === 'date') {
          const parts = versionRange.split('..');
          if (parts.length !== 2 || !parts[0] || !parts[1] || !isDate(parts[0]) || !isDate(parts[1]) || parts[0] > parts[1]) invalid('API date range');
        }
      }
      if (!versions.length && versionRange === null) invalid('empty API constraint');
      return { scheme, versions, versionRange };
    }),
    targets: list(item.targets, 'targets', (value) => {
      const target = record(value, ['kind', 'value'], 'target');
      return { kind: choice(target.kind, ['endpoint', 'method', 'sdk-symbol', 'model'] as const, 'target kind'), value: text(target.value, 'target value', 512) };
    }),
    migrationInstructions: nullableText(item.migrationInstructions, 'migrationInstructions'),
    evidence: list(item.evidence, 'evidence', (value) => {
      const evidence = record(value, ['sourceUrl', 'locator', 'excerpt'], 'evidence');
      return { sourceUrl: url(evidence.sourceUrl, 'evidence URL'), locator: nullableText(evidence.locator, 'locator', 512), excerpt: nullableText(evidence.excerpt, 'excerpt', 2000) };
    }),
    provenance: {
      kind: choice(provenance.kind, ['official', 'unverified', 'illustrative'] as const, 'provenance kind'),
      sources: list(provenance.sources, 'sources', (value) => {
        const source = record(value, ['url', 'retrievedAt'], 'source');
        return { url: url(source.url, 'source URL'), retrievedAt: timestamp(source.retrievedAt, 'retrievedAt') };
      }),
      notes: nullableText(provenance.notes, 'provenance notes'),
    },
    verification: {
      status: choice(verification.status, ['verified', 'unverified', 'illustrative'] as const, 'verification status'),
      method: verification.method === null ? null : choice(verification.method, ['manual-official-review'] as const, 'verification method'),
      reviewer: nullableText(verification.reviewer, 'reviewer', 160),
    },
    lastReviewedAt: timestamp(item.lastReviewedAt, 'lastReviewedAt'),
  };
  const sources = new Set(result.provenance.sources.map((source) => source.url));
  if (result.evidence.some((evidence) => !sources.has(evidence.sourceUrl))) invalid('evidence provenance');
  if (officialSourceUrl && !sources.has(officialSourceUrl)) invalid('official source provenance');
  if (result.provenance.kind === 'official' && (!officialSourceUrl
    || result.provenance.sources.some((source) => !isOfficialUrl(provider, source.url)))) invalid('official provenance authority');
  if (result.verification.status === 'verified') {
    if (result.provenance.kind !== 'official' || !officialSourceUrl || !result.lastReviewedAt
      || result.verification.method !== 'manual-official-review' || !result.verification.reviewer
      || !result.evidence.some((evidence) => evidence.sourceUrl === officialSourceUrl)
      || result.provenance.sources.some((source) => !isOfficialUrl(provider, source.url))) invalid('verification evidence');
  } else {
    if (result.verification.method !== null || result.verification.reviewer !== null) invalid('unverified attestation');
    if ((result.verification.status === 'illustrative') !== (result.provenance.kind === 'illustrative')) invalid('illustrative provenance');
  }
  // Fixed field order and normalized array ordering without altering original references.
  result.affectedSdks.sort((a, b) => compare(a.packageName, b.packageName) || compare(a.versionRange ?? '', b.versionRange ?? ''));
  for (const versions of result.affectedApiVersions) versions.versions = [...new Set(versions.versions)].sort(compare);
  result.affectedApiVersions.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  result.targets.sort((a, b) => compare(a.kind, b.kind) || compare(a.value, b.value));
  result.evidence.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  result.provenance.sources.sort((a, b) => compare(a.url, b.url) || compare(a.retrievedAt ?? '', b.retrievedAt ?? ''));
  return result;
}

export function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
