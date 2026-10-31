"""Orchestration controls only. No mock HTTP endpoint is called a validator."""
import base64
import importlib.util
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location("pq_normal",Path(__file__).with_name("pq-normal-process-lab.py"))
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)


class NormalPQControls(unittest.TestCase):
    def test_native_prefixed_and_rpc_uppercase_hash_aliases_cannot_replay(self):
        value=lab.digest(b"public")
        self.assertEqual(lab.comet_hash("0x"+value),lab.comet_hash(value.upper()))
        ceremony=object.__new__(lab.Ceremony);ceremony.attempted={value}
        with self.assertRaisesRegex(RuntimeError,"duplicate broadcast"):
            ceremony.post_once("no-new-intent",b"public","0x"+value.upper())
        with self.assertRaisesRegex(RuntimeError,"replay differs"):
            ceremony.halt_post(b"public","0x"+value)
        for malformed in (None,"",value+"00","0x"+value[:-1]," " + value):
            with self.subTest(malformed=malformed),self.assertRaises(RuntimeError):lab.comet_hash(malformed)

    def test_sender_jsonl_matches_explicit_go_command_order(self):
        request=dict(version="YNX-PQ-LAB-SENDER-REQUEST/v1",operationId="a"*64,ownerIndex=4,firstNonce="2",members=1)
        command=lab.sender_command_data("sign",request,42,"b"*64)
        expected='{"version":"YNX-PQ-LAB-SENDER-COMMAND/v1","operation":"sign","request":{"version":"YNX-PQ-LAB-SENDER-REQUEST/v1","operationId":"'+"a"*64+'","ownerIndex":4,"firstNonce":"2","members":1},"checkpointHeight":"42","checkpointAppHash":"'+"b"*64+'","materialsFile":"","materialsSHA256":"","proofFile":""}'
        self.assertEqual(json.dumps(command,separators=(",",":")),expected)
        confirmed=lab.sender_command_data("confirm",request,materials="/public/materials",materials_sha="c"*64,proof="/public/proof")
        self.assertEqual(confirmed["checkpointHeight"],"0")
        self.assertEqual(confirmed["checkpointAppHash"],"")

    def test_public_proof_file_rejects_escape_symlink_and_changed_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();directory=root/"public";directory.mkdir()
            target=directory/"request.json";target.write_bytes(b"original")
            ref=dict(path="request.json",sha256=lab.digest(b"original"))
            self.assertEqual(lab.public_file(directory,ref),target)
            (root/"outside").write_bytes(b"original")
            (directory/"alias").symlink_to(root/"outside")
            for escaped in ("../outside",str(root/"outside"),"alias"):
                with self.subTest(path=escaped),self.assertRaisesRegex(RuntimeError,"escaped"):
                    lab.public_file(directory,dict(ref,path=escaped))
            target.write_bytes(b"changed")
            with self.assertRaisesRegex(RuntimeError,"pin differs"):lab.public_file(directory,ref)

    def test_verifier_requires_successful_final_data_and_both_original_hashes(self):
        # Contract validation only: these dictionaries never count as node/proof evidence.
        tx=dict(abciHash="0x"+"a"*64,nativeHash="0x"+"b"*64)
        answer=dict(code="VERIFIED_TRANSACTION_DATA",result=dict(included=True,finalized=True,executionSuccessful=True,executionCode="0",nativeGrant=False,transactionHash="a"*64,nativeWireHash="b"*64))
        lab.require_verified(answer,tx)
        for key,value in (("included",False),("finalized",False),("executionSuccessful",False),("executionCode","1"),("nativeGrant",True),("nativeGrant",None),("transactionHash","c"*64),("nativeWireHash","c"*64)):
            changed=copy.deepcopy(answer);changed["result"][key]=value
            with self.subTest(key=key,value=value),self.assertRaises(RuntimeError):lab.require_verified(changed,tx)
        with self.assertRaises(RuntimeError):lab.require_verified(dict(answer,code="ACK"),tx)

    def test_original_abci_info_bytes_and_header_hash_are_not_conflated(self):
        raw=bytes(range(32))
        self.assertEqual(lab.decoded_hash(raw.hex().upper()),raw.hex())
        self.assertEqual(lab.decoded_hash(base64.b64encode(raw).decode()),raw.hex())
        with self.assertRaises(RuntimeError):lab.decoded_hash(base64.b64encode(b"short").decode())

    def test_fd_command_carries_only_descriptor_number_and_original_argv(self):
        command=["/owned/ynx-comet","start","--pq-recovery-fd","3"]
        wrapped=lab.fd3_command(command,8)
        self.assertEqual(wrapped[-len(command):],command)
        self.assertEqual(wrapped[2],'exec 3<&8; exec 8<&-; exec "$@"')
        self.assertEqual(lab.fd3_command(command,3)[2],'exec 3<&3; exec "$@"')
        with self.assertRaises(RuntimeError):lab.fd3_command(command,2)

    def test_duplicate_or_wrong_hash_is_rejected_before_any_http_or_new_intent(self):
        ceremony=object.__new__(lab.Ceremony);ceremony.attempted=set()
        with self.assertRaisesRegex(RuntimeError,"hash differs"):
            ceremony.post_once("not-dispatched",b"public", "0"*64)
        ceremony.attempted.add(lab.digest(b"public"))
        with self.assertRaisesRegex(RuntimeError,"duplicate broadcast"):
            ceremony.post_once("not-dispatched",b"public",lab.digest(b"public"))

    def test_halt_driver_duplicate_never_posts_or_re_signs(self):
        ceremony=object.__new__(lab.Ceremony);ceremony.attempted={lab.digest(b"public")}
        with self.assertRaisesRegex(RuntimeError,"replay differs"):
            ceremony.halt_post(b"public",lab.digest(b"public"))

    @unittest.skipUnless(sys.platform=="linux","actual inherited FD check requires Linux job; no node result inferred")
    def test_actual_child_receives_synthetic_credential_only_on_fd3(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/".private").mkdir();(root/"public").mkdir()
            credential=root/".private/recovery.raw";credential.write_bytes(bytes(range(32)));credential.chmod(0o600)
            window=lab.lab.Window(Path(__file__).resolve().parents[2],root)
            fd=os.open(credential,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
            try:
                # This process checks private descriptor delivery only. It is
                # not a signer/node, prints no credential and executes no tx.
                command=lab.fd3_command([sys.executable,"-c","import os; assert len(os.read(3,33))==32; os.close(3)"],fd)
                proc=window.launch("fd-delivery",command,pass_fds=(fd,))
            finally:os.close(fd)
            try:self.assertEqual(window.wait(proc),0)
            finally:self.assertTrue(window.stop())


if __name__=="__main__":unittest.main()
