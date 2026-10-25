package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func pqABCIContractMaterial(t *testing.T, name string) (string, chain.ConsensusContractMaterial, ynxauth.ContractDeployPayload) {
	t.Helper()
	dir := "devtools"
	initial := uint64(7)
	if name == ynxauth.ContractERC20Name {
		dir = "tokens"
		initial = 1000000
	}
	rel := filepath.Join("contracts", dir, name+".sol")
	source, err := os.ReadFile(filepath.Join("..", "..", rel))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join("..", "..", "artifacts", rel, name+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var actual struct {
		BuildInfoID      string `json:"buildInfoId"`
		DeployedBytecode string `json:"deployedBytecode"`
	}
	if err = json.Unmarshal(raw, &actual); err != nil {
		t.Fatal(err)
	}
	build, err := os.ReadFile(filepath.Join("..", "..", "artifacts", "build-info", actual.BuildInfoID+".json"))
	if err != nil {
		t.Fatal(err)
	}
	trimmed := strings.TrimSpace(string(source))
	sourceHash, codeHash, err := chain.ValidateBoundedPinnedContract(name, trimmed, actual.DeployedBytecode)
	if err != nil {
		t.Fatal(err)
	}
	return trimmed, chain.ConsensusContractMaterial{ArtifactFile: raw, BuildInfoFile: build}, ynxauth.ContractDeployPayload{Name: name, SourceHash: sourceHash, DeployedBytecodeHash: codeHash, CompilerConfigHash: chain.SolidityCompilerConfig().ConfigHash, ConstructorArgs: []uint64{initial}}
}

func pqABCIContractWire(t *testing.T, f *abciRevocationFixture, key *ynxbatch.PrivateKey, owner, kind string, payload any, nonce, fee uint64) []byte {
	t.Helper()
	body, err := ynxauth.EncodeActionPayload(kind, payload)
	if err != nil {
		t.Fatal(err)
	}
	message, err := (ynxauth.Action{ChainID: f.network, NativeChainID: uint64(f.m.Network.ChainID), Owner: owner, Nonce: nonce, Fee: fee, Kind: kind, Payload: body}).SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	_, wire := consensusPQProof(t, key, f.network, owner, ynxauth.TransactionPurpose, message)
	return wire
}

func pqABCIContractCall(t *testing.T, f *abciRevocationFixture, artifact chain.ContractArtifact, data string, nonce uint64) []byte {
	t.Helper()
	commitment, err := chain.ContractExecutionStateCommitment(artifact)
	if err != nil {
		t.Fatal(err)
	}
	p := ynxauth.ContractExecutePayload{Name: artifact.Name, Target: artifact.Address, SourceHash: artifact.SourceHash, DeployedBytecodeHash: artifact.DeployedBytecodeHash, CompilerConfigHash: artifact.CompilerConfigHash, ExpectedStorageCommitment: commitment, Calldata: data}
	wire := pqABCIContractWire(t, f, f.key, f.owner, ynxauth.ActionContractExecute, p, nonce, ynxauth.ContractExecuteFee)
	raw, err := EncodePQContractTransaction(wire, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func pqABCIContractData(name, recipient string, n uint64) string {
	if name == ynxauth.ContractCounterName {
		return "0x7cf5dab0" + fmt.Sprintf("%064x", n)
	}
	return "0xa9059cbb" + strings.Repeat("0", 24) + recipient[2:] + fmt.Sprintf("%064x", n)
}

func pqABCIContractBlock(t *testing.T, a *Application, height int64, raw ...[]byte) {
	t.Helper()
	ctx := context.Background()
	at := time.Date(2030, 1, 1, 0, 0, int(height), 0, time.UTC)
	before := mustJSON(t, a.committed)
	if len(raw) == 1 {
		check, err := a.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: raw[0]})
		if err != nil || check.Code != 0 {
			t.Fatalf("real contract CheckTx: %+v %v", check, err)
		}
	}
	prepared, err := a.PrepareProposal(ctx, &abcitypes.RequestPrepareProposal{Height: height, Time: at, Txs: raw, MaxTxBytes: math.MaxInt64})
	if err != nil || len(prepared.Txs) != len(raw) {
		t.Fatalf("contract prepare: %+v %v", prepared, err)
	}
	proposal, err := a.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: height, Time: at, Txs: raw})
	if err != nil || proposal.Status != abcitypes.ResponseProcessProposal_ACCEPT {
		t.Fatalf("contract process: %+v %v", proposal, err)
	}
	if !bytes.Equal(before, mustJSON(t, a.committed)) {
		t.Fatal("read-only proposal admission changed committed contract state")
	}
	commitSponsorBlock(t, a, height, at, raw...)
}

