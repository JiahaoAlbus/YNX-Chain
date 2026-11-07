// Read-only archive gate, following Auth's normal-common-image nm -g/-m gate.
// A successful result is neither final Native linking nor Source qualification.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const sha=raw=>createHash('sha256').update(raw).digest('hex');
const requireValue=(value,message)=>{if(!value)throw Error(message);};
const identifier=/^[A-Za-z_][A-Za-z0-9_]*$/;
const sort=values=>[...new Set(values)].sort();
const linkHeaders=['private_client_v1.h','private_client_startup_v1.h'];
const mandatoryCoreHeaders=['tx_batch.h','account_initial.h'];
export const linkRequiredSymbols=Object.freeze([
  'ynx_link_private_client_registration_from_borrow_v1',
  'ynx_link_private_client_registration_borrow_current_v1',
  'ynx_link_private_client_registration_borrow_release_v1',
  'ynx_link_private_client_capture_v1','ynx_link_private_client_current_local_v1',
  'ynx_link_private_client_current_source_v1','ynx_link_private_client_recheck_v1',
  'ynx_link_private_client_call_v1','ynx_link_private_client_error_v1',
  'ynx_link_private_client_packet_free_v1','ynx_link_private_client_retire_v1',
  'ynx_link_private_client_join_v1','ynx_link_private_client_close_v1','ynx_link_private_client_free_v1',
  ...['open','adopt_source','retire','join','close','closed','free','error'].map(name=>'ynx_link_pay_native_startup_'+name+'_v1'),
]);
export const productTransportRequiredSymbols=Object.freeze([
  'open','request','response_diagnostics','release_response','cancel','retire','join','close',
].map(name=>'ynx_product_pay_transport_'+name+'_v1'));

