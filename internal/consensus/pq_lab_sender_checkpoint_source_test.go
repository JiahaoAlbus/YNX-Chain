//go:build unix

package consensus

import (
	"bytes"
	"crypto/sha256"
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
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

func TestPQLabSenderCheckpointSourceSameInputColdAndSteadyParity(t *testing.T) {
	testPQLabSenderCheckpointSourceParity(t, true)
}

func TestPQLabSenderCheckpointSourceCanonicalColdAndSteadyParity(t *testing.T) {
	testPQLabSenderCheckpointSourceParity(t, false)
}

func testPQLabSenderCheckpointSourceParity(t *testing.T, large bool) {
	t.Helper()
	p, pin, corpus := checkpointReadFixture(t, 1)
	rawMigration, err := os.ReadFile(p.MigrationFile)
	if err != nil {
		t.Fatal(err)
	}
	// This accepted original encoding crosses only the optional cache budget;
	// it does not invent 500 keys, change genesis, sign new history, or alter
	// the existing full-input limit. Both arms read these SAME original bytes.
	padded := rawMigration
	if large {
		padded = append(bytes.Repeat([]byte(" "), 33<<20), rawMigration...)
	}
	if err = os.WriteFile(p.MigrationFile, padded, 0600); err != nil {
		t.Fatal(err)
	}
	beforeCache := NewPQLabStaticCache()
	defer beforeCache.Close()
	afterSource := NewPQLabSenderCheckpointSource()
	defer afterSource.Close()
	uncached := false
	for heightIndex := 0; heightIndex <= len(corpus.Transactions); heightIndex++ {
		if heightIndex > 0 {
			tx, e := os.ReadFile(filepath.Join(p.RootDir, "workload", corpus.Transactions[heightIndex-1].Envelope.Path))
			if e != nil {
				t.Fatal(e)
			}
			checkpointReadApplyOriginal(t, p, pin, tx)
		}
		raw, e := os.ReadFile(p.Nodes[0].StatePath)
		if e != nil {
			t.Fatal(e)
		}
		var actual CommittedState
		if e = json.Unmarshal(raw, &actual); e != nil {
			t.Fatal(e)
		}
		bm, am := &PQLabMetrics{}, &PQLabMetrics{}
		start := time.Now()
		var before *PQLabSenderCheckpoint
		if !uncached {
			before, e = beforeA88PQLabSenderCheckpointCached(p.RootDir, pin, "", actual.Height, actual.AppHash, bm, beforeCache)
			if e == ErrPQLabStaticCacheBound {
				uncached = true
			}
		}
		if uncached {
			before, e = beforeA88PQLabSenderCheckpointCached(p.RootDir, pin, "", actual.Height, actual.AppHash, bm, nil)
		}
		if e != nil {
			t.Fatal(e)
		}
		for repeat := 0; repeat < 2; repeat++ {
			if e = before.current(); e != nil {
				t.Fatal(e)
			}
		}
		beforeNS := time.Since(start).Nanoseconds()
		start = time.Now()
		after, e := afterSource.Load(p.RootDir, pin, "", actual.Height, actual.AppHash, am)
		if e != nil {
			t.Fatal(e)
		}
		for repeat := 0; repeat < 2; repeat++ {
			if e = after.current(); e != nil {
				t.Fatal(e)
			}
		}
		afterNS := time.Since(start).Nanoseconds()
		left, _ := encodeCommittedStateJSON(before.state)
		right, _ := encodeCommittedStateJSON(after.state)
		if !bytes.Equal(left, right) || !bytes.Equal(raw, right) || !bytes.Equal(before.network, after.network) || before.migrationHash != after.migrationHash {
			t.Fatal("same original input changed complete state, balances, nonces, history or AppHash")
		}
		owned := afterSource.inputs.heldStatic
		if owned == nil {
			owned = &pqLabLiveStaticSnapshot{witness: afterSource.cache.entry.witness}
		}
		for _, node := range p.Nodes {
			cold, e := NewPersistentApplicationWithBootstrap(owned.witness.migration, node.StatePath, owned.witness.bootstrap)
			if e != nil {
				t.Fatal(e)
			}
			coldRaw, _ := encodeCommittedStateJSON(cold.committed)
			if !bytes.Equal(raw, coldRaw) {
				t.Fatal("complete original cold state differs")
			}
		}
		b, a := bm.Snapshot().Stages, am.Snapshot().Stages
		if b["checkpoint.captureCurrentBytes"].Calls != 12 || b["checkpoint.fullStateValidation"].Calls != 4 || a["checkpoint.captureCurrentBytes"].Calls != 12 || a["checkpoint.fullStateValidation"].Calls != 1 || a["checkpoint.exactBytesValidationReuse"].Calls != 11 {
			t.Fatal("actual current/full validation denominators changed", b, a)
		}
		wantBootstrap := uint64(0)
		if heightIndex == 0 {
			wantBootstrap = 1
		}
		beforeBootstrap := wantBootstrap
		if large {
			beforeBootstrap = 1
		}
		if b["lab.bootstrapFullValidation"].Calls != beforeBootstrap || a["lab.bootstrapFullValidation"].Calls != wantBootstrap {
			t.Fatal("cold/steady original bootstrap validation count differs", b, a)
		}
		if a["lab.validatorKeyFullValidation"].Calls != 0 || a["lab.validatedMigrationOwnerBuild"].Calls != wantBootstrap {
			t.Fatal("combined full key/canonical owner was omitted/repeated or a separate pass reappeared", a)
		}
		stats := afterSource.CacheStats()
		if large && (stats.Entries != 0 || stats.HeldFiles != 0 || stats.OriginalBytes != 0 || stats.Misses != 1 || stats.Bypasses != 1) {
			t.Fatal("large held source entered or enlarged bounded cache", stats)
		}
		t.Logf("SENDER_SOURCE_PARITY height=%d cold=%t stateBytes=%d stateSHA=%s appHash=%s freshCapturesEach=12 beforeFullState=4 afterFullState=1 beforeBootstrap=%d afterBootstrap=%d beforeLoadAndCurrentNS=%d afterLoadAndCurrentNS=%d syntheticOnly=true fullChain=false", actual.Height, heightIndex == 0, len(raw), pqLabSHA(raw), actual.AppHash, beforeBootstrap, wantBootstrap, beforeNS, afterNS)
	}
	if now, e := os.ReadFile(p.MigrationFile); e != nil || !bytes.Equal(now, padded) {
		t.Fatal("original migration bytes changed", e)
	}
}

func TestPQLabSenderCheckpointSourceScopeCurrentAndClose(t *testing.T) {
	p, pin, _ := checkpointReadFixture(t, 1)
	raw, err := os.ReadFile(p.Nodes[0].StatePath)
	if err != nil {
		t.Fatal(err)
	}
	var actual CommittedState
	if err = json.Unmarshal(raw, &actual); err != nil {
		t.Fatal(err)
	}
	source := NewPQLabSenderCheckpointSource()
	defer source.Close()
	cp, err := source.Load(p.RootDir, pin, "", actual.Height, actual.AppHash, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, root, pin, activation, hash string
		height                            int64
	}{
		{"foreign-root", p.RootDir + "-other", pin, "", actual.AppHash, actual.Height},
		{"foreign-pin", p.RootDir, strings.Repeat("a", 64), "", actual.AppHash, actual.Height},
		{"foreign-activation", p.RootDir, pin, strings.Repeat("a", 64), actual.AppHash, actual.Height},
		{"wrong-height", p.RootDir, pin, "", actual.AppHash, actual.Height + 1},
		{"wrong-hash", p.RootDir, pin, "", strings.Repeat("a", 64), actual.Height},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, e := source.Load(tc.root, tc.pin, tc.activation, tc.height, tc.hash, nil); e == nil {
				t.Fatal("held math became foreign/current authority")
			}
		})
	}
	if err = os.WriteFile(p.Nodes[3].StatePath, []byte(`{"invalid-current-policy":true}`), 0600); err != nil {
		t.Fatal(err)
	}
	if cp.current() == nil {
		t.Fatal("one changed actual node bypassed current check")
	}
	if err = os.WriteFile(p.Nodes[3].StatePath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err = cp.current(); err != nil {
		t.Fatal(err)
	}
	// A same-byte replacement of a STATIC original is not the held source.
	genesis, err := os.ReadFile(p.GenesisFile)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(p.GenesisFile+".replacement", genesis, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(p.GenesisFile+".replacement", p.GenesisFile); err != nil {
		t.Fatal(err)
	}
	if cp.current() == nil {
		t.Fatal("same-byte replaced static original accepted")
	}
	if _, err = source.Load(p.RootDir, pin, "", actual.Height, actual.AppHash, nil); err == nil {
		t.Fatal("changed static original silently reopened")
	}
	// A real descriptor close error stays sticky and invalidates checkpoints.
	if err = source.cache.entry.originals[0].file.Close(); err != nil {
		t.Fatal(err)
	}
	closeErr := source.Close()
	if !errors.Is(closeErr, os.ErrClosed) || source.Close() != closeErr || cp.current() == nil {
		t.Fatal("Close error swallowed or closed source resumed", closeErr)
	}
	if _, err = source.Load(p.RootDir, pin, "", actual.Height, actual.AppHash, nil); err == nil {
		t.Fatal("closed owner rebuilt witness")
	}
}

func TestPQLabCheckpointReadCrossNodeExactBytesAndClose(t *testing.T) {
	p, pin, _ := checkpointReadFixture(t, 1)
	cache := NewPQLabStaticCache()
	defer cache.Close()
	entry, err := cache.load(p.RootDir, pin, nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(p.Nodes[0].StatePath)
	if err != nil {
		t.Fatal(err)
	}
	var state CommittedState
	if err = json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	r := &pqLabCheckpointRead{witness: entry.witness, height: state.Height, appHash: state.AppHash, metrics: &PQLabMetrics{}}
	if _, err = r.read(0, p.Nodes[0].StatePath, capturePQEngineState); err != nil {
		t.Fatal(err)
	}
	late := errors.New("actual second node close failed")
	if _, err = r.read(1, p.Nodes[1].StatePath, func(path string) (*pqEngineStateRead, error) {
		o, e := capturePQEngineState(path)
		if e == nil {
			closeOriginal := o.closeOriginal
			o.closeOriginal = func() error {
				if closeOriginal != nil {
					return errors.Join(closeOriginal(), late)
				}
				return late
			}
		}
		return o, e
	}); !errors.Is(err, late) || r.files[1].validated {
		t.Fatal("cross-node reuse published after failed close", err)
	}
	if _, err = r.read(1, p.Nodes[1].StatePath, capturePQEngineState); err != nil || !r.files[1].validated {
		t.Fatal("real independent original did not validate", err)
	}
	if err = os.WriteFile(p.Nodes[2].StatePath, append([]byte(" \n"), raw...), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = r.read(2, p.Nodes[2].StatePath, capturePQEngineState); err != nil {
		t.Fatal(err)
	}
	if r.metrics.Snapshot().Stages["checkpoint.fullStateValidation"].Calls != 2 {
		t.Fatal("nonidentical bytes skipped full validator")
	}
	bad := bytes.Replace(raw, []byte(`"height":`), []byte(`"height":9`), 1)
	if bytes.Equal(raw, bad) {
		t.Fatal("height mutation missed original field")
	}
	if err = os.WriteFile(p.Nodes[3].StatePath, bad, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = r.read(3, p.Nodes[3].StatePath, capturePQEngineState); err == nil || r.files[3].validated {
		t.Fatal("invalid full state cached or accepted")
	}
}

func TestPQLabSenderCheckpointSourceRevocationNonceAndUnknown(t *testing.T) {
	work, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Owners: 2, Transfers: 2, BatchSize: 1, Online: true})
	if err != nil {
		t.Fatal(err)
	}
	defer work.Destroy()
	root := filepath.Join(pqLabWorkloadTemp(t), "lab")
	p, err := GeneratePQLabNetwork(work.Migration, PQLabNetworkOptions{RootDir: root, BaseP2P: 31656, BaseRPC: 31757})
	if err != nil {
		t.Fatal(err)
	}
	planRaw, err := os.ReadFile(filepath.Join(root, "network-plan.json"))
	if err != nil {
		t.Fatal(err)
	}
	pin := pqLabSHA(planRaw)
	_, m, _, err := loadPQLab(root, pin)
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(root, "workload")
	if _, err = work.WriteCorpus(dir, m); err != nil {
		t.Fatal(err)
	}
	persistPQLabTestCheckpoint(t, p, pin, nil)
	manifest, err := os.ReadFile(filepath.Join(dir, "PUBLIC-WORKLOAD.json"))
	if err != nil {
		t.Fatal(err)
	}
	credential, err := os.ReadFile(filepath.Join(dir, "private-senders", "recovery.raw"))
	if err != nil {
		t.Fatal(err)
	}
	defer clear(credential)
	sender, err := OpenPQLabSender(dir, pqLabSHA(manifest), 0, credential)
	if err != nil {
		t.Fatal(err)
	}
	defer sender.Close()
	revoked, err := OpenPQLabSender(dir, pqLabSHA(manifest), 1, credential)
	if err != nil {
		t.Fatal(err)
	}
	defer revoked.Close()
	source := NewPQLabSenderCheckpointSource()
	defer source.Close()
	load := func() *PQLabSenderCheckpoint {
		raw, e := os.ReadFile(p.Nodes[0].StatePath)
		if e != nil {
			t.Fatal(e)
		}
		var actual CommittedState
		if e = json.Unmarshal(raw, &actual); e != nil {
			t.Fatal(e)
		}
		cp, e := source.Load(root, pin, "", actual.Height, actual.AppHash, nil)
		if e != nil {
			t.Fatal(e)
		}
		return cp
	}
	initial := load()
	request := PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("a", 64), OwnerIndex: 0, FirstNonce: 3, Members: 1}
	if _, err = sender.Sign(request, initial); err == nil {
		t.Fatal("held source authorized a future nonce")
	}
	request.FirstNonce = 2
	originalPK := sender.public.PKA
	sender.public.PKA = bytes.Repeat([]byte{1}, len(originalPK))
	_, err = sender.Sign(request, initial)
	sender.public.PKA = originalPK
	if err == nil {
		t.Fatal("held source authorized a different full pair")
	}
	operation, _ := sender.operation(request.OperationID)
	if _, err = os.Stat(operation); !os.IsNotExist(err) {
		t.Fatal("pre-sign refusal reserved an intent", err)
	}
	h := uint64(initial.state.Height + 1)
	intent := ynxauth.RevocationIntent{ChainID: initial.network, Owner: revoked.owner.Owner, PKA: revoked.public.PKA, PKB: revoked.public.PKB, AuthorizingRevision: 1, ThroughRevision: 1, LedgerNonce: 2, ExecuteAt: h, RevokeAt: h + 1}
	message, err := intent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	_, proof := consensusPQProof(t, revoked.key, initial.network, revoked.owner.Owner, ynxauth.RevocationPurpose, message)
	wire, err := (ynxauth.Revocation{Intent: intent, CurrentPQProof: proof}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	envelope, err := EncodePQTransaction(PQRevocationType, wire)
	if err != nil {
		t.Fatal(err)
	}
	checkpointReadApplyOriginal(t, p, pin, envelope)
	if initial.current() == nil {
		t.Fatal("previous actual height became current after revoke")
	}
	current := load()
	revokeRequest := request
	revokeRequest.OwnerIndex = 1
	revokeRequest.FirstNonce = 3
	if _, err = revoked.Sign(revokeRequest, current); err == nil {
		t.Fatal("actual committed revocation bypassed by held immutable witness")
	}
	checks := 0
	originalCurrent := current.current
	current.current = func() error {
		checks++
		if checks == 2 {
			return errors.New("actual post-sign observation unavailable")
		}
		return originalCurrent()
	}
	if _, err = sender.Sign(request, current); !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("post-sign failure did not preserve UNKNOWN", err)
	}
	original, err := os.ReadFile(filepath.Join(operation, "transaction.abci"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(operation, "RESULT.json")); !os.IsNotExist(err) {
		t.Fatal("UNKNOWN became an acknowledged result")
	}
	if _, err = sender.Recover(request); err != nil {
		t.Fatal("original could not reconcile without re-sign", err)
	}
	if _, err = sender.Sign(request, nil); err != nil {
		t.Fatal("exact original could not recover", err)
	}
	if after, e := os.ReadFile(filepath.Join(operation, "transaction.abci")); e != nil || !bytes.Equal(original, after) {
		t.Fatal("recovery replaced original wire", e)
	}
	request.OperationID = strings.Repeat("b", 64)
	if _, err = sender.Sign(request, load()); !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("new id escaped unresolved original", err)
	}
}

func TestPQLabSenderBootstrapOriginalCanonicalPinsAndWitness(t *testing.T) {
	source, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Owners: 2, Transfers: 1, BatchSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer source.Destroy()
	if err = source.Migration.Validate(); err != nil {
		t.Fatal(err)
	}
	f := pqLabBoundFixture(t, source.Migration)
	canonical, err := f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	// Original key API has stronger completeness semantics than Validate.
	if _, err = newPQLabSenderBootstrap(f.raw, f.pins, source.Migration, nil); err == nil || !strings.Contains(err.Error(), "not bound") {
		t.Fatal("unbound validator slipped through complete migration writer", err)
	}
	for _, kind := range []string{"inline", "reference"} {
		t.Run(kind, func(t *testing.T) {
			raw := bytes.Clone(f.raw)
			if kind == "reference" {
				var doc cmttypes.GenesisDoc
				if err := cmtjson.Unmarshal(raw, &doc); err != nil {
					t.Fatal(err)
				}
				doc.AppState, _ = json.Marshal(newCometMigrationReference(f.migration, canonical))
				raw, err = cmtjson.MarshalIndent(doc, "", "  ")
				if err != nil {
					t.Fatal(err)
				}
			}
			pins := f.pins
			pins.CometGenesisSHA256 = pqLabSHA(raw)
			legacy, err := NewConsensusBootstrap(raw, pins, f.migration)
			if err != nil {
				t.Fatal(err)
			}
			metrics := &PQLabMetrics{}
			owned, err := newPQLabSenderBootstrap(raw, pins, f.migration, metrics)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(legacy.record, owned.bootstrap.record) || !bytes.Equal(legacy.rawGenesis, owned.bootstrap.rawGenesis) || !bytes.Equal(legacy.appState, owned.bootstrap.appState) || !reflect.DeepEqual(legacy.members, owned.bootstrap.members) || owned.canonicalHash != sha256.Sum256(canonical) || owned.canonicalBytes != len(canonical) {
				t.Fatal("complete original bootstrap/canonical ownership changed")
			}
			stages := metrics.Snapshot().Stages
			if stages["lab.validatorKeyFullValidation"].Calls != 0 || stages["lab.validatedMigrationOwnerBuild"].Calls != 1 {
				t.Fatal("combined full key API/writer denominators", stages)
			}
			if _, err = newConsensusBootstrap(raw, pins, f.migration, owned); err == nil {
				t.Fatal("already-bound witness retargeted")
			}
			var doc cmttypes.GenesisDoc
			if err = cmtjson.Unmarshal(raw, &doc); err != nil {
				t.Fatal(err)
			}
			if kind == "reference" {
				var r cometMigrationReference
				if err = json.Unmarshal(doc.AppState, &r); err != nil {
					t.Fatal(err)
				}
				r.MigrationCanonicalBytes = "1"
				doc.AppState, _ = json.Marshal(r)
			} else {
				var embedded chain.ConsensusMigrationState
				if err = json.Unmarshal(doc.AppState, &embedded); err != nil {
					t.Fatal(err)
				}
				embedded.Accounts[0].Nonce++
				doc.AppState, _ = json.Marshal(embedded)
			}
			bad, err := cmtjson.MarshalIndent(doc, "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			wrong := pins
			wrong.CometGenesisSHA256 = pqLabSHA(bad)
			if _, err = newPQLabSenderBootstrap(bad, wrong, f.migration, nil); err == nil {
				t.Fatal("independently repinned different full AppState accepted")
			}
		})
	}
	for _, kind := range []string{"wrong-pin", "wrong-chain", "wrong-member", "bad-validator-key", "bad-original-proof"} {
		t.Run(kind, func(t *testing.T) {
			raw := bytes.Clone(f.raw)
			pins := f.pins
			encoded, _ := json.Marshal(f.migration)
			var m chain.ConsensusMigrationState
			if err := json.Unmarshal(encoded, &m); err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "wrong-pin":
				pins.CometGenesisSHA256 = strings.Repeat("a", 64)
			case "wrong-chain", "wrong-member":
				var d cmttypes.GenesisDoc
				if err := cmtjson.Unmarshal(raw, &d); err != nil {
					t.Fatal(err)
				}
				if kind == "wrong-chain" {
					d.ChainID = "ynx_642398-1"
				} else {
					d.Validators[0].Power++
				}
				raw, err = cmtjson.MarshalIndent(d, "", "  ")
				if err != nil {
					t.Fatal(err)
				}
				pins.CometGenesisSHA256 = pqLabSHA(raw)
			case "bad-validator-key":
				m.Validators[0].ConsensusPubKey = "invalid"
			case "bad-original-proof":
				changed := false
				for i := range m.Runtime.Blocks {
					for j := range m.Runtime.Blocks[i].Transactions {
						tx := &m.Runtime.Blocks[i].Transactions[j]
						if strings.Contains(tx.Memo, "pq-migration") {
							if strings.HasSuffix(tx.Memo, "0") {
								tx.Memo = tx.Memo[:len(tx.Memo)-1] + "1"
							} else {
								tx.Memo = tx.Memo[:len(tx.Memo)-1] + "0"
							}
							changed = true
							break
						}
					}
					if changed {
						break
					}
				}
				if !changed {
					t.Fatal("original real registration proof missing")
				}
			}
			if _, err := newPQLabSenderBootstrap(raw, pins, m, nil); err == nil {
				t.Fatal("invalid original accepted", kind)
			}
		})
	}
	for _, kind := range []string{"zero", "hash-only", "copied", "mutated"} {
		t.Run(kind, func(t *testing.T) {
			w, err := newValidatedMigration(f.migration, nil)
			if err != nil {
				t.Fatal(err)
			}
			w.bootstrapKeysValidated = w
			switch kind {
			case "zero":
				w = &validatedMigration{}
			case "hash-only":
				w = &validatedMigration{migration: w.migration, canonicalBytes: w.canonicalBytes, canonicalHash: w.canonicalHash}
			case "copied":
				copy := *w
				w = &copy
			case "mutated":
				w.migration.Accounts[0].Nonce++
			}
			if _, err := newConsensusBootstrap(f.raw, f.pins, f.migration, w); err == nil {
				t.Fatal("unowned/tampered witness accepted", kind)
			}
		})
	}
}

// The following reference is the exact a88 production loader/read algorithm,
// mechanically renamed for SAME-input cold/steady comparison. No keys, state,
// permissions or signatures are fabricated by this reference.
func beforeA88PQLabSenderCheckpointCached(root, planPin, activationPin string, height int64, appHash string, metrics *PQLabMetrics, cache *PQLabStaticCache) (*PQLabSenderCheckpoint, error) {
	defer pqLabMeasure(metrics, "checkpoint.loadTotal")()
	var entry *pqLabStaticEntry
	var err error
	var p PQLabNetworkPlan
	var m chain.ConsensusMigrationState
	var b *ConsensusBootstrap
	if cache == nil {
		p, m, b, err = loadPQLabMeasured(root, planPin, metrics)
	} else {
		entry, err = cache.load(root, planPin, metrics)
		if err == nil {
			p, m, b = entry.plan, entry.witness.migration, entry.witness.bootstrap
		}
	}
	if err != nil {
		return nil, err
	}
	var engine *PQEngineAuthorization
	if activationPin != "" {
		raw, err := pqLabRead(filepath.Join(root, "activation", "activation.json"), 1<<20)
		if err != nil || pqLabFile("", raw).SHA256 != activationPin {
			return nil, errors.New("independent activation pin required")
		}
		var activation PQLabActivation
		if err = pqLabDecode(raw, &activation); err != nil {
			return nil, err
		}
		if activation.ScheduleFile != filepath.Join(root, "activation", "schedule.json") {
			return nil, errors.New("schedule escaped original lab")
		}
		schedule, err := pqLabRead(activation.ScheduleFile, 32<<10)
		if err != nil {
			return nil, err
		}
		engine, err = NewPQEngineAuthorization(schedule, activation.ScheduleHash)
		if err != nil {
			return nil, err
		}
	}
	var witness *validatedMigration
	if entry != nil {
		witness = entry.witness
	} else {
		witness, err = newValidatedMigration(m, b)
		if err != nil {
			return nil, err
		}
	}
	reads := &beforeA88CheckpointRead{witness: witness, engine: engine, height: height, appHash: appHash, metrics: metrics}
	read := func() (CommittedState, error) {
		var first CommittedState
		if entry != nil {
			done := pqLabMeasure(metrics, "checkpoint.staticOriginalReadback")
			e := entry.current()
			done()
			if e != nil {
				return first, e
			}
		}
		for i, n := range p.Nodes {
			endNode := pqLabMeasure(metrics, "checkpoint.nodeReadAndValidate")
			state, e := reads.read(i, n.StatePath, capturePQEngineState)
			endNode()
			if e != nil {
				return CommittedState{}, e
			}
			if i == 0 && state != nil {
				first = *state
			}
		}
		if entry != nil {
			done := pqLabMeasure(metrics, "checkpoint.staticOriginalReadback")
			e := entry.current()
			done()
			if e != nil {
				return CommittedState{}, e
			}
		}
		return first, nil
	}
	endInitial := pqLabMeasure(metrics, "checkpoint.initialFourNodeRead")
	state, err := read()
	endInitial()
	if err != nil {
		return nil, err
	}
	network, err := hex.DecodeString(m.OriginalGenesisHash)
	if err != nil {
		return nil, err
	}
	return &PQLabSenderCheckpoint{state: state, network: network, migrationHash: m.StateHash, current: func() error {
		defer pqLabMeasure(metrics, "checkpoint.currentFourNodeRead")()
		_, err := read()
		return err
	}}, nil
}

type beforeA88CheckpointRead struct {
	witness *validatedMigration
	engine  *PQEngineAuthorization
	height  int64
	appHash string
	metrics *PQLabMetrics
	files   [4]beforeA88CheckpointFingerprint
}

type beforeA88CheckpointFingerprint struct {
	path, layout string
	bytes        int
	hash         [sha256.Size]byte
	validated    bool
}

func (r *beforeA88CheckpointRead) read(index int, path string, capture func(string) (*pqEngineStateRead, error)) (state *CommittedState, result error) {
	if r == nil || index < 0 || index >= len(r.files) || r.witness.valid() != nil {
		return state, errors.New("missing invocation-local checkpoint validation scope")
	}
	done := pqLabMeasure(r.metrics, "checkpoint.captureCurrentBytes")
	original, err := capture(path)
	done()
	if err != nil {
		return state, err
	}
	// Each captured capability is retired exactly once, including hash hits.
	// A mixed/late close failure is never converted into a successful reuse.
	var publish *beforeA88CheckpointFingerprint
	defer func() {
		if original.closeOriginal != nil {
			result = errors.Join(result, original.closeOriginal())
		}
		if result == nil && publish != nil {
			r.files[index] = *publish
		}
	}()
	fingerprint := beforeA88CheckpointFingerprint{path: path, layout: original.layout, bytes: len(original.data), hash: sha256.Sum256(original.data), validated: true}
	prior := r.files[index]
	if prior.validated && prior == fingerprint {
		done := pqLabMeasure(r.metrics, "checkpoint.exactBytesValidationReuse")
		err := original.unchanged()
		done()
		if err != nil {
			return state, err
		}
		// No synthetic state is returned: this branch only confirms exact
		// current original bytes. The actual detached initial state remains
		// in the checkpoint and cannot be reconstructed from this fingerprint.
		return nil, nil
	}
	done = pqLabMeasure(r.metrics, "checkpoint.fullStateValidation")
	// Keep the original decoder and EVERY history/registry/AND check. Its
	// capability close is owned by the outer defer so it cannot run twice.
	copy := *original
	copy.closeOriginal = nil
	decoded, err := readPQEngineCommittedStateOwned(path, r.witness, r.engine, nil, func(string) (*pqEngineStateRead, error) { return &copy, nil })
	done()
	if err != nil {
		return nil, err
	}
	if !decoded.Initialized || decoded.Height != r.height || decoded.AppHash != r.appHash || decoded.AccountPolicy == nil {
		return nil, errors.New("actual four-node checkpoint differs from independently supplied H/AppHash")
	}
	// Do not retain replacement encodings or extend the scope. An alternate
	// valid encoding is accepted after normal validation on every such read.
	if !prior.validated {
		// Closing a supplied original may fail. Publish the fingerprint only
		// after that deferred close has reported success.
		publish = &fingerprint
	}
	return &decoded, nil
}
