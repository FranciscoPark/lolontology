// 세 페이지(온톨로지·밴픽·아이템) 전환. 주소의 #해시로 현재 페이지를 유지한다.
import {$} from './app-state.js';
import {renderOntology} from './view-ontology.js';
import {renderGraphBuild} from './view-items.js';

export const PAGES = ['ontology', 'banpick', 'items'];

export function setPage(page) {
  for (const name of PAGES) $(`#page-${name}`).hidden = name !== page;
  document.querySelectorAll('[data-page]').forEach(button => {
    const active = button.dataset.page === page;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  history.replaceState(null, '', `#${page}`);
  if (page === 'ontology') renderOntology();
  if (page === 'items') renderGraphBuild();
}

export function bindNav() {
  document
    .querySelectorAll('[data-page]')
    .forEach(button => button.addEventListener('click', () => setPage(button.dataset.page)));
  $('#back-to-draft').onclick = () => setPage('banpick');
}
