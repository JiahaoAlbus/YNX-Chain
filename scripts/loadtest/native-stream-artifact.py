#!/usr/bin/env python3
"""Bounded original ZIP/range recovery for the explicit native stream small tier.
Derived from the original client-procs2 diagnostic range recovery. Read-only;
no fixture, transaction submission, node launch or network performance admission.
"""
import hashlib,json,os,re,stat,struct,time,zlib
from pathlib import Path,PurePosixPath

BLOCK=65536
MAX_ARCHIVE=512<<20
MAX_INDEX=8<<20
MAX_ENTRIES=20000
MAX_MEMBER=16<<20
MAX_RECOVERED=96<<20
MAX_CACHE=128<<20

def need(value,message):
    if not value:raise RuntimeError(message)

def integer(v,lo,hi):return type(v) is int and lo<=v<=hi

def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()+b'\n'

def safe_name(raw,flags):
    try:name=raw.decode('utf-8' if flags&2048 else 'cp437')
    except UnicodeError as error:raise RuntimeError('invalid ZIP member name') from error
    parts=name.rstrip('/').split('/')
    need(name and len(raw)<=4096 and not name.startswith('/') and '\\' not in name and '\x00' not in name and all(p not in ('','.','..') and ':' not in p for p in parts),'unsafe ZIP member path')
    return name

class Blocks:
    """One retained block; fetch receives exact ranges of at most64KiB."""
    def __init__(self,size,fetch):
        need(integer(size,22,MAX_ARCHIVE),'archive size bound')
        self.size=size;self.fetch=fetch;self.position=None;self.block=b'';self.calls=0
    def read(self,offset,length):
        need(integer(offset,0,self.size) and integer(length,0,65557) and offset+length<=self.size,'bounded ZIP read differs')
        result=bytearray()
        while length:
            base=offset//BLOCK*BLOCK
            if base!=self.position:
                size=min(BLOCK,self.size-base);raw=self.fetch(base,size)
                need(type(raw) is bytes and len(raw)==size,'exact range body length differs')
                self.position=base;self.block=raw;self.calls+=1
            n=min(length,len(self.block)-(offset-base));need(n>0,'ZIP range made no progress')
            result.extend(self.block[offset-base:offset-base+n]);offset+=n;length-=n
        return bytes(result)

