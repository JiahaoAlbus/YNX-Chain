"""Priority public diagnostic members; never complete-archive or network admission.

Arguments: frozen source packet, existing run capture root, original artifact
metadata JSON, run ID, NEW proof JSON. Reuses original cache and transport.
Do not run concurrently with another reader writing that same cache/capture.
"""
import hashlib
import importlib.util
import json
import os
import signal
import stat
import sys
import time
from pathlib import Path


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


base, destination, artifact_path = map(lambda p: Path(p).absolute(), sys.argv[1:4])
run_id = int(sys.argv[4])
output = Path(sys.argv[5]).absolute()
artifact = json.loads(artifact_path.read_bytes())
head = 'd24e97b8d3373e294a9d7992e07b4ef532bd6dcf'
assert run_id == 40113221553 and artifact['id'] == 12567657516 and artifact['size_in_bytes'] == 98811639
assert artifact['workflow_run']['id'] == run_id and artifact['workflow_run']['head_sha'] == head
reader_path = base / 'frozen-readers/scripts/loadtest/native-stream-artifact.py'
adapter_path = base / 'persistent-original-range-recovery.py'
reader_sha = hashlib.sha256(reader_path.read_bytes()).hexdigest()
assert reader_sha == '302fc2be287d1836471d20985736cfe395d2bce662f1116d9c75c5c2e9d3257e'
assert hashlib.sha256(adapter_path.read_bytes()).hexdigest() == '7164d9a1c9944c300c90009317a76a46bc2a8b44aaeeb395d017ccf7c901bc3b'
core = load('original_priority_core', reader_path)
transport = load('original_priority_transport', adapter_path)
core.need(destination.resolve() == destination, 'capture symlink refused')
signal.signal(signal.SIGALRM, core.recovery_timeout)
signal.setitimer(signal.ITIMER_REAL, 60)
began = time.monotonic()
opener = None
try:
    meta, url = core.original_artifact(artifact['id'], run_id, head, 'network-pair')
    identity = dict(artifactId=meta['id'], name=meta['name'], bytes=meta['size_in_bytes'], runId=run_id, head=head, digestReportedButNotRecomputed=meta.get('digest'))
    opener = transport.PersistentArtifactOpener(url)
    ranges = core.ExactHTTPRanges(url, identity['bytes'], destination.parent / 'range-cache', identity, opener=opener)
    ranges.deadline = began + 60
    archive = core.Archive(core.Blocks(identity['bytes'], ranges.fetch))
    selection = core.Selection('network-pair')
    cases = ('before-native-mm-bounded', 'after-native-mm-grouped')
    names = ('verifier.log', 'native-stream-verifier.json', 'network/transactions-result.json', 'evidence/actual.json', 'abci-0.log', 'abci-1.log', 'abci-2.log', 'abci-3.log')
    wanted = {case + '/' + name for case in cases for name in names} | {'evidence/actual.json'}
    members = []
    for entry in archive.entries():
        relative = selection.select(entry['name'])
        if relative not in wanted:
            continue
        core.need(not stat.S_ISLNK(entry['mode']) and core.integer(entry['size'], 0, core.MAX_MEMBER), 'original member type/size bound')
        core.need(sum(m['bytes'] for m in members) + entry['size'] <= core.MAX_RECOVERED, 'original selected byte cap')
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        core.need(target.parent.resolve() == target.parent, 'capture member symlink refused')
        begin = archive.inspect_member(entry)
        if target.exists() or target.is_symlink():
            member = core.file_identity(target)
            core.need(member['bytes'] == entry['size'] and member['crc32'] == entry['crc'], 'existing original member differs')
            core.need(member == archive.member(entry, core.VerifyOnly(), begin), 'original member SHA differs')
        else:
            partial = target.with_name(target.name + '.recover-partial')
            member = core.recover_partial_member(archive, entry, partial, begin)
            os.link(partial, target)
            partial.unlink()
            fd = os.open(target.parent, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        members.append(dict(path=relative, **member))
    core.need(time.monotonic() - began <= 60, 'original60s deadline')
    proof = dict(schema=1, artifact=identity, originalReaderSHA256=reader_sha, consumerSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), priorityOriginalMembers=members, missingOriginalPriorityMembers=sorted(wanted - {m['path'] for m in members}), networkRangeBytes=ranges.network_bytes, etag=ranges.etag, elapsedSeconds=time.monotonic() - began, completeArchiveRecovery=False, nativePairQualified=False, networkQualified=False, interpretation='Only selected original diagnostic members with original ZIP/CRC/SHA/range/ETag/caps. Does not replace complete original recovery or worker/resource admission.')
    with output.open('x') as handle:
        json.dump(proof, handle, indent=2)
        handle.write('\n')
    print(json.dumps(dict(members=len(members), missing=proof['missingOriginalPriorityMembers'], networkRangeBytes=ranges.network_bytes, proof=str(output))))
finally:
    if opener is not None:
        opener.close()
    signal.setitimer(signal.ITIMER_REAL, 0)
