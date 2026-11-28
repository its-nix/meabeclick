import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  build: {
    // Keep CSP font-src strict ('self' + fonts.gstatic.com): small KaTeX
    // woff2 files otherwise inline as data:font/woff2;base64,... and are
    // blocked by the browser on every page that imports katex.min.css.
    assetsInlineLimit: (filePath) => (/\.(woff2?|ttf|otf|eot)$/i.test(filePath) ? false : undefined),
  },
});
