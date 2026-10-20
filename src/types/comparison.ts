import type { SavedScan } from './history.ts';
import type { ReportBlock, ReportView } from './reporting.ts';

export interface ComparisonContext {
  scanId: string; projectId: string; savedAt: string; envelopeSchema: 1; projectionSchema: 1;
  metadata: ReportView['metadata']; complete: boolean; coverage: ReportView['coverage'];
  scope: ReportBlock[]; notices: string[]; limitations: ReportBlock[];
  integrations: number; assessments: number;
}
export interface IntegrationComparison {
  provider: string; packageName: string; category: 'new' | 'missing' | 'unchanged';
  evidenceChanged: boolean; before: ReportBlock[]; after: ReportBlock[];
}
export interface AssessmentEvidence {
  identity: SavedScan['identities']['findings'][number]; evidence: ReportBlock;
}
export interface AssessmentComparison {
  key: string; category: 'new' | 'missing' | 'changed' | 'unchanged' | 'inconclusive';
  uncertainty: 'increased' | 'reduced' | 'unchanged' | 'inconclusive';
  evidenceChanged: boolean; reason: string;
  before: AssessmentEvidence[]; after: AssessmentEvidence[];
}
/** Independent schema; never a current scan or a mutable saved record. */
export interface ScanComparison {
  schemaVersion: 1; before: ComparisonContext; after: ComparisonContext;
  inconclusive: boolean; warnings: string[]; limitations: string[];
  integrations: IntegrationComparison[]; assessments: AssessmentComparison[];
}
