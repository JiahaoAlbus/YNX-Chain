import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Optional


DEFAULT_TIMEOUT_SECONDS = 10.0
HEX_QUANTITY = re.compile(r"^0x(?:0|[1-9a-f][0-9a-f]*)$", re.IGNORECASE)


class YNXSDKError(RuntimeError):
    def __init__(self, message: str, *, status: Optional[int] = None, code: Optional[int] = None):
        super().__init__(message)
        self.status = status
        self.code = code


def _endpoint(base_url: str, path: str = "") -> str:
    parsed = urllib.parse.urlsplit(base_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise YNXSDKError("endpoint must be an absolute HTTP(S) URL")
    endpoint_path = parsed.path.rstrip("/")
    if path:
        endpoint_path = f"{endpoint_path}/{path.lstrip('/')}"
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, endpoint_path or "/", parsed.query, ""))


def _request_json(url: str, *, body: Optional[dict[str, Any]] = None, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> Any:
    if timeout <= 0:
        raise YNXSDKError("timeout must be positive")
    encoded = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
    headers = {} if body is None else {"Content-Type": "application/json"}
    request = urllib.request.Request(url, data=encoded, headers=headers, method="GET" if body is None else "POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(detail)
            detail = payload.get("message") or payload.get("error", {}).get("message") or detail
        except (json.JSONDecodeError, AttributeError):
            pass
        raise YNXSDKError(f"YNX endpoint failed ({error.code}): {detail}", status=error.code) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise YNXSDKError(f"YNX endpoint request failed: {error}") from error
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise YNXSDKError("YNX endpoint returned invalid JSON") from error


def get_status(base_url: str, *, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> dict[str, Any]:
    result = _request_json(_endpoint(base_url, "/status"), timeout=timeout)
    if not isinstance(result, dict):
        raise YNXSDKError("YNX status response must be an object")
    return result


def call_evm(
    evm_url: str,
    method: str,
    params: Optional[list[Any]] = None,
    *,
    request_id: int = 1,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> Any:
    if not method:
        raise YNXSDKError("JSON-RPC method is required")
    params = [] if params is None else params
    if not isinstance(params, list):
        raise YNXSDKError("JSON-RPC params must be a list")
    response = _request_json(
        _endpoint(evm_url),
        body={"jsonrpc": "2.0", "id": request_id, "method": method, "params": params},
        timeout=timeout,
    )
    if not isinstance(response, dict) or response.get("jsonrpc") != "2.0" or response.get("id") != request_id:
        raise YNXSDKError("YNX EVM returned a mismatched JSON-RPC response")
    if response.get("error"):
        error = response["error"]
        raise YNXSDKError(
            f"YNX EVM error {error.get('code')}: {error.get('message')}",
            code=error.get("code"),
        )
    if "result" not in response:
        raise YNXSDKError("YNX EVM response is missing result")
    return response["result"]


def _parse_hex_quantity(value: Any, name: str) -> int:
    if not isinstance(value, str) or not HEX_QUANTITY.fullmatch(value):
        raise YNXSDKError(f"{name} is not a canonical hex quantity")
    return int(value[2:], 16)


@dataclass(frozen=True)
class YNXClient:
    rest_url: str
    evm_url: str
    timeout: float = DEFAULT_TIMEOUT_SECONDS

    def __post_init__(self) -> None:
        object.__setattr__(self, "rest_url", _endpoint(self.rest_url))
        object.__setattr__(self, "evm_url", _endpoint(self.evm_url))
        if self.timeout <= 0:
            raise YNXSDKError("timeout must be positive")

    def get_status(self) -> dict[str, Any]:
        return get_status(self.rest_url, timeout=self.timeout)

    def call_evm(self, method: str, params: Optional[list[Any]] = None) -> Any:
        return call_evm(self.evm_url, method, params, timeout=self.timeout)

    def get_chain_snapshot(self) -> dict[str, Any]:
        status = self.get_status()
        evm_chain_id = self.call_evm("eth_chainId")
        evm_block_hex = self.call_evm("eth_blockNumber")
        return {
            "status": status,
            "evmChainId": evm_chain_id,
            "evmBlockHex": evm_block_hex,
            "evmBlockNumber": _parse_hex_quantity(evm_block_hex, "eth_blockNumber"),
        }


def assert_ynx_testnet_snapshot(snapshot: dict[str, Any], *, maximum_height_lag: int = 30) -> dict[str, Any]:
    status = snapshot.get("status") or {}
    if status.get("chainId") != 6423:
        raise YNXSDKError("REST chain ID is not 6423")
    if status.get("nativeCurrencySymbol") != "YNXT":
        raise YNXSDKError("native currency symbol is not YNXT")
    if status.get("publicNetwork") is not True:
        raise YNXSDKError("REST endpoint is not marked as a public network")
    if snapshot.get("evmChainId") != "0x1917":
        raise YNXSDKError("EVM chain ID is not 0x1917")
    rest_height = status.get("height")
    evm_height = snapshot.get("evmBlockNumber")
    if not isinstance(rest_height, int) or isinstance(rest_height, bool) or rest_height < 0:
        raise YNXSDKError("REST height is invalid")
    if not isinstance(evm_height, int) or isinstance(evm_height, bool) or evm_height < 0:
        raise YNXSDKError("EVM height is invalid")
    if abs(rest_height - evm_height) > maximum_height_lag:
        raise YNXSDKError(f"REST/EVM height difference exceeds {maximum_height_lag} blocks")
    return snapshot


YNX_TESTNET = {
    "chainId": "0x1917",
    "chainIdDecimal": 6423,
    "chainName": "YNX Testnet",
    "nativeCurrency": {"name": "YNXT", "symbol": "YNXT", "decimals": 18},
    "rpcUrls": ["https://evm.ynxweb4.com"],
    "restUrls": ["https://rpc.ynxweb4.com"],
    "blockExplorerUrls": ["https://explorer.ynxweb4.com"],
}
