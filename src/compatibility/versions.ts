import semver from 'semver';
import type { ApiChange } from '../types/changes.ts';
import type { DeclaredVersion } from '../types/index.ts';
import type { ApiVersionDeclaration, VersionEvaluation, VersionOutcome } from '../types/compatibility.ts';

function range(value: string | null): string | null {
  if (value === null || value.length > 256 || !value.trim()) return null;
  return semver.validRange(value, { loose: false });
}

function aggregate(outcomes: VersionOutcome[]): VersionOutcome {
  if (!outcomes.length) return 'unknown';
  if (outcomes.every((value) => value === 'matches')) return 'matches';
  if (outcomes.every((value) => value === 'excludes')) return 'excludes';
  return outcomes.some((value) => value !== 'unknown') ? 'uncertain' : 'unknown';
}

export function evaluateSdkVersions(declarations: readonly DeclaredVersion[], constraints: ApiChange['affectedSdks'], packageName: string): VersionEvaluation {
  if (!constraints.length) return { outcome: 'not-specified', evidenceLevel: 'none', rationale: ['No SDK constraint is documented.'] };
  const matching = constraints.filter((constraint) => constraint.packageName === packageName);
  const supportedRanges = matching.map((constraint) => range(constraint.versionRange));
  const unknownConstraint = supportedRanges.some((value) => value === null);
  const knownRanges = supportedRanges.filter((value): value is string => value !== null);
  if (!matching.length || !knownRanges.length) return { outcome: 'unknown', evidenceLevel: 'none', rationale: ['No supported affected SDK version range is available.'] };
  const rationale: string[] = [];
  const outcomes: VersionOutcome[] = [];
  let allResolved = declarations.length > 0;
  const versionsByManifest = new Map<string, Set<string>>();
  for (const declaration of declarations) {
    const declared = declaration.status === 'declared' ? range(declaration.version) : null;
    const resolved = declaration.resolutionStatus === 'lockfile' && declaration.resolvedVersion !== null
      && declaration.resolvedVersion.length <= 256 ? semver.valid(declaration.resolvedVersion, { loose: false }) : null;
    if (resolved) {
      if (declared === null || !semver.satisfies(resolved, declared)) {
        outcomes.push('uncertain'); allResolved = false;
        rationale.push('Lockfile version conflicts with or cannot be reconciled to its declaration.');
        continue;
      }
      const byManifest = versionsByManifest.get(declaration.file) ?? new Set<string>();
      byManifest.add(resolved);
      versionsByManifest.set(declaration.file, byManifest);
      const matches = knownRanges.some((affected) => semver.satisfies(resolved, affected));
      outcomes.push(matches ? 'matches' : unknownConstraint ? 'unknown' : 'excludes');
      rationale.push(matches ? 'A recorded lockfile SDK version satisfies an affected range.' : 'A recorded lockfile SDK version does not satisfy any supported affected range.');
    } else {
      allResolved = false;
      if (declared !== null) {
        const intersects = knownRanges.some((affected) => semver.intersects(declared, affected));
        // Declared ranges/exact pins are not evidence of installed versions.
        outcomes.push('uncertain');
        rationale.push(intersects ? 'Declared SDK constraints overlap an affected range; no reliable resolved version is available.'
          : 'Declared SDK constraints appear disjoint, but the installed version is not established.');
      } else {
        outcomes.push('unknown');
        rationale.push('SDK version evidence is unknown, dynamic, unsupported, or unresolved.');
      }
    }
  }
  if ([...versionsByManifest.values()].some((versions) => versions.size > 1)) {
    outcomes.push('uncertain');
    rationale.push('Conflicting recorded SDK versions exist for the same manifest; precedence is not inferred.');
  }
  return {
    outcome: aggregate(outcomes), evidenceLevel: allResolved ? 'lockfile-record' : declarations.length ? 'declaration-only' : 'none',
    rationale: rationale.length ? [...new Set(rationale)].sort() : ['No SDK version declarations were discovered.'],
  };
}

export function evaluateApiVersion(evidence: ApiVersionDeclaration | undefined, constraints: ApiChange['affectedApiVersions']): VersionEvaluation {
  if (!constraints.length) return { outcome: 'not-specified', evidenceLevel: 'none', rationale: ['No remote API version constraint is documented.'] };
  if (!evidence) return { outcome: 'unknown', evidenceLevel: 'none', rationale: ['No remote API version was explicitly supplied; SDK versions are not substituted.'] };
  if (evidence.dynamic) return { outcome: 'uncertain', evidenceLevel: 'user-declared', rationale: ['The supplied API version is a dynamic channel, not a fixed runtime version.'] };
  let matches = false;
  let unsupported = false;
  for (const constraint of constraints) {
    if (constraint.scheme !== evidence.scheme) { unsupported = true; continue; }
    if (constraint.versions.includes(evidence.version)) matches = true;
    // Never assume chronological ordering or apply npm semver to a provider API.
    if (constraint.versionRange !== null) unsupported = true;
  }
  return {
    outcome: matches ? 'matches' : unsupported ? 'unknown' : 'excludes', evidenceLevel: 'user-declared',
    rationale: [matches ? 'The user-declared API version exactly matches a documented affected identifier.'
      : unsupported ? 'API range ordering or a catalog version scheme is unsupported; exclusion cannot be established.'
        : 'The user-declared API version differs from every supported documented affected identifier.',
    'API input is user-declared; runtime configuration and version availability are not verified.'],
  };
}
