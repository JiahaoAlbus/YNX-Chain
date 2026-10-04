export const zh={
  skip:'跳至正文',navExperience:'产品体验',navJourney:'使用流程',navHelp:'帮助',open:'打开网页版',
  title:'清晰理解卡支付的每一步。',lead:'申请测试网卡，探索消费控制和完整支付生命周期。仅使用 YNX Testnet 的 YNXT，不涉及真实资金。',explore:'进入网页版探索',how:'了解使用流程',guest:'无需钱包即可浏览。仅在你选择账户操作时连接钱包。',
  artAlt:'YNX 测试网卡视觉示意，不代表已发卡',caption:'TEST 卡视觉示意。不代表已发卡，不包含支付凭证。',boundaryTitle:'测试网，不是银行卡。',boundary:'仅演练支付网络。不支持法币充值、PAN、CVV、真实商户清算或现实消费。',
  experienceEyebrow:'先了解，再连接',experienceTitle:'连接之前，也能自由探索。',experienceLead:'现有 Card 应用保留公开仪表盘、安全访客演示和申请入口，不以登录作为浏览门槛。',
  feature1Title:'卡片与控制，一目了然',feature1:'预览卡片体验、冻结控制、消费限额和商户限制。访客操作始终明确标记为 DEMO。',feature2Title:'看清每一阶段',feature2:'探索模拟授权、扣款、撤销与退款，查看活动和恢复说明，而不是无法解释的余额变化。',feature3Title:'知道什么已经核验',feature3:'钱包返回并不等于 Card 入账。YNXT 充值须经精确测试网交易和 Card API 核验，才能增加可用余额。',
  journeyEyebrow:'从探索到申请',journeyTitle:'每一步都由你决定，不自动创建卡。',
  step1Title:'以访客身份探索',step1:'浏览概览、卡片、充值、活动、控制与帮助。体验明确标记的本地演示；它们不代表账户、资金或链上交易。',
  step2Title:'选择自己的钱包',step2:'YNX Wallet 与 MetaMask 是独立选项。网页版发现已安装 Provider；未安装时提供安装指引，不打开空白自定义协议页面。',
  step3Title:'申请 TEST 测试卡',step3:'确认测试网条款，设置昵称、用途、消费限额和安全控制。激活须取得账户批准与已核验的后端回执。',
  step4Title:'核验后才能入账',step4:'ACTIVE 测试卡可请求精确的 YNXT 充值意向。你在钱包批准交易，链上确认与 Card API 接受必须先于入账。',
  statusTitle:'当前核验边界',status:'公开探索可用。本页不证明钱包批准、后端激活或 YNXT 充值。私有服务不可用时仅标记为降级，不断开标准钱包。',
  helpEyebrow:'安全与访问',helpTitle:'从网页版开始，私钥始终自己保管。',helpLead:'使用现有 Web/PWA 服务。未经平台发布核验，不在此提供独立安装包。不要向 Card 提交助记词或私钥。',privacyTitle:'介绍页保存什么',privacy:'仅在此设备保存你选择的语言偏好。本页不请求钱包账户、签名或交易，也不显示虚构的用户余额和活动。',recoverTitle:'在应用中恢复',recover:'使用同一钱包返回已绑定的申请。交易结果待定或未知时应先核验，不要盲目重发。',footer:'不具备现实支付能力。本次发布不提供未来受监管的真实卡服务。',
};
export function applyLanguage(document,storage,language){
  const chinese=language==='zh-CN';
  for(const element of document.querySelectorAll('[data-copy]')){
    if(!element.dataset.english)element.dataset.english=element.textContent;
    element.textContent=chinese?zh[element.dataset.copy]:element.dataset.english;
  }
  for(const element of document.querySelectorAll('[data-alt]')){
    if(!element.dataset.englishAlt)element.dataset.englishAlt=element.alt;
    element.alt=chinese?zh[element.dataset.alt]:element.dataset.englishAlt;
  }
  document.documentElement.lang=chinese?'zh-CN':'en';
  document.title=chinese?'YNX Card | 探索测试网':'YNX Card | Explore Testnet';
  const button=document.getElementById('language');
  button.textContent=chinese?'English':'中文';button.lang=chinese?'en':'zh-CN';
  button.setAttribute('aria-label',chinese?'切换至英文':'Switch to Chinese');
  try{storage?.setItem('ynx-card.secure.v1.locale',chinese?'zh-CN':'en')}catch{}
}
if(typeof document!=='undefined'){
  let storage,language='en';try{storage=window.localStorage;language=storage.getItem('ynx-card.secure.v1.locale')==='zh-CN'?'zh-CN':'en'}catch{}
  applyLanguage(document,null,language);
  document.getElementById('language').addEventListener('click',()=>{language=language==='en'?'zh-CN':'en';applyLanguage(document,storage,language)});
}
