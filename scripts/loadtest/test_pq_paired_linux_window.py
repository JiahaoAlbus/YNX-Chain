import importlib.util
from pathlib import Path
import tempfile
import unittest
import json

spec = importlib.util.spec_from_file_location("pq_linux_guard", Path(__file__).with_name("pq-paired-linux-window.py"))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


def stat_line(pid, parent=1, group=1, start=100, threads=2):
    fields = ["S"] + ["0"] * 45
    fields[1], fields[2], fields[17], fields[19] = str(parent), str(group), str(threads), str(start)
    return (str(pid) + " (name with ) and spaces) " + " ".join(fields)).encode()


class LinuxGuardControls(unittest.TestCase):
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
