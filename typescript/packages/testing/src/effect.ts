import { Cause, Effect, Exit, Layer, ManagedRuntime, Option } from 'effect';
import { expect } from 'vitest';

/**
 * Run an Effect to completion in a test. Throws on failure so vitest sees a real error.
 */
export const runTest = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);

/**
 * Run an Effect against a Layer-built environment. Always disposes the runtime.
 */
export const runTestWith =
  <R, E0>(layer: Layer.Layer<R, E0>) =>
  async <A, E>(effect: Effect.Effect<A, E, R>): Promise<A> => {
    const runtime = ManagedRuntime.make(layer);
    try {
      const exit = await runtime.runPromiseExit(effect);
      if (Exit.isSuccess(exit)) return exit.value;
      throw Cause.squash(exit.cause);
    } finally {
      await runtime.dispose();
    }
  };

/**
 * Assert that an Effect fails with a typed error matching the predicate.
 */
export const expectEffectFailure = async <A, E>(
  effect: Effect.Effect<A, E>,
  predicate: (error: E) => boolean,
): Promise<void> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    expect.fail(`expected Effect to fail, but it succeeded with ${JSON.stringify(exit.value)}`);
  }
  const errorOption = Cause.findErrorOption(exit.cause);
  if (Option.isNone(errorOption)) {
    expect.fail(`expected a typed failure, got: ${Cause.pretty(exit.cause)}`);
  }
  if (!predicate(errorOption.value)) {
    expect.fail(`failure did not match predicate: ${JSON.stringify(errorOption.value)}`);
  }
};
