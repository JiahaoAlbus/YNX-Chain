//go:build transportlab_actual

package transportlab

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
)

// actualApplicationSnapshot contains only observations from the real public
// application endpoints. RawState retains the entire /state response, with no
// field filtering, normalization, hash reconstruction, or replacement state.
// Application-local verification caches are absent from that public endpoint;
// equality here makes no claim about unexposed process-local implementation.
type actualApplicationSnapshot struct {
	Info     *abci.ResponseInfo
	State    consensus.CommittedState
	RawState []byte
}

// captureActualApplication must be called while the test owns the application's
// execution sequence: Info and Query take separate read locks, not one combined
// checkpoint lock. An intervening Commit is a failed consistency check rather
// than a retry that could hide the first observation.
func captureActualApplication(t *testing.T, app *consensus.Application) actualApplicationSnapshot {
	t.Helper()
	if app == nil {
		t.Fatal("cannot capture a nil real Application")
	}
	info, err := app.Info(t.Context(), &abci.RequestInfo{})
	if err != nil {
		t.Fatalf("real Application.Info failed: %v", err)
	}
	if info == nil {
		t.Fatal("real Application.Info returned a nil response")
	}
	// Own both the response struct and its mutable byte field. No caller can
	// change a saved baseline by retaining the original response allocation.
	ownedInfo := *info
	ownedInfo.LastBlockAppHash = bytes.Clone(info.LastBlockAppHash)
	response, err := app.Query(t.Context(), &abci.RequestQuery{Path: "/state"})
	if err != nil {
		t.Fatalf("real Application.Query(/state) failed: %v", err)
	}
	if response == nil {
		t.Fatal("real Application.Query(/state) returned a nil response")
	}
	if response.Code != abci.CodeTypeOK {
		t.Fatalf("real Application.Query(/state) rejected: code=%d", response.Code)
	}
	snapshot := actualApplicationSnapshot{Info: &ownedInfo, RawState: bytes.Clone(response.Value)}
	// JSON decoding creates an independently owned tree, including nested
	// account lots, policy records, histories, receipts, and fee journals.
	if err := json.Unmarshal(snapshot.RawState, &snapshot.State); err != nil {
		t.Fatalf("decode complete real Application /state response: %v", err)
	}
	if response.Height != snapshot.State.Height {
		t.Fatalf("real /state query height differs from its state: query=%d state=%d", response.Height, snapshot.State.Height)
	}
	requireActualSnapshotConsistent(t, snapshot)
	return snapshot
}

// This validates the observation boundary only. It does not call a verifier,
// reproduce application hashing/execution, or promote /state into a proof.
func requireActualSnapshotConsistent(t *testing.T, snapshot actualApplicationSnapshot) {
	t.Helper()
	if snapshot.Info == nil || len(snapshot.RawState) == 0 {
		t.Fatal("real Application snapshot lacks Info or complete raw /state bytes")
	}
	var decoded consensus.CommittedState
	if err := json.Unmarshal(snapshot.RawState, &decoded); err != nil {
		t.Fatalf("saved real /state response is not complete JSON: %v", err)
	}
	if !reflect.DeepEqual(decoded, snapshot.State) {
		t.Fatal("saved typed Application state differs from its complete owned /state bytes")
	}
	if snapshot.Info.Data != consensus.ApplicationName || snapshot.Info.Version == "" || snapshot.Info.AppVersion == 0 {
		t.Fatal("snapshot did not retain the actual Application Info identity/version")
	}
	if snapshot.State.Version <= 0 || snapshot.State.ChainID <= 0 || snapshot.State.Height < 0 {
		t.Fatal("real Application /state returned invalid version, chain, or height coordinates")
	}
	appHash, err := hex.DecodeString(snapshot.State.AppHash)
	if err != nil || len(appHash) != 32 || hex.EncodeToString(appHash) != snapshot.State.AppHash {
		t.Fatal("real Application /state app hash is not the canonical 32-byte digest")
	}
	if snapshot.State.Initialized {
		if snapshot.Info.LastBlockHeight != snapshot.State.Height || !bytes.Equal(snapshot.Info.LastBlockAppHash, appHash) {
			t.Fatalf("real initialized Info and /state coordinates differ: infoHeight=%d stateHeight=%d", snapshot.Info.LastBlockHeight, snapshot.State.Height)
		}
		return
	}
	// NewPersistentApplication initially exposes its original migration through
	// /state but intentionally reports no committed ABCI block through Info.
	// InitChain does not flip Initialized; only a successful Commit does so.
	// Preserve this distinction instead of manufacturing a bootstrap Commit.
	if snapshot.Info.LastBlockHeight != 0 || len(snapshot.Info.LastBlockAppHash) != 0 {
		t.Fatal("uninitialized real Application advertised committed Info coordinates")
	}
	if snapshot.State.AppHash != snapshot.State.MigrationStateHash {
		t.Fatal("uninitialized real Application state lost its original migration hash")
	}
}

