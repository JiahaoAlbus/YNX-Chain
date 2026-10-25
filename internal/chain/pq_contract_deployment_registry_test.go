package chain

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func TestPQContractDeploymentRegistryDataIsDeterministicAndIndependent(t *testing.T) {
	registry := PublicPQContractDeploymentRegistry()
	if registry.Version != PQContractDeploymentRegistryVersion || registry.RuntimeMode != BoundedContractRuntimeMode || !reflect.DeepEqual(registry.Compiler, SolidityCompilerConfig()) || len(registry.Contracts) != len(boundedPinnedContracts) {
		t.Fatal("public registry is not a complete projection of the existing consensus data")
	}
	names := make([]string, 0, len(registry.Contracts))
	for _, entry := range registry.Contracts {
		pin, ok := boundedPinnedContracts[entry.Name]
		if !ok || entry.SourceHash != pin.SourceHash || entry.DeployedBytecodeHash != pin.DeployedBytecodeHash || entry.CreationBytecodeHash != pin.CreationBytecodeHash || entry.RawABIHash != pin.RawABIHash || entry.CompilerConfigHash != registry.Compiler.ConfigHash {
			t.Fatal("public entry differs from the unique pinned registry", entry.Name)
		}
		names = append(names, entry.Name)
	}
	if !sort.StringsAreSorted(names) || len(names) == 0 {
		t.Fatal("public registry order is unstable or empty")
	}
	before, err := json.Marshal(registry)
	if err != nil {
		t.Fatal(err)
	}
	registry.Contracts[0].Name = "changed"
	registry.Contracts[0].SourceHash = "changed"
	registry.Compiler.Limitations[0] = "changed"
	after, err := json.Marshal(PublicPQContractDeploymentRegistry())
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("a caller mutated the original registry or compiler data", err)
	}
	var document map[string]json.RawMessage
	if json.Unmarshal(after, &document) != nil || len(document) != 4 {
		t.Fatal("public registry top-level schema changed")
	}
	var entries []map[string]json.RawMessage
	if json.Unmarshal(document["contracts"], &entries) != nil {
		t.Fatal("public contract entries are not a JSON list")
	}
	for _, entry := range entries {
		if len(entry) != 6 || entry["name"] == nil || entry["sourceHash"] == nil || entry["deployedBytecodeHash"] == nil || entry["compilerConfigHash"] == nil || entry["creationBytecodeHash"] == nil || entry["rawABIHash"] == nil {
			t.Fatal("public entry schema acquired transaction context or lost a commitment")
		}
	}
}

