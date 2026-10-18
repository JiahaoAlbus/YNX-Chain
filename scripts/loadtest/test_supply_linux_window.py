"""Source-only counterexamples; never start a fixture, node or compiler."""
import importlib.util
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

FILE = Path(__file__).with_name("supply-linux-window.py")
spec = importlib.util.spec_from_file_location("supply", FILE)
supply = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supply)


def manifest(root):
    return dict(purpose="local-ephemeral-consensus-quorum-only-not-for-remote-or-custody",
                migrationPath=str(root / "migration.json"), nodes=[
                    dict(home=str(root / str(i)), abciStatePath=str(root / str(i) / "state.json"),
                         p2pListen=f"tcp://127.0.0.1:{31700+i}", rpcListen=f"tcp://127.0.0.1:{31800+i}",
                         rpcUrl=f"http://127.0.0.1:{31800+i}", abciListen=f"tcp://127.0.0.1:{31900+i}") for i in range(4)])


def report(profile="supply-256x4", pacing="relative"):
    counts = dict.fromkeys(("input", "offered", "submitted", "checkTxAccepted", "includedCodeZero",
                           "effectiveBusinessIncluded", "quorumConfirmed", "finalSubmitted"), 1024)
    counts.update(dict.fromkeys(("checkTxRejected", "checkTxUnverifiedResponses", "executionFailed", "submissionUnknown",
                                "timedOut", "observationFailed", "notSubmitted"), 0))
    counts["finalSubmittedPerMeasurementSecond"]=100
    phases = {}
    for name in ("completionWait", "offerDecode", "pacingWait", "dispatch", "sign", "encode", "journalAppend"):
        phases[name+"Attempts"], phases[name+"Ns"] = 1, 100
    phases.update(signAttempts=768, encodeAttempts=768, signedSuccessors=768,
                  terminalSinkAttempts=0, terminalSinkNs=0, journalSetupNs=100,
                  journalDurableEnvelopes=1024, journalDurableBytes=100)
    phases.update(completionSupplyWaitAttempts=1, completionSupplyWaitNs=100,
                  completionDrainWaitAttempts=0, completionDrainWaitNs=0,
                  completionFailureWaitAttempts=0, completionFailureWaitNs=0,
                  pacingFutureTargetAttempts=1, pacingAlreadyDueAttempts=0,
                  pacingPositiveRemainingNs=50, pacingWakeLatenessNs=50, pacingMaxWakeLatenessNs=50,
                  pacingCatchupTargets=0, pacingCadenceResets=0, pacingPeakCatchupTargets=0)
    rounds = 4
    if profile == "supply-512x2":
        rounds = 2
        phases.update(signAttempts=512, encodeAttempts=512, signedSuccessors=512)
    tx = dict(status="confirmed", checkTxCode=0, executionCode=0, checkTxIdentityVerified=True,
              quorumVerified=True, transactionProofVerified=True, durableStateVerified=True,
              durableInfoVerified=True, height=2, durableStateHeight=2, durableInfoHeight=2,
              durableSnapshotSha256="a"*64, confirmedObservedAt="2026-10-18T00:00:00Z",
              queueDelayMs=10,inclusionMs=1000,confirmationMs=1500)
    return dict(roundsRequested=rounds, roundsCompleted=rounds, pacingMode=pacing, senderMode="ready-pool", inclusionMode="block-scan", configuredOfferedRate=512,
                setupErrors=[], summary=counts, readySenders=dict(supply=phases),
                loadQueues=dict(peakOfferedAwaitingSubmission=4,peakAcceptedAwaitingObservationCompletion=512),
                transactions=[dict(tx, index=i) for i in range(1024)])


