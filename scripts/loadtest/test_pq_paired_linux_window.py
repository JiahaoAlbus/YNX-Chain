import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from contextlib import redirect_stdout, redirect_stderr
import io
import json
import os
import hashlib

spec = importlib.util.spec_from_file_location("pq_linux_guard", Path(__file__).with_name("pq-paired-linux-window.py"))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


def stat_line(pid, parent=1, group=1, start=100, threads=2):
    fields = ["S"] + ["0"] * 45
    fields[1], fields[2], fields[17], fields[19] = str(parent), str(group), str(threads), str(start)
    return (str(pid) + " (name with ) and spaces) " + " ".join(fields)).encode()


class LinuxGuardControls(unittest.TestCase):
    def business_recipe(self, temporary, fresh=False):
        # Parsing controls only. These ELF-shaped bytes are NEVER executed and
        # are not a compiler result, a signature, or a four-node qualification.
        parent = Path(temporary).resolve()
        source, case, build = parent / "source", parent / "case", parent / "case.build"
        (source / "internal/consensus").mkdir(parents=True)
        for relative in guard.consensus_business_source_pins(fresh):
            (source / relative).write_bytes((Path(__file__).resolve().parents[2] / relative).read_bytes())
        case.mkdir(mode=0o700); build.mkdir(mode=0o700)
        client = guard.FRESH_BUSINESS_CLIENT_COMMIT if fresh else guard.BUSINESS_CLIENT_COMMIT
        profile = guard.FRESH_BUSINESS_E2E_PROFILE if fresh else guard.BUSINESS_E2E_PROFILE
        manifest = dict(version="YNX-PQ-NETWORK-FRESH-BUSINESS-BUILD/v1" if fresh else "YNX-PQ-NETWORK-BUSINESS-BUILD/v1", protocolCommit="a" * 40,
                        performanceClientCommit=client, sourceRoot=str(source),
                        sourceLeaves={key: value["sha256"] for key, value in guard.consensus_business_source_pins(fresh).items()}, binaries={})
        if fresh:
            manifest["performanceClientTree"] = guard.FRESH_BUSINESS_CLIENT_TREE
        for name in guard.BUSINESS_BINARIES:
            binary = build / name
            binary.write_bytes(b"\x7fELF\x02\x01" + bytes(10) + b"\x02\x00\x3e\x00" + name.encode())
            binary.chmod(0o700)
            manifest["binaries"][name] = dict(path=str(binary), sha256=guard.digest(binary), bytes=binary.stat().st_size,
                commit=client if name == "ynx-consensus-perf-client" else "a" * 40)
        path = build / "business-manifest.json"
        path.write_text(json.dumps(manifest)); path.chmod(0o600)
        plan = dict(profile=profile, caps=guard.fixed_caps(profile),
            sourceRoot=str(source), commit="a" * 40, executionAuthorized=False,
            workingDirectory=str(source / "internal/consensus"), sourcePins=guard.consensus_business_source_pins(fresh),
            binaryPin={key: manifest["binaries"]["consensus.test"][key] for key in ("path", "sha256")},
            businessManifestPin=dict(path=str(path), sha256=guard.digest(path)),
            command=[str(build / "consensus.test"), "-test.run=^" + (guard.FRESH_BUSINESS_E2E_TEST if fresh else guard.BUSINESS_E2E_TEST) + "$", "-test.count=1", "-test.timeout=120s", "-test.v"])
        plan["environment"] = guard.consensus_business_environment(plan, build, fresh)
        prepared = case / "prepared.json"
        prepared.write_text(json.dumps(plan)); prepared.chmod(0o600)
        return plan, prepared, source, case, build, manifest

    def fresh_output(self, manifest, pid=1234):
        # Synthetic parser DATA only. No process, keys, node or client is run.
        summary = dict(version="YNX-PQ-NETWORK-FRESH-PAIRED-BUSINESS/v1", syntheticOnly=True,
            protocolCommit=manifest["protocolCommit"], clientCommit=guard.FRESH_BUSINESS_CLIENT_COMMIT,
            clientTree=guard.FRESH_BUSINESS_CLIENT_TREE, binaries=manifest["binaries"], sourceLeaves=manifest["sourceLeaves"],
            arms=[], phaseRows=[], clockDomain="pq-fresh:" + str(pid), sameVM=True, sameProcessPID=pid,
            businessFinalized=32, birthsExcluded=34, sustainedTPSQualified=False, publicDeployment=False, nativeGrant=False)
        for a, (name, mode) in enumerate((("before", "decode-index-again"), ("after", "reuse-validated-index"))):
            start = 1000000000 + a * 20000000000
            births = [dict(owner="0x" + format(100 + a * 100 + i, "040x"), fundingHash="0x" + format(1000 + a * 100 + i, "064x"),
                abciTransactionHash="0x" + format(2000 + a * 100 + i, "064x"), nativeTransactionHash="0x" + format(3000 + a * 100 + i, "064x"),
                height=11, index=i, activationHeight=12, registrationFinalized=True, finalizedBusinessMembers=0) for i in range(17)]
            rows = []
            for i in range(16):
                native, abci = "0x" + format(4000 + a * 100 + i, "064x"), "0x" + format(5000 + a * 100 + i, "064x")
                submission = dict(readbackIndexMode=mode, readbackOnly=False, submissionToFirstCommittedRPCObservationNs="1000",
                    firstCommittedRPCObservationSource="post_response", firstCommittedRPCHeight="20", firstCommittedRPCIndex=i,
                    abciTransactionHash=abci, nativeTransactionHash=native, transactionType="pq_transfer", executionHeight="20", cometIndex=i,
                    submissionAttempts=1, originalReadbackAttempts=0, initialSubmissionUnknown=False, members=1,
                    effectiveBusinessIncludedObserved=1, rejectedMembers=0, effectiveBusinessFinalized=0, independentFinalityVerified=False,
                    registrationFinalized=False, consensusExecutionOutcome="", finalizedBusinessHashes=None, actualOfferToFinalityMeasured=False,
                    sustainedTPSQualified=False, status="committed_observed", proofVerificationStatus="", proofVerifierSha256="", trustContextSha256="",
                    verifierPreparationNs="0", verifierProcessNs="0", verifierEvidenceDurabilityNs="0", verifierResultValidationNs="0", proofVerificationNs="0",
                    clientPhases={key: "100" for key in ("inputPreparationNs", "intentDurabilityNs", "submissionHTTPNs", "submissionValidationNs", "originalReadbackHTTPNs", "originalReadbackValidationNs", "proofCollectionHTTPNs", "collectorIdentityValidationNs", "proofDurabilityNs")})
                readback = dict(submission, readbackOnly=True, submissionToFirstCommittedRPCObservationNs=None,
                    firstCommittedRPCObservationSource="", firstCommittedRPCHeight="0", firstCommittedRPCIndex=None,
                    submissionAttempts=0, originalReadbackAttempts=1, independentFinalityVerified=True, effectiveBusinessFinalized=1,
                    consensusExecutionOutcome="succeeded", finalizedBusinessHashes=[native], proofVerificationStatus="verified_original_transaction",
                    proofVerifierSha256=manifest["binaries"]["ynx-consensus-proof-verify"]["sha256"], trustContextSha256="c" * 64)
                offered, completed = start + i * 500000000, start + 9000000000 + i * 1000000
                rows.append(dict(sender=births[i + 1]["owner"], nativeHash=native, abciHash=abci, height=20, index=i,
                    offerOffsetNs=offered, offerLatenessNs=0, observedCompletionNs=offered + 1000000,
                    independentCompletionNs=completed, offerToIndependentNs=completed - offered,
                    independentTimingMeaning="upper-bound observation including queued proof verification; not consensus formation time",
                    submission=submission, readback=readback))
            summary["arms"].append(dict(name=name, readbackIndexMode=mode, genesisSHA256=str(a + 1) * 64,
                activationHeight=10, initialHeight=1, finalHeight=25, births=births, rows=rows,
                offeredBusiness=16, finalizedBusiness=16, maximumInFlight=4, offeredRatePerSecond=2,
                businessWindowNs=10000000000, businessStartNs=start,
                clockOrigin="paired selector origin shared by both arms and all Host/ABCI offsets; child client durations use their own clock",
                clock=guard.FRESH_BUSINESS_CLOCK, sustainedTPSQualified=False))
            for h in range(10, 26):
                for node in range(4):
                    at = start + h * 1000000
                    summary["phaseRows"].append(dict(arm=name, nodeIndex=node, height=str(h), clockDomain=summary["clockDomain"], startNs=at, endNs=at + 10, phase="finalize"))
                    summary["phaseRows"].append(dict(arm=name, nodeIndex=node, height=str(h), clockDomain=summary["clockDomain"], startNs=at + 11, endNs=at + 20, phase="commit",
                        commitTiming=dict(height=h, storage="atomic-json", durable=True, elapsedNs=8, payloadBytes=100, stagesNs={"sync": 2})))
        return summary

    def fresh_stdout(self, summary):
        return ("=== RUN   " + guard.FRESH_BUSINESS_E2E_TEST + "\n    pq_network_fresh_business_test.go:1089: PQ_NETWORK_FRESH_BUSINESS_SUMMARY "
                + json.dumps(summary, separators=(",", ":")) + "\n--- PASS: " + guard.FRESH_BUSINESS_E2E_TEST + " (30.00s)\nPASS\n").encode()

    def test_fresh_business_closed_source3_client70e7_whole_tree_and_original_caps(self):
        self.assertEqual(guard.FRESH_BUSINESS_CLIENT_COMMIT, "70e7e450997a0ae77dbad5a8be3682f482c6ddd8")
        self.assertEqual(guard.FRESH_BUSINESS_CLIENT_TREE, "4866cc3924c060eb6a29939915d39b1c5c625607")
        self.assertEqual(guard.FRESH_BUSINESS_E2E_SOURCE_SHA256, "8f2d4f58808dee77ab00dc69a9a285f770b7aeafa49b4e8865455f581ad1d438")
        caps = guard.fixed_caps(guard.FRESH_BUSINESS_E2E_PROFILE)
        self.assertEqual(caps, dict(guard.CAPS, privateBytes=536870912))
        self.assertEqual([caps[k] for k in ("activeMs", "cleanupMs", "totalMs", "ownedRSSBytes", "ownedProcesses", "threads", "buildBytes")], [105000, 15000, 120000, 1073741824, 16, 320, 1073741824])
        with tempfile.TemporaryDirectory() as tmp:
            plan, prepared, source, case, build, _ = self.business_recipe(tmp, True)
            self.assertEqual(guard.validate_consensus_fresh_business_recipe(plan, prepared, inherited={}), (source, case, plan["command"], plan["environment"]))
            captured = guard.validate_consensus_business_files(plan, source, build, fresh=True)
            self.assertEqual(len(captured), 8)
            self.assertEqual(guard.consensus_runtime_environment(plan["environment"], case, build, plan["profile"], {"UNTRUSTED": "ignored"}), dict(plan["environment"], PATH="/usr/bin:/bin", TMPDIR=str(case / "tmp")))
            for key in ("YNX_PQ_NETWORK_E2E", "YNX_PQ_NETWORK_BUSINESS_E2E", "YNX_PQ_NETWORK_REMOTE_E2E", "YNX_PQ_REMOTE_PROCESS", "YNX_PQ_REMOTE_PROCESS_LAYOUT"):
                with self.subTest(key=key), self.assertRaises(RuntimeError):
                    guard.validate_consensus_fresh_business_recipe(plan, prepared, inherited={key: ""})
            original = (source / guard.FRESH_BUSINESS_E2E_SOURCE).read_bytes()
            target = source / guard.FRESH_BUSINESS_E2E_SOURCE
            replacement = target.with_name(target.name + ".replacement")
            replacement.write_bytes(original); replacement.replace(target)
            with self.assertRaises(RuntimeError): guard.validate_consensus_business_files(plan, source, build, captured, True)

    def test_fresh_business_rejects_old_case_manifest_client_tree_source_or_expanded_limits(self):
        for mutate in (lambda p:p.update(profile=guard.BUSINESS_E2E_PROFILE), lambda p:p.update(executionAuthorized=True),
                       lambda p:p["caps"].update(activeMs=106000), lambda p:p["caps"].update(privateBytes=536870913),
                       lambda p:p["sourcePins"].pop(guard.FRESH_BUSINESS_E2E_SOURCE),
                       lambda p:p["command"].__setitem__(1, "-test.run=^" + guard.BUSINESS_E2E_TEST + "$"),
                       lambda p:p["environment"].update(YNX_PQ_NETWORK_BUSINESS_E2E="authorized-four-node-business-window")):
            with tempfile.TemporaryDirectory() as tmp:
                plan, prepared, *_ = self.business_recipe(tmp, True); mutate(plan)
                with self.assertRaises(RuntimeError): guard.validate_consensus_fresh_business_recipe(plan, prepared, inherited={})
        for mode in ("old-version", "old-client", "package-tree", "missing-source", "extra-field", "duplicate", "old-UNKNOWN"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                plan, prepared, source, case, build, manifest = self.business_recipe(tmp, True)
                if mode == "old-version": manifest["version"] = "YNX-PQ-NETWORK-BUSINESS-BUILD/v1"
                elif mode == "old-client": manifest["performanceClientCommit"] = guard.BUSINESS_CLIENT_COMMIT
                elif mode == "package-tree": manifest["performanceClientTree"] = "1" * 40
                elif mode == "missing-source": manifest["sourceLeaves"].pop(guard.FRESH_BUSINESS_E2E_SOURCE)
                elif mode == "extra-field": manifest["fallback"] = True
                elif mode == "old-UNKNOWN": (case / "UNKNOWN").write_bytes(b"retain exact old attempt")
                path = build / "business-manifest.json"; raw = json.dumps(manifest).encode()
                if mode == "duplicate": raw = raw.replace(b'"version":', b'"version":"ignored","version":', 1)
                path.write_bytes(raw); plan["businessManifestPin"]["sha256"] = guard.digest(path)
                plan["environment"] = guard.consensus_business_environment(plan, build, True)
                before = {str(p): p.read_bytes() for folder in (case, build) for p in folder.rglob("*") if p.is_file()}
                with self.assertRaises(RuntimeError): guard.validate_consensus_fresh_business_recipe(plan, prepared, inherited={})
                self.assertEqual(before, {str(p): p.read_bytes() for folder in (case, build) for p in folder.rglob("*") if p.is_file()})

    def test_fresh_business_real_summary_binding_numeric_phases_and_unknown_are_not_invented(self):
        with tempfile.TemporaryDirectory() as tmp:
            *_, manifest = self.business_recipe(tmp, True)
            summary = self.fresh_output(manifest)
            evidence = guard.validate_consensus_fresh_business_result(self.fresh_stdout(summary), b"", 0, manifest, 1234)
            self.assertEqual(evidence["freshBusiness"], summary)
            self.assertEqual(evidence["resultSHA256"], hashlib.sha256(json.dumps(summary, separators=(",", ":")).encode()).hexdigest())
            row = summary["arms"][0]["rows"][0]["submission"]
            row.update(status="submission_unknown", initialSubmissionUnknown=True, effectiveBusinessIncludedObserved=0,
                submissionToFirstCommittedRPCObservationNs=None, firstCommittedRPCObservationSource="", firstCommittedRPCHeight="0", firstCommittedRPCIndex=None)
            evidence = guard.validate_consensus_fresh_business_result(self.fresh_stdout(summary), b"", 0, manifest, 1234)
            self.assertEqual((evidence["firstRPCMissing"], evidence["initialUNKNOWN"]), (1, 1))
            self.assertIsNone(evidence["freshBusiness"]["arms"][0]["rows"][0]["submission"]["submissionToFirstCommittedRPCObservationNs"])

    def test_fresh_business_refuses_missing_proof_first_rpc_false_credit_or_numeric_phase_corruption(self):
        mutations = [lambda s:s.update(businessFinalized=34), lambda s:s.update(birthsExcluded=32), lambda s:s.update(sameProcessPID=1235),
            lambda s:s.update(clockDomain="pq-fresh:other"), lambda s:s.update(nativeGrant=True), lambda s:s["sourceLeaves"].clear(),
            lambda s:s["arms"][0]["births"][0].update(finalizedBusinessMembers=1),
            lambda s:s["arms"][1]["births"][0].update(owner=s["arms"][0]["births"][0]["owner"]),
            lambda s:s["arms"][0]["rows"].pop(), lambda s:s["arms"][0]["rows"][0]["readback"].update(independentFinalityVerified=False),
            lambda s:s["arms"][0]["rows"][0]["readback"].update(proofVerifierSha256="0" * 64),
            lambda s:s["arms"][0]["rows"][0]["submission"].update(submissionToFirstCommittedRPCObservationNs=None),
            lambda s:s["arms"][0]["rows"][0].update(offerToIndependentNs=1),
            lambda s:s["phaseRows"][0].update(startNs="100"), lambda s:s["phaseRows"][1]["commitTiming"].update(elapsedNs="8"),
            lambda s:s["phaseRows"][1]["commitTiming"].update(durable=False), lambda s:s["phaseRows"].pop(),
            lambda s:s["phaseRows"].append(dict(s["phaseRows"][0])), lambda s:s["phaseRows"][0].update(height="020")]
        with tempfile.TemporaryDirectory() as tmp:
            *_, manifest = self.business_recipe(tmp, True)
            for index, mutate in enumerate(mutations):
                summary = self.fresh_output(manifest); mutate(summary)
                with self.subTest(index=index), self.assertRaises(RuntimeError):
                    guard.validate_consensus_fresh_business_result(self.fresh_stdout(summary), b"", 0, manifest, 1234)
            raw = self.fresh_stdout(self.fresh_output(manifest))
            for stdout, stderr, code in ((raw, b"", 1), (raw, b"warning", 0), (raw.replace(b"--- PASS:", b"--- SKIP:"), b"", 0),
                                        (raw + b"PASS\n", b"", 0), (raw.replace(b'"phaseRows":', b'"phaseRows":[],"phaseRows":', 1), b"", 0),
                                        (raw.replace(b'"syntheticOnly":true', b'"syntheticOnly":true' + b" " * (256 << 10), 1), b"", 0)):
                with self.assertRaises(RuntimeError): guard.validate_consensus_fresh_business_result(stdout, stderr, code, manifest, 1234)

    def test_fresh_business_explicit_cli_default_no_execution_and_all_modes_exclusive(self):
        flag = "--consensus-fresh-paired-business"
        for other in ("--consensus-e2e", "--consensus-e2e-retained-history", "--consensus-remote-e2e-retained-history", "--consensus-signed-business"):
            with self.subTest(other=other), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit): guard.argument_parser().parse_args([other, flag])
        with self.assertRaises(RuntimeError): guard.selected_profile(False, False, False, True, True)
        with self.assertRaises(RuntimeError): guard.selected_profile(False, False, False, False, "true")
        with mock.patch.object(guard, "run", return_value=7) as run:
            output = io.StringIO()
            with redirect_stdout(output): self.assertEqual(guard.main([flag]), 0)
            run.assert_not_called()
            self.assertEqual(json.loads(output.getvalue())["caps"], guard.fixed_caps(guard.FRESH_BUSINESS_E2E_PROFILE))
            self.assertEqual(guard.main([flag, "--execute", "--prepared", "/unused/prepared.json", "--receipt", "/unused/receipt.json"]), 7)
            self.assertEqual(run.call_args.kwargs, dict(case_n=1, consensus_e2e=False, consensus_e2e_retained_history=False, consensus_fresh_paired_business=True))

    def business_output(self):
        # Log parser controls only, never represented as an actual test PASS.
        lines, network = self.e2e_output()
        network.update(finalHeight=20, blockCount=19)
        for node in network["nodes"]:
            node["height"], node["pqHRS"]["height"] = 20, 20
        lines[0] = "=== RUN   " + guard.BUSINESS_E2E_TEST
        lines[4] = "    pq_network_e2e_test.go:340: PQ_NETWORK_E2E_SUMMARY " + json.dumps(network)
        lines[-2] = "--- PASS: " + guard.BUSINESS_E2E_TEST + " (20.00s)"
        rows = [dict(kind=kind, outcome=outcome, transactionHash=str(i + 5) * 64, height=15 + i,
                     finalizedBusinesses=admitted, rejectedMembers=rejected, registrationFinalized=registered,
                     initialSubmissionUnknown=i == 1, independentFinalityVerified=True, offerToIndependentFinalityNs=1000000)
                for i, (kind, outcome, admitted, rejected, registered) in enumerate((
                    ("account_initial", "succeeded", 0, 0, True), ("pq_transfer", "succeeded", 1, 0, False), ("pq_whole", "partial", 1, 1, False)))]
        summary = dict(version="YNX-PQ-NETWORK-SIGNED-BUSINESS/v1", syntheticOnly=True,
                       clientCommit=guard.BUSINESS_CLIENT_COMMIT, protocolCommit="a" * 40, rows=rows,
                       sustainedTPSQualified=False, publicDeployment=False, nativeGrant=False)
        lines.insert(-2, "    pq_network_business_test.go:249: PQ_NETWORK_BUSINESS_SUMMARY " + json.dumps(summary))
        return lines, summary

    def test_signed_business_closed_recipe_four_original_elfs_and_unchanged_limits(self):
        profile = guard.BUSINESS_E2E_PROFILE
        self.assertEqual(guard.fixed_caps(profile), guard.fixed_caps(guard.E2E_RETAINED_HISTORY_PROFILE))
        with tempfile.TemporaryDirectory() as tmp:
            plan, prepared, source, case, build, _ = self.business_recipe(tmp)
            self.assertEqual(guard.validate_consensus_business_recipe(plan, prepared, inherited={}),
                             (source, case, plan["command"], plan["environment"]))
            captured = guard.validate_consensus_business_files(plan, source, build)
            self.assertEqual(len(captured), 7)
            self.assertEqual(guard.consensus_runtime_environment(plan["environment"], case, build, profile,
                {"ARBITRARY_UNTRUSTED": "ignored"}), dict(plan["environment"], PATH="/usr/bin:/bin", TMPDIR=str(case / "tmp")))
            for key in ("YNX_PQ_NETWORK_E2E", "YNX_PQ_NETWORK_REMOTE_E2E", "YNX_PQ_REMOTE_PROCESS", "YNX_PQ_REMOTE_PROCESS_LAYOUT"):
                with self.subTest(key=key), self.assertRaises(RuntimeError):
                    guard.validate_consensus_business_recipe(plan, prepared, inherited={key: ""})
            for pin in (source / guard.BUSINESS_E2E_SOURCE, build / "business-manifest.json", build / "ynx-bft-gatewayd"):
                original = pin.read_bytes(); mode = pin.stat().st_mode & 0o777
                replacement = pin.with_name(pin.name + ".replacement")
                replacement.write_bytes(original); replacement.chmod(mode); replacement.replace(pin)
                with self.subTest(pin=pin), self.assertRaises(RuntimeError):
                    guard.validate_consensus_business_files(plan, source, build, captured)
                captured = guard.validate_consensus_business_files(plan, source, build)

    def test_signed_business_refuses_expanded_recipe_manifest_or_old_unknown(self):
        mutations = (lambda p: p.update(executionAuthorized=True), lambda p: p.update(profile="consensus-e2e"),
                     lambda p: p.update(remoteSignerPin=p["binaryPin"]), lambda p: p["caps"].update(threads=321),
                     lambda p: p["command"].__setitem__(1, "-test.run=" + guard.BUSINESS_E2E_TEST),
                     lambda p: p["environment"].update(YNX_PQ_NETWORK_E2E="authorized-four-node-window"),
                     lambda p: p["businessManifestPin"].update(sha256="0" * 64))
        with tempfile.TemporaryDirectory() as tmp:
            plan, prepared, *_ = self.business_recipe(tmp)
            for change in mutations:
                changed = json.loads(json.dumps(plan)); change(changed)
                with self.subTest(change=change), self.assertRaises(RuntimeError):
                    guard.validate_consensus_business_recipe(changed, prepared, inherited={})
        for mode in ("wrong-client", "wrong-source", "extra-binary", "wrong-size", "duplicate", "symlink", "UNKNOWN"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                plan, prepared, source, case, build, manifest = self.business_recipe(tmp)
                path = build / "business-manifest.json"
                if mode == "wrong-client": manifest["binaries"]["ynx-consensus-perf-client"]["commit"] = "a" * 40
                elif mode == "wrong-source": manifest["sourceLeaves"][guard.BUSINESS_E2E_SOURCE] = "1" * 64
                elif mode == "extra-binary": manifest["binaries"]["foreign"] = manifest["binaries"]["ynx-bft-gatewayd"]
                elif mode == "wrong-size": manifest["binaries"]["ynx-bft-gatewayd"]["bytes"] += 1
                elif mode == "symlink":
                    binary = build / "ynx-bft-gatewayd"; target = source / "original-elf"
                    binary.rename(target); binary.symlink_to(target)
                elif mode == "UNKNOWN": (case / "UNKNOWN").write_bytes(b"original uncertain case")
                raw = json.dumps(manifest).encode()
                if mode == "duplicate": raw = raw.replace(b'"version":', b'"version":"YNX-PQ-NETWORK-BUSINESS-BUILD/v1","version":', 1)
                path.write_bytes(raw)
                plan["businessManifestPin"]["sha256"] = guard.digest(path)
                plan["environment"] = guard.consensus_business_environment(plan, build)
                retained = {str(p): p.read_bytes() for root in (case, build) for p in root.rglob("*") if p.is_file()}
                with self.assertRaises(RuntimeError): guard.validate_consensus_business_recipe(plan, prepared, inherited={})
                self.assertEqual(retained, {str(p): p.read_bytes() for root in (case, build) for p in root.rglob("*") if p.is_file()})

    def test_signed_business_requires_actual_rows_and_independent_finality_without_tps_claim(self):
        lines, summary = self.business_output()
        raw = ("\n".join(lines) + "\n").encode()
        result = guard.validate_consensus_business_result(raw, b"", 0, "a" * 40)
        self.assertEqual(result["signedBusiness"], summary)
        changes = (lambda s: s.update(rows=[]), lambda s: s.update(publicDeployment=True),
                   lambda s: s.update(sustainedTPSQualified=True), lambda s: s.update(protocolCommit="b" * 40),
                   lambda s: s["rows"][0].update(finalizedBusinesses=1),
                   lambda s: s["rows"][1].update(independentFinalityVerified=False),
                   lambda s: s["rows"][1].update(height=s["rows"][0]["height"]),
                   lambda s: s["rows"][2].update(outcome="succeeded", rejectedMembers=0),
                   lambda s: s["rows"][2].update(transactionHash=s["rows"][1]["transactionHash"]),
                   lambda s: s["rows"][2].update(offerToIndependentFinalityNs=0))
        for change in changes:
            modified = json.loads(json.dumps(summary)); change(modified)
            output = list(lines)
            output[-3] = "    pq_network_business_test.go:249: PQ_NETWORK_BUSINESS_SUMMARY " + json.dumps(modified)
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                guard.validate_consensus_business_result(("\n".join(output) + "\n").encode(), b"", 0, "a" * 40)
        for output, stderr, code in ((raw, b"", 1), (raw.replace(b"--- PASS:", b"--- SKIP:"), b"", 0),
                                      (raw + b"PASS\n", b"", 0), (raw, b"panic: failed\n", 0),
                                      (raw.replace(b'"rows":', b'"rows":[],"rows":'), b"", 0)):
            with self.assertRaises(RuntimeError): guard.validate_consensus_business_result(output, stderr, code, "a" * 40)

    def test_signed_business_explicit_cli_never_grants_execution_or_combines_profiles(self):
        for flag in ("--consensus-e2e", "--consensus-e2e-retained-history", "--consensus-remote-e2e-retained-history"):
            with self.subTest(flag=flag), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                guard.argument_parser().parse_args([flag, "--consensus-signed-business"])
        for selected in ((True, False, False, True), (False, True, False, True), (False, False, True, True), (False, False, False, "true")):
            with self.assertRaises(RuntimeError): guard.selected_profile(*selected)
        with mock.patch.object(guard, "run", return_value=7) as run:
            output = io.StringIO()
            with redirect_stdout(output): self.assertEqual(guard.main(["--consensus-signed-business"]), 0)
            run.assert_not_called()
            self.assertEqual(json.loads(output.getvalue())["caps"], guard.fixed_caps(guard.BUSINESS_E2E_PROFILE))
            self.assertEqual(guard.main(["--consensus-signed-business", "--execute", "--prepared", "/unused/prepared.json", "--receipt", "/unused/receipt.json"]), 7)
            self.assertEqual(run.call_args.kwargs, dict(case_n=1, consensus_e2e=False, consensus_e2e_retained_history=False, consensus_signed_business=True))

    def e2e_recipe(self, temporary, profile="consensus-e2e"):
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
        plan = dict(profile=profile, sourceRoot=str(source), commit="a" * 40,
                    executionAuthorized=False, workingDirectory=str(source / "internal/consensus"),
                    sourcePins={guard.E2E_SOURCE: dict(sha256=guard.E2E_SOURCE_SHA256),
                                guard.E2E_PROGRESS_SOURCE: dict(sha256=guard.E2E_PROGRESS_SOURCE_SHA256)},
                    binaryPin=dict(path=str(binary), sha256=guard.digest(binary)),
                    command=[str(binary), "-test.run=^" + guard.E2E_TEST + "$", "-test.count=1", "-test.timeout=120s", "-test.v"],
                    environment=dict(guard.E2E_ENV))
        if profile == guard.E2E_RETAINED_HISTORY_PROFILE:
            plan["caps"] = guard.fixed_caps(profile)
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

    def remote_e2e_recipe(self, temporary):
        # Source/transport controls only: neither fake ELF is ever executed.
        plan, prepared, source, case, build, binary = self.e2e_recipe(
            temporary, guard.REMOTE_E2E_RETAINED_HISTORY_PROFILE)
        for relative in (guard.REMOTE_E2E_SOURCE, guard.REMOTE_PROCESS_SOURCE):
            original = Path(__file__).resolve().parents[2] / relative
            (source / relative).write_bytes(original.read_bytes())
        daemon = build / "ynx-consensus-pq-remote-signer"
        daemon.write_bytes(b"\x7fELFcontrol-only-normal-daemon-shape-not-executed")
        daemon.chmod(0o700)
        plan.update(caps=guard.fixed_caps(guard.REMOTE_E2E_RETAINED_HISTORY_PROFILE),
                    sourcePins=guard.consensus_remote_source_pins(),
                    remoteSignerPin=dict(path=str(daemon), sha256=guard.digest(daemon)))
        plan["command"][1] = "-test.run=^" + guard.REMOTE_E2E_TEST + "$"
        plan["environment"] = guard.consensus_remote_environment(plan, build)
        prepared.write_text(json.dumps(plan))
        return plan, prepared, source, case, build, binary, daemon

    def remote_e2e_output(self):
        # Synthetic log controls do not attest to a daemon or valid signature.
        lines, summary = self.e2e_output()
        lines[0] = "=== RUN   " + guard.REMOTE_E2E_TEST
        lines[-2] = "--- PASS: " + guard.REMOTE_E2E_TEST + " (20.00s)"
        remote = dict(version="ynx-pq-four-node-remote-e2e/v1", syntheticOnly=True,
            remoteValidatorIndex=0, normalBinarySHA256="7" * 64, daemonStarts=2, daemonExits=2,
            checkpointPathSharedWithOriginalApp=True, originalHRSColdRecovered=True,
            remoteProposalVerified=True, remotePrevoteVerified=True, remotePrecommitVerified=True,
            remoteThreeOfFourCommitVerified=True, remoteColdCommitVerified=True,
            proposalCount=1, prevoteCount=3, precommitCount=3, firstRemoteHeight=12,
            lastRemoteHeight=16, threeOfFourCommitHeight=14, coldCommitHeight=15,
            automaticReconnect=False, localSignerForRemoteValidator=False, publicDeployment=False)
        lines.insert(4, "    pq_network_remote_e2e_test.go:404: PQ_NETWORK_REMOTE_E2E_SUMMARY " + json.dumps(remote))
        return lines, summary, remote

    def test_remote_profile_is_explicit_closed_and_preserves_all_resource_caps(self):
        profile = guard.REMOTE_E2E_RETAINED_HISTORY_PROFILE
        self.assertEqual(guard.fixed_caps(profile), guard.fixed_caps(guard.E2E_RETAINED_HISTORY_PROFILE))
        self.assertEqual(guard.fixed_caps()["privateBytes"], 32 << 20)
        with tempfile.TemporaryDirectory() as tmp:
            plan, prepared, source, case, build, binary, daemon = self.remote_e2e_recipe(tmp)
            actual = guard.validate_consensus_remote_e2e_recipe(plan, prepared, inherited={})
            self.assertEqual(actual, (source, case, plan["command"], plan["environment"]))
            self.assertEqual(set(plan["sourcePins"]), {guard.E2E_SOURCE, guard.E2E_PROGRESS_SOURCE,
                                                      guard.REMOTE_E2E_SOURCE, guard.REMOTE_PROCESS_SOURCE})
            self.assertEqual(set(plan["environment"]), {"GOMAXPROCS", "GOGC", "GOMEMLIMIT", "YNX_PQ_NETWORK_REMOTE_E2E",
                                                       "YNX_PQ_REMOTE_SIGNER_BINARY", "YNX_PQ_REMOTE_SIGNER_SHA256"})
            self.assertEqual(guard.validate_consensus_remote_signer_binary(plan, build), daemon)
            self.assertEqual(len(guard.validate_consensus_remote_e2e_files(plan, source, build)), 6)
            self.assertEqual({p.name for p in build.iterdir()}, {binary.name, daemon.name})
            self.assertEqual({p.name for p in case.iterdir()}, {"prepared.json"})
            for selected in ("consensus-e2e", guard.E2E_RETAINED_HISTORY_PROFILE, profile):
                with self.subTest(local=selected), self.assertRaises(RuntimeError):
                    guard.validate_consensus_e2e_recipe(plan, prepared, selected)
            with self.assertRaises(RuntimeError): guard.validate_recipe(plan, prepared)
            original = json.loads(json.dumps(plan))
            for key in guard.CAPS:
                changed = json.loads(json.dumps(original)); changed["caps"][key] += 1
                with self.subTest(cap=key), self.assertRaises(RuntimeError):
                    guard.validate_consensus_remote_e2e_recipe(changed, prepared, inherited={})
        valid = dict(rssBytes=1000000, threads=10, privateBytes=536870912, buildBytes=100,
                     freeDiskBytes=3129999360, availableMemoryBytes=4 << 30)
        guard.enforce(valid, True, profile)
        for key, value in (("privateBytes", 536870913), ("rssBytes", (1 << 30) + 1),
                           ("threads", 321), ("buildBytes", (1 << 30) + 1),
                           ("freeDiskBytes", 3129999359),
                           ("availableMemoryBytes", guard.CAPS["availableMemoryFloorBytes"] - 1)):
            with self.subTest(limit=key), self.assertRaises(RuntimeError):
                guard.enforce(dict(valid, **{key: value}), True, profile)

    def test_remote_recipe_rejects_mode_selector_environment_and_pin_smuggling(self):
        mutations = [lambda p:p.update(profile=guard.E2E_RETAINED_HISTORY_PROFILE),
                     lambda p:p.update(executionAuthorized=True), lambda p:p.update(extra="not-reviewed"),
                     lambda p:p.pop("caps"), lambda p:p.update(n=1),
                     lambda p:p["command"].__setitem__(1, "-test.run=^" + guard.E2E_TEST + "$"),
                     lambda p:p["command"].__setitem__(1, "-test.run=" + guard.REMOTE_E2E_TEST),
                     lambda p:p["command"].__setitem__(3, "-test.timeout=150s"),
                     lambda p:p["command"].append("-test.bench=.."),
                     lambda p:p["environment"].update(YNX_PQ_NETWORK_REMOTE_E2E="authorized-four-node-window"),
                     lambda p:p["environment"].update(YNX_PQ_NETWORK_E2E="authorized-four-node-window"),
                     lambda p:p["environment"].update(YNX_PQ_REMOTE_PROCESS="authorized-signer-process-window"),
                     lambda p:p["environment"].update(GOMAXPROCS="4"),
                     lambda p:p["environment"].update(YNX_HOST_MODE="unapproved"),
                     lambda p:p["environment"].pop("YNX_PQ_REMOTE_SIGNER_SHA256"),
                     lambda p:p["environment"].update(YNX_PQ_REMOTE_SIGNER_BINARY=p["binaryPin"]["path"]),
                     lambda p:p.pop("remoteSignerPin"),
                     lambda p:p.update(remoteSignerPin=p["binaryPin"]),
                     lambda p:p["remoteSignerPin"].update(sha256="0" * 64),
                     lambda p:p["remoteSignerPin"].update(extra="not-reviewed"),
                     lambda p:p["sourcePins"].update({"extra.go": dict(sha256="1" * 64)})]
        mutations += [lambda p, key=key:p["sourcePins"].pop(key) for key in guard.consensus_remote_source_pins()]
        mutations += [lambda p, key=key:p["sourcePins"][key].update(sha256="0" * 64)
                      for key in guard.consensus_remote_source_pins()]
        with tempfile.TemporaryDirectory() as tmp:
            plan, prepared, _, case, build, *_ = self.remote_e2e_recipe(tmp)
            before = {str(p): p.read_bytes() for root in (case, build) for p in root.rglob("*") if p.is_file()}
            for index, mutate in enumerate(mutations):
                changed = json.loads(json.dumps(plan)); mutate(changed)
                with self.subTest(index=index), self.assertRaises(RuntimeError):
                    guard.validate_consensus_remote_e2e_recipe(changed, prepared, inherited={})
            self.assertEqual(before, {str(p): p.read_bytes() for root in (case, build) for p in root.rglob("*") if p.is_file()})

    def test_remote_window_does_not_inherit_old_optins_keys_or_host_modes(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan, prepared, _, case, build, *_ = self.remote_e2e_recipe(tmp)
            inherited = dict(PATH="/unapproved", HOME="/unapproved", GODEBUG="unapproved",
                             YNX_HOST_MODE="unapproved", YNX_PRIVATE_KEY="control-only-not-a-real-secret")
            actual = guard.consensus_runtime_environment(plan["environment"], case, build,
                                                        guard.REMOTE_E2E_RETAINED_HISTORY_PROFILE, inherited)
            self.assertEqual(actual, dict(plan["environment"], PATH="/usr/bin:/bin", TMPDIR=str(case / "tmp")))
            for key in ("YNX_PQ_NETWORK_E2E", "YNX_PQ_REMOTE_PROCESS", "YNX_PQ_REMOTE_PROCESS_LAYOUT"):
                for value in ("", "authorized-four-node-window", "authorized-signer-process-window"):
                    with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                        guard.validate_consensus_remote_e2e_recipe(plan, prepared, inherited={key: value})
                    with self.assertRaises(RuntimeError):
                        guard.consensus_runtime_environment(plan["environment"], case, build,
                            guard.REMOTE_E2E_RETAINED_HISTORY_PROFILE, {key: value})
            with self.assertRaises(RuntimeError):
                guard.consensus_runtime_environment(guard.E2E_ENV, case, build, "consensus-e2e",
                                                    {"YNX_PQ_NETWORK_REMOTE_E2E": "authorized-four-node-remote-signer-window"})

    def test_original_local_recipe_still_rejects_remote_binary_parameters_and_tree(self):
        for kind in ("remote-pin", "remote-environment", "remote-source-pins", "second-binary"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                plan, prepared, _, _, build, binary = self.e2e_recipe(tmp)
                if kind == "remote-pin": plan["remoteSignerPin"] = dict(plan["binaryPin"])
                elif kind == "remote-environment":
                    plan["environment"].update(YNX_PQ_NETWORK_REMOTE_E2E="authorized-four-node-remote-signer-window")
                elif kind == "remote-source-pins": plan["sourcePins"] = guard.consensus_remote_source_pins()
                else:
                    daemon = build / "ynx-consensus-pq-remote-signer"
                    daemon.write_bytes(binary.read_bytes()); daemon.chmod(0o700)
                with self.assertRaises(RuntimeError): guard.validate_consensus_e2e_recipe(plan, prepared)

    def test_remote_recipe_preserves_changed_or_aliased_daemon_and_source_material(self):
        for kind in ("missing-daemon", "changed-daemon", "script-daemon", "symlink-daemon", "hardlink-daemon",
                     "extra-build", "missing-source", "changed-source", "source-repinned", "symlink-source", "source-root-symlink"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                plan, prepared, source, case, build, _, daemon = self.remote_e2e_recipe(tmp)
                leaf = source / guard.REMOTE_E2E_SOURCE
                if kind == "missing-daemon": daemon.rename(Path(tmp) / "retain-daemon")
                elif kind == "changed-daemon": daemon.write_bytes(b"\x7fELFchanged")
                elif kind == "script-daemon":
                    daemon.write_bytes(b"#!/bin/sh\nexit 0\n")
                    plan["remoteSignerPin"]["sha256"] = guard.digest(daemon)
                    plan["environment"] = guard.consensus_remote_environment(plan, build)
                elif kind == "symlink-daemon":
                    retained = Path(tmp) / "retained-daemon"; daemon.rename(retained); daemon.symlink_to(retained)
                elif kind == "hardlink-daemon": os.link(daemon, Path(tmp) / "retained-daemon")
                elif kind == "extra-build": (build / "UNKNOWN").write_bytes(b"retain original effect")
                elif kind == "missing-source": leaf.rename(Path(tmp) / "retain-source")
                elif kind in ("changed-source", "source-repinned"):
                    leaf.write_bytes(leaf.read_bytes() + b"\n// changed fixture source\n")
                    if kind == "source-repinned": plan["sourcePins"][guard.REMOTE_E2E_SOURCE]["sha256"] = guard.digest(leaf)
                elif kind == "symlink-source":
                    retained = Path(tmp) / "retained-source"; leaf.rename(retained); leaf.symlink_to(retained)
                elif kind == "source-root-symlink":
                    alias = Path(tmp) / "source-alias"; alias.symlink_to(source, target_is_directory=True)
                    plan["sourceRoot"] = str(alias)
                before = {str(p): p.read_bytes() for root in (case, build) for p in root.rglob("*") if p.is_file()}
                with self.assertRaises((RuntimeError, OSError)):
                    guard.validate_consensus_remote_e2e_recipe(plan, prepared, inherited={})
                self.assertEqual(before, {str(p): p.read_bytes() for root in (case, build) for p in root.rglob("*") if p.is_file()})

    def test_remote_six_source_and_binary_identities_must_stay_immutable(self):
        for target in (guard.E2E_SOURCE, guard.E2E_PROGRESS_SOURCE, guard.REMOTE_E2E_SOURCE,
                       guard.REMOTE_PROCESS_SOURCE, "consensus.test", "ynx-consensus-pq-remote-signer"):
            with self.subTest(target=target), tempfile.TemporaryDirectory() as tmp:
                plan, _, source, _, build, *_ = self.remote_e2e_recipe(tmp)
                captured = guard.validate_consensus_remote_e2e_files(plan, source, build)
                leaf = source / target if target.startswith("internal/") else build / target
                content, mode = leaf.read_bytes(), leaf.stat().st_mode & 0o777
                retained = Path(tmp) / (leaf.name + ".retained")
                leaf.rename(retained); leaf.write_bytes(content); leaf.chmod(mode)
                # The byte pin still matches. A replacement inode cannot reuse
                # admission from the original captured source/binary identity.
                with self.assertRaisesRegex(RuntimeError, "since admission"):
                    guard.validate_consensus_remote_e2e_files(plan, source, build, captured)
        with tempfile.TemporaryDirectory() as tmp:
            plan, _, source, _, build, *_ = self.remote_e2e_recipe(tmp)
            captured = guard.validate_consensus_remote_e2e_files(plan, source, build)
            unknown = build / "UNKNOWN"
            unknown.write_bytes(b"retain unexpected build effect")
            with self.assertRaises(RuntimeError):
                guard.validate_consensus_remote_e2e_files(plan, source, build, captured)
            self.assertEqual(unknown.read_bytes(), b"retain unexpected build effect")

    def test_remote_result_requires_sole_remote_test_and_all_actual_custody_evidence(self):
        lines, _, original = self.remote_e2e_output()
        stdout = ("\n".join(lines) + "\n").encode()
        evidence = guard.validate_consensus_remote_e2e_result(stdout, b"", 0, "7" * 64)
        self.assertEqual(evidence["remoteSigner"], original)
        with self.assertRaises(RuntimeError): guard.validate_consensus_e2e_result(stdout, b"", 0)
        local, _ = self.e2e_output()
        with self.assertRaises(RuntimeError):
            guard.validate_consensus_remote_e2e_result(("\n".join(local) + "\n").encode(), b"", 0, "7" * 64)
        for key in original:
            changed = json.loads(json.dumps(original))
            if key == "version": changed[key] = "ynx-pq-four-node-e2e/v1"
            elif type(changed[key]) is bool: changed[key] = not changed[key]
            elif key == "normalBinarySHA256": changed[key] = "8" * 64
            elif key == "remoteValidatorIndex": changed[key] = 1
            elif key in ("daemonStarts", "daemonExits"): changed[key] = 3
            else: changed[key] = 0
            output = list(lines)
            output[4] = "    pq_network_remote_e2e_test.go:404: PQ_NETWORK_REMOTE_E2E_SUMMARY " + json.dumps(changed)
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                guard.validate_consensus_remote_e2e_result(("\n".join(output) + "\n").encode(), b"", 0, "7" * 64)
        invalid = [lines[:4] + lines[5:], lines[:5] + [lines[4]] + lines[5:],
                   lines[:4] + [lines[5], lines[4]] + lines[6:]]
        for changed in invalid:
            with self.assertRaises(RuntimeError):
                guard.validate_consensus_remote_e2e_result(("\n".join(changed) + "\n").encode(), b"", 0, "7" * 64)
        duplicate = stdout.replace(b'"daemonStarts": 2', b'"daemonStarts": 1, "daemonStarts": 2')
        with self.assertRaises(RuntimeError): guard.validate_consensus_remote_e2e_result(duplicate, b"", 0, "7" * 64)
        with self.assertRaises(RuntimeError): guard.validate_consensus_remote_e2e_result(stdout, b"", 0, "8" * 64)

    def test_remote_cli_is_mutually_exclusive_and_default_never_starts_a_window(self):
        flags = ("--consensus-e2e", "--consensus-e2e-retained-history", "--consensus-remote-e2e-retained-history")
        for first in flags[:2]:
            with self.subTest(first=first), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                guard.argument_parser().parse_args([first, flags[2]])
        for selected in ((True, False, True), (False, True, True), (False, False, "true")):
            with self.subTest(selected=selected), self.assertRaises(RuntimeError): guard.selected_profile(*selected)
        with mock.patch.object(guard, "run") as run:
            output = io.StringIO()
            with redirect_stdout(output): self.assertEqual(guard.main([flags[2]]), 0)
            self.assertEqual(json.loads(output.getvalue())["caps"], guard.fixed_caps(guard.REMOTE_E2E_RETAINED_HISTORY_PROFILE))
            run.assert_not_called()
            with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit): guard.main([flags[2], "--execute"])
            run.assert_not_called()
        with mock.patch.object(guard, "run", return_value=7) as run:
            self.assertEqual(guard.main([flags[2], "--execute", "--prepared", "/unused/prepared.json",
                                         "--receipt", "/unused/receipt.json"]), 7)
            self.assertEqual(run.call_args.kwargs, dict(case_n=1, consensus_e2e=False,
                consensus_e2e_retained_history=False, consensus_remote_e2e_retained_history=True))

    def test_remote_workflow_source_keeps_dispatch_exclusive_and_normal_build_pins(self):
        # Static pipeline controls only. Reading YAML source does not dispatch
        # a job, execute an ELF, prove Node.Start, or qualify network evidence.
        workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/resource-market-ci.yml").read_text()
        name = "consensus_remote_e2e_retained_history"
        declaration = workflow.split("      " + name + ":\n", 1)[1].split("      remote_signer_process:", 1)[0]
        self.assertIn("default: false", declaration)
        self.assertIn("type: boolean", declaration)
        identity = workflow.split("      - name: Record exact candidate identity\n", 1)[1].split("      - name:", 1)[0]
        selections = next(line for line in workflow.splitlines() if "for YNX_WINDOW_SELECTED in" in line)
        # Inputs cross the YAML/shell boundary through the explicit env map.
        # Check every original mode binding and its quoted loop argument; a
        # renamed or omitted mode must still fail this source contract.
        for input_name, env_name in (
            ("paired_n1", "YNX_ENTRY_PAIRED"),
            ("consensus_e2e", "YNX_ENTRY_LOCAL"),
            ("consensus_e2e_retained_history", "YNX_ENTRY_LOCAL_RETAINED"),
            (name, "YNX_ENTRY_REMOTE_RETAINED"),
            ("remote_signer_process", "YNX_ENTRY_REMOTE_PROCESS"),
        ):
            with self.subTest(input_name=input_name):
                self.assertIn(env_name + ": ${{ inputs." + input_name + " }}", identity)
                self.assertEqual(selections.count('"$' + env_name + '"'), 1)
        self.assertNotIn("${{ inputs.", selections)
        process = workflow.split("      - name: Run the separately authorized normal remote signer process\n", 1)[1].split("      - name:", 1)[0]
        self.assertIn("!inputs." + name, process)
        build = workflow.split("      - name: Build exact bounded network binaries and recipe without starting nodes\n", 1)[1].split("      - name:", 1)[0]
        network = workflow.split("      - name: Run the authorized bounded four-validator transition\n", 1)[1].split("      - name:", 1)[0]
        condition = next(line for line in network.splitlines() if line.strip().startswith("if:"))
        self.assertIn("github.event_name == 'workflow_dispatch'", condition)
        self.assertIn("inputs.candidate_sha == github.sha", condition)
        self.assertIn("!inputs.remote_signer_process", condition)
        self.assertIn("!inputs.paired_n1", condition)
        self.assertIn("inputs." + name, condition)
        self.assertIn("steps.normalci.outcome == 'success'", condition)
        self.assertIn("steps.pqnetworkbuild.outcome == 'success'", condition)
        self.assertIn("--consensus-remote-e2e-retained-history", network)
        self.assertIn("go build -p 1 -trimpath", build)
        self.assertIn("go test -p 1 -c", build)
        self.assertNotIn("--execute", build)
        self.assertNotIn("go test -p 1 -c", network)
        self.assertIn("./cmd/ynx-consensus-pq-remote-signer", build)
        self.assertIn("'remoteSignerPin'", build)
        self.assertIn(guard.REMOTE_E2E_TEST, build)
        for leaf, pin in guard.consensus_remote_source_pins().items():
            with self.subTest(leaf=leaf):
                self.assertIn("'" + leaf + "': '" + pin["sha256"] + "'", build)
        self.assertIn("if digest(source / leaf) != pin:", build)
        self.assertIn("sourcePins={leaf: dict(sha256=pin)", build)
        self.assertNotIn("sourcePins={leaf: dict(sha256=digest", build)
        # The outer job must not preempt the complete original guard after a
        # slow checkout or compilation. Admission uses the server run start.
        self.assertIn("started = int(os.environ['YNX_REMOTE_WORKFLOW_STARTED_AT'])", network)
        self.assertIn("remaining = started + 12*60 - now", network)
        self.assertIn("remaining < 150", network)
        self.assertLess(network.index("YNX_REMOTE_OUTER_BUDGET_REFUSED"), network.index("--execute"))

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

    def test_retained_history_profile_requires_explicit_matching_recipe(self):
        profile = guard.E2E_RETAINED_HISTORY_PROFILE
        original = dict(guard.CAPS)
        expected = dict(original, privateBytes=536870912)
        self.assertEqual(guard.fixed_caps(profile), expected)
        self.assertEqual({key for key in expected if expected[key] != original[key]}, {"privateBytes"})
        # Returned dictionaries cannot mutate the original guard or later runs.
        changed = guard.fixed_caps(profile)
        changed["activeMs"] = 1
        self.assertEqual(guard.CAPS, original)
        self.assertEqual(guard.fixed_caps(profile), expected)
        for selected in (None, "consensus-e2e"):
            self.assertEqual(guard.fixed_caps(selected), original)
        with self.assertRaises(RuntimeError): guard.fixed_caps("caller-chosen")
        with tempfile.TemporaryDirectory() as tmp:
            plan, prepared, source, case, build, _ = self.e2e_recipe(tmp, profile)
            with self.assertRaises(RuntimeError): guard.validate_consensus_e2e_recipe(plan, prepared)
            self.assertEqual(guard.validate_consensus_e2e_recipe(plan, prepared, profile),
                             (source, case, plan["command"], guard.E2E_ENV))
            plan["profile"] = "consensus-e2e"
            with self.assertRaises(RuntimeError): guard.validate_consensus_e2e_recipe(plan, prepared, profile)
            # An old flag/recipe cannot claim the retained-history cap either.
            with self.assertRaises(RuntimeError): guard.validate_consensus_e2e_recipe(plan, prepared)
            plan["caps"] = dict(original)
            guard.validate_consensus_e2e_recipe(plan, prepared)
            self.assertEqual({p.name for p in case.iterdir()}, {"prepared.json"})
            self.assertEqual({p.name for p in build.iterdir()}, {"consensus.test"})

    def test_retained_history_rejects_all_cap_overrides_before_case_mutation(self):
        profile = guard.E2E_RETAINED_HISTORY_PROFILE
        with tempfile.TemporaryDirectory() as tmp:
            original, prepared, _, case, build, _ = self.e2e_recipe(tmp, profile)
            mutations = [lambda p:p.pop("caps"), lambda p:p.update(caps=None),
                         lambda p:p["caps"].update(extra=1),
                         lambda p:p["caps"].update(privateBytes=32 << 20),
                         lambda p:p["caps"].update(privateBytes=float(536870912))]
            mutations += [lambda p, key=key:p["caps"].__setitem__(key, p["caps"][key] + 1)
                          for key in guard.CAPS]
            mutations += [lambda p, key=key:p["caps"].pop(key) for key in guard.CAPS]
            before = {str(p): p.read_bytes() for root in (case, build) for p in root.rglob("*") if p.is_file()}
            for index, mutate in enumerate(mutations):
                changed = json.loads(json.dumps(original)); mutate(changed)
                with self.subTest(index=index), self.assertRaises(RuntimeError):
                    guard.validate_consensus_e2e_recipe(changed, prepared, profile)
            self.assertEqual(before, {str(p): p.read_bytes() for root in (case, build) for p in root.rglob("*") if p.is_file()})
            self.assertEqual({p.name for p in case.iterdir()}, {"prepared.json"})
            self.assertEqual({p.name for p in build.iterdir()}, {"consensus.test"})

    def test_retained_history_keeps_exact_environment_command_and_two_pins(self):
        profile = guard.E2E_RETAINED_HISTORY_PROFILE
        self.assertEqual(guard.E2E_SOURCE_SHA256, "a6029a4e54a7cbe86e31fdc0a0e88ffac2d17940a709feb13d6f274de44829d2")
        self.assertEqual(guard.E2E_PROGRESS_SOURCE_SHA256, "66dd40ab781943d85555cac243148d9744d049d780488f542bb47e50af977044")
        mutations = [lambda p:p.update(executionAuthorized=True),
                     lambda p:p["command"].__setitem__(3, "-test.timeout=150s"),
                     lambda p:p["environment"].pop("YNX_PQ_NETWORK_E2E"),
                     lambda p:p["environment"].update(GOMAXPROCS="4"),
                     lambda p:p["sourcePins"].pop(guard.E2E_PROGRESS_SOURCE),
                     lambda p:p["sourcePins"].update({"extra.go": dict(sha256="0" * 64)}),
                     lambda p:p["sourcePins"][guard.E2E_SOURCE].update(sha256="0" * 64),
                     lambda p:p["sourcePins"][guard.E2E_PROGRESS_SOURCE].update(sha256="0" * 64)]
        with tempfile.TemporaryDirectory() as tmp:
            original, prepared, *_ = self.e2e_recipe(tmp, profile)
            for index, mutate in enumerate(mutations):
                changed = json.loads(json.dumps(original)); mutate(changed)
                with self.subTest(index=index), self.assertRaises(RuntimeError):
                    guard.validate_consensus_e2e_recipe(changed, prepared, profile)
        for kind in ("changed-helper", "symlink-helper", "old-unknown"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                plan, prepared, source, case, build, _ = self.e2e_recipe(tmp, profile)
                helper = source / guard.E2E_PROGRESS_SOURCE
                if kind == "changed-helper": helper.write_bytes(helper.read_bytes() + b"\n// changed\n")
                elif kind == "symlink-helper":
                    target = Path(tmp) / "original-helper"
                    helper.rename(target); helper.symlink_to(target)
                else: (case / "UNKNOWN").write_bytes(b"retain original intent")
                before = {str(p): p.read_bytes() for root in (case, build) for p in root.rglob("*") if p.is_file()}
                with self.assertRaises(RuntimeError): guard.validate_consensus_e2e_recipe(plan, prepared, profile)
                self.assertEqual(before, {str(p): p.read_bytes() for root in (case, build) for p in root.rglob("*") if p.is_file()})

    def test_retained_history_private_limit_and_disk_reserves_remain_bounded(self):
        profile = guard.E2E_RETAINED_HISTORY_PROFILE
        valid = dict(rssBytes=1000000, threads=10, privateBytes=536870912, buildBytes=100,
                     freeDiskBytes=3129999360, availableMemoryBytes=4 << 30)
        guard.enforce(valid, True, profile)
        for selected in (None, "consensus-e2e"):
            with self.subTest(profile=selected), self.assertRaisesRegex(RuntimeError, "privateBytes"):
                guard.enforce(dict(valid, privateBytes=(32 << 20) + 1), True, selected)
        with self.assertRaisesRegex(RuntimeError, "privateBytes"):
            guard.enforce(dict(valid, privateBytes=536870913), True, profile)
        with self.assertRaisesRegex(RuntimeError, "disk floor/reserve"):
            guard.enforce(dict(valid, freeDiskBytes=3129999359), True, profile)
        # Runtime keeps the original 1 GiB floor + 425 MiB root reserve.
        guard.enforce(dict(valid, freeDiskBytes=1519386624), False, profile)
        with self.assertRaisesRegex(RuntimeError, "disk floor/reserve"):
            guard.enforce(dict(valid, freeDiskBytes=1519386623), False, profile)
        for key, value in (("rssBytes", (1 << 30) + 1), ("threads", 321),
                           ("buildBytes", (1 << 30) + 1),
                           ("availableMemoryBytes", guard.CAPS["availableMemoryFloorBytes"] - 1)):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                guard.enforce(dict(valid, **{key: value}), True, profile)

    def test_retained_history_cli_flags_are_exclusive_and_never_implicit_execution(self):
        parser = guard.argument_parser()
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as rejected:
            parser.parse_args(["--consensus-e2e", "--consensus-e2e-retained-history"])
        self.assertEqual(rejected.exception.code, 2)
        with self.assertRaises(RuntimeError): guard.selected_profile(True, True)
        with self.assertRaises(RuntimeError): guard.selected_profile(False, "true")
        for flag, profile in (("--consensus-e2e", "consensus-e2e"),
                              ("--consensus-e2e-retained-history", guard.E2E_RETAINED_HISTORY_PROFILE)):
            with self.subTest(flag=flag), mock.patch.object(guard, "run") as run:
                output = io.StringIO()
                with redirect_stdout(output): self.assertEqual(guard.main([flag]), 0)
                self.assertEqual(json.loads(output.getvalue())["caps"], guard.fixed_caps(profile))
                run.assert_not_called()
                with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                    guard.main([flag, "--execute"])
                run.assert_not_called()
        # Dispatch routing only: no ELF, fork, probe, host proc or Node.Start.
        with mock.patch.object(guard, "run", return_value=7) as run:
            code = guard.main(["--consensus-e2e-retained-history", "--execute",
                               "--prepared", "/unused/prepared.json", "--receipt", "/unused/receipt.json"])
            self.assertEqual(code, 7)
            self.assertEqual(run.call_args.kwargs,
                             dict(case_n=1, consensus_e2e=False, consensus_e2e_retained_history=True))

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
