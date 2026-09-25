import {accessSync,constants} from 'node:fs';
import {isAbsolute} from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';

// Service-only preflight. No network calls, Wallet requests or private values logged.
try{
  const env=process.env,[major,minor]=process.versions.node.split('.').map(Number);
  if(major<22||(major===22&&minor<18)||typeof DatabaseSync!=='function'||typeof backup!=='function')throw Error();
  if(!/^[a-f0-9]{40}$/.test(env.YNX_CARD_SOURCE_COMMIT??''))throw Error();
  if(env.YNX_CARD_HOST!=='127.0.0.1'||env.YNX_CARD_PORT!=='18740'||env.YNX_CARD_DATA_DIR!=='/var/lib/ynx-card')throw Error();
  if(env.YNX_CARD_ALLOWED_ORIGIN!=='https://card.ynxweb4.com')throw Error();
  const key=Buffer.from(env.YNX_CARD_STATE_KEY_BASE64??'','base64');
  const validKey=key.length===32&&key.toString('base64')===env.YNX_CARD_STATE_KEY_BASE64;key.fill(0);if(!validKey)throw Error();
  const adapter=env.YNX_CARD_AUTH_ADAPTER_MODULE;if(!adapter||!isAbsolute(adapter))throw Error();accessSync(adapter,constants.R_OK);
  const rpc=new URL(env.YNX_CARD_CORE_RPC_URL??'');
  if(rpc.protocol!=='https:'||rpc.username||rpc.password||rpc.search||rpc.hash)throw Error();
  if(!/^0x[0-9a-fA-F]{40}$/.test(env.YNX_CARD_TESTNET_FUNDING_ADDRESS??'')||/^0x0{40}$/i.test(env.YNX_CARD_TESTNET_FUNDING_ADDRESS))throw Error();
  const confirmations=Number(env.YNX_CARD_MIN_CONFIRMATIONS);if(!Number.isSafeInteger(confirmations)||confirmations<2)throw Error();
  console.log('Card service preflight passed; runtime authentication and funding are not yet proven.');
}catch{
  console.error('Card service preflight failed: require supported Node, exact private bind/source, accepted authentication adapter, storage key and explicit Testnet funding configuration.');
  process.exitCode=1;
}
