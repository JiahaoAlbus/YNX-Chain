#!/usr/bin/env python3
"""Freeze tracked owner HEAD and guarded diagnostics; never runs Go or owners' dirty code."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile


def sha(raw): return hashlib.sha256(raw).hexdigest()


def prepare(owner, commit, output):
    if not re.fullmatch(r"[0-9a-f]{40}", commit): raise ValueError("exact owner HEAD required")
    owner, output = Path(owner), Path(output)
    if not owner.is_absolute() or owner.resolve()!=owner or not output.is_absolute() or output.exists(): raise ValueError("canonical owner/new absolute output required")
    def git(*args): return subprocess.check_output(["git","-C",str(owner),*args],timeout=30)
    if git("rev-parse","HEAD").decode().strip()!=commit: raise ValueError("owner moved; obtain fresh candidate before freezing")
    dirty=git("status","--porcelain","--untracked-files=normal").decode()
    output.mkdir(mode=0o700); source=output/"source";source.mkdir(mode=0o700)
    archive=output/"source.tar"
    with open(archive,"xb") as stream:
        subprocess.run(["git","-C",str(owner),"archive",commit,"go.mod","go.sum","internal","third_party/cometbft"],stdout=stream,check=True,timeout=30)
    with tarfile.open(archive) as bundle: bundle.extractall(source,filter="data")
    leaf=Path(__file__).resolve().parent/"overlays"
    replacements={}; pins={}; patches={}
    hooks={
      "internal/consensus/account_policy.go":[("func DecodePQTransaction(payload []byte) (PQTransaction, []byte, error) {",'defer baselineCount("DecodePQTransaction",uint64(len(payload)),0,0)()')],
      "internal/consensus/account_batch.go":[
        ("func cloneConsensusPQBatches(input map[string]PQCommittedBatch) map[string]PQCommittedBatch {","defer baselineBatches(input)()"),
        ("func cloneBatchTransferCandidate(state executionState) executionState {","defer baselineMember(state)()"),
        ("func (a *Application) applyPQWhole(state executionState, payload, wire []byte, height int64, blockTime time.Time) (executionState, transactionExecution, error) {",'defer baselineCount("applyPQWhole",uint64(len(payload)+len(wire)),0,0)()')],
      "internal/consensus/application.go":[("func cloneExecutionStateValue(state executionState) executionState {",'defer baselineCount("cloneExecutionStateValue",0,0,0)()')]
    }
    for relative,insertions in hooks.items():
        original=(source/relative).read_bytes(); text=original.decode()
        pins[relative]=sha(original)
        for anchor,hook in insertions:
            if text.count(anchor)!=1: raise ValueError("owner callee changed; no forced patch: "+anchor)
            text=text.replace(anchor,anchor+"\n\t"+hook,1)
        target=output/(Path(relative).name+".observed")
        target.write_text(text); replacements[str(source/relative)]=str(target)
        patches[relative]=dict(originalSha256=sha(original),diagnosticSha256=sha(text.encode()),onlyEntryObservers=True)
    for name in ("pq_baseline_probe.go.in","pq_baseline_test.go.in"):
        raw=(leaf/name).read_bytes(); target=output/name;target.write_bytes(raw)
        replacements[str(source/"internal/consensus"/name.removesuffix(".in"))]=str(target)
        pins[name]=sha(raw)
    overlay=output/"overlay.json";overlay.write_text(json.dumps(dict(Replace=replacements))+"\n")
    result=dict(schema="YNX-PQ-CURRENT-BASELINE-PREPARATION/v1",commit=commit,
                tree=git("rev-parse",commit+"^{tree}").decode().strip(),owner=str(owner),
                observedOwnerDirty=dirty,dirtyExcludedFromFrozenSource=True,source=str(source),
                archiveSha256=sha(archive.read_bytes()),pins=pins,diagnosticPatches=patches,
                command=["go","test","-overlay",str(overlay),"-p","1","./internal/consensus","-run","^TestPQCurrentBaseline$","-count=1","-timeout=780s","-v"],
                scope="actual signed local ABCI source stages only; no node processes, consensus finality, Wallet protected signing, hop bytes or sustained TPS")
    (output/"prepared.json").write_text(json.dumps(result,indent=2)+"\n")
    return result


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--owner",required=True);parser.add_argument("--commit",required=True);parser.add_argument("--output",required=True)
    args=parser.parse_args();print(json.dumps(prepare(args.owner,args.commit,args.output)))
