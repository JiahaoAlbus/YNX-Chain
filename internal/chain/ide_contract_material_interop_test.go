package chain

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

const ideContractC8EHandoffSHA256 = "c5d0cc17eecf81131fcd04c112c9707b885d02ad87e4313bf93700dbff6620a5"
const ideContractC8ECompilerCommitment = "500f922ce0b89e7618d36ffbcd3238458891baee59b17040527042ce47db0c93"

type ideContractC8ECommitments struct {
	source, creation, deployed, rawABI string
}

var ideContractC8EActualCommitments = map[string]ideContractC8ECommitments{
	ynxauth.ContractCounterName: {
		source:   "961d42cf02384dad28e18137d58f2b46c93dbd3a80ca078a3d96726d6d86191b",
		creation: "fec3e70ad7d8c859d138198c44e73c9129334af46c682358f19b151a0a45c1a9",
		deployed: "181da68c46882bfc589c74c941e2c24975583ccb27def570afb7054e094b448f",
		rawABI:   "97c6a1aa39019cfdd36d1d7af58a5495dcdfc035989d23ce86fb6e75212864a4",
	},
	ynxauth.ContractERC20Name: {
		source:   "344b1d80d8b2fec3d22a38aa98b28e2c6ab20429f26b6cef726da1e634cbb5c4",
		creation: "5a84349f7964136ff5115a0457b21785cc87d4695f07e66d0270890d94da8e00",
		deployed: "4d70b5bbacc2ac43ccfcda0ccd9e5eccadbb8286bba07ec80a3cecaa93434df5",
		rawABI:   "c8e6dcc86de074f5653e7503ecb3c71e3fd393514205c9e4d7d49030382a1659",
	},
}

type ideContractC8EMaterial struct {
	source   string
	material ConsensusContractMaterial
	artifact hardhatArtifactFile
}

