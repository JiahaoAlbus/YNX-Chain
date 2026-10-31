"""Observer contract controls only; fixture JSON never establishes node traffic."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

spec=importlib.util.spec_from_file_location("normal_wire",Path(__file__).with_name("pq-normal-process-lab.py"))
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)


def fixture():
    def totals(messages,transactions,raw,proto):
        return dict(messages=messages,transactions=transactions,transactionBytes=raw,reencodedProtoBytes=proto)
    return dict(version="YNX-COMET-WIRE-OBSERVATION/v1",scope="synthetic-loopback-lab/v1",syntheticOnly=True,independentFinality=False,physicalBytesMeasured=False,
        captureBoundary="after-normal-node-stop;completed-calls-only;in-flight-excluded",
        snapshot=dict(schema="YNX-MEMPOOL-WIRE-OBSERVATION/v1",attached=True,physicalBytesMeasured=False,overflow=False,
            sendAttempts=totals(3,3,300,312),sendQueued=totals(2,2,200,208),sendNotQueued=totals(1,1,100,104),received=totals(2,2,200,208),
            emptyReceived=0,sendCallNs=30,sendCallMaxNs=20,checkTxCalls=2,checkTxReturnNil=1,checkTxReturnError=1,checkTxCallNs=40,checkTxCallMaxNs=25))


class WireReadbackControls(unittest.TestCase):
    def test_original_snapshot_arithmetic_and_measurement_boundaries_fail_closed(self):
        lab.validate_wire_observation(fixture())
        changes=[("physicalBytesMeasured",True),("independentFinality",True),("snapshot.physicalBytesMeasured",True),
            ("snapshot.attached",False),("snapshot.overflow",True),("snapshot.sendAttempts.transactionBytes",301),
            ("snapshot.checkTxCalls",3),("snapshot.sendCallMaxNs",31),("snapshot.checkTxCallNs",-1),
            ("snapshot.emptyReceived",True),("snapshot.sendCallNs",1<<64),("snapshot.received",None)]
        for field,value in changes:
            row=copy.deepcopy(fixture());parent=row;parts=field.split(".")
            for part in parts[:-1]:parent=parent[part]
            parent[parts[-1]]=value
            with self.subTest(field=field),self.assertRaises(RuntimeError):lab.validate_wire_observation(row)
        with self.assertRaises(RuntimeError):lab.validate_wire_observation(None)

    def ceremony(self,root,enabled=True):
        c=object.__new__(lab.Ceremony);c.observe_wire=enabled;c.wire_outputs=[]
        c.w=SimpleNamespace(work=root,children=[]);return c

    def test_opt_in_uses_fresh_distinct_original_cli_lifetimes_and_default_off(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();(root/"public").mkdir()
            disabled=self.ceremony(root,False)
            self.assertEqual(disabled.wire_arguments("bootstrap",0),[])
            self.assertFalse((root/"public/node-wire").exists())
            self.assertFalse(disabled.wire_readback()["logicalReadbackComplete"])
            c=self.ceremony(root);args=c.wire_arguments("bootstrap",0)
            self.assertEqual(args,["--wire-observation-output",str(root/"public/node-wire/bootstrap-node-0.json"),"--wire-observation-scope","synthetic-loopback-lab/v1"])
            self.assertNotEqual(c.wire_arguments("pq",0)[1],args[1])
            with self.assertRaisesRegex(RuntimeError,"cannot be replayed"):c.wire_arguments("bootstrap",0)
            with self.assertRaises(RuntimeError):c.wire_arguments("public",0)
            with self.assertRaises(RuntimeError):c.wire_arguments("pq",True)

    def test_readback_keeps_raw_pins_and_missing_lifetime_is_not_zero_or_ready(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();(root/"public").mkdir();c=self.ceremony(root)
            for phase in ("bootstrap","pq"):
                for node in range(4):
                    args=c.wire_arguments(phase,node);Path(args[1]).write_text(json.dumps(fixture()))
                    c.w.children.append(dict(name=f"{phase}-node-{node}",process=SimpleNamespace(returncode=0)))
            result=c.wire_readback()
            self.assertTrue(result["logicalReadbackComplete"])
            self.assertFalse(result["physicalBytesMeasured"])
            self.assertFalse(result["independentFinality"])
            self.assertFalse(result["networkPackingReady"])
            self.assertEqual(len(result["observations"]),8)
            for row in result["observations"]:
                self.assertEqual(row["sha256"],hashlib.sha256((root/"public"/row["file"]).read_bytes()).hexdigest())
            c.wire_outputs[-1]["path"]=root/"public/node-wire/not-produced.json"
            partial=c.wire_readback()
            self.assertFalse(partial["logicalReadbackComplete"])
            self.assertEqual(len(partial["observations"]),7)
            self.assertEqual(len(partial["errors"]),1)
            self.assertEqual(partial["errors"][0]["node"],3)


if __name__=="__main__":unittest.main()
