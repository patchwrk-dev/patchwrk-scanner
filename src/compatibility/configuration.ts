import type { ConfigurationEvidence } from '../types/configuration.ts';
import type { ApiChange } from '../types/changes.ts';
import type { ApiVersionDeclaration, VersionEvaluation, VersionOutcome } from '../types/compatibility.ts';
import { parseApiVersionInputs } from './api-versions.ts';
import { evaluateApiVersion } from './versions.ts';

function combined(outcomes: VersionOutcome[]): VersionOutcome {
  if (!outcomes.length || outcomes.every((value) => value === 'unknown')) return 'unknown';
  if (outcomes.every((value) => value === 'matches')) return 'matches';
  if (outcomes.every((value) => value === 'excludes')) return 'excludes';
  return 'uncertain';
}

export function evaluateObservedApi(evidence: ConfigurationEvidence[], change: ApiChange, declared: ApiVersionDeclaration | undefined): VersionEvaluation {
  const records = evidence.filter((item) => item.kind === 'api-version');
  if (!records.length) return evaluateApiVersion(declared, change.affectedApiVersions);
  if (!change.affectedApiVersions.length) return { outcome: 'not-specified', evidenceLevel: 'none', rationale: ['No remote API version constraint is documented.'] };
  const outcomes: VersionOutcome[] = [];
  const rationale: string[] = [];
  const values = new Set<string>();
  for (const item of records) {
    if (item.status !== 'literal' || !item.value) {
      // CLI declaration may supply unresolved defaults, but cannot erase a dynamic override.
      outcomes.push(item.scope === 'default-unresolved' && declared ? evaluateApiVersion(declared, change.affectedApiVersions).outcome : 'unknown');
      rationale.push('An account/SDK default or dynamic configuration remains unverified.');
    } else {
      const parsed = parseApiVersionInputs([`${item.provider}=${item.value}`])[0];
      outcomes.push(evaluateApiVersion(parsed, change.affectedApiVersions).outcome);
      values.add(item.value);
      rationale.push('Observed literal API configuration was compared by exact identifier at its client/request scope.');
    }
  }
  if (declared) {
    outcomes.push(evaluateApiVersion(declared, change.affectedApiVersions).outcome);
    if (values.size && !values.has(declared.version)) outcomes.push('uncertain');
  }
  if (values.size > 1) { outcomes.push('uncertain'); rationale.push('Multiple scoped API versions exist; no global version or override precedence is inferred.'); }
  return { outcome: combined(outcomes), evidenceLevel: 'observed-literal-configuration', rationale: [...new Set(rationale)].sort() };
}

export function evaluateTargetConfiguration(evidence: ConfigurationEvidence[], change: ApiChange): VersionEvaluation {
  const models = change.targets.filter((target) => target.kind === 'model').map((target) => target.value);
  const legacyOption = change.provider === 'stripe' && change.targets.some((target) => target.kind === 'sdk-symbol' && target.value === 'stripeVersion');
  if (!models.length && !legacyOption) return { outcome: 'not-specified', evidenceLevel: 'none', rationale: ['No supported configuration target constraint is documented.'] };
  if (legacyOption) return {
    outcome: evidence.some((item) => item.optionName === 'stripeVersion') ? 'matches' : 'unknown', evidenceLevel: 'observed-literal-configuration',
    rationale: ['The legacy option is matched only by observed property use; absence is not proof of nonuse.'],
  };
  const modelEvidence = evidence.filter((item) => item.kind === 'model' && (item.scope !== 'default-unresolved'
    || !evidence.some((other) => other.kind === 'model' && other.scope === 'request' && other.clientId === item.clientId)));
  const outcomes = modelEvidence.map((item): VersionOutcome => item.status === 'literal' && item.value
    ? models.includes(item.value) ? 'matches' : 'excludes' : 'unknown');
  return { outcome: combined(outcomes), evidenceLevel: modelEvidence.length ? 'observed-literal-configuration' : 'none',
    rationale: ['Observed model parameters are compared to documented model targets, never to API version identifiers. Missing or dynamic models stay unknown.'] };
}
