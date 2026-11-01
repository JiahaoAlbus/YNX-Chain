// New combined-family controls only. Never reruns the individual-family suites.
import{execFileSync}from'node:child_process';import{fileURLToPath}from'node:url';
execFileSync(process.execPath,['--test',fileURLToPath(new URL('../../test/product-browser-source-union.test.mjs',import.meta.url))],{stdio:'inherit',maxBuffer:2<<20});
execFileSync(process.execPath,[fileURLToPath(new URL('../../node_modules/typescript/bin/tsc',import.meta.url)),'--strict','--noEmit','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022',fileURLToPath(new URL('../../test/product-browser-source-union.types.mts',import.meta.url))],{stdio:'inherit'});