func pqABCIContractDeploy(t *testing.T, f *abciRevocationFixture, name string) (chain.ContractArtifact, []byte) {
	t.Helper()
	source, material, p := pqABCIContractMaterial(t, name)
	nonce := queryConsensusAccount(t, f.a, f.owner).Nonce + 1
	wire := pqABCIContractWire(t, f, f.key, f.owner, ynxauth.ActionContractDeploy, p, nonce, ynxauth.ContractDeployFee)
	raw, err := EncodePQContractTransaction(wire, source, &material)
	if err != nil {
		t.Fatal(err)
	}
	pqABCIContractBlock(t, f.a, f.a.committed.Height+1, raw)
	entry := f.a.committed.PQHistory[len(f.a.committed.PQHistory)-1]
	artifact, err := f.a.PQContractArtifact(entry.Transaction.To)
	if err != nil {
		t.Fatal(err)
	}
	if artifact.PQAnchorTransactionHash != SignedTransactionHash(wire) || artifact.CompilerArtifact == nil || entry.Transaction.Fee != 10 {
		t.Fatal("PQ deployment lacks original Member identity, actual compiler artifact or fee")
	}
	return artifact, raw
}

func pqABCIClassicCall(t *testing.T, f *abciRevocationFixture, address, data string, nonce uint64, key string) []byte {
	p := IDEContractCallPayload{Address: address, Calldata: data, IdempotencyKey: key}
	p.RequestHash = IDECallRequestHash(p.Address, p.Calldata, p.IdempotencyKey)
	return mustIDEAction(t, f.otherClassic, ActionIDEContractCall, p, nonce)
}

func TestABCIRealPQContractDeployCallsClassicInterleavingRevocationAndRestart(t *testing.T) {
	for _, name := range []string{ynxauth.ContractCounterName, ynxauth.ContractERC20Name} {
		t.Run(name, func(t *testing.T) {
			f := newABCIRevocationFixture(t)
			pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
			start := queryConsensusAccount(t, f.a, f.owner)
			artifact, _ := pqABCIContractDeploy(t, f, name)
			amount := uint64(5)
			if name == ynxauth.ContractERC20Name {
				amount = 250
			}
			first := pqABCIContractCall(t, f, artifact, pqABCIContractData(name, f.other, amount), 3)
			pqABCIContractBlock(t, f.a, 4, first)
			legacyAmount := uint64(3)
			if name == ynxauth.ContractERC20Name {
				legacyAmount = 50
			}
			classic := pqABCIClassicCall(t, f, artifact.Address, pqABCIContractData(name, f.owner, legacyAmount), 1, "pq-interleave-legacy")
			otherBefore := queryConsensusAccount(t, f.a, f.other)
			pqABCIContractBlock(t, f.a, 5, classic)
			otherAfter := queryConsensusAccount(t, f.a, f.other)
			if otherAfter.Nonce != otherBefore.Nonce+1 || otherAfter.Balance != otherBefore.Balance-1 {
				t.Fatal("ABCI classic contract fee/nonce semantics silently changed")
			}
			cold, err := NewPersistentApplication(f.m, f.path)
			if err != nil {
				t.Fatalf("cold restore with latest classic call: %v", err)
			}
			if !bytes.Equal(mustJSON(t, cold.committed), mustJSON(t, f.a.committed)) {
				t.Fatal("cold restore changed complete contract state")
			}
			f.a = cold
			artifact, err = f.a.PQContractArtifact(artifact.Address)
			if err != nil {
				t.Fatal(err)
			}
			lastAmount := uint64(2)
			if name == ynxauth.ContractERC20Name {
				lastAmount = 10
			}
			last := pqABCIContractCall(t, f, artifact, pqABCIContractData(name, f.other, lastAmount), 4)
			pqABCIContractBlock(t, f.a, 6, last)
			after := queryConsensusAccount(t, f.a, f.owner)
			if after.Balance != start.Balance-14 || after.Nonce != start.Nonce+3 || after.ResourceUsage.BandwidthUsed != start.ResourceUsage.BandwidthUsed+3 || after.ResourceUsage.ComputeUsed != start.ResourceUsage.ComputeUsed+7 {
				t.Fatal("PQ fees, exact nonce and resources were not executed")
			}
			artifact, err = f.a.PQContractArtifact(artifact.Address)
			if err != nil {
				t.Fatal(err)
			}
			contract := contractAfterQuery(t, f.a, artifact.Address)
			if name == ynxauth.ContractCounterName {
				if artifact.RuntimeStorage[fmt.Sprintf("0x%064x", 0)] != fmt.Sprintf("0x%064x", 17) {
					t.Fatal("counter did not replay all real writes")
				}
			} else {
				for address, want := range map[string]uint64{f.owner: 999790, f.other: 210} {
					result, _, err := chain.CallConsensusSourceContract(artifact, contract.DeployedBytecode, "0x70a08231"+strings.Repeat("0", 24)+address[2:], artifact.RuntimeStorage)
					if err != nil || result != fmt.Sprintf("0x%064x", want) {
						t.Fatalf("actual ERC20 balances: %s %s %v", address, result, err)
					}
				}
			}
			pqABCIContractBlock(t, f.a, 7, mustPQEnvelope(t, PQRevocationType, f.revocation(t, 5, 7, 1)))
			pqABCIContractRejected(t, f.a, pqABCIContractCall(t, f, artifact, pqABCIContractData(name, f.other, 1), 6))
			ownerClassic := IDEContractCallPayload{Address: artifact.Address, Calldata: pqABCIContractData(name, f.other, 1), IdempotencyKey: "revoked-classic"}
			ownerClassic.RequestHash = IDECallRequestHash(ownerClassic.Address, ownerClassic.Calldata, ownerClassic.IdempotencyKey)
			pqABCIContractRejected(t, f.a, mustIDEAction(t, f.classic, ActionIDEContractCall, ownerClassic, 6))
			pqABCIContractBlock(t, f.a, 8, pqABCIClassicCall(t, f, artifact.Address, pqABCIContractData(name, f.owner, 1), 2, "unmigrated-after-revoke"))
			if _, err := NewPersistentApplication(f.m, f.path); err != nil {
				t.Fatalf("future revocation erased lawful historical calls: %v", err)
			}
		})
	}
}

