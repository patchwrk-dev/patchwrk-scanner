/** Independent presentation contract; does not change scanner schema 2. */
export interface ReportMetadata {
  scannerVersion: string | null;
  buildFingerprint: string | null;
  catalogVersion: string;
  catalogFingerprint: string;
  catalogRecordCount: number;
  providers: { id: string; name: string; records: number }[];
  startedAt: string;
  finishedAt: string;
  generatedAt: string;
}

export interface ReportView {
  schemaVersion: 1;
  metadata: ReportMetadata;
  complete: boolean;
  stats: { label: string; value: number }[];
  notices: string[];
  coverage: { label: string; value: string }[];
  sections: { kind: 'scope' | 'integrations' | 'findings' | 'attention' | 'actions' | 'limitations'; title: string; blocks: ReportBlock[] }[];
}

export interface ReportBlock {
  title: string;
  rows: { label: string; value: string }[];
  notes: string[];
  status?: string;
  sourceUrl?: string;
  finding?: {
    provider: string;
    title: string;
    explanation: string;
    references: string[];
    moreReferences: number;
    uncertainty: string[];
    actions: string[];
  };
}
