// Only new Browser shared-family math/lifecycle/normal CLI controls. No old suite.
import {execFileSync}from'node:child_process';import{fileURLToPath}from'node:url';
execFileSync(process.execPath,['--test',fileURLToPath(new URL('../../test/browser-source-v2-common-positive.test.mjs',import.meta.url))],{stdio:'inherit',maxBuffer:2<<20});
