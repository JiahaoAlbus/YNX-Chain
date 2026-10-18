//go:build unix

package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	dbm "github.com/cometbft/cometbft-db"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

func proofTargetFixtureInput(t *testing.T, f *proofHostSourceFixture, e PQTransactionProofExpectation, account string) (OperatorCheckpointOptions, ProofHostTargetInput) {
	t.Helper()
	height, err := strconv.ParseInt(f.plan.EngineHeight, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := hex.DecodeString(f.plan.EngineAppHash)
	if err != nil {
		t.Fatal(err)
	}
	trusted := f.f.light.trust
	options := OperatorCheckpointOptions{StatePath: f.plan.StateFile, StateLayout: f.plan.StateLayout, CometDataDirectory: f.plan.CometDataDirectory, SigningStatePath: f.plan.SigningStatePath, SigningLockKind: "pq-signer", Authorization: f.f.light.authorization}
	input := ProofHostTargetInput{Account: account, TransactionType: e.TransactionType, Envelope: bytes.Clone(e.Envelope), NativeWire: bytes.Clone(e.NativeWire), TransactionHash: bytes.Clone(e.TransactionHash), NativeWireHash: bytes.Clone(e.NativeWireHash), Height: e.Block.HeaderHeight, Index: e.Index, EngineHeight: height, EngineAppHash: hash, TrustedHeight: trusted.TrustedLightBlock.Height, TrustedBlockHash: bytes.Clone(trusted.TrustedLightBlock.Hash()), TrustingPeriod: time.Hour, MaxClockDrift: time.Second, TrustLevel: cmtmath.Fraction{Numerator: 1, Denominator: 3}}
	return options, input
}

// Extend the existing genuine engine fixture with a legitimate recipient's
// migration and typed action. This uses the recipient's original classic key,
// real dual PoP and current dual signature, never a fake execution callback.
func proofTargetTypedAction(t *testing.T, f *pqTransactionProofFixture) (PQTransactionProofExpectation, string) {
	t.Helper()
	h := f.light.harness
	a := &abciRevocationFixture{classic: deterministicPrivateKey(212), m: h.f.migration}
	t.Cleanup(a.classic.Zero)
	a.owner = mustNativeAddress(t, a.classic)
	var err error
	a.network, err = hex.DecodeString(a.m.OriginalGenesisHash)
	if err != nil {
		t.Fatal(err)
	}
	a.key, a.public, err = ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.key.Destroy)
	registrationH := h.app.committed.Height + 1
	h.apply(t, cmttypes.Txs{mustPQEnvelope(t, PQMigrationType, a.registration(t, false, uint64(registrationH+1)))})
	r, err := h.raw.LoadFinalizeBlockResponse(registrationH)
	if err != nil || len(r.TxResults) != 1 || r.TxResults[0].Code != 0 {
		t.Fatal("real recipient registration failed", err, r)
	}
	raw := pqABCIStake(t, a, false, 1, 2, 0)
	height := h.app.committed.Height + 1
	h.apply(t, cmttypes.Txs{raw})
	h.apply(t, nil)
	r, err = h.raw.LoadFinalizeBlockResponse(height)
	if err != nil || len(r.TxResults) != 1 || r.TxResults[0].Code != 0 {
		t.Fatal("real typed action failed", err, r)
	}
	wire, _, err := DecodePQNativeActionTransaction(raw)
	if err != nil {
		t.Fatal(err)
	}
	header := func(b *cmttypes.LightBlock) PQLightProofExpectation {
		return PQLightProofExpectation{ChainID: b.ChainID, HeaderHeight: b.Height, BlockHash: bytes.Clone(b.Hash()), StateHeight: b.Height - 1, StateAppHash: bytes.Clone(b.AppHash)}
	}
	abci, native := sha256.Sum256(raw), sha256.Sum256(wire)
	return PQTransactionProofExpectation{Block: header(f.light.block(t, height)), Successor: header(f.light.block(t, height+1)), TransactionType: PQActionType, Envelope: raw, NativeWire: wire, TransactionHash: abci[:], NativeWireHash: native[:], Index: 0}, a.owner
}

