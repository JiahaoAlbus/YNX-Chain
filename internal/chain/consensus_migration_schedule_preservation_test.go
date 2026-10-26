package chain

import (
	"bytes"
	"encoding/json"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func pqSchedulePreservationFixture(t *testing.T) (*Devnet, ConsensusMigrationState, ConsensusMigrationState, uint64, string) {
	t.Helper()
	// Reuse the real Faucet/Transfer/multiblock source fixture. Deployment and
	// public verification use the same ordinary contract path/source as the
	// existing persisted-contract regression, before scheduling is enabled.
	d := ownedMigrationSnapshotFixture(t, false)
	const source = "pragma solidity ^0.8.24; contract Persisted { event PersistedEvent(address indexed actor, uint256 amount); }"
	artifact, _, err := d.DeployContract("ynx_owned_export_sender", "Persisted", source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.VerifyContract(artifact.Address, source); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	d.ProduceBlock()
	before, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if before.AccountPolicy != nil || before.Runtime == nil || before.Runtime.Version != devnetSnapshotVersion ||
		len(before.Runtime.Blocks) < 4 || len(before.Runtime.Blocks[1].Transactions) < 2 ||
		len(before.Runtime.Blocks[1].Transactions[0].Logs) == 0 ||
		len(before.Runtime.Blocks[1].Transactions[0].Logs[0].Topics) == 0 ||
		len(before.Runtime.Blocks[1].Transactions[0].LotFlows) == 0 || len(before.Runtime.Contracts) != 1 {
		t.Fatal("real source fixture lacks complete contract/history/nested receipt state")
	}
	enableAt := before.Height + 100
	if err := d.EnableAccountPQ(enableAt); err != nil {
		t.Fatal(err)
	}
	after, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	return d, before, after, enableAt, artifact.Address
}

func pqSchedulePreservationClone(t *testing.T, state ConsensusMigrationState) ConsensusMigrationState {
	t.Helper()
	var clone ConsensusMigrationState
	if err := json.Unmarshal(ownedMigrationJSON(t, state), &clone); err != nil {
		t.Fatal(err)
	}
	return clone
}

func pqSchedulePreservationReseal(t *testing.T, state *ConsensusMigrationState) {
	t.Helper()
	var err error
	state.StateHash, err = state.calculateHash()
	if err != nil {
		t.Fatal(err)
	}
}

func TestConsensusPQSchedulePreservationRealEnableAndReopen(t *testing.T) {
	d, before, after, enableAt, _ := pqSchedulePreservationFixture(t)
	beforeWire, afterWire := ownedMigrationJSON(t, before), ownedMigrationJSON(t, after)
	source := ownedMigrationJSON(t, normalizedConsensusRuntimeSnapshot(d.snapshotLocked()))
	if before.StateHash == after.StateHash {
		t.Fatal("the real added policy/runtime version must change the migration hash")
	}
	if err := VerifyConsensusPQSchedulePreservation(before, after, enableAt); err != nil {
		t.Fatal("real EnableAccountPQ transition rejected:", err)
	}
	if !bytes.Equal(beforeWire, ownedMigrationJSON(t, before)) || !bytes.Equal(afterWire, ownedMigrationJSON(t, after)) ||
		!bytes.Equal(source, ownedMigrationJSON(t, normalizedConsensusRuntimeSnapshot(d.snapshotLocked()))) {
		t.Fatal("preservation validation changed caller or live source state")
	}
	// The actual source-runtime reopen and idempotent configuration path must
	// preserve the whole existing policy, including its original empty values.
	reopened, err := after.RestoreSourceRuntime()
	if err != nil {
		t.Fatal(err)
	}
	if err := reopened.EnableAccountPQ(enableAt); err != nil {
		t.Fatal(err)
	}
	again, err := reopened.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyConsensusPQSchedulePreservation(after, again, enableAt); err != nil {
		t.Fatal("unchanged reopened schedule rejected:", err)
	}
	if err := VerifyConsensusPQSchedulePreservation(after, after, enableAt); err != nil {
		t.Fatal("the same immutable caller object rejected:", err)
	}
	if !bytes.Equal(afterWire, ownedMigrationJSON(t, after)) || !reflect.DeepEqual(after, again) {
		t.Fatal("same-height reopen changed complete typed migration state")
	}
}

func TestConsensusPQSchedulePreservationRejectsResealedStateChanges(t *testing.T) {
	_, before, after, enableAt, contract := pqSchedulePreservationFixture(t)
	beforeWire, afterWire := ownedMigrationJSON(t, before), ownedMigrationJSON(t, after)
	changeAccount := func(s *ConsensusMigrationState, balance bool) {
		address := "ynx_owned_export_sender"
		for i := range s.Accounts {
			if s.Accounts[i].Address == address {
				if balance {
					s.Accounts[i].Balance++
					s.Runtime.Accounts[address].Balance++
					s.LiquidSupplyYNXT++
				} else {
					s.Accounts[i].Nonce++
					s.Runtime.Accounts[address].Nonce++
				}
				return
			}
		}
		t.Fatal("source account missing")
	}
	for name, mutate := range map[string]func(*ConsensusMigrationState){
		"balance and supply": func(s *ConsensusMigrationState) { changeAccount(s, true) },
		"nonce":              func(s *ConsensusMigrationState) { changeAccount(s, false) },
		"account address": func(s *ConsensusMigrationState) {
			old, next := "ynx_owned_export_sender", "ynx_owned_export_sender_changed"
			a := s.Runtime.Accounts[old]
			delete(s.Runtime.Accounts, old)
			a.Address = next
			s.Runtime.Accounts[next] = a
			for i := range s.Accounts {
				if s.Accounts[i].Address == old {
					s.Accounts[i].Address = next
				}
			}
			sort.Slice(s.Accounts, func(i, j int) bool { return s.Accounts[i].Address < s.Accounts[j].Address })
		},
		"contract storage": func(s *ConsensusMigrationState) {
			a := s.Runtime.Contracts[contract]
			if a.RuntimeStorage == nil {
				a.RuntimeStorage = make(map[string]string)
			}
			a.RuntimeStorage["preservation-change"] = "1"
			s.Runtime.Contracts[contract] = a
		},
		"contract metadata": func(s *ConsensusMigrationState) {
			a := s.Runtime.Contracts[contract]
			a.VerifierStatus = "changed-verifier-evidence"
			s.Runtime.Contracts[contract] = a
		},
		"constructor arguments": func(s *ConsensusMigrationState) {
			a := s.Runtime.Contracts[contract]
			a.ConstructorArgs = append(a.ConstructorArgs, "changed-argument")
			s.Runtime.Contracts[contract] = a
		},
		"transaction payload": func(s *ConsensusMigrationState) { s.Runtime.Blocks[1].Transactions[0].Amount++ },
		"transaction nonce":   func(s *ConsensusMigrationState) { s.Runtime.Blocks[1].Transactions[0].Nonce++ },
		"transaction hash":    func(s *ConsensusMigrationState) { s.Runtime.Blocks[1].Transactions[0].Hash = strings.Repeat("a", 64) },
		"transaction order": func(s *ConsensusMigrationState) {
			s.Runtime.Blocks[1].Transactions[0], s.Runtime.Blocks[1].Transactions[1] = s.Runtime.Blocks[1].Transactions[1], s.Runtime.Blocks[1].Transactions[0]
		},
		"receipt memo": func(s *ConsensusMigrationState) { s.Runtime.Blocks[1].Transactions[0].Memo = "changed receipt memo" },
		"receipt topic": func(s *ConsensusMigrationState) {
			s.Runtime.Blocks[1].Transactions[0].Logs[0].Topics[0] = "changed topic"
		},
		"receipt data":     func(s *ConsensusMigrationState) { s.Runtime.Blocks[1].Transactions[0].Logs[0].Data = "0x1234" },
		"receipt lot flow": func(s *ConsensusMigrationState) { s.Runtime.Blocks[1].Transactions[0].LotFlows[0].Amount++ },
		"historical block time": func(s *ConsensusMigrationState) {
			s.Runtime.Blocks[2].Time = s.Runtime.Blocks[2].Time.Add(time.Nanosecond)
		},
		"historical block hash": func(s *ConsensusMigrationState) {
			s.Runtime.Blocks[2].Hash = strings.Repeat("b", 64)
			s.Runtime.Blocks[3].ParentHash = s.Runtime.Blocks[2].Hash
		},
		"network metadata":              func(s *ConsensusMigrationState) { s.Network.Name += " changed"; s.Runtime.Config = s.Network },
		"checkpoint time":               func(s *ConsensusMigrationState) { s.Runtime.SavedAt = time.Unix(123, 0).UTC() },
		"checkpoint integrity metadata": func(s *ConsensusMigrationState) { s.Runtime.StateIntegrity = "changed-original-metadata" },
		"peer metadata":                 func(s *ConsensusMigrationState) { s.Runtime.Peers = map[string]ValidatorPeer{"changed": {}} },
		"peer sync metadata":            func(s *ConsensusMigrationState) { s.Runtime.PeerSyncs = map[string]ValidatorPeerSync{"changed": {}} },
		"validator observation":         func(s *ConsensusMigrationState) { s.Runtime.Validators[0].PeerStatus = "changed-original-status" },
		"resource policy notes": func(s *ConsensusMigrationState) {
			s.ResourcePolicy.Notes[0] = "changed-original-policy-note"
			s.ResourcePolicy.PolicyHash = resourcePolicyHash(s.ResourcePolicy)
			s.Runtime.Policy = s.ResourcePolicy
		},
		"typed optional map": func(s *ConsensusMigrationState) {
			if len(s.Runtime.PQBatches) != 0 {
				t.Fatal("unexpected original PQ batch")
			}
			if s.Runtime.PQBatches == nil {
				s.Runtime.PQBatches = map[string]PQBatchProof{}
			} else {
				s.Runtime.PQBatches = nil
			}
		},
		"typed materials map": func(s *ConsensusMigrationState) {
			if len(s.ContractMaterials) != 0 {
				t.Fatal("unexpected built-in compiler material")
			}
			if s.ContractMaterials == nil {
				s.ContractMaterials = map[string]ConsensusContractMaterial{}
			} else {
				s.ContractMaterials = nil
			}
		},
		"noncanonical empty records": func(s *ConsensusMigrationState) {
			s.AccountPolicy.Records = []ynxauth.Record{}
			s.Runtime.AccountPolicy.Records = []ynxauth.Record{}
		},
		"noncanonical empty revocations": func(s *ConsensusMigrationState) {
			s.AccountPolicy.Revocations = []ynxauth.RevocationRecord{}
			s.Runtime.AccountPolicy.Revocations = []ynxauth.RevocationRecord{}
		},
	} {
		t.Run(name, func(t *testing.T) {
			candidate := pqSchedulePreservationClone(t, after)
			mutate(&candidate)
			pqSchedulePreservationReseal(t, &candidate)
			// These changes remain individually valid. The new independent
			// comparison must reject them after the ordinary full validation.
			if err := candidate.Validate(); err != nil {
				t.Fatal("tamper control must still pass original full Validate:", err)
			}
			candidateWire := ownedMigrationJSON(t, candidate)
			if err := VerifyConsensusPQSchedulePreservation(before, candidate, enableAt); err == nil {
				t.Fatal("resealed changed state accepted as schedule-only preservation")
			}
			if err := VerifyConsensusPQSchedulePreservation(after, candidate, enableAt); err == nil {
				t.Fatal("resealed changed state accepted as unchanged existing schedule")
			}
			if !bytes.Equal(candidateWire, ownedMigrationJSON(t, candidate)) ||
				!bytes.Equal(beforeWire, ownedMigrationJSON(t, before)) || !bytes.Equal(afterWire, ownedMigrationJSON(t, after)) {
				t.Fatal("rejection changed a caller object or a shared nested source")
			}
		})
	}
}

func TestConsensusPQSchedulePreservationRejectsWrongHeightAndPolicy(t *testing.T) {
	_, before, after, enableAt, _ := pqSchedulePreservationFixture(t)
	for _, height := range []uint64{0, before.Height - 1, before.Height, enableAt - 1, enableAt + 1} {
		if err := VerifyConsensusPQSchedulePreservation(before, after, height); err == nil {
			t.Fatalf("wrong explicit height %d accepted", height)
		}
		if err := VerifyConsensusPQSchedulePreservation(after, after, height); err == nil {
			t.Fatalf("existing schedule accepted wrong explicit height %d", height)
		}
	}
	for name, mutate := range map[string]func(*ConsensusMigrationState){
		"wrong height": func(s *ConsensusMigrationState) { s.AccountPolicy.EnableAt++; s.Runtime.AccountPolicy.EnableAt++ },
		"wrong genesis": func(s *ConsensusMigrationState) {
			s.AccountPolicy.NetworkID[0] ^= 1
			s.Runtime.AccountPolicy.NetworkID[0] ^= 1
		},
		"omitted policy": func(s *ConsensusMigrationState) {
			s.AccountPolicy = nil
			s.Runtime.AccountPolicy = nil
			s.Runtime.Version = devnetSnapshotVersion
		},
		"populated policy": func(s *ConsensusMigrationState) {
			r := ynxauth.Record{AlgorithmVersion: ynxbatch.Version, Owner: "0x" + strings.Repeat("1", 40),
				PKA: make([]byte, ynxbatch.PublicKeyASize), PKB: make([]byte, ynxbatch.PublicKeyBSize),
				Revision: 1, RegisteredAt: enableAt, ActiveFrom: enableAt + 1, LedgerNonce: 1}
			s.AccountPolicy.Records = []ynxauth.Record{r}
			s.Runtime.AccountPolicy = cloneAccountPolicy(s.AccountPolicy)
		},
		"populated revocations": func(s *ConsensusMigrationState) {
			s.AccountPolicy.Revocations = []ynxauth.RevocationRecord{{}}
			s.Runtime.AccountPolicy = cloneAccountPolicy(s.AccountPolicy)
		},
		"runtime version":              func(s *ConsensusMigrationState) { s.Runtime.Version = devnetSnapshotVersion },
		"runtime policy contradiction": func(s *ConsensusMigrationState) { s.Runtime.AccountPolicy.EnableAt++ },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := pqSchedulePreservationClone(t, after)
			mutate(&candidate)
			pqSchedulePreservationReseal(t, &candidate)
			wire := ownedMigrationJSON(t, candidate)
			if err := VerifyConsensusPQSchedulePreservation(before, candidate, enableAt); err == nil {
				t.Fatal("unsupported schedule/policy transition accepted")
			}
			if err := VerifyConsensusPQSchedulePreservation(after, candidate, enableAt); err == nil {
				t.Fatal("existing policy rewrite/removal accepted")
			}
			if !bytes.Equal(wire, ownedMigrationJSON(t, candidate)) {
				t.Fatal("invalid policy rejection mutated caller")
			}
		})
	}
}

