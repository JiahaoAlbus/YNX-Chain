#!/usr/bin/env python3
"""Fixed private Supply probe; default prints a recipe and launches nothing.

Linux evidence is a separate environment, never a matched Darwin comparison.
Reuse the original native resource monitor without changing its global caps.
"""
import argparse
import base64
import ctypes
import errno
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import time
from urllib.request import build_opener, ProxyHandler, HTTPRedirectHandler
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("pq_native", HERE / "pq-paired-linux-window.py")
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
PROFILE = dict(name="supply-256x4", senders=256, rounds=4, offeredRate=512,
               concurrency=4, observers=4, activeMs=45000, cleanupMs=15000,
               totalMs=60000, ownedProcesses=10, longLivedChildren=9,
               ownedRSSBytes=1 << 30, privateBytes=32 << 20, threads=320,
               availableMemoryFloorBytes=native.CAPS["availableMemoryFloorBytes"])
PROFILES = {"supply-256x4": PROFILE,
            "supply-512x2": dict(PROFILE, name="supply-512x2", senders=512, rounds=2),
            "supply-2048x1": dict(PROFILE, name="supply-2048x1", senders=2048, rounds=1, offeredRate=1000, senderMode="rounds")}
# A separate opt-in diagnostic budget, never selected by fallback from a failed case.
ONESHOT_PROFILES = ("supply-2048x1", "supply-2048x1-data64")
PROFILES[ONESHOT_PROFILES[1]] = dict(PROFILES[ONESHOT_PROFILES[0]], name=ONESHOT_PROFILES[1], privateBytes=64 << 20)
ENV = dict(GOMAXPROCS="1", GOGC="100", GOMEMLIMIT="off")
BINARIES = ("ynx-abci", "cometbft", "ynx-consensus-perf-fixture", "ynx-consensus-perf-client")
PAIR_CAPS = dict(totalMs=120000, retainedBytes=64 << 20, logBytes=2 << 20,
                 buildBytes=1 << 30, metadataReserveMs=500)


def recipe(transport="socket", profile_name="supply-256x4", pacing="relative", observer_phases=False, shared_replay=None, endpoint_fair=None, endpoint_elastic=None, prefix_replay=None, prefix_native_clone=None,native_submit8=False,native_suffix_setup=False,observer_native_facts=False,client_procs2=False,require_client_runtime=False):
    if prefix_native_clone is not None and (type(prefix_native_clone) is not bool or prefix_native_clone and prefix_replay is not True):
        raise RuntimeError("native clone requires explicit prefix replay selection")
    if type(native_submit8) is not bool or native_submit8 and (prefix_native_clone is not True or prefix_replay is not True):
        raise RuntimeError("submit8 requires explicit native prefix selection")
    if type(native_suffix_setup) is not bool or native_suffix_setup and not native_submit8:raise RuntimeError("native suffix setup requires explicit native8 mode")
    if type(observer_native_facts) is not bool or observer_native_facts and (not native_submit8 or native_suffix_setup):raise RuntimeError("observer native facts require original native8 setup")
    if type(client_procs2) is not bool or type(require_client_runtime) is not bool or client_procs2 and not observer_native_facts:raise RuntimeError("client procs2 requires explicit observer native facts")
    one_shot=profile_name in ONESHOT_PROFILES
    if prefix_replay is not None and (type(prefix_replay) is not bool or prefix_replay and profile_name!="supply-2048x1-data64"):
        raise RuntimeError("prefix replay requires the explicit data64 profile")
    if one_shot and (transport!="grpc" or pacing!="relative" or observer_phases is not True or shared_replay is not None and shared_replay is not (prefix_replay is not True) or endpoint_fair is not None or endpoint_elastic is not None):
        raise RuntimeError("2048x1 requires explicit grpc/relative/observer phases/exclusive replay without endpoint candidates")
    if one_shot:shared_replay=prefix_replay is not True
    if transport not in ("socket", "grpc"):
        raise RuntimeError("only existing socket/grpc ABCI transports allowed")
    if profile_name not in PROFILES:
        raise RuntimeError("only registered fixed Supply profiles allowed")
    if profile_name == "supply-512x2" and transport != "grpc":
        raise RuntimeError("the new 512x2 profile is explicitly gRPC only")
    if pacing not in ("relative", "bounded-cadence", "grouped-cadence4") or pacing != "relative" and profile_name != "supply-512x2":
        raise RuntimeError("bounded cadence is explicit fixed512x2/gRPC only")
    profile = dict(PROFILES[profile_name], name=profile_name + ("-grpc" if transport == "grpc" else "") + ("-"+pacing if pacing != "relative" else ""))
    if native_submit8:profile["concurrency"]=8
    result = dict(schema=1, profile=profile, abciTransport=transport, pacingMode=pacing,
                pacingCatchupOfferLimit=4 if pacing != "relative" else 1, environment=ENV, execute=False,
                requiresSeparateRootGrant=True, nodesStarted=False,
                platform="Linux native /proc; not macOS pressure1",
                comparison="Independent private CI case; no Darwin before/after multiplier",
                resourceCaps=native.CAPS,
                input="workflow_dispatch.run_linux_supply (default false)")
    if profile_name == "supply-2048x1-data64":
        result["resourceCaps"] = dict(native.CAPS, privateBytes=64 << 20)
        result["capacityScope"] = dict(explicitProfileOnly=True, automaticRetry=False,
            priorFailedRun=39161413763, priorFinalPrivateBytes=40191359,
            priorProfile="supply-2048x1", noPerformanceQualification=True)
    if prefix_replay is True:result["prefixDurableReplay"]=True
    if prefix_native_clone is True:result["prefixNativeClone"]=True
    if native_submit8:result["nativeSubmit8"]=True
    if native_suffix_setup:result["nativeSuffixSetup"]=True
    if observer_native_facts:result["observerNativeFacts"]=True
    if client_procs2:result["clientProcs2"]=True
    if require_client_runtime or client_procs2:result["expectedClientGOMAXPROCS"]=2 if client_procs2 else 1
    if observer_phases:
        result["observerPhaseTiming"]=True
        result["observerTraceLimits"]=dict(perWorker=256,aggregate=1024,totalsCompleteDespiteTraceCap=True)
    if shared_replay is not None:
        if type(shared_replay) is not bool or not observer_phases or (transport,profile_name,pacing) not in (("grpc","supply-512x2","bounded-cadence"),("grpc","supply-2048x1","relative"),("grpc","supply-2048x1-data64","relative")):
            raise RuntimeError("shared replay selection requires fixed512x2/grpc/bounded-cadence and observer timing")
        result["sharedDurableReplay"]=shared_replay
    if endpoint_fair is not None:
        if type(endpoint_fair) is not bool or shared_replay is not True:
            raise RuntimeError("fairness comparison requires explicit shared replay and its fixed timed profile")
        result["endpointFairSubmission"]=endpoint_fair
    if endpoint_elastic is not None:
        if type(endpoint_elastic) is not bool or type(endpoint_fair) is not bool or shared_replay is not True or endpoint_elastic and endpoint_fair is not True:
            raise RuntimeError("elastic endpoint selection requires explicit shared replay/timed profile and fairness")
        result["endpointElasticSubmission"]=endpoint_elastic
    return result


def prepare_shared_replay_pair():
    selected=recipe("grpc","supply-512x2","bounded-cadence",True)
    return dict(schema=1,name="prepared-same-VM-shared-replay-pair",execute=False,
                executionAuthorized=False,executionAdmitted=False,nodesStarted=False,
                selected=selected,pairCaps=PAIR_CAPS,executionRecipe=pair_recipe("independent-shared"),
                before=dict(observerPhaseTiming=True,sharedDurableReplay=False),
                after=dict(observerPhaseTiming=True,sharedDurableReplay=True,
                           extraClientArgument="-shared-durable-replay"),
                cache=dict(entries=1,canonicalByteLimit=16 << 20,inFlightLimit=4,
                           exactCurrentContent=True,privateStateCloneAndFullValidation=True,
                           signaturesFeeNonceAndPublishedInfoUnchanged=True),
                priorActual=dict(runId=39145119313,source="1a071fe7ab021e3e9535ea12395df40b97d968af",
                                 receiptSHA256="5e991c731b053fee329f94c2ef2ea24ac76460a6716f8c1727105f96b494d334",
                                 role="diagnostic only, not the before side of a future pair"),
                admission="Preparation only. Candidate peak RSS not measured; extra canonical bytes/private decode states are not an RSS bound. Original1GiB RSS/32MiB data caps stay unchanged. Future pair needs actual fresh admission, a separate Root grant through the integrated original pair wrapper.",
                comparison="Same source/VM/ELFs/caps/profile, observer timing on both sides. Preserve original full business and joint latency/rate guards; finite case never qualifies sustained1000TPS.")


PAIR_MODES = {"relative-bounded": ("relative", "bounded-cadence"),
              "bounded-grouped": ("bounded-cadence", "grouped-cadence4"),
              "independent-shared": ("independent-replay", "shared-replay"),
              "shared-fair": ("shared-baseline", "shared-endpoint-fair"),
              "shared-elastic": ("shared-baseline", "shared-endpoint-elastic"),
              "shared-prefix-data64": ("shared-replay", "prefix-replay"),
              "prefix-native-data64": ("prefix-control", "prefix-native-clone"),
              "native-submit8-data64": ("native-submit4", "native-submit8"),
              "native-suffix-data64": ("native-suffix-control", "native-suffix-candidate"),
              "native-observer-facts-data64": ("native-observer-control", "native-observer-facts"),
              "native-client-procs2-data64": ("native-client-procs1", "native-client-procs2")}
DATA64_PAIRS=("shared-prefix-data64","prefix-native-data64","native-submit8-data64","native-suffix-data64","native-observer-facts-data64","native-client-procs2-data64")


def pair_modes(comparison):
    if comparison not in PAIR_MODES:
        raise RuntimeError("only registered fixed comparison pairs allowed")
    return PAIR_MODES[comparison]


def prepare_1000_tier():
    evidence_path=HERE.parents[1]/"docs/performance/evidence/bounded-grouped-pair-ci-39142884319-actual.json"
    if native.digest(evidence_path)!="41d69a66a36db3270d91ca7267e1e0e9e3ff3da3e5b3dd92c67e43c4c909b004":
        raise RuntimeError("tier budget actual prior evidence pin differs")
    evidence=json.loads(native.bounded(evidence_path,1 << 20))
    peak_data=max(c["peaks"]["privateBytes"] for c in evidence["cases"])
    peak_rss=max(c["peaks"]["rssBytes"] for c in evidence["cases"])
    fixture_path=HERE.parents[1]/"docs/performance/evidence/fixture2048-ci-39151370359-actual.json"
    if native.digest(fixture_path)!="fbfc6e702e541fa41c0631d741e4521fc7762c52f7bb8653bc9c2961f0ce0c13":
        raise RuntimeError("actual2048 fixture resource evidence pin differs")
    fixture=json.loads(native.bounded(fixture_path,1 << 20))
    return dict(schema=1,name="one-shot-2048-independent-senders-offer1000",execute=False,
                executionAuthorized=False,executionAdmitted=False,nodesStarted=False,
                workload=dict(independentSenders=2048,totalTransactions=2048,transactionsPerSender=1,
                              rounds=1,senderMode="rounds",offeredRate=1000,concurrency=4,observers=4,
                              clientTimeoutMs=10000,inclusionMode="block-scan",observerPhaseTiming=True,sharedDurableReplay=True),
                resourceCaps={k:PROFILE[k] for k in ("activeMs","cleanupMs","totalMs","ownedProcesses","longLivedChildren","ownedRSSBytes","privateBytes","threads","availableMemoryFloorBytes")},
                nativeAdmissionCaps={k:native.CAPS[k] for k in ("diskFloorBytes","rootReserveBytes","compileReserveBytes","buildBytes","logBytes","sampleMs")},
                fixtureCommand=["<exact-built-fixture>","-ephemeral","-count","2048","-output","<new-private-network>"],
                clientCommand=["<exact-built-client>","-manifest","<new-private-network>/network-manifest.json",
                               "-transactions","<new-private-network>/transactions.json","-output","<new-private-network>/transactions-result.json",
                               "-rounds","1","-sender-mode","rounds","-offered-rate","1000","-concurrency","4","-observers","4",
                               "-timeout","10s","-inclusion-mode","block-scan","-observer-phase-timing","-shared-durable-replay"],
                priorActual=dict(runId=39142884319,sourceCommit=evidence["sourceCommit"],
                                 evidenceSHA256=native.digest(evidence_path),totalTransactions=1024,
                                 independentSenders=512,peakPrivateBytes=peak_data,peakRSSBytes=peak_rss),
                actualFixtureResources=dict(runId=39151370359,sourceCommit=fixture["sourceCommit"],evidenceSHA256=native.digest(fixture_path),
                    fixtureBytes=fixture["fixtureResources"]["totalFixtureBytes"],privateIncludingEvidenceBytes=fixture["sampledPeaks"]["privateBytes"],
                    fixtureGeneratorRSSBytes=fixture["stages"]["generator"]["peaks"]["rssBytes"],buildRSSBytes=fixture["stages"]["build"]["peaks"]["rssBytes"],
                    nodesStarted=False,nodeReaderRuntimePeakStillUnknown=True,
                    scope="Actual2048 fixture build/generation fit original sampled caps. This is not four-node/reader/history/measurement-driver admission."),
                conservativeScenarios=dict(twicePriorPrivateBytes=2*peak_data,twicePriorRSSBytes=2*peak_rss,
                    dataScenarioExceedsExisting32MiB=2*peak_data>PROFILE["privateBytes"],
                    rssScenarioExceedsExisting1GiB=2*peak_rss>PROFILE["ownedRSSBytes"]),
                admissionReasons=["Actual2048 fixture resources are measured above. No actual2048 four-node/reader/runtime peak exists. Historical twice-prior scenarios are not upper bounds or permanent vetoes on a separately granted bounded measurement.",
                                  "Historical2x data scenario exceeds original32MiB; measured2048 fixture is smaller than32MiB. Runtime DB, signed execution/history, reader, reports and cleanup growth still need actual charging. No cap increase or data deletion is authorized.",
                                  "Fixture generator/build RSS are actual measured phases, not a4node RSS estimate. Fixed4node/worker and variable account/history costs are not assumed linear. Existing1GiB guard remains mandatory; runtime fit remains unproven.",
                                  "Owned-process/thread, disk reserve, logs,45+15 window and actual MemAvailable guards remain unchanged. No workload starts from this plan."],
                registeredExecutionRecipe=recipe("grpc","supply-2048x1","relative",True),
                interpretation="Finite2048 signed business inputs, each with a distinct sender/nonce1. Configured1000offers/s is not accepted/included/final TPS and does not establish ten-minute capacity. Registered as a separate explicit bounded2048x1 window with original caps; no execution/admission follows preparation. Actual node/reader/data peaks still require its own Root-granted measurement.")


def fixture_resource_recipe():
    return dict(schema=1,kind="2048-independent-sender-fixture-resources-only",execute=False,
                nodesStarted=False,networkExecutionAdmitted=False,fixtureOnly=True,
                profile=dict(PROFILE,name="fixture-2048x1-only",senders=2048,rounds=1),
                resourceCaps=native.CAPS,environment=ENV,
                workload=dict(independentSenders=2048,totalTransactions=2048,transactionsPerSender=1,
                              futureConfiguredOfferRate=1000),
                generatedBy="original cmd/ynx-consensus-perf-fixture -ephemeral -count2048; no retained sender keys",
                measurements="Original guard samples owned build/generator process RSS/threads, all private data/evidence and build/tmp plus incremental shared Go cache bytes. Preexisting shared cache is recorded separately; filesystem free/reserve includes its whole footprint.",
                interpretation="Fixture generation/structural readback only, no application/node/server/client workload starts. No business inclusion/finality or sustained TPS. Actual node/reader growth and2048 network peak remain unmeasured even if this fixture fits.")


