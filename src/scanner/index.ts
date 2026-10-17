import { lstat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, parse, resolve, sep } from 'node:path';
import type { Integration, ScanOptions, ScanReport } from '../types/index.ts';
import { providers, validateRegistry } from '../providers/index.ts';
import { configureLimits, lockNames } from './policy.ts';
import { SafeScope } from './filesystem.ts';
import { analyzeSource } from './source.ts';
import { discoverDependencies, parseObject, resolveDependency } from './dependencies.ts';
import type { DependencyFinding } from './dependencies.ts';
import { analyzeModules, moduleLimits } from './modules.ts';
import type { IndexedModule } from './modules.ts';

export async function validateDirectory(input: string): Promise<string> {
  if (!input || input.includes('\0')) throw new Error('Invalid directory path.');
  if (input.split(/[\\/]/u).includes('..')) {
    throw new Error('Parent traversal (..) is not allowed; use a direct path.');
  }
  const directory = resolve(input);
  const root = parse(directory).root;
  if (!isAbsolute(directory) || directory === root) {
    throw new Error('Scanning a filesystem root is not allowed.');
  }
  // Reject symlinks in every path component before descending into it.
  let current = root;
  for (const component of directory.slice(root.length).split(sep)) {
    current = resolve(current, component);
    let info;
    try {
      info = await lstat(current);
    } catch {
      throw new Error('Directory does not exist or cannot be accessed.');
    }
    if (info.isSymbolicLink()) throw new Error('Symbolic link paths are not allowed.');
    if (!info.isDirectory()) throw new Error('Scan target must be a directory.');
  }
  return directory;
}

