"""New current-input adapter controls; no node/secret/host-state invocation."""
from pathlib import Path
import hashlib
import subprocess
import tempfile
import unittest

SOURCE=Path(__file__).with_name("remote")/"copy-current-native-data-once.sh"
RAW=SOURCE.read_bytes()
FUNCTION=RAW.split(b"# BEGIN YNX_NATIVE_READONLY_FD_COPY\n",1)[1].split(b"# END YNX_NATIVE_READONLY_FD_COPY\n",1)[0]

class CurrentNativeCopyControls(unittest.TestCase):
    def args(self):
        return ["--case-dir","/var/tmp/ynx-pq-current-native-public-control",
                "--source-bytes","690000001","--native-pid","12345","--native-start-ticks","456789",
                "--native-exe-sha256","a"*64,"--owned-unit","ynx-pq-current-native-public-control.service",
                "--confirmed-script-sha256",hashlib.sha256(RAW).hexdigest()]
    def run_script(self,args):
        return subprocess.run(["/bin/bash","--noprofile","--norc",str(SOURCE),*args],
                              text=True,capture_output=True,timeout=5)
    def test_original_held_fd_guard_is_reused_byte_for_byte(self):
        self.assertEqual(len(FUNCTION),3716)
        self.assertEqual(hashlib.sha256(FUNCTION).hexdigest(),"3450a3d3e45f775b60768917f70916ddef6e3e34290d13317a0191b7c1078e5b")
        self.assertNotIn(b"$source.tmp",FUNCTION)
        self.assertIn(b'$(fdidentity 3) == "$source_before"',FUNCTION)
        self.assertIn(b'$source_sha == "$copy_sha"',FUNCTION)
    def test_dynamic_current_bytes_prepare_does_not_export_or_authorize(self):
        result=self.run_script(["--prepare",*self.args()])
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn("sourceBytes=690000001",result.stdout)
        self.assertIn("executionPerformed=false",result.stdout)
        self.assertIn("authoritativeFinalCheckpoint=false exported=false",result.stdout)
        self.assertNotIn("666005578",result.stdout)
    def test_zero_overbound_duplicate_and_fixed_input_substitution_refused(self):
        for value in ("0","0690000001","1073741825"):
            args=self.args();args[args.index("--source-bytes")+1]=value
            with self.subTest(value=value):self.assertNotEqual(self.run_script(["--prepare",*args]).returncode,0)
        for extra in (["--source-bytes","666005578"],["--source","/tmp/other"],["--execute"]):
            with self.subTest(extra=extra):self.assertNotEqual(self.run_script(["--prepare",*self.args(),*extra]).returncode,0)
    def test_refusal_never_writes_into_an_unreserved_existing_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            args=self.args();args[args.index("--case-dir")+1]=tmp
            result=self.run_script(["--prepare",*args])
            self.assertNotEqual(result.returncode,0)
            self.assertEqual(list(Path(tmp).iterdir()),[])
    def test_no_arguments_are_data_only_and_no_source_or_process_is_opened(self):
        result=self.run_script([]);self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn("freshBytesRequired=true",result.stdout)
        self.assertIn("exported=false noAutomaticRetry=true",result.stdout)
    def test_current_adapter_retains_normal_private_execution_constraints(self):
        for text in (b'case_reserved=false',b'case_reserved=true',b'6442450944',b'23622320128',
                     b'17179869184',b'== 2min',b'== 12s',b'== control-group',b'== no',
                     b'Linux-root-protected-worker-required',b'original-current-native-process-changed',
                     b'original-current-native-identity-mismatch',b'existing-case-or-UNKNOWN-retained',
                     b'exact-current-control-source-mismatch',b'authoritativeFinalCheckpoint=false pqActivation=false'):
            self.assertIn(text,RAW)
        self.assertNotIn(b'569890',RAW)
        self.assertNotIn(b'666005578',RAW)
        self.assertNotIn(b'once02',RAW)
        self.assertNotIn(b'systemctl stop',RAW)
        self.assertNotIn(b'--export-consensus-state',RAW)

if __name__=="__main__":unittest.main()
