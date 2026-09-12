# Security

How the Devin Jordan Security Training Academy website is hardened, what the
hosting platform enforces, and how to report a problem.

## Reporting a vulnerability

Please report suspected security issues by phone:

**(848) 398-0976**

The same contact is published in machine-readable form at
[`/.well-known/security.txt`](public/.well-known/security.txt), per RFC 9116.

Please include what you found, how to reproduce it, and how we can reach you.
Allow a few business days for a reply, and please do not publicly disclose an
issue before we have had a chance to fix it.

> **Recommended improvement:** a dedicated security email address (for example
> `security@devinjordansecuritytrainingacademy.com`) would be a better contact
> than a phone number. It creates a written record, works across time zones, and
> is what most researchers and automated tools expect. If one is set up, add it
> as the first `Contact:` line in `security.txt`.

## Hardening applied

**Real response headers.** Everything below is sent as an HTTP response header
from [`public/_headers`](public/_headers), not as a `<meta>` tag. This matters:
headers cover every response — JSON, fonts, images — not just HTML documents,
and `frame-ancestors` is ignored entirely when it arrives in a meta tag.

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'` with per-directive tightening; see below |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera, microphone, geolocation, payment and others switched off |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |

**Content Security Policy.**

```
default-src 'self'; script-src 'self'; style-src 'self';
img-src 'self' https://images.unsplash.com; font-src 'self'; connect-src 'self';
frame-src 'none'; frame-ancestors 'none'; object-src 'none';
base-uri 'self'; form-action 'none'; upgrade-insecure-requests
```

It uses neither `'unsafe-inline'` nor `'unsafe-eval'`. `frame-ancestors 'none'`
blocks framing outright, `object-src 'none'` blocks plugins, `base-uri 'self'`
stops an injected `<base>` tag redirecting relative URLs, `form-action 'none'`
stops any injected form submitting anywhere, and `upgrade-insecure-requests`
rewrites stray `http://` subresource URLs to `https://`.

**No inline code.** No inline `<script>` blocks, no `on*` handler attributes,
no `javascript:` URLs, no `eval` or `new Function`. All behaviour lives in
`src/scripts/`, bundled by Astro into hashed files served from this origin.
There are also no inline `style` attributes anywhere — every one is a named
class — which is what lets `style-src` stay `'self'`. Setting individual
properties from JavaScript (`element.style.display`) is still used where
appropriate and is permitted under CSP; where a whole element needs hiding, the
code toggles an `.is-hidden` class instead.

**Self-hosted assets.** Every stylesheet, script, font and icon is served from
this origin. No requests to Google Fonts, cdnjs, or any other third party, with
one exception noted under *Known gaps*.

**Framing check.** `src/scripts/guard.ts` runs first on every page: if the page
finds itself inside a frame it tries to navigate the top window to itself, and
hides its content if that is refused. The response headers are the real defence
— this is belt-and-braces for the case where the site is ever served from
somewhere that cannot set headers.

**Automatic HTTPS.** Cloudflare terminates TLS and redirects HTTP to HTTPS.
Certificates renew automatically.

## Why not GitHub Pages

An earlier revision of this site targeted GitHub Pages. Pages serves static
files and does not let a repository set response headers — no `.htaccess`, no
`_headers`, no server configuration. That made `frame-ancestors`,
`X-Frame-Options`, `Permissions-Policy` and any custom HSTS policy impossible to
set, and it made a `<meta>`-tag CSP the only option, which cannot protect
non-HTML responses.

Moving to Cloudflare Pages closed all of those gaps. It is also what makes the
planned staff sign-in possible at all: authentication needs server-side session
handling and permission checks, which static hosting cannot provide.

## Planned: staff accounts and permissions

Phase 2 adds Supabase for staff sign-in and content editing. The security
design principle is that **permissions are enforced in the database**, using
Postgres Row Level Security, not in the browser. Anything enforced only in
client-side JavaScript can be bypassed by editing the page, so the policies live
where the data does. When that work lands this document will be extended to
cover the role model, session handling and audit logging.

## Known gaps

- **Hero photograph.** The homepage hero background still loads from
  `images.unsplash.com`, which is why `img-src` names that one origin rather
  than being plain `'self'`. The file could not be downloaded from the build
  environment because outbound access to Unsplash was blocked there. Saving it
  as `public/assets/img/hero.jpg`, pointing `--hero-image` in
  `src/styles/tokens.css` at it, and dropping the origin from `img-src` is a
  small and worthwhile follow-up. A fallback background colour is already in
  place so the section degrades cleanly if the image fails.
- **HSTS preload.** `Strict-Transport-Security` is set with `includeSubDomains`
  but without `preload`. Adding `preload` and submitting the domain to the
  browser preload list is a further step, but it is difficult to reverse — every
  subdomain must serve valid HTTPS, permanently. Worth doing deliberately rather
  than by default.
- **ORI dataset provenance.** See the warning in README.md; the data needs
  verifying against the original file before it is relied on.
