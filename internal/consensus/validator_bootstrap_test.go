package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	"github.com/cloudflare/circl/sign/slhdsa"
	abci "github.com/cometbft/cometbft/abci/types"
	cryptoenc "github.com/cometbft/cometbft/crypto/encoding"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

type validatorRegistryFixture struct {
	migration chain.ConsensusMigrationState
	raw       []byte
	pins      ConsensusBootstrapPins
	bootstrap *ConsensusBootstrap
	legacy    map[string]ed25519.PrivateKey
	doc       *cmttypes.GenesisDoc
}

func newValidatorRegistryFixture(t *testing.T) *validatorRegistryFixture {
	t.Helper()
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	d.ProduceBlock()
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	f := &validatorRegistryFixture{legacy: make(map[string]ed25519.PrivateKey)}
	var bindings []chain.ConsensusValidatorKeyBinding
	for i, member := range migration.Validators {
		key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(i + 71)}, ed25519.SeedSize))
		public := key.Public().(ed25519.PublicKey)
		address := sha256.Sum256(public)
		f.legacy[string(address[:20])] = key
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: member.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(public), ConsensusAddress: strings.ToUpper(hex.EncodeToString(address[:20]))})
	}
	f.migration, err = migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	f.doc, err = BuildCometGenesis(f.migration, time.Date(2026, 10, 18, 1, 2, 3, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	f.raw, err = cmtjson.Marshal(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(f.raw)
	f.pins = ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(sum[:]), OriginalGenesisHash: f.migration.OriginalGenesisHash, MigrationStateHash: f.migration.StateHash}
	f.bootstrap, err = NewConsensusBootstrap(f.raw, f.pins, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	if len(f.bootstrap.record.Members) < 2 {
		t.Fatal("fixture requires two actual active validators")
	}
	return f
}

func (f *validatorRegistryFixture) initRequest(t *testing.T) *abci.RequestInitChain {
	t.Helper()
	params := f.doc.ConsensusParams.ToProto()
	req := &abci.RequestInitChain{Time: f.doc.GenesisTime, ChainId: f.doc.ChainID, InitialHeight: f.doc.InitialHeight, ConsensusParams: &params, AppStateBytes: bytes.Clone(f.doc.AppState)}
	for _, v := range f.doc.Validators {
		key, err := cryptoenc.PubKeyToProto(v.PubKey)
		if err != nil {
			t.Fatal(err)
		}
		req.Validators = append(req.Validators, abci.ValidatorUpdate{PubKey: key, Power: v.Power})
	}
	return req
}

func (f *validatorRegistryFixture) transaction(t *testing.T, memberIndex int, height int64) ([]byte, []byte) {
	t.Helper()
	member := f.bootstrap.record.Members[memberIndex]
	pa, a, err := mldsa87.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pb, b, err := slhdsa.GenerateKey(rand.Reader, slhdsa.SHA2_256f)
	if err != nil {
		t.Fatal(err)
	}
	pbBytes, err := pb.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	intent := ynxconsensusauth.RegistrationIntent{Kind: ynxconsensusauth.RegisterValidator, GenesisID: bytes.Clone(f.bootstrap.genesisID), ChainID: f.doc.ChainID, ValidatorAddress: bytes.Clone(member.Address), Sequence: 1, Epoch: 1, ApprovedAt: height, EffectiveAt: height + 2, PreviousEventHash: make([]byte, 32), LegacyEd25519PublicKey: bytes.Clone(member.Ed25519), MLDSA87PublicKey: pa.Bytes(), SLHDSASHA2256fPublicKey: pbBytes}
	authority, err := intent.AuthoritySigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	pop, err := intent.PossessionSigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	proofA := make([]byte, ynxconsensusauth.MLDSA87SignatureSize)
	if err := mldsa87.SignTo(a, pop, nil, false, proofA); err != nil {
		t.Fatal(err)
	}
	proofB, err := slhdsa.SignRandomized(&b, rand.Reader, slhdsa.NewMessage(pop), nil)
	if err != nil {
		t.Fatal(err)
	}
	reg := ynxconsensusauth.Registration{Intent: intent, LegacyApproval: ed25519.Sign(f.legacy[string(member.Address)], authority), PossessionMLDSA87: proofA, PossessionSLHDSASHA2256f: proofB}
	wire, err := reg.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	payload, err := EncodeValidatorRegistryTransaction(wire)
	if err != nil {
		t.Fatal(err)
	}
	return payload, wire
}

func newPinnedRegistryApp(t *testing.T, f *validatorRegistryFixture, path string) *Application {
	t.Helper()
	app, err := NewPersistentApplicationWithBootstrap(f.migration, path, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.InitChain(context.Background(), f.initRequest(t)); err != nil {
		t.Fatal(err)
	}
	return app
}

func TestConsensusBootstrapPinsAndFullInitChain(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	app := newPinnedRegistryApp(t, f, "")
	before := app.committed.AppHash
	for name, mutate := range map[string]func(*abci.RequestInitChain){
		"power":     func(r *abci.RequestInitChain) { r.Validators[0].Power++ },
		"duplicate": func(r *abci.RequestInitChain) { r.Validators[1] = r.Validators[0] },
		"missing":   func(r *abci.RequestInitChain) { r.Validators = r.Validators[:1] },
		"chain":     func(r *abci.RequestInitChain) { r.ChainId = "other" },
		"height":    func(r *abci.RequestInitChain) { r.InitialHeight++ },
		"time":      func(r *abci.RequestInitChain) { r.Time = r.Time.Add(time.Second) },
		"params":    func(r *abci.RequestInitChain) { r.ConsensusParams.Block.MaxGas++ },
		"AppState":  func(r *abci.RequestInitChain) { r.AppStateBytes = []byte("{}") },
	} {
		t.Run(name, func(t *testing.T) {
			req := f.initRequest(t)
			mutate(req)
			if _, err := app.InitChain(context.Background(), req); err == nil {
				t.Fatal("substituted InitChain accepted")
			}
			if app.committed.AppHash != before || app.committed.ValidatorRegistry != nil {
				t.Fatal("InitChain changed old application hash or initialized registry")
			}
		})
	}
	for name, pins := range map[string]ConsensusBootstrapPins{
		"raw genesis":    {CometGenesisSHA256: strings.Repeat("01", 32), OriginalGenesisHash: f.pins.OriginalGenesisHash, MigrationStateHash: f.pins.MigrationStateHash},
		"native genesis": {CometGenesisSHA256: f.pins.CometGenesisSHA256, OriginalGenesisHash: strings.Repeat("02", 32), MigrationStateHash: f.pins.MigrationStateHash},
		"migration":      {CometGenesisSHA256: f.pins.CometGenesisSHA256, OriginalGenesisHash: f.pins.OriginalGenesisHash, MigrationStateHash: strings.Repeat("03", 32)},
		"missing":        {},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := NewConsensusBootstrap(f.raw, pins, f.migration); err == nil {
				t.Fatal("wrong independent pin accepted")
			}
		})
	}
	if _, err := NewConsensusBootstrap(append(bytes.Clone(f.raw), '\n'), f.pins, f.migration); err == nil {
		t.Fatal("raw genesis normalization erased exact byte pin")
	}
	for _, mutation := range []string{"power", "duplicate", "AppHash", "AppState"} {
		var altered cmttypes.GenesisDoc
		if err := cmtjson.Unmarshal(f.raw, &altered); err != nil {
			t.Fatal(err)
		}
		switch mutation {
		case "power":
			altered.Validators[0].Power++
		case "duplicate":
			altered.Validators[1] = altered.Validators[0]
		case "AppHash":
			altered.AppHash[0] ^= 1
		case "AppState":
			altered.AppState = json.RawMessage("{}")
		}
		raw, _ := cmtjson.Marshal(altered)
		hash := sha256.Sum256(raw)
		pins := f.pins
		pins.CometGenesisSHA256 = hex.EncodeToString(hash[:])
		if _, err := NewConsensusBootstrap(raw, pins, f.migration); err == nil {
			t.Fatalf("raw pin bypassed %s cross-check with independent native/migration pins", mutation)
		}
	}
	member := f.bootstrap.record.Members[0]
	for _, hash := range [][]byte{nil, bytes.Repeat([]byte{0x91}, 32)} {
		if _, err := app.PrepareProposal(context.Background(), &abci.RequestPrepareProposal{Height: f.doc.InitialHeight, NextValidatorsHash: hash}); err == nil {
			t.Fatal("PrepareProposal accepted missing/changed future membership")
		}
		response, err := app.ProcessProposal(context.Background(), &abci.RequestProcessProposal{Height: f.doc.InitialHeight, NextValidatorsHash: hash})
		if err != nil || response.Status != abci.ResponseProcessProposal_REJECT {
			t.Fatal("ProcessProposal accepted missing/changed future membership")
		}
		if _, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: f.doc.InitialHeight, NextValidatorsHash: hash}); err == nil {
			t.Fatal("FinalizeBlock accepted missing/changed future membership")
		}
		if app.pending != nil || app.committed.AppHash != before {
			t.Fatal("future membership rejection mutated application")
		}
	}
	source := f.bootstrap.membershipAt(f.doc.InitialHeight)
	if _, err := source.ConsensusRegistrationStateAt(f.bootstrap.genesisID, f.doc.ChainID, member.Address, f.doc.InitialHeight-1); err == nil {
		t.Fatal("membership before initial Comet height accepted")
	}
	if _, err := source.ConsensusRegistrationStateAt(f.bootstrap.genesisID, f.doc.ChainID, member.Address, f.doc.InitialHeight+1); err == nil {
		t.Fatal("membership beyond detached execution bound accepted")
	}
	view, err := source.ConsensusRegistrationStateAt(f.bootstrap.genesisID, f.doc.ChainID, member.Address, f.doc.InitialHeight)
	if err != nil {
		t.Fatal(err)
	}
	view.LegacyEd25519PublicKey[0] ^= 1
	if !reflect.DeepEqual(f.bootstrap.record.Members[0], member) {
		t.Fatal("detached source mutated immutable bootstrap")
	}
	// Supplying a Bootstrap must not rewrite an already committed old hash.
	path := filepath.Join(t.TempDir(), "state.json")
	legacy, err := NewPersistentApplication(f.migration, path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: f.doc.InitialHeight}); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewPersistentApplicationWithBootstrap(f.migration, path, f.bootstrap)
	if err != nil || reopened.committed.AppHash != legacy.committed.AppHash || reopened.committed.Version != legacy.committed.Version || reopened.committed.ValidatorRegistry != nil {
		t.Fatalf("bootstrap silently changed old committed hash: %v", err)
	}
	for _, version := range []int{14, 15} {
		copy := legacy.committed
		copy.Version = version
		copy.bootstrap = nil
		oldHash, err := copy.calculateHash()
		if err != nil {
			t.Fatal(err)
		}
		copy.bootstrap = f.bootstrap
		hash, err := copy.calculateHash()
		if err != nil || hash != oldHash {
			t.Fatal("private bootstrap entered legacy hash domain")
		}
	}
}
