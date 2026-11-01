# Build provenance DATA only. No Root, Source, key, network or executable loader.
from pathlib import Path
import json,tarfile,io,hashlib,base64,sys,subprocess,os
archive,source,cache,output=map(Path,sys.argv[1:5]);spec=json.loads((source/'integration/RUNTIME_BUNDLE_CLOSED_INPUTS.json').read_text());lock=json.loads((source/'package-lock.json').read_text());package=json.loads((source/'package.json').read_text());assert package['bundledDependencies']==spec['directBundled'];assert len(spec['packages'])==6
expected={};origins=[];original_outputs=output.parent/'BUNDLE_ORIGINALS';original_outputs.mkdir(exist_ok=True)
for row in spec['packages']:
 key='node_modules/'+row['name'];entry=lock['packages'][key];assert all(entry.get(k)==row[k] for k in ['version','resolved','integrity']);algorithm,encoded=row['integrity'].split('-',1);assert algorithm=='sha512';digest=base64.b64decode(encoded,validate=True);assert len(digest)==64
 if row['resolved'].startswith('file:'):
  relative=row['resolved'][5:];assert relative.startswith('testdata/') and '..' not in Path(relative).parts and not Path(relative).is_absolute();original=source/relative
 else:
  assert row['name'].startswith('@noble/') and row['resolved'].startswith('https://registry.npmjs.org/');h=digest.hex();original=cache/'_cacache/content-v2/sha512'/h[:2]/h[2:4]/h[4:]
 raw=original.read_bytes();assert hashlib.sha512(raw).digest()==digest,(row['name'],'original-integrity');bundle_original=original_outputs/('original-'+str(len(origins))+'.tgz');bundle_original.write_bytes(raw);origin=dict(**row,originalArchive=str(original),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),artifactOriginal='BUNDLE_ORIGINALS/'+bundle_original.name,members=0);seen=set()
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as t:
  for member in t.getmembers():
   q=Path(member.name);assert member.isfile() and not member.issym() and not member.islnk() and member.name.startswith('package/') and not q.is_absolute() and '..' not in q.parts and member.name not in seen;seen.add(member.name);b=t.extractfile(member).read();name=key+'/'+str(q.relative_to('package'));assert name not in expected;expected[name]=dict(bytes=b,originalMode=member.mode,origin=row['name']);origin['members']+=1
 origins.append(origin)
rows=[];seen=set();bundled=set();normal=[]
with tarfile.open(archive,'r:gz') as t:
 for member in t.getmembers():
  q=Path(member.name);assert member.isfile() and not member.issym() and not member.islnk() and member.name.startswith('package/') and not q.is_absolute() and '..' not in q.parts and member.name not in seen;seen.add(member.name);rel=str(q.relative_to('package'));b=t.extractfile(member).read();f=source/rel;assert f.is_file() and not f.is_symlink() and f.read_bytes()==b,rel
  if rel.startswith('node_modules/'):
   assert rel in expected,(rel,'undeclared-bundle-member');e=expected[rel];assert b==e['bytes'] and (member.mode&0o111)==(e['originalMode']&0o111),rel;bundled.add(rel);kind='closed-original-archive';origin=e['origin']
  else:kind='ordinary-source';origin=None;normal.append((rel,b,member.mode))
  rows.append(dict(path=rel,bytes=len(b),sha256=hashlib.sha256(b).hexdigest(),mode=oct(member.mode),provenance=kind,origin=origin))
assert bundled==set(expected),(len(bundled),len(expected),'bundle-inventory')
sha=os.environ.get('GITHUB_SHA');git_verified=False
if sha:
 repo=source.parents[1];tree={}
 for line in subprocess.check_output(['git','-C',str(repo),'ls-tree','-rz',sha,'--','packages/wallet-auth']).split(b'\0'):
  if not line:continue
  info,path=line.split(b'\t',1);mode,kind,oid=info.split();assert kind==b'blob';tree[path.decode().removeprefix('packages/wallet-auth/')]=(mode.decode(),oid.decode())
 proc=subprocess.Popen(['git','-C',str(repo),'cat-file','--batch'],stdin=subprocess.PIPE,stdout=subprocess.PIPE)
 for rel,b,mode in normal:
  gm,oid=tree[rel];assert mode==int(gm[-3:],8),rel;proc.stdin.write((oid+'\n').encode());proc.stdin.flush();head=proc.stdout.readline().split();assert head[1]==b'blob';g=proc.stdout.read(int(head[2]));assert proc.stdout.read(1)==b'\n';assert b==g,rel
 proc.stdin.close();assert proc.wait()==0;git_verified=True
result=dict(schema=spec['schema'],archive=dict(file=archive.name,bytes=archive.stat().st_size,sha256=hashlib.sha256(archive.read_bytes()).hexdigest()),members=len(rows),ordinarySourceMembers=len(normal),bundledMembers=len(bundled),bundlePackages=len(origins),allMembersMatchSource=True,ordinaryGitVerified=git_verified,ordinaryGitCommit=sha,bundledOriginalArchivesIntegrityAndEveryMemberVerified=True,noWildcardNodeModules=True,origins=origins,rows=rows,NativeCompiled=False,RootAdmission=False,SourceAdmission=False,realLoginRestoreRevoke=False)
output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k not in ['rows','origins']}))
