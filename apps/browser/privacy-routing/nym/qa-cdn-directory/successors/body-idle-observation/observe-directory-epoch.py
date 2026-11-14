"""Preserve an allowlisted epoch diagnostic from a complete, owned terminal capture."""
import json
import importlib.util
import sys

PREFIX = b'YNX_NYM_QA_EPOCH_DIAGNOSTIC_V1 '

PINNED_PARSERS = {
    'qa_directory_capture': '57e5a9e0542654b81faf20fa32f94840ff81186ac28e1b847c86bcd18a8659fc',
    'mac_cdn_fresh_executor': '8a9e3955d5481efbf3a25b6b70b75ad0edb8a109b73007e83b1cd077f639c8f8',
    'current_epoch_directory_bridge': '9bb52b82961ade4f1b7535ea1dd848b4561dacdcd197d20b569e001141c07a96',
}


def pinned_parser(runner):
    for name, digest in PINNED_PARSERS.items():
        path = runner.GLUE / (name + '.py')
        runner.check_pin(path, digest)
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return module.public_epoch_summary


class TerminalDiagnostics:
    def __init__(self, body_observer, parse_epoch):
        self.body_observer = body_observer
        self.parse_epoch = parse_epoch
        self.epoch = None

    def public_body_failure(self, stderr, run_id, fixed_errors, *, terminal_capture_complete):
        self.epoch = self._from_terminal(stderr, fixed_errors, terminal_capture_complete)
        return self.body_observer.public_body_failure(
            stderr, run_id, fixed_errors, terminal_capture_complete=terminal_capture_complete)

    def _from_terminal(self, stderr, fixed_errors, complete):
        if complete is not True or not isinstance(stderr, bytes) or len(stderr) > 524288:
            return None
        frames = [line[len(PREFIX):] for line in stderr.split(b'\n')[:-1] if line.startswith(PREFIX)]
        if len(frames) != 1 or not 0 < len(frames[0]) <= 4096:
            return None
        fields = self.parse_epoch(frames[0])
        if fields is None:
            return None
        legacy = json.loads(frames[0])['legacyError']
        if legacy not in fixed_errors:
            return None
        return fields

    def persist(self, case, sha, save):
        receipt = case / 'once-fresh-directory/receipt.json'
        if self.epoch is None or not receipt.is_file():
            return None
        terminal = json.loads(receipt.read_text())
        if (terminal['capturedEOF'] != ['stderr', 'stdout'] or terminal['FDClosed'] is not True
                or terminal['remainingOwned'] or terminal['cleanupFailure']
                or terminal['childOutcomeRecordingFailure'] or len(terminal['processes']) != 1):
            return None
        child = terminal['processes'][0]
        if child['reaped'] is not True or child['exit'] == 0:
            return None
        dest = case / 'EPOCH_OBSERVATION.json'
        save(dest, {'schema': 'P05_NYM_OWNED_EPOCH_OBSERVATION_V1', 'originalReceiptSHA256': sha(receipt),
                    'scopeSHA256': terminal['scopeSHA256'], 'binarySHA256': terminal['binarySHA256'],
                    'originalPID': child['pid'], 'originalWait': child['exit'], 'publicEpoch': self.epoch})
        return dest
