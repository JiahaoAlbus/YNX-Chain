package chain

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
)

// Raw files preserve the original ABI hash, including its JSON whitespace.
// Materials are shared by registered contract name, not repeated per address.
// Execution uses only code verified against both the source checkpoint and the
// bounded registry. Neither a path nor a compiler label is proof of that code.
type ConsensusContractMaterial struct {
	ArtifactFile  []byte `json:"artifactFile"`
	BuildInfoFile []byte `json:"buildInfoFile"`
}

type ConsensusContractBlocker struct {
	Address string `json:"address"`
	Reason  string `json:"reason"`
}

var consensusContractSources = map[string]string{
	"SampleEVMWriteCounter":     "contracts/devtools/SampleEVMWriteCounter.sol",
	"SampleYNXTCompatibleERC20": "contracts/tokens/SampleYNXTCompatibleERC20.sol",
}

var consensusBuildID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,160}$`)

const consensusArtifactLimit = 1 << 20
const consensusBuildInfoLimit = 16 << 20

// LoadConsensusContractMaterials reads only this source repository's fixed
// artifact roots. A missing/unsupported contract remains in Runtime and produces
// an address-specific blocker; it is never replaced with a fresh deployment.
func LoadConsensusContractMaterials(runtime *ConsensusRuntimeState) (map[string]ConsensusContractMaterial, []ConsensusContractBlocker) {
	if runtime == nil || len(runtime.Contracts) == 0 {
		return nil, nil
	}
	root, ok := repoRoot()
	materials := make(map[string]ConsensusContractMaterial)
	var blockers []ConsensusContractBlocker
	addresses := make([]string, 0, len(runtime.Contracts))
	for address := range runtime.Contracts {
		addresses = append(addresses, address)
	}
	sort.Strings(addresses)
	for _, address := range addresses {
		original := runtime.Contracts[address]
		var err error
		material, exists := materials[original.Name]
		if !ok {
			err = errors.New("fixed source artifact root is unavailable")
		} else if !exists {
			material, err = readConsensusContractMaterial(root, original.Name)
		}
		if err == nil {
			_, err = ValidateConsensusContractMaterial(original, material)
		}
		if err != nil {
			blockers = append(blockers, ConsensusContractBlocker{Address: address, Reason: err.Error()})
			continue
		}
		materials[original.Name] = material
	}
	if len(materials) == 0 {
		materials = nil
	}
	return materials, blockers
}

func readConsensusContractMaterial(root, name string) (ConsensusContractMaterial, error) {
	source, ok := consensusContractSources[name]
	if !ok {
		return ConsensusContractMaterial{}, errors.New("contract is outside the bounded registry")
	}
	artifactPath := "artifacts/" + source + "/" + name + ".json"
	raw, err := readConfinedConsensusArtifact(root, "artifacts/contracts", artifactPath, consensusArtifactLimit)
	if err != nil {
		return ConsensusContractMaterial{}, err
	}
	var artifact hardhatArtifactFile
	if err := json.Unmarshal(raw, &artifact); err != nil || !consensusBuildID.MatchString(artifact.BuildInfoID) {
		return ConsensusContractMaterial{}, errors.New("actual artifact has invalid build-info identity")
	}
	build, err := readConfinedConsensusArtifact(root, "artifacts/build-info", "artifacts/build-info/"+artifact.BuildInfoID+".json", consensusBuildInfoLimit)
	if err != nil {
		return ConsensusContractMaterial{}, err
	}
	return ConsensusContractMaterial{ArtifactFile: raw, BuildInfoFile: build}, nil
}

func readConfinedConsensusArtifact(root, allowed, relative string, limit int64) ([]byte, error) {
	if filepath.IsAbs(relative) || strings.Contains(relative, "\\") || filepath.ToSlash(filepath.Clean(relative)) != relative || !strings.HasPrefix(relative, allowed+"/") {
		return nil, errors.New("contract artifact path is not canonical within its fixed root")
	}
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	path, err := filepath.EvalSymlinks(filepath.Join(realRoot, filepath.FromSlash(relative)))
	if err != nil {
		return nil, fmt.Errorf("contract code material unavailable: %w", err)
	}
	base := filepath.Join(realRoot, filepath.FromSlash(allowed)) + string(filepath.Separator)
	if !strings.HasPrefix(path, base) {
		return nil, errors.New("contract material symlink escapes its fixed source root")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > limit {
		return nil, errors.New("contract material is not a bounded regular file")
	}
	raw, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(raw)) > limit {
		return nil, errors.New("contract material exceeds its size limit")
	}
	return raw, nil
}

// ValidateConsensusContractMaterial is deterministic and performs no filesystem
// access. Its returned bytecode is the actual verified executable material.
func ValidateConsensusContractMaterial(original ContractArtifact, material ConsensusContractMaterial) (string, error) {
	sourceName, supported := consensusContractSources[original.Name]
	if !supported || original.CompilerArtifact == nil || original.ArtifactKind != contractPinnedArtifactKind {
		return "", errors.New("source contract lacks supported pinned compiler provenance")
	}
	if len(material.ArtifactFile) == 0 || len(material.ArtifactFile) > consensusArtifactLimit || len(material.BuildInfoFile) == 0 || len(material.BuildInfoFile) > consensusBuildInfoLimit {
		return "", errors.New("source contract is missing bounded actual artifact/build-info material")
	}
	var artifact hardhatArtifactFile
	if err := json.Unmarshal(material.ArtifactFile, &artifact); err != nil {
		return "", err
	}
	meta := original.CompilerArtifact
	expectedPath := "artifacts/" + sourceName + "/" + original.Name + ".json"
	if artifact.ContractName != original.Name || artifact.SourceName != sourceName || !consensusBuildID.MatchString(artifact.BuildInfoID) || meta.ContractName != artifact.ContractName || meta.SourceName != sourceName || meta.ArtifactPath != expectedPath || meta.BuildInfoID != artifact.BuildInfoID {
		return "", errors.New("actual contract artifact identity differs from original source record")
	}
	var build struct {
		SolcVersion string `json:"solcVersion"`
		Input       struct {
			Sources map[string]struct {
				Content string `json:"content"`
			} `json:"sources"`
			Settings struct {
				Optimizer struct {
					Enabled bool `json:"enabled"`
					Runs    int  `json:"runs"`
				} `json:"optimizer"`
			} `json:"settings"`
		} `json:"input"`
	}
	if err := json.Unmarshal(material.BuildInfoFile, &build); err != nil || build.SolcVersion != contractCompilerVersion || !build.Input.Settings.Optimizer.Enabled || build.Input.Settings.Optimizer.Runs != 200 {
		return "", errors.New("actual build-info compiler settings differ from the pinned source compiler")
	}
	source := build.Input.Sources[sourceName].Content
	prefixed := build.Input.Sources["project/"+sourceName].Content
	if source != "" && prefixed != "" && source != prefixed {
		return "", errors.New("ambiguous build-info source contents")
	}
	if source == "" {
		source = prefixed
	}
	if source == "" || (original.SourceHash != hashParts("source", source) && original.SourceHash != hashParts("source", strings.TrimSpace(source))) {
		return "", errors.New("actual compiled source does not match original source hash")
	}
	_, deployedHash, err := ValidateBoundedPinnedContract(original.Name, source, artifact.DeployedBytecode)
	if err != nil {
		return "", err
	}
	if artifact.DeployedBytecode != normalizeHex(artifact.DeployedBytecode) || artifact.Bytecode != normalizeHex(artifact.Bytecode) || artifact.Bytecode == "0x" || original.DeployedBytecodeHash != deployedHash || meta.DeployedBytecodeHash != deployedHash || original.BytecodeHash != hashParts("solc-bytecode", artifact.Bytecode) || meta.BytecodeHash != original.BytecodeHash || meta.ABIHash != hashParts("solc-abi", string(artifact.ABI)) {
		return "", errors.New("actual ABI/creation/runtime bytecode does not match original compiler hashes")
	}
	config := SolidityCompilerConfig()
	if original.CompilerConfigHash != config.ConfigHash || original.Compiler.ConfigHash != config.ConfigHash || original.Compiler.Version != contractCompilerVersion || original.ArtifactHash != hashParts("artifact", config.ConfigHash, original.ArtifactKind, original.Name, original.SourceHash, original.BytecodeHash, original.DeployedBytecodeHash, fmt.Sprint(len(original.ABI))) {
		return "", errors.New("source contract compiler/artifact commitment is inconsistent")
	}
	if err := validateConsensusContractFunctions(original, artifact); err != nil {
		return "", err
	}
	if !reflect.DeepEqual(original.RuntimeStorageSlots, extractRuntimeStorageSlots(source)) {
		return "", errors.New("source storage-slot metadata differs from actual compiled source")
	}
	return artifact.DeployedBytecode, nil
}

func validateConsensusContractFunctions(original ContractArtifact, artifact hardhatArtifactFile) error {
	var entries []hardhatABIEntry
	if err := json.Unmarshal(artifact.ABI, &entries); err != nil {
		return err
	}
	metadata := selectorArtifactMetadata{}
	for _, entry := range entries {
		if entry.Type != "function" && entry.Type != "event" {
			continue
		}
		types := make([]string, len(entry.Inputs))
		for i, input := range entry.Inputs {
			types[i] = input.Type
		}
		signature := entry.Name + "(" + strings.Join(types, ",") + ")"
		if entry.Type == "event" {
			metadata.Events = append(metadata.Events, selectorEventMetadata{Name: entry.Name, Signature: signature, Topic: "0x" + hex.EncodeToString(legacyKeccak256([]byte(signature)))})
			continue
		}
		selector := "0x" + hex.EncodeToString(legacyKeccak256([]byte(signature))[:4])
		metadata.Functions = append(metadata.Functions, selectorFunctionMetadata{Name: entry.Name, Signature: signature, Selector: selector, BytecodeSelectorMatched: strings.Contains(artifact.DeployedBytecode[2:], selector[2:])})
	}
	expected := hardhatABIFunctions(artifact.ABI, metadata)
	if len(expected) != len(original.Functions) || len(expected) != len(original.CompilerArtifact.ABIFunctions) {
		return errors.New("source function inventory differs from actual ABI")
	}
	for i, actual := range expected {
		for _, recorded := range []ContractFunctionABI{original.Functions[i], original.CompilerArtifact.ABIFunctions[i]} {
			if recorded.Name != actual.Name || recorded.Signature != actual.Signature || recorded.Selector != actual.Selector || recorded.BytecodeSelectorMatched != actual.BytecodeSelectorMatched || recorded.StateMutability != actual.StateMutability || len(recorded.Inputs) != len(actual.Inputs) || len(recorded.Inputs) > 0 && !reflect.DeepEqual(recorded.Inputs, actual.Inputs) || len(recorded.Outputs) != len(actual.Outputs) || len(recorded.Outputs) > 0 && !reflect.DeepEqual(recorded.Outputs, actual.Outputs) {
				return errors.New("source function selector/ABI authority differs from actual artifact")
			}
		}
	}
	events := hardhatABIEvents(artifact.ABI, metadata)
	if !reflect.DeepEqual(original.Events, events) || !reflect.DeepEqual(original.CompilerArtifact.ABIEvents, events) {
		return errors.New("source event evidence differs from actual ABI topics")
	}
	abi := make([]ContractABIEntry, 0, len(events)+len(expected))
	for _, event := range events {
		abi = append(abi, ContractABIEntry{Type: "event", Name: event.Name, Signature: event.Signature, Topic: event.Topic, Inputs: event.Inputs})
	}
	for _, function := range expected {
		abi = append(abi, ContractABIEntry{Type: "function", Name: function.Name, Signature: function.Signature, Selector: function.Selector, Inputs: function.Inputs, Outputs: function.Outputs, StateMutability: function.StateMutability})
	}
	want, _ := json.Marshal(abi)
	got, _ := json.Marshal(original.ABI)
	if !bytes.Equal(want, got) {
		return errors.New("source ABI projection differs from actual artifact ABI")
	}
	return nil
}

func CallConsensusSourceContract(original ContractArtifact, bytecode, calldata string, storage map[string]string) (string, int, error) {
	calldata = normalizeHex(calldata)
	if len(calldata) < 10 {
		return "", 0, errors.New("source static call requires ABI calldata")
	}
	for _, candidate := range original.Functions {
		if candidate.Selector == calldata[:10] && candidate.BytecodeSelectorMatched && (candidate.StateMutability == "pure" || candidate.StateMutability == "view") {
			return CallBoundedContract(bytecode, calldata, storage)
		}
	}
	return "", 0, errors.New("source contract does not admit this static selector")
}

func CloneConsensusContractMaterials(input map[string]ConsensusContractMaterial) map[string]ConsensusContractMaterial {
	if len(input) == 0 {
		return nil
	}
	copy := make(map[string]ConsensusContractMaterial, len(input))
	for name, value := range input {
		copy[name] = ConsensusContractMaterial{ArtifactFile: bytes.Clone(value.ArtifactFile), BuildInfoFile: bytes.Clone(value.BuildInfoFile)}
	}
	return copy
}

// ExecuteConsensusSourceContract preserves the original write-selector and ERC20
// transition checks while using current committed storage and verified code.
func ExecuteConsensusSourceContract(original ContractArtifact, bytecode, calldata, caller string, storage map[string]string) (BoundedContractTransition, error) {
	calldata = normalizeHex(calldata)
	if len(calldata) < 10 {
		return BoundedContractTransition{}, errors.New("source contract requires ABI calldata")
	}
	var candidate *ContractFunctionABI
	for i := range original.Functions {
		if original.Functions[i].Selector == calldata[:10] {
			candidate = &original.Functions[i]
			break
		}
	}
	if candidate == nil || !candidate.BytecodeSelectorMatched || candidate.StateMutability == "pure" || candidate.StateMutability == "view" {
		return BoundedContractTransition{}, errors.New("source contract does not admit this write selector")
	}
	transition, err := ExecuteBoundedContract(bytecode, calldata, caller, storage)
	if err != nil {
		return BoundedContractTransition{}, err
	}
	if len(transition.StorageWrites) == 0 && len(transition.Logs) == 0 {
		return BoundedContractTransition{}, errors.New("source write has no state transition evidence")
	}
	if candidate.Signature == "transfer(address,uint256)" {
		to, _, err := decodeERC20TransferCalldata(calldata)
		slot, exists := original.RuntimeStorageSlots["balanceOf"]
		fromKey, fromOK := solidityMappingStorageKey(evmAddressForLog(caller), slot)
		toKey, toOK := solidityMappingStorageKey(to, slot)
		_, wroteFrom := transition.Storage[fromKey]
		_, wroteTo := transition.Storage[toKey]
		if err != nil || !exists || !fromOK || !toOK || transition.EncodedResult != encodeContractReturn("true", candidate.Outputs) || len(transition.StorageWrites) < 2 || !wroteFrom || !wroteTo {
			return BoundedContractTransition{}, errors.New("source ERC20 transfer evidence is incomplete")
		}
	}
	return transition, nil
}
