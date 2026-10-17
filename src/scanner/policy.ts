import type { ScanLimits } from '../types/index.ts';

export const defaultLimits: Readonly<ScanLimits> = {
  maxFiles: 2_000,
  maxFileBytes: 1_048_576,
  maxTotalBytes: 20_971_520,
  maxEntries: 20_000,
  maxDepth: 32,
};

export function configureLimits(overrides: Partial<ScanLimits> = {}): ScanLimits {
  if (Object.keys(overrides).some((key) => !Object.hasOwn(defaultLimits, key))) throw new Error('Unknown scan limit.');
  const limits = { ...defaultLimits, ...overrides };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('Scan limits must be positive safe integers.');
  }
  // Bound allocations even when options are supplied programmatically.
  if (limits.maxFileBytes > 16_777_216 || limits.maxDepth > 128) {
    throw new Error('Maximum file size is 16 MiB and maximum depth is 128.');
  }
  if (limits.maxFiles > 20_000 || limits.maxEntries > 200_000 || limits.maxTotalBytes > 268_435_456) {
    throw new Error('Maximum scan budget is 20000 files, 200000 entries, and 256 MiB.');
  }
  return limits;
}

const ignoredDirectories = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'generated',
  '__generated__', 'secrets', 'credentials', 'fixtures', '.git', '.aws', '.ssh',
]);

export function ignoredName(name: string, directory: boolean): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith('.') || /(?:secret|credential|private[-_]?key|api[-_]?key|access[-_]?token|service[-_]?account)/u.test(lower)) return true;
  if (directory) return ignoredDirectories.has(lower);
  return /(?:\.min\.[cm]?js|\.generated\.[^.]+|\.g\.[^.]+|\.d\.(?:ts|mts|cts))$/u.test(lower)
    || /(?:^|[-_.])(?:bundle|generated)(?:[-_.]|$)/u.test(lower);
}

export function supportedSource(name: string): boolean {
  return /\.(?:[cm]?[jt]s|[jt]sx)$/u.test(name);
}

export const lockNames = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']);
