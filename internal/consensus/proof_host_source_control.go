//go:build unix

package consensus

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/cometbft/cometbft/node"
	"golang.org/x/sys/unix"
)

const ProofHostLivePolicyVersion = "YNX-PROOF-HOST-LIVE-POLICY/v1"
const MaxProofHostLivePolicyBytes = 16384

// This policy selects ONE public DATA capture, not a Native/Host grant. Its
// complete pin is an independent operator startup argument. It never permits a
// request to choose files, a trust root, an account, an epoch or an operation.
type ProofHostLivePolicy struct {
	Version               string `json:"version"`
	SourcePlanFile        string `json:"sourcePlanFile"`
	SourcePlanSHA256      string `json:"sourcePlanSHA256"`
	ControlFile           string `json:"controlFile"`
	Destination           string `json:"destination"`
	SessionID             string `json:"sessionId"`
	CaptureTimeoutSeconds string `json:"captureTimeoutSeconds"`
}

type ProofHostLiveRequest struct {
	Version      string `json:"version"`
	PolicySHA256 string `json:"policySHA256"`
	SessionID    string `json:"sessionId"`
	SourceID     string `json:"sourceId"`
	Epoch        string `json:"epoch"`
	OperationID  string `json:"operationId"`
}

type ProofHostLiveResult struct {
	Version              string                    `json:"version"`
	PolicySHA256         string                    `json:"policySHA256"`
	SessionID            string                    `json:"sessionId"`
	Outcome              string                    `json:"outcome"`
	Delivery             *ProofHostDeliveryReceipt `json:"delivery,omitempty"`
	PublicDataOnly       bool                      `json:"publicDataOnly"`
	NativeRootAuthorized bool                      `json:"nativeRootAuthorized"`
}

type proofHostLiveInputs struct {
	policy               ProofHostLivePolicy
	plan                 ProofHostSourcePlan
	policyFile, planFile *proofHostOriginal
	policyHash           string
}

func loadProofHostLiveInputs(path, pin string) (out *proofHostLiveInputs, err error) {
	policy, err := readProofHostOriginal(path, pin, MaxProofHostLivePolicyBytes)
	if err != nil {
		return nil, err
	}
	out = &proofHostLiveInputs{policyFile: policy, policyHash: pin}
	defer func() {
		if err != nil {
			err = errors.Join(err, out.close())
			out = nil
		}
	}()
	if pqLightUniqueJSON(policy.raw) != nil || json.Unmarshal(policy.raw, &out.policy) != nil {
		return out, errors.New("invalid original live source policy")
	}
	canonical, e := json.Marshal(out.policy)
	if e != nil || !pqLightJSONEquivalent(policy.raw, canonical) || out.policy.Version != ProofHostLivePolicyVersion {
		return out, errors.New("exact complete live source policy required")
	}
	p := out.policy
	if _, e = proofHostHash(pin); e != nil {
		return out, e
	}
	if _, e = proofHostHash(p.SessionID); e != nil {
		return out, e
	}
	if _, e = proofHostHash(p.SourcePlanSHA256); e != nil {
		return out, e
	}
	out.planFile, err = readProofHostOriginal(p.SourcePlanFile, p.SourcePlanSHA256, MaxProofHostSourcePlanBytes)
	if err != nil {
		return out, err
	}
	out.plan, err = DecodeProofHostSourcePlan(out.planFile.raw, p.SourcePlanSHA256)
	if err != nil {
		return out, err
	}
	if p.ControlFile != filepath.Join(filepath.Dir(out.plan.StateFile), "proof-host-source-"+p.SessionID+".json") {
		return out, errors.New("live control must be the exact private original application session path")
	}
	if _, e = proofHostUint(p.CaptureTimeoutSeconds, 300, false); e != nil {
		return out, e
	}
	if err = proofHostDirectory(p.Destination); err != nil {
		return out, err
	}
	for _, dir := range []string{filepath.Dir(p.ControlFile), filepath.Dir(p.Destination)} {
		if err = proofHostLivePrivateDirectory(dir); err != nil {
			return out, err
		}
	}
	return out, nil
}

