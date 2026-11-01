package contribution

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	processWorkerName = "ynx-network-task-worker"
	processCodeLimit  = 128 << 20
	processStderrMax  = 4096
)

type processFile struct {
	path string
	info os.FileInfo
	pin  [sha256.Size]byte
}

// PinnedWASMExecutor runs only a locally pinned, fixed interpreter executable.
// It neither selects a program from job JSON nor establishes job/Wallet/reward
// authority. The original worker owns its import-free fixed WASM execution;
// this host owns child lifetime, bounded I/O, and the executable byte binding.
type PinnedWASMExecutor struct {
	mu      sync.Mutex
	source  processFile
	capture processFile
	dir     string
	dirInfo os.FileInfo
	active  *processOperation
	stopped bool
	starts  uint64
	closed  bool
}

type processOperation struct {
	cancel context.CancelFunc
	done   chan struct{}
	child  bool
	read   uint64
}

func inspectProcessFile(path string, expected *processFile, pin [sha256.Size]byte) ([]byte, os.FileInfo, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: fixed worker unavailable", ErrInvalid)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0022 != 0 || info.Mode().Perm()&0111 == 0 ||
		info.Mode()&(os.ModeSetuid|os.ModeSetgid) != 0 || info.Size() <= 0 || info.Size() > processCodeLimit || !processCurrentOwner(info) {
		return nil, nil, fmt.Errorf("%w: unsafe fixed worker identity", ErrInvalid)
	}
	if expected != nil && (!os.SameFile(info, expected.info) || info.Mode() != expected.info.Mode() ||
		info.Size() != expected.info.Size() || !info.ModTime().Equal(expected.info.ModTime())) {
		return nil, nil, fmt.Errorf("%w: fixed worker identity changed", ErrInvalid)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: fixed worker open failed", ErrInvalid)
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) || opened.Mode() != info.Mode() || opened.Size() != info.Size() || !opened.ModTime().Equal(info.ModTime()) {
		return nil, nil, fmt.Errorf("%w: fixed worker replaced during open", ErrInvalid)
	}
	raw, err := io.ReadAll(io.LimitReader(file, processCodeLimit+1))
	if err != nil || int64(len(raw)) != info.Size() {
		return nil, nil, fmt.Errorf("%w: fixed worker capture failed", ErrInvalid)
	}
	after, statErr := file.Stat()
	named, nameErr := os.Lstat(path)
	if statErr != nil || nameErr != nil || !os.SameFile(info, after) || !os.SameFile(info, named) ||
		after.Mode() != info.Mode() || named.Mode() != info.Mode() || after.Size() != info.Size() || named.Size() != info.Size() ||
		!after.ModTime().Equal(info.ModTime()) || !named.ModTime().Equal(info.ModTime()) || sha256.Sum256(raw) != pin {
		return nil, nil, fmt.Errorf("%w: fixed worker independent digest or identity changed", ErrInvalid)
	}
	return raw, info, nil
}

