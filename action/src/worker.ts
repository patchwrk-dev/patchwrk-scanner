import { fileURLToPath } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import { scanWithCompatibility } from '../../src/compatibility/index.ts';
import { LocalChangeCatalog } from '../../src/changes/catalog.ts';
import { minimize } from './result.ts';
try {
  const report = await scanWithCompatibility(workerData.root, { catalog: new LocalChangeCatalog(fileURLToPath(new URL('./catalog.json', import.meta.url))) });
  parentPort?.postMessage({ ok: true, result: minimize(report) });
} catch {
  parentPort?.postMessage({ ok: false });
}
