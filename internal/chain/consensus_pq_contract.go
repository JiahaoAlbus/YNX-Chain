package chain

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// Both ledgers use this artifact assembler. Material resolution and the actual
// execution timestamp belong to the caller; consensus never reads local files
// or the wall clock while interpreting a transaction.
func buildContractArtifactFromCompiler(address, deployer, name, source string, verified bool, verifiedAt *time.Time, constructorArgs []string, compilerArtifact *ContractCompilerArtifact, hasCompilerArtifact bool, deployedAt time.Time) ContractArtifact {
	sourceHash := hashParts("source", source)
	compiler := SolidityCompilerConfig()
	events := extractContractEvents(source)
	functions := extractContractFunctions(source)
	runtimeStorageSlots := extractRuntimeStorageSlots(source)
	runtimeStorage := extractRuntimeStorage(source, deployer, constructorArgs)
	if hasCompilerArtifact {
		events = mergeCompilerArtifactEvents(compilerArtifact.ABIEvents, events)
		functions = mergeCompilerArtifactFunctions(compilerArtifact.ABIFunctions, functions, source)
	}
	abi := make([]ContractABIEntry, 0, len(events)+len(functions))
	for _, event := range events {
		abi = append(abi, ContractABIEntry{Type: "event", Name: event.Name, Signature: event.Signature, Topic: event.Topic, Inputs: event.Inputs})
	}
	for _, function := range functions {
		abi = append(abi, ContractABIEntry{Type: "function", Name: function.Name, Signature: function.Signature, Selector: function.Selector, Inputs: function.Inputs, Outputs: function.Outputs, StateMutability: function.StateMutability})
	}
	status := "unverified"
	reproducibilityStatus := "unverified; pinned compiler config recorded but source match has not been checked"
	artifactKind := contractArtifactKind
	compilerMode := compiler.CompilerMode
	compilerExecutionStatus := "hardhat_artifact_not_found_for_submitted_source"
	bytecodeHash := hashParts("bytecode", compiler.ConfigHash, contractArtifactKind, sourceHash, strings.Join(contractFunctionSignatures(functions), "|"))
	deployedBytecodeHash := hashParts("deployed-bytecode", compiler.ConfigHash, contractArtifactKind, sourceHash, strings.Join(contractFunctionSignatures(functions), "|"))
	deployedComparisonStatus := "not_checked_no_pinned_solc_artifact"
	if hasCompilerArtifact {
		artifactKind = contractPinnedArtifactKind
		compilerMode = contractPinnedCompilerMode
		compilerExecutionStatus = "matched_existing_hardhat_solc_0_8_24_artifact"
		bytecodeHash = compilerArtifact.BytecodeHash
		deployedBytecodeHash = compilerArtifact.DeployedBytecodeHash
		deployedComparisonStatus = "not_checked_until_verify"
		reproducibilityStatus = "pinned Hardhat artifact matched submitted source; deployed bytecode comparison not checked until verification"
	}
	if verified {
		status = "source_hash_and_pinned_compiler_config_matched_local_artifact"
		reproducibilityStatus = "source hash and pinned compiler config matched local deterministic artifact"
		if hasCompilerArtifact {
			status = "source_hash_compiler_config_and_deployed_bytecode_matched_local_artifact"
			reproducibilityStatus = "source hash, pinned compiler config, artifact bytecode, and local deployed bytecode hash matched"
			deployedComparisonStatus = "matched_local_deployed_bytecode_hash"
		}
	}
	limitations := append([]string{
		"compiler version/settings are pinned and hashed; arbitrary IDE snippets remain analyzer artifacts unless they match a Hardhat artifact",
		"runtime supports simple pure/view return literals for devnet verification",
	}, compiler.Limitations...)
	if hasCompilerArtifact {
		limitations = append([]string{
			"matched repository Hardhat artifact with pinned Solidity 0.8.24 bytecode hashes",
			"artifact-backed local staticcall subset requires the ABI selector to appear in solc deployed bytecode",
			"local devnet interprets a bounded read-only EVM opcode subset for supported static calls, simple constructor-seeded storage, and mapping/SHA3-backed reads; it also supports a generic pinned-artifact write-call subset for supported nonpayable/payable calldata through the local EVM subset with CALLER, SLOAD, SSTORE, LOG, and RETURN coverage, but it does not support full EVM bytecode state transitions, arbitrary opcode coverage, complex dynamic storage layouts, or remote public proof",
		}, compiler.Limitations...)
	}
	runtimeMode := "deterministic-devnet-pure-view-runtime"
	if hasCompilerArtifact {
		runtimeMode = "hardhat-artifact-local-evm-opcode-staticcall-subset"
	}
	return ContractArtifact{
		Address: address, Name: name, Deployer: deployer, SourceHash: sourceHash,
		BytecodeHash: bytecodeHash, DeployedBytecodeHash: deployedBytecodeHash,
		ArtifactHash: hashParts("artifact", compiler.ConfigHash, artifactKind, name, sourceHash, bytecodeHash, deployedBytecodeHash, fmt.Sprint(len(abi))),
		ArtifactKind: artifactKind, CompilerMode: compilerMode, CompilerConfigHash: compiler.ConfigHash,
		Compiler: compiler, CompilerArtifact: compilerArtifact, CompilerExecutionStatus: compilerExecutionStatus,
		RuntimeMode: runtimeMode, VerifierMode: compiler.VerifierMode, ReproducibleBuild: verified,
		ReproducibilityStatus: reproducibilityStatus, DeployedBytecodeComparisonStatus: deployedComparisonStatus,
		ConstructorArgs: cleanConstructorArgs(constructorArgs), RuntimeStorage: runtimeStorage,
		RuntimeStorageSlots: runtimeStorageSlots, ABI: abi, Events: events, Functions: functions,
		Limitations: limitations, Verified: verified, VerifierStatus: status, DeployedAt: deployedAt, VerifiedAt: verifiedAt,
	}
}