def fixture_resource_readout(network):
    manifest=validate_manifest(json.loads(native.bounded(network/"network-manifest.json",1 << 20)),network)
    payload=native.bounded(network/"transactions.json",8 << 20)
    rows=json.loads(payload).get("transactions",[])
    if len(rows)!=2048 or (network/"ephemeral-sender-secrets.json").exists():
        raise RuntimeError("exact2048 fixture without retained sender keys required")
    senders=set();recipients=set()
    for item in rows:
        if not isinstance(item,str):raise RuntimeError("fixture transaction encoding missing")
        wire=base64.b64decode(item,validate=True)
        if base64.b64encode(wire).decode()!=item or not 1<=len(wire)<=65536:
            raise RuntimeError("fixture canonical bounded envelope missing")
        tx=json.loads(wire)
        if (tx.get("chainId")!=6423 or tx.get("nonce")!=1 or tx.get("type")!="transfer"
                or tx.get("amount")!=1 or tx.get("fee")!=1 or not tx.get("signature") or not tx.get("publicKey")
                or not tx.get("from") or not tx.get("to") or tx["from"] in senders):
            raise RuntimeError("independent nonce1 signed fixture shape differs")
        senders.add(tx["from"]);recipients.add(tx["to"])
    if len(senders)!=2048 or len(recipients)!=1 or any(Path(n["abciStatePath"]).exists() for n in manifest["nodes"]):
        raise RuntimeError("fixture sender/recipient shape differs or node state unexpectedly exists")
    migration_path=Path(manifest["migrationPath"])
    migration=json.loads(native.bounded(migration_path,16 << 20))
    accounts={a["address"]:a for a in migration.get("accounts",[])}
    if any(addr not in accounts or accounts[addr].get("nonce")!=0 or accounts[addr].get("balance",0)<2 for addr in senders):
        raise RuntimeError("fixture migration sender balance/nonce coverage differs")
    files=[];categories={}
    for f in sorted(network.rglob("*")):
        if f.is_symlink():raise RuntimeError("fixture artifact symlink refused")
        if not f.is_file():continue
        name=str(f.relative_to(network))
        category=("migration-account-data" if f==migration_path else "signed-transactions" if f.name=="transactions.json" else "genesis-copies" if f.name=="genesis.json" else "node-config-and-key-scaffolding")
        size=f.stat().st_size;categories[category]=categories.get(category,0)+size
        files.append(dict(path=name,bytes=size,sha256=native.digest(f),category=category))
    return dict(independentSenders=len(senders),recipients=len(recipients),transactions=2048,nonce=1,
                migrationAccounts=len(migration.get("accounts",[])),categories=categories,files=files,
                totalFixtureBytes=sum(categories.values()),nodesStarted=False,
                signatureScope="Original generator signs actual envelopes. This Python readback checks canonical identity/count/nonce and file hashes, not an independent cryptographic signature verifier. No execution success is asserted.",
                scalingScope="Migration/account data and signed envelopes are actual account-dependent bytes; fixed four-node scaffolding and genesis copies are classified by path, not assumed constant per-account. Node runtime/reader/history growth is unmeasured.")


def pair_recipe(comparison="relative-bounded"):
    if comparison == "native-client-procs2-data64":
        selected=pair_recipe("native-observer-facts-data64")
        selected.update(kind="fixed-same-VM-native-client-procs2-data64-pair",
            cases=[recipe("grpc","supply-2048x1-data64","relative",True,prefix_replay=True,prefix_native_clone=True,native_submit8=True,observer_native_facts=True,client_procs2=flag,require_client_runtime=True) for flag in (False,True)],
            order="native-client-procs1 then native-client-procs2; sequential, no second case after any first-case refusal",
            input=dict(selected["input"],linux_supply_pacing="paired-native-client-procs2-data64"),
            interpretation="Only explicit client-local GOMAXPROCS1 versus2 changes. Require actual typed runtime values on both original reports. Both retain observer native facts,original suffix setup,8submitters/4observers/original queues,node GOMAXPROCS1 and original resource caps. No throughput gain or sustained1000 qualification is presumed.")
        return selected
    if comparison == "native-observer-facts-data64":
        selected=pair_recipe("native-submit8-data64")
        selected.update(kind="fixed-same-VM-native-observer-facts-data64-pair",
            cases=[recipe("grpc","supply-2048x1-data64","relative",True,prefix_replay=True,prefix_native_clone=True,native_submit8=True,observer_native_facts=flag) for flag in (False,True)],
            order="native-observer-control then native-observer-facts; sequential, no second case after any first-case refusal",
            input=dict(selected["input"],linux_supply_pacing="paired-native-observer-facts-data64"),
            interpretation="Both cases original native suffix setup,8submitters/4observers/original2048queues and original caps. Only second reuses decoder-owned successful expected-chain+digest+full-byte signature facts. Misses retain original verification and every current-state fee/nonce/height/context check remains. Separate actual observer counters, unchanged replay bounds/counters; finite only, not sustained1000 acceptance.")
        return selected
    if comparison == "native-suffix-data64":
        selected=pair_recipe("native-submit8-data64")
        selected.update(kind="fixed-same-VM-native-suffix-data64-pair",
            cases=[recipe("grpc","supply-2048x1-data64","relative",True,prefix_replay=True,prefix_native_clone=True,native_submit8=True,native_suffix_setup=flag) for flag in (False,True)],
            order="native-suffix-control then native-suffix-candidate; sequential, no second case after any first-case refusal",
            input=dict(selected["input"],linux_supply_pacing="paired-native-suffix-data64"),
            interpretation="Same native private clone,8 submitters/4 observers,2048 signed inputs,offer1000 and original queues/caps. Only suffix initialization changes: original NewApplication versus explicit private initializer. Full migration/state validation, private migration clone, execution/signatures and durable/quorum gates retained. Finite only, no sustained1000 claim.")
        return selected
    if comparison == "native-submit8-data64":
        selected=pair_recipe("prefix-native-data64")
        selected.update(kind="fixed-same-VM-native-submit8-data64-pair",
            cases=[recipe("grpc","supply-2048x1-data64","relative",True,prefix_replay=True,prefix_native_clone=True,native_submit8=flag) for flag in (False,True)],
            order="native-submit4 then native-submit8; sequential, no second case after any first-case refusal",
            input=dict(selected["input"],linux_supply_pacing="paired-native-submit8-data64"),
            interpretation="Same native-copy backend,2048 signed inputs,offer1000,4 observers and actual per-input queue capacities. Only explicit submit worker count4 versus8 differs; original process/RSS/time/evidence guards unchanged. No added transaction attempt, retry or UNKNOWN promotion; finite only, not sustained1000TPS qualification.")
        return selected
    if comparison == "prefix-native-data64":
        selected=pair_recipe("shared-prefix-data64")
        selected.update(kind="fixed-same-VM-prefix-native-data64-pair",
            cases=[recipe("grpc","supply-2048x1-data64","relative",True,prefix_replay=True,prefix_native_clone=flag) for flag in (False,True)],
            order="prefix-control then prefix-native-clone; never concurrent; stop after failed or unclean first case",
            input=dict(selected["input"],linux_supply_pacing="paired-prefix-native-data64"),
            interpretation="Same source/VM/ELFs/environment/native signed workload and unchanged data64 caps; only explicit private reconstruction differs. Native cache object inventory is not RSS; original owned RSS sampler charges all decoded state. Preserve all original business/signature/quorum/durable/queue-inclusive latency and adverse samples. Finite only, no sustained1000TPS qualification.")
        return selected
    if comparison == "shared-prefix-data64":
        return dict(schema=1,kind="fixed-same-VM-shared-prefix-data64-pair",execute=False,
                    requiresSeparateRootGrant=True,nodesStarted=False,
                    pairCaps=dict(PAIR_CAPS,retainedBytes=128 << 20),
                    cases=[recipe("grpc","supply-2048x1-data64","relative",True,prefix_replay=flag) for flag in (False,True)],
                    order="shared-replay then prefix-replay; never concurrent; stop after failed or unclean first case",
                    binaries="same exact four ELF files, built once before pair runtime",
                    input=dict(run_linux_supply=True,linux_supply_transport="grpc",linux_supply_profile="supply-2048x1-data64",linux_supply_pacing="paired-shared-prefix-data64",measure_observer_phases=True,prefix_durable_replay=False),
                    timing="120s total including both cases, receipt fsync and double empty closures; each case45s active+15s cleanup including fsync<=60s. Remaining time can only shorten admission.",
                    admission="Explicit pair128MiB retained including all case/aggregate receipts; each case64MiB, RSS1GiB, threads320, process10, logs1MiB, pair logs2MiB, build1GiB. Fresh native floors plus initial128MiB aggregate disk reserve. Original default pair64MiB unchanged. No grant or admission implied.",
                    interpretation="Same source/VM/ELFs/environment/workload policy and caps; only replay backend differs. Fresh private fixtures have different identities and startup/block scheduling. Preserve all2048 original business proofs per side, raw stage timing and queue-inclusive inclusion/final tails including negative results. Finite comparison, never sustained1000TPS qualification.")
    if comparison == "shared-elastic":
        selected=pair_recipe("shared-fair")
        selected.update(kind="fixed-same-VM-elastic-endpoint-pair",
                        cases=[recipe("grpc","supply-512x2","bounded-cadence",True,True,flag,flag) for flag in (False,True)],
                        order="shared-baseline then shared-endpoint-elastic; never concurrent; stop after failed or unclean first case",
                        input=dict(run_linux_supply=True,linux_supply_transport="grpc",linux_supply_profile="supply-512x2",linux_supply_pacing="paired-shared-elastic",measure_observer_phases=True),
                        interpretation="Same source/VM/ELFs/caps; original shared submission queue versus explicit elastic endpoint policy. Shared replay, observer and original HTTP boundary timing on both sides. Four workers and total queue unchanged; candidate limit2 per unchanged index%4 authority. Preserve all1024 original business, raw stage/queue/CheckTx quantiles and joint tail guards. Finite only, no sustained1000TPS claim.")
        return selected
    before, after = pair_modes(comparison)
    if comparison == "shared-fair":
        selected=pair_recipe("independent-shared")
        selected.update(kind="fixed-same-VM-endpoint-fairness-pair",
                        cases=[recipe("grpc","supply-512x2","bounded-cadence",True,True,flag) for flag in (False,True)],
                        order="shared-baseline then shared-endpoint-fair; never concurrent; stop after failed or unclean first case",
                        input=dict(run_linux_supply=True,linux_supply_transport="grpc",linux_supply_profile="supply-512x2",linux_supply_pacing="paired-shared-fair",measure_observer_phases=True),
                        interpretation="Shared replay and observer timing on both sides, same current source/VM/ELFs and fixed512x2 profile. Only endpoint-fair-submission changes; original clients[index%4], four submitters, queue capacity and safety gates remain. Compare original submission queue/CheckTx P95/P99 as well as inclusion/final quantiles and rates. Fixed order/fresh fixture variation applies; no sustained1000TPS inference.")
        return selected
    if comparison == "independent-shared":
        return dict(schema=1,kind="fixed-same-VM-shared-replay-pair",execute=False,
                    requiresSeparateRootGrant=True,nodesStarted=False,pairCaps=PAIR_CAPS,
                    cases=[recipe("grpc","supply-512x2","bounded-cadence",True,flag) for flag in (False,True)],
                    order="independent-replay then shared-replay; never concurrent; stop after failed or unclean first case",
                    binaries="same exact four ELF files, built once before pair runtime",
                    input=dict(run_linux_supply=True,linux_supply_transport="grpc",linux_supply_profile="supply-512x2",linux_supply_pacing="paired-independent-shared",measure_observer_phases=True),
                    timing="Original120s total including both guards, all raw receipt fsync, two empty closures and terminal fsync. Each case45s active+15s cleanup, invocation including fsync<=60s; remaining global time may shorten admission only.",
                    admission="Fresh native MemAvailable/disk/process/thread/RSS/data/log guards unchanged. Candidate canonical clone peak unmeasured; sampled guard may refuse during candidate work. This recipe does not assert admission or a hard RSS bound.",
                    interpretation="Same current source/VM/ELFs and fixed512x2 profile, timing on both sides; only shared replay flag changes. Two fresh fixtures have different identities/startup order. Actual finite joint rate+latency guards required; no sustained1000TPS inference.")
    return dict(schema=1, kind="fixed-same-VM-pacing-pair" if comparison == "relative-bounded" else "fixed-same-VM-grouping-pair", execute=False,
                requiresSeparateRootGrant=True, nodesStarted=False, pairCaps=PAIR_CAPS,
                cases=[recipe("grpc", "supply-512x2", mode) for mode in (before, after)],
                order=before+" then "+after+"; never concurrent; stop after any failed or unclean first case",
                binaries="same exact four ELF files, built once before pair runtime",
                input=dict(run_linux_supply=True, linux_supply_transport="grpc", linux_supply_profile="supply-512x2", linux_supply_pacing="paired-"+comparison),
                timing="Both case guards, raw receipt fsync, empty closure checks and pair receipt fsync count toward120s. Per-case invocation including fsync must also stay within60s. Remaining global time can shorten admission, never extend a case.",
                interpretation="Two fresh private fixtures with matched generation policy on one actual VM. Startup order and random fixture identities differ; finite paired observation, not sustained capacity or a generalized speedup.")


class PairBudget:
    """Fixed pair accounting in the original wrapper, not a new job framework."""
    def __init__(self, root, evidence, started, build, comparison="relative-bounded"):
        self.root, self.evidence, self.started = root, evidence, started
        self.build, self.active_case = build, root
        self.caps = pair_recipe(comparison)["pairCaps"]
        self.data64 = comparison in DATA64_PAIRS
        before, after = pair_modes(comparison)
        self.case_names = ("before-"+before, "after-"+after)
        self.deadline = started + self.caps["totalMs"]/1000
        self.samples = []

    def remaining(self):
        return self.deadline-time.monotonic()

    def io_timeout(self):
        remaining = self.remaining()-self.caps["metadataReserveMs"]/1000
        if remaining <= 0:
            raise RuntimeError("pair120s metadata budget exhausted")
        return min(5, remaining)

    def observe(self, sample=None):
        if self.remaining() <= 0:
            raise RuntimeError("pair120s total deadline exceeded")
        if sample is None:
            sample = native_sample(self.active_case, self.build, {}, self.started,enforce_limits=not self.data64)
        native.enforce(sample,private_bytes_cap=64 << 20 if self.data64 else None)
        if self.data64 and not self.samples and sample["freeDiskBytes"] < (native.CAPS["diskFloorBytes"]+native.CAPS["rootReserveBytes"]+native.CAPS["compileReserveBytes"]+self.caps["retainedBytes"]):
            raise RuntimeError("pair128MiB initial disk reserve failed")
        roots = (self.root, self.evidence)
        retained = sum(native.directory_bytes(p) for p in roots)
        # The original per-case log cap covers child stdout/stderr directly in
        # its case root. LevelDB *.log files below network/ are durable DB/WAL
        # data, already charged to each32MiB and the aggregate64MiB data caps.
        logs = sum(p.stat().st_size for case_name in self.case_names
                   for p in (self.root/case_name).glob("*.log"))
        if retained > self.caps["retainedBytes"]:
            raise RuntimeError("combined pair retained%dMiB cap exceeded" % (self.caps["retainedBytes"] >> 20))
        if logs > self.caps["logBytes"]:
            raise RuntimeError("combined pair child stdout/stderr log2MiB cap exceeded")
        row = dict(elapsedMs=int((time.monotonic()-self.started)*1000), retainedBytes=retained, logBytes=logs)
        row.update({k:sample[k] for k in ("rssBytes", "threads", "availableMemoryBytes", "freeDiskBytes", "buildBytes")})
        self.samples.append(row)
        if self.remaining() <= 0:
            raise RuntimeError("pair120s exceeded during guard I/O")


