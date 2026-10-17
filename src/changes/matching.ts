import type { Integration } from '../types/index.ts';
import type { ApiChange } from '../types/changes.ts';
import { deduplicateChanges } from './catalog.ts';

export interface ChangeMatchContext {
  integration: Integration;
  // Explicit remote configuration only. SDK versions must never populate this field.
  observedApiVersions: readonly { scheme: 'date' | 'semver' | 'opaque'; version: string }[];
}
export interface ChangeMatchCandidate {
  changeId: string;
  provider: string;
  packageName: string;
  basis: 'provider-and-package' | 'provider-only';
  sdkVersionAssessment: 'not-evaluated';
  apiVersionAssessment: 'not-evaluated';
  riskConclusion: null;
}
export interface ChangeMatcher {
  candidates(context: ChangeMatchContext, changes: readonly ApiChange[]): ChangeMatchCandidate[];
}

export const candidateMatcher: ChangeMatcher = {
  candidates: ({ integration }, changes) => deduplicateChanges(changes)
    .filter((change) => change.provider === integration.provider
      && (!change.affectedSdks.length || change.affectedSdks.some((sdk) => sdk.packageName === integration.packageName)))
    .map((change) => ({
      changeId: change.id, provider: change.provider, packageName: integration.packageName,
      basis: change.affectedSdks.length ? 'provider-and-package' as const : 'provider-only' as const,
      sdkVersionAssessment: 'not-evaluated' as const, apiVersionAssessment: 'not-evaluated' as const,
      riskConclusion: null,
    })).sort((a, b) => a.changeId < b.changeId ? -1 : a.changeId > b.changeId ? 1 : 0),
};
