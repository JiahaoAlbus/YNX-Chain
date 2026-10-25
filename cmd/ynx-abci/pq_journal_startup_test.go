//go:build unix

package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	abci "github.com/cometbft/cometbft/abci/types"
	cryptoenc "github.com/cometbft/cometbft/crypto/encoding"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

type pqJournalStartupFixture struct {
	migration                         chain.ConsensusMigrationState
	doc                               *cmttypes.GenesisDoc
	bootstrap                         *consensus.ConsensusBootstrap
	pins                              consensus.ConsensusBootstrapPins
	migrationPath, genesisPath, owner string
	registrations                     [][]byte
	transfer                          []byte
	validatorHash                     []byte
}

func newPQJournalStartupFixture(t *testing.T) *pqJournalStartupFixture {
	t.Helper()
	key := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{61}, 32))
	defer key.Zero()
	owner, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	recipientKey := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{62}, 32))
	defer recipientKey.Zero()
	recipient, err := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err = d.Faucet(owner, 1000); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	m, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	legacy := map[string]ed25519.PrivateKey{}
	var bindings []chain.ConsensusValidatorKeyBinding
	for i, member := range m.Validators {
		private := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(i + 71)}, ed25519.SeedSize))
		public := private.Public().(ed25519.PublicKey)
		hash := sha256.Sum256(public)
		address := strings.ToUpper(hex.EncodeToString(hash[:20]))
		legacy[address] = private
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: member.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(public), ConsensusAddress: address})
	}
	defer func() {
		for _, private := range legacy {
			clear(private)
		}
	}()
	m, err = m.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := consensus.BuildCometGenesis(m, time.Date(2026, 10, 18, 1, 2, 3, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	f := &pqJournalStartupFixture{migration: m, doc: doc, owner: owner, pins: consensus.ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(sum[:]), OriginalGenesisHash: m.OriginalGenesisHash, MigrationStateHash: m.StateHash}}
	f.bootstrap, err = consensus.NewConsensusBootstrap(raw, f.pins, m)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	f.migrationPath, f.genesisPath = filepath.Join(dir, "migration.json"), filepath.Join(dir, "genesis.json")
	canonical, err := m.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(f.migrationPath, canonical, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(f.genesisPath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	var validators []*cmttypes.Validator
	for _, member := range doc.Validators {
		validators = append(validators, cmttypes.NewValidator(member.PubKey, member.Power))
		candidate, pka, pkb, err := ynxconsensusauth.GenerateCandidateKey()
		if err != nil {
			t.Fatal(err)
		}
		intent := ynxconsensusauth.RegistrationIntent{Kind: ynxconsensusauth.RegisterValidator, GenesisID: bytes.Clone(sum[:]), ChainID: doc.ChainID, ValidatorAddress: bytes.Clone(member.Address), Sequence: 1, Epoch: 1, ApprovedAt: doc.InitialHeight, EffectiveAt: doc.InitialHeight + 2, PreviousEventHash: make([]byte, 32), LegacyEd25519PublicKey: bytes.Clone(member.PubKey.Bytes()), MLDSA87PublicKey: pka, SLHDSASHA2256fPublicKey: pkb}
		a, b, err := candidate.RegistrationPossession(intent)
		candidate.Destroy()
		if err != nil {
			t.Fatal(err)
		}
		authority, err := intent.AuthoritySigningBytes()
		if err != nil {
			t.Fatal(err)
		}
		wire, err := (ynxconsensusauth.Registration{Intent: intent, LegacyApproval: ed25519.Sign(legacy[strings.ToUpper(hex.EncodeToString(member.Address))], authority), PossessionMLDSA87: a, PossessionSLHDSASHA2256f: b}).MarshalBinary()
		if err != nil {
			t.Fatal(err)
		}
		tx, err := consensus.EncodeValidatorRegistryTransaction(wire)
		if err != nil {
			t.Fatal(err)
		}
		f.registrations = append(f.registrations, tx)
	}
	f.validatorHash = cmttypes.NewValidatorSet(validators).Hash()
	tx, err := consensus.NewSignedTransfer(key, m.Network.ChainID, recipient, 7, 1)
	if err != nil {
		t.Fatal(err)
	}
	f.transfer, err = consensus.EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *pqJournalStartupFixture) init(t *testing.T, a *consensus.Application) {
	t.Helper()
	params := f.doc.ConsensusParams.ToProto()
	req := &abci.RequestInitChain{Time: f.doc.GenesisTime, ChainId: f.doc.ChainID, InitialHeight: f.doc.InitialHeight, ConsensusParams: &params, AppStateBytes: f.doc.AppState}
	for _, v := range f.doc.Validators {
		key, err := cryptoenc.PubKeyToProto(v.PubKey)
		if err != nil {
			t.Fatal(err)
		}
		req.Validators = append(req.Validators, abci.ValidatorUpdate{PubKey: key, Power: v.Power})
	}
	if _, err := a.InitChain(context.Background(), req); err != nil {
		t.Fatal(err)
	}
}

func TestPQJournalNormalStartupRealExecutionScheduleAndColdRecovery(t *testing.T) {
	f := newPQJournalStartupFixture(t)
	for _, layout := range []string{"snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "original.state")
			a, lease, _, err := prepareApplication(f.migrationPath, path, layout, f.genesisPath, f.pins, "", "")
			if err != nil {
				t.Fatal("normal pinned journal startup refused", err)
			}
			defer func() {
				if lease != nil {
					_ = lease.Close()
				}
			}()
			f.init(t, a)
			txs := append(append([][]byte{}, f.registrations...), f.transfer, f.transfer)
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			result, err := a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: f.doc.InitialHeight, Time: f.doc.GenesisTime.Add(time.Second), NextValidatorsHash: f.validatorHash, Txs: txs})
			if err != nil || len(result.TxResults) != len(txs) {
				t.Fatal("normal startup execution failed", err)
			}
			for _, tx := range result.TxResults[:len(txs)-1] {
				if tx.Code != 0 {
					t.Fatal(tx.Log)
				}
			}
			if result.TxResults[len(txs)-1].Code != consensus.CodeInvalidNonce {
				t.Fatal("duplicate native nonce accepted")
			}
			pendingBytes, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, pendingBytes) {
				t.Fatal("pending execution rewrote durable source", err)
			}
			if _, err = a.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			registryResponse, err := a.Query(context.Background(), &abci.RequestQuery{Path: "/validator-registry"})
			if err != nil || registryResponse.Code != 0 {
				t.Fatal(err)
			}
			var registry consensus.ValidatorRegistryState
			if err = json.Unmarshal(registryResponse.Value, &registry); err != nil {
				t.Fatal(err)
			}
			if len(registry.Events) != len(f.registrations) {
				t.Fatal("full registry history missing")
			}
			schedule, err := consensus.NewPQEngineSchedule(f.bootstrap, &registry, f.doc.InitialHeight, f.doc.InitialHeight+4)
			if err != nil {
				t.Fatal(err)
			}
			raw, err := json.Marshal(schedule)
			if err != nil {
				t.Fatal(err)
			}
			pin, err := schedule.Hash()
			if err != nil {
				t.Fatal(err)
			}
			schedulePath := filepath.Join(t.TempDir(), "operator-schedule.json")
			if err = os.WriteFile(schedulePath, raw, 0600); err != nil {
				t.Fatal(err)
			}
			if err = lease.Close(); err != nil {
				t.Fatal(err)
			}
			lease = nil
			a, lease, _, err = prepareApplication(f.migrationPath, path, layout, f.genesisPath, f.pins, schedulePath, pin)
			if err != nil {
				t.Fatal("normal startup did not reattach independently pinned schedule", err)
			}
			for h := schedule.AuthorizedAt; h <= schedule.ActivationHeight+1; h++ {
				snapshot, err := a.CommittedPQEngineSnapshot()
				if err != nil {
					t.Fatal(err)
				}
				next, err := snapshot.ExpectedValidatorHash(h + 1)
				if err != nil {
					t.Fatal(err)
				}
				result, err = a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h, NextValidatorsHash: next})
				if err != nil {
					t.Fatal(err)
				}
				if _, err = a.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
					t.Fatal(err)
				}
				if err = lease.Close(); err != nil {
					t.Fatal(err)
				}
				lease = nil
				a, lease, _, err = prepareApplication(f.migrationPath, path, layout, f.genesisPath, f.pins, schedulePath, pin)
				if err != nil {
					t.Fatal("same original journal failed cold continuation", err)
				}
				info, err := a.Info(context.Background(), &abci.RequestInfo{})
				if err != nil || info.LastBlockHeight != h || !bytes.Equal(info.LastBlockAppHash, result.AppHash) {
					t.Fatal("cold restart changed original H/AppHash", err)
				}
			}
			response, err := a.Query(context.Background(), &abci.RequestQuery{Path: "/accounts/" + f.owner})
			if err != nil || response.Code != 0 {
				t.Fatal(err)
			}
			var account chain.Account
			if err = json.Unmarshal(response.Value, &account); err != nil {
				t.Fatal(err)
			}
			if account.Nonce != 1 || account.Balance != 992 {
				t.Fatal("cold journal lost actual value, fee or nonce", account.Nonce, account.Balance)
			}
			if err = lease.Close(); err != nil {
				t.Fatal(err)
			}
			lease = nil
			original, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if bad, badLease, _, err := prepareApplication(f.migrationPath, path, layout, f.genesisPath, f.pins, "", ""); err == nil || bad != nil || badLease != nil {
				if badLease != nil {
					_ = badLease.Close()
				}
				t.Fatal("saved schedule substituted for missing independent authorization")
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(original, after) {
				t.Fatal("authority refusal rewrote original journal", err)
			}
		})
	}
}

