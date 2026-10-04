const link=document.querySelector('[data-media-about]');
function update(){if(!link)return;const lang=new URL(location.href).searchParams.get('lang')||document.documentElement.lang;const target=new URL('index.html',location.href);target.searchParams.set('lang',lang.startsWith('zh')?'zh-CN':'en');link.href=target.href;link.textContent=lang.startsWith('zh')?'← Media 产品介绍':'← About YNX Media';}
update();new MutationObserver(update).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
