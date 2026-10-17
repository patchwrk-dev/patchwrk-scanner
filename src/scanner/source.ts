import ts from 'typescript';
import type { DetectionEvidence, ProviderDefinition } from '../types/index.ts';
import type { ConfigurationEvidence } from '../types/configuration.ts';
import { configurationAnalyzer } from './configuration.ts';
import type { ClientDefinition, ImportedClient } from '../types/analysis.ts';
import { moduleMetadata } from './module-metadata.ts';
import type { ModuleMetadata } from './module-metadata.ts';

interface Binding {
  provider: ProviderDefinition;
  packageName: string;
  exported: string;
  typeOnly: boolean;
}

export interface SourceFinding {
  provider: string;
  packageName: string;
  evidence: DetectionEvidence;
}

export function analyzeSource(
  file: string,
  text: string,
  registry: readonly ProviderDefinition[],
  importedClients: readonly ImportedClient[] = [],
): { findings: SourceFinding[]; warnings: string[]; configurations: ConfigurationEvidence[]; module: ModuleMetadata } {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  // Bound our recursive visitors and checker input after the byte-bounded parser.
  const pending: { node: ts.Node; depth: number }[] = [{ node: source, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++nodes > 50_000 || current.depth > 128) {
      return { findings: [], configurations: [], module: { imports: [], exports: [], definitions: [] }, warnings: ['Source AST resource limit; analysis skipped.'] };
    }
    ts.forEachChild(current.node, (node) => { pending.push({ node, depth: current.depth + 1 }); });
  }
  // In-memory host: no tsconfig, libraries, import resolution, or filesystem access.
  const host: ts.CompilerHost = {
    getSourceFile: (name) => name === file ? source : undefined,
    getDefaultLibFileName: () => '', writeFile: () => undefined,
    getCurrentDirectory: () => '', getDirectories: () => [],
    fileExists: (name) => name === file, readFile: () => undefined,
    getCanonicalFileName: (name) => name, useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n', resolveModuleNames: (names) => names.map(() => undefined),
  };
  const program = ts.createProgram([file], { allowJs: true, noLib: true, noResolve: true, noEmit: true }, host);
  const warnings: string[] = [];
  if (program.getSyntacticDiagnostics(source).length) {
    return { findings: [], configurations: [], module: { imports: [], exports: [], definitions: [] }, warnings: ['Unsupported or malformed syntax; source analysis skipped.'] };
  }
  // Generated headers are inspected only within already bounded, allowed source files.
  if (/[@#]\s*(?:generated|auto-generated)\b/iu.test(text.slice(0, 512))) {
    return { findings: [], configurations: [], module: { imports: [], exports: [], definitions: [] }, warnings: ['Generated source header; source analysis skipped.'] };
  }
  const checker = program.getTypeChecker();
  const configuration = configurationAnalyzer(source, checker);
  configuration.bindImported(importedClients);
  const definitions: ClientDefinition[] = [];
  const bindings = new Map<ts.Symbol, Binding>();
  const findings: SourceFinding[] = [];
  const topLevelBindings = new Map<string, number>();
  const count = (name: string) => topLevelBindings.set(name, (topLevelBindings.get(name) ?? 0) + 1);
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name) count(clause.name.text);
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) count(clause.namedBindings.name.text);
        else for (const entry of clause.namedBindings.elements) count(entry.name.text);
      }
    }
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) count(declaration.name.text);
  }
  const match = (name: string) => registry.find((provider) => provider.packages.some((packageName) => name === packageName
    || (name.startsWith(`${packageName}/`) && name.slice(packageName.length + 1).split('/').every((part) => /^[A-Za-z0-9_.-]+$/u.test(part) && part !== '.' && part !== '..'))));
  const packageFor = (provider: ProviderDefinition, name: string) => provider.packages.find((packageName) => name === packageName || name.startsWith(`${packageName}/`))!;
  const add = (node: ts.Node, binding: Binding, type: DetectionEvidence['type']) => {
    findings.push({
      provider: binding.provider.id, packageName: binding.packageName,
      evidence: { file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, type, typeOnly: binding.typeOnly },
    });
  };
  const bind = (identifier: ts.Identifier, binding: Binding) => {
    const topLevel = ts.isImportSpecifier(identifier.parent) || ts.isImportClause(identifier.parent) || ts.isNamespaceImport(identifier.parent)
      || (ts.isVariableDeclaration(identifier.parent) && identifier.parent.parent.parent.parent === source);
    if (topLevel && (topLevelBindings.get(identifier.text) ?? 0) > 1) { warnings.push('Ambiguous SDK binding; client initialization is not inferred.'); return; }
    const symbol = checker.getSymbolAtLocation(identifier);
    if (symbol && symbol.declarations?.length === 1) bindings.set(symbol, binding);
    else if (symbol) warnings.push('Ambiguous SDK binding; client initialization is not inferred.');
  };
  const requireBinding = (node: ts.Node): Binding | undefined => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'require'
      || checker.getSymbolAtLocation(node.expression)?.declarations?.length || node.arguments.length !== 1) return undefined;
    const argument = node.arguments[0];
    if (!argument || !ts.isStringLiteral(argument)) {
      warnings.push('Dynamic require cannot be resolved statically.');
      return undefined;
    }
    const provider = match(argument.text);
    return provider ? { provider, packageName: packageFor(provider, argument.text), exported: argument.text === packageFor(provider, argument.text) ? 'default' : 'unsupported-subpath', typeOnly: false } : undefined;
  };

  const collect = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const provider = match(node.moduleSpecifier.text);
      if (provider) {
        const clause = node.importClause;
        const allNamedTypes = clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
          && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((specifier) => specifier.isTypeOnly);
        const binding: Binding = {
          provider, packageName: packageFor(provider, node.moduleSpecifier.text), exported: node.moduleSpecifier.text === packageFor(provider, node.moduleSpecifier.text) ? 'default' : 'unsupported-subpath',
          typeOnly: (clause?.isTypeOnly ?? false) || (!clause?.name && !!allNamedTypes),
        };
        add(node, binding, 'esm-import');
        if (clause?.name) bind(clause.name, binding);
        if (clause?.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) bind(clause.namedBindings.name, { ...binding, exported: binding.exported === 'unsupported-subpath' ? 'unsupported-subpath' : '*' });
          else for (const specifier of clause.namedBindings.elements) {
            bind(specifier.name, { ...binding, exported: binding.exported === 'unsupported-subpath' ? 'unsupported-subpath' : specifier.propertyName?.text ?? specifier.name.text, typeOnly: binding.typeOnly || specifier.isTypeOnly });
          }
        }
      }
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const argument = node.moduleReference.expression;
      const provider = argument && ts.isStringLiteral(argument) ? match(argument.text) : undefined;
      if (provider && argument && ts.isStringLiteral(argument)) {
        const binding = { provider, packageName: packageFor(provider, argument.text), exported: argument.text === packageFor(provider, argument.text) ? 'default' : 'unsupported-subpath', typeOnly: node.isTypeOnly };
        bind(node.name, binding);
        add(node, binding, 'commonjs-require');
      }
    }
    const required = requireBinding(node);
    if (required) add(node, required, 'commonjs-require');
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const binding = requireBinding(node.initializer);
      if (binding && ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const)) {
        if (ts.isIdentifier(node.name)) bind(node.name, binding);
        else if (ts.isObjectBindingPattern(node.name)) for (const element of node.name.elements) {
          if (ts.isIdentifier(element.name) && !element.dotDotDotToken && !element.initializer
            && (!element.propertyName || ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName))) {
            const exported = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : element.name.text;
            bind(element.name, { ...binding, exported: binding.exported === 'unsupported-subpath' ? 'unsupported-subpath' : exported });
          }
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const reference = (expression: ts.Expression): Binding | undefined => {
    if (ts.isParenthesizedExpression(expression)) return reference(expression.expression);
    const required = requireBinding(expression);
    if (required) return required;
    if (ts.isIdentifier(expression)) {
      const symbol = checker.getSymbolAtLocation(expression);
      return symbol ? bindings.get(symbol) : undefined;
    }
    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
      const symbol = checker.getSymbolAtLocation(expression.expression);
      const binding = symbol ? bindings.get(symbol) : undefined;
      if (binding && ['*', 'default'].includes(binding.exported)) return { ...binding, exported: expression.name.text };
    }
    return undefined;
  };
  const inspect = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const binding = reference(node.expression);
      if (binding && !binding.typeOnly) {
        const constructor = ts.isNewExpression(node);
        const allowed = constructor ? binding.provider.constructors : binding.provider.factories;
        const defaultAllowed = constructor ? binding.provider.defaultConstructor : binding.provider.defaultFactory;
        if ((binding.exported === 'default' && defaultAllowed) || allowed.includes(binding.exported)) {
          add(node, binding, 'client-initialization');
          configuration.initialize(node, binding.provider.id, binding.packageName);
          const variable = ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)
            && ts.isVariableDeclarationList(node.parent.parent) && (node.parent.parent.flags & ts.NodeFlags.Const) ? node.parent : undefined;
          definitions.push({ id: `${file}:${node.getStart(source)}`, provider: binding.provider.id, packageName: binding.packageName,
            file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            localName: variable && ts.isIdentifier(variable.name) ? variable.name.text : null,
            topLevel: !!variable && variable.parent.parent.parent === source,
            defaultExport: ts.isExportAssignment(node.parent) && node.parent.parent === source && !node.parent.isExportEquals });
        }
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        warnings.push('Dynamic imports are not analyzed.');
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
  const inspectConfiguration = (node: ts.Node): void => { configuration.inspect(node); ts.forEachChild(node, inspectConfiguration); };
  inspectConfiguration(source);
  for (const client of importedClients) findings.push({ provider: client.definition.provider, packageName: client.definition.packageName,
    evidence: { file, line: client.line, type: 'client-reference', typeOnly: false } });
  return { findings, warnings: [...new Set(warnings)], configurations: configuration.evidence, module: moduleMetadata(source, definitions, checker) };
}
