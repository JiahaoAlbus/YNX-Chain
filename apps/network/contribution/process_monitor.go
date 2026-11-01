package contribution

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"strconv"
	"sync/atomic"
	"time"
)

const monitorVersion = "YNX-NETWORK-RESOURCE-MONITOR/v1"

type monitorEvent struct {
	Version      string `json:"version"`
	Phase        string `json:"phase"`
	Challenge    string `json:"challenge"`
	PID          string `json:"pid"`
	Parent       string `json:"parent"`
	Start        string `json:"start"`
	UserMicros   string `json:"userMicros"`
	SystemMicros string `json:"systemMicros"`
	RSSBytes     string `json:"rssBytes"`
}
type processMonitor struct {
	command  *exec.Cmd
	cancel   context.CancelFunc
	pipe     *os.File
	done     chan struct{}
	fault    atomic.Bool
	limited  atomic.Bool
	stopping atomic.Bool
	event    monitorEvent // terminal event; only read after done
	stderr   *processOutput
}

func (e *PinnedWASMExecutor) checkPins() error {
	if _, _, err := inspectProcessFile(e.source.path, &e.source, e.source.pin); err != nil {
		return err
	}
	_, _, err := inspectProcessFile(e.capture.path, &e.capture, e.capture.pin)
	return err
}
func (m *processMonitor) readEvent(reader *bufio.Reader, challenge string, pid int, start string) (monitorEvent, error) {
	var event monitorEvent
	raw, err := reader.ReadSlice('\n')
	if err != nil || len(raw) > 1024 {
		return event, ErrOSLimits
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&event) != nil || d.Decode(new(any)) != io.EOF {
		return event, ErrOSLimits
	}
	canonical, err := json.Marshal(event)
	if err != nil || !bytes.Equal(bytes.TrimSpace(raw), canonical) || event.Version != monitorVersion || event.Challenge != challenge || event.PID != strconv.Itoa(pid) || event.Parent != strconv.Itoa(os.Getpid()) || (start != "" && event.Start != start) {
		return event, ErrOSLimits
	}
	for _, s := range []string{event.Start, event.UserMicros, event.SystemMicros, event.RSSBytes} {
		n, err := strconv.ParseUint(s, 10, 64)
		if err != nil || strconv.FormatUint(n, 10) != s {
			return event, ErrOSLimits
		}
	}
	if event.Start == "0" {
		return event, ErrOSLimits
	}
	return event, nil
}

// Only the direct worker's live handle is passed here. The native sampler has
// no signal authority; a terminal event cancels the original owned command.
func (e *PinnedWASMExecutor) startMonitor(ctx context.Context, pid int, cpu, millis uint64, challenge string, stopWorker context.CancelFunc) (*processMonitor, error) {
	if e.monitor == nil {
		return nil, ErrOSLimits
	}
	if err := e.monitor.checkPins(); err != nil {
		return nil, err
	}
	r, w, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	mctx, mcancel := context.WithCancel(ctx)
	m := &processMonitor{cancel: mcancel, pipe: r, done: make(chan struct{})}
	m.stderr = &processOutput{limit: processStderrMax, cancel: stopWorker}
	m.command = exec.CommandContext(mctx, e.monitor.capture.path, "--pid", strconv.Itoa(pid), "--parent", strconv.Itoa(os.Getpid()), "--cpu-micros", strconv.FormatUint(cpu*millis, 10), "--duration-ms", strconv.FormatUint(millis, 10), "--challenge", challenge)
	m.command.Dir = e.monitor.dir
	m.command.Env = []string{"LC_ALL=C"}
	m.command.Stdout = w
	m.command.Stderr = m.stderr
	m.command.WaitDelay = 250 * time.Millisecond
	if err = m.command.Start(); err != nil {
		mcancel()
		_ = r.Close()
		_ = w.Close()
		return nil, err
	}
	_ = w.Close()
	deadline := time.Now().Add(time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	_ = r.SetReadDeadline(deadline)
	reader := bufio.NewReaderSize(r, 1024)
	first, err := m.readEvent(reader, challenge, pid, "")
	if err != nil || first.Phase != "ready" {
		// The process did start: preserve its own wait4 accounting and wait
		// exactly once in finish, even when no input may be released.
		mcancel()
		_ = r.Close()
		close(m.done)
		if err == nil && (first.Phase == "cpu_limit" || first.Phase == "wall_limit") {
			m.limited.Store(true)
			return m, ErrLimit
		}
		m.fault.Store(true)
		return m, ErrOSLimits
	}
	_ = r.SetReadDeadline(time.Time{})
	go func() {
		defer close(m.done)
		terminal, err := m.readEvent(reader, challenge, pid, first.Start)
		m.event = terminal
		if !m.stopping.Load() {
			if err != nil {
				m.fault.Store(true)
				stopWorker()
			} else {
				switch terminal.Phase {
				case "cpu_limit", "wall_limit":
					m.limited.Store(true)
					stopWorker()
				case "exited":
				default:
					m.fault.Store(true)
					stopWorker()
				}
			}
		}
	}()
	return m, nil
}
func (m *processMonitor) finish() *MonitorUsage {
	if m == nil {
		return nil
	}
	m.stopping.Store(true)
	m.cancel()
	_ = m.pipe.Close()
	_ = m.command.Wait()
	<-m.done
	u := measureProcess(m.command.ProcessState, nil, false)
	if u == nil {
		return nil
	}
	return &MonitorUsage{UserMicros: u.UserMicros, SystemMicros: u.SystemMicros, PeakRSSBytes: u.PeakRSSBytes, Waited: u.Waited}
}
