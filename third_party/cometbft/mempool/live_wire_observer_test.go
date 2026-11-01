//go:build linux || darwin

package mempool

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/cometbft/cometbft/p2p"
	protomem "github.com/cometbft/cometbft/proto/tendermint/mempool"
	"github.com/stretchr/testify/require"
	"golang.org/x/sys/unix"
)

// These use the existing BaseApplication fixture only for original reactor
// counter DATA. No node/peer network, signature, AND or business result runs.
func TestLiveWireObservationDefaultUnknownAndAttachedNotRunning(t *testing.T) {
	var absent *Reactor
	nilSnapshot := absent.LiveWireObservation()
	require.Equal(t, "UNKNOWN", nilSnapshot.Status)
	require.Nil(t, nilSnapshot.Wire)
	r := newLosslessTransportReactor(t, nil)
	channels := r.GetChannels()
	before := r.LiveWireObservation()
	require.Equal(t, "UNKNOWN", before.Status)
	require.Nil(t, before.Wire)
	require.Equal(t, LiveCounterStatus{Status: "UNKNOWN", Reason: "not_supplied"}, before.WireStatus)
	require.Nil(t, before.Lossless)
	require.Equal(t, "DISABLED", before.LosslessStatus.Status)
	require.Nil(t, before.Proto)
	require.Equal(t, "UNKNOWN", before.ProtoStatus.Status)
	require.Nil(t, r.wireObserver.Load())
	require.Nil(t, r.losslessHex.Load())
	observer := &WireObserver{}
	require.NoError(t, r.SetWireObserver(observer))
	attached := r.LiveWireObservation()
	require.Equal(t, "UNKNOWN", attached.Status)
	require.Equal(t, "reactor_not_running", attached.Reason)
	require.NotNil(t, attached.Wire)
	require.True(t, attached.Wire.Attached)
	require.False(t, attached.WireStatus.Complete)
	require.NotNil(t, attached.ObserverLifetimeID)
	require.Equal(t, channels, r.GetChannels())
	require.NoError(t, r.Start())
	live := r.LiveWireObservation()
	require.Equal(t, "OBSERVED", live.Status)
	require.True(t, live.Complete)
	require.Equal(t, "OBSERVED", live.WireStatus.Status)
	require.Equal(t, "DISABLED", live.LosslessStatus.Status)
	require.Nil(t, live.Lossless)
	require.Nil(t, live.Proto)
	require.Equal(t, "UNKNOWN", live.ProtoStatus.Status)
	require.Equal(t, before.ReactorLifetimeID, live.ReactorLifetimeID)
	require.Equal(t, uint64(os.Getpid()), live.ProducerPID)
	require.Equal(t, uint64(1), live.LifecycleGeneration)
	// An active reactor WITHOUT an observer never converts absent counters to
	// zero observations merely because the clock and process are real.
	other := newLosslessTransportReactor(t, nil)
	require.NoError(t, other.Start())
	unknown := other.LiveWireObservation()
	require.Equal(t, "UNKNOWN", unknown.Status)
	require.Equal(t, "wire_not_supplied", unknown.Reason)
	require.Nil(t, unknown.Wire)
}

