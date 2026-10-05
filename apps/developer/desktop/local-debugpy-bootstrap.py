"""YNX compatibility entry point for the reviewed debugpy 1.8.20 adapter.

The upstream adapter, launcher and DAP implementation remain unchanged. Only
its three named listener allocations are bound to supervisor-owned endpoints.
No attach conversion, socket-wide monkey patch or port-zero fallback is used.
"""
import hashlib
import json
import os
import runpy
import sys

PINS = {
    "adapter/__main__.py": "ce6d475e0a1e5dce3cc79b51c254561a8031041b31f1d11904a53dad4e5a095f",
    "adapter/clients.py": "92df10a72a3c013f55b856e56236649b2f9dfbc5d056735ce2e525fbaea2db7c",
    "adapter/launchers.py": "492d736c4462b2a88f709f43ec39113075222f7c7662f7820fb3f87aa0d13a3f",
    "adapter/servers.py": "fcda211deb9c2fada184ee4d4cfa4373970c743d2a8866bd5f8c9ca99af3885b",
    "common/sockets.py": "e3e5f47c3805e9b628b8f536c079bb9eb9d4bba81a8f421544b7aa8540e1f23a",
    "server/cli.py": "1a97b9ca4e1438df58bdf06cc039c20ed20dfcc056795e6fcdc0c3366549b3e9",
}


def main():
    configuration = json.loads(sys.argv[1])
    root = configuration["debugpy"]
    if not os.path.isabs(root) or os.path.realpath(root) != root:
        raise RuntimeError("Noncanonical debugpy runtime")
    ports = configuration["ports"]
    if len(ports) != 3 or len(set(ports)) != 3 or any(type(p) is not int or not 1024 <= p <= 65535 for p in ports):
        raise RuntimeError("Invalid bounded debug endpoints")
    for relative, digest in PINS.items():
        path = os.path.join(root, relative)
        if os.path.realpath(path) != path or os.path.islink(path):
            raise RuntimeError("Debug runtime path changed")
        with open(path, "rb") as source:
            if hashlib.sha256(source.read()).hexdigest() != digest:
                raise RuntimeError("Unsupported debugpy contract: " + relative)
    sys.path.insert(0, os.path.dirname(root))
    import debugpy
    if debugpy.__version__ != "1.8.20":
        raise RuntimeError("Unsupported debugpy version")
    from debugpy.common import sockets
    original = sockets.serve
    endpoints = dict(zip(("Client", "Server", "Launcher"), ports))

    def bounded_serve(name, handler, host, port=0, backlog=128, timeout=None):
        if name not in endpoints or host not in (None, "127.0.0.1", "localhost") or port not in (None, 0, endpoints[name]):
            raise RuntimeError("Debug endpoint is outside this session")
        return original(name, handler, "127.0.0.1", endpoints[name], backlog, timeout)

    sockets.serve = bounded_serve
    # Upstream localhost probing itself uses a temporary bind(0). The already
    # allocated IPv4 endpoints prove IPv4 availability; no extra probe is needed.
    sockets.get_default_localhost = lambda: "127.0.0.1"
    sys.argv = [os.path.join(root, "adapter")] + configuration["args"]
    runpy.run_path(os.path.join(root, "adapter", "__main__.py"), run_name="__main__")


if __name__ == "__main__":
    main()
