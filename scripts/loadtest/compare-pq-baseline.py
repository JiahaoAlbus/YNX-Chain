#!/usr/bin/env python3
"""Compare complete same-input source states; never compute final chain TPS."""
import argparse
import json
from pathlib import Path


def compare(before,after):
    before,after=Path(before),Path(after)
    receipts=[json.loads((root/"receipt.json").read_bytes()) for root in (before,after)]
    if not all(r.get("sourceMatrixComplete") is True and r.get("cleanupComplete") is True for r in receipts): raise ValueError("both complete actual source matrices and cleanup required")
    if receipts[0]["inputSha256"]!=receipts[1]["inputSha256"]: raise ValueError("original valid public inputs differ")
    rows=[]
    for h in (0,64,256,512):
        for k in (1,16):
            case="H%d-K%d"%(h,k)
            measures=[json.loads((root/(case+"-measure.json")).read_bytes()) for root in (before,after)]
            states=[json.loads((root/(case+"-after.json")).read_bytes()) for root in (before,after)]
            if states[0]!=states[1]: raise ValueError(case+": full committed state differs; no fields projected away")
            for field in ("inputSha256","outerTxHash","memberResults","appHash","blockHeight","historyWholeCount","members","wholeCountInCandidate"):
                if measures[0][field]!=measures[1][field]: raise ValueError(case+": "+field+" differs")
            if measures[0]["inputSha256"]!=receipts[0]["inputSha256"]: raise ValueError(case+": detached input binding")
            phases=[{p["name"]:p for p in m["phases"]} for m in measures]
            if set(phases[0])!=set(phases[1]): raise ValueError("phase inventory differs")
            rows.append(dict(case=case,completeStateEqual=True,
                             phases={name:dict(before=phases[0][name],after=phases[1][name]) for name in phases[0]}))
    return dict(schema="YNX-SAME-INPUT-SOURCE-DIFFERENTIAL/v1",beforeCommit=receipts[0]["sourceCommit"],afterCommit=receipts[1]["sourceCommit"],
                inputSha256=receipts[0]["inputSha256"],cases=rows,
                stableFinalTPS="UNMEASURED",P95FinalConfirmation="UNMEASURED",actualHopBytesPerTx="UNMEASURED",firstSaturatedChainStage="UNMEASURED",
                scope="exact complete local committed-state/member/fee/balance/nonce/AppHash/history and cold-reopen comparisons; network/finality qualification remains separate")


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--before",required=True);parser.add_argument("--after",required=True);parser.add_argument("--output",required=True)
    args=parser.parse_args();result=compare(args.before,args.after)
    with open(args.output,"x") as out:json.dump(result,out,separators=(",",":"));out.write("\n")
