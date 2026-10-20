import { createHash } from 'node:crypto';
import type { HistoryListing, SavedScan } from '../types/history.ts';
import { escapeHtml } from './html.ts';
import { maxHtmlBytes } from '../artifacts/filesystem.ts';

export function historySummary(record: SavedScan) {
  return { scanId: record.scanId, projectId: record.projectId, savedAt: record.savedAt, scanStartedAt: record.snapshot.metadata.startedAt,
    scannerVersion: record.snapshot.metadata.scannerVersion, catalogVersion: record.snapshot.metadata.catalogVersion,
    catalogFingerprint: record.snapshot.metadata.catalogFingerprint, complete: record.snapshot.complete, readable: true,
    integrations: record.identities.integrations, stats: record.snapshot.stats };
}
export function formatHistoryTerminal(list: HistoryListing): string {
  return ['PatchWRK — local scan history (historical snapshots, not current compatibility)', `Project: ${list.projectId}`, `Records: ${list.records.length}; stored file bytes: ${list.bytes}`,
    ...list.records.map((record) => `${record.scanId} | ${record.snapshot.metadata.startedAt} | integrations ${record.identities.integrations.length} | attention ${record.snapshot.stats[2]!.value} | unknown ${record.snapshot.stats[3]!.value} | ${record.snapshot.complete ? 'recorded scope complete' : 'partial'} | readable snapshot`),
    ...list.warnings.map((warning) => `Warning: ${warning}`), 'Schema validation does not authenticate stored findings. No rescan, upload or monitoring.'].join('\n');
}
export function formatSavedTerminal(record: SavedScan): string {
  return ['PatchWRK — historical snapshot (not current compatibility)', `Scan: ${record.scanId}; project: ${record.projectId}`, `Original scan: ${record.snapshot.metadata.startedAt}; saved: ${record.savedAt}`,
    `Scanner: ${record.snapshot.metadata.scannerVersion ?? 'unknown'}; catalog: ${record.snapshot.metadata.catalogVersion}; fingerprint: ${record.snapshot.metadata.catalogFingerprint}`,
    ...record.snapshot.stats.map((stat) => `${stat.label}: ${stat.value}`),
    ...record.snapshot.sections.find((s) => s.kind === 'findings')!.blocks.flatMap((block) => [
      `${JSON.stringify(block.title)}: ${block.status ?? 'No assessment'}`, ...(block.finding?.uncertainty ?? block.notes).map((note) => `  ${JSON.stringify(note)}`),
    ]), 'Use --json for the complete stored privacy-filtered snapshot or --html NEW.html for a historical report. No rescan was performed.'].join('\n');
}
const historyCss = `*{box-sizing:border-box}body{font:16px/1.6 system-ui,sans-serif;background:#f6f5f1;color:#191a1c;margin:0}main{max-width:1120px;margin:auto;padding:40px 24px}.brand{font-size:18px;font-weight:750;margin:0}h1{font-size:clamp(30px,4.2vw,44px);line-height:1.15;margin:28px 0 12px}h2{font-size:21px;margin:0}p{margin:8px 0}.muted,dt{color:#55585d}.notice{border-left:3px solid #191a1c;padding:12px 18px;margin:24px 0;background:#fff}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:24px 0}.stat,article,.technical{background:#fff;border:1px solid #deded7;border-radius:12px;padding:20px}.stat strong{display:block;font-size:28px;line-height:1.3}.stat span{font-size:13px;color:#55585d}.latest{margin:20px 0}.timeline{display:grid;gap:18px;margin:24px 0}article header{display:flex;justify-content:space-between;align-items:start;gap:16px}.badges{display:flex;flex-wrap:wrap;gap:8px}.badge{display:inline-block;font-size:12px;font-weight:650;border-radius:20px;border:1px solid #d7dade;background:#f1f2f3;color:#4a5058;padding:4px 10px}.affected{color:#9d2929;background:#fff0f0;border-color:#efc8c8}.review{color:#805000;background:#fff6e6;border-color:#ead4a9}dl{display:grid;grid-template-columns:minmax(160px,1fr) 2fr;gap:8px 20px;margin:18px 0}dd{margin:0}p,dd,code,li{overflow-wrap:anywhere}code{font-size:13px}details{border-top:1px solid #deded7;margin-top:18px;padding-top:14px}summary{cursor:pointer;font-weight:650}summary:focus-visible{outline:3px solid #151515;outline-offset:4px}.technical details{border:0;margin:0;padding:0}footer{font-size:13px;color:#55585d;margin:28px 0}.empty{padding:24px 0}@media(max-width:700px){main{padding:24px 16px}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}article header{display:block}.badges{margin-top:12px}dl{grid-template-columns:1fr;gap:4px}dd{margin-bottom:10px}.stat,article,.technical{padding:16px}}`;

function displayDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value)) + ' UTC';
}

