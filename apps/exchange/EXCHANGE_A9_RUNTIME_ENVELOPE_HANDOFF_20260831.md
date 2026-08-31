# Exchange a9 runtime envelope

The local Linux amd64 candidate is source `a9cf3d86594ceaf9d5a36d04182590d77acccf0b`, archive SHA-256 `4de9f877f3aa71382e216e3171e6b8b783a9284704c54c8b4e3794e6c9451ac3` (3,406,293 bytes), and binary SHA-256 `45fd389542d28006f465125d9f498b0cf9ac4ce55ef7f925e47b8e49c317373e` (7,516,308 bytes). It is local and unsigned.

Fresh public reads show that `/`, `/health`, and `/version` all return the same 18,603-byte HTML document. Therefore HTTP 200 does not establish a service health/version identity or a source-bound Exchange deployment. Central must bind the actual host, service and rollback target and provide non-fallback health/version endpoints before any Exchange-only lease. No SSH, deployment, account approval, order, settlement, signature or transaction occurred.
