#!/usr/bin/env python3
"""Actual Nym readBounded excerpt with owned pipes and suspended poll; no vendor/authority."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import tempfile

def block(source, signature):
    start = source.index(signature)
    opening = source.index('{', start)
    depth, end = 1, opening + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]

MOCKS = r'''
enum LeasePhase { case blocked, lost }
struct MockLease { let phase: LeasePhase }
@MainActor final class MockProtection {
    var live = true
    var bootstrapControlLease: MockLease { get throws {
        guard live else { throw NymProtectedFailure.controlLeaseLost }
        return .init(phase: .blocked)
    } }
}
@MainActor final class OwnedBackendStartGate {
    let backendOutput: FileHandle
    var pending: CheckedContinuation<Void, Never>?
    var calls = 0
    init(fd: Int32) { backendOutput = FileHandle(fileDescriptor: fd, closeOnDealloc: false) }
    func poll() async throws -> Int? {
        calls += 1
        if calls == 1 { await withCheckedContinuation { pending = $0 } }
        return nil
    }
}
@MainActor final class Subject {
    let protection: MockProtection? = MockProtection()
    var vendor: OwnedBackendStartGate?
    var generation = UUID()
    var selectionDeadline = Date().addingTimeInterval(60)
    let operationStage = NymProtectedStage.proof
    func require(_ expected: UUID) throws {
        try Task.checkCancellation()
        guard generation == expected else { throw NymProtectedFailure.cancelled }
        guard Date() < selectionDeadline else { throw NymProtectedFailure.staleNumericPlan }
    }
    METHOD
    func run(_ gate: OwnedBackendStartGate, consume: (Data) -> Bool) async -> String {
        vendor = gate
        do { try await readBounded(gate, limit: 128, seconds: 1, expected: generation, consume: consume); return "completed" }
        catch let failure as NymProtectedFailure { return failure.rawValue }
        catch { return String(describing: type(of: error)) }
    }
}
@main struct Main {
    @MainActor static func main() async throws {
        var records: [[String: Any]] = []
        for scenario in ["generation", "lease", "descriptor", "selection", "deadline", "unchanged"] {
            var first: [Int32] = [0, 0]
            precondition(pipe(&first) == 0)
            let originalFD = first[0]
            let gate = OwnedBackendStartGate(fd: originalFD), subject = Subject()
            var consumed = 0
            let task = Task { @MainActor in await subject.run(gate) { bytes in
                consumed += bytes.count; return true
            } }
            while gate.pending == nil { await Task.yield() }
            if scenario == "generation" { subject.generation = UUID() }
            if scenario == "lease" { subject.protection!.live = false }
            if scenario == "selection" { subject.selectionDeadline = .distantPast }
            if scenario == "deadline" { try await Task.sleep(for: .milliseconds(1100)) }
            var writeFD = first[1]
            if ["descriptor", "generation", "lease"].contains(scenario) {
                // Keep the first pipe open while allocating the second, ensuring a distinct
                // underlying inode. Then deliberately reuse the captured descriptor number.
                var second: [Int32] = [0, 0]; precondition(pipe(&second) == 0)
                precondition(close(first[0]) == 0 && close(first[1]) == 0)
                precondition(dup2(second[0], originalFD) == originalFD)
                close(second[0]); writeFD = second[1]
            }
            let bytes = Array("owned replacement bytes".utf8)
            precondition(write(writeFD, bytes, bytes.count) == bytes.count)
            gate.pending!.resume(); gate.pending = nil
            let outcome = await task.value
            close(originalFD); close(writeFD)
            records.append(["scenario": scenario, "outcome": outcome, "consumed": consumed])
        }
        let data = try JSONSerialization.data(withJSONObject: records, options: [.sortedKeys])
        print(String(decoding: data, as: UTF8.self))
    }
}
'''

def sha(data):
    return hashlib.sha256(data).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--before-source', type=Path,
                        default=Path(__file__).with_name('NymReadBoundedBefore.fixture.swift'))
    args = parser.parse_args()
    assert args.output.is_absolute() and not args.output.exists()
    args.output.mkdir(mode=0o700, parents=True)
    native = Path(__file__).resolve().parents[3]/'native/Sources/YNXBrowserNative/NymProtectedRouteProvider.swift'
    snapshots = {'before': args.before_source.read_bytes(), 'after': native.read_bytes()}
    sdk = subprocess.check_output(['xcodebuild', '-version', '-sdk', 'macosx', 'Path'], text=True).strip()
    reports = {}
    with tempfile.TemporaryDirectory(prefix='ynx-nym-postawait.', dir='/tmp') as alias:
        (args.output/'tmp').mkdir()
        os.symlink(args.output/'tmp', Path(alias)/'tmp')
        env = dict(os.environ, TMPDIR=str(Path(alias)/'tmp')+'/')
        for label, data in snapshots.items():
            source = data.decode()
            declarations = [block(source, 'enum NymProtectedFailure:'), block(source, 'enum NymProtectedStage:')]
            if 'struct NymOwnedOutputIdentity {' in source:
                declarations.append(block(source, 'struct NymOwnedOutputIdentity {'))
            fixture = 'import Foundation\nimport Darwin\n'+'\n'.join(declarations)+'\n'
            fixture += MOCKS.replace('METHOD', block(source, 'private func readBounded('))
            path = args.output/(label+'.swift'); path.write_text(fixture)
            command = ['swiftc', '-j', '1', '-sdk', sdk, '-target', platform.machine()+'-apple-macosx14.0',
                       '-module-cache-path', str(args.output/'module-cache'), '-swift-version', '6', '-parse-as-library',
                       str(path), '-o', str(args.output/label)]
            result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=60)
            (args.output/(label+'-compile.log')).write_text(result.stdout+result.stderr)
            result.check_returncode()
            result = subprocess.run([str(args.output/label)], capture_output=True, text=True, timeout=8)
            (args.output/(label+'-runtime.log')).write_text(result.stdout+result.stderr)
            result.check_returncode()
            reports[label] = json.loads(result.stdout)
    for row in reports['before']:
        assert row['outcome'] == 'completed' and row['consumed'] > 0, row
    expected = {'generation': 'cancelled', 'lease': 'controlLeaseLost', 'descriptor': 'backendExited',
                'selection': 'staleNumericPlan', 'deadline': 'proofTimedOut', 'unchanged': 'completed'}
    for row in reports['after']:
        assert row['outcome'] == expected[row['scenario']], row
        assert (row['consumed'] > 0) == (row['scenario'] == 'unchanged'), row
    source = snapshots['after'].decode()
    status = block(source, 'func status() async')
    aux = block(source, 'func auxiliaryOperation(')
    read = block(source, 'private func readBounded(')
    checks = {
        'statusExpiryAfterLastPoll': status.index('Date() < selectionDeadline', status.index('try await proofGate.poll()')) > 0,
        'auxCancellationBeforePostPollDrain': aux.index('try requireAuxiliary(expected)', aux.index('if let exit = try await gate.poll()')) < aux.index('try drain()', aux.index('if let exit = try await gate.poll()')),
        'auxIdentityCheckedBeforeEveryRead': 'try outputIdentity.requireCurrent()' in aux[aux.index('func drain()'):],
        'readGenerationThenLeaseThenIdentityAfterAwait': read.index('try require(expected)', read.index('try await vendor.poll()')) < read.index('try outputIdentity.requireCurrent()'),
        'productionAdmissionNotChanged': 'try owner.requireBackendStartupQualification(mode: .nym)' in source,
    }
    assert all(checks.values()), checks
    assert native.read_bytes() == snapshots['after'], 'Mutable source changed during delta'
    receipt = {'schema': 'P05_NYM_POSTAWAIT_OUTPUT_DELTA_V1', 'sourceSHA256': {k: sha(v) for k, v in snapshots.items()},
               'actualMethodControlledScenarios': reports, 'wiringChecks': checks,
               'privacyAuthorityOrVendorOrPublicNetwork': 'NOT_RUN', 'sourceOnlyBuild25Unchanged': True}
    (args.output/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print(json.dumps({'receipt': str(args.output/'receipt.json'), 'newRuntimeScenarios': 6, 'wiringChecks': len(checks)}))

if __name__ == '__main__':
    main()
