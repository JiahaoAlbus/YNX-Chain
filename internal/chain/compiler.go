package chain

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	contractCompilerVersion       = "0.8.24"
	contractCompilerPackage       = "hardhat/solc-wasm"
	contractCompilerConfigPath    = "hardhat.config.ts"
	contractArtifactKind          = "source-analyzer-artifact"
	contractPinnedArtifactKind    = "pinned-solc-bytecode-artifact"
	contractCompilerMode          = "deterministic-devnet-source-analyzer-with-pinned-solidity-config"
	contractPinnedCompilerMode    = "pinned-solidity-hardhat-artifact"
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

type hardhatArtifactFile struct {
	ContractName     string          `json:"contractName"`
	SourceName       string          `json:"sourceName"`
	ABI              json.RawMessage `json:"abi"`
	Bytecode         string          `json:"bytecode"`
	DeployedBytecode string          `json:"deployedBytecode"`
	InputSourceName  string          `json:"inputSourceName"`
	BuildInfoID      string          `json:"buildInfoId"`
}

type hardhatABIEntry struct {
	Type            string `json:"type"`
	Name            string `json:"name"`
	StateMutability string `json:"stateMutability"`
	Inputs          []struct {
		Name    string `json:"name"`
		Type    string `json:"type"`
		Indexed bool   `json:"indexed"`
	} `json:"inputs"`
	Outputs []struct {
		Type string `json:"type"`
	} `json:"outputs"`
}

type hardhatBuildInfoFile struct {
	SolcVersion string `json:"solcVersion"`
	Input       struct {
		Sources map[string]struct {
			Content string `json:"content"`
		} `json:"sources"`
	} `json:"input"`
}

type selectorMetadataFile struct {
	Artifacts map[string]selectorArtifactMetadata `json:"artifacts"`
}

type selectorArtifactMetadata struct {
	RuntimeSelectorMode string                     `json:"runtimeSelectorMode"`
	Functions           []selectorFunctionMetadata `json:"functions"`
	Events              []selectorEventMetadata    `json:"events"`
}

type selectorFunctionMetadata struct {
	Name                    string `json:"name"`
	Signature               string `json:"signature"`
	Selector                string `json:"selector"`
	BytecodeSelectorMatched bool   `json:"bytecodeSelectorMatched"`
}

type selectorEventMetadata struct {
	Name      string `json:"name"`
	Signature string `json:"signature"`
	Topic     string `json:"topic"`
}

func resolvePinnedCompilerArtifact(name, source string) (*ContractCompilerArtifact, bool) {
	root, ok := repoRoot()
	if !ok {
		return nil, false
	}
	sourceHash := hashParts("source", source)
	artifactsRoot := filepath.Join(root, "artifacts", "contracts")
	var matched *ContractCompilerArtifact
	_ = filepath.WalkDir(artifactsRoot, func(path string, entry os.DirEntry, err error) error {
		if err != nil || matched != nil || entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") || entry.Name() == "artifacts.d.ts" {
			return nil
		}
		payload, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		var artifact hardhatArtifactFile
		if err := json.Unmarshal(payload, &artifact); err != nil {
			return nil
		}
		if artifact.ContractName != name || artifact.SourceName == "" || artifact.Bytecode == "" || artifact.DeployedBytecode == "" {
			return nil
		}
		compiledSource, ok := hardhatBuildInfoSource(root, artifact.BuildInfoID, artifact.SourceName)
		if !ok || (hashParts("source", compiledSource) != sourceHash && hashParts("source", strings.TrimSpace(compiledSource)) != sourceHash) {
			return nil
		}
		relPath, _ := filepath.Rel(root, path)
		relPath = filepath.ToSlash(relPath)
		selectorMetadata, _ := hardhatSelectorMetadata(root, relPath)
		abiEvents := hardhatABIEvents(artifact.ABI, selectorMetadata)
		abiFunctions := hardhatABIFunctions(artifact.ABI, selectorMetadata)
		selectors := make([]string, 0, len(abiFunctions))
		matches := 0
		for _, function := range abiFunctions {
			selectors = append(selectors, function.Selector)
			if function.BytecodeSelectorMatched {
				matches++
			}
		}
		matched = &ContractCompilerArtifact{
			SourceName:                      artifact.SourceName,
			ContractName:                    artifact.ContractName,
			BuildInfoID:                     artifact.BuildInfoID,
			ArtifactPath:                    relPath,
			BytecodeHash:                    hashParts("solc-bytecode", artifact.Bytecode),
			DeployedBytecodeHash:            hashParts("solc-deployed-bytecode", artifact.DeployedBytecode),
			ABIHash:                         hashParts("solc-abi", string(artifact.ABI)),
			RuntimeSelectorMode:             selectorMetadata.RuntimeSelectorMode,
			RuntimeSelectors:                selectors,
			DeployedBytecodeSelectorMatches: matches,
			ABIFunctions:                    abiFunctions,
			ABIEvents:                       abiEvents,
			CompilerExecuted:                true,
			Status:                          "matched_hardhat_artifact",
		}
		return nil
	})
	return matched, matched != nil
}

