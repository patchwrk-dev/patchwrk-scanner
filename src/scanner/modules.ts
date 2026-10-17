import { posix } from 'node:path';
import type { ClientDefinition, ImportedClient, ModuleLimits, RepositoryAnalysis } from '../types/analysis.ts';
import type { ProviderDefinition } from '../types/index.ts';
import { analyzeSource } from './source.ts';
import type { ModuleMetadata } from './module-metadata.ts';
import { nearestManifest, resolveManifest, workspaceMember } from './manifest-resolution.ts';
import type { ManifestIndex } from './manifest-resolution.ts';
import { dependencySections, object } from './dependencies.ts';

export const defaultModuleLimits: Readonly<ModuleLimits> = { maxModules: 256, maxEdges: 2000, maxTraversalDepth: 32, maxResolutionSteps: 10_000 };
export function moduleLimits(overrides: Partial<ModuleLimits> = {}): ModuleLimits {
  const result = { ...defaultModuleLimits, ...overrides };
  for (const [key, value] of Object.entries(result)) {
    const maximums: Record<string, number> = { maxModules: 2000, maxEdges: 20_000, maxTraversalDepth: 128, maxResolutionSteps: 100_000 };
    if (!Object.hasOwn(maximums, key) || !Number.isSafeInteger(value) || value < 1 || value > maximums[key]!) throw new Error('Invalid module analysis limits.');
  }
  return result;
}
export interface IndexedModule { text: string; result: ReturnType<typeof analyzeSource> }

