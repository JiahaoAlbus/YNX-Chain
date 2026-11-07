package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
)

type pqWalletPolicyFixture struct {
	*abciRevocationFixture
	registry *validatorRegistryFixture
	layout   string
	auth     *PQEngineAuthorization
}

func newPQWalletPolicyFixture(t *testing.T, layout string, registry bool) *pqWalletPolicyFixture {
	t.Helper()
	f := &pqWalletPolicyFixture{abciRevocationFixture: newABCIRevocationFixture(t), layout: layout}
	v := &validatorRegistryFixture{legacy: make(map[string]ed25519.PrivateKey)}
	var bindings []chain.ConsensusValidatorKeyBinding
	for i, member := range f.m.Validators {
		key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(i + 111)}, ed25519.SeedSize))
		public := key.Public().(ed25519.PublicKey)
		address := sha256.Sum256(public)
		v.legacy[string(address[:20])] = key
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: member.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(public), ConsensusAddress: strings.ToUpper(hex.EncodeToString(address[:20]))})
	}
	var err error
	f.m, err = f.m.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	v.migration = f.m
	v.doc, err = BuildCometGenesis(f.m, time.Date(2026, 10, 18, 1, 2, 3, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	v.raw, err = cmtjson.Marshal(v.doc)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(v.raw)
	v.pins = ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(sum[:]), OriginalGenesisHash: f.m.OriginalGenesisHash, MigrationStateHash: f.m.StateHash}
	v.bootstrap, err = NewConsensusBootstrap(v.raw, v.pins, f.m)
	if err != nil {
		t.Fatal(err)
	}
	f.registry = v
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	f.path = filepath.Join(dir, "state")
	f.open(t)
	if _, err = f.a.InitChain(context.Background(), v.initRequest(t)); err != nil {
		t.Fatal(err)
	}
	var txs [][]byte
	if registry {
		for i := range v.bootstrap.record.Members {
			_, wire := engineRegistration(t, v, i, 2)
			raw, err := EncodeValidatorRegistryTransaction(wire)
			if err != nil {
				t.Fatal(err)
			}
			txs = append(txs, raw)
		}
	}
	txs = append(txs, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	f.commit(t, txs...)
	if registry {
		schedule, err := NewPQEngineSchedule(v.bootstrap, f.a.committed.ValidatorRegistry, 2, 6)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(schedule)
		hash, err := schedule.Hash()
		if err != nil {
			t.Fatal(err)
		}
		f.auth, err = NewPQEngineAuthorization(raw, hash)
		if err != nil {
			t.Fatal(err)
		}
		f.open(t)
	}
	return f
}

func (f *pqWalletPolicyFixture) open(t *testing.T) {
	t.Helper()
	var err error
	if f.auth == nil {
		switch f.layout {
		case "snapshot-journal":
			f.a, err = NewJournaledApplicationWithBootstrap(f.m, f.path, f.registry.bootstrap)
		case "block-journal":
			f.a, err = NewBlockJournaledApplicationWithBootstrap(f.m, f.path, f.registry.bootstrap)
		default:
			f.a, err = NewPersistentApplicationWithBootstrap(f.m, f.path, f.registry.bootstrap)
		}
		if err != nil {
			t.Fatal(err)
		}
		return
	}
	switch f.layout {
	case "snapshot-journal":
		f.a, err = NewJournaledApplicationWithEngineAuthorization(f.m, f.path, f.registry.bootstrap, f.auth)
	case "block-journal":
		f.a, err = NewBlockJournaledApplicationWithEngineAuthorization(f.m, f.path, f.registry.bootstrap, f.auth)
	default:
		f.a, err = NewPersistentApplicationWithEngineAuthorization(f.m, f.path, f.registry.bootstrap, f.auth)
	}
	if err != nil {
		t.Fatal(err)
	}
}

func (f *pqWalletPolicyFixture) commit(t *testing.T, txs ...[]byte) {
	t.Helper()
	h := f.a.committed.Height + 1
	snapshot, err := f.a.CommittedPQEngineSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	next, err := snapshot.ExpectedValidatorHash(h + 1)
	if err != nil {
		t.Fatal(err)
	}
	r, err := f.a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h, Time: f.registry.doc.GenesisTime.Add(time.Duration(h) * time.Second), NextValidatorsHash: next, Txs: txs})
	if err != nil {
		t.Fatal(err)
	}
	for _, tx := range r.TxResults {
		if tx.Code != 0 {
			t.Fatal("actual account/registry transaction rejected", tx.Code, tx.Log)
		}
	}
	if _, err = f.a.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
}

