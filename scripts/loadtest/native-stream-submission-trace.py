"""Offline complete8192 HTTP trace diagnosis; no RPC, nodes or new admission."""
import hashlib,importlib.util,json,os
from pathlib import Path

MAX_TRACE_RECORDS=8192

def need(value,message):
    if not value:raise RuntimeError(message)

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def pin(path):
    raw=path.read_bytes();return dict(path=str(path),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())

class SubmissionTraceJoin:
    """Retain only bounded HTTP facts, never signed payloads or complete rows.

    Reuse the original finite controller's single-attempt hook validation and
    exact nearest-rank quantiles. Missing/repeated hooks fail this diagnosis;
    they never fabricate zero network wait or change business qualification.
    """
    def __init__(self,total,validator):
        need(type(total) is int and 1<=total<=MAX_TRACE_RECORDS,'explicit bounded trace record count required')
        self.total=total;self.validator=validator;self.rows=[];self.error_stages={}
    def add(self,row):
        need(len(self.rows)<self.total,'submission trace record bound exceeded')
        phases=row.get('submissionPhases')
        need(isinstance(phases,dict),'original submission HTTP trace absent')
        errors=row.get('errors',[])
        need(isinstance(errors,list),'original diagnostic errors must be a list')
        additions={}
        for error in errors:
            need(isinstance(error,dict),'original diagnostic error shape differs')
            stage=error.get('stage');count=error.get('count')
            need(type(stage) is str and 1<=len(stage)<=128 and type(count) is int and 1<=count<=2**31-1,'original diagnostic stage/count differs')
            additions[stage]=additions.get(stage,0)+count
        need(len(self.error_stages.keys()|additions.keys())<=64,'diagnostic stage bound exceeded')
        for stage,count in additions.items():self.error_stages[stage]=self.error_stages.get(stage,0)+count
        self.rows.append(dict(submissionPhases=dict(phases),checkTxMs=row.get('checkTxMs')))
    def result(self):
        need(len(self.rows)==self.total,'complete original submission trace coverage required')
        result=self.validator(dict(observerPhaseTiming=True,transactions=self.rows),self.total)
        totals={k:dict(samples=0,totalNs=0,minNs=None,maxNs=None) for k in result['durationsMs']}
        for row in self.rows:
            p=row['submissionPhases'];get,got,wrote,first,end=(p[k] for k in ('firstGetConnNs','firstGotConnNs','firstWroteRequestNs','firstResponseByteNs','callbackReturnNs'))
            values=dict(beforeGetConnMs=get,connectionAcquireMs=got-get,connectionToWriteMs=wrote-got,firstByteToReturnMs=end-first,callbackReturnMs=end)
            if first>=wrote:values['writeToFirstByteMs']=first-wrote
            for name,value in values.items():
                item=totals[name];item['samples']+=1;item['totalNs']+=value;item['minNs']=value if item['minNs'] is None else min(item['minNs'],value);item['maxNs']=value if item['maxNs'] is None else max(item['maxNs'],value)
        for name,item in totals.items():
            need(item['samples']==result['durationsMs'][name]['samples'],'trace interval denominator differs')
            item['meanNs']=item['totalNs']/item['samples'] if item['samples'] else None
        groups={}
        for label,reused in (('reused',True),('new',False)):
            values=sorted(row['submissionPhases']['firstGotConnNs']-row['submissionPhases']['firstGetConnNs'] for row in self.rows if row['submissionPhases']['firstConnReused'] is reused)
            n=len(values);groups[label]=dict(samples=n,totalNs=sum(values),meanNs=sum(values)/n if n else None,**{name:values[(n*pct+99)//100-1] if n else None for name,pct in (('p50Ns',50),('p95Ns',95),('p99Ns',99))})
        need(sum(g['samples'] for g in groups.values())==self.total and sum(g['totalNs'] for g in groups.values())==totals['connectionAcquireMs']['totalNs'],'connection reuse group coverage differs')
        result.update(connectionAcquireByReuse=groups,intervalTotalsNs=totals,maximumRetainedTraceRecords=MAX_TRACE_RECORDS,errorOccurrences=sum(self.error_stages.values()),errorOccurrencesByStage=dict(sorted(self.error_stages.items())),networkOrSustainedQualificationAdded=False)
        return result

def diagnose(source_packet,case,qualified_path):
    source_packet=source_packet.resolve();case=case.resolve();qualified_path=qualified_path.resolve()
    current=load('current_trace_stream_reader',Path(__file__).with_name('native-stream-evidence.py'))
    qualified_raw=current.capture(qualified_path,2<<20);qualified=current.strict_json(qualified_raw)
    need(qualified.get('nativePairQualified') is True and qualified.get('slotReturned') is True,'original qualified pair required separately')
    grant_path=source_packet/'original-root-grant.json';grant_raw=current.capture(grant_path,64<<10);grant=current.strict_json(grant_raw)
    need(current.digest(grant_raw)==qualified['originalGrantSHA256'] and grant['sourceCommit']==qualified['sourceCommit'],'original grant/source binding differs')
    request_path=Path(grant['request']['path']);request_raw=current.capture(request_path,128<<10)
    need(len(request_raw)==grant['request']['bytes'] and current.digest(request_raw)==grant['request']['sha256'],'original request binding differs')
    request=current.strict_json(request_raw);reader_dir=source_packet/'frozen-readers/scripts/loadtest'
    for name in ('scripts/loadtest/supply-linux-window.py','scripts/loadtest/native-stream-evidence.py'):
        raw=current.capture(source_packet/'frozen-readers'/name,1<<20);ref=request['frozenReaders'][name]
        need(len(raw)==ref['bytes'] and current.digest(raw)==ref['sha256'],'frozen source reader differs')
    controller=load('frozen_trace_controller',reader_dir/'supply-linux-window.py')
    receipt_raw=current.capture(case/'evidence/actual.json',16<<20);receipt=current.strict_json(receipt_raw)
    need(receipt['sourceCommit']==qualified['sourceCommit'] and current.digest(receipt_raw) in {c['receipt']['sha256'] for c in qualified['cases']},'case receipt outside original qualified pair')
    network=case/'network';client_raw=current.capture(network/'transactions-result.json',16<<20);client=current.strict_json(client_raw)
    need(current.digest(client_raw)==receipt['resultSHA256'],'original client result SHA differs')
    tip_selection=dict(expected_block_tip_hint=receipt['nativeBlockTipHint']) if 'nativeBlockTipHint' in receipt else {}
    measured=controller.validate_native_stream_report(client,network,runtime_network=Path(receipt['case'])/'network',pacing=receipt['pacingMode'],expected_input_reuse=receipt['nativeCurrentInputReuse'],expected_canonical_certificate=receipt.get('nativeCanonicalCertificate',False),expected_native_suffix=receipt.get('nativeSuffixSetup',False),**tip_selection)
    need(measured==receipt['measurement'],'complete original frozen readback differs')
    join=SubmissionTraceJoin(8192,controller.validate_submission_phases)
    manifest=current.capture(network/'network-manifest.json',1<<20);initial=current.strict_json(current.capture(network/'transactions.json',16<<20))['transactions']
    proof=current.verify_streams(network,Path(receipt['case'])/'network',Path(receipt['case'])/'network/transactions-result.json',manifest,initial,client['readySenders']['intentSegments'],client['terminalStream'],client['transactions'],4,64<<20,measure_latency=True,submission_trace_join=join)
    need(proof['originalPublicMemberManifest']==measured['streamEvidence']['originalPublicMemberManifest'],'HTTP fold changed original complete identities')
    trace=proof['submissionTraceJoin'];need(trace['intervalTotalsNs']['callbackReturnMs']['totalNs']==proof['rowMetrics']['callbackReturnNs'],'HTTP fold lost original callback coverage')
    need(trace['errorOccurrences']==client['summary']['errorOccurrences'],'complete original diagnostic error coverage differs')
    return dict(schema=1,kind='original_complete_native_stream_HTTP_trace_diagnosis',runId=qualified['runId'],sourceCommit=qualified['sourceCommit'],nativeSuffixSetup=receipt.get('nativeSuffixSetup',False),canonicalCertificate=receipt.get('nativeCanonicalCertificate',False),**(dict(nativeBlockTipHint=True) if receipt.get('nativeBlockTipHint',False) is True else {}),originalQualifiedPair=dict(path=str(qualified_path),bytes=len(qualified_raw),sha256=current.digest(qualified_raw)),originalReceiptSHA256=current.digest(receipt_raw),originalClientSHA256=current.digest(client_raw),originalPublicMemberManifest=proof['originalPublicMemberManifest'],submissionTrace=trace,originalBusinessSummary=client['summary'],submissionOccupancy=client['submissionOccupancy'],consumer=pin(Path(__file__).resolve()),streamReader=pin(Path(__file__).with_name('native-stream-evidence.py').resolve()),frozenController=pin(reader_dir/'supply-linux-window.py'),networkOrSustainedQualificationAdded=False,interpretation='Offline full8192 signed/terminal identity join. Original monotonic HTTP hook boundaries include transport/server/client scheduling and response decode. Hook overlaps retain separate denominators; quantiles and worker wall totals are not additive. Original poll errorOccurrences remain in business summary, independent of zero terminal business failures.')

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source-packet',type=Path,required=True);parser.add_argument('--case',type=Path,required=True);parser.add_argument('--qualified-pair',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    result=diagnose(args.source_packet,args.case,args.qualified_pair)
    fd=os.open(args.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as handle:json.dump(result,handle,indent=2);handle.write('\n');handle.flush();os.fsync(handle.fileno())
    print(json.dumps(dict(samples=result['submissionTrace']['samples'],output=pin(args.output),networkOrSustainedQualificationAdded=False)))
