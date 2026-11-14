#!/usr/bin/env python3
"""Compile the actual QA phase recorder; synthetic streams only, no PT/network/profile."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import time
import uuid


PROBE = r'''
import Foundation
@main struct Probe {
    static func main() throws {
        func parsed(_ s: String) -> [String: Any]? { SnowflakeSafePhaseRecorder.classify(Data(s.utf8)) }
        let exact = [
            ("Negotiating via HTTP rendezvous...", "brokerHTTPAttempt"),
            ("Received Answer.", "brokerAnswerParsed"),
            ("WebRTC: DataChannel.OnOpen", "dataChannelOpen"),
            ("WebRTC: timeout waiting for DataChannel.OnOpen  Retrying...", "dataChannelOpenTimeout"),
            ("WebRTC: DataChannel created", "dataChannelCreated"),
            ("WebRTC: Created offer", "ICEOfferCreated"),
            ("WebRTC: Set local description", "localDescriptionSet"),
            ("WebRTC: DataChannel.OnClose", "dataChannelClosed"),
            ("WebRTC: Closing", "peerClosing"),
            ("ConnectLoop: stopped.", "connectLoopStopped")]
        for (input, phase) in exact { precondition(parsed(input)?["phase"] as? String == phase) }
        precondition(parsed("HTTP rendezvous response: 403 Forbidden")?["statusCode"] as? Int == 403)
        precondition(parsed("NAT Type: unknown")?["NATCategory"] as? String == "unknown")
        let prefixes = ["Warning: NAT checking failed for server at ", "Error resolving address: ",
            "WebRTC: Unable to SetRemoteDescription:", "CovertDTLS ERROR: ", "NewPeerConnection ERROR: ",
            "CreateDataChannel ERROR: ", "Failed to prepare offer ", "Failed to apply offer "]
        let secret = "192.0.2.4:3478 [2001:db8::4] private.example https://name:secret@example.invalid/?nonce=identity /Users/private cert=longtoken SDP candidate:private"
        for prefix in prefixes {
            let d = parsed(prefix + secret)!
            let encoded = try JSONSerialization.data(withJSONObject: d)
            let output = String(decoding: encoded, as: UTF8.self)
            for token in secret.split(separator: " ") { precondition(!output.contains(token)) }
            precondition(d["errorDetail"] as? String == "omitted")
        }
        let wrapped = "2026-11-07T13:43:39Z INFO tor_ptmgr::ipc::sealed: [pt /private/secret] 2026/11/07 13:43:39 HTTP rendezvous response: 200 OK"
        precondition(parsed(wrapped)?["phase"] as? String == "brokerHTTPResponse")
        precondition(parsed(wrapped)?["envelope"] as? String == "arti-pt-log")
        let negative = ["Received answer: SDP-secret", "Target URL: private.example", "Front URL: private.example",
            "url: stun:private.example:3478", "WebRTC: arbitrary identity Retrying...", "NAT Type: private.example",
            "HTTP rendezvous response: 999 mystery", "HTTP rendezvous response: 200 secret.example",
            "\u{1b}[32mReceived Answer.", "Received Answer.\nSDP-secret", "forged Received Answer.",
            "2026-11-07T13:43:39Z INFO other::module: [pt x] Received Answer.",
            "Received Answer. trailing", "WebRTC: DTLS connected to private.example"]
        for text in negative { precondition(parsed(text) == nil) }
        precondition(SnowflakeSafePhaseRecorder.classify(Data([0xff, 0xfe])) == nil)
        var split = SnowflakeSafePhaseRecorder(began: 1)
        precondition(split.consume(Data("Received An".utf8), at: 2).isEmpty)
        precondition(split.consume(Data("swer.\r\n".utf8), at: 3).first?["phase"] as? String == "brokerAnswerParsed")
        var long = SnowflakeSafePhaseRecorder(began: 1)
        precondition(long.consume(Data(repeating: 65, count: 20000), at: 2).isEmpty)
        precondition(long.consume(Data("\nReceived Answer.\n".utf8), at: 3).count == 1)
        precondition(long.omittedLines == 1)
        var capped = SnowflakeSafePhaseRecorder(began: 1)
        _ = capped.consume(Data(repeating: 65, count: SnowflakeSafePhaseRecorder.byteLimit + 1), at: 2)
        precondition(capped.inputBytes == SnowflakeSafePhaseRecorder.byteLimit && capped.truncated)
        var events = SnowflakeSafePhaseRecorder(began: 1)
        let emitted = events.consume(Data(String(repeating: "Received Answer.\n", count: 300).utf8), at: 2)
        precondition(emitted.count == 256 && events.truncated)
        var lines = SnowflakeSafePhaseRecorder(began: 1)
        _ = lines.consume(Data(String(repeating: "?\n", count: 8200).utf8), at: 2)
        precondition(lines.completeLines == 8192 && lines.truncated)
        var expired = SnowflakeSafePhaseRecorder(began: 1)
        precondition(expired.consume(Data("Received Answer.\n".utf8), at: 650_000_000_002).isEmpty && expired.truncated)
        // Unlike the old first-512 diagnostic stream, irrelevant lines cannot consume the phase
        // event allowance. This exercises a late actual fixed marker after 600 unknown lines.
        var late = SnowflakeSafePhaseRecorder(began: 1)
        let lateEvents = late.consume(Data((String(repeating: "unknown secret\n", count: 600) + "HTTP rendezvous response: 503 Service Unavailable\n").utf8), at: 2)
        precondition(lateEvents.count == 1 && lateEvents[0]["statusCode"] as? Int == 503 && !late.truncated)
        print("{\"status\":\"PASS\",\"groups\":12,\"exactMarkers\":10,\"dynamicTailCases\":8,\"negativeCases\":15,\"livePTEmission\":\"NOT_RUN\"}")
    }
}
'''


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--exact-snowflake-source', type=Path)
    p.add_argument('--synthetic-only', action='store_true', help='Run actual recorder with synthetic streams; official source provenance explicitly NOT_RUN')
    p.add_argument('--provenance-only', action='store_true', help='Check provided exact source constants/hashes without compiling or rerunning synthetic streams')
    p.add_argument('--output', required=True, type=Path)
    a = p.parse_args(); out = a.output.resolve(); out.mkdir(parents=True, mode=0o700, exist_ok=False)
    if a.synthetic_only == bool(a.exact_snowflake_source) or (a.provenance_only and not a.exact_snowflake_source):
        p.error('choose --synthetic-only OR --exact-snowflake-source; provenance-only requires actual source')
    source = a.exact_snowflake_source.resolve() if a.exact_snowflake_source else None
    expected = {
        'client/lib/rendezvous_http.go': ['Negotiating via HTTP rendezvous...', 'HTTP rendezvous response: %s'],
        'client/lib/webrtc.go': ['Received Answer.', 'WebRTC: DataChannel.OnOpen', 'timeout waiting for DataChannel.OnOpen', 'CovertDTLS ERROR: %s'],
        'client/lib/snowflake.go': ['Warning: NAT checking failed for server at %s: %s', 'WebRTC: %v  Retrying...'],
        'client/lib/rendezvous.go': ['NAT Type: %s'],
        'common/nat/nat.go': ['Error resolving address: %s']}
    source_pins = {}
    for name, constants in expected.items() if source else []:
        f = source/name; raw = f.read_bytes(); text = raw.decode()
        assert all(s in text for s in constants), 'exact source marker mismatch: ' + name
        source_pins[str(f)] = hashlib.sha256(raw).hexdigest()
    if a.provenance_only:
        result = dict(status='PASS', officialMarkerProvenance='PROVIDED_SOURCE_CONSTANTS_AND_HASHES_CHECKED', sourcePins=source_pins, syntheticStreams='NOT_RUN', network='NOT_RUN')
        (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n'); print(json.dumps(result,indent=2)); return
    helper = Path(__file__).with_name('SnowflakeSafePhaseRecorder.swift')
    (out/'Recorder.swift').write_bytes(helper.read_bytes()); (out/'Probe.swift').write_text(PROBE)
    temporary = out/'tmp'; temporary.mkdir(mode=0o700)
    alias = Path('/private/tmp')/('p05-sf-phase-'+uuid.uuid4().hex[:12]); alias.symlink_to(temporary, target_is_directory=True)
    link_info = alias.lstat(); target_info = temporary.stat()
    environment = dict(os.environ, TMPDIR=str(alias)+'/')
    sdk = subprocess.check_output(['/usr/bin/xcrun','--show-sdk-path'], text=True).strip()
    base = ['/usr/bin/xcrun','swiftc','-swift-version','6','-target',platform.machine()+'-apple-macosx14.0','-sdk',sdk,'-j','1','-module-cache-path',str(out/'module-cache')]
    processes = []; failure = None
    try:
        for name, argv, timeout in [
            ('normal-no-QA', base+['-typecheck',str(out/'Recorder.swift')], 30),
            ('QA-compile', base+['-DYNX_PRIVACY_ACCEPTANCE','-parse-as-library',str(out/'Recorder.swift'),str(out/'Probe.swift'),'-o',str(out/'Probe')],45),
            ('synthetic-streams', [str(out/'Probe')],5)]:
            started=time.monotonic(); child=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=environment,start_new_session=True)
            timed_out=False
            try: stdout,stderr=child.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                timed_out=True; child.terminate()
                try: stdout,stderr=child.communicate(timeout=2)
                except subprocess.TimeoutExpired: child.kill(); stdout,stderr=child.communicate(timeout=2)
            (out/(name+'.stdout')).write_bytes(stdout);(out/(name+'.stderr')).write_bytes(stderr)
            processes.append(dict(name=name,pid=child.pid,returncode=child.returncode,reaped=child.poll() is not None,timedOut=timed_out,seconds=time.monotonic()-started,argv=argv))
            if child.returncode or timed_out: failure=name;break
    finally:
        assert alias.is_symlink() and alias.lstat().st_ino==link_info.st_ino and alias.resolve()==temporary and temporary.stat().st_ino==target_info.st_ino
        alias.unlink()
    result=dict(status='FAIL' if failure else 'PASS',firstCause=failure,sourcePins=source_pins,officialMarkerProvenance='PROVIDED_SOURCE_CONSTANTS_AND_HASHES_CHECKED' if source else 'NOT_RUN; synthetic streams only, no official source substituted',recorderSHA256=hashlib.sha256(helper.read_bytes()).hexdigest(),driverSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),processes=processes,ownAliasRemoved=not alias.exists(),liveFixedPTEmission='NOT_RUN',RootOrQualification='NOT_RUN',network='NOT_RUN',old512LineCapture='unchanged; previous evidence preserved; phase parser has separate limits')
    (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));raise SystemExit(1 if failure else 0)


if __name__ == '__main__': main()
