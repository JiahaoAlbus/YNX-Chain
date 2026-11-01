package mempool

import (
	"errors"
	"math"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cometbft/cometbft/p2p"
)

// These peers have no connection, goroutine, send method or business verifier.
// Only the actual connection-private Get/Set contract is exercised here.
type losslessBudgetOnlyPeer struct {
	p2p.Peer
	values   sync.Map
	getCalls atomic.Int64
	setCalls atomic.Int64
}

func (p *losslessBudgetOnlyPeer) ID() p2p.ID {
	return p2p.ID("1111111111111111111111111111111111111111")
}

func (p *losslessBudgetOnlyPeer) Get(key string) interface{} {
	p.getCalls.Add(1)
	value, _ := p.values.Load(key)
	return value
}

func (p *losslessBudgetOnlyPeer) Set(key string, value interface{}) {
	p.setCalls.Add(1)
	p.values.Store(key, value)
}

type losslessBudgetOnlyClock struct {
	mu    sync.Mutex
	value time.Time
}

func (c *losslessBudgetOnlyClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.value
}

func (c *losslessBudgetOnlyClock) set(value time.Time) {
	c.mu.Lock()
	c.value = value
	c.mu.Unlock()
}

func newLosslessBudgetOnlyTransport(t *testing.T, limits LosslessHexLimits) (*losslessHexTransport, *losslessBudgetOnlyClock) {
	t.Helper()
	budget, err := normalizeLosslessHexBudget(limits)
	if err != nil {
		t.Fatal(err)
	}
	clock := &losslessBudgetOnlyClock{value: time.Unix(100, 0)}
	return &losslessHexTransport{budget: budget, now: clock.now}, clock
}

func losslessBudgetOnlyState(t *testing.T, peer *losslessBudgetOnlyPeer) *losslessHexPeerBudget {
	t.Helper()
	raw, _ := peer.values.Load(losslessHexPeerBudgetKey)
	state, ok := raw.(*losslessHexPeerBudget)
	if !ok || state == nil {
		t.Fatal("connection has no original budget state")
	}
	return state
}

func losslessBudgetOnlyUsed(t *testing.T, peer *losslessBudgetOnlyPeer) uint64 {
	t.Helper()
	state := losslessBudgetOnlyState(t, peer)
	state.mu.Lock()
	defer state.mu.Unlock()
	return state.used
}

func requireLosslessBudgetError(t *testing.T, err error) {
	t.Helper()
	if !errors.Is(err, ErrLosslessHexPeerBudget) {
		t.Fatalf("expected original peer budget refusal, got %v", err)
	}
}

func TestLosslessHexBudgetNormalize(t *testing.T) {
	budget, err := normalizeLosslessHexBudget(LosslessHexLimits{})
	if err != nil || budget.maxPeerBytes != 64<<20 || budget.maxPeerDuration != 30*time.Second || budget.maxSendAttempts != 3 || budget.maxSendDuration != 2*time.Second {
		t.Fatalf("zero must select finite defaults: %+v, %v", budget, err)
	}
	for _, limits := range []LosslessHexLimits{
		{MaxPeerBytes: 1, MaxPeerDuration: time.Millisecond, MaxSendAttempts: 1, MaxSendDuration: time.Millisecond},
		{MaxPeerBytes: 1 << 30, MaxPeerDuration: 5 * time.Minute, MaxSendAttempts: 16, MaxSendDuration: 30 * time.Second},
	} {
		if _, err := normalizeLosslessHexBudget(limits); err != nil {
			t.Fatalf("inclusive valid configuration bound refused: %+v: %v", limits, err)
		}
	}
	invalid := []struct {
		name   string
		limits LosslessHexLimits
	}{
		{"peer_bytes", LosslessHexLimits{MaxPeerBytes: (1 << 30) + 1}},
		{"peer_bytes_overflow", LosslessHexLimits{MaxPeerBytes: math.MaxUint64}},
		{"peer_duration_negative", LosslessHexLimits{MaxPeerDuration: -time.Millisecond}},
		{"peer_duration_short", LosslessHexLimits{MaxPeerDuration: time.Millisecond - time.Nanosecond}},
		{"peer_duration_long", LosslessHexLimits{MaxPeerDuration: 5*time.Minute + time.Nanosecond}},
		{"attempts_negative", LosslessHexLimits{MaxSendAttempts: -1}},
		{"attempts_long", LosslessHexLimits{MaxSendAttempts: 17}},
		{"send_duration_negative", LosslessHexLimits{MaxSendDuration: -time.Millisecond}},
		{"send_duration_short", LosslessHexLimits{MaxSendDuration: time.Millisecond - time.Nanosecond}},
		{"send_duration_long", LosslessHexLimits{MaxSendDuration: 30*time.Second + time.Nanosecond}},
	}
	for _, tc := range invalid {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := normalizeLosslessHexBudget(tc.limits); !errors.Is(err, ErrLosslessHexLimit) {
				t.Fatalf("unbounded/invalid configuration accepted: %v", err)
			}
		})
	}
}

