/**
 * Keeps the projector roster current.
 *
 * An external module rather than an inline block, because the production CSP is
 * `script-src 'self'` — see src/lib/security.ts. Matches the shape of ori.ts
 * and news.ts: find the element, bail quietly if it is not this page.
 *
 * Five seconds. Fast enough that a student who has just scanned sees their name
 * appear while they are still looking at the screen, slow enough that an
 * eight-hour class is a few thousand requests rather than a few hundred
 * thousand.
 *
 * WHY IT FAILS QUIET BUT NOT INVISIBLE
 * ------------------------------------
 * A failed poll does not clear the list — a blank roster caused by one dropped
 * request would read as "nobody came" to a room full of people who did. The
 * last good render stays on screen. But repeated failures do show a small
 * stale marker, because a screen that has silently stopped updating is worse
 * than one that admits it: the instructor needs to know before they certify a
 * roster that is missing the last hour.
 */

const POLL_MS = 5_000;
/** Roughly a minute of failures before saying so. */
const FAILURES_BEFORE_WARNING = 12;

type RosterEntry = { name: string; timeIn: string };
type RosterPayload = { ok: boolean; count: number; roster: RosterEntry[] };

const stage = document.querySelector<HTMLElement>('[data-roster-endpoint]');

if (stage) {
  const endpoint = stage.dataset.rosterEndpoint!;
  const list = stage.querySelector<HTMLOListElement>('[data-roster-list]');
  const countEl = stage.querySelector<HTMLElement>('[data-roster-count]');
  const emptyEl = stage.querySelector<HTMLElement>('[data-roster-empty]');

  let failures = 0;
  let warning: HTMLElement | null = null;

  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const showWarning = (show: boolean): void => {
    if (show && !warning) {
      warning = document.createElement('p');
      warning.className = 'roster-stale';
      warning.textContent = 'Display is not updating — check the connection before certifying.';
      list?.parentElement?.prepend(warning);
    } else if (!show && warning) {
      warning.remove();
      warning = null;
    }
  };

  const render = (payload: RosterPayload): void => {
    if (!list) return;

    if (countEl) countEl.textContent = String(payload.count);

    // Rebuild rather than diff. Two hundred rows of text is nothing, and a diff
    // is a second implementation of the same list waiting to disagree with the
    // server-rendered one.
    list.textContent = '';
    for (const entry of payload.roster) {
      const li = document.createElement('li');

      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = entry.name;

      const at = document.createElement('span');
      at.className = 'at';
      const parsed = new Date(entry.timeIn);
      at.textContent = Number.isNaN(parsed.getTime()) ? '' : timeFormatter.format(parsed);

      li.append(who, at);
      list.append(li);
    }

    if (emptyEl) emptyEl.hidden = payload.count > 0;
  };

  const poll = async (): Promise<void> => {
    try {
      const response = await fetch(endpoint, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });

      if (!response.ok) throw new Error(`status ${response.status}`);

      const payload = (await response.json()) as RosterPayload;
      if (!payload.ok) throw new Error('not available');

      failures = 0;
      showWarning(false);
      render(payload);
    } catch {
      // Keep whatever is on screen. See the header.
      failures += 1;
      if (failures >= FAILURES_BEFORE_WARNING) showWarning(true);
    }
  };

  window.setInterval(poll, POLL_MS);
  // Catch up immediately when the display is woken or refocused, so an
  // instructor who just unlocked the laptop is not looking at a stale list.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void poll();
  });
}
