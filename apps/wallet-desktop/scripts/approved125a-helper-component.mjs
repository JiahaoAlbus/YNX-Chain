import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual,types} from 'node:util';
import path from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const bytes=readFileSync(new URL('./approved125a-helper-component-data.json',import.meta.url));
if(sha(bytes)!=='727745885d9e61e4f05405ec6e2bb8730750bec4a3b155cf287e33f8e0cbeac2')fail('APPROVED125A_PROFILE_DIFFERS');
const profile=JSON.parse(bytes.toString('utf8'));
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};freeze(profile);
export const APPROVED125A_HELPER_SOURCE_TUPLE=profile.tuple;
const same=(a,b,code)=>{if(!isDeepStrictEqual(a,b))fail(code);};
function pinned(b,p,code){if(!Buffer.isBuffer(b)||b.length!==p.bytes||sha(b)!==p.sha256)fail(code);return b;}
function tuple(input){if(!input||types.isProxy(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))fail('APPROVED125A_SOURCE_TUPLE_DIFFERS');const keys=Reflect.ownKeys(input),expected=Object.keys(profile.tuple);if(keys.length!==expected.length||keys.some(k=>typeof k!=='string'||!expected.includes(k)))fail('APPROVED125A_SOURCE_TUPLE_DIFFERS');for(const k of expected){const d=Object.getOwnPropertyDescriptor(input,k);if(!d||!Object.hasOwn(d,'value')||!d.enumerable||d.value!==profile.tuple[k])fail('APPROVED125A_SOURCE_TUPLE_DIFFERS');}}
/** Finite approved helper-only executed-component reader. readSource reads the
 * exact ORIGINAL compile/producer Git identities; readPackedAsset reads actual
 * ASAR/canonical package bytes. Callbacks transport bytes, confer no authority.
 * Does not accept Node bytes, classify c6 as C227, execute helper, install a
 * service, replace old paired reader or promote current runtime/Root/Source.
 */
export function verifyApproved125aHelperComponent(options){
 const names=['recordBytes','originalAttemptBytes','expectedHelperSourceTuple','readSource','readPackedAsset'];
 if(!options||types.isProxy(options)||![Object.prototype,null].includes(Object.getPrototypeOf(options))||Reflect.ownKeys(options).length!==names.length)fail('APPROVED125A_OPTIONS_INVALID');
 const values={};for(const key of Reflect.ownKeys(options)){if(!names.includes(key))fail('APPROVED125A_OPTIONS_INVALID');const d=Object.getOwnPropertyDescriptor(options,key);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)fail('APPROVED125A_OPTIONS_INVALID');values[key]=d.value;}
 const {recordBytes,originalAttemptBytes,expectedHelperSourceTuple,readSource,readPackedAsset}=values;
 tuple(expectedHelperSourceTuple);
 if(typeof readSource!=='function'||typeof readPackedAsset!=='function')fail('APPROVED125A_READERS_REQUIRED');
 pinned(recordBytes,{bytes:profile.tuple.recordBytes,sha256:profile.tuple.recordSHA256},'APPROVED125A_RECORD_DIFFERS');
 pinned(originalAttemptBytes,profile.originalAttemptPin,'APPROVED125A_ORIGINAL_ATTEMPT_DIFFERS');
 const record=JSON.parse(recordBytes.toString('utf8')),attempt=JSON.parse(originalAttemptBytes.toString('utf8'));
 const continuation=record.normalPortableImageRole?.postBuildContinuation,helper=record.helperBuild;
 same(helper,profile.helperBuild,'APPROVED125A_HELPER_LEDGER_DIFFERS');
 same(continuation?.compileSource,profile.compileSource,'APPROVED125A_COMPILE_SOURCE_DIFFERS');
 same(continuation?.recordProducer,profile.recordProducer,'APPROVED125A_PRODUCER_SOURCE_DIFFERS');
 same(continuation?.originalFailure,profile.originalFailure,'APPROVED125A_FIRST_FAILURE_DIFFERS');
 if(attempt.kind!=='PORTABLE_QA_ACTUAL_EXECUTION_ATTEMPT/v1'||attempt.failed!==true||attempt.recordWritten!==false||attempt.failureCode!=='PORTABLE_QA_CLOSED_RECORD'||attempt.ledger.length!==62||attempt.ledger.some(x=>x.exit!==0))fail('APPROVED125A_ORIGINAL_EXECUTION_DIFFERS');
 same(profile.helperLedgerIndices.map(i=>attempt.ledger[i]),profile.helperLedger,'APPROVED125A_HELPER_EXECUTION_DIFFERS');
 if(helper.executed!==true||helper.readbackOnly!==false||helper.commandsKind!=='executed-normal-build'||helper.commands.length!==1||helper.exitCodes.length!==1||helper.exitCodes[0]!==0)fail('APPROVED125A_HELPER_NOT_EXECUTED');
 for(const key of ['serviceRegistered','installed','nativeQualified','appSigned'])if(helper[key]!==false)fail('APPROVED125A_UNSUPPORTED_QUALIFICATION');
 const command=helper.commands[0],execution=attempt.ledger[60],scan=attempt.ledger[61];
 same({tool:execution.tool,argv:execution.argv},command,'APPROVED125A_RECIPE_DIFFERS');
 const units=command.argv.filter(a=>a.startsWith(profile.sourceRoot+'/')&&/\.(?:mm|cpp|cc|c)$/.test(a)).map(a=>path.posix.relative(profile.sourceRoot,a));
 same(units,profile.translationUnits,'APPROVED125A_TRANSLATION_UNITS_DIFFERS');if(units.length!==13)fail('APPROVED125A_HELPER13_REQUIRED');
 same({tool:scan.tool,argv:scan.argv,exit:scan.exit,stdoutSHA256:scan.stdoutSHA256,ownedUndefined:[]},helper.ownedUndefinedScan,'APPROVED125A_OWNED_UNDEFINED_DIFFERS');
 for(const row of helper.inputFiles)pinned(readSource(row.relative,profile.tuple.compileCommit),row,'APPROVED125A_COMPILE_SOURCE_PIN_DIFFERS');
 for(const row of continuation.recordProducer.sourceFiles)pinned(readSource(row.relative,profile.tuple.producerCommit),row,'APPROVED125A_PRODUCER_SOURCE_PIN_DIFFERS');
 pinned(readPackedAsset(helper.packagedOutput),helper.output,'APPROVED125A_PACKAGED_HELPER_DIFFERS');
 pinned(readPackedAsset(helper.plist.relative),helper.plist,'APPROVED125A_PACKAGED_PLIST_DIFFERS');
 return freeze({kind:'YNX_APPROVED125A_HELPER_COMPONENT_VERIFIED/v1',sourceTuple:profile.tuple,helper:{output:helper.output,packagedOutput:helper.packagedOutput,translationUnits:13,sourceInputs:helper.inputFiles.length,producerSourceInputs:continuation.recordProducer.sourceFiles.length,executedOriginalHelper:true,bytesVerified:true,sourceBytesVerified:true,runtimeProtocolSourcePins:profile.protocolSourceFiles},originalAttempt:{failed:true,failureCode:'PORTABLE_QA_CLOSED_RECORD',recordWritten:false,commands:62,helperCommand:60,helperScan:61},nodeComponentVerified:false,pairedComponentVerified:false,helperExecutedNow:false,serviceRegistered:false,installed:false,nativeQualified:false,appSigned:false,RootAdmission:false,SourceAdmission:false,bundleMustBeVerifiedSeparately:true});
}
