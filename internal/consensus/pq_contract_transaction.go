package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

const (
	PQActionType                  = "pq_action"
	MaxPQContractTransactionBytes = 24 << 20
	pqContractHistoryMemo         = "ynx-abci-pq-contract-v1:"
)

// PQContractTransaction transports the existing canonical Action Member. The
// optional compiler material is required only for a new deployment; its actual
// source/code/config must match the signed identity and the single pinned code
// registry. Neither paths nor caller-supplied artifact metadata confer authority.
type PQContractTransaction struct {
	Version  int                              `json:"version"`
	Type     string                           `json:"type"`
	WireHex  string                           `json:"wireHex"`
	Source   string                           `json:"source,omitempty"`
	Material *chain.ConsensusContractMaterial `json:"material,omitempty"`
}

func EncodePQContractTransaction(wire []byte, source string, material *chain.ConsensusContractMaterial) ([]byte, error) {
	if len(wire) == 0 || len(wire) > chain.MaxPQActionMemberBytes {
		return nil, errors.New("PQ contract member size is invalid")
	}
	m, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return nil, err
	}
	a, err := ynxauth.DecodeAction(m.Message)
	if err != nil {
		return nil, err
	}
	switch a.Kind {
	case ynxauth.ActionContractDeploy:
		if material == nil || len(source) == 0 || len(source) > 64<<10 || source != strings.TrimSpace(source) || len(material.ArtifactFile) == 0 || len(material.ArtifactFile) > 128<<10 || len(material.BuildInfoFile) == 0 || len(material.BuildInfoFile) > 16<<20 {
			return nil, errors.New("PQ deployment requires bounded actual source/artifact/build-info")
		}
	case ynxauth.ActionContractExecute:
		if source != "" || material != nil {
			return nil, errors.New("PQ call cannot replace compiler material")
		}
	default:
		return nil, errors.New("ABCI PQ action kind is not enabled")
	}
	raw, err := json.Marshal(PQContractTransaction{Version: 1, Type: PQActionType, WireHex: hex.EncodeToString(wire), Source: source, Material: material})
	if err != nil || len(raw) > MaxPQContractTransactionBytes {
		return nil, errors.New("PQ contract transport exceeds bound")
	}
	return raw, nil
}

func DecodePQContractTransaction(raw []byte) (PQContractTransaction, []byte, ynxauth.Action, error) {
	var e PQContractTransaction
	var a ynxauth.Action
	if len(raw) == 0 || len(raw) > MaxPQContractTransactionBytes {
		return e, nil, a, errors.New("PQ contract transport size is invalid")
	}
	if err := json.Unmarshal(raw, &e); err != nil {
		return e, nil, a, err
	}
	wire, err := hex.DecodeString(e.WireHex)
	if err != nil || e.Version != 1 || e.Type != PQActionType || hex.EncodeToString(wire) != e.WireHex {
		return e, nil, a, errors.New("noncanonical PQ contract envelope")
	}
	canonical, err := EncodePQContractTransaction(wire, e.Source, e.Material)
	if err != nil || !bytes.Equal(raw, canonical) {
		return e, nil, a, errors.New("noncanonical PQ contract transport")
	}
	m, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return e, nil, a, err
	}
	a, err = ynxauth.DecodeAction(m.Message)
	return e, wire, a, err
}

type pqContractHistoryRecord struct {
	Transport []byte                           `json:"transport"`
	Receipt   chain.ConsensusPQContractReceipt `json:"receipt"`
}

func encodePQContractHistory(raw []byte, receipt chain.ConsensusPQContractReceipt) (string, error) {
	b, err := json.Marshal(pqContractHistoryRecord{Transport: bytes.Clone(raw), Receipt: receipt})
	if err != nil {
		return "", err
	}
	return pqContractHistoryMemo + hex.EncodeToString(b), nil
}