export function analyzeModules(modules: Map<string, IndexedModule>, registry: readonly ProviderDefinition[], manifests: ManifestIndex, limits: ModuleLimits) {
  const report: RepositoryAnalysis = { schemaVersion: 1, complete: true, modulesAnalyzed: modules.size, edgesInspected: 0, resolutionSteps: 0, cyclesDetected: 0,
    limits, bindings: [], clients: [], warnings: [], limitations: [
      'Only already-read allowed source files participate; no filesystem module resolver, node_modules, or tsconfig is evaluated.',
      'Relative paths and explicit JSON-workspace exports/main entries only; aliases, export stars, factories, and dynamic imports remain unsupported.',
      'Subpaths establish package identity only, not constructor exports or package export-map validity.',
      'Static client relationships do not prove runtime identity, execution, or provider health.',
    ] };
  const files = [...modules.keys()].sort();
  const allDefinitions = files.flatMap((file) => modules.get(file)!.result.module.definitions);
  const definitions = allDefinitions.slice(0, 2000);
  if (allDefinitions.length > definitions.length) { report.complete = false; report.warnings.push('Client definition limit reached (2000).'); }
  const metadata = (file: string): ModuleMetadata | undefined => modules.get(file)?.result.module;
  const cache = new Map<string, ClientDefinition | null>();
  const pathCache = new Map<string, string | null>();
  const warn = (message: string, incomplete = false) => { report.warnings.push(message); if (incomplete) report.complete = false; };
  const lookupPath = (from: string, specifier: string): string | null => {
    if (!specifier || specifier.length > 512 || specifier.includes('\\') || specifier.includes('\0') || specifier.startsWith('/')) return null;
    let base: string;
    if (specifier.startsWith('./') || specifier.startsWith('../')) base = posix.normalize(posix.join(posix.dirname(from), specifier));
    else {
      const caller = nearestManifest(from, manifests.observed);
      const document = caller ? manifests.documents.get(caller) : undefined;
      if (!document || !dependencySections.some((section) => typeof object(document[section])?.[specifier] === 'string')) return null;
      const candidates = [...manifests.documents].filter(([path, value]) => value.name === specifier && workspaceMember(path, manifests));
      if (candidates.length !== 1) return null;
      const [manifest, entry] = candidates[0]!;
      const target = entry.exports ?? entry.main;
      if (typeof target !== 'string' || !target.startsWith('./') || target.split('/').includes('..') || target.includes('\\')) return null;
      base = posix.normalize(posix.join(posix.dirname(manifest), target));
    }
    if (base === '..' || base.startsWith('../') || base.startsWith('/')) { warn(`Out-of-scope module reference in ${JSON.stringify(from)}.`); return null; }
    const candidates = new Set<string>();
    if (modules.has(base)) candidates.add(base);
    if (/\.[cm]?js$/u.test(base)) {
      const substitutions = base.endsWith('.mjs') ? ['.mts'] : base.endsWith('.cjs') ? ['.cts'] : ['.ts', '.tsx'];
      for (const suffix of substitutions) { const candidate = base.replace(/\.[cm]?js$/u, suffix); if (modules.has(candidate)) candidates.add(candidate); }
    }
    if (!posix.extname(base)) for (const suffix of ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']) {
      if (modules.has(base + suffix)) candidates.add(base + suffix);
      if (modules.has(`${base}/index${suffix}`)) candidates.add(`${base}/index${suffix}`);
    }
    if (candidates.size !== 1) { warn(`Missing or ambiguous module reference in ${JSON.stringify(from)}.`); return null; }
    return [...candidates][0]!;
  };
  const resolvePath = (from: string, specifier: string): string | null => {
    const key = `${from}\0${specifier}`;
    if (pathCache.has(key)) return pathCache.get(key)!;
    if (report.edgesInspected >= limits.maxEdges) { warn('Module edge limit reached.', true); return null; }
    report.edgesInspected++;
    const result = lookupPath(from, specifier); pathCache.set(key, result); return result;
  };
  const resolveExport = (file: string, name: string, active = new Set<string>(), depth = 0): ClientDefinition | null => {
    if (report.resolutionSteps >= limits.maxResolutionSteps || depth > limits.maxTraversalDepth) { warn('Module traversal/step limit reached.', true); return null; }
    report.resolutionSteps++;
    const key = JSON.stringify([file, name]);
    if (active.has(key)) { report.cyclesDetected++; warn('Circular export relationship encountered; client remains unknown.'); return null; }
    if (cache.has(key)) return cache.get(key)!;
    const entries = metadata(file)?.exports.filter((entry) => entry.name === name) ?? [];
    if (entries.length !== 1) return null;
    const entry = entries[0]!;
    const next = new Set(active); next.add(key);
    let definition: ClientDefinition | null = null;
    if (entry.definitionId) definition = definitions.find((item) => item.id === entry.definitionId) ?? null;
    else if (entry.module) {
      const target = resolvePath(file, entry.module);
      if (target) definition = resolveExport(target, entry.importedName, next, depth + 1);
    } else if (entry.localName) {
      const local = definitions.filter((item) => item.file === file && item.localName === entry.localName && item.topLevel);
      if (local.length === 1) definition = local[0]!;
      else if (!local.length) {
        const imports = metadata(file)?.imports.filter((item) => item.localName === entry.localName) ?? [];
        if (imports.length === 1) {
          const imported = imports[0]!;
          const target = resolvePath(file, imported.module);
          if (target) {
            const defaultRequire = imported.kind === 'require' && imported.importedName === '*'
              && metadata(target)?.commonJsDefault && metadata(target)?.exports.length === 1 && metadata(target)?.exports[0]?.name === 'default';
            if (imported.importedName !== '*' || defaultRequire) definition = resolveExport(target, defaultRequire ? 'default' : imported.importedName, next, depth + 1);
          }
        }
      }
    }
    cache.set(key, definition);
    return definition;
  };
  const replacements = new Map<string, ReturnType<typeof analyzeSource>>();
  const moduleStates = new Map<string, 'active' | 'complete'>();
  const visitModule = (file: string, depth = 0): void => {
    if (moduleStates.get(file) === 'active') { report.cyclesDetected++; warn('Circular module dependency detected; execution order is not established.', true); return; }
    if (moduleStates.get(file) === 'complete') return;
    if (depth > limits.maxTraversalDepth || report.resolutionSteps >= limits.maxResolutionSteps) { warn('Module traversal/step limit reached.', true); return; }
    report.resolutionSteps++;
    moduleStates.set(file, 'active');
    const references = [...(metadata(file)?.imports.map((entry) => entry.module) ?? []), ...(metadata(file)?.exports.flatMap((entry) => entry.module ? [entry.module] : []) ?? [])];
    for (const reference of [...new Set(references)].sort()) {
      if (registry.some((provider) => provider.packages.some((name) => reference === name || reference.startsWith(`${name}/`)))) continue;
      const target = resolvePath(file, reference);
      if (target) visitModule(target, depth + 1);
    }
    moduleStates.set(file, 'complete');
  };
  for (const file of files) visitModule(file);
  const usages = new Map<string, { file: string; line: number; type: 'client-reference'; typeOnly: false }[]>();
  for (const file of files) {
    const initial = modules.get(file)!.result;
    for (const finding of initial.findings) if (finding.evidence.type !== 'dependency') {
      report.bindings.push(resolveManifest(finding.provider, finding.packageName, finding.evidence, manifests));
    }
    const importedClients: ImportedClient[] = [];
    for (const imported of initial.module.imports) {
      // External SDK imports are handled by the single-file scanner, not traversed.
      if (registry.some((provider) => provider.packages.some((name) => imported.module === name || imported.module.startsWith(`${name}/`)))) continue;
      const target = resolvePath(file, imported.module);
      if (!target) continue;
      const exportNames = imported.importedName === '*' ? [...new Set(metadata(target)?.exports.map((entry) => entry.name) ?? [])].sort() : [imported.importedName];
      for (const name of exportNames) {
        if (importedClients.length >= 100 || report.resolutionSteps >= limits.maxResolutionSteps) { warn('Imported-client binding/traversal limit reached.', true); break; }
        const definition = resolveExport(target, name);
        if (!definition) { warn(`Unresolved exported client in ${JSON.stringify(file)}.`); continue; }
        if (initial.module.imports.filter((entry) => entry.localName === imported.localName).length !== 1) { warn(`Ambiguous import alias in ${JSON.stringify(file)}.`); continue; }
        const member = imported.importedName !== '*' || (imported.kind === 'require' && metadata(target)?.commonJsDefault && name === 'default' && exportNames.length === 1) ? null : name;
        importedClients.push({ localName: imported.localName, member, definition, line: imported.line });
        const references = usages.get(definition.id) ?? [];
        references.push({ file, line: imported.line, type: 'client-reference', typeOnly: false }); usages.set(definition.id, references);
      }
    }
    if (importedClients.length) replacements.set(file, analyzeSource(file, modules.get(file)!.text, registry, importedClients));
  }
  for (const definition of definitions) {
    report.clients.push({ definition, usages: usages.get(definition.id) ?? [], manifestResolution: resolveManifest(definition.provider, definition.packageName, definition, manifests),
      confidence: 'static-client-relationship', limitations: [
        'Client identity is a static relationship; wrappers, mutation, and runtime dependency injection are not evaluated.',
        ...(!definition.topLevel && !definition.defaultExport ? ['Nested/factory definitions cannot be propagated reliably.'] : []),
      ] });
  }
  report.clients.sort((a, b) => a.definition.id < b.definition.id ? -1 : a.definition.id > b.definition.id ? 1 : 0);
  report.bindings.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line);
  report.warnings = [...new Set(report.warnings)].sort();
  return { report, replacements };
}