def empty_pair_closure(budget):
    scans = []
    for _ in range(2):
        budget.observe()
        rows, _ = native.proc_inventory()
        ids = native.owned_set(rows, os.getpid())
        if ids != [os.getpid()]:
            raise RuntimeError("pair prior owned closure is not empty; second case forbidden")
        scans.append(dict(elapsedMs=int((time.monotonic()-budget.started)*1000), owned=ids,
                          launcherStartTicks=rows[os.getpid()]["startTicks"]))
        time.sleep(.05)
    return scans


def pair_case_qualified(row, mode, profile="supply-512x2", total=1024,native_submit8=False,native_suffix_setup=False,observer_native_facts=False,client_procs2=False,require_client_runtime=False):
    if row.get("clientProcs2",False) is not client_procs2:raise RuntimeError("pair client scheduler selection differs")
    if require_client_runtime or client_procs2:
        runtime_receipt=row.get("clientRuntimeVerification") or {}
        if type(runtime_receipt.get("gomaxprocs")) is not int or runtime_receipt.get("clientProcs2") is not client_procs2:raise RuntimeError("pair client runtime receipt is not typed")
        if row.get("clientRuntimeVerification")!={"clientProcs2":client_procs2,"gomaxprocs":2 if client_procs2 else 1}:raise RuntimeError("pair client actual runtime receipt differs")
    if type(observer_native_facts) is not bool or row.get("observerNativeFacts",False) is not observer_native_facts:raise RuntimeError("pair observer native selection differs")
    if type(native_suffix_setup) is not bool or row.get("nativeSuffixSetup",False) is not native_suffix_setup:raise RuntimeError("pair native suffix selection differs")
    if row.get("nativeSubmit8",False) is not native_submit8:raise RuntimeError("pair submit8 selection differs")
    expected_profile=recipe("grpc",profile,mode,profile in ONESHOT_PROFILES,**(dict(prefix_replay=True,prefix_native_clone=True,native_submit8=True) if native_submit8 else {}))["profile"]
    if row.get("firstCause") is not None or row.get("cleanupComplete") is not True or row.get("nodesStarted") is not True:
        raise RuntimeError("pair case failed or cleanup incomplete")
    if row.get("pacingMode") != mode or row.get("abciTransport") != "grpc" or row.get("profile") != expected_profile:
        raise RuntimeError("pair case fixed configuration mismatch")
    m = row.get("measurement", {})
    if (any(m.get("summary", {}).get(k) != total for k in ("input", "offered", "submitted", "checkTxAccepted", "effectiveBusinessIncluded", "quorumConfirmed", "finalSubmitted"))
            or any(m.get("summary", {}).get(k) != 0 for k in ("submissionUnknown", "timedOut", "notSubmitted", "executionFailed", "checkTxRejected", "checkTxUnverifiedResponses", "observationFailed"))
            or len(row.get("nodePhases", [])) != 4):
        raise RuntimeError("pair case incomplete business results; no second case")


def offer_latency_readout(report,total=1024):
    rows = report.get("transactions", [])
    if len(rows) != total or report.get("summary", {}).get("finalSubmitted") != total:
        raise RuntimeError("complete actual business results required for offer latency")
    def quantiles(key):
        values=[]
        for row in rows:
            queue, stage = row.get("queueDelayMs"), row.get(key)
            if any(type(v) not in (int,float) or not math.isfinite(v) or v < 0 for v in (queue,stage)):
                raise RuntimeError("actual measured offer queue/stage latency missing/invalid")
            value=queue+stage
            if not math.isfinite(value): raise RuntimeError("offer latency overflow")
            values.append(value)
        values.sort()
        return dict(samples=total, **{name:values[math.ceil(q*total)-1] for name,q in (("p50",.5),("p95",.95),("p99",.99))})
    peaks=report.get("loadQueues",{})
    for name in ("peakOfferedAwaitingSubmission", "peakAcceptedAwaitingObservationCompletion"):
        if type(peaks.get(name)) is not int or not 0 <= peaks[name] <= total:
            raise RuntimeError("actual owned queue peak missing/invalid")
    return dict(offerToEffectiveInclusionLatencyMs=quantiles("inclusionMs"),
                offerToQualifiedFinalLatencyMs=quantiles("confirmationMs"), actualQueuePeaks=peaks,
                supply=report["readySenders"]["supply"],
                scope=f"Actual per-row measured queueDelayMs+stageMs, nearest-rank over all{total} qualified business finals. Queue peaks are original atomic counters, not reconstructed from UTC.")


def validate_observer_phases(report):
    if report.get("observerPhaseTiming") is not True:
        raise RuntimeError("explicit observer timing absent")
    stats=report.get("groupedObservation",{}); phases=stats.get("phases",{})
    totals=phases.get("totals",{})
    allowed={"tx_query","block_query","commit_query","validators_query","quorum_verification",
             "block_results_query","block_capture_and_merkle","block_envelope_verification",
             "transaction_inclusion_proof","durable_business_batch","published_info_query","published_state_verification"}
    if phases.get("schema")!=1 or not totals or set(totals)-allowed or type(phases.get("traceCapped")) is not bool:
        raise RuntimeError("observer timing schema/phase inventory missing")
    for row in totals.values():
        if (set(row)!={"attempts","errors","durationNs"} or any(type(v) is not int or v<0 for v in row.values())
                or row["errors"]>row["attempts"] or row["attempts"]>0 and row["durationNs"]<=0):
            raise RuntimeError("invalid original observer phase attempts/time")
    for phase,counter in (("tx_query","transactionQueries"),("block_query","blockQueries"),
                          ("commit_query","commitQueries"),("validators_query","validatorQueries"),
                          ("quorum_verification","quorumVerifications"),("block_results_query","blockResultsQueries"),
                          ("durable_business_batch","durableBatches"),("published_info_query","publishedInfoQueries")):
        if type(stats.get(counter)) is not int or totals.get(phase,{}).get("attempts",0)!=stats[counter]:
            raise RuntimeError("observer phase count differs from existing call counter: "+phase)
    if totals.get("transaction_inclusion_proof",{}).get("attempts",0)<report["summary"]["finalSubmitted"]:
        raise RuntimeError("per-transaction proof timing coverage missing")
    trace=phases.get("trace")
    if not isinstance(trace,list) or not 0<len(trace)<=1024:
        raise RuntimeError("bounded observer call trace missing")
    for row in trace:
        if (row.get("phase") not in allowed or any(type(row.get(k)) is not int or row[k]<0 for k in ("sequence","worker","node","height","members","startOffsetNs","durationNs"))
                or row["worker"]>3 or row["node"]>3 or row["sequence"]<1 or type(row.get("failed")) is not bool):
            raise RuntimeError("invalid monotonic original observer call trace")
    reader=report.get("durableReadback",{}).get("phaseTotalsNs")
    names={"loadNs","hashNs","captureNs","decodeNs","indexPublishNs","transactionVerifyNs"}
    if not isinstance(reader,dict) or set(reader)!=names or any(type(v) is not int or v<=0 for v in reader.values()):
        raise RuntimeError("actual durable readback child phases missing")
    return dict(observer=phases,durableReader=reader,
                interpretation="Original call wall times include server/transport/lock waits; trace may be explicitly capped while totals remain complete. Reader load includes children. Parallel workers and nested scopes are not additive BFT latency.")


def validate_shared_replay(report, expected, require_work_phases=False):
    if type(expected) is not bool or report.get("sharedDurableReplay") is not expected or report.get("observerPhaseTiming") is not True:
        raise RuntimeError("actual shared replay selection/timing differs")
    reader=report.get("durableReadback",{})
    stats=reader.get("sharedReplay")
    if not expected:
        if stats is not None:
            raise RuntimeError("independent replay baseline unexpectedly enabled shared cache")
        return dict(sharedDurableReplay=False,stats=None)
    names={"lookups","hits","joins","fullReplays","failures","bypasses","waitNs","cachedCanonicalBytes","canonicalByteLimit","peakFlights"}
    if not isinstance(stats,dict) or set(stats) not in (names,names|{"workPhases"}) or any(type(stats.get(k)) is not int or stats[k]<0 for k in names):
        raise RuntimeError("shared replay actual bounded counters missing/invalid")
    if (stats["canonicalByteLimit"]!=16 << 20 or stats["cachedCanonicalBytes"]>16 << 20
            or not 1<=stats["peakFlights"]<=4 or stats["fullReplays"]<1
            or stats["failures"]>stats["fullReplays"]
            or stats["hits"]+stats["joins"]+stats["fullReplays"]>stats["lookups"]
            or stats["lookups"]!=reader.get("snapshotValidations")):
        raise RuntimeError("shared replay work counts/retention bound differ")
    work=stats.get("workPhases")
    if require_work_phases and "workPhases" not in stats:
        raise RuntimeError("actual shared replay work phases required")
    if "workPhases" in stats:
        phases={"produce","canonicalCopy","privateJSON","privateValidate"}
        if not isinstance(work,dict) or set(work)!=phases|{"canonicalCopyBytes"} or type(work.get("canonicalCopyBytes")) is not int or work["canonicalCopyBytes"]<0:
            raise RuntimeError("shared replay work phases missing/invalid")
        for name in phases:
            phase=work.get(name)
            if (not isinstance(phase,dict) or set(phase)!={"calls","errors","durationNs"}
                    or any(type(v) is not int or v<0 for v in phase.values()) or phase["errors"]>phase["calls"]
                    or phase["calls"]==0 and (phase["durationNs"]!=0 or phase["errors"]!=0)
                    or phase["calls"]>0 and phase["durationNs"]<=0):
                raise RuntimeError("shared replay work phase counters invalid")
        produce,copy,decode,validate=(work[k] for k in ("produce","canonicalCopy","privateJSON","privateValidate"))
        if (not stats["fullReplays"]<=produce["calls"]<=stats["fullReplays"]+stats["bypasses"]
                or produce["calls"]>stats["lookups"] or copy["errors"]!=0 or copy["calls"]>stats["lookups"]
                or decode["calls"]>stats["hits"]+stats["joins"] or copy["calls"]<decode["calls"]
                or validate["calls"]!=decode["calls"]-decode["errors"]
                or copy["calls"]==0 and work["canonicalCopyBytes"]!=0):
            raise RuntimeError("shared replay work counts differ from original replay/copy paths")
    if any(row.get("durableStoreFormat")!="block-journal" for row in report.get("transactions",[])):
        raise RuntimeError("shared replay comparison requires actual block-journal business readback")
    return dict(sharedDurableReplay=True,stats=stats,
                interpretation="Counters describe actual work, not logical replayed history. Clone/flight counts are not a physical RSS bound; original sampled guards still apply. No hit or lower work count alone qualifies performance.")


def validate_prefix_replay(report,expected,require_work_phases=False,expected_native_clone=False,expected_native_suffix=False):
    validate_native_suffix_selection(report,expected_native_suffix)
    if (type(expected_native_clone) is not bool or report.get("prefixNativeClone",False) is not expected_native_clone
            or expected_native_clone and expected is not True):
        raise RuntimeError("actual native clone selection differs")
    if type(expected) is not bool or report.get("prefixDurableReplay",False) is not expected:
        raise RuntimeError("actual prefix replay selection differs")
    reader=report.get("durableReadback",{});stats=reader.get("prefixReplay")
    if not expected:
        if stats is not None:raise RuntimeError("unselected prefix replay counters present")
        return dict(prefixDurableReplay=False,stats=None)
    names={"calls","successfulFullReplays","successfulPrefixReuses","failures","durationNs","replayedBlocks","replayedTransactionInputs","canonicalByteLimit"}
    if (report.get("sharedDurableReplay") is not False or report.get("observerPhaseTiming") is not True or reader.get("sharedReplay") is not None
            or not isinstance(stats,dict) or set(stats) not in ((names|{"workPhases","nativeCloneCache"}|({"nativeSuffixSetup"} if expected_native_suffix else set()),) if expected_native_clone else (names,names|{"workPhases"})) or any(type(stats[k]) is not int or stats[k]<0 for k in names)
            or stats["calls"]!=reader.get("snapshotValidations") or stats["calls"]<1 or stats["durationNs"]<=0
            or stats["calls"]!=stats["successfulFullReplays"]+stats["successfulPrefixReuses"]+stats["failures"]
            or stats["successfulFullReplays"]<1 or stats["successfulPrefixReuses"]<1 or stats["canonicalByteLimit"]!=16<<20
            or stats["replayedBlocks"]!=reader.get("blockJournalReplayedBlocks")
            or stats["replayedTransactionInputs"]!=reader.get("blockJournalReplayedTransactionInputs")):
        raise RuntimeError("prefix replay successful work counters/bounds missing or inconsistent")
    phases=stats.get("workPhases")
    if (require_work_phases or expected_native_clone) and phases is None:raise RuntimeError("actual prefix child phases required")
    if phases is not None:
        phase_names={"gateWait","prefixCheck","privateJSON","privateValidate","fullReplay","suffixSetup","suffixReplay","suffixEncode","canonicalCopy","certificatePublish"}
        if expected_native_clone:phase_names.add("privateNativeClone")
        if not isinstance(phases,dict) or set(phases)!=phase_names:raise RuntimeError("prefix phase inventory differs")
        for phase in phases.values():
            if (not isinstance(phase,dict) or set(phase)!={"calls","errors","durationNs"}
                    or any(type(v) is not int or v<0 for v in phase.values()) or phase["errors"]>phase["calls"] or phase["calls"]>stats["calls"]
                    or phase["calls"]==0 and (phase["errors"]!=0 or phase["durationNs"]!=0) or phase["calls"]>0 and phase["durationNs"]<=0):raise RuntimeError("invalid actual prefix phase counts/time")
        def calls(name):return phases[name]["calls"]
        def success(name):return calls(name)-phases[name]["errors"]
        native_calls=calls("privateNativeClone") if expected_native_clone else 0
        native_success=success("privateNativeClone") if expected_native_clone else 0
        if (calls("prefixCheck")>success("gateWait") or calls("privateJSON")+native_calls+calls("fullReplay")!=calls("prefixCheck")
                or calls("privateValidate")!=success("privateJSON")+native_success or calls("suffixSetup")+calls("canonicalCopy")>success("privateValidate")
                or calls("suffixReplay")!=success("suffixSetup") or calls("suffixEncode")!=success("suffixReplay")
                or calls("certificatePublish")>success("fullReplay")+success("suffixEncode")
                or sum(p["durationNs"] for p in phases.values())>stats["durationNs"]):raise RuntimeError("prefix child phases differ from actual sequential branches/parent time")
    if expected_native_clone:
        cache=stats.get("nativeCloneCache")
        keys={"canonicalBytes","height","accounts","feeEvents","lotEntries"}
        if (not isinstance(cache,dict) or set(cache)!=keys|{"snapshotPresent"} or cache["snapshotPresent"] is not True
                or any(type(cache[k]) is not int or cache[k]<0 for k in keys)
                or not 0<cache["canonicalBytes"]<=16<<20 or cache["height"]<1
                or cache["accounts"]<report.get("summary",{}).get("input",0)
                or cache["feeEvents"]<report.get("summary",{}).get("input",0)
                or phases["privateNativeClone"]["calls"]<1
                or any(cache["height"]<t.get("durableStateHeight",0) for t in report.get("transactions",[]))):
            raise RuntimeError("actual native clone retained cache inventory differs")
    facts=reader.get("blockJournalNativeVerificationFacts",{})
    if (facts.get("capacity")!=4096 or facts.get("string_byte_limit")!=4<<20
            or type(facts.get("entries")) is not int or not 1<=facts["entries"]<=4096
            or type(facts.get("retained_string_bytes")) is not int or not 0<=facts["retained_string_bytes"]<=4<<20
            or type(facts.get("successful_verifications")) is not int or facts.get("successful_verifications")!=report.get("summary",{}).get("input")
            or type(facts.get("lookups")) is not int or type(facts.get("hits")) is not int or facts["hits"]<0
            or facts["lookups"]!=facts["hits"]+facts["successful_verifications"]):
        raise RuntimeError("prefix replay original native verification facts differ")
    if any(t.get("durableStoreFormat")!="block-journal" for t in report.get("transactions",[])):
        raise RuntimeError("prefix replay requires original block-journal business readback")
    result=dict(prefixDurableReplay=True,stats=stats,interpretation="Successful full and reused-prefix outputs are separate; failed partial work is not included in completed block/input counts. Counters are not physical RSS or finality.")
    if expected_native_clone:result["prefixNativeClone"]=True
    return result


