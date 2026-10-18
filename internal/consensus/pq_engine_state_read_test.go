package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/crypto/ynxpq"
)

type pqReadFixture struct {
	f        *validatorRegistryFixture
	app      *Application
	auth     *PQEngineAuthorization
	schedule *PQEngineSchedule
	keys     []engineTestKey
	path     string
	layout   string
}

func newPQReadFixture(t *testing.T, layout string) *pqReadFixture {
	t.Helper()
	r := &pqReadFixture{f: newValidatorRegistryFixture(t), layout: layout, path: filepath.Join(t.TempDir(), "original-state")}
	var err error
	switch layout {
	case "snapshot-journal":
		r.app, err = NewJournaledApplicationWithBootstrap(r.f.migration, r.path, r.f.bootstrap)
	case "block-journal":
		r.app, err = NewBlockJournaledApplicationWithBootstrap(r.f.migration, r.path, r.f.bootstrap)
	default:
		r.app, err = NewPersistentApplicationWithBootstrap(r.f.migration, r.path, r.f.bootstrap)
	}
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.app.InitChain(context.Background(), r.f.initRequest(t)); err != nil {
		t.Fatal(err)
	}
	var txs [][]byte
	for i := range r.f.bootstrap.record.Members {
		key, wire := engineRegistration(t, r.f, i, r.f.doc.InitialHeight)
		tx, err := EncodeValidatorRegistryTransaction(wire)
		if err != nil {
			t.Fatal(err)
		}
		r.keys, txs = append(r.keys, key), append(txs, tx)
	}
	r.commit(t, txs...)
	r.schedule, err = NewPQEngineSchedule(r.f.bootstrap, r.app.committed.ValidatorRegistry, r.app.committed.Height, r.app.committed.Height+4)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(r.schedule)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := r.schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	r.auth, err = NewPQEngineAuthorization(raw, hash)
	if err != nil {
		t.Fatal(err)
	}
	// Use the normal authenticated writer's original path. No hand-built
	// journal or fake imported registry is used to create positive evidence.
	switch layout {
	case "snapshot-journal":
		r.app, err = NewJournaledApplicationWithEngineAuthorization(r.f.migration, r.path, r.f.bootstrap, r.auth)
	case "block-journal":
		r.app, err = NewBlockJournaledApplicationWithEngineAuthorization(r.f.migration, r.path, r.f.bootstrap, r.auth)
	default:
		r.app, err = NewPersistentApplicationWithEngineAuthorization(r.f.migration, r.path, r.f.bootstrap, r.auth)
	}
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func (r *pqReadFixture) commit(t *testing.T, txs ...[]byte) {
	t.Helper()
	h := r.app.committed.Height + 1
	snapshot, err := r.app.CommittedPQEngineSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	next, err := snapshot.ExpectedValidatorHash(h + 1)
	if err != nil {
		t.Fatal(err)
	}
	response, err := r.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h, Time: r.f.doc.GenesisTime.Add(time.Duration(h) * time.Second), NextValidatorsHash: next, Txs: txs})
	if err != nil {
		t.Fatal(err)
	}
	for _, result := range response.TxResults {
		if result.Code != 0 {
			t.Fatal("actual signed registry transaction failed", result.Code, result.Log)
		}
	}
	if _, err = r.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
}

type pqReadFile struct {
	Mode os.FileMode
	Data []byte
}

func pqReadInventory(t *testing.T, path string) map[string]pqReadFile {
	t.Helper()
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	result := make(map[string]pqReadFile)
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			t.Fatal("unexpected fixture directory entry", err)
		}
		raw, err := os.ReadFile(filepath.Join(filepath.Dir(path), entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		result[entry.Name()] = pqReadFile{info.Mode(), raw}
	}
	return result
}

