//go:build linux

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/spf13/cobra"
)

// These are private file-control unit tests, not running Node/network evidence.
// The only production getter is the separate typed, build-tagged adapter.
type wireLiveControlNode struct {
	running atomic.Bool
	quit    chan struct{}
}

func (n *wireLiveControlNode) IsRunning() bool       { return n.running.Load() }
func (n *wireLiveControlNode) Quit() <-chan struct{} { return n.quit }

func newWireLiveControlTest(t *testing.T) (*operatorWireLiveControl, *wireLiveControlNode, *atomic.Uint64) {
	t.Helper()
	path := filepath.Join(wireObservationTestDir(t), "control")
	if e := os.Mkdir(path, 0700); e != nil {
		t.Fatal(e)
	}
	root, dir, parent, err := openOperatorWireLiveDirectory(path, true)
	if err != nil {
		t.Fatal(err)
	}
	id, err := operatorWireLiveProcessIdentity()
	if err != nil {
		t.Fatal(err)
	}
	c := &operatorWireLiveControl{path: path, root: root, directory: dir, parent: parent, identity: id, done: make(chan struct{})}
	n := &wireLiveControlNode{quit: make(chan struct{})}
	calls := new(atomic.Uint64)
	get := func() (operatorWireLiveSample, error) {
		now, e := operatorWireLiveMonotonic()
		if e != nil {
			return operatorWireLiveSample{}, e
		}
		seq := calls.Add(1)
		return operatorWireLiveSample{raw: []byte(`{"controlFixtureOnly":true,"sequence":` + strconv.FormatUint(seq, 10) + `}`), pid: id.PID, reactor: 11, observer: 12, generation: 13, start: now, end: now, complete: true}, nil
	}
	if err = c.bind(n, get); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	return c, n, calls
}

func readWireLiveReceipt(t *testing.T, c *operatorWireLiveControl, phase string) operatorWireLiveReceipt {
	t.Helper()
	raw, e := os.ReadFile(filepath.Join(c.path, phase+".result.json"))
	if e != nil {
		t.Fatal(e)
	}
	r, e := decodeOperatorWireLiveReceipt(raw, phase, c.identity)
	if e != nil {
		t.Fatal(e)
	}
	return r
}

func TestOperatorWireLivePrivateControlTwoEndpointsAndNoReplay(t *testing.T) {
	c, n, calls := newWireLiveControlTest(t)
	if e := c.Start(context.Background()); e == nil {
		t.Fatal("unstarted original node accepted")
	}
	n.running.Store(true)
	if e := c.Start(context.Background()); e != nil {
		t.Fatal(e)
	}
	if e := c.Start(context.Background()); e == nil {
		t.Fatal("duplicate producer start accepted")
	}
	if e := requestOperatorWireLive(context.Background(), c.path, "after", io.Discard); e == nil {
		t.Fatal("after accepted before original before result")
	}
	for i, phase := range []string{"before", "after"} {
		var out bytes.Buffer
		if e := requestOperatorWireLive(context.Background(), c.path, phase, &out); e != nil {
			t.Fatal(e)
		}
		original, e := os.ReadFile(filepath.Join(c.path, phase+".raw.json"))
		if e != nil {
			t.Fatal(e)
		}
		if !bytes.Equal(out.Bytes(), original) || !bytes.Contains(original, []byte(`"controlFixtureOnly":true`)) {
			t.Fatal("original control-test bytes were replaced with claimed live data")
		}
		r := readWireLiveReceipt(t, c, phase)
		if r.Status != "OBSERVED" || r.Reason != "" || r.AuthorityGranted || r.RawSHA256 != wireLiveDigest(original) || calls.Load() != uint64(i+1) {
			t.Fatalf("wrong original endpoint result %+v", r)
		}
		if e = requestOperatorWireLive(context.Background(), c.path, phase, io.Discard); e == nil {
			t.Fatal("original consumed request replayed")
		}
		if calls.Load() != uint64(i+1) {
			t.Fatal("duplicate requester caused another capture")
		}
	}
	select {
	case <-c.done:
	case <-time.After(time.Second):
		t.Fatal("two-slot producer did not retire")
	}
	if e := c.Close(); e != nil {
		t.Fatal(e)
	}
	if e := c.Close(); e != nil {
		t.Fatal(e)
	}
	for _, name := range []string{"producer.json", "before.request", "before.raw.json", "before.result.json", "after.request", "after.raw.json", "after.result.json"} {
		s, e := os.Stat(filepath.Join(c.path, name))
		if e != nil || s.Mode() != 0600 {
			t.Fatal("original private result missing or weakened", name, e)
		}
	}
}

