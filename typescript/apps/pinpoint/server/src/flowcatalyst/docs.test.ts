import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildDocPages } from './docs.js';

const ARCHITECTURE_DOC = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/architecture.md',
);

const SAMPLE = [
  '# Pinpoint — Architecture',
  '',
  '> Lede paragraph.',
  '',
  '**Contents** — [What](#1-what) · [More](#2-more)',
  '',
  '## 1. What pinpoint does',
  '',
  'See [HANDOFF.md](HANDOFF.md) and [the spec](https://example.test/spec).',
  '',
  '```',
  '## not a heading — inside a fence',
  '```',
  '',
  '## 2. System context',
  '',
  '```mermaid',
  'flowchart LR',
  '  a --> b',
  '```',
  '',
  '## 3. Code structure and layering',
  '',
  'Body three.',
  '',
  '## 4. Domain model',
  '',
  'Body four.',
  '',
  '## 5. The write path',
  '',
  'Body five.',
  '',
  '## 6. Process flows',
  '',
  '### 6.1 A sub-heading',
  '',
  'Body six.',
  '',
  '## 7. HTTP surface and contracts',
  '## 8. Identity and permissions',
  '## 9. FlowCatalyst platform integration',
  '## 10. Deployment',
  '## 11. Data, indexes and migrations',
  '## 12. Configuration reference',
  '## 13. Testing and tooling',
  '',
  'Flows are described in §6; the topology in §10.',
  '',
  '## 14. Known gaps and divergences',
].join('\n');

describe('buildDocPages', () => {
  it('splits the document into the five platform pages', () => {
    const pages = buildDocPages(SAMPLE);
    expect(pages.map((p) => p.slug)).toEqual([
      'architecture-overview',
      'domain-model',
      'process-flows',
      'api-and-access',
      'operations',
    ]);
    expect(pages.every((p) => p.content.startsWith(`# ${p.title}\n`))).toBe(true);
  });

  it('drops the repo doc section numbering, and the heading when it repeats the page title', () => {
    const pages = buildDocPages(SAMPLE);
    const flows = pages.find((p) => p.slug === 'process-flows');
    expect(flows?.content).not.toMatch(/^#{2,6} \d+[.\s]/m);
    // single-section page named after itself → no duplicated heading
    expect(flows?.content).not.toContain('## Process flows');
    // its sub-headings are promoted so the page still has h2s
    expect(flows?.content).toContain('## A sub-heading');
    const overview = pages[0];
    expect(overview?.content).toContain('## What pinpoint does');
    expect(overview?.content).toContain('## System context');
  });

  it('keeps the lede on the first page only, without the in-page contents list', () => {
    const [first, second] = buildDocPages(SAMPLE);
    expect(first?.content).toContain('> Lede paragraph.');
    expect(first?.content).not.toContain('**Contents**');
    expect(second?.content).not.toContain('> Lede paragraph.');
  });

  it('does not treat a `## ` line inside a fenced block as a section heading', () => {
    const first = buildDocPages(SAMPLE)[0];
    expect(first?.content).toContain('## not a heading — inside a fence');
  });

  it('preserves mermaid fences (the platform renders them)', () => {
    const first = buildDocPages(SAMPLE)[0];
    expect(first?.content).toContain('```mermaid');
    expect(first?.content).toContain('flowchart LR');
  });

  it('rewrites §N to the page that now holds that section', () => {
    const operations = buildDocPages(SAMPLE).at(-1);
    expect(operations?.content).toContain('*Process Flows*');
    expect(operations?.content).toContain('*Deployment & Operations*');
    expect(operations?.content).not.toMatch(/§\d/);
  });

  it('degrades repo-relative links to code spans but keeps http links', () => {
    const first = buildDocPages(SAMPLE)[0];
    expect(first?.content).toContain('`HANDOFF.md`');
    expect(first?.content).toContain('[the spec](https://example.test/spec)');
  });

  it('throws when a section has no page (a new `## N.` must be mapped)', () => {
    expect(() => buildDocPages(`${SAMPLE}\n\n## 15. Something new\n\nBody.`)).toThrow(/15/);
  });

  it('maps every section of the real docs/architecture.md', () => {
    const pages = buildDocPages(readFileSync(ARCHITECTURE_DOC, 'utf8'));
    expect(pages).toHaveLength(5);
    for (const page of pages) expect(page.content.length).toBeGreaterThan(200);
    // Every mermaid diagram in the source survives the split.
    const source = readFileSync(ARCHITECTURE_DOC, 'utf8');
    const sourceDiagrams = (source.match(/```mermaid/g) ?? []).length;
    const pageDiagrams = pages.reduce(
      (n, p) => n + (p.content.match(/```mermaid/g) ?? []).length,
      0,
    );
    expect(pageDiagrams).toBe(sourceDiagrams);
  });
});
