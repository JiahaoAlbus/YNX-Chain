package consensus

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	dbm "github.com/cometbft/cometbft-db"
	cmtconsensus "github.com/cometbft/cometbft/consensus"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	"github.com/cometbft/cometbft/light"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

type pqLightProofFixture struct {
	harness       *engineWiringHarness
	schedule      *PQEngineSchedule
	authorization *PQEngineAuthorization
	trust         PQLightProofTrust
	expected      PQLightProofExpectation
	proof         PQLightProofRequest
}

// Four actual validators make the fourth signature a meaningful bad-tail test:
// the first three already exceed 2/3. Reuse the normal engine harness, real
// registration PoP, BlockExecutor, durable application and BlockStore; no node,
// network, synthetic commit approval, or alternate cryptographic path is used.
func newPQLightProofFixture(t *testing.T) *pqLightProofFixture {
	t.Helper()
	d := chain.NewDevnetWithValidators(chain.DefaultNetworkConfig("testnet"), []chain.Validator{
		{Address: "ynx_validator_primary", Moniker: "primary", VotingPower: 1, Active: true},
		{Address: "ynx_validator_seoul", Moniker: "seoul", VotingPower: 1, Active: true},
		{Address: "ynx_validator_tokyo", Moniker: "tokyo", VotingPower: 1, Active: true},
		{Address: "ynx_validator_sydney", Moniker: "sydney", VotingPower: 1, Active: true},
	})
	d.ProduceBlock()
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	f := &validatorRegistryFixture{legacy: make(map[string]ed25519.PrivateKey)}
	var bindings []chain.ConsensusValidatorKeyBinding
	for i, member := range migration.Validators {
		key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(91 + i)}, ed25519.SeedSize))
		public := key.Public().(ed25519.PublicKey)
		address := sha256.Sum256(public)
		f.legacy[string(address[:20])] = key
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: member.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(public), ConsensusAddress: strings.ToUpper(hex.EncodeToString(address[:20]))})
	}
	f.migration, err = migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	// A freshly generated synthetic genesis lets the normal CLI immediately
	// consume the public fixture with its real local clock and the explicit
	// one-hour test trust period. Proof input never chooses that clock.
	f.doc, err = BuildCometGenesis(f.migration, time.Now().UTC().Add(-time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	f.raw, err = cmtjson.Marshal(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	genesisHash := sha256.Sum256(f.raw)
	f.pins = ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(genesisHash[:]), OriginalGenesisHash: f.migration.OriginalGenesisHash, MigrationStateHash: f.migration.StateHash}
	f.bootstrap, err = NewConsensusBootstrap(f.raw, f.pins, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	if len(f.bootstrap.record.Members) != 4 {
		t.Fatal("light proof bad-tail fixture requires exactly four original validators")
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
	h.apply(t, registrations)
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
	source, err := NewPQEngineFileSource(f.migration, h.path, f.bootstrap, authorization)
	if err != nil {
		t.Fatal(err)
	}
	appHash, err := hex.DecodeString(app.committed.AppHash)
	if err != nil {
		t.Fatal(err)
	}
	authority, err := source.ConsensusAuthorityForState(f.doc.ChainID, app.committed.Height, appHash)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, ok := authority.(*PQEngineSnapshot)
	if !ok {
		t.Fatal("normal file loader did not return engine snapshot")
	}
	out := &pqLightProofFixture{harness: h, schedule: schedule, authorization: authorization}
	trusted := out.block(t, schedule.ActivationHeight)
	target := out.block(t, schedule.ActivationHeight+2)
	out.trust = PQLightProofTrust{Snapshot: snapshot, TrustedLightBlock: trusted, TrustingPeriod: time.Hour, MaxClockDrift: time.Second, TrustLevel: cmtmath.Fraction{Numerator: 1, Denominator: 3}, Now: target.Time.Add(time.Second)}
	out.expected = PQLightProofExpectation{ChainID: f.doc.ChainID, HeaderHeight: target.Height, BlockHash: bytes.Clone(target.Hash()), StateHeight: target.Height - 1, StateAppHash: bytes.Clone(target.AppHash)}
	out.proof = out.encode(t, target)
	return out
}

func (f *pqLightProofFixture) block(t *testing.T, height int64) *cmttypes.LightBlock {
	t.Helper()
	block := f.harness.blocks.LoadBlock(height)
	set, err := f.harness.raw.LoadValidators(height)
	if err != nil {
		t.Fatal(err)
	}
	if block == nil {
		t.Fatal("actual BlockStore missing height", height)
	}
	return &cmttypes.LightBlock{SignedHeader: &cmttypes.SignedHeader{Header: &block.Header, Commit: f.harness.blocks.LoadSeenCommit(height)}, ValidatorSet: set}
}
func (f *pqLightProofFixture) encode(t *testing.T, block *cmttypes.LightBlock) PQLightProofRequest {
	t.Helper()
	commit, err := cmtjson.Marshal(coretypes.NewResultCommit(block.Header, block.Commit, false))
	if err != nil {
		t.Fatal(err)
	}
	validators, err := cmtjson.Marshal(&coretypes.ResultValidators{BlockHeight: block.Height, Validators: block.ValidatorSet.Validators, Count: len(block.ValidatorSet.Validators), Total: len(block.ValidatorSet.Validators)})
	if err != nil {
		t.Fatal(err)
	}
	return PQLightProofRequest{Version: PQLightProofVersion, CommitResult: commit, ValidatorsResult: validators}
}

// Change only the application version in an actual full stored block, rebuild
// its real part set/BlockID, and sign every new precommit with the independently
// registered full dual key. This isolates authority-version enforcement from
// the unrelated failure of stale signatures after header mutation.
func (f *pqLightProofFixture) resignWrongApplicationVersion(t *testing.T, height int64) *cmttypes.LightBlock {
	t.Helper()
	original := f.block(t, height)
	full := f.harness.blocks.LoadBlock(height)
	full.Version.App++
	parts, err := full.MakePartSet(cmttypes.BlockPartSizeBytes)
	if err != nil {
		t.Fatal(err)
	}
	id := cmttypes.BlockID{Hash: full.Header.Hash(), PartSetHeader: parts.Header()}
	commit := &cmttypes.Commit{Height: height, Round: original.Commit.Round, BlockID: id}
	for i, member := range original.ValidatorSet.Validators {
		vote := &cmttypes.Vote{Type: cmtproto.PrecommitType, Height: height, Round: commit.Round, BlockID: id, Timestamp: original.Commit.Signatures[i].Timestamp, ValidatorAddress: bytes.Clone(member.Address), ValidatorIndex: int32(i)}
		request, err := ynxconsensusauth.NewVoteRequestV2(f.harness.f.bootstrap.genesisID, original.ChainID, vote.ToProto())
		if err != nil {
			t.Fatal(err)
		}
		message, err := request.SigningBytes(1)
		if err != nil {
			t.Fatal(err)
		}
		for _, key := range f.harness.keys {
			if bytes.Equal(key.address, member.Address) {
				a, b := key.signatures(t, message)
				vote.Signature, err = (ynxconsensusauth.Envelope{KeyEpoch: 1, MLDSA87: a, SLHDSASHA2256f: b}).MarshalBinary()
				if err != nil {
					t.Fatal(err)
				}
			}
		}
		if len(vote.Signature) == 0 {
			t.Fatal("missing actual registered validator key")
		}
		commit.Signatures = append(commit.Signatures, vote.CommitSig())
	}
	block := &cmttypes.LightBlock{SignedHeader: &cmttypes.SignedHeader{Header: &full.Header, Commit: commit}, ValidatorSet: original.ValidatorSet}
	if err := block.ValidateBasic(original.ChainID); err != nil {
		t.Fatal(err)
	}
	bound, err := f.trust.Snapshot.BindValidatorSet(height, block.ValidatorSet)
	if err != nil {
		t.Fatal(err)
	}
	if err = bound.VerifyCommit(original.ChainID, id, height, commit); err != nil {
		t.Fatal("wrong-version fixture lacks valid full dual signatures", err)
	}
	if !bytes.Equal(block.ConsensusHash, original.ConsensusHash) {
		t.Fatal("wrong-version fixture changed consensus params hash")
	}
	return block
}
func pqLightClone(t *testing.T, block *cmttypes.LightBlock) *cmttypes.LightBlock {
	t.Helper()
	raw, err := cmtjson.Marshal(block)
	if err != nil {
		t.Fatal(err)
	}
	out, err := DecodePQTrustedLightBlock(raw)
	if err != nil {
		t.Fatal(err)
	}
	return out
}
func requirePQLightRejected(t *testing.T, trust PQLightProofTrust, expected PQLightProofExpectation, proof PQLightProofRequest) {
	t.Helper()
	result, err := VerifyPQLightProof(trust, expected, proof)
	if err == nil || !reflect.DeepEqual(result, PQLightProofResult{}) {
		t.Fatal("invalid proof produced a usable result", err, result)
	}
	var typed *PQLightProofError
	if !errors.As(err, &typed) || typed.Code == "" || len(err.Error()) > 512 {
		t.Fatal("failure lost stable bounded semantics", err)
	}
}

func TestPQLightProofActualCommitAndLightTransitions(t *testing.T) {
	f := newPQLightProofFixture(t)
	before, err := cmtjson.Marshal(f.trust.TrustedLightBlock)
	if err != nil {
		t.Fatal(err)
	}
	for _, adjacent := range []bool{false, true} {
		trust := f.trust
		if adjacent {
			trust.TrustedLightBlock = f.block(t, f.expected.HeaderHeight-1)
		}
		requestJSON, err := json.Marshal(f.proof)
		if err != nil {
			t.Fatal(err)
		}
		request, err := DecodePQLightProofRequest(requestJSON)
		if err != nil {
			t.Fatal(err)
		}
		result, err := VerifyPQLightProof(trust, f.expected, request)
		if err != nil {
			t.Fatal("actual dual-PQ light transition", adjacent, err)
		}
		if !result.CommitVerified || !result.LightTransitionVerified || result.Classification != "data" || result.HeaderHeight != f.expected.HeaderHeight || result.StateHeight != f.expected.StateHeight || result.BlockHash != hex.EncodeToString(f.expected.BlockHash) || result.StateAppHash != hex.EncodeToString(f.expected.StateAppHash) || result.TrustedHeight != trust.TrustedLightBlock.Height {
			t.Fatal("result lost actual verified anchors", result)
		}
		raw, _ := json.Marshal(result)
		var fields map[string]any
		if json.Unmarshal(raw, &fields) != nil {
			t.Fatal("result JSON")
		}
		for _, field := range []string{"headerHeight", "stateHeight", "trustedHeight", "authorityThroughHeight"} {
			if _, ok := fields[field].(string); !ok {
				t.Fatal("height precision lost", field)
			}
		}
		if fields["authorization"] != nil || fields["nativeRoot"] != nil || fields["transactionIncluded"] != nil {
			t.Fatal("data verifier issued unrelated authority")
		}
	}
	after, _ := cmtjson.Marshal(f.trust.TrustedLightBlock)
	if !bytes.Equal(before, after) {
		t.Fatal("verification mutated caller trusted block")
	}
	bare := f.trust.TrustedLightBlock
	if bare.ValidatorSet.VerifyCommit(bare.ChainID, bare.Commit.BlockID, bare.Height, bare.Commit) == nil {
		t.Fatal("verification leaked key authority into input")
	}
	for _, raw := range [][]byte{
		append([]byte(`{"authority":"peer",`), before[1:]...),
		append([]byte(`{"signed_header":null,`), before[1:]...),
		append(bytes.Clone(before), []byte(`null`)...),
	} {
		if _, err := DecodePQTrustedLightBlock(raw); err == nil {
			t.Fatal("trusted-block decoder accepted unknown, duplicate or trailing fields")
		}
	}

	target := f.block(t, f.expected.HeaderHeight)
	t.Run("resigned-wrong-application-version", func(t *testing.T) {
		wrongTarget := f.resignWrongApplicationVersion(t, target.Height)
		trusted, err := light.BindLightBlock(f.trust.Snapshot, pqLightClone(t, f.trust.TrustedLightBlock))
		if err != nil {
			t.Fatal(err)
		}
		bound, err := f.trust.Snapshot.BindValidatorSet(wrongTarget.Height, wrongTarget.ValidatorSet)
		if err != nil {
			t.Fatal(err)
		}
		// The normal trust algorithm alone has no historical AppVersion input.
		if err = light.Verify(trusted.SignedHeader, trusted.ValidatorSet, wrongTarget.SignedHeader, bound, f.trust.TrustingPeriod, f.trust.Now, f.trust.MaxClockDrift, f.trust.TrustLevel); err != nil {
			t.Fatal("resigned fixture does not isolate the version-authority boundary", err)
		}
		for _, block := range []*cmttypes.LightBlock{wrongTarget, f.resignWrongApplicationVersion(t, f.trust.TrustedLightBlock.Height)} {
			if _, err := light.BindLightBlock(f.trust.Snapshot, block); err == nil || !strings.Contains(err.Error(), "application version") {
				t.Fatal("fork light binding accepted fully signed wrong application version", err)
			}
			trust, expected, proof := f.trust, f.expected, f.proof
			if block.Height == target.Height {
				expected.BlockHash = bytes.Clone(block.Hash())
				proof = f.encode(t, block)
			} else {
				trust.TrustedLightBlock = block
			}
			result, err := VerifyPQLightProof(trust, expected, proof)
			var failure *PQLightProofError
			if !errors.As(err, &failure) || failure.Code != "authority_rejected" || !strings.Contains(failure.Detail, "application version") || !reflect.DeepEqual(result, PQLightProofResult{}) {
				t.Fatal("proof did not reject specifically on historical application version", err)
			}
		}
	})
	t.Run("historical-zero-app-codec", func(t *testing.T) {
		zero := pqLightClone(t, target)
		zero.Version.App = 0
		zero.Commit.BlockID.Hash = bytes.Clone(zero.Hash())
		raw, err := cmtjson.Marshal(zero)
		if err != nil {
			t.Fatal(err)
		}
		decoded, err := DecodePQTrustedLightBlock(raw)
		if err != nil || decoded.Version.App != 0 {
			t.Fatal("canonical historical omitted App=0 rejected by codec", err)
		}
		explicit := bytes.Replace(raw, []byte(`"version":{`), []byte(`"version":{"app":"0",`), 1)
		if bytes.Equal(raw, explicit) {
			t.Fatal("zero-App control did not alter actual version object")
		}
		if _, err := DecodePQTrustedLightBlock(explicit); err == nil {
			t.Fatal("explicit noncanonical zero-App accepted")
		}
		// Structural decoding is not verification and cannot downgrade the
		// independently pinned nonzero version at this actual fixture height.
		expected := f.expected
		expected.BlockHash = bytes.Clone(zero.Hash())
		requirePQLightRejected(t, f.trust, expected, f.encode(t, zero))
	})
	for _, branch := range []string{"ML-DSA", "SLH-DSA"} {
		t.Run("bad-tail-"+branch, func(t *testing.T) {
			bad := pqLightClone(t, target)
			last := len(bad.Commit.Signatures) - 1
			envelope, err := ynxconsensusauth.ParseEnvelope(bad.Commit.Signatures[last].Signature)
			if err != nil {
				t.Fatal(err)
			}
			if branch == "ML-DSA" {
				envelope.MLDSA87[0] ^= 1
			} else {
				envelope.SLHDSASHA2256f[0] ^= 1
			}
			bad.Commit.Signatures[last].Signature, err = envelope.MarshalBinary()
			if err != nil {
				t.Fatal(err)
			}
			trusted, err := light.BindLightBlock(f.trust.Snapshot, pqLightClone(t, f.trust.TrustedLightBlock))
			if err != nil {
				t.Fatal(err)
			}
			bound, err := light.BindLightBlock(f.trust.Snapshot, bad)
			if err != nil {
				t.Fatal(err)
			}
			if err = light.Verify(trusted.SignedHeader, trusted.ValidatorSet, bound.SignedHeader, bound.ValidatorSet, f.trust.TrustingPeriod, f.trust.Now, f.trust.MaxClockDrift, f.trust.TrustLevel); err != nil {
				t.Fatal("fixture does not reach the actual early-exit bad-tail boundary", err)
			}
			requirePQLightRejected(t, f.trust, f.expected, f.encode(t, bad))
		})
	}
	for _, kind := range []string{"absent", "nil"} {
		t.Run("strict-"+kind, func(t *testing.T) {
			block := pqLightClone(t, target)
			last := len(block.Commit.Signatures) - 1
			if kind == "absent" {
				block.Commit.Signatures[last] = cmttypes.NewCommitSigAbsent()
			} else {
				member := block.ValidatorSet.Validators[last]
				vote := &cmttypes.Vote{Type: cmtproto.PrecommitType, Height: block.Height, Round: block.Commit.Round, Timestamp: block.Commit.Signatures[last].Timestamp, ValidatorAddress: bytes.Clone(member.Address), ValidatorIndex: int32(last)}
				request, err := ynxconsensusauth.NewVoteRequestV2(f.harness.f.bootstrap.genesisID, block.ChainID, vote.ToProto())
				if err != nil {
					t.Fatal(err)
				}
				message, err := request.SigningBytes(1)
				if err != nil {
					t.Fatal(err)
				}
				for _, key := range f.harness.keys {
					if bytes.Equal(key.address, member.Address) {
						a, b := key.signatures(t, message)
						vote.Signature, err = (ynxconsensusauth.Envelope{KeyEpoch: 1, MLDSA87: a, SLHDSASHA2256f: b}).MarshalBinary()
						if err != nil {
							t.Fatal(err)
						}
					}
				}
				block.Commit.Signatures[last] = vote.CommitSig()
			}
			if _, err := VerifyPQLightProof(f.trust, f.expected, f.encode(t, block)); err != nil {
				t.Fatal("valid three-of-four plus absent/nil vote rejected", err)
			}
			if kind == "absent" {
				block.Commit.Signatures[last].Timestamp = target.Time
			} else {
				block.Commit.Signatures[last].Signature[len(block.Commit.Signatures[last].Signature)-1] ^= 1
			}
			requirePQLightRejected(t, f.trust, f.expected, f.encode(t, block))
		})
	}
	noQuorum := pqLightClone(t, target)
	noQuorum.Commit.Signatures[2] = cmttypes.NewCommitSigAbsent()
	noQuorum.Commit.Signatures[3] = cmttypes.NewCommitSigAbsent()
	requirePQLightRejected(t, f.trust, f.expected, f.encode(t, noQuorum))
}

func TestPQLightProofRejectsAuthorityAnchorsAndMalformedRPC(t *testing.T) {
	f := newPQLightProofFixture(t)
	for _, name := range []string{"chain", "block", "state-hash", "state-height", "overflow", "nil-authority", "expired", "zero-period", "future-clock", "fraction-zero", "fraction-overflow", "fraction-too-small", "same-height"} {
		t.Run(name, func(t *testing.T) {
			trust, expected := f.trust, f.expected
			switch name {
			case "chain":
				expected.ChainID += "-other"
			case "block":
				expected.BlockHash = bytes.Repeat([]byte{9}, 32)
			case "state-hash":
				expected.StateAppHash = bytes.Repeat([]byte{9}, 32)
			case "state-height":
				expected.StateHeight--
			case "overflow":
				expected.StateHeight = math.MaxInt64
				expected.HeaderHeight = math.MinInt64
			case "nil-authority":
				trust.Snapshot = nil
			case "expired":
				trust.Now = trust.TrustedLightBlock.Time.Add(trust.TrustingPeriod)
			case "zero-period":
				trust.TrustingPeriod = 0
			case "future-clock":
				trust.Now = trust.TrustedLightBlock.Time.Add(-time.Hour)
			case "fraction-zero":
				trust.TrustLevel = cmtmath.Fraction{}
			case "fraction-overflow":
				trust.TrustLevel = cmtmath.Fraction{Numerator: math.MaxUint64, Denominator: math.MaxUint64}
			case "fraction-too-small":
				trust.TrustLevel = cmtmath.Fraction{Numerator: 1, Denominator: 4}
			case "same-height":
				trust.TrustedLightBlock = f.block(t, expected.HeaderHeight)
			}
			requirePQLightRejected(t, trust, expected, f.proof)
		})
	}
	target := f.block(t, f.expected.HeaderHeight)
	for _, name := range []string{"header-height", "commit-height", "round", "index", "part-set", "parameters", "app-version", "next-set", "power", "duplicate", "order", "header-chain", "missing-signature"} {
		t.Run(name, func(t *testing.T) {
			block := pqLightClone(t, target)
			expected := f.expected
			switch name {
			case "header-height":
				block.Header.Height++
			case "commit-height":
				block.Commit.Height++
			case "round":
				block.Commit.Round++
			case "index":
				block.Commit.Signatures[0], block.Commit.Signatures[1] = block.Commit.Signatures[1], block.Commit.Signatures[0]
			case "part-set":
				block.Commit.BlockID.PartSetHeader.Hash[0] ^= 1
			case "parameters":
				block.ConsensusHash = bytes.Repeat([]byte{5}, 32)
			case "app-version":
				block.Version.App++
			case "next-set":
				block.NextValidatorsHash = bytes.Repeat([]byte{5}, 32)
			case "power":
				block.ValidatorSet.Validators[0].VotingPower++
			case "duplicate":
				block.ValidatorSet.Validators[1] = block.ValidatorSet.Validators[0]
			case "order":
				block.ValidatorSet.Validators[0], block.ValidatorSet.Validators[1] = block.ValidatorSet.Validators[1], block.ValidatorSet.Validators[0]
			case "header-chain":
				block.ChainID += "-other"
			case "missing-signature":
				block.Commit.Signatures = block.Commit.Signatures[:3]
			}
			if name == "parameters" || name == "app-version" || name == "next-set" || name == "header-chain" {
				block.Commit.BlockID.Hash = bytes.Clone(block.Hash())
				expected.BlockHash = bytes.Clone(block.Hash())
			}
			requirePQLightRejected(t, f.trust, expected, f.encode(t, block))
		})
	}
	for _, name := range []string{"pagination", "wrong-height", "unknown", "duplicate-json", "trailing", "number-instead-of-string", "leading-zero"} {
		t.Run(name, func(t *testing.T) {
			proof := f.proof
			var response coretypes.ResultValidators
			if err := cmtjson.Unmarshal(proof.ValidatorsResult, &response); err != nil {
				t.Fatal(err)
			}
			switch name {
			case "pagination":
				response.Total++
				proof.ValidatorsResult, _ = cmtjson.Marshal(response)
			case "wrong-height":
				response.BlockHeight--
				proof.ValidatorsResult, _ = cmtjson.Marshal(response)
			case "unknown":
				proof.ValidatorsResult = append([]byte(`{"root":"peer",`), proof.ValidatorsResult[1:]...)
			case "duplicate-json":
				proof.ValidatorsResult = append([]byte(`{"total":"4",`), proof.ValidatorsResult[1:]...)
			case "trailing":
				proof.CommitResult = append(bytes.Clone(proof.CommitResult), []byte(` {}`)...)
			case "number-instead-of-string":
				proof.ValidatorsResult = bytes.Replace(proof.ValidatorsResult, []byte(`"count":"4"`), []byte(`"count":4`), 1)
			case "leading-zero":
				proof.ValidatorsResult = bytes.Replace(proof.ValidatorsResult, []byte(`"count":"4"`), []byte(`"count":"04"`), 1)
			}
			requirePQLightRejected(t, f.trust, f.expected, proof)
		})
	}
	// Wrong but independently well-formed genesis/history cannot authenticate
	// this proof. This is a second normal loader, not a peer-bound key callback.
	other := newPQLightProofFixture(t)
	wrongTrust := f.trust
	wrongTrust.Snapshot = other.trust.Snapshot
	requirePQLightRejected(t, wrongTrust, f.expected, f.proof)
}

func TestPQLightProofDecoderBoundsAndTrustArithmetic(t *testing.T) {
	valid := []byte(`{"version":"YNX-PQ-LIGHT-PROOF/v1","commitResult":"e30=","validatorsResult":"e30="}`)
	if _, err := DecodePQLightProofRequest(valid); err != nil {
		t.Fatal(err)
	}
	for _, raw := range [][]byte{
		append([]byte(`{"version":"other",`), valid[1:]...),
		append([]byte(`{"now":"peer",`), valid[1:]...),
		append(bytes.Clone(valid), []byte(`null`)...),
		[]byte(`{"version":"YNX-PQ-LIGHT-PROOF/v1","commitResult":null,"validatorsResult":"e30="}`),
		append([]byte{'"', 0xff}, '"'),
		bytes.Repeat([]byte{' '}, MaxPQLightProofRequestBytes+1),
	} {
		if _, err := DecodePQLightProofRequest(raw); err == nil {
			t.Fatal("invalid outer request accepted")
		}
	}
	if _, err := pqLightTrustLevel(cmtmath.Fraction{Numerator: math.MaxInt64, Denominator: math.MaxInt64}, cmttypes.MaxTotalVotingPower); err != nil {
		t.Fatal("exact reducible trust fraction rejected", err)
	}
	if _, err := pqLightTrustLevel(cmtmath.Fraction{Numerator: math.MaxInt64 - 1, Denominator: math.MaxInt64}, cmttypes.MaxTotalVotingPower); err == nil {
		t.Fatal("unsafe upstream multiplication accepted")
	}
}