// ConsensusPQContractReceipt is the native execution receipt, reused without
// introducing another virtual machine or a caller-controlled authorization bit.
// Signature, policy, balance and nonce checks remain mandatory in the caller.
type ConsensusPQContractReceipt = pqContractReceipt

// ValidatePQContractPinnedArtifact binds fresh PQ admission to the actual fixed
// creation code and raw ABI as well as source/runtime. Existing legacy loading
// does not call it. Build-info labels or self-consistent replacement hashes are
// not trusted substitutes for these entries in the one bounded registry.
func ValidatePQContractPinnedArtifact(a ContractArtifact) error {
	pin, ok := boundedPinnedContracts[a.Name]
	if !ok || a.CompilerArtifact == nil || a.SourceHash != pin.SourceHash || a.DeployedBytecodeHash != pin.DeployedBytecodeHash || a.BytecodeHash != pin.CreationBytecodeHash || a.CompilerArtifact.BytecodeHash != pin.CreationBytecodeHash || a.CompilerArtifact.ABIHash != pin.RawABIHash {
		return errors.New("PQ contract creation code or actual raw ABI differs from pinned compiler output")
	}
	return nil
}

// BuildConsensusPQContractDeployment derives the entire initial artifact from
// actual supplied compiler files. Material is bounded and validated against the
// one pinned registry; metadata is never accepted as a self-reported template.
func BuildConsensusPQContractDeployment(a ynxauth.Action, hash string, at time.Time, source string, material ConsensusContractMaterial) (ConsensusPQContractReceipt, error) {
	value, err := ynxauth.DecodeActionPayload(a.Kind, a.Payload)
	p, ok := value.(ynxauth.ContractDeployPayload)
	if err != nil || !ok || a.Kind != ynxauth.ActionContractDeploy || a.Fee != ynxauth.ContractDeployFee || at.IsZero() || len(source) > maxPQContractSourceBytes || source != strings.TrimSpace(source) || len(material.ArtifactFile) > maxPQContractArtifactBytes || len(material.ArtifactFile) == 0 {
		return ConsensusPQContractReceipt{}, errors.New("invalid deterministic PQ contract deployment input")
	}
	var actual hardhatArtifactFile
	if err := json.Unmarshal(material.ArtifactFile, &actual); err != nil {
		return ConsensusPQContractReceipt{}, err
	}
	if _, _, err := ValidateBoundedPinnedContract(p.Name, source, actual.DeployedBytecode); err != nil {
		return ConsensusPQContractReceipt{}, err
	}
	var entries []hardhatABIEntry
	if err := json.Unmarshal(actual.ABI, &entries); err != nil {
		return ConsensusPQContractReceipt{}, err
	}
	selectors := selectorArtifactMetadata{RuntimeSelectorMode: "hardhat-ethers-keccak-selector-event-topic-and-deployed-bytecode-presence"}
	for _, entry := range entries {
		types := make([]string, len(entry.Inputs))
		for i, input := range entry.Inputs {
			types[i] = input.Type
		}
		signature := entry.Name + "(" + strings.Join(types, ",") + ")"
		switch entry.Type {
		case "event":
			selectors.Events = append(selectors.Events, selectorEventMetadata{Name: entry.Name, Signature: signature, Topic: "0x" + hex.EncodeToString(legacyKeccak256([]byte(signature)))})
		case "function":
			selector := "0x" + hex.EncodeToString(legacyKeccak256([]byte(signature))[:4])
			selectors.Functions = append(selectors.Functions, selectorFunctionMetadata{Name: entry.Name, Signature: signature, Selector: selector, BytecodeSelectorMatched: strings.Contains(actual.DeployedBytecode[2:], selector[2:])})
		}
	}
	meta := &ContractCompilerArtifact{
		SourceName: actual.SourceName, ContractName: actual.ContractName, BuildInfoID: actual.BuildInfoID,
		ArtifactPath: "artifacts/" + actual.SourceName + "/" + actual.ContractName + ".json",
		BytecodeHash: hashParts("solc-bytecode", actual.Bytecode), DeployedBytecodeHash: hashParts("solc-deployed-bytecode", actual.DeployedBytecode),
		ABIHash: hashParts("solc-abi", string(actual.ABI)), RuntimeSelectorMode: selectors.RuntimeSelectorMode,
		ABIFunctions: hardhatABIFunctions(actual.ABI, selectors), ABIEvents: hardhatABIEvents(actual.ABI, selectors),
		CompilerExecuted: true, Status: "matched_hardhat_artifact",
	}
	for _, f := range meta.ABIFunctions {
		meta.RuntimeSelectors = append(meta.RuntimeSelectors, f.Selector)
		if f.BytecodeSelectorMatched {
			meta.DeployedBytecodeSelectorMatches++
		}
	}
	artifact := buildContractArtifactFromCompiler(pqContractAddress(hash), a.Owner, p.Name, source, false, nil, []string{strconv.FormatUint(p.ConstructorArgs[0], 10)}, meta, true, at.UTC())
	// Match the persisted native artifact's exact nil/empty representation.
	raw, err := json.Marshal(artifact)
	if err != nil {
		return ConsensusPQContractReceipt{}, err
	}
	var normalized ContractArtifact
	if err := json.Unmarshal(raw, &normalized); err != nil {
		return ConsensusPQContractReceipt{}, err
	}
	artifact = normalized
	if err := ValidatePQContractPinnedArtifact(artifact); err != nil {
		return ConsensusPQContractReceipt{}, err
	}
	code, err := ValidateConsensusContractMaterial(artifact, material)
	if err != nil {
		return ConsensusPQContractReceipt{}, err
	}
	r := ConsensusPQContractReceipt{Version: pqContractReceiptVersion, Artifact: artifact, Source: source, ArtifactFile: bytes.Clone(material.ArtifactFile), Bytecode: code}
	tx := Transaction{Hash: hash, Type: "contract_deploy", From: a.Owner, To: artifact.Address, Fee: int64(a.Fee), Nonce: a.Nonce, Timestamp: at.UTC()}
	if _, err := pqContractPostState(tx, a, p, &r); err != nil {
		return ConsensusPQContractReceipt{}, err
	}
	return r, nil
}

