import type { ConfigurationEvidence } from './configuration.ts';
import type { ModuleLimits, RepositoryAnalysis } from './analysis.ts';

export interface ProviderDefinition {
  id: string;
  name: string;
  packages: readonly string[];
  constructors: readonly string[];
  factories: readonly string[];
  defaultConstructor: boolean;
  defaultFactory: boolean;
  evidenceUrl: string;
}

export type DependencySection = 'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies';
export type EvidenceType = 'dependency' | 'esm-import' | 'commonjs-require' | 'client-initialization' | 'client-reference';

export interface DetectionEvidence {
  file: string;
  line: number;
  type: EvidenceType;
  typeOnly: boolean;
}

export interface DeclaredVersion {
  file: string;
  section: DependencySection;
  version: string | null;
  status: 'declared' | 'unknown' | 'unsupported';
  resolvedVersion: string | null;
  resolutionStatus: 'lockfile' | 'unknown' | 'unsupported';
  lockfile: string | null;
}

export interface Integration {
  provider: string;
  packageName: string;
  declaredVersions: DeclaredVersion[];
  locations: DetectionEvidence[];
}

export interface ScanLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxEntries: number;
  maxDepth: number;
}

export interface ScanOptions {
  limits?: Partial<ScanLimits>;
  providers?: readonly ProviderDefinition[];
  analysisLimits?: Partial<ModuleLimits>;
}

export interface ScanReport {
  schemaVersion: 2;
  directory: string;
  status: 'discovery';
  integrations: Integration[];
  configuration?: ConfigurationEvidence[];
  analysis?: RepositoryAnalysis;
  warnings: string[];
  coverage: {
    filesScanned: number;
    bytesScanned: number;
    entriesVisited: number;
    filesSkipped: number;
    complete: boolean;
    limits: ScanLimits;
    limitations: string[];
  };
}

export interface CompatibilityRule {
  id: string;
  providerId: string;
  evidenceUrl: string;
}
