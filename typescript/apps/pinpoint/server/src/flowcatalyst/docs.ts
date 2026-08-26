/**
 * Publishing pinpoint's documentation to the FlowCatalyst platform.
 *
 * The platform hosts two things per application, neither of which the SDK's
 * hand-written resources wrap (they exist only in its generated layer), so we
 * call them through `client.request(...)` — which still gives us token
 * injection, retries and the `ResultAsync` error channel:
 *
 *   POST /api/applications/{appCode}/openapi/sync   the OpenAPI document
 *   POST /api/applications/{appCode}/docs/sync      Markdown pages (Mermaid renders)
 *
 * Both are pushed by `pnpm flowcatalyst:sync`. The pages are derived from
 * `apps/pinpoint/docs/architecture.md` — the same source of truth the
 * committed `architecture.html` is built from.
 */
import type { FlowCatalystClient } from '@flowcatalyst/sdk';

export interface PinpointDocPage {
  readonly slug: string;
  readonly title: string;
  readonly content: string;
}

/** What the platform reports back after ingesting a spec. */
export interface SyncOpenApiSpecResult {
  readonly applicationCode: string;
  readonly specId: string;
  readonly version: string;
  readonly status: string;
  readonly unchanged: boolean;
  readonly hasBreaking: boolean;
  readonly archivedPriorVersion?: string;
}

interface PageSpec {
  readonly slug: string;
  readonly title: string;
  /** `## N.` section numbers of docs/architecture.md that make up this page. */
  readonly sections: readonly number[];
}

/**
 * How the 14 sections of architecture.md map onto platform pages. One giant
 * page reads badly in a docs sidebar; one page per section fragments the
 * process flows. These five are the natural seams.
 */
const DOC_PAGES: readonly PageSpec[] = [
  { slug: 'architecture-overview', title: 'Architecture Overview', sections: [1, 2, 3] },
  { slug: 'domain-model', title: 'Domain Model & Write Path', sections: [4, 5] },
  { slug: 'process-flows', title: 'Process Flows', sections: [6] },
  { slug: 'api-and-access', title: 'API Surface & Access', sections: [7, 8, 9] },
  { slug: 'operations', title: 'Deployment & Operations', sections: [10, 11, 12, 13, 14] },
];

interface Section {
  readonly number: number;
  readonly lines: readonly string[];
}

/**
 * Split the document on top-level `## N. Title` headings, ignoring headings
 * that appear inside fenced code blocks (the ASCII source tree contains `#`
 * comments, and mermaid blocks contain `%%`).
 */
function splitSections(markdown: string): { lede: string[]; sections: Section[] } {
  const lines = markdown.split('\n');
  const lede: string[] = [];
  const sections: Section[] = [];
  let current: { number: number; lines: string[] } | null = null;
  let inFence = false;

  for (const line of lines) {
    if (line.startsWith('```')) inFence = !inFence;
    const heading = inFence ? null : /^## (\d+)\. /.exec(line);
    if (heading) {
      if (current) sections.push({ number: current.number, lines: current.lines });
      current = { number: Number(heading[1]), lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
    else lede.push(line);
  }
  if (current) sections.push({ number: current.number, lines: current.lines });
  return { lede, sections };
}

/**
 * Rewrite references that only make sense inside the repo:
 *  - `§N` → the title of the page that now holds section N
 *  - repo-relative links (`[HANDOFF.md](HANDOFF.md)`) → plain code spans;
 *    the platform can't resolve them. http(s) links are left alone.
 */
function rewriteReferences(content: string, sectionToPage: ReadonlyMap<number, PageSpec>): string {
  return content
    .replace(/§(\d+)/g, (whole, n: string) => {
      const page = sectionToPage.get(Number(n));
      return page ? `*${page.title}*` : whole;
    })
    .replace(/\[([^\]]+)\]\((?!https?:)[^)]+\)/g, (_whole, text: string) => `\`${text}\``);
}

/**
 * Render one section for a page: the repo doc's `## 6. Process flows`
 * numbering is an artefact of it being a single document, so drop it. When a
 * page carries exactly one section with the same name as the page, drop the
 * heading too rather than repeat it under the page title.
 */
