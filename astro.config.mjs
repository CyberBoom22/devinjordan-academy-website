// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

// The canonical origin. Used for the sitemap, canonical URLs and absolute
// social-card URLs. No `base` is set: the site is served from the apex domain,
// not from a /repo-name subpath.
const SITE = 'https://devinjordansecuritytrainingacademy.com';

export default defineConfig({
  site: SITE,
  output: 'server',
  adapter: cloudflare({
    imageService: 'compile',
    platformProxy: { enabled: true },
  }),
  integrations: [
    sitemap({
      // Private or token-addressed areas must never appear in a sitemap.
      // /admin is guarded; the other three are reached by an unguessable token
      // and listing one would publish a live check-in link or a certificate.
      filter: (page) =>
        !['/admin', '/session/', '/check-in/', '/verify/', '/intake/'].some((path) =>
          page.includes(path),
        ),
    }),
  ],
  build: {
    // Never inline stylesheets. An inlined <style> block would force
    // `style-src 'unsafe-inline'` into the Content Security Policy, and
    // keeping that directive strict is worth one cached request.
    inlineStylesheets: 'never',
  },
});
