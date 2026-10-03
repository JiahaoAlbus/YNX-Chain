package chaincrypto

import (
	"context"
	"crypto/sha256"
	"sync"
)

// MigrationState is an isolated state-transaction candidate. ActivationHeight
// comes from the independently authenticated consensus state, never a signed
// request. This package does not authenticate an initial state or activate it.
type MigrationState struct {
	Network                                                Network
	Policy                                                 AuthPolicy
	NextNonce, Revision, ActivationHeight, CommittedHeight uint64
}

func snapshotMigrationState(s MigrationState) MigrationState {
	s.Policy = snapshotPolicy(s.Policy)
	return s
}

func (s MigrationState) validate() error {
	if !networkValid(s.Network) || s.Policy.Validate() != nil || s.NextNonce == 0 || s.Revision == 0 || s.CommittedHeight == 0 {
		return ErrInvalid
	}
	if (s.Policy.State == HybridEnforced || s.Policy.State == RecoveryPending) &&
		(s.ActivationHeight == 0 || s.Policy.EnforceHeight != s.ActivationHeight) {
		return ErrInvalid
	}
	return nil
}

func migrationStateHash(s MigrationState) [32]byte {
	// Every committed context field participates; no cross-network/height or
	// stale-revision capability may consume the next nonce.
	b := make([]byte, 0, 4000)
	n := sha256.Sum256([]byte(s.Network.ConsensusID))
	b = append(b, n[:]...)
	b = append(b, s.Network.Genesis[:]...)
	for _, v := range []uint64{s.Network.ChainID, s.NextNonce, s.Revision, s.ActivationHeight, s.CommittedHeight} {
		for i := 7; i >= 0; i-- {
			b = append(b, byte(v>>(uint(i)*8)))
		}
	}
	p := policyHash(s.Policy)
	b = append(b, p[:]...)
	return sha256.Sum256(b)
}

// CommittedMigration is deliberately opaque and unexportable. It authorizes
// exactly one state snapshot and retains the original verified request bytes.
type CommittedMigration struct {
	before [32]byte
	proof  TransitionProof
	next   MigrationState
	valid  bool
}

func PrepareCommittedMigration(ctx context.Context, s MigrationState, provider CryptoProvider,
	m MigrationRequest, signatures Signatures, newPossession []byte, height uint64) (CommittedMigration, error) {
	var zero CommittedMigration
	if ctx == nil || ctx.Err() != nil || !boundedKeys(s.Policy.Keys) || len(m.NewPQKey) > 2592 ||
		!boundedSignatures(signatures) || len(newPossession) > 4627 {
		return zero, ErrInvalid
	}
	s = snapshotMigrationState(s)
	m.NewPQKey = append([]byte(nil), m.NewPQKey...)
	signatures = snapshotSignatures(signatures)
	newPossession = append([]byte(nil), newPossession...)
	if s.validate() != nil || height < s.CommittedHeight || s.NextNonce == ^uint64(0) || s.Revision == ^uint64(0) || s.Policy.Version == ^uint64(0) {
		return zero, ErrInvalid
	}
	if (s.Policy.State == HybridEnforced || s.Policy.State == RecoveryPending) && height < s.Policy.EnforceHeight {
		return zero, ErrInvalid
	}
	verifier := TxVerifier{Provider: provider, Network: s.Network}
	proof, err := verifier.VerifyTransition(s.Policy, m, signatures, newPossession, height, s.NextNonce)
	if err != nil {
		return zero, err
	}
	if err = ctx.Err(); err != nil {
		return zero, err
	}
	authorized, err := AuthorizedMigration(s.Policy, proof, height, s.NextNonce)
	if err != nil {
		return zero, err
	}
	next := snapshotMigrationState(s)
	next.Policy.State = authorized.Next
	next.Policy.Version++
	next.NextNonce++
	next.Revision++
	next.CommittedHeight = height
	switch {
	case s.Policy.State == Legacy && authorized.Next == PQRegistered:
		next.Policy.Keys.PostQuantum = append([]byte(nil), authorized.NewPQKey...)
	case s.Policy.State == PQRegistered && authorized.Next == HybridEnforced:
		if s.ActivationHeight == 0 || height < s.ActivationHeight {
			return zero, ErrInvalid
		}
		next.Policy.EnforceHeight = s.ActivationHeight
	case s.Policy.State == RecoveryPending && authorized.Next == HybridEnforced:
		if next.Policy.KeyVersion == ^uint64(0) {
			return zero, ErrInvalid
		}
		next.Policy.KeyVersion++
		next.Policy.Keys.PostQuantum = append([]byte(nil), authorized.NewPQKey...)
	}
	if next.validate() != nil {
		return zero, ErrInvalid
	}
	if err := ctx.Err(); err != nil {
		return zero, err
	}
	return CommittedMigration{before: migrationStateHash(s), proof: proof, next: next, valid: true}, nil
}

// MemoryMigrationLedger implements the same-lock policy-and-nonce transaction
// for isolated concurrency vectors. It is NOT durable consensus storage. A
// production state adapter must commit the entire returned state in its original
// chain transaction and authenticate the initial state/activation schedule.
type MemoryMigrationLedger struct {
	mu    sync.Mutex
	state MigrationState
}

func NewMemoryMigrationLedger(s MigrationState) (*MemoryMigrationLedger, error) {
	if !boundedKeys(s.Policy.Keys) {
		return nil, ErrInvalid
	}
	s = snapshotMigrationState(s)
	if s.validate() != nil {
		return nil, ErrInvalid
	}
	return &MemoryMigrationLedger{state: s}, nil
}

func (l *MemoryMigrationLedger) Snapshot() MigrationState {
	l.mu.Lock()
	defer l.mu.Unlock()
	return snapshotMigrationState(l.state)
}

func (l *MemoryMigrationLedger) Commit(ctx context.Context, authorized CommittedMigration, height uint64) (MigrationState, error) {
	if l == nil || ctx == nil {
		return MigrationState{}, ErrInvalid
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return MigrationState{}, err
	}
	if !authorized.valid || authorized.before != migrationStateHash(l.state) ||
		height < authorized.next.CommittedHeight ||
		Transition(l.state.Policy, authorized.proof.next, authorized.proof, height, l.state.NextNonce) != nil {
		return MigrationState{}, ErrInvalid
	}
	if (authorized.next.Policy.State == HybridEnforced || authorized.next.Policy.State == RecoveryPending) && height < authorized.next.Policy.EnforceHeight {
		return MigrationState{}, ErrInvalid
	}
	if err := ctx.Err(); err != nil {
		return MigrationState{}, err
	}
	// No caller-owned key, network, nonce or policy object is copied at commit.
	// This single assignment is the isolated ledger's linearization point.
	l.state = snapshotMigrationState(authorized.next)
	l.state.CommittedHeight = height
	return snapshotMigrationState(l.state), nil
}
