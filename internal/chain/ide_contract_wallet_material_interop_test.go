package chain

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

const ideWalletInboxHandoffSHA256 = "f4cd73d2580dabeefa441ac12d0279056caffb70ecf33923ee8abfe6e4042d22"
const ideWalletInboxLimit = 64 << 10

type ideWalletInboxMaterial struct {
	ideCanonicalCompilerMaterial
	probeRPCBytes int
}

// The new wire wrapper contains the same original compiler input. Its complete
// output stays in its original separate file. Neither executable bytes nor raw
// ABI are reformatted, compressed, regenerated or inferred from prior Go PASS.
func readIDEWalletInboxMaterials(t *testing.T) map[string]ideWalletInboxMaterial {
	t.Helper()
	original := readIDECanonicalMaterials(t, "abi", ideCanonicalABIHandoffSHA256, 9966)
	base := filepath.Join("testdata", "ide-pq-wallet-inbox")
	raw, err := os.ReadFile(filepath.Join(base, "HANDOFF.json"))
	if err != nil || len(raw) != 11159 || ideMaterialSHA256(raw) != ideWalletInboxHandoffSHA256 {
		t.Fatal("new inbox material handoff identity changed", err)
	}
	var h struct {
		Schema    string          `json:"schema"`
		Compiler  json.RawMessage `json:"compiler"`
		Contracts []struct {
			ContractName             string `json:"contractName"`
			SourceName               string `json:"sourceName"`
			InputSourceName          string `json:"inputSourceName"`
			BuildInfoID              string `json:"buildInfoId"`
			ChainRuntimeHash         string `json:"chainRuntimeHash"`
			ExpectedChainRuntimeHash string `json:"expectedChainRuntimeHash"`
			RawABIHash               string `json:"rawABIHash"`
			Files                    []struct {
				Path   string `json:"path"`
				Bytes  int    `json:"bytes"`
				SHA256 string `json:"sha256"`
			} `json:"files"`
			NormalInboxSizeProbe struct {
				Bytes                        int  `json:"bytes"`
				Limit                        int  `json:"limit"`
				SyntheticAccountAndRequestID bool `json:"syntheticAccountAndRequestId"`
				Submitted                    bool `json:"submitted"`
			} `json:"normalInboxSizeProbe"`
		} `json:"contracts"`
		Truth struct {
			GoCalleePass                    bool `json:"goCalleePass"`
			Signed                          bool `json:"signed"`
			Broadcast                       bool `json:"broadcast"`
			Deployed                        bool `json:"deployed"`
			NormalWalletInboxSizeCompatible bool `json:"normalWalletInboxSizeCompatible"`
			FullCompilerOutputPreserved     bool `json:"fullCompilerOutputPreserved"`
			ArtifactRawABIUnchanged         bool `json:"artifactRawABIUnchanged"`
			SourceUnchanged                 bool `json:"sourceUnchanged"`
		} `json:"truth"`
		Supersedes struct {
			Bytes  int    `json:"bytes"`
			SHA256 string `json:"sha256"`
		} `json:"supersedes"`
		CompilerOutputRecompiled bool `json:"compilerOutputRecompiled"`
		PriorGoProof             struct {
			AppliesToPriorHOnly bool `json:"appliesToPriorHOnly"`
		} `json:"priorGoProof"`
	}
	if err := json.Unmarshal(raw, &h); err != nil {
		t.Fatal(err)
	}
	oldH, err := os.ReadFile(filepath.Join("testdata", "ide-pq-canonical", "abi", "HANDOFF.json"))
	if err != nil {
		t.Fatal(err)
	}
	var originalH struct{ Compiler json.RawMessage }
	if json.Unmarshal(oldH, &originalH) != nil || !bytes.Equal(h.Compiler, originalH.Compiler) || h.Schema != "ynx-ide-wallet-inbox-sized-deployment-material-1" || len(h.Contracts) != 2 || h.Truth.GoCalleePass || h.Truth.Signed || h.Truth.Broadcast || h.Truth.Deployed || !h.Truth.NormalWalletInboxSizeCompatible || !h.Truth.FullCompilerOutputPreserved || !h.Truth.ArtifactRawABIUnchanged || !h.Truth.SourceUnchanged || h.Supersedes.Bytes != 9966 || h.Supersedes.SHA256 != ideCanonicalABIHandoffSHA256 || h.CompilerOutputRecompiled || !h.PriorGoProof.AppliesToPriorHOnly {
		t.Fatal("new inbox material changed compiler pins, preserved-output rules or unsigned truth")
	}
	result := make(map[string]ideWalletInboxMaterial, 2)
	for _, contract := range h.Contracts {
		prior, exists := original[contract.ContractName]
		if !exists || result[contract.ContractName].source != "" || contract.SourceName != prior.artifact.SourceName || contract.InputSourceName != prior.inputSourceName || contract.BuildInfoID != prior.artifact.BuildInfoID || len(contract.Files) != 6 || contract.NormalInboxSizeProbe.Limit != ideWalletInboxLimit || !contract.NormalInboxSizeProbe.SyntheticAccountAndRequestID || contract.NormalInboxSizeProbe.Submitted {
			t.Fatal("new inbox material inventory or original compiler identity changed")
		}
		files := make(map[string][]byte, 6)
		for _, file := range contract.Files {
			name := filepath.Base(file.Path)
			if files[name] != nil || filepath.Base(filepath.Dir(file.Path)) != contract.ContractName {
				t.Fatal("ambiguous inbox material filename")
			}
			data, err := os.ReadFile(filepath.Join(base, contract.ContractName, name))
			if err != nil || len(data) != file.Bytes || ideMaterialSHA256(data) != file.SHA256 {
				t.Fatal("new inbox raw file differs from its exact new SHA256 pin", name, err)
			}
			files[name] = data
		}
		for _, name := range []string{"source.sol", "request-source.txt", "compiler-input.json", "compiler-output.json", "artifact.json"} {
			old, err := os.ReadFile(filepath.Join("testdata", "ide-pq-canonical", "abi", contract.ContractName, name))
			if err != nil || len(files[name]) == 0 || !bytes.Equal(old, files[name]) {
				t.Fatal("inbox adaptation changed original source, input, output, artifact or raw ABI", name, err)
			}
		}
		var wrapper map[string]json.RawMessage
		if json.Unmarshal(files["build-info.json"], &wrapper) != nil || len(wrapper) != 5 {
			t.Fatal("new build-info is not the original input/version/id wire format")
		}
		for field, want := range map[string]string{"_format": "ynx-solc-standard-json-build-info-1", "id": contract.BuildInfoID, "solcVersion": "0.8.24", "solcLongVersion": "0.8.24+commit.e11b9ed9.Emscripten.clang"} {
			var got string
			if json.Unmarshal(wrapper[field], &got) != nil || got != want {
				t.Fatal("new build-info changed original compiler identity", field)
			}
		}
		if !bytes.Equal(wrapper["input"], files["compiler-input.json"]) || bytes.Equal(files["build-info.json"], prior.material.BuildInfoFile) {
			t.Fatal("new build-info failed to retain exact original compiler input or reused prior wire bytes")
		}
		pin := boundedPinnedContracts[contract.ContractName]
		if contract.ChainRuntimeHash != pin.DeployedBytecodeHash || contract.ExpectedChainRuntimeHash != pin.DeployedBytecodeHash || contract.RawABIHash != pin.RawABIHash {
			t.Fatal("new handoff changed original runtime or raw ABI commitments")
		}
		var artifact hardhatArtifactFile
		if err := json.Unmarshal(files["artifact.json"], &artifact); err != nil {
			t.Fatal(err)
		}
		material := ideCanonicalCompilerMaterial{
			source: string(files["request-source.txt"]), inputSourceName: contract.InputSourceName, artifact: artifact,
			material:       ConsensusContractMaterial{ArtifactFile: files["artifact.json"], BuildInfoFile: files["build-info.json"]},
			artifactSHA256: ideMaterialSHA256(files["artifact.json"]), buildSHA256: ideMaterialSHA256(files["build-info.json"]), requestSourceSHA256: ideMaterialSHA256(files["request-source.txt"]),
		}
		result[contract.ContractName] = ideWalletInboxMaterial{ideCanonicalCompilerMaterial: material, probeRPCBytes: contract.NormalInboxSizeProbe.Bytes}
	}
	return result
}

