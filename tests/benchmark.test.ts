import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { scanWithCompatibility } from '../src/compatibility/index.ts';
interface Example {
  id: string; files: Record<string, string>;
  labels: {providers: string[]; reportedProviders: string[]; statuses: Record<string, string>; supported: boolean};
}
it('evaluates manually labeled synthetic repository benchmarks', async () => {
  const suite = JSON.parse(await readFile('tests/fixtures/benchmark/suite.json', 'utf8')) as {cases: Example[]};
  let tp = 0; let fp = 0; let fn = 0; let supportedTp = 0; let supportedFn = 0;
  let statusChecks = 0; const durations: {id: string; milliseconds: number}[] = [];
  for (const example of suite.cases) {
    const root = await mkdtemp(resolve('.scanner-test-benchmark-'));
    try {
      for (const [file, content] of Object.entries(example.files)) {
        const target = resolve(root, file); await mkdir(dirname(target), {recursive: true}); await writeFile(target, content);
      }
      const start = performance.now(); const report = await scanWithCompatibility(root);
      durations.push({id: example.id, milliseconds: Math.round((performance.now() - start) * 100) / 100});
      const observed = new Set(report.integrations.map((item) => item.provider));
      expect([...observed].sort(), example.id).toEqual([...example.labels.reportedProviders].sort());
      for (const provider of observed) { if (example.labels.providers.includes(provider)) tp++; else fp++; }
      for (const provider of example.labels.providers) {
        if (!observed.has(provider)) fn++;
        if (example.labels.supported) { if (observed.has(provider)) supportedTp++; else supportedFn++; }
      }
      for (const [provider, status] of Object.entries(example.labels.statuses)) {
        const assessments = report.compatibility.assessments.filter((item) => item.provider === provider && item.changeId === (provider === 'stripe' ? 'stripe.sdk8.request-option-rename' : 'openai.text-davinci-003.retirement'));
        expect(assessments, example.id).not.toHaveLength(0);
        expect(assessments.every((item) => item.status === status), example.id).toBe(true); statusChecks++;
      }
    } finally { await rm(root, {recursive: true, force: true}); }
  }
  const metrics = {repositories: suite.cases.length,unit:'provider presence per repository',tp,fp,fn,
    precision: tp / (tp + fp),recall: tp / (tp + fn),supportedRecall: supportedTp / (supportedTp + supportedFn),statusChecks,durations};
  expect(fp).toBe(0); expect(fn).toBe(2); expect(metrics.supportedRecall).toBe(1);
  console.log('PATCHWRK_BENCHMARK', JSON.stringify(metrics));
});
