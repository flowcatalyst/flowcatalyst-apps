/**
 * Amazon Bedrock-backed `AddressVerifier` — Gemma 4 via the `bedrock-mantle`
 * OpenAI-compatible endpoint.
 *
 * Gemma 4 is NOT served over the native Bedrock Converse / InvokeModel API; it
 * runs behind the `bedrock-mantle` inference engine, which exposes an
 * OpenAI-compatible Chat Completions API at
 *   https://bedrock-mantle.{region}.api.aws/openai/v1
 * authenticated with a Bedrock API key (`Authorization: Bearer <key>`; IAM
 * action `bedrock-mantle:CallWithBearerToken`).
 *
 * We therefore POST to /chat/completions directly with `fetch` — the same
 * hand-rolled approach the Ollama verifier uses — rather than the
 * `@ai-sdk/amazon-bedrock` provider, which speaks the native API and cannot
 * reach the mantle endpoint. One fewer dependency, and it keeps the package
 * on zod 3.
 *
 * Errors are logged + swallowed (returns null) — same Rust semantics as the
 * other verifiers: a misbehaving LLM must not block the matching pipeline.
 * The algorithmic matcher's verdict still stands; verification is the
 * optional quality layer.
 */
import { z } from 'zod';
import {
  buildVerifierPrompt,
  VERIFIER_SYSTEM_PROMPT,
  VerificationResultSchema,
  type AddressVerifier,
  type VerificationResult,
} from '../../domain/services/address-verifier.js';

export interface BedrockVerifierConfig {
  /** Gemma 4 model id on Bedrock, e.g. `google.gemma-4-26b-a4b`. */
  readonly model: string;
  /** AWS region for the mantle endpoint. Defaults to AWS_REGION, then us-east-1. */
  readonly region?: string;
  /**
   * Full override of the OpenAI-compatible base URL. Defaults to
   * `https://bedrock-mantle.<region>.api.aws/openai/v1`.
   */
  readonly baseUrl?: string;
  /**
   * Bedrock API key sent as `Authorization: Bearer <key>`. Resolved from
   * AWS_BEARER_TOKEN_BEDROCK / PINPOINT_BEDROCK_API_KEY at the call site.
   */
  readonly apiKey?: string;
  /** Optional log hook called when verification fails. */
  readonly onError?: (err: unknown) => void;
}

// Minimal shape of an OpenAI-compatible chat-completions response.
const ChatCompletionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ role: z.string(), content: z.string() }) }))
    .min(1),
});

/**
 * Pull the JSON object out of the model's reply, tolerating markdown ```json
 * fences or leading prose. We request `response_format: json_object`, but
 * instruct models occasionally wrap the payload anyway — so we extract the
 * first balanced `{...}` rather than trusting the reply to be bare JSON.
 */
function extractJson(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? content;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('no JSON object found in model reply');
  }
  return body.slice(start, end + 1);
}

export function createBedrockVerifier(config: BedrockVerifierConfig): AddressVerifier {
  const region = config.region ?? process.env['AWS_REGION'] ?? 'us-east-1';
  const baseUrl = (config.baseUrl ?? `https://bedrock-mantle.${region}.api.aws/openai/v1`).replace(
    /\/$/,
    '',
  );

  return {
    async verify(
      inputAddress: string,
      candidateAddress: string,
    ): Promise<VerificationResult | null> {
      try {
        if (!config.apiKey) {
          throw new Error(
            'missing Bedrock API key (set AWS_BEARER_TOKEN_BEDROCK or PINPOINT_BEDROCK_API_KEY)',
          );
        }

        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            // Ask for JSON only. OpenAI-compatible json_object mode requires
            // the word "JSON" to appear in the prompt — VERIFIER_SYSTEM_PROMPT
            // already satisfies that. If a future mantle build rejects this
            // param, drop it: the prompt + extractJson still yield a verdict.
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: VERIFIER_SYSTEM_PROMPT },
              { role: 'user', content: buildVerifierPrompt(inputAddress, candidateAddress) },
            ],
          }),
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(
            `bedrock-mantle /chat/completions returned ${response.status}: ${detail.slice(0, 200)}`,
          );
        }

        const data = ChatCompletionSchema.parse(await response.json());
        const [choice] = data.choices;
        if (!choice) {
          throw new Error('bedrock-mantle returned no choices');
        }
        const parsed = JSON.parse(extractJson(choice.message.content)) as unknown;
        return VerificationResultSchema.parse(parsed);
      } catch (err) {
        config.onError?.(err);
        return null;
      }
    },
  };
}
