package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/spf13/cobra"
)

const operatorWireLiveVersion = "YNX-OPERATOR-LIVE-WIRE/v1"
const operatorWireLiveLimit = 128 << 10
const operatorWireLivePoll = 10 * time.Millisecond
const operatorWireLiveDeadline = 2 * time.Second

// Only the build-tagged adapter can produce this internal value from the
// actual typed Reactor getter. No JSON request may supply counter metadata.
type operatorWireLiveSample struct {
	raw                                            []byte
	pid, reactor, observer, generation, start, end uint64
	complete                                       bool
	reason                                         string
}
type operatorWireLiveGetter func() (operatorWireLiveSample, error)
type operatorWireLiveNode interface {
	IsRunning() bool
	Quit() <-chan struct{}
}
type operatorWireLiveIdentity struct {
	PID        uint64 `json:"pid,string"`
	StartTicks string `json:"startTicks"`
}
type operatorWireLiveProducer struct {
	Version  string                   `json:"version"`
	Identity operatorWireLiveIdentity `json:"identity"`
}
type operatorWireLiveReceipt struct {
	Version          string                   `json:"version"`
	Phase            string                   `json:"phase"`
	Status           string                   `json:"status"`
	Reason           string                   `json:"reason"`
	Identity         operatorWireLiveIdentity `json:"identity"`
	RawSHA256        string                   `json:"rawSHA256"`
	StartMonotonicNS *uint64                  `json:"startMonotonicNs,string"`
	EndMonotonicNS   *uint64                  `json:"endMonotonicNs,string"`
	SyntheticOnly    bool                     `json:"syntheticOnly"`
	AuthorityGranted bool                     `json:"authorityGranted"`
}

// Same private file-control model as the original operator DATA producer.
// Exactly two named slots; no public RPC/socket, PID selector, reset, observer
// attachment or unbounded collector. An error retires this original session.
type operatorWireLiveControl struct {
	mu               sync.Mutex
	path             string
	root             *os.Root
	directory        *os.File
	parent           os.FileInfo
	identity         operatorWireLiveIdentity
	node             operatorWireLiveNode
	getter           operatorWireLiveGetter
	before           *operatorWireLiveSample
	started, retired bool
	next             int
	cancel           context.CancelFunc
	wg               sync.WaitGroup
	done             chan struct{}
	finish, close    sync.Once
	err              error
}

func (o *operatorWireObservation) startLive(ctx context.Context) (<-chan struct{}, error) {
	if o == nil || o.live == nil {
		return nil, nil
	}
	if err := o.live.Start(ctx); err != nil {
		return nil, err
	}
	return o.live.done, nil
}
func (o *operatorWireObservation) closeLive() error {
	if o == nil || o.live == nil {
		return nil
	}
	return o.live.Close()
}

func validateOperatorWireLiveCapability(path string) error {
	if !operatorWireLiveLinked {
		return errors.New("live wire observation requires the matching typed Reactor build; stock/after-stop evidence is not live")
	}
	return validateOperatorWireLivePath(path)
}