// NewPinnedWASMExecutor captures exactly the independently pinned original
// worker bytes in a private immutable local executable. The original path AND
// the captured executable identity/digest are checked before and after every
// child. Capturing prevents a source-path rename between preflight and exec
// from substituting different code. Same-user filesystem access is not a
// cryptographic sandbox boundary; independent publisher authority is separate.
func NewPinnedWASMExecutor(path, independentSHA256 string) (result *PinnedWASMExecutor, err error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || filepath.Base(path) != processWorkerName ||
		len(independentSHA256) != sha256.Size*2 || strings.ToLower(independentSHA256) != independentSHA256 {
		return nil, ErrInvalid
	}
	physical, err := filepath.EvalSymlinks(path)
	if err != nil || physical != path {
		return nil, fmt.Errorf("%w: canonical fixed worker path required", ErrInvalid)
	}
	decoded, err := hex.DecodeString(independentSHA256)
	if err != nil || len(decoded) != sha256.Size {
		return nil, ErrInvalid
	}
	var pin [sha256.Size]byte
	copy(pin[:], decoded)
	raw, info, err := inspectProcessFile(path, nil, pin)
	if err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp("", "ynx-network-fixed-wasm-")
	if err != nil {
		return nil, err
	}
	ok := false
	temporary := dir
	directoryInfo, err := os.Lstat(temporary)
	if err != nil {
		return nil, err
	}
	var createdFile os.FileInfo
	defer func() {
		if !ok {
			if cleanupErr := cleanupProcessCapture(temporary, directoryInfo, createdFile, nil); cleanupErr != nil {
				err = errors.Join(err, cleanupErr)
			}
		}
	}()
	dir, err = filepath.EvalSymlinks(dir)
	if err != nil {
		return nil, err
	}
	if err = os.Chmod(dir, 0700); err != nil {
		return nil, err
	}
	directoryInfo, err = os.Lstat(dir)
	if err != nil {
		return nil, err
	}
	worker := filepath.Join(dir, processWorkerName)
	file, err := os.OpenFile(worker, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0500)
	if err != nil {
		return nil, err
	}
	createdFile, err = file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	_, writeErr := file.Write(raw)
	syncErr := file.Sync()
	closeErr := file.Close()
	if err = errors.Join(writeErr, syncErr, closeErr); err != nil {
		return nil, err
	}
	_, captured, err := inspectProcessFile(worker, nil, pin)
	if err != nil {
		return nil, err
	}
	source := processFile{path: path, info: info, pin: pin}
	if _, _, err = inspectProcessFile(path, &source, pin); err != nil {
		return nil, err
	}
	ok = true
	return &PinnedWASMExecutor{source: source, capture: processFile{path: worker, info: captured, pin: pin}, dir: dir, dirInfo: directoryInfo}, nil
}

func sameProcessDirectory(current, expected os.FileInfo) bool {
	return current != nil && expected != nil && current.IsDir() && current.Mode() == expected.Mode() &&
		current.Mode().Perm() == 0700 && os.SameFile(current, expected) && processCurrentOwner(current)
}

// Cleanup is deliberately non-recursive. A replaced directory, unknown entry,
// replaced capture or changed pinned bytes remain untouched for reconciliation.
// During a failed construction only the exact file descriptor we created may
// be removed; its incomplete contents are not treated as a finished pin.
func cleanupProcessCapture(dir string, expectedDir, createdFile os.FileInfo, pinned *processFile) error {
	named, err := os.Lstat(dir)
	if err != nil || !sameProcessDirectory(named, expectedDir) {
		return fmt.Errorf("%w: private worker directory identity changed; preserved", ErrInvalid)
	}
	directory, err := os.Open(dir)
	if err != nil {
		return fmt.Errorf("%w: private worker directory unavailable; preserved", ErrInvalid)
	}
	defer directory.Close()
	opened, err := directory.Stat()
	if err != nil || !sameProcessDirectory(opened, expectedDir) {
		return fmt.Errorf("%w: private worker directory replaced during cleanup; preserved", ErrInvalid)
	}
	entries, err := directory.ReadDir(-1)
	if err != nil {
		return fmt.Errorf("%w: private worker directory unreadable; preserved", ErrInvalid)
	}
	if createdFile == nil && len(entries) != 0 || createdFile != nil && (len(entries) != 1 || entries[0].Name() != processWorkerName) {
		return fmt.Errorf("%w: unknown worker directory entries preserved", ErrConflict)
	}
	if createdFile != nil {
		file := filepath.Join(dir, processWorkerName)
		current, err := os.Lstat(file)
		if err != nil || !current.Mode().IsRegular() || !os.SameFile(current, createdFile) ||
			current.Mode() != createdFile.Mode() || !processCurrentOwner(current) {
			return fmt.Errorf("%w: unknown replacement worker preserved", ErrInvalid)
		}
		if pinned != nil {
			if _, _, err := inspectProcessFile(file, pinned, pinned.pin); err != nil {
				return err
			}
		}
		named, err = os.Lstat(dir)
		current, fileErr := os.Lstat(file)
		if err != nil || fileErr != nil || !sameProcessDirectory(named, expectedDir) ||
			!os.SameFile(current, createdFile) || current.Mode() != createdFile.Mode() || !processCurrentOwner(current) {
			return fmt.Errorf("%w: capture ownership changed during cleanup; preserved", ErrInvalid)
		}
		// Resolve deletion relative to the verified open original directory, not
		// a saved PID or a potentially replaced parent path.
		if err := processUnlinkCapture(directory); err != nil {
			return fmt.Errorf("%w: known capture could not be removed", ErrConflict)
		}
	}
	named, err = os.Lstat(dir)
	if err != nil || !sameProcessDirectory(named, expectedDir) {
		return fmt.Errorf("%w: worker directory changed during cleanup; preserved", ErrInvalid)
	}
	if err := os.Remove(dir); err != nil {
		return fmt.Errorf("%w: worker directory is not empty or could not be removed; preserved", ErrConflict)
	}
	return nil
}

