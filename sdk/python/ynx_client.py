import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Optional


DEFAULT_TIMEOUT_SECONDS = 10.0
HEX_QUANTITY = re.compile(r"^0x(?:0|[1-9a-f][0-9a-f]*)$", re.IGNORECASE)
HEX_ADDRESS = re.compile(r"^0x[0-9a-f]{40}$", re.IGNORECASE)
YNX_ADDRESS_HRP = "ynx"
BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
BECH32_REVERSE = {character: index for index, character in enumerate(BECH32_CHARSET)}


class YNXSDKError(RuntimeError):
    def __init__(self, message: str, *, status: Optional[int] = None, code: Optional[int] = None):
        super().__init__(message)
        self.status = status
        self.code = code


def _convert_address_bits(data: list[int], from_bits: int, to_bits: int, pad: bool) -> list[int]:
    accumulator = 0
    bits = 0
    result: list[int] = []
    max_value = (1 << to_bits) - 1
    max_accumulator = (1 << (from_bits + to_bits - 1)) - 1
    for value in data:
        if value < 0 or value >> from_bits:
            raise YNXSDKError("address payload value exceeds conversion bit width")
        accumulator = ((accumulator << from_bits) | value) & max_accumulator
        bits += from_bits
        while bits >= to_bits:
            bits -= to_bits
            result.append((accumulator >> bits) & max_value)
    if pad and bits:
        result.append((accumulator << (to_bits - bits)) & max_value)
    if not pad and (bits >= from_bits or ((accumulator << (to_bits - bits)) & max_value)):
        raise YNXSDKError("address payload has invalid Bech32 padding")
    return result


def _bech32_hrp_expand(hrp: str) -> list[int]:
    return [ord(character) >> 5 for character in hrp] + [0] + [ord(character) & 31 for character in hrp]


def _bech32_polymod(values: list[int]) -> int:
    generators = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
    checksum = 1
    for value in values:
        top = checksum >> 25
        checksum = ((checksum & 0x1FFFFFF) << 5) ^ value
        for index, generator in enumerate(generators):
            if (top >> index) & 1:
                checksum ^= generator
    return checksum


def _decode_hex_address(value: str) -> list[int]:
    value = value.strip() if isinstance(value, str) else ""
    if not HEX_ADDRESS.fullmatch(value):
        raise YNXSDKError("account address must be 0x-prefixed with 40 hex characters")
    return list(bytes.fromhex(value[2:]))


def to_ynx_address(value: str) -> str:
    payload = _decode_hex_address(to_evm_address(value))
    data = _convert_address_bits(payload, 8, 5, True)
    checksum = _bech32_polymod(_bech32_hrp_expand(YNX_ADDRESS_HRP) + data + [0] * 6) ^ 1
    checksum_values = [(checksum >> (5 * (5 - index))) & 31 for index in range(6)]
    return f"{YNX_ADDRESS_HRP}1" + "".join(BECH32_CHARSET[item] for item in data + checksum_values)


def to_evm_address(value: str) -> str:
    if not isinstance(value, str):
        raise YNXSDKError("account address must be a string")
    value = value.strip()
    if not value.lower().startswith(f"{YNX_ADDRESS_HRP}1"):
        return "0x" + bytes(_decode_hex_address(value)).hex()
    if len(value) > 90:
        raise YNXSDKError("YNX address exceeds Bech32 maximum length")
    if value != value.lower() and value != value.upper():
        raise YNXSDKError("YNX address must not mix uppercase and lowercase")
    value = value.lower()
    separator = value.rfind("1")
    if separator <= 0 or separator + 7 > len(value):
        raise YNXSDKError("YNX address has an invalid Bech32 separator or checksum length")
    if value[:separator] != YNX_ADDRESS_HRP:
        raise YNXSDKError('YNX address HRP must be "ynx"')
    try:
        data = [BECH32_REVERSE[character] for character in value[separator + 1 :]]
    except KeyError as error:
        raise YNXSDKError("YNX address contains an invalid Bech32 character") from error
    if _bech32_polymod(_bech32_hrp_expand(YNX_ADDRESS_HRP) + data) != 1:
        raise YNXSDKError("YNX address checksum is invalid")
    payload = _convert_address_bits(data[:-6], 5, 8, False)
    if len(payload) != 20:
        raise YNXSDKError("YNX address payload must be 20 bytes")
    return "0x" + bytes(payload).hex()


def normalize_ynx_address(value: str) -> dict[str, str]:
    evm_address = to_evm_address(value)
    return {"evmAddress": evm_address, "ynxAddress": to_ynx_address(evm_address)}


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
