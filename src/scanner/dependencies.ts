import ts from 'typescript';
import type { DeclaredVersion, DependencySection, ProviderDefinition } from '../types/index.ts';

export const dependencySections: readonly DependencySection[] = [
  'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies',
];

export function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

export function parseObject(text: string): Record<string, unknown> {
  // Reject deep structures before constructing the JSON AST or traversing it.
  let depth = 0; let quoted = false; let escaped = false;
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') { if (++depth > 64) throw new Error('JSON nesting limit.'); }
    else if (character === '}' || character === ']') depth--;
  }
  const result = object(JSON.parse(text) as unknown);
  if (!result) throw new Error('Expected a JSON object.');
  const source = ts.parseJsonText('manifest.json', text);
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const names = new Set<string>();
      for (const entry of node.properties) {
        if (!ts.isPropertyAssignment(entry) || !ts.isStringLiteral(entry.name)) throw new Error('Invalid JSON property.');
        const name = entry.name.text;
        if (names.has(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Ambiguous or unsafe JSON property.');
        names.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

export interface DependencyFinding {
  provider: string;
  packageName: string;
  line: number;
  declaration: DeclaredVersion;
}

function property(container: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  return container.properties.filter(ts.isPropertyAssignment).findLast((entry) => {
    return (ts.isStringLiteral(entry.name) || ts.isIdentifier(entry.name)) && entry.name.text === name;
  });
}

function dependencyLine(source: ts.JsonSourceFile, section: string, name: string): number {
  const statement = source.statements[0];
  if (statement && ts.isExpressionStatement(statement) && ts.isObjectLiteralExpression(statement.expression)) {
    const group = property(statement.expression, section)?.initializer;
    const entry = group && ts.isObjectLiteralExpression(group) ? property(group, name) : undefined;
    if (entry) return source.getLineAndCharacterOfPosition(entry.getStart(source)).line + 1;
  }
  return 1;
}

// Deliberately conservative: do not echo URLs/local paths that may contain secrets.
function declaredVersion(value: unknown): Pick<DeclaredVersion, 'version' | 'status'> {
  if (typeof value !== 'string' || !value.trim()) return { version: null, status: 'unknown' };
  if (value.length <= 256 && (/^[v\d^~<>=*xX][0-9A-Za-z.*+^~<>=| -]*$/u.test(value) || /^[a-z][a-z0-9-]*$/u.test(value))) {
    return { version: value, status: 'declared' };
  }
  return { version: null, status: 'unsupported' };
}

export function discoverDependencies(
  file: string,
  text: string,
  registry: readonly ProviderDefinition[],
): { manifest: Record<string, unknown>; findings: DependencyFinding[]; warnings: string[] } {
  const manifest = parseObject(text);
  const source = ts.parseJsonText(file, text);
  const findings: DependencyFinding[] = [];
  const warnings: string[] = [];
  for (const section of dependencySections) {
    const dependencies = object(manifest[section]);
    if (manifest[section] !== undefined && !dependencies) warnings.push(`Invalid ${section} object.`);
    if (!dependencies) continue;
    for (const provider of registry) for (const packageName of provider.packages) {
      if (!Object.hasOwn(dependencies, packageName)) continue;
      const declared = declaredVersion(dependencies[packageName]);
      findings.push({
        provider: provider.id, packageName, line: dependencyLine(source, section, packageName),
        declaration: {
          file, section, ...declared,
          resolvedVersion: null, resolutionStatus: 'unknown', lockfile: null,
        },
      });
      if (declared.status !== 'declared') warnings.push(`Unknown or unsupported declared version for ${packageName} in ${section}.`);
    }
  }
  return { manifest, findings, warnings };
}

function exactVersion(value: string): boolean {
  if (value.length > 256) return false;
  const match = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(value);
  return !!match && (!match[1] || match[1].split('.').every((part) => !/^0\d+$/u.test(part)));
}

/** Only same-directory npm v2/v3 direct entries with matching declarations. */
export function resolveDependency(finding: DependencyFinding, lock: Record<string, unknown>, file: string): string | undefined {
  const declaration = finding.declaration;
  if (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) {
    declaration.resolutionStatus = 'unsupported';
    return 'Unsupported npm lockfile version.';
  }
  if (declaration.status !== 'declared') {
    declaration.resolutionStatus = 'unsupported';
    return 'Resolved version unavailable for an unsupported declaration.';
  }
  const packages = object(lock.packages);
  const root = object(packages?.['']);
  const entry = object(packages?.[`node_modules/${finding.packageName}`]);
  const section = object(root?.[declaration.section]);
  if (!section || section[finding.packageName] !== declaration.version) return 'Lockfile declaration is missing or differs from package.json.';
  if (!entry || entry.link || (entry.name !== undefined && entry.name !== finding.packageName)
    || typeof entry.version !== 'string' || !exactVersion(entry.version)) {
    return 'No reliable direct SDK version in npm lockfile.';
  }
  declaration.resolvedVersion = entry.version;
  declaration.resolutionStatus = 'lockfile';
  declaration.lockfile = file;
  return undefined;
}
