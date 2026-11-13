//go:build unix

package consensus

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

// PQLabPublicOwnerSessionOptions fixes one synthetic original scope and its
// explicitly allowed owners before any command. It is not a Wallet/Root lease.
type PQLabPublicOwnerSessionOptions struct {
	RootDir, PlanSHA256, ActivationSHA256, WorkloadSHA256 string
	Owners                                                []int
}

// PQLabPublicOwnerSession shares ONLY the original immutable public validation
// witness. Each owner still has the normal distinct key, writer lease, history
// MAC, nonce/current checks and durable UNKNOWN record. Each owner has its own
// single-flight gate, no worker/queue and no two-owner rotation/lost denominator.
// No witness is exported, persisted, transferred between processes or accepted
// from callers. Static preparation is optional and explicitly measured; without
// it the first-sign bootstrap work remains inside its measured call.
type PQLabPublicOwnerSession struct {
	mu          sync.Mutex
	publicMu    sync.Mutex
	active      sync.WaitGroup
	retired     atomic.Bool
	ctx         context.Context
	options     PQLabPublicOwnerSessionOptions
	public      *pqLabLiveUncachedReads
	checkpoints *PQLabSenderCheckpointSource
	credential  []byte
	manifest    PQLabWorkloadManifest
	owners      map[int]*PQLabSender
	gates       map[int]*pqLabPublicOwnerGate
	commands    uint64
	budget      uint64
	closed      bool
	closing     bool
	closeDone   chan struct{}
	closeErr    error
}

type pqLabPublicOwnerGate struct {
	mu       sync.Mutex
	retired  atomic.Bool
	closeErr error
	commands uint64 // protected by session.mu, including refused Busy attempts
	budget   uint64
}

type PQLabPublicOwnerSessionStats struct {
	AllowedOwners int                    `json:"allowedOwners"`
	OpenedOwners  int                    `json:"openedOwners"`
	Commands      uint64                 `json:"commands"`
	CommandLimit  uint64                 `json:"commandLimit"`
	Retired       bool                   `json:"retired"`
	Closed        bool                   `json:"closed"`
	StaticCache   PQLabStaticCacheStats  `json:"staticCache"`
	SourceInputs  PQLabSenderSourceStats `json:"sourceInputs"`
}

var ErrPQLabPublicOwnerBusy = errors.New("original public owner command already in flight; no request queued")

