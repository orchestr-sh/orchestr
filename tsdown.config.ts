import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['./src/index.ts', './src/Facades/index.ts', './src/Events/index.ts', './src/Console/orchestr.ts'],
  dts: true,
  minify: true,
  unbundle: true,
});