func TestLosslessHexBudgetPeerIdentityAndLifetime(t *testing.T) {
	transport, _ := newLosslessBudgetOnlyTransport(t, LosslessHexLimits{MaxPeerBytes: 3})
	peer := &losslessBudgetOnlyPeer{}
	var disabled *losslessHexTransport
	disabled.initPeer(peer)
	disabled.closePeer(peer)
	requireLosslessBudgetError(t, disabled.reservePeer(peer, 1))
	if peer.getCalls.Load() != 0 || peer.setCalls.Load() != 0 {
		t.Fatal("disabled transport touched a peer slot")
	}
	var typedNil *losslessBudgetOnlyPeer
	transport.initPeer(typedNil)
	requireLosslessBudgetError(t, transport.reservePeer(typedNil, 1))
	requireLosslessBudgetError(t, transport.reservePeer(peer, 1))
	if _, err := transport.newSendBudget(peer); !errors.Is(err, ErrLosslessHexPeerBudget) {
		t.Fatalf("uninitialized connection got a send budget: %v", err)
	}
	transport.initPeer(peer)
	state := losslessBudgetOnlyState(t, peer)
	var initializers sync.WaitGroup
	for i := 0; i < 16; i++ {
		initializers.Add(1)
		go func() { defer initializers.Done(); transport.initPeer(peer) }()
	}
	initializers.Wait()
	if err := transport.reservePeer(peer, 3); err != nil {
		t.Fatal(err)
	}
	transport.initPeer(peer)
	if losslessBudgetOnlyState(t, peer) != state || peer.setCalls.Load() != 1 {
		t.Fatal("repeated init replaced the spent original slot")
	}
	requireLosslessBudgetError(t, transport.reservePeer(peer, 1))
	other, _ := newLosslessBudgetOnlyTransport(t, LosslessHexLimits{})
	other.initPeer(peer)
	other.closePeer(peer)
	requireLosslessBudgetError(t, other.reservePeer(peer, 0))
	if err := transport.reservePeer(peer, 0); err != nil {
		t.Fatalf("foreign owner changed the original connection: %v", err)
	}
	transport.closePeer(peer)
	transport.initPeer(peer)
	requireLosslessBudgetError(t, transport.reservePeer(peer, 0))
	if _, err := transport.newSendBudget(peer); !errors.Is(err, ErrLosslessHexPeerBudget) {
		t.Fatalf("closed connection reopened: %v", err)
	}
	newPeer := &losslessBudgetOnlyPeer{}
	if peer.ID() != newPeer.ID() {
		t.Fatal("test must use the same peer ID on different connections")
	}
	transport.initPeer(newPeer)
	if err := transport.reservePeer(newPeer, 3); err != nil {
		t.Fatalf("genuinely new connection inherited old debt: %v", err)
	}
	transport.closePeer(peer)
	if err := transport.reservePeer(newPeer, 0); err != nil {
		t.Fatalf("old connection close affected its successor: %v", err)
	}
	copyPeer := &losslessBudgetOnlyPeer{}
	copyPeer.values.Store(losslessHexPeerBudgetKey, losslessBudgetOnlyState(t, newPeer))
	requireLosslessBudgetError(t, transport.reservePeer(copyPeer, 0))
}

