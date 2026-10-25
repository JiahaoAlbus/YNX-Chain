package main

import (
	"bytes"
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// Only the original core can admit occupancy against its independent Genesis
// allowlist. This consumer neither makes that allowlist nor grants a balance.
func preparePQInitialCase(wire []byte) (pqWholeCase, error) {
	var p pqWholeCase
	intent, _, err := ynxauth.DecodePQInitialRegistrationMember(wire)
	if err != nil {
		return p, err
	}
	payload, err := consensus.EncodePQInitialRegistrationTransaction(wire)
	if err != nil {
		return p, err
	}
	native := consensus.SignedTransactionHash(wire)
	return pqWholeCase{kind: consensus.PQInitialRegistrationType, native: native, outer: consensus.SignedTransactionHash(payload), wire: bytes.Clone(wire), members: []string{native}, registration: &intent}, nil
}
func (p pqWholeCase) validateInitialCommitted(v bftgateway.PQMemberView) error {
	intent := p.registration
	if intent == nil || v.Type != consensus.PQInitialRegistrationType || v.Status != "committed" || !v.Committed || v.Source != "comet-rpc" || v.NativeTransactionHash != p.native || v.ABCITransactionHash != p.outer || !bytes.Equal(v.Wire, p.wire) || v.ExecutionHeight == 0 || v.ExecutionHeight >= intent.ActivateAt || v.CometIndex == nil || v.ReadbackURL != "/transactions/pq/originals/"+p.native || v.Error != "" || v.Transaction == nil {
		return errors.New("initial registration original identity/readback differs")
	}
	tx := v.Transaction
	if v.From != intent.Owner || v.To != intent.Owner || v.Amount != 0 || v.Fee != 0 || v.Nonce != 1 || tx.Type != consensus.PQInitialRegistrationType || tx.Hash != p.native || tx.From != intent.Owner || tx.To != intent.Owner || tx.Amount != 0 || tx.Fee != 0 || tx.Nonce != 1 || tx.BlockNum != v.ExecutionHeight {
		return errors.New("initial registration must preserve zero-value birth and nonce1")
	}
	return nil
}
