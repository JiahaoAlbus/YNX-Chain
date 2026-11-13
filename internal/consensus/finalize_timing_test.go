package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

func TestFinalizeTimingDefaultAndCanonicalEquivalence(t *testing.T) {
	migration, _ := journalFixture(t)
	badPQ, err := EncodePQTransaction(PQTransferType, []byte{0xab})
	if err != nil {
		t.Fatal(err)
	}
	native := journalTransfer(t, 1)
	for _, layout := range []struct {
		name string
		open func(chain.ConsensusMigrationState, string) (*Application, error)
	}{{"atomic", NewPersistentApplication}, {"snapshot", NewJournaledApplication}, {"block", NewBlockJournaledApplication}} {
		t.Run(layout.name, func(t *testing.T) {
			apps := make([]*Application, 2)
			paths := []string{filepath.Join(t.TempDir(), "state"), filepath.Join(t.TempDir(), "state")}
			for i := range apps {
				apps[i], err = layout.open(migration, paths[i])
				if err != nil {
					t.Fatal(err)
				}
			}
			if _, ok := apps[0].FinalizeTimingSnapshot(); ok || apps[0].finalizeTimingActive != nil {
				t.Fatal("default capture enabled")
			}
			apps[1].SetFinalizeTimingEnabled(true)
			for block, txs := range [][][]byte{nil, {native}, {badPQ, []byte("PUBLIC-invalid")}} {
				h := int64(migration.Height) + 1 + int64(block)
				req := &abci.RequestFinalizeBlock{Height: h, Time: time.Unix(1802736000+h, 0), Txs: txs}
				responses := make([][]byte, 2)
				for i, a := range apps {
					r, e := a.FinalizeBlock(context.Background(), req)
					if e != nil {
						t.Fatal(e)
					}
					responses[i], e = r.Marshal()
					if e != nil {
						t.Fatal(e)
					}
					if _, e = a.Commit(context.Background(), &abci.RequestCommit{}); e != nil {
						t.Fatal(e)
					}
				}
				if !bytes.Equal(responses[0], responses[1]) {
					t.Fatal("observation changed actual response/AppHash")
				}
				x, _ := json.Marshal(apps[0].committed)
				y, _ := json.Marshal(apps[1].committed)
				if !bytes.Equal(x, y) {
					t.Fatal("observation changed state/fees/Lots bytes")
				}
				x, e1 := os.ReadFile(paths[0])
				y, e2 := os.ReadFile(paths[1])
				if e1 != nil || e2 != nil || !bytes.Equal(x, y) {
					t.Fatal("observation changed actual storage bytes", e1, e2)
				}
			}
			snap, ok := apps[1].FinalizeTimingSnapshot()
			if !ok || snap.Attempts != 3 || snap.Dropped != 0 || len(snap.Samples) != 3 {
				t.Fatal("actual capture incomplete")
			}
			for i, s := range snap.Samples {
				if !s.Success || s.FailedPhase != "" || s.AppHash == "" || s.ElapsedNs <= 0 {
					t.Fatal("success sample malformed")
				}
				var sum int64
				for _, phase := range []string{"preflight", "prepare", "apply_transactions", "seal", "continuation", "response"} {
					ns, ok := s.PhaseNs[phase]
					if !ok || ns < 0 {
						t.Fatal("phase absent")
					}
					sum += ns
				}
				if sum != s.ElapsedNs {
					t.Fatal("phases do not partition total")
				}
				for _, child := range []string{"seal.accounts_materialize", "seal.fee_materialize", "seal.validate"} {
					if _, ok := s.ChildrenNs[child]; !ok {
						t.Fatal("materialization/validation missing")
					}
				}
				_, cloned := s.ChildrenNs["transaction.accounts_materialize"]
				if cloned != (i == 2) {
					t.Fatal("native/empty/PQ clone attribution differs")
				}
			}
			if snap.Samples[2].Counts["rejected_transactions"] != 2 {
				t.Fatal("invalid transactions hidden by successful Finalize")
			}
			before, _ := json.Marshal(snap)
			apps[1].CheckTx(context.Background(), &abci.RequestCheckTx{Tx: badPQ})
			apps[1].PrepareProposal(context.Background(), &abci.RequestPrepareProposal{Height: apps[1].committed.Height + 1, Txs: [][]byte{badPQ}, MaxTxBytes: 1 << 20})
			apps[1].ProcessProposal(context.Background(), &abci.RequestProcessProposal{Height: apps[1].committed.Height + 1, Txs: [][]byte{badPQ}})
			after, _ := apps[1].FinalizeTimingSnapshot()
			raw, _ := json.Marshal(after)
			if !bytes.Equal(before, raw) || apps[1].finalizeTimingActive != nil {
				t.Fatal("proposal/check leaked into Finalize")
			}
			snap.Latest.PhaseNs["preflight"] = -1
			snap.Samples[0].Counts["seal.accounts_materialize"] = 999
			owned, _ := apps[1].FinalizeTimingSnapshot()
			if owned.Latest.PhaseNs["preflight"] < 0 || owned.Samples[0].Counts["seal.accounts_materialize"] == 999 {
				t.Fatal("retained capture aliased")
			}
			cold, e := layout.open(migration, paths[1])
			if e != nil || !journalStateEqual(t, cold.committed, apps[1].committed) {
				t.Fatal("normal cold loader changed", e)
			}
			if _, ok := cold.FinalizeTimingSnapshot(); ok {
				t.Fatal("timing serialized into restart")
			}
			apps[1].SetFinalizeTimingEnabled(false)
			if _, ok := apps[1].FinalizeTimingSnapshot(); ok {
				t.Fatal("disable retained capture")
			}
		})
	}
}
func TestFinalizeTimingFailuresAndBoundedKnownClock(t *testing.T) {
	migration, _ := journalFixture(t)
	a, err := NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	a.SetFinalizeTimingEnabled(true)
	tick := int64(0)
	a.finalizeTiming.now = func() time.Time { tick++; return time.Unix(0, tick*100) }
	h := int64(migration.Height) + 1
	if _, err = a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h}); err != nil {
		t.Fatal(err)
	}
	first, _ := a.FinalizeTimingSnapshot()
	if first.Latest.ElapsedNs <= 0 {
		t.Fatal("known clock not observed")
	}
	if _, err = a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h + 1}); err == nil {
		t.Fatal("pending guard lost")
	}
	s, _ := a.FinalizeTimingSnapshot()
	if s.Latest.Success || s.Latest.FailedPhase != "preflight" || s.Latest.AppHash != "" || len(s.Latest.PhaseNs) != 1 || len(s.Latest.ChildrenNs) != 0 {
		t.Fatal("early failure reused success")
	}
	if _, err = a.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	// A real sealing validation refusal, with no fake time/error success.
	a.committed.Accounts[0].Balance++
	if _, err = a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h + 1}); err == nil {
		t.Fatal("invalid supply accepted")
	}
	s, _ = a.FinalizeTimingSnapshot()
	if s.Latest.Success || s.Latest.FailedPhase != "seal.validate" || s.Latest.AppHash != "" || a.pending != nil {
		t.Fatal("seal failure lost exact phase or changed pending")
	}
	if _, ok := s.Latest.PhaseNs["continuation"]; ok {
		t.Fatal("unexecuted stage invented")
	}
	for i := 0; i < FinalizeTimingMaxSamples; i++ {
		if _, err = a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: -1}); err == nil {
			t.Fatal("height guard lost")
		}
	}
	s, _ = a.FinalizeTimingSnapshot()
	if len(s.Samples) != FinalizeTimingMaxSamples || s.Attempts != FinalizeTimingMaxSamples+3 || s.Dropped != 3 || s.Latest.Attempt != s.Attempts || s.Latest.Success {
		t.Fatal("capture/drop/latest bound")
	}
	a.SetFinalizeTimingEnabled(false)
	calls := tick
	a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: -1})
	if tick != calls || a.finalizeTimingActive != nil {
		t.Fatal("disabled observer clock or active scope")
	}
	var disabled *finalizeTimings
	disabled.childFinish("none", disabled.childStart(), errors.New("PUBLIC"))
	disabled.enter("none")
	disabled.transaction(false)
	disabled.succeeded("none")
}
func TestFinalizeTimingMaterializationOriginalOwnership(t *testing.T) {
	migration, _ := journalFixture(t)
	a, err := NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	state := a.committedExecutionStateView()
	state.feeEvents = feeEventJournal{base: []BFTFeeEvent{{GrossFeeYNXT: 1}, {GrossFeeYNXT: 2}}}.append(BFTFeeEvent{GrossFeeYNXT: 3})
	clock := int64(0)
	tm := &finalizeTimings{now: func() time.Time { clock++; return time.Unix(0, clock) }, sample: FinalizeTimingSample{ChildrenNs: map[string]int64{}, Counts: map[string]uint64{}}}
	accounts := tm.accounts(state, "seal.accounts_materialize")
	fees := tm.fees(state.feeEvents)
	if !reflect.DeepEqual(accounts, cloneExecutionAccounts(state)) || !reflect.DeepEqual(fees, state.feeEvents.events()) {
		t.Fatal("materialization changed order/bytes")
	}
	accounts[0].Balance++
	for k := range accounts[0].Lots {
		accounts[0].Lots[k]++
		break
	}
	fees[0].GrossFeeYNXT++
	if reflect.DeepEqual(accounts, cloneExecutionAccounts(state)) || state.feeEvents.base[0].GrossFeeYNXT != 1 {
		t.Fatal("owned clone escaped")
	}
	if clock != 4 || len(tm.sample.ChildrenNs) != 2 || tm.sample.Counts["seal.fee_materialize"] != 3 {
		t.Fatal("exact expression clock/count coverage")
	}
}
