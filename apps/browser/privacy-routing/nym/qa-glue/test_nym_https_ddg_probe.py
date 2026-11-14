import socket
import threading
import unittest

from nym_https_ddg_probe import read_search
from nym_https_stage_probe import PhaseFailure
from nym_ddg_stage_observer import make_observer
from nym_reply_surb_observer import ReplySurbObserver


class FixedSearchControls(unittest.TestCase):
    markup = b'<html><a class="result__a" href="https://example.invalid">fixture</a></html>'

    def exchange(self, status, body, length=None):
        left, right = socket.socketpair()
        left.settimeout(2)
        right.settimeout(2)
        commands = []
        statuses = []

        def serve():
            with right:
                request = bytearray()
                while b'\r\n\r\n' not in request:
                    data = right.recv(4096)
                    if not data:
                        break
                    request.extend(data)
                reported = len(body) if length is None else length
                right.sendall(f'HTTP/1.1 {status}\r\nContent-Type: text/html\r\nContent-Length: {reported}\r\n'.encode()
                              + b'Location: https://unused.invalid/\r\n\r\n' + body)
                right.shutdown(socket.SHUT_WR)
                while (data := right.recv(4096)):
                    request.extend(data)
                commands.append(bytes(request))

        thread = threading.Thread(target=serve)
        thread.start()
        try:
            try:
                result = read_search(left, lambda _, **fields: statuses.append(fields['status']), lambda: None)
            except PhaseFailure as error:
                result = str(error)
        finally:
            left.close()
            thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(commands, [b'GET /html/?q=YNX%20browser HTTP/1.1\r\nHost: html.duckduckgo.com\r\n'
                                    b'Accept: text/html\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n'])
        self.assertEqual(statuses, [int(status.split()[0])])
        return result

    def test_complete_200_with_closed_result_link(self):
        result = self.exchange('200 OK', self.markup)
        self.assertEqual(result['siteClassification'], 'COMPLETE_SEARCH_RESULTS')
        self.assertEqual(result['searchResultLinks'], 1)
        self.assertNotIn('example.invalid', repr(result))

    def test_202_challenge_overrides_result_markup(self):
        result = self.exchange('202 Accepted', self.markup + b'<form id="challenge-form"></form>')
        self.assertEqual(result['siteClassification'], 'CAPTCHA')
        self.assertEqual(result['searchResultLinks'], 0)

    def test_202_alone_and_site_denial_do_not_establish_results(self):
        self.assertEqual(self.exchange('202 Accepted', self.markup)['siteClassification'], 'HTTP_202_UNVERIFIED')
        self.assertEqual(self.exchange('403 Forbidden', self.markup)['siteClassification'], 'HTTP_SITE_DENIED')

    def test_truncated_document_cannot_establish_results(self):
        self.assertEqual(self.exchange('200 OK', self.markup, len(self.markup) + 10), 'HTTP_BODY_TRUNCATED')

    def test_redirect_stops_after_original_request(self):
        result = self.exchange('302 Found', b'')
        self.assertEqual(result['siteClassification'], 'REDIRECT_NOT_FOLLOWED')
        self.assertFalse(result['followedRedirect'])

    def test_only_fixed_search_connection_controls_scope(self):
        observer = make_observer(ReplySurbObserver, 'a'*32, 63801)
        start = '2026-11-13T00:00:00Z INFO common/socks5-client-core/src/socks/client.rs:499: Starting proxy for '
        self.assertIsNone(observer.feed(start+'www.rfc-editor.org:443 (id: 1)'))
        event = observer.feed(start+'html.duckduckgo.com:443 (id: 2)')
        self.assertEqual(event['event'], 'current_proxy_started')
        self.assertEqual(observer.current_id, 2)
        denial = '2026-11-13T00:00:00Z ERROR common/socks5-client-core/src/socks/mixnet_responses.rs:82: Network requester failed on connection id 2 with error: failed filter check'
        self.assertTrue(observer.feed(denial)['currentConnection'])
        self.assertEqual(observer.first_failure['fixedReason'], 'NR_CURRENT_CONNECTION_ERROR')


if __name__ == '__main__':
    unittest.main()
