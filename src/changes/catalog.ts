import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { ApiChange, ChangeCatalog, ChangeCatalogRepository } from '../types/changes.ts';
import { assertJsonData, compare, invalid, record, validateChange } from './validation.ts';

export interface CatalogLimits { maxBytes: number; maxRecords: number }
export const catalogLimits: Readonly<CatalogLimits> = { maxBytes: 1_048_576, maxRecords: 1000 };

function limits(options: Partial<CatalogLimits>): CatalogLimits {
  const result = { ...catalogLimits, ...options };
  if (!Number.isSafeInteger(result.maxBytes) || result.maxBytes < 1 || result.maxBytes > 4_194_304
    || !Number.isSafeInteger(result.maxRecords) || result.maxRecords < 1 || result.maxRecords > 10_000) invalid('catalog limits');
  return result;
}

/** Fail closed on duplicates; never choose between conflicting copies. */
export function deduplicateChanges(values: readonly unknown[]): ApiChange[] {
  const identifiers = new Set<string>();
  const changes = values.map((value) => {
    const change = validateChange(value);
    if (identifiers.has(change.id)) invalid('duplicate change identifier');
    identifiers.add(change.id);
    return change;
  });
  return changes.sort((a, b) => compare(a.provider, b.provider) || compare(a.id, b.id));
}

export function validateCatalog(input: unknown, options: Partial<CatalogLimits> = {}): ChangeCatalog {
  const configured = limits(options);
  assertJsonData(input);
  const catalog = record(input, ['schemaVersion', 'catalogVersion', 'changes'], 'catalog');
  if (catalog.schemaVersion !== 1) invalid('catalog schemaVersion');
  if (typeof catalog.catalogVersion !== 'string' || !/^[1-9]\d{0,8}$/u.test(catalog.catalogVersion)) invalid('catalogVersion');
  if (!Array.isArray(catalog.changes) || catalog.changes.length > configured.maxRecords) invalid('catalog record limit');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > configured.maxBytes) invalid('catalog byte limit');
  return { schemaVersion: 1, catalogVersion: catalog.catalogVersion, changes: deduplicateChanges(catalog.changes) };
}

export function parseCatalog(text: string, options: Partial<CatalogLimits> = {}): ChangeCatalog {
  const configured = limits(options);
  if (Buffer.byteLength(text, 'utf8') > configured.maxBytes) invalid('catalog byte limit');
  // Check nesting before either parser can allocate a deeply recursive AST.
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') { if (++depth > 24) invalid('structure limit'); }
    else if (character === '}' || character === ']') depth--;
  }
  let input: unknown;
  try { input = JSON.parse(text) as unknown; } catch { invalid('catalog JSON'); }
  // JSON.parse otherwise silently accepts repeated object keys.
  const source = ts.parseJsonText('catalog.json', text);
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const names = new Set<string>();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name)) invalid('catalog JSON properties');
        if (names.has(property.name.text)) invalid('duplicate JSON property');
        names.add(property.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return validateCatalog(input, configured);
}

async function parentIdentities(path: string): Promise<string[]> {
  let current = parse(path).root;
  const identities: string[] = [];
  for (const component of dirname(path).slice(current.length).split(sep).filter(Boolean)) {
    current = resolve(current, component);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) invalid('catalog path');
    identities.push(`${info.dev}:${info.ino}`);
  }
  return identities;
}

export async function loadCatalogFile(path: string, options: Partial<CatalogLimits> = {}): Promise<ChangeCatalog> {
  const configured = limits(options);
  if (!path || path.includes('\0') || path.split(/[\\/]/u).includes('..')) invalid('catalog path');
  const target = resolve(path);
  if (dirname(target) === parse(target).root) invalid('catalog root path');
  try {
    const parents = JSON.stringify(await parentIdentities(target));
    const before = await lstat(target);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > configured.maxBytes) invalid('catalog file');
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== before.ino || opened.dev !== before.dev
        || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs
        || JSON.stringify(await parentIdentities(target)) !== parents) invalid('catalog file changed');
      const data = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < data.length) {
        const read = await handle.read(data, offset, data.length - offset, offset);
        if (!read.bytesRead) break;
        offset += read.bytesRead;
      }
      const after = await handle.stat();
      const current = await lstat(target);
      if (offset !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
        || after.ctimeMs !== opened.ctimeMs || current.ino !== opened.ino || current.dev !== opened.dev
        || current.isSymbolicLink() || JSON.stringify(await parentIdentities(target)) !== parents) invalid('catalog file changed');
      return parseCatalog(new TextDecoder('utf-8', { fatal: true }).decode(data), configured);
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid change data:')) throw error;
    throw new Error('Catalog file is unreadable, unsafe, changed, or not UTF-8.', { cause: error });
  }
}

export class LocalChangeCatalog implements ChangeCatalogRepository {
  private readonly path: string;
  constructor(path = fileURLToPath(new URL('./data/catalog.v1.json', import.meta.url))) { this.path = path; }
  load(): Promise<ChangeCatalog> { return loadCatalogFile(this.path); }
}
