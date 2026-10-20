import type { CliOutput } from './run.ts';
import { LocalScanHistoryRepository } from '../history/repository.ts';
import { formatHistoryTerminal, formatHistoryHtml, formatSavedTerminal, historySummary } from '../reports/history.ts';
import { formatHtml } from '../reports/html.ts';
import { writeNewArtifact } from '../artifacts/filesystem.ts';
import { uuid } from '../history/validation.ts';

export const historyHelp = `PatchWRK local scan history (offline, opt-in)

history init --directory DIR [--json]
scan TARGET --history-dir DIR --project-id UUID [--json] [--html NEW.html]
history list --directory DIR [--project-id UUID] [--json] [--html NEW.html]
history show SCAN_UUID --directory DIR [--json] [--html NEW.html]
history delete SCAN_UUID --directory DIR [--apply] [--json]
history prune --directory DIR --project-id UUID [--keep-last N] [--older-than-days N] [--apply] [--json]

No implicit history location. Init creates one project UUID per private directory.
Delete/prune preview by default; --apply explicitly authorizes local unlink.
Age AND keep-last criteria are combined. No automatic pruning, sync or rescan.
HTML is generated only to an explicitly requested NEW destination; no browser opens.
Records and reports can retain sensitive root-relative labels; inspect privately.`;

export async function runHistory(args: string[], output: CliOutput): Promise<number> {
  const command = args[1];
  if (!command || !['init', 'list', 'show', 'delete', 'prune'].includes(command)) throw new Error('Unknown history command. Use patchwrk history --help.');
  const values = new Map<string, string>(); let scanId: string | undefined; let json = false; let apply = false;
  const paths = new Set(['--directory', '--project-id', '--html', '--keep-last', '--older-than-days']);
  for (let index = 2; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--json' && !json) json = true;
    else if (arg === '--apply' && !apply) apply = true;
    else if (paths.has(arg) && !values.has(arg)) {
      const value = args[++index]; if (!value || value.startsWith('-')) throw new Error('Missing history option value.'); values.set(arg, value);
    } else if (!arg.startsWith('-') && scanId === undefined && ['show', 'delete'].includes(command)) scanId = uuid(arg);
    else throw new Error('Unknown or duplicate history argument.');
  }
  const allowed: Record<string, string[]> = { init: ['--directory'], list: ['--directory', '--project-id', '--html'], show: ['--directory', '--html'], delete: ['--directory'], prune: ['--directory', '--project-id', '--keep-last', '--older-than-days'] };
  if ([...values.keys()].some((key) => !allowed[command]!.includes(key)) || (apply && !['delete', 'prune'].includes(command))) throw new Error('Option not supported for this history command.');
  const dir = values.get('--directory'); if (!dir) throw new Error('History requires an explicit --directory.');
  if (command === 'init') {
    const project = await LocalScanHistoryRepository.init(dir); output.stdout(json ? JSON.stringify(project, null, 2) : `History initialized. Project UUID: ${project.projectId}`); return 0;
  }
  const repo = await LocalScanHistoryRepository.open(dir, values.get('--project-id'));
  if (command === 'list') {
    const listing = await repo.list(); const html = values.get('--html');
    if (html) await writeNewArtifact(html, formatHistoryHtml(listing));
    output.stdout(json ? JSON.stringify({ ...listing, records: listing.records.map(historySummary) }, null, 2) : formatHistoryTerminal(listing)); return 0;
  }
  if (command === 'show') {
    if (!scanId) throw new Error('History show requires a scan UUID.');
    const record = await repo.get(scanId); const html = values.get('--html');
    if (html) await writeNewArtifact(html, formatHtml(record.snapshot, { scanId: record.scanId, savedAt: record.savedAt }));
    output.stdout(json ? JSON.stringify(record, null, 2) : formatSavedTerminal(record)); return 0;
  }
  if (command === 'delete' && !scanId) throw new Error('History delete requires a scan UUID.');
  const policy: { keepLast?: number; olderThanDays?: number } = {};
  for (const [flag, key] of [['--keep-last', 'keepLast'], ['--older-than-days', 'olderThanDays']] as const) {
    const value = values.get(flag); if (value !== undefined) { if (!/^(?:0|[1-9]\d*)$/u.test(value)) throw new Error('Retention values must be nonnegative integers.'); policy[key] = Number(value); }
  }
  if (command === 'prune' && !values.has('--project-id')) throw new Error('History prune requires an explicit --project-id.');
  const outcome = command === 'delete' ? await repo.remove(scanId!, apply) : await repo.prune(policy, apply);
  output.stdout(json ? JSON.stringify(outcome, null, 2) : `${outcome.applied ? 'Apply' : 'Preview only'}: ${outcome.selected.length} selected; ${outcome.deleted.length} deleted; ${outcome.failed.length} failed.\n${outcome.selected.map((id) => `Selected: ${id}`).join('\n')}\n${outcome.deleted.map((id) => `Deleted: ${id}`).join('\n')}\n${outcome.warnings.join('\n')}`);
  return outcome.failed.length || outcome.lockCleanupFailed ? 1 : 0;
}
