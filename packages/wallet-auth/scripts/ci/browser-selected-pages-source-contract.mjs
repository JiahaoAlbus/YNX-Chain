// New Browser contract DATA controls/types only, never Native/GUI/Root work.
import {execFileSync}from'node:child_process';import {fileURLToPath}from'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
execFileSync(process.execPath,['--test',fileURLToPath(new URL('../../test/browser-selected-pages-source-contract.test.mjs',import.meta.url)),fileURLToPath(new URL('../../test/browser-selected-pages-source-routing.test.mjs',import.meta.url))],{cwd:root,stdio:'inherit'});
execFileSync(process.execPath,[fileURLToPath(new URL('../../node_modules/typescript/bin/tsc',import.meta.url)),'--noEmit','--strict','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','test/browser-selected-pages-source-contract.types.mts'],{cwd:root,stdio:'inherit'});
