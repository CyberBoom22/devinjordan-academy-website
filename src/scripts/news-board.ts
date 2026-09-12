/**
 * News & legislation board.
 *
 * Entries for every jurisdiction and category are rendered at build time and
 * simply shown or hidden here, so the content is in the HTML for search
 * engines and the filters stay instant.
 */
export function initNewsBoard(): void {
    const board = document.getElementById('newsBoard');
    if (!board) return;

    const pills = document.getElementById('statePills');
    const select = document.getElementById('stateSelect') as HTMLSelectElement | null;
    const tabs = document.getElementById('newsTabs');
    const list = document.getElementById('newsList');
    if (!list) return;

    const ready = board.dataset.ready === 'true';
    let activeState = board.dataset.initialState ?? 'NJ';
    let activeCat = 'legislation';

    const render = () => {
        pills?.querySelectorAll<HTMLElement>('.state-pill').forEach((b) =>
            b.classList.toggle('active', b.dataset.state === activeState),
        );
        if (select && select.value !== activeState) select.value = activeState;
        tabs?.querySelectorAll<HTMLElement>('.news-tab').forEach((t) =>
            t.classList.toggle('active', t.dataset.cat === activeCat),
        );

        if (!ready) {
            // Keep the pickers live but show the connecting animation, so
            // visitors never see placeholder entries.
            const stateName =
                pills?.querySelector<HTMLElement>(`.state-pill[data-state="${activeState}"]`)
                    ?.dataset.name ??
                select?.selectedOptions[0]?.dataset.name ??
                'jurisdiction';
            const what = activeCat === 'cases' ? 'court decisions' : 'bills and laws';
            const nameEl = list.querySelector<HTMLElement>('.news-loading-state');
            const whatEl = list.querySelector<HTMLElement>('.news-loading-what');
            if (nameEl) nameEl.textContent = stateName;
            if (whatEl) whatEl.textContent = what;
            return;
        }

        let shown = 0;
        list.querySelectorAll<HTMLElement>('.news-item').forEach((item) => {
            const hit = item.dataset.state === activeState && item.dataset.cat === activeCat;
            item.style.display = hit ? '' : 'none';
            if (hit) shown++;
        });

        const empty = list.querySelector<HTMLElement>('.news-empty');
        if (empty) {
            empty.classList.toggle('is-hidden', shown > 0);
            const what = activeCat === 'cases' ? 'court decisions' : 'bills or laws';
            const whatEl = empty.querySelector<HTMLElement>('.news-empty-what');
            const stateEl = empty.querySelector<HTMLElement>('.news-empty-state');
            if (whatEl) whatEl.textContent = what;
            if (stateEl) {
                stateEl.textContent =
                    pills?.querySelector<HTMLElement>(`.state-pill[data-state="${activeState}"]`)
                        ?.dataset.name ?? 'this state';
            }
        }
    };

    pills?.querySelectorAll<HTMLElement>('.state-pill').forEach((btn) => {
        btn.addEventListener('click', () => {
            activeState = btn.dataset.state ?? activeState;
            render();
        });
    });

    select?.addEventListener('change', () => {
        if (select.value) {
            activeState = select.value;
            render();
        }
    });

    tabs?.querySelectorAll<HTMLElement>('.news-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            activeCat = tab.dataset.cat ?? activeCat;
            render();
        });
    });

    render();
}
