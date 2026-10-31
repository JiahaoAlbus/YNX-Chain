"""Orchestration controls only. No mock HTTP endpoint is called a validator."""
import base64
import importlib.util
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
