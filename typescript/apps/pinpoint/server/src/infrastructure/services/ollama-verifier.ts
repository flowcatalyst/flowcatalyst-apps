/**
 * Ollama-backed `AddressVerifier`. Port of Rust `OllamaVerifier`.
 *
 * Hits the Ollama `/api/chat` endpoint directly rather than going through
 * a Vercel AI SDK provider — the canonical community provider
 * (`ollama-ai-provider-v2`) peers on `zod ^4`, and bumping the whole
 * monorepo from zod 3 to zod 4 is a wider piece of work than Slice 7
 * should drag in. Ollama supports structured output natively via the
 * `format` field (a JSON schema), so we get the same end result with
 * one less dependency.
 *
 * Errors are logged + swallowed (returns null) — same semantics as Rust:
 * a misbehaving LLM must not block the matching pipeline.
 */
import { z } from 'zod';
import {
  buildVerifierPrompt,
  VERIFIER_SYSTEM_PROMPT,
  VerificationResultSchema,
  type AddressVerifier,
  type VerificationResult,
} from '../../domain/services/address-verifier.js';

export interface OllamaVerifierConfig {
  /** Base URL of the Ollama server, e.g. `http://localhost:11434`. No trailing slash. */
  readonly baseUrl: string;
  /** Model tag, e.g. `gemma4` (Rust default). */
  readonly model: string;
  /** Optional log hook called when verification fails. */
  readonly onError?: (err: unknown) => void;
}

// JSON Schema describing the same shape as `VerificationResultSchema`.
// Ollama's `format` field accepts a JSON Schema object and constrains
// the model output to match. Keeping this hand-written rather than
// generated from the Zod schema means the schema-validation step on
// our side still has teeth — the model could still misbehave.
const RESPONSE_FORMAT = {
  type: 'object',
  properties: {
    match_confirmed: {
      type: 'boolean',
      description: 'Whether the two addresses refer to the same physical location.',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Confidence in the assessment from 0.0 to 1.0.',
    },
    reasoning: {
      type: 'string',
      description: 'Brief explanation of why the addresses do or do not match.',
    },
  },
  required: ['match_confirmed', 'confidence', 'reasoning'],
} as const;

const ChatResponseSchema = z.object({
  message: z.object({
    role: z.string(),
    content: z.string(),
  }),
  done: z.boolean().optional(),
});

export function createOllamaVerifier(config: OllamaVerifierConfig): AddressVerifier {
  const baseUrl = config.baseUrl.replace(/\/$/, '');

  return {
    async verify(
      inputAddress: string,
      candidateAddress: string,
    ): Promise<VerificationResult | null> {
      try {
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: config.model,
            stream: false,
            format: RESPONSE_FORMAT,
            messages: [
              { role: 'system', content: VERIFIER_SYSTEM_PROMPT },
              { role: 'user', content: buildVerifierPrompt(inputAddress, candidateAddress) },
            ],
          }),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`Ollama /api/chat returned ${response.status}: ${body.slice(0, 200)}`);
        }

        const data = ChatResponseSchema.parse(await response.json());
        const parsed = JSON.parse(data.message.content) as unknown;
        return VerificationResultSchema.parse(parsed);
      } catch (err) {
        config.onError?.(err);
        return null;
      }
    },
  };
}
