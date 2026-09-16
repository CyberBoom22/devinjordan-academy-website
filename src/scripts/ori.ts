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
        if (matches) {
          // Striped here rather than with :nth-of-type, which counts the rows
          // a filter has hidden and stripes the survivors at random.
          row.classList.toggle('alt', visible % 2 === 1);
          visible += 1;
        }
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

  /**
   * Bring the surviving list into view after a county is picked.
   *
   * Filtering leaves the chosen county as the only section, so it is already
   * at the top of the list — but the viewport does not move, and from halfway
   * down 640 rows the change is invisible. Only on the dropdown: doing it per
   * keystroke while someone types a search would yank the page around under
   * them.
   */
  const revealResults = (): void => {
    const target = sections.find((section) => !section.hidden) ?? list;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  };

  search?.addEventListener('input', filter);

  countySelect?.addEventListener('change', () => {
    filter();
    revealResults();
  });

  // Paint the initial stripes. Also re-syncs the counts if the browser restored
  // a typed query on a back-navigation, which it does for text inputs.
  filter();

  /* --- Copy a code ------------------------------------------------------- */
  const copyStatus = document.getElementById('oriCopyStatus');

  const flashCopied = (button: HTMLElement): void => {
    button.classList.add('copied');
    window.setTimeout(() => button.classList.remove('copied'), 1200);

    // The green flash says nothing to a screen reader, and this is a button
    // whose entire purpose is an effect you cannot see.
    if (copyStatus) copyStatus.textContent = `Copied ${button.dataset.code ?? ''}`;
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
