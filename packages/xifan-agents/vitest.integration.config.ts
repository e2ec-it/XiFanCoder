import { mergeConfig } from 'vitest/config';

import baseConfig from './vitest.config.js';

export default mergeConfig(baseConfig, {
  test: {
    include: [
      'src/__tests__/db/*.test.ts',
      'src/__tests__/e2e/**/*.test.ts',
      'src/__tests__/integration/**/*.test.ts',
      'src/__tests__/memory/retriever.test.ts',
      'src/__tests__/memory/store.test.ts',
      'src/__tests__/observer/*.test.ts',
    ],
  },
});