func prepareOperatorWireLive(path string) (c *operatorWireLiveControl, err error) {
	if err = validateOperatorWireLiveCapability(path); err != nil {
		return nil, err
	}
	root, directory, parent, err := openOperatorWireLiveDirectory(path, true)
	if err != nil {
		return nil, err
	}
	c = &operatorWireLiveControl{path: path, root: root, directory: directory, parent: parent, done: make(chan struct{})}
	if c.identity, err = operatorWireLiveProcessIdentity(); err != nil {
		_ = c.Close()
		return nil, err
	}
	return c, nil
}
func (c *operatorWireLiveControl) current() error {
	return currentOperatorWireLiveDirectory(c.path, c.root, c.directory, c.parent)
}
func (c *operatorWireLiveControl) bind(n operatorWireLiveNode, get operatorWireLiveGetter) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if n == nil || get == nil || n.IsRunning() || c.node != nil || c.started || c.retired {
		return errors.New("live wire control requires the original node/getter before first Start")
	}
	c.node, c.getter = n, get
	return nil
}
func (c *operatorWireLiveControl) Start(parent context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if parent == nil || c.started || c.retired || c.node == nil || c.getter == nil || !c.node.IsRunning() {
		return errors.New("live wire control requires its original running node")
	}
	id, err := operatorWireLiveProcessIdentity()
	if err != nil || id != c.identity {
		return errors.New("original live producer process identity unavailable")
	}
	if err = c.current(); err != nil {
		return err
	}
	// This is DATA provenance for the original supervisor, never permission to
	// attach to another PID. The supervisor independently owns this child.
	raw, _ := json.Marshal(operatorWireLiveProducer{operatorWireLiveVersion, c.identity})
	if err = writeOperatorWireLiveFile(c.root, c.directory, "producer.json", raw); err != nil {
		return err
	}
	c.started = true
	ctx, cancel := context.WithCancel(parent)
	c.cancel = cancel
	c.wg.Add(1)
	go func() {
		defer c.wg.Done()
		defer c.finish.Do(func() { close(c.done) })
		ticker := time.NewTicker(operatorWireLivePoll)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-c.node.Quit():
				return
			case <-ticker.C:
				present, e := c.step()
				c.mu.Lock()
				if e != nil {
					c.err = errors.Join(c.err, e)
					c.retired = true
				}
				finished := c.next == 2
				c.mu.Unlock()
				if e != nil || (present && finished) {
					return
				}
			}
		}
	}()
	return nil
}
func (c *operatorWireLiveControl) Close() error {
	if c == nil {
		return nil
	}
	// Cancellation retires future reads and joins a current capture. File I/O
	// cannot be preempted; this is deliberately not a hard Close latency cap.
	c.close.Do(func() {
		c.mu.Lock()
		c.retired = true
		if c.cancel != nil {
			c.cancel()
		}
		c.mu.Unlock()
		c.wg.Wait()
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.root != nil {
			c.err = errors.Join(c.err, c.root.Close())
			c.root = nil
		}
		if c.directory != nil {
			c.err = errors.Join(c.err, c.directory.Close())
			c.directory = nil
		}
		c.finish.Do(func() { close(c.done) })
	})
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.err
}
func wireLiveDigest(raw []byte) string { h := sha256.Sum256(raw); return hex.EncodeToString(h[:]) }

