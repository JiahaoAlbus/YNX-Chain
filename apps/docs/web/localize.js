import{applyLocale,selectedLocale}from'./i18n.js';
applyLocale(selectedLocale());
document.querySelector('#locale').addEventListener('change',event=>applyLocale(event.target.value));
