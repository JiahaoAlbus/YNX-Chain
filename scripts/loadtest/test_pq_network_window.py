"""Supervisor binding/artifact controls only; no node/socket/traffic sampling."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest import mock


def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


hook=module("network_window_controls","pq-network-window.py")
driver=module("normal_window_controls","pq-independent-load.py")


def ceremony(root):
    nodes=[dict(index=i,nodeId=format(i+1,"040x"),p2pAddress="tcp://127.0.0.1:%d"%(31656+i)) for i in range(4)]
    children=[dict(name="pq-node-%d"%i,startTicks=1000+i,process=SimpleNamespace(pid=200+i,poll=lambda:None)) for i in range(4)]
    return SimpleNamespace(mode="online",plan=dict(nodes=nodes),w=SimpleNamespace(work=root,children=children))


class NetworkHookControls(unittest.TestCase):
    def create(self,root):
        (root/"public").mkdir()
        with mock.patch.dict(os.environ,GITHUB_RUN_ID="control-only",GITHUB_RUN_ATTEMPT="1"):
            return hook.NetworkWindow(ceremony(root),driver.lab,"a"*40,"b"*40,"c"*64,500)

    def test_normal_constructor_imports_are_pure_and_freeze_is_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            window=self.create(Path(directory))
            self.assertIsNone(window.start);self.assertIsNone(window.end)
            self.assertEqual(list((Path(directory)/"public").iterdir()),[Path(directory)/"public/network-binding.json"])
            with mock.patch.object(hook.hashlib,"sha256",return_value=SimpleNamespace(hexdigest=lambda:"0"*64)):
                with self.assertRaisesRegex(RuntimeError,"identity changed"):hook.frozen_module("owned-tcp-accounting.py")

    def test_same_original_scope_two_checkpoints_missing_layers_stay_unknown(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);window=self.create(root);seen=[]
            def missing_sample(**args):
                seen.append(args);at=time.monotonic_ns()
                return dict(schema="YNX-OWNED-TCP/1",startMonotonicNs=str(at),endMonotonicNs=str(at),
                    nodes=args["nodes"],complete=False,reasons=["CONTROL_ONLY_NOT_SAMPLED"],firstCause="CONTROL_ONLY_NOT_SAMPLED")
            with mock.patch.object(window.tcp,"sample_owned_tcp",side_effect=missing_sample),mock.patch.object(driver.urllib.request,"build_opener") as network:
                window.capture("start");result=window.finish(0)
                network.assert_not_called()
            self.assertEqual(len(seen),2)
            self.assertEqual(seen[0]["nodes"],seen[1]["nodes"])
            self.assertEqual(seen[0]["nodes"],window.binding["nodes"])
            self.assertEqual(seen[0]["launcher_pid"],os.getpid())
            self.assertIsNone(seen[0]["previous"])
            self.assertIs(seen[1]["previous"],window.start["tcp"])
            for node in result["nodes"]:
                for layer in ("logical","attempted","serializedProto"):
                    self.assertEqual(node[layer]["status"],"UNKNOWN")
            self.assertEqual(result["tcp"]["status"],"UNKNOWN")
            self.assertIsNone(result["binding"]["qualifiedCount"])
            self.assertEqual(result["qualifiedCountEvidence"],0)
            self.assertIsNone(result["delivered"]);self.assertFalse(result["gainsQualified"])
            self.assertFalse(result["physicalBytesMeasured"])
            self.assertEqual(result["bindingSHA256"],window.layers.digest(window.binding))
            self.assertEqual(json.loads((root/"public/network-accounting.json").read_bytes()),result)
            for row in result["originalCheckpoints"]:
                self.assertEqual(driver.lab.guard.digest(root/"public"/row["path"]),row["sha256"])
            with self.assertRaisesRegex(RuntimeError,"start checkpoint"):window.finish(0)

    def test_stopped_or_duplicate_original_nodes_cannot_be_sampled(self):
        for case in ("stopped","duplicate"):
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);(root/"public").mkdir();c=ceremony(root)
                if case=="stopped":c.w.children[0]["process"].poll=lambda:0
                else:c.w.children.append(c.w.children[0])
                with mock.patch.dict(os.environ,GITHUB_RUN_ID="control-only"):
                    with self.assertRaisesRegex(RuntimeError,"live original"):
                        hook.NetworkWindow(c,driver.lab,"a"*40,"b"*40,"c"*64,500)
                self.assertEqual(list((root/"public").iterdir()),[])

    def test_original_endpoint_must_be_canonical_loopback(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/"public").mkdir();c=ceremony(root)
            c.plan["nodes"][0]["p2pAddress"]="tcp://192.0.2.1:31656"
            with mock.patch.dict(os.environ,GITHUB_RUN_ID="control-only"):
                with self.assertRaisesRegex(RuntimeError,"loopback"):
                    hook.NetworkWindow(c,driver.lab,"a"*40,"b"*40,"c"*64,500)


if __name__=="__main__":unittest.main()
