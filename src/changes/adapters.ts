import { providerIds } from '../types/changes.ts';
import type { OfficialSourceAdapter, ProviderId } from '../types/changes.ts';
import { isOfficialUrl } from './sources.ts';
import { validateChange } from './validation.ts';

/** Manual normalized snapshots only; future raw HTML/feed parsing is separate work. */
export function createSourceAdapter(provider: ProviderId): OfficialSourceAdapter {
  if (!providerIds.includes(provider)) throw new Error('Unknown source adapter provider.');
  return {
    provider,
    retrievalPlan: {
      mode: 'offline-only', inputFormat: 'normalized-json-record',
      futureTransport: 'official-announcement-snapshot',
      verificationRequired: 'manual-official-review',
      retrievalPolicy: 'provider-controlled-domain-or-github-organization',
    },
    isOfficialUrl: (url) => isOfficialUrl(provider, url),
    normalize: (snapshot) => {
      const change = validateChange(snapshot);
      if (change.provider !== provider) throw new Error('Source adapter provider mismatch.');
      return change;
    },
  };
}

export const sourceAdapters: readonly OfficialSourceAdapter[] = providerIds.map(createSourceAdapter);
