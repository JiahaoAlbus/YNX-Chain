package mempool

import (
	"errors"
	"reflect"
	"sync"
	"time"

	"github.com/cometbft/cometbft/p2p"
)

var ErrLosslessHexPeerBudget = errors.New("lossless hex: peer budget unavailable or exhausted")

// Only the explicitly enabled transport uses this connection-private slot.
// There is no process-wide peer-ID map and no reset on a repeated InitPeer.
const losslessHexPeerBudgetKey = "mempool.lossless-hex-v1.private-budget"

type losslessHexBudgetLimits struct {
	maxPeerBytes    uint64
	maxPeerDuration time.Duration
	maxSendAttempts int
	maxSendDuration time.Duration
}

func normalizeLosslessHexBudget(limits LosslessHexLimits) (losslessHexBudgetLimits, error) {
	if limits.MaxPeerBytes == 0 {
		limits.MaxPeerBytes = 64 << 20
	}
	if limits.MaxPeerDuration == 0 {
		limits.MaxPeerDuration = 30 * time.Second
	}
	if limits.MaxSendAttempts == 0 {
		limits.MaxSendAttempts = 3
	}
	if limits.MaxSendDuration == 0 {
		limits.MaxSendDuration = 2 * time.Second
	}
	if limits.MaxPeerBytes > 1<<30 ||
		limits.MaxPeerDuration < time.Millisecond || limits.MaxPeerDuration > 5*time.Minute ||
		limits.MaxSendAttempts < 1 || limits.MaxSendAttempts > 16 ||
		limits.MaxSendDuration < time.Millisecond || limits.MaxSendDuration > 30*time.Second {
		return losslessHexBudgetLimits{}, ErrLosslessHexLimit
	}
	return losslessHexBudgetLimits{
		maxPeerBytes: limits.MaxPeerBytes, maxPeerDuration: limits.MaxPeerDuration,
		maxSendAttempts: limits.MaxSendAttempts, maxSendDuration: limits.MaxSendDuration,
	}, nil
}

type losslessHexPeerBudget struct {
	owner *losslessHexTransport
	peer  p2p.Peer
	mu    sync.Mutex

	firstUse time.Time
	lastUse  time.Time
	started  bool
	used     uint64
	closed   bool
}

type losslessHexSendBudget struct {
	owner *losslessHexTransport
	peer  *losslessHexPeerBudget
	mu    sync.Mutex

	firstUse time.Time
	lastUse  time.Time
	attempts int
	closed   bool
}

// Normal p2p peers and the bounded test peers are pointer-backed connections.
// Refuse nil/value wrappers rather than compare a possibly non-comparable
// interface or let a copied private slot impersonate another connection.
func losslessHexBudgetPeerPointer(peer p2p.Peer) bool {
	value := reflect.ValueOf(peer)
	return value.IsValid() && value.Kind() == reflect.Ptr && !value.IsNil()
}

func (t *losslessHexTransport) initPeer(peer p2p.Peer) {
	if t == nil || !losslessHexBudgetPeerPointer(peer) {
		return
	}
	// InitPeer is normally serialized by Switch. This also prevents concurrent
	// initialization by the same transport from replacing a spent/closed slot.
	// Never acquire a peer/send budget mutex while holding t.mu.
	t.mu.Lock()
	defer t.mu.Unlock()
	if peer.Get(losslessHexPeerBudgetKey) != nil {
		return
	}
	peer.Set(losslessHexPeerBudgetKey, &losslessHexPeerBudget{owner: t, peer: peer})
}

func (t *losslessHexTransport) peerBudget(peer p2p.Peer) (*losslessHexPeerBudget, error) {
	if t == nil || !losslessHexBudgetPeerPointer(peer) {
		return nil, ErrLosslessHexPeerBudget
	}
	state, ok := peer.Get(losslessHexPeerBudgetKey).(*losslessHexPeerBudget)
	if !ok || state == nil || state.owner != t || state.peer != peer {
		return nil, ErrLosslessHexPeerBudget
	}
	return state, nil
}