class SupplySourceTests(unittest.TestCase):
    def oneshot_report_fixture(self):
        # Structural orchestration data only, not a cryptographic/business run.
        import base64,hashlib
        row=self.observer_report();template=row["transactions"][0]
        row.update(roundsRequested=1,roundsCompleted=1,senderMode="rounds",configuredOfferedRate=1000,
                   concurrency=4,observerConcurrency=4,pacingMode="relative",sharedDurableReplay=True,
                   readySenders=dict(supply={}),endpoints=["http://127.0.0.1:"+str(31757+i) for i in range(4)])
        for key in ("input","offered","submitted","checkTxAccepted","includedCodeZero","effectiveBusinessIncluded","quorumConfirmed","finalSubmitted"):row["summary"][key]=2048
        row["summary"].update(submissionQueueDelayMs=dict(samples=2048,p50=10,p95=10,p99=10),checkTxLatencyMs=dict(samples=2048,p50=20,p95=20,p99=20))
        row["groupedObservation"]["phases"]["totals"]["transaction_inclusion_proof"]["attempts"]=2048
        row["durableReadback"].update(snapshotValidations=1,blockJournalReplayedBlocks=1,blockJournalReplayedTransactionInputs=2048,
            sharedReplay=dict(lookups=1,hits=0,joins=0,fullReplays=1,failures=0,bypasses=0,waitNs=0,cachedCanonicalBytes=100,canonicalByteLimit=16<<20,peakFlights=1))
        fixture=[];rows=[]
        for i in range(2048):
            wire=json.dumps(dict(chainId=6423,type="transfer",nonce=1,amount=1,fee=1,signature="synthetic-unit",publicKey="synthetic-unit",**{"from":"unit-sender-"+str(i),"to":"unit-recipient"})).encode()
            encoded=base64.b64encode(wire).decode();fixture.append(encoded)
            rows.append(dict(template,index=i,round=1,endpoint=row["endpoints"][i%4],signedTransaction=encoded,hash=hashlib.sha256(wire).hexdigest().upper(),bytes=len(wire),checkTxMs=20,durableStoreFormat="block-journal",submissionPhases=self.submission_phases()))
        row["transactions"]=rows
        return row,fixture

    def test_oneshot2048_registered_but_no_execution_or_cap_increase(self):
        plan=supply.recipe("grpc","supply-2048x1","relative",True)
        self.assertFalse(plan["execute"]);self.assertFalse(plan["nodesStarted"]);self.assertTrue(plan["requiresSeparateRootGrant"])
        self.assertEqual(plan["profile"]["senders"],2048);self.assertEqual(plan["profile"]["rounds"],1);self.assertEqual(plan["profile"]["offeredRate"],1000)
        self.assertEqual(plan["resourceCaps"],supply.native.CAPS)
        for k in ("activeMs","cleanupMs","totalMs","ownedProcesses","ownedRSSBytes","privateBytes","threads"):
            self.assertEqual(plan["profile"][k],supply.PROFILE[k])
        for args in (("socket","supply-2048x1","relative",True),("grpc","supply-2048x1"),("grpc","supply-2048x1","bounded-cadence",True),("grpc","supply-2048x1","relative",True,False),("grpc","supply-2048x1","relative",True,True,True)):
            with self.subTest(args=args),self.assertRaises(RuntimeError):supply.recipe(*args)

    def test_data64_profile_is_explicit_and_preserves_original_workload_and_defaults(self):
        legacy=supply.recipe("grpc","supply-2048x1","relative",True)
        scoped=supply.recipe("grpc","supply-2048x1-data64","relative",True)
        self.assertEqual(legacy["resourceCaps"]["privateBytes"],32<<20)
        self.assertEqual(supply.native.CAPS["privateBytes"],32<<20)
        self.assertEqual(scoped["resourceCaps"],dict(legacy["resourceCaps"],privateBytes=64<<20))
        self.assertEqual(scoped["profile"],dict(legacy["profile"],name="supply-2048x1-data64-grpc",privateBytes=64<<20))
        self.assertFalse(scoped["execute"]);self.assertFalse(scoped["nodesStarted"])
        self.assertTrue(scoped["requiresSeparateRootGrant"])
        self.assertFalse(scoped["capacityScope"]["automaticRetry"])
        args=(Path("build"),Path("manifest"),Path("network"),Path("output"))
        self.assertEqual(supply.supply_client_command(*args,legacy["profile"],"relative",True,True),supply.supply_client_command(*args,scoped["profile"],"relative",True,True))
        for args in (("socket","supply-2048x1-data64","relative",True),("grpc","supply-2048x1-data64"),("grpc","supply-2048x1-data64","bounded-cadence",True),("grpc","supply-2048x1-data64","relative",True,False)):
            with self.subTest(args=args),self.assertRaises(RuntimeError):supply.recipe(*args)
        row,fixture=self.oneshot_report_fixture()
        self.assertEqual(supply.validate_report(row,"supply-2048x1-data64",fixture_transactions=fixture),supply.validate_report(row,"supply-2048x1",fixture_transactions=fixture))
        row["summary"]["submissionUnknown"]=1
        with self.assertRaises(RuntimeError):supply.validate_report(row,"supply-2048x1-data64",fixture_transactions=fixture)

    def test_data64_actual_failure_bytes_and_all_other_guards_remain_charged(self):
        import copy
        sample=dict(rssBytes=721408000,threads=63,privateBytes=40191359,buildBytes=118951286,freeDiskBytes=89040670720,availableMemoryBytes=15097982976,processLogBytes=133944)
        original=copy.deepcopy(sample)
        legacy={"profile":supply.recipe("grpc","supply-2048x1","relative",True)["profile"]}
        scoped={"profile":supply.recipe("grpc","supply-2048x1-data64","relative",True)["profile"]}
        with self.assertRaisesRegex(RuntimeError,"privateBytes cap"):
            supply.enforce_captured_sample(sample,legacy)
        self.assertIs(legacy["refusedSamples"][0],sample)
        supply.enforce_captured_sample(sample,scoped)
        self.assertEqual(sample,original)
        for key,value in (("privateBytes",(64<<20)+1),("rssBytes",(1<<30)+1),("threads",321),("buildBytes",(1<<30)+1),("processLogBytes",(1<<20)+1),("availableMemoryBytes",1),("freeDiskBytes",1)):
            changed=dict(sample,**{key:value});result={"profile":scoped["profile"]}
            with self.subTest(key=key),self.assertRaises(RuntimeError):supply.enforce_captured_sample(changed,result)
            self.assertIs(result["refusedSamples"][0],changed)
            self.assertEqual(changed[key],value)
        floor=sum(supply.native.CAPS[k] for k in ("diskFloorBytes","rootReserveBytes","compileReserveBytes"))
        reserve=dict(sample,privateBytes=1,freeDiskBytes=floor+(32<<20))
        supply.enforce_captured_sample(reserve,legacy,True)
        with self.assertRaisesRegex(RuntimeError,"disk floor"):
            supply.enforce_captured_sample(reserve,scoped,True)
        for bad in (32<<20,65<<20,True):
            with self.subTest(bad=bad),self.assertRaisesRegex(RuntimeError,"unregistered"):
                supply.native.enforce(sample,private_bytes_cap=bad)
        self.assertEqual(supply.native.CAPS["privateBytes"],32<<20)

    def test_oneshot2048_all_original_business_and_phase_rows_required(self):
        row,fixture=self.oneshot_report_fixture()
        result=supply.validate_report(row,"supply-2048x1",fixture_transactions=fixture)
        self.assertEqual(result["oneShot"]["independentSenders"],2048)
        self.assertFalse(result["oneShot"]["sustainedTPSQualified"])
        self.assertEqual(result["submissionPhaseVerification"]["samples"],2048)
        self.assertEqual(result["offerLatency"]["offerToQualifiedFinalLatencyMs"]["p95"],1510)
        self.assertEqual(result["originalSubmissionTails"]["checkTxLatencyMs"]["samples"],2048)

    def test_oneshot2048_rejects_missing_identity_proof_nonce_phase_and_wrong_mode(self):
        import copy,base64
        original,fixture=self.oneshot_report_fixture()
        for kind in ("missing","unknown","proof","authority","fixture","hash","nonce","duplicate","phase","count","ready","workers","offer","rounds","shared","tail"):
            row=copy.deepcopy(original);inputs=list(fixture)
            if kind=="missing":row["transactions"].pop()
            if kind=="unknown":row["summary"]["submissionUnknown"]=1
            if kind=="proof":row["transactions"][0]["quorumVerified"]=False
            if kind=="authority":row["transactions"][0]["endpoint"]=row["endpoints"][1]
            if kind=="fixture":inputs[0]=inputs[1]
            if kind=="hash":row["transactions"][0]["hash"]="0"*64
            if kind in ("nonce","duplicate"):
                tx=json.loads(base64.b64decode(inputs[0]));tx["nonce"]=2 if kind=="nonce" else 1
                if kind=="duplicate":tx["from"]="unit-sender-1"
                inputs[0]=base64.b64encode(json.dumps(tx).encode()).decode();row["transactions"][0]["signedTransaction"]=inputs[0]
                import hashlib
                row["transactions"][0].update(hash=hashlib.sha256(base64.b64decode(inputs[0])).hexdigest().upper(),bytes=len(base64.b64decode(inputs[0])))
            if kind=="phase":del row["transactions"][0]["submissionPhases"]
            if kind=="count":row["summary"]["finalSubmitted"]=1024
            if kind=="ready":row["readySenders"]["supply"]={"signAttempts":1}
            if kind=="workers":row["concurrency"]=5
            if kind=="offer":row["configuredOfferedRate"]=512
            if kind=="rounds":row["roundsRequested"]=2
            if kind=="shared":row["sharedDurableReplay"]=False
            if kind=="tail":row["summary"]["submissionQueueDelayMs"]["p99"]=999
            with self.subTest(kind=kind),self.assertRaises(RuntimeError):supply.validate_report(row,"supply-2048x1",fixture_transactions=inputs)

    def test_oneshot2048_original_client_command_has_no_ready_pool_or_successor_keys(self):
        profile=supply.recipe("grpc","supply-2048x1","relative",True)["profile"]
        cmd=supply.supply_client_command(Path("build"),Path("network/manifest"),Path("network"),Path("out"),profile,"relative",True,True)
        for flag,value in (("-offered-rate","1000"),("-sender-mode","rounds"),("-rounds","1"),("-concurrency","4"),("-observers","4")):
            self.assertEqual(cmd[cmd.index(flag)+1],value)
        self.assertIn("-shared-durable-replay",cmd);self.assertIn("-observer-phase-timing",cmd)
        for flag in ("-endpoint-fair-submission","-endpoint-elastic-submission","-streaming-workload","-terminal-gzip"):
            self.assertNotIn(flag,cmd)

    def test_oneshot2048_cli_is_read_only_until_explicit_execute(self):
        args=[sys.executable,"-B",str(FILE),"--profile","supply-2048x1","--transport","grpc","--observer-phases"]
        result=subprocess.run(args,capture_output=True,text=True,timeout=5)
        self.assertEqual(result.returncode,0,result.stderr)
        plan=json.loads(result.stdout);self.assertFalse(plan["execute"]);self.assertFalse(plan["nodesStarted"])
        self.assertTrue(plan["sharedDurableReplay"])
        refused=subprocess.run(args[:-1],capture_output=True,text=True,timeout=5)
        self.assertNotEqual(refused.returncode,0)
        with self.assertRaisesRegex(RuntimeError,"shared replay"):
            supply.run(Path("source"),Path("build"),Path("case"),Path("receipt"),"grpc","supply-2048x1",observer_phases=True,shared_replay=False)

    def test_larger_probe_retains_actual_refused_bytes_without_raising_caps(self):
        sample=dict(rssBytes=1,threads=1,privateBytes=(32<<20)+1,buildBytes=1,freeDiskBytes=10<<30,availableMemoryBytes=2<<30,processLogBytes=0)
        result={}
        with self.assertRaisesRegex(RuntimeError,"privateBytes cap"):
            supply.enforce_captured_sample(sample,result)
        self.assertIs(result["refusedSamples"][0],sample)
        self.assertEqual(result["refusedSamples"][0]["privateBytes"],33554433)
        self.assertEqual(supply.native.CAPS["privateBytes"],32<<20)
        sample=dict(sample,privateBytes=1,processLogBytes=(1<<20)+1);result={}
        with self.assertRaisesRegex(RuntimeError,"log cap"):
            supply.enforce_captured_sample(sample,result)
        self.assertEqual(result["refusedSamples"][0]["processLogBytes"],1048577)

    def test_oneshot_terminal_requires_actual_post_fsync_caps_total_and_double_closure(self):
        import copy,hashlib
        base=dict(firstCause=None,nodesStarted=True,cleanupComplete=True,launcher=7,
                  closureScans=[dict(owned=[7],launcherStartTicks=1),dict(owned=[7],launcherStartTicks=1)],
                  measurement=dict(summary=dict(finalSubmitted=2048)))
        with tempfile.TemporaryDirectory() as d:
            receipt=Path(d)/"actual.json";receipt.write_text(json.dumps(base))
            def check(row,capture=lambda:dict(privateBytes=1),elapsed=1):
                out=io.StringIO()
                with patch.object(supply.time,"monotonic",return_value=elapsed),contextlib.redirect_stdout(out):
                    qualified=supply.oneshot_post_fsync(row,receipt,capture,0)
                frame=json.loads(out.getvalue().split("YNX_ONESHOT_1000_TERMINAL ")[1])
                self.assertEqual(frame["receiptSHA256"],hashlib.sha256(receipt.read_bytes()).hexdigest())
                self.assertIs(frame["qualified"],qualified)
                return qualified,frame
            self.assertTrue(check(copy.deepcopy(base))[0])
            for kind in ("child","missing","identity","incomplete","cause","cleanup","deadline","caps"):
                row=copy.deepcopy(base);elapsed=1;capture=lambda:dict(privateBytes=1)
                if kind=="child":row["closureScans"][-1]["owned"]=[7,8]
                if kind=="missing":row["closureScans"].pop()
                if kind=="identity":row["closureScans"][-1]["launcherStartTicks"]=2
                if kind=="incomplete":row["measurement"]["summary"]["finalSubmitted"]=2047
                if kind=="cause":row["firstCause"]="original UNKNOWN"
                if kind=="cleanup":row["cleanupComplete"]=False
                if kind=="deadline":elapsed=60.001
                if kind=="caps":
                    def capture():raise RuntimeError("original privateBytes cap exceeded after fsync")
                with self.subTest(kind=kind):
                    qualified,frame=check(row,capture,elapsed)
                    self.assertFalse(qualified);self.assertIsNotNone(frame["firstCause"])

    def test_default_has_no_execution(self):
        raw = subprocess.check_output([sys.executable, "-B", str(FILE)], timeout=5)
        row = json.loads(raw)
        self.assertIs(row["execute"], False)
        self.assertIs(row["nodesStarted"], False)
        self.assertIs(row["requiresSeparateRootGrant"], True)
        self.assertEqual(row["profile"]["activeMs"] + row["profile"]["cleanupMs"], 60000)
        self.assertEqual(supply.native.CAPS["activeMs"], 105000)  # parent module unchanged

    def test_manifest_private_paths_and_loopback(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            supply.validate_manifest(manifest(root), root)
            for url in ("http://public.example:31800", "http://127.0.0.1:31800@public.example:31800",
                        "http://127.0.0.1:31800/?next=x", "http://localhost:31800", "http://127.0.0.1"):
                with self.subTest(url=url), self.assertRaises((RuntimeError, ValueError)):
                    supply.endpoint(url)
            for key, value in (("home", str(root.parent)), ("abciStatePath", str(root.parent / "database")),
                               ("rpcUrl", "http://127.0.0.1:12345")):
                m = manifest(root); m["nodes"][0][key] = value
                with self.subTest(key=key), self.assertRaises(RuntimeError):
                    supply.validate_manifest(m, root)
            (root / "escape").symlink_to(root.parent, target_is_directory=True)
            with self.assertRaises(RuntimeError):
                supply.inside(root / "escape" / "state", root)

    def test_summary_does_not_replace_business_proofs(self):
        supply.validate_report(report())
        for key in ("quorumVerified", "transactionProofVerified", "durableStateVerified", "durableInfoVerified", "checkTxIdentityVerified"):
            row = report(); row["transactions"][35][key] = False
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                supply.validate_report(row)
        for key in ("submissionUnknown", "executionFailed", "timedOut"):
            row = report(); row["summary"][key] = 1
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                supply.validate_report(row)
        row = report(); row["transactions"][0]["index"] = 1
        with self.assertRaises(RuntimeError):
            supply.validate_report(row)

    def test_supply_initial_signatures_excluded_but_all_journaled(self):
        for key, value in (("signedSuccessors", 1024), ("journalDurableEnvelopes", 768),
                           ("terminalSinkAttempts", 1024), ("signNs", -1), ("completionWaitNs", 0)):
            row = report(); row["readySenders"]["supply"][key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                supply.validate_report(row)

    def test_native_resource_refusals_preserve_parent_caps(self):
        baseline = dict(rssBytes=1, threads=1, privateBytes=1, buildBytes=1,
                        freeDiskBytes=10 << 30, availableMemoryBytes=2 << 30)
        supply.native.enforce(baseline, True)
        for key, value in (("rssBytes", (1 << 30)+1), ("threads", 321),
                           ("privateBytes", (32 << 20)+1), ("freeDiskBytes", 1),
                           ("availableMemoryBytes", (1 << 30)+(128 << 20)-1)):
            row = dict(baseline, **{key: value})
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                supply.native.enforce(row, True)

    def test_nondarwin_alias_no_start(self):
        with patch.object(supply.sys, "platform", "darwin"), patch.object(supply.subprocess, "Popen") as start:
            with self.assertRaises(RuntimeError):
                supply.run(Path("/source"), Path("/build"), Path("/case"), Path("/receipt"))
            start.assert_not_called()

    def test_redirects_fail_closed(self):
        with self.assertRaises(RuntimeError):
            supply.NoRedirect().redirect_request(None, None, None, None, None, None)

    def test_missing_live_rss_is_not_zero(self):
        launcher = supply.os.getpid()
        rows = {launcher: dict(pid=launcher, parent=0, startTicks=1, state="R", threads=1)}
        with patch.object(supply.native, "proc_inventory", return_value=(rows, [])), \
                patch.object(supply.native, "bounded", side_effect=PermissionError("smaps denied")):
            with self.assertRaises(PermissionError):
                supply.native_sample(Path("/case"), Path("/build"), {}, 0)

    def test_owned_pid_overflow_is_not_truncated(self):
        launcher = supply.os.getpid()
        rows = {launcher: dict(pid=launcher, parent=0, startTicks=1)}
        rows.update({launcher+i: dict(pid=launcher+i, parent=launcher, startTicks=i+1) for i in range(1, 11)})
        with patch.object(supply.native, "proc_inventory", return_value=(rows, [])), \
                patch.object(supply.native, "bounded") as read:
            with self.assertRaisesRegex(RuntimeError, "process cap"):
                supply.native_sample(Path("/case"), Path("/build"), {}, 0)
            read.assert_not_called()

    def test_ci_is_opt_in_and_follows_existing_release_gates(self):
        workflow = FILE.parents[2] / ".github/workflows/chain-core.yml"
        text = workflow.read_text()
        start = text.index("      run_linux_supply:")
        self.assertIn("default: false", text[start:text.index("      measure_anchor_validation:", start)])
        step = text.index("      - name: Build and run explicitly scheduled isolated Linux Supply case")
        self.assertGreater(step, text.index("      - run: make secret-scan"))
        self.assertIn("github.event_name == 'workflow_dispatch' && inputs.run_linux_supply", text[step:step+250])
        self.assertIn("test_supply_linux_window.py -v", text)

    def test_transport_pair_is_explicit_and_caps_identical(self):
        original, grpc = supply.recipe(), supply.recipe("grpc")
        self.assertEqual(original["abciTransport"], "socket")
        for key in original["profile"]:
            if key != "name":
                self.assertEqual(original["profile"][key], grpc["profile"][key])
        node = manifest(Path("/private"))["nodes"][0]
        app, comet = supply.server_commands(Path("/build"), node, "/private/migration.json", "grpc")
        self.assertEqual(app[app.index("-transport")+1], "grpc")
        self.assertEqual(comet[comet.index("--abci")+1], "grpc")
        self.assertEqual(comet[comet.index("--proxy_app")+1], "127.0.0.1:31900")
        _, original_comet = supply.server_commands(Path("/build"), node, "/private/migration.json", "socket")
        self.assertNotIn("--proxy_app", original_comet)
        self.assertIn("-phase-timing", app)
        self.assertIn("block-journal", app)
        with self.assertRaises(RuntimeError):
            supply.server_commands(Path("/build"), node, "/private/migration.json", "local-unverified")

    def test_actual_deadline_shape_retained_but_cannot_qualify(self):
        row = report()
        row["summary"].update(offered=990, submitted=819, finalSubmitted=734,
                              submissionUnknown=4, timedOut=81, notSubmitted=205)
        row["setupErrors"] = [dict(stage="run", message="context deadline exceeded")]
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "failed.json"
            output.write_text(json.dumps(row))
            partial = supply.partial_measurement(output)
            self.assertIs(partial["qualified"], False)
            self.assertEqual(partial["summary"]["submissionUnknown"], 4)
            self.assertEqual(partial["summary"]["timedOut"], 81)
            self.assertEqual(partial["supply"], row["readySenders"]["supply"])
            with self.assertRaises(RuntimeError):
                supply.validate_report(row)

    def test_fixed_512_profile_does_not_raise_resource_or_transaction_caps(self):
        old = supply.recipe("grpc")["profile"]
        new = supply.recipe("grpc", "supply-512x2")["profile"]
        self.assertEqual(new["senders"]*new["rounds"], 1024)
        for key in old:
            if key not in ("name", "senders", "rounds"):
                self.assertEqual(old[key], new[key])
        for name in ("custom", "supply-1024x2", "supply-512x4"):
            with self.assertRaises(RuntimeError):
                supply.recipe("grpc", name)
        with self.assertRaises(RuntimeError):
            supply.recipe("socket", "supply-512x2")

    def test_512_profile_requires_its_actual_round_and_successor_counts(self):
        supply.validate_report(report("supply-512x2"), "supply-512x2")
        for row in (report(), dict(report("supply-512x2"), roundsCompleted=4)):
            with self.assertRaises(RuntimeError):
                supply.validate_report(row, "supply-512x2")
        row = report("supply-512x2")
        row["readySenders"]["supply"]["signedSuccessors"] = 768
        with self.assertRaises(RuntimeError):
            supply.validate_report(row, "supply-512x2")

    def test_wait_scope_mismatch_or_failure_cannot_qualify(self):
        for key, value in (("completionSupplyWaitNs", 101), ("completionDrainWaitAttempts", 1),
                           ("completionFailureWaitNs", 1), ("pacingFutureTargetAttempts", 0),
                           ("pacingMaxWakeLatenessNs", 51)):
            row = report("supply-512x2"); row["readySenders"]["supply"][key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                supply.validate_report(row, "supply-512x2")
        row = report("supply-512x2")
        del row["readySenders"]["supply"]["completionDrainWaitNs"]
        with self.assertRaises(RuntimeError):
            supply.validate_report(row, "supply-512x2")

    def test_bounded_cadence_is_explicit_and_has_no_resource_override(self):
        old = supply.recipe("grpc", "supply-512x2")
        candidate = supply.recipe("grpc", "supply-512x2", "bounded-cadence")
        self.assertEqual(old["pacingMode"], "relative")
        self.assertEqual(candidate["pacingCatchupOfferLimit"], 4)
        self.assertEqual(old["environment"], candidate["environment"])
        for key in old["profile"]:
            if key != "name": self.assertEqual(old["profile"][key], candidate["profile"][key])
        for profile, pacing in (("supply-256x4", "bounded-cadence"), ("supply-512x2", "unbounded")):
            with self.assertRaises(RuntimeError):
                supply.recipe("grpc", profile, pacing)

    def test_selected_pacing_must_match_actual_report_and_burst_cap(self):
        row = report("supply-512x2", "bounded-cadence")
        row["readySenders"]["supply"].update(pacingCatchupTargets=1, pacingPeakCatchupTargets=1)
        supply.validate_report(row, "supply-512x2", "bounded-cadence")
        with self.assertRaises(RuntimeError):
            supply.validate_report(row, "supply-512x2", "relative")
        row["readySenders"]["supply"]["pacingPeakCatchupTargets"] = 4
        with self.assertRaises(RuntimeError):
            supply.validate_report(row, "supply-512x2", "bounded-cadence")

    def test_grouped_four_preserves_caps_and_cannot_replace_frozen_pair_mode(self):
        old=supply.recipe("grpc","supply-512x2","bounded-cadence")
        grouped=supply.recipe("grpc","supply-512x2","grouped-cadence4")
        self.assertEqual(grouped["pacingCatchupOfferLimit"],4)
        self.assertEqual(old["environment"],grouped["environment"])
        for key in old["profile"]:
            if key!="name":self.assertEqual(old["profile"][key],grouped["profile"][key])
        with self.assertRaises(RuntimeError):supply.recipe("grpc","supply-256x4","grouped-cadence4")
        row=report("supply-512x2","grouped-cadence4")
        row["readySenders"]["supply"].update(pacingCatchupTargets=768,pacingPeakCatchupTargets=3)
        supply.validate_report(row,"supply-512x2","grouped-cadence4")
        with self.assertRaises(RuntimeError):supply.validate_report(row,"supply-512x2","bounded-cadence")
        self.assertEqual([r["pacingMode"] for r in supply.pair_recipe()["cases"]],["relative","bounded-cadence"])
        with self.assertRaises(RuntimeError):supply.pair_case_qualified(self.pair_row("grouped-cadence4"),"bounded-cadence")

    def test_pair_prepare_is_fixed_and_never_starts(self):
        row = json.loads(subprocess.check_output([sys.executable, "-B", str(FILE), "--prepare-pair", "--transport", "grpc", "--profile", "supply-512x2"], timeout=5))
        self.assertFalse(row["execute"])
        self.assertFalse(row["nodesStarted"])
        self.assertEqual(row["pairCaps"], dict(totalMs=120000, retainedBytes=64 << 20, logBytes=2 << 20, buildBytes=1 << 30, metadataReserveMs=500))
        self.assertEqual([r["pacingMode"] for r in row["cases"]], ["relative", "bounded-cadence"])
        for case in row["cases"]:
            self.assertEqual(case["profile"]["privateBytes"], 32 << 20)
            self.assertEqual(case["profile"]["activeMs"]+case["profile"]["cleanupMs"], 60000)
            self.assertEqual(case["profile"]["senders"]*case["profile"]["rounds"], 1024)

    def test_pair_total_retained_deadline_and_build_are_not_doubled(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve(); data=root/"data"; evidence=root/"evidence"; build=root/"build"
            for directory in (data,evidence,build): directory.mkdir()
            sample = dict(rssBytes=1, threads=1, privateBytes=1, buildBytes=1, freeDiskBytes=10 << 30, availableMemoryBytes=2 << 30)
            budget = supply.PairBudget(data,evidence,0,build)
            with patch.object(supply.time,"monotonic",return_value=1), patch.object(supply.native,"directory_bytes",return_value=33 << 20):
                with self.assertRaisesRegex(RuntimeError,"retained64MiB"):
                    budget.observe(sample)
            with patch.object(supply.time,"monotonic",return_value=120):
                with self.assertRaisesRegex(RuntimeError,"deadline"):
                    budget.observe(sample)
            with patch.object(supply.time,"monotonic",return_value=1):
                with self.assertRaisesRegex(RuntimeError,"buildBytes"):
                    budget.observe(dict(sample,buildBytes=(1 << 30)+1))

    def test_pair_leveldb_wal_is_data_not_process_stdout(self):
        # Actual39140104063 falsely counted nested blockstore/state/tx_index
        # *.log WAL as child stdout, refusing a5.75MiB case at the2MiB log cap.
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve(); data=root/"pair"; evidence=root/"evidence"; build=root/"build"
            for d in (data,evidence,build):d.mkdir()
            case=data/"before-relative"; database=case/"network/validator-1/data/state.db"
            database.mkdir(parents=True)
            (database/"000001.log").write_bytes(b"w"*(3 << 20))
            (case/"comet-0.log").write_bytes(b"s"*1024)
            sample=dict(rssBytes=1,threads=1,privateBytes=(3 << 20)+1024,buildBytes=1,
                        freeDiskBytes=10 << 30,availableMemoryBytes=2 << 30)
            budget=supply.PairBudget(data,evidence,0,build)
            with patch.object(supply.time,"monotonic",return_value=1):
                budget.observe(sample)
                self.assertEqual(budget.samples[-1]["logBytes"],1024)
                self.assertGreaterEqual(budget.samples[-1]["retainedBytes"],3 << 20)
                after=data/"after-bounded-cadence";after.mkdir()
                (after/"comet-0.log").write_bytes(b"s"*(2 << 20))
                with self.assertRaisesRegex(RuntimeError,"stdout/stderr log2MiB"):
                    budget.observe(sample)

    def test_pair_rejects_incomplete_or_unclean_case(self):
        for change in (dict(firstCause="deadline"),dict(cleanupComplete=False),dict(nodesStarted=False)):
            row = self.pair_row("relative");row.update(change)
            with self.assertRaises(RuntimeError): supply.pair_case_qualified(row,"relative")
        row = self.pair_row("relative");row["measurement"]["summary"]["submissionUnknown"]=4
        with self.assertRaises(RuntimeError): supply.pair_case_qualified(row,"relative")

    def test_pair_refuses_second_case_when_owned_closure_not_empty(self):
        pid = supply.os.getpid()
        rows = {pid:dict(pid=pid,parent=0,startTicks=1),pid+1000:dict(pid=pid+1000,parent=pid,startTicks=2)}
        budget = type("Budget",(),dict(observe=lambda self:None,started=0))()
        with patch.object(supply.native,"proc_inventory",return_value=(rows,[])):
            with self.assertRaisesRegex(RuntimeError,"not empty"):
                supply.empty_pair_closure(budget)

    @staticmethod
    def pair_row(mode):
        return dict(firstCause=None,cleanupComplete=True,nodesStarted=True,pacingMode=mode,abciTransport="grpc",
                    profile=supply.recipe("grpc","supply-512x2",mode)["profile"],
                    measurement=dict(summary=report("supply-512x2",mode)["summary"]),nodePhases=[{} for _ in range(4)])

    def mock_pair(self, first_failure=None, mutate_binary=False, fail_after_fsync=False,comparison="relative-bounded",corrupt_result=False,replay_fault=None):
        # Synthetic orchestration only: no compiler, fixture, socket or node.
        import hashlib
        with tempfile.TemporaryDirectory() as temp:
            parent=Path(temp).resolve();source=parent/"source";build=parent/"build";evidence=parent/"evidence"
            for d in (source,build,evidence):d.mkdir()
            binaries={}
            for name in supply.BINARIES:
                raw=name.encode();(build/name).write_bytes(raw);binaries[name]=dict(sha256=hashlib.sha256(raw).hexdigest())
            order=[]
            def fake_run(source,build,case,out,transport,profile,mode,**kwargs):
                label=(("shared-endpoint-elastic" if comparison=="shared-elastic" else "shared-endpoint-fair") if kwargs.get("endpoint_fair") else "shared-baseline") if comparison in ("shared-fair","shared-elastic") else ("shared-replay" if kwargs.get("shared_replay") else "independent-replay") if comparison=="independent-shared" else mode
                order.append(label);case.mkdir()
                if replay_fault=="rss" and (kwargs.get("endpoint_fair") if comparison in ("shared-fair","shared-elastic") else kwargs.get("shared_replay")):
                    raise RuntimeError("synthetic candidate owned RSS cap exceeded")
                row=self.pair_row(mode)
                row.update(sourceCommit="a"*40,sourceTree="b"*40,internalTree="c"*40,compiler="synthetic-unit",
                           binaries=binaries,environment=supply.ENV,host=dict(uname=list(supply.platform.uname()),cpuCount=supply.os.cpu_count()))
                code=0
                if first_failure=="error":row["firstCause"]="synthetic deadline";code=1
                if first_failure=="cleanup":row["cleanupComplete"]=False
                if first_failure=="unknown":row["measurement"]["summary"]["submissionUnknown"]=4
                if comparison in ("bounded-grouped","independent-shared","shared-fair","shared-elastic"):
                    client=report("supply-512x2",mode)
                    if comparison in ("independent-shared","shared-fair","shared-elastic"):
                        self.assertTrue(kwargs["observer_phases"])
                        self.assertIsInstance(kwargs["shared_replay"],bool)
                        timed=self.observer_report()
                        client.update(observerPhaseTiming=True,sharedDurableReplay=kwargs["shared_replay"],groupedObservation=timed["groupedObservation"],durableReadback=timed["durableReadback"])
                        client["durableReadback"].update(snapshotValidations=1,blockJournalReplayedBlocks=1,blockJournalReplayedTransactionInputs=1024)
                        for tx in client["transactions"]:tx["durableStoreFormat"]="block-journal"
                        if kwargs["shared_replay"]:
                            client["durableReadback"]["sharedReplay"]=dict(lookups=1,hits=0,joins=0,fullReplays=1,failures=0,bypasses=0,waitNs=0,cachedCanonicalBytes=100,canonicalByteLimit=16 << 20,peakFlights=1)
                        row.update(observerPhaseTiming=True,sharedDurableReplay=kwargs["shared_replay"],observerPhases=supply.validate_observer_phases(client),sharedReplayVerification=supply.validate_shared_replay(client,kwargs["shared_replay"]))
                        if replay_fault=="selection":row["sharedDurableReplay"]=not kwargs["shared_replay"]
                    if comparison in ("shared-fair","shared-elastic"):
                        self.assertTrue(kwargs["shared_replay"])
                        flag=kwargs["endpoint_fair"]
                        client.update(endpointFairSubmission=flag,endpoints=["http://127.0.0.1:"+str(31757+i) for i in range(4)])
                        for tx in client["transactions"]:tx["endpoint"]=client["endpoints"][tx["index"]%4]
                        if flag:client["readySenders"]["endpointDispatch"]=dict(workers=4,perEndpointInFlightLimit=1,queueCapacityTotal=1024,callbackAttempts=[256]*4,callbackReturns=[256]*4)
                        for tx in client["transactions"]:tx["checkTxMs"]=20
                        client["summary"]["submissionQueueDelayMs"]=dict(samples=1024,p50=10,p95=10,p99=10)
                        client["summary"]["checkTxLatencyMs"]=dict(samples=1024,p50=20,p95=20,p99=20)
                        row["measurement"]["summary"]=client["summary"]
                        row["measurement"]["supply"]=client["readySenders"]["supply"]
                        if first_failure=="unknown":row["measurement"]["summary"]["submissionUnknown"]=4
                        row.update(endpointFairSubmission=flag,endpointDispatchVerification=supply.validate_endpoint_dispatch(client,flag))
                        if replay_fault=="endpoint-selection":row["endpointFairSubmission"]=not flag
                        if replay_fault=="authority":client["transactions"][0]["endpoint"]=client["endpoints"][1]
                        if replay_fault=="tail-summary":client["summary"]["submissionQueueDelayMs"]["p99"]=999
                        if replay_fault=="case-measurement":row["measurement"]["supply"]=dict(client["readySenders"]["supply"],signAttempts=511)
                        if comparison=="shared-elastic":
                            elastic=kwargs["endpoint_elastic"]
                            self.assertIs(elastic,flag)
                            client["endpointElasticSubmission"]=elastic
                            if elastic:client["readySenders"]["endpointDispatch"].update(perEndpointInFlightLimit=2,peakInFlight=[1,2,1,2],peakTotalInFlight=4)
                            for tx in client["transactions"]:tx["submissionPhases"]=self.submission_phases()
                            row.update(endpointElasticSubmission=elastic,submissionPhaseVerification=supply.validate_submission_phases(client),endpointDispatchVerification=supply.validate_endpoint_dispatch(client,flag,elastic=elastic))
                            if replay_fault=="elastic-selection":row["endpointElasticSubmission"]=not elastic
                            if replay_fault=="phase-missing":del client["transactions"][0]["submissionPhases"]
                            if replay_fault=="phase-repeat":client["transactions"][0]["submissionPhases"]["wroteRequestCalls"]=2
                            if replay_fault=="phase-case-drift":row["submissionPhaseVerification"]["samples"]=1
                            if replay_fault=="elastic-peaks" and elastic:client["readySenders"]["endpointDispatch"]["peakTotalInFlight"]=5
                    network=case/"network";network.mkdir()
                    encoded=json.dumps(client).encode();(network/"transactions-result.json").write_bytes(encoded)
                    row["resultSHA256"]=hashlib.sha256(encoded).hexdigest() if not corrupt_result else "0"*64
                out.write_text(json.dumps(row))
                if mutate_binary:(build/supply.BINARIES[0]).write_bytes(b"changed")
                return code
            bounded=supply.native.bounded
            def read(path,limit=65536):
                return b"synthetic-unit-boot" if str(path)=="/proc/sys/kernel/random/boot_id" else bounded(path,limit)
            def empty(budget):order.append("empty");return []
            def observe(sample=None):
                if fail_after_fsync and (evidence/"actual.json").exists():
                    raise RuntimeError("synthetic pair budget exhausted after receipt fsync")
            output=io.StringIO()
            with patch.object(supply.sys,"platform","linux"),patch.object(supply.platform,"machine",return_value="x86_64"), \
                    patch.object(supply.native,"bounded",side_effect=read),patch.object(supply.os,"readlink",return_value="pid:[unit]"), \
                    patch.object(supply.PairBudget,"observe",side_effect=observe),patch.object(supply,"empty_pair_closure",side_effect=empty), \
                    patch.object(supply,"run",side_effect=fake_run),patch.object(supply.signal,"signal"),patch.object(supply.signal,"setitimer"), \
                    contextlib.redirect_stdout(output):
                code=supply.run_pair(source,build,parent/"pair",evidence/"actual.json",comparison)
            row=json.loads((evidence/"actual.json").read_text())
            row["_terminal"]=json.loads(output.getvalue().split("YNX_SUPPLY_PAIR_TERMINAL ")[-1])
            return code,order,row

    def test_pair_stops_after_failed_unknown_or_unclean_first_case(self):
        for reason in ("error","unknown","cleanup"):
            with self.subTest(reason=reason):
                code,order,row=self.mock_pair(first_failure=reason)
                self.assertEqual(code,1);self.assertEqual(order,["relative"])
                self.assertFalse(row["casesQualified"])

    def test_pair_serial_order_and_changed_binary_refusal(self):
        code,order,row=self.mock_pair()
        self.assertEqual(code,0);self.assertEqual(order,["relative","empty","bounded-cadence","empty"])
        self.assertTrue(row["casesQualified"])
        code,order,row=self.mock_pair(mutate_binary=True)
        self.assertEqual(code,1);self.assertEqual(order,["relative","empty"])
        self.assertIn("binary changed",row["firstCause"])

    def test_pair_post_fsync_budget_rejects_otherwise_qualified_cases(self):
        code,order,row=self.mock_pair(fail_after_fsync=True)
        self.assertEqual(code,1)
        self.assertTrue(row["casesQualified"])
        self.assertFalse(row["_terminal"]["qualified"])
        self.assertIn("after receipt fsync",row["_terminal"]["firstCause"])

    def test_grouping_pair_explicit_order_and_original_recipe_unchanged(self):
        import hashlib
        raw=(json.dumps(supply.pair_recipe(),indent=2)+"\n").encode()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),"d13f9f6bcbc2051cef78b9b46041bde79d713de810bad98efdedc0287c4f7dc7")
        grouped=supply.pair_recipe("bounded-grouped")
        self.assertEqual(grouped["input"]["linux_supply_pacing"],"paired-bounded-grouped")
        self.assertEqual([c["pacingMode"] for c in grouped["cases"]],["bounded-cadence","grouped-cadence4"])
        self.assertEqual(grouped["pairCaps"],supply.pair_recipe()["pairCaps"])
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();data=root/"pair";evidence=root/"evidence";build=root/"build"
            for d in (data,evidence,build):d.mkdir()
            case=data/"after-grouped-cadence4";case.mkdir()
            (case/"client.log").write_bytes(b"x"*((2 << 20)+1))
            budget=supply.PairBudget(data,evidence,0,build,"bounded-grouped")
            sample=dict(rssBytes=1,threads=1,privateBytes=1,buildBytes=1,freeDiskBytes=10 << 30,availableMemoryBytes=2 << 30)
            with patch.object(supply.time,"monotonic",return_value=1):
                with self.assertRaisesRegex(RuntimeError,"stdout/stderr log2MiB"):budget.observe(sample)
        with self.assertRaises(RuntimeError):supply.pair_recipe("grouped-bounded")
        code,order,row=self.mock_pair(comparison="bounded-grouped")
        self.assertEqual(code,0);self.assertEqual(order,["bounded-cadence","empty","grouped-cadence4","empty"])
        self.assertIn("jointObservation",row)
        self.assertFalse(row["jointObservation"]["finiteJointImprovementObserved"])
        self.assertEqual(row["cases"][0]["offerLatency"]["offerToQualifiedFinalLatencyMs"]["p95"],1510)

    def test_grouping_pair_unknown_or_changed_raw_never_starts_second_case(self):
        for kwargs in (dict(first_failure="unknown"),dict(first_failure="cleanup"),dict(corrupt_result=True)):
            with self.subTest(kwargs=kwargs):
                code,order,row=self.mock_pair(comparison="bounded-grouped",**kwargs)
                self.assertEqual(code,1);self.assertEqual(order,["bounded-cadence"])
                self.assertFalse(row["_terminal"]["qualified"])

    def test_offer_latency_includes_queue_and_invalid_or_missing_values_fail(self):
        row=report("supply-512x2")
        row["transactions"][0].update(queueDelayMs=5000,confirmationMs=1)
        readout=supply.offer_latency_readout(row)
        self.assertEqual(readout["offerToEffectiveInclusionLatencyMs"]["p95"],1010)
        self.assertEqual(readout["offerToQualifiedFinalLatencyMs"]["p95"],1510)
        for value in (-1,float("inf"),float("nan"),None):
            row=report("supply-512x2");row["transactions"][0]["queueDelayMs"]=value
            with self.subTest(value=value),self.assertRaises(RuntimeError):supply.offer_latency_readout(row)
        row=report("supply-512x2");row["loadQueues"]["peakAcceptedAwaitingObservationCompletion"]=1025
        with self.assertRaises(RuntimeError):supply.offer_latency_readout(row)

    def test_more_tps_with_worse_final_p95_is_not_joint_acceptance(self):
        before=dict(summary=dict(finalSubmittedPerMeasurementSecond=200),offerLatency=supply.offer_latency_readout(report("supply-512x2")))
        after=dict(summary=dict(finalSubmittedPerMeasurementSecond=300),offerLatency=supply.offer_latency_readout(report("supply-512x2","grouped-cadence4")))
        after["offerLatency"]["offerToQualifiedFinalLatencyMs"]["p95"]=1600
        guard=supply.joint_observation(before,after)
        self.assertTrue(guard["finiteFinalRateIncreased"])
        self.assertFalse(guard["offerToFinalP95NotWorse"])
        self.assertFalse(guard["finiteJointImprovementObserved"])
        self.assertFalse(guard["sustainedTPSQualified"])
        after["summary"]["finalSubmittedPerMeasurementSecond"]=float("nan")
        with self.assertRaises(RuntimeError):supply.joint_observation(before,after)

    def test_observer_timing_opt_in_does_not_change_old_pair_recipe(self):
        original=supply.recipe("grpc","supply-512x2","bounded-cadence")
        timed=supply.recipe("grpc","supply-512x2","bounded-cadence",True)
        self.assertNotIn("observerPhaseTiming",original)
        self.assertTrue(timed["observerPhaseTiming"])
        self.assertEqual(original["profile"],timed["profile"])
        self.assertEqual(timed["observerTraceLimits"]["aggregate"],1024)

    @staticmethod
    def observer_report():
        row=report("supply-512x2")
        mapping={"block_query":"blockQueries","block_results_query":"blockResultsQueries","commit_query":"commitQueries",
                 "validators_query":"validatorQueries","quorum_verification":"quorumVerifications",
                 "durable_business_batch":"durableBatches","published_info_query":"publishedInfoQueries"}
        totals={p:dict(attempts=1,errors=0,durationNs=100) for p in mapping}
        totals["transaction_inclusion_proof"]=dict(attempts=1024,errors=0,durationNs=100)
        stats={c:1 for c in mapping.values()};stats["transactionQueries"]=0
        stats["phases"]=dict(schema=1,totals=totals,traceCapped=True,trace=[dict(sequence=1,worker=0,phase="block_query",node=0,height=2,members=0,startOffsetNs=1,durationNs=100,failed=False)])
        row.update(observerPhaseTiming=True,groupedObservation=stats,
                   durableReadback=dict(phaseTotalsNs={k:100 for k in ("loadNs","hashNs","captureNs","decodeNs","indexPublishNs","transactionVerifyNs")}))
        return row

    def test_observer_timing_requires_original_call_counts_and_bounded_monotonic_facts(self):
        supply.validate_observer_phases(self.observer_report())
        for change in ("call_count","missing_reader","fake_error","negative_trace","oversize_trace","missing_opt_in"):
            row=self.observer_report()
            if change=="call_count":row["groupedObservation"]["blockQueries"]=2
            if change=="missing_reader":del row["durableReadback"]["phaseTotalsNs"]["decodeNs"]
            if change=="fake_error":row["groupedObservation"]["phases"]["totals"]["commit_query"]["errors"]=2
            if change=="negative_trace":row["groupedObservation"]["phases"]["trace"][0]["durationNs"]=-1
            if change=="oversize_trace":row["groupedObservation"]["phases"]["trace"]*=1025
            if change=="missing_opt_in":row["observerPhaseTiming"]=False
            with self.subTest(change=change),self.assertRaises(RuntimeError):supply.validate_observer_phases(row)

    def test_shared_replay_integrated_pair_has_one_difference_and_old_recipes_stay_pinned(self):
        import hashlib
        pins={"relative-bounded":"d13f9f6bcbc2051cef78b9b46041bde79d713de810bad98efdedc0287c4f7dc7",
              "bounded-grouped":"f474659891e8d4ac20d5cdf023cb8a3f31f7e55f151689c8dc125369fe72b874"}
        for kind,pin in pins.items():
            self.assertEqual(hashlib.sha256((json.dumps(supply.pair_recipe(kind),indent=2)+"\n").encode()).hexdigest(),pin)
        pair=supply.pair_recipe("independent-shared")
        before,after=pair["cases"]
        self.assertFalse(before["sharedDurableReplay"])
        self.assertTrue(after["sharedDurableReplay"])
        self.assertEqual({k:v for k,v in before.items() if k!="sharedDurableReplay"},{k:v for k,v in after.items() if k!="sharedDurableReplay"})
        self.assertTrue(before["observerPhaseTiming"])
        self.assertEqual(pair["pairCaps"],supply.PAIR_CAPS)
        self.assertTrue(pair["input"]["measure_observer_phases"])
        denied=subprocess.run([sys.executable,"-B",str(FILE),"--prepare-pair","--pair-kind","independent-shared","--transport","grpc","--profile","supply-512x2"],capture_output=True,text=True,timeout=5)
        self.assertEqual(denied.returncode,2)
        for args in (("grpc","supply-512x2","bounded-cadence",False,True),("socket","supply-256x4","relative",True,True)):
            with self.assertRaises(RuntimeError):supply.recipe(*args)

    def test_shared_replay_pair_preserves_serial_closure_identity_and_terminal_guards(self):
        code,order,row=self.mock_pair(comparison="independent-shared")
        self.assertEqual(code,0)
        self.assertEqual(order,["independent-replay","empty","shared-replay","empty"])
        self.assertFalse(row["cases"][0]["sharedReplayVerification"]["sharedDurableReplay"])
        self.assertTrue(row["cases"][1]["sharedReplayVerification"]["sharedDurableReplay"])
        self.assertIn("observerPhases",row["cases"][0])
        self.assertFalse(row["jointObservation"]["sustainedTPSQualified"])
        for kwargs in (dict(first_failure="unknown"),dict(first_failure="cleanup"),dict(corrupt_result=True),dict(replay_fault="selection")):
            with self.subTest(kwargs=kwargs):
                code,order,row=self.mock_pair(comparison="independent-shared",**kwargs)
                self.assertEqual(code,1)
                self.assertEqual(order,["independent-replay"])
                self.assertFalse(row["_terminal"]["qualified"])
        for kwargs in (dict(mutate_binary=True),dict(replay_fault="rss"),dict(fail_after_fsync=True)):
            with self.subTest(kwargs=kwargs):
                code,order,row=self.mock_pair(comparison="independent-shared",**kwargs)
                self.assertEqual(code,1)
                self.assertFalse(row["_terminal"]["qualified"])
        self.assertIn("after receipt fsync",row["_terminal"]["firstCause"])

    def test_shared_replay_actual_counter_and_retention_forgery_refused(self):
        row=self.observer_report()
        row.update(sharedDurableReplay=True)
        row["durableReadback"].update(snapshotValidations=1,sharedReplay=dict(lookups=1,hits=0,joins=0,fullReplays=1,failures=0,bypasses=0,waitNs=0,cachedCanonicalBytes=100,canonicalByteLimit=16 << 20,peakFlights=1))
        for tx in row["transactions"]:tx["durableStoreFormat"]="block-journal"
        supply.validate_shared_replay(row,True)
        import copy
        for field,value in (("peakFlights",5),("cachedCanonicalBytes",(16 << 20)+1),("lookups",2),("canonicalByteLimit",32 << 20),("fullReplays",0),("hits",1),("failures",2),("waitNs",-1)):
            changed=copy.deepcopy(row);changed["durableReadback"]["sharedReplay"][field]=value
            with self.subTest(field=field),self.assertRaises(RuntimeError):supply.validate_shared_replay(changed,True)
        with self.assertRaises(RuntimeError):supply.validate_shared_replay(row,False)
        row["sharedDurableReplay"]=False
        with self.assertRaises(RuntimeError):supply.validate_shared_replay(row,False)

    def test_shared_replay_work_phases_validate_actual_counts_without_rebinding_legacy_results(self):
        import copy
        row=self.observer_report();row["sharedDurableReplay"]=True
        stats=dict(lookups=3,hits=1,joins=1,fullReplays=1,failures=0,bypasses=0,waitNs=10,cachedCanonicalBytes=100,canonicalByteLimit=16<<20,peakFlights=1)
        row["durableReadback"].update(snapshotValidations=3,sharedReplay=stats)
        for tx in row["transactions"]:tx["durableStoreFormat"]="block-journal"
        legacy=copy.deepcopy(supply.validate_shared_replay(row,True))
        with self.assertRaisesRegex(RuntimeError,"work phases required"):
            supply.validate_shared_replay(row,True,require_work_phases=True)
        phase=lambda calls,ns:dict(calls=calls,errors=0,durationNs=ns)
        stats["workPhases"]=dict(produce=phase(1,100),canonicalCopy=phase(3,10),privateJSON=phase(2,60),privateValidate=phase(2,50),canonicalCopyBytes=300)
        self.assertEqual(supply.validate_shared_replay(row,True,require_work_phases=True)["stats"],stats)
        for kind in ("missing","unknown","negative","boolean","zero_duration","too_many_errors","produce_count","copy_count","private_count","validation_count","copy_bytes"):
            changed=copy.deepcopy(row);work=changed["durableReadback"]["sharedReplay"]["workPhases"]
            if kind=="missing":del work["produce"]
            if kind=="unknown":work["extra"]={}
            if kind=="negative":work["privateJSON"]["durationNs"]=-1
            if kind=="boolean":work["produce"]["calls"]=True
            if kind=="zero_duration":work["privateValidate"]["durationNs"]=0
            if kind=="too_many_errors":work["privateJSON"]["errors"]=3
            if kind=="produce_count":work["produce"]["calls"]=2
            if kind=="copy_count":work["canonicalCopy"]["calls"]=4
            if kind=="private_count":work["privateJSON"]["calls"]=3
            if kind=="validation_count":work["privateValidate"]["calls"]=1
            if kind=="copy_bytes":work["canonicalCopyBytes"]=-1
            with self.subTest(kind=kind),self.assertRaises(RuntimeError):supply.validate_shared_replay(changed,True)
        del stats["workPhases"]
        self.assertEqual(supply.validate_shared_replay(row,True),legacy)

    def test_shared_replay_pair_is_only_prepared_and_preserves_original_caps(self):
        plan=supply.prepare_shared_replay_pair()
        self.assertFalse(plan["execute"])
        self.assertFalse(plan["executionAdmitted"])
        self.assertFalse(plan["executionAuthorized"])
        self.assertFalse(plan["nodesStarted"])
        self.assertEqual(plan["selected"]["profile"],supply.recipe("grpc","supply-512x2","bounded-cadence",True)["profile"])
        self.assertTrue(plan["before"]["observerPhaseTiming"] and plan["after"]["observerPhaseTiming"])
        self.assertEqual(plan["cache"]["entries"],1)
        self.assertEqual(plan["pairCaps"],supply.PAIR_CAPS)
        self.assertEqual(plan["selected"]["profile"]["privateBytes"],32 << 20)
        self.assertNotIn(plan["name"],supply.PROFILES)
        denied=subprocess.run([sys.executable,"-B",str(FILE),"--prepare-shared-replay-pair","--execute"],capture_output=True,text=True,timeout=5)
        self.assertEqual(denied.returncode,2)
        self.assertIn("cannot execute any workload",denied.stderr)

    def test_1000_tier_is_budget_only_and_never_admitted_by_extrapolation(self):
        tier=supply.prepare_1000_tier()
        self.assertFalse(tier["execute"])
        self.assertFalse(tier["executionAuthorized"])
        self.assertFalse(tier["executionAdmitted"])
        self.assertEqual(tier["workload"]["independentSenders"],2048)
        self.assertEqual(tier["workload"]["totalTransactions"],2048)
        self.assertEqual(tier["workload"]["offeredRate"],1000)
        self.assertEqual(tier["workload"]["transactionsPerSender"],1)
        self.assertEqual(tier["resourceCaps"]["privateBytes"],32 << 20)
        self.assertEqual(tier["resourceCaps"]["ownedRSSBytes"],1 << 30)
        self.assertTrue(tier["conservativeScenarios"]["dataScenarioExceedsExisting32MiB"])
        self.assertEqual(tier["actualFixtureResources"]["runId"],39151370359)
        self.assertLess(tier["actualFixtureResources"]["fixtureBytes"],tier["resourceCaps"]["privateBytes"])
        self.assertFalse(tier["actualFixtureResources"]["nodesStarted"])
        self.assertTrue(tier["actualFixtureResources"]["nodeReaderRuntimePeakStillUnknown"])
        self.assertNotIn(tier["name"],supply.PROFILES)
        denied=subprocess.run([sys.executable,"-B",str(FILE),"--prepare-1000-tier","--execute"],capture_output=True,text=True,timeout=5)
        self.assertEqual(denied.returncode,2)
        self.assertIn("cannot execute any workload",denied.stderr)

    @staticmethod
    def synthetic_2048_fixture(root):
        import base64
        root.mkdir()
        m=manifest(root)
        (root/"network-manifest.json").write_text(json.dumps(m))
        accounts=[];rows=[]
        for i in range(2048):
            sender="synthetic-sender-"+str(i)
            accounts.append(dict(address=sender,balance=10000,nonce=0))
            tx=dict(chainId=6423,nonce=1,type="transfer",amount=1,fee=1,signature="synthetic-not-a-crypto-proof",publicKey="synthetic",**{"from":sender,"to":"synthetic-recipient"})
            rows.append(base64.b64encode(json.dumps(tx).encode()).decode())
        (root/"migration.json").write_text(json.dumps(dict(accounts=accounts)))
        (root/"transactions.json").write_text(json.dumps(dict(transactions=rows)))
        for i in range(4):
            d=root/str(i)/"config";d.mkdir(parents=True);(d/"genesis.json").write_text('{}')
        return rows

    def test_2048_fixture_resource_recipe_is_not_a_network_profile(self):
        plan=supply.fixture_resource_recipe()
        self.assertFalse(plan["nodesStarted"])
        self.assertFalse(plan["networkExecutionAdmitted"])
        self.assertFalse(plan["execute"])
        self.assertEqual(plan["profile"]["senders"],2048)
        self.assertNotIn(plan["profile"]["name"],supply.PROFILES)
        self.assertEqual(plan["resourceCaps"],supply.native.CAPS)
        for action in ("--execute","--execute-pair","--prepare-pair","--observer-phases","--prepare-1000-tier"):
            refused=subprocess.run([sys.executable,"-B",str(FILE),"--measure-1000-fixture",action],capture_output=True,text=True,timeout=5)
            self.assertEqual(refused.returncode,2)
            self.assertIn("cannot combine",refused.stderr)

    @staticmethod
    def submission_phases():
        return dict(getConnCalls=1,gotConnCalls=1,wroteRequestCalls=1,firstByteCalls=1,writeErrors=0,
                    firstGetConnNs=1000000,firstGotConnNs=2000000,firstWroteRequestNs=3000000,
                    firstResponseByteNs=4000000,firstConnReused=True,callbackReturnNs=25000000)

    def test_elastic_pair_keeps_original_budget_and_only_changes_dispatch_policy(self):
        plan=supply.pair_recipe("shared-elastic");a,b=plan["cases"]
        self.assertEqual(plan["pairCaps"],supply.PAIR_CAPS)
        self.assertFalse(plan["execute"])
        self.assertTrue(plan["requiresSeparateRootGrant"])
        for key in ("endpointFairSubmission","endpointElasticSubmission"):
            self.assertIs(a[key],False);self.assertIs(b[key],True)
        omitted={"endpointFairSubmission","endpointElasticSubmission"}
        self.assertEqual({k:v for k,v in a.items() if k not in omitted},{k:v for k,v in b.items() if k not in omitted})
        self.assertEqual(plan["input"]["linux_supply_pacing"],"paired-shared-elastic")
        for args in (("grpc","supply-512x2","bounded-cadence",True,True,False,True),
                     ("grpc","supply-512x2","bounded-cadence",True,False,True,True)):
            with self.assertRaises(RuntimeError):supply.recipe(*args)

    def test_elastic_pair_reads_both_original_phases_and_rejects_drift_or_failures(self):
        code,order,row=self.mock_pair(comparison="shared-elastic")
        self.assertEqual(code,0,row.get("firstCause"))
        self.assertEqual(order,["shared-baseline","empty","shared-endpoint-elastic","empty"])
        self.assertTrue(all(c["submissionPhaseVerification"]["samples"]==1024 for c in row["cases"]))
        self.assertEqual(row["cases"][1]["endpointDispatchVerification"]["stats"]["perEndpointInFlightLimit"],2)
        for fault in ("phase-missing","phase-repeat","phase-case-drift","elastic-selection","elastic-peaks","authority","endpoint-selection","tail-summary","case-measurement","rss"):
            with self.subTest(fault=fault):
                code,order,row=self.mock_pair(comparison="shared-elastic",replay_fault=fault)
                self.assertNotEqual(code,0)
                self.assertIsNotNone(row["firstCause"])
        for kwargs in (dict(first_failure="unknown"),dict(first_failure="cleanup"),dict(corrupt_result=True),dict(mutate_binary=True),dict(fail_after_fsync=True)):
            with self.subTest(kwargs=kwargs):
                code,order,row=self.mock_pair(comparison="shared-elastic",**kwargs)
                self.assertNotEqual(code,0)

    def test_elastic_pair_cli_requires_explicit_timed_fixed_profile(self):
        args=[sys.executable,"-B",str(FILE),"--prepare-pair","--pair-kind","shared-elastic","--observer-phases","--transport","grpc","--profile","supply-512x2"]
        result=subprocess.run(args,capture_output=True,text=True,timeout=5)
        self.assertEqual(result.returncode,0,result.stderr)
        plan=json.loads(result.stdout)
        self.assertFalse(plan["execute"]);self.assertFalse(plan["nodesStarted"])
        for kind in ("untimed","socket","profile","not-pair"):
            changed=list(args)
            if kind=="untimed":changed.remove("--observer-phases")
            if kind=="socket":changed[changed.index("grpc")]="socket"
            if kind=="profile":changed[changed.index("supply-512x2")]="supply-256x4"
            if kind=="not-pair":changed.remove("--prepare-pair")
            with self.subTest(kind=kind):
                refused=subprocess.run(changed,capture_output=True,text=True,timeout=5)
                self.assertEqual(refused.returncode,2)

    def test_original_http_phase_offsets_reject_missing_repeated_or_fabricated_boundaries(self):
        import copy
        row=report("supply-512x2","bounded-cadence");row["observerPhaseTiming"]=True
        for tx in row["transactions"]:tx.update(checkTxMs=20,submissionPhases=self.submission_phases())
        result=supply.validate_submission_phases(row)
        self.assertEqual(result["durationsMs"]["connectionAcquireMs"],dict(samples=1024,p50=1,p95=1,p99=1))
        self.assertEqual(result["durationsMs"]["callbackReturnMs"]["p99"],25)
        for key,value in (("getConnCalls",2),("gotConnCalls",True),("writeErrors",1),("firstGetConnNs",-1),("firstGotConnNs",0),("callbackReturnNs",19000000),("firstConnReused",1)):
            changed=copy.deepcopy(row);changed["transactions"][0]["submissionPhases"][key]=value
            with self.subTest(key=key),self.assertRaises(RuntimeError):supply.validate_submission_phases(changed)
        for mode in ("missing","count","untimed","nan"):
            changed=copy.deepcopy(row)
            if mode=="missing":del changed["transactions"][0]["submissionPhases"]["firstResponseByteNs"]
            if mode=="count":changed["transactions"].pop()
            if mode=="untimed":changed["observerPhaseTiming"]=False
            if mode=="nan":changed["transactions"][0]["checkTxMs"]=float("nan")
            with self.subTest(mode=mode),self.assertRaises(RuntimeError):supply.validate_submission_phases(changed)
        row["transactions"][0]["submissionPhases"]["firstResponseByteNs"]=2500000
        result=supply.validate_submission_phases(row)
        self.assertEqual(result["writeFirstByteHookOverlaps"],1)
        self.assertEqual(result["durationsMs"]["writeToFirstByteMs"]["samples"],1023)
        self.assertEqual(result["durationsMs"]["firstByteToReturnMs"]["samples"],1024)

    def test_elastic_dispatch_refuses_excess_peaks_or_legacy_mislabel(self):
        import copy
        row=report("supply-512x2","bounded-cadence")
        row.update(endpointFairSubmission=True,endpointElasticSubmission=True,endpoints=["http://127.0.0.1:"+str(31757+i) for i in range(4)])
        for tx in row["transactions"]:tx["endpoint"]=row["endpoints"][tx["index"]%4]
        row["readySenders"]["endpointDispatch"]=dict(workers=4,perEndpointInFlightLimit=2,queueCapacityTotal=1024,callbackAttempts=[256]*4,callbackReturns=[256]*4,peakInFlight=[2]*4,peakTotalInFlight=4)
        supply.validate_endpoint_dispatch(row,True,elastic=True)
        with self.assertRaises(RuntimeError):supply.validate_endpoint_dispatch(row,True)
        for key,value in (("workers",5),("perEndpointInFlightLimit",3),("peakInFlight",[3,1,1,1]),("peakInFlight",[True]*4),("peakTotalInFlight",5),("peakTotalInFlight",True),("peakTotalInFlight",1)):
            changed=copy.deepcopy(row);changed["readySenders"]["endpointDispatch"][key]=value
            with self.subTest(key=key),self.assertRaises(RuntimeError):supply.validate_endpoint_dispatch(changed,True,elastic=True)

    def test_fair_pair_changes_only_dispatch_and_keeps_existing_recipes_pinned(self):
        import hashlib
        pins={"relative-bounded":"d13f9f6bcbc2051cef78b9b46041bde79d713de810bad98efdedc0287c4f7dc7",
              "bounded-grouped":"f474659891e8d4ac20d5cdf023cb8a3f31f7e55f151689c8dc125369fe72b874",
              "independent-shared":"c504a71a2d7860693d78d67888ba2d245f3e7071e894c06a15684b770c9ce8c2",
              "shared-fair":"00ca9b48e2b8e9cca442f4a28406b4c71cedd74a5ed5e4b6902f9bafea3a90a6"}
        for kind,pin in pins.items():self.assertEqual(hashlib.sha256((json.dumps(supply.pair_recipe(kind),indent=2)+"\n").encode()).hexdigest(),pin)
        plan=supply.pair_recipe("shared-fair");a,b=plan["cases"]
        self.assertFalse(plan["execute"])
        self.assertEqual(plan["pairCaps"],supply.PAIR_CAPS)
        self.assertTrue(a["sharedDurableReplay"] and b["sharedDurableReplay"])
        self.assertTrue(a["observerPhaseTiming"] and b["observerPhaseTiming"])
        self.assertFalse(a["endpointFairSubmission"]);self.assertTrue(b["endpointFairSubmission"])
        self.assertEqual({k:v for k,v in a.items() if k!="endpointFairSubmission"},{k:v for k,v in b.items() if k!="endpointFairSubmission"})
        with self.assertRaises(RuntimeError):supply.recipe("grpc","supply-512x2","bounded-cadence",True,False,True)
        refused=subprocess.run([sys.executable,"-B",str(FILE),"--prepare-pair","--pair-kind","shared-fair","--transport","grpc","--profile","supply-512x2"],capture_output=True,text=True,timeout=5)
        self.assertEqual(refused.returncode,2)

    def test_fair_pair_raw_identity_authority_caps_and_failure_stop_second_case(self):
        code,order,row=self.mock_pair(comparison="shared-fair")
        self.assertEqual(code,0)
        self.assertEqual(order,["shared-baseline","empty","shared-endpoint-fair","empty"])
        self.assertTrue(all(c["sharedReplayVerification"]["sharedDurableReplay"] for c in row["cases"]))
        self.assertTrue(row["cases"][1]["endpointDispatchVerification"]["stats"]["workers"]==4)
        self.assertIn("dispatchTailObservation",row)
        self.assertFalse(row["dispatchTailObservation"]["sustainedTPSQualified"])
        for kwargs in (dict(first_failure="unknown"),dict(first_failure="cleanup"),dict(corrupt_result=True),dict(replay_fault="authority"),dict(replay_fault="endpoint-selection"),dict(replay_fault="tail-summary"),dict(replay_fault="case-measurement")):
            with self.subTest(kwargs=kwargs):
                code,order,row=self.mock_pair(comparison="shared-fair",**kwargs)
                self.assertEqual(code,1);self.assertEqual(order,["shared-baseline"])
                self.assertFalse(row["_terminal"]["qualified"])
        for kwargs in (dict(mutate_binary=True),dict(replay_fault="rss"),dict(fail_after_fsync=True)):
            with self.subTest(kwargs=kwargs):
                code,order,row=self.mock_pair(comparison="shared-fair",**kwargs)
                self.assertEqual(code,1);self.assertFalse(row["_terminal"]["qualified"])

    def test_fair_dispatch_rejects_worker_request_count_or_authority_forgery(self):
        import copy
        row=report("supply-512x2","bounded-cadence")
        row.update(endpointFairSubmission=True,endpoints=["http://127.0.0.1:"+str(31757+i) for i in range(4)])
        for tx in row["transactions"]:tx["endpoint"]=row["endpoints"][tx["index"]%4]
        row["readySenders"]["endpointDispatch"]=dict(workers=4,perEndpointInFlightLimit=1,queueCapacityTotal=1024,callbackAttempts=[256]*4,callbackReturns=[256]*4)
        supply.validate_endpoint_dispatch(row,True)
        for key,value in (("workers",5),("perEndpointInFlightLimit",2),("queueCapacityTotal",2048),("callbackAttempts",[257,256,256,256]),("callbackReturns",[255,256,256,256])):
            changed=copy.deepcopy(row);changed["readySenders"]["endpointDispatch"][key]=value
            with self.subTest(key=key),self.assertRaises(RuntimeError):supply.validate_endpoint_dispatch(changed,True)
        changed=copy.deepcopy(row);changed["transactions"][0]["endpoint"]=row["endpoints"][1]
        with self.assertRaises(RuntimeError):supply.validate_endpoint_dispatch(changed,True)
        with self.assertRaises(RuntimeError):supply.validate_report(row,"supply-512x2","bounded-cadence")

    def test_faster_fair_dispatch_cannot_hide_worse_queue_checktx_or_final_p99(self):
        import copy
        before=dict(summary=report("supply-512x2")["summary"],offerLatency=supply.offer_latency_readout(report("supply-512x2")))
        for key in ("submissionQueueDelayMs","checkTxLatencyMs"):before["summary"][key]=dict(samples=1024,p50=10,p95=20,p99=30)
        after=copy.deepcopy(before);after["summary"]["finalSubmittedPerMeasurementSecond"]=200
        joint=supply.joint_observation(before,after)
        self.assertTrue(joint["finiteJointImprovementObserved"])
        self.assertTrue(supply.dispatch_tail_observation(before,after,joint)["finiteJointAndTailImprovement"])
        for key in ("submissionQueueDelayMs","checkTxLatencyMs"):
            for quantile in ("p95","p99"):
                changed=copy.deepcopy(after);changed["summary"][key][quantile]=100
                self.assertFalse(supply.dispatch_tail_observation(before,changed,joint)["finiteJointAndTailImprovement"])
        after["offerLatency"]["offerToQualifiedFinalLatencyMs"]["p99"]+=1
        self.assertFalse(supply.dispatch_tail_observation(before,after,joint)["finiteJointAndTailImprovement"])

    def test_submission_tail_summary_must_match_all_original_rows(self):
        import copy
        row=report("supply-512x2")
        for i,tx in enumerate(row["transactions"]):tx.update(queueDelayMs=i,checkTxMs=20)
        row["summary"].update(submissionQueueDelayMs=dict(samples=1024,p50=511,p95=972,p99=1013),checkTxLatencyMs=dict(samples=1024,p50=20,p95=20,p99=20))
        self.assertEqual(supply.original_submission_tails(row)["submissionQueueDelayMs"]["p99"],1013)
        for mode in ("summary","count","missing","negative","nan"):
            changed=copy.deepcopy(row)
            if mode=="summary":changed["summary"]["submissionQueueDelayMs"]["p99"]=1
            if mode=="count":changed["transactions"].pop()
            if mode=="missing":del changed["transactions"][0]["checkTxMs"]
            if mode=="negative":changed["transactions"][0]["queueDelayMs"]=-1
            if mode=="nan":changed["transactions"][0]["checkTxMs"]=float("nan")
            with self.subTest(mode=mode),self.assertRaises(RuntimeError):supply.original_submission_tails(changed)

    def test_2048_fixture_readback_binds_every_sender_nonce_and_all_file_bytes(self):
        import base64
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/"network";rows=self.synthetic_2048_fixture(root)
            result=supply.fixture_resource_readout(root)
            self.assertEqual(result["independentSenders"],2048)
            self.assertEqual(result["migrationAccounts"],2048)
            self.assertEqual(result["totalFixtureBytes"],sum(p.stat().st_size for p in root.rglob('*') if p.is_file()))
            for mode in ("duplicate","nonce","sender-secrets","node-state"):
                modified=list(rows)
                if mode=="duplicate":modified[-1]=modified[0]
                if mode=="nonce":
                    tx=json.loads(base64.b64decode(modified[-1]));tx["nonce"]=2;modified[-1]=base64.b64encode(json.dumps(tx).encode()).decode()
                (root/"transactions.json").write_text(json.dumps(dict(transactions=modified)))
                extra=root/"ephemeral-sender-secrets.json" if mode=="sender-secrets" else root/"0"/"state.json"
                if mode in ("sender-secrets","node-state"):extra.write_text('{}')
                with self.subTest(mode=mode),self.assertRaises(RuntimeError):supply.fixture_resource_readout(root)
                if extra.exists():extra.unlink()

    def test_fixture_resource_controller_cannot_start_nodes_or_client(self):
        # Synthetic control-path counterexample only. No Go or fixture binary
        # executes; actual resource peaks require the separate opt-in CI run.
        import ctypes
        with tempfile.TemporaryDirectory() as temp:
            parent=Path(temp).resolve();source=parent/"source";build=parent/"build";evidence=parent/"evidence";cache=parent/"cache"
            for d in (source,build,evidence,cache):d.mkdir()
            (cache/"existing").write_bytes(b'x'*100)
            head='a'*40;commands=[]
            def command(args,**kwargs):
                if args==["git","rev-parse","HEAD"]:return head.encode()
                if args==["git","status","--porcelain"]:return b''
                if args[0]=="git":return b'b'*40
                if args==["go","env","GOCACHE"]:return str(cache).encode()
                if args==["go","version"]:return b'go version synthetic-unit'
                if args[:3]==["go","version","-m"]:return ("GOOS=linux GOARCH=amd64 CGO_ENABLED=0 vcs.revision="+head+" vcs.modified=false").encode()
                raise AssertionError(args)
            test=self
            class Child:
                pid=91001;returncode=0
                def poll(self):return 0
                def kill(self):pass
            def popen(args,**kwargs):
                commands.append(args)
                if args[:2]==["go","build"]:
                    test.assertNotIn("-trimpath",args,"fixture-only build must reuse normal source-gate package cache")
                    wire=bytearray(20);wire[:6]=b'\x7fELF\x02\x01';wire[18:20]=b'\x3e\x00';(build/"ynx-consensus-perf-fixture").write_bytes(wire)
                elif args[0]==str(build/"ynx-consensus-perf-fixture"):
                    test.assertNotIn("-retain-ephemeral-senders",args);test.assertEqual(args[-2:],["-count","2048"]);test.synthetic_2048_fixture(Path(args[args.index("-output")+1]))
                else:raise AssertionError("unexpected node/client/compiler command: "+str(args))
                return Child()
            class Prctl:
                def __call__(self,option,arg,third,*rest):
                    if option==37:ctypes.cast(arg,ctypes.POINTER(ctypes.c_int))[0]=1
                    return 0
            class Libc:prctl=Prctl()
            real_bounded=supply.native.bounded
            def bounded(path,limit=65536):
                if str(path)=="/proc/mounts":return b'proc /proc proc rw 0 0\n'
                if str(path) in ("/proc/meminfo","/proc/cpuinfo"):return b'synthetic-unit'
                return real_bounded(path,limit)
            def sample(case,build,known,started,initial=False,enforce_limits=True):
                return dict(rssBytes=100,threads=1,privateBytes=supply.native.directory_bytes(case),buildBytes=supply.native.directory_bytes(build),freeDiskBytes=10 << 30,availableMemoryBytes=2 << 30,tasks=[])
            rows={supply.os.getpid():dict(pid=supply.os.getpid(),parent=0,startTicks=1,threads=1,state='R')}
            stdout=io.StringIO()
            with patch.object(supply.sys,"platform","linux"),patch.object(supply.platform,"machine",return_value="x86_64"),patch.object(supply.platform,"uname",return_value=("Linux","synthetic","unit","unit","x86_64","synthetic")), \
                    patch.object(supply.subprocess,"check_output",side_effect=command),patch.object(supply.subprocess,"Popen",side_effect=popen), \
                    patch.object(supply.ctypes,"CDLL",return_value=Libc()),patch.object(supply,"native_sample",side_effect=sample), \
                    patch.object(supply.native,"bounded",side_effect=bounded),patch.object(supply.native,"proc_inventory",return_value=(rows,[])), \
                    patch.object(supply.signal,"signal"),contextlib.redirect_stdout(stdout):
                code=supply.run(source,build,parent/"case",evidence/"actual.json",fixture_only=True)
            actual=json.loads((evidence/"actual.json").read_text())
            terminal=json.loads(stdout.getvalue().split('YNX_FIXTURE_RESOURCE_TERMINAL ')[1])
            self.assertEqual(code,0,actual["firstCause"])
            self.assertFalse(actual["nodesStarted"])
            self.assertTrue(actual["cleanupComplete"])
            self.assertTrue(terminal["qualified"])
            self.assertFalse(terminal["nodesStarted"])
            self.assertEqual(len(commands),2)
            self.assertIn("postFsyncSample",terminal)


if __name__ == "__main__":
    unittest.main()
