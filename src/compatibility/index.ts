import type { Integration, ScanOptions, ScanReport } from '../types/index.ts';
import type { ApiChange, ChangeCatalogRepository } from '../types/changes.ts';
import type { ApiVersionDeclaration, CompatibilityAssessment, CompatibilityScanReport, CompatibilityStatus, CompatibilitySummary, VersionEvaluation } from '../types/compatibility.ts';
import { LocalChangeCatalog, validateCatalog } from '../changes/catalog.ts';
import { assertJsonData, compare } from '../changes/validation.ts';
import { scanRepository } from '../scanner/index.ts';
import { parseApiVersionInputs } from './api-versions.ts';
import { evaluateApiVersion, evaluateSdkVersions } from './versions.ts';
import type { ConfigurationEvidence } from '../types/configuration.ts';
import { evaluateObservedApi, evaluateTargetConfiguration } from './configuration.ts';
import type { ClientAnalysis } from '../types/analysis.ts';

export const matchingLimits = {
  maxAssessments: 200, maxLocationsPerAssessment: 100, maxDeclarationsPerAssessment: 100,
} as const;

function statusFor(sdk: VersionEvaluation, api: VersionEvaluation, verified: boolean, target?: VersionEvaluation): CompatibilityStatus {
  const active = [sdk, api, ...(target ? [target] : [])].filter((evaluation) => evaluation.outcome !== 'not-specified');
  if (!active.length || active.every((evaluation) => evaluation.outcome === 'unknown')) return 'unknown';
  // Cross-dimension AND/OR semantics are not represented in catalog v1: agreement
  // permits conclusions, disagreement/unknowns preserve uncertainty.
  if (!verified) return 'potentially-affected';
  if (active.every((evaluation) => evaluation.outcome === 'matches')) return 'affected';
  if (active.every((evaluation) => evaluation.outcome === 'excludes')) return 'not-affected-by-this-change';
  return 'potentially-affected';
}

function assessment(integration: Integration, change: ApiChange, api: ApiVersionDeclaration | undefined, complete: boolean, configurations: ConfigurationEvidence[], client?: ClientAnalysis): CompatibilityAssessment {
  const sdkEvaluation = evaluateSdkVersions(integration.declaredVersions, change.affectedSdks, integration.packageName);
  const apiEvaluation = configurations.length ? evaluateObservedApi(configurations, change, api) : evaluateApiVersion(api, change.affectedApiVersions);
  const configurationEvaluation = evaluateTargetConfiguration(configurations, change);
  const verified = change.verification.status === 'verified' && change.category !== 'unknown';
  let status = statusFor(sdkEvaluation, apiEvaluation, verified, configurationEvaluation);
  if (!complete && (status === 'affected' || status === 'not-affected-by-this-change')) status = 'potentially-affected';
  const unknowns = [
    ...(sdkEvaluation.outcome === 'unknown' || sdkEvaluation.outcome === 'uncertain' ? ['Installed SDK version applicability is unresolved.'] : []),
    ...(!api && !configurations.some((item) => item.kind === 'api-version' && item.status === 'literal') ? ['Remote API version is unknown; SDK versions do not establish it.'] : ['Declared or observed source configuration is not verified runtime configuration.']),
    ...(!verified ? ['The change is unverified, illustrative, or has an unknown category.'] : []),
    ...(!complete ? ['Repository discovery coverage is partial.'] : []),
    ...(change.targets.length ? ['Use of documented endpoints, methods, or symbols has not been established.'] : []),
  ];
  const rationale = [
    ...sdkEvaluation.rationale, ...apiEvaluation.rationale, ...configurationEvaluation.rationale,
    ...(status === 'potentially-affected' ? ['Evidence is incomplete, conflicting, conditional, or lacks verified change metadata.'] : []),
  ];
  const locations = [...integration.locations].sort((a, b) => compare(a.file, b.file) || a.line - b.line || compare(a.type, b.type));
  const declarations = [...integration.declaredVersions].sort((a, b) => compare(a.file, b.file) || compare(a.section, b.section)
    || compare(a.resolvedVersion ?? '', b.resolvedVersion ?? '') || compare(a.version ?? '', b.version ?? ''));
  const displayComplete = locations.length <= matchingLimits.maxLocationsPerAssessment && declarations.length <= matchingLimits.maxDeclarationsPerAssessment && configurations.length <= 100;
  const displayedLocations = structuredClone(locations.slice(0, matchingLimits.maxLocationsPerAssessment));
  return {
    provider: change.provider, packageName: integration.packageName, locations: displayedLocations,
    ...(client ? { client: structuredClone({ ...client, usages: client.usages.slice(0, matchingLimits.maxLocationsPerAssessment),
      manifestResolution: { ...client.manifestResolution, declarations: client.manifestResolution.declarations.slice(0, matchingLimits.maxDeclarationsPerAssessment) } }) } : {}),
    changeId: change.id, changeRecord: structuredClone(change), configurationEvidence: structuredClone(configurations.slice(0, 100)), configurationEvaluation,
    category: change.category, lastReviewedAt: change.lastReviewedAt, officialSourceUrl: change.officialSourceUrl,
    verification: structuredClone(change.verification), provenance: structuredClone(change.provenance), sourceEvidence: structuredClone(change.evidence),
    status, scope: configurationEvaluation.outcome === 'not-specified' ? 'documented-version-applicability' : 'documented-configuration-applicability',
    evidenceLevel: status === 'affected' || status === 'not-affected-by-this-change' ? 'supported-version-evidence'
      : status === 'potentially-affected' ? 'partial-evidence' : 'insufficient-evidence',
    sdkEvaluation, apiEvaluation,
    facts: { kind: 'observed-repository-metadata', sdkDeclarations: structuredClone(declarations.slice(0, matchingLimits.maxDeclarationsPerAssessment)), locations: displayedLocations, displayComplete },
    userDeclared: api ? [structuredClone(api)] : [],
    inferred: { kind: 'deterministic-version-comparison', rationale }, unknowns,
    limitations: [
      'Applicability is conditional on repository metadata and supplied API versions; deployed configuration is not verified.',
      'A version match does not establish endpoint usage, production breakage, or repository health.',
      client ? 'SDK evidence is scoped to the original client definition manifest; runtime module resolution is not verified.' : 'SDK versions across manifests are aggregated; imports are not resolved to a specific manifest.',
      'API ranges and cross-dimension constraint logic are not inferred; disagreement is inconclusive.',
      'Catalog verification metadata is a manual attestation, not independent proof of authenticity.',
      ...(!displayComplete ? ['Evidence display is truncated; full evidence remains in scanner integrations and all SDK declarations were evaluated.'] : []),
    ],
  };
}

