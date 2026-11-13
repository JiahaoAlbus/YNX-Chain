"""Original Core live-materials session frames for an isolated proof lane."""
import json
import re


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def hash256(value):
    return type(value) is str and re.fullmatch('[0-9a-f]{64}', value)


def command(operation, sequence, *, transaction_file='', transaction_sha256='', native_wire_hash=''):
    require(type(sequence) is int and 0 < sequence <= 10000,
            'bounded original live sequence required')
    if operation == 'request':
        require(type(transaction_file) is str and transaction_file.startswith('/')
                and hash256(transaction_sha256) and hash256(native_wire_hash),
                'original live request requires transaction path and both hashes')
    else:
        require(operation == 'result' and (transaction_file, transaction_sha256, native_wire_hash) == ('', '', ''),
                'original live result command cannot replace the transaction')
    frame = dict(version='YNX-PQ-LAB-LIVE-MATERIALS-COMMAND/v1', operation=operation,
                 sequence=str(sequence), transactionFile=transaction_file,
                 transactionSHA256=transaction_sha256, nativeWireHash=native_wire_hash)
    # Go compares the exact json.Marshal form, including its HTML escaping.
    raw = json.dumps(frame, separators=(',', ':'), ensure_ascii=False)
    for char, escape in (('&', r'\u0026'), ('<', r'\u003c'), ('>', r'\u003e'),
                         ('\u2028', r'\u2028'), ('\u2029', r'\u2029')):
        raw = raw.replace(char, escape)
    data = raw.encode('utf-8') + b'\n'
    require(len(data) < 32 << 10, 'original live command exceeds Go scanner bound')
    return data


def session_stats(stats, policy_sha256, node, max_operations, commands):
    require(type(stats) is dict and set(stats) == {
        'policySHA256', 'nodeIndex', 'maxOperations', 'commands', 'commandLimit', 'retired', 'closed'
    } and stats['policySHA256'] == policy_sha256
        and all(type(stats[key]) is int and stats[key] == expected for key, expected in (
            ('nodeIndex', node), ('maxOperations', max_operations), ('commands', commands),
            ('commandLimit', 4 * max_operations + 16)))
        and stats['retired'] is False and stats['closed'] is False,
        'original live session identity or command accounting differs')


class OriginalRefusal(RuntimeError):
    def __init__(self, failure_class):
        self.failure_class = failure_class
        super().__init__(f"original live session {failure_class}; preserve original without retry")


class Lane:
    """Operate a single already-opened Core lane. Its caller owns process cleanup."""
    def __init__(self, stdin, receive, ready, *, policy_sha256, node, max_operations):
        require(hash256(policy_sha256) and type(node) is int and 0 <= node < 4
                and type(max_operations) is int and 0 < max_operations <= 10000,
                'original live policy identity required')
        require(type(ready) is dict and ready.get('version') == 'YNX-PQ-LAB-LIVE-MATERIALS-READY/v1'
                and ready.get('status') == 'original_static_source_and_anchor_held'
                and type(ready.get('startupElapsedNs')) is int and 0 <= ready['startupElapsedNs'] < 1 << 63
                and ready.get('syntheticOnly') is True and ready.get('authorityGranted') is False
                and ready.get('currentCheckpointClaim') is False,
                'original live READY scope differs')
        session_stats(ready.get('session'), policy_sha256, node, max_operations, 0)
        self.stdin = stdin
        self.receive = receive
        self.startup_ns = ready['startupElapsedNs']
        self.policy_sha256 = policy_sha256
        self.node = node
        self.commands = 0
        self.max_operations = max_operations
        self.sequence = 0
        self.awaiting_result = False
        self.poisoned = False

    def exchange(self, operation, sequence, **transaction):
        expected = self.sequence if self.awaiting_result else self.sequence + 1
        require(not self.poisoned and sequence == expected and sequence <= self.max_operations
                and operation == ('result' if self.awaiting_result else 'request'),
                'original live lane sequence or operation differs; preserve original')
        raw = command(operation, sequence, **transaction)
        # Lost writes and replies leave the original operation unresolved. No
        # later request or result can accidentally consume a delayed reply.
        self.poisoned = True
        require(self.stdin.write(raw) == len(raw), 'original live command short write')
        self.stdin.flush()
        reply = self.receive()
        outcome = 'request_published' if operation == 'request' else 'original_result_read'
        require(type(reply) is dict and reply.get('version') == 'YNX-PQ-LAB-LIVE-MATERIALS-REPLY/v1'
                and reply.get('operation') == operation and reply.get('sequence') == str(sequence)
                and 'failure' not in reply
                and type(reply.get('startupElapsedNs')) is int and reply['startupElapsedNs'] == self.startup_ns
                and type(reply.get('calleeElapsedNs')) is int and 0 <= reply['calleeElapsedNs'] < 1 << 63
                and reply.get('syntheticOnly') is True and reply.get('authorityGranted') is False,
                'original live reply refused or uncertain; preserve original without retry')
        failure_class = reply.get('failureClass')
        if reply.get('outcome') == 'REFUSED_OR_UNKNOWN_NO_RETRY':
            require(failure_class in ('BUSY', 'CONTEXT_ENDED', 'REFUSED_OR_UNKNOWN')
                    and reply.get('firstCausePresent') is True
                    and 'requestPath' not in reply and 'result' not in reply,
                    'unqualified original live refusal; preserve original without retry')
            raise OriginalRefusal(failure_class)
        require(reply.get('outcome') == outcome and 'failureClass' not in reply
                and reply.get('firstCausePresent') is False,
                'original live success scope differs; preserve original without retry')
        if operation == 'request':
            require(type(reply.get('requestPath')) is str and 'result' not in reply,
                    'original publication reply differs')
        else:
            require(type(reply.get('result')) is dict and 'requestPath' not in reply,
                    'original result reply differs')
        session_stats(reply.get('session'), self.policy_sha256, self.node, self.max_operations,
                      self.commands + 1)
        self.commands += 1
        self.sequence = sequence
        self.awaiting_result = operation == 'request'
        self.poisoned = False
        return reply
