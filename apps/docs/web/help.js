import {guides, guideLocale} from './guide-translations.js';

const picker = document.querySelector('#language');
const routes = [
  'POST /api/v1/session', 'DELETE /api/v1/session',
  'GET /api/v1/objects?parentId=&q=', 'POST /api/v1/objects',
  'GET /api/v1/objects/{id}', 'GET /api/v1/objects/{id}/content',
  'PUT /api/v1/objects/{id}/document',
  'POST /api/v1/objects/{id}/versions/{version}/restore',
];
for (const [language, guide] of Object.entries(guides)) {
  const option = document.createElement('option');
  option.value = language;
  option.textContent = guide.name;
  picker.append(option);
  const article = document.createElement('article');
  article.lang = language;
  article.dataset.language = language;
  article.hidden = true;
  const title = document.createElement('h1');
  title.textContent = guide.title;
  article.append(title);
  const navigation = document.createElement('nav');
  article.append(navigation);
  guide.headings.forEach((heading, index) => {
    const section = document.createElement('section');
    section.id = `guide-${language}-${index}`;
    const link = document.createElement('a');
    link.href = `#${section.id}`;
    link.textContent = heading;
    navigation.append(link);
    const h2 = document.createElement('h2');
    h2.textContent = heading;
    const paragraph = document.createElement('p');
    paragraph.textContent = guide.paragraphs[index];
    section.append(h2, paragraph);
    if (index === 3) {
      const pre = document.createElement('pre');
      pre.dir = 'ltr';
      const code = document.createElement('code');
      code.textContent = routes.join('\n');
      pre.append(code);
      section.append(pre);
    }
    article.append(section);
  });
  document.querySelector('main').append(article);
}
function selectLanguage(value) {
  const language = guideLocale(value);
  picker.value = language;
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  document.title = `YNX Docs | ${guides[language]?.title || (language === 'zh-Hans' ? '使用与开发文档' : 'Guides and API')}`;
  for (const article of document.querySelectorAll('[data-language]')) {
    article.hidden = article.dataset.language !== language;
  }
  try { localStorage.setItem('ynx.docs.guide.language', language); } catch {}
}
let language = navigator.language;
try { language = localStorage.getItem('ynx.docs.guide.language') || language; } catch {}
selectLanguage(language);
picker.addEventListener('change', () => selectLanguage(picker.value));
