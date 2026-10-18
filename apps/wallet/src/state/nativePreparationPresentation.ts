import type {NativePreparationReview} from '../chain/nativeTransferOutbox';

export type NativePreparationPresentation=Readonly<{
  state:'binding-failed'|'storage-unconfirmed'|'preparation-unconfirmed'|'original-stored';
  notice:string|null;
  hideResend:boolean;
  sendAuthorized:false;
  newSignatureAuthorized:false;
}>;

/** Display only. Keep the existing lease, biometric and original-byte dispatch
 * checks. Neither a green label nor a preparation review grants an effect. */
export function nativePreparationPresentation(input:Readonly<{
  account:string;hash:string;localRetention:boolean;review:NativePreparationReview|null;
}>,locale:string):NativePreparationPresentation{
  const zh=locale.startsWith('zh'),review=input.review;
  const same=review?.account===input.account&&review.hash===input.hash;
  if(same&&review?.bindingFailed===true){
    const unsaved=input.localRetention||review.storageConfirmed!==true;
    const notice=zh?'原交易已签名，但后续绑定未完成。原件已保留；不要重发，也不要另签替代交易。':'The original transaction was signed, but its required binding did not complete. Keep the original. Do not resend or sign a replacement.';
    return Object.freeze({state:'binding-failed',notice:notice+(unsaved?(zh?' 结果尚未确认保存，请保持 Wallet 运行；重新打开此页仅尝试本地保存。':' Durable saving is unconfirmed. Keep Wallet running; reopening this page only attempts a local save.') :''),hideResend:true,sendAuthorized:false,newSignatureAuthorized:false});
  }
  if(input.localRetention||same&&review?.storageConfirmed===false)return Object.freeze({state:'storage-unconfirmed',notice:zh?
    '原操作结果尚未确认保存。请保持 Wallet 运行；重新打开此转账页仅尝试本地保存，不会重新签名或发送。':
    'Durable saving of the original result is unconfirmed. Keep Wallet running. Reopening this transfer page only attempts a local save; it does not sign or send again.',hideResend:true,sendAuthorized:false,newSignatureAuthorized:false});
  if(!same||review?.bindingFailed!==false||review?.storageConfirmed!==true)return Object.freeze({state:'preparation-unconfirmed',notice:zh?
    '原签名的准备状态尚未确认。保留此原件，不要重发或另签替代交易。':
    'The original signing preparation is unconfirmed. Keep this original. Do not resend or sign a replacement.',hideResend:true,sendAuthorized:false,newSignatureAuthorized:false});
  return Object.freeze({state:'original-stored',notice:null,hideResend:false,sendAuthorized:false,newSignatureAuthorized:false});
}
