// action/src/index.ts
import { lstat, realpath, open } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
async function validateRoot(workspace, relative = ".") {
  if (!workspace || !path.isAbsolute(workspace) || (await lstat(workspace)).isSymbolicLink()) throw Error("Invalid workspace");
  if (!relative || relative.length > 1024 || relative.includes("\\") || relative.includes("\0") || relative.startsWith("/") || relative.split("/").some((x) => x === "..") || relative.includes(":")) throw Error("Invalid path");
  const base = await realpath(workspace), target = path.resolve(base, relative);
  if (target !== base && !target.startsWith(base + path.sep)) throw Error("Invalid path");
  const parts = path.relative(base, target).split(path.sep).filter(Boolean);
  let current = base;
  for (const part of parts) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw Error("Invalid path");
  }
  if (!(await lstat(target)).isDirectory() || await realpath(target) !== target) throw Error("Invalid directory");
  return target;
}
async function appendCommandFile(filename, workspace, content) {
  if (!path.isAbsolute(filename) || Buffer.byteLength(content) > 128e3) throw Error("Invalid command file");
  const file = await realpath(filename), base = await realpath(workspace);
  if (file === base || file.startsWith(base + path.sep) || file !== path.resolve(filename)) throw Error("Invalid command file");
  const before = await lstat(file);
  if (!before.isFile() || before.nlink !== 1) throw Error("Invalid command file");
  const fd = await open(file, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await fd.stat();
    if (!info.isFile() || info.nlink !== 1 || info.dev !== before.dev || info.ino !== before.ino) throw Error("Changed command file");
    await fd.writeFile(content);
  } finally {
    await fd.close();
  }
}
function scanWorker(root, timeout = 75e3) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.mjs", import.meta.url), { workerData: { root }, execArgv: [], env: {}, resourceLimits: { maxOldGenerationSizeMb: 512 } });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().then(() => error ? reject(Error("Scan failed")) : resolve(value));
    };
    const timer = setTimeout(() => finish(true), timeout);
    worker.once("message", (message) => finish(message.ok !== true, message.result));
    worker.once("error", () => finish(true));
    worker.once("exit", () => {
      if (!settled) finish(true);
    });
  });
}
async function runAction(env, runtime = { platform: process.platform, arch: process.arch, node: process.versions.node }) {
  if (runtime.platform !== "linux" || runtime.arch !== "x64" || runtime.node.split(".")[0] !== "24") throw Error("Unsupported runner: Linux x64 / Node 24 required");
  if (Object.keys(env).some((k) => k.startsWith("INPUT_") && k !== "INPUT_PATH")) throw Error("Unexpected input");
  const root = await validateRoot(env.GITHUB_WORKSPACE ?? "", env.INPUT_PATH ?? ".");
  const result = await scanWorker(root);
  const json = JSON.stringify(result);
  if (json.length > 1e5) throw Error("Output limit");
  const status = result.status;
  if (status !== "complete" && status !== "partial") throw Error("Invalid result");
  if (env.GITHUB_OUTPUT) await appendCommandFile(env.GITHUB_OUTPUT, env.GITHUB_WORKSPACE, `status=${status}
result=${json}
`);
  if (env.GITHUB_STEP_SUMMARY) await appendCommandFile(env.GITHUB_STEP_SUMMARY, env.GITHUB_WORKSPACE, `## PatchWRK Free Scanner

Status: **${status}**. Static evidence only; no production-health guarantee.

\`\`\`json
${json}
\`\`\`
`);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runAction(process.env).then((result) => {
    console.error(`PatchWRK: ${result.status}; privacy-minimized JSON follows. Findings alone do not fail the job; incomplete coverage does.`);
    console.error(`Discovery counts: ${JSON.stringify(result.discoveries)}`);
    console.error(`Historical finding counts: ${JSON.stringify(result.counts)}`);
    console.log(JSON.stringify(result));
    if (result.status === "partial") process.exitCode = 2;
  }).catch(() => {
    console.error("PatchWRK: action failed; no report or compatibility conclusion. Check runtime, inputs and checkout.");
    process.exitCode = 1;
  });
}
export {
  appendCommandFile,
  runAction,
  scanWorker,
  validateRoot
};