func OpenPQLabPublicOwnerSession(ctx context.Context, options PQLabPublicOwnerSessionOptions, credential []byte, metrics *PQLabMetrics) (result *PQLabPublicOwnerSession, resultErr error) {
	defer pqLabMeasure(metrics, "publicOwner.openScope")()
	if ctx == nil || ctx.Err() != nil || len(credential) != 32 || len(options.Owners) < 1 || len(options.Owners) > MaxPQLabOwners {
		return nil, errors.New("bounded original synthetic owner scope and credential required")
	}
	if err := requireInspectionPath(options.RootDir); err != nil {
		return nil, err
	}
	s := &PQLabPublicOwnerSession{ctx: ctx, options: options, public: &pqLabLiveUncachedReads{}, checkpoints: NewPQLabSenderCheckpointSource(), owners: make(map[int]*PQLabSender), gates: make(map[int]*pqLabPublicOwnerGate), closeDone: make(chan struct{})}
	s.options.Owners = append([]int(nil), options.Owners...)
	complete := false
	defer func() {
		if !complete {
			resultErr = errors.Join(resultErr, s.Close())
		}
	}()
	planRaw, err := s.public.read(filepath.Join(options.RootDir, "network-plan.json"), 1<<20)
	if err != nil || pqLabSHA(planRaw) != options.PlanSHA256 {
		return nil, errors.New("independent original network plan pin required")
	}
	var plan PQLabNetworkPlan
	if err = pqLabDecode(planRaw, &plan); err != nil || plan.RootDir != options.RootDir || !plan.SyntheticOnly || plan.PublicNetwork || plan.NativeChainID != PQLabNativeChainID {
		return nil, errors.New("different original synthetic lab scope")
	}
	raw, err := s.public.read(filepath.Join(options.RootDir, "workload", "PUBLIC-WORKLOAD.json"), 8<<20)
	if err != nil || pqLabSHA(raw) != options.WorkloadSHA256 {
		return nil, errors.New("independent original workload pin required")
	}
	var manifest PQLabWorkloadManifest
	if err = pqLabDecode(raw, &manifest); err != nil || manifest.Version != PQLabWorkloadVersion || manifest.Mode != "online" || !manifest.SyntheticOnly || manifest.AuthorityGranted || manifest.NativeChainID != "642399" || manifest.MigrationStateHash != plan.MigrationStateHash || manifest.OriginalGenesisHash != plan.OriginalGenesisHash || len(manifest.Owners) < 1 || len(manifest.Owners) > MaxPQLabOwners {
		return nil, errors.New("original online workload differs from pinned lab")
	}
	previous, capacity := -1, 0
	for _, index := range s.options.Owners {
		if index <= previous || index >= len(manifest.Owners) || manifest.Owners[index].Index != index {
			return nil, errors.New("ordered unique original owner indices required")
		}
		count, e := strconv.Atoi(manifest.Owners[index].MemberCapacity)
		if e != nil || count < 1 || count > MaxPQLabTransfers || strconv.Itoa(count) != manifest.Owners[index].MemberCapacity {
			return nil, errors.New("invalid original owner capacity")
		}
		capacity += count
		if capacity > MaxPQLabOnlineTransfers {
			return nil, errors.New("aggregate original owner capacity exceeded")
		}
		s.owners[index] = nil
		s.gates[index] = &pqLabPublicOwnerGate{budget: uint64(4*count + 16)}
		previous = index
	}
	s.budget = uint64(4*capacity + 16*len(s.options.Owners))
	s.manifest = manifest
	if err = s.public.current(); err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	s.credential = bytes.Clone(credential)
	complete = true
	return s, nil
}

// Retire seals admission immediately. Close joins the complete synchronous
// command before destroying owner keys/leases and the held public source.
func (s *PQLabPublicOwnerSession) Retire() {
	if s != nil {
		s.retired.Store(true)
	}
}

func (s *PQLabPublicOwnerSession) Close() error {
	if s == nil {
		return nil
	}
	s.Retire()
	s.mu.Lock()
	if s.closed {
		err := s.closeErr
		s.mu.Unlock()
		return err
	}
	if s.closing {
		done := s.closeDone
		s.mu.Unlock()
		<-done
		s.mu.Lock()
		err := s.closeErr
		s.mu.Unlock()
		return err
	}
	s.closing = true
	if s.closeDone == nil {
		s.closeDone = make(chan struct{})
	}
	s.mu.Unlock()
	// Admission and Add are under mu; Retire precedes Wait. No owner can be
	// destroyed between its checkpoint.current, sign and durable publication.
	s.active.Wait()
	var closeErr error
	for _, index := range s.options.Owners {
		if sender := s.owners[index]; sender != nil {
			closeErr = errors.Join(closeErr, s.gates[index].closeErr, sender.Close())
		}
	}
	closeErr = errors.Join(closeErr, s.checkpoints.Close())
	if s.public != nil {
		closeErr = errors.Join(closeErr, s.public.close())
	}
	clear(s.credential)
	s.credential = nil
	s.mu.Lock()
	s.closeErr, s.closed = closeErr, true
	close(s.closeDone)
	s.mu.Unlock()
	return closeErr
}

