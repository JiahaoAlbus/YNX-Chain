// Original Auth R97 controls; Native/peer/effect seams are PUBLIC only.
import test from 'node:test';
import * as runtime from '../src/original-identity-peer-runtime.js';
import {runControls} from '../integration/identity-peer-r97/runtime-controls.mjs';
import {runCleanupDelta} from '../integration/identity-peer-r97/cleanup-delta.mjs';
test('original identity peer lifecycle: supplier14 PUBLIC cases',async()=>{await runControls(runtime);});
test('original identity peer cleanup: supplier6 PUBLIC cases',async()=>{await runCleanupDelta(runtime);});
