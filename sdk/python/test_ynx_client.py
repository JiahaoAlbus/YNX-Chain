import json
import pathlib
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(pathlib.Path(__file__).parent))

from ynx_client import YNXClient, YNXSDKError, assert_ynx_testnet_snapshot, call_evm, get_status


class FixtureHandler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass

    def do_GET(self):
        if self.path != "/status":
            self.send_error(404)
            return
        self._json({"chainId": 6423, "nativeCurrencySymbol": "YNXT", "publicNetwork": True, "height": 100})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        if body["method"] == "eth_error":
            self._json({"jsonrpc": "2.0", "id": body["id"], "error": {"code": -32601, "message": "unsupported"}})
            return
        results = {"eth_chainId": "0x1917", "eth_blockNumber": "0x64"}
        self._json({"jsonrpc": "2.0", "id": body["id"], "result": results[body["method"]]})

    def _json(self, payload):
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


class YNXClientTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_status_and_validated_snapshot(self):
        self.assertEqual(get_status(self.base_url)["height"], 100)
        snapshot = assert_ynx_testnet_snapshot(YNXClient(self.base_url, self.base_url).get_chain_snapshot())
        self.assertEqual(snapshot["evmBlockNumber"], 100)

    def test_json_rpc_error(self):
        with self.assertRaises(YNXSDKError) as raised:
            call_evm(self.base_url, "eth_error")
        self.assertEqual(raised.exception.code, -32601)

    def test_height_mismatch(self):
        with self.assertRaisesRegex(YNXSDKError, "height difference"):
            assert_ynx_testnet_snapshot(
                {
                    "status": {"chainId": 6423, "nativeCurrencySymbol": "YNXT", "publicNetwork": True, "height": 100},
                    "evmChainId": "0x1917",
                    "evmBlockNumber": 1,
                }
            )

    def test_rejects_unsupported_protocol(self):
        with self.assertRaisesRegex(YNXSDKError, "absolute HTTP"):
            YNXClient("file:///tmp/status", self.base_url)


if __name__ == "__main__":
    unittest.main()