// requireActualApplicationUnchanged detects public committed changes after
// CheckTx, PrepareProposal, ProcessProposal, or FinalizeBlock. Finalize only
// creates pending state in the real application; this assertion remains valid
// until Commit. It checks height/history/fees as well as AppHash: empty blocks
// can change persisted height while leaving the application hash unchanged.
func requireActualApplicationUnchanged(t *testing.T, before actualApplicationSnapshot, app *consensus.Application) {
	t.Helper()
	requireActualSnapshotConsistent(t, before)
	after := captureActualApplication(t, app)
	requireActualApplicationsEqual(t, before, after)
}

// requireActualApplicationsEqual compares entire actual public checkpoints for
// the two transport arms, or a live arm against its normally reopened cold app.
// It neither opens storage nor infers persistence/finality from an equal hash.
func requireActualApplicationsEqual(t *testing.T, left, right actualApplicationSnapshot) {
	t.Helper()
	requireActualSnapshotConsistent(t, left)
	requireActualSnapshotConsistent(t, right)
	if !reflect.DeepEqual(left.Info, right.Info) {
		t.Fatalf("actual Application Info responses differ: leftHeight=%d rightHeight=%d leftVersion=%d rightVersion=%d", left.Info.LastBlockHeight, right.Info.LastBlockHeight, left.Info.AppVersion, right.Info.AppVersion)
	}
	if !bytes.Equal(left.RawState, right.RawState) {
		at := 0
		for at < len(left.RawState) && at < len(right.RawState) && left.RawState[at] == right.RawState[at] {
			at++
		}
		// Report coordinates and the first differing offset, never dump full
		// account/history payloads into logs to explain an equality failure.
		t.Fatalf("complete real Application /state bytes differ at offset %d: leftBytes=%d rightBytes=%d leftHeight=%d rightHeight=%d", at, len(left.RawState), len(right.RawState), left.State.Height, right.State.Height)
	}
	if !reflect.DeepEqual(left.State, right.State) {
		t.Fatal("complete actual public CommittedState values differ")
	}
}

// actualAccount performs an exact unique-address lookup in an actual captured
// public state. It does not synthesize a missing account, normalize identities,
// or derive balances from callbacks, model outputs, or a parallel ledger.
func actualAccount(t *testing.T, snapshot actualApplicationSnapshot, address string) chain.ConsensusAccount {
	t.Helper()
	requireActualSnapshotConsistent(t, snapshot)
	if address == "" {
		t.Fatal("actual account lookup requires an exact nonempty address")
	}
	var result chain.ConsensusAccount
	found := false
	for _, account := range snapshot.State.Accounts {
		if account.Address != address {
			continue
		}
		if found {
			t.Fatal("real Application snapshot contains duplicate exact account identities")
		}
		result, found = account, true
	}
	if !found {
		t.Fatal("required exact account is absent from the real Application snapshot")
	}
	// ConsensusAccount's only reference-valued field is Lots; ResourceUsage and
	// balances/nonces are values. Return an owned map so an assertion cannot
	// mutate a saved pre-state through an account value returned by this helper.
	if result.Lots != nil {
		owned := make(map[string]int64, len(result.Lots))
		for lot, amount := range result.Lots {
			owned[lot] = amount
		}
		result.Lots = owned
	}
	return result
}
