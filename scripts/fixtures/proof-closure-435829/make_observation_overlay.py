#!/usr/bin/env python3
"""Test-only measurements around exact existing calls; no alternate verifier."""
import hashlib, json, pathlib, os
CASE=pathlib.Path(os.environ['YNX_PROOF_CLOSURE_CASE']).resolve(strict=True)
SOURCE=CASE/'composition/source'
VARIANT=os.environ.get('YNX_PROOF_CLOSURE_VARIANT','original')
assert VARIANT in ('original','prepared')
SUFFIX='' if VARIANT=='original' else '-prepared'
OVERLAY=CASE/('observation-overlay'+SUFFIX)
OVERLAY.mkdir()
replacements={} if VARIANT=='original' else json.loads((CASE/'OPTIMIZATION-OVERLAY.json').read_text())['Replace']
ledger=[]

def patch(rel, changes, stages):
    raw=pathlib.Path(replacements.get(str(SOURCE/rel),SOURCE/rel)).read_bytes(); text=raw.decode()
    for old,new in changes:
        assert text.count(old)==1, (rel,old)
        text=text.replace(old,new)
    target=OVERLAY/rel;target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(text)
    replacements[str(SOURCE/rel)]=str(target)
    ledger.append(dict(path=rel,beforeSHA256=hashlib.sha256(raw).hexdigest(),afterSHA256=hashlib.sha256(text.encode()).hexdigest(),stages=stages,change='BEGIN/END observation only; original call and original error branch unchanged'))

def surround(line, stage, endvar):
    return (line,'\t'+endvar+' := proofClosureDiagnosticBegin("'+stage+'")\n'+line+'\n\t'+endvar+'(err)')

patch('cmd/ynx-consensus-proof-verify/trust.go',[
 surround('\tmigration, err := readProofMigration(c.MigrationFile)','migration.read','migrationDone'),
 surround('\tbootstrap, err := consensus.NewConsensusBootstrap(genesisRaw, pins, migration)' if VARIANT=='original' else '\tprepared, err := consensus.PreparePQEngineBootstrap(genesisRaw, pins, migration)','bootstrap.validate','bootstrapDone'),
 surround('\tengine, err := consensus.NewPQEngineAuthorization(scheduleRaw, c.ScheduleHash)','schedule.validate','scheduleDone'),
 surround('\tsource, err := consensus.NewPQEngineFileSourceWithRuntimeUpgrade(migration, c.StateFile, bootstrap, engine, runtime)' if VARIANT=='original' else '\tsource, err := prepared.FileSource(c.StateFile, engine, runtime)','state.sourceConstruction','sourceDone'),
 surround('\tauthority, err := source.ConsensusAuthorityForState(c.ChainID, int64(height), appHash)','state.committedAuthority','authorityDone'),
 surround('\ttrust.TrustedLightBlock, err = consensus.DecodePQTrustedLightBlock(trustedRaw)','trust.lightBlockDecode','trustedDone'),
 ('\tif err = scanJSONDocument(decoder); err != nil {','\tshapeDone := proofClosureDiagnosticBegin("migration.strictShape")\n\terr = scanJSONDocument(decoder)\n\tshapeDone(err)\n\tif err != nil {'),
 ('\tmigration, decodeErr := chain.ReadConsensusMigrationState(stream)','\ttypedDone := proofClosureDiagnosticBegin("migration.typedRead")\n\tmigration, decodeErr := chain.ReadConsensusMigrationState(stream)\n\ttypedDone(decodeErr)')
],['migration.read','migration.strictShape','migration.typedRead','bootstrap.validate','schedule.validate','state.sourceConstruction','state.committedAuthority','trust.lightBlockDecode'])
patch('cmd/ynx-consensus-proof-verify/transaction.go',[
 surround('\tc, expected, err := decodeTransactionTrustContext(contextRaw, o.contextSHA256)','request.trustContextDecode','contextDone'),
 surround('\tproof, err := consensus.DecodePQTransactionProofRequest(request.Proof)','request.proofDecode','proofDone'),
 surround('\ttrust, err := c.LightTrust.load()','trust.load','trustDone'),
 surround('\tverified, err := consensus.VerifyPQTransactionProof(trust, expected, proof)','transaction.verify','transactionDone')
],['request.trustContextDecode','request.proofDecode','trust.load','transaction.verify'])
patch('internal/consensus/pq_transaction_proof.go',[
 surround('\tblockResult, err := VerifyPQLightProof(trust, expected.Block, proof.Block)','light.block','blockDone'),
 surround('\tsuccessorResult, err := VerifyPQLightProof(nextTrust, expected.Successor, proof.Successor)','light.successor','successorDone')
],['light.block','light.successor'])

