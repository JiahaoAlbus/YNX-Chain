# PUBLIC Snowflake output-guard candidate

This library is new QA source, not part of publisher Lyrebird SHA `7c0ac55c…f2f3e1d`,
frozen Browser 25, or normal privacy qualification. It implements the actual full
`github.com/pion/transport/v4@v4.0.1` interfaces. No socket implementation, TLS stack,
Snowflake protocol, Root authority or generic proxy is recreated here.

The fixed-source caller contract is
`P05/r2-20261107/security/pion-public-egress-contract/CONTRACT.md`, SHA
`97259d654a4fc7ad0ff59da022260770a43508b06fbad488affa5e4c60e58c1f`.

## Implemented library seams

- `NewApprovedDNS(fronts, stun, addresses, expires)` copies exactly two front and eight
  STUN name bindings. Missing/extra/expired/nonpublic answers are denied; no default
  resolver exists. Its constructor input is not review authorization. A future factory
  must verify the exact reviewed line/source pins before supplying names/maps.
- `NewPeerNet(inner, mappings)` implements every transport.Net method explicitly.
  Local UDP4/UDP6 listeners may bind local/private interface addresses. Their returned
  PacketConn/UDPConn are private guarded wrappers. Generic numeric UDP dial is converted
  to an explicit family. TCP/raw-IP/unix and raw CreateDialer/CreateListenConfig fallbacks
  are refused; interface enumeration is metadata only.
- The UDP wrappers check each Write/WriteTo/WriteToUDP/WriteMsgUDP final numeric address.
  The checked UDPAddr is a deep copy, and exactly that copy is passed to the inner socket.
  Connected payload I/O requires the actual remote from guarded DialUDP and stays bound
  to it. Unconnected Write and nonempty ancillary writes are denied. All four receive
  paths filter the source before delivery; denied data/address/OOB/flags are cleared.
  A packet read returning after wrapper Close is discarded even from a public source.
- `NewSTUNPolicy(exactNumericTuples, expires)` plus `GuardSTUNPacketConn(inner, policy)`
  protects the separate IPv4 NAT socket. RFC5780 OTHER-ADDRESS is checked on every send
  against pre-reviewed tuples; a server reply cannot expand the set. Absent approved
  alternate tuples, discovery may fail/return NAT unknown. That is preferable to an
  unrestricted send. No packet contents or STUN credentials are logged.
- `NewBrokerDialer(mappings, timeout)` accepts only reviewed front host:443, obtains its
  numeric destination from the closed map and uses standard `net.Dialer.ControlContext`
  to reject before connect. It verifies actual RemoteAddr and returns a private expiring
  stream wrapper. The original TLS caller retains front ServerName, HTTP Host, RootCAs,
  certificate verification and handshake. There is no proxy/TLS bypass/fallback.
  The partial numeric hook is private; external callers cannot install it as a broader
  public-443 authority while skipping the complete original-name/mapping path.
- Policy denial closes the original wrapper and is sticky. `PolicyRejection` unwraps
  to `io.ErrClosedPipe`: fixed Pion candidate_base.go propagates that error while it
  swallows an ordinary write error. A zero-byte EOF is preserved as the network cause.

Both map and STUN constructors normalize supplied wall-clock expiry once into a private
monotonic duration/deadline, retain the absolute deadline as a second check, and make
observed expiry sticky. They never accept a raw JSON time as a renewable authority.
All packet/UDP reads check scope before entering the inner read and after its return;
pending reads are also clamped to the scope deadline without extending an earlier
caller deadline. The broker stream uses the same deadline bound. These use ordinary
Go deadlines, not new background workers or an OS-wide network/sleep kill switch.

The numeric policy deliberately overblocks every IANA special-purpose range, mapped
private IPv4, zones, transition/translation space and IPv6 outside ordinary 2000::/3.
An address classified public is not proof of physical routability or protection from
local/VPN routing. See [IANA IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml),
[IANA IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml),
and [Go Dialer pre-connect hook](https://pkg.go.dev/net@go1.22.12#Dialer).

The library has no lifetime/qualification authority. The future QA owner must retain
and close every original socket on cancellation/deadline. Map expiry is an additional
guard on I/O, not a substitute for that owned shutdown. Private helper `newUDPConn`
starts with an unscoped policy only for internal construction/tests; all public
`NewPeerNet` sockets install the nonnil expiring mapping policy. This is not a complete
process kill switch, DNS capture result, actual vendor integration or Browser LeakSafe.

## Actual callsites still NOT wired

| Fixed source | Required future successor overlay |
| --- | --- |
| Snowflake `client/lib/webrtc.go:274-313` | Guarded SetNet; explicit UDP4/UDP6; DisableActiveTCP(true); mDNS disabled; keepLocal false; forbid mux/proxy/different Net after setup. |
| Snowflake `common/nat/nat.go:152-188,203-237` and `client/lib/snowflake.go:283-302` | Use the closed STUN resolver and guarded PacketConn; retain exact OTHER-ADDRESS checks and cleanup. |
| Snowflake `client/lib/rendezvous.go:59-90` | Guard the base HTTP transport DialContext and reject proxy/SQS/TURN/unknown rendezvous configuration before any socket. |
| ptutil `utls/roundtripper.go:173-225` | Supply this dialer to the private uTLS dial path; outer base transport alone does not cover HTTPS. Preserve SNI/RootCAs/UClient/Handshake. |
| Lyrebird root configuration factory | Bind reviewed source/line pins and immutable prepared mappings; own cancellation/deadline. Exact publisher root is not supplied by a later cached revision. A new official tagged-root QA successor can be separately identified and built without claiming publisher byte equivalence. |

No caller above has been patched, rebuilt or network-accepted in this module. The
local Arti↔PT SOCKS/control listener is separate owned communication; it is not a
remote-public exception and must not be routed through a candidate's LAN allowance.

## Offline checks

`tor/tests/test_public_egress_guard.py` copies this source into an owned scratch module,
replaces the dependency with the full pinned local transport source, disables downloads,
and records source/dependency hashes, Go version, PIDs, exit, RSS, deadline and group cleanup.
The CI supplier must provide genuine pinned transport/ICE source; no fake interface tree
or local WD path may stand in for provenance. The pinned module sums are:

- transport v4.0.1: `h1:sdROELU6BZ63Ab7FrOLn13M6YdJLY20wldXW2Cu2k8o=`
- ICE v4.2.0: `h1:jJC8S+CvXCCvIQUgx+oNZnoUpt6zwc34FhjWwCU4nlw=`

All accepted public vectors go only to counting fakes. There is one real stdlib
ControlContext rejection for numeric loopback, after local socket creation and before
connect; no listener, DNS, successful connection or private payload send is used.
Tests of Pion's private error branch are source-bound error semantics, explicitly not
execution of a full ICE agent or an actual Snowflake network path.

```sh
python3 apps/browser/privacy-routing/tor/tests/test_public_egress_guard.py \
  --transport-source /absolute/pinned/github.com/pion/transport/v4@v4.0.1 \
  --ice-source /absolute/pinned/github.com/pion/ice/v4@v4.2.0 \
  --go /absolute/pinned/go --output /absolute/fresh/owned/results
```

Use `--test-name TestPacketConcurrentCloseDropsLatePublicRead` only for that new
late-close delta; the default command requires every test declared in the candidate.