func decodePQContractHistory(tx chain.Transaction) (pqContractHistoryRecord, []byte, ynxauth.Action, error) {
	var r pqContractHistoryRecord
	var a ynxauth.Action
	if !strings.HasPrefix(tx.Memo, pqContractHistoryMemo) || len(tx.Memo) > 3*MaxPQContractTransactionBytes+(2<<20) {
		return r, nil, a, errors.New("missing or oversized ABCI contract history")
	}
	b, err := hex.DecodeString(strings.TrimPrefix(tx.Memo, pqContractHistoryMemo))
	if err != nil {
		return r, nil, a, err
	}
	if err = json.Unmarshal(b, &r); err != nil {
		return r, nil, a, err
	}
	canonical, err := encodePQContractHistory(r.Transport, r.Receipt)
	if err != nil || canonical != tx.Memo {
		return r, nil, a, errors.New("noncanonical ABCI contract history")
	}
	_, wire, a, err := DecodePQContractTransaction(r.Transport)
	return r, wire, a, err
}

func (a *Application) applyPQContractAction(state executionState, raw []byte, height int64, blockTime time.Time) (executionState, transactionExecution, error) {
	fail := func(err error) (executionState, transactionExecution, error) {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	e, wire, action, err := DecodePQContractTransaction(raw)
	if err != nil {
		return fail(err)
	}
	if height <= 0 || state.accountPolicy == nil || action.NativeChainID != uint64(a.migration.Network.ChainID) || !bytes.Equal(action.ChainID, state.accountPolicy.NetworkID) {
		return fail(errors.New("PQ contract requires actual policy, network and block context"))
	}
	m, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return fail(err)
	}
	if err = a.pqCertificateCache.VerifyDecodedMember(state.accountPolicy, action.Owner, ynxauth.TransactionPurpose, m.Message, m, uint64(height)); err != nil {
		return fail(err)
	}
	nativeHash, abciHash := SignedTransactionHash(wire), SignedTransactionHash(raw)
	for _, prior := range state.pqHistory {
		if prior.Transaction.Hash == nativeHash {
			return fail(errors.New("PQ contract original member already executed"))
		}
	}
	index, exists := accountIndex(state.accounts, action.Owner)
	if !exists || state.accounts[index].Nonce == math.MaxUint64 || action.Nonce != state.accounts[index].Nonce+1 {
		return fail(errors.New("PQ contract requires exact next owner nonce"))
	}
	var receipt chain.ConsensusPQContractReceipt
	compute, typeName := int64(1), "contract_call"
	if action.Kind == ynxauth.ActionContractDeploy {
		if blockTime.IsZero() {
			// CheckTx has no proposed block time. Its candidate is discarded;
			// FinalizeBlock reconstructs the artifact with the actual block time.
			blockTime = time.Unix(height, 0).UTC()
		}
		compute, typeName = 5, "contract_deploy"
		receipt, err = chain.BuildConsensusPQContractDeployment(action, nativeHash, blockTime, e.Source, *e.Material)
		if err != nil {
			return fail(err)
		}
		if _, exists = bftContractIndex(state.contracts, receipt.Artifact.Address); exists {
			return fail(errors.New("PQ deployment address exists"))
		}
	} else {
		value, decodeErr := ynxauth.DecodeActionPayload(action.Kind, action.Payload)
		if decodeErr != nil {
			return fail(decodeErr)
		}
		p := value.(ynxauth.ContractExecutePayload)
		before, code, findErr := pqCurrentContractArtifact(state.contracts, state.legacyContracts, state.pqHistory, p.Target)
		if findErr != nil {
			return fail(findErr)
		}
		if blockTime.IsZero() {
			blockTime = before.DeployedAt
		}
		receipt, err = chain.BuildConsensusPQContractCall(action, nativeHash, blockTime, before, code, a.migration.ContractMaterials[before.Name])
		if err != nil {
			return fail(err)
		}
	}
	tx := chain.Transaction{Hash: nativeHash, Type: typeName, From: action.Owner, To: receipt.Artifact.Address, Fee: int64(action.Fee), Nonce: action.Nonce, BlockNum: uint64(height), Timestamp: blockTime.UTC()}
	post, err := chain.ReplayConsensusPQContract(tx, wire, receipt)
	if err != nil {
		return fail(err)
	}
	// Detach all writes before fee lots, resources, runtime or history changes.
	state.accounts = cloneAccounts(state.accounts)
	state.traceLots = cloneTraceLots(state.traceLots)
	state.contracts = cloneBFTContracts(state.contracts)
	state.evmLogs = cloneBFTEVMLogs(state.evmLogs)
	state.evmReceipts = cloneBFTEVMReceipts(state.evmReceipts)
	tx.LotFlows, err = a.chargePQContract(&state, action, compute)
	if err != nil {
		return fail(err)
	}
	tx.Memo, err = encodePQContractHistory(raw, receipt)
	if err != nil {
		return fail(err)
	}
	bftReceipt := BFTEVMReceipt{TxHash: abciHash, From: action.Owner, Action: ActionIDEContractCall, Status: "success", To: post.Address, Logs: []BFTEVMLog{}, BlockHeight: height}
	if action.Kind == ynxauth.ActionContractDeploy {
		contract := BFTContract{Address: post.Address, Name: post.Name, Deployer: post.Deployer, SourceHash: post.SourceHash, DeployedBytecodeHash: post.DeployedBytecodeHash, DeployedBytecode: receipt.Bytecode, ConstructorArgs: append([]string(nil), post.ConstructorArgs...), RuntimeStorage: post.RuntimeStorage, RuntimeMode: chain.BoundedContractRuntimeMode, BlockHeight: height, TxHash: abciHash, LastUpdatedHeight: height}
		contract.AuditHash = bftContractAuditHash(contract)
		state.contracts = insertBFTContract(state.contracts, contract)
		bftReceipt.Action, bftReceipt.To, bftReceipt.ContractAddress = ActionIDEContractDeploy, "", post.Address
	} else {
		index, _ := bftContractIndex(state.contracts, post.Address)
		contract := state.contracts[index]
		contract.RuntimeStorage, contract.LastUpdatedHeight, contract.LastCallTxHash = post.RuntimeStorage, height, abciHash
		contract.AuditHash = bftContractAuditHash(contract)
		state.contracts[index] = contract
		transition := receipt.Transition
		bftReceipt.EncodedResult, bftReceipt.OpcodeStepCount, bftReceipt.StorageWrites = transition.EncodedResult, transition.StepCount, transition.StorageWrites
		for _, event := range transition.Logs {
			log := BFTEVMLog{Address: post.Address, Topics: append([]string(nil), event.Topics...), Data: event.Data, BlockHeight: height, TxHash: abciHash}
			log.AuditHash = bftEVMLogAuditHash(log)
			bftReceipt.Logs = append(bftReceipt.Logs, log)
			state.evmLogs = append(state.evmLogs, log)
		}
	}
	bftReceipt.AuditHash = bftEVMReceiptAuditHash(bftReceipt)
	state.evmReceipts = insertBFTEVMReceipt(state.evmReceipts, bftReceipt)
	state.feeEvents = state.feeEvents.append(newCurrentFeeEvent(abciHash, PQActionType, action.Owner, a.feeRecipient, int64(action.Fee), height, blockTime))
	state.pqHistory = append(clonePQHistory(state.pqHistory), PQCommittedAuthorization{ABCITransactionHash: abciHash, Transaction: tx})
	return state, transactionExecution{typeName: PQActionType, hash: abciHash, event: abcitypes.Event{Type: "ynx.pq_contract", Attributes: []abcitypes.EventAttribute{{Key: "action", Value: action.Kind, Index: true}, {Key: "owner", Value: action.Owner, Index: true}, {Key: "contract", Value: post.Address, Index: true}, {Key: "native_hash", Value: nativeHash, Index: true}}}}, nil
}

