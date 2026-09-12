/**
 * ORI directory: filtering and copy-to-clipboard.
 *
 * Filtering matches against a pre-built uppercase string on each row (agency
 * name plus both code forms), so a search never touches the DOM to read text.
 * With 640 rows that is the difference between instant and noticeably laggy
 * on a phone.
 */

const list = document.getElementById('oriList');

if (list) {
  const search = document.getElementById('oriSearch') as HTMLInputElement | null;
  const countySelect = document.getElementById('oriCounty') as HTMLSelectElement | null;
  const countLabel = document.getElementById('oriCount');
  const empty = document.getElementById('oriEmpty');

  const sections = Array.from(list.querySelectorAll<HTMLElement>('.ori-county'));
  const totalAgencies = Number(list.dataset.totalAgencies ?? 0);
  const totalCounties = Number(list.dataset.totalCounties ?? sections.length);

  const plural = (count: number): string => `${count} ${count === 1 ? 'agency' : 'agencies'}`;

  const filter = (): void => {
    const query = (search?.value ?? '').trim().toUpperCase();
    const county = countySelect?.value ?? '';
    let shown = 0;

    for (const section of sections) {
      const countyMatches = !county || section.dataset.county === county;
      let visible = 0;

      for (const row of section.querySelectorAll<HTMLElement>('.ori-row')) {
        const matches = countyMatches && (!query || (row.dataset.match ?? '').includes(query));
        row.hidden = !matches;
        if (matches) visible += 1;
      }

      section.hidden = visible === 0;

      // Show the county's real total, and only say "x of y" while a filter is
      // actually hiding some of them.
      const tally = section.querySelector<HTMLElement>('.ori-tally');
      if (tally) {
        const total = Number(tally.dataset.total ?? 0);
        tally.textContent = visible === total ? plural(total) : `${visible} of ${plural(total)}`;
      }

      shown += visible;
    }

    if (empty) empty.hidden = shown > 0;

    if (countLabel) {
      countLabel.textContent =
        shown === totalAgencies
          ? `${plural(totalAgencies)} in ${totalCounties} counties`
          : `${shown} of ${plural(totalAgencies)}`;
    }
  };

  search?.addEventListener('input', filter);
  countySelect?.addEventListener('change', filter);

  /* --- Copy a code ------------------------------------------------------- */
  const flashCopied = (button: HTMLElement): void => {
    button.classList.add('copied');
    window.setTimeout(() => button.classList.remove('copied'), 1200);
  };

  const fallbackCopy = (text: string, done: () => void): void => {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    try {
      document.execCommand('copy');
      done();
    } catch {
      // Clipboard unavailable — the code is still visible and selectable.
    }
    document.body.removeChild(field);
  };

  // One delegated listener rather than 1,280 individual ones.
  list.addEventListener('click', (event) => {
    const chip = (event.target as HTMLElement | null)?.closest<HTMLElement>('.ori-chip');
    const code = chip?.dataset.code;
    if (!chip || !code) return;

    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(code)
        .then(() => flashCopied(chip))
        .catch(() => fallbackCopy(code, () => flashCopied(chip)));
    } else {
      fallbackCopy(code, () => flashCopied(chip));
    }
  });
}