func TestLosslessHexBudgetPeerBytes(t *testing.T) {
	transport, _ := newLosslessBudgetOnlyTransport(t, LosslessHexLimits{MaxPeerBytes: 5})
	peer := &losslessBudgetOnlyPeer{}
	transport.initPeer(peer)
	if err := transport.reservePeer(peer, 4); err != nil {
		t.Fatal(err)
	}
	requireLosslessBudgetError(t, transport.reservePeer(peer, 2))
	requireLosslessBudgetError(t, transport.reservePeer(peer, math.MaxUint64))
	if got := losslessBudgetOnlyUsed(t, peer); got != 4 {
		t.Fatalf("failed reservation changed or wrapped used: %d", got)
	}
	if err := transport.reservePeer(peer, 1); err != nil {
		t.Fatalf("exact byte limit must remain usable: %v", err)
	}
	requireLosslessBudgetError(t, transport.reservePeer(peer, 1))
	if got := losslessBudgetOnlyUsed(t, peer); got != 5 {
		t.Fatalf("successful costs were refunded: %d", got)
	}
}

func TestLosslessHexBudgetPeerClock(t *testing.T) {
	t.Run("zero_time_and_exact_deadline", func(t *testing.T) {
		transport, clock := newLosslessBudgetOnlyTransport(t, LosslessHexLimits{MaxPeerDuration: 10 * time.Millisecond})
		peer := &losslessBudgetOnlyPeer{}
		transport.initPeer(peer)
		start := time.Time{}
		clock.set(start)
		if err := transport.reservePeer(peer, 1); err != nil {
			t.Fatal(err)
		}
		clock.set(start.Add(10*time.Millisecond - time.Nanosecond))
		if err := transport.reservePeer(peer, 1); err != nil {
			t.Fatal(err)
		}
		clock.set(start.Add(10 * time.Millisecond))
		requireLosslessBudgetError(t, transport.reservePeer(peer, 1))
		transport.initPeer(peer)
		requireLosslessBudgetError(t, transport.reservePeer(peer, 0))
		if got := losslessBudgetOnlyUsed(t, peer); got != 2 {
			t.Fatalf("expired reservation was charged or reset: %d", got)
		}
	})
	t.Run("regression_after_first_use_is_terminal", func(t *testing.T) {
		transport, clock := newLosslessBudgetOnlyTransport(t, LosslessHexLimits{})
		peer := &losslessBudgetOnlyPeer{}
		transport.initPeer(peer)
		start := clock.now()
		if err := transport.reservePeer(peer, 1); err != nil {
			t.Fatal(err)
		}
		clock.set(start.Add(5 * time.Millisecond))
		if err := transport.reservePeer(peer, 1); err != nil {
			t.Fatal(err)
		}
		clock.set(start.Add(4 * time.Millisecond))
		requireLosslessBudgetError(t, transport.reservePeer(peer, 1))
		clock.set(start.Add(6 * time.Millisecond))
		requireLosslessBudgetError(t, transport.reservePeer(peer, 1))
	})
	t.Run("missing_clock", func(t *testing.T) {
		transport, _ := newLosslessBudgetOnlyTransport(t, LosslessHexLimits{})
		peer := &losslessBudgetOnlyPeer{}
		transport.initPeer(peer)
		transport.now = nil
		requireLosslessBudgetError(t, transport.reservePeer(peer, 0))
		_, err := transport.newSendBudget(peer)
		requireLosslessBudgetError(t, err)
	})
}