def validate_client_runtime(report,expected=False,require=False):
    if report.get("nativeStream8",False) is not False:
        raise RuntimeError("finite Supply controller cannot qualify the separate native streaming workload")
    if type(expected) is not bool or type(require) is not bool or report.get("clientProcs2",False) is not expected:
        raise RuntimeError("actual client scheduler selection differs")
    if expected and (report.get("observerNativeFacts") is not True or report.get("nativeSubmit8") is not True
            or report.get("prefixNativeClone") is not True or report.get("prefixDurableReplay") is not True
            or report.get("nativeSuffixSetup",False) is not False or report.get("sharedDurableReplay") is not False):
        raise RuntimeError("client procs2 backend selection differs")
    actual=report.get("gomaxprocs")
    if require or expected:
        if type(actual) is not int or actual!=(2 if expected else 1):raise RuntimeError("actual client GOMAXPROCS differs or missing")
        return dict(clientProcs2=expected,gomaxprocs=actual)
    return None


def validate_observer_native_facts(report,expected=False):
    if type(expected) is not bool or report.get("observerNativeFacts",False) is not expected:
        raise RuntimeError("observer native facts selection differs")
    reader=report.get("durableReadback") or {};stats=reader.get("observerNativeFacts")
    if not expected:
        if stats is not None:raise RuntimeError("unselected observer native counters present")
        return dict(observerNativeFacts=False,stats=None)
    names={"lookups","hits","misses","fallbackMathVerifications","fallbackFailures"}
    if (report.get("nativeSubmit8") is not True or report.get("prefixNativeClone") is not True or report.get("prefixDurableReplay") is not True
            or report.get("nativeSuffixSetup",False) is not False or report.get("sharedDurableReplay") is not False
            or not isinstance(stats,dict) or set(stats)!=names|{"enabled"} or stats.get("enabled") is not True
            or any(type(stats[k]) is not int or stats[k]<0 for k in names)
            or stats["lookups"]!=stats["hits"]+stats["misses"] or stats["hits"]<1 or stats["fallbackFailures"]!=0
            or stats["misses"]!=stats["fallbackMathVerifications"] or stats["lookups"]!=reader.get("transactionVerifications")
            or type(reader.get("transactionVerifications")) is not int or stats["lookups"]!=2048):
        raise RuntimeError("actual observer native signature work/configuration differs")
    return dict(observerNativeFacts=True,stats=stats)

def validate_native_suffix_selection(report,expected=False):
    actual=report.get("nativeSuffixSetup",False)
    stats=report.get("durableReadback",{}).get("prefixReplay") or {}
    if type(expected) is not bool or actual is not expected or stats.get("nativeSuffixSetup",False) is not expected:
        raise RuntimeError("actual native suffix initialization selection differs")
    if expected and (report.get("nativeSubmit8") is not True or report.get("prefixNativeClone") is not True or report.get("prefixDurableReplay") is not True):
        raise RuntimeError("native suffix initialization requires selected native8 backend")
    return dict(nativeSuffixSetup=expected)

def validate_submitter_selection(report,expected=False,require_inventory=False,total=2048):
    if type(expected) is not bool or report.get("nativeSubmit8",False) is not expected:
        raise RuntimeError("actual submit8 selection differs")
    if expected and (type(report.get("concurrency")) is not int or type(report.get("observerConcurrency")) is not int or report.get("concurrency")!=8 or report.get("observerConcurrency")!=4 or report.get("prefixNativeClone") is not True or report.get("prefixDurableReplay") is not True):
        raise RuntimeError("submit8 requires actual native8/four observer selection")
    inventory=report.get("pacedWorkers")
    if inventory is None:
        if expected or require_inventory:raise RuntimeError("actual paced worker/queue inventory required")
    else:
        keys={"submitters","observers","submissionQueueCapacity","observationQueueCapacities"}
        if (report.get("prefixNativeClone") is not True or not isinstance(inventory,dict) or set(inventory)!=keys
                or any(type(inventory[k]) is not int for k in keys-{"observationQueueCapacities"})
                or inventory["submitters"]!=(8 if expected else 4) or inventory["submitters"]!=report.get("concurrency")
                or inventory["observers"]!=4 or inventory["observers"]!=report.get("observerConcurrency")
                or inventory["submissionQueueCapacity"]!=total or not isinstance(inventory["observationQueueCapacities"],list)
                or len(inventory["observationQueueCapacities"])!=4
                or any(type(v) is not int or v!=total for v in inventory["observationQueueCapacities"])):
            raise RuntimeError("actual paced worker/queue inventory differs")
    return dict(nativeSubmit8=expected,pacedWorkers=inventory)


def validate_runtime_measurements(report,total=2048,require=False,native_submit8=False):
    validate_submitter_selection(report,native_submit8,total=total)
    cpu=report.get("processCPU");occupancy=report.get("submissionOccupancy")
    if cpu is None and occupancy is None and not require:return None
    if not isinstance(cpu,dict) or not isinstance(occupancy,dict):raise RuntimeError("actual CPU and submission occupancy required")
    cpu_names={"available","samples","userNs","systemNs","totalNs","measurementWallNs","sampleBracketWallNs","sampleBracketOverheadNs","cpuPercentOfOneCore","scope"}
    cpu_ints=cpu_names-{"available","cpuPercentOfOneCore","scope"}
    window=report.get("summary",{}).get("measurementWindowSeconds")
    if (set(cpu)!=cpu_names or cpu.get("available") is not True or cpu.get("samples")!=2 or type(cpu.get("scope")) is not str or not cpu.get("scope")
            or any(type(cpu.get(k)) is not int or cpu[k]<0 for k in cpu_ints)
            or type(window) not in (int,float) or not math.isfinite(window) or window<=0 or abs(cpu["measurementWallNs"]-window*1e9)>1
            or cpu["measurementWallNs"]<=0 or cpu["sampleBracketWallNs"]<cpu["measurementWallNs"] or cpu["sampleBracketOverheadNs"]!=cpu["sampleBracketWallNs"]-cpu["measurementWallNs"]
            or cpu["totalNs"]<=0 or cpu["totalNs"]!=cpu["userNs"]+cpu["systemNs"] or type(cpu.get("cpuPercentOfOneCore")) not in (int,float)
            or not math.isfinite(cpu["cpuPercentOfOneCore"]) or abs(cpu["cpuPercentOfOneCore"]-100*cpu["totalNs"]/cpu["sampleBracketWallNs"])>1e-9):raise RuntimeError("invalid actual process CPU counter/bracket facts")
    names={"callbackStarted","callbackReturned","activeCallbacksAtEnd","peakActiveCallbacks","callbackBusyNs","queueWaitSamples","queueWaitNs","peakQueueWaitNs","measurementWallNs","scope"}
    rows=report.get("transactions",[])
    if (set(occupancy)!=names or type(occupancy.get("scope")) is not str or not occupancy.get("scope") or any(type(occupancy.get(k)) is not int or occupancy[k]<0 for k in names-{"scope"})
            or occupancy["measurementWallNs"]!=cpu["measurementWallNs"] or occupancy["callbackStarted"]!=total or occupancy["callbackReturned"]!=total
            or occupancy["queueWaitSamples"]!=total or occupancy["activeCallbacksAtEnd"]!=0 or not 1<=occupancy["peakActiveCallbacks"]<=report.get("concurrency",0)
            or len(rows)!=total or not 0<occupancy["callbackBusyNs"]<=report["concurrency"]*occupancy["measurementWallNs"]):raise RuntimeError("invalid actual submission callback occupancy")
    queue=[r.get("queueDelayMs") for r in rows]
    callbacks=[r.get("submissionPhases",{}).get("callbackReturnNs") for r in rows]
    if (any(type(v) not in (int,float) or not math.isfinite(v) or v<0 for v in queue) or any(type(v) is not int or v<0 for v in callbacks)
            or abs(occupancy["queueWaitNs"]-sum(queue)*1e6)>total or abs(occupancy["peakQueueWaitNs"]-max(queue)*1e6)>1
            or occupancy["callbackBusyNs"]<sum(callbacks)):raise RuntimeError("runtime occupancy differs from original per-row intervals")
    return dict(processCPU=cpu,submissionOccupancy=occupancy,interpretation="Process CPU includes all client/runtime work; callback wall busy times overlap. Neither isolates pure server/network cost or BFT finality. Queue intervals bind all original rows.")


def original_endpoint_binding(report,total):
    endpoints=report.get("endpoints",[])
    if len(endpoints)!=4 or len(set(endpoints))!=4:
        raise RuntimeError("four distinct original endpoint identities required")
    for value in endpoints:
        endpoint(value)
        if urlparse(value).scheme!="http":raise RuntimeError("original RPC HTTP endpoint required")
    rows=report.get("transactions",[])
    if len(rows)!=total or any(row.get("index")!=i or row.get("endpoint")!=endpoints[i%4] for i,row in enumerate(rows)):
        raise RuntimeError("original per-index endpoint binding differs")
    return endpoints


def validate_endpoint_dispatch(report, expected, elastic=False):
    if type(elastic) is not bool or elastic and not expected or report.get("endpointElasticSubmission",False) is not elastic:
        raise RuntimeError("actual elastic endpoint selection absent/different")
    if type(expected) is not bool or report.get("endpointFairSubmission") is not expected:
        raise RuntimeError("actual endpoint fairness selection absent/different")
    original_endpoint_binding(report,1024)
    stats=report.get("readySenders",{}).get("endpointDispatch")
    if not expected:
        if stats is not None:raise RuntimeError("baseline unexpectedly enabled endpoint dispatch")
    else:
        names={"workers","perEndpointInFlightLimit","queueCapacityTotal","callbackAttempts","callbackReturns"}
        if elastic:names|={"peakInFlight","peakTotalInFlight"}
        if (not isinstance(stats,dict) or set(stats)!=names
                or any(type(stats.get(k)) is not int or stats[k]!=v for k,v in (("workers",4),("perEndpointInFlightLimit",2 if elastic else 1),("queueCapacityTotal",1024)))
                or any(not isinstance(stats.get(k),list) or stats[k]!=[256]*4 or any(type(v) is not int for v in stats[k]) for k in ("callbackAttempts","callbackReturns"))):
            raise RuntimeError("actual original worker/queue/callback bounds differ")
        if elastic:
            peaks=stats["peakInFlight"];total=stats["peakTotalInFlight"]
            if (not isinstance(peaks,list) or len(peaks)!=4 or any(type(v) is not int or not 1<=v<=2 for v in peaks)
                    or type(total) is not int or not max(peaks)<=total<=min(4,sum(peaks))):
                raise RuntimeError("actual elastic callback peaks exceed original worker/endpoint bounds")
    return dict(endpointFairSubmission=expected,originalEndpointBindingVerified=True,stats=stats,
                interpretation="Actual callback counts are not extra RPC or business successes; original1024-result business qualification is required separately. No request authority replacement or automatic UNKNOWN retry.")


def validate_submission_phases(report,total=1024):
    rows=report.get("transactions",[])
    if report.get("observerPhaseTiming") is not True or len(rows)!=total:
        raise RuntimeError("all1024 original timed submission rows required")
    counters=("getConnCalls","gotConnCalls","wroteRequestCalls","firstByteCalls")
    offsets=("firstGetConnNs","firstGotConnNs","firstWroteRequestNs","firstResponseByteNs","callbackReturnNs")
    metrics={name:[] for name in ("beforeGetConnMs","connectionAcquireMs","connectionToWriteMs","writeToFirstByteMs","firstByteToReturnMs","callbackReturnMs")}
    reused=overlap=0
    for row in rows:
        p=row.get("submissionPhases")
        if (not isinstance(p,dict) or set(p)!=set(counters+offsets+("writeErrors","firstConnReused"))
                or any(type(p[k]) is not int or p[k]!=1 for k in counters)
                or type(p["writeErrors"]) is not int or p["writeErrors"]!=0
                or any(type(p[k]) is not int or p[k]<0 for k in offsets)
                or type(p["firstConnReused"]) is not bool):
            raise RuntimeError("original single-attempt HTTP phase facts absent/invalid")
        get,got,wrote,first,end=(p[k] for k in offsets)
        wall=row.get("checkTxMs")
        if (not get<=got<=min(wrote,first) or max(wrote,first)>end
                or type(wall) not in (int,float) or not math.isfinite(wall) or wall<0 or end+1<wall*1e6):
            raise RuntimeError("HTTP monotonic boundaries differ from original callback duration")
        reused+=p["firstConnReused"]
        for name,value in (("beforeGetConnMs",get),("connectionAcquireMs",got-get),("connectionToWriteMs",wrote-got),("firstByteToReturnMs",end-first),("callbackReturnMs",end)):
            metrics[name].append(value/1e6)
        if first>=wrote:metrics["writeToFirstByteMs"].append((first-wrote)/1e6)
        else:overlap+=1
    def quantiles(values):
        values=sorted(values);n=len(values)
        return dict(samples=n,**{name:values[math.ceil(q*n)-1] if n else None for name,q in (("p50",.5),("p95",.95),("p99",.99))})
    return dict(samples=total,hookCalls={key:total for key in counters},writeErrors=0,
                reusedConnections=reused,writeFirstByteHookOverlaps=overlap,
                durationsMs={key:quantiles(values) for key,values in metrics.items()},
                interpretation="Monotonic original client HTTP hooks; single-attempt rows only. First-byte wait includes server/transport scheduling; response tail includes body/decode/identity checks. Concurrent write/first-byte hooks may overlap: omit negative intervals and retain their count/sample denominator. Not pure network/server time and not additive across parallel callbacks.")


def original_submission_tails(report,total=1024):
    rows=report.get("transactions",[])
    if len(rows)!=total:
        raise RuntimeError("all1024 original rows required for submission tail readback")
    result={}
    for summary_key,row_key in (("submissionQueueDelayMs","queueDelayMs"),("checkTxLatencyMs","checkTxMs")):
        values=[row.get(row_key) for row in rows]
        if any(type(v) not in (int,float) or not math.isfinite(v) or v<0 for v in values):
            raise RuntimeError("original submission tail duration absent/invalid: "+row_key)
        values.sort()
        observed=dict(samples=total,**{name:values[math.ceil(q*total)-1] for name,q in (("p50",.5),("p95",.95),("p99",.99))})
        if report.get("summary",{}).get(summary_key)!=observed:
            raise RuntimeError("submission tail summary differs from original raw rows: "+summary_key)
        result[summary_key]=observed
    return result


