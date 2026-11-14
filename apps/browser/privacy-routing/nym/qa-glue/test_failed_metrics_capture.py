"""One genuine owned-pipe negative; Python exit28 fixture, NOT curl/network/TLS."""
import argparse,hashlib,json,tempfile,unittest
from pathlib import Path
import mac_cdn_fresh_executor as glue
import current_epoch_directory_bridge as bridge

class OwnedMetricsNegative(unittest.TestCase):
    def test_original_nonzero_cause_survives_metrics_capture_and_io_refusal(self):
        r2=glue.load('metrics_negative_original_r2',glue.R2/'r2_executor.py','330470c332d4cea28d7593c6fb787262b76342196f42c4d0e1db3ad734b0af67')
        guard=glue.load('metrics_negative_owned_guard',glue.O/'run_fullfeature_v4.py','b66d0f7e39649885d38281ad44edec5720e2105dff87f052309779653414cb05')
        class NoNetworkResources:pass
        base=glue.configure(r2,guard,NoNetworkResources,Path('/does-not-execute-runtime'))
        Experiment=bridge.install(base,r2,Path('/does-not-execute-directory'))
        root=Path(tempfile.mkdtemp(prefix='owned-failed-metrics-',dir=glue.PR/'nym-epoch-diagnostic-20261108'))
        exp=Experiment(argparse.Namespace(out=root/'case',port=63781,budget_seconds=45))
        data=dict(response_code=0,ssl_verify_result=0,proxy_used=1,remote_ip='127.0.0.1',time_total=60.01)
        command=['/usr/bin/python3','-c','import sys;sys.stdout.write('+repr(json.dumps(data)+'\n')+');sys.exit(28)']
        try:
            with self.assertRaisesRegex(r2.Failed,'rfc-first-exit-28'):
                exp.run('rfc-first',command,seconds=5)
            self.assertEqual(len(exp.children),1);child=exp.children[0]
            self.assertEqual(child.process.returncode,28);self.assertTrue(child.cleanup_confirmed)
            self.assertTrue(all(child.eof));self.assertTrue(all(child.closed));self.assertEqual(child.custodian.owned(),[])
            path=exp.out/'rfc-first-metrics-observation.json';raw=path.read_bytes();saved=json.loads(raw)
            self.assertEqual(saved['originalPID'],child.pid);self.assertEqual(saved['originalExit'],28)
            self.assertEqual(saved['metrics'],data);self.assertTrue(saved['completeOwnedCapture'])
            self.assertEqual(saved['tlsSuccessProof'],'NO_TLS_SUCCESS_PROOF')
            # A second write must refuse, retain the first observation, and not
            # raise over the request's original exit28 first cause.
            bridge.persist_metrics_observation(exp,r2,'rfc-first')
            self.assertEqual(path.read_bytes(),raw)
            self.assertEqual(exp.metrics_observation_failures[0]['type'],'FileExistsError')
            self.assertIsNone(bridge.fixed_curl_metrics(b'{"response_code":0}'))
            (root/'result.json').write_text(json.dumps(dict(newTests=1,fixture='Python-owned-pipe-not-curl',originalPID=child.pid,originalExit=28,
                originalWaitReaped=True,bothEOF=child.eof,FDClosed=child.closed,remainingOwned=[],networkOrTLS=False,
                rejectedVerify0AsSuccess=True,firstObservationUnchangedSHA256=hashlib.sha256(raw).hexdigest(),NoProductionAuthority=True),indent=2)+'\n')
        finally:exp.log.close()

if __name__=='__main__':unittest.main()
