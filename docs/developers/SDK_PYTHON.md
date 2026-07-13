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

Run `make sdk-check` for fixture-backed unit/package checks and `make sdk-remote-check` for read-only compatibility proof against the public testnet.