def dispatch_tail_observation(before, after, joint):
    metrics={}
    for key in ("submissionQueueDelayMs","checkTxLatencyMs"):
        rows=[]
        for case in (before,after):
            row=case.get("summary",{}).get(key,{})
            if row.get("samples")!=1024 or any(type(row.get(q)) not in (int,float) or not math.isfinite(row[q]) or row[q]<0 for q in ("p50","p95","p99")):
                raise RuntimeError("complete actual queue/CheckTx percentile facts required")
            rows.append(row)
        metrics[key]=dict(before=rows[0],after=rows[1],p95NotWorse=rows[1]["p95"]<=rows[0]["p95"],p99NotWorse=rows[1]["p99"]<=rows[0]["p99"])
    inclusion=after["offerLatency"]["offerToEffectiveInclusionLatencyMs"]["p99"]<=before["offerLatency"]["offerToEffectiveInclusionLatencyMs"]["p99"]
    final=after["offerLatency"]["offerToQualifiedFinalLatencyMs"]["p99"]<=before["offerLatency"]["offerToQualifiedFinalLatencyMs"]["p99"]
    tails=all(row["p95NotWorse"] and row["p99NotWorse"] for row in metrics.values())
    return dict(metrics=metrics,offerToInclusionP99NotWorse=inclusion,offerToFinalP99NotWorse=final,
                finiteJointAndTailImprovement=joint["finiteJointImprovementObserved"] and tails and inclusion and final,
                sustainedTPSQualified=False,
                interpretation="Finite actual same-VM comparison only. Keep adverse submission/CheckTx tails and original inclusion/final quantiles visible. Source tests or lower queue tails alone do not qualify TPS, sustained capacity or default promotion.")


def joint_observation(before, after):
    rates=[row["summary"].get("finalSubmittedPerMeasurementSecond") for row in (before,after)]
    if any(type(v) not in (int,float) or not math.isfinite(v) or v <= 0 for v in rates):
        raise RuntimeError("actual finite final rates missing/invalid")
    faster = after["summary"]["finalSubmittedPerMeasurementSecond"] > before["summary"]["finalSubmittedPerMeasurementSecond"]
    included = after["offerLatency"]["offerToEffectiveInclusionLatencyMs"]["p95"] <= before["offerLatency"]["offerToEffectiveInclusionLatencyMs"]["p95"]
    final = after["offerLatency"]["offerToQualifiedFinalLatencyMs"]["p95"] <= before["offerLatency"]["offerToQualifiedFinalLatencyMs"]["p95"]
    target = after["offerLatency"]["offerToQualifiedFinalLatencyMs"]["p95"] <= 3000
    return dict(finiteFinalRateIncreased=faster, offerToInclusionP95NotWorse=included,
                offerToFinalP95NotWorse=final, finiteFinalP95Within3s=target,
                finiteJointImprovementObserved=faster and included and final and target,
                sustainedTPSQualified=False,
                interpretation="This comparison does not change case safety qualification. A higher finite TPS alone is not joint performance acceptance; no ten-minute or sustained1000TPS claim.")


def run_pair(source, build, root, receipt, comparison="relative-bounded"):
    modes = pair_modes(comparison)
    if sys.platform != "linux" or platform.machine() != "x86_64":
        raise RuntimeError("same native Linux amd64 VM required")
    source, build, root, receipt = map(lambda p:p.absolute(), (source, build, root, receipt))
    if (root.exists() or root.is_symlink() or receipt.exists() or receipt.is_symlink()
            or root.is_relative_to(source) or source.is_relative_to(root)
            or root.is_relative_to(build) or build.is_relative_to(root)
            or receipt.is_relative_to(root) or root.is_relative_to(receipt.parent)
            or any(p.resolve() != p for p in (source, build, root.parent, receipt.parent))):
        raise RuntimeError("exclusive disjoint fixed-pair roots required")
    started = time.monotonic()
    root.mkdir(mode=0o700)
    budget = PairBudget(root, receipt.parent, started, build, comparison)
    result = dict(pair_recipe(comparison), execute=True, nodesStarted=None, launcher=os.getpid(), startedAtUnix=time.time(),
                  host=dict(uname=list(platform.uname()), cpuCount=os.cpu_count(),
                            bootID=native.bounded(Path("/proc/sys/kernel/random/boot_id")).decode().strip(),
                            pidNamespace=os.readlink("/proc/self/ns/pid")),
                  cases=[], closureScans=[], firstCause=None, casesQualified=False,
                  preparedCases=pair_recipe(comparison)["cases"],
                  terminalQualification="Requires post-fsync stdout verdict and exit0; receipt alone is not total-window PASS")
    def exhausted(_signum, _frame):
        raise RuntimeError("pair120s outer watchdog expired")
    prior = signal.signal(signal.SIGALRM, exhausted)
    signal.setitimer(signal.ITIMER_REAL, max(.001, budget.remaining()))
    baseline = None
    try:
        for index, mode in enumerate(modes):
            budget.observe()
            if budget.remaining() <= 15.5:
                raise RuntimeError("pair lacks cleanup and metadata reserve; next case refused")
            if baseline is not None:
                for name in BINARIES:
                    if native.digest(build/name) != baseline["binaries"][name]["sha256"]:
                        raise RuntimeError("pair compiled binary changed before second case")
                if list(platform.uname()) != baseline["host"]["uname"] or os.cpu_count() != baseline["host"]["cpuCount"]:
                    raise RuntimeError("pair actual host changed")
            case = root / (("before-" if index == 0 else "after-")+mode)
            out = root / (mode+"-actual.json")
            budget.active_case = case
            invoked = time.monotonic()
            pace = "relative" if comparison in DATA64_PAIRS else "bounded-cadence" if comparison in ("independent-shared","shared-fair","shared-elastic") else mode
            if comparison in DATA64_PAIRS:
                code = run(source,build,case,out,"grpc","supply-2048x1-data64",pace,pair_budget=budget,observer_phases=True,
                    prefix_replay=comparison in ("prefix-native-data64","native-submit8-data64","native-suffix-data64","native-observer-facts-data64","native-client-procs2-data64") or index==1,
                    **({"prefix_native_clone":True,"native_submit8":True,"observer_native_facts":True,"client_procs2":index==1,"require_client_runtime":True} if comparison=="native-client-procs2-data64" else {"prefix_native_clone":True,"native_submit8":True,"observer_native_facts":index==1} if comparison=="native-observer-facts-data64" else {"prefix_native_clone":True,"native_submit8":True,"native_suffix_setup":index==1} if comparison=="native-suffix-data64" else {"prefix_native_clone":True,"native_submit8":index==1} if comparison=="native-submit8-data64" else {"prefix_native_clone":index==1} if comparison=="prefix-native-data64" else {}))
            elif comparison in ("shared-fair","shared-elastic"):
                code = run(source,build,case,out,"grpc","supply-512x2",pace,pair_budget=budget,observer_phases=True,shared_replay=True,endpoint_fair=index==1,**(dict(endpoint_elastic=index==1) if comparison=="shared-elastic" else {}))
            elif comparison == "independent-shared":
                code = run(source,build,case,out,"grpc","supply-512x2",pace,pair_budget=budget,observer_phases=True,shared_replay=index==1)
            else:
                code = run(source, build, case, out, "grpc", "supply-512x2", mode, pair_budget=budget)
            duration = time.monotonic()-invoked
            row = json.loads(native.bounded(out, 4 << 20))
            if result["nodesStarted"] is not True: result["nodesStarted"] = row.get("nodesStarted")
            result["cases"].append(dict(order=index+1, mode=mode, receipt=str(out), sha256=native.digest(out),
                                        invocationElapsedMs=int(duration*1000), code=code,
                                        firstCause=row.get("firstCause"), summary=row.get("measurement", {}).get("summary")))
            if code != 0 or duration > 60:
                raise RuntimeError("pair case failed or invocation/fsync exceeded60s: "+str(row.get("firstCause")))
            pair_case_qualified(row, pace,"supply-2048x1-data64" if comparison in DATA64_PAIRS else "supply-512x2",2048 if comparison in DATA64_PAIRS else 1024,**({"native_submit8":True,"observer_native_facts":True,"client_procs2":index==1,"require_client_runtime":True} if comparison=="native-client-procs2-data64" else {"native_submit8":True,"observer_native_facts":index==1} if comparison=="native-observer-facts-data64" else {"native_submit8":True,"native_suffix_setup":index==1} if comparison=="native-suffix-data64" else {"native_submit8":index==1} if comparison=="native-submit8-data64" else {}))
            if comparison in DATA64_PAIRS:
                selected_prefix=comparison in ("prefix-native-data64","native-submit8-data64","native-suffix-data64","native-observer-facts-data64","native-client-procs2-data64") or index==1
                selected_native=comparison in ("native-submit8-data64","native-suffix-data64","native-observer-facts-data64","native-client-procs2-data64") or comparison=="prefix-native-data64" and index==1
                selected_submit8=comparison in ("native-suffix-data64","native-observer-facts-data64","native-client-procs2-data64") or comparison=="native-submit8-data64" and index==1
                selected_suffix=comparison=="native-suffix-data64" and index==1
                selected_observer=comparison=="native-client-procs2-data64" or comparison=="native-observer-facts-data64" and index==1
                selected_procs2=comparison=="native-client-procs2-data64" and index==1
                require_client_runtime=comparison=="native-client-procs2-data64"
                selected_shared=not selected_prefix
                client_raw=native.bounded(case/"network/transactions-result.json",16 << 20)
                if hashlib.sha256(client_raw).hexdigest()!=row.get("resultSHA256"):
                    raise RuntimeError("prefix pair original client hash differs")
                client=json.loads(client_raw)
                fixture=json.loads(native.bounded(case/"network/transactions.json",16 << 20))["transactions"]
                measured=validate_report(client,"supply-2048x1-data64",pace,fixture_transactions=fixture,prefix_replay=selected_prefix,prefix_native_clone=selected_native,native_submit8=selected_submit8,require_inventory=comparison in ("native-submit8-data64","native-suffix-data64","native-observer-facts-data64","native-client-procs2-data64"),native_suffix_setup=selected_suffix,observer_native_facts=selected_observer,client_procs2=selected_procs2,require_client_runtime=require_client_runtime)
                client_runtime=validate_client_runtime(client,selected_procs2,require_client_runtime)
                observer_facts=validate_observer_native_facts(client,selected_observer)
                phases=validate_observer_phases(client)
                shared=validate_shared_replay(client,selected_shared,require_work_phases=selected_shared)
                prefix=validate_prefix_replay(client,selected_prefix,require_work_phases=selected_prefix,expected_native_clone=selected_native,expected_native_suffix=selected_suffix)
                runtime=validate_runtime_measurements(client,2048,require=True,native_submit8=selected_submit8)
                if (measured!=row.get("measurement") or phases!=row.get("observerPhases")
                        or shared!=row.get("sharedReplayVerification") or row.get("sharedDurableReplay") is not selected_shared
                        or runtime!=row.get("runtimeMeasurements") or prefix!=row.get("prefixReplayVerification",dict(prefixDurableReplay=False,stats=None)) or row.get("prefixDurableReplay",False) is not selected_prefix
                        or row.get("prefixNativeClone",False) is not selected_native or row.get("nativeSubmit8",False) is not selected_submit8 or row.get("nativeSuffixSetup",False) is not selected_suffix or row.get("observerNativeFacts",False) is not selected_observer
                        or row.get("clientProcs2",False) is not selected_procs2
                        or (require_client_runtime and row.get("clientRuntimeVerification")!=client_runtime)
                        or (selected_observer and row.get("observerNativeFactVerification")!=observer_facts)
                        or (not selected_observer and row.get("observerNativeFactVerification") is not None)):
                    raise RuntimeError("prefix pair receipt differs from original business/backend/timing facts")
                if comparison in ("native-observer-facts-data64","native-client-procs2-data64"):result["cases"][-1]["observerNativeFactVerification"]=observer_facts
                if require_client_runtime:result["cases"][-1]["clientRuntimeVerification"]=client_runtime
                result["cases"][-1].update(offerLatency=offer_latency_readout(client,2048),nodePhases=row["nodePhases"],
                    observerPhases=phases,sharedReplayVerification=shared,prefixReplayVerification=prefix,
                    durableReadback=client["durableReadback"],submissionPhaseVerification=validate_submission_phases(client,2048),runtimeMeasurements=runtime)
            if comparison in ("bounded-grouped","independent-shared","shared-fair","shared-elastic"):
                # Read only the already qualified original client result. This
                # I/O and its hash/quantiles remain inside the same pair budget.
                client_raw=native.bounded(case/"network/transactions-result.json",16 << 20)
                if hashlib.sha256(client_raw).hexdigest() != row.get("resultSHA256"):
                    raise RuntimeError("grouping pair raw client result hash differs")
                client=json.loads(client_raw)
                measured=validate_report(client,"supply-512x2",pace,endpoint_fair=comparison in ("shared-fair","shared-elastic") and index==1,endpoint_elastic=comparison=="shared-elastic" and index==1)
                if comparison in ("shared-fair","shared-elastic") and measured!=row.get("measurement"):
                    raise RuntimeError("fair pair case measurement differs from original client facts")
                result["cases"][-1]["offerLatency"]=offer_latency_readout(client)
                result["cases"][-1]["nodePhases"]=row["nodePhases"]
                if comparison in ("independent-shared","shared-fair","shared-elastic"):
                    phases=validate_observer_phases(client)
                    shared_expected=comparison in ("shared-fair","shared-elastic") or index==1
                    shared=validate_shared_replay(client,shared_expected)
                    if row.get("observerPhases") != phases or row.get("sharedReplayVerification") != shared or row.get("sharedDurableReplay") is not shared_expected:
                        raise RuntimeError("shared replay receipt differs from actual client timing/selection")
                    result["cases"][-1].update(observerPhases=phases,sharedReplayVerification=shared,durableReadback=client["durableReadback"])
                if comparison in ("shared-fair","shared-elastic"):
                    dispatch=validate_endpoint_dispatch(client,index==1,elastic=comparison=="shared-elastic" and index==1)
                    if row.get("endpointDispatchVerification")!=dispatch or row.get("endpointFairSubmission") is not (index==1):
                        raise RuntimeError("endpoint dispatch receipt differs from actual original client counters/selection")
                    result["cases"][-1]["endpointDispatchVerification"]=dispatch
                    result["cases"][-1]["originalSubmissionTails"]=original_submission_tails(client)
                    if comparison=="shared-elastic":
                        phases=validate_submission_phases(client)
                        if row.get("endpointElasticSubmission") is not (index==1) or row.get("submissionPhaseVerification")!=phases:
                            raise RuntimeError("elastic selection/submission phases differ from original client")
                        result["cases"][-1]["submissionPhaseVerification"]=phases
            result["closureScans"].append(empty_pair_closure(budget))
            if baseline is None:
                baseline = row
                result["compiledBinaries"] = row["binaries"]
                result["sourceCommit"], result["compiler"] = row["sourceCommit"], row["compiler"]
            else:
                for key in ("sourceCommit", "sourceTree", "internalTree", "compiler", "binaries", "environment"):
                    if row[key] != baseline[key]:
                        raise RuntimeError("pair identity differs: "+key)
                if row["host"]["uname"] != baseline["host"]["uname"] or row["host"]["cpuCount"] != baseline["host"]["cpuCount"]:
                    raise RuntimeError("pair VM identity differs")
            budget.observe()
        result["casesQualified"] = True
        if comparison in ("bounded-grouped","independent-shared","shared-fair","shared-elastic","shared-prefix-data64","prefix-native-data64","native-submit8-data64","native-suffix-data64","native-observer-facts-data64","native-client-procs2-data64"):
            result["jointObservation"]=joint_observation(*result["cases"])
        if comparison in ("shared-fair","shared-elastic"):
            result["dispatchTailObservation"]=dispatch_tail_observation(*result["cases"],result["jointObservation"])
    except Exception as error:
        result["firstCause"] = str(error)
    finally:
        try:
            budget.observe()
        except Exception as error:
            result["firstCause"] = result["firstCause"] or str(error)
        result["samples"] = budget.samples
        result["elapsedBeforePairReceiptFsyncMs"] = int((time.monotonic()-started)*1000)
        try:
            with receipt.open("x") as handle:
                json.dump(result, handle, indent=2); handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
            budget.observe()  # Includes the actual pair receipt bytes and fsync wall time.
        except Exception as error:
            result["firstCause"] = result["firstCause"] or str(error)
        pair_sha = native.digest(receipt) if receipt.is_file() else None
        elapsed_exact = (time.monotonic()-started)*1000
        elapsed = int(elapsed_exact)
        if elapsed_exact > budget.caps["totalMs"]:
            result["firstCause"] = result["firstCause"] or "pair total including fsync exceeded120s"
        verdict = dict(schema=1, kind="fixed-pair-post-fsync-verdict", elapsedMs=elapsed,
                       firstCause=result["firstCause"], casesQualified=result["casesQualified"],
                       pairReceipt=str(receipt), pairReceiptSHA256=pair_sha,
                       retainedBytesAfterFsync=budget.samples[-1]["retainedBytes"] if budget.samples else None,
                       qualified=result["firstCause"] is None and result["casesQualified"])
        try:
            print("YNX_SUPPLY_PAIR_TERMINAL "+json.dumps(verdict), flush=True)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, prior)
    return 0 if verdict["qualified"] else 1


