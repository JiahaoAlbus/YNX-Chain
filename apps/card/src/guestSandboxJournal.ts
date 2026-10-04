import type {Locale} from './i18n';
import {isGuestAuthorizationDecision} from './guestAuthorizationDecision';
export {guestAuthorizationDetail,guestDecisionText} from './guestAuthorizationDecision';

export const GUEST_SANDBOX_KEY='ynx.card.guest-sandbox.v1';
const details:Readonly<Record<string,string>>={
 'Guest demo started':'Local sandbox workspace opened',
 'Simulate authorization':'Authorization decision prepared locally',
 'Simulate capture':'Capture workflow prepared locally',
 'Simulate reversal':'Reversal workflow prepared locally',
 'Simulate refund':'Refund workflow prepared locally',
 'Authorization simulation':'Local authorization workflow completed',
 'Online control changed':'Online simulation setting changed',
 'International control changed':'International simulation setting changed',
 'Simulated card frozen':'Local freeze applied',
 'Simulated card unfrozen':'Local freeze removed',
};
export type GuestDemoEvent={id:number;label:string;detail:string};
export type GuestSandboxSnapshot={schemaVersion:'ynx.card.guest-sandbox.v1';simulation:true;controls:{frozen:boolean;online:boolean;international:boolean};events:readonly GuestDemoEvent[]};
export type GuestSandboxStorage={getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void};
type Status='local'|'temporary'|'preserved';
function empty():GuestSandboxSnapshot{return {schemaVersion:'ynx.card.guest-sandbox.v1',simulation:true,controls:{frozen:false,online:true,international:false},events:[]}}
function keys(value:object,expected:readonly string[]):boolean{return Object.keys(value).sort().join('|')===[...expected].sort().join('|')}
export function validGuestSandbox(value:unknown):value is GuestSandboxSnapshot{
 if(!value||typeof value!=='object'||Array.isArray(value)||!keys(value,['schemaVersion','simulation','controls','events']))return false;
 const s=value as GuestSandboxSnapshot,c=s.controls;
 if(s.schemaVersion!==GUEST_SANDBOX_KEY||s.simulation!==true||!c||typeof c!=='object'||!keys(c,['frozen','online','international'])||[c.frozen,c.online,c.international].some(v=>typeof v!=='boolean')||!Array.isArray(s.events)||s.events.length>100)return false;
 const ids=new Set<number>();
 for(const event of s.events){
  if(!event||typeof event!=='object'||!keys(event,['id','label','detail'])||!Number.isSafeInteger(event.id)||event.id<1||ids.has(event.id)||!Object.hasOwn(details,event.label)||(event.detail!==details[event.label]&&!isGuestAuthorizationDecision(event.label,event.detail)))return false;
  ids.add(event.id);
 }
 return true;
}
/** Anonymous DEMO-only storage. Never a wallet identity, private account or ledger. */
export class GuestSandboxJournal{
 snapshot:GuestSandboxSnapshot=empty();
 status:Status='temporary';
 private baseline:string|null=null;
 private writable=false;
 constructor(private readonly storage?:GuestSandboxStorage){
  if(!storage)return;
  try{
   this.baseline=storage.getItem(GUEST_SANDBOX_KEY);
   if(this.baseline!==null){
    if(this.baseline.length>65_536)throw Error('invalid');
    const value:unknown=JSON.parse(this.baseline);
    if(!validGuestSandbox(value))throw Error('invalid');
    this.snapshot=value;
   }
   this.writable=true;this.status='local';
  }catch{this.status='preserved'}
 }
 save(next:GuestSandboxSnapshot):boolean{
  if(!this.storage||!this.writable||!validGuestSandbox(next)){if(this.storage)this.status='preserved';return false}
  try{
   if(this.storage.getItem(GUEST_SANDBOX_KEY)!==this.baseline)throw Error('conflict');
   const encoded=JSON.stringify(next);
   this.storage.setItem(GUEST_SANDBOX_KEY,encoded);
   if(this.storage.getItem(GUEST_SANDBOX_KEY)!==encoded)throw Error('write unconfirmed');
   this.baseline=encoded;this.snapshot=next;this.status='local';return true;
  }catch{this.writable=false;this.status='preserved';return false}
 }
}
export function webGuestSandboxStorage():GuestSandboxStorage|undefined{
 try{return typeof window==='undefined'?undefined:window.localStorage}catch{return undefined}
}
const copy:Record<Locale,readonly[string,string,string]>={
 en:['DEMO history and controls: this browser only. Not an account or on-chain history.','DEMO changes are temporary and will not survive reopening this page.','Existing DEMO storage was preserved. New changes could not be saved; reload to review the saved history.'],
 'zh-CN':['演示历史与控制项仅保存在此浏览器，不是账户或链上记录。','演示更改为临时状态，重新打开页面后不会保留。','原演示存储已保留，新更改未能保存；重新加载可查看已保存历史。'],
 'zh-TW':['示範歷史與控制項僅儲存在此瀏覽器，不是帳戶或鏈上紀錄。','示範變更是暫時狀態，重新開啟頁面後不會保留。','原示範儲存已保留，新變更未能儲存；重新載入可查看已儲存歷史。'],
 ja:['デモ履歴と設定はこのブラウザー内のみです。アカウントやチェーン履歴ではありません。','デモ変更は一時的です。ページを開き直すと残りません。','既存のデモ保存は保持しました。新しい変更は保存できません。再読み込みで保存済み履歴を確認してください。'],
 ko:['데모 기록과 설정은 이 브라우저에만 저장됩니다. 계정이나 체인 기록이 아닙니다.','데모 변경은 임시 상태이며 페이지를 다시 열면 유지되지 않습니다.','기존 데모 저장소는 보존되었습니다. 새 변경은 저장되지 않았습니다. 새로 고침하여 저장된 기록을 확인하세요.'],
 es:['Historial y controles DEMO: solo este navegador. No son una cuenta ni historial de cadena.','Los cambios DEMO son temporales y no persisten al reabrir la página.','Se conservó el almacenamiento DEMO existente. Los cambios nuevos no se guardaron; recarga para ver el historial guardado.'],
 fr:['Historique et réglages DEMO : ce navigateur uniquement, pas un compte ni un historique de chaîne.','Les changements DEMO sont temporaires et disparaîtront à la réouverture.','Le stockage DEMO existant est conservé. Les nouvelles modifications ne sont pas enregistrées ; rechargez pour consulter l’historique sauvegardé.'],
 de:['DEMO-Verlauf und Einstellungen: nur in diesem Browser, kein Konto oder Blockchain-Verlauf.','DEMO-Änderungen sind vorübergehend und bleiben beim erneuten Öffnen nicht erhalten.','Vorhandener DEMO-Speicher bleibt erhalten. Neue Änderungen wurden nicht gespeichert; zum gespeicherten Verlauf neu laden.'],
 pt:['Histórico e controles DEMO: apenas neste navegador, não uma conta ou histórico da cadeia.','As alterações DEMO são temporárias e não persistem ao reabrir a página.','O armazenamento DEMO existente foi preservado. Novas alterações não foram salvas; recarregue para ver o histórico salvo.'],
 ru:['История и настройки DEMO только в этом браузере, не аккаунт и не история блокчейна.','Изменения DEMO временные и исчезнут при повторном открытии страницы.','Существующее хранилище DEMO сохранено. Новые изменения не записаны; обновите страницу для просмотра сохранённой истории.'],
 ar:['سجل DEMO والإعدادات في هذا المتصفح فقط، وليست حساباً أو سجلاً على الشبكة.','تغييرات DEMO مؤقتة ولن تبقى عند إعادة فتح الصفحة.','حُفظ التخزين السابق لـ DEMO. لم تُحفظ التغييرات الجديدة؛ أعد تحميل الصفحة لعرض السجل المحفوظ.'],
 id:['Riwayat dan kontrol DEMO hanya di browser ini, bukan akun atau riwayat blockchain.','Perubahan DEMO bersifat sementara dan hilang saat halaman dibuka kembali.','Penyimpanan DEMO lama dipertahankan. Perubahan baru tidak tersimpan; muat ulang untuk melihat riwayat tersimpan.'],
};
export function guestSandboxStorageText(locale:Locale,status:Status):string{return copy[locale][status==='local'?0:status==='temporary'?1:2]}
