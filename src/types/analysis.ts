import type { DeclaredVersion, DetectionEvidence } from './index.ts';

export interface ModuleLimits {
  maxModules: number;
  maxEdges: number;
  maxTraversalDepth: number;
  maxResolutionSteps: number;
}
export interface ManifestResolution {
  file: string;
  line: number;
  provider: string;
  packageName: string;
  status: 'resolved' | 'ambiguous' | 'unknown';
  manifest: string | null;
  basis: 'nearest-manifest' | 'workspace-root' | 'unresolved';
  declarations: DeclaredVersion[];
  limitations: string[];
}
export interface ClientDefinition {
  id: string;
  provider: string;
  packageName: string;
  file: string;
  line: number;
  localName: string | null;
  topLevel: boolean;
  defaultExport: boolean;
}
export interface ImportedClient {
  localName: string;
  member: string | null;
  definition: ClientDefinition;
  line: number;
}
export interface ClientAnalysis {
  definition: ClientDefinition;
  usages: DetectionEvidence[];
  manifestResolution: ManifestResolution;
  confidence: 'static-client-relationship';
  limitations: string[];
}
export interface RepositoryAnalysis {
  schemaVersion: 1;
  complete: boolean;
  modulesAnalyzed: number;
  edgesInspected: number;
  resolutionSteps: number;
  cyclesDetected: number;
  limits: ModuleLimits;
  bindings: ManifestResolution[];
  clients: ClientAnalysis[];
  warnings: string[];
  limitations: string[];
}
