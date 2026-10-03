// Product-only navigation. Keep every existing permission/data root and handler
// in place; a route is never an authorization grant or a synthetic session.
const routes = new Map([
  ['#matrix-social-workspace', 'chats'], ['#social-moments', 'moments'],
  ['#people-panel', 'contacts'], ['#profile-form', 'settings'],
]);
const nav = document.querySelector('.topbar nav');
const titles = { chats: 'Chats', contacts: 'Contacts', moments: 'Moments', settings: 'Settings' };
function select(route) {
  document.body.dataset.socialPage = route;
  for (const link of nav?.querySelectorAll('a') ?? []) {
    const selected = routes.get(link.getAttribute('href')) === route;
    link.setAttribute('aria-current', selected ? 'page' : 'false');
    link.textContent = titles[routes.get(link.getAttribute('href'))] ?? link.textContent;
  }
  document.querySelector('main')?.scrollTo({ top: 0 });
}
nav?.addEventListener('click', event => {
  const link = event.target.closest('a');
  const route = link && routes.get(link.getAttribute('href'));
  if (!route) return;
  event.preventDefault(); select(route);
});
select(routes.get(location.hash) ?? 'chats');
const moments = document.querySelector('#social-moments');
if (moments && !moments.hasChildNodes()) {
  const title = document.createElement('h2'); title.textContent = 'Moments';
  const locked = document.createElement('p');
  locked.textContent = 'Sign in to see moments shared with you. Private audiences stay protected.';
  moments.append(title, locked);
}
const appearance = document.createElement('fieldset');
appearance.className = 'social-appearance';
const legend = document.createElement('legend'); legend.textContent = 'Text size'; appearance.append(legend);
let saved = '1';
try { saved = localStorage.getItem('ynx.social.ui.text-scale.v1') ?? '1'; } catch { /* guest navigation still works */ }
for (const scale of ['0.9', '1', '1.15', '1.3']) {
  const label = document.createElement('label');
  const input = document.createElement('input'); input.type = 'radio'; input.name = 'socialTextScale'; input.value = scale;
  input.checked = scale === (['0.9', '1', '1.15', '1.3'].includes(saved) ? saved : '1');
  if (input.checked) document.documentElement.style.fontSize = `${Number(scale) * 16}px`;
  input.addEventListener('change', () => {
    document.documentElement.style.fontSize = `${Number(scale) * 16}px`;
    try { localStorage.setItem('ynx.social.ui.text-scale.v1', scale); } catch { /* effective for this view */ }
  });
  label.append(input, document.createTextNode(`${Math.round(Number(scale) * 100)}%`)); appearance.append(label);
}
document.querySelector('#social-workspace')?.prepend(appearance);
// Never remove hidden from private content. The existing identity controller
// remains the only authority that reveals workspace-content or chat devices.