function renderSection(section: Section, page: PageSpec): string {
  const [heading, ...rest] = section.lines;
  const title = (heading ?? '').replace(/^## \d+\.\s*/, '');
  const duplicate =
    page.sections.length === 1 &&
    title.toLowerCase() === page.title.toLowerCase().replace(/ & /g, ' and ');
  const kept = duplicate ? rest : [`## ${title}`, ...rest];
  let inFence = false;
  const cleaned = kept.map((line) => {
    if (line.startsWith('```')) inFence = !inFence;
    if (inFence) return line;
    // `### 6.1 Create location …` → `### Create location …`; the sub-numbering
    // is orphaned once the parent section number is gone.
    const unnumbered = line.replace(/^(#{3,6}) \d+(\.\d+)*\.?\s+/, '$1 ');
    // When the section heading was dropped as a duplicate of the page title,
    // promote what is left so the page still has h2s for a docs sidebar.
    return duplicate ? unnumbered.replace(/^###/, '##') : unnumbered;
  });
  return cleaned.join('\n').trim();
}

/**
 * Build the platform pages from architecture.md. Every section must land on
 * exactly one page — a new `## N.` heading with no home is an error rather
 * than silently dropped documentation.
 */
export function buildDocPages(markdown: string): PinpointDocPage[] {
  const { lede, sections } = splitSections(markdown);
  const byNumber = new Map(sections.map((s) => [s.number, s]));
  const sectionToPage = new Map<number, PageSpec>();
  for (const page of DOC_PAGES) for (const n of page.sections) sectionToPage.set(n, page);

  const unmapped = sections.map((s) => s.number).filter((n) => !sectionToPage.has(n));
  if (unmapped.length > 0) {
    throw new Error(
      `docs/architecture.md sections ${unmapped.join(', ')} are not assigned to a page — add them to DOC_PAGES in src/flowcatalyst/docs.ts.`,
    );
  }

  // The repo doc's own "**Contents** — …" line links to in-page anchors that
  // no longer exist once the document is split.
  const intro = lede
    .filter((l) => !l.startsWith('**Contents**'))
    .join('\n')
    .replace(/^# .*$/m, '')
    .replace(/^-{3,}$/m, '')
    .trim();

  return DOC_PAGES.map((page, index) => {
    const parts = page.sections
      .map((n) => byNumber.get(n))
      .filter((s): s is Section => s !== undefined)
      .map((s) => renderSection(s, page));
    const body = parts.join('\n\n');
    const head = `# ${page.title}\n`;
    const content = index === 0 ? `${head}\n${intro}\n\n${body}\n` : `${head}\n${body}\n`;
    return {
      slug: page.slug,
      title: page.title,
      content: rewriteReferences(content, sectionToPage),
    };
  });
}

/**
 * POST the OpenAPI document; the platform versions it and flags breaking
 * changes. Throws on failure (the SDK's `ResultAsync` is unwrapped here so
 * neverthrow stays out of pinpoint's type surface).
 */
export async function syncOpenApiSpec(
  client: FlowCatalystClient,
  appCode: string,
  spec: unknown,
): Promise<SyncOpenApiSpecResult> {
  const result = await client.request<SyncOpenApiSpecResult>((httpClient, headers) =>
    httpClient.post({
      url: '/api/applications/{appCode}/openapi/sync',
      path: { appCode },
      body: { spec },
      headers: { 'Content-Type': 'application/json', ...headers },
    }),
  );
  if (result.isErr()) {
    throw new Error(`OpenAPI spec sync failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** POST the Markdown pages (replace-all for this application). Throws on failure. */
export async function syncDocPages(
  client: FlowCatalystClient,
  appCode: string,
  docs: readonly PinpointDocPage[],
): Promise<void> {
  const result = await client.request<unknown>((httpClient, headers) =>
    httpClient.post({
      url: '/api/applications/{appCode}/docs/sync',
      path: { appCode },
      body: { docs: docs.map((d) => ({ slug: d.slug, title: d.title, content: d.content })) },
      headers: { 'Content-Type': 'application/json', ...headers },
    }),
  );
  if (result.isErr()) {
    throw new Error(`Docs sync failed: ${JSON.stringify(result.error)}`);
  }
}
