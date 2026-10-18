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
            "supply-512x2": dict(PROFILE, name="supply-512x2", senders=512, rounds=2)}
ENV = dict(GOMAXPROCS="1", GOGC="100", GOMEMLIMIT="off")
BINARIES = ("ynx-abci", "cometbft", "ynx-consensus-perf-fixture", "ynx-consensus-perf-client")
PAIR_CAPS = dict(totalMs=120000, retainedBytes=64 << 20, logBytes=2 << 20,
                 buildBytes=1 << 30, metadataReserveMs=500)


def recipe(transport="socket", profile_name="supply-256x4", pacing="relative", observer_phases=False, shared_replay=None):
    if transport not in ("socket", "grpc"):
        raise RuntimeError("only existing socket/grpc ABCI transports allowed")
    if profile_name not in PROFILES:
        raise RuntimeError("only fixed 256x4 or 512x2 Supply profiles allowed")
    if profile_name == "supply-512x2" and transport != "grpc":
        raise RuntimeError("the new 512x2 profile is explicitly gRPC only")
    if pacing not in ("relative", "bounded-cadence", "grouped-cadence4") or pacing != "relative" and profile_name != "supply-512x2":
        raise RuntimeError("bounded cadence is explicit fixed512x2/gRPC only")
    profile = dict(PROFILES[profile_name], name=profile_name + ("-grpc" if transport == "grpc" else "") + ("-"+pacing if pacing != "relative" else ""))
    result = dict(schema=1, profile=profile, abciTransport=transport, pacingMode=pacing,
                pacingCatchupOfferLimit=4 if pacing != "relative" else 1, environment=ENV, execute=False,
                requiresSeparateRootGrant=True, nodesStarted=False,
                platform="Linux native /proc; not macOS pressure1",
                comparison="Independent private CI case; no Darwin before/after multiplier",
                resourceCaps=native.CAPS,
                input="workflow_dispatch.run_linux_supply (default false)")
    if observer_phases:
        result["observerPhaseTiming"]=True
        result["observerTraceLimits"]=dict(perWorker=256,aggregate=1024,totalsCompleteDespiteTraceCap=True)
    if shared_replay is not None:
        if type(shared_replay) is not bool or not observer_phases or (transport,profile_name,pacing)!=("grpc","supply-512x2","bounded-cadence"):
            raise RuntimeError("shared replay selection requires fixed512x2/grpc/bounded-cadence and observer timing")
        result["sharedDurableReplay"]=shared_replay
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
              "independent-shared": ("independent-replay", "shared-replay")}


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
    return dict(schema=1,name="one-shot-2048-independent-senders-offer1000",execute=False,
                executionAuthorized=False,executionAdmitted=False,nodesStarted=False,
                workload=dict(independentSenders=2048,totalTransactions=2048,transactionsPerSender=1,
                              rounds=1,senderMode="rounds",offeredRate=1000,concurrency=4,observers=4,
                              clientTimeoutMs=10000,inclusionMode="block-scan",observerPhaseTiming=True),
                resourceCaps={k:PROFILE[k] for k in ("activeMs","cleanupMs","totalMs","ownedProcesses","longLivedChildren","ownedRSSBytes","privateBytes","threads","availableMemoryFloorBytes")},
                nativeAdmissionCaps={k:native.CAPS[k] for k in ("diskFloorBytes","rootReserveBytes","compileReserveBytes","buildBytes","logBytes","sampleMs")},
                fixtureCommand=["<exact-built-fixture>","-ephemeral","-count","2048","-output","<new-private-network>"],
                clientCommand=["<exact-built-client>","-manifest","<new-private-network>/network-manifest.json",
                               "-transactions","<new-private-network>/transactions.json","-output","<new-private-network>/transactions-result.json",
                               "-rounds","1","-sender-mode","rounds","-offered-rate","1000","-concurrency","4","-observers","4",
                               "-timeout","10s","-inclusion-mode","block-scan","-observer-phase-timing"],
                priorActual=dict(runId=39142884319,sourceCommit=evidence["sourceCommit"],
                                 evidenceSHA256=native.digest(evidence_path),totalTransactions=1024,
                                 independentSenders=512,peakPrivateBytes=peak_data,peakRSSBytes=peak_rss),
                conservativeScenarios=dict(twicePriorPrivateBytes=2*peak_data,twicePriorRSSBytes=2*peak_rss,
                    dataScenarioExceedsExisting32MiB=2*peak_data>PROFILE["privateBytes"],
                    rssScenarioExceedsExisting1GiB=2*peak_rss>PROFILE["ownedRSSBytes"]),
                admissionReasons=["No actual2048/1000tier resource measurement exists. Twice prior peak is a conservative scenario, not a measured projection or proven upper bound.",
                                  "Data scenario exceeds original32MiB; quadrupling independent-account fixture identity versus prior512 also needs charging. No cap increase or data deletion is authorized.",
                                  "RSS cannot be assumed linear: fixed4node/worker cost and retained histories differ. Existing1GiB guard remains mandatory; no verified fit.",
                                  "Owned-process/thread, disk reserve, logs,45+15 window and actual MemAvailable guards remain unchanged. No workload starts from this plan."],
                interpretation="Finite2048 signed business inputs, each with a distinct sender/nonce1. Configured1000offers/s is not accepted/included/final TPS and does not establish ten-minute capacity. Prepared through original fixture/client commands, intentionally not registered as an executable window until budget admissibility is established.")


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
    before, after = pair_modes(comparison)
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
        before, after = pair_modes(comparison)
        self.case_names = ("before-"+before, "after-"+after)
        self.deadline = started + PAIR_CAPS["totalMs"]/1000
        self.samples = []

    def remaining(self):
        return self.deadline-time.monotonic()

    def io_timeout(self):
        remaining = self.remaining()-PAIR_CAPS["metadataReserveMs"]/1000
        if remaining <= 0:
            raise RuntimeError("pair120s metadata budget exhausted")
        return min(5, remaining)

    def observe(self, sample=None):
        if self.remaining() <= 0:
            raise RuntimeError("pair120s total deadline exceeded")
        if sample is None:
            sample = native_sample(self.active_case, self.build, {}, self.started)
        native.enforce(sample)
        roots = (self.root, self.evidence)
        retained = sum(native.directory_bytes(p) for p in roots)
        # The original per-case log cap covers child stdout/stderr directly in
        # its case root. LevelDB *.log files below network/ are durable DB/WAL
        # data, already charged to each32MiB and the aggregate64MiB data caps.
        logs = sum(p.stat().st_size for case_name in self.case_names
                   for p in (self.root/case_name).glob("*.log"))
        if retained > PAIR_CAPS["retainedBytes"]:
            raise RuntimeError("combined pair retained64MiB cap exceeded")
        if logs > PAIR_CAPS["logBytes"]:
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