func TestConsensusPQSchedulePreservationRequiresBothCompleteValidStates(t *testing.T) {
	_, before, after, enableAt, _ := pqSchedulePreservationFixture(t)
	for _, side := range []string{"before", "after"} {
		for _, kind := range []string{"state hash", "missing runtime", "legacy migration"} {
			t.Run(side+"/"+kind, func(t *testing.T) {
				left, right := pqSchedulePreservationClone(t, before), pqSchedulePreservationClone(t, after)
				candidate := &left
				if side == "after" {
					candidate = &right
				}
				switch kind {
				case "state hash":
					candidate.StateHash = strings.Repeat("0", 64)
				case "missing runtime":
					candidate.Runtime = nil
					pqSchedulePreservationReseal(t, candidate)
				case "legacy migration":
					candidate.Version, candidate.SourceFormat = LegacyConsensusMigrationVersion, "ynx-devnet-state-v1"
					candidate.Runtime, candidate.AccountPolicy, candidate.ContractMaterials = nil, nil, nil
					candidate.OriginalGenesisHash = ""
					pqSchedulePreservationReseal(t, candidate)
					if err := candidate.Validate(); err != nil {
						t.Fatal("legacy control must be independently valid:", err)
					}
				}
				leftWire, rightWire := ownedMigrationJSON(t, left), ownedMigrationJSON(t, right)
				if err := VerifyConsensusPQSchedulePreservation(left, right, enableAt); err == nil {
					t.Fatal("incomplete/invalid source or target accepted")
				}
				if !bytes.Equal(leftWire, ownedMigrationJSON(t, left)) || !bytes.Equal(rightWire, ownedMigrationJSON(t, right)) {
					t.Fatal("validation failure changed caller")
				}
			})
		}
	}
	oldRuntime := pqSchedulePreservationClone(t, before)
	oldRuntime.Runtime.Version = legacyDevnetSnapshotVersion
	pqSchedulePreservationReseal(t, &oldRuntime)
	if err := oldRuntime.Validate(); err != nil {
		t.Fatal("old runtime control must remain independently valid:", err)
	}
	if err := VerifyConsensusPQSchedulePreservation(oldRuntime, after, enableAt); err == nil {
		t.Fatal("unsupported v1 runtime accepted as the original v2 schedule transition")
	}
}