func proofHostLivePrivateDirectory(path string) error {
	if err := requireInspectionPath(path); err != nil {
		return err
	}
	var stat unix.Stat_t
	if err := unix.Lstat(path, &stat); err != nil {
		return err
	}
	if stat.Mode&unix.S_IFMT != unix.S_IFDIR || stat.Mode&07777 != 0700 || stat.Uid != uint32(os.Geteuid()) {
		return errors.New("existing same-user canonical private directory required")
	}
	return nil
}
func (in *proofHostLiveInputs) close() error {
	var err error
	if in.planFile != nil {
		err = errors.Join(err, in.planFile.file.Close())
	}
	if in.policyFile != nil {
		err = errors.Join(err, in.policyFile.file.Close())
	}
	return err
}
func (in *proofHostLiveInputs) current() error {
	return errors.Join(in.policyFile.unchanged(), in.planFile.unchanged(), proofHostLivePrivateDirectory(filepath.Dir(in.policy.ControlFile)), proofHostLivePrivateDirectory(filepath.Dir(in.policy.Destination)))
}
func (in *proofHostLiveInputs) request() ProofHostLiveRequest {
	return ProofHostLiveRequest{"YNX-PROOF-HOST-LIVE-REQUEST/v1", in.policyHash, in.policy.SessionID, in.plan.SourceID, in.plan.Epoch, in.plan.OperationID}
}

func proofHostLiveAbsent(paths ...string) error {
	for _, p := range paths {
		if _, err := os.Lstat(p); !os.IsNotExist(err) {
			return errors.New("existing live source request, attempt or output requires original reconciliation")
		}
	}
	return nil
}

// PublishProofHostLiveRequest is the normal offline trigger. It publishes only
// the preconfigured DATA request, not a proof or an authorization. No retry,
// deletion, network call or successful-acquisition claim is made here.
func PublishProofHostLiveRequest(policyPath, pin string) (result ProofHostLiveResult, err error) {
	in, err := loadProofHostLiveInputs(policyPath, pin)
	if err != nil {
		return result, err
	}
	defer func() { err = errors.Join(err, in.close()) }()
	if err = proofHostLiveAbsent(in.policy.ControlFile, in.policy.ControlFile+".partial", in.policy.Destination+".attempt", in.policy.Destination); err != nil {
		return result, err
	}
	raw, e := json.Marshal(in.request())
	if e != nil {
		return result, e
	}
	if err = in.current(); err != nil {
		return result, err
	}
	if err = publishProofHostLiveControl(in.policy.ControlFile, raw); err != nil {
		return result, err
	}
	if err = in.current(); err != nil {
		return result, err
	}
	return ProofHostLiveResult{Version: "YNX-PROOF-HOST-LIVE-RESULT/v1", PolicySHA256: pin, SessionID: in.policy.SessionID, Outcome: "request_published", PublicDataOnly: true}, nil
}

// ProofHostLiveControl owns one normal Node/App capture and joins it before
// those original stores close. It has no listener, signing method, auth issuer,
// arbitrary request callback or automatic replay. Close retires it forever.
type ProofHostLiveControl struct {
	in                                *proofHostLiveInputs
	node                              *node.Node
	app                               *Application
	mu                                sync.Mutex
	started, retired, attempted, busy bool
	cancel                            context.CancelFunc
	wg                                sync.WaitGroup
	err                               error
	done                              chan struct{}
	finish                            sync.Once
	close                             sync.Once
}

