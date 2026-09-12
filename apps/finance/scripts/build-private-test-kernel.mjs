// Build-only adapter: exports the official Wallet test protocol implementation,
// never a Finance signature/verification implementation. No key is an input.
import {resolve,relative,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../web/package.json',import.meta.url));
const {build}=require('esbuild');
const source=process.env.YNX_WALLET_SDK_SOURCE;
if(!source)throw new Error('Set YNX_WALLET_SDK_SOURCE to the exact official Wallet worktree');
const exact='9840ef871165eb523c4e7a3d48964dd25f8dee8e';
execFileSync('git',['cat-file','-e',exact+'^{commit}'],{cwd:source});
// A sibling owner may have new uncommitted work. Load every Wallet source module
// from the immutable git object, never from that owner's mutable file contents.
const frozen={name:'exact-wallet-source',setup(build){build.onLoad({filter:/\.js$/},args=>{
  const path=relative(source,args.path);if(!path.startsWith('packages/wallet-auth/src/'))return;
  return {contents:execFileSync('git',['show',exact+':'+path],{cwd:source,encoding:'utf8',maxBuffer:10<<20}),loader:'js',resolveDir:dirname(args.path)};
});}};
await build({stdin:{contents:'export { ProductSessionGatewayHttpHandler, signProductSessionApproval, createProductSessionReturnURL, canonicalJSON } from "./src/index.js";',resolveDir:resolve(source,'packages/wallet-auth'),sourcefile:'finance-offline-test-kernel-entry.mjs'},plugins:[frozen],outfile:fileURLToPath(new URL('../tests/fixtures/wallet-test-kernel-9840ef87.mjs',import.meta.url)),bundle:true,format:'esm',platform:'node',target:'node22',minify:true,legalComments:'inline',banner:{js:'// OFFLINE TEST ONLY — Wallet source '+exact+'. No Finance protocol implementation.'}});
