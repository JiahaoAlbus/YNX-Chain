// Package ownednode manages one explicitly approved foreground child under its
// own private directory. It never signals a caller-supplied or journal-only PID.
// The original signed ordinary-node release contract is not supplied; production
// install/start therefore fail closed. Isolated fixtures are labeled separately.
package ownednode

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/internal/accountengine"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/internal/current4transport"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
)

var ErrUnsupported = errors.New("owned node platform unsupported")
var ErrOriginalReleaseMissing = errors.New("original signed ordinary-node release/runtime contract not supplied")
var ErrUnsafePath = errors.New("managed node path/owner identity changed; existing data preserved")
var ErrCapacity = errors.New("managed node capacity limit reached")
var ErrConsent = errors.New("current explicit native IPC consent required")
var ErrReconcile = errors.New("node process result requires original-owner reconciliation; stored PID is not an owned handle")
var ErrClosed = errors.New("node manager closed")

type Config struct {
	Directory              string
	IsolatedFixture        bool
	MaxArtifactBytes       uint64
	StorageQuotaBytes      uint64
	MinimumFreeBytes       uint64
	StopGrace              time.Duration
	RuntimeCandidate       *RuntimeCandidate
	ExpectedRuntimeNetwork *RuntimeNetwork
	ObserverRuntime        *ObserverRuntimeConfig
	Current4Host           *Current4Host
	// Original build profile only. This selects an independent transport,
	// never an account/engineReference, Root row or proof permission.
	AccountEnginePurpose string
	// Separate qualified transport profile only; legacy account purpose never
	// silently enables fresh scopes or changes its original socket lifetime.
	SourceBrokerPurpose string
	// FixtureSynchronizationNetwork enables only the isolated transport fixture.
	// It is not an original ordinary-runtime launch or admission contract.
	FixtureSynchronizationNetwork *RuntimeNetwork
}
type Capacity struct {
	Complete    bool   `json:"complete"`
	UsedBytes   uint64 `json:"usedBytes,string"`
	LimitBytes  uint64 `json:"limitBytes,string"`
	FreeBytes   uint64 `json:"freeBytes,string"`
	Enforcement string `json:"enforcement"`
}
type Status struct {
	NodeID              string                   `json:"nodeId"`
	Stage               string                   `json:"stage"`
	Mode                string                   `json:"mode"`
	Generation          uint64                   `json:"generation,string"`
	RunID               string                   `json:"runId"`
	ProcessOwned        bool                     `json:"processOwned"`
	LastPID             int                      `json:"lastPid"`
	ArtifactSHA256      string                   `json:"artifactSHA256"`
	FirstCause          string                   `json:"firstCause"`
	LastExit            string                   `json:"lastExit"`
	ProductionSupported bool                     `json:"productionSupported"`
	Capacity            Capacity                 `json:"capacity"`
	Diagnostics         Diagnostics              `json:"diagnostics"`
	RuntimeCandidate    *RuntimeCandidateView    `json:"runtimeCandidate,omitempty"`
	ObserverRuntime     *ObserverRuntimeReadback `json:"observerRuntime,omitempty"`
}
type Intent struct {
	ManagerID      string `json:"managerId"`
	NodeID         string `json:"nodeId"`
	Action         string `json:"action"`
	ArtifactSHA256 string `json:"artifactSHA256"`
	Generation     uint64 `json:"generation,string"`
}

