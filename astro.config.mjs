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
    // One stylesheet per page keeps the critical CSS small on a content site
    // where most visitors only ever load the homepage.
    inlineStylesheets: 'auto',
  },
  vite: {
    build: {
      cssMinify: 'lightningcss',
    },
  },
});
