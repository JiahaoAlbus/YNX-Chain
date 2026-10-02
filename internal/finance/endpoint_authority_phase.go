package finance

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// Optional bounded metadata pipe. A missing/invalid stream never changes the
// authority result. The original child deadline and stdout/stderr stay intact.
func attachAuthorityPhases(command *exec.Cmd) func() (string, int64, string) {
	unavailable := func() (string, int64, string) { return "unknown", 0, "unavailable" }
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		return unavailable
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		return unavailable
	}
	command.ExtraFiles = []*os.File{writer}
	command.Env = append(command.Env, "YNX_FINANCE_AUTHORITY_PHASE_FD=3")
	var mu sync.Mutex
	var raw []byte
	invalid := false
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer reader.Close()
		buf := make([]byte, 512)
		for {
			n, err := reader.Read(buf)
			if n > 0 {
				mu.Lock()
				if len(raw)+n > 4096 {
					invalid = true
					mu.Unlock()
					return
				}
				raw = append(raw, buf[:n]...)
				mu.Unlock()
			}
			if err != nil {
				return
			}
		}
	}()
	return func() (string, int64, string) {
		writer.Close()
		// Descendants cannot hold a telemetry descriptor and delay the decision.
		select {
		case <-done:
		case <-time.After(5 * time.Millisecond):
			reader.Close()
			<-done
		}
		mu.Lock()
		defer mu.Unlock()
		if invalid {
			return "unknown", 0, "invalid"
		}
		return decodeAuthorityPhases(raw)
	}
}

func decodeAuthorityPhases(raw []byte) (string, int64, string) {
	bad := func() (string, int64, string) { return "unknown", 0, "invalid" }
	if len(raw) == 0 {
		return "unknown", 0, "none"
	}
	if len(raw) > 4096 || !utf8.Valid(raw) || raw[len(raw)-1] != '\n' {
		return bad()
	}
	lines := bytes.Split(raw[:len(raw)-1], []byte{'\n'})
	if len(lines) > 24 {
		return bad()
	}
	phase := "unknown"
	var elapsed int64
	for i, line := range lines {
		if len(line) > 256 {
			return bad()
		}
		d := json.NewDecoder(bytes.NewReader(line))
		d.UseNumber()
		start, e := d.Token()
		if e != nil || start != json.Delim('{') {
			return bad()
		}
		fields := map[string]any{}
		for d.More() {
			key, e := d.Token()
			name, ok := key.(string)
			if e != nil || !ok {
				return bad()
			}
			if _, exists := fields[name]; exists {
				return bad()
			}
			switch name {
			case "schemaVersion", "phase", "elapsedMilliseconds":
			default:
				return bad()
			}
			v, e := d.Token()
			if e != nil {
				return bad()
			}
			fields[name] = v
		}
		end, e := d.Token()
		if e != nil || end != json.Delim('}') || len(fields) != 3 {
			return bad()
		}
		if _, e = d.Token(); e != io.EOF {
			return bad()
		}
		if fields["schemaVersion"] != "ynx-finance-authority-phase/v1" {
			return bad()
		}
		p, ok := fields["phase"].(string)
		if !ok || !authorityPhaseAllowed(p) {
			return bad()
		}
		number, ok := fields["elapsedMilliseconds"].(json.Number)
		if !ok {
			return bad()
		}
		text := string(number)
		if text == "" || len(text) > 5 || strings.HasPrefix(text, "0") && text != "0" {
			return bad()
		}
		for _, ch := range text {
			if ch < '0' || ch > '9' {
				return bad()
			}
		}
		ms, e := strconv.ParseInt(text, 10, 64)
		if e != nil || ms < 0 || ms > 60000 || i > 0 && ms < elapsed {
			return bad()
		}
		phase, elapsed = p, ms
	}
	return phase, elapsed, "available"
}
func authorityPhaseAllowed(p string) bool {
	switch p {
	case "cli-ready", "files-read", "checkpoint-inspect", "clock-fetch", "clock-body", "clock-persist", "clock-ready", "authority-verify", "authority-checkpoint", "history-scan", "history-verify", "root-anchor-scan", "root-anchor-verify", "done":
		return true
	}
	return false
}