func TestOperatorWireLiveUnknownPreservesOriginalAndRetires(t *testing.T) {
	for _, name := range []string{"stopped-before", "stopped-during", "busy", "missing", "overflow", "clock", "process", "reactor", "observer", "generation", "raw-bound", "malformed-request", "request-mode", "raw-collision"} {
		t.Run(name, func(t *testing.T) {
			c, n, _ := newWireLiveControlTest(t)
			n.running.Store(true)
			c.started = true
			base := c.getter
			// Capture the first endpoint only for pair/lifetime changes.
			pair := name == "reactor" || name == "observer" || name == "generation"
			if pair {
				if e := publishOperatorWireLiveRequest(c.root, c.directory, "before.request", []byte(operatorWireLiveVersion+" before\n")); e != nil {
					t.Fatal(e)
				}
				if _, e := c.step(); e != nil {
					t.Fatal(e)
				}
			}
			phase := "before"
			if pair {
				phase = "after"
			}
			var observedRaw []byte
			c.getter = func() (operatorWireLiveSample, error) {
				s, e := base()
				if e != nil {
					return s, e
				}
				switch name {
				case "stopped-during":
					n.running.Store(false)
				case "busy", "missing", "overflow":
					s.complete = false
					s.reason = name
				case "clock":
					s.start = 0
				case "process":
					s.pid++
				case "reactor":
					s.reactor++
				case "observer":
					s.observer++
				case "generation":
					s.generation++
				case "raw-bound":
					s.raw = bytes.Repeat([]byte("x"), operatorWireLiveLimit+1)
				}
				observedRaw = bytes.Clone(s.raw)
				return s, nil
			}
			raw := []byte(operatorWireLiveVersion + " " + phase + "\n")
			if name == "malformed-request" {
				raw = []byte("choose-another-pid")
			}
			if e := publishOperatorWireLiveRequest(c.root, c.directory, phase+".request", raw); e != nil {
				t.Fatal(e)
			}
			if name == "stopped-before" {
				n.running.Store(false)
			}
			if name == "request-mode" {
				if e := os.Chmod(filepath.Join(c.path, phase+".request"), 0644); e != nil {
					t.Fatal(e)
				}
			}
			if name == "raw-collision" {
				if e := os.WriteFile(filepath.Join(c.path, phase+".raw.json"), []byte("original-UNKNOWN"), 0600); e != nil {
					t.Fatal(e)
				}
			}
			if _, e := c.step(); e == nil {
				t.Fatal("invalid running endpoint accepted")
			}
			r := readWireLiveReceipt(t, c, phase)
			if r.Status != "UNKNOWN" || !c.retired {
				t.Fatal("failed capture became success or remained retryable")
			}
			if _, e := c.step(); e == nil {
				t.Fatal("UNKNOWN capture retried")
			}
			held, e := os.ReadFile(filepath.Join(c.path, phase+".request"))
			if e != nil || !bytes.Equal(raw, held) {
				t.Fatal("original request lost")
			}
			if len(observedRaw) > 0 && len(observedRaw) <= operatorWireLiveLimit && name != "raw-collision" {
				got, e := os.ReadFile(filepath.Join(c.path, phase+".raw.json"))
				if e != nil || !bytes.Equal(got, observedRaw) {
					t.Fatal("incomplete original raw was replaced/lost", e)
				}
			}
			if name == "raw-collision" {
				got, _ := os.ReadFile(filepath.Join(c.path, phase+".raw.json"))
				if string(got) != "original-UNKNOWN" {
					t.Fatal("UNKNOWN evidence overwritten")
				}
			}
		})
	}
}

