export interface ConfigurationEvidence {
  provider: 'stripe' | 'openai';
  packageName: string | null;
  file: string;
  line: number;
  clientId: string | null;
  kind: 'api-version' | 'model';
  scope: 'client' | 'request' | 'default-unresolved';
  evidenceType: 'sdk-initialization-option' | 'request-option' | 'version-header' | 'model-parameter' | 'unknown-default';
  value: string | null;
  status: 'literal' | 'dynamic' | 'unknown' | 'unsupported';
  origin: 'observed-source-configuration';
  runtimeVerified: false;
  reason: string | null;
  documentationUrl: string;
  optionName: string;
}