func (c *operatorWireLiveControl) step() (present bool, err error) {
	if !c.mu.TryLock() {
		return true, errors.New("live capture busy; UNKNOWN")
	}
	defer c.mu.Unlock()
	if c.retired || !c.started || c.next >= 2 {
		return true, errors.New("original live session is retired or exhausted")
	}
	phase := []string{"before", "after"}[c.next]
	if _, e := c.root.Lstat(phase + ".request"); errors.Is(e, os.ErrNotExist) {
		return false, nil
	} else if e != nil {
		return true, e
	}
	// Mark this slot consumed before reading; partial, malformed and UNKNOWN
	// requests are never retried into a new measurement.
	c.next++
	receipt := operatorWireLiveReceipt{Version: operatorWireLiveVersion, Phase: phase, Status: "UNKNOWN", Reason: "capture_failed", Identity: c.identity, SyntheticOnly: true}
	defer func() {
		if err != nil {
			c.retired = true
			c.err = errors.Join(c.err, err)
		}
		raw, e := json.Marshal(receipt)
		if e == nil {
			e = writeOperatorWireLiveFile(c.root, c.directory, phase+".result.json", raw)
		}
		err = errors.Join(err, e, c.current())
	}()
	if err = c.current(); err != nil {
		return true, err
	}
	raw, err := readOperatorWireLiveFile(c.root, phase+".request", 64)
	if err != nil {
		return true, err
	}
	if !bytes.Equal(raw, []byte(operatorWireLiveVersion+" "+phase+"\n")) {
		receipt.Reason = "invalid_request"
		return true, errors.New("exact original two-slot live request required")
	}
	if !c.node.IsRunning() {
		receipt.Reason = "node_not_running"
		return true, errors.New("node stopped; UNKNOWN")
	}
	identity, err := operatorWireLiveProcessIdentity()
	if err != nil || identity != c.identity {
		receipt.Reason = "process_changed"
		return true, errors.New("original process changed; UNKNOWN")
	}
	start, err := operatorWireLiveMonotonic()
	if err != nil {
		receipt.Reason = "clock_unavailable"
		return true, err
	}
	receipt.StartMonotonicNS = &start
	sample, err := c.getter()
	end, clockErr := operatorWireLiveMonotonic()
	if clockErr == nil {
		receipt.EndMonotonicNS = &end
	}
	if err != nil {
		return true, err
	}
	if len(sample.raw) == 0 || len(sample.raw) > operatorWireLiveLimit {
		receipt.Reason = "raw_unavailable"
		return true, errors.New("bounded original raw live sample unavailable")
	}
	receipt.RawSHA256 = wireLiveDigest(sample.raw)
	if err = writeOperatorWireLiveFile(c.root, c.directory, phase+".raw.json", sample.raw); err != nil {
		return true, err
	}
	if clockErr != nil || end < start || sample.start < start || sample.end > end || sample.end < sample.start {
		receipt.Reason = "clock_unavailable"
		return true, errors.New("kernel monotonic sample bounds unavailable; UNKNOWN")
	}
	identity, err = operatorWireLiveProcessIdentity()
	if err != nil || identity != c.identity || sample.pid != identity.PID || !c.node.IsRunning() {
		receipt.Reason = "node_lifetime_changed"
		return true, errors.New("node/process stopped or changed during capture; UNKNOWN")
	}
	if !sample.complete {
		receipt.Reason = sample.reason
		if receipt.Reason == "" {
			receipt.Reason = "reactor_unknown"
		}
		return true, errors.New("original reactor live sample is UNKNOWN: " + receipt.Reason)
	}
	if sample.reactor == 0 || sample.observer == 0 || sample.generation == 0 {
		receipt.Reason = "lifetime_unavailable"
		return true, errors.New("private original reactor/observer lifetime unavailable")
	}
	if c.before != nil && (c.before.pid != sample.pid || c.before.reactor != sample.reactor || c.before.observer != sample.observer || c.before.generation != sample.generation || c.before.end > sample.start) {
		receipt.Reason = "lifetime_changed"
		return true, errors.New("before/after original lifetime or generation changed")
	}
	if end-start > uint64(operatorWireLiveDeadline) {
		receipt.Reason = "capture_deadline"
		return true, errors.New("capture exceeded cooperative deadline; original evidence retained")
	}
	if c.before == nil {
		copy := sample
		copy.raw = nil
		c.before = &copy
	}
	receipt.Status, receipt.Reason = "OBSERVED", ""
	return true, nil
}

