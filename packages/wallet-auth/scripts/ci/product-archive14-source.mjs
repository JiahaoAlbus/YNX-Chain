// Only samepurpose archive14/legacy12 delta; no previous single/cross-family suite.
import{execFileSync}from'node:child_process';import{fileURLToPath}from'node:url';
execFileSync(process.execPath,['--test',fileURLToPath(new URL('../../test/product-archive14-source.test.mjs',import.meta.url))],{stdio:'inherit',maxBuffer:2<<20});
execFileSync(process.execPath,[fileURLToPath(new URL('../../node_modules/typescript/bin/tsc',import.meta.url)),'--strict','--noEmit','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022',fileURLToPath(new URL('../../test/product-archive14-source.types.mts',import.meta.url))],{stdio:'inherit'});
