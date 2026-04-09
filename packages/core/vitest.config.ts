import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.ts',
        // Barrel re-export files (no logic)
        'src/index.ts',
        'src/config/index.ts',
        'src/crash/index.ts',
        'src/daemon/index.ts',
        'src/db/index.ts',
        'src/errors/index.ts',
        'src/llm/index.ts',
        'src/lsp/index.ts',
        'src/mcp/index.ts',
        'src/memory/index.ts',
        'src/permissions/index.ts',
        'src/providers/index.ts',
        'src/runtime/index.ts',
        'src/session/index.ts',
        'src/skills/index.ts',
        'src/tools/index.ts',
        // Type-only declaration files (no runtime code)
        'src/db/types.ts',
        'src/llm/types.ts',
        'src/lsp/types.ts',
        'src/permissions/types.ts',
      ],
    },
  },
});
