#!/usr/bin/env tsx
/**
 * Parse every ```mermaid block in docs/architecture.md with mermaid's own
 * parser (headless via jsdom) so a broken diagram fails here instead of
 * rendering as an error box on GitHub or in the published artifact.
 *
 *   pnpm docs:check
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const DOC = resolve(here, '../../docs/architecture.md');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
(globalThis as Record<string, unknown>)['window'] = dom.window;
(globalThis as Record<string, unknown>)['document'] = dom.window.document;
const mermaid = (await import('mermaid')).default;
mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });

const src = readFileSync(DOC, 'utf8');
const blocks = [...src.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1] ?? '');
let failed = 0;
for (const [i, block] of blocks.entries()) {
  try {
    const r = await mermaid.parse(block);
    console.log(`#${i + 1} ok (${r?.diagramType ?? '?'})`);
  } catch (err) {
    failed++;
    const msg = String((err as Error).message ?? err)
      .split('\n')
      .slice(0, 2)
      .join(' | ');
    console.error(`#${i + 1} FAIL: ${msg}\n   starts: ${block.split('\n')[0]}`);
  }
}
console.log(`${blocks.length - failed}/${blocks.length} mermaid blocks parse`);
if (failed > 0) process.exit(1);
