import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: { compilerOptions: { composite: false } },
    clean: true,
    sourcemap: true,
    outDir: 'dist/esm',
  },
  {
    entry: ['src/index.ts'],
    format: ['cjs'],
    dts: false,
    clean: false,
    sourcemap: true,
    outDir: 'dist/cjs',
    outExtension: () => ({ js: '.cjs' }),
  },
]);