func (f *pqWalletPolicyFixture) request(t *testing.T) PQWalletPolicyReadRequest {
	t.Helper()
	hash, err := hex.DecodeString(f.a.committed.AppHash)
	if err != nil || len(hash) != 32 {
		t.Fatal(err)
	}
	cp := PQWalletPolicyCheckpoint{ChainID: f.registry.doc.ChainID, Height: f.a.committed.Height}
	copy(cp.AppHash[:], hash)
	return PQWalletPolicyReadRequest{Migration: f.m, StatePath: f.path, Bootstrap: f.registry.bootstrap, EngineAuthorization: f.auth, Checkpoint: cp, Owner: f.owner}
}

func (f *pqWalletPolicyFixture) read(t *testing.T) *PQWalletPolicyAtCheckpoint {
	t.Helper()
	before := pqReadInventory(t, f.path)
	r, err := ReadPQWalletPolicyAtCheckpoint(f.request(t))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, pqReadInventory(t, f.path)) {
		t.Fatal("policy read wrote/repaired original data or locks")
	}
	v, err := r.OwnerPolicy()
	if err != nil {
		t.Fatal(err)
	}
	want := walletAccountQuery(t, f.a, f.owner)
	raw, err := ynxauth.EncodeWalletPolicyProjection(*want.Policy, f.owner)
	if err != nil || !bytes.Equal(raw, v.PolicyOriginal) || v.LedgerNonce != want.LedgerNonce || v.AuthorizationStatus != want.AuthorizationStatus || v.CommittedAuthorizationStatus != want.CommittedAuthorizationStatus {
		t.Fatal("sealed projection differs from actual same checkpoint query", err)
	}
	return r
}

