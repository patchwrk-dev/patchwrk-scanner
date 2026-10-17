import type { DetectionEvidence, DeclaredVersion, ScanReport } from './index.ts';
import type { ApiChange, ProviderId } from './changes.ts';
import type { ConfigurationEvidence } from './configuration.ts';
import type { ClientAnalysis } from './analysis.ts';

export type CompatibilityStatus = 'affected' | 'potentially-affected' | 'not-affected-by-this-change' | 'unknown';
export type VersionOutcome = 'matches' | 'excludes' | 'uncertain' | 'unknown' | 'not-specified';

export interface ApiVersionDeclaration {
  provider: ProviderId;
  version: string;
  scheme: 'date' | 'opaque';
  dynamic: boolean;
  origin: 'user-declared';
  runtimeVerified: false;
  documentationUrl: string;
}

export interface VersionEvaluation {
  outcome: VersionOutcome;
  evidenceLevel: 'lockfile-record' | 'declaration-only' | 'user-declared' | 'observed-literal-configuration' | 'none';
  rationale: string[];
}

export interface CompatibilityAssessment {
  provider: ProviderId;
  packageName: string;
  client?: ClientAnalysis;
  locations: DetectionEvidence[];
  changeId: string;
  changeRecord: ApiChange;
  configurationEvidence: ConfigurationEvidence[];
  configurationEvaluation: VersionEvaluation;
  category: ApiChange['category'];
  lastReviewedAt: string | null;
  officialSourceUrl: string | null;
  verification: ApiChange['verification'];
  provenance: ApiChange['provenance'];
  sourceEvidence: ApiChange['evidence'];
  status: CompatibilityStatus;
  scope: 'documented-version-applicability' | 'documented-configuration-applicability';
  evidenceLevel: 'supported-version-evidence' | 'partial-evidence' | 'insufficient-evidence';
  sdkEvaluation: VersionEvaluation;
  apiEvaluation: VersionEvaluation;
  facts: { kind: 'observed-repository-metadata'; sdkDeclarations: DeclaredVersion[]; locations: DetectionEvidence[]; displayComplete: boolean };
  userDeclared: ApiVersionDeclaration[];
  inferred: { kind: 'deterministic-version-comparison'; rationale: string[] };
  unknowns: string[];
  limitations: string[];
}

export interface CompatibilitySummary {
  schemaVersion: 1;
  catalogVersion: string;
  catalogRecordCount: number;
  apiVersionDeclarations: ApiVersionDeclaration[];
  assessments: CompatibilityAssessment[];
  coverage: {
    complete: boolean;
    assessmentsTruncated: boolean;
    evidenceDisplayTruncated: boolean;
    limits: { maxAssessments: number; maxLocationsPerAssessment: number; maxDeclarationsPerAssessment: number };
  };
  warnings: string[];
  limitations: string[];
}

/** Additive extension: scanner schema version 2 and existing fields are retained. */
export interface CompatibilityScanReport extends ScanReport {
  compatibility: CompatibilitySummary;
}
