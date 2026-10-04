const bar=document.querySelector('[data-media-navigation]');
const labels={en:{about:'YNX Media',label:'Media experiences',video:'Watch',music:'Listen',creator:'Create'},'zh-CN':{about:'YNX Media',label:'Media 功能',video:'观看',music:'聆听',creator:'创作'}};
function update(){
 if(!bar)return;
 const lang=new URL(location.href).searchParams.get('lang')||document.documentElement.lang;
 const locale=lang.startsWith('zh')?'zh-CN':'en',words=labels[locale];
 bar.setAttribute('aria-label',words.label);
 const about=bar.querySelector('[data-media-about]'),target=new URL('index.html',location.href);
 target.searchParams.set('lang',locale);about.href=target.href;about.textContent=words.about;
 for(const link of bar.querySelectorAll('[data-media-experience]')){
  const role=link.dataset.mediaExperience,current=role===bar.dataset.currentExperience;
  // Only transfer display language. Account grants and return views belong to each original engine.
  const next=new URL(current?'app.html':link.dataset.mediaDestination,location.href);
  next.searchParams.set('lang',locale);link.href=next.href;link.textContent=words[role];
  if(current)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
 }
}
update();new MutationObserver(update).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
