import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/scripts/hook-recorder.ts'],
  format: ['cjs'],
  outDir: 'dist/scripts',
  noExternal: ['pg'],   // bundle pg inline — hook runs standalone outside node_modules
  dts: false,
  splitting: false,
  clean: false,
});
