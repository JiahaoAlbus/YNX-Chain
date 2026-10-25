package chain

import "sort"

const PQContractDeploymentRegistryVersion = "YNX-PQ-CONTRACT-DEPLOYMENT-REGISTRY/v1"

// PQContractDeploymentIdentity contains the three public commitments used by
// the typed deployment payload. It carries no sender, action, nonce, timestamp,
// permission or assertion that complete compiler material has been validated.
type PQContractDeploymentIdentity struct {
	SourceHash           string `json:"sourceHash"`
	DeployedBytecodeHash string `json:"deployedBytecodeHash"`
	CompilerConfigHash   string `json:"compilerConfigHash"`
}

// PQContractDeploymentRegistryEntry projects the single consensus registry.
// Creation code and raw ABI remain separately checked by the actual Builder;
// supplying these public hashes never substitutes for the original material.
type PQContractDeploymentRegistryEntry struct {
	Name string `json:"name"`
	PQContractDeploymentIdentity
	CreationBytecodeHash string `json:"creationBytecodeHash"`
	RawABIHash           string `json:"rawABIHash"`
}

// PQContractDeploymentRegistry is public DATA for original SDK/Main callers.
// Compiler flags and limitations retain their existing meaning verbatim. This
// describes the bounded interpreter and does not claim full EVM support.
type PQContractDeploymentRegistry struct {
	Version     string                              `json:"version"`
	RuntimeMode string                              `json:"runtimeMode"`
	Compiler    ContractCompilerConfig              `json:"compiler"`
	Contracts   []PQContractDeploymentRegistryEntry `json:"contracts"`
}

// PublicPQContractDeploymentRegistry returns independent values in name order.
// There is no second allowlist or mutable reference to the consensus table.
func PublicPQContractDeploymentRegistry() PQContractDeploymentRegistry {
	compiler := SolidityCompilerConfig()
	names := make([]string, 0, len(boundedPinnedContracts))
	for name := range boundedPinnedContracts {
		names = append(names, name)
	}
	sort.Strings(names)
	entries := make([]PQContractDeploymentRegistryEntry, 0, len(names))
	for _, name := range names {
		pin := boundedPinnedContracts[name]
		entries = append(entries, PQContractDeploymentRegistryEntry{
			Name: name,
			PQContractDeploymentIdentity: PQContractDeploymentIdentity{
				SourceHash: pin.SourceHash, DeployedBytecodeHash: pin.DeployedBytecodeHash,
				CompilerConfigHash: compiler.ConfigHash,
			},
			CreationBytecodeHash: pin.CreationBytecodeHash, RawABIHash: pin.RawABIHash,
		})
	}
	return PQContractDeploymentRegistry{
		Version: PQContractDeploymentRegistryVersion, RuntimeMode: BoundedContractRuntimeMode,
		Compiler: compiler, Contracts: entries,
	}
}

// ValidatePQContractDeploymentIdentity uses the real source/runtime membership
// validator, including its existing normalization and bounds. Its three hashes
// are DATA only: full artifact/build-info, creation/ABI, typed payload, account
// authorization and consensus execution checks remain mandatory in the normal
// deployment path. No deployment context is invented to compute this identity.
func ValidatePQContractDeploymentIdentity(name, source, deployedBytecode string) (PQContractDeploymentIdentity, error) {
	sourceHash, deployedHash, err := ValidateBoundedPinnedContract(name, source, deployedBytecode)
	if err != nil {
		return PQContractDeploymentIdentity{}, err
	}
	return PQContractDeploymentIdentity{
		SourceHash: sourceHash, DeployedBytecodeHash: deployedHash,
		CompilerConfigHash: SolidityCompilerConfig().ConfigHash,
	}, nil
}
