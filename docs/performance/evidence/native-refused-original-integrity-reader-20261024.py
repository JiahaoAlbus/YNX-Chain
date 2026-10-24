"""Zero-network original public integrity audit for refused run40101270671.

Arguments: original frozen source packet, run capture root, original artifact
API JSON, NEW proof JSON. Run exclusively after any original cache writer ends.
Full integrity never promotes the original failed worker/resource admission.
"""
import hashlib
import importlib.util
import json
import signal
import sys
from pathlib import Path

base, capture, artifact_path, output = map(lambda p: Path(p).absolute(), sys.argv[1:5])
reader = base / 'frozen-readers/scripts/loadtest/native-stream-artifact.py'
reader_sha = hashlib.sha256(reader.read_bytes()).hexdigest()
assert reader_sha == '653420615d9540352376f2cf25dab2aabbb06b70d0af72ab44466b00646f560d'
artifact = json.loads(artifact_path.read_bytes())
assert artifact['id'] == 12563147355 and artifact['size_in_bytes'] == 99518524
assert artifact['workflow_run']['id'] == 40101270671 and artifact['workflow_run']['head_sha'] == '1f21f1f2eed732c0948ac98ff7028bee5f2d6ca4'
identity = dict(artifactId=artifact['id'], name=artifact['name'], bytes=artifact['size_in_bytes'], runId=40101270671, head=artifact['workflow_run']['head_sha'], digestReportedButNotRecomputed=artifact.get('digest'))
spec = importlib.util.spec_from_file_location('original_refused_integrity_core', reader)
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)


class NoNetwork:
    def open(self, *args, **kwargs):
        raise RuntimeError('original retained range missing; no network request permitted')


signal.signal(signal.SIGALRM, core.recovery_timeout)
signal.setitimer(signal.ITIMER_REAL, 60)
try:
    ranges = core.ExactHTTPRanges('https://artifact.blob.core.windows.net/original-no-network', identity['bytes'], capture.parent / 'range-cache', identity, opener=NoNetwork())
    integrity = core.recover(core.Blocks(identity['bytes'], ranges.fetch), capture, 'network-pair')
    assert ranges.network_bytes == 0
    try:
        original_check = core.verify_capture(capture, 'network-pair', identity['head'])
    except Exception as error:
        original_check = dict(passed=False, firstCause=str(error) or type(error).__name__)
    else:
        # Do not promote a posthoc readback over the original failed job.
        original_check = dict(passed=True, result=original_check, originalJobStillFailed=True)
    result = dict(schema=1, artifact=identity, originalReaderSHA256=reader_sha, consumerSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), fullOriginalPublicIntegrityVerified=True, originalMemberIntegrity=integrity, networkRangeBytes=0, originalCompleteReadback=original_check, nativePairQualified=False, sustainedTPSQualified=False, interpretation='Complete selected original public ZIP names/sizes/CRC/SHA and manifest, using original retained ranges and unchanged frozen reader only. Integrity is separate from original resource/worker admission; original run40101270671 remains refused.')
    with output.open('x') as handle:
        json.dump(result, handle, indent=2)
        handle.write('\n')
    print(json.dumps(dict(fullOriginalPublicIntegrityVerified=True, members=integrity['members'], bytes=integrity['bytes'], networkRangeBytes=0, nativePairQualified=False, originalReadbackPassed=original_check['passed'])))
finally:
    signal.setitimer(signal.ITIMER_REAL, 0)