// Exact fee lots, balance, nonce and resources are one detached mutation. Alias
// handling checks net credits, so a fee recipient may lawfully call its own code.
func (a *Application) chargePQContract(state *executionState, action ynxauth.Action, compute int64) ([]chain.LotFlow, error) {
	state.accounts, _ = ensureAccount(state.accounts, a.feeRecipient)
	i, _ := accountIndex(state.accounts, action.Owner)
	j, _ := accountIndex(state.accounts, a.feeRecipient)
	sender, recipient := &state.accounts[i], &state.accounts[j]
	fee := int64(action.Fee)
	if sender.Nonce == math.MaxUint64 || action.Nonce != sender.Nonce+1 || sender.Balance < fee || sender.ResourceUsage.BandwidthUsed == math.MaxInt64 || sender.ResourceUsage.ComputeUsed > math.MaxInt64-compute || i != j && recipient.Balance > math.MaxInt64-fee {
		return nil, errors.New("PQ contract fee, nonce or resource capacity is insufficient")
	}
	remaining := fee
	var flows []chain.LotFlow
	for _, id := range sortedLotKeys(sender.Lots) {
		if remaining == 0 {
			break
		}
		amount := sender.Lots[id]
		if amount <= 0 {
			continue
		}
		if amount > remaining {
			amount = remaining
		}
		lot, ok := state.traceLots[id]
		if !ok || lot.LotID != id || i != j && recipient.Lots[id] > math.MaxInt64-amount {
			return nil, errors.New("PQ contract fee lacks valid trace lineage or overflows")
		}
		flows = append(flows, chain.LotFlow{LotID: id, From: action.Owner, To: a.feeRecipient, Amount: amount})
		remaining -= amount
	}
	if remaining != 0 {
		return nil, errors.New("insufficient traceable PQ contract fee")
	}
	if recipient.Lots == nil {
		recipient.Lots = map[string]int64{}
	}
	for _, f := range flows {
		sender.Lots[f.LotID] -= f.Amount
		recipient.Lots[f.LotID] += f.Amount
		lot := state.traceLots[f.LotID]
		lot.LastInbound = a.feeRecipient
		state.traceLots[f.LotID] = lot
	}
	sender.Balance -= fee
	recipient.Balance += fee
	sender.Nonce = action.Nonce
	sender.ResourceUsage.BandwidthUsed++
	sender.ResourceUsage.ComputeUsed += compute
	return flows, nil
}