// These are the original public compiler outputs, including their rejected
// metadata. The immutable handoff pins all twelve raw files, not reconstructed
// JSON or a locally compiled replacement. No account, ledger or signer is used.
func readIDEContractC8EMaterials(t *testing.T) map[string]ideContractC8EMaterial {
	t.Helper()
	base := filepath.Join("testdata", "ide-pq-c8e")
	raw, err := os.ReadFile(filepath.Join(base, "HANDOFF.json"))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	if len(raw) != 7713 || hex.EncodeToString(sum[:]) != ideContractC8EHandoffSHA256 {
		t.Fatal("original IDE c8e handoff bytes or SHA256 changed")
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
		} `json:"compiler"`
		Contracts []struct {
			ContractName string `json:"contractName"`
			SourceName   string `json:"sourceName"`
			BuildInfoID  string `json:"buildInfoId"`
			Files        []struct {
				Path   string `json:"path"`
				Bytes  int    `json:"bytes"`
				SHA256 string `json:"sha256"`
			} `json:"files"`
		} `json:"contracts"`
		Truth struct {
			GoMaterialValidated           bool `json:"GoMaterialValidated"`
			ChainCommitmentsAuthenticated bool `json:"chainCommitmentsAuthenticated"`
			Signed                        bool `json:"signed"`
			Posted                        bool `json:"posted"`
			Deployed                      bool `json:"deployed"`
		} `json:"truth"`
	}
	if err := json.Unmarshal(raw, &handoff); err != nil {
		t.Fatal(err)
	}
	if handoff.Schema != "ynx.ide.actual-pinned-solc-material-handoff/v1" || handoff.IDESource.Commit != "c8e853687ac324208eee7d4464aac0f93ea033d3" || !handoff.IDESource.NotIncludedInCurrentApp || handoff.Compiler.ActualVersion != "0.8.24+commit.e11b9ed9.Emscripten.clang" || !handoff.Compiler.NoNetwork || len(handoff.Contracts) != 2 || handoff.Truth.GoMaterialValidated || handoff.Truth.ChainCommitmentsAuthenticated || handoff.Truth.Signed || handoff.Truth.Posted || handoff.Truth.Deployed {
		t.Fatal("original c8e producer identity or unvalidated/unsigned truth changed")
	}
	result := make(map[string]ideContractC8EMaterial, 2)
	for _, contract := range handoff.Contracts {
		if _, exists := ideContractC8EActualCommitments[contract.ContractName]; !exists || result[contract.ContractName].source != "" || contract.SourceName != consensusContractSources[contract.ContractName] || len(contract.Files) != 6 {
			t.Fatal("unexpected original c8e material inventory")
		}
		files := make(map[string][]byte, 6)
		for _, file := range contract.Files {
			name := filepath.Base(file.Path)
			if filepath.Base(filepath.Dir(file.Path)) != contract.ContractName || files[name] != nil {
				t.Fatal("ambiguous original c8e filename", file.Path)
			}
			data, err := os.ReadFile(filepath.Join(base, contract.ContractName, name))
			if err != nil {
				t.Fatal(err)
			}
			sum := sha256.Sum256(data)
			if len(data) != file.Bytes || hex.EncodeToString(sum[:]) != file.SHA256 {
				t.Fatal("original c8e compiler material bytes changed", contract.ContractName, name)
			}
			files[name] = data
		}
		for _, name := range []string{"source.sol", "request-source.txt", "compiler-input.json", "compiler-output.json", "artifact.json", "build-info.json"} {
			if len(files[name]) == 0 {
				t.Fatal("original c8e file is missing", contract.ContractName, name)
			}
		}
		requestSource := string(files["request-source.txt"])
		if requestSource != strings.TrimSpace(string(files["source.sol"])) {
			t.Fatal("SDK request source is not the original source's exact trimmed spelling")
		}
		var artifact hardhatArtifactFile
		if err := json.Unmarshal(files["artifact.json"], &artifact); err != nil || artifact.ContractName != contract.ContractName || artifact.SourceName != contract.SourceName || artifact.BuildInfoID != contract.BuildInfoID {
			t.Fatal("original c8e artifact identity differs from its handoff", err)
		}
		var build struct {
			SolcVersion string `json:"solcVersion"`
			Input       struct {
				Sources  map[string]struct{ Content string } `json:"sources"`
				Settings struct {
					Optimizer struct {
						Enabled bool `json:"enabled"`
						Runs    int  `json:"runs"`
					} `json:"optimizer"`
				} `json:"settings"`
			} `json:"input"`
		}
		if err := json.Unmarshal(files["build-info.json"], &build); err != nil || build.SolcVersion != "0.8.24" || !build.Input.Settings.Optimizer.Enabled || build.Input.Settings.Optimizer.Runs != 200 || len(build.Input.Sources) != 1 || build.Input.Sources[contract.SourceName].Content != string(files["source.sol"]) {
			t.Fatal("original c8e compiler input or settings differ from its actual source", err)
		}
		result[contract.ContractName] = ideContractC8EMaterial{source: requestSource, material: ConsensusContractMaterial{ArtifactFile: files["artifact.json"], BuildInfoFile: files["build-info.json"]}, artifact: artifact}
	}
	return result
}

