package chain

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConsensusContractMaterialChecksActualCompilerFiles(t *testing.T) {
	root, ok := repoRoot()
	if !ok {
		t.Fatal("source repository root is required")
	}
	for name, sourcePath := range consensusContractSources {
		t.Run(name, func(t *testing.T) {
			material, err := readConsensusContractMaterial(root, name)
			if err != nil {
				t.Fatal(err)
			}
			source, err := os.ReadFile(filepath.Join(root, sourcePath))
			if err != nil {
				t.Fatal(err)
			}
			original := buildContractArtifactWithArgs("0x"+strings.Repeat("2", 40), "0x"+strings.Repeat("1", 40), name, strings.TrimSpace(string(source)), false, nil, nil)
			bytecode, err := ValidateConsensusContractMaterial(original, material)
			if err != nil || bytecode == "" {
				t.Fatalf("actual source compiler material rejected: %v", err)
			}
			wire, err := json.Marshal(material)
			if err != nil {
				t.Fatal(err)
			}
			var restored ConsensusContractMaterial
			if err := json.Unmarshal(wire, &restored); err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(material.ArtifactFile, restored.ArtifactFile) || !bytes.Equal(material.BuildInfoFile, restored.BuildInfoFile) {
				t.Fatal("migration JSON changed original artifact/ABI bytes")
			}
			if _, err := ValidateConsensusContractMaterial(original, restored); err != nil {
				t.Fatal(err)
			}
			var metadataOnly ContractArtifact
			originalWire, _ := json.Marshal(original)
			_ = json.Unmarshal(originalWire, &metadataOnly)
			if _, err := ValidateConsensusContractMaterial(metadataOnly, restored); err != nil {
				t.Fatalf("durable source metadata rejected: %v", err)
			}
			metadataOnly.CompilerArtifact.ArtifactPath = "artifacts/contracts/../../outside.json"
			if _, err := ValidateConsensusContractMaterial(metadataOnly, restored); err == nil {
				t.Fatal("self-reported noncanonical artifact path accepted")
			}
			_ = json.Unmarshal(originalWire, &metadataOnly)
			metadataOnly.Functions[0].Selector = "0xffffffff"
			if _, err := ValidateConsensusContractMaterial(metadataOnly, restored); err == nil {
				t.Fatal("source selector trusted without actual ABI derivation")
			}
			var artifact hardhatArtifactFile
			_ = json.Unmarshal(material.ArtifactFile, &artifact)
			artifact.DeployedBytecode = "0x00"
			restored.ArtifactFile, _ = json.Marshal(artifact)
			if _, err := ValidateConsensusContractMaterial(original, restored); err == nil {
				t.Fatal("substituted executable bytecode accepted")
			}
		})
	}
}

func TestConsensusContractMaterialsRejectMissingAndUnsupportedPerAddress(t *testing.T) {
	runtime := &ConsensusRuntimeState{Contracts: map[string]ContractArtifact{
		"0x" + strings.Repeat("3", 40): {Address: "0x" + strings.Repeat("3", 40), Name: "unregistered-contract"},
		"0x" + strings.Repeat("4", 40): {Address: "0x" + strings.Repeat("4", 40), Name: "SampleEVMWriteCounter"},
	}}
	materials, blockers := LoadConsensusContractMaterials(runtime)
	if len(materials) != 0 || len(blockers) != 2 || blockers[0].Address != "0x"+strings.Repeat("3", 40) || blockers[1].Address != "0x"+strings.Repeat("4", 40) {
		t.Fatalf("source contracts silently omitted or replaced: %+v", blockers)
	}
	if len(runtime.Contracts) != 2 {
		t.Fatal("material preparation changed the source inventory")
	}
}

func TestConsensusArtifactReadConfinesActualResolvedPaths(t *testing.T) {
	root := t.TempDir()
	base := filepath.Join(root, "artifacts", "contracts")
	if err := os.MkdirAll(base, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(base, "valid.json"), []byte("valid"), 0600); err != nil {
		t.Fatal(err)
	}
	if raw, err := readConfinedConsensusArtifact(root, "artifacts/contracts", "artifacts/contracts/valid.json", 16); err != nil || string(raw) != "valid" {
		t.Fatalf("fixed root read failed: %v", err)
	}
	outside := filepath.Join(t.TempDir(), "outside.json")
	if err := os.WriteFile(outside, []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(base, "escape.json")); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"artifacts/contracts/escape.json", "artifacts/contracts/../contracts/valid.json", "artifacts/contracts\\valid.json", outside} {
		if _, err := readConfinedConsensusArtifact(root, "artifacts/contracts", path, 16); err == nil {
			t.Fatalf("escaped/noncanonical path accepted: %s", path)
		}
	}
	if _, err := readConfinedConsensusArtifact(root, "artifacts/contracts", "artifacts/contracts/valid.json", 4); err == nil {
		t.Fatal("artifact byte limit ignored")
	}
}