func pqABCIContractRejected(t *testing.T, a *Application, raw []byte) {
	t.Helper()
	before := mustJSON(t, a.committed)
	check, err := a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: raw})
	if err != nil || check.Code == 0 {
		t.Fatalf("unauthorized/stale contract action accepted: %+v %v", check, err)
	}
	if !bytes.Equal(before, mustJSON(t, a.committed)) {
		t.Fatal("rejected action changed complete committed state")
	}
	if a.statePath != "" {
		disk, err := os.ReadFile(a.statePath)
		if err == nil {
			var saved CommittedState
			if json.Unmarshal(disk, &saved) != nil || saved.AppHash != a.committed.AppHash {
				t.Fatal("rejection changed persisted state")
			}
		}
	}
}

func TestABCIPQContractOriginalANDProofAndAtomicNegativeCases(t *testing.T) {
	f := newABCIRevocationFixture(t)
	source, material, p := pqABCIContractMaterial(t, ynxauth.ContractCounterName)
	wire := pqABCIContractWire(t, f, f.key, f.owner, ynxauth.ActionContractDeploy, p, 2, 10)
	raw, err := EncodePQContractTransaction(wire, source, &material)
	if err != nil {
		t.Fatal(err)
	}
	pqABCIContractRejected(t, f.a, raw) // no migration/activation yet
	pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	for _, component := range []string{"A", "B"} {
		t.Run(component, func(t *testing.T) {
			member, err := ynxbatch.DecodeMember(wire)
			if err != nil {
				t.Fatal(err)
			}
			if component == "A" {
				member.Certificate.SigmaA[0] ^= 1
			} else {
				member.Certificate.SigmaB[0] ^= 1
			}
			bad, err := ynxbatch.EncodeMember(member)
			if err != nil {
				t.Fatal(err)
			}
			transport, err := EncodePQContractTransaction(bad, source, &material)
			if err != nil {
				t.Fatal(err)
			}
			pqABCIContractRejected(t, f.a, transport)
		})
	}
	for _, tc := range []struct {
		name, owner string
		nonce, fee  uint64
	}{{"wrong-owner", f.other, 1, 10}, {"wrong-nonce", f.owner, 3, 10}, {"wrong-fee", f.owner, 2, 2}} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.name == "wrong-fee" {
				// The canonical constructor correctly refuses fee 2. Sign the
				// deliberately malformed message with the real current pair so
				// admission, rather than this legal-action helper, rejects it.
				member, err := ynxbatch.DecodeMember(wire)
				if err != nil {
					t.Fatal(err)
				}
				fields, err := ynxbatch.DecodeFields(member.Message, 12, ynxauth.MaxActionBytes)
				if err != nil {
					t.Fatal(err)
				}
				fields[8], fields[9] = ynxbatch.U32(0), ynxbatch.U32(uint32(tc.fee))
				message, err := ynxbatch.EncodeFields(fields...)
				if err != nil {
					t.Fatal(err)
				}
				_, malformed := consensusPQProof(t, f.key, f.network, f.owner, ynxauth.TransactionPurpose, message)
				bad, err := json.Marshal(PQContractTransaction{Version: 1, Type: PQActionType, WireHex: fmt.Sprintf("%x", malformed), Source: source, Material: &material})
				if err != nil {
					t.Fatal(err)
				}
				pqABCIContractRejected(t, f.a, bad)
				return
			}
			wire := pqABCIContractWire(t, f, f.key, tc.owner, ynxauth.ActionContractDeploy, p, tc.nonce, tc.fee)
			bad, err := EncodePQContractTransaction(wire, source, &material)
			if err != nil {
				t.Fatal(err)
			}
			pqABCIContractRejected(t, f.a, bad)
		})
	}
	badMaterial := material
	badMaterial.ArtifactFile = bytes.Replace(material.ArtifactFile, []byte(p.Name), []byte("UnregisteredContract"), 1)
	bad, err := EncodePQContractTransaction(wire, source, &badMaterial)
	if err != nil {
		t.Fatal(err)
	}
	pqABCIContractRejected(t, f.a, bad)
	for _, mode := range []string{"creation", "ABI", "forged-build"} {
		t.Run(mode, func(t *testing.T) {
			modified := chain.ConsensusContractMaterial{ArtifactFile: bytes.Clone(material.ArtifactFile), BuildInfoFile: bytes.Clone(material.BuildInfoFile)}
			var actual struct {
				Bytecode string `json:"bytecode"`
			}
			if err := json.Unmarshal(material.ArtifactFile, &actual); err != nil {
				t.Fatal(err)
			}
			if mode == "ABI" {
				modified.ArtifactFile = bytes.Replace(modified.ArtifactFile, []byte("\"initialCount\""), []byte("\"forgedInitialCount\""), 1)
			} else {
				modified.ArtifactFile = bytes.Replace(modified.ArtifactFile, []byte(actual.Bytecode), []byte("0x60006000f3"), 1)
				if mode == "forged-build" {
					var forged map[string]any
					if err := json.Unmarshal(modified.BuildInfoFile, &forged); err != nil {
						t.Fatal(err)
					}
					forged["output"] = map[string]any{"contracts": map[string]any{"contracts/devtools/SampleEVMWriteCounter.sol": map[string]any{p.Name: map[string]any{"evm": map[string]any{"bytecode": map[string]any{"object": "60006000f3"}}}}}}
					var err error
					modified.BuildInfoFile, err = json.Marshal(forged)
					if err != nil {
						t.Fatal(err)
					}
				}
			}
			if bytes.Equal(modified.ArtifactFile, material.ArtifactFile) {
				t.Fatal("tamper did not change actual compiler file")
			}
			transport, err := EncodePQContractTransaction(wire, source, &modified)
			if err != nil {
				t.Fatal(err)
			}
			pqABCIContractRejected(t, f.a, transport)
		})
	}
	for _, mode := range []string{"balance", "trace-lots", "bandwidth", "compute", "recipient-overflow", "alias"} {
		t.Run(mode, func(t *testing.T) {
			state := f.a.cloneExecutionState()
			i, _ := accountIndex(state.accounts, f.owner)
			j, _ := accountIndex(state.accounts, f.a.feeRecipient)
			switch mode {
			case "balance":
				state.accounts[i].Balance = 9
			case "trace-lots":
				state.accounts[i].Lots = map[string]int64{}
			case "bandwidth":
				state.accounts[i].ResourceUsage.BandwidthUsed = math.MaxInt64
			case "compute":
				state.accounts[i].ResourceUsage.ComputeUsed = math.MaxInt64 - 4
			case "recipient-overflow":
				state.accounts[j].Balance = math.MaxInt64 - 9
			case "alias":
			}
			app := &Application{migration: f.m, feeRecipient: f.a.feeRecipient}
			if mode == "alias" {
				app.feeRecipient = f.owner
				state.accounts[i].Balance = math.MaxInt64
			}
			before := mustJSON(t, state.accounts)
			next, _, err := app.applyPQContractAction(state, raw, 3, time.Date(2030, 1, 1, 0, 0, 3, 0, time.UTC))
			if mode == "alias" {
				if err != nil {
					t.Fatal(err)
				}
				if next.accounts[i].Balance != math.MaxInt64 || next.accounts[i].Nonce != 2 {
					t.Fatal("fee self-payment overflowed or skipped nonce")
				}
			} else if err == nil {
				t.Fatal("invalid fee/resource candidate accepted")
			}
			if !bytes.Equal(before, mustJSON(t, state.accounts)) {
				t.Fatal("candidate failure/alias mutated input account state")
			}
		})
	}
	pqABCIContractBlock(t, f.a, 3, raw)
	pqABCIContractRejected(t, f.a, raw)
	address := f.a.committed.PQHistory[len(f.a.committed.PQHistory)-1].Transaction.To
	artifact, err := f.a.PQContractArtifact(address)
	if err != nil {
		t.Fatal(err)
	}
	call := pqABCIContractCall(t, f, artifact, pqABCIContractData(artifact.Name, f.other, 1), 3)
	pqABCIContractBlock(t, f.a, 4, call)
	pqABCIContractRejected(t, f.a, pqABCIContractCall(t, f, artifact, pqABCIContractData(artifact.Name, f.other, 1), 4))
}