func TestLiveWireObservationActualCompletedCallsAndOriginalSchemas(t *testing.T) {
	observer := &WireObserver{}
	r := newLosslessTransportReactor(t, observer)
	require.NoError(t, r.Start())
	before := r.LiveWireObservation()
	peer := wireTestSourcePeer(r)
	msg := &protomem.Txs{Txs: [][]byte{[]byte("live-counter-only")}}
	r.Receive(p2p.Envelope{ChannelID: MempoolChannel, Src: peer, Message: msg})
	after := r.LiveWireObservation()
	require.Equal(t, "OBSERVED", after.Status)
	require.Equal(t, before.ReactorLifetimeID, after.ReactorLifetimeID)
	require.Equal(t, *before.ObserverLifetimeID, *after.ObserverLifetimeID)
	require.Equal(t, before.Wire.Received.Messages+1, after.Wire.Received.Messages)
	require.Equal(t, before.Wire.CheckTxCalls+1, after.Wire.CheckTxCalls)
	require.Equal(t, before.Wire.Received.TransactionBytes+uint64(len(msg.Txs[0])), after.Wire.Received.TransactionBytes)
	require.True(t, after.NonAtomic)
	require.True(t, after.CompletedCallsOnly)
	require.True(t, after.InFlightExcluded)
	require.True(t, after.EndpointOnly)
	require.False(t, after.PhysicalBytesMeasured)
	require.Equal(t, observer.Snapshot(), *after.Wire)
	encoded, err := json.Marshal(after)
	require.NoError(t, err)
	// One real, data-only Go JSON object for the owning offline Python adapter
	// compatibility check. It contains no peer, account or transaction payload.
	t.Logf("LIVE_WIRE_OBSERVATION_JSON %s", encoded)
	var raw map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(encoded, &raw))
	for _, field := range []string{"producerPID", "reactorLifetimeID", "observerLifetimeID", "lifecycleGeneration", "startMonotonicNs", "endMonotonicNs"} {
		var decimal string
		require.NoError(t, json.Unmarshal(raw[field], &decimal))
		_, err := strconv.ParseUint(decimal, 10, 64)
		require.NoError(t, err)
	}
	original, err := json.Marshal(observer.Snapshot())
	require.NoError(t, err)
	require.JSONEq(t, string(original), string(raw["wire"]))
	require.Equal(t, "null", string(raw["lossless"]))
	require.Equal(t, "null", string(raw["proto"]))
	// Returned raw/metadata are detached values. Mutating DATA cannot reset,
	// change attachment, or become a constructor for observation authority.
	after.Wire.CheckTxCalls = 0
	*after.ObserverLifetimeID = 0
	current := r.LiveWireObservation()
	require.Equal(t, uint64(1), current.Wire.CheckTxCalls)
	require.NotZero(t, *current.ObserverLifetimeID)
}

func TestLiveWireObservationLosslessRawBusyAndOverflow(t *testing.T) {
	observer := &WireObserver{}
	r := newLosslessTransportReactor(t, observer)
	require.NoError(t, r.EnableExperimentalLosslessHex(LosslessHexLimits{}))
	require.NoError(t, r.Start())
	lossless := r.losslessHex.Load()
	live := r.LiveWireObservation()
	require.Equal(t, "OBSERVED", live.Status)
	require.Equal(t, r.ExperimentalLosslessHexSnapshot(), *live.Lossless)
	require.Equal(t, "OBSERVED", live.LosslessStatus.Status)
	// Holding either original writer mutex cannot block the producer. We do
	// not spin/wait, return a cached old sample, or turn missing raw into zero.
	for _, which := range []string{"wire", "lossless"} {
		if which == "wire" {
			observer.mu.Lock()
		} else {
			lossless.mu.Lock()
		}
		done := make(chan LiveWireObservation, 1)
		go func() { done <- r.LiveWireObservation() }()
		var busy LiveWireObservation
		select {
		case busy = <-done:
		case <-time.After(time.Second):
			if which == "wire" {
				observer.mu.Unlock()
			} else {
				lossless.mu.Unlock()
			}
			t.Fatal("live bounded capture waited on an original counter lock")
		}
		if which == "wire" {
			observer.mu.Unlock()
			require.Nil(t, busy.Wire)
			require.Equal(t, "capture_busy", busy.WireStatus.Reason)
		} else {
			lossless.mu.Unlock()
			require.Nil(t, busy.Lossless)
			require.Equal(t, "capture_busy", busy.LosslessStatus.Reason)
		}
		require.Equal(t, "UNKNOWN", busy.Status)
		require.False(t, busy.Complete)
	}
	observer.mu.Lock()
	observer.snapshot.CheckTxCalls = math.MaxUint64
	observer.add(&observer.snapshot.CheckTxCalls, 1)
	observer.mu.Unlock()
	overflow := r.LiveWireObservation()
	require.Equal(t, "UNKNOWN", overflow.Status)
	require.False(t, overflow.Complete)
	require.True(t, overflow.WireStatus.Overflow)
	require.True(t, overflow.Wire.Overflow)
	require.Equal(t, uint64(math.MaxUint64), overflow.Wire.CheckTxCalls)
	// Raw overflowing values are preserved. Other supplied layers retain their
	// own schema/status; top-level UNKNOWN prevents a whole checkpoint claim.
	lossless.mu.Lock()
	lossless.totals.SendAttempts = math.MaxUint64
	lossless.add(&lossless.totals.SendAttempts, 1)
	lossless.mu.Unlock()
	both := r.LiveWireObservation()
	require.True(t, both.LosslessStatus.Overflow)
	require.True(t, both.Lossless.Overflow)
	require.Equal(t, uint64(math.MaxUint64), both.Lossless.SendAttempts)
}

