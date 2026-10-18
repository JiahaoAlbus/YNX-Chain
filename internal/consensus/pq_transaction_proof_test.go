package consensus

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	dbm "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtconsensus "github.com/cometbft/cometbft/consensus"
	"github.com/cometbft/cometbft/crypto/merkle"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

type pqTransactionProofFixture struct {
	light    *pqLightProofFixture
	expected []PQTransactionProofExpectation
	proofs   []PQTransactionProofRequest
}

// Real source policy/migration, original Ed membership, four double-PQ PoPs,
// engine activation, BlockExecutor results and two stored signed headers. No
// Node.Start, RPC, peer-authorized snapshot, or fake successful result is used.
// Index 1 deliberately reaches Finalize with a duplicate authorization to test
// a committed nonzero ABCI result; this is not a claim of proposal acceptance.
func newPQTransactionProofFixture(t *testing.T) *pqTransactionProofFixture {
	t.Helper()
	account := &abciRevocationFixture{classic: deterministicPrivateKey(211), otherClassic: deterministicPrivateKey(212)}
	account.owner, account.other = mustNativeAddress(t, account.classic), mustNativeAddress(t, account.otherClassic)
	t.Cleanup(account.classic.Zero)
	t.Cleanup(account.otherClassic.Zero)
	d := chain.NewDevnetWithValidators(chain.DefaultNetworkConfig("testnet"), []chain.Validator{
		{Address: "ynx_validator_primary", Moniker: "primary", VotingPower: 1, Active: true},
		{Address: "ynx_validator_seoul", Moniker: "seoul", VotingPower: 1, Active: true},
		{Address: "ynx_validator_tokyo", Moniker: "tokyo", VotingPower: 1, Active: true},
		{Address: "ynx_validator_sydney", Moniker: "sydney", VotingPower: 1, Active: true},
	})
	if _, err := d.Faucet(account.owner, 100); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	if err := d.EnableAccountPQ(2); err != nil {
		t.Fatal(err)
	}
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	account.network, err = hex.DecodeString(migration.OriginalGenesisHash)
	if err != nil {
		t.Fatal(err)
	}
	account.key, account.public, err = ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(account.key.Destroy)
	f := &validatorRegistryFixture{legacy: make(map[string]ed25519.PrivateKey)}
	var bindings []chain.ConsensusValidatorKeyBinding
	for index, v := range migration.Validators {
		key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(index + 111)}, 32))
		public := key.Public().(ed25519.PublicKey)
		address := sha256.Sum256(public)
		f.legacy[string(address[:20])] = key
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: v.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(public), ConsensusAddress: strings.ToUpper(hex.EncodeToString(address[:20]))})
	}
	t.Cleanup(func() {
		for _, key := range f.legacy {
			clear(key)
		}
	})
	f.migration, err = migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	account.m = f.migration
	f.doc, err = BuildCometGenesis(f.migration, time.Now().UTC().Add(-time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	f.raw, err = cmtjson.Marshal(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	genesis := sha256.Sum256(f.raw)
	f.pins = ConsensusBootstrapPins{hex.EncodeToString(genesis[:]), f.migration.OriginalGenesisHash, f.migration.StateHash}
	f.bootstrap, err = NewConsensusBootstrap(f.raw, f.pins, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	app, err := NewPersistentApplicationWithBootstrap(f.migration, filepath.Join(t.TempDir(), "committed.json"), f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	db, blockDB := dbm.NewMemDB(), dbm.NewMemDB()
	t.Cleanup(func() { _ = db.Close(); _ = blockDB.Close() })
	h := &engineWiringHarness{f: f, app: app, source: &engineSourceRecorder{app: app}, raw: sm.NewStore(db, sm.StoreOptions{}), blocks: blockstore.NewBlockStore(blockDB), path: app.statePath}
	h.proxy = startEngineTestProxy(t, app)
	initial, err := sm.MakeGenesisState(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	initial.AppHash = nil
	if err = h.raw.Save(initial); err != nil {
		t.Fatal(err)
	}
	handshake := cmtconsensus.NewHandshaker(h.raw, initial, h.blocks, f.doc)
	handshake.SetConsensusAuthoritySource(h.source)
	if err = handshake.Handshake(h.proxy); err != nil {
		t.Fatal(err)
	}
	if _, err = h.wrapped().Load(); err != nil {
		t.Fatal(err)
	}
	var registrations cmttypes.Txs
	for i := range f.bootstrap.record.Members {
		key, wire := engineRegistration(t, f, i, f.doc.InitialHeight)
		h.keys = append(h.keys, key)
		tx, err := EncodeValidatorRegistryTransaction(wire)
		if err != nil {
			t.Fatal(err)
		}
		registrations = append(registrations, tx)
	}
	registration := account.registration(t, false, uint64(f.doc.InitialHeight+1))
	registrations = append(registrations, mustPQEnvelope(t, PQMigrationType, registration))
	h.apply(t, registrations)
	registered, err := h.raw.LoadFinalizeBlockResponse(f.doc.InitialHeight)
	if err != nil {
		t.Fatal(err)
	}
	for _, result := range registered.TxResults {
		if result.Code != 0 {
			t.Fatal("real registration rejected", result.Code, result.Log)
		}
	}
	schedule, err := NewPQEngineSchedule(f.bootstrap, h.app.committed.ValidatorRegistry, h.app.committed.Height, h.app.committed.Height+4)
	if err != nil {
		t.Fatal(err)
	}
	scheduleRaw, err := json.Marshal(schedule)
	if err != nil {
		t.Fatal(err)
	}
	scheduleHash, err := schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	authorization, err := NewPQEngineAuthorization(scheduleRaw, scheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	app, err = NewPersistentApplicationWithEngineAuthorization(f.migration, h.path, f.bootstrap, authorization)
	if err != nil {
		t.Fatal(err)
	}
	h.app = app
	h.source.app = app
	h.proxy = startEngineTestProxy(t, app)
	for app.committed.Height < schedule.ActivationHeight+2 {
		h.apply(t, nil)
	}
	_, member := consensusPQProof(t, account.key, account.network, account.owner, ynxauth.TransactionPurpose, account.transferMessage(t, false, 2, 7))
	transfer := mustPQEnvelope(t, PQTransferType, member)
	whole := abciWhole(t, account, account.transferMessage(t, false, 3, 2), account.transferMessage(t, false, 4, 999), account.transferMessage(t, false, 4, 2), account.transferMessage(t, false, 5, 2))
	envelopes := cmttypes.Txs{transfer, transfer, mustPQEnvelope(t, PQWholeType, whole)}
	height := app.committed.Height + 1
	h.apply(t, envelopes)
	h.apply(t, nil)
	results, err := h.raw.LoadFinalizeBlockResponse(height)
	if err != nil {
		t.Fatal(err)
	}
	if len(results.TxResults) != 3 || results.TxResults[0].Code != 0 || results.TxResults[1].Code == 0 || results.TxResults[2].Code != 0 {
		t.Fatal("fixture did not execute actual success/rejected/partial outcomes", results)
	}
	source, err := NewPQEngineFileSource(f.migration, h.path, f.bootstrap, authorization)
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
	snapshot, ok := authority.(*PQEngineSnapshot)
	if !ok {
		t.Fatal("normal loader returned no snapshot")
	}
	light := &pqLightProofFixture{harness: h, schedule: schedule, authorization: authorization}
	block, successor := light.block(t, height), light.block(t, height+1)
	light.trust = PQLightProofTrust{Snapshot: snapshot, TrustedLightBlock: light.block(t, schedule.ActivationHeight), TrustingPeriod: time.Hour, MaxClockDrift: time.Second, TrustLevel: cmtmath.Fraction{Numerator: 1, Denominator: 3}, Now: successor.Time.Add(time.Second)}
	blockExpectation := func(b *cmttypes.LightBlock) PQLightProofExpectation {
		return PQLightProofExpectation{ChainID: b.ChainID, HeaderHeight: b.Height, BlockHash: bytes.Clone(b.Hash()), StateHeight: b.Height - 1, StateAppHash: bytes.Clone(b.AppHash)}
	}
	light.expected, light.proof = blockExpectation(block), light.encode(t, block)
	out := &pqTransactionProofFixture{light: light}
	actualBlock := h.blocks.LoadBlock(height)
	for i, envelope := range envelopes {
		kind, wire, err := pqTransactionWire(envelope)
		if err != nil {
			t.Fatal(err)
		}
		native := sha256.Sum256(wire)
		expected := PQTransactionProofExpectation{Block: blockExpectation(block), Successor: blockExpectation(successor), TransactionType: kind, Envelope: bytes.Clone(envelope), NativeWire: bytes.Clone(wire), TransactionHash: envelope.Hash(), NativeWireHash: bytes.Clone(native[:]), Index: int64(i)}
		txProof, err := cmtjson.Marshal(actualBlock.Data.Txs.Proof(i))
		if err != nil {
			t.Fatal(err)
		}
		execution, resultProof, err := EncodePQTransactionExecutionProof(results.TxResults, i)
		if err != nil {
			t.Fatal(err)
		}
		out.expected = append(out.expected, expected)
		out.proofs = append(out.proofs, PQTransactionProofRequest{Version: PQTransactionProofVersion, Block: light.encode(t, block), Successor: light.encode(t, successor), TransactionProof: txProof, ExecutionResult: execution, ExecutionProof: resultProof})
	}
	return out
}

func clonePQTransactionProof(t *testing.T, p PQTransactionProofRequest) PQTransactionProofRequest {
	t.Helper()
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	var out PQTransactionProofRequest
	if err = json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func (f *pqTransactionProofFixture) resigned(t *testing.T, height int64, change func(*cmttypes.Header)) *cmttypes.LightBlock {
	t.Helper()
	original := f.light.block(t, height)
	full := f.light.harness.blocks.LoadBlock(height)
	change(&full.Header)
	parts, err := full.MakePartSet(cmttypes.BlockPartSizeBytes)
	if err != nil {
		t.Fatal(err)
	}
	id := cmttypes.BlockID{Hash: full.Header.Hash(), PartSetHeader: parts.Header()}
	commit := &cmttypes.Commit{Height: height, Round: original.Commit.Round, BlockID: id}
	for i, member := range original.ValidatorSet.Validators {
		vote := &cmttypes.Vote{Type: cmtproto.PrecommitType, Height: height, Round: commit.Round, BlockID: id, Timestamp: original.Commit.Signatures[i].Timestamp, ValidatorAddress: bytes.Clone(member.Address), ValidatorIndex: int32(i)}
		request, err := ynxconsensusauth.NewVoteRequestV2(f.light.harness.f.bootstrap.genesisID, original.ChainID, vote.ToProto())
		if err != nil {
			t.Fatal(err)
		}
		message, err := request.SigningBytes(1)
		if err != nil {
			t.Fatal(err)
		}
		var signature []byte
		for _, key := range f.light.harness.keys {
			if bytes.Equal(key.address, member.Address) {
				a, b := key.signatures(t, message)
				signature, err = (ynxconsensusauth.Envelope{KeyEpoch: 1, MLDSA87: a, SLHDSASHA2256f: b}).MarshalBinary()
				if err != nil {
					t.Fatal(err)
				}
			}
		}
		if len(signature) == 0 {
			t.Fatal("missing original registered signing key")
		}
		vote.Signature = signature
		commit.Signatures = append(commit.Signatures, vote.CommitSig())
	}
	return &cmttypes.LightBlock{SignedHeader: &cmttypes.SignedHeader{Header: &full.Header, Commit: commit}, ValidatorSet: original.ValidatorSet}
}

func TestPQTransactionProofActualTwoHeaderSuccessFailureAndWholePartial(t *testing.T) {
	f := newPQTransactionProofFixture(t)
	originalProofs, err := json.Marshal(f.proofs)
	if err != nil {
		t.Fatal(err)
	}
	before, err := cmtjson.Marshal(f.light.trust.TrustedLightBlock)
	if err != nil {
		t.Fatal(err)
	}
	for index, want := range []string{"succeeded", "rejected", "partial"} {
		raw, err := json.Marshal(f.proofs[index])
		if err != nil {
			t.Fatal(err)
		}
		proof, err := DecodePQTransactionProofRequest(raw)
		if err != nil {
			t.Fatal(err)
		}
		result, err := VerifyPQTransactionProof(f.light.trust, f.expected[index], proof)
		if err != nil || !result.Included || !result.Finalized || result.NativeGrant || result.Classification != "data" || result.Outcome != want || result.ExecutionSuccessful != (index == 0) || (result.ExecutionCode != 0) != (index == 1) || result.Index != int64(index) || result.Total != 3 {
			t.Fatal("actual transaction/result finality changed", index, result, err)
		}
		if result.TransactionHash == result.NativeWireHash || result.Block.HeaderHeight+1 != result.Successor.HeaderHeight || !result.Block.CommitVerified || !result.Successor.CommitVerified {
			t.Fatal("wire/envelope identity or two-header verification lost")
		}
		if index == 2 && (len(result.BatchResults) != 4 || result.BatchResults[1].Outcome != "rejected") {
			t.Fatal("outer Code0 disguised partial Whole rejection")
		}
		encoded, err := json.Marshal(result)
		if err != nil {
			t.Fatal(err)
		}
		var fields map[string]any
		if json.Unmarshal(encoded, &fields) != nil {
			t.Fatal("result JSON")
		}
		for _, field := range []string{"height", "index", "total", "executionCode", "gasWanted", "gasUsed"} {
			if _, ok := fields[field].(string); !ok {
				t.Fatal("integer lost exact decimal encoding", field)
			}
		}
		if fields["log"] != nil || fields["events"] != nil || fields["info"] != nil {
			t.Fatal("uncommitted result metadata exposed as verified")
		}
	}
	after, _ := cmtjson.Marshal(f.light.trust.TrustedLightBlock)
	if !bytes.Equal(before, after) {
		t.Fatal("trusted input acquired mutation/capability")
	}
	for _, nilIndex := range []int{-1, 0, 1} {
		if _, _, err := EncodePQTransactionExecutionProof([]*abci.ExecTxResult{nil}, nilIndex); err == nil {
			t.Fatal("nil/out-of-bounds result accepted")
		}
	}
	actual, err := f.light.harness.raw.LoadFinalizeBlockResponse(f.expected[0].Block.HeaderHeight)
	if err != nil {
		t.Fatal(err)
	}
	originalA, originalB, err := EncodePQTransactionExecutionProof(actual.TxResults, 0)
	if err != nil {
		t.Fatal(err)
	}
	actual.TxResults[0].Log = "not signed by LastResultsHash"
	actual.TxResults[0].Events = []abci.Event{{Type: "untrusted-display-only"}}
	actual.TxResults[0].Codespace = "untrusted"
	a, b, err := EncodePQTransactionExecutionProof(actual.TxResults, 0)
	if err != nil || !bytes.Equal(a, originalA) || !bytes.Equal(b, originalB) {
		t.Fatal("normal Comet deterministic result projection changed", err)
	}
	t.Run("malformed request", func(t *testing.T) {
		raw, _ := json.Marshal(f.proofs[0])
		for _, bad := range [][]byte{append([]byte(`{"unknown":true,`), raw[1:]...), append([]byte(`{"version":"other",`), raw[1:]...), append(bytes.Clone(raw), []byte(`null`)...)} {
			if _, err := DecodePQTransactionProofRequest(bad); err == nil {
				t.Fatal("unknown/duplicate/trailing request accepted")
			}
		}
	})
	t.Run("independent coordinates", func(t *testing.T) {
		for name, mutate := range map[string]func(*PQTransactionProofExpectation){"index": func(e *PQTransactionProofExpectation) { e.Index++ }, "type": func(e *PQTransactionProofExpectation) { e.TransactionType = PQMigrationType }, "native": func(e *PQTransactionProofExpectation) { e.NativeWire = []byte("different") }, "wirehash": func(e *PQTransactionProofExpectation) { e.NativeWireHash = bytes.Repeat([]byte{1}, 32) }, "outerhash": func(e *PQTransactionProofExpectation) { e.TransactionHash = bytes.Repeat([]byte{2}, 32) }, "envelope": func(e *PQTransactionProofExpectation) { e.Envelope = append(bytes.Clone(e.Envelope), ' ') }, "height": func(e *PQTransactionProofExpectation) { e.Successor.HeaderHeight++ }, "state": func(e *PQTransactionProofExpectation) { e.Successor.StateAppHash = bytes.Repeat([]byte{3}, 32) }} {
			t.Run(name, func(t *testing.T) {
				e := f.expected[0]
				mutate(&e)
				if _, err := VerifyPQTransactionProof(f.light.trust, e, f.proofs[0]); err == nil {
					t.Fatal("proof retargeted independent intent")
				}
			})
		}
	})
	for _, field := range []string{"tx-data", "tx-root", "tx-index", "result-index", "result-total", "result-aunt", "code", "data", "gas-wanted", "gas-used", "log", "events"} {
		t.Run(field, func(t *testing.T) {
			p := clonePQTransactionProof(t, f.proofs[0])
			switch field {
			case "tx-data", "tx-root", "tx-index":
				var tx cmttypes.TxProof
				if cmtjson.Unmarshal(p.TransactionProof, &tx) != nil {
					t.Fatal("fixture proof")
				}
				if field == "tx-data" {
					tx.Data[0] ^= 1
				}
				if field == "tx-root" {
					tx.RootHash[0] ^= 1
				}
				if field == "tx-index" {
					tx.Proof.Index++
				}
				p.TransactionProof, _ = cmtjson.Marshal(tx)
			case "result-index", "result-total", "result-aunt":
				var proof merkle.Proof
				if cmtjson.Unmarshal(p.ExecutionProof, &proof) != nil {
					t.Fatal("fixture result proof")
				}
				if field == "result-index" {
					proof.Index++
				}
				if field == "result-total" {
					proof.Total++
				}
				if field == "result-aunt" {
					proof.Aunts[0][0] ^= 1
				}
				p.ExecutionProof, _ = cmtjson.Marshal(proof)
			default:
				var result abci.ExecTxResult
				if result.Unmarshal(p.ExecutionResult) != nil {
					t.Fatal("fixture result")
				}
				switch field {
				case "code":
					result.Code++
				case "data":
					result.Data[0] ^= 1
				case "gas-wanted":
					result.GasWanted++
				case "gas-used":
					result.GasUsed++
				case "log":
					result.Log = "not committed"
				case "events":
					result.Events = []abci.Event{{Type: "uncommitted"}}
				}
				p.ExecutionResult, _ = result.Marshal()
			}
			if _, err := VerifyPQTransactionProof(f.light.trust, f.expected[0], p); err == nil {
				t.Fatal("tampered transaction/result accepted")
			}
		})
	}
	for _, which := range []string{"block", "successor"} {
		for _, branch := range []string{"A", "B"} {
			t.Run(which+"-bad-tail-"+branch, func(t *testing.T) {
				p := clonePQTransactionProof(t, f.proofs[0])
				target := &p.Block
				if which == "successor" {
					target = &p.Successor
				}
				var c coretypes.ResultCommit
				if cmtjson.Unmarshal(target.CommitResult, &c) != nil {
					t.Fatal("commit fixture")
				}
				envelope, err := ynxconsensusauth.ParseEnvelope(c.Commit.Signatures[3].Signature)
				if err != nil {
					t.Fatal(err)
				}
				if branch == "A" {
					envelope.MLDSA87[0] ^= 1
				} else {
					envelope.SLHDSASHA2256f[0] ^= 1
				}
				c.Commit.Signatures[3].Signature, err = envelope.MarshalBinary()
				if err != nil {
					t.Fatal(err)
				}
				target.CommitResult, _ = cmtjson.Marshal(c)
				if _, err = VerifyPQTransactionProof(f.light.trust, f.expected[0], p); err == nil {
					t.Fatal("all-present dual-signature verification skipped tail")
				}
			})
		}
	}
	for _, field := range []string{"parts", "last-commit", "results-root"} {
		t.Run("fully-resigned-"+field, func(t *testing.T) {
			p := clonePQTransactionProof(t, f.proofs[0])
			e := f.expected[0]
			changed := f.resigned(t, e.Successor.HeaderHeight, func(h *cmttypes.Header) {
				switch field {
				case "parts":
					h.LastBlockID.PartSetHeader.Hash[0] ^= 1
				case "last-commit":
					h.LastCommitHash[0] ^= 1
				case "results-root":
					h.LastResultsHash[0] ^= 1
				}
			})
			p.Successor = f.light.encode(t, changed)
			e.Successor.BlockHash = bytes.Clone(changed.Hash())
			if _, err := VerifyPQLightProof(f.light.trust, e.Successor, p.Successor); err != nil {
				t.Fatal("fully re-signed negative fixture failed unrelated light verification", err)
			}
			if _, err := VerifyPQTransactionProof(f.light.trust, e, p); err == nil {
				t.Fatal("two independent valid signatures replaced exact header/result linkage")
			}
		})
	}
	// Recompute the actual deterministic result root and sign the changed
	// successor with every original key. A stale Merkle root cannot cause these
	// negative controls to pass: only the PQ result profile rejects them.
	for _, profile := range []struct {
		name  string
		index int
	}{{"single-success-wrong-identity", 0}, {"single-rejected-success-data", 1}, {"whole-rejected-member-claims-identity", 2}} {
		t.Run("fully-resigned-"+profile.name, func(t *testing.T) {
			e := f.expected[profile.index]
			p := clonePQTransactionProof(t, f.proofs[profile.index])
			actual, err := f.light.harness.raw.LoadFinalizeBlockResponse(e.Block.HeaderHeight)
			if err != nil {
				t.Fatal(err)
			}
			result := actual.TxResults[profile.index]
			switch profile.index {
			case 0:
				result.Data = []byte("0x" + strings.Repeat("00", 32))
			case 1:
				if result.Code == 0 {
					t.Fatal("negative fixture lost actual rejected result")
				}
				result.Data = []byte(SignedTransactionHash(e.Envelope))
			case 2:
				var batch PQBatchExecutionResult
				if err := json.Unmarshal(result.Data, &batch); err != nil {
					t.Fatal(err)
				}
				batch.Results[1].TransactionHash = batch.Results[0].TransactionHash
				result.Data, err = json.Marshal(batch)
				if err != nil {
					t.Fatal(err)
				}
			}
			p.ExecutionResult, p.ExecutionProof, err = EncodePQTransactionExecutionProof(actual.TxResults, profile.index)
			if err != nil {
				t.Fatal(err)
			}
			root := cmttypes.NewResults(actual.TxResults).Hash()
			changed := f.resigned(t, e.Successor.HeaderHeight, func(h *cmttypes.Header) { h.LastResultsHash = bytes.Clone(root) })
			p.Successor = f.light.encode(t, changed)
			e.Successor.BlockHash = bytes.Clone(changed.Hash())
			if _, err := VerifyPQLightProof(f.light.trust, e.Successor, p.Successor); err != nil {
				t.Fatal("profile negative did not carry an independently valid fully signed header", err)
			}
			var merkleProof merkle.Proof
			if err := cmtjson.Unmarshal(p.ExecutionProof, &merkleProof); err != nil || merkleProof.Verify(changed.LastResultsHash, p.ExecutionResult) != nil {
				t.Fatal("profile negative did not carry a matching result proof", err)
			}
			if _, err := VerifyPQTransactionProof(f.light.trust, e, p); err == nil {
				t.Fatal("valid consensus proof released a result inconsistent with its original PQ profile")
			}
		})
	}
	afterProofs, err := json.Marshal(f.proofs)
	if err != nil || !bytes.Equal(originalProofs, afterProofs) {
		t.Fatal("fixture bytes changed")
	}
}