func TestABCIPQContractHistoryRejectsResealedExecutionAndFeeTampering(t *testing.T) {
	f := newABCIRevocationFixture(t)
	pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	artifact, _ := pqABCIContractDeploy(t, f, ynxauth.ContractCounterName)
	pqABCIContractBlock(t, f.a, 4, pqABCIContractCall(t, f, artifact, pqABCIContractData(artifact.Name, f.other, 5), 3))
	pqABCIContractBlock(t, f.a, 5, pqABCIClassicCall(t, f, artifact.Address, pqABCIContractData(artifact.Name, f.owner, 3), 1, "history-classic"))
	base := mustJSON(t, f.a.committed)
	for _, mode := range []string{"prestate", "transition", "receipt-result", "receipt-write", "log", "order", "final-storage", "immutable-owner", "unsigned-resource", "resources", "fee-flow", "fee-event", "erase-proof"} {
		t.Run(mode, func(t *testing.T) {
			var s CommittedState
			if err := json.Unmarshal(base, &s); err != nil {
				t.Fatal(err)
			}
			entry := &s.PQHistory[len(s.PQHistory)-1]
			i, _ := bftContractIndex(s.Contracts, artifact.Address)
			rindex, _ := bftEVMReceiptIndex(s.EVMReceipts, entry.ABCITransactionHash)
			switch mode {
			case "prestate", "transition":
				h, _, _, err := decodePQContractHistory(entry.Transaction)
				if err != nil {
					t.Fatal(err)
				}
				if mode == "prestate" {
					h.Receipt.Artifact.RuntimeStorage[fmt.Sprintf("0x%064x", 0)] = fmt.Sprintf("0x%064x", 99)
				} else {
					h.Receipt.Transition.Storage[fmt.Sprintf("0x%064x", 0)] = fmt.Sprintf("0x%064x", 99)
				}
				entry.Transaction.Memo, err = encodePQContractHistory(h.Transport, h.Receipt)
				if err != nil {
					t.Fatal(err)
				}
			case "receipt-result":
				s.EVMReceipts[rindex].EncodedResult = fmt.Sprintf("0x%064x", 99)
			case "receipt-write":
				s.EVMReceipts[rindex].StorageWrites[0].NewValue = fmt.Sprintf("0x%064x", 99)
			case "log":
				s.EVMReceipts[rindex].Logs[0].Data = fmt.Sprintf("0x%064x", 99)
				s.EVMReceipts[rindex].Logs[0].AuditHash = bftEVMLogAuditHash(s.EVMReceipts[rindex].Logs[0])
				s.EVMLogs[0] = s.EVMReceipts[rindex].Logs[0]
			case "order":
				s.EVMLogs[0], s.EVMLogs[1] = s.EVMLogs[1], s.EVMLogs[0]
			case "final-storage":
				s.Contracts[i].RuntimeStorage[fmt.Sprintf("0x%064x", 0)] = fmt.Sprintf("0x%064x", 99)
			case "immutable-owner":
				s.Contracts[i].Deployer = f.other
			case "unsigned-resource":
				entry.Transaction.Sponsor = f.other
			case "resources":
				ownerIndex, _ := accountIndex(s.Accounts, f.owner)
				s.Accounts[ownerIndex].ResourceUsage.ComputeUsed = 0
			case "fee-flow":
				entry.Transaction.LotFlows[0].Amount = -2
			case "fee-event":
				for j := range s.FeeEvents {
					if s.FeeEvents[j].TxHash == entry.ABCITransactionHash {
						s.FeeEvents[j].GrossFeeYNXT = 1
						s.FeeEvents[j].AuditHash = feeEventAuditHash(s.FeeEvents[j])
					}
				}
			case "erase-proof":
				s.PQHistory = s.PQHistory[:len(s.PQHistory)-1]
			}
			s.Contracts[i].AuditHash = bftContractAuditHash(s.Contracts[i])
			s.EVMReceipts[rindex].AuditHash = bftEVMReceiptAuditHash(s.EVMReceipts[rindex])
			var err error
			s.AppHash, err = s.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			if err = s.Validate(f.m); err == nil {
				t.Fatal("resealed corrupted complete contract history accepted")
			}
		})
	}
}