func TestProofHostTargetStoppedOriginalTypedActionAndLayouts(t *testing.T) {
	// One four-validator signing fixture supplies every layout and negative.
	signed := newPQTransactionProofFixture(t)
	typed, owner := proofTargetTypedAction(t, signed)
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			f := newProofHostSourceFixtureFromTransaction(t, signed, layout, "")
			options, input := proofTargetFixtureInput(t, f, typed, owner)
			inspect := func(o OperatorCheckpointOptions, x ProofHostTargetInput) (ProofHostTargetResult, error) {
				return InspectStoppedProofHostTarget(f.f.light.harness.f.migration, f.f.light.harness.f.raw, f.f.light.harness.f.pins, o, x, time.Now().UTC())
			}
			before := proofSourceTree(t, f.root)
			out, err := inspect(options, input)
			if err != nil {
				t.Fatal("normal stopped typed target", err)
			}
			if out.Version != "YNX-PROOF-HOST-TARGET/v1" || out.Classification != "data" || out.NativeRootAuthorized || out.DeploymentVerified || !out.SourceReadOnly || !out.WriterExcluded || !out.SigningWriterExcluded || !out.LedgerProofVerified || !out.Verification.ExecutionSuccessful || out.Verification.NativeGrant || !reflect.DeepEqual(out.ExpectedTransaction, proofSourceExpected(typed)) {
				t.Fatal("target changed independent original/proof DATA boundary", out)
			}
			if !reflect.DeepEqual(before, proofSourceTree(t, f.root)) {
				t.Fatal("target generation changed original stores or signing identity")
			}
			if layout != "atomic-json" {
				return
			}
			for index, want := range []string{"succeeded", "rejected", "partial"} {
				o, x := proofTargetFixtureInput(t, f, signed.expected[index], f.plan.Account)
				r, err := inspect(o, x)
				if err != nil || r.Verification.Outcome != want || !r.Verification.Finalized || r.Verification.ExecutionSuccessful != (index == 0) {
					t.Fatal("actual terminal result misclassified", index, r, err)
				}
			}
			for name, change := range map[string]func(*ProofHostTargetInput){
				"account":          func(x *ProofHostTargetInput) { x.Account = "0x" + strings.Repeat("f", 40) },
				"native-hash":      func(x *ProofHostTargetInput) { x.NativeWireHash = bytes.Repeat([]byte{31}, 32) },
				"outer-hash":       func(x *ProofHostTargetInput) { x.TransactionHash = bytes.Repeat([]byte{32}, 32) },
				"outer-bytes":      func(x *ProofHostTargetInput) { x.Envelope = append(bytes.Clone(x.Envelope), ' ') },
				"type":             func(x *ProofHostTargetInput) { x.TransactionType = PQTransferType },
				"checkpoint":       func(x *ProofHostTargetInput) { x.EngineAppHash = bytes.Repeat([]byte{33}, 32) },
				"trusted":          func(x *ProofHostTargetInput) { x.TrustedBlockHash = bytes.Repeat([]byte{34}, 32) },
				"lookup-index":     func(x *ProofHostTargetInput) { x.Index = 1 },
				"lookup-height":    func(x *ProofHostTargetInput) { x.Height-- },
				"missing-period":   func(x *ProofHostTargetInput) { x.TrustingPeriod = 0 },
				"missing-fraction": func(x *ProofHostTargetInput) { x.TrustLevel = cmtmath.Fraction{} },
			} {
				t.Run(name, func(t *testing.T) {
					x := input
					change(&x)
					r, err := inspect(options, x)
					if err == nil || !reflect.DeepEqual(r, ProofHostTargetResult{}) {
						t.Fatal("invalid original accepted or partial success returned", r, err)
					}
				})
			}
			for _, kind := range []string{"app", "signer", "database"} {
				t.Run("active-"+kind, func(t *testing.T) {
					var close func() error
					if kind == "database" {
						db, err := dbm.NewGoLevelDB("state", options.CometDataDirectory)
						if err != nil {
							t.Fatal(err)
						}
						close = db.Close
					} else {
						path := options.StatePath + ".writer.lock"
						if kind == "signer" {
							path = options.SigningStatePath + ".lock"
						}
						var err error
						close, err = existingInspectionLockFile(path)
						if err != nil {
							t.Fatal(err)
						}
					}
					r, err := inspect(options, input)
					closeErr := close()
					if err == nil || closeErr != nil || !reflect.DeepEqual(r, ProofHostTargetResult{}) {
						t.Fatal("active writer bypassed", err, closeErr)
					}
				})
			}
			// A real writer may update LevelDB LOG. Freeze the post-close originals
			// before testing uncertainty, rather than attributing that to the reader.
			unknown := filepath.Join(filepath.Dir(options.StatePath), "retained.UNKNOWN")
			proofSourceWrite(t, unknown, []byte("retained uncertain effect"))
			before = proofSourceTree(t, f.root)
			if _, err := inspect(options, input); err == nil {
				t.Fatal("UNKNOWN source accepted")
			}
			if !reflect.DeepEqual(before, proofSourceTree(t, f.root)) {
				t.Fatal("uncertain original files changed")
			}
		})
	}
	for _, corruption := range []string{"pruned", "execution-result"} {
		t.Run(corruption, func(t *testing.T) {
			f := newProofHostSourceFixtureFromTransaction(t, signed, "atomic-json", "")
			options, input := proofTargetFixtureInput(t, f, typed, owner)
			if corruption == "pruned" {
				db, err := dbm.NewGoLevelDB("blockstore", options.CometDataDirectory)
				if err != nil {
					t.Fatal(err)
				}
				actual, err := signed.light.harness.raw.Load()
				if err != nil {
					t.Fatal(err)
				}
				_, _, err = blockstore.NewBlockStore(db).PruneBlocks(input.Height+1, actual)
				if err != nil {
					t.Fatal(err)
				}
				if err = db.Close(); err != nil {
					t.Fatal(err)
				}
			} else {
				db, err := dbm.NewGoLevelDB("state", options.CometDataDirectory)
				if err != nil {
					t.Fatal(err)
				}
				store := sm.NewStore(db, sm.StoreOptions{})
				result, err := store.LoadFinalizeBlockResponse(input.Height)
				if err != nil {
					t.Fatal(err)
				}
				result.TxResults[0].GasUsed++
				if err = store.SaveFinalizeBlockResponse(input.Height, result); err != nil {
					t.Fatal(err)
				}
				if err = db.Close(); err != nil {
					t.Fatal(err)
				}
			}
			before := proofSourceTree(t, f.root)
			r, err := InspectStoppedProofHostTarget(signed.light.harness.f.migration, signed.light.harness.f.raw, signed.light.harness.f.pins, options, input, time.Now().UTC())
			if err == nil || !reflect.DeepEqual(r, ProofHostTargetResult{}) {
				t.Fatal("missing/tampered original history accepted", err)
			}
			if !reflect.DeepEqual(before, proofSourceTree(t, f.root)) {
				t.Fatal("failed reader repaired missing/tampered originals")
			}
		})
	}
}