// The fourth original IDE handoff is the exact Wallet-inbox-sized material.
// Its existing public assembler context is reused only to compare the normal
// Go Builder. The DATA identity/registry calls themselves need no Action/H/time.
func TestPQContractDeploymentRegistryFourthWalletMaterialMatchesActualBuilder(t *testing.T) {
	materials := readIDEWalletInboxMaterials(t)
	registry := PublicPQContractDeploymentRegistry()
	for _, entry := range registry.Contracts {
		t.Run(entry.Name, func(t *testing.T) {
			actual, ok := materials[entry.Name]
			if !ok {
				t.Fatal("public registry entry lacks the original fourth material")
			}
			originalSource := actual.source
			originalArtifact, originalBuild := bytes.Clone(actual.material.ArtifactFile), bytes.Clone(actual.material.BuildInfoFile)
			identity, err := ValidatePQContractDeploymentIdentity(entry.Name, actual.source, actual.artifact.DeployedBytecode)
			if err != nil || identity != entry.PQContractDeploymentIdentity {
				t.Fatal("DATA identity disagrees with the actual registry membership", err)
			}
			action, hash, at := idePublicContractDeploymentFixture(t, entry.Name)
			receipt, err := BuildConsensusPQContractDeployment(action, hash, at, actual.source, actual.material)
			if err != nil {
				t.Fatal("original fourth material failed the actual Builder", err)
			}
			code, err := ValidateConsensusContractMaterial(receipt.Artifact, actual.material)
			if err != nil || code != actual.artifact.DeployedBytecode || receipt.Bytecode != code || receipt.Artifact.SourceHash != identity.SourceHash || receipt.Artifact.DeployedBytecodeHash != identity.DeployedBytecodeHash || receipt.Artifact.CompilerConfigHash != identity.CompilerConfigHash || receipt.Artifact.BytecodeHash != entry.CreationBytecodeHash || receipt.Artifact.CompilerArtifact == nil || receipt.Artifact.CompilerArtifact.ABIHash != entry.RawABIHash {
				t.Fatal("DATA commitments disagree with actual full-material validation", err)
			}
			for _, bad := range []struct{ name, source, bytecode string }{
				{"unsupported", actual.source, actual.artifact.DeployedBytecode},
				{entry.Name, actual.source + "\n// changed", actual.artifact.DeployedBytecode},
				{entry.Name, actual.source, "0x"},
				{entry.Name, actual.source, "0x6000"},
				{entry.Name, actual.source, "0x" + strings.Repeat("ab", 12*1024)},
			} {
				identity, err := ValidatePQContractDeploymentIdentity(bad.name, bad.source, bad.bytecode)
				if err == nil || identity != (PQContractDeploymentIdentity{}) {
					t.Fatal("invalid DATA membership returned commitments")
				}
			}
			if _, err := BuildConsensusPQContractDeployment(action, hash, at, actual.source+"\n// changed", actual.material); err == nil {
				t.Fatal("normal Builder accepted a changed source after sharing the identity helper")
			}
			var artifact hardhatArtifactFile
			if json.Unmarshal(actual.material.ArtifactFile, &artifact) != nil {
				t.Fatal("original artifact decoding failed")
			}
			artifact.DeployedBytecode = "0x6000"
			badArtifact, err := json.Marshal(artifact)
			if err != nil {
				t.Fatal(err)
			}
			badMaterial := actual.material
			badMaterial.ArtifactFile = badArtifact
			if _, err := BuildConsensusPQContractDeployment(action, hash, at, actual.source, badMaterial); err == nil {
				t.Fatal("normal Builder accepted replacement runtime code")
			}
			if actual.source != originalSource || !bytes.Equal(originalArtifact, actual.material.ArtifactFile) || !bytes.Equal(originalBuild, actual.material.BuildInfoFile) {
				t.Fatal("public DATA or normal validation mutated original material")
			}
			t.Logf("PQ_CONTRACT_DEPLOYMENT_REGISTRY_FOURTH_MATERIAL name=%s handoffSHA256=%s artifactSHA256=%s buildInfoSHA256=%s sourceHash=%s deployedBytecodeHash=%s compilerConfigHash=%s fullMaterialValidated=true syntheticAssemblerFixture=true signed=false submitted=false deployed=false", entry.Name, ideWalletInboxHandoffSHA256, actual.artifactSHA256, actual.buildSHA256, identity.SourceHash, identity.DeployedBytecodeHash, identity.CompilerConfigHash)
		})
	}
	if len(materials) != len(registry.Contracts) {
		t.Fatal("original fourth handoff and public registry membership differ")
	}
	if t.Failed() {
		return
	}
	writePublicPQContractDeploymentRegistry(t, registry)
}

// The original CI may retain a deterministic public DATA artifact. A retained
// partial/UNKNOWN is never replaced; no directory or deployment context is made.
func writePublicPQContractDeploymentRegistry(t *testing.T, registry PQContractDeploymentRegistry) {
	t.Helper()
	filename := os.Getenv("YNX_PQ_CONTRACT_DEPLOYMENT_REGISTRY_OUT")
	if filename == "" {
		return
	}
	if !filepath.IsAbs(filename) || filepath.Clean(filename) != filename {
		t.Fatal("public registry output must be an explicit canonical absolute filename")
	}
	parent := filepath.Dir(filename)
	canonical, err := filepath.EvalSymlinks(parent)
	if err != nil || canonical != parent {
		t.Fatal("public registry output parent must already exist without symlinks", err)
	}
	raw, err := json.MarshalIndent(registry, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	raw = append(raw, '\n')
	file, err := os.OpenFile(filename, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		t.Fatal("preserve existing registry output/partial/UNKNOWN", err)
	}
	if _, err := file.Write(raw); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	directory, err := os.Open(parent)
	if err != nil {
		t.Fatal(err)
	}
	syncErr := directory.Sync()
	closeErr := directory.Close()
	if syncErr != nil || closeErr != nil {
		t.Fatal("public registry output directory durability failed", syncErr, closeErr)
	}
	readback, err := os.ReadFile(filename)
	if err != nil || !bytes.Equal(readback, raw) {
		t.Fatal("public registry output readback differs", err)
	}
	digest := sha256.Sum256(raw)
	t.Logf("PQ_CONTRACT_DEPLOYMENT_REGISTRY_PUBLIC_DATA path=%s bytes=%d sha256=%s transactionContext=false signed=false submitted=false deployed=false", filename, len(raw), hex.EncodeToString(digest[:]))
}