func TestPQWalletPolicyCheckpointRegisteredHistoryAcrossLayouts(t *testing.T) {
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			f := newPQWalletPolicyFixture(t, layout, true)
			initial := f.read(t)
			v, _ := initial.OwnerPolicy()
			if v.CommittedRegistration != nil || v.ExecutionRegistration == nil || v.ExecutionRegistration.Revision != 1 || !bytes.Equal(v.ExecutionRegistration.PKA, f.public.PKA) || !bytes.Equal(v.ExecutionRegistration.PKB, f.public.PKB) || v.ExecutionHeight != 3 || v.LedgerNonce != 1 {
				t.Fatal("pending/active first registration or full pair incorrect")
			}
			if layout == "atomic-json" {
				exportPQWalletPolicyFixture(t, f, "registered")
			}
			v.PolicyOriginal[0] ^= 1
			v.ExecutionRegistration.PKA[0] ^= 1
			v.NetworkID[0] ^= 1
			fresh, _ := initial.OwnerPolicy()
			if !bytes.Equal(fresh.ExecutionRegistration.PKA, f.public.PKA) || fresh.PolicyOriginal[0] != '{' {
				t.Fatal("mutable accessor changed sealed result")
			}
			key, pub, err := ynxbatch.KeyGen()
			if err != nil {
				t.Fatal(err)
			}
			defer key.Destroy()
			wire := abciRegistrationWire(t, nil, f.key, key, ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: pub.PKA, PKB: pub.PKB, PriorRevision: 1, NewRevision: 2, LedgerNonce: 2, ActivateAt: 5})
			f.commit(t, mustPQEnvelope(t, PQMigrationType, wire))
			v, _ = f.read(t).OwnerPolicy()
			if v.ExecutionRegistration.Revision != 1 {
				t.Fatal("pending rotation was prematurely active")
			}
			f.commit(t)
			v, _ = f.read(t).OwnerPolicy()
			if v.CommittedRegistration.Revision != 1 || v.ExecutionRegistration.Revision != 2 || !bytes.Equal(v.ExecutionRegistration.PKB, pub.PKB) {
				t.Fatal("rotation next-height boundary or complete pair lost")
			}
			f.commit(t)
			f.open(t)
			v, _ = f.read(t).OwnerPolicy()
			if v.CommittedRegistration.Revision != 2 || v.ExecutionRegistration.Revision != 2 {
				t.Fatal("cold rotation changed epoch")
			}
			if layout == "atomic-json" {
				exportPQWalletPolicyFixture(t, f, "rotated")
			}
			intent := ynxauth.RevocationIntent{ChainID: f.network, Owner: f.owner, PKA: pub.PKA, PKB: pub.PKB, AuthorizingRevision: 2, ThroughRevision: 2, LedgerNonce: 3, ExecuteAt: 6, RevokeAt: 7}
			message, err := intent.SigningBytes()
			if err != nil {
				t.Fatal(err)
			}
			_, proof := consensusPQProof(t, key, f.network, f.owner, ynxauth.RevocationPurpose, message)
			revoke, err := (ynxauth.Revocation{Intent: intent, CurrentPQProof: proof}).Encode()
			if err != nil {
				t.Fatal(err)
			}
			f.commit(t, mustPQEnvelope(t, PQRevocationType, revoke))
			v, _ = f.read(t).OwnerPolicy()
			if v.CommittedRegistration == nil || v.ExecutionRegistration != nil || v.PQSigningEnabled || v.AuthorizationStatus != "revoked" || v.CommittedAuthorizationStatus != "revocation_pending" {
				t.Fatal("terminal revoke granted next execution authority")
			}
			if layout == "atomic-json" {
				exportPQWalletPolicyFixture(t, f, "revoked")
			}
			f.commit(t)
			f.open(t)
			v, _ = f.read(t).OwnerPolicy()
			if v.CommittedRegistration != nil || v.ExecutionRegistration != nil || v.CommittedPQSigningEnabled {
				t.Fatal("cold tombstone restored authority")
			}
			old, _ := initial.OwnerPolicy()
			if old.ExecutionRegistration.Revision != 1 || old.CommittedHeight != 2 {
				t.Fatal("historical sealed result was silently renewed")
			}
		})
	}
}