// PrepareSource establishes the same session-owned static witness before the
// command stream starts. It reads no sender key or current checkpoint, consumes
// no owner command budget, and grants no signing eligibility. Close joins this
// read just like an admitted command; cancellation/retirement never emits READY.
func (s *PQLabPublicOwnerSession) PrepareSource(ctx context.Context, metrics *PQLabMetrics) error {
	defer pqLabMeasure(metrics, "publicOwner.prepareSource")()
	if s == nil {
		return errors.New("original public owner session required")
	}
	s.mu.Lock()
	if err := s.alive(ctx); err != nil {
		s.mu.Unlock()
		return err
	}
	s.active.Add(1)
	s.mu.Unlock()
	defer s.active.Done()
	if err := s.currentPublic(); err != nil {
		return err
	}
	if err := s.checkpoints.Prepare(s.options.RootDir, s.options.PlanSHA256, s.options.ActivationSHA256, metrics); err != nil {
		return err
	}
	if err := s.currentPublic(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.alive(ctx)
}

func (s *PQLabPublicOwnerSession) Stats() PQLabPublicOwnerSessionStats {
	if s == nil {
		return PQLabPublicOwnerSessionStats{}
	}
	s.mu.Lock()
	result := PQLabPublicOwnerSessionStats{AllowedOwners: len(s.options.Owners), Commands: s.commands, CommandLimit: s.budget, Retired: s.retired.Load(), Closed: s.closed}
	for _, sender := range s.owners {
		if sender != nil {
			result.OpenedOwners++
		}
	}
	s.mu.Unlock()
	// Public capture may hold its own lock during full validation. Never hold
	// session admission while waiting for these observational snapshots.
	result.StaticCache = s.checkpoints.CacheStats()
	result.SourceInputs = s.checkpoints.SourceStats()
	return result
}

func (s *PQLabPublicOwnerSession) alive(ctx context.Context) error {
	if s.closed || s.retired.Load() || ctx == nil || s.ctx == nil {
		return errors.New("original public owner session retired or closed")
	}
	return errors.Join(s.ctx.Err(), ctx.Err())
}

func (s *PQLabPublicOwnerSession) currentPublic() error {
	s.publicMu.Lock()
	defer s.publicMu.Unlock()
	return s.public.current()
}

func (s *PQLabPublicOwnerSession) beginOwner(ctx context.Context, request PQLabSenderRequest, metrics *PQLabMetrics) (*PQLabSender, func(), error) {
	s.mu.Lock()
	if err := s.alive(ctx); err != nil {
		s.mu.Unlock()
		return nil, nil, err
	}
	gate, allowed := s.gates[request.OwnerIndex]
	if !allowed || gate.retired.Load() || request.Version != "YNX-PQ-LAB-SENDER-REQUEST/v1" || gate.commands >= gate.budget {
		s.mu.Unlock()
		return nil, nil, errors.New("original owner or bounded command budget refused")
	}
	s.commands++
	gate.commands++
	s.active.Add(1)
	s.mu.Unlock()
	if !gate.mu.TryLock() {
		s.active.Done()
		return nil, nil, ErrPQLabPublicOwnerBusy
	}
	done := func() { gate.mu.Unlock(); s.active.Done() }
	fail := func(err error) (*PQLabSender, func(), error) { done(); return nil, nil, err }
	if gate.retired.Load() {
		return fail(errors.New("original owner retired"))
	}
	if err := s.currentPublic(); err != nil {
		return fail(err)
	}
	s.mu.Lock()
	sender := s.owners[request.OwnerIndex]
	s.mu.Unlock()
	if sender == nil {
		var err error
		sender, err = OpenPQLabSenderMeasured(filepath.Join(s.options.RootDir, "workload"), s.options.WorkloadSHA256, request.OwnerIndex, s.credential, metrics)
		if err != nil {
			return fail(err)
		}
		// OpenPQLabSender has checked the same original manifest hash and full
		// registered pair. Share only this immutable public decoded value; do
		// not retain one full owner directory per imported private key.
		sender.manifest = s.manifest
		s.mu.Lock()
		s.owners[request.OwnerIndex] = sender
		s.mu.Unlock()
	}
	if err := s.alive(ctx); err != nil {
		return fail(err)
	}
	return sender, done, nil
}

func (s *PQLabPublicOwnerSession) Sign(ctx context.Context, request PQLabSenderRequest, height int64, appHash string, metrics *PQLabMetrics) (PQLabSenderResult, error) {
	defer pqLabMeasure(metrics, "publicOwner.signTotal")()
	if s == nil {
		return PQLabSenderResult{}, errors.New("original public owner session required")
	}
	sender, done, err := s.beginOwner(ctx, request, metrics)
	if err != nil {
		return PQLabSenderResult{}, err
	}
	defer done()
	// Existing operation recovery must not depend on a new checkpoint or sign.
	operation, err := sender.operation(request.OperationID)
	if err != nil {
		return PQLabSenderResult{}, err
	}
	var checkpoint *PQLabSenderCheckpoint
	if _, err = os.Lstat(operation); os.IsNotExist(err) {
		checkpoint, err = s.checkpoints.Load(s.options.RootDir, s.options.PlanSHA256, s.options.ActivationSHA256, height, appHash, metrics)
	} else if err != nil {
		return PQLabSenderResult{}, ErrPQLabSenderUnknown
	}
	if err != nil {
		return PQLabSenderResult{}, err
	}
	if err = s.alive(ctx); err != nil {
		return PQLabSenderResult{}, err
	}
	result, err := sender.SignMeasured(request, checkpoint, metrics)
	if err == nil && (s.alive(ctx) != nil || s.currentPublic() != nil) {
		return PQLabSenderResult{}, ErrPQLabSenderUnknown
	}
	return result, err
}

func (s *PQLabPublicOwnerSession) Recover(ctx context.Context, request PQLabSenderRequest, metrics *PQLabMetrics) (PQLabSenderResult, error) {
	if s == nil {
		return PQLabSenderResult{}, errors.New("original public owner session required")
	}
	sender, done, err := s.beginOwner(ctx, request, metrics)
	if err != nil {
		return PQLabSenderResult{}, err
	}
	defer done()
	result, err := sender.Recover(request)
	if err == nil && (s.alive(ctx) != nil || s.currentPublic() != nil) {
		return PQLabSenderResult{}, ErrPQLabSenderUnknown
	}
	return result, err
}

func (s *PQLabPublicOwnerSession) Confirm(ctx context.Context, request PQLabSenderRequest, materials PQLabProofMaterials, proof PQTransactionProofRequest, now time.Time, metrics *PQLabMetrics) (PQLabProofExport, error) {
	if s == nil {
		return PQLabProofExport{}, errors.New("original public owner session required")
	}
	sender, done, err := s.beginOwner(ctx, request, metrics)
	if err != nil {
		return PQLabProofExport{}, err
	}
	defer done()
	result, err := sender.ConfirmMeasured(request, materials, proof, now, metrics)
	if err == nil && (s.alive(ctx) != nil || s.currentPublic() != nil) {
		return PQLabProofExport{}, ErrPQLabSenderUnknown
	}
	return result, err
}

// CloseOwner retires only the selected original custody. It does not clear its
// durable UNKNOWN, acquire another nonce, close public inputs or touch peers.
// Reopening a retired owner requires a new explicitly pinned session.
func (s *PQLabPublicOwnerSession) CloseOwner(ctx context.Context, index int) error {
	if s == nil {
		return errors.New("original public owner session required")
	}
	s.mu.Lock()
	if err := s.alive(ctx); err != nil {
		s.mu.Unlock()
		return err
	}
	gate, allowed := s.gates[index]
	if !allowed || gate.retired.Load() {
		s.mu.Unlock()
		return errors.New("original owner absent or already retired")
	}
	gate.retired.Store(true)
	s.commands++
	s.active.Add(1)
	s.mu.Unlock()
	defer s.active.Done()
	gate.mu.Lock()
	defer gate.mu.Unlock()
	s.mu.Lock()
	sender := s.owners[index]
	s.mu.Unlock()
	if sender != nil {
		gate.closeErr = errors.Join(gate.closeErr, sender.Close())
	}
	return gate.closeErr
}
