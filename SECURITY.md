# Security

How the Devin Jordan Security Training Academy website is hardened, what the
hosting platform enforces, and how to report a problem.

## Reporting a vulnerability

Please report suspected security issues by phone:

**(848) 398-0976**

The same contact is published in machine-readable form at
[`/.well-known/security.txt`](public/.well-known/security.txt), per RFC 9116.

Please include what you found, how to reproduce it, and how we can reach you.
Allow a few business days for a reply. Please do not publicly disclose an issue
before we have had a chance to fix it.

> **Recommended improvement:** a dedicated security email address (for example
> `security@devinjordansecuritytrainingacademy.com`) would be a better contact
> than a phone number. It creates a written record, works across time zones, and
> is what most researchers and automated tools expect. If one is set up, add it
> as the first `Contact:` line in `security.txt`.
>
> The current `security.txt` **expires 2027-09-11** and must be refreshed before
> then, or tooling will treat it as stale.

## Access control

Authorisation is enforced by the database, not by the application.

Every table carries row level security, and every policy calls one function,
`app.has_permission()`. The same function backs the public site's reads, the
admin area's writes, and anything a hand-crafted request might try. Template
checks decide what to _render_ — hiding a button someone cannot use — and are
deliberately not the security boundary.

The model has three layers: a suspended account can do nothing; a per-person
override grants or denies a single permission, with a deny beating every role;
otherwise the union of the account's roles applies.

Separately, roles carry a numeric authority level and an account may only
administer accounts and roles strictly below its own. This is what prevents
privilege escalation: without it, any holder of `user.manage` could grant
itself `role.manage`. A database trigger additionally refuses to remove the
last active Owner, so the academy cannot lock itself out.

Full details in [README.md](README.md#how-access-control-works).

## Hardening applied

**Real response headers.** The site runs on Cloudflare Workers, which can set
response headers. `src/lib/security.ts` sets them on every response:

| Header                       | Value                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `Content-Security-Policy`    | `default-src 'self'`, no `'unsafe-inline'`, no `'unsafe-eval'`, `frame-ancestors 'none'` |
| `X-Frame-Options`            | `DENY`                                                                                   |
| `X-Content-Type-Options`     | `nosniff`                                                                                |
| `Referrer-Policy`            | `strict-origin-when-cross-origin`                                                        |
| `Permissions-Policy`         | camera, microphone, geolocation, payment and USB all switched off                        |
| `Strict-Transport-Security`  | `max-age=31536000; includeSubDomains; preload` (HTTPS only)                              |
| `Cross-Origin-Opener-Policy` | `same-origin`                                                                            |

Admin responses additionally carry `Cache-Control: private, no-store` and
`X-Robots-Tag: noindex, nofollow`.

**Self-hosted assets.** Every stylesheet, script, font and icon is served from
this origin. There are no requests to Google Fonts, cdnjs or any other
third-party origin, so no outside party can see who visits the site or change
what the site serves.

**No inline code.** There are no inline `<script>` blocks, no `on*` handler
attributes, no `javascript:` URLs, and no `eval`. Stylesheets are never inlined
either (`build.inlineStylesheets: 'never'`), which is what lets `style-src`
stay `'self'` with no `'unsafe-inline'`.

**Untrusted content is escaped.** Copy comes from the database, which means it
comes from whatever staff typed into the admin area. The helpers in
`src/lib/format.ts` escape first and add the small amount of markup the design
needs second, so a stray tag in a headline renders as visible text.

**Link URLs are constrained at two levels.** `news_sources.url` has a database
check constraint requiring `http(s)`, and `safeUrl()` re-checks at render time.
A `javascript:` URL cannot reach a link's `href` even if a form is bypassed.

**Open-redirect guard on sign-in.** The login form's `?next` parameter is
rejected unless it begins `/admin`. Protocol-relative values (`//evil.test`)
are rejected too.

**Sign-out is POST only.** A GET endpoint would let any page on the internet
sign the academy out with an `<img>` tag.

**Sign-in does not confirm which accounts exist.** A failure reports only that
the email and password did not match.

**Service role key is server-only.** It bypasses row level security and is read
exclusively in `src/lib/supabase/server.ts`, never imported into anything that
ships to the browser. In production it is a Wrangler secret.

**Audit log.** `public.audit_log` is append-only: readable with `audit.read`,
and writable by no policy at all. Rows arrive only through a `security definer`
function.

## Changes from the previous hosting

The previous build ran on GitHub Pages, which cannot set response headers. Four
protections were documented there as unfixable: `frame-ancestors`,
`X-Frame-Options`, `Permissions-Policy` and a controllable HSTS. All four are
now set as real headers.

The JavaScript clickjacking guard that stood in for them has been removed
rather than kept. It is redundant: `frame-ancestors 'none'` is enforced by the
browser before any page script runs.

The `<meta http-equiv="X-Content-Type-Options">` tag is also gone. Browsers
ignore that directive in a `<meta>` tag; it is now sent as a real header.

## Known gaps

- **Hero photograph.** The previous build loaded it from `images.unsplash.com`.
  The rebuild references a self-hosted `/img/hero.jpg` that has not been added
  yet, so the hero currently renders with its gradient alone. `img-src` is
  already `'self' data:` — no third-party origin is permitted.
- **No automated dependency scanning.** Worth adding Dependabot or `npm audit`
  in CI.
- **No rate limiting on sign-in.** Supabase applies its own limits, but a
  Cloudflare rate-limiting rule on `/admin/login` would be a sensible addition
  before the account list grows.
