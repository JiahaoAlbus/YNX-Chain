package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func main() {
	var input struct {
		CanonicalPayloadHex string `json:"canonicalPayloadHex"`
		TransactionHash     string `json:"transactionHash"`
	}
	decoder := json.NewDecoder(os.Stdin)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		panic(err)
	}
	payload, err := hex.DecodeString(strings.TrimPrefix(input.CanonicalPayloadHex, "0x"))
	if err != nil {
		panic(err)
	}
	tx, err := consensus.DecodeSignedApplicationAction(payload)
	if err != nil {
		panic(err)
	}
	if err := tx.Verify(6423); err != nil {
		panic(err)
	}
	if tx.Action != consensus.ActionIDEContractDeploy || consensus.ApplicationActionHash(payload) != input.TransactionHash {
		panic("Developer Wallet transaction binding mismatch")
	}
	fmt.Printf("%s %s %d\n", tx.Action, input.TransactionHash, tx.Nonce)
}
