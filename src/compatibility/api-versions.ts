import type { ApiVersionDeclaration } from '../types/compatibility.ts';
import { isDate, parseProvider } from '../changes/validation.ts';

export function parseApiVersionInputs(inputs: readonly string[]): ApiVersionDeclaration[] {
  if (!Array.isArray(inputs) || inputs.length > 5) throw new Error('Too many API version declarations.');
  const seen = new Set<string>();
  return inputs.map((input) => {
    if (typeof input !== 'string' || input.length > 160) throw new Error('Malformed API version declaration.');
    const parts = input.split('=');
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('Expected --api-version provider=version.');
    const provider = parseProvider(parts[0]);
    const version = parts[1];
    if (seen.has(provider)) throw new Error('Duplicate API version provider.');
    seen.add(provider);
    let supported = false;
    let scheme: 'date' | 'opaque' = 'opaque';
    let documentationUrl: string;
    switch (provider) {
      case 'stripe': {
        supported = /^\d{4}-\d{2}-\d{2}(?:\.[a-z]+)?$/u.test(version) && isDate(version.slice(0, 10));
        scheme = version.includes('.') ? 'opaque' : 'date';
        documentationUrl = 'https://docs.stripe.com/api/versioning';
        break;
      }
      case 'anthropic':
        supported = isDate(version); scheme = 'date';
        documentationUrl = 'https://platform.claude.com/docs/en/api/versioning';
        break;
      case 'shopify':
        supported = (/^[1-9]\d{3}-(?:01|04|07|10)$/u.test(version)) || version === 'unstable';
        documentationUrl = 'https://shopify.dev/docs/api/usage/versioning';
        break;
      case 'openai':
        supported = version === 'v1';
        documentationUrl = 'https://developers.openai.com/api/reference/overview';
        break;
      case 'twilio':
        // Only the documented classic REST API namespace; product APIs are out of scope.
        supported = version === '2010-04-01'; scheme = 'date';
        documentationUrl = 'https://www.twilio.com/docs/iam/api';
        break;
    }
    if (!supported) throw new Error('Unsupported provider API version format.');
    return { provider, version, scheme, dynamic: version === 'unstable', origin: 'user-declared' as const, runtimeVerified: false as const, documentationUrl };
  }).sort((a, b) => a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0);
}
