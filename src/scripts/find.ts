/**
 * Find-in-page.
 *
 * Searches the current document only. The original walked every "page" because
 * the whole site was one document with hidden sections; now each page is real,
 * so cross-page search would mean a search index, which is a different feature
 * and a bigger promise than this bar should make.
 */

import { revealInView } from './reveal';

const ANIM_SELECTOR = '.anim-snap-up, .anim-hard-left, .anim-hard-right, .anim-enter-up';
const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;

const toggle = document.getElementById('findToggle');
const bar = document.getElementById('findBar');
const input = document.getElementById('findInput') as HTMLInputElement | null;
const countLabel = document.getElementById('findCount');
const closeButton = document.getElementById('findClose');
const nextButton = document.getElementById('findNext');
const prevButton = document.getElementById('findPrev');

let hits: HTMLElement[] = [];
let currentHit = -1;
let debounce: number | undefined;

function clearHits(): void {
  document.querySelectorAll('mark.find-hit').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
    parent.normalize();
  });
  hits = [];
  currentHit = -1;
  if (countLabel) countLabel.textContent = '';
}

/** Text nodes worth searching — skips script, style and SVG internals. */
function collectTextNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      const parent = (node as Text).parentElement;
      if (!parent || parent.closest('script, style, svg, .find-bar')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

function runSearch(): void {
  clearHits();
  const query = input?.value.trim() ?? '';
  if (query.length < MIN_QUERY_LENGTH) return;

  const needle = query.toLowerCase();
  const main = document.getElementById('main') ?? document.body;

  for (const node of collectTextNodes(main)) {
    const text = node.nodeValue ?? '';
    const haystack = text.toLowerCase();
    let index = haystack.indexOf(needle);
    if (index === -1) continue;

    const fragment = document.createDocumentFragment();
    let last = 0;

    while (index !== -1) {
      fragment.appendChild(document.createTextNode(text.slice(last, index)));
      const mark = document.createElement('mark');
      mark.className = 'find-hit';
      mark.textContent = text.slice(index, index + query.length);
      fragment.appendChild(mark);
      hits.push(mark);
      last = index + query.length;
      index = haystack.indexOf(needle, last);
    }

    fragment.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode?.replaceChild(fragment, node);
  }

  if (hits.length) {
    goToHit(0);
  } else if (countLabel) {
    countLabel.textContent = '0 / 0';
  }
}

function goToHit(index: number): void {
  if (!hits.length) return;

  hits[currentHit]?.classList.remove('current');
  currentHit = ((index % hits.length) + hits.length) % hits.length;

  const hit = hits[currentHit];
  if (!hit) return;

  hit.classList.add('current');
  if (countLabel) countLabel.textContent = `${currentHit + 1} / ${hits.length}`;

  // A match can sit inside a section that has not been revealed yet, or that
  // a filter has hidden. Reveal its ancestors so the jump lands somewhere
  // visible rather than on an invisible element.
  let ancestor: HTMLElement | null = hit.closest(ANIM_SELECTOR);
  while (ancestor) {
    ancestor.classList.add('is-visible');
    ancestor = ancestor.parentElement?.closest(ANIM_SELECTOR) ?? null;
  }

  hit.scrollIntoView({ behavior: 'smooth', block: 'center' });
  revealInView();
}

function openFind(): void {
  document.getElementById('mobileMenu')?.classList.remove('open');
  document.getElementById('navToggle')?.setAttribute('aria-expanded', 'false');

  bar?.classList.add('open');
  toggle?.setAttribute('aria-expanded', 'true');
  input?.focus();
  input?.select();
}

function closeFind(): void {
  bar?.classList.remove('open');
  toggle?.setAttribute('aria-expanded', 'false');
  clearHits();
  if (input) input.value = '';
}

toggle?.addEventListener('click', () => {
  if (bar?.classList.contains('open')) closeFind();
  else openFind();
});

closeButton?.addEventListener('click', closeFind);
nextButton?.addEventListener('click', () => goToHit(currentHit + 1));
prevButton?.addEventListener('click', () => goToHit(currentHit - 1));

input?.addEventListener('input', () => {
  window.clearTimeout(debounce);
  debounce = window.setTimeout(runSearch, DEBOUNCE_MS);
});

input?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    goToHit(currentHit + (event.shiftKey ? -1 : 1));
  } else if (event.key === 'Escape') {
    closeFind();
    toggle?.focus();
  }
});
