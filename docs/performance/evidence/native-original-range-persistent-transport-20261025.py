"""Reuse TLS only; original frozen archive/range/ETag/CRC/SHA/checkers stay intact."""
from contextlib import contextmanager
from urllib.parse import urlsplit
import http.client,os

class PersistentArtifactOpener:
 def __init__(self,url,factory=http.client.HTTPSConnection):
  if any(os.environ.get(k) for k in ('HTTPS_PROXY','https_proxy','ALL_PROXY','all_proxy')):
   raise RuntimeError('configured proxy requires original transport; no direct override')
  p=urlsplit(url)
  if p.scheme!='https' or p.port not in (None,443) or p.username or p.password or p.fragment or not p.hostname or not (p.hostname.endswith('.blob.core.windows.net') or p.hostname.endswith('.actions.githubusercontent.com')):
   raise RuntimeError('original artifact host/scheme required')
  self.url=url;self.path=p.path+('?' + p.query if p.query else '')
  self.connection=factory(p.hostname,port=443,timeout=15)
  self.requests=0;self.reused=0
 @contextmanager
 def open(self,request,timeout):
  if request.full_url!=self.url or request.get_method()!='GET' or request.data is not None:
   raise RuntimeError('exact original artifact GET required')
  if self.connection.sock is not None:
   self.connection.sock.settimeout(timeout);self.reused+=1
  self.connection.timeout=timeout;self.requests+=1
  try:
   self.connection.request('GET',self.path,headers=dict(request.header_items()))
   response=self.connection.getresponse()
  except BaseException:
   self.connection.close();raise
  try:yield response
  finally:
   reusable=response.isclosed() and not response.will_close
   response.close()
   if not reusable:self.connection.close()
 def close(self):self.connection.close()

def main():
 import argparse,hashlib,importlib.util,json,signal,sys,time
 from pathlib import Path
 sys.dont_write_bytecode=True
 a=argparse.ArgumentParser()
 for name in ('reader','reader-sha','head','destination','cache','proof'):a.add_argument('--'+name,required=True)
 a.add_argument('--artifact-id',type=int,required=True);a.add_argument('--run-id',type=int,required=True)
 a.add_argument('--mode',choices=('unit','network','network-pair'),required=True)
 args=a.parse_args();reader=Path(args.reader);raw=reader.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=args.reader_sha:raise RuntimeError('original frozen reader digest differs')
 spec=importlib.util.spec_from_file_location('original_frozen_reader',reader);core=importlib.util.module_from_spec(spec);spec.loader.exec_module(core)
 signal.signal(signal.SIGALRM,core.recovery_timeout);signal.setitimer(signal.ITIMER_REAL,60);began=time.monotonic();opener=None
 try:
  meta,url=core.original_artifact(args.artifact_id,args.run_id,args.head,args.mode)
  identity=dict(artifactId=meta['id'],name=meta['name'],bytes=meta['size_in_bytes'],runId=args.run_id,head=args.head,digestReportedButNotRecomputed=meta.get('digest'))
  opener=PersistentArtifactOpener(url)
  ranges=core.ExactHTTPRanges(url,identity['bytes'],Path(args.cache),identity,opener=opener);ranges.deadline=began+60
  proof=core.recover(core.Blocks(identity['bytes'],ranges.fetch),Path(args.destination),args.mode)
  proof.update(artifact=identity,networkRangeBytes=ranges.network_bytes,etag=ranges.etag)
  proof['completeReadback']=core.verify_capture(Path(args.destination),args.mode,args.head)
  core.need(time.monotonic()-began<=60,'original60s complete recovery deadline exceeded')
  proof.update(originalReaderSHA256=args.reader_sha,transportAdapterSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),transport='same pinned original HTTPS GET/ranges with connection reuse only; no redirect/retry/proxy bypass',httpRequests=opener.requests,reusedConnectionRequests=opener.reused,elapsedSeconds=time.monotonic()-began)
  with Path(args.proof).open('x') as f:json.dump(proof,f,sort_keys=True);f.write('\n')
  print(json.dumps(dict(complete=True,members=proof['members'],bytes=proof['bytes'],networkRangeBytes=ranges.network_bytes,httpRequests=opener.requests,reusedConnectionRequests=opener.reused,elapsedSeconds=proof['elapsedSeconds'],proof=args.proof)))
 except Exception as e:
  print(json.dumps(dict(recovered=False,firstCause=str(e) if isinstance(e,RuntimeError) else type(e).__name__,networkQualified=False,httpRequests=opener.requests if opener else 0,reusedConnectionRequests=opener.reused if opener else 0,networkRangeBytes=ranges.network_bytes if 'ranges' in locals() else 0)),flush=True);return 1
 finally:
  if opener is not None:opener.close()
  signal.setitimer(signal.ITIMER_REAL,0)
 return 0
if __name__=='__main__':raise SystemExit(main())
