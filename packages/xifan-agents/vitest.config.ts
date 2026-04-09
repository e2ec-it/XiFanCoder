import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 120_000,
    env: {
      TESTCONTAINERS_RYUK_DISABLED: 'true',
      DOCKER_HOST: 'unix:///var/run/docker.sock',
    },
  },
});