func TestLiveWireObservationPrivateLifetimesAndRealClockDomain(t *testing.T) {
	a, b := newLosslessTransportReactor(t, &WireObserver{}), newLosslessTransportReactor(t, &WireObserver{})
	require.NoError(t, a.Start())
	require.NoError(t, b.Start())
	var begin, end unix.Timespec
	require.NoError(t, unix.ClockGettime(unix.CLOCK_MONOTONIC, &begin))
	x := a.LiveWireObservation()
	y := b.LiveWireObservation()
	require.NoError(t, unix.ClockGettime(unix.CLOCK_MONOTONIC, &end))
	require.NotEqual(t, x.ReactorLifetimeID, y.ReactorLifetimeID)
	require.NotEqual(t, *x.ObserverLifetimeID, *y.ObserverLifetimeID)
	require.Equal(t, x.ProducerPID, y.ProducerPID)
	require.Equal(t, "CLOCK_MONOTONIC", x.Clock)
	require.Equal(t, "OBSERVED", x.ClockStatus)
	require.Empty(t, x.ClockError)
	require.LessOrEqual(t, uint64(begin.Sec)*1e9+uint64(begin.Nsec), *x.StartMonotonicNs)
	require.LessOrEqual(t, *x.StartMonotonicNs, *x.EndMonotonicNs)
	require.LessOrEqual(t, *x.EndMonotonicNs, *y.StartMonotonicNs)
	require.LessOrEqual(t, *y.EndMonotonicNs, uint64(end.Sec)*1e9+uint64(end.Nsec))
	ids := a.LiveWireObservation()
	require.Equal(t, x.ReactorLifetimeID, ids.ReactorLifetimeID)
	require.Equal(t, *x.ObserverLifetimeID, *ids.ObserverLifetimeID)
}

func TestLiveWireObservationStopInvalidatesRawAndConcurrentCapture(t *testing.T) {
	observer := &WireObserver{}
	r := newLosslessTransportReactor(t, observer)
	require.NoError(t, r.EnableExperimentalLosslessHex(LosslessHexLimits{}))
	require.NoError(t, r.Start())
	peer := wireTestSourcePeer(r)
	r.Receive(p2p.Envelope{ChannelID: MempoolChannel, Src: peer, Message: &protomem.Txs{Txs: [][]byte{[]byte("bounded-counter-data")}}})
	between := r.LiveWireObservation()
	require.Equal(t, "OBSERVED", between.Status)
	// This deterministic endpoint models stop after raw reads and before the
	// final lifecycle read. The actual method uses this same final callee.
	require.NoError(t, r.Stop())
	r.finishLiveWireObservation(&between, observer, r.losslessHex.Load())
	require.Equal(t, "UNKNOWN", between.Status)
	require.Equal(t, "reactor_stopped_during_capture", between.Reason)
	require.False(t, between.Complete)
	require.NotNil(t, between.Wire)
	require.Equal(t, uint64(1), between.Wire.CheckTxCalls)
	require.Equal(t, "UNKNOWN", between.WireStatus.Status)
	require.False(t, between.LosslessStatus.Complete)
	stopped := r.LiveWireObservation()
	require.Equal(t, "UNKNOWN", stopped.Status)
	require.Equal(t, uint64(2), stopped.LifecycleGeneration)
	require.False(t, stopped.ReactorRunningAtStart)
	require.Equal(t, uint64(1), stopped.Wire.CheckTxCalls)
	// The bounded concurrent functional case covers the real public getter
	// racing actual Stop. It neither starts load nor loops a measurement window.
	concurrent := newLosslessTransportReactor(t, &WireObserver{})
	require.NoError(t, concurrent.Start())
	var workers sync.WaitGroup
	start := make(chan struct{})
	results := make(chan LiveWireObservation, 128)
	for i := 0; i < 4; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			for j := 0; j < 32; j++ {
				results <- concurrent.LiveWireObservation()
			}
		}()
	}
	close(start)
	require.NoError(t, concurrent.Stop())
	workers.Wait()
	close(results)
	for got := range results {
		if got.Status == "OBSERVED" {
			require.True(t, got.ReactorRunningAtStart)
			require.True(t, got.ReactorRunningAtEnd)
			require.Equal(t, uint64(1), got.LifecycleGeneration)
		} else {
			require.False(t, got.Complete)
		}
	}
	for i := 0; i < 8; i++ {
		got := concurrent.LiveWireObservation()
		require.Equal(t, "UNKNOWN", got.Status)
		require.False(t, got.Complete)
	}
	// No counter reset, channel mutation, observer replacement, or automatic
	// enablement is available through this read-only API.
	require.True(t, reflect.DeepEqual(observer.Snapshot(), *stopped.Wire))
}
