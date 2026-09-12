/**
 * Builds the site-wide search index consumed by the find bar.
 *
 * Runs after `astro build` and reads the generated HTML, so the index can
 * never drift from what is actually published — no page summaries to maintain
 * by hand. Output: dist/search-index.json
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const DIST = 'dist';

async function walk(dir) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await walk(full)));
        else if (entry.name.endsWith('.html')) out.push(full);
    }
    return out;
}

function textOf(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
        .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;|&#\d+;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const files = await walk(DIST);
const index = [];

for (const file of files) {
    const html = await readFile(file, 'utf8');
    if (/<meta\s+name="robots"\s+content="noindex"/i.test(html)) continue;

    const rel = relative(DIST, file).split(sep).join('/');
    const url = '/' + rel.replace(/index\.html$/, '').replace(/\.html$/, '');
    const title = (html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? url)
        .replace(/\s*—.*$/, '')
        .trim();

    index.push({ url: url === '/' ? '/' : url.replace(/\/$/, ''), title, text: textOf(html) });
}

index.sort((a, b) => a.url.localeCompare(b.url));
await writeFile(join(DIST, 'search-index.json'), JSON.stringify(index));
console.log(`search-index.json: ${index.length} pages, ${index.reduce((n, p) => n + p.text.length, 0)} chars`);