// BuildConsensusPQContractCall uses the complete trusted current artifact and
// executable code. A first anchor needs actual material already authenticated
// by the migration checkpoint. Subsequent calls retain their prior marker.
func BuildConsensusPQContractCall(a ynxauth.Action, hash string, at time.Time, before ContractArtifact, code string, material ConsensusContractMaterial) (ConsensusPQContractReceipt, error) {
	value, err := ynxauth.DecodeActionPayload(a.Kind, a.Payload)
	p, ok := value.(ynxauth.ContractExecutePayload)
	if err != nil || !ok || a.Kind != ynxauth.ActionContractExecute || a.Fee != ynxauth.ContractExecuteFee || at.IsZero() {
		return ConsensusPQContractReceipt{}, errors.New("invalid PQ contract call")
	}
	r := ConsensusPQContractReceipt{Version: pqContractReceiptVersion, Artifact: before, Bytecode: code}
	if err := ValidatePQContractPinnedArtifact(before); err != nil {
		return ConsensusPQContractReceipt{}, err
	}
	if before.PQAnchorTransactionHash == "" {
		validated, err := ValidateConsensusContractMaterial(before, material)
		if err != nil || validated != code {
			return ConsensusPQContractReceipt{}, errors.New("first PQ contract call lacks original compiler material")
		}
		var build hardhatBuildInfoFile
		if err := json.Unmarshal(material.BuildInfoFile, &build); err != nil {
			return ConsensusPQContractReceipt{}, err
		}
		name := consensusContractSources[before.Name]
		r.Source = strings.TrimSpace(build.Input.Sources[name].Content)
		if r.Source == "" {
			r.Source = strings.TrimSpace(build.Input.Sources["project/"+name].Content)
		}
		r.ArtifactFile = bytes.Clone(material.ArtifactFile)
	}
	transition, err := ExecuteConsensusSourceContract(before, code, p.Calldata, a.Owner, before.RuntimeStorage)
	if err != nil {
		return ConsensusPQContractReceipt{}, err
	}
	r.Transition = &transition
	tx := Transaction{Hash: hash, Type: "contract_call", From: a.Owner, To: before.Address, Fee: int64(a.Fee), Nonce: a.Nonce, Timestamp: at.UTC()}
	if _, err := pqContractPostState(tx, a, p, &r); err != nil {
		return ConsensusPQContractReceipt{}, err
	}
	return r, nil
}

