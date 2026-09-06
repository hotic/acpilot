import { context } from 'esbuild';

// host 端：src/host/extension.ts → dist/extension.cjs；扩展宿主是 CJS，vscode 模块由宿主提供
const watch = process.argv.includes('--watch');

const ctx = await context({
  entryPoints: ['src/host/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: true,
  minify: false,
  logLevel: 'info',
  alias: { '@shared': './src/shared' },
});

if (watch) await ctx.watch();
else { await ctx.rebuild(); await ctx.dispose(); }