type ideWalletInboxParamsProof struct {
	requestSHA256, paramsSHA256 string
	requestBytes, paramsBytes   int
}

// These exact synthetic RPC objects were produced by the normal caller but
// never submitted. Read params as original JSON bytes, rather than estimating
// size from raw binary material or creating a smaller replacement request.
func readIDEWalletInboxParams(t *testing.T, current map[string]ideWalletInboxMaterial) map[string]ideWalletInboxParamsProof {
	t.Helper()
	base := filepath.Join("testdata", "ide-pq-wallet-inbox", "inbox")
	raw, err := os.ReadFile(filepath.Join(base, "MAIN_NORMAL_INBOX_FIXTURE_HANDOFF.json"))
	if err != nil || len(raw) != 3517 || ideMaterialSHA256(raw) != "a2b055a9a39f1323faafae75efb5ab24d78a15022025467e60750c4196cf5f67" {
		t.Fatal("original public RPC sizing handoff changed", err)
	}
	var h struct {
		Schema   string `json:"schema"`
		Fixtures []struct {
			MaterialHandoff struct {
				Bytes  int    `json:"bytes"`
				SHA256 string `json:"sha256"`
			} `json:"materialHandoff"`
			Request struct {
				Path   string `json:"path"`
				Bytes  int    `json:"bytes"`
				SHA256 string `json:"sha256"`
			} `json:"request"`
			ParamsSHA256     string `json:"paramsSha256"`
			ParamsBytes      int    `json:"paramsBytes"`
			NormalInboxLimit int    `json:"normalInboxLimit"`
		} `json:"fixtures"`
		ActualAccount           bool `json:"actualAccount"`
		NonceSelected           bool `json:"nonceSelected"`
		Approved                bool `json:"approved"`
		Signed                  bool `json:"signed"`
		Submitted               bool `json:"submitted"`
		OriginalJSONRPCIdentity bool `json:"originalJSONRPCIdentity"`
	}
	if json.Unmarshal(raw, &h) != nil || h.Schema != "ynx-ide-main-inbox-public-negative-positive-data-1" || len(h.Fixtures) != 4 || h.ActualAccount || h.NonceSelected || h.Approved || h.Signed || h.Submitted || h.OriginalJSONRPCIdentity {
		t.Fatal("public sizing fixtures acquired account authorization or submission truth")
	}
	original := readIDECanonicalMaterials(t, "abi", ideCanonicalABIHandoffSHA256, 9966)
	result := make(map[string]ideWalletInboxParamsProof, 2)
	oldSizes := make(map[string]int, 2)
	for _, fixture := range h.Fixtures {
		data, err := os.ReadFile(filepath.Join(base, filepath.Base(fixture.Request.Path)))
		if err != nil || len(data) != fixture.Request.Bytes || ideMaterialSHA256(data) != fixture.Request.SHA256 || fixture.NormalInboxLimit != ideWalletInboxLimit {
			t.Fatal("original synthetic RPC bytes or limit changed", err)
		}
		var rpc struct {
			JSONRPC string          `json:"jsonrpc"`
			ID      int             `json:"id"`
			Method  string          `json:"method"`
			Params  json.RawMessage `json:"params"`
		}
		if json.Unmarshal(data, &rpc) != nil || rpc.JSONRPC != "2.0" || rpc.ID != 1 || rpc.Method != "ynx_preparePQContractAction" || len(rpc.Params) != fixture.ParamsBytes || ideMaterialSHA256(rpc.Params) != fixture.ParamsSHA256 {
			t.Fatal("exact original RPC params bytes differ from public sizing evidence")
		}
		var params []struct {
			Version int    `json:"version"`
			Account string `json:"account"`
			Action  struct {
				Kind    string `json:"kind"`
				Fee     string `json:"fee"`
				Payload struct {
					Name                 string   `json:"name"`
					SourceHash           string   `json:"sourceHash"`
					DeployedBytecodeHash string   `json:"deployedBytecodeHash"`
					CompilerConfigHash   string   `json:"compilerConfigHash"`
					ConstructorArgs      []string `json:"constructorArgs"`
					Value                string   `json:"value"`
				} `json:"payload"`
				Deployment struct {
					Source   string                    `json:"source"`
					Material ConsensusContractMaterial `json:"material"`
				} `json:"deployment"`
			} `json:"action"`
		}
		if json.Unmarshal(rpc.Params, &params) != nil || len(params) != 1 {
			t.Fatal("public RPC params do not contain one deployment request")
		}
		p := params[0]
		name := p.Action.Payload.Name
		pin, supported := boundedPinnedContracts[name]
		if !supported || p.Version != 1 || p.Account != "0x"+strings.Repeat("a", 40) || p.Action.Kind != ynxauth.ActionContractDeploy || p.Action.Fee != "10" || p.Action.Payload.Value != "0" || !reflect.DeepEqual(p.Action.Payload.ConstructorArgs, []string{"1"}) || p.Action.Payload.SourceHash != pin.SourceHash || p.Action.Payload.DeployedBytecodeHash != pin.DeployedBytecodeHash || p.Action.Payload.CompilerConfigHash != SolidityCompilerConfig().ConfigHash {
			t.Fatal("original synthetic request payload or pinned commitment changed")
		}
		material, source := original[name].material, original[name].source
		switch fixture.MaterialHandoff.SHA256 {
		case ideCanonicalABIHandoffSHA256:
			if fixture.MaterialHandoff.Bytes != 9966 || oldSizes[name] != 0 {
				t.Fatal("original full-output RPC sizing fixture is duplicated")
			}
			oldSizes[name] = len(rpc.Params)
		case ideWalletInboxHandoffSHA256:
			if fixture.MaterialHandoff.Bytes != 11159 || result[name].requestBytes != 0 || len(rpc.Params) > ideWalletInboxLimit || len(data) != current[name].probeRPCBytes {
				t.Fatal("new exact RPC fixture exceeds the original inbox or uses inconsistent sizing evidence")
			}
			material, source = current[name].material, current[name].source
			result[name] = ideWalletInboxParamsProof{requestSHA256: fixture.Request.SHA256, paramsSHA256: fixture.ParamsSHA256, requestBytes: len(data), paramsBytes: len(rpc.Params)}
		default:
			t.Fatal("RPC fixture points at an unknown material handoff")
		}
		if p.Action.Deployment.Source != source || !bytes.Equal(p.Action.Deployment.Material.ArtifactFile, material.ArtifactFile) || !bytes.Equal(p.Action.Deployment.Material.BuildInfoFile, material.BuildInfoFile) {
			t.Fatal("original RPC base64 material differs from the exact Go callee inputs")
		}
	}
	red, err := os.ReadFile(filepath.Join(base, "MATERIAL_WALLET_INBOX_SIZE_RED.json"))
	if err != nil || len(red) != 651 || ideMaterialSHA256(red) != "62822e4cff1f68b9b951a95dcb4d3e26085098d19bc564aae56635c1a442c197" {
		t.Fatal("original wallet inbox oversize counterexample was changed", err)
	}
	if oldSizes[ynxauth.ContractERC20Name] != 75135 || oldSizes[ynxauth.ContractERC20Name] <= ideWalletInboxLimit || oldSizes[ynxauth.ContractCounterName] != 25555 || len(result) != 2 || result[ynxauth.ContractCounterName].paramsBytes != 6467 || result[ynxauth.ContractERC20Name].paramsBytes != 14483 {
		t.Fatal("exact old over-limit or new under-limit params byte boundary changed")
	}
	return result
}