// ReplayConsensusPQContract validates the original native action and the exact
// native bytecode transition. ABCI verifies the original Member under historical
// policy separately and binds its own fee and inclusion records; no Devnet block
// hashes or synthetic source logs are invented here.
func ReplayConsensusPQContract(tx Transaction, wire []byte, r ConsensusPQContractReceipt) (ContractArtifact, error) {
	if err := ValidatePQContractPinnedArtifact(r.Artifact); err != nil {
		return ContractArtifact{}, err
	}
	m, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return ContractArtifact{}, err
	}
	a, err := ynxauth.DecodeAction(m.Message)
	if err != nil || !pqContractKind(a.Kind) || tx.Hash != pqBatchHash(wire) || tx.Nonce != a.Nonce {
		return ContractArtifact{}, errors.New("contract history differs from original native action")
	}
	p, err := ynxauth.DecodeActionPayload(a.Kind, a.Payload)
	if err != nil {
		return ContractArtifact{}, err
	}
	return pqContractPostState(tx, a, p, &r)
}

// SameConsensusContractPrestate excludes only the six public verification
// metadata fields, exactly as the existing signed execution commitment does.
func SameConsensusContractPrestate(a, b ContractArtifact) bool {
	return reflect.DeepEqual(pqContractImmutableProjection(a), pqContractImmutableProjection(b)) && reflect.DeepEqual(a.RuntimeStorage, b.RuntimeStorage)
}