def server_commands(build, node, migration, transport):
    recipe(transport)  # Reject unknown transports before any process is spawned.
    comet = [str(build / "cometbft"), "start", "--home", node["home"], "--abci", transport]
    if transport == "grpc":
        endpoint(node["abciListen"])
        target = urlparse(node["abciListen"])
        # grpc.NewClient defaults to the DNS resolver: tcp:// is a server
        # listen URI, not a gRPC client target. Numeric loopback avoids DNS.
        comet += ["--proxy_app", "127.0.0.1:" + str(target.port)]
    return ([str(build / "ynx-abci"), "-listen", node["abciListen"], "-transport", transport,
             "-migration-state", migration, "-state", node["abciStatePath"], "-state-layout", "block-journal", "-phase-timing"],
            comet)


def partial_measurement(output):
    if not output.is_file():
        return None
    row = json.loads(native.bounded(output, 16 << 20))
    return dict(qualified=False, resultSHA256=native.digest(output), summary=row.get("summary"),
                supply=row.get("readySenders", {}).get("supply"), setupErrors=row.get("setupErrors"))


def inside(value, root):
    path = Path(value)
    if not path.is_absolute() or path.is_symlink() or not path.resolve().is_relative_to(root.resolve()) or path.resolve() == root.resolve():
        raise RuntimeError("fixture path escapes exclusive private root")
    return str(path)


def endpoint(value):
    parsed = urlparse(value)
    if (parsed.scheme not in ("tcp", "http") or parsed.hostname != "127.0.0.1"
            or parsed.username or parsed.password or parsed.path not in ("", "/")
            or parsed.query or parsed.fragment or parsed.port is None or not 1024 <= parsed.port <= 65535):
        raise RuntimeError("only explicit loopback fixture endpoints allowed")
    return value


def validate_manifest(m, root):
    if m.get("purpose") != "local-ephemeral-consensus-quorum-only-not-for-remote-or-custody" or len(m.get("nodes", [])) != 4:
        raise RuntimeError("private four-node fixture identity required")
    inside(m["migrationPath"], root)
    ports = set()
    for node in m["nodes"]:
        inside(node["home"], root)
        inside(node["abciStatePath"], root)
        for key in ("p2pListen", "rpcListen", "abciListen", "rpcUrl"):
            endpoint(node[key])
        for key in ("p2pListen", "rpcListen", "abciListen"):
            port = urlparse(node[key]).port
            if port in ports:
                raise RuntimeError("overlapping fixture ports")
            ports.add(port)
        if urlparse(node["rpcUrl"]).port != urlparse(node["rpcListen"]).port:
            raise RuntimeError("RPC listen/observation port mismatch")
    return m


def validate_oneshot_report(report,fixture_transactions,prefix_replay=False,prefix_native_clone=False,native_submit8=False,require_inventory=False,native_suffix_setup=False,observer_native_facts=False,client_procs2=False,require_client_runtime=False):
    validate_client_runtime(report,client_procs2,require_client_runtime)
    validate_observer_native_facts(report,observer_native_facts)
    validate_native_suffix_selection(report,native_suffix_setup)
    submitter_selection=validate_submitter_selection(report,native_submit8,require_inventory)
    total=2048
    if (report.get("roundsRequested")!=1 or report.get("roundsCompleted")!=1 or report.get("senderMode")!="rounds"
            or report.get("configuredOfferedRate")!=1000 or report.get("concurrency")!=(8 if native_submit8 else 4) or report.get("observerConcurrency")!=4
            or report.get("pacingMode")!="relative" or report.get("inclusionMode")!="block-scan" or report.get("setupErrors")
            or report.get("endpointFairSubmission",False) is not False or report.get("endpointElasticSubmission",False) is not False
            or report.get("terminalStream") is not None or report.get("streamingWorkload") is not None
            or report.get("retentionMode","")!=""):
        raise RuntimeError("fixed2048x1/offer1000 original worker/profile selection differs")
    summary=qualify_business_rows(report,total)
    ready=report.get("readySenders",{})
    if (any(ready.get(k,0)!=0 for k in ("prepared","offered","completed","quarantinedAccounts","roundsCompleted"))
            or ready.get("endpointDispatch") is not None or ready.get("boundedSummary") is not None
            or any(type(v) is not int or v!=0 for v in ready.get("supply",{}).values())):
        raise RuntimeError("one-shot profile cannot claim ready-pool/successor work")
    original_endpoint_binding(report,total)
    if not isinstance(fixture_transactions,list) or len(fixture_transactions)!=total:
        raise RuntimeError("all2048 original fixture envelopes required for result binding")
    senders=set();recipients=set()
    for row,encoded in zip(report["transactions"],fixture_transactions):
        if row.get("round")!=1 or row.get("signedTransaction")!=encoded:
            raise RuntimeError("one-shot result differs from original signed fixture")
        wire=base64.b64decode(encoded,validate=True);tx=json.loads(wire)
        if (base64.b64encode(wire).decode()!=encoded or not 1<=len(wire)<=65536 or row.get("bytes")!=len(wire)
                or row.get("hash","").upper()!=hashlib.sha256(wire).hexdigest().upper()
                or any(type(tx.get(k)) is not int for k in ("chainId","amount","fee","nonce"))
                or tx.get("chainId")!=6423 or tx.get("type")!="transfer" or tx["nonce"]!=1
                or tx.get("amount")!=1 or tx.get("fee")!=1 or not tx.get("signature") or not tx.get("publicKey")
                or not tx.get("from") or not tx.get("to") or tx["from"] in senders):
            raise RuntimeError("independent nonce1 business input identity/shape differs")
        senders.add(tx["from"]);recipients.add(tx["to"])
    if len(senders)!=total or len(recipients)!=1:
        raise RuntimeError("fixed2048 independent sender/one recipient shape differs")
    validate_prefix_replay(report,prefix_replay,expected_native_clone=prefix_native_clone,expected_native_suffix=native_suffix_setup)
    validate_shared_replay(report,not prefix_replay)
    validate_observer_phases(report)
    measured=dict(summary=summary,oneShot=dict(independentSenders=total,nonce=1,configuredOfferedRate=1000,
                originalFixtureBytesBound=True,sustainedTPSQualified=False,
                interpretation="Finite signed business probe. Fixture generation/signing precedes client measurement; no successor signing/journaling or ready-pool wait is inferred. Python verifies identity/shape, original Go path verifies signatures/business/quorum/durability. Not sustained1000TPS or independent cryptographic replay."),
                offerLatency=offer_latency_readout(report,total),originalSubmissionTails=original_submission_tails(report,total),
                submissionPhaseVerification=validate_submission_phases(report,total))
    runtime=validate_runtime_measurements(report,total,native_submit8=native_submit8)
    if runtime is not None:measured["runtimeMeasurements"]=runtime
    if submitter_selection["pacedWorkers"] is not None:measured["submitterVerification"]=submitter_selection
    return measured


def qualify_business_rows(report,total):
    s = report["summary"]
    for key in ("input", "offered", "submitted", "checkTxAccepted", "includedCodeZero",
                "effectiveBusinessIncluded", "quorumConfirmed", "finalSubmitted"):
        if type(s.get(key)) is not int or s[key] != total:
            raise RuntimeError("unqualified business count: " + key)
    for key in ("checkTxRejected", "checkTxUnverifiedResponses", "executionFailed", "submissionUnknown",
                "timedOut", "observationFailed", "notSubmitted"):
        if type(s.get(key)) is not int or s[key] != 0:
            raise RuntimeError("business failure/UNKNOWN: " + key)
    transactions = report.get("transactions", [])
    if len(transactions) != total or {t.get("index") for t in transactions} != set(range(total)):
        raise RuntimeError("complete per-transaction evidence required")
    for t in transactions:
        if (t.get("status") != "confirmed" or t.get("checkTxCode") != 0 or t.get("executionCode") != 0
                or any(t.get(k) is not True for k in ("checkTxIdentityVerified", "quorumVerified", "transactionProofVerified", "durableStateVerified", "durableInfoVerified"))
                or t.get("height", 0) <= 0 or t.get("durableStateHeight", 0) < t["height"]
                or t.get("durableInfoHeight", 0) < t["durableStateHeight"]
                or not t.get("durableSnapshotSha256") or not t.get("confirmedObservedAt")):
            raise RuntimeError("per-transaction business qualification missing")
    return s


def validate_report(report, profile_name="supply-256x4", pacing="relative", endpoint_fair=False, endpoint_elastic=False,fixture_transactions=None,prefix_replay=False,prefix_native_clone=False,native_submit8=False,require_inventory=False,native_suffix_setup=False,observer_native_facts=False,client_procs2=False,require_client_runtime=False):
    validate_client_runtime(report,client_procs2,require_client_runtime)
    validate_observer_native_facts(report,observer_native_facts)
    validate_native_suffix_selection(report,native_suffix_setup)
    validate_submitter_selection(report,native_submit8,require_inventory)
    if prefix_native_clone and not prefix_replay:raise RuntimeError("native clone readout requires prefix replay")
    if prefix_replay and profile_name!="supply-2048x1-data64":raise RuntimeError("prefix readout requires explicit data64 profile")
    if profile_name not in ONESHOT_PROFILES:validate_prefix_replay(report,False)
    if profile_name in ONESHOT_PROFILES:
        if pacing!="relative" or endpoint_fair or endpoint_elastic:
            raise RuntimeError("2048x1 cannot select pair endpoint or pacing candidates")
        return validate_oneshot_report(report,fixture_transactions,prefix_replay,prefix_native_clone,native_submit8,require_inventory,native_suffix_setup,observer_native_facts,client_procs2,require_client_runtime)
    profile = recipe("grpc", profile_name, pacing)["profile"]
    if report.get("endpointElasticSubmission",False) is not endpoint_elastic:
        raise RuntimeError("actual elastic endpoint selection differs from selected profile")
    if report.get("endpointFairSubmission",False) is not endpoint_fair:
        raise RuntimeError("actual endpoint fairness differs from selected profile")
    if (report.get("roundsCompleted") != profile["rounds"] or report.get("roundsRequested") != profile["rounds"] or report.get("senderMode") != "ready-pool"
            or report.get("inclusionMode") != "block-scan" or report.get("configuredOfferedRate") != 512
            or report.get("pacingMode") != pacing or report.get("setupErrors")):
        raise RuntimeError("fixed Supply workload incomplete")
    s=qualify_business_rows(report,1024)
    supply = report["readySenders"]["supply"]
    for key, value in supply.items():
        if type(value) is not int or value < 0:
            raise RuntimeError("invalid measured Supply counter: " + key)
    for key in ("signAttempts", "encodeAttempts", "signedSuccessors"):
        if supply.get(key) != 1024-profile["senders"]:
            raise RuntimeError("successor timing coverage missing: " + key)
    if supply.get("journalDurableEnvelopes") != 1024 or supply.get("terminalSinkAttempts") != 0 or supply.get("terminalSinkNs") != 0:
        raise RuntimeError("finite journal/sink mode differs from fixed profile")
    for prefix in ("completionWait", "offerDecode", "pacingWait", "dispatch", "sign", "encode", "journalAppend"):
        if supply.get(prefix + "Attempts", 0) <= 0 or supply.get(prefix + "Ns", 0) <= 0:
            raise RuntimeError("Supply phase timing missing: " + prefix)
    if supply.get("journalSetupNs", 0) <= 0 or supply.get("journalDurableBytes", 0) <= 0:
        raise RuntimeError("durable Supply setup missing")
    for suffix in ("Attempts", "Ns"):
        parts = [supply.get("completion"+name+"Wait"+suffix) for name in ("Supply", "Drain", "Failure")]
        if any(type(v) is not int or v < 0 for v in parts) or sum(parts) != supply["completionWait"+suffix] or parts[2] != 0:
            raise RuntimeError("Supply/final-drain/failure wait partition incomplete")
    if (supply.get("pacingFutureTargetAttempts", -1)+supply.get("pacingAlreadyDueAttempts", -1) != supply["pacingWaitAttempts"]
            or any(type(supply.get(k)) is not int or supply[k] < 0 for k in ("pacingPositiveRemainingNs", "pacingWakeLatenessNs", "pacingMaxWakeLatenessNs"))
            or supply["pacingMaxWakeLatenessNs"] > supply["pacingWakeLatenessNs"]):
        raise RuntimeError("pacing scheduled/wake timing coverage missing")
    decisions = [supply.get(k) for k in ("pacingCatchupTargets", "pacingCadenceResets")]
    if (any(type(v) is not int or v < 0 for v in decisions) or sum(decisions) > 1024
            or type(supply.get("pacingPeakCatchupTargets")) is not int or not 0 <= supply["pacingPeakCatchupTargets"] <= 3
            or pacing == "relative" and (any(decisions) or supply["pacingPeakCatchupTargets"] != 0)):
        raise RuntimeError("pacing decision counters differ from selected mode")
    return dict(summary=s, supply=supply)


