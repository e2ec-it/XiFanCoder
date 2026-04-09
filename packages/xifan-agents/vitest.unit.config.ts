import { mergeConfig } from 'vitest/config';

import baseConfig from './vitest.config.js';

export default mergeConfig(baseConfig, {
  test: {
    include: [
      'src/__tests__/brain/*.test.ts',
      'src/__tests__/memory/embedder.test.ts',
      'src/__tests__/memory/reflection.test.ts',
      'src/__tests__/scripts/*.test.ts',
      'src/__tests__/unit/*.test.ts',
      'src/__tests__/evolution/*.test.ts',
      'src/__tests__/plugin/*.test.ts',
    ],
    exclude: [
      'src/__tests__/e2e/**',
      'src/__tests__/integration/**',
      'src/__tests__/db/**',
      'src/__tests__/observer/**',
    ],
    coverage: {
      include: [
      'src/brain/**/*.ts',
      'src/memory/embedder.ts',
      'src/memory/reflection.ts',
      'src/scripts/**/*.ts',
      'src/plugin/**/*.ts',
      'src/evolution/**/*.ts',
      'src/observer/mcp-proxy.ts',
      ],
      exclude: [
        'src/**/__tests__/**',
        'src/plugin/index.ts',
        'src/scripts/hook-recorder.ts',
        'src/evolution/sage.ts',
      ],
    },
  },
});
