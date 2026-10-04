// Generate compatibility evidence from the original Go analyzer only.
// All state is new and in-memory. No HTTP, profile, signing key or public
// transaction is used. This is not evidence of a deployed public contract.
package main

import (
	"encoding/json"
	"os"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func main() {
	source := "pragma solidity ^0.8.24; contract WalletReadOnlyCompatibility { function ping() public pure returns (uint256) { return 7; } function ok() public view returns (bool) { return true; } }"
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("devnet"))
	if _, err := devnet.Faucet("ynx_wallet_contract_fixture", 100); err != nil {
		panic(err)
	}
	artifact, _, err := devnet.DeployContract("ynx_wallet_contract_fixture", "WalletReadOnlyCompatibility", source)
	if err != nil {
		panic(err)
	}
	if artifact.ArtifactKind != "source-analyzer-artifact" {
		panic("fixture must exercise the original source analyzer, not bytecode")
	}
	reads := make([]chain.ContractCallResult, 0, len(artifact.Functions))
	for _, function := range artifact.Functions {
		result, err := devnet.CallContract(artifact.Address, function.Selector)
		if err != nil {
			panic(err)
		}
		reads = append(reads, result)
	}
	err = json.NewEncoder(os.Stdout).Encode(struct {
		Source   string                     `json:"source"`
		Artifact chain.ContractArtifact     `json:"artifact"`
		Reads    []chain.ContractCallResult `json:"reads"`
	}{source, artifact, reads})
	if err != nil {
		panic(err)
	}
}
