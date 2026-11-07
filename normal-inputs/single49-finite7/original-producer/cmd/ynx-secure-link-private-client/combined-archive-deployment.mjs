// Read-only minimum-OS metadata gate. Formats/constants come from the local
// macOS SDK mach-o/loader.h, mach/machine.h and ar.h. No object is extracted,
// rewritten or patched. Existing runtime/strong-symbol checks remain separate.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const sha=raw=>createHash('sha256').update(raw).digest('hex');
const requireValue=(value,message)=>{if(!value)throw Error(message);};
const architectures=Object.freeze({arm64:{cpu:0x0100000c,subtype:0},x86_64:{cpu:0x01000007,subtype:3}});
const legacy=new Map([[0x24,['LC_VERSION_MIN_MACOSX',1]],[0x25,['LC_VERSION_MIN_IPHONEOS',2]],
  [0x2f,['LC_VERSION_MIN_TVOS',3]],[0x30,['LC_VERSION_MIN_WATCHOS',4]]]);
const version=value=>[value>>>16,(value>>>8)&255,value&255].join('.');
const targetPacked=13<<16;

function archiveMembers(raw,report){
  requireValue(raw.subarray(0,8).toString()==='!<arch>\n','REGULAR_AR_REQUIRED');
  const members=[];
  let offset=8,strings=null;
  while(offset<raw.length){
    report.nextHeaderOffset=offset;
    requireValue(members.length<16384&&offset+60<=raw.length,'AR_TRUNCATED_OR_EXCESSIVE_HEADERS');
    const header=raw.subarray(offset,offset+60);
    requireValue(header.subarray(58,60).toString()==='`\n','AR_INVALID_HEADER_TRAILER');
    const text=header.subarray(48,58).toString().trim();
    requireValue(/^\d+$/.test(text),'AR_INVALID_MEMBER_SIZE');
    const size=Number(text),start=offset+60;
    requireValue(Number.isSafeInteger(size)&&size<=raw.length-start,'AR_MEMBER_OUT_OF_BOUNDS');
    let name=header.subarray(0,16).toString().trim(),content=start;
    if(name.startsWith('#1/')){
      requireValue(/^#1\/\d+$/.test(name),'AR_INVALID_BSD_NAME');
      const length=Number(name.slice(3));
      requireValue(Number.isSafeInteger(length)&&length>0&&length<=size,'AR_BSD_NAME_OUT_OF_BOUNDS');
      name=raw.subarray(start,start+length).toString().replace(/\x00+$/,'');content+=length;
    }else if(name==='//')strings=raw.subarray(start,start+size);
    else if(/^\/\d+$/.test(name)){
      const index=Number(name.slice(1));
      requireValue(strings&&Number.isSafeInteger(index)&&index<strings.length,'AR_GNU_NAME_OUT_OF_BOUNDS');
      const end=strings.indexOf(10,index);
      requireValue(end>=index,'AR_GNU_NAME_UNTERMINATED');
      name=strings.subarray(index,end).toString().replace(/\/$/,'');
    }else if(name!=='/')name=name.replace(/\/$/,'');
    requireValue(name.length>0&&!name.includes('\x00'),'AR_INVALID_MEMBER_NAME');
    const member={index:members.length,name,headerOffset:offset,contentOffset:content,bytes:start+size-content};
    members.push(member);report.members.push(member);
    offset=start+size+(size%2);
    requireValue(offset<=raw.length,'AR_TRUNCATED_PADDING');
  }
  requireValue(offset===raw.length,'AR_INCOMPLETE_TAIL');
  delete report.nextHeaderOffset;
  return members;
}

function inspectObject(raw,row,expected,budget){
  row.kind='object';row.checkable=false;row.verified=false;row.reasons=[];row.deploymentCommands=[];
  const deny=reason=>{if(!row.reasons.includes(reason))row.reasons.push(reason);};
  try {
    requireValue(raw.length>=4,'OBJECT_TRUNCATED_MAGIC');
    const le=raw.readUInt32LE(0),be=raw.readUInt32BE(0);
    if([0xcafebabe,0xcafebabf,0xbebafeca,0xbfbafeca].includes(be))throw Error('FAT_OBJECT_NOT_ADMITTED');
    const little=[0xfeedface,0xfeedfacf].includes(le);
    requireValue(little||[0xfeedface,0xfeedfacf].includes(be),'NON_MACH_O_MEMBER');
    const magic=little?le:be,is64=magic===0xfeedfacf,headerSize=is64?32:28;
    requireValue(raw.length>=headerSize,'MACH_HEADER_TRUNCATED');
    const u32=offset=>little?raw.readUInt32LE(offset):raw.readUInt32BE(offset);
    row.endian=little?'little':'big';row.bits=is64?64:32;
    row.cpuType=u32(4);row.cpuSubtype=u32(8);row.fileType=u32(12);
    row.architecture=Object.entries(architectures).find(([,item])=>item.cpu===row.cpuType&&item.subtype===row.cpuSubtype)?.[0]??'unrecognized-cpu-subtype';
    if(row.cpuType!==expected.cpu||row.cpuSubtype!==expected.subtype)deny('UNEXPECTED_ARCHITECTURE');
    if(row.fileType!==1)deny('NOT_MH_OBJECT');
    const count=u32(16),size=u32(20),alignment=is64?8:4;
    row.loadCommandCount=count;row.loadCommandBytes=size;
    requireValue(count<=4096&&count<=budget.commands&&count*8<=size&&size%alignment===0&&size<=raw.length-headerSize,'LOAD_COMMAND_REGION_OUT_OF_BOUNDS');
    budget.commands-=count;
    const limit=headerSize+size;
    let offset=headerSize;
    for(let index=0;index<count;index++){
      requireValue(offset+8<=limit,'LOAD_COMMAND_HEADER_TRUNCATED');
      const command=u32(offset),bytes=u32(offset+4);
      requireValue(bytes>=8&&bytes%alignment===0&&bytes<=limit-offset,'LOAD_COMMAND_SIZE_INVALID');
      if(command===0x32){
        requireValue(bytes>=24,'BUILD_VERSION_TRUNCATED');
        const tools=u32(offset+20);
        requireValue(tools<=65536&&24+tools*8===bytes,'BUILD_VERSION_TOOL_BOUNDS');
        const minimum=u32(offset+12),sdk=u32(offset+16);
        row.deploymentCommands.push({index,offset:row.contentOffset+offset,command:'LC_BUILD_VERSION',
          platform:u32(offset+8),minimumPacked:minimum,minimumVersion:version(minimum),sdkPacked:sdk,sdkVersion:version(sdk),tools});
      }else if(legacy.has(command)){
        requireValue(bytes===16,'VERSION_MIN_SIZE_INVALID');
        const [name,platform]=legacy.get(command),minimum=u32(offset+8),sdk=u32(offset+12);
        row.deploymentCommands.push({index,offset:row.contentOffset+offset,command:name,platform,
          minimumPacked:minimum,minimumVersion:version(minimum),sdkPacked:sdk,sdkVersion:version(sdk)});
      }
      // Other load commands are bounded by their exact original cmdsize. This
      // gate never rewrites/normalizes them or interprets them as deployment.
      offset+=bytes;
    }
    requireValue(offset===limit,'LOAD_COMMAND_REGION_COUNT_MISMATCH');
    if(row.deploymentCommands.length!==1)deny(row.deploymentCommands.length?'AMBIGUOUS_DEPLOYMENT_COMMANDS':'DEPLOYMENT_COMMAND_MISSING');
    for(const command of row.deploymentCommands){
      if(command.platform!==1)deny('NON_MACOS_PLATFORM');
      if(!command.minimumPacked)deny('MINIMUM_OS_UNSPECIFIED');
      if(command.platform===1&&command.minimumPacked>targetPacked)deny('MINIMUM_OS_ABOVE_13_0');
    }
    row.checkable=row.fileType===1&&row.deploymentCommands.length===1&&
      row.deploymentCommands[0].platform===1&&row.deploymentCommands[0].minimumPacked!==0;
  }catch(error){deny(error.message);}
  row.verified=row.checkable&&row.reasons.length===0;
}

function inputBytes(pin){
  requireValue(pin&&path.isAbsolute(pin.path??'')&&Number.isSafeInteger(pin.bytes)&&pin.bytes>0&&pin.bytes<=512*1024*1024&&/^[a-f0-9]{64}$/.test(pin.sha256??''),'EXACT_ARCHIVE_PIN_REQUIRED');
  const stat=fs.lstatSync(pin.path);
  requireValue(stat.isFile()&&!stat.isSymbolicLink(),'REGULAR_ARCHIVE_FILE_REQUIRED');
  const raw=fs.readFileSync(pin.path);
  requireValue(raw.length===pin.bytes&&sha(raw)===pin.sha256,'ARCHIVE_IDENTITY_MISMATCH');
  return raw;
}

export function inspectArchiveDeployment(pin,options){
  const report={version:1,status:'ARCHIVE_DEPLOYMENT_TARGET_REJECTED',archive:pin,
    target:options?.target??null,architecture:options?.architecture??null,members:[],archiveErrors:[],
    archiveUnchanged:false,structuralSymbolGateVerified:false,RootAdmission:false,SourceAdmission:false,
    installed:false,deployed:false,
    limitation:'Original per-object deployment metadata only. Not SDK/API availability, an execution on macOS 13, or the separate strong-symbol/single-runtime gate.'};
  try {
    requireValue(options?.target==='13.0'&&Object.hasOwn(architectures,options?.architecture??''),'EXPLICIT_MACOS_13_0_AND_ARCHITECTURE_REQUIRED');
    const raw=inputBytes(pin),expected=architectures[options.architecture];
    let members=[];
    const budget={commands:262144};
    try {members=archiveMembers(raw,report);}catch(error){report.archiveErrors.push(error.message);members=report.members;report.unparsedTail={offset:report.nextHeaderOffset??0,reason:error.message};}
    for(const row of members){
      const data=raw.subarray(row.contentOffset,row.contentOffset+row.bytes);
      const magic=data.length>=4?data.readUInt32LE(0):0;
      const looksObject=[0xfeedface,0xfeedfacf,0xcefaedfe,0xcffaedfe,0xcafebabe,0xcafebabf,0xbebafeca,0xbfbafeca].includes(magic);
      if(!looksObject&&(row.name==='/'||row.name==='//'
          ||['__.SYMDEF','__.SYMDEF SORTED','__.SYMDEF_64','__.SYMDEF_64 SORTED'].includes(row.name))){
        row.kind='archive-metadata';row.verified=null;row.reasons=[];
      }else inspectObject(data,row,expected,budget);
    }
    inputBytes(pin);report.archiveUnchanged=true;
  }catch(error){report.archiveErrors.push(error.message);}
  const objects=report.members.filter(row=>row.kind==='object');
  report.objectCount=objects.length;report.metadataMembers=report.members.filter(row=>row.kind==='archive-metadata').length;
  report.verifiedObjects=objects.filter(row=>row.verified).length;
  report.rejectedObjects=objects.filter(row=>!row.verified).length;
  report.unverifiableObjects=objects.filter(row=>!row.checkable).length;
  if(!objects.length)report.archiveErrors.push('NO_MACH_O_OBJECTS_VERIFIED');
  const minima=objects.flatMap(row=>row.deploymentCommands??[]).filter(row=>row.platform===1&&row.minimumPacked);
  const versions=[...new Set(minima.map(row=>row.minimumPacked))].sort((a,b)=>a-b);
  report.observedMinimumVersions=versions.map(version);
  report.maximumObservedMinimum=versions.length?version(versions.at(-1)):null;
  if(!report.archiveErrors.length&&objects.length&&report.rejectedObjects===0&&report.archiveUnchanged)
    report.status='ARCHIVE_DEPLOYMENT_TARGET_VERIFIED';
  report.firstCause=report.archiveErrors[0]??objects.find(row=>!row.verified)?.reasons[0]??null;
  return report;
}

export function checkArchiveDeployment(pin,options){
  const report=inspectArchiveDeployment(pin,options);
  if(report.status!=='ARCHIVE_DEPLOYMENT_TARGET_VERIFIED'){
    const error=Error('combined archive deployment rejected: '+report.firstCause);error.report=report;throw error;
  }
  return report;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  try {
    const args=process.argv.slice(2);
    requireValue(args.length===4&&args[0]==='--plan'&&args[2]==='--plan-sha256'&&/^[a-f0-9]{64}$/.test(args[3]),
      'usage: node combined-archive-deployment.mjs --plan FILE --plan-sha256 SHA256');
    const raw=fs.readFileSync(args[1]);requireValue(sha(raw)===args[3],'PLAN_IDENTITY_MISMATCH');
    const plan=JSON.parse(raw),report=inspectArchiveDeployment(plan.archive,{target:plan.target,architecture:plan.architecture});
    requireValue(sha(fs.readFileSync(args[1]))===args[3],'PLAN_CHANGED_DURING_INSPECTION');
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
    if(report.status!=='ARCHIVE_DEPLOYMENT_TARGET_VERIFIED')process.exitCode=1;
  }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