function bound(entry){
  requireValue(entry&&path.isAbsolute(entry.path??'')&&Number.isSafeInteger(entry.bytes)&&entry.bytes>0&&entry.bytes<=512*1024*1024&&/^[a-f0-9]{64}$/.test(entry.sha256??''),'exact bounded input identity required');
  const stat=fs.lstatSync(entry.path);
  requireValue(stat.isFile()&&!stat.isSymbolicLink(),'regular input required: '+entry.path);
  const raw=fs.readFileSync(entry.path);
  requireValue(raw.length===entry.bytes&&sha(raw)===entry.sha256,'input changed: '+entry.path);
  return raw;
}
function boundedRows(rows,label,max){
  requireValue(Array.isArray(rows)&&rows.length>0&&rows.length<=max,'bounded nonempty '+label+' required');
  return rows;
}
function uncomment(text){return text.replace(/\/\*[\s\S]*?\*\//g,' ').replace(/\/\/[^\n]*/g,'');}
function headerExports(raw){
  const text=uncomment(raw.toString('utf8'));
  // Exported prototypes only: exclude typedef/function-pointer declarations,
  // static inline bodies, static asserts and function-like macros.
  const pattern=/(?:^|\n)\s*(?:extern\s+)?(?:int32_t|uint32_t|int64_t|uint64_t|void|int)\s+((?:YNX|ynx_link_|ynx_product_pay_transport_)[A-Za-z0-9_]+)\s*\([^;{}]*\)\s*;/g;
  return [...text.matchAll(pattern)].map(match=>match[1]);
}
function plainSymbols(text){
  return text.split('\n').flatMap(line=>{
    const match=line.match(/^\s*(?:([a-f0-9]+)\s+)?([A-Za-z?])\s+([^\s]+)\s*$/i);
    return match?[{address:match[1]??null,type:match[2],name:match[3],line}]:[];
  });
}
function archiveMembers(raw){
  // Local Darwin SDK <ar.h>: ARMAG is 8 bytes; ar_hdr is fixed ASCII
  // name[16],date[12],uid[6],gid[6],mode[8],size[10],ARFMAG[2]. BSD #1/n
  // stores its extended name at the start of that member's payload.
  const members=[];
  let offset=8;
  while(offset<raw.length){
    requireValue(members.length<65536&&offset+60<=raw.length,'bounded complete ar member header required');
    const header=raw.subarray(offset,offset+60);
    requireValue(header.subarray(58,60).toString()==='`\n','invalid ar member header');
    const sizeText=header.subarray(48,58).toString().trim();
    requireValue(/^\d+$/.test(sizeText),'canonical ar member size required');
    const size=Number(sizeText),start=offset+60;
    requireValue(Number.isSafeInteger(size)&&size>=0&&size<=raw.length-start,'ar member exceeds original archive');
    let name=header.subarray(0,16).toString().trim(),content=start;
    if(name.startsWith('#1/')){
      requireValue(/^#1\/\d+$/.test(name),'bounded BSD ar name required');
      const length=Number(name.slice(3));
      requireValue(Number.isSafeInteger(length)&&length>0&&length<=size,'BSD ar name exceeds member');
      name=raw.subarray(start,start+length).toString().replace(/\x00+$/,'');content+=length;
    }
    name=name.replace(/\/$/,'');
    const magic=raw.subarray(content,Math.min(content+8,start+size)).toString();
    requireValue(magic!=='!<arch>\n'&&magic!=='!<thin>\n'&&!/\.a$/.test(name),'nested/second archive member refused');
    members.push(name);offset=start+size+(size%2);
  }
  requireValue(offset===raw.length,'incomplete ar member padding');
  return members;
}
function attributes(text,name){
  return text.split('\n').filter(line=>line.trim().split(/\s+/).at(-1)===name);
}
function strongFunction(name,globals,macho){
  const key='_'+name;
  const rows=globals.filter(row=>row.name===key&&row.type!=='U');
  const attrs=attributes(macho,key);
  const definitions=attrs.filter(row=>! /\bundefined\b/.test(row));
  // Mach-O weak functions can also print T in ordinary nm. The -m attributes
  // are therefore mandatory; ordinary cross-member U rows are not definitions.
  requireValue(rows.length===1&&rows[0].type==='T'&&definitions.length===1&&
    !attrs.some(row=>/\bweak\b/.test(row))&&!/\bundefined\b/.test(definitions[0]),
    'missing/weak/undefined/duplicate strong archive callee: '+name);
  return {symbol:name,type:rows[0].type,definition:definitions[0].trim(),undefinedReferences:attrs.length-definitions.length};
}

/**
 * plan v1: goArchives:[pin], linkerInputs:[pin], coreSources:[Go //export pin],
 * headers:[{owner:'core'|'link',name,...pin}], nativeUndefined:[nm -u text pin
 * or a pinned actual Native JSON {unresolvedCore:['_YNX...',...]}].
 * The caller owns complete source/linker-input provenance. This gate verifies
 * those exact inputs and cannot turn an incomplete Native compile into one.
 */
export function checkCombinedArchive(plan){
  requireValue(process.platform==='darwin','Darwin Mach-O archive inspection required');
  requireValue(plan?.version===1&&Array.isArray(plan.goArchives)&&plan.goArchives.length===1,
    'exactly one complete Go archive required; never Core plus LINK archives');
  const archive=plan.goArchives[0],archiveRaw=bound(archive);
  requireValue(archiveRaw.subarray(0,8).toString()==='!<arch>\n','a single actual ar archive required');
  const rawMembers=archiveMembers(archiveRaw);
  requireValue(rawMembers.filter(name=>name==='go.o').length===1,'one go.o and no nested/second Go archive required');
  const allInputs=[archive],coreExportMap=new Map(),headerMap=new Map(),symbolHeaders=new Map();
  const sourcePaths=new Set();
  for(const source of boundedRows(plan.coreSources,'original Core Go sources',256)){
    requireValue(source.path?.endsWith('.go')&&!sourcePaths.has(source.path),'unique original Core Go source required');
    sourcePaths.add(source.path);
    const text=bound(source).toString('utf8');allInputs.push(source);
    for(const match of text.matchAll(/^\/\/export ([A-Za-z_][A-Za-z0-9_]*)\s*$/gm)){
      const symbol=match[1];
      requireValue(symbol.startsWith('YNX')&&!coreExportMap.has(symbol),'duplicate/foreign Core //export: '+symbol);
      coreExportMap.set(symbol,source.path);
    }
  }
  requireValue(coreExportMap.size>0,'original Core //export closure is empty');
  for(const header of boundedRows(plan.headers,'complete Core/LINK headers',64)){
    requireValue(['core','link','product'].includes(header.owner)&&/^[A-Za-z0-9_.-]+\.h$/.test(header.name??'')&&path.basename(header.path??'')===header.name&&!headerMap.has(header.name),'unique named Core/LINK/Product header required');
    const raw=bound(header);allInputs.push(header);headerMap.set(header.name,header);
    for(const symbol of headerExports(raw)){
      requireValue(identifier.test(symbol)&&!symbolHeaders.has(symbol),'duplicate header export: '+symbol);
      symbolHeaders.set(symbol,{owner:header.owner,name:header.name,path:header.path});
    }
  }
  for(const name of mandatoryCoreHeaders)requireValue(headerMap.get(name)?.owner==='core','mandatory Core header missing: '+name);
  for(const name of linkHeaders)requireValue(headerMap.get(name)?.owner==='link','mandatory LINK header missing: '+name);
  requireValue([...headerMap.values()].filter(row=>row.owner==='link').length===2,'exact original two LINK ABI headers required');
  for(const symbol of coreExportMap.keys())requireValue(symbolHeaders.get(symbol)?.owner==='core','Core //export has no original header: '+symbol);
  for(const [symbol,header] of symbolHeaders)if(header.owner==='core')requireValue(coreExportMap.has(symbol),'Core header has no original //export: '+symbol);
  const links=[...symbolHeaders].filter(([,header])=>header.owner==='link').map(([symbol])=>symbol);
  requireValue(JSON.stringify(sort(links))===JSON.stringify(sort(linkRequiredSymbols)),'complete original LINK 22-function ABI required');
  const productHeaders=[...headerMap.values()].filter(row=>row.owner==='product');
  const products=[...symbolHeaders].filter(([,header])=>header.owner==='product').map(([symbol])=>symbol);
  if(productHeaders.length)requireValue(productHeaders.length===1&&productHeaders[0].name==='product_pay_transport_private.h'&&
    JSON.stringify(sort(products))===JSON.stringify(sort(productTransportRequiredSymbols)),'complete dedicated Product eight-function ABI required');
  const required=sort([...coreExportMap.keys(),...links,...products]);
  const requiredSet=new Set(required),observed=new Set(),ignoredNative=new Set(),nativeEvidence=[];
  for(const log of boundedRows(plan.nativeUndefined,'actual Native undefined evidence',32)){
    const text=bound(log).toString('utf8');allInputs.push(log);
    if(text.trimStart().startsWith('{')){
      const object=JSON.parse(text);
      requireValue(Array.isArray(object.unresolvedCore)&&object.unresolvedCore.length>0&&object.unresolvedCore.length<=256,
        'actual Native JSON unresolvedCore array required');
      const references=new Set();
      for(const value of object.unresolvedCore){
        requireValue(typeof value==='string'&&/^_YNX[A-Za-z0-9_]+$/.test(value),'exact original Core symbol required in Native JSON');
        const symbol=value.slice(1);
        requireValue(coreExportMap.has(symbol)&&symbolHeaders.get(symbol)?.owner==='core','actual Native Core JSON reference has no original export/header: '+symbol);
        requireValue(!references.has(symbol),'duplicate Native Core JSON reference: '+symbol);
        references.add(symbol);observed.add(symbol);
      }
      nativeEvidence.push({path:log.path,format:'actual-native-unresolvedCore-json',references:sort(references)});
      continue;
    }
    const references=new Set();
    for(const line of text.split('\n')){
      const symbol=line.trim().split(/\s+/).at(-1)?.match(/^_((?:YNX|ynx_link_|ynx_product_pay_transport_)[A-Za-z0-9_]+)$/)?.[1];
      if(!symbol)continue;
      if(requiredSet.has(symbol)){observed.add(symbol);references.add(symbol);}
      else if(symbol.startsWith('ynx_link_')||symbol.startsWith('ynx_product_pay_transport_'))throw Error('actual Native LINK/Product reference has no ABI header: '+symbol);
      else ignoredNative.add(symbol); // e.g. Native's YNXIDEIdentityHelperService.
    }
    nativeEvidence.push({path:log.path,format:'actual-native-nm-undefined-text',references:sort(references)});
  }
  requireValue(observed.size>0,'no actual Native Core/LINK undefined references supplied');
  const archivePath=fs.realpathSync(archive.path);
  let archiveInputs=0;
  for(const input of boundedRows(plan.linkerInputs,'actual linker inputs',512)){
    const raw=bound(input);allInputs.push(input);
    requireValue(!input.path.endsWith('.a')||raw.subarray(0,8).toString()==='!<arch>\n','unidentified/thin archive in linker inputs');
    if(raw.subarray(0,8).toString()==='!<arch>\n'){
      requireValue(fs.realpathSync(input.path)===archivePath&&input.sha256===archive.sha256,'second/unidentified archive in combined linker inputs');
      archiveInputs++;
    }
  }
  requireValue(archiveInputs===1,'combined archive must occur exactly once in linker inputs');
  const commands=[];
  function run(tool,args){
    const result=spawnSync(tool,args,{encoding:'utf8',maxBuffer:64*1024*1024,timeout:30000});
    requireValue(!result.error&&result.status===0,`${tool} failed: ${result.error?.message??result.stderr}`);
    commands.push({tool,args,exit:result.status,stdoutBytes:Buffer.byteLength(result.stdout),stdoutSHA256:sha(result.stdout)});
    return result.stdout;
  }
  const members=run('/usr/bin/ar',['-t',archive.path]).split('\n').map(line=>line.trim()).filter(Boolean);
  requireValue(members.length===rawMembers.length&&members.filter(name=>name.replace(/\/$/,'')==='go.o').length===1,
    'one go.o and no nested/second Go archive required');
  const globals=plainSymbols(run('/usr/bin/nm',['-g',archive.path]));
  const macho=run('/usr/bin/nm',['-m',archive.path]);
  const actualProduct=globals.filter(row=>row.type!=='U'&&row.name.startsWith('_ynx_product_pay_transport_')).map(row=>row.name.slice(1));
  const matrix=required.map(name=>({...strongFunction(name,globals,macho),header:symbolHeaders.get(name),source:coreExportMap.get(name)??'original LINK ABI'}));
  requireValue(JSON.stringify(sort(actualProduct))===JSON.stringify(sort(products)),
    'unlisted Product transport archive export or missing dedicated header');
  requireValue(!globals.some(row=>row.type!=='U'&&row.name.startsWith('_ynx_product_pay_source_')),
    'Auth-owned Product Source definition in LINK archive');
  for(const name of ['crosscall2','_cgo_topofstack'])strongFunction(name,globals,macho);
  const full=plainSymbols(run('/usr/bin/nm',[archive.path]));
  const runtimeEntries=full.filter(row=>/^__rt0_(?:arm64|amd64)_darwin_lib$/.test(row.name)&&row.type!=='U');
  requireValue(runtimeEntries.length===1&&/^[Tt]$/.test(runtimeEntries[0].type),'one original Go runtime entry required');
  requireValue(!globals.some(row=>row.type!=='U'&&/^_ynx_link_private_fixture_/.test(row.name)),'fixture installer in normal combined archive');
  for(const input of allInputs)bound(input);
  return {version:1,status:'COMBINED_GO_ARCHIVE_STRONG_SYMBOLS_VERIFIED',goArchives:plan.goArchives,
    coreExports:sort(coreExportMap.keys()),linkExports:sort(links),productExports:sort(products),headers:[...headerMap.values()],
    nativeObservedGoReferences:sort(observed),nativeOtherOwnedReferences:sort(ignoredNative),nativeEvidence,
    symbols:matrix,runtimeEntry:runtimeEntries[0].name,archiveMembers:members.length,commands,
    finalNativeImageVerified:false,RootAdmission:false,SourceAdmission:false,installed:false,deployed:false,
    limitation:'Exact archive/header/strong-symbol gate only. Caller supplies complete source and linker provenance; Native closure compilation and final common-image gate remain separate.'};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  requireValue(args.length===4&&args[0]==='--plan'&&args[2]==='--plan-sha256'&&/^[a-f0-9]{64}$/.test(args[3]),
    'usage: node combined-archive-symbols.mjs --plan FILE --plan-sha256 SHA256');
  const raw=fs.readFileSync(args[1]);requireValue(sha(raw)===args[3],'plan content pin mismatch');
  const result=checkCombinedArchive(JSON.parse(raw));
  requireValue(sha(fs.readFileSync(args[1]))===args[3],'plan changed during inspection');
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
