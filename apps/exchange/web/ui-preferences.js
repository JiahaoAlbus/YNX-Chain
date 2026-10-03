// Product-local presentation preference only; no account, SDK or permission state.
(() => {
  const control = document.querySelector('#ui-text-size');
  if (!control) return;
  const key = 'ynx.' + document.title.split(' — ')[0].toLowerCase().replace(/\s+/g, '-') + '.text-size';
  const sizes = {compact:'100%', standard:'107.142857%', large:'121.428571%'};
  const copy = {
    en:['Display','Text size','Compact','Standard','Larger'],
    'zh-CN':['显示','字号','紧凑','标准','较大'], 'zh-Hans':['显示','字号','紧凑','标准','较大'],
    'zh-TW':['顯示','字級','緊湊','標準','較大'], 'zh-Hant':['顯示','字級','緊湊','標準','較大'],
    ja:['表示','文字サイズ','コンパクト','標準','大きめ'], ko:['화면','글자 크기','작게','표준','크게'],
    es:['Pantalla','Tamaño de texto','Compacto','Estándar','Más grande'],
    fr:['Affichage','Taille du texte','Compact','Standard','Plus grand'],
    de:['Anzeige','Textgröße','Kompakt','Standard','Größer'],
    pt:['Exibição','Tamanho do texto','Compacto','Padrão','Maior'],
    ru:['Отображение','Размер текста','Компактный','Стандартный','Крупнее'],
    ar:['العرض','حجم النص','مضغوط','قياسي','أكبر'], id:['Tampilan','Ukuran teks','Ringkas','Standar','Lebih besar']
  };
  const apply = value => {control.value = Object.hasOwn(sizes,value) ? value : 'standard'; document.documentElement.style.setProperty('--ui-scale',sizes[control.value]);};
  const translate = () => {
    const labels = copy[document.documentElement.lang] || copy.en;
    document.querySelector('#ui-display-label').textContent=labels[0];
    document.querySelector('#ui-size-label').textContent=labels[1];
    control.setAttribute('aria-label',labels[1]);
    [...control.options].forEach((option,index)=>option.textContent=labels[index+2]);
  };
  try {apply(localStorage.getItem(key));} catch {apply('standard');}
  control.addEventListener('change',()=>{apply(control.value);try{localStorage.setItem(key,control.value);}catch{}});
  new MutationObserver(translate).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  translate();
})();
