package consensus

import (
	"encoding/json"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func queryLegacyContracts(response *abcitypes.ResponseQuery, path string, state CommittedState) bool {
	source := state.LegacyContracts
	if path == "/ide/source" {
		response.Value, _ = json.Marshal(source)
		return true
	}
	if source == nil {
		return false
	}
	if strings.HasPrefix(path, "/ide/source/") {
		address := strings.TrimPrefix(path, "/ide/source/")
		original, ok := source.Contracts[address]
		if !ok {
			response.Code, response.Log = 1, "original source contract not found"
			return true
		}
		response.Value, _ = json.Marshal(struct {
			chain.ContractArtifact
			SourceAnchor string `json:"sourceAnchor"`
		}{original, source.SourceAnchor})
		return true
	}
	if strings.HasPrefix(path, "/ide/verifier/") {
		address := strings.TrimPrefix(path, "/ide/verifier/")
		original, ok := source.Contracts[address]
		if !ok {
			return false
		}
		index, ok := bftContractIndex(state.Contracts, address)
		if !ok {
			response.Code, response.Log = 1, "imported executable contract missing"
			return true
		}
		live := state.Contracts[index]
		response.Value, _ = json.Marshal(map[string]any{"address": address, "sourceAnchor": source.SourceAnchor, "original": original, "runtimeMode": live.RuntimeMode, "sourceHash": live.SourceHash, "deployedBytecodeHash": live.DeployedBytecodeHash, "codeMaterialStatus": "original_artifact_bytes_validated", "originalVerified": original.Verified, "lastCallTxHash": live.LastCallTxHash, "lastUpdatedHeight": live.LastUpdatedHeight, "remotePublicProofStatus": "not_claimed"})
		return true
	}
	if strings.HasPrefix(path, "/ide/call/") {
		parts := strings.SplitN(strings.TrimPrefix(path, "/ide/call/"), "/", 2)
		if len(parts) != 2 {
			return false
		}
		original, ok := source.Contracts[parts[0]]
		if !ok {
			return false
		}
		index, ok := bftContractIndex(state.Contracts, parts[0])
		if !ok {
			response.Code, response.Log = 1, "imported executable contract missing"
			return true
		}
		live := state.Contracts[index]
		encoded, steps, err := chain.CallConsensusSourceContract(original, live.DeployedBytecode, parts[1], live.RuntimeStorage)
		if err != nil {
			response.Code, response.Log = 1, "imported static call failed: "+err.Error()
			return true
		}
		response.Value, _ = json.Marshal(map[string]any{"address": live.Address, "sourceAnchor": source.SourceAnchor, "encodedResult": encoded, "opcodeStepCount": steps, "runtimeMode": live.RuntimeMode})
		return true
	}
	return false
}
