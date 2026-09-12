# Devin Jordan Security Training Academy

The academy's website, plus the admin area the academy uses to run it.

- **Public site** — home, about, courses, news & legislation, ORI directory.
- **Admin area** (`/admin`) — sign-in, staff accounts, roles and granular
  permissions, and (in progress) content editing.

Built with [Astro](https://astro.build) in server-rendered mode on Cloudflare
Workers, with [Supabase](https://supabase.com) for authentication, the database
and file storage.

---

## Why this stack

The site needs three things at once, and each one rules something out:

| Requirement                                                  | What it rules out                        |
| ------------------------------------------------------------ | ---------------------------------------- |
| The academy edits content themselves, with no developer      | A hand-written HTML file                 |
| Changes appear immediately                                   | A static build that has to be redeployed |
| Search engines index the courses and the ORI directory       | A client-rendered single-page app        |
| Staff log in, with different people allowed different things | Static hosting with no backend           |

Server rendering satisfies all four: search engines get real HTML, the academy
gets instant publishing, and every request can carry a signed-in identity.

---

## Getting started

```bash
npm install
cp .env.example .env     # fill in the Supabase values, or leave blank
npm run dev              # http://localhost:4321
```

**The site runs with an empty `.env`.** Without Supabase it renders from the
content committed in `src/lib/seed/`, which is the real site content. That is
deliberate: a fresh clone looks right immediately, and a Supabase outage in
production degrades the site to slightly out of date rather than to an error
page. The admin area is the only part that needs the database.

### Commands

| Command                             | What it does                                                         |
| ----------------------------------- | -------------------------------------------------------------------- |
| `npm run dev`                       | Development server                                                   |
| `npm run build`                     | Production build                                                     |
| `npm run preview`                   | Run the built worker locally with Wrangler                           |
| `npm run verify`                    | Format check, lint, type check and build — run before pushing        |
| `npm run db:types`                  | Regenerate `src/lib/supabase/database.types.ts` from the live schema |
| `npm run db:permissions -- --write` | Regenerate the role/permission seed migration                        |

---

## Setting up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run the migrations in `supabase/migrations/` in order, either with
   `supabase db push` or by pasting each into the SQL editor:
   - `0001_rbac.sql` — accounts, roles, permissions, audit log
   - `0002_content.sql` — pages, courses, instructors, news, ORI, enquiries
   - `0003_seed_roles.sql` — the five built-in roles and their permissions
3. Copy the project URL and the publishable (anon) key into `.env`.
4. Create the first account in Supabase → Authentication → Users, then give it
   the Owner role:

   ```sql
   insert into public.user_roles (user_id, role_id)
   select u.id, r.id
   from auth.users u, public.roles r
   where u.email = 'you@example.com' and r.key = 'owner';

   update public.profiles set status = 'active' where email = 'you@example.com';
   ```

5. Sign in at `/admin`. Everyone else can be invited from there.

6. Regenerate the database types so the admin screens type-check precisely:

   ```bash
   supabase link --project-ref <your-ref>
   npm run db:types
   ```

---

## How access control works

Three layers, checked in this order:

1. **Account status.** A suspended profile can do nothing, whatever it holds.
2. **Per-person override.** A grant or a deny for one individual. A deny always
   wins, over every role.
3. **Roles.** Otherwise, the union of everything the account's roles carry.

Alongside that sits the **hierarchy**, which permissions deliberately cannot
express. Roles have a numeric level — lower means more authority — and an
account may only administer accounts and roles strictly below its own.

| Role          | Level | In short                                             |
| ------------- | ----- | ---------------------------------------------------- |
| Owner         | 10    | Everything, including managing administrators        |
| Administrator | 20    | All content and media; manages everyone below        |
| Editor        | 30    | All content; no access to users or settings          |
| Instructor    | 40    | Own profile; can draft news for an editor to publish |
| Viewer        | 50    | Read-only, including enquiries                       |

Without the hierarchy, any account holding `user.manage` could grant itself
`role.manage` and take over. With it, an Administrator can manage Editors and
Instructors and can never touch an Owner, another Administrator, or their own
access.

**Application code never asks "is this an admin?"** — it asks "may this user
publish news?". So the academy can invent a role in the admin UI ("Front Desk",
"Range Officer"), tick exactly the boxes it needs, and every page honours it
with no code change and no deploy.

`src/lib/auth/permissions.ts` is the source of truth for the permission list,
including the plain-language description shown beside each checkbox. After
editing it, run `npm run db:permissions -- --write` and apply the migration.

### Where enforcement actually lives

In the database. Every table's row level security policy calls the same
`app.has_permission()` function. The checks in templates decide **what to
render** — hiding a button someone cannot use — and are not a security
boundary. A hand-crafted request is refused by Postgres regardless.

---

## Project layout

```
src/
  components/     One folder per area of the site; styles are scoped per component
  layouts/        BaseLayout (public), AdminLayout (admin)
  lib/
    auth/         Permission registry and session loading
    content/      Typed models and the repository templates read through
    seed/         The site's content, committed so it runs without a database
    supabase/     Request-scoped clients; server.ts never reaches the browser
  pages/          Routes. /admin/* is guarded by middleware, not per page
  scripts/        Client-side behaviour, one file per concern
  styles/         tokens.css is the single source of truth for the design
supabase/
  migrations/     Run in order
```

### Design tokens

Every colour, font and measurement lives in `src/styles/tokens.css`. Components
reference tokens, never literals, so changing a brand colour is one edit.

---

## Deploying

```bash
npx wrangler login
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npm run deploy
```

Set `PUBLIC_SITE_URL`, `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` as
plain variables in the Cloudflare dashboard. The service role key bypasses row
level security and must only ever be a secret.

### Pointing the domain at it

`devinjordansecuritytrainingacademy.com` currently resolves to GoDaddy's
parking addresses. After the first deploy, add the domain as a custom domain in
the Cloudflare Workers dashboard and follow the DNS instructions it gives you.

---

## Outstanding

Tracked honestly rather than quietly:

- **Content editing screens.** Courses, instructors, news, the ORI directory,
  page copy, enquiries and settings each have a permission, a table and a
  sidebar entry, but the editing screen itself is not built yet. They show as
  disabled "soon" rows in the admin sidebar rather than linking to a 404.
- **Two images from the old build.** The hero photograph
  (`public/img/hero.jpg`) and the wide footer wordmark
  (`public/img/logo-wordmark.webp`) have not been extracted. The hero falls
  back to its gradient and the footer shows the square badge, so nothing is
  broken — but neither matches the original exactly. The instructor portrait
  (`public/img/instructors/che-gary.jpg`) is referenced by the seed data and
  also still to be added.
- **Contact form.** The current site shows phone numbers because its Wix host
  had no server to receive a submission. The `enquiries` table and its
  permissions already exist, so restoring the form is a template change with no
  migration.
- **`security.txt` expires 2027-09-11** and lists a phone number rather than a
  security email address. See `SECURITY.md`.
