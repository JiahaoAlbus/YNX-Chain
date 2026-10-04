import type {Locale} from './i18n';

export type GuestAuthorizationControls={frozen:boolean;online:boolean};
const codes=['GUEST_DEMO_DECLINED_CARD_FROZEN','GUEST_DEMO_DECLINED_ONLINE_DISABLED'] as const;
type DecisionCode=typeof codes[number];
const copy:Record<Locale,readonly[string,string]>={
 en:['DEMO declined: the simulated card is frozen. No authorization or payment was created.','DEMO declined: online merchant simulation is disabled. No authorization or payment was created.'],
 'zh-CN':['演示已拒绝：模拟卡已冻结。未创建授权或支付。','演示已拒绝：在线商户模拟已关闭。未创建授权或支付。'],
 'zh-TW':['示範已拒絕：模擬卡已凍結。未建立授權或付款。','示範已拒絕：線上商戶模擬已關閉。未建立授權或付款。'],
 ja:['デモ拒否：模擬カードは凍結中です。承認や支払いは作成されていません。','デモ拒否：オンライン加盟店の模擬処理は無効です。承認や支払いは作成されていません。'],
 ko:['데모 거절: 모의 카드가 동결되었습니다. 승인이나 결제가 생성되지 않았습니다.','데모 거절: 온라인 가맹점 시뮬레이션이 꺼져 있습니다. 승인이나 결제가 생성되지 않았습니다.'],
 es:['DEMO rechazada: la tarjeta simulada está congelada. No se creó autorización ni pago.','DEMO rechazada: la simulación de comercios en línea está desactivada. No se creó autorización ni pago.'],
 fr:['DEMO refusée : la carte simulée est gelée. Aucune autorisation ni aucun paiement créé.','DEMO refusée : la simulation de commerçants en ligne est désactivée. Aucune autorisation ni aucun paiement créé.'],
 de:['DEMO abgelehnt: Die simulierte Karte ist gesperrt. Keine Autorisierung oder Zahlung erstellt.','DEMO abgelehnt: Die Online-Händlersimulation ist deaktiviert. Keine Autorisierung oder Zahlung erstellt.'],
 pt:['DEMO recusada: o cartão simulado está congelado. Nenhuma autorização ou pagamento foi criado.','DEMO recusada: a simulação de comerciantes online está desativada. Nenhuma autorização ou pagamento foi criado.'],
 ru:['DEMO отклонена: симулированная карта заморожена. Авторизация и платёж не созданы.','DEMO отклонена: симуляция онлайн-продавца отключена. Авторизация и платёж не созданы.'],
 ar:['رُفضت المحاكاة: البطاقة التجريبية مجمدة. لم يُنشأ تفويض أو دفع.','رُفضت المحاكاة: محاكاة التاجر عبر الإنترنت معطلة. لم يُنشأ تفويض أو دفع.'],
 id:['DEMO ditolak: kartu simulasi dibekukan. Tidak ada otorisasi atau pembayaran yang dibuat.','DEMO ditolak: simulasi pedagang online dinonaktifkan. Tidak ada otorisasi atau pembayaran yang dibuat.'],
};
export function guestAuthorizationDetail(label:string,detail:string,controls:GuestAuthorizationControls):string{
 if(label!=='Simulate authorization'&&label!=='Authorization simulation')return detail;
 if(controls.frozen)return codes[0];
 if(!controls.online)return codes[1];
 return detail;
}
export function isGuestAuthorizationDecision(label:string,detail:string):boolean{
 return (label==='Simulate authorization'||label==='Authorization simulation')&&codes.includes(detail as DecisionCode);
}
export function guestDecisionText(locale:Locale,detail:string):string|null{
 const index=codes.indexOf(detail as DecisionCode);
 return index<0?null:copy[locale][index]!;
}
