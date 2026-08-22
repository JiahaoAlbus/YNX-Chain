import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const candidatePath=fileURLToPath(new URL('../../../release/pay/ynx-chain-pay-static-5f4ce98e.caddy',import.meta.url));
const rollbackPath=fileURLToPath(new URL('../../../release/pay/ynx-chain-pay-static-rollback-p0222.caddy',import.meta.url));
const [candidate,rollback]=await Promise.all([readFile(candidatePath,'utf8'),readFile(rollbackPath,'utf8')]);
const payBlock=/pay\.ynxweb4\.com \{([\s\S]*?)\n\}\n\ntrust\.ynxweb4\.com/.exec(candidate)?.[1]??'';
for(const route of ['/invoices','/invoices/*','/split-payments','/split-payments/*','/quant-bills','/quant-bills/*']){
  if(!payBlock.split(/\s+/).includes(route))throw new Error(`Pay static matcher is missing exact SPA route ${route}`);
}
for(const required of ['handle /build-identity.json','Cache-Control "no-store, max-age=0, must-revalidate"','reverse_proxy 127.0.0.1:6430']){
  if(!payBlock.includes(required))throw new Error(`Pay Caddy contract is missing ${required}`);
}
const stripPay=value=>value.replace(/pay\.ynxweb4\.com \{[\s\S]*?\n\}\n\ntrust\.ynxweb4\.com/, 'PAY_BLOCK\n\ntrust.ynxweb4.com');
if(stripPay(candidate)!==stripPay(rollback))throw new Error('Candidate changes a non-Pay Caddy stanza');
console.log('pay-public-caddy-routes: six bare/wildcard SPA routes, identity no-store, backend fallback, and non-Pay byte equivalence pass');
