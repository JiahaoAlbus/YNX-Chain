//go:build unix

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/spf13/cobra"
)

func selectionCommandSHA(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func TestRegisterProofHostSourceCommandStrictArguments(t *testing.T) {
	for _, args := range [][]string{{}, {"--delivery-manifest", "/missing"},
		{"--delivery-manifest", "/a", "--delivery-manifest", "/b"},
		{"--delivery-manifest", "/a", "--delivery-manifest-sha256", strings.Repeat("a", 64), "--binding", "/b", "--binding-sha256", strings.Repeat("b", 64), "--output", "/c", "--current", "true"},
		{"--delivery-manifest", "/a", "--delivery-manifest-sha256", strings.Repeat("a", 64), "--binding", "/b", "--binding-sha256", strings.Repeat("b", 64), "--output", "/c", "--root", "self"},
	} {
		cmd := newRegisterProofHostSourceCommand()
		var out bytes.Buffer
		cmd.SetOut(&out)
		cmd.SetErr(&out)
		cmd.SetArgs(args)
		if err := cmd.Execute(); err == nil || strings.Contains(out.String(), "catalogSha256") {
			t.Fatal("invalid command arguments registered source DATA", args)
		}
	}
}

func selectionCommandWrite(t *testing.T, path string, raw []byte) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if n, err := f.Write(raw); err != nil || n != len(raw) {
		t.Fatal("retained public selection fixture write failed", err)
	}
	if err := f.Sync(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
}

// The existing source fixture comes from actual dual-signed execution. This
// normal CLI test runs after its original CI producer, with no Node or RPC.
func TestRegisterProofHostSourceNormalCommandRetainedFixture(t *testing.T) {
	root := os.Getenv("YNX_PROOF_HOST_SOURCE_FIXTURE_OUT")
	if root == "" {
		t.Skip("requires the original retained Host ledger fixture; this skip is not registration evidence")
	}
	metadataRaw, err := os.ReadFile(filepath.Join(root, "metadata.json"))
	if err != nil {
		t.Fatal(err)
	}
	var metadata map[string]string
	if json.Unmarshal(metadataRaw, &metadata) != nil || len(metadata) != 7 {
		t.Fatal("original retained source metadata is unavailable")
	}
	planRaw, err := os.ReadFile(metadata["sourcePlanPath"])
	if err != nil || selectionCommandSHA(planRaw) != metadata["sourcePlanSHA256"] {
		t.Fatal("independent original source plan pin changed", err)
	}
	plan, err := consensus.DecodeProofHostSourcePlan(planRaw, metadata["sourcePlanSHA256"])
	if err != nil {
		t.Fatal(err)
	}
	parent := filepath.Join(root, "source-selection")
	if err := os.Mkdir(parent, 0700); err != nil {
		t.Fatal("original/partial selection attempt must be retained", err)
	}
	var exported bytes.Buffer
	export := newExportProofHostSourceCommand()
	export.SetOut(&exported)
	export.SetErr(&exported)
	export.SetArgs([]string{"--source-plan", metadata["sourcePlanPath"], "--source-plan-sha256", metadata["sourcePlanSHA256"], "--output", filepath.Join(parent, "delivery")})
	if err := export.Execute(); err != nil {
		t.Fatal("normal original SourceOwner delivery command failed", err)
	}
	var delivery consensus.ProofHostDeliveryReceipt
	if json.Unmarshal(exported.Bytes(), &delivery) != nil || !delivery.PublicDataOnly || delivery.NativeRootAuthorized || delivery.DeploymentVerified {
		t.Fatal("normal delivery result granted authority or omitted original pins")
	}
	binding := consensus.ProofHostDeliveryBinding{OperationID: plan.OperationID, Account: plan.Account, NetworkID: plan.NetworkID, OriginalHash: plan.OriginalHash, NativeWireHash: plan.ExpectedTransaction.NativeWireHash, TransactionHash: plan.ExpectedTransaction.TransactionHash}
	if binding.OriginalHash != "0x"+binding.NativeWireHash || binding.TransactionHash == binding.NativeWireHash {
		t.Fatal("original source plan hashes were collapsed")
	}
	bindingRaw, err := json.Marshal(binding)
	if err != nil {
		t.Fatal(err)
	}
	bindingPath := filepath.Join(parent, "binding.json")
	selectionCommandWrite(t, bindingPath, bindingRaw)
	catalogPath := filepath.Join(parent, "catalog.json")
	args := []string{"register-proof-host-source", "--delivery-manifest", delivery.ManifestPath, "--delivery-manifest-sha256", delivery.ManifestSHA256, "--binding", bindingPath, "--binding-sha256", selectionCommandSHA(bindingRaw), "--output", catalogPath}
	var out bytes.Buffer
	command := &cobra.Command{Use: "ynx-comet", PersistentPreRunE: func(*cobra.Command, []string) error { return errors.New("normal Comet root setup must not run") }}
	command.AddCommand(newRegisterProofHostSourceCommand())
	command.SetOut(&out)
	command.SetErr(&out)
	command.SetArgs(args)
	if err := command.Execute(); err != nil {
		t.Fatal("normal operator registration command failed", err)
	}
	var receipt consensus.ProofHostSourceCatalogReceipt
	var fields map[string]json.RawMessage
	if json.Unmarshal(out.Bytes(), &receipt) != nil || json.Unmarshal(out.Bytes(), &fields) != nil || len(fields) != 2 || receipt.CatalogPath != catalogPath {
		t.Fatal("registration result is not the exact catalog path and independent SHA")
	}
	catalogRaw, err := os.ReadFile(catalogPath)
	if err != nil || selectionCommandSHA(catalogRaw) != receipt.CatalogSHA256 {
		t.Fatal("normal registration did not retain exact catalog bytes", err)
	}
	selectionCommandWrite(t, filepath.Join(parent, "registration.json"), out.Bytes())
	request := consensus.ProofHostSourceSelectionRequest{Version: consensus.ProofHostSourceSelectionRequestVersion, OperationID: binding.OperationID, Account: binding.Account, NetworkID: binding.NetworkID, TransactionHash: binding.TransactionHash, NativeWireHash: binding.NativeWireHash}
	requestRaw, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	selectionCommandWrite(t, filepath.Join(parent, "request.json"), requestRaw)
	selected, err := consensus.SelectRegisteredProofHostSource(receipt.CatalogPath, receipt.CatalogSHA256, requestRaw)
	if err != nil || selected.SourcePath != delivery.SourcePath || selected.SourceSHA256 != delivery.SourceSHA256 || selected.SourceID != delivery.SourceID || selected.Epoch != delivery.Epoch {
		t.Fatal("normal registered original source could not be selected", err)
	}
	// A delivery/output failure is UNKNOWN, never permission to overwrite it.
	repeat := newRegisterProofHostSourceCommand()
	repeat.SetArgs(args[1:])
	repeat.SetOut(&bytes.Buffer{})
	if err := repeat.Execute(); err == nil {
		t.Fatal("normal command overwrote an existing catalog")
	}
	if after, _ := os.ReadFile(catalogPath); !bytes.Equal(after, catalogRaw) {
		t.Fatal("rejected normal repeat changed the catalog")
	}
	t.Log("PROOF_HOST_SOURCE_REGISTERED_DATA_ONLY normalCLI=true RootGrant=false HostQualification=false")
}