func processLimits(input int, limits Limits) (cpu, memory, millis uint64, err error) {
	for _, value := range []string{limits.CPUMilli, limits.MemoryBytes, limits.StorageBytes, limits.EgressBytes, limits.DurationMillis} {
		if len(value) > 20 {
			return 0, 0, 0, ErrInvalid
		}
	}
	cpu, e1 := strictUint(limits.CPUMilli)
	memory, e2 := strictUint(limits.MemoryBytes)
	storage, e3 := strictUint(limits.StorageBytes)
	egress, e4 := strictUint(limits.EgressBytes)
	millis, e5 := strictUint(limits.DurationMillis)
	if e1 != nil || e2 != nil || e3 != nil || e4 != nil || e5 != nil {
		return 0, 0, 0, ErrInvalid
	}
	if input <= 0 || input > HistogramMaxInputBytes || cpu == 0 || cpu > 1000 || memory < HistogramMemoryBytes ||
		memory > MaxMemoryBytes || millis == 0 || millis > MaxDurationMillis || storage != 0 || egress != 0 {
		return 0, 0, 0, ErrLimit
	}
	return cpu, memory, millis, nil
}

type processOutput struct {
	data     []byte
	limit    int
	overflow bool
	cancel   context.CancelFunc
}

func (w *processOutput) Write(raw []byte) (int, error) {
	if len(raw) > w.limit-len(w.data) {
		w.overflow = true
		w.cancel()
		return 0, ErrLimit
	}
	w.data = append(w.data, raw...)
	return len(raw), nil
}

type processInput struct {
	reader   *bytes.Reader
	read     uint64
	progress func(uint64)
}

func (r *processInput) Read(raw []byte) (int, error) {
	n, err := r.reader.Read(raw)
	r.read += uint64(n)
	if r.progress != nil {
		r.progress(r.read)
	}
	return n, err
}

