package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func (a *Application) applyIDEAction(state executionState, payload []byte, tx SignedApplicationAction, height int64, blockTime time.Time) (executionState, transactionExecution, error) {
	txHash := ApplicationActionHash(payload)
	key, requestHash, err := ideActionIdentity(tx)
	if err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	id := IDEIdempotencyID(tx.Signer, key)
	if index, ok := ideIdempotencyIndex(state.ideIdempotency, id); ok {
		existing := state.ideIdempotency[index]
		if existing.Action != tx.Action || existing.RequestHash != requestHash {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("IDE idempotency key conflicts with a different request"))
		}
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("IDE request was already committed"))
	}
	if err := a.chargeApplicationAction(&state, tx); err != nil {
		return executionState{}, transactionExecution{}, err
	}

	objectID := ""
	receipt := BFTEVMReceipt{TxHash: txHash, From: tx.Signer, Action: tx.Action, Status: "success", Logs: []BFTEVMLog{}, BlockHeight: height}
	switch tx.Action {
	case ActionIDEContractDeploy:
		var input IDEContractDeployPayload
		_ = json.Unmarshal(tx.Payload, &input)
		sourceHash, bytecodeHash, err := chain.ValidateBoundedPinnedContract(input.Name, input.Source, input.DeployedBytecode)
		if err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		address := ideContractAddress(tx.Signer, txHash)
		if _, exists := bftContractIndex(state.contracts, address); exists {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("deterministic IDE contract address already exists"))
		}
		contract := BFTContract{Address: address, Name: input.Name, Deployer: tx.Signer, SourceHash: sourceHash, DeployedBytecodeHash: bytecodeHash, DeployedBytecode: input.DeployedBytecode, ConstructorArgs: append([]string(nil), input.ConstructorArgs...), RuntimeStorage: chain.BoundedContractInitialStorage(input.Source, tx.Signer, input.ConstructorArgs), RuntimeMode: chain.BoundedContractRuntimeMode, BlockHeight: height, TxHash: txHash, LastUpdatedHeight: height}
		contract.AuditHash = bftContractAuditHash(contract)
		state.contracts = insertBFTContract(state.contracts, contract)
		objectID, receipt.ContractAddress = address, address
	case ActionIDEContractCall:
		var input IDEContractCallPayload
		_ = json.Unmarshal(tx.Payload, &input)
		index, ok := bftContractIndex(state.contracts, input.Address)
		if !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("committed IDE contract not found"))
		}
		contract := state.contracts[index]
		transition, err := chain.ExecuteBoundedContract(contract.DeployedBytecode, input.Calldata, tx.Signer, contract.RuntimeStorage)
		if err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("bounded IDE execution failed: "+err.Error()))
		}
		if len(transition.StorageWrites) == 0 && len(transition.Logs) == 0 {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("bounded IDE write call produced no state transition evidence"))
		}
		contract.RuntimeStorage, contract.LastUpdatedHeight, contract.LastCallTxHash = transition.Storage, height, txHash
		contract.AuditHash = bftContractAuditHash(contract)
		state.contracts[index] = contract
		objectID, receipt.To, receipt.EncodedResult, receipt.OpcodeStepCount, receipt.StorageWrites = contract.Address, contract.Address, transition.EncodedResult, transition.StepCount, transition.StorageWrites
		for _, executionLog := range transition.Logs {
			log := BFTEVMLog{Address: contract.Address, Topics: append([]string(nil), executionLog.Topics...), Data: executionLog.Data, BlockHeight: height, TxHash: txHash}
			log.AuditHash = bftEVMLogAuditHash(log)
			receipt.Logs = append(receipt.Logs, log)
			state.evmLogs = append(state.evmLogs, log)
		}
	default:
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("unsupported IDE action"))
	}
	receipt.AuditHash = bftEVMReceiptAuditHash(receipt)
	state.evmReceipts = insertBFTEVMReceipt(state.evmReceipts, receipt)
	state.ideIdempotency = insertIDEIdempotency(state.ideIdempotency, BFTIDEIdempotency{ID: id, Signer: tx.Signer, IdempotencyKey: key, Action: tx.Action, RequestHash: requestHash, ObjectID: objectID, TxHash: txHash})
	return state, transactionExecution{typeName: tx.Type, event: abcitypes.Event{Type: "ynx.ide_contract", Attributes: []abcitypes.EventAttribute{{Key: "action", Value: tx.Action, Index: true}, {Key: "signer", Value: tx.Signer, Index: true}, {Key: "object_id", Value: objectID, Index: true}}}}, nil
}

