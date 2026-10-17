import {resolveNativeModule} from './nativeModuleResolver.js';
import type {ReceivePNGResult} from '../../src/state/receivePNG';
type PublicPNGModule={savePng(base64:string,filename:string):Promise<ReceivePNGResult>};
function native():PublicPNGModule|null{const value=resolveNativeModule('YnxReceivePng');return value&&typeof (value as Partial<PublicPNGModule>).savePng==='function'?value as PublicPNGModule:null}
export function receivePNGAvailable():boolean{try{return typeof native()?.savePng==='function'}catch{return false}}
export async function saveReceivePNG(base64:string,filename:string):Promise<ReceivePNGResult>{const module=native();if(!module)throw Error('RECEIVE_PNG_UNAVAILABLE');return module.savePng(base64,filename)}