// Full immutable metadata comes only from the trusted migration artifact or an
// earlier validated PQ deployment/call. Current storage comes from the actual
// shared BFT contract, including intervening lawful classic calls.
func pqCurrentContractArtifact(contracts []BFTContract, legacy *LegacyContracts, history []PQCommittedAuthorization, address string) (chain.ContractArtifact, string, error) {
	index, ok := bftContractIndex(contracts, address)
	if !ok {
		return chain.ContractArtifact{}, "", errors.New("PQ contract target does not exist")
	}
	contract := contracts[index]
	var artifact chain.ContractArtifact
	found := false
	if legacy != nil {
		artifact, found = legacy.Contracts[address]
	}
	for i := len(history) - 1; i >= 0; i-- {
		tx := history[i].Transaction
		if tx.To != address || !strings.HasPrefix(tx.Memo, pqContractHistoryMemo) {
			continue
		}
		r, wire, _, err := decodePQContractHistory(tx)
		if err != nil {
			return artifact, "", err
		}
		artifact, err = chain.ReplayConsensusPQContract(tx, wire, r.Receipt)
		if err != nil {
			return artifact, "", err
		}
		found = true
		break
	}
	if !found {
		return artifact, "", errors.New("classic ABCI deployment lacks a trusted complete artifact bridge")
	}
	if artifact.Address != contract.Address || artifact.Name != contract.Name || artifact.Deployer != contract.Deployer || artifact.SourceHash != contract.SourceHash || artifact.DeployedBytecodeHash != contract.DeployedBytecodeHash {
		return artifact, "", errors.New("PQ artifact differs from actual contract identity")
	}
	artifact.RuntimeStorage = cloneStringMap(contract.RuntimeStorage)
	return artifact, contract.DeployedBytecode, nil
}

// PQContractArtifact returns the exact currently signable complete prestate.
// It does not mutate state or authorize any operation.
func (a *Application) PQContractArtifact(address string) (chain.ContractArtifact, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	artifact, _, err := pqCurrentContractArtifact(a.committed.Contracts, a.committed.LegacyContracts, a.committed.PQHistory, address)
	if err != nil {
		return chain.ContractArtifact{}, err
	}
	raw, err := json.Marshal(artifact)
	if err != nil {
		return chain.ContractArtifact{}, err
	}
	var copy chain.ContractArtifact
	err = json.Unmarshal(raw, &copy)
	return copy, err
}