func TestLosslessHexBudgetSendAttemptsAndAtomicCharge(t *testing.T) {
	transport, _ := newLosslessBudgetOnlyTransport(t, LosslessHexLimits{MaxPeerBytes: 10, MaxSendAttempts: 3})
	peer := &losslessBudgetOnlyPeer{}
	transport.initPeer(peer)
	budget, err := transport.newSendBudget(peer)
	if err != nil {
		t.Fatal(err)
	}
	requireLosslessBudgetError(t, transport.reserveSendAttempt(peer, budget, 11))
	if budget.attempts != 0 || losslessBudgetOnlyUsed(t, peer) != 0 {
		t.Fatal("failed byte reservation spent an attempt or partial byte debt")
	}
	// The first two reservations may represent queue-false attempts. They remain
	// spent; no queue-success callback/refund exists in this module.
	for i := 0; i < 3; i++ {
		if err := transport.reserveSendAttempt(peer, budget, 3); err != nil {
			t.Fatal(err)
		}
	}
	requireLosslessBudgetError(t, transport.reserveSendAttempt(peer, budget, 1))
	if budget.attempts != 3 || losslessBudgetOnlyUsed(t, peer) != 9 {
		t.Fatal("attempt cap failed or charged a refused fourth attempt")
	}
	// A different pending send has its own attempt counter, while sharing the
	// original connection's cumulative byte/time debt.
	next, err := transport.newSendBudget(peer)
	if err != nil {
		t.Fatal(err)
	}
	if err := transport.reserveSendAttempt(peer, next, 1); err != nil {
		t.Fatal(err)
	}
	requireLosslessBudgetError(t, transport.reserveSendAttempt(peer, next, 1))
	if next.attempts != 1 || losslessBudgetOnlyUsed(t, peer) != 10 {
		t.Fatal("new send reset peer debt or failed charge spent an attempt")
	}
}

func TestLosslessHexBudgetSendIdentityAndClock(t *testing.T) {
	transport, clock := newLosslessBudgetOnlyTransport(t, LosslessHexLimits{MaxSendDuration: 10 * time.Millisecond})
	peer, otherPeer := &losslessBudgetOnlyPeer{}, &losslessBudgetOnlyPeer{}
	transport.initPeer(peer)
	transport.initPeer(otherPeer)
	budget, err := transport.newSendBudget(peer)
	if err != nil {
		t.Fatal(err)
	}
	requireLosslessBudgetError(t, transport.reserveSendAttempt(otherPeer, budget, 1))
	requireLosslessBudgetError(t, transport.reserveSendAttempt(peer, nil, 1))
	other, _ := newLosslessBudgetOnlyTransport(t, LosslessHexLimits{})
	requireLosslessBudgetError(t, other.reserveSendAttempt(peer, budget, 1))
	start := clock.now()
	clock.set(start.Add(10*time.Millisecond - time.Nanosecond))
	if err := transport.reserveSendAttempt(peer, budget, 1); err != nil {
		t.Fatal(err)
	}
	clock.set(start.Add(10 * time.Millisecond))
	requireLosslessBudgetError(t, transport.reserveSendAttempt(peer, budget, 1))
	clock.set(start.Add(9 * time.Millisecond))
	requireLosslessBudgetError(t, transport.reserveSendAttempt(peer, budget, 1))
	if losslessBudgetOnlyUsed(t, peer) != 1 || losslessBudgetOnlyUsed(t, otherPeer) != 0 {
		t.Fatal("wrong owner/peer or expired send changed cumulative debt")
	}
	transport.closePeer(peer)
	requireLosslessBudgetError(t, transport.reserveSendAttempt(peer, budget, 0))
}

func TestLosslessHexBudgetSendClockRollback(t *testing.T) {
	transport, clock := newLosslessBudgetOnlyTransport(t, LosslessHexLimits{})
	peer := &losslessBudgetOnlyPeer{}
	transport.initPeer(peer)
	budget, err := transport.newSendBudget(peer)
	if err != nil {
		t.Fatal(err)
	}
	start := clock.now()
	clock.set(start.Add(2 * time.Millisecond))
	if err := transport.reserveSendAttempt(peer, budget, 1); err != nil {
		t.Fatal(err)
	}
	clock.set(start.Add(time.Millisecond))
	requireLosslessBudgetError(t, transport.reserveSendAttempt(peer, budget, 1))
	clock.set(start.Add(3 * time.Millisecond))
	_, err = transport.newSendBudget(peer)
	requireLosslessBudgetError(t, err)
}