def pair_case_qualified(row, mode):
    if row.get("firstCause") is not None or row.get("cleanupComplete") is not True or row.get("nodesStarted") is not True:
        raise RuntimeError("pair case failed or cleanup incomplete")
    if row.get("pacingMode") != mode or row.get("abciTransport") != "grpc" or row.get("profile") != recipe("grpc", "supply-512x2", mode)["profile"]:
        raise RuntimeError("pair case fixed configuration mismatch")
    m = row.get("measurement", {})
    if (any(m.get("summary", {}).get(k) != 1024 for k in ("input", "offered", "submitted", "checkTxAccepted", "effectiveBusinessIncluded", "quorumConfirmed", "finalSubmitted"))
            or any(m.get("summary", {}).get(k) != 0 for k in ("submissionUnknown", "timedOut", "notSubmitted", "executionFailed", "checkTxRejected", "checkTxUnverifiedResponses", "observationFailed"))
            or len(row.get("nodePhases", [])) != 4):
        raise RuntimeError("pair case incomplete business results; no second case")


def offer_latency_readout(report):
    rows = report.get("transactions", [])
    if len(rows) != 1024 or report.get("summary", {}).get("finalSubmitted") != 1024:
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
        return dict(samples=1024, **{name:values[math.ceil(q*1024)-1] for name,q in (("p50",.5),("p95",.95),("p99",.99))})
    peaks=report.get("loadQueues",{})
    for name in ("peakOfferedAwaitingSubmission", "peakAcceptedAwaitingObservationCompletion"):
        if type(peaks.get(name)) is not int or not 0 <= peaks[name] <= 1024:
            raise RuntimeError("actual owned queue peak missing/invalid")
    return dict(offerToEffectiveInclusionLatencyMs=quantiles("inclusionMs"),
                offerToQualifiedFinalLatencyMs=quantiles("confirmationMs"), actualQueuePeaks=peaks,
                supply=report["readySenders"]["supply"],
                scope="Actual per-row measured queueDelayMs+stageMs, nearest-rank over all1024 qualified business finals. Queue peaks are original atomic counters, not reconstructed from UTC.")


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


