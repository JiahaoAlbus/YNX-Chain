package contribution

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"runtime"
	"strconv"
	"time"
)

const osLimitsVersion = "YNX-NETWORK-WORKER-OS-LIMITS/v1"

var ErrOSLimits = errors.New("OS_LIMITS_UNAVAILABLE: fixed worker limit readback required")

// OSControls are per-execution kernel readbacks from the fixed pinned child.
// CPU seconds are readback only; the parent enforces a sampled CPU budget.
// File growth is not total disk quota.
// Hard RSS and CPU-share enforcement remain unavailable for this host mode.
type OSControls struct {
	Version       string         `json:"version"`
	Platform      string         `json:"platform"`
	CPUSeconds    string         `json:"cpuSeconds"`
	FileSizeBytes string         `json:"fileSizeBytes"`
	CoreBytes     string         `json:"coreBytes"`
	OpenFiles     string         `json:"openFiles"`
	Processes     string         `json:"processes"`
	ParentBound   bool           `json:"parentBound"`
	MemoryHard    bool           `json:"memoryHard"`
	CPUShareHard  bool           `json:"cpuShareHard"`
	DiskQuotaHard bool           `json:"diskQuotaHard"`
	Linux         *LinuxControls `json:"linux,omitempty"`
}
type ProcessUsage struct {
	Source            string           `json:"source"`
	UserMicros        uint64           `json:"userMicros"`
	SystemMicros      uint64           `json:"systemMicros"`
	PeakRSSBytes      uint64           `json:"peakRSSBytes"`
	ExitCode          int              `json:"exitCode"`
	ExitSignal        string           `json:"exitSignal,omitempty"`
	Waited            bool             `json:"waited"`
	HostKillRequested bool             `json:"hostKillRequested"`
	Controls          *OSControls      `json:"controls,omitempty"`
	Monitor           *MonitorUsage    `json:"monitor,omitempty"`
	Group             *LinuxGroupUsage `json:"group,omitempty"`
}
type MonitorUsage struct {
	UserMicros   uint64 `json:"userMicros"`
	SystemMicros uint64 `json:"systemMicros"`
	PeakRSSBytes uint64 `json:"peakRSSBytes"`
	Waited       bool   `json:"waited"`
}
type ContainmentSupport struct {
	Platform        string `json:"platform"`
	Mode            string `json:"mode"`
	CPU             string `json:"cpu"`
	Memory          string `json:"memory"`
	Disk            string `json:"disk"`
	Stop            string `json:"stop"`
	ProductionReady bool   `json:"productionReady"`
}

// A capability description is not a claim that a disabled helper ran a child.
func ProcessContainmentSupport() ContainmentSupport {
	s := ContainmentSupport{Platform: runtime.GOOS, Mode: "UNSUPPORTED_HOST_CONTAINMENT", CPU: "NO_OS_QUOTA", Memory: "NO_HOST_RSS_HARD_LIMIT", Disk: "NO_TOTAL_DISK_QUOTA", Stop: "OWNED_PROCESS_KILL_AND_WAIT"}
	if runtime.GOOS == "linux" {
		s.Mode = "LINUX_CGROUP_V2_REQUIRES_VERIFIED_DELEGATE_AND_BWRAP"
		s.CPU = "CGROUP_CPU_MAX_IF_VERIFIED"
		s.Memory = "CGROUP_MEMORY_MAX_SWAP_ZERO_IF_VERIFIED"
		s.Disk = "PRIVATE_BOUNDED_TMPFS_OR_READ_ONLY_IF_VERIFIED"
	}
	if runtime.GOOS == "darwin" {
		s.Mode = "PARTIAL_FIXED_WORKER_SAMPLED_CPU"
		s.CPU = "PROC_RUSAGE_SAMPLED_BUDGET_KILL_NOT_HARD_CPU_SHARE"
		s.Disk = "RLIMIT_FSIZE_ZERO_GROWTH_NOT_METADATA_QUOTA"
	}
	return s
}

// This factory does not enable production. Only the fixed source/capture pins
// plus fresh private FD3 readback admit input to a controlled Darwin worker.
func NewOSLimitedWASMExecutor(path, pin, monitorPath, monitorPin string) (*PinnedWASMExecutor, error) {
	if runtime.GOOS != "darwin" {
		return nil, ErrUnsupported
	}
	e, err := NewPinnedWASMExecutor(path, pin)
	if err != nil {
		return nil, err
	}
	monitor, err := capturePinnedProcess(monitorPath, monitorPin, processMonitorName)
	if err != nil {
		return nil, errors.Join(err, e.Close())
	}
	e.monitor = monitor
	e.requireOS = true
	return e, nil
}

