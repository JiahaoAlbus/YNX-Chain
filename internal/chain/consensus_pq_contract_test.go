package chain

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// The existing CI rebuilds both files with the actual pinned compiler before
// running this test. Pins are checked against that output, not a substitute ABI
// or synthetic bytecode fixture. Full authorization tests live in consensus.
func TestConsensusPQContractActualCompilerPinsAndSharedArtifactAssembler(t *testing.T) {
	root, ok := repoRoot()
	if !ok {
		t.Fatal("actual compiler repository unavailable")
	}
	for _, name := range []string{ynxauth.ContractCounterName, ynxauth.ContractERC20Name} {
		t.Run(name, func(t *testing.T) {
			material, err := readConsensusContractMaterial(root, name)
			if err != nil {
				t.Fatal(err)
			}
			source, err := os.ReadFile(filepath.Join(root, consensusContractSources[name]))
			if err != nil {
				t.Fatal(err)
			}
			var actual hardhatArtifactFile
			if err = json.Unmarshal(material.ArtifactFile, &actual); err != nil {
				t.Fatal(err)
			}
			pin := boundedPinnedContracts[name]
			if hashParts("solc-bytecode", actual.Bytecode) != pin.CreationBytecodeHash || hashParts("solc-abi", string(actual.ABI)) != pin.RawABIHash {
				t.Fatal("actual fixed compiler creation/ABI differs from registry pins")
			}
			owner := "0x" + strings.Repeat("1", 40)
			hash := "0x" + strings.Repeat("2", 64)
			at := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
			p := ynxauth.ContractDeployPayload{Name: name, SourceHash: pin.SourceHash, DeployedBytecodeHash: pin.DeployedBytecodeHash, CompilerConfigHash: SolidityCompilerConfig().ConfigHash, ConstructorArgs: []uint64{7}}
			payload, err := ynxauth.EncodeActionPayload(ynxauth.ActionContractDeploy, p)
			if err != nil {
				t.Fatal(err)
			}
			a := ynxauth.Action{Owner: owner, Kind: ynxauth.ActionContractDeploy, Payload: payload, Fee: 10, Nonce: 1}
			r, err := BuildConsensusPQContractDeployment(a, hash, at, strings.TrimSpace(string(source)), material)
			if err != nil {
				t.Fatal(err)
			}
			native := buildContractArtifactWithArgs(pqContractAddress(hash), owner, name, strings.TrimSpace(string(source)), false, nil, []string{"7"})
			native.DeployedAt = at
			got, err := json.Marshal(r.Artifact)
			if err != nil {
				t.Fatal(err)
			}
			want, err := json.Marshal(native)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got, want) {
				t.Fatal("pure consensus and existing source assembler produced different complete artifacts")
			}
			if _, err = ValidateConsensusContractMaterial(r.Artifact, material); err != nil {
				t.Fatal(err)
			}
		})
	}
}
