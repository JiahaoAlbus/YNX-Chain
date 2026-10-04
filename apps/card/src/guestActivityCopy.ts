import type {Locale} from './i18n';
const copy:Record<Locale,readonly[string,string]>={
 en:['Viewing {shown} of {total} local DEMO events','Show more DEMO events'],
 'zh-CN':['正在查看 {total} 条本地演示事件中的 {shown} 条','查看更多演示事件'],
 'zh-TW':['正在查看 {total} 筆本地示範事件中的 {shown} 筆','查看更多示範事件'],
 ja:['ローカルデモ {total} 件中 {shown} 件を表示','デモ履歴をさらに表示'],
 ko:['로컬 데모 {total}개 중 {shown}개 표시','데모 기록 더 보기'],
 es:['Mostrando {shown} de {total} eventos DEMO locales','Mostrar más eventos DEMO'],
 fr:['Affichage de {shown} sur {total} événements DEMO locaux','Voir plus d’événements DEMO'],
 de:['{shown} von {total} lokalen DEMO-Ereignissen angezeigt','Weitere DEMO-Ereignisse anzeigen'],
 pt:['Exibindo {shown} de {total} eventos DEMO locais','Mostrar mais eventos DEMO'],
 ru:['Показано {shown} из {total} локальных событий DEMO','Показать ещё события DEMO'],
 ar:['عرض {shown} من {total} أحداث DEMO المحلية','عرض المزيد من أحداث DEMO'],
 id:['Menampilkan {shown} dari {total} peristiwa DEMO lokal','Tampilkan lebih banyak peristiwa DEMO'],
};
export function guestActivityCount(locale:Locale,shown:number,total:number):string{return copy[locale][0].replace('{shown}',String(shown)).replace('{total}',String(total))}
export function guestActivityMore(locale:Locale):string{return copy[locale][1]}
