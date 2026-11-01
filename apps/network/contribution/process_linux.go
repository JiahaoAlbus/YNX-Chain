//go:build linux

package contribution

import (
	"crypto/rand"
	"debug/elf"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

// A delegate is discovered only from this process's dedicated systemd service.
// No caller/job API accepts a cgroup, unit, PID, command or sandbox host path.
type linuxBackend struct {
	delegate *os.File
	path     string
	info     os.FileInfo
	sandbox  *PinnedWASMExecutor
}
type linuxOperation struct {
	directory  *os.File
	name, path string
	info       os.FileInfo
	backend    *linuxBackend
	limits     LinuxLimits
	filter     *os.File
	killFile   *os.File
	killMu     sync.Mutex
}

func linuxUnitParent(raw string) (string, error) {
	lines := strings.Split(strings.TrimSpace(raw), "\n")
	if len(lines) != 1 || !strings.HasPrefix(lines[0], "0::/") {
		return "", ErrUnsupported
	}
	own := strings.TrimPrefix(lines[0], "0::")
	if filepath.Clean(own) != own || filepath.Base(own) != "supervisor" {
		return "", ErrUnsupported
	}
	parent := filepath.Dir(own)
	unit := filepath.Base(parent)
	nonce := strings.TrimSuffix(strings.TrimPrefix(unit, "ynx-network-resource-"), ".service")
	b, e := hex.DecodeString(nonce)
	if e != nil || len(b) != 16 || hex.EncodeToString(b) != nonce || unit != "ynx-network-resource-"+nonce+".service" {
		return "", ErrUnsupported
	}
	for _, s := range strings.Split(strings.TrimPrefix(parent, "/"), "/") {
		if s == "" || s == "." || s == ".." {
			return "", ErrUnsupported
		}
	}
	return "/sys/fs/cgroup" + parent, nil
}
func linuxOpenDir(path string) (*os.File, error) {
	fd, e := unix.Open("/", unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_RDONLY, 0)
	if e != nil {
		return nil, e
	}
	for _, part := range strings.Split(strings.TrimPrefix(path, "/"), "/") {
		if part == "" || part == "." || part == ".." {
			unix.Close(fd)
			return nil, ErrInvalid
		}
		next, e := unix.Openat(fd, part, unix.O_NOFOLLOW|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_RDONLY, 0)
		unix.Close(fd)
		if e != nil {
			return nil, e
		}
		fd = next
	}
	return os.NewFile(uintptr(fd), path), nil
}
func linuxRead(dir *os.File, name string) (string, error) {
	fd, e := unix.Openat(int(dir.Fd()), name, unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_RDONLY, 0)
	if e != nil {
		return "", e
	}
	f := os.NewFile(uintptr(fd), name)
	defer f.Close()
	raw, e := io.ReadAll(io.LimitReader(f, 4097))
	if e != nil || len(raw) > 4096 {
		return "", ErrOSLimits
	}
	return strings.TrimSpace(string(raw)), nil
}
func linuxWrite(dir *os.File, name, value string) error {
	fd, e := unix.Openat(int(dir.Fd()), name, unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_WRONLY, 0)
	if e != nil {
		return e
	}
	f := os.NewFile(uintptr(fd), name)
	defer f.Close()
	n, e := f.WriteString(value)
	if e != nil {
		return e
	}
	if n != len(value) {
		return io.ErrShortWrite
	}
	return nil
}
func linuxCgroupDirectory(d *os.File, uid uint32) (os.FileInfo, error) {
	var fs unix.Statfs_t
	if unix.Fstatfs(int(d.Fd()), &fs) != nil || fs.Type != unix.CGROUP2_SUPER_MAGIC {
		return nil, ErrUnsupported
	}
	info, e := d.Stat()
	if e != nil || !info.IsDir() {
		return nil, ErrUnsupported
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || st.Uid != uid || info.Mode().Perm()&0022 != 0 {
		return nil, ErrUnsupported
	}
	return info, nil
}
func newLinuxBackend(pin string) (*linuxBackend, error) {
	if os.Geteuid() == 0 {
		return nil, ErrUnsupported
	}
	raw, e := os.ReadFile("/proc/self/cgroup")
	if e != nil {
		return nil, ErrUnsupported
	}
	path, e := linuxUnitParent(string(raw))
	if e != nil {
		return nil, e
	}
	d, e := linuxOpenDir(path)
	if e != nil {
		return nil, fmt.Errorf("%w: delegated cgroup unavailable", ErrUnsupported)
	}
	info, e := linuxCgroupDirectory(d, uint32(os.Geteuid()))
	if e != nil {
		d.Close()
		return nil, e
	}
	ok := false
	defer func() {
		if !ok {
			d.Close()
		}
	}()
	procs, e := linuxRead(d, "cgroup.procs")
	if e != nil || procs != "" {
		return nil, ErrUnsupported
	}
	available, e := linuxRead(d, "cgroup.controllers")
	if e != nil {
		return nil, ErrUnsupported
	}
	have := map[string]bool{}
	for _, name := range strings.Fields(available) {
		have[name] = true
	}
	if !have["cpu"] || !have["memory"] || !have["pids"] {
		return nil, fmt.Errorf("%w: delegated cpu memory pids unavailable", ErrUnsupported)
	}
	// Capture the non-setuid system installation. No install, namespace sysctl,
	// external-controller enablement or privileged fallback is attempted by this backend.
	sandbox, e := captureSystemSandbox(pin)
	if e != nil {
		return nil, e
	}
	ok = true
	return &linuxBackend{d, path, info, sandbox}, nil
}
func NewLinuxContainedWASMExecutor(path, pin, sandboxPin string) (*PinnedWASMExecutor, error) {
	backend, e := newLinuxBackend(sandboxPin)
	if e != nil {
		return nil, e
	}
	executor, e := NewPinnedWASMExecutor(path, pin)
	if e != nil {
		backend.close()
		return nil, e
	}
	f, err := elf.Open(executor.capture.path)
	if err != nil {
		executor.Close()
		backend.close()
		return nil, ErrInvalid
	}
	defer f.Close()
	for _, program := range f.Progs {
		if program.Type == elf.PT_INTERP {
			executor.Close()
			backend.close()
			return nil, fmt.Errorf("%w: static fixed worker required", ErrInvalid)
		}
	}
	needed, err := f.DynString(elf.DT_NEEDED)
	if err != nil || len(needed) > 0 {
		executor.Close()
		backend.close()
		return nil, ErrInvalid
	}
	executor.linux = backend
	return executor, nil
}
func (b *linuxBackend) checkPins() error { return b.sandbox.checkPins() }
func (b *linuxBackend) close() error {
	e := b.sandbox.Close()
	return errors.Join(e, b.delegate.Close())
}

func (b *linuxBackend) enableOwnControllers() error {
	procs, e := linuxRead(b.delegate, "cgroup.procs")
	if e != nil || procs != "" {
		return ErrOSLimits
	}
	ctrls, e := linuxRead(b.delegate, "cgroup.subtree_control")
	if e != nil {
		return ErrUnsupported
	}
	set := map[string]bool{}
	for _, c := range strings.Fields(ctrls) {
		set[c] = true
	}
	if !set["cpu"] || !set["memory"] || !set["pids"] {
		// Delegate= makes controllers available to the unit's sole writer;
		// it does not promise subtree_control is already enabled. This is
		// exactly our own verified, empty dedicated unit root, never a host
		// slice, user@ service or external ancestor. Do not move any process.
		available, e := linuxRead(b.delegate, "cgroup.controllers")
		if e != nil {
			return ErrUnsupported
		}
		have := map[string]bool{}
		for _, name := range strings.Fields(available) {
			have[name] = true
		}
		if !have["cpu"] || !have["memory"] || !have["pids"] {
			return fmt.Errorf("%w: delegated cpu memory pids unavailable", ErrUnsupported)
		}
		if e = linuxWrite(b.delegate, "cgroup.subtree_control", "+cpu +memory +pids"); e != nil {
			return fmt.Errorf("%w: own delegated controllers denied: %v", ErrUnsupported, e)
		}
		readback, e := linuxRead(b.delegate, "cgroup.subtree_control")
		if e != nil {
			return ErrOSLimits
		}
		enabled := map[string]bool{}
		for _, name := range strings.Fields(readback) {
			enabled[name] = true
		}
		if !enabled["cpu"] || !enabled["memory"] || !enabled["pids"] {
			return ErrOSLimits
		}
	}
	return nil
}
func (b *linuxBackend) prepare(limits Limits) (*linuxOperation, error) {
	ownRaw, readErr := os.ReadFile("/proc/self/cgroup")
	if readErr != nil {
		return nil, ErrUnsupported
	}
	currentParent, parentErr := linuxUnitParent(string(ownRaw))
	if parentErr != nil || currentParent != b.path {
		return nil, ErrOSLimits
	}
	l, e := linuxLimits(limits, uint64(os.Getpagesize()))
	if e != nil {
		return nil, e
	}
	if e = b.sandbox.checkPins(); e != nil {
		return nil, e
	}
	current, e := linuxOpenDir(b.path)
	if e != nil {
		return nil, ErrOSLimits
	}
	info, e := linuxCgroupDirectory(current, uint32(os.Geteuid()))
	current.Close()
	if e != nil || !os.SameFile(info, b.info) {
		return nil, ErrOSLimits
	}
	if e = b.enableOwnControllers(); e != nil {
		return nil, e
	}
	var nonce [16]byte
	if _, e = rand.Read(nonce[:]); e != nil {
		return nil, e
	}
	name := "job-" + hex.EncodeToString(nonce[:])
	if e = unix.Mkdirat(int(b.delegate.Fd()), name, 0700); e != nil {
		return nil, fmt.Errorf("%w: cannot create delegated leaf", ErrUnsupported)
	}
	fd, e := unix.Openat(int(b.delegate.Fd()), name, unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_DIRECTORY|unix.O_RDONLY, 0)
	if e != nil {
		return nil, ErrOSLimits
	}
	d := os.NewFile(uintptr(fd), name)
	info, e = linuxCgroupDirectory(d, uint32(os.Geteuid()))
	if e != nil {
		d.Close()
		return nil, e
	}
	op := &linuxOperation{directory: d, name: name, path: filepath.Join(b.path, name), info: info, backend: b, limits: l}
	fail := func(e error) (*linuxOperation, error) { return nil, errors.Join(e, op.cleanup()) }
	for _, p := range [][2]string{{"memory.max", strconv.FormatUint(l.MemoryMax, 10)}, {"memory.swap.max", "0"}, {"memory.oom.group", "1"}, {"cpu.max", l.cpuMax()}, {"cpu.max.burst", "0"}, {"pids.max", strconv.FormatUint(l.TasksMax, 10)}} {
		if e = linuxWrite(d, p[0], p[1]); e != nil {
			return fail(fmt.Errorf("%w: %s", ErrUnsupported, p[0]))
		}
		value, err := linuxRead(d, p[0])
		if err != nil || value != p[1] {
			return fail(ErrOSLimits)
		}
	}
	for _, name := range []string{"cgroup.events", "memory.peak", "memory.events", "pids.events", "cpu.stat", "cgroup.procs"} {
		if _, e = linuxRead(d, name); e != nil {
			return fail(fmt.Errorf("%w: required accounting missing", ErrUnsupported))
		}
	}
	// Acquire the original kill handle before starting. Do NOT invoke the
	// destructive cgroup.kill operation as a capability probe: kill is reserved
	// for stopping/draining this exact live leaf after a child was admitted.
	// CLOEXEC and exclusion from ExtraFiles keep it out of the sandbox.
	killFD, err := unix.Openat(int(d.Fd()), "cgroup.kill", unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_WRONLY, 0)
	if err != nil {
		return fail(fmt.Errorf("%w: cgroup.kill handle unavailable", ErrUnsupported))
	}
	op.killFile = os.NewFile(uintptr(killFD), "owned-cgroup-kill")
	filter, e := linuxSeccompFile()
	if e != nil {
		return fail(e)
	}
	op.filter = filter
	return op, nil
}
func (o *linuxOperation) configure(cmd *exec.Cmd, pipe *processLimitPipe, worker string) error {
	// Bubblewrap0.9 --unshare-all uses the user/cgroup TRY variants. Its
	// --disable-userns preflight instead requires explicit --unshare-user.
	// Require every namespace here: missing kernel support must fail closed.
	args := []string{"--unshare-user", "--unshare-pid", "--unshare-net", "--unshare-ipc", "--unshare-uts", "--unshare-cgroup", "--disable-userns", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--clearenv", "--setenv", "GOMAXPROCS", "1", "--setenv", "GOMEMLIMIT", strconv.FormatUint(o.limits.MemoryMax, 10) + "B", "--setenv", "LC_ALL", "C", "--setenv", "YNX_NETWORK_OS_LIMITS", "1", "--setenv", "YNX_NETWORK_LIMITS_CHALLENGE", pipe.challenge, "--setenv", "YNX_NETWORK_SCRATCH_BYTES", strconv.FormatUint(o.limits.ScratchBytes, 10)}
	for _, kind := range []string{"net", "mnt", "pid", "user"} {
		value, e := os.Readlink("/proc/self/ns/" + kind)
		if e != nil {
			return e
		}
		args = append(args, "--setenv", "YNX_NETWORK_PARENT_NS_"+strings.ToUpper(kind), value)
	}
	args = append(args, "--ro-bind", worker, "/worker", "--dir", "/run", "--ro-bind", o.path, "/run/ynx-cgroup", "--proc", "/proc", "--remount-ro", "/proc", "--dir", "/scratch")
	if o.limits.ScratchBytes > 0 {
		args = append(args, "--perms", "0700", "--size", strconv.FormatUint(o.limits.ScratchBytes, 10), "--tmpfs", "/scratch")
	}
	args = append(args, "--remount-ro", "/", "--chdir", "/scratch", "--seccomp", "4", "--", "/worker")
	args = append(args, cmd.Args[1:]...)
	cmd.Path = o.backend.sandbox.capture.path
	cmd.Args = append([]string{cmd.Path}, args...)
	cmd.Dir = o.backend.sandbox.dir
	cmd.Env = []string{"LC_ALL=C"}
	cmd.ExtraFiles = []*os.File{pipe.write, o.filter}
	cmd.SysProcAttr = &syscall.SysProcAttr{UseCgroupFD: true, CgroupFD: int(o.directory.Fd()), Pdeathsig: syscall.SIGKILL}
	return nil
}
func (o *linuxOperation) verify(c *OSControls) error {
	if c == nil || c.Platform != "linux" || !validOSControls(c) {
		return ErrOSLimits
	}
	l := c.Linux
	info, e := o.directory.Stat()
	if e != nil || !os.SameFile(info, o.info) {
		return ErrOSLimits
	}
	st := info.Sys().(*syscall.Stat_t)
	if l.CgroupInode != strconv.FormatUint(st.Ino, 10) || l.MemoryMax != strconv.FormatUint(o.limits.MemoryMax, 10) || l.CPUMax != o.limits.cpuMax() || l.ScratchBytes != strconv.FormatUint(o.limits.ScratchBytes, 10) {
		return ErrOSLimits
	}
	for _, pair := range [][2]string{{"net", l.NetNS}, {"mnt", l.MountNS}, {"pid", l.PIDNS}, {"user", l.UserNS}} {
		parent, e := os.Readlink("/proc/self/ns/" + pair[0])
		if e != nil || parent == pair[1] {
			return ErrOSLimits
		}
	}
	procs, e := linuxRead(o.directory, "cgroup.procs")
	if e != nil || procs == "" {
		return ErrOSLimits
	}
	return nil
}
func (o *linuxOperation) kill() error {
	o.killMu.Lock()
	defer o.killMu.Unlock()
	if o.killFile == nil {
		return ErrOSLimits
	}
	n, e := o.killFile.WriteString("1")
	if e != nil {
		return e
	}
	if n != 1 {
		return io.ErrShortWrite
	}
	return nil
}
func linuxNumbers(raw string) (map[string]uint64, error) {
	m := map[string]uint64{}
	for _, line := range strings.Split(raw, "\n") {
		parts := strings.Fields(line)
		if len(parts) != 2 {
			return nil, ErrOSLimits
		}
		if _, ok := m[parts[0]]; ok {
			return nil, ErrOSLimits
		}
		n, e := strconv.ParseUint(parts[1], 10, 64)
		if e != nil || strconv.FormatUint(n, 10) != parts[1] {
			return nil, ErrOSLimits
		}
		m[parts[0]] = n
	}
	return m, nil
}
func (o *linuxOperation) finish() (*LinuxGroupUsage, error) {
	// Always destroy only this live directory, including normal child completion,
	// so a descendant cannot outlive the owned wrapper or retain the leaf slot.
	if e := o.kill(); e != nil {
		return nil, e
	}
	deadline := time.Now().Add(time.Second)
	for {
		events, e := linuxRead(o.directory, "cgroup.events")
		if e != nil {
			return nil, e
		}
		v, e := linuxNumbers(events)
		if e != nil {
			return nil, e
		}
		if n, ok := v["populated"]; ok && n == 0 {
			break
		}
		if time.Now().After(deadline) {
			return nil, ErrOSLimits
		}
		time.Sleep(time.Millisecond)
	}
	cpuRaw, e := linuxRead(o.directory, "cpu.stat")
	if e != nil {
		return nil, e
	}
	cpu, e := linuxNumbers(cpuRaw)
	if e != nil {
		return nil, e
	}
	memRaw, e := linuxRead(o.directory, "memory.events")
	if e != nil {
		return nil, e
	}
	mem, e := linuxNumbers(memRaw)
	if e != nil {
		return nil, e
	}
	peakRaw, e := linuxRead(o.directory, "memory.peak")
	if e != nil {
		return nil, e
	}
	peak, e := strconv.ParseUint(peakRaw, 10, 64)
	if e != nil {
		return nil, e
	}
	for _, key := range []string{"user_usec", "system_usec", "throttled_usec"} {
		if _, ok := cpu[key]; !ok {
			return nil, ErrOSLimits
		}
	}
	if _, ok := mem["oom_kill"]; !ok {
		return nil, ErrOSLimits
	}
	pidsRaw, e := linuxRead(o.directory, "pids.events")
	if e != nil {
		return nil, e
	}
	pids, e := linuxNumbers(pidsRaw)
	if e != nil {
		return nil, e
	}
	denied, ok := pids["max"]
	if !ok {
		return nil, ErrOSLimits
	}
	return &LinuxGroupUsage{PidsDenied: denied, Source: "linux-cgroup-v2-kernel", UserMicros: cpu["user_usec"], SystemMicros: cpu["system_usec"], MemoryPeakBytes: peak, OOMKills: mem["oom_kill"], ThrottledMicros: cpu["throttled_usec"], Empty: true}, nil
}
func (o *linuxOperation) cleanup() error {
	if o.filter != nil {
		_ = o.filter.Close()
	}
	fd, e := unix.Openat(int(o.backend.delegate.Fd()), o.name, unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_DIRECTORY|unix.O_RDONLY, 0)
	if e != nil {
		return fmt.Errorf("%w: unknown cgroup leaf preserved", ErrOSLimits)
	}
	named := os.NewFile(uintptr(fd), o.name)
	info, e := named.Stat()
	named.Close()
	if e != nil || !os.SameFile(info, o.info) {
		return fmt.Errorf("%w: replaced cgroup leaf preserved", ErrOSLimits)
	}
	procs, e := linuxRead(o.directory, "cgroup.procs")
	if e != nil || procs != "" {
		return fmt.Errorf("%w: populated cgroup preserved", ErrOSLimits)
	}
	// No recursion, no persisted names, no signal/recovery on a later invocation.
	if e = unix.Unlinkat(int(o.backend.delegate.Fd()), o.name, unix.AT_REMOVEDIR); e != nil {
		return fmt.Errorf("%w: cgroup cleanup incomplete", ErrOSLimits)
	}
	var killErr error
	if o.killFile != nil {
		killErr = o.killFile.Close()
	}
	return errors.Join(killErr, o.directory.Close())
}

// Bubblewrap applies the filter after namespace construction, before exec.
// The worker may create Go threads, but no process forks, sockets, io_uring,
// namespace/mount mutations or tracing. x32/foreign syscall ABIs fail closed.
func linuxSeccompFile() (*os.File, error) {
	var arch uint32
	switch runtime.GOARCH {
	case "amd64":
		arch = unix.AUDIT_ARCH_X86_64
	case "arm64":
		arch = unix.AUDIT_ARCH_AARCH64
	default:
		return nil, ErrUnsupported
	}
	ins := []unix.SockFilter{{Code: unix.BPF_LD | unix.BPF_W | unix.BPF_ABS, K: 4}, {Code: unix.BPF_JMP | unix.BPF_JEQ | unix.BPF_K, Jt: 1, K: arch}, {Code: unix.BPF_RET | unix.BPF_K, K: unix.SECCOMP_RET_KILL_PROCESS}, {Code: unix.BPF_LD | unix.BPF_W | unix.BPF_ABS, K: 0}}
	addDeny := func(number int, errno uint32) {
		ins = append(ins, unix.SockFilter{Code: unix.BPF_JMP | unix.BPF_JEQ | unix.BPF_K, Jf: 1, K: uint32(number)}, unix.SockFilter{Code: unix.BPF_RET | unix.BPF_K, K: unix.SECCOMP_RET_ERRNO | errno})
	}
	if runtime.GOARCH == "amd64" {
		ins = append(ins, unix.SockFilter{Code: unix.BPF_JMP | unix.BPF_JSET | unix.BPF_K, Jf: 1, K: 0x40000000}, unix.SockFilter{Code: unix.BPF_RET | unix.BPF_K, K: unix.SECCOMP_RET_KILL_PROCESS})
	}
	for _, n := range []int{unix.SYS_SOCKET, unix.SYS_SOCKETPAIR, unix.SYS_CONNECT, unix.SYS_BIND, unix.SYS_LISTEN, unix.SYS_ACCEPT, unix.SYS_ACCEPT4, unix.SYS_IO_URING_SETUP, unix.SYS_IO_URING_ENTER, unix.SYS_IO_URING_REGISTER, unix.SYS_PTRACE, unix.SYS_PROCESS_VM_READV, unix.SYS_PROCESS_VM_WRITEV, unix.SYS_BPF, unix.SYS_PERF_EVENT_OPEN, unix.SYS_MOUNT, unix.SYS_UMOUNT2, unix.SYS_PIVOT_ROOT, unix.SYS_UNSHARE, unix.SYS_SETNS, unix.SYS_OPEN_TREE, unix.SYS_MOVE_MOUNT, unix.SYS_FSOPEN, unix.SYS_FSCONFIG, unix.SYS_FSMOUNT, unix.SYS_MOUNT_SETATTR, unix.SYS_SETHOSTNAME, unix.SYS_SETDOMAINNAME, unix.SYS_KEYCTL, unix.SYS_ADD_KEY, unix.SYS_REQUEST_KEY, unix.SYS_USERFAULTFD, unix.SYS_SCHED_SETSCHEDULER, unix.SYS_SCHED_SETATTR} {
		addDeny(n, uint32(unix.EPERM))
	}
	for _, n := range linuxForkSyscalls() {
		addDeny(n, uint32(unix.EPERM))
	}
	addDeny(unix.SYS_CLONE3, uint32(unix.ENOSYS))
	// clone flags argument0 low32; Go threads use CLONE_THREAD. The denylist is
	// additional to the empty filesystem and removed capabilities, not a claim
	// that seccomp alone is a sandbox.
	ins = append(ins, unix.SockFilter{Code: unix.BPF_JMP | unix.BPF_JEQ | unix.BPF_K, Jf: 4, K: unix.SYS_CLONE}, unix.SockFilter{Code: unix.BPF_LD | unix.BPF_W | unix.BPF_ABS, K: 16}, unix.SockFilter{Code: unix.BPF_JMP | unix.BPF_JSET | unix.BPF_K, Jt: 1, K: unix.CLONE_THREAD}, unix.SockFilter{Code: unix.BPF_RET | unix.BPF_K, K: unix.SECCOMP_RET_ERRNO | uint32(unix.EPERM)}, unix.SockFilter{Code: unix.BPF_RET | unix.BPF_K, K: unix.SECCOMP_RET_ALLOW}, unix.SockFilter{Code: unix.BPF_RET | unix.BPF_K, K: unix.SECCOMP_RET_ALLOW})
	f, e := os.CreateTemp("", "ynx-network-seccomp-")
	if e != nil {
		return nil, e
	}
	_ = os.Remove(f.Name())
	if e = binary.Write(f, binary.LittleEndian, ins); e != nil {
		f.Close()
		return nil, e
	}
	if _, e = f.Seek(0, 0); e != nil {
		f.Close()
		return nil, e
	}
	return f, nil
}
