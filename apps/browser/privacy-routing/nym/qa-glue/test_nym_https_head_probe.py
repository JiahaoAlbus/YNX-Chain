import socket
import threading
import unittest

from nym_https_head_probe import read_head
from nym_https_stage_probe import PhaseFailure


class FixedHeadControls(unittest.TestCase):
    def exchange(self, response):
        sent = []
        left, right = socket.socketpair()
        left.settimeout(1)
        right.settimeout(1)

        def serve():
            request = bytearray()
            try:
                while b'\r\n\r\n' not in request:
                    data = right.recv(4096)
                    if not data:
                        break
                    request.extend(data)
                right.sendall(response)
                # Keep the peer open. HEAD must finish without waiting for the
                # advertised body. The next read must see the caller's EOF.
                while True:
                    extra = right.recv(4096)
                    if not extra:
                        break
                    request.extend(extra)
                sent.append(bytes(request))
            except OSError as error:
                sent.append(type(error).__name__)
            finally:
                right.close()

        worker = threading.Thread(target=serve)
        worker.start()
        try:
            try:
                result = read_head(left)
            except PhaseFailure as error:
                result = str(error)
        finally:
            left.close()
            worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(sent, [b'HEAD /rfc/rfc1928.txt HTTP/1.1\r\nHost: www.rfc-editor.org\r\n'
                                b'Accept: text/plain\r\nConnection: close\r\n\r\n'])
        return result

    def test_head_completes_with_an_advertised_but_unsent_representation(self):
        result = self.exchange(b'HTTP/1.1 200 OK\r\nContent-Length: 19741\r\n\r\n')
        self.assertEqual(result['httpStatus'], 200)
        self.assertFalse(result['responseBodyRead'])
        self.assertFalse(result['documentBodyVerified'])

    def test_redirect_status_is_observed_without_another_request(self):
        result = self.exchange(b'HTTP/1.1 302 Found\r\nLocation: https://unused.invalid/\r\n\r\n')
        self.assertEqual(result['httpStatus'], 302)
        self.assertFalse(result['followedRedirect'])

    def test_informational_status_does_not_establish_final_headers(self):
        self.assertEqual(self.exchange(b'HTTP/1.1 103 Early Hints\r\n\r\n'), 'HTTP_FINAL_STATUS_REQUIRED')


if __name__ == '__main__':
    unittest.main()
