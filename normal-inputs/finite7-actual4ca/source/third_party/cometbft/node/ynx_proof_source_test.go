package node

import (
	"bytes"
	"errors"
	"reflect"
	"testing"

	sm "github.com/cometbft/cometbft/state"
	"github.com/cometbft/cometbft/types"
)

// This uses the same constructor and original LevelDBs as the owned-database
// regressions. It never calls Node.Start or starts a listener. The writes below
// are deliberately inconsistent synthetic store observations, not commits,
// signatures, trusted checkpoints, or permission to run a network window.
func TestProofSourceConsumerActualNodeCheckpointClassification(t *testing.T) {
	c := nodeOwnedDatabaseConfig(t)
	n, dbs, err := nodeOwnedDatabaseConstruct(t, c, "")
	if err != nil {
		t.Fatal(err)
	}
	stopped := false
	t.Cleanup(func() {
		if !stopped {
			n.OnStop()
			requireNodeDatabasesClosedOnce(t, dbs)
		}
	})
	if n.IsRunning() || n.isListening || len(n.rpcListeners) != 0 {
		t.Fatal("proof-source fixture unexpectedly started the Node or a listener")
	}
	view, err := n.ProofSourceView()
	if err != nil {
		t.Fatal(err)
	}
	original, err := n.stateStore.Load()
	if err != nil {
		t.Fatal(err)
	}
	if !original.Equals(n.consensusState.GetState()) {
		t.Fatal("constructor did not supply the same original store/consensus checkpoint")
	}
	got, err := view.LoadState()
	if err != nil || !got.Equals(original) {
		t.Fatal("actual original checkpoint was not readable", err)
	}

	for _, tc := range []struct {
		name      string
		mutate    func(*sm.State)
		transient bool
	}{
		{
			name: "adjacent-height",
			mutate: func(s *sm.State) {
				s.LastBlockHeight++
				// Normal State serialization at H>=1 requires LastValidators.
				s.LastValidators = original.Validators.Copy()
			},
			transient: true,
		},
		{
			name: "same-height-app-hash-conflict",
			mutate: func(s *sm.State) {
				s.AppHash = bytes.Repeat([]byte{0x71}, 32)
				if bytes.Equal(s.AppHash, original.AppHash) {
					s.AppHash[0] ^= 1
				}
			},
		},
		{
			name: "same-height-block-id-conflict",
			mutate: func(s *sm.State) {
				s.LastBlockID = types.BlockID{
					Hash: bytes.Repeat([]byte{0x72}, 32),
					PartSetHeader: types.PartSetHeader{
						Total: 1,
						Hash:  bytes.Repeat([]byte{0x73}, 32),
					},
				}
				if s.LastBlockID.Equals(original.LastBlockID) {
					s.LastBlockID.Hash[0] ^= 1
				}
			},
		},
		{
			name: "different-chain",
			mutate: func(s *sm.State) {
				s.ChainID += "-another"
			},
		},
		{
			name: "different-chain-at-adjacent-height",
			mutate: func(s *sm.State) {
				s.ChainID += "-another"
				s.LastBlockHeight++
				s.LastValidators = original.Validators.Copy()
			},
		},
		{
			name: "height-gap-greater-than-one",
			mutate: func(s *sm.State) {
				s.LastBlockHeight += 2
				s.LastValidators = original.Validators.Copy()
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			changed := original.Copy()
			tc.mutate(&changed)
			t.Cleanup(func() {
				if err := n.stateStore.Save(original); err != nil {
					t.Error("restore original checkpoint", err)
					return
				}
				restored, err := view.LoadState()
				if err != nil || !restored.Equals(original) {
					t.Error("actual API did not read the restored original checkpoint", err)
				}
			})
			if err := n.stateStore.Save(changed); err != nil {
				t.Fatal("save synthetic checkpoint observation", err)
			}
			actual, err := view.LoadState()
			if err == nil || !reflect.DeepEqual(actual, sm.State{}) {
				t.Fatal("mismatched node checkpoint released a successful state", err)
			}
			if errors.Is(err, ErrProofSourceCheckpointCrossing) != tc.transient {
				t.Fatalf("checkpoint transient classification = %t, want %t: %v", errors.Is(err, ErrProofSourceCheckpointCrossing), tc.transient, err)
			}
		})
	}

	restored, err := view.LoadState()
	if err != nil || !restored.Equals(original) {
		t.Fatal("original checkpoint changed after the counterexamples", err)
	}
	n.OnStop()
	stopped = true
	requireNodeDatabasesClosedOnce(t, dbs)
}
