package main

import (
	"bytes"
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// Consume the normal Native ABI's public N1 Member, without converting its
// original wire identity into a Whole or creating a signing/approval provider.
func preparePQMemberCase(wire []byte) (pqWholeCase, error) {
	var p pqWholeCase
	if len(wire) == 0 || len(wire) > bftgateway.MaxPQMemberIngressBytes {
		return p, errors.New("Member outside canonical N1 ingress profile")
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return p, err
	}
	transfer, err := ynxauth.DecodeTransfer(member.Message)
	if err != nil {
		return p, err
	}
	if member.Certificate.N != 1 || member.Index != 0 || len(member.PathA) != 0 || len(member.PathB) != 0 || member.Certificate.Purpose != ynxauth.TransactionPurpose || member.Certificate.Owner != transfer.From || !bytes.Equal(member.Certificate.ChainID, transfer.ChainID) || transfer.Fee != uint64(consensus.SignedTransactionFeeYNXT) || transfer.NativeChainID != 6423 {
		return p, errors.New("expected original N1 TX-BATCH native transfer Member")
	}
	payload, err := consensus.EncodePQTransaction(consensus.PQTransferType, wire)
	if err != nil {
		return p, err
	}
	native := consensus.SignedTransactionHash(wire)
	return pqWholeCase{kind: consensus.PQTransferType, native: native, outer: consensus.SignedTransactionHash(payload), wire: bytes.Clone(wire), members: []string{native}, transfer: &transfer}, nil
}
func (p pqWholeCase) validateMemberCommitted(v bftgateway.PQMemberView) (int, error) {
	t := p.transfer
	if t == nil || v.Type != consensus.PQTransferType || v.Status != "committed" || !v.Committed || v.Source != "comet-rpc" || v.NativeTransactionHash != p.native || v.ABCITransactionHash != p.outer || !bytes.Equal(v.Wire, p.wire) || v.ExecutionHeight == 0 || v.CometIndex == nil || v.ReadbackURL != "/transactions/pq/originals/"+p.native || v.Error != "" || v.Transaction == nil {
		return 0, errors.New("original committed Member identity/readback differs")
	}
	tx := v.Transaction
	if v.From != t.From || v.To != t.To || v.Amount != int64(t.Amount) || v.Fee != int64(t.Fee) || v.Nonce != t.Nonce || tx.Hash != p.native || tx.From != t.From || tx.To != t.To || tx.Amount != v.Amount || tx.Fee != v.Fee || tx.Nonce != v.Nonce || tx.BlockNum != v.ExecutionHeight {
		return 0, errors.New("Member business amount/fee/nonce/history differs")
	}
	return 1, nil
}