type gatedProcessInput struct {
	ctx   context.Context
	ready <-chan struct{}
	input io.Reader
}

func (r gatedProcessInput) Read(raw []byte) (int, error) {
	select {
	case <-r.ctx.Done():
		return 0, r.ctx.Err()
	case <-r.ready:
		if err := r.ctx.Err(); err != nil {
			return 0, err
		}
		return r.input.Read(raw)
	}
}

type processLimitPipe struct {
	read, write *os.File
	challenge   string
	ready       chan struct{}
}

func newProcessLimitPipe() (*processLimitPipe, error) {
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return nil, err
	}
	r, w, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	return &processLimitPipe{r, w, hex.EncodeToString(nonce[:]), make(chan struct{})}, nil
}
func (p *processLimitPipe) close() { _ = p.read.Close(); _ = p.write.Close() }
func (p *processLimitPipe) verify(ctx context.Context, cpu, millis uint64) (*OSControls, error) {
	deadline := time.Now().Add(time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	if err := p.read.SetReadDeadline(deadline); err != nil {
		return nil, ErrOSLimits
	}
	raw, err := io.ReadAll(io.LimitReader(p.read, 1025))
	if err != nil || len(raw) > 1024 {
		return nil, ErrOSLimits
	}
	var response struct {
		OSControls
		Challenge string `json:"challenge"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&response) != nil || decoder.Decode(new(any)) != io.EOF || response.Challenge != p.challenge || !validOSControls(&response.OSControls) || (response.Platform == "darwin" && response.CPUSeconds != strconv.FormatUint((cpu*millis+999999)/1000000, 10)) {
		return nil, ErrOSLimits
	}
	canonical, err := json.Marshal(response)
	if err != nil || !bytes.Equal(bytes.TrimSpace(raw), canonical) {
		return nil, ErrOSLimits
	}
	return &response.OSControls, nil
}
func validOSControls(c *OSControls) bool {
	if c == nil {
		return false
	}
	if c.Platform == "linux" {
		return c.Version == osLimitsVersion && c.CPUSeconds == "0" && c.CoreBytes == "0" && c.OpenFiles == "32" && c.Processes == "32" && c.ParentBound && c.MemoryHard && c.CPUShareHard && c.DiskQuotaHard && validLinuxControls(c.Linux) && c.FileSizeBytes == c.Linux.ScratchBytes
	}
	if c.Linux != nil {
		return false
	}
	seconds, err := strconv.ParseUint(c.CPUSeconds, 10, 64)
	return err == nil && seconds >= 1 && seconds <= 5 && strconv.FormatUint(seconds, 10) == c.CPUSeconds && c.Version == osLimitsVersion && c.Platform == "darwin" && c.FileSizeBytes == "0" && c.CoreBytes == "0" && c.OpenFiles == "32" && c.Processes == "0" && c.ParentBound && !c.MemoryHard && !c.CPUShareHard && !c.DiskQuotaHard
}
func validProcessUsage(u *ProcessUsage) bool {
	// A five-second child cannot legitimately consume an hour of CPU. This
	// generous journal sanity bound also prevents sums of maxRecords children
	// from overflowing when later actual local observations are added.
	const maxMicros = uint64(time.Hour / time.Microsecond)
	groupValid := u == nil || u.Group == nil || (u.Source == "linux-wait4-wrapper-rusage" && u.Group.Source == "linux-cgroup-v2-kernel" && u.Group.Empty && u.Group.UserMicros <= maxMicros && u.Group.SystemMicros <= maxMicros && u.Group.OOMKills <= 32 && u.Group.PidsDenied <= 1000000000 && u.Group.ThrottledMicros <= maxMicros)
	return groupValid && (u == nil || ((u.Source == "darwin-wait4-rusage" || u.Source == "linux-wait4-wrapper-rusage") && u.Waited && u.UserMicros <= maxMicros && u.SystemMicros <= maxMicros && u.ExitCode >= -1 && u.ExitCode <= 255 && len(u.ExitSignal) <= 64 && (u.Controls == nil || validOSControls(u.Controls)) && (u.Monitor == nil || (u.Monitor.Waited && u.Monitor.UserMicros <= maxMicros && u.Monitor.SystemMicros <= maxMicros))))
}
func cloneProcessUsage(u *ProcessUsage) *ProcessUsage {
	if u == nil {
		return nil
	}
	v := *u
	if u.Group != nil {
		g := *u.Group
		v.Group = &g
	}
	if u.Monitor != nil {
		m := *u.Monitor
		v.Monitor = &m
	}
	if u.Controls != nil {
		c := *u.Controls
		if c.Linux != nil {
			l := *c.Linux
			c.Linux = &l
		}
		v.Controls = &c
	}
	return &v
}
