import { scanWithCompatibility } from '../compatibility/index.ts';
import { formatJson, formatTerminal } from '../reports/index.ts';
import type { ScanLimits } from '../types/index.ts';
import { listChanges } from '../changes/index.ts';
import { formatChangesJson, formatChangesTerminal } from '../reports/changes.ts';
import type { ChangeCatalogRepository } from '../types/changes.ts';
import type { ModuleLimits } from '../types/analysis.ts';

export const help = `PatchWRK Scanner

Usage: patchwrk scan [directory] [--json]
       patchwrk changes [--provider name] [--json]
       patchwrk --help

Commands:
  scan       Discover supported API SDK dependencies and source evidence
  changes    List the local offline change catalog (no live updates)

Options:
  --help, -h Show this help
  --json     Print a JSON report
  --provider NAME    Filter changes by provider
  --max-files N       Maximum files read (default: 2000)
  --max-file-bytes N  Maximum bytes per file (default: 1048576)
  --max-total-bytes N Maximum total bytes read (default: 20971520)
  --max-entries N    Maximum directory entries (default: 20000)
  --max-depth N      Maximum directory depth (default: 32)
  --api-version provider=version  Supply a user-declared remote API version
  --max-modules N     Maximum source modules indexed (default: 256)
  --max-module-edges N Maximum module edges (default: 2000)
  --max-module-depth N Maximum module traversal depth (default: 32)
  --max-resolution-steps N Maximum graph work steps (default: 10000)

The directory defaults to the current working directory.
Discovery and compatibility matching are static and read-only; no live monitoring.`;

export interface CliOutput {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export const changesHelp = `PatchWRK API Change Intelligence

Usage: patchwrk changes [--provider NAME] [--json]

Options:
  --provider NAME  stripe, openai, anthropic, shopify, or twilio
  --coverage       Show catalog coverage and recorded source retrieval dates
  --json           Print a JSON report
  --help, -h       Show this help

Local offline catalog only; no live retrieval or continuous updates.`;

export async function runCli(args: string[], output: CliOutput, services: { catalog?: ChangeCatalogRepository } = {}): Promise<number> {
  try {
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
      output.stdout(args[0] === 'changes' ? changesHelp : help);
      return 0;
    }
    if (args[0] === 'changes') {
      let provider: string | undefined;
      let json = false;
      let coverageOnly = false;
      for (let index = 1; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--json') json = true;
        else if (arg === '--coverage' && !coverageOnly) coverageOnly = true;
        else if (arg === '--provider' && provider === undefined) {
          provider = args[++index];
          if (!provider || provider.startsWith('-')) throw new Error('Expected provider after --provider.');
        } else throw new Error('Unknown or duplicate changes argument. Use patchwrk changes --help.');
      }
      const report = await listChanges(services.catalog, provider);
      output.stdout(json ? formatChangesJson(report) : formatChangesTerminal(report, coverageOnly));
      return 0;
    }
    if (args[0] !== 'scan') throw new Error('Unknown command. Use patchwrk --help.');
    let directory: string | undefined;
    let json = false;
    let positionalOnly = false;
    const limits: Partial<ScanLimits> = {};
    const analysisLimits: Partial<ModuleLimits> = {};
    const moduleOptions: Record<string, keyof ModuleLimits> = {
      '--max-modules': 'maxModules', '--max-module-edges': 'maxEdges', '--max-module-depth': 'maxTraversalDepth', '--max-resolution-steps': 'maxResolutionSteps',
    };
    const apiVersionInputs: string[] = [];
    const usedLimitOptions = new Set<string>();
    const limitOptions: Record<string, keyof ScanLimits> = {
      '--max-files': 'maxFiles', '--max-file-bytes': 'maxFileBytes',
      '--max-total-bytes': 'maxTotalBytes', '--max-entries': 'maxEntries', '--max-depth': 'maxDepth',
    };
    for (let index = 1; index < args.length; index++) {
      const arg = args[index]!;
      if (!positionalOnly && arg === '--') positionalOnly = true;
      else if (!positionalOnly && arg === '--json') json = true;
      else if (!positionalOnly && arg === '--api-version') {
        const value = args[++index];
        if (!value || value.startsWith('-')) throw new Error('Expected provider=version after --api-version.');
        apiVersionInputs.push(value);
      }
      else if (!positionalOnly && Object.hasOwn(limitOptions, arg)) {
        if (usedLimitOptions.has(arg)) throw new Error('Duplicate scan limit option.');
        usedLimitOptions.add(arg);
        const value = args[++index];
        if (!value || !/^[1-9]\d*$/u.test(value)) throw new Error(`Expected a positive integer after ${arg}.`);
        limits[limitOptions[arg]!] = Number(value);
      }
      else if (!positionalOnly && Object.hasOwn(moduleOptions, arg)) {
        if (usedLimitOptions.has(arg)) throw new Error('Duplicate module analysis limit option.');
        usedLimitOptions.add(arg);
        const value = args[++index];
        if (!value || !/^[1-9]\d*$/u.test(value)) throw new Error('Expected a positive integer module limit.');
        analysisLimits[moduleOptions[arg]!] = Number(value);
      }
      else if (!positionalOnly && arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
      else if (directory !== undefined) throw new Error('Only one directory may be scanned.');
      else directory = arg;
    }
    const report = await scanWithCompatibility(directory ?? process.cwd(), { scan: { limits, analysisLimits }, apiVersionInputs, ...services });
    output.stdout(json ? formatJson(report) : formatTerminal(report));
    return 0;
  } catch (error) {
    output.stderr(`PatchWRK: ${JSON.stringify(error instanceof Error ? error.message : 'Scan failed.')}`);
    return 1;
  }
}
