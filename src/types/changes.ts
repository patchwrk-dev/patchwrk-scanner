export const providerIds = ['stripe', 'openai', 'anthropic', 'shopify', 'twilio'] as const;
export type ProviderId = typeof providerIds[number];
export const changeCategories = ['breaking-change', 'deprecation', 'security-advisory', 'sdk-update', 'nonbreaking-change', 'unknown'] as const;
export type ChangeCategory = typeof changeCategories[number];
export type VerificationStatus = 'verified' | 'unverified' | 'illustrative';

export interface ApiChange {
  provider: ProviderId;
  id: string;
  title: string;
  description: string;
  officialSourceUrl: string | null;
  publicationDate: string | null;
  effectiveDate: string | null;
  retirementDate: string | null;
  category: ChangeCategory;
  affectedSdks: { packageName: string; versionRange: string | null }[];
  affectedApiVersions: { scheme: 'date' | 'semver' | 'opaque'; versions: string[]; versionRange: string | null }[];
  targets: { kind: 'endpoint' | 'method' | 'sdk-symbol' | 'model'; value: string }[];
  migrationInstructions: string | null;
  evidence: { sourceUrl: string; locator: string | null; excerpt: string | null }[];
  provenance: {
    kind: 'official' | 'unverified' | 'illustrative';
    sources: { url: string; retrievedAt: string | null }[];
    notes: string | null;
  };
  verification: {
    status: VerificationStatus;
    method: 'manual-official-review' | null;
    reviewer: string | null;
  };
  lastReviewedAt: string | null;
}

export interface ChangeCatalog {
  schemaVersion: 1;
  catalogVersion: string;
  changes: ApiChange[];
}

export interface ChangeClassification {
  category: ChangeCategory;
  declaredCategory: ChangeCategory;
  verificationStatus: VerificationStatus;
  basis: 'reviewed-official-metadata' | 'unverified' | 'illustrative' | 'insufficient-evidence';
}

export interface ChangesReport {
  schemaVersion: 1;
  status: 'offline-catalog';
  catalogVersion: string;
  provider: ProviderId | null;
  changes: { record: ApiChange; classification: ChangeClassification }[];
  warnings: string[];
  catalogCoverage?: {
    recordCount: number;
    providers: { provider: ProviderId; records: number; lastRetrievedAt: string | null; lastReviewedAt: string | null }[];
    oldestRetrievalAt: string | null;
    newestRetrievalAt: string | null;
    liveMonitoring: false;
  };
}

/** Storage boundary shared by local files and future database implementations. */
export interface ChangeCatalogRepository {
  load(): Promise<ChangeCatalog>;
}

/** No fetch method exists in the offline foundation. */
export interface OfficialSourceAdapter {
  provider: ProviderId;
  retrievalPlan: {
    mode: 'offline-only';
    inputFormat: 'normalized-json-record';
    futureTransport: 'official-announcement-snapshot';
    verificationRequired: 'manual-official-review';
    retrievalPolicy: 'provider-controlled-domain-or-github-organization';
  };
  isOfficialUrl(url: string): boolean;
  normalize(snapshot: unknown): ApiChange;
}