func TestLosslessHexBudgetParallelReservations(t *testing.T) {
	transport, _ := newLosslessBudgetOnlyTransport(t, LosslessHexLimits{MaxPeerBytes: 257})
	peer := &losslessBudgetOnlyPeer{}
	transport.initPeer(peer)
	var successful atomic.Uint64
	var unexpected atomic.Uint64
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for n := 0; n < 32; n++ {
				err := transport.reservePeer(peer, 1)
				if err == nil {
					successful.Add(1)
				} else if !errors.Is(err, ErrLosslessHexPeerBudget) {
					unexpected.Add(1)
				}
			}
		}()
	}
	wg.Wait()
	if successful.Load() != 257 || losslessBudgetOnlyUsed(t, peer) != 257 || unexpected.Load() != 0 {
		t.Fatalf("concurrent reservation did not enforce one byte budget: successes=%d used=%d unexpected=%d", successful.Load(), losslessBudgetOnlyUsed(t, peer), unexpected.Load())
	}
	t.Run("direct_reservation_close_race", func(t *testing.T) {
		transport, _ := newLosslessBudgetOnlyTransport(t, LosslessHexLimits{MaxPeerBytes: 257})
		peer := &losslessBudgetOnlyPeer{}
		transport.initPeer(peer)
		start := make(chan struct{})
		var successful atomic.Uint64
		var workers sync.WaitGroup
		for i := 0; i < 32; i++ {
			workers.Add(1)
			go func() {
				defer workers.Done()
				<-start
				for n := 0; n < 32; n++ {
					if transport.reservePeer(peer, 1) == nil {
						successful.Add(1)
					}
				}
			}()
		}
		workers.Add(1)
		go func() { defer workers.Done(); <-start; transport.closePeer(peer) }()
		close(start)
		workers.Wait()
		if successful.Load() > 257 || losslessBudgetOnlyUsed(t, peer) != successful.Load() {
			t.Fatalf("close did not serialize with byte charges: success=%d used=%d", successful.Load(), losslessBudgetOnlyUsed(t, peer))
		}
		requireLosslessBudgetError(t, transport.reservePeer(peer, 0))
	})
}

func TestLosslessHexBudgetParallelAttemptsAndClose(t *testing.T) {
	for _, closeDuring := range []bool{false, true} {
		name := "attempts"
		if closeDuring {
			name = "close_race"
		}
		t.Run(name, func(t *testing.T) {
			transport, _ := newLosslessBudgetOnlyTransport(t, LosslessHexLimits{MaxPeerBytes: 100, MaxSendAttempts: 3})
			peer := &losslessBudgetOnlyPeer{}
			transport.initPeer(peer)
			budget, err := transport.newSendBudget(peer)
			if err != nil {
				t.Fatal(err)
			}
			start := make(chan struct{})
			var wg sync.WaitGroup
			var successful atomic.Uint64
			for i := 0; i < 32; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					if transport.reserveSendAttempt(peer, budget, 2) == nil {
						successful.Add(1)
					}
				}()
			}
			if closeDuring {
				wg.Add(1)
				go func() { defer wg.Done(); <-start; transport.closePeer(peer) }()
			}
			close(start)
			wg.Wait()
			count := successful.Load()
			if (!closeDuring && count != 3) || count > 3 || losslessBudgetOnlyUsed(t, peer) != 2*count || budget.attempts != int(count) {
				t.Fatalf("bytes/attempts were not atomic around close: success=%d used=%d attempts=%d", count, losslessBudgetOnlyUsed(t, peer), budget.attempts)
			}
			transport.closePeer(peer)
			requireLosslessBudgetError(t, transport.reservePeer(peer, 0))
			requireLosslessBudgetError(t, transport.reserveSendAttempt(peer, budget, 0))
		})
	}
}