func TestABCIPQContractNewDeploymentAndCallInSameBlockPreserveContinuity(t *testing.T) {
	f := newABCIRevocationFixture(t)
	pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	source, material, p := pqABCIContractMaterial(t, ynxauth.ContractCounterName)
	wire := pqABCIContractWire(t, f, f.key, f.owner, ynxauth.ActionContractDeploy, p, 2, 10)
	deploy, err := EncodePQContractTransaction(wire, source, &material)
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2030, 1, 1, 0, 0, 3, 0, time.UTC)
	candidate, _, err := f.a.applyPQContractAction(f.a.cloneExecutionState(), deploy, 3, at)
	if err != nil {
		t.Fatal(err)
	}
	address := candidate.pqHistory[len(candidate.pqHistory)-1].Transaction.To
	artifact, _, err := pqCurrentContractArtifact(candidate.contracts, candidate.legacyContracts, candidate.pqHistory, address)
	if err != nil {
		t.Fatal(err)
	}
	call := pqABCIContractCall(t, f, artifact, pqABCIContractData(artifact.Name, f.other, 5), 3)
	pqABCIContractBlock(t, f.a, 3, deploy, call)
	cold, err := NewPersistentApplication(f.m, f.path)
	if err != nil {
		t.Fatal(err)
	}
	got, err := cold.PQContractArtifact(address)
	if err != nil {
		t.Fatal(err)
	}
	if got.RuntimeStorage[fmt.Sprintf("0x%064x", 0)] != fmt.Sprintf("0x%064x", 12) {
		t.Fatal("same-block deploy/call failed to retain real runtime state")
	}
	before := mustJSON(t, cold.committed)
	got.CompilerArtifact.ABIHash = strings.Repeat("0", 64)
	got.RuntimeStorageSlots["count"] = 99
	got.RuntimeStorage[fmt.Sprintf("0x%064x", 0)] = fmt.Sprintf("0x%064x", 99)
	if !bytes.Equal(before, mustJSON(t, cold.committed)) {
		t.Fatal("read-only full artifact query leaked mutable committed aliases")
	}
	var next CommittedState
	if err = json.Unmarshal(before, &next); err != nil {
		t.Fatal(err)
	}
	next.PQHistory = next.PQHistory[:len(next.PQHistory)-1]
	if err = validateConsensusPQContinuation(cold.committed, next); err == nil {
		t.Fatal("live continuation deleted a known original contract proof")
	}
	pqABCIContractRejected(t, cold, deploy)
}