// The normal supervisor invokes this command around its OWN running child.
// It publishes one private request, waits a fixed bounded interval, and emits
// ONLY the original raw Reactor JSON. It accepts no PID, counters or clock.
func newRequestWireObservationCommand() *cobra.Command {
	var directory, phase string
	c := &cobra.Command{Use: "request-wire-observation", Args: cobra.NoArgs, SilenceUsage: true, SilenceErrors: true, PersistentPreRunE: func(*cobra.Command, []string) error { return nil }, RunE: func(cmd *cobra.Command, _ []string) error {
		if err := validateOperatorWireLiveCapability(directory); err != nil {
			return err
		}
		return requestOperatorWireLive(cmd.Context(), directory, phase, cmd.OutOrStdout())
	}}
	c.Flags().Var(&initializationStringFlag{target: &directory}, "control", "original startup-bound private live control directory")
	c.Flags().Var(&initializationStringFlag{target: &phase}, "phase", "exact before or after; each is single-use")
	for _, name := range []string{"control", "phase"} {
		if e := c.MarkFlagRequired(name); e != nil {
			panic(e)
		}
	}
	return c
}
func requestOperatorWireLive(parent context.Context, path, phase string, out io.Writer) error {
	if parent == nil || out == nil || phase != "before" && phase != "after" {
		return errors.New("live endpoint must be before or after with a bounded caller")
	}
	root, dir, original, err := openOperatorWireLiveDirectory(path, false)
	if err != nil {
		return err
	}
	defer root.Close()
	defer dir.Close()
	producerRaw, err := readOperatorWireLiveFile(root, "producer.json", 4096)
	if err != nil {
		return err
	}
	var producer operatorWireLiveProducer
	if err = json.Unmarshal(producerRaw, &producer); err != nil {
		return err
	}
	canonical, err := json.Marshal(producer)
	if err != nil || !bytes.Equal(canonical, producerRaw) || producer.Version != operatorWireLiveVersion || !validOperatorWireLiveIdentity(producer.Identity) {
		return errors.New("original producer identity unavailable; UNKNOWN")
	}
	if phase == "after" {
		raw, e := readOperatorWireLiveFile(root, "before.result.json", 4096)
		if e != nil {
			return e
		}
		prior, e := decodeOperatorWireLiveReceipt(raw, "before", producer.Identity)
		if e != nil || prior.Status != "OBSERVED" || prior.Reason != "" {
			return errors.New("first original endpoint was not observed; no after retry")
		}
	}
	if err = currentOperatorWireLiveDirectory(path, root, dir, original); err != nil {
		return err
	}
	if err = publishOperatorWireLiveRequest(root, dir, phase+".request", []byte(operatorWireLiveVersion+" "+phase+"\n")); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(parent, operatorWireLiveDeadline)
	defer cancel()
	ticker := time.NewTicker(operatorWireLivePoll)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return errors.New("live observation UNKNOWN: original request retained; do not retry")
		case <-ticker.C:
			if _, e := root.Lstat(phase + ".result.json"); errors.Is(e, os.ErrNotExist) {
				continue
			} else if e != nil {
				return e
			}
			raw, e := readOperatorWireLiveFile(root, phase+".result.json", 4096)
			if e != nil {
				return e
			}
			result, e := decodeOperatorWireLiveReceipt(raw, phase, producer.Identity)
			if e != nil {
				return e
			}
			if result.Status != "OBSERVED" || result.Reason != "" {
				return errors.New("live observation UNKNOWN: " + result.Reason)
			}
			payload, e := readOperatorWireLiveFile(root, phase+".raw.json", operatorWireLiveLimit)
			if e != nil {
				return e
			}
			if wireLiveDigest(payload) != result.RawSHA256 {
				return errors.New("original raw live bytes changed; UNKNOWN")
			}
			producerAgain, e := readOperatorWireLiveFile(root, "producer.json", 4096)
			if e != nil || !bytes.Equal(producerAgain, producerRaw) {
				return errors.New("original producer binding changed; UNKNOWN")
			}
			if e = currentOperatorWireLiveDirectory(path, root, dir, original); e != nil {
				return e
			}
			n, e := out.Write(payload)
			if e == nil && n != len(payload) {
				e = io.ErrShortWrite
			}
			return e
		}
	}
}

func validOperatorWireLiveIdentity(id operatorWireLiveIdentity) bool {
	n, err := strconv.ParseUint(id.StartTicks, 10, 64)
	return err == nil && n > 0 && strconv.FormatUint(n, 10) == id.StartTicks && id.PID > 0
}

func decodeOperatorWireLiveReceipt(raw []byte, phase string, id operatorWireLiveIdentity) (operatorWireLiveReceipt, error) {
	var result operatorWireLiveReceipt
	if e := json.Unmarshal(raw, &result); e != nil {
		return result, e
	}
	canonical, e := json.Marshal(result)
	if e != nil || !bytes.Equal(raw, canonical) || result.Version != operatorWireLiveVersion || result.Phase != phase || !result.SyntheticOnly || result.AuthorityGranted || result.Identity != id || !validOperatorWireLiveIdentity(id) {
		return result, errors.New("invalid original live response; UNKNOWN")
	}
	if result.Status == "OBSERVED" && (result.StartMonotonicNS == nil || result.EndMonotonicNS == nil || *result.StartMonotonicNS == 0 || *result.EndMonotonicNS < *result.StartMonotonicNS || len(result.RawSHA256) != 64) {
		return result, errors.New("missing observed endpoint coordinates")
	}
	return result, nil
}
