import {readFile,mkdtemp,symlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// One same-copy R9 input for Commerce builds. Legacy npm packages/locks stay intact.
const vendor=resolve(dirname(fileURLToPath(import.meta.url)),'../vendor');
export const CURRENT_WALLET_SDK=Object.freeze({
    archive:'ynx-chain-wallet-auth-1.2.0-r9.tgz',bytes:634294,
    sha256:'1306a7d28dbdf2335868cbe25880fa601519ff10ccc9de38331d7701fed91bae',
    sourceHead:'2689bece12fddd991c2ecd7a024f6aa4e8b1afbd',
    sourceTree:'4b0af59f43c1283054c3d33af1d4c84bd36ecd2a',
});

export async function prepareCurrentWalletSDK({dependencies,archive=join(vendor,CURRENT_WALLET_SDK.archive)}={}) {
    const bytes=await readFile(archive);
    if(bytes.length!==CURRENT_WALLET_SDK.bytes || createHash('sha256').update(bytes).digest('hex')!==CURRENT_WALLET_SDK.sha256)
        throw new Error('Commerce Wallet SDK input does not match current R9');
    const stage=await mkdtemp(join(tmpdir(),'ynx-commerce-wallet-r9-'));
    // Extraction only follows the exact supplied, hash-verified official archive.
    execFileSync('tar',['-xzf',archive,'-C',stage]);
    const root=join(stage,'package'),manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
    if(manifest.name!=='@ynx-chain/wallet-auth'||manifest.version!=='1.2.0')throw new Error('Unexpected Commerce SDK package identity');
    if(dependencies)await symlink(resolve(dependencies),join(stage,'node_modules'),'dir');
    const entry=subpath=>{
        const exported=manifest.exports[subpath];
        const relative=typeof exported==='string'?exported:exported?.import??exported?.default;
        if(typeof relative!=='string'||!relative.startsWith('./')||relative.split('/').includes('..'))throw new Error('Unexported Commerce Wallet SDK entry: '+subpath);
        return resolve(root,relative);
    };
    const plugin={name:'commerce-current-wallet-sdk',setup(build){
        build.onResolve({filter:/^@ynx-chain\/wallet-auth(?:\/.*)?$/},args=>({
            path:entry(args.path==='@ynx-chain/wallet-auth'?'.':'./'+args.path.slice('@ynx-chain/wallet-auth/'.length)),
        }));
    }};
    // Native owners select this official constructor, never the browser factory.
    return Object.freeze({root,stage,entry,buildOptions:{plugins:[plugin]},provenance:CURRENT_WALLET_SDK});
}
