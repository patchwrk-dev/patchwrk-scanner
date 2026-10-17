import type { ProviderDefinition } from '../types/index.ts';

// Canonical package identities; safe subpaths can identify a package, never imply constructor semantics.
export const providers: readonly ProviderDefinition[] = [
  {
    id: 'stripe', name: 'Stripe', packages: ['stripe'], constructors: ['Stripe'],
    factories: [], defaultConstructor: true, defaultFactory: true,
    evidenceUrl: 'https://github.com/stripe/stripe-node',
  },
  {
    id: 'openai', name: 'OpenAI', packages: ['openai'], constructors: ['OpenAI'],
    factories: [], defaultConstructor: true, defaultFactory: false,
    evidenceUrl: 'https://github.com/openai/openai-node',
  },
  {
    id: 'anthropic', name: 'Anthropic', packages: ['@anthropic-ai/sdk'], constructors: ['Anthropic'],
    factories: [], defaultConstructor: true, defaultFactory: false,
    evidenceUrl: 'https://github.com/anthropics/anthropic-sdk-typescript',
  },
  {
    id: 'shopify', name: 'Shopify', packages: ['@shopify/shopify-api'], constructors: [],
    factories: ['shopifyApi'], defaultConstructor: false, defaultFactory: false,
    evidenceUrl: 'https://github.com/Shopify/shopify-app-js/tree/main/packages/apps/shopify-api',
  },
  {
    id: 'twilio', name: 'Twilio', packages: ['twilio'], constructors: ['Twilio'],
    factories: [], defaultConstructor: false, defaultFactory: true,
    evidenceUrl: 'https://github.com/twilio/twilio-node',
  },
];

export function validateRegistry(registry: readonly ProviderDefinition[]): void {
  const names = new Set<string>();
  for (const provider of registry) {
    if (!/^[a-z][a-z0-9-]*$/u.test(provider.id) || !provider.packages.length) {
      throw new Error('Invalid provider registry.');
    }
    for (const name of provider.packages) {
      if (!/^(?:@[a-z0-9-]+\/)?[a-z0-9-]+$/u.test(name) || names.has(name)) {
        throw new Error('Invalid or duplicate provider package.');
      }
      names.add(name);
    }
  }
}
