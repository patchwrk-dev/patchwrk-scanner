import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { formatHistoryHtml } from '../src/reports/history.ts';
import type { HistoryListing, SavedScan } from '../src/types/history.ts';

function record(): SavedScan {
  return {
    schemaVersion: 1, scanId: '11111111-1111-4111-8111-111111111111', projectId: '22222222-2222-4222-8222-222222222222', savedAt: '2026-10-20T12:01:00.000Z',
    identities: { integrations: [{ provider: 'openai', packageName: 'openai' }], findings: [] },
    snapshot: { schemaVersion: 1, metadata: { startedAt: '2026-10-20T12:00:00.000Z' }, complete: true,
      stats: [{ label: 'Files scanned', value: 2 }, { label: 'Supported integrations', value: 1 }, { label: 'Assessments requiring attention', value: 0 }, { label: 'Unknown assessments', value: 0 }] } as SavedScan['snapshot'],
  };
}
function listing(records = [record()]): HistoryListing { return { schemaVersion: 1, projectId: 'project', records, warnings: [], bytes: 123 }; }

it('renders real recorded counts and UTC dates without mutating the listing', () => {
  const list = listing(); const before = structuredClone(list); const html = formatHistoryHtml(list);
  expect(list).toEqual(before);
  expect(html).toContain('<h1>Scan History</h1>'); expect(html).toContain('<h2>Latest scan</h2>');
  expect(html).toContain('October 20, 2026 at 12:00 PM UTC');
  expect(html).toContain('No known finding within coverage'); expect(html).toContain('does not establish application health');
  expect(html).toContain('Newest saved snapshot first');
});

it('preserves reopening metadata in native collapsed details', () => {
  const html = formatHistoryHtml(listing());
  const details = html.match(/<details><summary>Technical details<\/summary>(.*?)<\/details>/su)![1]!;
  for (const value of ['11111111-1111-4111-8111-111111111111.json', '2026-10-20T12:00:00.000Z', '2026-10-20T12:01:00.000Z', 'Snapshot schema version', 'not authenticated', 'redacted equivalent:', 'patchwrk history show']) expect(details).toContain(value);
  expect(html).not.toMatch(/<details[^>]*\bopen/u);
  expect(html).not.toMatch(/<button|<script|onclick=|href=|src=/u);
});

it('handles empty history without inventing latest scan counts and keeps warnings escaped', () => {
  const list = listing([]); list.warnings = ['<img src=x onerror=alert(1)>'];
  const html = formatHistoryHtml(list);
  expect(html).toContain('No saved scan available'); expect(html).toContain('No readable saved scans');
  expect(html).toContain('<strong>—</strong>'); expect(html).toContain('&lt;img'); expect(html).not.toContain('<img');
});

it('keeps uncertainty visible alongside affected findings and distinguishes previous cards', () => {
  const first = record(); first.snapshot.stats[3]!.value = 2;
  first.identities.findings = [{ status: 'affected' } as SavedScan['identities']['findings'][number]];
  const html = formatHistoryHtml(listing([first, record(), record()]));
  expect(html).toContain('badge affected">Affected'); expect(html).toContain('badge">Unknown');
  expect(html).toContain('<h2>Previous scan</h2>'); expect(html).toContain('<h2>Scan 3 — October 20, 2026');
});

it('hashes only its static stylesheet for CSP and retains mobile layout', () => {
  const html = formatHistoryHtml(listing()); const css = html.match(/<style>(.*?)<\/style>/su)![1]!;
  expect(html).toContain(`style-src 'sha256-${createHash('sha256').update(css).digest('base64')}'`);
  for (const directive of ["default-src 'none'", "script-src 'none'", "connect-src 'none'", "form-action 'none'"]) expect(html).toContain(directive);
  expect(css).toContain('@media(max-width:700px)'); expect(css).not.toContain('url(');
  const list = listing(); list.records[0]!.identities.integrations[0]!.packageName = '</dd><script>alert(1)</script>';
  expect(formatHistoryHtml(list)).not.toContain('<script>'); expect(formatHistoryHtml(list)).toContain('&lt;script&gt;');
});