func NewProofHostLiveControl(n *node.Node, app *Application, policyPath, pin string) (control *ProofHostLiveControl, err error) {
	if n == nil || app == nil {
		return nil, errors.New("original owning Node/Application required")
	}
	in, err := loadProofHostLiveInputs(policyPath, pin)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, in.close())
		}
	}()
	app.mu.RLock()
	statePath := app.statePath
	bootstrap := app.bootstrap
	authorization := app.pqEngineAuthorization
	app.mu.RUnlock()
	if statePath != in.plan.StateFile || bootstrap == nil || authorization == nil || bootstrap.record.ChainID != in.plan.ExpectedTransaction.Block.ChainID {
		return nil, errors.New("live source requires the original independently authorized PQ application")
	}
	if err = bootstrap.matchesMigration(app.migration); err != nil {
		return nil, err
	}
	if _, err = n.ProofSourceView(); err != nil {
		return nil, err
	}
	if err = proofHostLiveAbsent(in.policy.ControlFile, in.policy.ControlFile+".partial", in.policy.Destination+".attempt", in.policy.Destination); err != nil {
		return nil, err
	}
	control = &ProofHostLiveControl{in: in, node: n, app: app, done: make(chan struct{})}
	if err = n.RegisterProofSourceConsumer(control.Close); err != nil {
		return nil, err
	}
	return control, nil
}

func (c *ProofHostLiveControl) Start(parent context.Context) error {
	if parent == nil {
		return errors.New("explicit owning process context required")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.started || c.retired {
		return errors.New("live source control already started or retired")
	}
	c.started = true
	ctx, cancel := context.WithCancel(parent)
	c.cancel = cancel
	c.wg.Add(1)
	go func() {
		defer c.wg.Done()
		defer c.finish.Do(func() { close(c.done) })
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-c.node.Quit():
				return
			case <-ticker.C:
				present, err := c.captureRequest(ctx)
				if err != nil {
					c.mu.Lock()
					c.err = err
					c.mu.Unlock()
					return
				}
				if present {
					return
				}
			}
		}
	}()
	return nil
}
func (c *ProofHostLiveControl) Done() <-chan struct{} { return c.done }
func (c *ProofHostLiveControl) Err() error            { c.mu.Lock(); defer c.mu.Unlock(); return c.err }
func (c *ProofHostLiveControl) Close() error {
	c.close.Do(func() {
		c.mu.Lock()
		c.retired = true
		if c.cancel != nil {
			c.cancel()
		}
		c.mu.Unlock()
		c.wg.Wait()
		c.mu.Lock()
		c.err = errors.Join(c.err, c.in.close())
		c.mu.Unlock()
		c.finish.Do(func() { close(c.done) })
	})
	return c.Err()
}

