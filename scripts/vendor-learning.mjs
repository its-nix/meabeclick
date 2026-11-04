import { cp, mkdir } from 'node:fs/promises';
const target = new URL('../static/learning-assets/', import.meta.url);
await mkdir(target, { recursive: true });
for (const file of ['katex.min.css', 'katex.min.js', 'fonts']) {
  await cp(new URL(`../node_modules/katex/dist/${file}`, import.meta.url), new URL(file, target), { recursive: true });
}
for (const subset of ['hebrew', 'latin']) {
  await cp(new URL(`../node_modules/@fontsource-variable/heebo/files/heebo-${subset}-wght-normal.woff2`, import.meta.url), new URL(`heebo-${subset}.woff2`, target));
}
await cp(new URL('../node_modules/katex/LICENSE', import.meta.url), new URL('KATEX-LICENSE.txt', target));
await cp(new URL('../node_modules/@fontsource-variable/heebo/LICENSE', import.meta.url), new URL('HEEBO-LICENSE.txt', target));
