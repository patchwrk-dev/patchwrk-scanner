import { posix } from 'node:path';
import type { ManifestResolution } from '../types/analysis.ts';
import type { DeclaredVersion, DetectionEvidence } from '../types/index.ts';
import { object } from './dependencies.ts';

export interface ManifestIndex {
  documents: Map<string, Record<string, unknown>>;
  observed: Set<string>;
  declarations: { provider: string; packageName: string; declaration: DeclaredVersion }[];
}

export function nearestManifest(file: string, observed: Set<string>): string | null {
  let directory = posix.dirname(file);
  for (;;) {
    const candidate = directory === '.' ? 'package.json' : `${directory}/package.json`;
    if (observed.has(candidate)) return candidate;
    if (directory === '.') return null;
    directory = posix.dirname(directory);
  }
}

export function workspaceMember(manifest: string, index: ManifestIndex): boolean {
  if (manifest === 'package.json') return false;
  const root = index.documents.get('package.json');
  const workspaces = Array.isArray(root?.workspaces) ? root.workspaces : object(root?.workspaces)?.packages;
  if (!Array.isArray(workspaces) || workspaces.length > 100) return false;
  const directory = posix.dirname(manifest);
  return workspaces.some((pattern: unknown) => {
    if (typeof pattern !== 'string' || pattern.length > 256 || pattern.startsWith('/') || pattern.includes('\\')) return false;
    const parts = pattern.split('/');
    if (parts.some((part) => part === '..' || part === '.' || !/^(?:[A-Za-z0-9_.-]+|\*)$/u.test(part))) return false;
    const segments = directory.split('/');
    return segments.length === parts.length && parts.every((part, index) => part === '*' || part === segments[index]);
  });
}

export function resolveManifest(provider: string, packageName: string, location: Pick<DetectionEvidence, 'file' | 'line'>, index: ManifestIndex): ManifestResolution {
  let manifest = nearestManifest(location.file, index.observed);
  let basis: ManifestResolution['basis'] = 'nearest-manifest';
  let declarations = index.declarations.filter((item) => item.provider === provider && item.packageName === packageName && item.declaration.file === manifest).map((item) => item.declaration);
  if (manifest && index.documents.has(manifest) && !declarations.length && workspaceMember(manifest, index)) {
    const shared = index.declarations.filter((item) => item.provider === provider && item.packageName === packageName && item.declaration.file === 'package.json').map((item) => item.declaration);
    if (shared.length) { manifest = 'package.json'; declarations = shared; basis = 'workspace-root'; }
  }
  const distinct = new Set(declarations.map((item) => JSON.stringify([item.version, item.status, item.resolvedVersion, item.resolutionStatus])));
  const status = !manifest || !index.documents.has(manifest) || !declarations.length ? 'unknown' : distinct.size > 1 ? 'ambiguous' : 'resolved';
  return { file: location.file, line: location.line, provider, packageName, manifest, basis: status === 'unknown' ? 'unresolved' : basis, status,
    declarations: structuredClone(declarations).sort((a, b) => a.section < b.section ? -1 : a.section > b.section ? 1 : 0),
    limitations: [
      'Declaration scope is static metadata, not verification of node_modules or deployed module resolution.',
      ...(status === 'ambiguous' ? ['Conflicting declaration/version evidence exists; no version was selected.'] : []),
      ...(status === 'unknown' ? ['No unambiguous declaration in the nearest manifest or supported explicit workspace root.'] : []),
    ] };
}