helper='''//go:build linux && amd64 && ynx_proof_closure_diagnostic

package PACKAGE

import (
 "encoding/json"
 "os"
 "runtime"
 "sync"
 "syscall"
 "time"
)

var proofClosureDiagnosticMu sync.Mutex
var proofClosureDiagnosticEvents uint32

// Diagnostic overlay only. Not included in the original normal binary.
// No error strings, request bodies, paths, heights, signatures or keys.
func proofClosureDiagnosticBegin(stage string) func(error) {
 start := time.Now()
 var initial runtime.MemStats
 runtime.ReadMemStats(&initial)
 emit := func(event string, err error) {
  var mem runtime.MemStats
  runtime.ReadMemStats(&mem)
  var usage syscall.Rusage
  usageErr := syscall.Getrusage(syscall.RUSAGE_SELF, &usage)
  proofClosureDiagnosticMu.Lock()
  defer proofClosureDiagnosticMu.Unlock()
  proofClosureDiagnosticEvents++
  if proofClosureDiagnosticEvents > 64 { panic("diagnostic event bound exceeded") }
  row := struct {
   Version string `json:"version"`
   Component string `json:"component"`
   Stage string `json:"stage"`
   Event string `json:"event"`
   ElapsedNs int64 `json:"elapsedNs"`
   Rejected bool `json:"rejected"`
   AllocatedBytes uint64 `json:"allocatedBytes"`
   HeapAllocBytes uint64 `json:"heapAllocBytes"`
   HeapInuseBytes uint64 `json:"heapInuseBytes"`
   PeakRSSBytes int64 `json:"peakRSSBytes"`
   PeakRSSAvailable bool `json:"peakRSSAvailable"`
  }{"YNX-PROOF-CLOSURE-OFFLINE-OBSERVATION/v1","PACKAGE",stage,event,time.Since(start).Nanoseconds(),err!=nil,mem.TotalAlloc-initial.TotalAlloc,mem.HeapAlloc,mem.HeapInuse,usage.Maxrss*1024,usageErr==nil}
  if json.NewEncoder(os.Stderr).Encode(row)!=nil { panic("diagnostic output failed") }
 }
 emit("BEGIN",nil)
 return func(err error) { emit("END",err) }
}
'''
for package, directory in [('main','cmd/ynx-consensus-proof-verify'),('consensus','internal/consensus')]:
    target=SOURCE/directory/'proof_closure_diagnostic_observer.go'
    expected=helper.replace('PACKAGE',package)
    if VARIANT=='original':
        with target.open('x') as f:f.write(expected)
    else:assert target.read_text()==expected, 'original observer changed'
    ledger.append(dict(path=target.relative_to(SOURCE).as_posix(),beforeSHA256=None,afterSHA256=hashlib.sha256(target.read_bytes()).hexdigest(),change='tagged test-only observer'))
(CASE/('OBSERVATION-OVERLAY'+SUFFIX+'.json')).write_text(json.dumps({'Replace':replacements},indent=2)+'\n')
(CASE/('OBSERVATION-DELTA'+SUFFIX+'.json')).write_text(json.dumps(ledger,indent=2)+'\n')
print('OBSERVATION_READY',len(replacements),'virtual replacements; original production files unchanged')
