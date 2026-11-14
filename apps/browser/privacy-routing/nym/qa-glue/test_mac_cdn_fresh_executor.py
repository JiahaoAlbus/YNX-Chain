"""New glue DATA controls and genuine owned pipes; no vendor/init/network."""
import argparse
import copy
import datetime as dt
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

import mac_cdn_fresh_executor as glue
from qa_directory_capture import ParsedDirectoryData
from test_qa_directory_capture import sample


class GlueControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(tempfile.mkdtemp(prefix='qa-glue-controls-', dir=glue.O))
        cls.r2 = glue.load('controls_original_r2', glue.R2/'r2_executor.py',
                           '330470c332d4cea28d7593c6fb787262b76342196f42c4d0e1db3ad734b0af67')
        guard = glue.load('controls_owned_groups', glue.O/'run_fullfeature_v4.py',
                         'b66d0f7e39649885d38281ad44edec5720e2105dff87f052309779653414cb05')
        class NoNetwork:
            pass
        cls.experiment_type = glue.configure(cls.r2, guard, NoNetwork, Path('/usr/bin/python3'))

    def experiment(self):
        path = self.root/('case-'+str(time.monotonic_ns()))
        result = self.experiment_type(argparse.Namespace(out=path, port=63781, budget_seconds=900))
        self.addCleanup(result.log.close)
        return result

    def test_fresh_profile_contract_and_home_unchanged(self):
        exp = self.experiment()
        self.assertEqual(glue.fresh_profile_id(exp.profileID), exp.profileID)
        self.assertEqual(len(exp.profileID), 54)
        self.assertEqual(exp.environment.get('HOME'), os.environ.get('HOME'))
        self.assertEqual(exp.environment['NYM_HOME_DIR'], str(exp.home))
        for bad in ['ynx-route-r2-'+'a'*32, exp.profileID.upper(), '../'+exp.profileID]:
            with self.assertRaises(ValueError): glue.fresh_profile_id(bad)
        self.assertFalse((exp.out/'init-intent-UNKNOWN.json').exists())
        self.assertEqual(exp.children, [])

    def test_sensitive_multiline_is_dropped_before_any_capture_or_hash(self):
        safe = glue.SafeLines()
        source = [b'public one', b'-----BEGIN PRIVATE KEY-----', b'secret body',
                  b'-----END PRIVATE KEY-----', b'PRIVATE_KEY=secret', b'public two']
        self.assertEqual([x for x in map(safe.accept, source) if x is not None], [b'public one', b'public two'])

    def test_original_owned_pipe_wait_eof_and_sensitive_output(self):
        exp = self.experiment()
        command = ['/usr/bin/python3', '-c', "import sys;sys.stdout.write('{\\n\"public\":true\\n}\\n');sys.stderr.write('-----BEGIN PRIVATE KEY-----\\nsecret-body\\n-----END PRIVATE KEY-----\\n')"]
        child = self.r2.Child(exp, 'owned-pipe', command, 65536)
        child.process.wait(timeout=5)
        self.assertEqual(exp.stop_child(child), 0)
        self.assertTrue(child.cleanup_confirmed)
        self.assertTrue(all(child.eof)); self.assertTrue(all(child.closed))
        self.assertEqual(bytes(child.data), b'{\n"public":true\n}\n')
        self.assertNotIn('secret', str(child.receipt()))
        self.assertEqual(child.custodian.owned(), [])

    def test_post_popen_thread_failure_retains_and_reaps_exact_child(self):
        exp = self.experiment()
        with patch('threading.Thread.start', side_effect=RuntimeError('controlled-setup-failure')):
            with self.assertRaisesRegex(RuntimeError, 'controlled-setup-failure'):
                self.r2.Child(exp, 'partial-setup', ['/usr/bin/python3', '-c', 'import time;time.sleep(30)'], 1024)
        self.assertEqual(len(exp.children), 1)
        child = exp.children[0]
        with self.assertRaisesRegex(self.r2.Failed, 'owned-output-not-complete'):
            exp.stop_child(child)
        self.assertIsNotNone(child.process.returncode)
        self.assertTrue(child.cleanup_confirmed); self.assertTrue(all(child.closed))
        self.assertFalse(all(child.eof))
        self.assertEqual(child.custodian.owned(), [])

    def table(self):
        body = sample(); now = dt.datetime.now(dt.timezone.utc)
        body['epoch'] = dict(current_epoch_start=(now-dt.timedelta(seconds=60)).isoformat(),
                             epoch_length=dict(secs=3600, nanos=0), total_elapsed_epochs=42)
        body['basic']['metadata'] = dict(status=None, absolute_epoch_id=42,
                                        refreshed_at=now.strftime('%Y-%m-%d %H:%M:%S.%f +00:00'))
        for node in body['basic']['nodes']['data']:
            node['performance'] = '0.5'
        invalid = copy.deepcopy(body['basic']['nodes']['data'][0])
        invalid.update(node_id=3, ed25519_identity_pubkey='ineligible-public', performance='1.0')
        body['basic']['nodes']['data'].append(invalid)
        body['basic']['nodes']['pagination'] = dict(page=0, total=3, size=3)
        return body

    def test_typed_membership_precedes_rank_and_raw_rows_unchanged(self):
        exp = self.experiment(); body = self.table(); before = copy.deepcopy(body)
        exp.parsed[id(body)] = ParsedDirectoryData(body, '0'*64, (1,), (2,))
        exp.capture_deadlines[id(body)] = (time.time()+10, time.monotonic_ns()+10_000_000_000)
        selected = exp.select(body, ['1'*64, '2'*64, '3'*64])
        self.assertEqual(selected['entryID'], 1)
        self.assertEqual(selected['requesterID'], 2)
        self.assertEqual(body, before)
        self.assertEqual(len(body['basic']['nodes']['data']), 3)

    def test_no_disk_data_or_previous_pair_rotation(self):
        exp = self.experiment(); body = self.table()
        with self.assertRaisesRegex(self.r2.Failed, 'selection-not-same-owned-capture'):
            exp.select(body, ['0'*64]*3)
        exp.parsed[id(body)] = ParsedDirectoryData(body, '0'*64, (1,), (2,))
        exp.capture_deadlines[id(body)] = (time.time()+10, time.monotonic_ns()+10_000_000_000)
        with self.assertRaisesRegex(self.r2.Failed, 'no-current-same-typed-role-pair'):
            exp.select(body, ['0'*64]*3, dict(entryIdentity='other', requester='other'))

    def test_capture_cannot_be_restamped_at_selection(self):
        exp = self.experiment(); body = self.table()
        exp.parsed[id(body)] = ParsedDirectoryData(body, '0'*64, (1,), (2,))
        exp.capture_deadlines[id(body)] = (time.time()-1, time.monotonic_ns()+10_000_000_000)
        with self.assertRaisesRegex(self.r2.Failed, 'selection-capture-expired-no-restamp'):
            exp.select(body, ['0'*64]*3)

    def test_system_curl_sized_metrics_line_preserved_with_operation_cap(self):
        exp = self.experiment()
        child = self.r2.Child(exp, 'metrics-line', ['/usr/bin/python3', '-c',
                              "import sys;sys.stdout.write('{\"publicMetrics\":\"'+'x'*9500+'\"}\\n')"], 65536)
        child.process.wait(timeout=5); self.assertEqual(exp.stop_child(child), 0)
        self.assertFalse(child.overflow)
        self.assertGreater(len(child.data), 8192)
        self.assertEqual(bytes(child.data).count(b'x'), 9500)

    def test_metrics_line_cannot_escape_operation_byte_cap(self):
        exp = self.experiment()
        child = self.r2.Child(exp, 'metrics-oversize', ['/usr/bin/python3', '-c',
                              "import sys;sys.stdout.write('x'*2000+'\\n')"], 1024)
        child.process.wait(timeout=5); self.assertEqual(exp.stop_child(child), 0)
        self.assertTrue(child.overflow)
        self.assertLessEqual(len(child.data), 1024)

    def test_only_fixed_directory_cause_vocabulary_can_persist(self):
        self.assertEqual(glue.fixed_directory_errors(
            b'An error occurred: qa-cdn-headers-timeout\n',
            b'https://untrusted.invalid/secret?private=abc PolicyExpired repeated PolicyExpired'),
            ['PolicyExpired', 'qa-cdn-headers-timeout'])
        self.assertEqual(glue.fixed_directory_errors(b'arbitrary error message', b'private_key=not-captured'), [])


if __name__ == '__main__':
    unittest.main()