func TestProofHostTargetDoesNotPermitPartialSourcePlans(t *testing.T) {
	// New function inputs do not alter the complete source-plan authority ABI.
	raw := []byte(`{"version":"YNX-PROOF-HOST-SOURCE-PLAN/v1","engineHeight":"10"}`)
	if _, err := DecodeProofHostSourcePlan(raw, proofHostSHA(raw)); err == nil {
		t.Fatal("partial source plan acquired authority")
	}
}

func TestProofHostTargetRetainsBoundedIndependentInputBytes(t *testing.T) {
	input := ProofHostTargetInput{Envelope: []byte("retained envelope"), NativeWire: []byte("retained native wire"), TransactionHash: bytes.Repeat([]byte{1}, 32), NativeWireHash: bytes.Repeat([]byte{2}, 32), EngineAppHash: bytes.Repeat([]byte{3}, 32), TrustedBlockHash: bytes.Repeat([]byte{4}, 32)}
	held, err := holdProofHostTargetInput(input)
	if err != nil {
		t.Fatal(err)
	}
	before := proofSourceJSON(t, held)
	for _, raw := range [][]byte{input.Envelope, input.NativeWire, input.TransactionHash, input.NativeWireHash, input.EngineAppHash, input.TrustedBlockHash} {
		raw[0] ^= 0xff
	}
	if !bytes.Equal(before, proofSourceJSON(t, held)) {
		t.Fatal("caller mutation retargeted retained original/checkpoint bytes")
	}
	for _, change := range []func(*ProofHostTargetInput){
		func(x *ProofHostTargetInput) { x.Envelope = nil },
		func(x *ProofHostTargetInput) { x.NativeWire = nil },
		func(x *ProofHostTargetInput) { x.EngineAppHash = x.EngineAppHash[:31] },
		func(x *ProofHostTargetInput) { x.TrustedBlockHash = append(x.TrustedBlockHash, 1) },
	} {
		bad := input
		change(&bad)
		if _, err := holdProofHostTargetInput(bad); err == nil {
			t.Fatal("invalid input bounds accepted before retaining originals")
		}
	}
}
