package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

type input struct {
	CanonicalPayloadHex string `json:"canonicalPayloadHex"`
	TransactionHash     string `json:"transactionHash"`
	Action              string `json:"action"`
}

func main() {
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, consensus.MaxSignedActionSize*2))
	if err != nil {
		fail(err)
	}
	var value input
	if err := json.Unmarshal(raw, &value); err != nil {
		fail(err)
	}
	if !strings.HasPrefix(value.CanonicalPayloadHex, "0x") || !strings.HasPrefix(value.TransactionHash, "0x") {
		fail(fmt.Errorf("canonical payload and transaction hash must use 0x encoding"))
	}
	payload, err := hex.DecodeString(strings.TrimPrefix(value.CanonicalPayloadHex, "0x"))
	if err != nil {
		fail(err)
	}
	tx, err := consensus.DecodeSignedApplicationAction(payload)
	if err != nil {
		fail(err)
	}
	if err := tx.Verify(6423); err != nil {
		fail(err)
	}
	if tx.Action != value.Action || consensus.ApplicationActionHash(payload) != value.TransactionHash {
		fail(fmt.Errorf("DEX Wallet action, payload hash or transaction hash binding mismatch"))
	}
	switch tx.Action {
	case consensus.ActionDexSwapExactInput:
		var decoded consensus.DexSwapExactInputPayload
		if json.Unmarshal(tx.Payload, &decoded) != nil || decoded.PoolID == "" || decoded.AssetIn == "" || decoded.AmountIn <= 0 || decoded.MinAmountOut <= 0 || decoded.DeadlineUnix <= 0 {
			fail(fmt.Errorf("invalid exact-input payload"))
		}
	case consensus.ActionDexSwapExactOutput:
		var decoded consensus.DexSwapExactOutputPayload
		if json.Unmarshal(tx.Payload, &decoded) != nil || decoded.PoolID == "" || decoded.AssetOut == "" || decoded.AmountOut <= 0 || decoded.MaxAmountIn <= 0 || decoded.DeadlineUnix <= 0 {
			fail(fmt.Errorf("invalid exact-output payload"))
		}
	case consensus.ActionDexLiquidityAdd:
		var decoded consensus.DexLiquidityPayload
		if json.Unmarshal(tx.Payload, &decoded) != nil || decoded.PoolID == "" || decoded.Amount0 <= 0 || decoded.Amount1 <= 0 || decoded.MinShares <= 0 || decoded.DeadlineUnix <= 0 {
			fail(fmt.Errorf("invalid add-liquidity payload"))
		}
	case consensus.ActionDexLiquidityRemove:
		var decoded consensus.DexLiquidityRemovePayload
		if json.Unmarshal(tx.Payload, &decoded) != nil || decoded.PoolID == "" || decoded.Shares <= 0 || decoded.MinAmount0 <= 0 || decoded.MinAmount1 <= 0 || decoded.DeadlineUnix <= 0 {
			fail(fmt.Errorf("invalid remove-liquidity payload"))
		}
	default:
		fail(fmt.Errorf("unsupported DEX Wallet action %q", tx.Action))
	}
	fmt.Printf("%s %s %d\n", tx.Action, value.TransactionHash, tx.Nonce)
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
