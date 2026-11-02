import { lstat, realpath, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { minimize } from './result.ts';
type SafeResult = ReturnType<typeof minimize>;

export async function validateRoot(workspace: string, relative = '.') {
  if (!workspace || !path.isAbsolute(workspace) || (await lstat(workspace)).isSymbolicLink()) throw Error('Invalid workspace');
  if (!relative || relative.length > 1024 || relative.includes('\\') || relative.includes('\0') || relative.startsWith('/') || relative.split('/').some(x => x === '..') || relative.includes(':')) throw Error('Invalid path');
  const base = await realpath(workspace), target = path.resolve(base, relative);
  if (target !== base && !target.startsWith(base + path.sep)) throw Error('Invalid path');
  const parts = path.relative(base, target).split(path.sep).filter(Boolean);
  let current = base;
  for (const part of parts) { current = path.join(current, part); if ((await lstat(current)).isSymbolicLink()) throw Error('Invalid path'); }
  if (!(await lstat(target)).isDirectory() || await realpath(target) !== target) throw Error('Invalid directory');
  return target;
}

export async function appendCommandFile(filename: string, workspace: string, content: string) {
  // Runner-provided command files must be existing regular, single-link files outside scanned content.
  if (!path.isAbsolute(filename) || Buffer.byteLength(content) > 128_000) throw Error('Invalid command file');
  const file = await realpath(filename), base = await realpath(workspace);
  if (file === base || file.startsWith(base + path.sep) || file !== path.resolve(filename)) throw Error('Invalid command file');
  const before = await lstat(file);
  if (!before.isFile() || before.nlink !== 1) throw Error('Invalid command file');
  const fd = await open(file, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await fd.stat();
    if (!info.isFile() || info.nlink !== 1 || info.dev !== before.dev || info.ino !== before.ino) throw Error('Changed command file');
    await fd.writeFile(content);
  } finally { await fd.close(); }
}

export function scanWorker(root: string, timeout = 75_000) {
  return new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { root }, execArgv: [], env: {}, resourceLimits: { maxOldGenerationSizeMb: 512 } });
    let settled = false;
    const finish = (error: boolean, value?: unknown) => {
      if (settled) return; settled = true; clearTimeout(timer);
      void worker.terminate().then(() => error ? reject(Error('Scan failed')) : resolve(value));
    };
    const timer = setTimeout(() => finish(true), timeout);
    worker.once('message', (message: { ok?: boolean; result?: unknown }) => finish(message.ok !== true, message.result));
    worker.once('error', () => finish(true));
    worker.once('exit', () => { if (!settled) finish(true); });
  });
}

export async function runAction(env: NodeJS.ProcessEnv, runtime = { platform: process.platform as string, arch: process.arch as string, node: process.versions.node }) {
  if (runtime.platform !== 'linux' || runtime.arch !== 'x64' || runtime.node.split('.')[0] !== '24') throw Error('Unsupported runner: Linux x64 / Node 24 required');
  if (Object.keys(env).some(k => k.startsWith('INPUT_') && k !== 'INPUT_PATH')) throw Error('Unexpected input');
  const root = await validateRoot(env.GITHUB_WORKSPACE ?? '', env.INPUT_PATH ?? '.');
  const result = await scanWorker(root) as SafeResult;
  const json = JSON.stringify(result);
  if (json.length > 100_000) throw Error('Output limit');
  const status = (result as { status: string }).status;
  if (status !== 'complete' && status !== 'partial') throw Error('Invalid result');
  if (env.GITHUB_OUTPUT) await appendCommandFile(env.GITHUB_OUTPUT, env.GITHUB_WORKSPACE!, `status=${status}\nresult=${json}\n`);
  if (env.GITHUB_STEP_SUMMARY) await appendCommandFile(env.GITHUB_STEP_SUMMARY, env.GITHUB_WORKSPACE!, `## PatchWRK Free Scanner\n\nStatus: **${status}**. Static evidence only; no production-health guarantee.\n\n\`\`\`json\n${json}\n\`\`\`\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runAction(process.env).then(result => {
    console.error(`PatchWRK: ${(result as {status: string}).status}; privacy-minimized JSON follows. Findings alone do not fail the job; incomplete coverage does.`);
    console.error(`Discovery counts: ${JSON.stringify(result.discoveries)}`);
    console.error(`Historical finding counts: ${JSON.stringify(result.counts)}`);
    console.log(JSON.stringify(result));
    if (result.status === 'partial') process.exitCode = 2;
  }).catch(() => { console.error('PatchWRK: action failed; no report or compatibility conclusion. Check runtime, inputs and checkout.'); process.exitCode = 1; });
}
