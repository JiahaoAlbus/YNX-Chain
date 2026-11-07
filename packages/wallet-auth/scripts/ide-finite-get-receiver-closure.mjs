// Fixed build-time closure only; no Root/current or server activation.
import {generateAuthRuntimeClosure} from './auth-runtime-closure.mjs';
import {fileURLToPath} from 'node:url';
export const IDE_FINITE_GET_RECEIVER_ENTRY='native/original-ide-finite-get-receiver-originals.mjs';
export function generateIDEFiniteGETReceiverClosureDATA(){
 if(arguments.length)throw Error('IDE_FINITE_GET_CLOSURE_ARGUMENTS_FORBIDDEN');
 return generateAuthRuntimeClosure(fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,''),{entries:[IDE_FINITE_GET_RECEIVER_ENTRY]});
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv.length!==2)throw Error('IDE_FINITE_GET_CLOSURE_ARGUMENTS_FORBIDDEN');
 process.stdout.write(JSON.stringify(generateIDEFiniteGETReceiverClosureDATA())+'\n');
}