// This is an explicit rejection regression, not a compatible-material PASS.
// c8e used different compiler source naming/settings and changed the bytecode
// commitments despite retaining the same Solidity source and raw ABI. Keep the
// original pinned registry and original known-good artifact authoritative.
func TestIDEContractMaterialC8ERejectsNonPinnedCompilerOutput(t *testing.T) {
	materials := readIDEContractC8EMaterials(t)
	root, ok := repoRoot()
	if !ok {
		t.Fatal("original repository compiler fixture is unavailable")
	}
	config := SolidityCompilerConfig()
	if config.ConfigHash != ideContractC8ECompilerCommitment || config.Version != "0.8.24" || !config.PreferWasm || !config.OptimizerEnabled || config.OptimizerRuns != 200 {
		t.Fatal("callee's existing fixed compiler config changed")
	}
	for _, name := range []string{ynxauth.ContractCounterName, ynxauth.ContractERC20Name} {
		t.Run(name, func(t *testing.T) {
			bad := materials[name]
			actual := ideContractC8ECommitments{source: hashParts("source", bad.source), creation: hashParts("solc-bytecode", bad.artifact.Bytecode), deployed: hashParts("solc-deployed-bytecode", bad.artifact.DeployedBytecode), rawABI: hashParts("solc-abi", string(bad.artifact.ABI))}
			if actual != ideContractC8EActualCommitments[name] {
				t.Fatalf("original c8e commitments changed: %+v", actual)
			}
			pin := boundedPinnedContracts[name]
			if actual.source != pin.SourceHash || actual.rawABI != pin.RawABIHash || actual.creation == pin.CreationBytecodeHash || actual.deployed == pin.DeployedBytecodeHash {
				t.Fatal("c8e counterexample no longer demonstrates the original source/ABI match and bytecode mismatch")
			}
			t.Logf("GoMaterialValidated=false name=%s actual source=%s creation=%s deployed=%s rawABI=%s compiler=%s", name, actual.source, actual.creation, actual.deployed, actual.rawABI, config.ConfigHash)
			t.Logf("name=%s expected source=%s creation=%s deployed=%s rawABI=%s compiler=%s", name, pin.SourceHash, pin.CreationBytecodeHash, pin.DeployedBytecodeHash, pin.RawABIHash, config.ConfigHash)
			const pinnedError = "contract source or deployed bytecode does not match the bounded pinned-artifact registry"
			if _, _, err := ValidateBoundedPinnedContract(name, bad.source, bad.artifact.DeployedBytecode); err == nil || err.Error() != pinnedError {
				t.Fatal("real c8e material was not rejected by the original bounded registry", err)
			}

			// The original artifact is assembled solely from normal CI's pinned
			// Hardhat output. Never rebuild its authority from the rejected IDE
			// files just to move validation past the identity comparison.
			normalMaterial, err := readConsensusContractMaterial(root, name)
			if err != nil {
				t.Fatal(err)
			}
			normalSource, err := os.ReadFile(filepath.Join(root, consensusContractSources[name]))
			if err != nil {
				t.Fatal(err)
			}
			owner := "0x" + strings.Repeat("1", 40)
			original := buildContractArtifactWithArgs("0x"+strings.Repeat("2", 40), owner, name, strings.TrimSpace(string(normalSource)), false, nil, []string{"7"})
			code, err := ValidateConsensusContractMaterial(original, normalMaterial)
			if err != nil {
				t.Fatal("normal pinned CI artifact is not a valid original", err)
			}
			if err := ValidatePQContractPinnedArtifact(original); err != nil {
				t.Fatal(err)
			}
			before, err := json.Marshal(original)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := ValidateConsensusContractMaterial(original, bad.material); err == nil || err.Error() != "actual contract artifact identity differs from original source record" {
				t.Fatal("bad IDE material replaced the original pinned compiler identity", err)
			}
			getter := "0x06661abd" // count()
			if name == ynxauth.ContractERC20Name {
				getter = "0x18160ddd" // totalSupply()
			}
			encoded, steps, err := CallConsensusSourceContract(original, code, getter, original.RuntimeStorage)
			if err != nil || encoded != fmt.Sprintf("0x%064x", uint64(7)) || steps <= 0 {
				t.Fatal("original pinned artifact's actual callee read regressed", encoded, steps, err)
			}
			after, err := json.Marshal(original)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("rejected IDE material or readonly call changed the original artifact", err)
			}

			// Reuse the existing public pure-assembler test's synthetic action
			// (owner 0x11.., nonce 1, hash 0x22.., constructor 7). It is not an
			// account selection, signed transaction, authorization or submission.
			payload, err := ynxauth.EncodeActionPayload(ynxauth.ActionContractDeploy, ynxauth.ContractDeployPayload{Name: name, SourceHash: pin.SourceHash, DeployedBytecodeHash: pin.DeployedBytecodeHash, CompilerConfigHash: config.ConfigHash, ConstructorArgs: []uint64{7}})
			if err != nil {
				t.Fatal(err)
			}
			action := ynxauth.Action{Owner: owner, Kind: ynxauth.ActionContractDeploy, Payload: payload, Fee: 10, Nonce: 1}
			_, err = BuildConsensusPQContractDeployment(action, "0x"+strings.Repeat("2", 64), time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC), bad.source, bad.material)
			if err == nil || err.Error() != pinnedError {
				t.Fatal("actual c8e material bypassed fresh deployment's original pinned validation", err)
			}
		})
	}
}
