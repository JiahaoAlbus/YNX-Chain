import ipaddress
import json
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen


class QuantError(RuntimeError):
    pass


class QuantClient:
    def __init__(self, base_url="http://127.0.0.1:6444", opener=urlopen):
        self.base_url = base_url.rstrip("/")
        self._opener = opener

    def health(self):
        return self._request("GET", "/health")

    def snapshot(self):
        return self._request("GET", "/v1/snapshot")

    def kill_switch(self, *, reason, approved=False):
        self._approved(approved)
        return self._mutation("/v1/risk/kill", {"reason": reason})

    def revoke_mandate(self, *, digest, actor, approved=False):
        self._approved(approved)
        if len(digest) != 64 or any(c not in "0123456789abcdefABCDEF" for c in digest):
            raise ValueError("SHA-256 mandate digest required")
        return self._mutation(f"/v1/testnet/mandates/{quote(digest)}/revoke", {"actor": actor})

    @staticmethod
    def _approved(approved):
        if approved is not True:
            raise QuantError("explicit operator approval required")

    def _mutation(self, path, payload):
        parsed = urlparse(self.base_url)
        try:
            is_loopback = parsed.hostname == "localhost" or ipaddress.ip_address(parsed.hostname).is_loopback
        except ValueError:
            is_loopback = False
        if parsed.username or parsed.password or not is_loopback:
            raise QuantError("preview mutations require a loopback endpoint")
        return self._request("POST", path, payload)

    def _request(self, method, path, payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        headers = {"Accept": "application/json"}
        if data is not None:
            headers.update({"Content-Type": "application/json", "X-YNX-Preview-Mode": "local-paper"})
        request = Request(self.base_url + path, data=data, headers=headers, method=method)
        with self._opener(request, timeout=10) as response:
            value = json.load(response)
            if not 200 <= response.status < 300:
                raise QuantError(value.get("error", f"HTTP {response.status}"))
            return value
