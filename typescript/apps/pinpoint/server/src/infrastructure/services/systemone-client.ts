/**
 * Minimal client for the Jev / SystemOne decision API (`POST /v1/systemone`),
 * which Cloudflare's Clef models serve. The same request + response body works
 * against every host we care about — only the base URL, model id and key change:
 *
 *   - local dev:  Ollama ≥ 0.35.1        baseUrl `http://localhost:11434`, model `clef-flash`
 *   - production: OpenRouter              baseUrl `https://openrouter.ai/api`, model `cloudflare/clef-flash`
 *
 * A decision model answers typed questions about a `state` in one forward pass:
 * a probability per allowed option, no generated text and no output parsing.
 *
 * Plain `fetch`, no SDK — Ollama's JS library doesn't support decision models
 * yet, and the wire format is small.
 */
import { z } from 'zod';

export type DecisionQuestion =
  | {
      readonly type: 'noul';
      readonly instructions?: string;
      /** Optional descriptions of what `true` and `false` mean. */
      readonly criteria?: { readonly true?: string; readonly false?: string };
    }
  | {
      readonly type: 'choice';
      readonly instructions?: string;
      /** Option id → description. */
      readonly criteria: Readonly<Record<string, string>>;
    }
  | {
      readonly type: 'score';
      readonly instructions?: string;
      /** Ordered level descriptions, indexed from 0. */
      readonly criteria: readonly string[];
    };

export interface DecisionRequest {
  /** Any string or JSON value describing the situation to decide on. */
  readonly state: unknown;
  readonly questions: Readonly<Record<string, DecisionQuestion>>;
}

const NoulAnswerSchema = z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) });
const ChoiceAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
});
const ScoreAnswerSchema = z.object({
  type: z.literal('score'),
  score: z.number(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
});

const DecisionResponseSchema = z.object({
  model: z.string().optional(),
  answers: z.record(
    z.string(),
    z.discriminatedUnion('type', [NoulAnswerSchema, ChoiceAnswerSchema, ScoreAnswerSchema]),
  ),
});

export type DecisionAnswer = z.infer<typeof DecisionResponseSchema>['answers'][string];
export type DecisionResponse = z.infer<typeof DecisionResponseSchema>;

export interface SystemOneClientConfig {
  /** Host base URL, without `/v1/systemone`. No trailing slash needed. */
  readonly baseUrl: string;
  /** Model id as the host names it — `clef-flash` (Ollama), `cloudflare/clef-flash` (OpenRouter). */
  readonly model: string;
  /** Bearer key. Required by OpenRouter; omit for a local Ollama. */
  readonly apiKey?: string;
  /** Abort a request after this long. Default 10 s. */
  readonly timeoutMs?: number;
}

export interface SystemOneClient {
  readonly model: string;
  /** Throws on transport failure, a non-2xx status or a malformed body. */
  decide(request: DecisionRequest): Promise<DecisionResponse>;
}

export function createSystemOneClient(config: SystemOneClientConfig): SystemOneClient {
  const url = `${config.baseUrl.replace(/\/$/, '')}/v1/systemone`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.apiKey) headers['authorization'] = `Bearer ${config.apiKey}`;

  return {
    model: config.model,
    async decide(request: DecisionRequest): Promise<DecisionResponse> {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: config.model, ...request }),
        signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`SystemOne ${url} returned ${response.status}: ${body.slice(0, 200)}`);
      }
      const parsed = DecisionResponseSchema.parse(await response.json());
      for (const id of Object.keys(request.questions)) {
        if (!parsed.answers[id]) throw new Error(`SystemOne response has no answer for '${id}'`);
      }
      return parsed;
    },
  };
}
