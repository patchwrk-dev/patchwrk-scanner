import { createHash } from 'node:crypto';
import { validRange } from 'semver';
import type { CompatibilityScanReport } from '../types/compatibility.ts';
import type { ReportView, ReportMetadata, ReportBlock } from '../types/reporting.ts';
import { isOfficialUrl } from '../changes/sources.ts';

export const statusLabels = {
  affected: 'Affected', 'potentially-affected': 'Potential risk',
  unknown: 'Unknown', 'not-affected-by-this-change': 'Not affected by this change',
} as const;

const privateText = /(?:secret|credential|password|bearer|token|canary|sentinel|sk[-_]|api[-_]?key|private[-_]?key)/iu;
const withheld = '[withheld for privacy]';

/** References remain inert text. Suspicious paths are omitted, never linked. */
function sourcePath(value: string): string {
  return value.length <= 240 && !privateText.test(value) && !value.split('/').some((part) => part === '..' || part === '.' || part.length > 64)
    && /^(?:[a-zA-Z0-9_@-][a-zA-Z0-9_.@-]*\/)*[a-zA-Z0-9_@-][a-zA-Z0-9_.@-]*$/u.test(value)
    ? value : withheld;
}

/** Warnings contain source labels; never retain their quoted payloads or absolute paths. */
function narrative(value: string): string {
  const clean = value.replace(/"(?:[^"\\]|\\.)*"/gu, withheld);
  const unsafeControl = [...clean].some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10) || code === 127 || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
  });
  return privateText.test(clean) || /(?:^|\s)(?:\/|[A-Za-z]:[\\/])/u.test(clean) || unsafeControl
    ? 'Additional detail withheld for privacy; retain the original local terminal/JSON report for private review.' : clean;
}

function version(value: string | null): string {
  return value && value.length <= 256 && /^[0-9v^~<>=*|.+ -]+(?:[a-zA-Z0-9.-]*)$/u.test(value) && !privateText.test(value) && validRange(value, { loose: false })
    ? value : 'Unknown or withheld';
}

/** Bound work before projecting an internal report. This is not a saved-report importer. */
function checkBudget(root: unknown): void {
  const pending: [unknown, number][] = [[root, 0]];
  let nodes = 0;
  let textBytes = 0;
  while (pending.length) {
    const [value, depth] = pending.pop()!;
    if (++nodes > 100_000 || depth > 64) throw new Error('HTML report structure limit exceeded.');
    if (typeof value === 'string') textBytes += Buffer.byteLength(value, 'utf8');
    if (textBytes > 32 * 1024 * 1024) throw new Error('HTML report input limit exceeded.');
    if (value !== null && typeof value === 'object') {
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
        if (descriptor.get || descriptor.set) throw new Error('Unsafe report property.');
        pending.push([descriptor.value, depth + 1]);
        if (pending.length > 100_000) throw new Error('HTML report structure limit exceeded.');
      }
    }
  }
}

