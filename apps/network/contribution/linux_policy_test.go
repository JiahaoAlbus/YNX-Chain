package contribution

import (
	"context"
	"errors"
	"runtime"
	"testing"
)

func TestLinuxResourcePolicyBoundsAndWire(t *testing.T) {
	l := Limits{CPUMilli: "1", MemoryBytes: "9000001", StorageBytes: "1048576", EgressBytes: "0", DurationMillis: "5000"}
	p, e := linuxLimits(l, 4096)
	if e != nil || p.MemoryMax > 9000001 || p.MemoryMax%4096 != 0 || p.CPUQuotaMicros != 1000 || p.CPUPeriodMicros != 1000000 || p.ScratchBytes != 1048576 || p.TasksMax != 32 {
		t.Fatalf("limits: %+v %v", p, e)
	}
	for _, edit := range []func(*Limits){func(l *Limits) { l.StorageBytes = "1048577" }, func(l *Limits) { l.StorageBytes = "01" }, func(l *Limits) { l.StorageBytes = "4097" }, func(l *Limits) { l.CPUMilli = "0" }, func(l *Limits) { l.CPUMilli = "1001" }, func(l *Limits) { l.MemoryBytes = "8388608" }, func(l *Limits) { l.EgressBytes = "1" }, func(l *Limits) { l.DurationMillis = "5001" }} {
		bad := l
		edit(&bad)
		if _, e := linuxLimits(bad, 4096); e == nil {
			t.Fatalf("invalid bound admitted: %+v", bad)
		}
	}
	for _, page := range []uint64{0, 1, 4095, 8193, 131072} {
		if _, e := linuxLimits(l, page); e == nil {
			t.Fatalf("invalid page=%d", page)
		}
	}
	if validScratch("verify_chunk", "4096") || !validScratch(PublicBlockHistogramKind, "4096") || !validScratch("verify_chunk", "0") {
		t.Fatal("scratch widened legacy work kind")
	}
	if runtime.GOOS != "linux" {
		e, err := NewLinuxContainedWASMExecutor("/never-read", "", " ")
		if e != nil || !errors.Is(err, ErrUnsupported) {
			t.Fatal("nonLinux admitted backend")
		}
	}
}
func TestLinuxKernelObservationsAreSeparateAndCloned(t *testing.T) {
	c := &OSControls{Version: osLimitsVersion, Platform: "linux", CPUSeconds: "0", FileSizeBytes: "0", CoreBytes: "0", OpenFiles: "32", Processes: "32", ParentBound: true, MemoryHard: true, CPUShareHard: true, DiskQuotaHard: true, Linux: &LinuxControls{MemoryMax: "8998912", SwapMax: "0", CPUMax: "100000 1000000", PidsMax: "32", ScratchBytes: "0", ScratchReadOnly: true, RootReadOnly: true, CgroupReadOnly: true, CgroupInode: "123", NetNS: "net:[1]", MountNS: "mnt:[2]", PIDNS: "pid:[3]", UserNS: "user:[4]", NoNewPrivileges: true, NoCapabilities: true}}
	u := &ProcessUsage{Source: "linux-wait4-wrapper-rusage", Waited: true, ExitCode: 0, Controls: c, Group: &LinuxGroupUsage{Source: "linux-cgroup-v2-kernel", UserMicros: 100, Empty: true}}
	if !validProcessUsage(u) || !validOSControls(c) {
		t.Fatal("valid independent wire rejected")
	}
	v := cloneProcessUsage(u)
	v.Controls.Linux.MemoryMax = "max"
	v.Group.UserMicros = 999
	if u.Controls.Linux.MemoryMax != "8998912" || u.Group.UserMicros != 100 {
		t.Fatal("kernel observations alias clone")
	}
	for _, edit := range []func(*ProcessUsage){func(x *ProcessUsage) { x.Group.Source = "guest" }, func(x *ProcessUsage) { x.Group.Empty = false }, func(x *ProcessUsage) { x.Group.UserMicros = ^uint64(0) }, func(x *ProcessUsage) { x.Controls.Linux.SwapMax = "max" }, func(x *ProcessUsage) { x.Controls.Linux.CPUMax = "max 1000000" }, func(x *ProcessUsage) { x.Controls.Linux.NoCapabilities = false }, func(x *ProcessUsage) { x.Controls.Linux.RootReadOnly = false }, func(x *ProcessUsage) { x.Controls.Linux.ScratchBytes = "1" }, func(x *ProcessUsage) { x.Controls.Linux.NetNS = "net:[01]" }} {
		v := cloneProcessUsage(u)
		edit(v)
		if validProcessUsage(v) {
			t.Fatalf("invalid kernel observation admitted: %+v", v)
		}
	}
	// Normal production construction still cannot execute any work.
	r, err := NewDisabled(t.TempDir() + "/journal.json")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	m := r.VerifyResourceMeter()
	if m.ActiveWorkers != 0 || m.CPUServiceVerified || m.Rewards != "NOT_AUTHORIZED" {
		t.Fatalf("default=%+v", m)
	}
	if err = r.StopContribution(context.Background()); err != nil {
		t.Fatal(err)
	}
}
