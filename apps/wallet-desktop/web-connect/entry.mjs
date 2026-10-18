import {createWalletAddressConnection} from '@ynx-chain/wallet-auth/walletconnect-dapp-connection';
import QRCode from 'qrcode';
import {mountWalletAddressConnectionPage} from '../src/walletconnect-address-page.mjs';

// Build against the formally supplied original SDK address-only profile. No
// internal-source fallback, synthetic URI or arbitrary origin/Project ID.
try{
 mountWalletAddressConnectionPage({document,origin:location.origin,createConnection:()=>createWalletAddressConnection(),encodeQR:uri=>QRCode.toDataURL(uri,{width:280,margin:2,errorCorrectionLevel:'M'})});
}catch{
 document.getElementById('status').textContent='Connection is unavailable on this origin or build. / 此来源或版本无法连接。';
}
