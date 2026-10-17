import type { ProviderId } from '../types/changes.ts';

// Authority allowlist only; no live sources have been retrieved or verified here.
const authorities: Record<ProviderId, { hosts: readonly string[]; githubOrg: string }> = {
  stripe: { hosts: ['stripe.com', 'www.stripe.com', 'docs.stripe.com'], githubOrg: 'stripe' },
  openai: { hosts: ['openai.com', 'www.openai.com', 'platform.openai.com', 'developers.openai.com'], githubOrg: 'openai' },
  anthropic: { hosts: ['anthropic.com', 'www.anthropic.com', 'docs.anthropic.com', 'platform.claude.com'], githubOrg: 'anthropics' },
  shopify: { hosts: ['shopify.dev', 'www.shopify.com', 'shopify.com'], githubOrg: 'shopify' },
  twilio: { hosts: ['twilio.com', 'www.twilio.com', 'docs.twilio.com'], githubOrg: 'twilio' },
};

export function safeHttpsUrl(value: string): boolean {
  if (value.length > 2048 || /[\s\\]/u.test(value)
    || [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && !url.hostname.endsWith('.') && !!url.hostname;
  } catch { return false; }
}

export function isOfficialUrl(provider: ProviderId, value: string): boolean {
  if (!safeHttpsUrl(value)) return false;
  const url = new URL(value);
  const authority = authorities[provider];
  return authority.hosts.includes(url.hostname)
    || (url.hostname === 'github.com' && url.pathname.toLowerCase().startsWith(`/${authority.githubOrg}/`));
}