func TestOperatorWireLiveCloseJoinsOriginalCaptureWithoutNodeQuit(t *testing.T) {
	c, n, _ := newWireLiveControlTest(t)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	releaseCapture := func() { once.Do(func() { close(release) }) }
	defer releaseCapture()
	base := c.getter
	c.getter = func() (operatorWireLiveSample, error) { close(entered); <-release; return base() }
	n.running.Store(true)
	if e := c.Start(context.Background()); e != nil {
		t.Fatal(e)
	}
	if e := publishOperatorWireLiveRequest(c.root, c.directory, "before.request", []byte(operatorWireLiveVersion+" before\n")); e != nil {
		t.Fatal(e)
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("control reader did not enter")
	}
	closed := make(chan error, 1)
	go func() { closed <- c.Close() }()
	select {
	case <-closed:
		t.Fatal("Close returned before original getter joined")
	case <-time.After(20 * time.Millisecond):
	}
	releaseCapture()
	select {
	case e := <-closed:
		if e != nil {
			t.Fatal(e)
		}
	case <-time.After(time.Second):
		t.Fatal("Close incorrectly waits for Node.Quit")
	}
	select {
	case <-n.quit:
		t.Fatal("control stopped its node")
	default:
	}
	if c.root != nil || !c.retired {
		t.Fatal("control not retired after join")
	}
}

func TestOperatorWireLivePermissionsIdentityAndResiduals(t *testing.T) {
	for _, name := range []string{"directory-mode", "special-mode", "symlink", "residual", "partial", "hardlink", "file-mode", "directory-replaced"} {
		t.Run(name, func(t *testing.T) {
			c, _, _ := newWireLiveControlTest(t)
			switch name {
			case "directory-mode":
				_ = os.Chmod(c.path, 0755)
				if e := validateOperatorWireLivePath(c.path); e == nil {
					t.Fatal("0755 accepted")
				}
			case "special-mode":
				_ = os.Chmod(c.path, 0700|os.ModeSticky)
				if e := validateOperatorWireLivePath(c.path); e == nil {
					t.Fatal("special directory bits accepted")
				}
			case "symlink":
				alias := c.path + "-alias"
				if e := os.Symlink(c.path, alias); e != nil {
					t.Fatal(e)
				}
				if e := validateOperatorWireLivePath(alias); e == nil {
					t.Fatal("symlink directory accepted")
				}
			case "residual":
				if e := os.WriteFile(filepath.Join(c.path, "original"), []byte("UNKNOWN"), 0600); e != nil {
					t.Fatal(e)
				}
				r, d, _, e := openOperatorWireLiveDirectory(c.path, true)
				if e == nil {
					r.Close()
					d.Close()
					t.Fatal("residual directory reopened")
				}
			case "partial":
				p := filepath.Join(c.path, "before.request.partial")
				if e := os.WriteFile(p, []byte("UNKNOWN"), 0600); e != nil {
					t.Fatal(e)
				}
				if e := publishOperatorWireLiveRequest(c.root, c.directory, "before.request", []byte("request")); e == nil {
					t.Fatal("partial request overwritten")
				}
				b, _ := os.ReadFile(p)
				if string(b) != "UNKNOWN" {
					t.Fatal("partial changed")
				}
			case "hardlink", "file-mode":
				if e := os.WriteFile(filepath.Join(c.path, "original"), []byte("original"), 0600); e != nil {
					t.Fatal(e)
				}
				if name == "hardlink" {
					if e := os.Link(filepath.Join(c.path, "original"), filepath.Join(c.path, "link")); e != nil {
						t.Fatal(e)
					}
				} else {
					_ = os.Chmod(filepath.Join(c.path, "original"), 0644)
				}
				if _, e := readOperatorWireLiveFile(c.root, "original", 64); e == nil {
					t.Fatal("non-private/aliased file accepted")
				}
			case "directory-replaced":
				if e := os.Rename(c.path, c.path+"-original"); e != nil {
					t.Fatal(e)
				}
				if e := os.Mkdir(c.path, 0700); e != nil {
					t.Fatal(e)
				}
				if e := c.current(); e == nil {
					t.Fatal("replacement directory accepted")
				}
				entries, _ := os.ReadDir(c.path)
				if len(entries) != 0 {
					t.Fatal("replacement mutated")
				}
			}
		})
	}
}

