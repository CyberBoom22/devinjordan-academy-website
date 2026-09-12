/**
 * Verifies src/data/ori.ts against the original single-file site.
 *
 * The ORI dataset was reconstructed from a chat transcript rather than from
 * the source file, so it carries a small risk of transcription error. A wrong
 * ORI is worse than a missing one — someone files paperwork with it. This
 * script removes the doubt.
 *
 *   node scripts/verify-ori.mjs path/to/Website-v2.html
 *
 * Exits non-zero on any mismatch.
 */
import { readFile } from 'node:fs/promises';

const source = process.argv[2];
if (!source) {
    console.error('usage: node scripts/verify-ori.mjs <path-to-Website-v2.html>');
    process.exit(2);
}

const html = await readFile(source, 'utf8');
const m = html.match(/const ORI_DATA = (\[[\s\S]*?\]);/);
if (!m) {
    console.error('Could not find ORI_DATA in that file.');
    process.exit(2);
}
const original = JSON.parse(m[1]);

const ours = await readFile('src/data/ori.ts', 'utf8');
const rawMatch = ours.match(/const RAW: RawCounty\[\] = (\[[\s\S]*?\n\];)/);
const mine = JSON.parse(rawMatch[1].replace(/,\s*\];$/, ']').replace(/\];$/, ']'));

const flatten = (data) =>
    data.flatMap(([county, fips, agencies]) =>
        agencies.map(([name, code]) => `${county}|${fips}|${name}|${code}`));

const a = flatten(original);
const b = flatten(mine);
const setA = new Set(a);
const setB = new Set(b);

const missing = a.filter((x) => !setB.has(x));
const extra = b.filter((x) => !setA.has(x));

console.log(`original: ${a.length} rows   reconstructed: ${b.length} rows`);
if (!missing.length && !extra.length) {
    console.log('✅ ORI dataset matches the original exactly.');
    process.exit(0);
}
if (missing.length) {
    console.log(`\n❌ ${missing.length} row(s) in the original but not here:`);
    missing.forEach((x) => console.log('   -', x));
}
if (extra.length) {
    console.log(`\n❌ ${extra.length} row(s) here but not in the original:`);
    extra.forEach((x) => console.log('   +', x));
}
process.exit(1);