export function assessCompatibility(scan: ScanReport, catalogInput: unknown, apiVersionInputs: readonly string[] = []): CompatibilitySummary {
  assertJsonData(scan);
  const catalog = validateCatalog(catalogInput);
  const apiVersionDeclarations = parseApiVersionInputs(apiVersionInputs);
  const assessments: CompatibilityAssessment[] = [];
  let assessmentsTruncated = false;
  const scoped: { integration: Integration; client?: ClientAnalysis }[] = [];
  for (const integration of scan.integrations) {
    const clients = scan.analysis?.clients.filter((item) => item.definition.provider === integration.provider && item.definition.packageName === integration.packageName) ?? [];
    if (!clients.length) scoped.push({ integration });
    else for (const client of clients) scoped.push({ client, integration: {
      provider: integration.provider, packageName: integration.packageName,
      declaredVersions: client.manifestResolution.status === 'resolved' ? client.manifestResolution.declarations : [],
      locations: [{file:client.definition.file,line:client.definition.line,type:'client-initialization',typeOnly:false}, ...client.usages],
    } });
  }
  scoped.sort((a, b) => compare(a.integration.provider,b.integration.provider) || compare(a.integration.packageName,b.integration.packageName) || compare(a.client?.definition.id ?? '', b.client?.definition.id ?? ''));
  for (const { integration, client } of scoped) for (const change of catalog.changes) {
    if (change.provider !== integration.provider) continue;
    if (change.affectedSdks.length && !change.affectedSdks.some((sdk) => sdk.packageName === integration.packageName)) continue;
    if (assessments.length >= matchingLimits.maxAssessments) { assessmentsTruncated = true; continue; }
    const complete = scan.coverage.complete && (!scan.analysis || (scan.analysis.complete && (!client || client.definition.topLevel || client.definition.defaultExport)));
    assessments.push(assessment(integration, change, apiVersionDeclarations.find((evidence) => evidence.provider === change.provider), complete,
      (scan.configuration ?? []).filter((item) => item.provider === integration.provider && (item.packageName === null || item.packageName === integration.packageName)
        && (!client || item.clientId === client.definition.id)), client));
  }
  assessments.sort((a, b) => compare(a.provider, b.provider) || compare(a.packageName, b.packageName) || compare(a.changeId, b.changeId) || compare(a.client?.definition.id ?? '', b.client?.definition.id ?? ''));
  return {
    schemaVersion: 1, catalogVersion: catalog.catalogVersion, catalogRecordCount: catalog.changes.length,
    apiVersionDeclarations, assessments,
    coverage: {
      complete: scan.coverage.complete && !assessmentsTruncated && assessments.every((item) => item.facts.displayComplete),
      assessmentsTruncated, evidenceDisplayTruncated: assessments.some((item) => !item.facts.displayComplete), limits: { ...matchingLimits },
    },
    warnings: [
      'Offline curated catalog only; no live monitoring or runtime verification.',
      'No matched assessments does not establish compatibility or repository health.',
      ...(assessmentsTruncated ? ['Compatibility assessment limit reached; remaining candidates were not evaluated.'] : []),
      ...apiVersionDeclarations.filter((evidence) => !scan.integrations.some((integration) => integration.provider === evidence.provider))
        .map((evidence) => `API version supplied for ${evidence.provider}, but no integration was discovered for that provider.`),
    ],
    limitations: ['Discovery coverage and catalog scope limit these assessments.', 'Statuses apply to a specific documented change and version evidence, not an entire integration or repository.'],
  };
}

export interface CompatibilityScanOptions {
  scan?: ScanOptions;
  apiVersionInputs?: readonly string[];
  catalog?: ChangeCatalogRepository;
}

export async function scanWithCompatibility(directory: string, options: CompatibilityScanOptions = {}): Promise<CompatibilityScanReport> {
  // Reject input before touching the selected repository.
  parseApiVersionInputs(options.apiVersionInputs ?? []);
  const catalog = validateCatalog(await (options.catalog ?? new LocalChangeCatalog()).load());
  const scan = await scanRepository(directory, options.scan);
  return { ...scan, compatibility: assessCompatibility(scan, catalog, options.apiVersionInputs) };
}
