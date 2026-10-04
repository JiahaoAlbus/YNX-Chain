(()=>{
 'use strict';
 const introductionHashes=new Set(['','#features','#downloads','#help','#content']);
 function preserveAppRoute(){if(!introductionHashes.has(location.hash)){location.replace('/app'+location.search+location.hash);return true}return false}
 if(preserveAppRoute())return;
 addEventListener('hashchange',preserveAppRoute);
 const en=Object.fromEntries([...document.querySelectorAll('[data-copy]')].map(el=>[el.dataset.copy,el.innerHTML]));
 const zh={skip:'跳到正文',features:'功能',platforms:'平台',help:'帮助',language:'语言',open:'打开网页版',title:'理解财务。<br>看清来源。',lead:'在同一个工作区浏览带来源的记录、个人规划与金融研究。先查看公开信息；私人记录需单独授权。',explore:'了解功能',guest:'此介绍页不会请求账户、签名或交易。',caption:'真实本地访客界面。测试网与 Sandbox 来源分开；不可用数据保持未知。',tag:'证据优先',featureTitle:'了解来源，保留控制。',recordsTitle:'带来源的记录',records:'查看已授权的资产、流水与报表及其来源边界。缺失观测不等于零余额。',plansTitle:'个人规划',plans:'整理预算与报告。AI 流水上下文需要精确记录同意；浏览不会授予历史访问权限。',researchTitle:'研究与执行分离',research:'Finance、Exchange 与 Quant 是同一类别下的现有工作区。研究视图不是托管服务，也不承诺收益。',platformTag:'选择入口',platformTitle:'从网页版开始。',platformBody:'使用现有应用，或查看官方目录中的当前平台状态。这里不会将候选归档与 ZIP 文件作为安装器提供。',catalog:'官方下载目录',before:'开始之前',helpTitle:'了解产品边界。',custodyQuestion:'Finance 会托管我的资产吗？',custodyAnswer:'不会。Finance 不是银行账户或主网托管服务。测试网资产与服务商 Sandbox 记录明确分开，绝不保证收益。',accessQuestion:'浏览需要钱包吗？',accessAnswer:'不需要。应用内的标准钱包连接、私人账户授权与操作相互独立。私人服务失败不能移除标准连接。请勿在这里输入私钥或助记词。',privacyQuestion:'在哪里查看帮助与隐私信息？',privacyAnswer:'应用的支持页面提供其配置的帮助、隐私与争议链接。打开支持页面不会授权钱包。',support:'打开应用支持',footer:'不托管 · 信息带来源 · 不保证收益',ecosystem:'YNX 生态'};
 const select=document.getElementById('introduction-language');
 let language='en';try{const saved=localStorage.getItem('ynx-finance-locale');if(saved==='zh-CN'||saved==='zh-Hans')language='zh-CN'}catch{}
 function render(){const copy=language==='zh-CN'?zh:en;document.documentElement.lang=language;select.value=language;for(const el of document.querySelectorAll('[data-copy]'))el.innerHTML=copy[el.dataset.copy];document.querySelector('[data-alt="preview"]').alt=language==='zh-CN'?'真实 Finance 访客工作区，无个人账户记录':'Actual Finance guest workspace without personal account records'}
 select.addEventListener('change',()=>{language=select.value;try{localStorage.setItem('ynx-finance-locale',language)}catch{}render()});render();
})();
