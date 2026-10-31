"""Controls for the normal Linux launcher; none are network/TPS evidence."""
import argparse
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import os
import sys

spec = importlib.util.spec_from_file_location("normal_cohort", Path(__file__).with_name("consensus-linux-cohort.py"))
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)


class NormalCohortControls(unittest.TestCase):
    def test_actual_capacity_and_heavy_conflict_are_admission_inputs(self):
        lab.admit(6 << 30, 16 << 30, [])
        for memory, disk, heavy in ((6 << 30, (16 << 30)-1, []), ((6 << 30)-1, 16 << 30, []), (6 << 30, 16 << 30, [dict(pid=99)])):
            with self.assertRaises(RuntimeError): lab.admit(memory, disk, heavy)

    def manifest(self, root):
        return dict(purpose="local-ephemeral", migrationPath=str(root / "migration.json"),
                    nodes=[dict(home=str(root / str(i)), abciStatePath=str(root / str(i) / "state.json"),
                                p2pListen="tcp://127.0.0.1:"+str(31656+i),
                                persistentPeers=",".join((str(j)*40)+"@127.0.0.1:"+str(31656+j) for j in range(4) if j != i),
                                consensusKeyType="ed25519", rpcUrl="http://127.0.0.1:"+str(31757+i)) for i in range(4)])

    def test_manifest_refuses_external_paths_endpoints_and_pq_relabel(self):
        root = Path("/owned/network")
        lab.validate_manifest(self.manifest(root), root)
        for key, value in (("home", "/foreign"), ("home", "/owned/network/../foreign"), ("rpcUrl", "http://43.153.202.237:31757"), ("p2pListen", "tcp://0.0.0.0:31656"), ("persistentPeers", "a"*40+"@43.153.202.237:31656"), ("consensusKeyType", "ynx-pq")):
            manifest = self.manifest(root); manifest["nodes"][0][key] = value
            with self.assertRaises(RuntimeError): lab.validate_manifest(manifest, root)
        manifest = self.manifest(root); manifest["nodes"][1]["rpcUrl"] = manifest["nodes"][0]["rpcUrl"]
        with self.assertRaises(RuntimeError): lab.validate_manifest(manifest, root)

    def test_normal_bootstrap_command_keeps_every_independent_pin(self):
        args = lab.node_args(dict(home="home", abciStatePath="state"),
                             dict(migrationPath="migration", genesisHash="comet", migrationStateHash="bound"),
                             dict(originalGenesisHash="native"))
        for flag, expected in (("--consensus-genesis-sha256", "comet"), ("--original-genesis-hash", "native"), ("--bound-migration-state-hash", "bound")):
            self.assertEqual(args[args.index(flag)+1], expected)
        self.assertNotIn("--pq-engine-schedule", args)

    def test_existing_report_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "receipt.json"
            lab.write_new(output, dict(firstCause="original"))
            before = output.read_bytes()
            with self.assertRaises(FileExistsError): lab.write_new(output, {})
            self.assertEqual(output.read_bytes(), before)

    def test_artifact_inventory_refuses_links_outside_owned_storage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / "data").write_bytes(b"retained")
            self.assertGreaterEqual(lab.private_bytes(root), 8)
            (root / "foreign").symlink_to("/tmp", target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError, "nonregular"): lab.private_bytes(root)

    def test_profiles_keep_original_probe_limits_and_pq_refuses_before_dispatch(self):
        for profile in lab.PROFILES.values():
            self.assertLessEqual(profile["count"]*profile["rounds"], 2048)
            self.assertEqual(profile["count"]*profile["rounds"]/profile["rate"], float(profile["window"][:-1]))
        args = argparse.Namespace(source="/source", commit="a"*40, work_parent="/work", profile="pq-and", execute=True)
        with mock.patch.object(lab, "check_source", return_value={}):
            with self.assertRaisesRegex(RuntimeError, "PQ normal producer/client not supplied"): lab.run(args)

    @unittest.skipUnless(sys.platform == "linux", "real Linux /proc required; no macOS runtime substitution")
    def test_real_owned_child_is_stopped_without_signalling_unrelated_processes(self):
        # Actual process lifecycle only; this sleeper is never called a node.
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / ".private").mkdir(); (root / "public").mkdir()
            window = lab.Window(Path(__file__).resolve().parents[2], root)
            proc = window.launch("owned-lifecycle", [sys.executable, "-c", "import time; time.sleep(20)"])
            self.assertIsNone(proc.poll())
            self.assertTrue(window.stop())
            self.assertIsNotNone(proc.returncode)


if __name__ == "__main__": unittest.main()
