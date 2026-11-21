package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

func pqEnrollmentProofFixture(t *testing.T) (PQLightProofTrust, PQLabEnrollmentPins, PQLabEnrollmentOriginal, PQLabEnrollmentOriginal, PQLabEnrollmentOriginal, *pqTransactionProofFixture) {
	t.Helper()
	f := newPQTransactionProofFixture(t)
	h := f.light.harness
	funding := PQLabEnrollmentOriginal{Expected: f.expected[0], Proof: f.proofs[0]}
	member, err := ynxbatch.DecodeMember(funding.Expected.NativeWire)
	if err != nil {
		t.Fatal(err)
	}
	transfer, err := ynxauth.DecodeTransfer(member.Message)
	if err != nil {
		t.Fatal(err)
	}
	classic := deterministicPrivateKey(212)
	t.Cleanup(classic.Zero)
	if mustNativeAddress(t, classic) != transfer.To {
		t.Fatal("funding target differs")
	}
	key, public, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(key.Destroy)
	height := h.app.committed.Height + 1
	intent := ynxauth.RegistrationIntent{ChainID: transfer.ChainID, Owner: transfer.To, PKA: public.PKA, PKB: public.PKB, NewRevision: 1, LedgerNonce: 1, ActivateAt: uint64(height + 1)}
	wire := abciRegistrationWire(t, classic, nil, key, intent)
	envelope := mustPQEnvelope(t, PQMigrationType, wire)
	h.apply(t, cmttypes.Txs{envelope})
	h.apply(t, nil)
	results, err := h.raw.LoadFinalizeBlockResponse(height)
	if err != nil || len(results.TxResults) != 1 || results.TxResults[0].Code != 0 {
		t.Fatal("migration execution", err, results)
	}
	actualBlock := h.blocks.LoadBlock(height)
	block, successor := f.light.block(t, height), f.light.block(t, height+1)
	expect := func(b *cmttypes.LightBlock) PQLightProofExpectation {
		return PQLightProofExpectation{ChainID: b.ChainID, HeaderHeight: b.Height, BlockHash: bytes.Clone(b.Hash()), StateHeight: b.Height - 1, StateAppHash: bytes.Clone(b.AppHash)}
	}
	nativeHash := sha256.Sum256(wire)
	txProof, err := cmtjson.Marshal(actualBlock.Data.Txs.Proof(0))
	if err != nil {
		t.Fatal(err)
	}
	execution, executionProof, err := EncodePQTransactionExecutionProof(results.TxResults, 0)
	if err != nil {
		t.Fatal(err)
	}
	migration := PQLabEnrollmentOriginal{
		Expected: PQTransactionProofExpectation{Block: expect(block), Successor: expect(successor), TransactionType: PQMigrationType, Envelope: bytes.Clone(envelope), NativeWire: bytes.Clone(wire), TransactionHash: cmttypes.Tx(envelope).Hash(), NativeWireHash: nativeHash[:], Index: 0},
		Proof:    PQTransactionProofRequest{Version: PQTransactionProofVersion, Block: f.light.encode(t, block), Successor: f.light.encode(t, successor), TransactionProof: txProof, ExecutionResult: execution, ExecutionProof: executionProof},
	}
	source, err := NewPQEngineFileSource(h.f.migration, h.path, h.f.bootstrap, f.light.authorization)
	if err != nil {
		t.Fatal(err)
	}
	engine, err := h.raw.Load()
	if err != nil {
		t.Fatal(err)
	}
	authority, err := source.ConsensusAuthorityForState(engine.ChainID, engine.LastBlockHeight, engine.AppHash)
	if err != nil {
		t.Fatal(err)
	}
	trust := f.light.trust
	trust.Snapshot = authority.(*PQEngineSnapshot)
	trust.Now = successor.Time.Add(time.Second)
	pins := PQLabEnrollmentPins{OriginalGenesis: bytes.Clone(transfer.ChainID), NativeChainID: transfer.NativeChainID, FundingSource: transfer.From, Owner: transfer.To, FundingAmount: transfer.Amount, PKA: bytes.Clone(public.PKA), PKB: bytes.Clone(public.PKB), ActivationHeight: intent.ActivateAt}
	if hex.EncodeToString(pins.OriginalGenesis) != h.f.migration.OriginalGenesisHash {
		t.Fatal("native genesis")
	}
	rejected := PQLabEnrollmentOriginal{Expected: f.expected[1], Proof: f.proofs[1]}
	f.light.trust = trust
	return trust, pins, funding, migration, rejected, f
}

