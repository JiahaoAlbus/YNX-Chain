import hashlib
import socket
import threading
import unittest
from unittest.mock import patch

from nym_https_range_probe import read_range
from nym_https_stage_probe import PhaseFailure


class FixedRangeControls(unittest.TestCase):
    body = b'X' * 1024

    def exchange(self, status, headers, body):
        left, right = socket.socketpair()
        left.settimeout(2)
        right.settimeout(2)
        commands = []
        stages = []

        def serve():
            with right:
                request = bytearray()
                while b'\r\n\r\n' not in request and (data := right.recv(4096)):
                    request.extend(data)
                right.sendall(f'HTTP/1.1 {status}\r\n'.encode() + headers + b'\r\n' + body)
                right.shutdown(socket.SHUT_WR)
                while (data := right.recv(4096)):
                    request.extend(data)
                commands.append(bytes(request))

        worker = threading.Thread(target=serve)
        worker.start()
        try:
            with patch('nym_https_range_probe.BODY_SHA256', hashlib.sha256(self.body).hexdigest()):
                try:
                    result = read_range(left, lambda _, **fields: stages.append(fields['status']), lambda: stages.append('body'))
                except PhaseFailure as error:
                    result = str(error)
        finally:
            left.close()
            worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(commands, [b'GET /rfc/rfc1928.txt HTTP/1.1\r\nHost: www.rfc-editor.org\r\n'
                                    b'Range: bytes=0-1023\r\nAccept: text/plain\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n'])
        return result, stages

    def test_exact_206_and_body_pin(self):
        result, stages = self.exchange('206 Partial Content', b'Content-Range: bytes 0-1023/19741\r\nContent-Length: 1024\r\n', self.body)
        self.assertEqual(stages, [206, 'body'])
        self.assertTrue(result['documentRangeVerified'])
        self.assertEqual(result['bodyBytes'], 1024)

    def test_full_body_or_redirect_status_refuses_before_reading_body(self):
        for status in ('200 OK', '302 Found'):
            with self.subTest(status=status):
                result, stages = self.exchange(status, b'Content-Length: 19741\r\n', b'')
                self.assertEqual(result, 'HTTP_RANGE_STATUS_NOT_206')
                self.assertEqual(stages, [int(status.split()[0])])

    def test_wrong_content_range_rejects_before_reading_body(self):
        self.assertEqual(self.exchange('206 Partial Content', b'Content-Range: bytes 1-1024/19741\r\nContent-Length: 1024\r\n', b''),
                         ('HTTP_CONTENT_RANGE_MISMATCH', [206]))

    def test_truncated_or_wrong_bytes_never_pass(self):
        headers = b'Content-Range: bytes 0-1023/19741\r\nContent-Length: 1024\r\n'
        self.assertEqual(self.exchange('206 Partial Content', headers, self.body[:-1])[0], 'HTTP_RANGE_BODY_TRUNCATED')
        self.assertEqual(self.exchange('206 Partial Content', headers, b'Y' * 1024)[0], 'HTTP_RANGE_BODY_PIN_MISMATCH')


if __name__ == '__main__':
    unittest.main()