func TestPQWalletPolicyCheckpointRefusesWrongAnchorAndAuthority(t *testing.T) {
	f := newPQWalletPolicyFixture(t, "atomic-json", false)
	original := f.request(t)
	for name, change := range map[string]func(*PQWalletPolicyReadRequest){
		"nil-bootstrap":      func(r *PQWalletPolicyReadRequest) { r.Bootstrap = nil },
		"wrong-chain":        func(r *PQWalletPolicyReadRequest) { r.Checkpoint.ChainID += "x" },
		"wrong-height":       func(r *PQWalletPolicyReadRequest) { r.Checkpoint.Height++ },
		"wrong-hash":         func(r *PQWalletPolicyReadRequest) { r.Checkpoint.AppHash[0] ^= 1 },
		"zero-hash":          func(r *PQWalletPolicyReadRequest) { r.Checkpoint.AppHash = [32]byte{} },
		"wrong-owner":        func(r *PQWalletPolicyReadRequest) { r.Owner = f.other },
		"noncanonical-owner": func(r *PQWalletPolicyReadRequest) { r.Owner = strings.ToUpper(r.Owner) },
		"wrong-migration":    func(r *PQWalletPolicyReadRequest) { r.Migration.StateHash = strings.Repeat("1", 64) },
	} {
		t.Run(name, func(t *testing.T) {
			r := original
			change(&r)
			if got, err := ReadPQWalletPolicyAtCheckpoint(r); err == nil || got != nil {
				t.Fatal("untrusted/mismatched input gained sealed policy")
			}
		})
	}
	for _, r := range []*PQWalletPolicyAtCheckpoint{nil, {}} {
		if _, err := r.Origin(); err == nil {
			t.Fatal("zero result supplied an origin")
		}
		if _, err := r.Checkpoint(); err == nil {
			t.Fatal("zero result accepted")
		}
		if _, err := r.OwnerPolicy(); err == nil {
			t.Fatal("zero result accepted")
		}
	}
	alias := filepath.Join(filepath.Dir(f.path), "alias")
	if err := os.Symlink(f.path, alias); err != nil {
		t.Fatal(err)
	}
	r := original
	r.StatePath = alias
	if got, err := ReadPQWalletPolicyAtCheckpoint(r); err == nil || got != nil {
		t.Fatal("file alias accepted")
	}
	dirAlias := filepath.Join(t.TempDir(), "dir-alias")
	if err := os.Symlink(filepath.Dir(f.path), dirAlias); err != nil {
		t.Fatal(err)
	}
	r = original
	r.StatePath = filepath.Join(dirAlias, "state")
	if got, err := ReadPQWalletPolicyAtCheckpoint(r); err == nil || got != nil {
		t.Fatal("parent alias accepted")
	}
	// Independent AppHash alone does not excuse a self-rehashed forged pair:
	// full original migration proof/history must still authenticate it.
	raw, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	var altered CommittedState
	if err = json.Unmarshal(raw, &altered); err != nil {
		t.Fatal(err)
	}
	altered.AccountPolicy.Records[0].PKA[0] ^= 1
	altered.AppHash, err = altered.calculateHash()
	if err != nil {
		t.Fatal(err)
	}
	changed, _ := json.Marshal(altered)
	if err = os.WriteFile(f.path, changed, 0600); err != nil {
		t.Fatal(err)
	}
	r = original
	hash, _ := hex.DecodeString(altered.AppHash)
	copy(r.Checkpoint.AppHash[:], hash)
	if got, err := ReadPQWalletPolicyAtCheckpoint(r); err == nil || got != nil {
		t.Fatal("self-rehashed unregistered full pair accepted")
	}
	if err = os.WriteFile(f.path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	f.commit(t)
	if got, err := ReadPQWalletPolicyAtCheckpoint(original); err == nil || got != nil {
		t.Fatal("stale checkpoint silently became current")
	}
}

func TestPQWalletPolicyCheckpointHeldSourceChangeAndClose(t *testing.T) {
	f := newPQWalletPolicyFixture(t, "atomic-json", false)
	req := f.request(t)
	baseline, err := ReadPQWalletPolicyAtCheckpoint(req)
	if err != nil {
		t.Fatal(err)
	}
	origin, err := baseline.Origin()
	if err != nil || origin != PQWalletPolicyIndependentCheckpointInput {
		t.Fatal("direct checkpoint input falsely attested a light or local engine origin", origin, err)
	}
	closeFailure := errors.New("original close failure")
	changeFailure := errors.New("original source changed")
	for _, mode := range []string{"final-change", "close", "validation-and-close"} {
		t.Run(mode, func(t *testing.T) {
			checks, closes := 0, 0
			got, err := readPQWalletPolicyAtCheckpoint(req, func(path string) (*pqEngineStateRead, error) {
				r, err := capturePQEngineState(path)
				if err != nil {
					return nil, err
				}
				r.checkOriginal = func() error {
					checks++
					if mode == "final-change" && checks == 2 {
						return changeFailure
					}
					return nil
				}
				r.closeOriginal = func() error {
					closes++
					if mode != "final-change" {
						return closeFailure
					}
					return nil
				}
				if mode == "validation-and-close" {
					r.data = []byte(`{"invalid":true}`)
				}
				return r, nil
			})
			if got != nil || err == nil || closes != 1 {
				t.Fatal("change/Close published usable policy or did not close once", err, closes)
			}
			if mode == "final-change" && (!errors.Is(err, changeFailure) || checks != 2) {
				t.Fatal("missing final original check", err, checks)
			}
			if mode != "final-change" && !errors.Is(err, closeFailure) {
				t.Fatal("original Close error lost", err)
			}
		})
	}
	t.Run("actual-replacement-after-projection", func(t *testing.T) {
		raw, err := os.ReadFile(f.path)
		if err != nil {
			t.Fatal(err)
		}
		dir, err := filepath.EvalSymlinks(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		copyPath, replacement := filepath.Join(dir, "original"), filepath.Join(dir, "replacement")
		for _, path := range []string{copyPath, replacement} {
			if err = os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
		}
		request := req
		request.StatePath = copyPath
		checks := 0
		got, err := readPQWalletPolicyAtCheckpoint(request, func(path string) (*pqEngineStateRead, error) {
			r, err := capturePQEngineState(path)
			if err != nil {
				return nil, err
			}
			original := *r
			r.checkOriginal = func() error {
				checks++
				if checks == 2 {
					if err := os.Rename(replacement, path); err != nil {
						return err
					}
				}
				return original.unchanged()
			}
			return r, nil
		})
		if got != nil || err == nil || !strings.Contains(err.Error(), "committed source changed") || checks != 2 {
			t.Fatal("byte-identical original inode replacement published usable policy", err, checks)
		}
	})
}

func TestPQWalletPolicyCheckpointRuntimeAndSchedulePins(t *testing.T) {
	f := newPQWalletPolicyFixture(t, "atomic-json", true)
	f.commit(t) // Actual P commits the independently selected schedule.
	r := f.request(t)
	r.EngineAuthorization = nil
	if got, err := ReadPQWalletPolicyAtCheckpoint(r); err == nil || got != nil {
		t.Fatal("persisted schedule supplied its own authorization")
	}
	wrong := clonePQEngineSchedule(f.auth.schedule)
	wrong.ActivationHeight++
	wrong.ValidatorUpdateHeight++
	raw, err := json.Marshal(wrong)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := wrong.Hash()
	if err != nil {
		t.Fatal(err)
	}
	r.EngineAuthorization, err = NewPQEngineAuthorization(raw, hash)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := ReadPQWalletPolicyAtCheckpoint(r); err == nil || got != nil {
		t.Fatal("different independent schedule accepted")
	}
	// Construct a genuinely pinned historical genesis profile, not a mutated
	// private Bootstrap object. Its missing independent runtime plan must be
	// rejected before a current-domain state can be interpreted as historical.
	doc, err := BuildCometGenesis(f.m, f.registry.doc.GenesisTime)
	if err != nil {
		t.Fatal(err)
	}
	doc.ConsensusParams.Version.App = 18
	raw, err = cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	pins := f.registry.pins
	pins.CometGenesisSHA256 = hex.EncodeToString(sum[:])
	r = f.request(t)
	r.Bootstrap, err = NewConsensusBootstrap(raw, pins, f.m)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := ReadPQWalletPolicyAtCheckpoint(r); got != nil || err == nil || !strings.Contains(err.Error(), "independent runtime upgrade authorization") {
		t.Fatal("historical runtime did not fail closed at independent plan boundary", err)
	}
}

// Optional producer for the sibling normal Go consumer: public synthetic
// inputs only. No signer, seed, private key, HRS or credential is exported.
// Each path is exclusive and failure preserves every already written byte.
func exportPQWalletPolicyFixture(t *testing.T, f *pqWalletPolicyFixture, stage string) {
	t.Helper()
	root := os.Getenv("YNX_PQ_WALLET_POLICY_PUBLIC_FIXTURE_OUT")
	if root == "" {
		return
	}
	if !filepath.IsAbs(root) || filepath.Clean(root) != root {
		t.Fatal("public fixture root must be absolute")
	}
	if stage == "registered" {
		if err := os.Mkdir(root, 0700); err != nil {
			t.Fatal(err)
		}
	}
	dir := filepath.Join(root, stage)
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	state, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	migration, err := f.m.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	schedule, err := json.Marshal(f.auth.schedule)
	if err != nil {
		t.Fatal(err)
	}
	metadata, err := json.Marshal(struct {
		SyntheticOnly bool
		Pins          ConsensusBootstrapPins
		ScheduleHash  string
		Checkpoint    PQWalletPolicyCheckpoint
		Owner         string
	}{true, f.registry.pins, f.auth.hash, f.request(t).Checkpoint, f.owner})
	if err != nil {
		t.Fatal(err)
	}
	for name, raw := range map[string][]byte{"migration.json": migration, "genesis.json": f.registry.raw, "schedule.json": schedule, "state.json": state, "inputs.json": metadata} {
		out, err := os.OpenFile(filepath.Join(dir, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			t.Fatal(err)
		}
		_, writeErr := out.Write(raw)
		if err = errors.Join(writeErr, out.Sync(), out.Close()); err != nil {
			t.Fatal(err)
		}
	}
}