func (r *pqReadFixture) read(t *testing.T, source *PQEngineFileSource) *PQEngineSnapshot {
	t.Helper()
	before := pqReadInventory(t, r.path)
	hash, err := hex.DecodeString(r.app.committed.AppHash)
	if err != nil {
		t.Fatal(err)
	}
	authority, err := source.ConsensusAuthorityForSigning(r.f.doc.ChainID, r.app.committed.Height, hash)
	if err != nil {
		t.Fatal("actual fresh signing source rejected the complete layout", r.layout, err)
	}
	state, err := readPQEngineCommittedState(r.path, r.f.migration, r.f.bootstrap, r.auth, nil)
	if err != nil {
		t.Fatal(err)
	}
	want, err := json.Marshal(r.app.committed)
	if err != nil {
		t.Fatal(err)
	}
	got, err := json.Marshal(state)
	if err != nil || !bytes.Equal(want, got) {
		t.Fatal("read-only recovery changed complete runtime/history/account state", err)
	}
	if !reflect.DeepEqual(before, pqReadInventory(t, r.path)) {
		t.Fatal("source modified data/locks or created recovery files")
	}
	return authority.(*PQEngineSnapshot)
}

func pqReadSuccessor(t *testing.T, r *pqReadFixture, current engineTestKey, next *engineTestKey) []byte {
	t.Helper()
	h := r.app.committed.Height + 1
	history, err := replayValidatorRegistry(r.app.committed.ValidatorRegistry, r.f.bootstrap, h)
	if err != nil {
		t.Fatal(err)
	}
	active, err := history.ConsensusKeysAt(r.f.doc.ChainID, current.address, h)
	if err != nil {
		t.Fatal(err)
	}
	var previous ynxconsensusauth.Registration
	var previousWire []byte
	for _, event := range r.app.committed.ValidatorRegistry.Events {
		reg, err := ynxconsensusauth.DecodeRegistration(event.Wire)
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Equal(reg.Intent.ValidatorAddress, current.address) {
			previous, previousWire = reg, event.Wire
		}
	}
	previousHash, err := ynxconsensusauth.RegistrationHash(previousWire)
	if err != nil {
		t.Fatal(err)
	}
	intent := ynxconsensusauth.RegistrationIntent{Kind: ynxconsensusauth.RevokeValidator, GenesisID: bytes.Clone(r.f.bootstrap.genesisID), ChainID: r.f.doc.ChainID, ValidatorAddress: bytes.Clone(current.address), Sequence: previous.Intent.Sequence + 1, AuthorizingEpoch: active.Epoch, Epoch: previous.Intent.Epoch, ApprovedAt: h, EffectiveAt: h + 2, PreviousEventHash: previousHash[:], AuthorityMLDSA87PublicKey: current.pka, AuthoritySLHDSASHA2256fPublicKey: current.pkb}
	if next != nil {
		intent.Kind, intent.Epoch = ynxconsensusauth.RotateValidator, active.Epoch+1
		intent.MLDSA87PublicKey, intent.SLHDSASHA2256fPublicKey = next.pka, next.pkb
	}
	message, err := intent.AuthoritySigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	a, b := current.signatures(t, message)
	reg := ynxconsensusauth.Registration{Intent: intent, AuthorityMLDSA87: a, AuthoritySLHDSASHA2256f: b}
	if next != nil {
		pop, err := intent.PossessionSigningBytes()
		if err != nil {
			t.Fatal(err)
		}
		reg.PossessionMLDSA87, reg.PossessionSLHDSASHA2256f = next.signatures(t, pop)
	}
	wire, err := reg.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	tx, err := EncodeValidatorRegistryTransaction(wire)
	if err != nil {
		t.Fatal(err)
	}
	return tx
}