def native_sample(case, build, known, started, initial=False, enforce_limits=True):
    rows, vanished = native.proc_inventory()
    ids = native.owned_set(rows, os.getpid(), known=known)
    if len(ids) > PROFILE["ownedProcesses"]:
        raise RuntimeError("Supply owned process cap exceeded")
    tasks = []
    for pid in ids:
        before = rows[pid]
        try:
            raw = native.bounded(Path("/proc") / str(pid) / "smaps_rollup") if before["state"] != "Z" else None
            after = native.parse_stat(native.bounded(Path("/proc") / str(pid) / "stat"), pid)
        except OSError as error:
            if error.errno not in (errno.ENOENT, errno.ESRCH):
                raise
            try:
                after = native.parse_stat(native.bounded(Path("/proc") / str(pid) / "stat"), pid)
            except OSError as absent:
                if absent.errno in (errno.ENOENT, errno.ESRCH):
                    continue
                raise
            if after["startTicks"] != before["startTicks"] or after["state"] != "Z":
                raise RuntimeError("live owned RSS unreadable")
            raw = None
        if before["startTicks"] != after["startTicks"] or raw is None and after["state"] != "Z":
            raise RuntimeError("owned identity changed during sample")
        tasks.append(dict(after, rssBytes=native.smaps_rss(raw) if raw is not None else 0))
    known.update({p["pid"]: p["startTicks"] for p in tasks if p["pid"] != os.getpid()})
    disk = os.statvfs(case)
    row = dict(elapsedMs=int((time.monotonic()-started)*1000), tasks=tasks,
               rssBytes=sum(t["rssBytes"] for t in tasks), threads=sum(t["threads"] for t in tasks),
               privateBytes=native.directory_bytes(case), buildBytes=native.directory_bytes(build),
               freeDiskBytes=disk.f_bavail*disk.f_frsize, availableMemoryBytes=native.memory_available(),
               hostIdentities=len(rows), vanishedHostPIDs=vanished)
    logs=sum(p.stat().st_size for p in case.glob("*.log"))
    if enforce_limits:
        native.enforce(row, initial)
        if logs > native.CAPS["logBytes"]:
            raise RuntimeError("combined process log cap exceeded")
    else:
        row["processLogBytes"]=logs
    return row


def enforce_captured_sample(sampled,result,initial=False):
    try:
        scoped = result.get("profile", {}).get("name") == "supply-2048x1-data64-grpc"
        native.enforce(sampled,initial,private_bytes_cap=64 << 20 if scoped else None)
        if sampled.get("processLogBytes",0)>native.CAPS["logBytes"]:
            raise RuntimeError("combined process log cap exceeded")
    except Exception:
        result.setdefault("refusedSamples",[]).append(sampled)
        raise


def oneshot_post_fsync(result,receipt,capture_sample,started):
    sampled=None
    try:
        sampled=capture_sample()
        if (time.monotonic()-started)*1000>60000:
            raise RuntimeError("one-shot total including receipt fsync exceeded60s")
        scans=result.get("closureScans",[])
        if (type(result.get("launcher")) is not int or result["launcher"]<=0
                or len(scans)<2 or any(s.get("owned")!=[result.get("launcher")] or type(s.get("launcherStartTicks")) is not int or s["launcherStartTicks"]<=0 for s in scans[-2:])
                or scans[-1].get("launcherStartTicks")!=scans[-2].get("launcherStartTicks")):
            raise RuntimeError("one-shot final double owned closure absent")
        if (result.get("cleanupComplete") is not True or result.get("nodesStarted") is not True
                or result.get("measurement",{}).get("summary",{}).get("finalSubmitted")!=2048):
            raise RuntimeError("one-shot final business/cleanup evidence incomplete")
    except Exception as error:
        result["firstCause"]=result.get("firstCause") or str(error)
    digest=native.digest(receipt)
    elapsed=int((time.monotonic()-started)*1000)
    if elapsed>60000:result["firstCause"]=result.get("firstCause") or "one-shot total including receipt/hash exceeded60s"
    qualified=result.get("firstCause") is None
    print("YNX_ONESHOT_1000_TERMINAL "+json.dumps(dict(schema=1,kind="fixed2048x1-post-fsync-verdict",
        qualified=qualified,nodesStarted=result.get("nodesStarted"),firstCause=result.get("firstCause"),
        receiptSHA256=digest,elapsedMs=elapsed,
        postFsyncSample=sampled,refusedSamples=result.get("refusedSamples",[]))),flush=True)
    return qualified


def preflight(build, case):
    if sys.platform != "linux" or platform.machine() != "x86_64":
        raise RuntimeError("native Linux amd64 runner required")
    if case.exists() or case.is_symlink():
        raise RuntimeError("new resource-probe directory required")
    case.mkdir(mode=0o700)
    if build.stat().st_dev != case.stat().st_dev:
        raise RuntimeError("build and private data must share monitored filesystem")
    # No children or builds: actual host kernel data, not synthetic test values.
    return native_sample(case, build, {}, time.monotonic(), initial=True)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError("fixture RPC redirect refused")


def supply_client_command(build,manifest_path,network,output,profile,pacing,observer_phases=False,shared_replay=None,endpoint_fair=None,endpoint_elastic=None,prefix_replay=None,prefix_native_clone=None,native_submit8=False,native_suffix_setup=False,observer_native_facts=False,client_procs2=False):
    if prefix_native_clone and (prefix_replay is not True or shared_replay):raise RuntimeError("native clone client requires exclusive prefix replay")
    if type(native_submit8) is not bool or profile["concurrency"]!=(8 if native_submit8 else 4) or native_submit8 and (prefix_native_clone is not True or prefix_replay is not True):raise RuntimeError("submit8 client mode/worker selection differs")
    if type(native_suffix_setup) is not bool or native_suffix_setup and not native_submit8:raise RuntimeError("native suffix client mode differs")
    if type(observer_native_facts) is not bool or observer_native_facts and (not native_submit8 or native_suffix_setup):raise RuntimeError("observer native client mode differs")
    if type(client_procs2) is not bool or client_procs2 and not observer_native_facts:raise RuntimeError("client procs2 command requires observer native facts")
    return [str(build / BINARIES[3]), "-manifest", str(manifest_path), "-transactions", str(network / "transactions.json"), "-output", str(output), "-timeout", "10s", "-concurrency", str(profile["concurrency"]), "-observers", str(profile["observers"]), "-offered-rate", str(profile["offeredRate"]), "-rounds", str(profile["rounds"]), "-sender-mode", profile.get("senderMode","ready-pool"), "-inclusion-mode", "block-scan", "-pacing-mode", pacing]+(["-observer-phase-timing"] if observer_phases else [])+(["-shared-durable-replay"] if shared_replay else [])+(["-endpoint-fair-submission"] if endpoint_fair else [])+(["-endpoint-elastic-submission"] if endpoint_elastic else [])+(["-prefix-durable-replay"] if prefix_replay else [])+(["-prefix-native-clone"] if prefix_native_clone else [])+(["-native-submit8"] if native_submit8 else [])+(["-native-suffix-setup"] if native_suffix_setup else [])+(["-observer-native-facts"] if observer_native_facts else [])+(["-client-procs2"] if client_procs2 else [])


def case_evidence_bytes(receipt, paired=False):
    # Pair roots retain earlier case data/receipts; only this receipt belongs to
    # the current case. PairBudget independently charges every retained byte.
    return (receipt.stat().st_size if receipt.is_file() else 0) if paired else native.directory_bytes(receipt.parent)


