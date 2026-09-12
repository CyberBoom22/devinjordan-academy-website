/**
 * Clickjacking guard.
 *
 * On Cloudflare we set `Content-Security-Policy: frame-ancestors` and
 * `X-Frame-Options` as real response headers (see public/_headers), which is
 * the authoritative defence. This stays as belt-and-braces for the case where
 * the site is served from somewhere that cannot set headers: if the page finds
 * itself framed it tries to break out, and hides its content if it cannot.
 */
export function enforceTopLevel(): void {
    if (window.top === window.self) return;
    try {
        window.top!.location.replace(window.self.location.href);
    } catch {
        // Cross-origin parent refused the navigation — hide rather than render
        // inside someone else's frame.
        document.documentElement.style.display = 'none';
    }
}
