package chain

const (
	contractCompilerVersion       = "0.8.24"
	contractCompilerPackage       = "hardhat/solc-wasm"
	contractCompilerConfigPath    = "hardhat.config.ts"
	contractArtifactKind          = "source-analyzer-artifact"
	contractCompilerMode          = "deterministic-devnet-source-analyzer-with-pinned-solidity-config"
	contractVerifierMode          = "source-hash-and-pinned-config-local-verifier"
	contractReproducibilityStatus = "pinned-solidity-config-recorded; bytecode is deterministic devnet analyzer output until production solc execution is wired"
)

func SolidityCompilerConfig() ContractCompilerConfig {
	configHash := hashParts(
		"solidity-compiler",
		contractCompilerVersion,
		contractCompilerPackage,
		contractCompilerConfigPath,
		"preferWasm=true",
		"optimizer=true",
		"runs=200",
	)
	return ContractCompilerConfig{
		ID:                        "solidity-" + contractCompilerVersion,
		Language:                  "Solidity",
		Version:                   contractCompilerVersion,
		Package:                   contractCompilerPackage,
		ConfigPath:                contractCompilerConfigPath,
		Source:                    "repo-pinned-hardhat-config",
		PreferWasm:                true,
		OptimizerEnabled:          true,
		OptimizerRuns:             200,
		Pinned:                    true,
		ConfigHash:                configHash,
		ArtifactKind:              contractArtifactKind,
		CompilerMode:              contractCompilerMode,
		VerifierMode:              contractVerifierMode,
		ProductionCompilerEnabled: false,
		ReproducibilityStatus:     contractReproducibilityStatus,
		Limitations: []string{
			"compiler version and settings are pinned from hardhat.config.ts",
			"devnet artifact bytecode is deterministic analyzer metadata, not production solc bytecode",
			"production verification requires executing the pinned compiler and comparing deployed bytecode",
		},
	}
}
