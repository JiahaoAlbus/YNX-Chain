// Local presentation preference only; independent of account/session storage.
const copy={"en":["Display","Text size","Compact","Standard","Larger"],"zh-Hans":["显示","字号","紧凑","标准","较大"],"zh-Hant":["顯示","字級","緊湊","標準","較大"],"ja":["表示","文字サイズ","コンパクト","標準","大きめ"],"ko":["화면","글자 크기","작게","표준","크게"],"es":["Pantalla","Tamaño del texto","Compacto","Estándar","Grande"],"fr":["Affichage","Taille du texte","Compact","Standard","Plus grand"],"de":["Anzeige","Textgröße","Kompakt","Standard","Größer"],"pt":["Tela","Tamanho do texto","Compacto","Padrão","Maior"],"ru":["Отображение","Размер текста","Компактный","Стандартный","Крупный"],"ar":["العرض","حجم النص","صغير","قياسي","أكبر"],"id":["Tampilan","Ukuran teks","Ringkas","Standar","Lebih besar"]};
const levels=['compact','standard','larger'];
const host=document.querySelector('.commerceNav');
if(host){
 const key="ynx-shop-text-size";
 let saved='standard';try{saved=localStorage.getItem(key)||saved;}catch{}
 if(!levels.includes(saved))saved='standard';
 const settings=document.createElement('details');settings.className='displaySettings';
 const summary=document.createElement('summary');const label=document.createElement('label');const caption=document.createElement('span');const select=document.createElement('select');select.id='commerceTextSize';
 for(const level of levels)select.add(new Option('',level,false,level===saved));
 label.append(caption,select);settings.append(summary,label);host.append(settings);
 const apply=()=>{document.documentElement.dataset.textSize=select.value;};
 select.addEventListener('change',()=>{apply();try{localStorage.setItem(key,select.value);}catch{}});
 const translate=()=>{let language=document.documentElement.lang;if(language==='zh-CN')language='zh-Hans';if(language==='zh-TW')language='zh-Hant';const text=copy[language]||copy[language.split('-')[0]]||copy.en;summary.textContent=text[0];caption.textContent=text[1];select.setAttribute('aria-label',text[1]);for(let index=0;index<3;index++)select.options[index].textContent=text[index+2];};
 apply();translate();new MutationObserver(translate).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
}