func TestABCIPQContractCommitFailurePreservesOriginalCandidateAndUnknown(t *testing.T) {
	for _, phase := range []string{"before", "after"} {
		t.Run(phase, func(t *testing.T) {
			f := newABCIRevocationFixture(t)
			pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
			source, material, p := pqABCIContractMaterial(t, ynxauth.ContractCounterName)
			wire := pqABCIContractWire(t, f, f.key, f.owner, ynxauth.ActionContractDeploy, p, 2, 10)
			raw, err := EncodePQContractTransaction(wire, source, &material)
			if err != nil {
				t.Fatal(err)
			}
			prior := mustJSON(t, f.a.committed)
			diskBefore, err := os.ReadFile(f.path)
			if err != nil {
				t.Fatal(err)
			}
			ctx := context.Background()
			result, err := f.a.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: 3, Time: time.Date(2030, 1, 1, 0, 0, 3, 0, time.UTC), Txs: [][]byte{raw}})
			if err != nil || len(result.TxResults) != 1 || result.TxResults[0].Code != 0 {
				t.Fatalf("real contract finalize: %+v %v", result, err)
			}
			pending := mustJSON(t, f.a.pending)
			candidateHash := f.a.pending.AppHash
			injected := errors.New("contract checkpoint failure")
			f.a.persistenceHooks = &committedPersistenceHooks{}
			if phase == "before" {
				f.a.persistenceHooks.beforeRename = func() error { return injected }
			} else {
				f.a.persistenceHooks.syncDirectory = func(string) error { return injected }
			}
			_, err = f.a.Commit(ctx, &abcitypes.RequestCommit{})
			if !errors.Is(err, injected) || errors.Is(err, ErrCommittedStateDurabilityUncertain) != (phase == "after") {
				t.Fatalf("wrong checkpoint classification: %v", err)
			}
			if !bytes.Equal(prior, mustJSON(t, f.a.committed)) || !bytes.Equal(pending, mustJSON(t, f.a.pending)) {
				t.Fatal("failed checkpoint published, discarded or reexecuted original candidate")
			}
			if _, err = f.a.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: 3, Txs: [][]byte{raw}}); err == nil {
				t.Fatal("UNKNOWN/pending allowed duplicate execution")
			}
			if phase == "before" {
				disk, err := os.ReadFile(f.path)
				if err != nil || !bytes.Equal(disk, diskBefore) {
					t.Fatal("pre-rename changed disk")
				}
			} else {
				_, err = newPersistentApplication(f.m, f.path, nil, &committedPersistenceHooks{syncDirectory: func(string) error { return injected }})
				if !errors.Is(err, ErrCommittedStateDurabilityUncertain) {
					t.Fatal("cold UNKNOWN skipped actual directory confirmation")
				}
				cold, err := NewPersistentApplication(f.m, f.path)
				if err != nil || cold.committed.AppHash != candidateHash {
					t.Fatalf("original cold candidate lost: %v", err)
				}
			}
			f.a.persistenceHooks = nil
			if _, err = f.a.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			if f.a.pending != nil || f.a.committed.AppHash != candidateHash {
				t.Fatal("reconfirmation changed original candidate")
			}
			pqABCIContractRejected(t, f.a, raw)
			cold, err := NewPersistentApplication(f.m, f.path)
			if err != nil || !bytes.Equal(mustJSON(t, cold.committed), mustJSON(t, f.a.committed)) {
				t.Fatalf("cold contract checkpoint differs: %v", err)
			}
		})
	}
}