func TestPQEngineStateReadActualLayoutsRegistryRotationRevocation(t *testing.T) {
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			r := newPQReadFixture(t, layout)
			source, err := NewPQEngineFileSource(r.f.migration, r.path, r.f.bootstrap, r.auth)
			if err != nil {
				t.Fatal(err)
			}
			r.read(t, source)
			for r.app.committed.Height < r.schedule.ActivationHeight {
				r.commit(t)
				r.read(t, source)
			}
			original := r.read(t, source)
			binding, err := original.history.PublicKeyBindingAt(r.f.doc.ChainID, r.keys[0].address, r.schedule.ActivationHeight)
			if err != nil {
				t.Fatal(err)
			}
			rotated, _ := engineRegistration(t, r.f, 0, r.app.committed.Height+1)
			r.commit(t, pqReadSuccessor(t, r, r.keys[0], &rotated))
			r.read(t, source)
			r.commit(t)
			r.commit(t)
			rotationHeight := r.app.committed.Height
			afterRotation := r.read(t, source)
			newBinding, err := afterRotation.history.PublicKeyBindingAt(r.f.doc.ChainID, rotated.address, rotationHeight)
			if err != nil {
				t.Fatal(err)
			}
			logical, err := ynxconsensusauth.DecodeLogicalPublicKey(newBinding)
			if err != nil || logical.Epoch != 2 {
				t.Fatal("cold source did not activate the actual new epoch", err)
			}
			if afterRotation.AuthorizeConsensusKey(binding, rotationHeight, 0, ynxpq.Precommit) == nil {
				t.Fatal("old full key remained usable after rotation")
			}
			r.commit(t, pqReadSuccessor(t, r, rotated, nil))
			r.commit(t)
			r.commit(t)
			cold, err := NewPQEngineFileSource(r.f.migration, r.path, r.f.bootstrap, r.auth)
			if err != nil {
				t.Fatal(err)
			}
			restored := r.read(t, cold)
			if restored.AuthorizeConsensusKey(newBinding, r.app.committed.Height, 0, ynxpq.Precommit) == nil {
				t.Fatal("revoked epoch reopened after cold journal read")
			}
			if err := restored.AuthorizeConsensusKey(binding, r.schedule.ActivationHeight, 0, ynxpq.Precommit); err != nil {
				t.Fatal("future rotation/revocation reinterpreted original signed height", err)
			}
			if len(r.app.committed.ValidatorRegistry.Events) != 4 {
				t.Fatal("actual registration/rotation/revocation history was lost")
			}
			hash, _ := hex.DecodeString(r.app.committed.AppHash)
			for _, test := range []struct {
				chain  string
				height int64
				hash   []byte
			}{
				{"foreign", r.app.committed.Height, hash},
				{r.f.doc.ChainID, r.app.committed.Height - 1, hash},
				{r.f.doc.ChainID, r.app.committed.Height + 1, hash},
				{r.f.doc.ChainID, r.app.committed.Height, bytes.Repeat([]byte{7}, 32)},
			} {
				if _, err := cold.ConsensusAuthorityForSigning(test.chain, test.height, test.hash); err == nil {
					t.Fatal("untrusted chain/height/hash was accepted")
				}
			}
			if _, err := LoadPQEngineSnapshot(r.f.migration, r.path, r.f.bootstrap, nil, r.app.committed.Height, hash); err == nil {
				t.Fatal("stored schedule supplied its own authority")
			}
			pqReadRejectRehashedHistory(t, r)
		})
	}
}