def validate_shared_replay(report, expected):
    if type(expected) is not bool or report.get("sharedDurableReplay") is not expected or report.get("observerPhaseTiming") is not True:
        raise RuntimeError("actual shared replay selection/timing differs")
    reader=report.get("durableReadback",{})
    stats=reader.get("sharedReplay")
    if not expected:
        if stats is not None:
            raise RuntimeError("independent replay baseline unexpectedly enabled shared cache")
        return dict(sharedDurableReplay=False,stats=None)
    names={"lookups","hits","joins","fullReplays","failures","bypasses","waitNs","cachedCanonicalBytes","canonicalByteLimit","peakFlights"}
    if not isinstance(stats,dict) or set(stats)!=names or any(type(v) is not int or v<0 for v in stats.values()):
        raise RuntimeError("shared replay actual bounded counters missing/invalid")
    if (stats["canonicalByteLimit"]!=16 << 20 or stats["cachedCanonicalBytes"]>16 << 20
            or not 1<=stats["peakFlights"]<=4 or stats["fullReplays"]<1
            or stats["failures"]>stats["fullReplays"]
            or stats["hits"]+stats["joins"]+stats["fullReplays"]>stats["lookups"]
            or stats["lookups"]!=reader.get("snapshotValidations")):
        raise RuntimeError("shared replay work counts/retention bound differ")
    if any(row.get("durableStoreFormat")!="block-journal" for row in report.get("transactions",[])):
        raise RuntimeError("shared replay comparison requires actual block-journal business readback")
    return dict(sharedDurableReplay=True,stats=stats,
                interpretation="Counters describe actual work, not logical replayed history. Clone/flight counts are not a physical RSS bound; original sampled guards still apply. No hit or lower work count alone qualifies performance.")


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
            pace = "bounded-cadence" if comparison == "independent-shared" else mode
            if comparison == "independent-shared":
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
            pair_case_qualified(row, pace)
            if comparison in ("bounded-grouped","independent-shared"):
                # Read only the already qualified original client result. This
                # I/O and its hash/quantiles remain inside the same pair budget.
                client_raw=native.bounded(case/"network/transactions-result.json",16 << 20)
                if hashlib.sha256(client_raw).hexdigest() != row.get("resultSHA256"):
                    raise RuntimeError("grouping pair raw client result hash differs")
                client=json.loads(client_raw)
                validate_report(client,"supply-512x2",pace)
                result["cases"][-1]["offerLatency"]=offer_latency_readout(client)
                result["cases"][-1]["nodePhases"]=row["nodePhases"]
                if comparison == "independent-shared":
                    phases=validate_observer_phases(client)
                    shared=validate_shared_replay(client,index==1)
                    if row.get("observerPhases") != phases or row.get("sharedReplayVerification") != shared or row.get("sharedDurableReplay") is not (index==1):
                        raise RuntimeError("shared replay receipt differs from actual client timing/selection")
                    result["cases"][-1].update(observerPhases=phases,sharedReplayVerification=shared,durableReadback=client["durableReadback"])
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
        if comparison in ("bounded-grouped","independent-shared"):
            result["jointObservation"]=joint_observation(*result["cases"])
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
        if elapsed_exact > PAIR_CAPS["totalMs"]:
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


def validate_report(report, profile_name="supply-256x4", pacing="relative"):
    profile = recipe("grpc", profile_name, pacing)["profile"]
    if (report.get("roundsCompleted") != profile["rounds"] or report.get("roundsRequested") != profile["rounds"] or report.get("senderMode") != "ready-pool"
            or report.get("inclusionMode") != "block-scan" or report.get("configuredOfferedRate") != 512
            or report.get("pacingMode") != pacing or report.get("setupErrors")):
        raise RuntimeError("fixed Supply workload incomplete")
    s = report["summary"]
    for key in ("input", "offered", "submitted", "checkTxAccepted", "includedCodeZero",
                "effectiveBusinessIncluded", "quorumConfirmed", "finalSubmitted"):
        if type(s.get(key)) is not int or s[key] != 1024:
            raise RuntimeError("unqualified business count: " + key)
    for key in ("checkTxRejected", "checkTxUnverifiedResponses", "executionFailed", "submissionUnknown",
                "timedOut", "observationFailed", "notSubmitted"):
        if type(s.get(key)) is not int or s[key] != 0:
            raise RuntimeError("business failure/UNKNOWN: " + key)
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
    transactions = report.get("transactions", [])
    if len(transactions) != 1024 or {t.get("index") for t in transactions} != set(range(1024)):
        raise RuntimeError("complete per-transaction evidence required")
    for t in transactions:
        if (t.get("status") != "confirmed" or t.get("checkTxCode") != 0 or t.get("executionCode") != 0
                or any(t.get(k) is not True for k in ("checkTxIdentityVerified", "quorumVerified", "transactionProofVerified", "durableStateVerified", "durableInfoVerified"))
                or t.get("height", 0) <= 0 or t.get("durableStateHeight", 0) < t["height"]
                or t.get("durableInfoHeight", 0) < t["durableStateHeight"]
                or not t.get("durableSnapshotSha256") or not t.get("confirmedObservedAt")):
            raise RuntimeError("per-transaction business qualification missing")
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


