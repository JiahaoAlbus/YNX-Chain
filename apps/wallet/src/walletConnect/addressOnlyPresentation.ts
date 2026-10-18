import type {WalletLocale} from '../i18n/i18n';
// Display only. Exact empty methods are checked at the original review caller;
// this copy is not a permission check, remote method or authorization grant.
const rows:Readonly<Record<WalletLocale,string>>={
 en:'Share only your public address. This session cannot request signatures, transfers or sign-in.',
 'zh-Hans':'仅共享你的公开地址。此会话不能请求签名、转账或登录。',
 'zh-Hant':'僅分享你的公開地址。此工作階段不能要求簽名、轉帳或登入。',
 ja:'公開アドレスのみを共有します。このセッションは署名、送金、ログインを要求できません。',
 ko:'공개 주소만 공유합니다. 이 세션은 서명, 송금 또는 로그인을 요청할 수 없습니다.',
 es:'Solo se comparte tu dirección pública. Esta sesión no puede solicitar firmas, transferencias ni inicio de sesión.',
 fr:'Seule votre adresse publique est partagée. Cette session ne peut demander ni signature, ni transfert, ni connexion.',
 de:'Nur deine öffentliche Adresse wird geteilt. Diese Sitzung kann keine Signaturen, Überweisungen oder Anmeldung anfordern.',
 pt:'Somente seu endereço público é compartilhado. Esta sessão não pode solicitar assinaturas, transferências ou login.',
 ru:'Передаётся только ваш публичный адрес. Эта сессия не может запрашивать подписи, переводы или вход.',
 ar:'تتم مشاركة عنوانك العام فقط. لا يمكن لهذه الجلسة طلب توقيعات أو تحويلات أو تسجيل دخول.',
 id:'Hanya alamat publik Anda yang dibagikan. Sesi ini tidak dapat meminta tanda tangan, transfer, atau masuk.'
};
export function walletConnectAddressOnlyCopy(locale:WalletLocale):string{return rows[locale];}
