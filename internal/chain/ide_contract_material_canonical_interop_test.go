package chain

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

const ideCanonicalCompactHandoffSHA256 = "fb4d26e3589edac75022fe69c092c29bb3df2e3c59c216f0f1cbbe473c0eb520"
const ideCanonicalABIHandoffSHA256 = "2f9a0fa4fc9a579cd60d26ab213ab3abe286e004ae2d3252e6ef020e3eeba372"

type ideCanonicalCompilerMaterial struct {
	source, inputSourceName                          string
	artifact                                         hardhatArtifactFile
	material                                         ConsensusContractMaterial
	artifactSHA256, buildSHA256, requestSourceSHA256 string
}

func ideMaterialSHA256(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// Read the producer's exact public bytes. Semantic input/output comparisons
// below establish their relation; the material sent to Go is never reformatted.
func readIDECanonicalMaterials(t *testing.T, generation, handoffSHA string, handoffBytes int) map[string]ideCanonicalCompilerMaterial {
	t.Helper()
	expectedSchema := map[string]string{"compact": "ynx-ide-canonical-input-deployment-material-1", "abi": "ynx-ide-canonical-input-raw-abi-deployment-material-1"}[generation]
	if expectedSchema == "" {
		t.Fatal("unknown original canonical material generation")
	}
	base := filepath.Join("testdata", "ide-pq-canonical", generation)
	raw, err := os.ReadFile(filepath.Join(base, "HANDOFF.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) != handoffBytes || ideMaterialSHA256(raw) != handoffSHA {
		t.Fatal("original canonical-input handoff bytes or SHA256 changed")
	}
	var handoff struct {
		Schema    string `json:"schema"`
		IDESource struct {
			Commit                  string `json:"commit"`
			NotIncludedInCurrentApp bool   `json:"notIncludedInCurrentApp"`
		} `json:"ideSource"`
		Compiler struct {
			ActualVersion string `json:"actualVersion"`
			NoNetwork     bool   `json:"noNetwork"`
			Pins          struct {
				Available              bool   `json:"available"`
				Pinned                 bool   `json:"pinned"`
				ExpectedVersion        string `json:"expectedVersion"`
				ExpectedArtifactSHA256 string `json:"expectedArtifactSha256"`
				ArtifactSHA256         string `json:"artifactSha256"`
				PackageSHA256          string `json:"packageSha256"`
				ExpectedPackageSHA256  string `json:"expectedPackageSha256"`
				ClosureSHA256          string `json:"closureSha256"`
				ExpectedClosureSHA256  string `json:"expectedClosureSha256"`
			} `json:"pins"`
		} `json:"compiler"`
		Contracts []struct {
			ContractName             string `json:"contractName"`
			SourceName               string `json:"sourceName"`
			InputSourceName          string `json:"inputSourceName"`
			BuildInfoID              string `json:"buildInfoId"`
			RuntimeSHA256            string `json:"runtimeSha256"`
			ChainRuntimeHash         string `json:"chainRuntimeHash"`
			ExpectedChainRuntimeHash string `json:"expectedChainRuntimeHash"`
			RawABIHash               string `json:"rawABIHash"`
			ProducerSource           struct {
				Bytes  int    `json:"bytes"`
				SHA256 string `json:"sha256"`
			} `json:"producerSource"`
			Files []struct {
				Path   string `json:"path"`
				Bytes  int    `json:"bytes"`
				SHA256 string `json:"sha256"`
			} `json:"files"`
		} `json:"contracts"`
		Truth struct {
			ActualCompile                bool `json:"actualCompile"`
			RawOutputPreserved           bool `json:"rawOutputPreserved"`
			ExpectedRuntimeHashesMatched bool `json:"expectedRuntimeHashesMatched"`
			GoCalleePass                 bool `json:"goCalleePass"`
			PackagedInCurrentApp         bool `json:"packagedInCurrentApp"`
			Signed                       bool `json:"signed"`
			Broadcast                    bool `json:"broadcast"`
			Deployed                     bool `json:"deployed"`
			ExpectedRawABIHashesMatched  bool `json:"expectedRawABIHashesMatched"`
		} `json:"truth"`
	}
	if err := json.Unmarshal(raw, &handoff); err != nil {
		t.Fatal(err)
	}
	pins := handoff.Compiler.Pins
	if handoff.Schema != expectedSchema || handoff.IDESource.Commit != "c8e853687ac324208eee7d4464aac0f93ea033d3" || !handoff.IDESource.NotIncludedInCurrentApp || handoff.Compiler.ActualVersion != "0.8.24+commit.e11b9ed9.Emscripten.clang" || !handoff.Compiler.NoNetwork || !pins.Available || !pins.Pinned || pins.ExpectedVersion != "0.8.24" || pins.ExpectedArtifactSHA256 != "fb59b825b7d57f9de89cd9de2415b12aab1fcc7eb2573fd2bf5c9b969eacf4d9" || pins.ArtifactSHA256 != pins.ExpectedArtifactSHA256 || pins.PackageSHA256 != "5a07c7be20943396b173c50e7fda861fcced70dfcad8f817585eb013378bf363" || pins.ExpectedPackageSHA256 != pins.PackageSHA256 || pins.ClosureSHA256 != "223fc0fd21323bcec16e861b7472da7b9c5aec15f044beb3674e455ab5996e8f" || pins.ExpectedClosureSHA256 != pins.ClosureSHA256 || len(handoff.Contracts) != 2 || !handoff.Truth.ActualCompile || !handoff.Truth.RawOutputPreserved || !handoff.Truth.ExpectedRuntimeHashesMatched || handoff.Truth.GoCalleePass || handoff.Truth.PackagedInCurrentApp || handoff.Truth.Signed || handoff.Truth.Broadcast || handoff.Truth.Deployed || handoff.Truth.ExpectedRawABIHashesMatched != (generation == "abi") {
		t.Fatal("original canonical compiler identity, pins or unsigned truth changed")
	}
	outputSelection := map[string]map[string][]string{"*": {"": {"ast"}, "*": {"abi", "evm.bytecode.linkReferences", "evm.bytecode.object", "evm.bytecode.opcodes", "evm.bytecode.sourceMap", "evm.deployedBytecode.immutableReferences", "evm.deployedBytecode.linkReferences", "evm.deployedBytecode.object", "evm.deployedBytecode.opcodes", "evm.deployedBytecode.sourceMap", "evm.methodIdentifiers"}}}
	materials := make(map[string]ideCanonicalCompilerMaterial, 2)
	for _, contract := range handoff.Contracts {
		if _, supported := boundedPinnedContracts[contract.ContractName]; !supported || materials[contract.ContractName].source != "" || contract.SourceName != consensusContractSources[contract.ContractName] || contract.InputSourceName != "project/"+contract.SourceName || len(contract.Files) != 6 {
			t.Fatal("canonical compiler material inventory changed")
		}
		files := make(map[string][]byte, 6)
		for _, file := range contract.Files {
			name := filepath.Base(file.Path)
			if filepath.Base(filepath.Dir(file.Path)) != contract.ContractName || files[name] != nil {
				t.Fatal("ambiguous original canonical compiler file", file.Path)
			}
			data, err := os.ReadFile(filepath.Join(base, contract.ContractName, name))
			if err != nil {
				t.Fatal(err)
			}
			if len(data) != file.Bytes || ideMaterialSHA256(data) != file.SHA256 {
				t.Fatal("original canonical compiler file bytes changed", contract.ContractName, name)
			}
			files[name] = data
		}
		for _, name := range []string{"source.sol", "request-source.txt", "compiler-input.json", "compiler-output.json", "artifact.json", "build-info.json"} {
			if len(files[name]) == 0 {
				t.Fatal("original canonical compiler file is missing", contract.ContractName, name)
			}
		}
		if len(files["source.sol"]) != contract.ProducerSource.Bytes || ideMaterialSHA256(files["source.sol"]) != contract.ProducerSource.SHA256 || string(files["request-source.txt"]) != strings.TrimSpace(string(files["source.sol"])) {
			t.Fatal("canonical source capture or exact trimmed SDK source changed")
		}
		var input struct {
			Language string                              `json:"language"`
			Sources  map[string]struct{ Content string } `json:"sources"`
			Settings struct {
				EVMVersion string `json:"evmVersion"`
				Optimizer  struct {
					Enabled bool `json:"enabled"`
					Runs    int  `json:"runs"`
				} `json:"optimizer"`
				Remappings      []string                       `json:"remappings"`
				OutputSelection map[string]map[string][]string `json:"outputSelection"`
			} `json:"settings"`
		}
		if err := json.Unmarshal(files["compiler-input.json"], &input); err != nil || input.Language != "Solidity" || len(input.Sources) != 1 || input.Sources[contract.InputSourceName].Content != string(files["source.sol"]) || input.Settings.EVMVersion != "shanghai" || !input.Settings.Optimizer.Enabled || input.Settings.Optimizer.Runs != 200 || input.Settings.Remappings == nil || len(input.Settings.Remappings) != 0 || !reflect.DeepEqual(input.Settings.OutputSelection, outputSelection) {
			t.Fatal("canonical compiler input differs from the original fixed compiler settings", err)
		}
		var build struct {
			ID              string          `json:"id"`
			SolcVersion     string          `json:"solcVersion"`
			SolcLongVersion string          `json:"solcLongVersion"`
			Input           json.RawMessage `json:"input"`
			Output          json.RawMessage `json:"output"`
		}
		if err := json.Unmarshal(files["build-info.json"], &build); err != nil || build.ID != contract.BuildInfoID || build.SolcVersion != "0.8.24" || build.SolcLongVersion != handoff.Compiler.ActualVersion || !bytes.Equal(build.Input, files["compiler-input.json"]) || !bytes.Equal(build.Output, files["compiler-output.json"]) || contract.BuildInfoID != "ynx_solc_0_8_24_"+ideMaterialSHA256(files["compiler-input.json"])[:40] {
			t.Fatal("canonical build-info does not preserve its exact compiler input/output", err)
		}
		var artifact hardhatArtifactFile
		if err := json.Unmarshal(files["artifact.json"], &artifact); err != nil || artifact.ContractName != contract.ContractName || artifact.SourceName != contract.SourceName || artifact.InputSourceName != contract.InputSourceName || artifact.BuildInfoID != contract.BuildInfoID {
			t.Fatal("canonical artifact identity differs from original compiler files", err)
		}
		if generation == "abi" && (contract.RawABIHash != boundedPinnedContracts[contract.ContractName].RawABIHash || hashParts("solc-abi", string(artifact.ABI)) != contract.RawABIHash) {
			t.Fatal("producer's raw ABI statement differs from actual unmodified ABI bytes")
		}
		var output struct {
			Contracts map[string]map[string]struct {
				ABI json.RawMessage `json:"abi"`
				EVM struct {
					Bytecode         struct{ Object string } `json:"bytecode"`
					DeployedBytecode struct{ Object string } `json:"deployedBytecode"`
				} `json:"evm"`
			} `json:"contracts"`
		}
		if err := json.Unmarshal(files["compiler-output.json"], &output); err != nil {
			t.Fatal(err)
		}
		compiled := output.Contracts[contract.InputSourceName][contract.ContractName]
		var compiledABI, artifactABI any
		if json.Unmarshal(compiled.ABI, &compiledABI) != nil || json.Unmarshal(artifact.ABI, &artifactABI) != nil || !reflect.DeepEqual(compiledABI, artifactABI) || artifact.Bytecode != "0x"+compiled.EVM.Bytecode.Object || artifact.DeployedBytecode != "0x"+compiled.EVM.DeployedBytecode.Object {
			t.Fatal("artifact executable bytes or ABI differ from actual compiler output")
		}
		runtime, err := hex.DecodeString(strings.TrimPrefix(artifact.DeployedBytecode, "0x"))
		if err != nil || ideMaterialSHA256(runtime) != contract.RuntimeSHA256 || hashParts("solc-deployed-bytecode", artifact.DeployedBytecode) != contract.ChainRuntimeHash || contract.ChainRuntimeHash != contract.ExpectedChainRuntimeHash || contract.ExpectedChainRuntimeHash != boundedPinnedContracts[contract.ContractName].DeployedBytecodeHash {
			t.Fatal("canonical producer's runtime byte or domain hash statement is incorrect", err)
		}
		materials[contract.ContractName] = ideCanonicalCompilerMaterial{source: string(files["request-source.txt"]), inputSourceName: contract.InputSourceName, artifact: artifact, material: ConsensusContractMaterial{ArtifactFile: files["artifact.json"], BuildInfoFile: files["build-info.json"]}, artifactSHA256: ideMaterialSHA256(files["artifact.json"]), buildSHA256: ideMaterialSHA256(files["build-info.json"]), requestSourceSHA256: ideMaterialSHA256(files["request-source.txt"])}
	}
	return materials
}

// Exactly the existing public pure-assembler fixture context. No account is
// created or chosen from a wallet, no nonce is obtained and no action is signed.
func idePublicContractDeploymentFixture(t *testing.T, name string) (ynxauth.Action, string, time.Time) {
	t.Helper()
	pin := boundedPinnedContracts[name]
	payload, err := ynxauth.EncodeActionPayload(ynxauth.ActionContractDeploy, ynxauth.ContractDeployPayload{Name: name, SourceHash: pin.SourceHash, DeployedBytecodeHash: pin.DeployedBytecodeHash, CompilerConfigHash: SolidityCompilerConfig().ConfigHash, ConstructorArgs: []uint64{7}})
	if err != nil {
		t.Fatal(err)
	}
	return ynxauth.Action{Owner: "0x" + strings.Repeat("1", 40), Kind: ynxauth.ActionContractDeploy, Payload: payload, Fee: 10, Nonce: 1}, "0x" + strings.Repeat("2", 64), time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
}

// This second real producer counterexample fixed the executable bytecode but
// compacted the artifact's raw ABI. Raw ABI whitespace is already committed by
// the original registry; do not compact/pretty-print the supplied files here.
func TestIDECanonicalCompilerMaterialRejectsCompactRawABI(t *testing.T) {
	materials := readIDECanonicalMaterials(t, "compact", ideCanonicalCompactHandoffSHA256, 9623)
	actualRawABI := map[string]string{
		ynxauth.ContractCounterName: "532e91823fc09ffa5fd0503fcd5286f71256fe75079a41281bee9a7b78d52c8f",
		ynxauth.ContractERC20Name:   "f804d9855c6509fdfa26d2a925ef462649ee51e5b8853a33a00508435fa3b484",
	}
	for _, name := range []string{ynxauth.ContractCounterName, ynxauth.ContractERC20Name} {
		t.Run(name, func(t *testing.T) {
			actual := materials[name]
			pin := boundedPinnedContracts[name]
			source, deployed, err := ValidateBoundedPinnedContract(name, actual.source, actual.artifact.DeployedBytecode)
			if err != nil || source != pin.SourceHash || deployed != pin.DeployedBytecodeHash || hashParts("solc-bytecode", actual.artifact.Bytecode) != pin.CreationBytecodeHash {
				t.Fatal("canonical compact counterexample no longer passes source/creation/runtime pins", err)
			}
			if hashParts("solc-abi", string(actual.artifact.ABI)) != actualRawABI[name] || actualRawABI[name] == pin.RawABIHash {
				t.Fatal("original compact ABI counterexample changed")
			}
			action, hash, at := idePublicContractDeploymentFixture(t, name)
			_, err = BuildConsensusPQContractDeployment(action, hash, at, actual.source, actual.material)
			if err == nil || err.Error() != "PQ contract creation code or actual raw ABI differs from pinned compiler output" {
				t.Fatal("original Go builder failed to reject the actual compact raw ABI", err)
			}
			t.Logf("GoMaterialValidated=false canonical source/runtime matched; rawABI actual=%s expected=%s artifactSHA256=%s buildInfoSHA256=%s", actualRawABI[name], pin.RawABIHash, actual.artifactSHA256, actual.buildSHA256)
		})
	}
}

// Both Go admission callees and the actual bounded getter must succeed before
// emitting validated commitments. This is a pure synthetic-fixture result,
// never a real account authorization, signed deployment or public-chain proof.
func TestIDECanonicalCompilerMaterialActualGoCalleesAndReadonlyGetters(t *testing.T) {
	materials := readIDECanonicalMaterials(t, "abi", ideCanonicalABIHandoffSHA256, 9966)
	config := SolidityCompilerConfig()
	if config.ConfigHash != "500f922ce0b89e7618d36ffbcd3238458891baee59b17040527042ce47db0c93" {
		t.Fatal("original callee compiler commitment changed")
	}
	for _, name := range []string{ynxauth.ContractCounterName, ynxauth.ContractERC20Name} {
		t.Run(name, func(t *testing.T) {
			actual := materials[name]
			pin := boundedPinnedContracts[name]
			source, deployed, err := ValidateBoundedPinnedContract(name, actual.source, actual.artifact.DeployedBytecode)
			creation, rawABI := hashParts("solc-bytecode", actual.artifact.Bytecode), hashParts("solc-abi", string(actual.artifact.ABI))
			if err != nil || source != pin.SourceHash || deployed != pin.DeployedBytecodeHash || creation != pin.CreationBytecodeHash || rawABI != pin.RawABIHash {
				t.Fatal("real canonical material differs from the original bounded registry", err)
			}
			action, hash, at := idePublicContractDeploymentFixture(t, name)
			receipt, err := BuildConsensusPQContractDeployment(action, hash, at, actual.source, actual.material)
			if err != nil {
				t.Fatal("actual canonical IDE files failed the original Go deployment assembler", err)
			}
			code, err := ValidateConsensusContractMaterial(receipt.Artifact, actual.material)
			if err != nil || code != actual.artifact.DeployedBytecode || code != receipt.Bytecode || receipt.Source != actual.source || !bytes.Equal(receipt.ArtifactFile, actual.material.ArtifactFile) || receipt.Artifact.SourceHash != source || receipt.Artifact.DeployedBytecodeHash != deployed || receipt.Artifact.BytecodeHash != creation || receipt.Artifact.CompilerConfigHash != config.ConfigHash || receipt.Artifact.CompilerArtifact == nil || receipt.Artifact.CompilerArtifact.ABIHash != rawABI || receipt.Artifact.CompilerArtifact.BuildInfoID != actual.artifact.BuildInfoID || !reflect.DeepEqual(receipt.Artifact.Compiler, config) {
				t.Fatal("Go deployment receipt did not retain the exact authenticated material commitments", err)
			}
			before, err := json.Marshal(receipt.Artifact)
			if err != nil {
				t.Fatal(err)
			}
			artifactBefore, buildBefore := bytes.Clone(actual.material.ArtifactFile), bytes.Clone(actual.material.BuildInfoFile)
			getter := "0x06661abd" // count()
			if name == ynxauth.ContractERC20Name {
				getter = "0x18160ddd" // totalSupply()
			}
			encoded, steps, err := CallConsensusSourceContract(receipt.Artifact, code, getter, receipt.Artifact.RuntimeStorage)
			if err != nil || encoded != fmt.Sprintf("0x%064x", uint64(7)) || steps <= 0 {
				t.Fatal("actual canonical material's bounded getter failed", encoded, steps, err)
			}
			after, err := json.Marshal(receipt.Artifact)
			if err != nil || !bytes.Equal(before, after) || !bytes.Equal(artifactBefore, actual.material.ArtifactFile) || !bytes.Equal(buildBefore, actual.material.BuildInfoFile) {
				t.Fatal("readonly getter changed the artifact, storage or original material bytes", err)
			}
			result, err := json.Marshal(map[string]any{
				"schema": "ynx-ide-contract-material-go-interop-v1", "contractName": name,
				"materialHandoffSHA256": ideCanonicalABIHandoffSHA256,
				"ideSourceCommit":       "c8e853687ac324208eee7d4464aac0f93ea033d3",
				"sourceName":            actual.artifact.SourceName, "inputSourceName": actual.inputSourceName,
				"buildInfoId":         actual.artifact.BuildInfoID,
				"requestSourceSHA256": actual.requestSourceSHA256,
				"artifactFileSHA256":  actual.artifactSHA256, "buildInfoFileSHA256": actual.buildSHA256,
				"sourceHash": source, "deployedBytecodeHash": deployed,
				"creationBytecodeHash": creation, "rawABIHash": rawABI, "compilerConfigHash": config.ConfigHash,
				"constructorArgs": []string{"7"}, "getterCalldata": getter,
				"getterEncodedResult": encoded, "getterSteps": steps,
				"goMaterialValidated": true, "syntheticFixture": true,
				"chainCommitmentsAuthenticated": false, "independentFinality": false,
				"signed": false, "submitted": false, "deployed": false,
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("IDE_CONTRACT_MATERIAL_INTEROP %s", result)
		})
	}
}
