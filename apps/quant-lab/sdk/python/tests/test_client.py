import io
import json
import unittest

from ynx_quant import QuantClient, QuantError


class Response(io.BytesIO):
    status = 200
    def __enter__(self): return self
    def __exit__(self, *_): self.close()


class QuantClientTest(unittest.TestCase):
    def test_reads_and_approved_mutation(self):
        calls = []
        def opener(request, timeout):
            calls.append(request)
            return Response(json.dumps({"status": "ok"}).encode())
        client = QuantClient(opener=opener)
        self.assertEqual(client.health()["status"], "ok")
        with self.assertRaises(QuantError): client.kill_switch(reason="operator test")
        client.kill_switch(reason="operator test", approved=True)
        self.assertEqual(calls[-1].method, "POST")
        self.assertEqual(calls[-1].headers["X-ynx-preview-mode"], "local-paper")

    def test_remote_mutation_fails_before_network(self):
        client = QuantClient("https://quant.invalid", opener=lambda *_: self.fail("network called"))
        with self.assertRaises(QuantError): client.kill_switch(reason="operator test", approved=True)


if __name__ == "__main__": unittest.main()
