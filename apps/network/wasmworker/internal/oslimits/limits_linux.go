//go:build linux

package oslimits

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

var errLinuxLimits = errors.New("fixed Linux cgroup/namespace controls unavailable")

func linuxRead(path string) (string, error) {
	f, e := os.Open(path)
	if e != nil {
		return "", e
	}
	defer f.Close()
	raw, e := io.ReadAll(io.LimitReader(f, 4097))
	if e != nil || len(raw) > 4096 {
		return "", errLinuxLimits
	}
	return strings.TrimSpace(string(raw)), nil
}
func decimal(s string) (uint64, error) {
	n, e := strconv.ParseUint(s, 10, 64)
	if e != nil || strconv.FormatUint(n, 10) != s {
		return 0, errLinuxLimits
	}
	return n, nil
}
func linuxNamespace(kind, value string) bool {
	pre := kind + ":["
	if !strings.HasPrefix(value, pre) || !strings.HasSuffix(value, "]") {
		return false
	}
	n, e := decimal(strings.TrimSuffix(strings.TrimPrefix(value, pre), "]"))
	return e == nil && n > 0
}
func Apply(cpuMilli, durationMS uint64) (Report, func(), error) {
	// Legacy controlled no-containment tests remain explicit. The Linux
	// contained factory always requires marker=1 and a fresh FD3 readback.
	marker := os.Getenv("YNX_NETWORK_OS_LIMITS")
	if marker == "" {
		return Report{}, func() {}, nil
	}
	fail := func() (Report, func(), error) { return Report{}, nil, errLinuxLimits }
	if marker != "1" || os.Geteuid() == 0 || cpuMilli == 0 || cpuMilli > 1000 || durationMS == 0 || durationMS > 5000 {
		return fail()
	}
	challenge := os.Getenv("YNX_NETWORK_LIMITS_CHALLENGE")
	b, e := hex.DecodeString(challenge)
	if e != nil || len(b) != 16 || hex.EncodeToString(b) != challenge {
		return fail()
	}
	scratch, e := decimal(os.Getenv("YNX_NETWORK_SCRATCH_BYTES"))
	if e != nil || scratch > 1<<20 || scratch%uint64(os.Getpagesize()) != 0 {
		return fail()
	}
	var root, group, space, proc unix.Statfs_t
	if unix.Statfs("/", &root) != nil || root.Flags&unix.ST_RDONLY == 0 || unix.Statfs("/run/ynx-cgroup", &group) != nil || group.Type != unix.CGROUP2_SUPER_MAGIC || group.Flags&unix.ST_RDONLY == 0 || unix.Statfs("/scratch", &space) != nil || unix.Statfs("/proc", &proc) != nil || proc.Type != unix.PROC_SUPER_MAGIC || proc.Flags&unix.ST_RDONLY == 0 {
		return fail()
	}
	if scratch == 0 {
		if space.Flags&unix.ST_RDONLY == 0 {
			return fail()
		}
	} else {
		if space.Type != unix.TMPFS_MAGIC || space.Flags&unix.ST_RDONLY != 0 || space.Bsize <= 0 || space.Blocks > scratch/uint64(space.Bsize) || space.Blocks*uint64(space.Bsize) != scratch {
			return fail()
		}
	}
	c := &LinuxControls{ScratchBytes: strconv.FormatUint(scratch, 10), ScratchReadOnly: scratch == 0, RootReadOnly: true, CgroupReadOnly: true}
	for name, dest := range map[string]*string{"memory.max": &c.MemoryMax, "memory.swap.max": &c.SwapMax, "cpu.max": &c.CPUMax, "pids.max": &c.PidsMax} {
		value, e := linuxRead("/run/ynx-cgroup/" + name)
		if e != nil {
			return fail()
		}
		*dest = value
	}
	mem, e := decimal(c.MemoryMax)
	if e != nil || mem < 129*65536 || mem > 24<<20 || c.SwapMax != "0" || c.CPUMax != fmt.Sprintf("%d 1000000", cpuMilli*1000) || c.PidsMax != "32" {
		return fail()
	}
	for name, expected := range map[string]string{"memory.oom.group": "1", "cpu.max.burst": "0"} {
		value, e := linuxRead("/run/ynx-cgroup/" + name)
		if e != nil || value != expected {
			return fail()
		}
	}
	var st unix.Stat_t
	if unix.Stat("/run/ynx-cgroup", &st) != nil {
		return fail()
	}
	c.CgroupInode = strconv.FormatUint(st.Ino, 10)
	for kind, dest := range map[string]*string{"net": &c.NetNS, "mnt": &c.MountNS, "pid": &c.PIDNS, "user": &c.UserNS} {
		value, e := os.Readlink("/proc/self/ns/" + kind)
		original := os.Getenv("YNX_NETWORK_PARENT_NS_" + strings.ToUpper(kind))
		if e != nil || !linuxNamespace(kind, value) || !linuxNamespace(kind, original) || original == value {
			return fail()
		}
		*dest = value
	}
	status, e := linuxRead("/proc/self/status")
	if e != nil {
		return fail()
	}
	fields := map[string]string{}
	for _, line := range strings.Split(status, "\n") {
		key, value, ok := strings.Cut(line, ":")
		if ok {
			fields[key] = strings.TrimSpace(value)
		}
	}
	if fields["NoNewPrivs"] != "1" || fields["Seccomp"] != "2" {
		return fail()
	}
	for _, key := range []string{"CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"} {
		n, e := strconv.ParseUint(fields[key], 16, 64)
		if e != nil || n != 0 {
			return fail()
		}
	}
	c.NoNewPrivileges = true
	c.NoCapabilities = true
	// Verify the enforced socket policy, not merely the existence of a fresh
	// network namespace (which alone would still allow loopback communication).
	for _, family := range []int{unix.AF_INET, unix.AF_INET6, unix.AF_UNIX} {
		fd, e := unix.Socket(family, unix.SOCK_STREAM, 0)
		if e == nil {
			unix.Close(fd)
			return fail()
		}
		if !errors.Is(e, unix.EPERM) {
			return fail()
		}
	}
	for _, limit := range []struct {
		resource int
		value    uint64
	}{{unix.RLIMIT_CORE, 0}, {unix.RLIMIT_FSIZE, scratch}, {unix.RLIMIT_NOFILE, 32}} {
		var after unix.Rlimit
		if unix.Setrlimit(limit.resource, &unix.Rlimit{Cur: limit.value, Max: limit.value}) != nil || unix.Getrlimit(limit.resource, &after) != nil || after.Cur != limit.value || after.Max != limit.value {
			return fail()
		}
	}
	report := Report{Version: Version, Platform: "linux", CPUSeconds: "0", FileSizeBytes: strconv.FormatUint(scratch, 10), CoreBytes: "0", OpenFiles: "32", Processes: "32", ParentBound: true, MemoryHard: true, CPUShareHard: true, DiskQuotaHard: true, Linux: c, Challenge: challenge}
	file := os.NewFile(3, "worker-os-limits")
	if file == nil {
		return fail()
	}
	defer file.Close()
	info, e := file.Stat()
	if e != nil || info.Mode()&os.ModeNamedPipe == 0 {
		return fail()
	}
	raw, e := json.Marshal(report)
	if e != nil {
		return fail()
	}
	n, e := file.Write(append(raw, '\n'))
	if e != nil || n != len(raw)+1 {
		return fail()
	}
	// Bubblewrap's die-with-parent and PID namespace own process-death cleanup.
	// No saved host PID is imported into the worker or used for signal authority.
	return report, func() {}, nil
}
