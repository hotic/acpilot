import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// webview 构建：root 指向 src/webview。
// 只打 index.html（单 JS + 单 CSS，文件名固定给 bridge 引用）
const root = fileURLToPath(new URL('./src/webview', import.meta.url));

export default defineConfig({
  root,
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@webview': root,
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/webview', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: { main: `${root}/index.html` },
      output: {
        codeSplitting: false,
        entryFileNames: 'main.js',
        chunkFileNames: 'chunk-[name].js',
        assetFileNames: a => (a.names?.some(n => n.endsWith('.css')) ? 'main.css' : 'assets/[name][extname]'),
      },
    },
  },
});
