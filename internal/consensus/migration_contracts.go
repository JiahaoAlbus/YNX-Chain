package consensus

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// LegacyContracts keeps original ABI/compiler/verifier and storage provenance.
// It is immutable; live Contracts hold the current executable storage. Original
// source deployment/history is never relabeled as a new BFT receipt.
type LegacyContracts struct {
	SourceAnchor string                            `json:"sourceAnchor"`
	Contracts    map[string]chain.ContractArtifact `json:"contracts"`
}

func migrationLegacyContracts(m chain.ConsensusMigrationState) *LegacyContracts {
	if m.Runtime == nil || len(m.Runtime.Contracts) == 0 {
		return nil
	}
	return cloneLegacyContracts(&LegacyContracts{SourceAnchor: m.StateHash, Contracts: m.Runtime.Contracts})
}

func cloneLegacyContracts(value *LegacyContracts) *LegacyContracts {
	if value == nil {
		return nil
	}
	raw, _ := json.Marshal(value)
	var copy LegacyContracts
	_ = json.Unmarshal(raw, &copy)
	return &copy
}

func migrationContracts(m chain.ConsensusMigrationState) ([]BFTContract, error) {
	if m.Runtime == nil || len(m.Runtime.Contracts) == 0 {
		return nil, nil
	}
	values := make([]BFTContract, 0, len(m.Runtime.Contracts))
	addresses := make([]string, 0, len(m.Runtime.Contracts))
	for address := range m.Runtime.Contracts {
		addresses = append(addresses, address)
	}
	sort.Strings(addresses)
	for _, address := range addresses {
		value, err := migrationContract(m, address, m.Runtime.Contracts[address])
		if err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	return values, nil
}

func migrationContract(m chain.ConsensusMigrationState, address string, original chain.ContractArtifact) (BFTContract, error) {
	bytecode, err := chain.ValidateConsensusContractMaterial(original, m.ContractMaterials[original.Name])
	if err != nil {
		return BFTContract{}, fmt.Errorf("contract %s: %w", address, err)
	}
	if address != original.Address || !IsNativeAddress(address) || !IsNativeAddress(original.Deployer) || m.Runtime.Accounts[original.Deployer] == nil || original.DeployedAt.IsZero() {
		return BFTContract{}, fmt.Errorf("contract %s has unmapped original identity", address)
	}
	deployments := 0
	for _, block := range m.Runtime.Blocks {
		for _, tx := range block.Transactions {
			if tx.Type == "contract_deploy" && tx.To == address {
				if tx.From != original.Deployer {
					return BFTContract{}, fmt.Errorf("contract %s deployment owner differs from source", address)
				}
				deployments++
			}
		}
	}
	if deployments != 1 {
		return BFTContract{}, fmt.Errorf("contract %s requires exactly one original deployment", address)
	}
	for key, value := range original.RuntimeStorage {
		if !ideWordPattern.MatchString(key) || !ideWordPattern.MatchString(value) {
			return BFTContract{}, fmt.Errorf("contract %s has unsupported source storage", address)
		}
	}
	value := BFTContract{SourceAnchor: m.StateHash, Address: address, Name: original.Name, Deployer: original.Deployer, SourceHash: original.SourceHash, DeployedBytecodeHash: original.DeployedBytecodeHash, DeployedBytecode: bytecode, ConstructorArgs: append([]string(nil), original.ConstructorArgs...), RuntimeStorage: cloneStringMap(original.RuntimeStorage), RuntimeMode: chain.BoundedContractRuntimeMode}
	value.AuditHash = bftContractAuditHash(value)
	return value, nil
}

func migrationContractBlockers(m chain.ConsensusMigrationState) []MigrationModuleBlocker {
	if m.Runtime == nil {
		return nil
	}
	var result []MigrationModuleBlocker
	for address, original := range m.Runtime.Contracts {
		if _, err := migrationContract(m, address, original); err != nil {
			result = append(result, MigrationModuleBlocker{Module: "contracts/" + address, Records: 1, Reason: err.Error()})
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Module < result[j].Module })
	return result
}

func validateLegacyContracts(s CommittedState, m chain.ConsensusMigrationState) error {
	if s.Version < 15 && s.LegacyContracts != nil {
		return errors.New("legacy state cannot carry imported contract authority")
	}
	if !reflect.DeepEqual(s.LegacyContracts, migrationLegacyContracts(m)) {
		return errors.New("imported contract source inventory or metadata differs from migration")
	}
	expected, err := migrationContracts(m)
	if err != nil {
		return err
	}
	byAddress := make(map[string]BFTContract, len(expected))
	for _, v := range expected {
		byAddress[v.Address] = v
	}
	for _, current := range s.Contracts {
		original, imported := byAddress[current.Address]
		if !imported {
			if current.SourceAnchor != "" {
				return errors.New("native contract forges a migration source anchor")
			}
			continue
		}
		delete(byAddress, current.Address)
		if current.SourceAnchor != original.SourceAnchor || current.Address != original.Address || current.Name != original.Name || current.Deployer != original.Deployer || current.SourceHash != original.SourceHash || current.DeployedBytecodeHash != original.DeployedBytecodeHash || current.DeployedBytecode != original.DeployedBytecode || !reflect.DeepEqual(current.ConstructorArgs, original.ConstructorArgs) || current.RuntimeMode != original.RuntimeMode || current.BlockHeight != 0 || current.TxHash != "" {
			return errors.New("imported contract identity/address/code was replaced or assigned a fabricated BFT deployment")
		}
		if current.LastCallTxHash == "" {
			if !reflect.DeepEqual(current, original) {
				return errors.New("untouched imported contract differs from original committed storage")
			}
		} else {
			if current.LastUpdatedHeight <= int64(m.Height) || current.LastUpdatedHeight > s.Height {
				return errors.New("imported contract update precedes cutover or exceeds committed height")
			}
			found := false
			for _, receipt := range s.EVMReceipts {
				if receipt.TxHash == current.LastCallTxHash && receipt.Action == ActionIDEContractCall && receipt.To == current.Address && receipt.BlockHeight == current.LastUpdatedHeight {
					found = true
				}
			}
			if !found {
				return errors.New("imported contract update has no real BFT call receipt")
			}
		}
	}
	if len(byAddress) != 0 {
		return errors.New("imported executable contract was omitted")
	}
	return nil
}
