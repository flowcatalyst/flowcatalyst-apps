import { defineConfig, mergeConfig, type ViteUserConfig } from 'vitest/config';

export const baseVitestConfig: ViteUserConfig = defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/**/__fixtures__/**'],
    },
    reporters: ['default'],
    testTimeout: 10_000,
  },
});

export function defineVitestConfig(overrides: ViteUserConfig = {}): ViteUserConfig {
  return mergeConfig(baseVitestConfig, overrides);
}
