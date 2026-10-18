import importlib.util
from pathlib import Path
import tempfile
import unittest
import json
import os

spec = importlib.util.spec_from_file_location("pq_linux_guard", Path(__file__).with_name("pq-paired-linux-window.py"))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


def stat_line(pid, parent=1, group=1, start=100, threads=2):
    fields = ["S"] + ["0"] * 45
    fields[1], fields[2], fields[17], fields[19] = str(parent), str(group), str(threads), str(start)
    return (str(pid) + " (name with ) and spaces) " + " ".join(fields)).encode()


class LinuxGuardControls(unittest.TestCase):
    def e2e_recipe(self, temporary):
        # Parser/control fixtures only. This fake ELF is NEVER executed and is
        # not a compiled test, cryptographic result or real network evidence.
        parent = Path(temporary).resolve()
        source, case, build = parent / "source", parent / "case", parent / "case.build"
        (source / "internal/consensus").mkdir(parents=True)
        for relative in (guard.E2E_SOURCE, guard.E2E_PROGRESS_SOURCE):
            original = Path(__file__).resolve().parents[2] / relative
            (source / relative).write_bytes(original.read_bytes())
        case.mkdir(mode=0o700); build.mkdir(mode=0o700)
        binary = build / "consensus.test"
        binary.write_bytes(b"\x7fELFcontrol-only-not-an-executable-test")
        binary.chmod(0o700)
        plan = dict(profile="consensus-e2e", sourceRoot=str(source), commit="a" * 40,
                    executionAuthorized=False, workingDirectory=str(source / "internal/consensus"),
                    sourcePins={guard.E2E_SOURCE: dict(sha256=guard.E2E_SOURCE_SHA256),
                                guard.E2E_PROGRESS_SOURCE: dict(sha256=guard.E2E_PROGRESS_SOURCE_SHA256)},
                    binaryPin=dict(path=str(binary), sha256=guard.digest(binary)),
                    command=[str(binary), "-test.run=^" + guard.E2E_TEST + "$", "-test.count=1", "-test.timeout=120s", "-test.v"],
                    environment=dict(guard.E2E_ENV))
        prepared = case / "prepared.json"
        prepared.write_text(json.dumps(plan)); prepared.chmod(0o600)
        return plan, prepared, source, case, build, binary

    def e2e_output(self):
        # Synthetic text is used solely to reject malformed acceptance claims.
        # Success here says nothing about a live validator or test execution.
        summary = dict(version="ynx-pq-four-node-e2e/v1", syntheticOnly=True,
                       initialHeight=2, finalHeight=16, blockCount=15, preservedOriginalBlocks=13,
                       scheduleHash="1" * 64, ordinaryTransferHeight=3, pqTransferHeight=14,
                       pqTransactionHash="0x" + "2" * 64, nativeReceiptsVerified=True, traceLineageVerified=True,
                       threeOfFourCommitVerified=True, twoOfFourRejected=True, coldRestartVerified=True,
                       nodeStopAndHostCloseCompleted=True,
                       nodes=[dict(index=i, height=16, appHash="3" * 64, blockHash="4" * 64,
                                   legacyHRS=dict(height=10, round=0, step=3),
                                   pqHRS=dict(height=16, round=0, step=3)) for i in range(4)])
        lines = ["=== RUN   " + guard.E2E_TEST,
                 "    pq_network_e2e_test.go:92: actual Ed25519 network: initial Comet height=2, ordinary transaction height=3, Counter storage=12",
                 "    pq_network_e2e_test.go:176: independent schedule pin=" + "1" * 64 + " registryHeight=8 P=9 U=10 A=12",
                 "    pq_network_e2e_test.go:208: actual 3/4 PQ Commit: height=14 ABCI transaction=0x" + "2" * 64,
                 "    pq_network_e2e_test.go:340: PQ_NETWORK_E2E_SUMMARY " + json.dumps(summary),
                 "--- PASS: " + guard.E2E_TEST + " (20.00s)", "PASS"]
        return lines, summary

    def test_consensus_e2e_accepts_only_sole_precompiled_pinned_recipe(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan, prepared, source, case, build, binary = self.e2e_recipe(tmp)
            actual = guard.validate_consensus_e2e_recipe(plan, prepared)
            self.assertEqual(actual, (source, case, plan["command"], guard.E2E_ENV))
            self.assertEqual(guard.validate_consensus_e2e_binary(plan, build), binary)
            self.assertEqual({p.name for p in build.iterdir()}, {"consensus.test"})
            self.assertEqual({p.name for p in case.iterdir()}, {"prepared.json"})
            # The paired admission path cannot interpret an E2E plan as N1.
            with self.assertRaises(RuntimeError): guard.validate_recipe(plan, prepared)
        self.assertEqual(guard.CAPS, dict(activeMs=105000, cleanupMs=15000, totalMs=120000,
            ownedRSSBytes=1 << 30, threads=320, ownedProcesses=16, privateBytes=32 << 20,
            buildBytes=1 << 30, logBytes=1 << 20, diskFloorBytes=1 << 30, rootReserveBytes=425 << 20,
            compileReserveBytes=1 << 30, availableMemoryFloorBytes=(1 << 30) + (128 << 20), sampleMs=200))

    def test_consensus_e2e_rejects_command_environment_or_pin_expansion(self):
        mutations = [lambda p:p.update(profile="paired"), lambda p:p.update(executionAuthorized=True),
                     lambda p:p.update(commit="a" * 39), lambda p:p.update(n=1), lambda p:p.update(trial=1),
                     lambda p:p.update(workingDirectory=p["sourceRoot"]),
                     lambda p:p["command"].__setitem__(0, "go"),
                     lambda p:p["command"].__setitem__(1, "-test.run=" + guard.E2E_TEST),
                     lambda p:p["command"].__setitem__(2, "-test.count=2"),
                     lambda p:p["command"].__setitem__(3, "-test.timeout=150s"),
                     lambda p:p["command"].append("-test.bench=."),
                     lambda p:p["environment"].update(GOMAXPROCS="4"),
                     lambda p:p["environment"].pop("YNX_PQ_NETWORK_E2E"),
                     lambda p:p["environment"].update(GOFLAGS="-race"),
                     lambda p:p["sourcePins"].clear(),
                     lambda p:p["sourcePins"][guard.E2E_SOURCE].update(sha256="0" * 64),
                     lambda p:p["sourcePins"].pop(guard.E2E_PROGRESS_SOURCE),
                     lambda p:p["sourcePins"].update({"internal/consensus/extra_test.go": dict(sha256="0" * 64)}),
                     lambda p:p["sourcePins"][guard.E2E_PROGRESS_SOURCE].update(sha256="0" * 64),
                     lambda p:p["sourcePins"][guard.E2E_PROGRESS_SOURCE].update(extra="not-frozen"),
                     lambda p:p["binaryPin"].update(sha256="0" * 64),
                     lambda p:p["binaryPin"].update(path="/tmp/unowned-consensus.test")]
        for number, mutate in enumerate(mutations):
            with self.subTest(number=number), tempfile.TemporaryDirectory() as tmp:
                plan, prepared, *_ = self.e2e_recipe(tmp)
                mutate(plan)
                with self.assertRaises(RuntimeError): guard.validate_consensus_e2e_recipe(plan, prepared)

    def test_consensus_e2e_rejects_missing_changed_or_aliased_progress_source(self):
        for kind in ("missing", "changed", "changed-and-repinned", "symlink", "parent-symlink", "directory"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                plan, prepared, source, case, build, _ = self.e2e_recipe(tmp)
                helper = source / guard.E2E_PROGRESS_SOURCE
                if kind == "missing": helper.unlink()
                elif kind in ("changed", "changed-and-repinned"):
                    helper.write_bytes(helper.read_bytes() + b"\n// different source\n")
                    if kind == "changed-and-repinned":
                        plan["sourcePins"][guard.E2E_PROGRESS_SOURCE]["sha256"] = guard.digest(helper)
                elif kind == "symlink":
                    target = Path(tmp) / "other-helper"
                    helper.rename(target); helper.symlink_to(target)
                elif kind == "parent-symlink":
                    target = Path(tmp) / "other-consensus"
                    helper.parent.rename(target); helper.parent.symlink_to(target, target_is_directory=True)
                elif kind == "directory":
                    helper.unlink(); helper.mkdir()
                before = {str(p): p.read_bytes() for root in (case, build) for p in root.rglob("*") if p.is_file()}
                with self.assertRaises(RuntimeError): guard.validate_consensus_e2e_recipe(plan, prepared)
                self.assertEqual(before, {str(p): p.read_bytes() for root in (case, build) for p in root.rglob("*") if p.is_file()})

    def test_consensus_e2e_preserves_old_artifacts_and_refuses_unsafe_binary(self):
        for kind in ("old-log", "old-unknown", "old-case-tmp", "old-build-tmp", "old-build-log",
                     "public-case", "public-build", "public-plan", "not-executable", "writable-binary",
                     "changed-binary", "script", "binary-symlink", "binary-hardlink", "source-symlink"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                plan, prepared, source, case, build, binary = self.e2e_recipe(tmp)
                if kind == "old-log": (case / "go.stdout.log").write_bytes(b"original")
                elif kind == "old-unknown": (case / "UNKNOWN").write_bytes(b"retain")
                elif kind == "old-case-tmp": (case / "tmp").mkdir()
                elif kind == "old-build-tmp": (build / "tmp").mkdir()
                elif kind == "old-build-log": (build / "compile.log").write_bytes(b"original")
                elif kind == "public-case": case.chmod(0o755)
                elif kind == "public-build": build.chmod(0o755)
                elif kind == "public-plan": prepared.chmod(0o644)
                elif kind == "not-executable": binary.chmod(0o600)
                elif kind == "writable-binary": binary.chmod(0o722)
                elif kind == "changed-binary": binary.write_bytes(b"\x7fELFdifferent")
                elif kind == "script":
                    binary.write_bytes(b"#!/bin/sh\nexit 0\n")
                    plan["binaryPin"]["sha256"] = guard.digest(binary)
                elif kind == "binary-symlink":
                    target = Path(tmp) / "other-elf"; binary.rename(target); binary.symlink_to(target)
                elif kind == "binary-hardlink": os.link(binary, Path(tmp) / "other-link")
                elif kind == "source-symlink":
                    target = Path(tmp) / "other-test"; (source / guard.E2E_SOURCE).rename(target)
                    (source / guard.E2E_SOURCE).symlink_to(target)
                before = {str(p): p.read_bytes() for root in (case, build) for p in root.rglob("*") if p.is_file()}
                with self.assertRaises(RuntimeError): guard.validate_consensus_e2e_recipe(plan, prepared)
                self.assertEqual(before, {str(p): p.read_bytes() for root in (case, build) for p in root.rglob("*") if p.is_file()})

    def test_consensus_e2e_needs_terminal_and_all_ordered_real_test_markers(self):
        lines, summary = self.e2e_output()
        stdout = ("\n".join(lines) + "\n").encode()
        evidence = guard.validate_consensus_e2e_result(stdout, b"", 0)
        self.assertEqual(evidence["coldRestart"], summary)
        for code in (None, True, 1, -9):
            with self.subTest(code=code), self.assertRaises(RuntimeError):
                guard.validate_consensus_e2e_result(stdout, b"", code)
        for index in range(len(lines)):
            with self.subTest(missing=index), self.assertRaises(RuntimeError):
                guard.validate_consensus_e2e_result(("\n".join(lines[:index] + lines[index+1:]) + "\n").encode(), b"", 0)
        for invalid in (stdout + b"--- SKIP: unexpected (0.00s)\n", stdout + b"FAIL\n", stdout + b"panic: failed\n",
                        stdout + b"late unqualified output\n",
                        stdout.replace(b"--- PASS:", b"--- SKIP:"), stdout + (lines[4] + "\n").encode(),
                        stdout.replace(b"registryHeight=8 P=9 U=10 A=12", b"registryHeight=8 P=10 U=10 A=12"),
                        stdout.replace(b"height=14 ABCI", b"height=11 ABCI"),
                        ("\n".join(lines[:3] + [lines[4], lines[3]] + lines[5:]) + "\n").encode(),
                        stdout.replace(b"=== RUN   " + guard.E2E_TEST.encode(), b"=== RUN   OtherTest")):
            with self.assertRaises(RuntimeError): guard.validate_consensus_e2e_result(invalid, b"", 0)
        with self.assertRaises(RuntimeError): guard.validate_consensus_e2e_result(stdout, b"fatal error: failed\n", 0)

    def test_consensus_e2e_cold_restart_summary_requires_four_actual_consistent_nodes(self):
        lines, original = self.e2e_output()
        mutations = [lambda s:s.update(coldRestartVerified=False), lambda s:s.update(nodeStopAndHostCloseCompleted=False),
                     lambda s:s.update(syntheticOnly=False), lambda s:s.update(twoOfFourRejected=False),
                     lambda s:s.update(nativeReceiptsVerified=False), lambda s:s.update(traceLineageVerified=False),
                     lambda s:s.update(threeOfFourCommitVerified=False), lambda s:s.update(blockCount=49),
                     lambda s:s.update(finalHeight=15), lambda s:s.update(preservedOriginalBlocks=1),
                     lambda s:s.update(scheduleHash="0" * 64), lambda s:s.update(pqTransactionHash="0x" + "0" * 64),
                     lambda s:s.update(initialHeight=True), lambda s:s.update(extra="not-pinned"),
                     lambda s:s["nodes"].pop(), lambda s:s["nodes"][3].update(index=2),
                     lambda s:s["nodes"][2].update(appHash="5" * 64),
                     lambda s:s["nodes"][1].update(blockHash="6" * 64),
                     lambda s:s["nodes"][0].update(height=15), lambda s:s["nodes"][0].pop("legacyHRS"),
                     lambda s:s["nodes"][0]["pqHRS"].update(round=-1),
                     lambda s:s["nodes"][0]["legacyHRS"].update(step=0)]
        for number, mutate in enumerate(mutations):
            changed = json.loads(json.dumps(original)); mutate(changed)
            output = list(lines); output[4] = "    pq_network_e2e_test.go:340: PQ_NETWORK_E2E_SUMMARY " + json.dumps(changed)
            with self.subTest(number=number), self.assertRaises(RuntimeError):
                guard.validate_consensus_e2e_result(("\n".join(output) + "\n").encode(), b"", 0)
        duplicate = list(lines)
        duplicate[4] = duplicate[4].replace('"coldRestartVerified": true', '"coldRestartVerified": false, "coldRestartVerified": true')
        with self.assertRaises(RuntimeError): guard.validate_consensus_e2e_result(("\n".join(duplicate)+"\n").encode(), b"", 0)

    def test_complete_result_shape_and_retained_bytes_are_required(self):
        # Format-only fake files: never a valid PQ ledger or business acceptance.
        with tempfile.TemporaryDirectory() as tmp:
            case=Path(tmp);plan=dict(commit="a"*40,n=1,trial=1);rows=[]
            for mode in ("members","whole"):
                snapshot=case/("pq-paired-result.json."+mode+".snapshot.json")
                snapshot.write_bytes(b"parser-only artifact")
                rows.append(dict(mode=mode,members=1,localBlockCheckpointMembers=1,coldRestoredMembers=1,
                                 cloneLocalPeersPreserved=True,checkpointPointerTransitions=1,
                                 memberHashes=["0x"+"1"*64],submitNs=100,submitWallNs=110,
                                 sharedSigningPreparationNs=50,manualProduceBlockNs=10,coldRestoreNs=10,
                                 requestCheckpointNs=[100],memberOfferToCheckpointNs=[110],
                                 pendingSnapshotBytes=1,pendingSnapshotSha256="2"*64,
                                 blockSnapshotBytes=snapshot.stat().st_size,blockSnapshotSha256=guard.digest(snapshot)))
            report=dict(schema=1,kind="isolated-single-producer-PQ-paired-component",sourceCommit=plan["commit"],
                        n=1,trial=1,businessProjectionEqual=True,bftFinalCommits=None,consensusFinalityLatency=None,
                        gomaxprocs=1,order=["members","whole"],sharedWholeSha256="3"*64,results=rows)
            guard.validate_result(report,plan,case)
            for mutate in (lambda r:r.pop("bftFinalCommits"),lambda r:r.pop("consensusFinalityLatency"),
                           lambda r:r["results"].pop(),lambda r:r["results"][0].update(coldRestoredMembers=0),
                           lambda r:r["results"][0].pop("cloneLocalPeersPreserved"),
                           lambda r:r["results"][0].update(memberHashes=[]),
                           lambda r:r["results"][0].update(requestCheckpointNs=[]),
                           lambda r:r["results"][0].update(sharedSigningPreparationNs=51),
                           lambda r:r["results"][0].update(blockSnapshotSha256="0"*64)):
                changed=json.loads(json.dumps(report));mutate(changed)
                with self.assertRaises(RuntimeError):guard.validate_result(changed,plan,case)
            (case/"pq-paired-result.json.members.snapshot.json").write_bytes(b"tampered")
            with self.assertRaises(RuntimeError):guard.validate_result(report,plan,case)

    def test_production_measurement_requires_bound_result_and_every_durable_boundary(self):
        # Synthetic shape controls, not actual dual signatures or local CP proof.
        phase=lambda a=1:dict(attempts=a,completed=a,errors=0,durationNs="10" if a else "0")
        file=lambda:dict(**{k:phase() for k in ("total","openTemp","encodeWrite","fileSync","close","rename","directorySync")},writeCalls=1,bytesWritten=100)
        hashes=["0x"+"1"*64]
        measurement=dict(version="ynx-pq-batch-measurement-v1",wireHash="0x"+"3"*64,executionHeight="2",
            result=dict(executionHeight="2",batchHash="0x"+"3"*64,status="durable",replayed=False,results=[dict(index=0,outcome="admitted",transactionHash=hashes[0])]),
            **{k:phase() for k in ("total","inputCloneHash","lockWait","policyValidation","wireDecode","wholeAuthentication","memberExecution")},
            replay=phase(0),verifierSignatureChecks=2,memberAdmitted=1,memberRejected=0,
            persistence=dict(**{k:phase() for k in ("total","snapshotBuild","integritySeal","checkpointBuild","persistenceLockWait","mkdir")},
                snapshotFile=file(),markerFile=file(),candidateIntegrity="local-integrity",published=dict(version="ynx-local-durability-v1",height="1",hash="local-block",snapshotIntegrity="local-integrity")))
        row=dict(memberHashes=hashes,wholeMeasurement=measurement)
        plan=dict(n=1,productionMeasurementVersion="ynx-pq-batch-measurement-v1")
        report=dict(sharedWholeSha256="3"*64,productionMeasurementVersion=plan["productionMeasurementVersion"])
        guard.validate_production_measurement(row,report,plan)
        for mutate in (lambda m:m.pop("persistence"),lambda m:m.update(wireHash="0x"+"0"*64),
                       lambda m:m["total"].update(durationNs=10),lambda m:m["total"].update(durationNs="-1"),
                       lambda m:m["persistence"].update(published=None),
                       lambda m:m["persistence"]["markerFile"]["directorySync"].update(completed=0,errors=1),
                       lambda m:m["result"].update(replayed=True),lambda m:m.update(verifierSignatureChecks=0)):
            changed=json.loads(json.dumps(measurement));mutate(changed)
            with self.assertRaises(RuntimeError):guard.validate_production_measurement(dict(row,wholeMeasurement=changed),report,plan)

    def test_minimal_claim_without_actual_member_results_does_not_qualify(self):
        plan=dict(commit="a"*40,n=1,trial=1)
        incomplete=dict(sourceCommit=plan["commit"],n=1,trial=1,businessProjectionEqual=True)
        with self.assertRaises(RuntimeError):guard.validate_result(incomplete,plan,Path("/unused"))

    def test_exact_prepared_case_and_overlay_are_required(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent=Path(tmp).resolve();source=parent/"source";source.mkdir();case=parent/"case";case.mkdir()
            overlay=case/"pq_paired_performance_test.go.in";overlay.write_text("package chain\n")
            mapping={"Replace":{str(source/"internal/chain/pq_paired_performance_test.go"):str(overlay)}}
            (case/"overlay.json").write_text(json.dumps(mapping))
            commit="a"*40
            plan=dict(sourceRoot=str(source),commit=commit,n=1,trial=1,executionAuthorized=False,
                      command=["go","test","-overlay",str(case/"overlay.json"),"-p","1","./internal/chain","-run","^TestPQPairedPersistentPerformance$","-count=1","-timeout=90s"],
                      overlayPin=dict(path=str(overlay),sha256=guard.digest(overlay)),
                      environment=dict(GOMAXPROCS="1",GOGC="50",GOMEMLIMIT="512MiB",YNX_PQ_PAIR_SOURCE_COMMIT=commit,YNX_PQ_PAIR_N="1",YNX_PQ_PAIR_TRIAL="1",YNX_PQ_PAIR_OUTPUT=str(case/"pq-paired-result.json")))
            guard.validate_recipe(plan,case/"prepared.json")
            measured16=json.loads(json.dumps(plan));measured16.update(n=16,productionMeasurementVersion="ynx-pq-batch-measurement-v1");measured16["environment"]["YNX_PQ_PAIR_N"]="16"
            with self.assertRaises(RuntimeError):guard.validate_recipe(measured16,case/"prepared.json")
            guard.validate_recipe(measured16,case/"prepared.json",case_n=16)
            self.assertEqual(guard.CAPS["privateBytes"],32<<20)
            self.assertEqual(guard.CAPS["ownedRSSBytes"],1<<30)
            for mutate in (lambda p:p.update(n=16),lambda p:p.update(trial=2),lambda p:p["command"].append("./..."),lambda p:p["environment"].update(GOMAXPROCS="2"),lambda p:p["overlayPin"].update(sha256="0"*64)):
                changed=json.loads(json.dumps(plan));mutate(changed)
                with self.assertRaises(RuntimeError):guard.validate_recipe(changed,case/"prepared.json")
            mapping["Replace"][str(source/"internal/chain/owned.go")]=str(overlay)
            (case/"overlay.json").write_text(json.dumps(mapping))
            with self.assertRaises(RuntimeError):guard.validate_recipe(plan,case/"prepared.json")

    def test_kernel_stat_offsets_and_comm_parenthesis(self):
        row = guard.parse_stat(stat_line(20, 10, 20, 123, 7), 20)
        self.assertEqual((row["parent"], row["group"], row["startTicks"], row["threads"]), (10, 20, 123, 7))
        for raw in (b"20 (bad) S 1", stat_line(21), stat_line(20, parent=-1)):
            with self.assertRaises((RuntimeError, ValueError)):
                guard.parse_stat(raw, 20)

    def test_recursive_group_changed_and_adopted_children_exclude_shared_parent(self):
        rows = {p: guard.parse_stat(stat_line(p, parent, group), p) for p, parent, group in
                [(1, 0, 1), (10, 1, 10), (20, 10, 20), (21, 20, 21), (22, 10, 22), (99, 1, 99)]}
        self.assertEqual(guard.owned_set(rows, 10, 20, require_job=True,job_start=100), [10, 20, 21, 22])
        with self.assertRaises(RuntimeError):guard.owned_set(rows,10,20,require_job=True,job_start=99)
        rows[21]["parent"] = 1
        self.assertIn(21, guard.owned_set(rows, 10, 20, known={21: 100}))
        self.assertNotIn(21, guard.owned_set(rows, 10, 20, known={21: 99}))

    def test_missing_active_roots_and_large_tree_are_not_truncated(self):
        with self.assertRaises(RuntimeError):
            guard.owned_set({}, 10, 20)
        rows = {10: guard.parse_stat(stat_line(10), 10)}
        with self.assertRaises(RuntimeError):
            guard.owned_set(rows, 10, 20, require_job=True)
        for pid in range(20, 40):
            rows[pid] = guard.parse_stat(stat_line(pid, 10, 20), pid)
        with self.assertRaises(RuntimeError):
            guard.owned_set(rows, 10, 20)

    def test_reused_job_pid_and_pgid_cannot_claim_unrelated_processes(self):
        rows={p:guard.parse_stat(stat_line(p,parent,group,start),p) for p,parent,group,start in
              [(10,1,10,100),(20,1,20,200),(21,1,20,201)]}
        owned=guard.owned_set(rows,10,20,known={20:100,21:101})
        self.assertEqual(owned,[10])

    def test_genuine_adopted_orphan_remains_owned_after_job_exit(self):
        rows={p:guard.parse_stat(stat_line(p,parent,group,start),p) for p,parent,group,start in
              [(10,1,10,100),(21,10,99,101),(22,21,22,102),(30,1,30,103)]}
        self.assertEqual(guard.owned_set(rows,10,20),[10,21,22])

    def test_rollup_requires_one_actual_rss_in_kib(self):
        self.assertEqual(guard.smaps_rss(b"Rss: 123 kB\nPss: 90 kB\n"), 123 * 1024)
        for raw in (b"", b"VmRSS: 123 kB", b"Rss: -1 kB", b"Rss: 1 kB\nRss: 2 kB\n"):
            with self.assertRaises(RuntimeError):
                guard.smaps_rss(raw)

    def test_real_byte_limits_and_reserves_fail_closed(self):
        valid = dict(rssBytes=1000000, threads=10, privateBytes=100, buildBytes=100,
                     freeDiskBytes=10 << 30, availableMemoryBytes=4 << 30)
        guard.enforce(valid, True)
        for key, value in [("rssBytes", (1 << 30) + 1), ("threads", 321), ("privateBytes", (32 << 20) + 1),
                           ("buildBytes", (1 << 30) + 1), ("freeDiskBytes", 0), ("availableMemoryBytes", 0),
                           ("rssBytes", float("nan")), ("freeDiskBytes", "unknown")]:
            with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                guard.enforce(dict(valid, **{key: value}), True)

    def test_fake_proc_fixture_reads_identity_without_command_fork(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "20").mkdir(); (root / "20/stat").write_bytes(stat_line(20, 10, 20))
            (root / "21").mkdir()  # This identity really vanished during capture.
            (root / "meminfo").write_bytes(b"MemAvailable: 2000000 kB\n")
            rows, vanished = guard.proc_inventory(root)
            self.assertEqual(list(rows), [20]); self.assertEqual(vanished, [21])
            self.assertEqual(guard.memory_available(root), 2000000 * 1024)
            (root / "meminfo").write_bytes(b"MemFree: 9999999 kB\n")
            with self.assertRaises(RuntimeError):
                guard.memory_available(root)

    def test_private_tree_rejects_symlinks_and_counts_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / "item").write_bytes(b"abc")
            self.assertEqual(guard.directory_bytes(root), 3)
            (root / "alias").symlink_to(root / "item")
            with self.assertRaises(RuntimeError):
                guard.directory_bytes(root)


if __name__ == "__main__":
    unittest.main()