def run(source, build, case, receipt, transport="socket", profile_name="supply-256x4", pacing="relative", pair_budget=None, observer_phases=False, shared_replay=None, fixture_only=False, endpoint_fair=None, endpoint_elastic=None,prefix_replay=None,prefix_native_clone=None,native_submit8=False,native_suffix_setup=False,observer_native_facts=False,client_procs2=False,require_client_runtime=False):
    if fixture_only and (prefix_native_clone or native_submit8 or native_suffix_setup or observer_native_facts or client_procs2 or require_client_runtime):raise RuntimeError("native candidates cannot select a fixture-only case")
    one_shot=not fixture_only and profile_name in ONESHOT_PROFILES
    if one_shot:
        if shared_replay is not None and shared_replay is not (prefix_replay is not True):
            raise RuntimeError("2048x1 requires exclusive shared replay or prefix selection")
        shared_replay=prefix_replay is not True
    selected = fixture_resource_recipe() if fixture_only else recipe(transport, profile_name, pacing, observer_phases, shared_replay, endpoint_fair, endpoint_elastic,prefix_replay,prefix_native_clone,native_submit8,native_suffix_setup,observer_native_facts,client_procs2,require_client_runtime)
    profile = selected["profile"]
    if sys.platform != "linux" or platform.machine() != "x86_64":
        raise RuntimeError("native Linux amd64 runner required; no Darwin pressure substitution")
    source, build, case, receipt = map(lambda p: p.absolute(), (source, build, case, receipt))
    if (case.exists() or case.is_symlink() or receipt.exists() or receipt.is_symlink()
            or case.is_relative_to(source) or source.is_relative_to(case)
            or build.is_relative_to(case) or receipt.is_relative_to(case)):
        raise RuntimeError("exclusive external case and receipt paths required")
    if any(p.resolve() != p for p in (source, build, case.parent, receipt.parent)):
        raise RuntimeError("symlinked runner roots refused")
    case.mkdir(mode=0o700)
    result = dict(selected, execute=True, source=str(source), build=str(build), case=str(case),
                  host=dict(uname=list(platform.uname()), cpuCount=os.cpu_count()),
                  samples=[], children=[], timeline=[], readinessWaitErrors=0,
                  firstCause=None, cleanupComplete=False)
    children, handles, known = [], [], {}
    started = time.monotonic()
    go_cache = None
    cache_baseline = 0
    fixture_qualified = False
    one_shot_qualified = False
    if one_shot:result["launcher"]=os.getpid()

    def mark(phase):
        result["timeline"].append(dict(phase=phase, elapsedNs=int((time.monotonic()-started)*1e9), unixNs=time.time_ns()))

    def command(args):
        return subprocess.check_output(args, cwd=source, timeout=pair_budget.io_timeout() if pair_budget else 5, stderr=subprocess.STDOUT).decode().strip()

    def capture_sample(initial=False):
        sampled=native_sample(case,build,known,started,initial,enforce_limits=not (fixture_only or one_shot))
        if fixture_only or one_shot:
            sampled["privateBytes"]+=case_evidence_bytes(receipt,pair_budget is not None)
        if fixture_only:
            sampled["preexistingGoCacheBytes"]=cache_baseline
            sampled["sharedGoCacheBytes"]=native.directory_bytes(go_cache) if go_cache is not None else 0
            sampled["incrementalGoCacheBytes"]=max(0,sampled["sharedGoCacheBytes"]-cache_baseline)
            sampled["buildBytes"]+=sampled["incrementalGoCacheBytes"]
        if fixture_only or one_shot:enforce_captured_sample(sampled,result,initial)
        return sampled

    def tick(initial=False):
        if time.monotonic()-started >= 45:
            raise RuntimeError("active45s deadline exceeded")
        if pair_budget and pair_budget.remaining() <= 15.5:
            raise RuntimeError("pair active reserve exhausted; begin cleanup")
        sampled = capture_sample(initial)
        result["samples"].append(sampled)
        if pair_budget: pair_budget.observe(sampled)
        if any(p.poll() is not None for p in children if getattr(p, "server", False)):
            raise RuntimeError("node exited during active window")

    def spawn(name, args, server=False, cwd=None):
        if len([p for p in children if p.poll() is None]) >= 9:
            raise RuntimeError("nine-child role cap exceeded")
        handle = open(case / (name + ".log"), "xb", buffering=0)
        handles.append(handle)
        p = subprocess.Popen(args, cwd=cwd or case, env={**os.environ, **ENV, **({"GOTMPDIR":str(build/"tmp")} if fixture_only else {})}, stdin=subprocess.DEVNULL,
                             stdout=handle, stderr=subprocess.STDOUT, start_new_session=True)
        p.server = server
        children.append(p)
        result["children"].append(dict(role=name, pid=p.pid, command=args))
        tick()
        return p

    def wait(p):
        while p.poll() is None:
            tick(); time.sleep(.1)
        tick()
        if p.returncode != 0:
            raise RuntimeError("child failed: " + str(p.args))

    def interrupted(signum, _):
        raise RuntimeError("wrapper signal " + str(signum))

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, interrupted)
    try:
        head = command(["git", "rev-parse", "HEAD"])
        if command(["git", "status", "--porcelain"]):
            raise RuntimeError("clean exact source required")
        result["sourceCommit"] = head
        result["compiler"] = command(["go", "version"])
        result["sourceTree"] = command(["git", "rev-parse", "HEAD^{tree}"])
        result["internalTree"] = command(["git", "rev-parse", "HEAD:internal"])
        if len({p.stat().st_dev for p in (source, case, build)}) != 1:
            raise RuntimeError("source/build/private data must share monitored filesystem")
        if fixture_only:
            libc=ctypes.CDLL(None,use_errno=True)
            libc.prctl.argtypes=[ctypes.c_int,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_ulong]
            value=ctypes.c_int()
            if libc.prctl(36,1,0,0,0) or libc.prctl(37,ctypes.cast(ctypes.pointer(value),ctypes.c_void_p).value,0,0,0) or value.value!=1:
                raise RuntimeError("subreaper unavailable before fixture build")
            go_cache=Path(command(["go","env","GOCACHE"]))
            if not go_cache.is_absolute() or go_cache.resolve()!=go_cache or go_cache.stat().st_dev!=case.stat().st_dev:
                raise RuntimeError("actual shared Go cache identity/filesystem differs")
            cache_baseline=native.directory_bytes(go_cache)
            result["goCacheAccounting"]=dict(path=str(go_cache),preexistingBytes=cache_baseline,charge="Original owned build/tmp plus actual incremental shared-cache bytes; preexisting cache remains visible and charged to filesystem free/reserve, never deleted.")
            (build/"tmp").mkdir(mode=0o700)
            tick(True);mark("fixture_build_start")
            wait(spawn("fixture-build",["go","build","-p","1","-o",str(build/"ynx-consensus-perf-fixture"),"./cmd/ynx-consensus-perf-fixture"],cwd=source))
            mark("fixture_build_complete")
        result["binaries"] = {}
        for name in (("ynx-consensus-perf-fixture",) if fixture_only else BINARIES):
            binary = build / name
            if binary.is_symlink() or not binary.is_file() or binary.stat().st_size > 64 << 20:
                raise RuntimeError("binary type/size bound")
            with binary.open("rb") as f:
                header = f.read(20)
            if header[:6] != b"\x7fELF\x02\x01" or header[18:20] != b"\x3e\x00":
                raise RuntimeError("Linux amd64 ELF required")
            info = command(["go", "version", "-m", str(binary)])
            for pin in ("GOOS=linux", "GOARCH=amd64", "CGO_ENABLED=0"):
                if pin not in info:
                    raise RuntimeError("binary target pin missing")
            if name != "cometbft" and ("vcs.revision="+head not in info or "vcs.modified=false" not in info):
                raise RuntimeError("binary source identity mismatch")
            if name == "cometbft" and "github.com/cometbft/cometbft\tv0.38.23\th1:jtCe5Do4EcHVf/FCyZMvkBm+AmsRGGyvswImXYAabdM=" not in info:
                raise RuntimeError("Comet module identity mismatch")
            result["binaries"][name] = dict(sha256=native.digest(binary), bytes=binary.stat().st_size, buildInfo=info)
        mounts = [line.split() for line in native.bounded(Path("/proc/mounts"), 1 << 20).splitlines()]
        proc = [r for r in mounts if len(r) >= 4 and r[1:3] == [b"/proc", b"proc"]]
        if len(proc) != 1 or any(o.startswith(b"hidepid=") and o != b"hidepid=0" for o in proc[0][3].split(b",")):
            raise RuntimeError("complete native procfs required")
        libc = ctypes.CDLL(None, use_errno=True)
        libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
        value = ctypes.c_int()
        if libc.prctl(36, 1, 0, 0, 0) or libc.prctl(37, ctypes.cast(ctypes.pointer(value), ctypes.c_void_p).value, 0, 0, 0) or value.value != 1:
            raise RuntimeError("subreaper unavailable")
        result["subreaper"] = True
        tick(True)
        result["host"].update(meminfo=native.bounded(Path("/proc/meminfo")).decode(),
                               cpuinfo=native.bounded(Path("/proc/cpuinfo"), 1 << 20).decode())
        network = case / "network"
        mark("fixture_start")
        wait(spawn("fixture", [str(build / BINARIES[2]), "-ephemeral", "-output", str(network), "-count", str(profile["senders"])]+([] if fixture_only or one_shot else ["-retain-ephemeral-senders"])))
        mark("fixture_complete")
        manifest_path = network / "network-manifest.json"
        manifest = validate_manifest(json.loads(native.bounded(manifest_path, 1 << 20)), network)
        if fixture_only:
            result["fixtureResources"]=fixture_resource_readout(network)
            tick();mark("fixture_resource_readback_complete")
        else:
            if one_shot:
                secrets=network/"ephemeral-sender-secrets.json"
                if secrets.exists() or secrets.is_symlink():
                    raise RuntimeError("one-shot fixture must not retain sender signing keys")
                result["fixtureResources"]=fixture_resource_readout(network)
            for i, node in enumerate(manifest["nodes"]):
                app, _ = server_commands(build, node, manifest["migrationPath"], transport)
                spawn("abci-"+str(i), app, True)
            for i, node in enumerate(manifest["nodes"]):
                _, comet = server_commands(build, node, manifest["migrationPath"], transport)
                spawn("comet-"+str(i), comet, True)
            result["nodesStarted"] = True
            mark("nodes_spawned")
            opener = build_opener(ProxyHandler({}), NoRedirect())
            for node in manifest["nodes"]:
                while True:
                    tick()
                    try:
                        with opener.open(node["rpcUrl"]+"/status", timeout=.05) as response:
                            raw = response.read((1 << 20)+1)
                        if len(raw) > 1 << 20:
                            raise RuntimeError("RPC status bound")
                        if int(json.loads(raw)["result"]["sync_info"]["latest_block_height"]) >= 2:
                            break
                    except (OSError, ValueError, KeyError):
                        result["readinessWaitErrors"] += 1
                    time.sleep(.05)
            mark("all_nodes_height2")
            output = network / "transactions-result.json"
            mark("client_start")
            wait(spawn("client",supply_client_command(build,manifest_path,network,output,profile,pacing,observer_phases,shared_replay,endpoint_fair,endpoint_elastic,prefix_replay,prefix_native_clone,native_submit8,native_suffix_setup,observer_native_facts,client_procs2)))
            client_report=json.loads(native.bounded(output,16 << 20))
            result["measurement"] = validate_report(client_report, profile_name, pacing, endpoint_fair=endpoint_fair is True, endpoint_elastic=endpoint_elastic is True,fixture_transactions=json.loads(native.bounded(network/"transactions.json",16 << 20))["transactions"] if one_shot else None,prefix_replay=prefix_replay is True,prefix_native_clone=prefix_native_clone is True,native_submit8=native_submit8,native_suffix_setup=native_suffix_setup,observer_native_facts=observer_native_facts,client_procs2=client_procs2,require_client_runtime=require_client_runtime)
            if observer_phases:
                result["observerPhases"]=validate_observer_phases(client_report)
            if shared_replay is not None:
                result["sharedReplayVerification"]=validate_shared_replay(client_report,shared_replay,require_work_phases=shared_replay is True)
            if endpoint_fair is not None:
                result["endpointDispatchVerification"]=validate_endpoint_dispatch(client_report,endpoint_fair,elastic=endpoint_elastic is True)
            if endpoint_elastic is not None:
                result["submissionPhaseVerification"]=validate_submission_phases(client_report)
            if prefix_replay is True:result["prefixReplayVerification"]=validate_prefix_replay(client_report,True,require_work_phases=True,expected_native_clone=prefix_native_clone is True,expected_native_suffix=native_suffix_setup)
            if require_client_runtime or client_procs2:result["clientRuntimeVerification"]=validate_client_runtime(client_report,client_procs2,require_client_runtime)
            if observer_native_facts:result["observerNativeFactVerification"]=validate_observer_native_facts(client_report,True)
            if one_shot:result["runtimeMeasurements"]=validate_runtime_measurements(client_report,2048,require=True,native_submit8=native_submit8)
            mark("client_complete")
            result["resultSHA256"] = native.digest(output)
    except Exception as error:
        result["firstCause"] = str(error)
        try:
            result["partialMeasurement"] = partial_measurement(case / "network/transactions-result.json")
        except Exception as diagnostic_error:
            result["partialReadError"] = str(diagnostic_error)
    finally:
        mark("cleanup_start")
        cleanup = time.monotonic()
        cleanup_deadline = min(cleanup+15, started+60)
        if pair_budget: cleanup_deadline = min(cleanup_deadline, pair_budget.deadline-.5)
        empty = 0
        while time.monotonic() < cleanup_deadline:
            for p in children:
                p.poll()
            try:
                rows, _ = native.proc_inventory()
                ids = [pid for pid in native.owned_set(rows, os.getpid(), known=known) if pid != os.getpid()]
                if one_shot:
                    result.setdefault("closureScans",[]).append(dict(elapsedMs=int((time.monotonic()-started)*1000),owned=[os.getpid()]+ids,launcherStartTicks=rows[os.getpid()]["startTicks"]))
                if not ids:
                    empty += 1
                    if empty == 2:
                        result["cleanupComplete"] = True
                        break
                else:
                    empty = 0
                for pid in ids:
                    row = rows[pid]
                    fresh = native.parse_stat(native.bounded(Path("/proc")/str(pid)/"stat"), pid)
                    if fresh["startTicks"] != row["startTicks"]:
                        raise RuntimeError("cleanup PID identity changed; not signalled")
                    if fresh["state"] == "Z" and fresh["parent"] == os.getpid():
                        os.waitpid(pid, os.WNOHANG)
                    else:
                        os.kill(pid, signal.SIGINT if time.monotonic()-cleanup < 2 else signal.SIGKILL)
                    known[pid] = row["startTicks"]
            except Exception as error:
                result["firstCause"] = result["firstCause"] or str(error)
                for p in children:
                    if p.poll() is None:
                        p.kill()
            time.sleep(.05)
        for handle in handles:
            handle.close()
        mark("cleanup_complete" if result["cleanupComplete"] else "cleanup_incomplete")
        if not result["cleanupComplete"]:
            result["firstCause"] = result["firstCause"] or "owned closure cleanup incomplete"
        try:
            final_sample=capture_sample()
            if fixture_only:result["samples"].append(final_sample)
            else:
                code = "import{readNodePhaseTiming as r}from './scripts/loadtest/node-phase-timing.mjs';import fs from'node:fs';console.log(JSON.stringify(process.argv.slice(1).map(p=>r(fs.readFileSync(p,'utf8')))));"
                result["nodePhases"] = json.loads(command(["node", "--input-type=module", "-e", code] + [str(case / ("abci-"+str(i)+".log")) for i in range(4)]))
        except Exception as error:
            result["firstCause"] = result["firstCause"] or str(error)
        result["elapsedMs"] = int((time.monotonic()-started)*1000)
        if result["elapsedMs"] > 60000:
            result["firstCause"] = result["firstCause"] or "total60s deadline exceeded"
        result["measurementLimits"] = "Sampled RSS, not a hard cgroup ceiling; non-atomic proc scans. Build occurs before the bounded runtime window in the existing CI job. Finite 1024 business transactions, not sustained TPS. Terminal sink disabled in this finite profile; zero is not a missing measurement. No Darwin matched comparison."
        if one_shot:
            result["measurementLimits"]="Finite2048 independent signed nonce1 inputs, configured1000offers/s, not sustained TPS. Fixture generation/signing precedes measured client window. All original resource caps unchanged; actual node/reader/history/evidence growth may refuse this case. No retry, endpoint candidate or default promotion. Original native admission, cleanup and post-fsync verdict required."
        if fixture_only:
            result["measurementLimits"]="Fixture-only resource sampling including build/generation and structural file readback within45+15s. Preexisting shared Go cache is inventoried separately; build/tmp+incremental cache and all private data/evidence are charged. Non-atomic sampled RSS/process observations are not instantaneous upper bounds. No nodes/reader/network/business finality or1000TPS admission. Post-fsync terminal+exit0 required."
        with receipt.open("x") as handle:
            json.dump(result, handle, indent=2); handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
        if fixture_only:
            post_sample=None
            try:
                post_sample=capture_sample()
                if (time.monotonic()-started)*1000>60000:raise RuntimeError("fixture total including receipt fsync exceeded60s")
            except Exception as error:result["firstCause"]=result["firstCause"] or str(error)
            fixture_qualified=result["firstCause"] is None and result["cleanupComplete"] and "fixtureResources" in result
            print("YNX_FIXTURE_RESOURCE_TERMINAL "+json.dumps(dict(qualified=fixture_qualified,nodesStarted=False,firstCause=result["firstCause"],receiptSHA256=native.digest(receipt),elapsedMs=int((time.monotonic()-started)*1000),postFsyncSample=post_sample,refusedSamples=result.get("refusedSamples",[]))),flush=True)
        elif one_shot:
            one_shot_qualified=oneshot_post_fsync(result,receipt,capture_sample,started)
        else:
            print(json.dumps({k: result.get(k) for k in ("firstCause", "nodesStarted", "cleanupComplete", "elapsedMs", "partialMeasurement")}), flush=True)
    return (0 if fixture_qualified else 1) if fixture_only else (0 if one_shot_qualified else 1) if one_shot else (1 if result["firstCause"] else 0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--prepare-1000-fixture", action="store_true")
    parser.add_argument("--measure-1000-fixture", action="store_true")
    parser.add_argument("--prepare-1000-tier", action="store_true")
    parser.add_argument("--prepare-shared-replay-pair", action="store_true")
    parser.add_argument("--prepare-pair", action="store_true")
    parser.add_argument("--execute-pair", action="store_true")
    parser.add_argument("--pair-kind", choices=tuple(PAIR_MODES), default="relative-bounded")
    parser.add_argument("--transport", choices=("socket", "grpc"), default="socket")
    parser.add_argument("--profile", choices=tuple(PROFILES), default="supply-256x4")
    parser.add_argument("--pacing", choices=("relative", "bounded-cadence", "grouped-cadence4"), default="relative")
    parser.add_argument("--check-runner", action="store_true")
    parser.add_argument("--observer-phases", action="store_true")
    parser.add_argument("--prefix-replay", action="store_true")
    parser.add_argument("--prefix-native-clone", action="store_true")
    parser.add_argument("--native-submit8", action="store_true")
    parser.add_argument("--native-suffix-setup", action="store_true")
    parser.add_argument("--observer-native-facts", action="store_true")
    parser.add_argument("--client-procs2", action="store_true")
    parser.add_argument("--source", type=Path)
    parser.add_argument("--build", type=Path)
    parser.add_argument("--case", type=Path)
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    if args.client_procs2 and not args.observer_native_facts:parser.error("client procs2 requires original observer native facts")
    if args.observer_native_facts and (not args.native_submit8 or args.native_suffix_setup):
        parser.error("observer native facts require original native8 setup")
    if args.native_suffix_setup and not args.native_submit8:
        parser.error("native suffix setup requires explicit native8")
    if args.native_submit8 and not args.prefix_native_clone:
        parser.error("submit8 requires explicit native prefix copy")
    if args.prefix_native_clone and not args.prefix_replay:
        parser.error("native clone requires explicit individual prefix replay")
    if args.prefix_replay and (args.prepare_pair or args.execute_pair or args.check_runner or args.prepare_1000_fixture or args.measure_1000_fixture or args.prepare_1000_tier or args.prepare_shared_replay_pair):
        parser.error("prefix replay is only an explicit individual data64 case")
    if args.prepare_1000_fixture or args.measure_1000_fixture:
        if (args.prepare_1000_fixture and args.measure_1000_fixture or args.execute or args.execute_pair or args.prepare_pair
                or args.check_runner or args.prepare_1000_tier or args.prepare_shared_replay_pair or args.observer_phases
                or args.pair_kind!="relative-bounded" or args.pacing!="relative"):
            parser.error("fixture-only measurement cannot combine with network/other measurement actions")
        if args.prepare_1000_fixture:
            print(json.dumps(fixture_resource_recipe(),indent=2))
        else:
            if not all((args.source,args.build,args.case,args.receipt)):
                parser.error("fixture resource measurement requires exact source/build/new case/new receipt")
            sys.exit(run(args.source,args.build,args.case,args.receipt,fixture_only=True))
        sys.exit(0)
    if args.prepare_shared_replay_pair:
        if args.execute or args.execute_pair or args.prepare_pair or args.check_runner or args.prepare_1000_tier:
            parser.error("shared replay preparation cannot execute any workload")
        print(json.dumps(prepare_shared_replay_pair(),indent=2))
        sys.exit(0)
    if args.prepare_1000_tier:
        if args.execute or args.execute_pair or args.prepare_pair or args.check_runner:
            parser.error("1000tier budget preparation cannot execute any workload")
        print(json.dumps(prepare_1000_tier(),indent=2))
        sys.exit(0)
    if args.pair_kind != "relative-bounded" and not (args.prepare_pair or args.execute_pair):
        parser.error("nondefault pair-kind requires an explicit pair action")
    if args.prepare_pair or args.execute_pair:
        if (args.prepare_pair and args.execute_pair or args.execute or args.check_runner
                or args.transport != "grpc" or args.profile != ("supply-2048x1-data64" if args.pair_kind in DATA64_PAIRS else "supply-512x2") or args.pacing != "relative"
                or args.observer_phases != (args.pair_kind in ("independent-shared","shared-fair","shared-elastic","shared-prefix-data64","prefix-native-data64","native-submit8-data64","native-suffix-data64","native-observer-facts-data64","native-client-procs2-data64"))):
            parser.error("fixed pair requires explicit grpc/512x2, no individual pacing or other action")
        if args.prepare_pair:
            print(json.dumps(pair_recipe(args.pair_kind), indent=2))
        else:
            if not all((args.source, args.build, args.case, args.receipt)):
                parser.error("pair execute requires exact source/build/new pair root/new receipt")
            sys.exit(run_pair(args.source, args.build, args.case, args.receipt, args.pair_kind))
    elif args.check_runner:
        if args.execute or not args.build or not args.case:
            parser.error("check-runner requires build/new case and excludes execute")
        print(json.dumps(preflight(args.build, args.case), indent=2))
    elif not args.execute:
        print(json.dumps(recipe(args.transport, args.profile, args.pacing,args.observer_phases,prefix_replay=True if args.prefix_replay else None,prefix_native_clone=True if args.prefix_native_clone else None,native_submit8=args.native_submit8,native_suffix_setup=args.native_suffix_setup,observer_native_facts=args.observer_native_facts,client_procs2=args.client_procs2), indent=2))
    else:
        if not all((args.source, args.build, args.case, args.receipt)):
            parser.error("execute requires exact source/build/new case/new receipt")
        sys.exit(run(args.source, args.build, args.case, args.receipt, args.transport, args.profile, args.pacing, observer_phases=args.observer_phases,prefix_replay=True if args.prefix_replay else None,prefix_native_clone=True if args.prefix_native_clone else None,native_submit8=args.native_submit8,native_suffix_setup=args.native_suffix_setup,observer_native_facts=args.observer_native_facts,client_procs2=args.client_procs2))