export function buildReportView(scan: CompatibilityScanReport, metadata: ReportMetadata): ReportView {
  checkBudget(scan);
  const complete = scan.coverage.complete && (scan.analysis?.complete ?? true) && scan.compatibility.coverage.complete;
  const row = (label: string, value: unknown) => ({ label, value: String(value) });
  const scopes: ReportBlock[] = [{
    title: 'Selected local project (absolute path omitted)',
    rows: [row('Mode', 'Manual · offline · read-only static analysis'), row('Invocation — redacted equivalent', 'patchwrk scan <selected-project> --html <new-report.html>'),
      row('Invocation omissions', 'Target/output paths, raw arguments and API-version declaration values omitted. Effective budgets are recorded below.'),
      row('Files read', scan.coverage.filesScanned), row('Bytes read', scan.coverage.bytesScanned), row('Entries visited', scan.coverage.entriesVisited), row('Files skipped', scan.coverage.filesSkipped),
      row('Discovery coverage', scan.coverage.complete ? 'Eligible scope analyzed' : 'Partial'),
      row('Module coverage', scan.analysis?.complete ? 'Indexed scope analyzed' : 'Unknown / partial'),
      row('Assessment coverage', scan.compatibility.coverage.complete ? 'Supported candidates displayed' : 'Partial'),
      row('Assessments truncated', scan.compatibility.coverage.assessmentsTruncated), row('Evidence display truncated', scan.compatibility.coverage.evidenceDisplayTruncated),
      ...Object.entries(scan.coverage.limits).map(([name, value]) => row(`Scan budget: ${name}`, value)),
      ...Object.entries(scan.analysis?.limits ?? {}).map(([name, value]) => row(`Module budget: ${name}`, value)),
      ...Object.entries(scan.compatibility.coverage.limits).map(([name, value]) => row(`Assessment budget: ${name}`, value))],
    notes: ['Supported JS/JSX/TS/TSX/MJS/CJS/MTS/CTS source, package manifests and supported npm v2/v3 lock records. Literal imports/requires and directly bound clients; bounded static cross-file relationships.',
      'Hidden, generated, credential, dependency, vendor and fixture paths are excluded. Unsupported dynamic imports, wrappers and runtime injection can be missed.',
      'Sanitized invocation is descriptive, not an exact replay command. User-declared API versions are not runtime verified.'],
  }];
  const integrations: ReportBlock[] = scan.integrations.map((item) => ({
    title: `${metadata.providers.find((provider) => provider.id === item.provider)?.name ?? item.provider} · ${item.packageName}`,
    rows: item.declaredVersions.flatMap((declaration) => [row('Manifest', sourcePath(declaration.file)), row('Dependency section', declaration.section),
      row('Declared SDK version', version(declaration.version)), row('Recorded SDK resolution', version(declaration.resolvedVersion)), row('Resolution status', declaration.resolutionStatus)])
      .concat([row('Installed runtime version', 'Unknown — not runtime verified')])
      .concat(item.locations.map((location) => row('Source evidence', `${sourcePath(location.file)}:${location.line} · ${location.type}${location.typeOnly ? ' · type only' : ''}`))),
    notes: [!item.declaredVersions.length ? 'No supported SDK declaration; installed version unknown.' : 'A declaration or lockfile record does not prove the installed or deployed SDK version.'],
  }));
  const findings: ReportBlock[] = scan.compatibility.assessments.map((assessment) => {
    const block: ReportBlock = {
      title: `${assessment.provider} · ${assessment.changeId}`,
      status: statusLabels[assessment.status],
      rows: [row('Historical record', narrative(assessment.changeRecord.title)), row('Category', assessment.category), row('Scope', assessment.scope),
        row('Evidence category', assessment.evidenceLevel), row('Existing machine status', assessment.status),
        row('Finding reference', createHash('sha256').update(JSON.stringify([assessment.provider, assessment.packageName, assessment.changeId,
          assessment.client?.definition.id ?? null, assessment.client?.manifestResolution.manifest ?? null])).digest('hex')),
        row('SDK evaluation', `${assessment.sdkEvaluation.outcome} · ${assessment.sdkEvaluation.evidenceLevel}`),
        row('Remote API evaluation', `${assessment.apiEvaluation.outcome} · ${assessment.apiEvaluation.evidenceLevel}`),
        row('Configuration evaluation', `${assessment.configurationEvaluation.outcome} · ${assessment.configurationEvaluation.evidenceLevel}`),
        row('Source verification', `${assessment.verification.status} · ${assessment.provenance.kind}`), row('Last reviewed', assessment.lastReviewedAt ?? 'Unknown'),
        ...assessment.provenance.sources.map((source) => row('Source retrieval date (manual curation)', source.retrievedAt ?? 'Unknown')),
        ...(assessment.client ? [row('Original client definition', `${sourcePath(assessment.client.definition.file)}:${assessment.client.definition.line}`),
          row('Definition manifest', assessment.client.manifestResolution.manifest ? sourcePath(assessment.client.manifestResolution.manifest) : 'Unknown'),
          row('Manifest resolution', `${assessment.client.manifestResolution.status} · ${assessment.client.manifestResolution.basis}`)] : []),
        ...assessment.locations.map((location) => row('Source reference', `${sourcePath(location.file)}:${location.line} · ${location.type}`)),
        ...assessment.configurationEvidence.map((configuration) => row('Observed source configuration',
          `${sourcePath(configuration.file)}:${configuration.line} · ${configuration.scope} · ${configuration.kind} · ${configuration.status} (value withheld; not runtime verified)`)),
        row('User-declared API versions', assessment.userDeclared.length ? 'Present; values withheld; not runtime verified' : 'None'),
        row('Evidence display complete', assessment.facts.displayComplete)],
      notes: [...assessment.inferred.rationale, ...assessment.unknowns, ...assessment.limitations, ...(assessment.client?.limitations ?? [])].map(narrative),
    };
    const references = [...new Set(assessment.locations.map((location) => `${sourcePath(location.file)}:${location.line}`))];
    const dynamic = assessment.configurationEvidence.some((item) => item.status === 'dynamic' || item.status === 'unsupported');
    const unresolved = assessment.configurationEvidence.some((item) => item.status === 'unknown');
    const unknownSdk = !assessment.facts.sdkDeclarations.length || assessment.facts.sdkDeclarations.some((item) => item.resolvedVersion === null);
    const explanations = {
      affected: 'The recorded evidence matches this historical change. Applicability is conditional; this does not establish runtime failure.',
      'potentially-affected': 'Existing evidence is incomplete, conflicting or conditional. Investigate the supporting evidence before drawing a conclusion.',
      unknown: 'The available evidence cannot determine applicability to this historical change. Unknown is not a pass.',
      'not-affected-by-this-change': 'The recorded evidence excludes this specific historical change. This is not an overall compatibility guarantee.',
    };
    block.finding = {
      provider: `${metadata.providers.find((provider) => provider.id === assessment.provider)?.name ?? assessment.provider} · ${assessment.packageName}`,
      title: narrative(assessment.changeRecord.title), explanation: explanations[assessment.status],
      references: references.slice(0, 3), moreReferences: Math.max(0, references.length - 3),
      uncertainty: [...assessment.unknowns.map(narrative),
        ...(dynamic ? ['Observed configuration is dynamic or unsupported; the runtime value was not evaluated.'] : []),
        ...(unresolved ? ['Observed default configuration remains unresolved; source literals are not runtime verification.'] : []),
        ...(!assessment.facts.displayComplete ? ['Evidence display is truncated. Review all available local evidence before drawing conclusions.'] : [])],
      actions: [
        'Review this record’s official provider documentation and historical scope.',
        ...(unknownSdk ? ['Verify the actual installed and deployed SDK version independently.'] : []),
        ...(dynamic ? ['Investigate dynamic configuration in the referenced source; Scanner does not evaluate it.'] : []),
        ...(unresolved && !dynamic ? ['Confirm unresolved default configuration in your authorized environment.'] : []),
        ...(assessment.status === 'affected' || assessment.status === 'potentially-affected' ? ['If you choose a migration, test it manually. No repair was generated or verified.'] : []),
      ],
    };
    if (assessment.officialSourceUrl && isOfficialUrl(assessment.provider, assessment.officialSourceUrl)
      && !privateText.test(assessment.officialSourceUrl) && !new URL(assessment.officialSourceUrl).search) block.sourceUrl = assessment.officialSourceUrl;
    return block;
  });
  for (const integration of scan.integrations) {
    if (!scan.compatibility.assessments.some((item) => item.provider === integration.provider && item.packageName === integration.packageName)) {
      findings.push({ title: `${integration.provider} · ${integration.packageName}`, status: complete ? 'No known finding within supported coverage' : 'Unknown / partial coverage', rows: [],
        notes: ['No matched historical assessment was recorded. This does not establish compatibility; discovery and catalog scope are limited.'] });
    }
  }
  const attention: ReportBlock[] = Object.entries(statusLabels).map(([status, label]) => ({ title: label,
    rows: [row('Assessments', scan.compatibility.assessments.filter((assessment) => assessment.status === status).length)],
    notes: [status === 'affected' ? 'Conditional applicability to a specific historical record, not confirmed runtime failure. Category may be nonbreaking.'
      : status === 'potentially-affected' ? 'Existing evidence is partial, conflicting or conditional; investigate the reported uncertainty.'
        : status === 'unknown' ? 'Missing evidence is not a pass. Confirm actual SDK and runtime configuration independently.' : 'Exclusion is scoped to one change, not the application or integration as a whole.'],
  }));
  return {
    schemaVersion: 1, metadata: structuredClone(metadata), complete,
    notices: [...scan.warnings, ...(scan.analysis?.warnings ?? []), ...scan.compatibility.warnings].map(narrative),
    coverage: scopes[0]!.rows.filter((item) => ['Discovery coverage', 'Module coverage', 'Assessment coverage', 'Assessments truncated', 'Evidence display truncated'].includes(item.label)),
    stats: [{ label: 'Files scanned', value: scan.coverage.filesScanned }, { label: 'Supported integrations', value: scan.integrations.length },
      { label: 'Assessments requiring attention', value: scan.compatibility.assessments.filter((item) => item.status === 'affected' || item.status === 'potentially-affected').length }, { label: 'Unknown assessments', value: scan.compatibility.assessments.filter((item) => item.status === 'unknown').length }],
    sections: [
      { kind: 'scope', title: 'What was scanned', blocks: scopes },
      { kind: 'integrations', title: 'Detected integrations', blocks: integrations.length ? integrations : [{ title: 'No supported integration detected', rows: [], notes: ['Empty findings do not establish absence of integrations or compatibility. Unsupported patterns can be missed.'] }] },
      { kind: 'findings', title: 'Findings and supporting evidence', blocks: findings.length ? findings : [{ title: 'No historical assessment', rows: [], notes: ['No matched assessment does not establish compatibility or repository health.'] }] },
      { kind: 'attention', title: 'What needs attention', blocks: attention },
      { kind: 'actions', title: 'Recommended next steps', blocks: [{ title: 'Developer review', rows: [], notes: [
        'Review the relevant source locations and recorded official provider guidance. Check historical dates; a suggested replacement may itself have retired.',
        'Investigate unknown SDK/API versions and confirm dynamic model, client and endpoint configuration independently.',
        'If you choose a supported migration, test it manually in your own authorized environment. Scanner generated no patch and verified no repair.',
      ] }] },
      { kind: 'limitations', title: 'Coverage, provenance and limitations', blocks: [{ title: 'Supported provider coverage', rows: metadata.providers.map((provider) => row(provider.name, `Supported SDK discovery · ${provider.records} historical catalog records · no monitoring or repair`)), notes: [
        'Experimental beta. Current bundled production catalog has four historical Stripe/OpenAI records; other supported providers have no curated records.',
        'Static evidence does not establish runtime reachability, production breakage, compatibility or application health. No automatic repair or Cloud monitoring.',
        'Report paths are root-relative and may still identify private code. Unsafe path labels and configuration values are withheld. No source excerpts, absolute target paths or raw arguments are stored in HTML. Review privately before sharing.',
        'This visual projection intentionally omits sensitive values and quoted warning details; the original local terminal/JSON preserves existing evidence. No history, comparison, telemetry or upload occurs.',
        'Fingerprints identify content, not authenticity. Review dates describe manual curation, not continuous freshness. Source-mode version/build identity may be unavailable.',
        ...scan.warnings, ...scan.coverage.limitations, ...(scan.analysis?.warnings ?? []), ...(scan.analysis?.limitations ?? []), ...scan.compatibility.warnings, ...scan.compatibility.limitations,
      ].map(narrative) }] },
    ],
  };
}
