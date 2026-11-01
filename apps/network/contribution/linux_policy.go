package contribution

import (
	"fmt"
	"strconv"
	"strings"
)

const linuxCPUPeriod = uint64(1000000)
const linuxTasksMax = uint64(32)
const MaxScratchBytes = uint64(1 << 20)

// LinuxLimits describes upper bounds, never a host capability assertion.
// Scratch is private tmpfs, charged to the same memory cgroup, not host disk.
type LinuxLimits struct {
	MemoryMax       uint64 `json:"memoryMax"`
	CPUQuotaMicros  uint64 `json:"cpuQuotaMicros"`
	CPUPeriodMicros uint64 `json:"cpuPeriodMicros"`
	TasksMax        uint64 `json:"tasksMax"`
	ScratchBytes    uint64 `json:"scratchBytes"`
}

func linuxLimits(limits Limits, page uint64) (LinuxLimits, error) {
	cpu, e1 := strictUint(limits.CPUMilli)
	mem, e2 := strictUint(limits.MemoryBytes)
	scratch, e3 := strictUint(limits.StorageBytes)
	ms, e4 := strictUint(limits.DurationMillis)
	if e1 != nil || e2 != nil || e3 != nil || e4 != nil || page < 4096 || page > 65536 || page&(page-1) != 0 || cpu == 0 || cpu > 1000 || mem < HistogramMemoryBytes || mem > MaxMemoryBytes || ms == 0 || ms > MaxDurationMillis || scratch > MaxScratchBytes || scratch%page != 0 || limits.EgressBytes != "0" {
		return LinuxLimits{}, ErrLimit
	}
	return LinuxLimits{mem / page * page, cpu * 1000, linuxCPUPeriod, linuxTasksMax, scratch}, nil
}
func validScratch(kind, raw string) bool {
	n, e := strictUint(raw)
	return e == nil && (n == 0 || (kind == PublicBlockHistogramKind && n <= MaxScratchBytes && n%4096 == 0))
}

type LinuxControls struct {
	MemoryMax       string `json:"memoryMax"`
	SwapMax         string `json:"swapMax"`
	CPUMax          string `json:"cpuMax"`
	PidsMax         string `json:"pidsMax"`
	ScratchBytes    string `json:"scratchBytes"`
	ScratchReadOnly bool   `json:"scratchReadOnly"`
	RootReadOnly    bool   `json:"rootReadOnly"`
	CgroupReadOnly  bool   `json:"cgroupReadOnly"`
	CgroupInode     string `json:"cgroupInode"`
	NetNS           string `json:"netNS"`
	MountNS         string `json:"mountNS"`
	PIDNS           string `json:"pidNS"`
	UserNS          string `json:"userNS"`
	NoNewPrivileges bool   `json:"noNewPrivileges"`
	NoCapabilities  bool   `json:"noCapabilities"`
}
type LinuxGroupUsage struct {
	Source          string `json:"source"`
	UserMicros      uint64 `json:"userMicros"`
	SystemMicros    uint64 `json:"systemMicros"`
	MemoryPeakBytes uint64 `json:"memoryPeakBytes"`
	OOMKills        uint64 `json:"oomKills"`
	ThrottledMicros uint64 `json:"throttledMicros"`
	Empty           bool   `json:"empty"`
	PidsDenied      uint64 `json:"pidsDenied"`
}

func canonicalNamespace(kind, value string) bool {
	prefix := kind + ":["
	if !strings.HasPrefix(value, prefix) || !strings.HasSuffix(value, "]") {
		return false
	}
	s := strings.TrimSuffix(strings.TrimPrefix(value, prefix), "]")
	n, e := strconv.ParseUint(s, 10, 64)
	return e == nil && n > 0 && strconv.FormatUint(n, 10) == s
}
func validLinuxControls(c *LinuxControls) bool {
	if c == nil || c.SwapMax != "0" || c.PidsMax != "32" || !c.RootReadOnly || !c.CgroupReadOnly || !c.NoNewPrivileges || !c.NoCapabilities {
		return false
	}
	mem, e := strictUint(c.MemoryMax)
	if e != nil || mem < HistogramMemoryBytes || mem > MaxMemoryBytes {
		return false
	}
	scratch, e := strictUint(c.ScratchBytes)
	if e != nil || scratch > MaxScratchBytes || scratch%4096 != 0 || c.ScratchReadOnly != (scratch == 0) {
		return false
	}
	parts := strings.Split(c.CPUMax, " ")
	if len(parts) != 2 || parts[1] != "1000000" {
		return false
	}
	quota, e := strictUint(parts[0])
	if e != nil || quota < 1000 || quota > 1000000 || quota%1000 != 0 {
		return false
	}
	inode, e := strictUint(c.CgroupInode)
	return e == nil && inode > 0 && canonicalNamespace("net", c.NetNS) && canonicalNamespace("mnt", c.MountNS) && canonicalNamespace("pid", c.PIDNS) && canonicalNamespace("user", c.UserNS)
}
func (l LinuxLimits) cpuMax() string {
	return fmt.Sprintf("%d %d", l.CPUQuotaMicros, l.CPUPeriodMicros)
}
