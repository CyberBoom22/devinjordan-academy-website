# Security

This document covers how the Devin Jordan Security Training Academy website is
hardened, what the hosting platform can and cannot enforce, and how to report a
problem.

## Reporting a vulnerability

Please report suspected security issues by phone:

**(848) 398-0976**

The same contact is published in machine-readable form at
[`/.well-known/security.txt`](.well-known/security.txt), per RFC 9116.

Please include what you found, how to reproduce it, and how we can reach you.
Allow a few business days for a reply. Please do not publicly disclose an issue
before we have had a chance to fix it.

> **Recommended improvement:** a dedicated security email address (for example
> `security@devinjordansecuritytrainingacademy.com`) would be a better contact
> than a phone number. It creates a written record, works across time zones, and
> is what most researchers and automated tools expect. If one is set up, add it
> as the first `Contact:` line in `security.txt`.

## Hardening applied

**Self-hosted assets.** Every stylesheet, script, font, and icon the page needs
is served from this repository. There are no requests to Google Fonts, cdnjs, or
any other third-party origin, so no outside party can see who visits the site or
change what the site serves. The one exception is noted under _Known gaps_ below.

**Content Security Policy.** Every page carries a strict CSP `<meta>` tag that
limits the browser to loading resources from this origin only:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self';
font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none';
base-uri 'self'; form-action 'none'; upgrade-insecure-requests
```

It uses neither `'unsafe-inline'` nor `'unsafe-eval'`. `object-src 'none'` and
`frame-src 'none'` block plugins and embedded frames, `base-uri 'self'` stops an
injected `<base>` tag from redirecting relative URLs, `form-action 'none'` stops
any injected form from submitting anywhere, and `upgrade-insecure-requests`
rewrites stray `http://` subresource URLs to `https://`.

**No inline code.** There are no inline `<script>` blocks, no `on*` event
handler attributes, no `javascript:` URLs, and no `eval` or `new Function`. All
behaviour lives in `assets/js/`. There are also no inline `style="..."`
attributes — every one was replaced by a named class — which is what allows
`style-src 'self'` to hold without `'unsafe-inline'`. Setting individual
properties from JavaScript (`element.style.display = 'none'`) is still used and
is permitted under CSP.

**Referrer policy.** `<meta name="referrer" content="strict-origin-when-cross-origin">`
sends only the origin (not the full path) when a visitor follows a link off-site,
and sends nothing at all when downgrading from HTTPS to HTTP.

**Framing check.** A meta-tag CSP cannot set `frame-ancestors`, so `assets/js/main.js`
begins with a clickjacking guard: if the page finds itself inside a frame it tries
to navigate the top-level window to itself, and if that is blocked it hides the
page content instead. This is defence in depth, not a substitute for a real
response header.

**`X-Content-Type-Options` removed.** The original file carried
`<meta http-equiv="X-Content-Type-Options" content="nosniff">`. Browsers ignore
this directive when it arrives as a `<meta>` tag — it is only honoured as an HTTP
response header — so it was removed rather than left in place giving a false
sense of protection. GitHub Pages already sends `X-Content-Type-Options: nosniff`
on its own responses.

**`security.txt`.** `/.well-known/security.txt` gives researchers a documented
way to reach us. The `.nojekyll` file at the repository root is what makes the
`.well-known/` directory publish at all — Jekyll would otherwise skip
directories beginning with a dot.

## GitHub Pages limitations

GitHub Pages serves static files and does not let a repository set custom HTTP
response headers. There is no `.htaccess`, no `_headers` file, and no server-side
configuration. As a result the following **cannot** be set from this repository:

| Protection                                                                     | Why it needs a header                                                                                                                                                                               |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy: frame-ancestors`                                     | Ignored in a `<meta>` tag; only valid as a header. The JavaScript framing check above is the partial substitute.                                                                                    |
| `X-Frame-Options`                                                              | Header-only. Same gap as `frame-ancestors`.                                                                                                                                                         |
| `X-Content-Type-Options`                                                       | Header-only. GitHub Pages happens to send it, but the repository cannot control or guarantee it.                                                                                                    |
| `Permissions-Policy`                                                           | Header-only. Camera, microphone, geolocation and similar features cannot be switched off from here.                                                                                                 |
| `Strict-Transport-Security` (custom `max-age`, `includeSubDomains`, `preload`) | Header-only. GitHub Pages sends its own HSTS header for `*.github.io`; for a custom domain it sends one once **Enforce HTTPS** is enabled in Settings → Pages, but the values are not configurable. |

To set any of these, the site would need a CDN or reverse proxy in front of it
that can add response headers — Cloudflare (free tier, via Transform Rules or a
Worker) is the usual choice. That is a hosting change, not a code change, and
nothing in this repository would need to be modified.

## Known gaps

- **Hero photograph.** The homepage hero background still loads from
  `images.unsplash.com`, so `img-src` in the CSP allows that one origin. The file
  could not be downloaded and self-hosted from the build environment because
  outbound access to Unsplash was blocked. Self-hosting it as
  `assets/img/hero.jpg` and tightening `img-src` back to `'self'` is a small,
  worthwhile follow-up.
- **No integrity pinning needed.** Because assets are local, Subresource
  Integrity hashes are unnecessary; the files are versioned in git.
