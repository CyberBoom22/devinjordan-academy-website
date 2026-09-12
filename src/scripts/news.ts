/**
 * News board filtering.
 *
 * Every entry is already in the document; this only decides which are shown.
 * That is the whole reason the board works with JavaScript disabled — without
 * this file a visitor sees all entries rather than none.
 */

const board = document.querySelector<HTMLElement>('.news-wrap');

if (board) {
  // Bound to a local const so the null check still holds inside the helpers
  // below — narrowing does not survive into a hoisted function declaration.
  const wrap = board;
  const feedReady = wrap.dataset.feedReady === 'true';
  const pills = Array.from(wrap.querySelectorAll<HTMLButtonElement>('.state-pill'));
  const select = wrap.querySelector<HTMLSelectElement>('#stateSelect');
  const tabs = Array.from(wrap.querySelectorAll<HTMLButtonElement>('.news-tab'));
  const items = Array.from(wrap.querySelectorAll<HTMLElement>('.news-item'));
  const empty = wrap.querySelector<HTMLElement>('#newsEmpty');

  let activeState = wrap.dataset.defaultJurisdiction ?? '';
  let activeCategory = 'legislation';

  const jurisdictionName = (code: string): string => {
    const option = select?.querySelector<HTMLOptionElement>(`option[value="${CSS.escape(code)}"]`);
    // The option label carries a count in parentheses once the feed is live.
    return (option?.textContent ?? code).replace(/\s*\(\d+\)\s*$/, '').trim();
  };

  const categoryNoun = (): string =>
    activeCategory === 'cases' ? 'court decisions' : 'bills or laws';

  const render = (): void => {
    for (const pill of pills) {
      pill.classList.toggle('active', pill.dataset.state === activeState);
    }

    if (select && select.value !== activeState) select.value = activeState;

    for (const tab of tabs) {
      const isActive = tab.dataset.cat === activeCategory;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
    }

    let visible = 0;
    for (const item of items) {
      const matches =
        item.dataset.jurisdiction === activeState && item.dataset.category === activeCategory;
      item.hidden = !matches;
      if (matches) visible += 1;
    }

    if (feedReady && empty) {
      empty.hidden = visible > 0;
      const what = empty.querySelector('#emptyWhat');
      const where = empty.querySelector('#emptyWhere');
      if (what) what.textContent = categoryNoun();
      if (where) where.textContent = jurisdictionName(activeState);
    }

    if (!feedReady) {
      const label = wrap.querySelector('#loadingJurisdiction');
      const what = wrap.querySelector('#loadingWhat');
      if (label) label.textContent = jurisdictionName(activeState);
      if (what)
        what.textContent = activeCategory === 'cases' ? 'court decisions' : 'bills and laws';
    }
  };

  for (const pill of pills) {
    pill.addEventListener('click', () => {
      activeState = pill.dataset.state ?? activeState;
      render();
    });
  }

  select?.addEventListener('change', () => {
    activeState = select.value;
    render();
  });

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      activeCategory = tab.dataset.cat ?? activeCategory;
      render();
    });
  }

  render();
}