class Archive:
    def __init__(self,source):
        self.source=source;size=source.size;tail=source.read(max(0,size-65557),min(size,65557));base=size-len(tail)
        end=tail.rfind(b'PK\x05\x06')
        while end>=0 and (end+22>len(tail) or end+22+int.from_bytes(tail[end+20:end+22],'little')!=len(tail)):
            end=tail.rfind(b'PK\x05\x06',0,end)
        need(end>=0,'ZIP EOCD absent')
        row=struct.unpack_from('<4s4H2IH',tail,end)
        need(end+22+row[7]==len(tail) and row[1:3]==(0,0) and row[3]==row[4],'ZIP EOCD tail/disk differs')
        count,index_size,index=row[4:7];index_end=base+end
        if count==65535 or index_size==0xffffffff or index==0xffffffff:
            locator=source.read(base+end-20,20);loc=struct.unpack('<4sIQI',locator)
            need(loc[0]==b'PK\x06\x07' and loc[1]==0 and loc[3]==1,'ZIP64 locator/disk differs')
            record=source.read(loc[2],56);z=struct.unpack('<4sQ2H2I4Q',record)
            need(z[0]==b'PK\x06\x06' and 44<=z[1]<=4096 and loc[2]+12+z[1]==base+end-20 and z[4:6]==(0,0) and z[6]==z[7],'ZIP64 EOCD differs')
            count,index_size,index=z[7:10];index_end=loc[2]
        need(integer(count,1,MAX_ENTRIES) and integer(index_size,46,MAX_INDEX) and integer(index,0,size) and index+index_size==index_end,'ZIP central directory bounds differ')
        self.count=count;self.index=index;self.index_size=index_size;self.central_sha=None
    def entries(self):
        at=self.index;end=at+self.index_size;digest=hashlib.sha256()
        for _ in range(self.count):
            need(at+46<=end,'truncated ZIP central header');head=self.source.read(at,46);row=struct.unpack('<4s6H3I5H2I',head)
            need(row[0]==b'PK\x01\x02' and row[3]&~(8|2048)==0 and row[4] in (0,8),'unsupported ZIP header/flags/compression')
            n,e,c=row[10:13];need(0<n<=4096 and e<=4096 and c<=4096 and at+46+n+e+c<=end,'ZIP central variable field bound')
            rest=self.source.read(at+46,n+e+c);name=safe_name(rest[:n],row[3]);extra=rest[n:n+e]
            size,packed,offset,disk=self.extended(extra,row)
            need(disk==0 and 0<=offset<self.index,'ZIP member disk/local offset differs')
            mode=(row[15]>>16)&0xffff
            digest.update(head);digest.update(rest);at+=46+n+e+c
            yield dict(name=name,nameRaw=rest[:n],flags=row[3],method=row[4],crc=row[7],packed=packed,size=size,offset=offset,mode=mode)
        need(at==end,'ZIP central count/size differs');self.central_sha=digest.hexdigest()
    @staticmethod
    def extended(extra,row):
        fields=[];pos=0;payload=None
        while pos<len(extra):
            need(pos+4<=len(extra),'ZIP64 extra header');kind,size=struct.unpack_from('<HH',extra,pos);pos+=4;need(pos+size<=len(extra),'ZIP64 extra length')
            if kind==1:need(payload is None,'duplicate ZIP64 extra');payload=extra[pos:pos+size]
            pos+=size
        cursor=0
        for value,sentinel,width in ((row[9],0xffffffff,8),(row[8],0xffffffff,8),(row[16],0xffffffff,8),(row[13],65535,4)):
            if value==sentinel:
                need(payload is not None and cursor+width<=len(payload),'ZIP64 field absent');value=int.from_bytes(payload[cursor:cursor+width],'little');cursor+=width
            fields.append(value)
        return fields
    def inspect_member(self,entry):
        need(not stat.S_ISLNK(entry['mode']) and (stat.S_IFMT(entry['mode']) in (0,stat.S_IFREG)),'selected ZIP member is not regular')
        need(integer(entry['size'],0,MAX_MEMBER) and integer(entry['packed'],0,MAX_MEMBER+BLOCK),'selected ZIP member byte bound')
        at=entry['offset'];header=self.source.read(at,30);local=struct.unpack('<4s5H3I2H',header)
        need(local[0]==b'PK\x03\x04' and local[2]==entry['flags'] and local[3]==entry['method'],'ZIP local/central mode differs')
        n,e=local[-2:];need(n<=4096 and e<=4096,'ZIP local name/extra bound');variable=self.source.read(at+30,n+e)
        need(variable[:n]==entry['nameRaw'],'ZIP local/central name differs')
        if not entry['flags']&8:
            sizes=(local[8],local[7])
            if 0xffffffff in sizes:
                fake=[0]*17;fake[9]=local[8];fake[8]=local[7];fake[16]=0;fake[13]=0;sizes=self.extended(variable[n:],fake)[:2]
            need(local[6]==entry['crc'] and tuple(sizes)==(entry['size'],entry['packed']),'ZIP local/central size/CRC differs')
        begin=at+30+n+e;need(begin+entry['packed']<=self.index,'ZIP member overlaps central directory')
        if entry['flags']&8:
            at=begin+entry['packed'];sig=self.source.read(at,4)
            if sig==b'PK\x07\x08':at+=4
            wide=local[7]==0xffffffff or local[8]==0xffffffff
            size=20 if wide else 12;descriptor=self.source.read(at,size)
            values=struct.unpack('<IQQ' if wide else '<III',descriptor)
            need(at+size<=self.index and values==(entry['crc'],entry['packed'],entry['size']),'ZIP data descriptor differs')
        return begin
    def member(self,entry,handle,begin=None):
        if begin is None:begin=self.inspect_member(entry)
        decoder=zlib.decompressobj(-15) if entry['method']==8 else None
        written=0;crc=0;sha=hashlib.sha256()
        def output(raw):
            nonlocal written,crc
            written+=len(raw);need(written<=entry['size'],'ZIP inflated member exceeded declared bound');handle.write(raw);crc=zlib.crc32(raw,crc);sha.update(raw)
        for relative in range(0,entry['packed'],BLOCK):
            raw=self.source.read(begin+relative,min(BLOCK,entry['packed']-relative))
            if decoder:
                while raw:
                    before=len(raw);before_written=written;output(decoder.decompress(raw,min(BLOCK,entry['size']-written+1)));raw=decoder.unconsumed_tail
                    need(not decoder.unused_data and (not raw or len(raw)<before or written>before_written),'ZIP deflate tail/progress differs')
            else:output(raw)
        if decoder:need(decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail,'ZIP incomplete deflate stream')
        need(written==entry['size'] and crc==entry['crc'],'ZIP original member CRC/size differs')
        return dict(bytes=written,sha256=sha.hexdigest(),crc32=crc)

