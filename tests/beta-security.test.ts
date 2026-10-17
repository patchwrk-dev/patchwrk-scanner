import { describe, expect, it } from 'vitest';
import { parseObject } from '../src/scanner/dependencies.ts';
import { configureLimits } from '../src/scanner/policy.ts';
import { discoverDependencies } from '../src/scanner/dependencies.ts';
import { providers } from '../src/providers/index.ts';
import { analyzeSource } from '../src/scanner/source.ts';

describe('beta audit regressions', () => {
  it('skips deeply nested source before recursive visitors or checker analysis', () => {
    const result = analyzeSource('deep.ts', 'const value=' + '('.repeat(160) + '1' + ')'.repeat(160), providers);
    expect(result.warnings).toContain('Source AST resource limit; analysis skipped.');
    expect(result.findings).toEqual([]);
  });
  it('skips source with excessive AST nodes', () => {
    const result = analyzeSource('wide.ts', 'const values=[' + '1,'.repeat(50_001) + '];', providers);
    expect(result.warnings).toContain('Source AST resource limit; analysis skipped.');
  });
  it.each([
    '{"dependencies":{"openai":"4.0.0","openai":"5.0.0"}}',
    '{"dependencies":{},"dependencies":{"stripe":"8.0.0"}}',
    '{"__proto__":{"polluted":true}}', '{"constructor":{}}', '{"prototype":{}}',
    '{"dependencies":{"openai":"4.0.0","op\\u0065nai":"5.0.0"}}',
  ])('rejects ambiguous or unsafe manifest JSON %s', (text) => {
    expect(() => parseObject(text)).toThrow(); expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });
  it('rejects excessive JSON nesting before constructing an AST', () => {
    expect(() => parseObject('{"nested":' + '['.repeat(65) + '0' + ']'.repeat(65) + '}')).toThrow('nesting');
  });
  it.each([{maxFiles:20001},{maxEntries:200001},{maxTotalBytes:268435457}])('rejects excessive scan budgets %j', (limits) => {
    expect(() => configureLimits(limits)).toThrow('Maximum scan budget');
  });
  it('rejects unknown programmatic limits', () => {
    expect(() => configureLimits({unexpected: 1} as never)).toThrow('Unknown');
  });
  it('withholds sensitive dependency URL values', () => {
    const result=discoverDependencies('package.json','{"dependencies":{"openai":"https://token:synthetic-secret@example.invalid/openai"}}',providers);
    expect(JSON.stringify(result.findings)).not.toContain('synthetic-secret');
    expect(result.findings[0]?.declaration.version).toBe(null);
  });
});
