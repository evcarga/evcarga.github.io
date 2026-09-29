import { defineConfig } from 'astro/config';

// Sitio estático en GitHub Pages. build.format 'file' mantiene las URLs /admin.html, /privacidad.html
export default defineConfig({
  site: 'https://evcarga.github.io',
  build: { format: 'file' },
  trailingSlash: 'never',
});