func TestABCIPQContractImportedOriginalArtifactAndSameBlockCalls(t *testing.T) {
	f := newABCIRevocationFixture(t)
	source, _, _ := pqABCIContractMaterial(t, ynxauth.ContractCounterName)
	original, _, err := f.d.DeployContractWithArgs(f.owner, ynxauth.ContractCounterName, source, []string{"7"})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = f.d.ExecuteContract(f.other, original.Address, pqABCIContractData(original.Name, f.owner, 3)); err != nil {
		t.Fatal(err)
	}
	f.d.ProduceBlock()
	f.m, err = f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	f.path = filepath.Join(t.TempDir(), "imported-contract.json")
	f.a, err = NewPersistentApplication(f.m, f.path)
	if err != nil {
		t.Fatal(err)
	}
	height := f.a.committed.Height + 1
	registration := abciRegistrationWire(t, f.classic, nil, f.key, ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: f.public.PKA, PKB: f.public.PKB, NewRevision: 1, LedgerNonce: queryConsensusAccount(t, f.a, f.owner).Nonce + 1, ActivateAt: uint64(height + 1)})
	pqABCIContractBlock(t, f.a, height, mustPQEnvelope(t, PQMigrationType, registration))
	height++
	before, err := f.a.PQContractArtifact(original.Address)
	if err != nil {
		t.Fatal(err)
	}
	if before.PQAnchorTransactionHash != "" || reflect.DeepEqual(before.RuntimeStorage, original.RuntimeStorage) {
		t.Fatal("import lost original executed state or fabricated PQ marker")
	}
	nonce := queryConsensusAccount(t, f.a, f.owner).Nonce + 1
	first := pqABCIContractCall(t, f, before, pqABCIContractData(before.Name, f.other, 5), nonce)
	candidate, _, err := f.a.applyPQContractAction(f.a.cloneExecutionState(), first, height, time.Date(2030, 1, 1, 0, 0, int(height), 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	after, _, err := pqCurrentContractArtifact(candidate.contracts, candidate.legacyContracts, candidate.pqHistory, before.Address)
	if err != nil {
		t.Fatal(err)
	}
	second := pqABCIContractCall(t, f, after, pqABCIContractData(after.Name, f.other, 2), nonce+1)
	pqABCIContractBlock(t, f.a, height, first, second)
	cold, err := NewPersistentApplication(f.m, f.path)
	if err != nil {
		t.Fatal(err)
	}
	current, err := cold.PQContractArtifact(before.Address)
	if err != nil {
		t.Fatal(err)
	}
	if current.RuntimeStorage[fmt.Sprintf("0x%064x", 0)] != fmt.Sprintf("0x%064x", 17) || current.Deployer != original.Deployer || !current.DeployedAt.Equal(original.DeployedAt) {
		t.Fatal("first PQ anchor or same-block actual calls rewrote original identity/state")
	}
}

func TestABCIPQContractPreservesLegitimateSourceResourceReleaseAndRestart(t *testing.T) {
	for _, release := range []string{"rental", "imported-pool-refund"} {
		t.Run(release, func(t *testing.T) {
			f := newABCIRevocationFixture(t)
			source, _, _ := pqABCIContractMaterial(t, ynxauth.ContractCounterName)
			original, _, err := f.d.DeployContractWithArgs(f.owner, ynxauth.ContractCounterName, source, []string{"7"})
			if err != nil {
				t.Fatal(err)
			}
			if _, _, err = f.d.ExecuteContract(f.owner, original.Address, pqABCIContractData(original.Name, f.other, 3)); err != nil {
				t.Fatal(err)
			}
			var pool chain.ResourcePool
			if release == "imported-pool-refund" {
				input := chain.ResourcePoolCreateInput{PoolType: "dapp", Name: "Source resource reservation", Public: true, AllowedScopes: []string{"contract_call"}, AllowedResourceTypes: []string{"compute"}, PerActionLimit: chain.ResourceUnits{Compute: 1}, CumulativeAllowance: chain.ResourceUnits{Compute: 5}, ExpiresAt: time.Date(2031, 1, 1, 0, 0, 0, 0, time.UTC), IdempotencyKey: "source-contract-resource-pool"}
				account, _ := f.d.Account(f.owner)
				input.Authorization, err = chain.SignResourceAuthorization(f.classic, f.m.Network.ChainID, chain.ResourcePoolCreateAction, input, account.Nonce+1)
				if err != nil {
					t.Fatal(err)
				}
				pool, _, err = f.d.CreateResourcePool(input)
				if err != nil {
					t.Fatal(err)
				}
			}
			f.d.ProduceBlock()
			f.m, err = f.d.ExportConsensusMigrationState()
			if err != nil {
				t.Fatal(err)
			}
			f.path = filepath.Join(t.TempDir(), "resource-release-contract.json")
			f.a, err = NewPersistentApplication(f.m, f.path)
			if err != nil {
				t.Fatal(err)
			}
			height := f.a.committed.Height + 1
			before := queryConsensusAccount(t, f.a, f.owner)
			var raw []byte
			if release == "rental" {
				expiry := time.Date(2030, 1, 1, 0, 1, int(height), 0, time.UTC)
				quote, err := chain.ResourceQuoteForPolicy(f.m.ResourcePolicy, f.owner, 0, 20, 0, 0, expiry)
				if err != nil {
					t.Fatal(err)
				}
				input := ResourceRentalPayload{Address: f.owner, Provider: chain.ProtocolResourceProvider, Compute: 20, QuoteID: quote.ID, QuoteExpiresAt: expiry, PolicyHash: f.m.ResourcePolicy.PolicyHash, MaxPriceYNXT: quote.PriceYNXT, IdempotencyKey: "before-pq-contract-rental"}
				input.RequestHash = ResourceRentalRequestHash(input.Address, input.Provider, input.Bandwidth, input.Compute, input.AICredits, input.TrustCredits, input.QuoteID, input.QuoteExpiresAt, input.PolicyHash, input.MaxPriceYNXT, input.IdempotencyKey)
				raw = mustResourceAction(t, f.classic, ActionResourceRent, input, before.Nonce+1)
			} else {
				input := ResourcePoolStatusPayload{PoolID: pool.ID, Status: "revoked", ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "before-pq-contract-refund"}
				raw = mustResourceAction(t, f.classic, ActionResourcePoolStatus, input, before.Nonce+1)
			}
			pqABCIContractBlock(t, f.a, height, raw)
			reduced := queryConsensusAccount(t, f.a, f.owner)
			if reduced.ResourceUsage.ComputeUsed >= before.ResourceUsage.ComputeUsed {
				t.Fatal("real resource execution did not release prior compiled-contract usage")
			}
			height++
			registration := abciRegistrationWire(t, f.classic, nil, f.key, ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: f.public.PKA, PKB: f.public.PKB, NewRevision: 1, LedgerNonce: reduced.Nonce + 1, ActivateAt: uint64(height + 1)})
			pqABCIContractBlock(t, f.a, height, mustPQEnvelope(t, PQMigrationType, registration))
			artifact, err := f.a.PQContractArtifact(original.Address)
			if err != nil {
				t.Fatal(err)
			}
			call := pqABCIContractCall(t, f, artifact, pqABCIContractData(artifact.Name, f.other, 5), queryConsensusAccount(t, f.a, f.owner).Nonce+1)
			pqABCIContractBlock(t, f.a, height+1, call)
			after := queryConsensusAccount(t, f.a, f.owner)
			if after.ResourceUsage.ComputeUsed != reduced.ResourceUsage.ComputeUsed+1 {
				t.Fatal("later PQ call lost its actual compute charge")
			}
			cold, err := NewPersistentApplication(f.m, f.path)
			if err != nil || !bytes.Equal(mustJSON(t, cold.committed), mustJSON(t, f.a.committed)) {
				t.Fatalf("lawful resource release prevented complete cold restoration: %v", err)
			}
			current, err := cold.PQContractArtifact(original.Address)
			if err != nil || current.RuntimeStorage[fmt.Sprintf("0x%064x", 0)] != fmt.Sprintf("0x%064x", 15) {
				t.Fatalf("resource release changed real compiled runtime: %v", err)
			}
			for _, mode := range []string{"erase-pq-usage", "forge-release"} {
				var bad CommittedState
				if err := json.Unmarshal(mustJSON(t, cold.committed), &bad); err != nil {
					t.Fatal(err)
				}
				if mode == "erase-pq-usage" {
					i, _ := accountIndex(bad.Accounts, f.owner)
					bad.Accounts[i].ResourceUsage.ComputeUsed = 0
				} else if release == "rental" {
					bad.ResourceRentals[0].Compute = math.MaxInt64
					bad.ResourceRentals[0].AuditHash = resourceRentalAuditHash(bad.ResourceRentals[0])
				} else {
					bad.ResourceSponsorIdempotency[0].PoolSnapshot.CumulativeAllowance.Compute++
				}
				bad.AppHash, err = bad.calculateHash()
				if err != nil {
					t.Fatal(err)
				}
				if err := bad.Validate(f.m); err == nil {
					t.Fatalf("resealed %s accepted after genuine %s", mode, release)
				}
			}
		})
	}
}
