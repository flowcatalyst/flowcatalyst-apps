/**
 * AWS Bedrock-backed `AddressVerifier`. Port of Rust `BedrockVerifier`.
 *
 * Uses the Vercel AI SDK's `generateObject` for typed structured output —
 * Zod schema in, validated `VerificationResult` out. Credentials follow
 * the standard AWS chain (env vars, ~/.aws/credentials, EC2/ECS roles)
 * via `@ai-sdk/amazon-bedrock`'s default behavior; no creds passed
 * explicitly.
 *
 * Errors are logged + swallowed (returns null) — same semantics as Rust:
 * a misbehaving LLM should NOT block the matching pipeline. The
 * algorithmic matcher's verdict still stands; verification is the
 * optional quality layer.
 */
import { generateObject } from 'ai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import {
  buildVerifierPrompt,
  VERIFIER_SYSTEM_PROMPT,
  VerificationResultSchema,
  type AddressVerifier,
  type VerificationResult,
} from '../../domain/services/address-verifier.js';

export interface BedrockVerifierConfig {
  /**
   * Bedrock model id, e.g. `anthropic.claude-3-haiku-20240307-v1:0`
   * (the Rust default — match it for parity with the existing pinpoint).
   */
  readonly model: string;
  /** AWS region. Defaults to AWS_REGION env, then us-east-1. */
  readonly region?: string;
  /** Optional log hook called when verification fails. */
  readonly onError?: (err: unknown) => void;
}

export function createBedrockVerifier(config: BedrockVerifierConfig): AddressVerifier {
  const bedrock = createAmazonBedrock({
    region: config.region ?? process.env['AWS_REGION'] ?? 'us-east-1',
  });
  const model = bedrock(config.model);

  return {
    async verify(
      inputAddress: string,
      candidateAddress: string,
    ): Promise<VerificationResult | null> {
      try {
        const { object } = await generateObject({
          model,
          schema: VerificationResultSchema,
          system: VERIFIER_SYSTEM_PROMPT,
          prompt: buildVerifierPrompt(inputAddress, candidateAddress),
        });
        return object;
      } catch (err) {
        // Rust pattern: log a warning and return None. Verification is
        // an opinion layer; the caller has a fallback verdict already.
        config.onError?.(err);
        return null;
      }
    },
  };
}
