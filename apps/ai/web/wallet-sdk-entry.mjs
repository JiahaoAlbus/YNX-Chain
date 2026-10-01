// Build input only. The deployment loads the immutable bundled output.
export {StandardWalletConnection} from '../../../packages/wallet-auth/src/standard-wallet-connection.js';
export {WalletConnectDAppConnection} from '../../../packages/wallet-auth/src/walletconnect-dapp-connection.js';
export {createHostedWalletAdapter} from '../../wallet-web/src/hosted-adapter.js';
export {toEVMAddress} from '../../../sdk/js/index.js';
export {createCentralBrowserSessionRegistry,centralBrowserClient} from '../../../packages/wallet-auth/src/central-browser-session-registry.js';
import QRCode from 'qrcode';
export const toDataURL=(value,options)=>QRCode.toDataURL(value,options);
