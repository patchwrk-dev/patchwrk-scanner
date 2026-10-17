import ts from 'typescript';
import type { ConfigurationEvidence } from '../types/configuration.ts';
import { parseApiVersionInputs } from '../compatibility/api-versions.ts';
import type { ImportedClient } from '../types/analysis.ts';
import { isCommonJsGlobal } from './module-metadata.ts';

const stripeDocs = 'https://github.com/stripe/stripe-node/wiki/Migration-guide-for-v12';
const openaiDocs = 'https://github.com/openai/openai-node';

/** Configuration rules operate only on AST nodes; no evaluator or module loading. */
export function configurationAnalyzer(source: ts.SourceFile, checker: ts.TypeChecker) {
  const evidence: ConfigurationEvidence[] = [];
  const clients = new Map<ts.Symbol, { provider: 'stripe' | 'openai'; id: string }>();
  const namespaces = new Map<ts.Symbol, Map<string, { provider: 'stripe' | 'openai'; id: string }>>();
  const literal = (node: ts.Expression | undefined): string | undefined => {
    if (!node) return undefined;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literal(node.expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isIdentifier(node)) {
      const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
      if (declaration && ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent)
        && (declaration.parent.flags & ts.NodeFlags.Const) && declaration.initializer
        && (ts.isStringLiteral(declaration.initializer) || ts.isNoSubstitutionTemplateLiteral(declaration.initializer))) return declaration.initializer.text;
    }
    return undefined;
  };
  const field = (node: ts.Expression | undefined, name: string): { node?: ts.Expression; found: boolean; uncertain: boolean } => {
    if (!node || !ts.isObjectLiteralExpression(node)) return { found: !!node, uncertain: !!node };
    const properties = node.properties.filter((entry) => entry.name
      && (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) && entry.name.text === name);
    const uncertain = node.properties.some((entry) => ts.isSpreadAssignment(entry) || (entry.name && ts.isComputedPropertyName(entry.name))) || properties.length > 1;
    const entry = properties[0];
    if (entry && ts.isPropertyAssignment(entry)) return { node: entry.initializer, found: true, uncertain };
    if (entry && ts.isShorthandPropertyAssignment(entry)) return { node: entry.name, found: true, uncertain };
    return { found: !!entry || uncertain, uncertain: !!entry || uncertain };
  };
  const add = (provider: 'stripe' | 'openai', node: ts.Node, clientId: string | null,
    kind: ConfigurationEvidence['kind'], scope: ConfigurationEvidence['scope'], type: ConfigurationEvidence['evidenceType'],
    option: ReturnType<typeof field>, packageName: string | null = provider, optionName = kind === 'model' ? 'model' : 'apiVersion') => {
    let value = option.uncertain ? undefined : literal(option.node);
    let status: ConfigurationEvidence['status'] = option.found ? value === undefined ? 'dynamic' : 'literal' : 'unknown';
    if (value !== undefined) {
      if (kind === 'api-version') {
        try { parseApiVersionInputs([`${provider}=${value}`]); } catch { value = undefined; status = 'unsupported'; }
      } else if (value.length > 128 || !/^[a-z0-9][a-z0-9._:-]*$/u.test(value) || /^(?:sk|rk|pk)[-_]/u.test(value)) {
        value = undefined; status = 'unsupported';
      }
    }
    evidence.push({ provider, packageName, file: source.fileName,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, clientId,
      kind, scope, evidenceType: type, value: value ?? null, status, origin: 'observed-source-configuration', runtimeVerified: false,
      reason: status === 'literal' ? null : status === 'unknown' ? 'Account, SDK default, or missing configuration cannot be established statically.'
        : 'Dynamic, indirect, conflicting, or unsupported configuration was not evaluated; expression contents are withheld.',
      documentationUrl: provider === 'stripe' ? stripeDocs : openaiDocs, optionName });
  };
  return {
    evidence,
    bindImported(imports: readonly ImportedClient[]) {
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) {
          const symbol = checker.getSymbolAtLocation(node);
          for (const imported of imports) {
            const definition = imported.definition;
            if (node.text !== imported.localName || !symbol || symbol.declarations?.length !== 1
              || (definition.provider !== 'stripe' && definition.provider !== 'openai')) continue;
            const declaration = symbol.declarations[0]!;
            const isImport = ts.isImportSpecifier(declaration) || ts.isImportClause(declaration) || ts.isNamespaceImport(declaration)
              || (ts.isVariableDeclaration(declaration) && declaration.parent.parent.parent === source)
              || (ts.isBindingElement(declaration) && declaration.parent.parent.parent.parent.parent === source);
            if (!isImport) continue;
            const client: { provider: 'stripe' | 'openai'; id: string } = { provider: definition.provider, id: definition.id };
            if (imported.member === null) clients.set(symbol, client);
            else {
              const members = namespaces.get(symbol) ?? new Map();
              members.set(imported.member, client); namespaces.set(symbol, members);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    },
    initialize(node: ts.CallExpression | ts.NewExpression, providerId: string, packageName: string) {
      if ((providerId !== 'stripe' && providerId !== 'openai') || packageName !== providerId) return;
      const provider = providerId;
      const id = `${source.fileName}:${node.getStart(source)}`;
      if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)
        && ts.isVariableDeclarationList(node.parent.parent) && (node.parent.parent.flags & ts.NodeFlags.Const)) {
        const symbol = checker.getSymbolAtLocation(node.parent.name);
        if (symbol) clients.set(symbol, { provider, id });
      }
      if (provider === 'stripe') {
        const option = field(node.arguments?.[1], 'apiVersion');
        add(provider, option.node ?? node, id, 'api-version', option.found ? 'client' : 'default-unresolved', option.found ? 'sdk-initialization-option' : 'unknown-default', option);
        const host = field(node.arguments?.[1], 'host');
        const protocol = field(node.arguments?.[1], 'protocol');
        if ((host.found && (host.uncertain || literal(host.node) !== 'api.stripe.com')) || protocol.found) {
          add(provider, node, id, 'api-version', 'client', 'sdk-initialization-option', { found: true, uncertain: true });
        }
      } else {
        add(provider, node, id, 'model', 'default-unresolved', 'unknown-default', { found: false, uncertain: false });
        const base = field(node.arguments?.[0], 'baseURL');
        if (base.found && (base.uncertain || !['https://api.openai.com/v1', 'https://api.openai.com/v1/'].includes(literal(base.node) ?? ''))) {
          add(provider, node, id, 'model', 'client', 'sdk-initialization-option', { found: true, uncertain: true });
        }
      }
    },
    inspect(node: ts.Node) {
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        const escaped = symbol ? clients.get(symbol) : undefined;
        const bindingName = (ts.isVariableDeclaration(node.parent) || ts.isBindingElement(node.parent)) && node.parent.name === node;
        const importName = ts.isImportSpecifier(node.parent) || ts.isImportClause(node.parent) || ts.isNamespaceImport(node.parent);
        const namespace = symbol ? namespaces.get(symbol) : undefined;
        if (namespace && !importName) {
          let expression: ts.Node = node;
          let firstMember: string | null = null;
          while (ts.isPropertyAccessExpression(expression.parent) && expression.parent.expression === expression) {
            firstMember ??= expression.parent.name.text; expression = expression.parent;
          }
          const supportedCall = firstMember !== null && namespace.has(firstMember)
            && ts.isCallExpression(expression.parent) && expression.parent.expression === expression;
          if (!supportedCall) for (const member of namespace.values()) add(member.provider, node, member.id,
            member.provider === 'openai' ? 'model' : 'api-version', 'request', member.provider === 'openai' ? 'model-parameter' : 'request-option', { found: true, uncertain: true });
        }
        if (escaped && !bindingName && !importName) {
          let expression: ts.Node = node;
          while (ts.isPropertyAccessExpression(expression.parent) && expression.parent.expression === expression) expression = expression.parent;
          const directCall = ts.isCallExpression(expression.parent) && expression.parent.expression === expression;
          let staticCjs = false;
          if (ts.isBinaryExpression(node.parent) && node.parent.right === node && node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && ts.isExpressionStatement(node.parent.parent) && node.parent.parent.parent === source) {
            const names: string[] = []; let root = node.parent.left;
            while (ts.isPropertyAccessExpression(root)) { names.unshift(root.name.text); root = root.expression; }
            staticCjs = ts.isIdentifier(root) && isCommonJsGlobal(root, checker)
              && ((root.text === 'module' && names[0] === 'exports' && names.length <= 2) || (root.text === 'exports' && names.length === 1));
          }
          const staticExport = (ts.isExportAssignment(node.parent) && !node.parent.isExportEquals) || ts.isExportSpecifier(node.parent) || staticCjs;
          if (!directCall && !staticExport && !ts.isTypeQueryNode(node.parent)) add(escaped.provider, node, escaped.id,
            escaped.provider === 'openai' ? 'model' : 'api-version', 'request', escaped.provider === 'openai' ? 'model-parameter' : 'request-option', { found: true, uncertain: true });
        }
      }
      if (!ts.isCallExpression(node)) return;
      const names: string[] = [];
      let root: ts.Expression = node.expression;
      while (ts.isPropertyAccessExpression(root)) { names.unshift(root.name.text); root = root.expression; }
      const symbol = ts.isIdentifier(root) ? checker.getSymbolAtLocation(root) : undefined;
      let client = symbol ? clients.get(symbol) : undefined;
      if (!client && symbol && names.length && namespaces.has(symbol)) {
        client = namespaces.get(symbol)?.get(names.shift()!);
      }
      if (client && names.length) {
        if (client.provider === 'stripe') {
          // Request options are accepted only on recognized SDK resource methods,
          // never an arbitrary first params object or a setter/wrapper.
          if (names.length >= 2 || names.join('.') === 'rawRequest') {
            const index = names.join('.') === 'rawRequest' ? 3 : 1;
            const options = node.arguments[index];
            for (const key of ['apiVersion', 'stripeVersion']) {
              const option = field(options, key);
              if (key === 'stripeVersion' && !option.node) continue;
              if (option.found) add('stripe', option.node ?? node, client.id, 'api-version', 'request', 'request-option', option, 'stripe', key);
            }
          }
        } else if (['completions.create', 'chat.completions.create', 'responses.create'].includes(names.join('.'))) {
          const option = field(node.arguments[0], 'model');
          add('openai', option.node ?? node, client.id, 'model', 'request', 'model-parameter', option);
        } else add('openai', node, client.id, 'model', 'request', 'model-parameter', { found: true, uncertain: true });
      }
      for (const argument of node.arguments) {
        if (!ts.isIdentifier(argument)) continue;
        const argumentSymbol = checker.getSymbolAtLocation(argument);
        const passedClient = argumentSymbol ? clients.get(argumentSymbol) : undefined;
        if (passedClient) add(passedClient.provider, node, passedClient.id,
          passedClient.provider === 'openai' ? 'model' : 'api-version', 'request', passedClient.provider === 'openai' ? 'model-parameter' : 'request-option', { found: true, uncertain: true });
      }
      // Literal, unshadowed fetch to Stripe's documented API host; no URL is emitted.
      if (ts.isIdentifier(node.expression) && node.expression.text === 'fetch' && !checker.getSymbolAtLocation(node.expression)?.declarations?.length) {
        const address = literal(node.arguments[0]);
        if (address) {
          let official = false;
          try { const url = new URL(address); official = url.protocol === 'https:' && url.hostname === 'api.stripe.com' && !url.username && !url.password && !url.port; } catch { /* Not a supported URL. */ }
          if (official) {
            const headers = field(node.arguments[1], 'headers');
            const option = headers.uncertain ? { found: true, uncertain: true } : field(headers.node, 'Stripe-Version');
            if (option.found) add('stripe', option.node ?? node, null, 'api-version', 'request', 'version-header', option, null, 'Stripe-Version');
          }
        }
      }
    },
  };
}