func TestIDEWalletInboxMaterialActualGoCalleesAndExactParamsSizes(t *testing.T) {
	materials := readIDEWalletInboxMaterials(t)
	params := readIDEWalletInboxParams(t, materials)
	config := SolidityCompilerConfig()
	for _, name := range []string{ynxauth.ContractCounterName, ynxauth.ContractERC20Name} {
		t.Run(name, func(t *testing.T) {
			actual := materials[name]
			pin := boundedPinnedContracts[name]
			source, deployed, err := ValidateBoundedPinnedContract(name, actual.source, actual.artifact.DeployedBytecode)
			creation, rawABI := hashParts("solc-bytecode", actual.artifact.Bytecode), hashParts("solc-abi", string(actual.artifact.ABI))
			if err != nil || source != pin.SourceHash || deployed != pin.DeployedBytecodeHash || creation != pin.CreationBytecodeHash || rawABI != pin.RawABIHash {
				t.Fatal("new inbox material differs from original pinned executable identity", err)
			}
			action, hash, at := idePublicContractDeploymentFixture(t, name)
			receipt, err := BuildConsensusPQContractDeployment(action, hash, at, actual.source, actual.material)
			if err != nil {
				t.Fatal("new exact input-only build-info failed original Go builder", err)
			}
			code, err := ValidateConsensusContractMaterial(receipt.Artifact, actual.material)
			if err != nil || code != actual.artifact.DeployedBytecode || code != receipt.Bytecode || receipt.Artifact.SourceHash != source || receipt.Artifact.BytecodeHash != creation || receipt.Artifact.DeployedBytecodeHash != deployed || receipt.Artifact.CompilerConfigHash != config.ConfigHash || !bytes.Equal(receipt.ArtifactFile, actual.material.ArtifactFile) {
				t.Fatal("new build-info failed actual material validation or changed commitments", err)
			}
			before, err := json.Marshal(receipt.Artifact)
			if err != nil {
				t.Fatal(err)
			}
			artifactBefore, buildBefore := bytes.Clone(actual.material.ArtifactFile), bytes.Clone(actual.material.BuildInfoFile)
			getter := "0x06661abd"
			if name == ynxauth.ContractERC20Name {
				getter = "0x18160ddd"
			}
			encoded, steps, err := CallConsensusSourceContract(receipt.Artifact, code, getter, receipt.Artifact.RuntimeStorage)
			if err != nil || encoded != fmt.Sprintf("0x%064x", uint64(7)) || steps <= 0 {
				t.Fatal("new exact material's original readonly getter failed", encoded, steps, err)
			}
			after, err := json.Marshal(receipt.Artifact)
			if err != nil || !bytes.Equal(before, after) || !bytes.Equal(artifactBefore, actual.material.ArtifactFile) || !bytes.Equal(buildBefore, actual.material.BuildInfoFile) {
				t.Fatal("new material readonly validation mutated artifact, storage or original bytes", err)
			}
			proof := params[name]
			result, err := json.Marshal(map[string]any{
				"schema": "ynx-ide-wallet-inbox-material-go-interop-v1", "contractName": name,
				"materialHandoffSHA256": ideWalletInboxHandoffSHA256,
				"artifactFileSHA256":    actual.artifactSHA256, "buildInfoFileSHA256": actual.buildSHA256,
				"requestSourceSHA256": actual.requestSourceSHA256, "buildInfoId": actual.artifact.BuildInfoID,
				"sourceHash": source, "deployedBytecodeHash": deployed, "creationBytecodeHash": creation,
				"rawABIHash": rawABI, "compilerConfigHash": config.ConfigHash,
				"rpcFileSHA256": proof.requestSHA256, "rpcBytes": proof.requestBytes,
				"paramsSHA256": proof.paramsSHA256, "paramsBytes": proof.paramsBytes, "inboxLimit": ideWalletInboxLimit,
				"syntheticFixture": true, "testConstructorArgs": []string{"7"}, "rpcConstructorArgs": []string{"1"},
				"getterCalldata": getter, "getterEncodedResult": encoded, "getterSteps": steps,
				"goMaterialValidated": true, "exactParamsWithinInboxLimit": true,
				"walletApproved": false, "signed": false, "submitted": false, "deployed": false, "independentFinality": false,
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("IDE_WALLET_CONTRACT_MATERIAL_INTEROP %s", result)
		})
	}
}
