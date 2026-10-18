# Original daemon runtime R31

The fixed service entry is scripts/original-wallet-private-service-launcher.mjs.
The original daemon calls it from its real v2 listen callback, with its same-copy
Host/runtime lifetime and a cleanup-only acquisition reference reserved earlier.
No Native owner, path, FD, provider or Source selection is accepted from a caller.
v3 keeps its separate explicit state/control adoption contract.

Native methods are the exact formal R31 factory/ready/read/write and partial-owner
retire/join/close exports. The factory has zero arguments. Capture the partial
before ready checks. A returned object, null read, pending write, source checkpoint
or package does not grant an account/session or prove installation.

The sole fixed 25 ms timer is serial. Read null retains idle/partial Native state;
a complete canonical raw string goes through the original decoder and dispatcher.
The original result is bound to its Native terminal ACK and current readback before
write. Write null only progresses that same retained raw/offset; undefined alone
means that transport write completed. No second read/effect is entered while it is
pending. IDs and raw originals remain retained; no replay, new owner or bridge is
created after uncertainty. The owner capacity stays 64 and response cap 65536 bytes.

The normal lifetime reports the first asynchronous failure to the original daemon,
which retires HTTP/new effects and drains the same owners. Falsy business and
cleanup causes are distinct. A captured dispatch acquisition owns Native cleanup;
the launcher never selects a second independent close path. Partial acquisition
without a returned owner is not assumed resource-free. Failed cleanup/UNKNOWN
remains retained and prevents a false clean shutdown.

R31 Kind::privateService is an explicitly registered daemon role. It is not an IDE
child's joint, fd4 guard or consumer authority. The IDE child-client derived from
its original once-adopted delivery still needs its actual Native supplier and
Wallet-parent forwarding/ACK/current path. Server ACK is not client ACK or a human
receipt. The R88 UI transport cannot treat a server DTO as its own terminal proof.

Focused controls execute this launcher with explicit PUBLIC Native/Source/dispatch
instruments. A separate actual daemon process using isolated temporary state proves
that the normal entry refuses an unconfigured original runtime and drains SIGTERM
without inventing a Native owner. These are not qualified Native positive controls.
Actual Source/profile/release approval, protected installation, actual NAPI channel
and Host ACK, cold reconciliation and supported-platform user journeys remain gates.
