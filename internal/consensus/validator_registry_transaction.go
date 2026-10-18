package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	abci "github.com/cometbft/cometbft/abci/types"
)

const (
	ValidatorRegistryTransactionType     = "ynx_validator_registry_v1"
	MaxValidatorRegistryTransactionBytes = 2*ynxconsensusauth.MaxRegistrationBytes + 128
)

type validatorRegistryEnvelope struct {
	Type string `json:"type"`
	Wire string `json:"wire"`
}

// The exact canonical outer bytes have their own ABCI transaction hash. The
// registration's domain-separated operation hash is a separate identity.
func EncodeValidatorRegistryTransaction(wire []byte) ([]byte, error) {
	if _, err := ynxconsensusauth.DecodeRegistration(wire); err != nil {
		return nil, err
	}
	return json.Marshal(validatorRegistryEnvelope{Type: ValidatorRegistryTransactionType, Wire: hex.EncodeToString(wire)})
}

func DecodeValidatorRegistryTransaction(payload []byte) ([]byte, error) {
	if len(payload) == 0 || len(payload) > MaxValidatorRegistryTransactionBytes {
		return nil, errors.New("validator registry envelope size invalid")
	}
	var envelope validatorRegistryEnvelope
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&envelope); err != nil {
		return nil, err
	}
	wire, err := hex.DecodeString(envelope.Wire)
	if err != nil || envelope.Type != ValidatorRegistryTransactionType {
		return nil, errors.New("invalid validator registry envelope")
	}
	canonical, err := EncodeValidatorRegistryTransaction(wire)
	if err != nil || !bytes.Equal(canonical, payload) {
		return nil, errors.New("validator registry envelope must have exact canonical bytes")
	}
	return wire, nil
}

func (a *Application) applyValidatorRegistryTransaction(state executionState, payload []byte, height int64, transactionIndex uint32) (executionState, transactionExecution, error) {
	fail := func(err error) (executionState, transactionExecution, error) {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	if a.bootstrap == nil {
		return fail(errors.New("validator registry ingress requires independent operator bootstrap pins"))
	}
	wire, err := DecodeValidatorRegistryTransaction(payload)
	if err != nil {
		return fail(err)
	}
	history, err := replayValidatorRegistry(state.validatorRegistry, a.bootstrap, height)
	if err != nil {
		return fail(err)
	}
	nextHistory, err := history.Append(wire, height, a.bootstrap.membershipAt(height))
	if err != nil {
		return fail(err)
	}
	next := cloneValidatorRegistry(state.validatorRegistry)
	if next == nil {
		next = &ValidatorRegistryState{Version: 1, Bootstrap: cloneValidatorBootstrapRecord(a.bootstrap.record)}
	}
	operationHash, _ := ynxconsensusauth.RegistrationHash(wire)
	abciHash := SignedTransactionHash(payload)
	next.Events = append(next.Events, ValidatorRegistryEvent{Index: uint64(len(next.Events)), Height: height, TransactionIndex: transactionIndex, ABCIHash: abciHash, OperationHash: "0x" + hex.EncodeToString(operationHash[:]), Wire: bytes.Clone(wire)})
	root := nextHistory.Root()
	next.Root = hex.EncodeToString(root[:])
	// Validate actual index ordering before returning a candidate. Failures
	// discard only this candidate and cannot mutate an earlier accepted state.
	if len(next.Events) > 1 {
		previous := next.Events[len(next.Events)-2]
		if previous.Height == height && previous.TransactionIndex >= transactionIndex {
			return fail(errors.New("validator registry transaction index did not advance"))
		}
	}
	state.validatorRegistry = next
	return state, transactionExecution{typeName: ValidatorRegistryTransactionType, hash: abciHash, event: abci.Event{Type: "ynx.validator_registry", Attributes: []abci.EventAttribute{{Key: "operation_hash", Value: "0x" + hex.EncodeToString(operationHash[:]), Index: true}, {Key: "registry_root", Value: next.Root, Index: true}}}}, nil
}
