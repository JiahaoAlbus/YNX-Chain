package bftgateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math/big"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ethnative"
)

// This describes the original fixed-fee adapter at the configured node. It
// does not supply account authorization or independently prove finality.
func (g *Gateway) evmOriginalFeeModel(ctx context.Context, raw json.RawMessage) (any, int, error) {
	if len(raw) != 0 {
		trimmed := bytes.TrimSpace(raw)
		if len(trimmed) == 0 || trimmed[0] != '[' {
			return nil, -32602, errors.New("ynx_getFeeModel accepts an empty array only")
		}
		var params []json.RawMessage
		if json.Unmarshal(trimmed, &params) != nil || len(params) != 0 {
			return nil, -32602, errors.New("ynx_getFeeModel accepts an empty array only")
		}
	}
	var observed consensus.EthereumOriginalObservation
	height, err := g.queryPQWalletJSON(ctx, consensus.EthereumOriginalCapabilityPath, &observed)
	if err != nil || consensus.ValidateEthereumOriginalObservation(observed, height) != nil || observed.NativeChainID != 6423 {
		return nil, -32004, errors.New("original Ethereum capability is unavailable from configured ABCI")
	}
	model := map[string]any{
		"version": "ynx-ethereum-native-v1", "enabled": true,
		"chainId": "0x1917", "transactionType": "0x0", "feeYNXT": "1",
		"feeWei": ethnative.Quantity(ethnative.Wei(1)), "gas": hexEVMQuantity(ethnative.TransferGas),
		"gasPrice": ethnative.Quantity(big.NewInt(ethnative.GasPriceWei)), "decimals": 18,
		"amountQuantumWei": ethnative.Quantity(ethnative.Wei(1)), "scope": "whole-YNXT plain native transfers",
		"fullEVM": false, "eip1559": false, "ynxBFTObservation": observed,
	}
	encoded, err := json.Marshal(model)
	if err != nil || len(encoded) > 4096 {
		return nil, -32004, errors.New("original Ethereum capability exceeds bounded result")
	}
	return model, 0, nil
}
