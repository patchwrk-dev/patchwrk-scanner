import type { ScanReport } from '../types/index.ts';
import type { CompatibilityScanReport } from '../types/compatibility.ts';
import { formatCompatibilityTerminal } from './compatibility.ts';

export function formatJson(report: ScanReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatTerminal(report: ScanReport | CompatibilityScanReport): string {
  return [
    'PatchWRK Scanner',
    `Directory: ${JSON.stringify(report.directory)}`,
    `Integrations: ${report.integrations.length}`,
    ...(report.analysis ? [
      `Module analysis: ${report.analysis.modulesAnalyzed} modules, ${report.analysis.edgesInspected} edges; ${report.analysis.complete ? 'indexed scope analyzed' : 'partial coverage'}`,
      ...report.analysis.bindings.map((binding) => `Manifest resolution: ${JSON.stringify(binding.file)}:${binding.line} ${binding.packageName} -> ${JSON.stringify(binding.manifest)} (${binding.status}, ${binding.basis})`),
      ...report.analysis.clients.flatMap((client) => [
        `Client definition: ${client.definition.provider} ${JSON.stringify(client.definition.file)}:${client.definition.line}; confidence ${client.confidence}`,
        ...client.usages.map((usage) => `  Related reference: ${JSON.stringify(usage.file)}:${usage.line}`),
      ]),
      ...report.analysis.warnings.map((warning) => `Analysis warning: ${warning}`),
    ] : []),
    ...(report.configuration ?? []).map((configuration) => `Observed configuration: ${configuration.provider} ${configuration.kind} ${JSON.stringify(configuration.file)}:${configuration.line} ${configuration.scope} ${configuration.evidenceType}; ${configuration.status} ${JSON.stringify(configuration.value)} (not runtime verified)`),
    ...report.integrations.flatMap((item) => [
      `${item.provider} (${item.packageName})`,
      ...(item.declaredVersions.length ? item.declaredVersions.map((version) =>
        `  Declared: ${JSON.stringify(version.version ?? version.status)}; resolved: ${JSON.stringify(version.resolvedVersion ?? version.resolutionStatus)} (${JSON.stringify(version.file)}, ${version.section})`)
        : ['  Declared: unknown; resolved: unknown']),
      ...item.locations.map((location) => `  ${JSON.stringify(location.file)}:${location.line} ${location.type}${location.typeOnly ? ' (type only)' : ''}`),
    ]),
    `Coverage: ${report.coverage.filesScanned} files, ${report.coverage.bytesScanned} bytes; ${report.coverage.complete ? 'eligible files scanned' : 'partial scan'}`,
    ...report.warnings.map((warning) => `Warning: ${warning}`),
    ...report.coverage.limitations.map((limitation) => `Limitation: ${limitation}`),
    ...('compatibility' in report ? [formatCompatibilityTerminal(report.compatibility)] : []),
  ].join('\n');
}