func hardhatABIEvents(raw json.RawMessage, selectorMetadata selectorArtifactMetadata) []ContractEventABI {
	var entries []hardhatABIEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil
	}
	topics := map[string]selectorEventMetadata{}
	for _, event := range selectorMetadata.Events {
		topics[event.Signature] = event
	}
	events := make([]ContractEventABI, 0, len(entries))
	for _, entry := range entries {
		if entry.Type != "event" || entry.Name == "" {
			continue
		}
		inputs := make([]ContractEventInput, 0, len(entry.Inputs))
		inputTypes := make([]string, 0, len(entry.Inputs))
		for i, input := range entry.Inputs {
			name := input.Name
			if name == "" {
				name = fmt.Sprintf("arg%d", i)
			}
			inputs = append(inputs, ContractEventInput{Name: name, Type: input.Type, Indexed: input.Indexed})
			inputTypes = append(inputTypes, input.Type)
		}
		signature := entry.Name + "(" + strings.Join(inputTypes, ",") + ")"
		topic := topics[signature].Topic
		if topic == "" {
			topic = evmTopic("event:" + signature)
		}
		events = append(events, ContractEventABI{
			Name:      entry.Name,
			Signature: signature,
			Topic:     topic,
			Inputs:    inputs,
			Source:    "hardhat-ethers-event-topic-metadata",
		})
	}
	return events
}

func hardhatABIFunctions(raw json.RawMessage, selectorMetadata selectorArtifactMetadata) []ContractFunctionABI {
	var entries []hardhatABIEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil
	}
	selectors := map[string]selectorFunctionMetadata{}
	for _, function := range selectorMetadata.Functions {
		selectors[function.Signature] = function
	}
	functions := make([]ContractFunctionABI, 0, len(entries))
	for _, entry := range entries {
		if entry.Type != "function" || entry.Name == "" {
			continue
		}
		inputs := make([]ContractEventInput, 0, len(entry.Inputs))
		inputTypes := make([]string, 0, len(entry.Inputs))
		for i, input := range entry.Inputs {
			name := input.Name
			if name == "" {
				name = fmt.Sprintf("arg%d", i)
			}
			inputs = append(inputs, ContractEventInput{Name: name, Type: input.Type, Indexed: input.Indexed})
			inputTypes = append(inputTypes, input.Type)
		}
		outputs := make([]string, 0, len(entry.Outputs))
		for _, output := range entry.Outputs {
			outputs = append(outputs, output.Type)
		}
		signature := entry.Name + "(" + strings.Join(inputTypes, ",") + ")"
		selector := selectors[signature]
		functions = append(functions, ContractFunctionABI{
			Name:                    entry.Name,
			Signature:               signature,
			Selector:                selector.Selector,
			SelectorSource:          "hardhat-ethers-keccak-selector-metadata",
			BytecodeSelectorMatched: selector.BytecodeSelectorMatched,
			Inputs:                  inputs,
			Outputs:                 outputs,
			StateMutability:         entry.StateMutability,
		})
	}
	return functions
}

func hardhatSelectorMetadata(root, artifactPath string) (selectorArtifactMetadata, bool) {
	payload, err := os.ReadFile(filepath.Join(root, "artifacts", "ynx-selector-metadata.json"))
	if err != nil {
		return selectorArtifactMetadata{RuntimeSelectorMode: "missing-hardhat-selector-metadata"}, false
	}
	var metadata selectorMetadataFile
	if err := json.Unmarshal(payload, &metadata); err != nil {
		return selectorArtifactMetadata{RuntimeSelectorMode: "invalid-hardhat-selector-metadata"}, false
	}
	artifact, ok := metadata.Artifacts[artifactPath]
	if !ok {
		return selectorArtifactMetadata{RuntimeSelectorMode: "missing-artifact-selector-metadata"}, false
	}
	return artifact, true
}

func hardhatDeployedBytecode(artifactPath string) (string, bool) {
	root, ok := repoRoot()
	if !ok || artifactPath == "" {
		return "", false
	}
	payload, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(artifactPath)))
	if err != nil {
		return "", false
	}
	var artifact hardhatArtifactFile
	if err := json.Unmarshal(payload, &artifact); err != nil || artifact.DeployedBytecode == "" {
		return "", false
	}
	return artifact.DeployedBytecode, true
}

func hardhatBuildInfoSource(root, buildInfoID, sourceName string) (string, bool) {
	if buildInfoID == "" || sourceName == "" {
		return "", false
	}
	payload, err := os.ReadFile(filepath.Join(root, "artifacts", "build-info", buildInfoID+".json"))
	if err != nil {
		return "", false
	}
	var buildInfo hardhatBuildInfoFile
	if err := json.Unmarshal(payload, &buildInfo); err != nil || buildInfo.SolcVersion != contractCompilerVersion {
		return "", false
	}
	for key, source := range buildInfo.Input.Sources {
		if key == sourceName || strings.TrimPrefix(key, "project/") == sourceName {
			return source.Content, source.Content != ""
		}
	}
	return "", false
}

func repoRoot() (string, bool) {
	dir, err := os.Getwd()
	if err != nil {
		return "", false
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, contractCompilerConfigPath)); err == nil {
			return dir, true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}