// beginRead and finishRead delimit all original source reads. Close sets
// retired under the same mutex before waiting, so no reader can join afterward.
func (c *ProofHostLiveControl) beginRead() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.retired || c.attempted || c.busy {
		return errors.New("live capture is retired, in flight or already attempted")
	}
	c.busy = true
	c.wg.Add(1)
	return nil
}
func (c *ProofHostLiveControl) finishRead() { c.mu.Lock(); c.busy = false; c.mu.Unlock(); c.wg.Done() }
func (c *ProofHostLiveControl) captureRequest(parent context.Context) (present bool, err error) {
	if err = c.beginRead(); err != nil {
		return true, err
	}
	defer c.finishRead()
	if err = parent.Err(); err != nil {
		return true, err
	}
	if _, e := os.Lstat(c.in.policy.ControlFile); os.IsNotExist(e) {
		return false, nil
	} else if e != nil {
		return true, e
	}
	if err = c.in.current(); err != nil {
		return true, err
	}
	request, err := readProofHostOriginal(c.in.policy.ControlFile, "", 4096)
	if err != nil {
		return true, err
	}
	defer func() { err = errors.Join(err, request.file.Close()) }()
	var stat unix.Stat_t
	if unix.Fstat(int(request.file.Fd()), &stat) != nil || stat.Uid != uint32(os.Geteuid()) || stat.Mode&07777 != 0600 {
		return true, errors.New("private original live request required")
	}
	var got ProofHostLiveRequest
	expected := c.in.request()
	raw, _ := json.Marshal(expected)
	if pqLightUniqueJSON(request.raw) != nil || json.Unmarshal(request.raw, &got) != nil || got != expected || !pqLightJSONEquivalent(request.raw, raw) {
		return true, errors.New("live request differs from independently fixed source policy")
	}
	c.mu.Lock()
	if c.retired || parent.Err() != nil {
		c.mu.Unlock()
		return true, context.Canceled
	}
	c.attempted = true
	c.mu.Unlock()
	attempt := c.in.policy.Destination + ".attempt"
	if err = os.Mkdir(attempt, 0700); err != nil {
		return true, err
	}
	defer func() {
		if err != nil {
			cause := err.Error()
			if len(cause) > 4096 {
				cause = cause[:4096]
			}
			body, _ := json.Marshal(map[string]string{"version": "YNX-PROOF-HOST-LIVE-FAILURE/v1", "policySHA256": c.in.policyHash, "sessionId": c.in.policy.SessionID, "outcome": "unknown", "firstCause": cause, "firstCauseSHA256": proofHostSHA([]byte(err.Error()))})
			err = errors.Join(err, proofHostLiveWrite(attempt, "failure.json", body))
		}
	}()
	// Once reserved, every failure is UNKNOWN and retained. In particular a
	// canceled/failed capture cannot be replayed by touching the request file.
	if err = proofHostLiveWrite(attempt, "intent.json", raw); err != nil {
		return true, err
	}
	// Cancellation is observed at safe checkpoints. Encoding, validation and
	// App RLock waits are not preempted; Close must join them before store close.
	seconds, _ := strconv.ParseUint(c.in.policy.CaptureTimeoutSeconds, 10, 64)
	ctx, cancel := context.WithTimeout(parent, time.Duration(seconds)*time.Second)
	defer cancel()
	captured, err := exportNodeProofHostSourceContext(ctx, c.node, c.app, c.in.planFile.raw, c.in.policy.SourcePlanSHA256, c.in.policy.Destination, time.Now().UTC())
	if err != nil {
		return true, err
	}
	if err = errors.Join(ctx.Err(), request.unchanged(), c.in.current()); err != nil {
		return true, err
	}
	receipt, err := WriteProofHostDelivery(c.in.policy.Destination, captured)
	if err != nil {
		return true, err
	}
	if err = ctx.Err(); err != nil {
		return true, err
	}
	result := ProofHostLiveResult{Version: "YNX-PROOF-HOST-LIVE-RESULT/v1", PolicySHA256: c.in.policyHash, SessionID: c.in.policy.SessionID, Outcome: "data_delivered", Delivery: &receipt, PublicDataOnly: true}
	body, err := json.Marshal(result)
	if err != nil {
		return true, err
	}
	if err = proofHostLiveWrite(attempt, "result.json", body); err != nil {
		return true, err
	}
	return true, nil
}

func proofHostLiveWrite(directory, name string, raw []byte) error {
	if len(raw) > 16384 {
		return errors.New("bounded live control result required")
	}
	if name != "intent.json" && name != "result.json" && name != "failure.json" {
		return errors.New("closed live result filename required")
	}
	if err := proofHostLivePrivateDirectory(directory); err != nil {
		return err
	}
	dfd, err := unix.Open(directory, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return err
	}
	defer unix.Close(dfd)
	var before unix.Stat_t
	if unix.Fstat(dfd, &before) != nil || before.Mode&unix.S_IFMT != unix.S_IFDIR || before.Mode&07777 != 0700 || before.Uid != uint32(os.Geteuid()) {
		return errors.New("live result directory unavailable")
	}
	fd, err := unix.Openat(dfd, name, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return err
	}
	f := os.NewFile(uintptr(fd), "private-live-data-result")
	n, writeErr := f.Write(raw)
	if writeErr == nil && n != len(raw) {
		writeErr = errors.New("short control write")
	}
	err = errors.Join(writeErr, f.Sync(), f.Close())
	if err != nil {
		return err
	}
	if err = unix.Fsync(dfd); err != nil {
		return err
	}
	var after unix.Stat_t
	if unix.Lstat(directory, &after) != nil || after.Dev != before.Dev || after.Ino != before.Ino {
		return errors.New("live result directory replaced; original output UNKNOWN")
	}
	return nil
}