func ideActionIdentity(tx SignedApplicationAction) (string, string, error) {
	switch tx.Action {
	case ActionIDEContractDeploy:
		var p IDEContractDeployPayload
		err := json.Unmarshal(tx.Payload, &p)
		return p.IdempotencyKey, p.RequestHash, err
	case ActionIDEContractCall:
		var p IDEContractCallPayload
		err := json.Unmarshal(tx.Payload, &p)
		return p.IdempotencyKey, p.RequestHash, err
	default:
		return "", "", errors.New("unsupported IDE action")
	}
}

func ideContractAddress(signer, txHash string) string {
	sum := sha256.Sum256([]byte("YNX_BFT_CONTRACT_ADDRESS_V1|" + signer + "|" + txHash))
	return "0x" + hex.EncodeToString(sum[:])[:40]
}

func bftContractIndex(values []BFTContract, address string) (int, bool) {
	index := sort.Search(len(values), func(i int) bool { return values[i].Address >= address })
	return index, index < len(values) && values[index].Address == address
}
func insertBFTContract(values []BFTContract, value BFTContract) []BFTContract {
	index, _ := bftContractIndex(values, value.Address)
	values = append(values, BFTContract{})
	copy(values[index+1:], values[index:])
	values[index] = value
	return values
}
func bftEVMReceiptIndex(values []BFTEVMReceipt, hash string) (int, bool) {
	index := sort.Search(len(values), func(i int) bool { return values[i].TxHash >= hash })
	return index, index < len(values) && values[index].TxHash == hash
}
func insertBFTEVMReceipt(values []BFTEVMReceipt, value BFTEVMReceipt) []BFTEVMReceipt {
	index, _ := bftEVMReceiptIndex(values, value.TxHash)
	values = append(values, BFTEVMReceipt{})
	copy(values[index+1:], values[index:])
	values[index] = value
	return values
}
func ideIdempotencyIndex(values []BFTIDEIdempotency, id string) (int, bool) {
	index := sort.Search(len(values), func(i int) bool { return values[i].ID >= id })
	return index, index < len(values) && values[index].ID == id
}
func insertIDEIdempotency(values []BFTIDEIdempotency, value BFTIDEIdempotency) []BFTIDEIdempotency {
	index, _ := ideIdempotencyIndex(values, value.ID)
	values = append(values, BFTIDEIdempotency{})
	copy(values[index+1:], values[index:])
	values[index] = value
	return values
}

func cloneBFTContracts(values []BFTContract) []BFTContract {
	out := append([]BFTContract(nil), values...)
	for i := range out {
		out[i].ConstructorArgs = append([]string(nil), out[i].ConstructorArgs...)
		out[i].RuntimeStorage = cloneStringMap(out[i].RuntimeStorage)
	}
	return out
}
func cloneBFTEVMReceipts(values []BFTEVMReceipt) []BFTEVMReceipt {
	out := make([]BFTEVMReceipt, len(values))
	copy(out, values)
	for i := range out {
		out[i].StorageWrites = append([]chain.StorageWrite(nil), out[i].StorageWrites...)
		out[i].Logs = cloneBFTEVMLogs(out[i].Logs)
	}
	return out
}
func cloneBFTEVMLogs(values []BFTEVMLog) []BFTEVMLog {
	out := make([]BFTEVMLog, len(values))
	copy(out, values)
	for i := range out {
		out[i].Topics = append([]string(nil), out[i].Topics...)
	}
	return out
}
func cloneStringMap(value map[string]string) map[string]string {
	out := make(map[string]string, len(value))
	for key, item := range value {
		out[key] = item
	}
	return out
}

func bftContractAuditHash(value BFTContract) string {
	value.AuditHash = ""
	return recordAuditHash("YNX_BFT_CONTRACT_AUDIT_V1", value)
}
func bftEVMReceiptAuditHash(value BFTEVMReceipt) string {
	value.AuditHash = ""
	return recordAuditHash("YNX_BFT_EVM_RECEIPT_AUDIT_V1", value)
}
func bftEVMLogAuditHash(value BFTEVMLog) string {
	value.AuditHash = ""
	return recordAuditHash("YNX_BFT_EVM_LOG_AUDIT_V1", value)
}

func normalizeIDEQueryCalldata(value string) string { return strings.ToLower(strings.TrimSpace(value)) }

