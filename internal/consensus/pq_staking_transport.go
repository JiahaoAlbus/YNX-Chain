package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// Originals are public, canonical classic transactions. They are evidence,
// never a replacement for the Member's current owner authorization. Execution
// binds each one to the actual prestate's successful fee event and replays it.
// Omitting them preserves the original three-field transport byte for byte.
type PQStakingActionTransaction struct {
	Version   int      `json:"version"`
	Type      string   `json:"type"`
	WireHex   string   `json:"wireHex"`
	Originals [][]byte `json:"originals,omitempty"`
}

func EncodePQStakingActionTransaction(wire []byte, originals [][]byte) ([]byte, error) {
	if len(wire) == 0 || len(wire) > chain.MaxPQActionMemberBytes {
		return nil, errors.New("PQ staking Member exceeds the existing bound")
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return nil, err
	}
	action, err := ynxauth.DecodeAction(member.Message)
	if err != nil || !isStakingAction(action.Kind) {
		return nil, errors.New("original staking evidence is supported only for validator staking")
	}
	// Charge the encoded size before marshaling a potentially large witness.
	// The outer bound is the existing material-bearing action transport bound.
	empty, err := json.Marshal(PQStakingActionTransaction{Version: 1, Type: PQActionType, WireHex: hex.EncodeToString(wire)})
	if err != nil {
		return nil, err
	}
	if len(originals) == 0 {
		return empty, nil
	}
	encodedBytes := len(empty) + len(`,"originals":[]`)
	for i, raw := range originals {
		if len(raw) == 0 || len(raw) > MaxSignedActionSize {
			return nil, errors.New("invalid original classic staking transaction size")
		}
		encodedBytes += 4*((len(raw)+2)/3) + 2
		if i > 0 {
			encodedBytes++
		}
		if encodedBytes > MaxPQContractTransactionBytes {
			return nil, errors.New("original staking evidence exceeds the existing transport bound")
		}
		tx, err := DecodeSignedApplicationAction(raw)
		if err != nil || !isStakingAction(tx.Action) {
			return nil, errors.New("original staking evidence requires canonical classic staking transactions")
		}
	}
	raw, err := json.Marshal(PQStakingActionTransaction{Version: 1, Type: PQActionType, WireHex: hex.EncodeToString(wire), Originals: originals})
	if err != nil || len(raw) > MaxPQContractTransactionBytes {
		return nil, errors.New("PQ staking transport exceeds the existing bound")
	}
	return raw, nil
}

func DecodePQStakingActionTransaction(raw []byte) ([]byte, ynxauth.Action, [][]byte, error) {
	var envelope PQStakingActionTransaction
	var action ynxauth.Action
	if len(raw) == 0 || len(raw) > MaxPQContractTransactionBytes {
		return nil, action, nil, errors.New("PQ staking transport size is invalid")
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, action, nil, err
	}
	wire, err := hex.DecodeString(envelope.WireHex)
	if err != nil || envelope.Version != 1 || envelope.Type != PQActionType || envelope.WireHex != hex.EncodeToString(wire) {
		return nil, action, nil, errors.New("noncanonical PQ staking envelope")
	}
	canonical, err := EncodePQStakingActionTransaction(wire, envelope.Originals)
	if err != nil || !bytes.Equal(canonical, raw) {
		return nil, action, nil, errors.New("noncanonical or unsupported PQ staking transport")
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return nil, action, nil, err
	}
	action, err = ynxauth.DecodeAction(member.Message)
	return wire, action, envelope.Originals, err
}
