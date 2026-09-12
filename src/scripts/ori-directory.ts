/**
 * ORI directory interactivity.
 *
 * The table itself is rendered at build time, so the full directory is present
 * in the HTML for search engines and for visitors with JavaScript disabled.
 * This module only filters what is already on the page and handles copying.
 */
function plural(n: number): string {
    return `${n} ${n === 1 ? 'agency' : 'agencies'}`;
}

function copyCode(btn: HTMLButtonElement, code: string): void {
    const done = () => {
        btn.classList.add('copied');
        window.setTimeout(() => btn.classList.remove('copied'), 1200);
    };
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(code).then(done).catch(() => fallbackCopy(code, done));
    } else {
        fallbackCopy(code, done);
    }
}

function fallbackCopy(text: string, done: () => void): void {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        done();
    } catch {
        /* clipboard unavailable */
    }
    document.body.removeChild(ta);
}

export function initOriDirectory(): void {
    const list = document.getElementById('oriList');
    if (!list) return;

    const searchEl = document.getElementById('oriSearch') as HTMLInputElement | null;
    const countyEl = document.getElementById('oriCounty') as HTMLSelectElement | null;
    const countEl = document.getElementById('oriCount');
    const totalAgencies = Number(list.dataset.totalAgencies ?? 0);
    const totalCounties = Number(list.dataset.totalCounties ?? 0);

    list.querySelectorAll<HTMLButtonElement>('.ori-chip').forEach((btn) => {
        btn.addEventListener('click', () => copyCode(btn, btn.dataset.code ?? ''));
    });

    const filter = () => {
        const q = (searchEl?.value ?? '').trim().toUpperCase();
        const county = countyEl?.value ?? '';
        let shown = 0;

        list.querySelectorAll<HTMLElement>('.ori-county').forEach((sec) => {
            let visible = 0;
            const countyOk = !county || sec.dataset.county === county;

            sec.querySelectorAll<HTMLElement>('.ori-row').forEach((row) => {
                const hit = countyOk && (!q || (row.dataset.match ?? '').includes(q));
                row.classList.toggle('is-hidden', !hit);
                if (hit) visible++;
            });

            sec.classList.toggle('is-hidden', visible === 0);

            // Show the county's real total; only say "x of y" while a filter is
            // actually hiding some of them.
            const tally = sec.querySelector<HTMLElement>('.ori-tally');
            if (tally) {
                const total = Number(tally.dataset.total);
                tally.textContent = visible === total ? plural(total) : `${visible} of ${plural(total)}`;
            }
            shown += visible;
        });

        let empty = list.querySelector<HTMLElement>('.ori-empty');
        if (!shown) {
            if (!empty) {
                empty = document.createElement('div');
                empty.className = 'ori-empty';
                const icon = document.createElement('i');
                icon.className = 'fa-solid fa-magnifying-glass';
                empty.appendChild(icon);
                empty.append(
                    'No agency matches that search. Try a town name or the first few characters of the code.',
                );
                list.appendChild(empty);
            }
            empty.classList.remove('is-hidden');
        } else if (empty) {
            empty.classList.add('is-hidden');
        }

        if (countEl) {
            countEl.textContent =
                shown === totalAgencies
                    ? `${plural(totalAgencies)} in ${totalCounties} counties`
                    : `${shown} of ${plural(totalAgencies)}`;
        }
    };

    searchEl?.addEventListener('input', filter);
    countyEl?.addEventListener('change', filter);
    filter();
}