func (t *losslessHexTransport) closePeer(peer p2p.Peer) {
	state, err := t.peerBudget(peer)
	if err != nil {
		return
	}
	state.mu.Lock()
	state.closed = true
	state.mu.Unlock()
	// Leave the spent slot on this actual connection. Reinitializing it cannot
	// refresh a window; a genuinely new peer object has its own private slot.
}

// reservePeerLocked requires state.mu. The clock is read under that mutex so
// concurrent reservations cannot mistake scheduling order for clock rollback.
// Successful costs are never refunded, including queue-false send attempts.
func (t *losslessHexTransport) reservePeerLocked(state *losslessHexPeerBudget, now time.Time, cost uint64) error {
	if state.closed || t.budget.maxPeerBytes == 0 || t.budget.maxPeerDuration <= 0 {
		return ErrLosslessHexPeerBudget
	}
	if !state.started {
		state.firstUse, state.lastUse, state.started = now, now, true
	} else {
		if now.Before(state.lastUse) {
			state.closed = true
			return ErrLosslessHexPeerBudget
		}
		state.lastUse = now
	}
	if now.Sub(state.firstUse) >= t.budget.maxPeerDuration {
		state.closed = true
		return ErrLosslessHexPeerBudget
	}
	// Subtract before adding: even a hostile MaxUint64 cost cannot wrap used.
	if state.used > t.budget.maxPeerBytes || cost > t.budget.maxPeerBytes-state.used {
		return ErrLosslessHexPeerBudget
	}
	state.used += cost
	return nil
}

func (t *losslessHexTransport) reservePeer(peer p2p.Peer, cost uint64) error {
	state, err := t.peerBudget(peer)
	if err != nil {
		return err
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if t.now == nil {
		return ErrLosslessHexPeerBudget
	}
	return t.reservePeerLocked(state, t.now(), cost)
}

func (t *losslessHexTransport) newSendBudget(peer p2p.Peer) (*losslessHexSendBudget, error) {
	state, err := t.peerBudget(peer)
	if err != nil {
		return nil, err
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if t.now == nil || t.budget.maxSendAttempts < 1 || t.budget.maxSendDuration <= 0 {
		return nil, ErrLosslessHexPeerBudget
	}
	now := t.now()
	if err := t.reservePeerLocked(state, now, 0); err != nil {
		return nil, err
	}
	return &losslessHexSendBudget{owner: t, peer: state, firstUse: now, lastUse: now}, nil
}

func (t *losslessHexTransport) reserveSendAttempt(peer p2p.Peer, budget *losslessHexSendBudget, frameBytes uint64) error {
	state, err := t.peerBudget(peer)
	if err != nil {
		return err
	}
	if budget == nil || budget.owner != t || budget.peer != state {
		return ErrLosslessHexPeerBudget
	}
	// The sole two-budget lock order is peer.mu -> send.mu. Close takes only
	// peer.mu; no path takes t.mu here or calls peer.Get/Set while either is held.
	// Both byte deduction and attempt increment commit under these locks.
	state.mu.Lock()
	defer state.mu.Unlock()
	budget.mu.Lock()
	defer budget.mu.Unlock()
	if t.now == nil || budget.closed || state.closed || t.budget.maxSendAttempts < 1 || t.budget.maxSendDuration <= 0 {
		return ErrLosslessHexPeerBudget
	}
	now := t.now()
	if now.Before(budget.lastUse) {
		budget.closed, state.closed = true, true
		return ErrLosslessHexPeerBudget
	}
	budget.lastUse = now
	if now.Sub(budget.firstUse) >= t.budget.maxSendDuration {
		budget.closed = true
		return ErrLosslessHexPeerBudget
	}
	if budget.attempts >= t.budget.maxSendAttempts {
		return ErrLosslessHexPeerBudget
	}
	if err := t.reservePeerLocked(state, now, frameBytes); err != nil {
		return err
	}
	budget.attempts++
	return nil
}