// Execute returns untrusted counts for the Runner's separate independent
// recomputation. CPU/memory flags and GOMEMLIMIT are bounded worker budgets,
// not OS-enforced CPU service or an economic/reward proof. On any error output
// is nil, with locally measured stdin bytes and wall time retained when started.
func (e *PinnedWASMExecutor) Execute(ctx context.Context, input []byte, limits Limits) ([]byte, Usage, error) {
	var usage Usage
	if e == nil || ctx == nil {
		return nil, usage, ErrInvalid
	}
	_, memory, millis, err := processLimits(len(input), limits)
	if err != nil {
		return nil, usage, err
	}
	if err = ctx.Err(); err != nil {
		return nil, usage, err
	}
	opCtx, cancel := context.WithTimeout(ctx, time.Duration(millis)*time.Millisecond)
	defer cancel()
	e.mu.Lock()
	if e.stopped {
		e.mu.Unlock()
		return nil, usage, ErrStopped
	}
	if e.active != nil {
		e.mu.Unlock()
		return nil, usage, ErrCapacity
	}
	op := &processOperation{cancel: cancel, done: make(chan struct{})}
	e.active = op
	e.mu.Unlock()
	defer func() {
		e.mu.Lock()
		e.active = nil
		close(op.done)
		e.mu.Unlock()
	}()
	if _, _, err = inspectProcessFile(e.source.path, &e.source, e.source.pin); err != nil {
		return nil, usage, err
	}
	if _, _, err = inspectProcessFile(e.capture.path, &e.capture, e.capture.pin); err != nil {
		return nil, usage, err
	}
	if err = opCtx.Err(); err != nil {
		return nil, usage, err
	}
	stdin := &processInput{reader: bytes.NewReader(input), progress: func(read uint64) { e.mu.Lock(); op.read = read; e.mu.Unlock() }}
	stdout := &processOutput{limit: HistogramOutputBytes, cancel: cancel}
	stderr := &processOutput{limit: processStderrMax, cancel: cancel}
	command := exec.CommandContext(opCtx, e.capture.path,
		"--bytes", strconv.Itoa(len(input)), "--cpu-milli", limits.CPUMilli,
		"--memory-bytes", limits.MemoryBytes, "--duration-ms", limits.DurationMillis)
	command.Dir = e.dir
	command.Env = []string{"GOMAXPROCS=1", "GOMEMLIMIT=" + strconv.FormatUint(memory, 10) + "B", "LC_ALL=C"}
	command.Stdin, command.Stdout, command.Stderr = stdin, stdout, stderr
	command.WaitDelay = 250 * time.Millisecond
	started := time.Now()
	// Always call Wait after a successful Start, including cancellation. Keep the
	// sole active admission slot until the actual process and I/O have returned.
	runErr := command.Start()
	if runErr == nil {
		e.mu.Lock()
		op.child = true
		if e.starts != ^uint64(0) {
			e.starts++
		}
		e.mu.Unlock()
		runErr = command.Wait()
	}
	usage.BytesRead = stdin.read
	usage.WallMicros = uint64(time.Since(started).Microseconds())
	if _, _, err = inspectProcessFile(e.source.path, &e.source, e.source.pin); err != nil {
		return nil, usage, err
	}
	if _, _, err = inspectProcessFile(e.capture.path, &e.capture, e.capture.pin); err != nil {
		return nil, usage, err
	}
	if stdout.overflow || stderr.overflow {
		return nil, usage, ErrLimit
	}
	if opCtx.Err() != nil {
		return nil, usage, opCtx.Err()
	}
	if runErr != nil || len(stderr.data) != 0 || len(stdout.data) != HistogramOutputBytes {
		return nil, usage, fmt.Errorf("%w: fixed WASM child failed or returned invalid output", ErrInvalid)
	}
	return append([]byte(nil), stdout.data...), usage, nil
}

// LocalProcess reports only owned-child admission and bytes read from this
// adapter's input. It neither exposes PID control nor claims guest progress or
// service verification. The child remains occupied until Wait has completed.
func (e *PinnedWASMExecutor) LocalProcess() (occupied, childStarted bool, inputRead uint64) {
	if e == nil {
		return false, false, 0
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.active == nil {
		return false, false, 0
	}
	return true, e.active.child, e.active.read
}

// Executions is the process-local number of successful actual child Starts.
// It proves neither completed work nor verified CPU/economic service and is
// never restored from a receipt, worker output or a caller-supplied counter.
func (e *PinnedWASMExecutor) Executions() uint64 {
	if e == nil {
		return 0
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.starts
}

// Stop seals this executor, cancels only its owned operation and waits for its
// actual child/pipe completion. A timed-out stop leaves admission sealed and
// preserves occupancy until Execute's Wait returns; it never restores a PID.
func (e *PinnedWASMExecutor) Stop(ctx context.Context) error {
	if e == nil || ctx == nil {
		return ErrInvalid
	}
	e.mu.Lock()
	e.stopped = true
	op := e.active
	if op != nil {
		op.cancel()
	}
	e.mu.Unlock()
	if op != nil {
		select {
		case <-op.done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

// Close releases only this constructor's private captured executable after no
// child can still use it. Original pinned code and other app data are preserved.
func (e *PinnedWASMExecutor) Close() error {
	if e == nil {
		return nil
	}
	if err := e.Stop(context.Background()); err != nil {
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return nil
	}
	if err := cleanupProcessCapture(e.dir, e.dirInfo, e.capture.info, &e.capture); err != nil {
		return err
	}
	e.closed = true
	return nil
}