func validateIDECommittedState(state CommittedState) error {
	previous := ""
	contracts := make(map[string]BFTContract, len(state.Contracts))
	for _, contract := range state.Contracts {
		bytecodeHash, err := chain.ValidateBoundedPinnedIdentity(contract.Name, contract.SourceHash, contract.DeployedBytecode)
		if err != nil || contract.Address == "" || !IsNativeAddress(contract.Address) || (previous != "" && contract.Address <= previous) || !IsNativeAddress(contract.Deployer) || contract.DeployedBytecodeHash != bytecodeHash || contract.RuntimeMode != chain.BoundedContractRuntimeMode || contract.BlockHeight <= 0 || !validResourceTxHash(contract.TxHash) || contract.LastUpdatedHeight < contract.BlockHeight || contract.Address != ideContractAddress(contract.Deployer, contract.TxHash) || contract.AuditHash != bftContractAuditHash(contract) {
			return errors.New("committed IDE contracts must be pinned, complete, audited, and sorted")
		}
		if contract.LastUpdatedHeight == contract.BlockHeight && contract.LastCallTxHash != "" || contract.LastUpdatedHeight > contract.BlockHeight && !validResourceTxHash(contract.LastCallTxHash) {
			return errors.New("committed IDE contract update anchor is invalid")
		}
		for key, value := range contract.RuntimeStorage {
			if !ideWordPattern.MatchString(key) || !ideWordPattern.MatchString(value) {
				return errors.New("committed IDE runtime storage is not canonical")
			}
		}
		contracts[contract.Address], previous = contract, contract.Address
	}
	previous = ""
	receipts := make(map[string]BFTEVMReceipt, len(state.EVMReceipts))
	expectedLogs := make(map[string]int)
	for _, receipt := range state.EVMReceipts {
		if !validResourceTxHash(receipt.TxHash) {
			return errors.New("committed IDE EVM receipt transaction hash is invalid")
		}
		if previous != "" && receipt.TxHash <= previous {
			return errors.New("committed IDE EVM receipts are not uniquely sorted")
		}
		if !IsNativeAddress(receipt.From) || receipt.Status != "success" || receipt.BlockHeight <= 0 {
			return errors.New("committed IDE EVM receipt is incomplete")
		}
		if expected := bftEVMReceiptAuditHash(receipt); receipt.AuditHash != expected {
			return fmt.Errorf("committed IDE EVM receipt audit mismatch: expected %s", expected)
		}
		if receipt.Action == ActionIDEContractDeploy {
			if receipt.To != "" || !IsNativeAddress(receipt.ContractAddress) {
				return errors.New("committed IDE deployment receipt has invalid addresses")
			}
		} else if receipt.Action == ActionIDEContractCall {
			if !IsNativeAddress(receipt.To) || receipt.ContractAddress != "" {
				return errors.New("committed IDE call receipt has invalid addresses")
			}
		} else {
			return errors.New("committed IDE receipt has unsupported action")
		}
		for _, log := range receipt.Logs {
			if log.TxHash != receipt.TxHash || log.BlockHeight != receipt.BlockHeight || !ideDataPattern.MatchString(log.Data) || log.AuditHash != bftEVMLogAuditHash(log) {
				return errors.New("committed IDE receipt log evidence mismatch")
			}
			expectedLogs[log.AuditHash]++
		}
		receipts[receipt.TxHash], previous = receipt, receipt.TxHash
	}
	for _, log := range state.EVMLogs {
		if !IsNativeAddress(log.Address) || !validResourceTxHash(log.TxHash) || log.BlockHeight <= 0 || !ideDataPattern.MatchString(log.Data) || log.AuditHash != bftEVMLogAuditHash(log) {
			return errors.New("committed IDE EVM log is incomplete or unaudited")
		}
		for _, topic := range log.Topics {
			if !ideWordPattern.MatchString(topic) {
				return errors.New("committed IDE EVM log topic is not canonical")
			}
		}
		receipt, ok := receipts[log.TxHash]
		if !ok || receipt.To != log.Address {
			return errors.New("committed IDE EVM log has no matching receipt")
		}
		if expectedLogs[log.AuditHash] == 0 {
			return errors.New("committed IDE EVM log is not present in its receipt")
		}
		expectedLogs[log.AuditHash]--
	}
	for _, remaining := range expectedLogs {
		if remaining != 0 {
			return errors.New("committed IDE receipt log is missing from global log state")
		}
	}
	previous = ""
	for _, record := range state.IDEIdempotency {
		if !payIDPattern.MatchString(record.ID) || (previous != "" && record.ID <= previous) || !IsNativeAddress(record.Signer) || !validResourceIdempotencyKey(record.IdempotencyKey) || !isIDEAction(record.Action) || !payHashPattern.MatchString(record.RequestHash) || !validResourceTxHash(record.TxHash) || record.ObjectID == "" {
			return errors.New("committed IDE idempotency records must be complete and sorted")
		}
		if _, ok := contracts[record.ObjectID]; !ok {
			return errors.New("IDE idempotency record has no contract")
		}
		if _, ok := receipts[record.TxHash]; !ok {
			return errors.New("IDE idempotency record has no receipt")
		}
		previous = record.ID
	}
	return nil
}
