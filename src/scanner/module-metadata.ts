import ts from 'typescript';
import type { ClientDefinition } from '../types/analysis.ts';

export interface ModuleImport { localName: string; importedName: string; module: string; line: number; kind: 'esm' | 'require' }
export interface ModuleExport { name: string; localName: string | null; module: string | null; importedName: string; definitionId: string | null }
export interface ModuleMetadata { imports: ModuleImport[]; exports: ModuleExport[]; definitions: ClientDefinition[]; commonJsDefault?: boolean }

/** TS synthesizes CommonJS symbols from assignments; local declarations still shadow them. */
export function isCommonJsGlobal(node: ts.Identifier, checker: ts.TypeChecker): boolean {
  const declarations = checker.getSymbolAtLocation(node)?.declarations ?? [];
  return declarations.every((declaration) => {
    let expression: ts.Node = declaration;
    if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) {
      while (ts.isPropertyAccessExpression(expression.parent) && expression.parent.expression === expression) expression = expression.parent;
    }
    const assignment = ts.isPropertyAccessExpression(expression) && ts.isBinaryExpression(expression.parent) && expression.parent.left === expression
      ? expression.parent : expression;
    if (!ts.isBinaryExpression(assignment) || assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
    const names: string[] = []; let root = assignment.left;
    while (ts.isPropertyAccessExpression(root)) { names.unshift(root.name.text); root = root.expression; }
    return ts.isIdentifier(root) && ((root.text === 'module' && names[0] === 'exports' && names.length <= 2)
      || (root.text === 'exports' && names.length === 1));
  });
}

export function moduleMetadata(source: ts.SourceFile, definitions: ClientDefinition[], checker: ts.TypeChecker): ModuleMetadata {
  const imports: ModuleImport[] = [];
  const exports: ModuleExport[] = [];
  let commonJsDefault = false;
  const line = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const localExport = (name: string, localName: string) => exports.push({ name, localName, module: null, importedName: name, definitionId: null });
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && !statement.importClause?.isTypeOnly) {
      const clause = statement.importClause;
      if (clause?.name) imports.push({ localName: clause.name.text, importedName: 'default', module: statement.moduleSpecifier.text, line: line(statement), kind: 'esm' });
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) imports.push({ localName: clause.namedBindings.name.text, importedName: '*', module: statement.moduleSpecifier.text, line: line(statement), kind: 'esm' });
        else for (const entry of clause.namedBindings.elements) if (!entry.isTypeOnly) imports.push({ localName: entry.name.text, importedName: entry.propertyName?.text ?? entry.name.text, module: statement.moduleSpecifier.text, line: line(statement), kind: 'esm' });
      }
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const entry of statement.exportClause.elements) if (!entry.isTypeOnly) exports.push({
        name: entry.name.text, localName: statement.moduleSpecifier ? null : entry.propertyName?.text ?? entry.name.text,
        module: statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null,
        importedName: entry.propertyName?.text ?? entry.name.text, definitionId: null,
      });
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      if (ts.isIdentifier(statement.expression)) localExport('default', statement.expression.text);
      else {
        const definition = definitions.find((entry) => entry.defaultExport && entry.id === `${source.fileName}:${statement.expression.getStart(source)}`);
        if (definition) exports.push({ name: 'default', localName: null, module: null, importedName: 'default', definitionId: definition.id });
      }
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) && ts.isIdentifier(declaration.name)) localExport(declaration.name.text, declaration.name.text);
        if (!(statement.declarationList.flags & ts.NodeFlags.Const) || !declaration.initializer) continue;
        let initializer = declaration.initializer;
        let selected: string | null = null;
        if (ts.isPropertyAccessExpression(initializer)) { selected = initializer.name.text; initializer = initializer.expression; }
        if (!ts.isCallExpression(initializer) || !ts.isIdentifier(initializer.expression) || initializer.expression.text !== 'require'
          || checker.getSymbolAtLocation(initializer.expression)?.declarations?.length
          || initializer.arguments.length !== 1 || !initializer.arguments[0] || !ts.isStringLiteral(initializer.arguments[0])) continue;
        // Shadowed require is rejected again by the single-file symbol analyzer.
        const module = initializer.arguments[0].text;
        if (ts.isIdentifier(declaration.name)) imports.push({ localName: declaration.name.text, importedName: selected ?? '*', module, line: line(declaration), kind: 'require' });
        else if (ts.isObjectBindingPattern(declaration.name) && selected === null) for (const entry of declaration.name.elements) {
          if (ts.isIdentifier(entry.name) && !entry.dotDotDotToken && !entry.initializer
            && (!entry.propertyName || ts.isIdentifier(entry.propertyName))) imports.push({ localName: entry.name.text, importedName: entry.propertyName && ts.isIdentifier(entry.propertyName) ? entry.propertyName.text : entry.name.text, module, line: line(declaration), kind: 'require' });
        }
      }
    }
    if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(statement.expression.right)) {
      const left = statement.expression.left;
      if (ts.isPropertyAccessExpression(left)) {
        let base: ts.Expression = left;
        while (ts.isPropertyAccessExpression(base)) base = base.expression;
        if (!ts.isIdentifier(base) || !isCommonJsGlobal(base, checker)) continue;
        if (ts.isIdentifier(left.expression) && left.expression.text === 'module' && left.name.text === 'exports') { localExport('default', statement.expression.right.text); commonJsDefault = true; }
        if (ts.isIdentifier(left.expression) && left.expression.text === 'exports') localExport(left.name.text, statement.expression.right.text);
        if (ts.isPropertyAccessExpression(left.expression) && ts.isIdentifier(left.expression.expression)
          && left.expression.expression.text === 'module' && left.expression.name.text === 'exports') localExport(left.name.text, statement.expression.right.text);
      }
    }
  }
  return { imports, exports, definitions, commonJsDefault };
}
