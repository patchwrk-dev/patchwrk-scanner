import type { ReportView } from './reporting.ts';
import type { CompatibilityStatus } from './compatibility.ts';

export interface HistoryProject { schemaVersion: 1; projectId: string }
export interface SavedScan {
  schemaVersion: 1;
  scanId: string;
  projectId: string;
  savedAt: string;
  identities: {
    integrations: { provider: string; packageName: string }[];
    findings: { provider: string; packageName: string; changeId: string; reference: string; clientReference: string | null; recordFingerprint: string; status: CompatibilityStatus; scope: string; category: string }[];
  };
  snapshot: ReportView;
}
export interface HistoryListing {
  schemaVersion: 1;
  projectId: string;
  records: SavedScan[];
  warnings: string[];
  bytes: number;
}
export interface HistoryDeletion {
  schemaVersion: 1;
  applied: boolean;
  selected: string[];
  deleted: string[];
  failed: string[];
  warnings: string[];
  lockCleanupFailed: boolean;
}