class Selection:
    def __init__(self,mode):
        need(mode in ('unit','network'),'explicit public artifact selection required');self.mode=mode;self.seen=set();self.bits=[bytearray((MAX_ENTRIES+7)//8) for _ in range(2)]
    def select(self,name):
        if name.endswith('/'):return None
        if self.mode=='network':
            if name.startswith('ynx-linux-supply-evidence/'):
                name='evidence/'+name[len('ynx-linux-supply-evidence/'):]
            elif name.startswith('ynx-linux-supply-case/'):
                name=name[len('ynx-linux-supply-case/'):]
            else:return None
        network='network/' if self.mode=='network' else ''
        fixed={network+n for n in ('network-manifest.json','transactions.json','transactions-result.json','transactions-result.json.streaming-plan.json','bound-migration.json')}
        if self.mode=='unit':fixed.add('PUBLIC_FIXTURE_SCOPE.json')
        else:fixed.update({'evidence/'+n+'.json' for n in ('actual','recipe','preflight')}|{'abci-'+str(i)+'.log' for i in range(4)}|{'comet-'+str(i)+'.log' for i in range(4)}|{'client.log','fixture.log'})
        if name in fixed:
            need(name not in self.seen,'duplicate selected ZIP member');self.seen.add(name);return name
        for i,(directory,prefix) in enumerate((('sender-ready-intents','intent'),('transactions-result.json.terminal-stream','terminal'))):
            match=re.fullmatch(re.escape(network+directory+'/')+prefix+r'-(\d{6})\.jsonl',name)
            if match:
                index=int(match[1]);need(index<MAX_ENTRIES,'selected segment index bound');byte,bit=divmod(index,8)
                need(not self.bits[i][byte]&(1<<bit),'duplicate selected ZIP segment');self.bits[i][byte]|=1<<bit;return name
        return None

def file_identity(path):
    before=path.lstat();need(stat.S_ISREG(before.st_mode) and before.st_size<=MAX_MEMBER,'recovered member not regular/bounded')
    sha=hashlib.sha256();crc=0;size=0
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as f:
        opened=os.fstat(f.fileno());need((opened.st_dev,opened.st_ino)==(before.st_dev,before.st_ino),'recovered member replaced')
        while raw:=f.read(BLOCK):size+=len(raw);sha.update(raw);crc=zlib.crc32(raw,crc)
        after=os.fstat(f.fileno())
    final=path.lstat();fields=lambda x:(x.st_dev,x.st_ino,x.st_size,x.st_mtime_ns,x.st_ctime_ns)
    need(fields(before)==fields(after)==fields(final) and size==before.st_size,'recovered member changed during read')
    return dict(bytes=size,sha256=sha.hexdigest(),crc32=crc)

class VerifyOnly:
    def write(self,raw):return len(raw)

def recover(source,destination,mode):
    destination=Path(destination).absolute();need(destination.resolve()==destination,'symlinked capture root refused');destination.mkdir(exist_ok=True)
    archive=Archive(source);selection=Selection(mode);manifest=hashlib.sha256();count=0;total=0
    for entry in archive.entries():
        relative=selection.select(entry['name'])
        if relative is None:continue
        need(not stat.S_ISLNK(entry['mode']) and integer(entry['size'],0,MAX_MEMBER),'selected ZIP member type/size bound')
        total+=entry['size'];need(total<=MAX_RECOVERED,'recovered public byte budget exceeded')
        target=destination/relative;target.parent.mkdir(parents=True,exist_ok=True);need(target.parent.resolve()==target.parent,'symlinked capture directory refused')
        begin=archive.inspect_member(entry)
        if target.exists() or target.is_symlink():
            identity=file_identity(target);need(identity['bytes']==entry['size'] and identity['crc32']==entry['crc'],'existing recovered member differs; reconcile original bytes')
            original=archive.member(entry,VerifyOnly(),begin)
            need(identity==original,'existing recovered member SHA256 differs from original range bytes')
        else:
            partial=target.with_name(target.name+'.recover-partial')
            with partial.open('xb') as handle:
                identity=archive.member(entry,handle,begin);handle.flush();os.fsync(handle.fileno())
            os.link(partial,target);partial.unlink()
            fd=os.open(target.parent,os.O_RDONLY|getattr(os,'O_DIRECTORY',0))
            try:os.fsync(fd)
            finally:os.close(fd)
        descriptor=dict(archivePath=entry['name'],path=relative,**identity);manifest.update(canonical(descriptor));count+=1
    need(count>0,'no selected original public members')
    return dict(schema=1,mode=mode,members=count,bytes=total,centralDirectoryBytes=archive.index_size,centralDirectorySHA256=archive.central_sha,
        selectedMemberManifestSHA256=manifest.hexdigest(),rangeCalls=source.calls,maxRetainedRangeBytes=BLOCK,
        wholeZipDigestComputed=False,networkQualified=False,sustainedTPSQualified=False,
        interpretation='Original ZIP central metadata plus exact local-name/size/CRC and public member identities. Selection manifest is not a whole-ZIP digest. Complete stream/BFT/resource/terminal qualification remains separate.')

class ExactHTTPRanges:
    """Original exact206 protocol, with immutable64KiB blocks and no URL/token log."""
    def __init__(self,url,size,cache,identity,opener=None):
        from urllib.request import build_opener,HTTPRedirectHandler
        from urllib.parse import urlsplit
        parts=urlsplit(url)
        need(parts.scheme=='https' and type(parts.hostname) is str and not parts.username and not parts.password and parts.port in (None,443) and (parts.hostname.endswith('.blob.core.windows.net') or parts.hostname.endswith('.actions.githubusercontent.com')),'artifact redirect host/scheme refused')
        class NoRedirect(HTTPRedirectHandler):
            def redirect_request(self,*a,**k):return None
        self.opener=opener or build_opener(NoRedirect());self.url=url;self.size=size;self.identity=identity
        self.cache=Path(cache).absolute();need(self.cache.resolve()==self.cache,'symlinked range cache refused');self.cache.mkdir(exist_ok=True)
        self.key=hashlib.sha256(canonical(identity)).hexdigest();pin=self.cache/'identity.json';raw=canonical(identity)
        if pin.exists():need(stat.S_ISREG(pin.lstat().st_mode) and pin.stat().st_size<=4096 and pin.read_bytes()==raw,'range cache belongs to another artifact')
        else:
            with pin.open('xb') as handle:handle.write(raw);handle.flush();os.fsync(handle.fileno())
        self.cache_bytes=0;files=0
        with os.scandir(self.cache) as entries:
            for entry in entries:
                files+=1;need(files<=8194 and entry.is_file(follow_symlinks=False),'range cache inventory differs')
                if entry.name.endswith('.bin'):self.cache_bytes+=entry.stat(follow_symlinks=False).st_size
        need(self.cache_bytes<=MAX_CACHE,'retained range cache budget exceeded')
        self.deadline=time.monotonic()+60;self.etag=None;self.network_bytes=0
    def fetch(self,start,size):
        from urllib.request import Request
        need(time.monotonic()<self.deadline,'original60s range recovery deadline exceeded; retain and resume original cache')
        need(integer(start,0,self.size-1) and start%BLOCK==0 and size==min(BLOCK,self.size-start),'exact aligned range required')
        body=self.cache/('block-%010d.bin'%start);pin=body.with_suffix('.json');span='bytes '+str(start)+'-'+str(start+size-1)+'/'+str(self.size)
        if body.exists() or pin.exists():
            need(body.exists() and pin.exists(),'incomplete original range cache; reconcile before retry')
            need(body.lstat().st_size==size and stat.S_ISREG(body.lstat().st_mode) and stat.S_ISREG(pin.lstat().st_mode) and pin.stat().st_size<=4096,'cached range type/size differs')
            raw=body.read_bytes();proof=json.loads(pin.read_text())
            need(proof.get('artifactIdentity')==self.key and proof.get('contentRange')==span and proof.get('sha256')==hashlib.sha256(raw).hexdigest(),'cached exact range integrity differs')
            etag=proof.get('etag')
        else:
            need(self.cache_bytes+size<=MAX_CACHE,'retained range cache budget exceeded')
            req=Request(self.url,headers={'Range':'bytes='+str(start)+'-'+str(start+size-1),'x-ms-range':'bytes='+str(start)+'-'+str(start+size-1),'Accept-Encoding':'identity'})
            with self.opener.open(req,timeout=min(15,max(.001,self.deadline-time.monotonic()))) as response:
                need(response.status==206 and response.headers.get('Content-Range')==span and response.headers.get('Content-Encoding','identity')=='identity','exact206/range/encoding required')
                raw=response.read(size+1);need(len(raw)==size,'exact range response length differs');etag=response.headers.get('ETag')
            need(type(etag) is str and etag,'original artifact ETag absent')
            need(self.etag is None or etag==self.etag,'artifact ETag changed during range recovery')
            with body.open('xb') as handle:handle.write(raw);handle.flush();os.fsync(handle.fileno())
            with pin.open('x') as handle:json.dump(dict(artifactIdentity=self.key,contentRange=span,etag=etag,sha256=hashlib.sha256(raw).hexdigest()),handle);handle.flush();os.fsync(handle.fileno())
            self.cache_bytes+=size;self.network_bytes+=size
        need(type(etag) is str and etag and (self.etag is None or self.etag==etag),'cached/remote artifact ETag differs');self.etag=etag
        return raw

def original_artifact(artifact_id,run_id,head,mode):
    import subprocess
    from urllib.request import Request,build_opener,HTTPRedirectHandler
    from urllib.error import HTTPError
    need(integer(artifact_id,1,2**63-1) and integer(run_id,1,2**63-1) and re.fullmatch('[0-9a-f]{40}',head) is not None,'exact artifact/run/source identity required')
    need(mode in ('unit','network'),'explicit artifact mode required')
    repo='repos/JiahaoAlbus/YNX-Chain/actions/artifacts/'+str(artifact_id)
    meta=json.loads(subprocess.check_output(['gh','api',repo],timeout=15));workflow=meta.get('workflow_run',{})
    expected=('native-stream-public-unit-' if mode=='unit' else 'linux-supply-')+head
    need(meta.get('id')==artifact_id and meta.get('name')==expected and meta.get('expired') is False and workflow.get('id')==run_id and workflow.get('head_sha')==head and integer(meta.get('size_in_bytes'),22,MAX_ARCHIVE),'original artifact metadata/run/source differs')
    token=subprocess.check_output(['gh','auth','token'],timeout=5).decode().strip()
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self,*a,**k):return None
    request=Request('https://api.github.com/'+repo+'/zip',headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'})
    try:
        build_opener(NoRedirect()).open(request,timeout=15)
        raise RuntimeError('original artifact redirect expected')
    except HTTPError as error:
        need(error.code==302,'original artifact redirect refused');url=error.headers.get('Location','')
    return meta,url

def verify_capture(destination,mode,head):
    import importlib.util
    def load(name):
        path=Path(__file__).with_name(name+'.py');spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
    evidence=load('native-stream-evidence');root=Path(destination).absolute()
    if mode=='unit':
        meta=evidence.strict_json(evidence.capture(root/'PUBLIC_FIXTURE_SCOPE.json',5<<20))
        need(meta.get('kind')=='native_stream_public_unit_fixture_not_network' and meta.get('independentBFTProof') is False,'original public unit scope differs')
        initial=evidence.strict_json(evidence.capture(root/'transactions.json',16<<20))['transactions']
        proof=evidence.verify_streams(root,meta['runtimeNetworkRoot'],meta['runtimeOutput'],evidence.capture(root/'network-manifest.json',1<<20),initial,meta['intents'],meta['terminalStream'],meta['latest'],meta['rounds'],4<<20,measure_latency=True)
        evidence.verify_bounded_latency(proof['rowMetrics'],meta['boundedSummary'])
        return dict(publicStream=proof,originalUnitOnly=True,streamReadbackVerified=True,networkQualified=False)
    need(mode=='network','explicit capture scope required')
    receipt=evidence.strict_json(evidence.capture(root/'evidence/actual.json',16<<20))
    need(receipt.get('sourceCommit')==head and receipt.get('profile',{}).get('name')=='supply-native-stream-2048x4-grpc','original source/profile receipt differs')
    need(receipt.get('nodesStarted') is True and receipt.get('cleanupComplete') is True and receipt.get('firstCause') is None,'original receipt is failed/incomplete; retained raw is not qualification')
    case=Path(receipt.get('case',''));need(case.is_absolute() and case.name=='ynx-linux-supply-case','original runtime case scope differs')
    report=evidence.strict_json(evidence.capture(root/'network/transactions-result.json',16<<20))
    measured=load('supply-linux-window').validate_native_stream_report(report,root/'network',runtime_network=case/'network')
    need(canonical(measured)==canonical(receipt.get('measurement')),'recovered complete stream differs from original controller measurement')
    return dict(measurement=measured,streamReadbackVerified=True,postFsyncTerminalStillRequiresOriginalCILog=True,independentNativeResourceAdmission=False,networkQualified=False,sustainedTPSQualified=False)

def recovery_timeout(signum,frame):
    raise RuntimeError('original60s recovery deadline exceeded; retain original cache')

if __name__=='__main__':
    import argparse,sys,signal
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact-id',type=int,required=True);parser.add_argument('--run-id',type=int,required=True)
    parser.add_argument('--head',required=True);parser.add_argument('--mode',choices=('unit','network'),required=True)
    parser.add_argument('--destination',type=Path,required=True);parser.add_argument('--cache',type=Path,required=True)
    args=parser.parse_args()
    signal.signal(signal.SIGALRM,recovery_timeout);signal.setitimer(signal.ITIMER_REAL,60)
    try:
        began=time.monotonic()
        meta,url=original_artifact(args.artifact_id,args.run_id,args.head,args.mode)
        identity=dict(artifactId=meta['id'],name=meta['name'],bytes=meta['size_in_bytes'],runId=args.run_id,head=args.head,digestReportedButNotRecomputed=meta.get('digest'))
        ranges=ExactHTTPRanges(url,identity['bytes'],args.cache,identity);ranges.deadline=began+60
        proof=recover(Blocks(identity['bytes'],ranges.fetch),args.destination,args.mode);proof.update(artifact=identity,networkRangeBytes=ranges.network_bytes,etag=ranges.etag)
        proof['completeReadback']=verify_capture(args.destination,args.mode,args.head)
        need(time.monotonic()-began<=60,'original60s complete recovery deadline exceeded')
        print(json.dumps(proof,sort_keys=True),flush=True)
    except Exception as error:
        # Exception objects can contain signed transport URLs. Preserve public
        # first cause without printing a bearer token or redirect query.
        message=str(error) if isinstance(error,RuntimeError) else type(error).__name__
        print(json.dumps(dict(recovered=False,firstCause=message,networkQualified=False)),file=sys.stderr,flush=True);sys.exit(1)

    finally:
        signal.setitimer(signal.ITIMER_REAL,0)
