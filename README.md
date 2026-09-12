# Devin Jordan Security Training Academy

The academy's website: state-certified armed and unarmed SORA training across
New Jersey and New York.

Built with [Astro](https://astro.build), deployed to Cloudflare Pages, with
Supabase planned for staff sign-in and content editing. Every page is
prerendered at build time, so the public site is static files served from
Cloudflare's edge.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:4321
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server with hot reload |
| `npm run build` | Production build into `dist/`, then builds the search index |
| `npm run preview` | Serves the built site through Wrangler, as Cloudflare will |
| `npm run check` | TypeScript and Astro diagnostics |
| `npm run deploy` | Build and push to Cloudflare Pages |

## How the folders are laid out

```
src/
  data/          Content you edit — see "Making changes" below
  lib/           types.ts, content.ts (data access), nav.ts
  styles/        Design tokens and stylesheets, loaded via global.css
  components/    Reusable pieces of page
  layouts/       BaseLayout.astro — the <head>, chrome and shell
  pages/         One file per route
  scripts/       Browser-side TypeScript, bundled by Astro
public/
  _headers       Cloudflare response headers, including the CSP
  assets/
    fonts/       Self-hosted Montserrat + Roboto (woff2, OFL licensed)
    vendor/      Font Awesome Free 6.4.0
    img/         Logos, headshot, favicons
scripts/         Build and maintenance scripts (Node, not shipped)
```

**The important convention:** components never import from `src/data/`
directly. They call `src/lib/content.ts`, which is the single place that knows
where content lives. That indirection is what lets the content move into
Supabase later without touching a single component.

## Making changes

### Prices and course details
`src/data/courses.ts`. Each course has a `name`, `blurb`, `price` and `cta`.
Prices are stored as display text (`"$250.00"`, `"$100.00+"`) rather than
numbers, because the academy quotes a "from" price for firearms qualification
and no numeric type represents that honestly.

### Contact details, address, phone numbers
`src/data/site.ts`. The `contacts` array drives both the contact section and
the footer — add or reorder entries there and both update. Entries with an
`href` render as links; entries without one render as plain text.

### News and legislation entries
`src/data/news.ts`. Each entry needs `title`, `date`, `status`, `summary` and
`sources[]`. `status` must be one of `Pending`, `Enacted`, `Closed`, `Decided`.

The `ready: false` flag gates the whole board: while it is false the state and
category pickers stay live but a loading animation shows in place of entries,
so visitors never see placeholder content. Flip it to `true` once real entries
are in.

### ORI directory
`src/data/ori.ts`, stored as `[county, FIPS, [[agency, code], ...]]` where
`code` is the five characters after the `NJ` prefix. ORI7 is `NJ` + code; ORI9
appends `00`. The counts shown on the page are derived from this data, so they
can never disagree with the table.

> ⚠️ **This dataset needs verifying.** It was reconstructed from a chat
> transcript rather than the original file. Structural checks pass — 21
> counties, 640 agencies, every code exactly five characters, no duplicates —
> but a substituted character would not show up in those. Run
> `node scripts/verify-ori.mjs path/to/Website-v2.html` against the original to
> confirm it byte for byte.

### Navigation
`src/lib/nav.ts`.

## Publishing

The site deploys from the `main` branch of this repository to Cloudflare Pages.

**To publish a change:**

1. Always start new work from the latest `main`.
2. Make the change on a branch (a Claude Code session does this automatically)
   or directly on github.com.
3. Open a pull request and merge it.
4. Cloudflare builds and publishes within a minute or two.

Every pull request also gets its own preview URL from Cloudflare, so changes
can be looked at before they go live.

**To roll back:** revert the merge commit on github.com. The revert is itself a
merge to `main`, so it republishes the same way.

**Domains** are registered and DNS-hosted at GoDaddy.
`devinjordansecuritytrainingacademy.com` is this site;
`devinjordansecurity.com` redirects to it from a separate repository.

## Credits and licences

| Asset | Source | Licence |
| --- | --- | --- |
| Montserrat | [@fontsource/montserrat](https://fontsource.org/fonts/montserrat) | SIL Open Font License 1.1 — `public/assets/fonts/OFL-Montserrat.txt` |
| Roboto | [@fontsource/roboto](https://fontsource.org/fonts/roboto) | SIL Open Font License 1.1 — `public/assets/fonts/OFL-Roboto.txt` |
| Font Awesome Free 6.4.0 | [fontawesome.com](https://fontawesome.com) | Icons CC BY 4.0, Fonts SIL OFL 1.1, Code MIT — `public/assets/vendor/fontawesome-free-6.4.0/LICENSE.txt` |
| Hero photograph | [Unsplash](https://unsplash.com/photos/photo-1549488344-c6a6f11656e1) | [Unsplash License](https://unsplash.com/license) — free to use, no attribution required |

The academy crests on the home and About pages are inline SVG authored for this
site, not third-party assets.

## Access model (staff accounts)

Four roles ship with the system — **owner**, **instructor**, **staff**, **tech**
— but a role is only a starting point. The owner can grant or revoke any
individual permission for any individual person from the dashboard, so access
does not have to fit one of four shapes.

Effective access is worked out like this:

```
  role defaults  +  individual grants  −  individual revokes
```

A revoke always beats a grant. The owner role is a superuser and bypasses the
whole calculation, so an owner can never be locked out of their own system.

**Permissions are enforced in Postgres, not in the browser.** Every rule lives
in Row Level Security policies and triggers, because anything checked only in
client-side JavaScript can be bypassed by editing the page. The dashboard hides
controls a person cannot use, but that is a courtesy — the database is what
actually refuses.

Four things the database will not let happen, whatever the UI does:

- nobody can change their own role;
- nobody can grant a permission they do not themselves hold, even with
  `permissions.manage`;
- the last active owner cannot be demoted, deactivated or deleted;
- a new sign-up lands inactive with the weakest role, so registering an account
  grants nothing until someone switches it on.

The permission catalogue is defined once in `src/lib/permissions.ts` and the SQL
seed is generated from it, so the list the code type-checks against and the list
in the database cannot drift apart:

```bash
node --experimental-strip-types scripts/generate-permission-seed.mjs
```

### Database work

```bash
npm run test:db     # throwaway Postgres, applies every migration, runs the suite
```

`supabase/tests/01_rbac.test.sql` is the specification for the access model. If
a migration change makes one of those assertions fail, the change is wrong until
proven otherwise — each one corresponds to a real security hole.

**First run on a new database:** the first owner cannot be created through the
dashboard, because assigning roles requires a permission only an owner holds.
Once that person has signed up, run this once from the Supabase SQL editor:

```sql
select public.bootstrap_owner('their@email.address');
```

It refuses to do anything once an active owner exists, and it is not callable
from the browser.

## Security

See [SECURITY.md](SECURITY.md) for the hardening applied and how to report a
vulnerability.