function historyBadges(record: SavedScan): string {
  const statuses = record.identities.findings.map((finding) => finding.status);
  const badges: string[] = [];
  if (statuses.includes('affected')) badges.push('<span class="badge affected">Affected</span>');
  if (statuses.includes('potentially-affected')) badges.push('<span class="badge review">Review needed</span>');
  if (record.snapshot.stats[3]!.value > 0 || !record.snapshot.complete || record.identities.integrations.length === 0) badges.push('<span class="badge">Unknown</span>');
  if (badges.length === 0) badges.push('<span class="badge">No known finding within coverage</span>');
  return badges.join('');
}

export function formatHistoryHtml(list: HistoryListing): string {
  const hash = createHash('sha256').update(historyCss).digest('base64'); const e = escapeHtml;
  // Repository order is newest saved snapshot first; rendering does not mutate records.
  const latest = list.records[0];
  const stat = (label: string, value: number | undefined) => `<div class="stat"><strong>${value ?? '—'}</strong><span>${label}</span></div>`;
  const cards = list.records.map((record, index) => {
    const title = index === 0 ? 'Latest scan' : index === 1 ? 'Previous scan' : `Scan ${index + 1} — ${displayDate(record.snapshot.metadata.startedAt)}`;
    return `<article><header><div><h2>${e(title)}</h2><p class="muted">${e(displayDate(record.snapshot.metadata.startedAt))}</p></div><div class="badges">${historyBadges(record)}</div></header><dl><dt>Supported integrations</dt><dd>${e(record.identities.integrations.map((i) => `${i.provider} (${i.packageName})`).join(', ') || 'None detected within supported scope')}</dd><dt>Assessments requiring attention</dt><dd>${record.snapshot.stats[2]!.value}</dd><dt>Unknown assessments</dt><dd>${record.snapshot.stats[3]!.value}</dd><dt>Recorded scope</dt><dd>${record.snapshot.complete ? 'Complete within supported scope' : 'Partial — review coverage limits'}</dd><dt>Snapshot readability</dt><dd>Validated snapshot (not authenticated)</dd></dl><details><summary>Technical details</summary><dl><dt>Full scan UUID</dt><dd><code>${e(record.scanId)}</code></dd><dt>Snapshot filename</dt><dd><code>${e(record.scanId)}.json</code></dd><dt>Original UTC timestamp</dt><dd>${e(record.snapshot.metadata.startedAt)}</dd><dt>Saved UTC timestamp</dt><dd>${e(record.savedAt)}</dd><dt>Snapshot schema version</dt><dd>${record.schemaVersion}</dd><dt>Validation / readability</dt><dd>Schema validated and readable; local contents are not authenticated.</dd></dl><p>Reopen explicitly to a new destination; redacted equivalent:</p><code>patchwrk history show ${e(record.scanId)} --directory &lt;selected-history&gt; --html &lt;new-report.html&gt;</code></details></article>`;
  }).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'sha256-${hash}'; img-src 'none'; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PatchWRK — Scan History</title><style>${historyCss}</style></head><body><main><p class="brand">PatchWRK Scanner</p><h1>Scan History</h1><p class="muted">Review previous local scans and their recorded findings.</p><aside class="notice">Saved, privacy-filtered snapshots — not live compatibility information. No original project was rescanned.</aside><div class="stats">${stat('Saved scans (readable)', list.records.length)}${stat('Latest scan: integrations', latest?.snapshot.stats[1]!.value)}${stat('Latest scan: requiring attention', latest?.snapshot.stats[2]!.value)}${stat('Latest scan: unknown assessments', latest?.snapshot.stats[3]!.value)}</div><p class="latest">Latest original scan: <strong>${latest ? e(displayDate(latest.snapshot.metadata.startedAt)) : 'No saved scan available'}</strong></p><p class="muted">Newest saved snapshot first. Counts include validated readable records only; unreadable or unknown entries are excluded.</p>${list.warnings.length ? `<aside class="notice"><strong>History needs review</strong><ul>${list.warnings.map((w) => `<li>${e(w)}</li>`).join('')}</ul></aside>` : ''}<section class="timeline" aria-label="Saved scans">${cards || '<p class="empty">No readable saved scans. Save a scan explicitly through the CLI to add a snapshot.</p>'}</section><div class="technical"><details><summary>History directory metadata</summary><dl><dt>Project UUID</dt><dd><code>${e(list.projectId)}</code></dd><dt>Listing schema version</dt><dd>${list.schemaVersion}</dd><dt>Stored file bytes</dt><dd>${list.bytes}</dd></dl></details></div><footer><p>Attention = Affected + Potential risk; unknowns also require review. No known finding within coverage does not establish application health or guarantee compatibility.</p><p>History is managed through explicit CLI commands. No automatic deletion, telemetry, Cloud synchronization or repair. A schema-valid local file does not prove genuine Scanner execution. Review privately before sharing.</p></footer></main></body></html>`;
  if (Buffer.byteLength(html, 'utf8') > maxHtmlBytes) throw new Error('History HTML exceeds the 32 MiB output limit.');
  return html;
}
