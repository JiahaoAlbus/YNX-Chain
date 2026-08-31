# YNX Code production package-egress network review

Status: proposed production change; **not applied**. The production operator must
approve the exact network name `ynx-pkg-egress` before running any
mutation below.

YNX Code workspaces have no network by default. An exact npm or Python package
install temporarily attaches one second NIC and must remove it before returning
success. The dedicated bridge permits only DNS and HTTPS, rejects unmatched
traffic, and explicitly drops loopback, link-local, carrier-grade NAT, private
and multicast destinations before the HTTPS allow rule. It must never be added
to an LXD profile.

The policy follows LXD 5.21's network ACL model: assigning an ACL to a bridge
adds a default reject for unmatched traffic, while bridge ACLs operate at the
host boundary and cannot provide intra-bridge filtering. YNX Code therefore
allows only one owner-bound runtime naming pattern on this network and attaches
the NIC only for the bounded package operation.

## Exact reviewed creation transaction

Run only after the production owner approves the named network. Stop on the
first error; do not substitute `lxdbr0`, another subnet, an existing ACL, or a
different default action.

```bash
sudo lxc network acl create ynx-code-package-egress-acl <<'YAML'
description: YNX Code package DNS and HTTPS only; private destinations denied
config:
  user.ynx-code-policy: ynx-code-package-egress/v1
ingress: []
egress:
  - action: drop
    description: Block private and special IPv4 destinations
    destination: 10.0.0.0/8,100.64.0.0/10,127.0.0.0/8,169.254.0.0/16,172.16.0.0/12,192.168.0.0/16,224.0.0.0/4
    state: enabled
  - action: drop
    description: Block private and special IPv6 destinations
    destination: ::1/128,fc00::/7,fe80::/10,ff00::/8
    state: enabled
  - action: allow
    description: Allow package registry HTTPS
    protocol: tcp
    destination_port: "443"
    state: enabled
  - action: allow
    description: Allow DNS queries
    protocol: udp
    destination_port: "53"
    state: enabled
  - action: allow
    description: Allow DNS queries over TCP
    protocol: tcp
    destination_port: "53"
    state: enabled
YAML

sudo lxc network create ynx-pkg-egress --type bridge \
  ipv4.address=10.251.0.1/24 ipv4.nat=true ipv6.address=none \
  security.acls=ynx-code-package-egress-acl \
  security.acls.default.ingress.action=reject \
  security.acls.default.egress.action=reject \
  user.ynx-code-policy=ynx-code-package-egress/v1
sudo lxc network set ynx-pkg-egress --property \
  description='YNX Code temporary reviewed package egress'
```

## Mandatory verification

Capture both immutable inputs and the normalized review result. The protected
deployment transaction performs these same checks before dependency installation,
image creation, service stop, symlink change, or public traffic verification.

```bash
sudo lxc query /1.0/networks/ynx-pkg-egress > /tmp/ynx-pkg-egress.json
sudo lxc query /1.0/network-acls/ynx-code-package-egress-acl > /tmp/ynx-code-package-egress-acl.json
node apps/developer/scripts/verify-package-egress-network.mjs \
  --network /tmp/ynx-pkg-egress.json \
  --acl /tmp/ynx-code-package-egress-acl.json
```

The verifier fails if the bridge is attached to a profile, has an external
interface or raw override, disables the firewall, enables IPv6/NAT outside the
review, broadens a default action, adds a port, removes a private-destination
drop, or changes the fixed network/ACL identity.

## Rollback boundary

If creation succeeds but verification fails, do not deploy Developer. After
confirming `used_by` is empty, delete only these two newly created objects:

```bash
sudo lxc network delete ynx-pkg-egress
sudo lxc network acl delete ynx-code-package-egress-acl
```

Never delete an object while `used_by` is non-empty. Network deletion is not
part of routine package installation or application rollback; the deployment
transaction instead removes each temporary NIC and stops the runtime if cleanup
is uncertain.
