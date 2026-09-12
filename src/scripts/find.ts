/**
 * Find in page.
 *
 * Behaviour is carried over from the original: type two or more characters,
 * every match on the page is highlighted, and the arrows step through them.
 *
 * One deliberate difference. The original site was a single document holding
 * every "page" as a hidden <div>, so its search reached the whole site. Routes
 * are now real pages, so this searches the current page and links to matches
 * elsewhere using a search index built at compile time.
 */
import { ANIM_SELECTOR } from './animations';

interface IndexEntry {
    url: string;
    title: string;
    text: string;
}

let hits: HTMLElement[] = [];
let currentHit = -1;
let findTimer: number | undefined;
let searchIndex: IndexEntry[] | null = null;

function clearHits(countEl: HTMLElement): void {
    document.querySelectorAll('mark.find-hit').forEach((m) => {
        const parent = m.parentNode;
        if (!parent) return;
        parent.replaceChild(document.createTextNode(m.textContent ?? ''), m);
        parent.normalize();
    });
    hits = [];
    currentHit = -1;
    countEl.textContent = '';
    const other = document.getElementById('findOther');
    if (other) other.textContent = '';
}

function collectTextNodes(root: Node): Text[] {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
            const p = (node as Text).parentElement;
            if (!p || p.closest('script, style, svg, .find-bar, nav')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    const nodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) nodes.push(n as Text);
    return nodes;
}

function goToHit(i: number, countEl: HTMLElement): void {
    if (!hits.length) return;
    if (currentHit >= 0 && hits[currentHit]) hits[currentHit].classList.remove('current');
    currentHit = ((i % hits.length) + hits.length) % hits.length;
    const hit = hits[currentHit];
    hit.classList.add('current');
    countEl.textContent = `${currentHit + 1} / ${hits.length}`;

    // Reveal any animation-hidden ancestors so the match is actually visible
    let anc: HTMLElement | null = hit.closest(ANIM_SELECTOR);
    while (anc) {
        anc.classList.add('is-visible');
        anc = anc.parentElement ? anc.parentElement.closest(ANIM_SELECTOR) : null;
    }

    hit.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function loadIndex(): Promise<IndexEntry[]> {
    if (searchIndex) return searchIndex;
    try {
        const res = await fetch('/search-index.json');
        searchIndex = res.ok ? ((await res.json()) as IndexEntry[]) : [];
    } catch {
        searchIndex = [];
    }
    return searchIndex;
}

async function showOtherPages(query: string): Promise<void> {
    const other = document.getElementById('findOther');
    if (!other) return;
    const index = await loadIndex();
    const here = window.location.pathname.replace(/\/$/, '') || '/';
    const q = query.toLowerCase();

    const elsewhere = index
        .filter((p) => (p.url.replace(/\/$/, '') || '/') !== here)
        .filter((p) => p.text.toLowerCase().includes(q) || p.title.toLowerCase().includes(q));

    other.textContent = '';
    if (!elsewhere.length) return;

    other.append('Also on: ');
    elsewhere.forEach((p, i) => {
        const a = document.createElement('a');
        a.href = p.url;
        a.textContent = p.title;
        other.appendChild(a);
        if (i < elsewhere.length - 1) other.append(', ');
    });
}

function runSearch(input: HTMLInputElement, countEl: HTMLElement): void {
    clearHits(countEl);
    const q = input.value.trim();
    if (q.length < 2) return;
    const qLower = q.toLowerCase();

    const main = document.querySelector('main') ?? document.body;
    collectTextNodes(main).forEach((node) => {
        const text = node.nodeValue ?? '';
        const lower = text.toLowerCase();
        let idx = lower.indexOf(qLower);
        if (idx === -1) return;

        const frag = document.createDocumentFragment();
        let last = 0;
        while (idx !== -1) {
            frag.appendChild(document.createTextNode(text.slice(last, idx)));
            const mark = document.createElement('mark');
            mark.className = 'find-hit';
            mark.textContent = text.substr(idx, q.length);
            frag.appendChild(mark);
            hits.push(mark);
            last = idx + q.length;
            idx = lower.indexOf(qLower, last);
        }
        frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode?.replaceChild(frag, node);
    });

    if (hits.length) {
        goToHit(0, countEl);
    } else {
        countEl.textContent = '0 / 0';
    }

    void showOtherPages(q);
}

export function initFind(): void {
    const toggle = document.getElementById('findToggle');
    const bar = document.getElementById('findBar');
    const input = document.getElementById('findInput') as HTMLInputElement | null;
    const countEl = document.getElementById('findCount');
    const closeBtn = document.getElementById('findClose');
    const nextBtn = document.getElementById('findNext');
    const prevBtn = document.getElementById('findPrev');
    if (!toggle || !bar || !input || !countEl || !closeBtn || !nextBtn || !prevBtn) return;

    const open = () => {
        const menu = document.getElementById('mobileMenu');
        const navToggle = document.getElementById('navToggle');
        menu?.classList.remove('open');
        navToggle?.setAttribute('aria-expanded', 'false');

        bar.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
        input.focus();
        input.select();
    };

    const close = () => {
        bar.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        clearHits(countEl);
        input.value = '';
    };

    toggle.addEventListener('click', () => {
        bar.classList.contains('open') ? close() : open();
    });
    closeBtn.addEventListener('click', close);
    nextBtn.addEventListener('click', () => goToHit(currentHit + 1, countEl));
    prevBtn.addEventListener('click', () => goToHit(currentHit - 1, countEl));

    input.addEventListener('input', () => {
        window.clearTimeout(findTimer);
        findTimer = window.setTimeout(() => runSearch(input, countEl), 250);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            goToHit(currentHit + (e.shiftKey ? -1 : 1), countEl);
        } else if (e.key === 'Escape') {
            close();
        }
    });
}
