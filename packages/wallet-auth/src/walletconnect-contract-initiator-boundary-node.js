// Private fixed Node input check. No caller path, provider or runtime fallback.
import {createRequire} from 'node:module';
import {readFileSync,realpathSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const packageRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Installed packages may use legal same-install hoisting. A source/npm-ci SDK
// must use its own dependencies, never an unrelated ancestor installation.
const firstNodeModules=packageRoot.indexOf(`${sep}node_modules${sep}`);
const dependencyRoot=firstNodeModules<0?join(packageRoot,'node_modules'):packageRoot.slice(0,firstNodeModules)+`${sep}node_modules`;
const realDependencyRoot=join(realpathSync(firstNodeModules<0?packageRoot:packageRoot.slice(0,firstNodeModules)),'node_modules');
const pins=Object.freeze([
 ['@walletconnect/core',77008,'79c9586939e619950d63fde0cddee9d9342117142b74409f5c951947950b3a6b'],
 ['@walletconnect/sign-client',72464,'28537cb3f5e5a6178311508a5480257682e0660e4d6e306dc5c8f5a58420c3aa'],
 ['@walletconnect/utils',42882,'f790ba8ac0ac64b3653ef5a75837d45359c4813b4591fdf9081c30018ee406f0'],
]);
const fail=()=>{throw Object.assign(new Error('YNX_CONTRACT_INITIATOR_RUNTIME_INPUT_DIFFERS'),{code:'YNX_CONTRACT_INITIATOR_RUNTIME_INPUT_DIFFERS'});};
export function verifyContractInitiatorRuntime(){
 const entries=new Map();
 for(const [name,bytes,sha]of pins){
  const entry=require.resolve(name),raw=readFileSync(entry),pkg=JSON.parse(readFileSync(join(dirname(dirname(entry)),'package.json')));
  const realEntry=realpathSync(entry);
  if(!entry.startsWith(dependencyRoot+sep)||!realEntry.startsWith(realDependencyRoot+sep)||!entry.endsWith('/dist/index.cjs')||raw.length!==bytes||createHash('sha256').update(raw).digest('hex')!==sha||pkg.name!==name||pkg.version!=='2.23.10'||pkg.exports?.['.']?.default!=='./dist/index.cjs'||pkg.exports?.['.']?.import||pkg.exports?.['.']?.require)fail();
  entries.set(name,realEntry);
 }
 for(const [from,to]of [['@walletconnect/sign-client','@walletconnect/core'],['@walletconnect/sign-client','@walletconnect/utils'],['@walletconnect/core','@walletconnect/utils']])if(realpathSync(createRequire(entries.get(from)).resolve(to))!==entries.get(to))fail();
 return true;
}
