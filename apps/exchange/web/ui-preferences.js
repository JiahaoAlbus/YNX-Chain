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

// Dialog presentation only. Native showModal, Escape, provider handlers and
// async account state remain owned by the existing application.
(() => {
  const copy = Object.freeze({
    en:['Manage account & access','Close'],
    'zh-Hans':['管理账户与访问权限','关闭'], 'zh-Hant':['管理帳戶與存取權限','關閉'],
    ja:['アカウントとアクセスを管理','閉じる'], ko:['계정 및 접근 관리','닫기'],
    es:['Gestionar cuenta y acceso','Cerrar'], fr:['Gérer le compte et les accès','Fermer'],
    de:['Konto und Zugriff verwalten','Schließen'], pt:['Gerenciar conta e acesso','Fechar'],
    ru:['Управление аккаунтом и доступом','Закрыть'], ar:['إدارة الحساب والوصول','إغلاق'],
    id:['Kelola akun dan akses','Tutup']
  });
  const detailCopy=Object.freeze({"en":["Market data details","Order information"],"zh-Hans":["市场数据详情","订单说明"],"zh-Hant":["市場資料詳情","訂單說明"],"ja":["市場データの詳細","注文について"],"ko":["시장 데이터 상세","주문 안내"],"es":["Detalles del mercado","Información de la orden"],"fr":["Détails du marché","Informations sur l’ordre"],"de":["Marktdaten anzeigen","Informationen zur Order"],"pt":["Detalhes do mercado","Informações da ordem"],"ru":["Сведения о рынке","Информация об ордере"],"ar":["تفاصيل بيانات السوق","معلومات الطلب"],"id":["Detail data pasar","Informasi pesanan"]});
  const translate = () => {
    const lang=document.documentElement.lang;
    const labels=Object.hasOwn(copy,lang)?copy[lang]:copy.en;
    const details=Object.hasOwn(detailCopy,lang)?detailCopy[lang]:detailCopy.en;
    document.querySelectorAll('[data-ui-copy="marketDetails"]').forEach(node=>{node.textContent=details[0]});
    document.querySelectorAll('[data-ui-copy="orderNotes"]').forEach(node=>{node.textContent=details[1]});
    document.querySelectorAll('[data-ui-copy="manage"]').forEach(node=>{node.textContent=labels[0]});
    document.querySelectorAll('dialog .close:not([data-exchange-locale])').forEach(node=>node.setAttribute('aria-label',labels[1]));
  };
  new MutationObserver(translate).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  translate();
  let lastTrigger=null;
  document.addEventListener('click',event=>{
    if(event.target instanceof Element&&!event.target.closest('dialog'))lastTrigger=event.target.closest('button,a,summary')||null;
  },true);
  for(const dialog of document.querySelectorAll('dialog')){
    let trigger=null,backdropStart=false;
    const outside=event=>{const r=dialog.getBoundingClientRect();return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom};
    new MutationObserver(()=>{if(dialog.open)trigger=lastTrigger;}).observe(dialog,{attributes:true,attributeFilter:['open']});
    dialog.addEventListener('pointerdown',event=>{backdropStart=event.target===dialog&&outside(event)});
    dialog.addEventListener('click',event=>{if(backdropStart&&event.target===dialog&&outside(event))dialog.close();backdropStart=false});
    dialog.addEventListener('close',()=>{
      const target=trigger;
      queueMicrotask(()=>{
        if(target?.isConnected&&!target.disabled&&(document.activeElement===document.body||dialog.contains(document.activeElement)))target.focus({preventScroll:true});
      });
    });
  }
})();
