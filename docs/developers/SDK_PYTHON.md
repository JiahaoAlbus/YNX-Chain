# Python SDK

The standard-library client in `sdk/python` reads YNX REST status and EVM JSON-RPC without mutating chain state. Its `pyproject.toml` supports local packaging, but the package is not claimed as published to PyPI.

```python
from ynx_client import YNXClient, assert_ynx_testnet_snapshot

client = YNXClient(
    rest_url="https://rpc.ynxweb4.com",
    evm_url="https://evm.ynxweb4.com",
)
snapshot = assert_ynx_testnet_snapshot(client.get_chain_snapshot())
print(snapshot["status"]["height"], snapshot["evmChainId"])
```

Run `make sdk-check` for fixture-backed unit/package checks, deterministic offline-installable wheel verification, and an isolated artifact-only consumer. `make sdk-remote-check` provides read-only compatibility proof against the public testnet. See `docs/developers/SDK_RELEASE_INTEGRITY.md` for the canonical manifest and optional owner-supplied detached-signature boundary.