// A valid frame checksum and a self-consistent alternative AppHash cannot
// replace the checkpoint independently supplied by the actual engine.
func pqReadRejectRehashedHistory(t *testing.T, r *pqReadFixture) {
	t.Helper()
	original, err := os.ReadFile(r.path)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(r.app.committed)
	if err != nil {
		t.Fatal(err)
	}
	expectedHash, _ := hex.DecodeString(r.app.committed.AppHash)
	for _, mode := range []string{"delete_terminal_revocation", "changed_second_possession_signature"} {
		t.Run(mode, func(t *testing.T) {
			var changed CommittedState
			if err := json.Unmarshal(encoded, &changed); err != nil {
				t.Fatal(err)
			}
			changed.bootstrap = r.f.bootstrap
			if mode == "delete_terminal_revocation" {
				changed.ValidatorRegistry.Events = changed.ValidatorRegistry.Events[:len(changed.ValidatorRegistry.Events)-1]
				history, err := replayValidatorRegistry(nil, r.f.bootstrap, changed.Height)
				if err != nil {
					t.Fatal(err)
				}
				for _, event := range changed.ValidatorRegistry.Events {
					history, err = history.Append(event.Wire, event.Height, r.f.bootstrap.membershipAt(changed.Height))
					if err != nil {
						t.Fatal(err)
					}
				}
				root := history.Root()
				changed.ValidatorRegistry.Root = hex.EncodeToString(root[:])
			} else {
				event := &changed.ValidatorRegistry.Events[0]
				registration, err := ynxconsensusauth.DecodeRegistration(event.Wire)
				if err != nil {
					t.Fatal(err)
				}
				registration.PossessionSLHDSASHA2256f[len(registration.PossessionSLHDSASHA2256f)-1] ^= 1
				event.Wire, err = registration.MarshalBinary()
				if err != nil {
					t.Fatal(err)
				}
				operation, err := ynxconsensusauth.RegistrationHash(event.Wire)
				if err != nil {
					t.Fatal(err)
				}
				tx, err := EncodeValidatorRegistryTransaction(event.Wire)
				if err != nil {
					t.Fatal(err)
				}
				event.OperationHash, event.ABCIHash = "0x"+hex.EncodeToString(operation[:]), SignedTransactionHash(tx)
			}
			changed.AppHash, err = changed.calculateHash()
			if err != nil || changed.AppHash == r.app.committed.AppHash {
				t.Fatal("mutation did not exercise another complete checkpoint", err)
			}
			validationErr := changed.Validate(r.f.migration)
			if mode == "delete_terminal_revocation" && validationErr != nil {
				t.Fatal("alternative valid-prefix control failed before engine hash binding", validationErr)
			}
			if mode == "changed_second_possession_signature" && validationErr == nil {
				t.Fatal("complete registry validation ignored the original second signature")
			}
			payload, err := json.Marshal(changed)
			if err != nil {
				t.Fatal(err)
			}
			switch r.layout {
			case "snapshot-journal":
				payload = append([]byte(snapshotJournalMagic+r.f.migration.StateHash+"\n"), journalRecord(payload)...)
			case "block-journal":
				checkpoint, err := encodeBlockCheckpoint(changed)
				if err != nil {
					t.Fatal(err)
				}
				payload = append([]byte(blockJournalMagic+r.f.migration.StateHash+"\n"), blockJournalFrame(checkpoint)...)
				payload = append(payload, checkpoint...)
			}
			if err := os.WriteFile(r.path, payload, 0600); err != nil {
				t.Fatal(err)
			}
			before := pqReadInventory(t, r.path)
			cold, err := NewPQEngineFileSource(r.f.migration, r.path, r.f.bootstrap, r.auth)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := cold.ConsensusAuthorityForSigning(r.f.doc.ChainID, r.app.committed.Height, expectedHash); err == nil {
				t.Fatal("cold source trusted altered history with recomputed hashes/checksums", mode)
			}
			if !reflect.DeepEqual(before, pqReadInventory(t, r.path)) {
				t.Fatal("rejected checkpoint was repaired or replaced")
			}
			if err := os.WriteFile(r.path, original, 0600); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPQEngineStateReadKeepsPinnedHistoricalRuntimeDomains(t *testing.T) {
	for _, version := range []int{12, 13} {
		f := newRuntimeUpgradeFixture(t, version)
		for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
			t.Run(layout+"/"+strconv.Itoa(version), func(t *testing.T) {
				path := filepath.Join(t.TempDir(), "original-state")
				var snapshots *snapshotJournal
				var blocks *blockJournal
				var err error
				if layout == "snapshot-journal" {
					snapshots, _, err = openSnapshotJournal(path, f.migration)
				} else if layout == "block-journal" {
					blocks, _, err = openBlockJournal(path, f.migration)
				}
				if err != nil {
					t.Fatal(err)
				}
				for _, original := range []CommittedState{f.old[len(f.old)-1], f.next} {
					switch layout {
					case "snapshot-journal":
						err = snapshots.save(original, f.migration, nil)
					case "block-journal":
						// Version transitions are full checkpoints in the actual writer.
						err = blocks.replaceCheckpoint(original, f.migration)
					default:
						err = saveCommittedState(path, original, f.migration)
					}
					if err != nil {
						t.Fatal(err)
					}
					before := pqReadInventory(t, path)
					hash, _ := hex.DecodeString(original.AppHash)
					_, err := loadPQEngineSnapshotWithRuntime(f.migration, path, f.bootstrap, nil, f.authorization, original.Height, hash)
					if err != nil {
						t.Fatal("read-only recovery reinterpreted an original pinned runtime checkpoint", err)
					}
					state, err := readPQEngineCommittedState(path, f.migration, f.bootstrap, nil, f.authorization)
					if err != nil || state.Version != original.Version || state.AppHash != original.AppHash {
						t.Fatal("readback upgraded or resealed original runtime", err)
					}
					if !reflect.DeepEqual(before, pqReadInventory(t, path)) {
						t.Fatal("historical read wrote a new domain or changed source bytes")
					}
				}
			})
		}
	}
}

func TestPQEngineStateReadRejectsCorruptionAndIncompleteTailWithoutRepair(t *testing.T) {
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			r := newPQReadFixture(t, layout)
			r.commit(t) // actual schedule admitted; source can no longer rely on nil policy.
			r.commit(t) // at least one V2 delta after the schedule-version checkpoint.
			source, err := NewPQEngineFileSource(r.f.migration, r.path, r.f.bootstrap, r.auth)
			if err != nil {
				t.Fatal(err)
			}
			r.read(t, source)
			original, err := os.ReadFile(r.path)
			if err != nil {
				t.Fatal(err)
			}
			hash, _ := hex.DecodeString(r.app.committed.AppHash)
			for _, mode := range []string{"partial_header", "partial_payload", "complete_checksum", "empty"} {
				t.Run(mode, func(t *testing.T) {
					bad := bytes.Clone(original)
					switch mode {
					case "partial_header":
						bad = append(bad, 0x01)
					case "partial_payload":
						bad = bad[:len(bad)-1]
					case "complete_checksum":
						bad[len(bad)-2] ^= 1
					case "empty":
						bad = nil
					}
					if err := os.WriteFile(r.path, bad, 0600); err != nil {
						t.Fatal(err)
					}
					before := pqReadInventory(t, r.path)
					if _, err := source.ConsensusAuthorityForSigning(r.f.doc.ChainID, r.app.committed.Height, hash); err == nil {
						t.Fatal("incomplete/corrupt source fell back to cached authority", mode)
					}
					if !reflect.DeepEqual(before, pqReadInventory(t, r.path)) {
						t.Fatal("read path repaired/truncated/rewrote the original")
					}
					if err := os.WriteFile(r.path, original, 0600); err != nil {
						t.Fatal(err)
					}
				})
			}
			if layout != "atomic-json" {
				f, err := journalRegularFile(r.path+".read.lock", os.O_RDONLY)
				if err != nil {
					t.Fatal(err)
				}
				if err := lockSnapshotJournal(f); err != nil {
					_ = f.Close()
					t.Fatal(err)
				}
				before := pqReadInventory(t, r.path)
				_, readErr := source.ConsensusAuthorityForSigning(r.f.doc.ChainID, r.app.committed.Height, hash)
				unlockSnapshotJournal(f)
				if err := f.Close(); err != nil {
					t.Fatal(err)
				}
				if readErr == nil || !reflect.DeepEqual(before, pqReadInventory(t, r.path)) {
					t.Fatal("live writer exclusion was ignored or modified", readErr)
				}
				if err := os.Remove(r.path + ".read.lock"); err != nil {
					t.Fatal(err)
				}
				before = pqReadInventory(t, r.path)
				if _, err := source.ConsensusAuthorityForSigning(r.f.doc.ChainID, r.app.committed.Height, hash); err == nil {
					t.Fatal("missing original read lock was recreated or ignored")
				}
				if !reflect.DeepEqual(before, pqReadInventory(t, r.path)) {
					t.Fatal("source created missing lock")
				}
			}
		})
	}
}

func TestPQEngineStateReadRejectsSourceChangeAfterCapture(t *testing.T) {
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			r := newPQReadFixture(t, layout)
			captured, err := capturePQEngineState(r.path)
			if err != nil {
				t.Fatal(err)
			}
			r.commit(t) // real normal writer append/atomic replacement after read.
			if err := captured.unchanged(); err == nil {
				t.Fatal("source advance during decoder work was not rejected")
			}
			captured, err = capturePQEngineState(r.path)
			if err != nil {
				t.Fatal(err)
			}
			replacement := filepath.Join(filepath.Dir(r.path), "replacement")
			if err := os.WriteFile(replacement, captured.data, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.Chtimes(replacement, captured.info.ModTime(), captured.info.ModTime()); err != nil {
				t.Fatal(err)
			}
			if err := os.Rename(replacement, r.path); err != nil {
				t.Fatal(err)
			}
			before := pqReadInventory(t, r.path)
			if err := captured.unchanged(); err == nil {
				t.Fatal("same bytes/size/time on another inode passed read identity guard")
			}
			if !reflect.DeepEqual(before, pqReadInventory(t, r.path)) {
				t.Fatal("identity check changed source")
			}
		})
	}
}
