import { defineConfig } from 'vitest/config';

const coverage = {
  provider: 'v8' as const,
  reporter: ['text', 'html'] as const,
  exclude: [
    'coverage/**',
    'dist/**',
    'migrations/**',
    'tests/**',
    'src/cli/index.ts',
    'src/cli/**/*.ts',
    '**/*.d.ts',
  ],
  thresholds: {
    lines: 70,
    statements: 70,
    functions: 70,
    branches: 70,
  },
};

export default defineConfig({
  test: {
    environment: 'node',
    coverage,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/globalSetup.ts'],
          fileParallelism: false,
          pool: 'forks',
          maxWorkers: 1,
        },
      },
    ],
  },
});
