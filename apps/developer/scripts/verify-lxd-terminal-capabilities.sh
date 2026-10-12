#!/usr/bin/env bash
set -euo pipefail
# Read-only. The deployment owner supplies an explicit dedicated QA container.
container="${1:?Pass an explicitly approved isolated QA container name}"
[[ "$container" =~ ^ynx-[a-f0-9]{10}-[a-f0-9]{24}$ ]] || { echo 'Invalid isolated container identity' >&2; exit 2; }
lxc exec "$container" -- python3 -c '
import json,os,shutil,subprocess
commands={key:shutil.which(key) for key in ("systemd-run","systemctl","useradd","python3")}
pid1=open("/proc/1/comm").read().strip()
cgroup=os.path.isfile("/sys/fs/cgroup/cgroup.controllers")
version=subprocess.run(["systemctl","show","--property=Version"],capture_output=True,text=True,timeout=8)
print(json.dumps({"pid1":pid1,"cgroupV2":cgroup,"commands":commands,"managerAvailable":version.returncode==0,"version":version.stdout.strip()},sort_keys=True))
assert pid1=="systemd" and cgroup and all(commands.values()) and version.returncode==0
'