export async function scanRepository(input: string, options: ScanOptions = {}): Promise<ScanReport> {
  const directory = await validateDirectory(input);
  const registry = options.providers ?? providers;
  const analysisLimits = moduleLimits(options.analysisLimits);
  validateRegistry(registry);
  const report: ScanReport = {
    schemaVersion: 2,
    directory,
    status: 'discovery',
    integrations: [],
    configuration: [],
    warnings: [],
    coverage: {
      filesScanned: 0, bytesScanned: 0, entriesVisited: 0, filesSkipped: 0,
      complete: true, limits: configureLimits(options.limits),
      limitations: [
        'Static SDK evidence does not prove active API usage or compatibility.',
        'Only registry packages, literal imports/requires, and directly bound client patterns are supported.',
        'Hidden, credential, generated, dependency, build, vendor, and fixture paths are excluded; custom ignore files are not interpreted.',
        'Only same-directory npm lockfile v2/v3 direct entries are interpreted; other formats and workspace resolutions remain unknown.',
        'Scan a stable checkout; portable Node filesystem checks are not a sandbox against hostile concurrent ancestor replacement.',
      ],
    },
  };
  const scope = new SafeScope(directory, report);
  await scope.initialize();
  const integrations = new Map<string, Integration>();
  const integration = (provider: string, packageName: string): Integration => {
    const key = `${provider}:${packageName}`;
    let item = integrations.get(key);
    if (!item) {
      item = { provider, packageName, declaredVersions: [], locations: [] };
      integrations.set(key, item);
    }
    return item;
  };
  const dependencies: DependencyFinding[] = [];
  const manifests = new Map<string, Record<string, unknown>>();
  const modules = new Map<string, IndexedModule>();
  let modulesTruncated = false;
  const locks = new Map<string, Record<string, unknown>>();
  const unsupportedLocks = new Set<string>();
  let rootManifest = false;
  for await (const path of scope.files()) {
    const name = basename(path);
    const file = scope.label(path);
    if (name === 'package.json' && dirname(path) === directory) rootManifest = true;
    if (lockNames.has(name) && name !== 'package-lock.json' && name !== 'npm-shrinkwrap.json') {
      unsupportedLocks.add(dirname(path));
      scope.warn(`Unsupported lockfile ${JSON.stringify(file)}; resolved versions remain unknown.`, false);
      continue; // Do not read unsupported formats.
    }
    const text = await scope.read(path);
    if (text === undefined) continue;
    if (name === 'package.json') {
      try {
        const result = discoverDependencies(file, text, registry);
        manifests.set(file, result.manifest);
        dependencies.push(...result.findings);
        for (const warning of result.warnings) scope.warn(`${JSON.stringify(file)}: ${warning}`);
      } catch {
        scope.warn(`Malformed package.json ${JSON.stringify(file)}; dependency analysis skipped.`);
      }
    } else if (lockNames.has(name)) {
      try {
        locks.set(path, parseObject(text));
      } catch {
        scope.warn(`Malformed npm lockfile ${JSON.stringify(file)}; resolved versions remain unknown.`);
      }
    } else {
      try {
        const result = analyzeSource(file, text, registry);
        if (modules.size < analysisLimits.maxModules) modules.set(file, { text, result });
        else modulesTruncated = true;
        report.configuration!.push(...result.configurations);
        for (const finding of result.findings) integration(finding.provider, finding.packageName).locations.push(finding.evidence);
        for (const warning of result.warnings) scope.warn(`${JSON.stringify(file)}: ${warning}`);
      } catch {
        scope.warn(`Source analysis failed for ${JSON.stringify(file)}.`);
      }
    }
  }
  if (!rootManifest) scope.warn('No root package.json found; declared versions may be unknown.', false);
  for (const finding of dependencies) {
    const manifestDirectory = dirname(resolve(directory, finding.declaration.file));
    const shrinkwrapPath = resolve(manifestDirectory, 'npm-shrinkwrap.json');
    const packageLockPath = resolve(manifestDirectory, 'package-lock.json');
    const lockPath = scope.encounteredLocks.has(shrinkwrapPath) ? shrinkwrapPath : packageLockPath;
    const lock = locks.get(lockPath);
    if (lock) {
      const warning = resolveDependency(finding, lock, scope.label(lockPath));
      if (warning) scope.warn(`${JSON.stringify(finding.declaration.file)} (${finding.packageName}): ${warning}`, false);
    } else if (unsupportedLocks.has(manifestDirectory)) {
      finding.declaration.resolutionStatus = 'unsupported';
    }
    const item = integration(finding.provider, finding.packageName);
    item.declaredVersions.push(finding.declaration);
    item.locations.push({ file: finding.declaration.file, line: finding.line, type: 'dependency', typeOnly: false });
  }
  const moduleAnalysis = analyzeModules(modules, registry, {
    documents: manifests, observed: new Set([...scope.encounteredManifests].map((path) => scope.label(path))), declarations: dependencies,
  }, analysisLimits);
  report.analysis = moduleAnalysis.report;
  if (modulesTruncated) {
    report.analysis.complete = false;
    report.analysis.warnings.push('Module count limit reached; cross-file coverage is partial.');
  }
  for (const [file, result] of moduleAnalysis.replacements) {
    report.configuration = report.configuration!.filter((item) => item.file !== file);
    report.configuration.push(...result.configurations);
    for (const finding of result.findings) integration(finding.provider, finding.packageName).locations.push(finding.evidence);
  }
  for (const client of report.analysis.clients) {
    const usages = [...client.usages, ...report.configuration!.filter((item) => item.clientId === client.definition.id && item.scope === 'request')
      .map((item) => ({ file: item.file, line: item.line, type: 'client-reference' as const, typeOnly: false }))];
    const seenUsages = new Set<string>();
    client.usages = usages.filter((value) => {
      const key = JSON.stringify([value.file, value.line]);
      if (seenUsages.has(key)) return false;
      seenUsages.add(key); return true;
    })
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  }
  if (!report.analysis.complete) scope.warn('Cross-file analysis is incomplete; compatibility conclusions remain conditional.');
  report.integrations = [...integrations.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.packageName.localeCompare(b.packageName));
  for (const item of report.integrations) {
    item.declaredVersions.sort((a, b) => a.file.localeCompare(b.file) || a.section.localeCompare(b.section));
    const seenLocations = new Set<string>();
    item.locations = item.locations.filter((value) => {
      const key = JSON.stringify([value.file, value.line, value.type, value.typeOnly]);
      if (seenLocations.has(key)) return false;
      seenLocations.add(key); return true;
    })
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.type.localeCompare(b.type));
    if (!item.declaredVersions.length) scope.warn(`No supported declaration for ${item.packageName}; declared and resolved versions are unknown.`, false);
  }
  report.warnings = [...new Set(report.warnings)].sort();
  report.configuration!.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.evidenceType.localeCompare(b.evidenceType));
  const seenConfiguration = new Set<string>();
  report.configuration = report.configuration!.filter((item) => {
    const key = JSON.stringify(item);
    if (seenConfiguration.has(key)) return false;
    seenConfiguration.add(key);
    return true;
  });
  return report;
}
