import { context } from 'esbuild';

// Host bundle: src/host/extension.ts → dist/extension.cjs. The extension host is CJS; the vscode module is provided by the host.
const watch = process.argv.includes('--watch');

const ctx = await context({
  entryPoints: ['src/host/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: watch,
  minify: !watch,
  logLevel: 'info',
  alias: { '@shared': './src/shared' },
});

if (watch) await ctx.watch();
else { await ctx.rebuild(); await ctx.dispose(); }