func TestPQLabEnrollmentOriginalProofsSameChain(t *testing.T) {
	trust, pins, funding, migration, rejected, _ := pqEnrollmentProofFixture(t)
	result, err := VerifyPQLabEnrollmentOriginals(trust, pins, funding, migration)
	if err != nil {
		t.Fatal(err)
	}
	if result.Classification != "data" || result.CurrentEligibility != "UNKNOWN" || result.NativeGrant || !result.Funding.ExecutionSuccessful || !result.Migration.ExecutionSuccessful || result.Funding.Height >= result.Migration.Height {
		t.Fatal("invalid historical proof result", result)
	}
	if result.Funding.Successor.HeaderHeight >= result.Migration.Block.HeaderHeight {
		t.Fatal("test requires nonadjacent transition")
	}
	t.Run("nonadjacent transition invalid target", func(t *testing.T) {
		bad := migration
		bad.Proof.Block.CommitResult = []byte(`{}`)
		if err := verifyEnrollmentTransition(trust, funding, bad, result.Funding, result.Migration); err == nil {
			t.Fatal("invalid transition target accepted")
		}
	})
	t.Run("nonadjacent transition expired", func(t *testing.T) {
		expired := trust
		expired.Now = expired.Now.Add(2 * time.Hour)
		if err := verifyEnrollmentTransition(expired, funding, migration, result.Funding, result.Migration); err == nil {
			t.Fatal("expired transition accepted")
		}
	})
	cases := map[string]func(*PQLabEnrollmentPins, *PQLabEnrollmentOriginal, *PQLabEnrollmentOriginal){
		"wrong native genesis": func(p *PQLabEnrollmentPins, _, _ *PQLabEnrollmentOriginal) {
			p.OriginalGenesis = bytes.Repeat([]byte{1}, 32)
		},
		"wrong owner":   func(p *PQLabEnrollmentPins, _, _ *PQLabEnrollmentOriginal) { p.Owner = p.FundingSource },
		"wrong amount":  func(p *PQLabEnrollmentPins, _, _ *PQLabEnrollmentOriginal) { p.FundingAmount++ },
		"wrong network": func(p *PQLabEnrollmentPins, _, _ *PQLabEnrollmentOriginal) { p.NativeChainID++ },
		"wrong key": func(p *PQLabEnrollmentPins, _, _ *PQLabEnrollmentOriginal) {
			p.PKB = bytes.Repeat([]byte{2}, ynxbatch.PublicKeyBSize)
		},
		"wrong activation": func(p *PQLabEnrollmentPins, _, _ *PQLabEnrollmentOriginal) { p.ActivationHeight++ },
		"different original hash": func(_ *PQLabEnrollmentPins, f, _ *PQLabEnrollmentOriginal) {
			f.Expected.TransactionHash = bytes.Repeat([]byte{3}, 32)
		},
		"wrong result proof":   func(_ *PQLabEnrollmentPins, _, m *PQLabEnrollmentOriginal) { m.Proof.ExecutionResult = []byte{1, 2, 3} },
		"missing trusted root": func(_ *PQLabEnrollmentPins, _, m *PQLabEnrollmentOriginal) { m.Proof.Block.CommitResult = nil },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			p, a, b := pins, funding, migration
			mutate(&p, &a, &b)
			got, err := VerifyPQLabEnrollmentOriginals(trust, p, a, b)
			if err == nil || got.NativeGrant || got.CurrentEligibility != "UNKNOWN" {
				t.Fatal("accepted non-original or missing proof", got, err)
			}
		})
	}
	if _, err := VerifyPQLabEnrollmentOriginals(PQLightProofTrust{}, pins, funding, migration); err == nil {
		t.Fatal("missing independent trust accepted")
	}
	if got, err := VerifyPQLabEnrollmentOriginals(trust, pins, rejected, migration); err == nil || got.CurrentEligibility != "UNKNOWN" || got.NativeGrant {
		t.Fatal("finalized but rejected duplicate funding was accepted", got, err)
	}
	otherTrust, _, _, _, _, _ := pqEnrollmentProofFixture(t)
	if got, err := VerifyPQLabEnrollmentOriginals(otherTrust, pins, funding, migration); err == nil || got.CurrentEligibility != "UNKNOWN" || got.NativeGrant {
		t.Fatal("different genesis trust accepted", got, err)
	}
}