def run(source, build, case, receipt, transport="socket", profile_name="supply-256x4", pacing="relative", pair_budget=None, observer_phases=False, shared_replay=None, fixture_only=False):
    selected = fixture_resource_recipe() if fixture_only else recipe(transport, profile_name, pacing, observer_phases, shared_replay)
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

    def mark(phase):
        result["timeline"].append(dict(phase=phase, elapsedNs=int((time.monotonic()-started)*1e9), unixNs=time.time_ns()))

    def command(args):
        return subprocess.check_output(args, cwd=source, timeout=pair_budget.io_timeout() if pair_budget else 5, stderr=subprocess.STDOUT).decode().strip()

    def capture_sample(initial=False):
        sampled=native_sample(case,build,known,started,initial,enforce_limits=not fixture_only)
        if fixture_only:
            sampled["privateBytes"]+=native.directory_bytes(receipt.parent)
            sampled["preexistingGoCacheBytes"]=cache_baseline
            sampled["sharedGoCacheBytes"]=native.directory_bytes(go_cache) if go_cache is not None else 0
            sampled["incrementalGoCacheBytes"]=max(0,sampled["sharedGoCacheBytes"]-cache_baseline)
            sampled["buildBytes"]+=sampled["incrementalGoCacheBytes"]
            try:
                native.enforce(sampled,initial)
                if sampled.get("processLogBytes",0)>native.CAPS["logBytes"]:raise RuntimeError("combined process log cap exceeded")
            except Exception:
                result.setdefault("refusedSamples",[]).append(sampled)
                raise
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
        wait(spawn("fixture", [str(build / BINARIES[2]), "-ephemeral", "-output", str(network), "-count", str(profile["senders"])]+([] if fixture_only else ["-retain-ephemeral-senders"])))
        mark("fixture_complete")
        manifest_path = network / "network-manifest.json"
        manifest = validate_manifest(json.loads(native.bounded(manifest_path, 1 << 20)), network)
        if fixture_only:
            result["fixtureResources"]=fixture_resource_readout(network)
            tick();mark("fixture_resource_readback_complete")
        else:
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
            wait(spawn("client", [str(build / BINARIES[3]), "-manifest", str(manifest_path), "-transactions", str(network / "transactions.json"), "-output", str(output), "-timeout", "10s", "-concurrency", "4", "-observers", "4", "-offered-rate", "512", "-rounds", str(profile["rounds"]), "-sender-mode", "ready-pool", "-inclusion-mode", "block-scan", "-pacing-mode", pacing]+(["-observer-phase-timing"] if observer_phases else [])+(["-shared-durable-replay"] if shared_replay else [])))
            client_report=json.loads(native.bounded(output,16 << 20))
            result["measurement"] = validate_report(client_report, profile_name, pacing)
            if observer_phases:
                result["observerPhases"]=validate_observer_phases(client_report)
            if shared_replay is not None:
                result["sharedReplayVerification"]=validate_shared_replay(client_report,shared_replay)
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
        else:
            print(json.dumps({k: result.get(k) for k in ("firstCause", "nodesStarted", "cleanupComplete", "elapsedMs", "partialMeasurement")}), flush=True)
    return (0 if fixture_qualified else 1) if fixture_only else (1 if result["firstCause"] else 0)


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
    parser.add_argument("--source", type=Path)
    parser.add_argument("--build", type=Path)
    parser.add_argument("--case", type=Path)
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
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
                or args.transport != "grpc" or args.profile != "supply-512x2" or args.pacing != "relative"
                or args.observer_phases != (args.pair_kind=="independent-shared")):
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
        print(json.dumps(recipe(args.transport, args.profile, args.pacing,args.observer_phases), indent=2))
    else:
        if not all((args.source, args.build, args.case, args.receipt)):
            parser.error("execute requires exact source/build/new case/new receipt")
        sys.exit(run(args.source, args.build, args.case, args.receipt, args.transport, args.profile, args.pacing, observer_phases=args.observer_phases))
