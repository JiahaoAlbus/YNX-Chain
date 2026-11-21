package consensus

import (
	"errors"
	"math"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ethnative"
)

const originalEthereumTransferGas = ethnative.TransferGas

// decodeOriginalEthereumAdapter accepts only the already-defined original
// whole-YNXT adapter wire. It delegates signature and exact old fee/value checks
// to the original verifier; callers must still enforce policy at execution H.
func decodeOriginalEthereumAdapter(payload []byte) (EthereumValueTransfer, error) {
	fields, err := decodeCanonicalRLPList(payload)
	if err != nil || len(fields) != 9 {
		return EthereumValueTransfer{}, errors.New("original Ethereum adapter requires canonical legacy RLP")
	}
	v, err := decodeRLPUint(fields[6], "v")
	if err != nil || v < 35 {
		return EthereumValueTransfer{}, errors.New("original Ethereum adapter requires a protected chain ID")
	}
	chainID := (v - 35) / 2
	if chainID == 0 || chainID > math.MaxInt64 {
		return EthereumValueTransfer{}, errors.New("original Ethereum adapter chain ID is invalid")
	}
	original, err := ethnative.Verify(payload, int64(chainID))
	if err != nil {
		return EthereumValueTransfer{}, err
	}
	var r, s [32]byte
	original.R.FillBytes(r[:])
	original.S.FillBytes(s[:])
	tx := EthereumValueTransfer{
		OriginalAdapter: true, EnvelopeType: EthereumLegacyTransferType,
		TransactionType: EthereumLegacyTransactionType, ChainID: int64(chainID),
		Nonce: original.Nonce, GasPrice: original.GasPrice.Uint64(), GasLimit: original.Gas,
		To: original.To, Value: original.Amount, Data: []byte{}, V: v, R: r, S: s,
		RecoveryID: byte(v - 35 - chainID*2), From: original.From, Fee: 1, Hash: original.Hash,
	}
	if err := tx.Verify(int64(chainID)); err != nil {
		return EthereumValueTransfer{}, err
	}
	return tx, nil
}

func validateOriginalEthereumAdapterFields(tx EthereumValueTransfer) error {
	if !tx.OriginalAdapter || tx.EnvelopeType != EthereumLegacyTransferType || tx.TransactionType != EthereumLegacyTransactionType || tx.GasLimit < ethnative.TransferGas || tx.GasLimit > ethnative.MaxGasLimit || tx.GasPrice != uint64(ethnative.GasPriceWei) || tx.Fee != 1 {
		return errors.New("original Ethereum adapter gas or fixed-fee fields changed")
	}
	return nil
}

// EthereumExecutionGas differs from the signed upper budget only in the
// original adapter, whose actual native transfer consumes exactly 25,000 gas.
func (tx EthereumValueTransfer) EthereumExecutionGas() uint64 {
	if tx.OriginalAdapter {
		return originalEthereumTransferGas
	}
	return tx.GasLimit
}
