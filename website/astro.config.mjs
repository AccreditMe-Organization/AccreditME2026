// The public website (ACC-213). Static, no UI framework, nothing inline: the
// CSP in vercel.json is `script-src 'self'; style-src 'self'`, so every script
// and stylesheet must be a file. `inlineStylesheets: 'never'` keeps CSS out of
// <style> tags, and `assetsInlineLimit: 0` stops Vite inlining a small script.
// `npm run verify` fails a built page that breaks either.
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.accreditme.app',
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
    inlineStylesheets: 'never',
  },
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
  integrations: [
    sitemap({
      i18n: { defaultLocale: 'en', locales: { en: 'en', ar: 'ar' } },
      // 404 pages are not destinations.
      filter: (page) => !/\/404\/?$/.test(page),
    }),
  ],
});