func TestOperatorWireLiveRequesterUnknownAndProducerIdentity(t *testing.T) {
	c, n, calls := newWireLiveControlTest(t)
	n.running.Store(true)
	if e := c.Start(context.Background()); e != nil {
		t.Fatal(e)
	}
	// Cancellation leaves the one original request and cannot silently retry.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if e := requestOperatorWireLive(ctx, c.path, "before", io.Discard); e == nil {
		t.Fatal("cancelled requester returned success")
	}
	if _, e := os.Stat(filepath.Join(c.path, "before.request")); e != nil {
		t.Fatal("UNKNOWN request not retained")
	}
	if e := requestOperatorWireLive(context.Background(), c.path, "before", io.Discard); e == nil {
		t.Fatal("UNKNOWN requester retried")
	}
	if calls.Load() > 1 {
		t.Fatal("more than original capture")
	}
	// A receipt from a different process/start is not this bound producer.
	r := operatorWireLiveReceipt{Version: operatorWireLiveVersion, Phase: "before", Status: "UNKNOWN", Identity: c.identity, SyntheticOnly: true}
	r.Identity.StartTicks = "1"
	raw, _ := json.Marshal(r)
	if _, e := decodeOperatorWireLiveReceipt(raw, "before", operatorWireLiveIdentity{PID: c.identity.PID, StartTicks: "2"}); e == nil {
		t.Fatal("foreign lifetime receipt accepted")
	}
	for _, bad := range []string{"0", "01", "-1", "18446744073709551616"} {
		if validOperatorWireLiveIdentity(operatorWireLiveIdentity{PID: 1, StartTicks: bad}) {
			t.Fatal("bad process-start coordinate accepted")
		}
	}
}

func TestOperatorWireLiveSelfProcParsingAndDefaultOff(t *testing.T) {
	id, e := operatorWireLiveProcessIdentity()
	if e != nil || id.PID != uint64(os.Getpid()) || !validOperatorWireLiveIdentity(id) {
		t.Fatal("original Linux process identity", e)
	}
	raw := []byte(strconv.Itoa(os.Getpid()) + " (original (name) with spaces) S " + strings.Repeat("0 ", 18) + "123 0")
	parsed, e := decodeOperatorWireLiveIdentity(raw, uint64(os.Getpid()))
	if e != nil || parsed.StartTicks != "123" {
		t.Fatal("proc comm grammar changed start field", e)
	}
	if _, e = decodeOperatorWireLiveIdentity(raw, uint64(os.Getpid()+1)); e == nil {
		t.Fatal("foreign PID accepted")
	}
	if !operatorWireLiveLinked {
		dir := wireObservationTestDir(t)
		p := pqOptions{state: filepath.Join(dir, "state"), wireObservationLiveControl: filepath.Join(dir, "control")}
		if e = runPQNode(&cobra.Command{}, p); e == nil || !strings.Contains(e.Error(), "matching typed Reactor") {
			t.Fatal("ordinary source silently used a non-live fallback", e)
		}
		if _, e = os.Stat(p.state + ".writer.lock"); !errors.Is(e, os.ErrNotExist) {
			t.Fatal("unsupported mode acquired original writer lease")
		}
	}
}
