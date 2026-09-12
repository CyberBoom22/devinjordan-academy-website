// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

const SITE = process.env.PUBLIC_SITE_URL ?? 'https://devinjordansecuritytrainingacademy.com';

export default defineConfig({
  site: SITE,
  output: 'server',
  adapter: cloudflare({
    imageService: 'compile',
    platformProxy: { enabled: true },
  }),
  integrations: [
    sitemap({
      // The admin area is private; it must never appear in a sitemap.
      filter: (page) => !page.includes('/admin'),
    }),
  ],
  build: {
    // Never inline stylesheets. An inlined <style> block would force
    // `style-src 'unsafe-inline'` into the Content Security Policy, and
    // keeping that directive strict is worth one cached request.
    inlineStylesheets: 'never',
  },
});