func TestPQJournalWrongIndependentPinsRefuseBeforeStateOrLocks(t *testing.T) {
	f := newPQJournalStartupFixture(t)
	for _, layout := range []string{"snapshot-journal", "block-journal"} {
		for _, field := range []string{"comet", "native", "migration"} {
			t.Run(layout+"/"+field, func(t *testing.T) {
				bad := f.pins
				switch field {
				case "comet":
					bad.CometGenesisSHA256 = strings.Repeat("a1", 32)
				case "native":
					bad.OriginalGenesisHash = strings.Repeat("a2", 32)
				case "migration":
					bad.MigrationStateHash = strings.Repeat("a3", 32)
				}
				path := filepath.Join(t.TempDir(), "must-not-open.state")
				app, lease, _, err := prepareApplication(f.migrationPath, path, layout, f.genesisPath, bad, "", "")
				if err == nil || app != nil || lease != nil {
					if lease != nil {
						_ = lease.Close()
					}
					t.Fatal("normal journal startup ignored independent pin", field)
				}
				for _, p := range []string{path, path + ".writer.lock", path + ".lock", path + ".read.lock"} {
					if _, err := os.Lstat(p); !os.IsNotExist(err) {
						t.Fatal("wrong pin touched state or lock", p, err)
					}
				}
			})
		}
	}
}
