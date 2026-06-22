/**
 * Amazon Bedrock-backed `AddressVerifier` — Gemma 4 via the `bedrock-mantle`
 * OpenAI-compatible endpoint.
 *
 * Gemma 4 is NOT served over the native Bedrock Converse / InvokeModel API; it
 * runs behind the `bedrock-mantle` inference engine, which exposes an
 * OpenAI-compatible Chat Completions API at
 *   https://bedrock-mantle.{region}.api.aws/openai/v1
 * authenticated with a bearer token (`Authorization: Bearer <token>`).
 *
 * Rather than a static API key, we mint a SHORT-TERM Bedrock token from the
 * ambient AWS credentials (in prod, the ECS task role) via
 * `@aws/bedrock-token-generator`. The token inherits the role's permissions
 * (needs `bedrock:InvokeModel` on the model + `bedrock:CallWithBearerToken`),
 * lasts up to 12h, and the provider caches + auto-refreshes it. No secret to
 * store or rotate. The token is region-scoped, so it MUST be signed for the
 * region that actually hosts Gemma (the mantle region) — which is not
 * necessarily the task's AWS_REGION.
 *
 * We POST to /chat/completions directly with `fetch` — the same hand-rolled
 * approach the Ollama verifier uses — rather than the `@ai-sdk/amazon-bedrock`
 * provider, which speaks the native API and cannot reach the mantle endpoint.
 *
 * Errors are logged + swallowed (returns null) — same Rust semantics as the
 * other verifiers: a misbehaving LLM must not block the matching pipeline.
 * The algorithmic matcher's verdict still stands; verification is the
 * optional quality layer.
 */
import { getTokenProvider } from '@aws/bedrock-token-generator';
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
  /**
   * AWS region that hosts Gemma / the mantle endpoint (e.g. `eu-central-1`).
   * Drives BOTH the endpoint URL and the bearer-token signing region — must be
   * the Gemma region, NOT necessarily the task's AWS_REGION.
   */
  readonly region: string;
  /**
   * Full override of the OpenAI-compatible base URL. Defaults to
   * `https://bedrock-mantle.<region>.api.aws/openai/v1`.
   */
  readonly baseUrl?: string;
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
  const baseUrl = (
    config.baseUrl ?? `https://bedrock-mantle.${config.region}.api.aws/openai/v1`
  ).replace(/\/$/, '');

  // Caching token provider over the default AWS credential chain (the ECS task
  // role in prod). Signed for the Gemma region; returns a cached token while
  // valid and refreshes automatically.
  const provideToken = getTokenProvider({ region: config.region });

  return {
    async verify(
      inputAddress: string,
      candidateAddress: string,
    ): Promise<VerificationResult | null> {
      try {
        const token = await provideToken();

        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
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
