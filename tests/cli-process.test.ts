import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

const execute = promisify(execFile);
const entry = resolve('src/cli/index.ts');
let sandbox: string;
beforeEach(async () => { sandbox = await mkdtemp(resolve('.scanner-test-')); });
afterEach(async () => { await rm(sandbox, { recursive: true, force: true }); });

it('shows help through the actual Node entry point', async () => {
  const result = await execute(process.execPath, [entry, '--help']);
  expect(result.stdout).toContain('Usage: patchwrk scan [directory]');
  expect(result.stderr).toBe('');
});

it('prints JSON evidence without running repository scripts or modules', async () => {
  const repository = resolve(sandbox, 'repo');
  await mkdir(repository);
  await writeFile(resolve(repository, 'package.json'), '{"dependencies":{"stripe":"^17.0.0"},"scripts":{"preinstall":"exit 99"}}');
  await writeFile(resolve(repository, 'client.js'), "const Stripe = require('stripe'); throw new Error('MUST NOT RUN');");
  const result = await execute(process.execPath, [entry, 'scan', repository, '--json']);
  expect(result.stderr).toBe('');
  const report = JSON.parse(result.stdout);
  expect(report.integrations[0].provider).toBe('stripe');
  expect(report.integrations[0].locations.map((location: { type: string }) => location.type)).toContain('commonjs-require');
  expect(report.coverage.complete).toBe(true);
});

it('exits with status 1 and no stdout for an invalid scan path', async () => {
  try {
    await execute(process.execPath, [entry, 'scan', resolve(sandbox, 'missing'), '--json']);
    expect.fail('Expected CLI failure');
  } catch (error) {
    expect(error).toMatchObject({ code: 1, stdout: '' });
    expect((error as { stderr: string }).stderr).toContain('does not exist');
  }
});