// Funding is the exact normal signed-classic transaction which the executor
// accepted; the test creates actual same-chain H/H+1 proofs for both originals.
func TestPQLabEnrollmentOriginalLegacyFundingProof(t *testing.T) {
	t.Run("adjacent blocks", func(t *testing.T) { testPQLabEnrollmentLegacyFunding(t, false) })
	t.Run("same block", func(t *testing.T) { testPQLabEnrollmentLegacyFunding(t, true) })
}

func testPQLabEnrollmentLegacyFunding(t *testing.T, sameBlock bool) {
	f := newPQTransactionProofFixture(t)
	h := f.light.harness
	classic, recipient := deterministicPrivateKey(212), deterministicPrivateKey(213)
	t.Cleanup(classic.Zero)
	t.Cleanup(recipient.Zero)
	owner := mustNativeAddress(t, recipient)
	tx, err := NewSignedTransfer(classic, h.f.migration.Network.ChainID, owner, 5, 1)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	fundHeight := h.app.committed.Height + 1
	if !sameBlock {
		h.apply(t, cmttypes.Txs{wire})
	}
	key, public, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(key.Destroy)
	network, err := hex.DecodeString(h.f.migration.OriginalGenesisHash)
	if err != nil {
		t.Fatal(err)
	}
	migrationHeight := h.app.committed.Height + 1
	intent := ynxauth.RegistrationIntent{ChainID: network, Owner: owner, PKA: public.PKA, PKB: public.PKB, NewRevision: 1, LedgerNonce: 1, ActivateAt: uint64(migrationHeight + 1)}
	migrationWire := abciRegistrationWire(t, recipient, nil, key, intent)
	migrationEnvelope := mustPQEnvelope(t, PQMigrationType, migrationWire)
	if sameBlock {
		h.apply(t, cmttypes.Txs{wire, migrationEnvelope})
	} else {
		h.apply(t, cmttypes.Txs{migrationEnvelope})
	}
	h.apply(t, nil)
	fundResult, err := h.raw.LoadFinalizeBlockResponse(fundHeight)
	if err != nil || len(fundResult.TxResults) == 0 || fundResult.TxResults[0].Code != 0 {
		t.Fatal("legacy funding failed", err, fundResult)
	}
	migrationResult, err := h.raw.LoadFinalizeBlockResponse(migrationHeight)
	migrationIndex := 0
	if sameBlock {
		migrationIndex = 1
	}
	if err != nil || len(migrationResult.TxResults) <= migrationIndex || migrationResult.TxResults[migrationIndex].Code != 0 {
		t.Fatal("migration failed", err, migrationResult)
	}
	makeOriginal := func(height int64, index int, kind string, envelope, native []byte) PQLabEnrollmentOriginal {
		b, s := f.light.block(t, height), f.light.block(t, height+1)
		expect := func(v *cmttypes.LightBlock) PQLightProofExpectation {
			return PQLightProofExpectation{ChainID: v.ChainID, HeaderHeight: v.Height, BlockHash: bytes.Clone(v.Hash()), StateHeight: v.Height - 1, StateAppHash: bytes.Clone(v.AppHash)}
		}
		txProof, err := cmtjson.Marshal(h.blocks.LoadBlock(height).Data.Txs.Proof(index))
		if err != nil {
			t.Fatal(err)
		}
		result, err := h.raw.LoadFinalizeBlockResponse(height)
		if err != nil {
			t.Fatal(err)
		}
		exec, resultProof, err := EncodePQTransactionExecutionProof(result.TxResults, index)
		if err != nil {
			t.Fatal(err)
		}
		nativeHash := sha256.Sum256(native)
		return PQLabEnrollmentOriginal{Expected: PQTransactionProofExpectation{Block: expect(b), Successor: expect(s), TransactionType: kind, Envelope: bytes.Clone(envelope), NativeWire: bytes.Clone(native), TransactionHash: cmttypes.Tx(envelope).Hash(), NativeWireHash: nativeHash[:], Index: int64(index)}, Proof: PQTransactionProofRequest{Version: PQTransactionProofVersion, Block: f.light.encode(t, b), Successor: f.light.encode(t, s), TransactionProof: txProof, ExecutionResult: exec, ExecutionProof: resultProof}}
	}
	funding := makeOriginal(fundHeight, 0, PQLabLegacyFundingType, wire, wire)
	migration := makeOriginal(migrationHeight, migrationIndex, PQMigrationType, migrationEnvelope, migrationWire)
	source, err := NewPQEngineFileSource(h.f.migration, h.path, h.f.bootstrap, f.light.authorization)
	if err != nil {
		t.Fatal(err)
	}
	state, err := h.raw.Load()
	if err != nil {
		t.Fatal(err)
	}
	authority, err := source.ConsensusAuthorityForState(state.ChainID, state.LastBlockHeight, state.AppHash)
	if err != nil {
		t.Fatal(err)
	}
	trust := f.light.trust
	trust.Snapshot = authority.(*PQEngineSnapshot)
	trust.Now = f.light.block(t, migrationHeight+1).Time.Add(time.Second)
	pins := PQLabEnrollmentPins{OriginalGenesis: network, NativeChainID: uint64(tx.ChainID), FundingSource: tx.From, Owner: owner, FundingAmount: uint64(tx.Amount), PKA: public.PKA, PKB: public.PKB, ActivationHeight: intent.ActivateAt}
	got, err := VerifyPQLabEnrollmentOriginals(trust, pins, funding, migration)
	if err != nil || got.CurrentEligibility != "UNKNOWN" || got.NativeGrant || !got.Funding.ExecutionSuccessful || !got.Migration.ExecutionSuccessful {
		t.Fatal("legacy enrollment proof", got, err)
	}
	if sameBlock && os.Getenv("YNX_ENROLLMENT_FIXTURE_OUT") != "" {
		writePQLabEnrollmentCLIProofFixture(t, f.light, trust, pins, funding, migration)
	}
	if _, err = VerifyPQTransactionProof(trust, funding.Expected, funding.Proof); err == nil {
		t.Fatal("public PQ-only verifier accepted classic wire")
	}
	if sameBlock {
		for _, mode := range []string{"original-index-mismatch", "other-execution-result", "other-native-hash", "other-hash", "altered-successor"} {
			t.Run("full API "+mode, func(t *testing.T) {
				bad := migration
				switch mode {
				case "original-index-mismatch":
					bad.Expected.Index = funding.Expected.Index
				case "other-execution-result":
					bad.Proof.ExecutionResult = bytes.Clone(funding.Proof.ExecutionResult)
				case "other-native-hash":
					bad.Expected.NativeWireHash = bytes.Repeat([]byte{0xf2}, 32)
				case "other-hash":
					bad.Expected.Block.BlockHash = bytes.Repeat([]byte{0xf1}, 32)
				case "altered-successor":
					bad.Proof.Successor.CommitResult = bytes.Clone(funding.Proof.Block.CommitResult)
				}
				out, err := VerifyPQLabEnrollmentOriginals(trust, pins, funding, bad)
				if err == nil || out.CurrentEligibility != "UNKNOWN" || out.NativeGrant {
					t.Fatalf("full API accepted invalid %s: %+v / %v", mode, out, err)
				}
			})
		}
	}
	if !sameBlock {
		t.Run("adjacent conflicting hash control", func(t *testing.T) {
			conflict := got.Migration
			conflict.Block.BlockHash = hex.EncodeToString(bytes.Repeat([]byte{9}, 32))
			if err := verifyEnrollmentTransition(trust, funding, migration, got.Funding, conflict); err == nil {
				t.Fatal("conflicting adjacent hashes accepted")
			}
		})
	} else {
		for _, mode := range []string{"reversed index", "different total", "different block", "different successor"} {
			t.Run(mode, func(t *testing.T) {
				bad := got.Migration
				switch mode {
				case "reversed index":
					bad.Index = got.Funding.Index
				case "different total":
					bad.Total++
				case "different block":
					bad.Block.BlockHash = hex.EncodeToString(bytes.Repeat([]byte{8}, 32))
				case "different successor":
					bad.Successor.BlockHash = hex.EncodeToString(bytes.Repeat([]byte{9}, 32))
				}
				if err := verifyEnrollmentSameBlock(got.Funding, bad); err == nil {
					t.Fatal("invalid same-block linkage accepted")
				}
			})
		}
	}
	t.Run("legacy wrong network", func(t *testing.T) {
		bad := pins
		bad.NativeChainID++
		if out, err := VerifyPQLabEnrollmentOriginals(trust, bad, funding, migration); err == nil || out.CurrentEligibility != "UNKNOWN" {
			t.Fatal("wrong legacy native chain accepted")
		}
	})
	t.Run("legacy result from other transaction", func(t *testing.T) {
		bad := funding
		bad.Proof.ExecutionResult = bytes.Clone(migration.Proof.ExecutionResult)
		if out, err := VerifyPQLabEnrollmentOriginals(trust, pins, bad, migration); err == nil || out.CurrentEligibility != "UNKNOWN" {
			t.Fatal("other result accepted")
		}
	})
	t.Run("original bytes", func(t *testing.T) {
		bad := funding
		bad.Expected.NativeWire = bytes.Clone(wire)
		bad.Expected.NativeWire[0] ^= 1
		if _, err := VerifyPQLabEnrollmentOriginals(trust, pins, bad, migration); err == nil {
			t.Fatal("changed original accepted")
		}
	})
	t.Run("header or result", func(t *testing.T) {
		bad := funding
		bad.Proof.ExecutionResult = []byte{1, 2}
		if _, err := VerifyPQLabEnrollmentOriginals(trust, pins, bad, migration); err == nil {
			t.Fatal("changed result accepted")
		}
	})
	t.Run("native hash", func(t *testing.T) {
		bad := funding
		bad.Expected.TransactionHash = bytes.Repeat([]byte{1}, 32)
		if _, err := VerifyPQLabEnrollmentOriginals(trust, pins, bad, migration); err == nil {
			t.Fatal("changed hash accepted")
		}
	})
	t.Run("invalid classic signature", func(t *testing.T) {
		forged := tx
		forged.Signature = "00"
		changed, err := json.Marshal(forged)
		if err != nil {
			t.Fatal(err)
		}
		hash := sha256.Sum256(changed)
		bad := funding
		bad.Expected.Envelope, bad.Expected.NativeWire = changed, bytes.Clone(changed)
		bad.Expected.TransactionHash, bad.Expected.NativeWireHash = bytes.Clone(hash[:]), bytes.Clone(hash[:])
		if _, err := VerifyPQLabEnrollmentOriginals(trust, pins, bad, migration); err == nil {
			t.Fatal("invalid classic signature accepted")
		}
	})
}