func (i Intent) SHA256() string {
	raw, _ := json.Marshal(i)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

type Approval struct {
	nonce, peer, digest string
	expires             time.Time
	native              bool
}
type child struct {
	current4      *current4transport.LaunchOwner
	cmd           *exec.Cmd
	done          chan struct{}
	terminating   chan struct{} // Serialized under the manager mutex, across Stop and Close.
	terminateErr  error         // First termination owner failure, under the manager mutex.
	waitErr       error         // Written by the sole Wait owner before closing done.
	runID         string
	stopRequested bool
	capture       *runtimeCapture
	logs          *runLogs
	exited        chan struct{}
	readContext   context.Context
	cancelReads   context.CancelFunc
	syncEndpoint  *synchronizationEndpoint
	syncBusy      bool
	syncReadback  Synchronization
	syncSocket    os.FileInfo
	syncExpires   time.Time
}
type Manager struct {
	originalSourceParentProfile           *originalSourceParentNormalProfile
	current4Host                          *Current4Host
	pendingCurrent4                       *current4transport.LaunchOwner
	pendingAccount                        *accountengine.EngineOwner
	accountEngine                         bool
	sourceBroker                          bool
	mu                                    sync.Mutex
	directory                             string
	uid                                   uint32
	fixture                               bool
	rootInfo, stateInfo                   os.FileInfo
	stateRaw                              []byte
	state                                 persistentState
	rootLock                              *os.File
	lock                                  *os.File
	lockInfo                              os.FileInfo
	lockRaw                               []byte
	maxArtifact, quotaBytes, minFreeBytes uint64
	stopGrace                             time.Duration
	approvals                             map[string]*Approval
	process                               *child
	termination                           *child
	starting                              *nodeStartAttempt
	runtime                               *RuntimeCandidate
	syncNetwork                           *RuntimeNetwork
	versionProbe                          *observerProbe
	closeMu                               sync.Mutex
	closeInFlight                         chan struct{}
	closeComplete                         bool
	closeResult                           error
	closeFailure                          error
	closeWaitErr                          error
	closeTerminationErr                   error
	closed, released                      bool
}

func New(cfg Config) (*Manager, error) {
	if cfg.SourceBrokerPurpose != "" && (cfg.SourceBrokerPurpose != current4transport.SourceBrokerPurpose || cfg.AccountEnginePurpose != accountengine.Purpose || cfg.Current4Host == nil) {
		return nil, ErrOriginalReleaseMissing
	}
	if cfg.AccountEnginePurpose != "" && (cfg.AccountEnginePurpose != accountengine.Purpose || cfg.Current4Host == nil) {
		return nil, ErrOriginalReleaseMissing
	}
	if !platformSupported() {
		return nil, ErrUnsupported
	}
	uid := os.Geteuid()
	if uid < 0 {
		return nil, ErrUnsupported
	}
	if filepath.Base(cfg.Directory) != DirectoryName {
		return nil, ErrUnsafePath
	}
	if cfg.MaxArtifactBytes == 0 {
		cfg.MaxArtifactBytes = 1 << 20
	}
	if cfg.StorageQuotaBytes == 0 {
		cfg.StorageQuotaBytes = 64 << 20
	}
	if cfg.MinimumFreeBytes == 0 {
		cfg.MinimumFreeBytes = 1 << 20
	}
	if cfg.StopGrace == 0 {
		cfg.StopGrace = 250 * time.Millisecond
	}
	if cfg.MaxArtifactBytes > 64<<20 || cfg.StorageQuotaBytes < 4096 || cfg.StorageQuotaBytes > 1<<40 || cfg.StopGrace < 0 || cfg.StopGrace > 2*time.Second {
		return nil, ErrCapacity
	}
	if cfg.FixtureSynchronizationNetwork != nil && (!cfg.IsolatedFixture || !validSynchronizationNetwork(*cfg.FixtureSynchronizationNetwork) || len(filepath.Join(cfg.Directory, "data", fixtureSyncSocket)) > 103) {
		return nil, ErrOriginalReleaseMissing
	}
	root, err := privateDir(cfg.Directory, uint32(uid), true)
	if err != nil {
		return nil, err
	}
	m := &Manager{directory: cfg.Directory, uid: uint32(uid), fixture: cfg.IsolatedFixture, rootInfo: root, maxArtifact: cfg.MaxArtifactBytes, quotaBytes: cfg.StorageQuotaBytes, minFreeBytes: cfg.MinimumFreeBytes, stopGrace: cfg.StopGrace, approvals: make(map[string]*Approval), current4Host: cfg.Current4Host}
	if err := m.acquireRootLock(); err != nil {
		return nil, err
	}
	complete := false
	defer func() {
		if !complete {
			_ = m.closeLocks()
		}
	}()
	m.accountEngine = cfg.AccountEnginePurpose == accountengine.Purpose
	m.sourceBroker = cfg.SourceBrokerPurpose == current4transport.SourceBrokerPurpose
	if cfg.FixtureSynchronizationNetwork != nil {
		network := *cfg.FixtureSynchronizationNetwork
		m.syncNetwork = &network
	}
	mode := "production"
	if cfg.IsolatedFixture {
		mode = "isolated-lifecycle-fixture"
	}
	raw, info, err := readOwnedFile(filepath.Join(cfg.Directory, stateName), m.uid, stateRecordLimit)
	fresh := errors.Is(err, os.ErrNotExist)
	if fresh {
		m.state = persistentState{Version: stateVersion, ManagerID: randomID(), Mode: mode, NodeID: NodeID, Stage: "not_installed"}
	} else {
		if err != nil {
			return nil, err
		}
		if strictRecord(raw, &m.state) != nil || m.state.Version != stateVersion || len(m.state.ManagerID) != 48 || m.state.NodeID != NodeID || m.state.Mode != mode || m.state.Generation >= math.MaxUint64-4 {
			return nil, ErrUnsafePath
		}
		m.stateInfo = info
		m.stateRaw = append([]byte(nil), raw...)
	}
	rootIdentity := identity(root)
	if m.state.RootIdentity == nil {
		if !fresh && m.state.Stage != "not_installed" {
			return nil, ErrReconcile
		}
		m.state.RootIdentity = &rootIdentity
	} else if *m.state.RootIdentity != rootIdentity {
		return nil, ErrUnsafePath
	}
	if err := m.acquireLock(fresh); err != nil {
		return nil, err
	}
	// Another manager can finish and close between our first journal read
	// and marker lock acquisition if it uses the older entry point. Do not
	// use that earlier snapshot to manage a run.
	if err := m.checkStateFile(); err != nil {
		return nil, err
	}
	for _, name := range []string{"bin", "data"} {
		info, dirErr := privateDir(filepath.Join(cfg.Directory, name), m.uid, true)
		if dirErr != nil {
			return nil, dirErr
		}
		var expected **FileIdentity
		if name == "bin" {
			expected = &m.state.BinIdentity
		} else {
			expected = &m.state.DataIdentity
		}
		current := identity(info)
		if *expected == nil {
			if !fresh && m.state.Stage != "not_installed" {
				return nil, ErrReconcile
			}
			entries, readErr := os.ReadDir(filepath.Join(cfg.Directory, name))
			if readErr != nil || len(entries) != 0 {
				return nil, ErrReconcile
			}
			*expected = &current
		} else if **expected != current {
			return nil, ErrUnsafePath
		}
	}
	logsMigrated, err := m.initializeLogs()
	if err != nil {
		return nil, err
	}
	if m.state.ArtifactSHA256 != "" && m.state.ArtifactIdentity == nil && m.state.Stage != "installing" && m.state.Stage != "reconcile_required" {
		return nil, ErrReconcile
	}
	if _, err := m.installedRuntime(); err != nil {
		return nil, err
	}
	if err := validateObserverRecord(m.state.Observer); err != nil {
		return nil, err
	}
	if err := m.observerRuntimeBinding(); err != nil {
		return nil, err
	}
	if m.state.Observer != nil && m.state.Observer.Version != nil && m.state.Observer.Version.ArtifactSHA256 != m.state.ArtifactSHA256 {
		return nil, ErrObserverInputs
	}
	if !fresh && m.state.Stage == "not_installed" {
		if err = m.save(); err != nil {
			return nil, err
		}
	}
	if fresh {
		if err = m.save(); err != nil {
			return nil, err
		}
	} else {
		switch m.state.Stage {
		case "installing":
			m.state.Stage = "reconcile_required"
			if m.state.FirstCause == "" {
				m.state.FirstCause = "manager reopened with incomplete artifact installation; preserve original staging/final bytes"
			}
			if err = m.save(); err != nil {
				return nil, err
			}
		case "running", "starting", "stopping":
			m.state.Stage = "reconcile_required"
			if m.state.FirstCause == "" {
				m.state.FirstCause = "manager reopened without the original child process handle"
			}
			if err = m.save(); err != nil {
				return nil, err
			}
		case "not_installed", "installed", "stopped", "reconcile_required":
		default:
			return nil, ErrUnsafePath
		}
	}
	if !fresh && logsMigrated {
		if err = m.save(); err != nil {
			return nil, err
		}
	}
	if cfg.RuntimeCandidate != nil || cfg.ExpectedRuntimeNetwork != nil {
		if cfg.RuntimeCandidate == nil || cfg.ExpectedRuntimeNetwork == nil {
			return nil, ErrRuntimeManifest
		}
		if err := m.bindRuntimeCandidate(cfg.RuntimeCandidate, *cfg.ExpectedRuntimeNetwork); err != nil {
			return nil, err
		}
	}
	if cfg.ObserverRuntime != nil {
		if err := m.bindObserverRuntime(context.Background(), *cfg.ObserverRuntime); err != nil {
			return nil, err
		}
	}
	complete = true
	return m, nil
}
func (m *Manager) peerAllowed(peer localipc.Peer) error {
	if !peer.Verified() || localipc.SameUID(m.uid, peer.UID()) != nil {
		return localipc.ErrPeerDenied
	}
	return nil
}
func peerBinding(peer localipc.Peer) string {
	pid, available := peer.PID()
	return fmt.Sprintf("%d:%d:%d:%t:%s", peer.UID(), peer.GID(), pid, available, peer.CredentialSource())
}
func (m *Manager) Prepare(peer localipc.Peer, action, artifactSHA256 string) (Intent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.intent(peer, action, artifactSHA256)
}
func (m *Manager) intent(peer localipc.Peer, action, artifactSHA256 string) (Intent, error) {
	if err := m.peerAllowed(peer); err != nil {
		return Intent{}, err
	}
	if m.closed {
		return Intent{}, ErrClosed
	}
	if m.state.Generation >= math.MaxUint64-4 {
		return Intent{}, ErrReconcile
	}
	if err := m.rootUnchanged(); err != nil {
		return Intent{}, err
	}
	if action != "install" && action != "start" && action != "stop" {
		return Intent{}, ErrConsent
	}
	if action != "install" {
		artifactSHA256 = m.state.ArtifactSHA256
	}
	if action == "install" {
		raw, err := hex.DecodeString(artifactSHA256)
		if err != nil || len(raw) != 32 || hex.EncodeToString(raw) != artifactSHA256 {
			return Intent{}, ErrConsent
		}
		if m.runtime != nil && artifactSHA256 != m.runtime.manifest.ArtifactSHA256 {
			return Intent{}, ErrConsent
		}
	}
	return Intent{ManagerID: m.state.ManagerID, NodeID: NodeID, Action: action, ArtifactSHA256: artifactSHA256, Generation: m.state.Generation}, nil
}

// Approve retains isolated fixture compatibility only. The normal host calls
// ApproveNative with its actual pinned producer, never a decoded allow boolean.
func (m *Manager) Approve(peer localipc.Peer, intent Intent, explicitUserConsent bool, ttl time.Duration) (*Approval, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	// Kept solely for existing isolated lifecycle fixtures. A host boolean is
	// not the normal production native decision transport.
	if !m.fixture || !explicitUserConsent {
		return nil, ErrConsent
	}
	return m.approve(peer, intent, ttl, false)
}
func (m *Manager) approve(peer localipc.Peer, intent Intent, ttl time.Duration, native bool) (*Approval, error) {
	current, err := m.intent(peer, intent.Action, intent.ArtifactSHA256)
	if err != nil {
		return nil, err
	}
	if ttl <= 0 || ttl > time.Minute || intent != current {
		return nil, ErrConsent
	}
	for nonce, old := range m.approvals {
		if !time.Now().Before(old.expires) {
			delete(m.approvals, nonce)
		}
	}
	if len(m.approvals) >= 128 {
		return nil, ErrConsent
	}
	approval := &Approval{nonce: randomID(), peer: peerBinding(peer), digest: intent.SHA256(), expires: time.Now().Add(ttl), native: native}
	m.approvals[approval.nonce] = approval
	return approval, nil
}
func (m *Manager) consume(peer localipc.Peer, intent Intent, approval *Approval) error {
	if approval == nil {
		return ErrConsent
	}
	if !m.fixture && !approval.native {
		return ErrConsent
	}
	registered := m.approvals[approval.nonce]
	if registered == nil || registered != approval || approval.peer != peerBinding(peer) || approval.digest != intent.SHA256() || !time.Now().Before(approval.expires) {
		return ErrConsent
	}
	delete(m.approvals, approval.nonce)
	return nil
}

// Install is the production boundary. There is no owner-supplied original
// publisher signature format, trusted key or ordinary-node runtime descriptor.
func (m *Manager) Install(ctx context.Context, peer localipc.Peer, intent Intent, approval *Approval) error {
	if ctx == nil {
		return ErrConsent
	}
	if err := m.peerAllowed(peer); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return ErrClosed
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if m.runtime != nil {
		if err := m.runtime.unchanged(); err != nil {
			return err
		}
	}
	return ErrOriginalReleaseMissing
}
func (m *Manager) InstallFixture(ctx context.Context, peer localipc.Peer, intent Intent, approval *Approval, artifact []byte) error {
	if ctx == nil {
		return ErrConsent
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.fixture {
		return ErrOriginalReleaseMissing
	}
	if m.runtime != nil {
		return ErrConsent
	}
	return m.installArtifactLocked(ctx, peer, intent, approval, artifact, nil)
}

func (m *Manager) installArtifactLocked(ctx context.Context, peer localipc.Peer, intent Intent, approval *Approval, artifact []byte, runtimeRecord *runtimeInstallRecord) error {
	current, err := m.intent(peer, "install", intent.ArtifactSHA256)
	if err != nil {
		return err
	}
	if current != intent || len(artifact) == 0 || uint64(len(artifact)) > m.maxArtifact {
		return ErrConsent
	}
	sum := sha256.Sum256(artifact)
	if hex.EncodeToString(sum[:]) != intent.ArtifactSHA256 {
		return ErrConsent
	}
	if m.state.Stage != "not_installed" {
		return errors.New("node artifact already installed or requires reconciliation")
	}
	if _, err = m.capacity(uint64(len(artifact)) + 1024); err != nil {
		return err
	}
	path := filepath.Join(m.directory, "bin", artifactName)
	if _, err = os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		return ErrUnsafePath
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	if err = m.consume(peer, intent, approval); err != nil {
		return err
	}
	m.state.Runtime = runtimeRecord
	return m.publishFixtureArtifact(ctx, intent, artifact)
}

func (m *Manager) Status(peer localipc.Peer) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.peerAllowed(peer); err != nil {
		return Status{}, err
	}
	if m.closed {
		return Status{}, ErrClosed
	}
	capacity, err := m.capacity(0)
	out := Status{NodeID: NodeID, Stage: m.state.Stage, Mode: m.state.Mode, Generation: m.state.Generation, RunID: m.state.RunID, ProcessOwned: m.process != nil, LastPID: m.state.LastPID, ArtifactSHA256: m.state.ArtifactSHA256, FirstCause: m.state.FirstCause, LastExit: m.state.LastExit, Capacity: capacity, Diagnostics: m.diagnostics()}
	out.ObserverRuntime = m.observerReadback()
	if m.runtime != nil {
		view := m.runtime.View()
		if candidateErr := m.runtime.unchanged(); candidateErr != nil {
			view.Code = "UNAVAILABLE"
		}
		out.RuntimeCandidate = &view
	}
	return out, err
}
func (m *Manager) firstCause(err error) {
	if err != nil && m.state.FirstCause == "" {
		m.state.FirstCause = err.Error()
	}
}
