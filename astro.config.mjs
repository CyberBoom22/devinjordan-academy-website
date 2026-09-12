// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

// Static by default: every public page is prerendered at build time, so the
// marketing site is fully cacheable at Cloudflare's edge. The Cloudflare
// adapter is already wired in so that individual routes can opt into
// on-demand rendering with `export const prerender = false` — that is how the
// staff CMS and its auth callbacks will run in phase 2, without changing how
// any of the public pages are served.
export default defineConfig({
    site: 'https://devinjordansecuritytrainingacademy.com',
    adapter: cloudflare({ imageService: 'compile' }),
    integrations: [sitemap()],
    build: { inlineStylesheets: 'never' },
    vite: {
        build: { cssCodeSplit: true },
    },
});
