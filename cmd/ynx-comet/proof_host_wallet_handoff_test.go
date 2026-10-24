//go:build unix

package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/spf13/cobra"
)

func walletHandoffTestOwner(t *testing.T) {
	t.Helper()
	if os.Getuid() == 0 || os.Getuid() != os.Geteuid() {
		t.Skip("a root/setuid process cannot provide Main's nonroot private source handoff; skip is not delivery evidence")
	}
}

type walletHandoffPublicInputs struct {
	parent, manifest, manifestPin, bindingPath, bindingPin, catalog string
	binding                                                         consensus.ProofHostDeliveryBinding
}

// Small fake public metadata only, deliberately not a ledger/context/Host
// fixture. Register/Select may catalog its mathematical DATA; these negative
// tests never call acquire/current or claim a valid proof/Root/source grant.
func walletHandoffNegativeInputs(t *testing.T) walletHandoffPublicInputs {
	t.Helper()
	walletHandoffTestOwner(t)
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(parent, 0700); err != nil {
		t.Fatal(err)
	}
	delivery := filepath.Join(parent, "delivery")
	if err := os.Mkdir(delivery, 0700); err != nil {
		t.Fatal(err)
	}
	pin := strings.Repeat("1", 64)
	header, err := json.Marshal(map[string]string{
		"version": "YNX-CONSENSUS-PROOF-HOST-SOURCE/v1", "sourceId": "public-negative-metadata", "epoch": "1",
		"contextFile": filepath.Join(delivery, "trust-context.json"), "contextSHA256": pin,
		"lifecycleFile": filepath.Join(delivery, "lifecycle.json"), "lifecycleSHA256": pin,
		"migrationSHA256": pin, "genesisSHA256": pin, "stateSHA256": pin, "scheduleSHA256": pin,
		"runtimePlanSHA256": "", "trustedLightBlockSHA256": pin,
	})
	if err != nil {
		t.Fatal(err)
	}
	selectionCommandWrite(t, filepath.Join(delivery, "host-source.json"), header)
	f := walletHandoffPublicInputs{parent: parent, manifest: filepath.Join(delivery, "delivery.json"), bindingPath: filepath.Join(parent, "binding.json"), catalog: filepath.Join(parent, "catalog.json"), binding: consensus.ProofHostDeliveryBinding{OperationID: "PUBLIC_NEGATIVE_ONLY", Account: "0x" + strings.Repeat("2", 40), NetworkID: strings.Repeat("3", 64), OriginalHash: "0x" + strings.Repeat("4", 64), NativeWireHash: strings.Repeat("4", 64), TransactionHash: strings.Repeat("5", 64)}}
	manifest := consensus.ProofHostDeliveryManifest{Version: consensus.ProofHostDeliveryVersion, SourceID: "public-negative-metadata", Epoch: "1", Binding: f.binding, SourceFile: "host-source.json", SourceSHA256: selectionCommandSHA(header), TotalBytes: strconv.Itoa(len(header) + 7)}
	for _, row := range [][2]string{{"migration", "migration.json"}, {"genesis", "genesis.json"}, {"state", "committed-state.json"}, {"schedule", "schedule.json"}, {"trustedLightBlock", "trusted-light-block.json"}, {"context", "trust-context.json"}, {"lifecycle", "lifecycle.json"}} {
		manifest.Files = append(manifest.Files, consensus.ProofHostDeliveryFile{Role: row[0], Name: row[1], Bytes: "1", SHA256: pin})
	}
	manifest.Files = append(manifest.Files, consensus.ProofHostDeliveryFile{Role: "source", Name: "host-source.json", Bytes: strconv.Itoa(len(header)), SHA256: selectionCommandSHA(header)})
	manifestRaw, _ := json.Marshal(manifest)
	bindingRaw, _ := json.Marshal(f.binding)
	selectionCommandWrite(t, f.manifest, manifestRaw)
	selectionCommandWrite(t, f.bindingPath, bindingRaw)
	f.manifestPin, f.bindingPin = selectionCommandSHA(manifestRaw), selectionCommandSHA(bindingRaw)
	return f
}

func (f walletHandoffPublicInputs) register(t *testing.T) consensus.ProofHostSourceCatalogReceipt {
	t.Helper()
	r, err := consensus.RegisterProofHostSourceCatalog(f.manifest, f.manifestPin, f.bindingPath, f.bindingPin, f.catalog)
	if err != nil {
		t.Fatal("public negative metadata could not reach the original DATA registrar", err)
	}
	return r
}

func TestProofHostWalletHandoffRequiresNonrootAndOriginalPrivateDestination(t *testing.T) {
	for _, ids := range [][2]int{{0, 0}, {1000, 0}, {0, 1000}, {1000, 1001}} {
		if proofHostWalletOwner(ids[0], ids[1]) == nil {
			t.Fatal("normal owner check accepted root or mismatched identity", ids)
		}
	}
	if proofHostWalletOwner(1000, 1000) != nil {
		t.Fatal("normal owner check rejected a nonroot matching identity")
	}
	walletHandoffTestOwner(t)
	for _, mode := range []string{"name", "parent", "symlink-parent", "existing", "symlink-file"} {
		t.Run(mode, func(t *testing.T) {
			parent, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(parent, 0700); err != nil {
				t.Fatal(err)
			}
			output := filepath.Join(parent, proofHostWalletModuleName)
			switch mode {
			case "name":
				output = filepath.Join(parent, "other.mjs")
			case "parent":
				if err := os.Chmod(parent, 0755); err != nil {
					t.Fatal(err)
				}
			case "symlink-parent":
				alias := parent + ".alias"
				if err := os.Symlink(parent, alias); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = os.Remove(alias) })
				output = filepath.Join(alias, proofHostWalletModuleName)
			case "existing":
				selectionCommandWrite(t, output, []byte("retained UNKNOWN"))
			case "symlink-file":
				target := filepath.Join(parent, "original")
				selectionCommandWrite(t, target, []byte("retained original"))
				if err := os.Symlink(target, output); err != nil {
					t.Fatal(err)
				}
			}
			if h, err := prepareProofHostWalletHandoff(output); err == nil {
				_ = h.close()
				t.Fatal("unsafe/previous handoff was accepted", mode)
			}
			if mode == "existing" || mode == "symlink-file" {
				raw, err := os.ReadFile(output)
				if err != nil || !strings.HasPrefix(string(raw), "retained ") {
					t.Fatal("rejected preflight changed original bytes", err)
				}
			}
		})
	}
}

func TestProofHostWalletHandoffBindingAndWriteFailuresRetainOriginals(t *testing.T) {
	for _, mode := range []string{"binding", "first-cause-and-close", "write-tamper", "path-replaced"} {
		t.Run(mode, func(t *testing.T) {
			f := walletHandoffNegativeInputs(t)
			receipt := f.register(t)
			catalogRaw, err := os.ReadFile(f.catalog)
			if err != nil {
				t.Fatal(err)
			}
			output := filepath.Join(f.parent, proofHostWalletModuleName)
			h, err := prepareProofHostWalletHandoff(output)
			if err != nil {
				t.Fatal(err)
			}
			defer h.close()
			path, pin := f.bindingPath, f.bindingPin
			first, closeErr := errors.New("PUBLIC_FIRST_WRITE_UNKNOWN"), errors.New("PUBLIC_CLOSE_UNKNOWN")
			var faults *proofHostWalletWriteFaults
			switch mode {
			case "binding":
				bad := f.binding
				bad.Account = "0x" + strings.Repeat("6", 40)
				raw, _ := json.Marshal(bad)
				path = filepath.Join(f.parent, "different-original-binding.json")
				selectionCommandWrite(t, path, raw)
				pin = selectionCommandSHA(raw)
			case "first-cause-and-close":
				faults = &proofHostWalletWriteFaults{afterWrite: func(*os.File) error { return first }, closeFile: func(file *os.File) error { return errors.Join(file.Close(), closeErr) }}
			case "write-tamper":
				faults = &proofHostWalletWriteFaults{afterWrite: func(file *os.File) error { _, err := file.WriteAt([]byte("!"), 0); return err }}
			case "path-replaced":
				faults = &proofHostWalletWriteFaults{afterWrite: func(*os.File) error {
					raw, err := os.ReadFile(output)
					if err != nil {
						return err
					}
					if err = os.Rename(output, output+".original"); err != nil {
						return err
					}
					return os.WriteFile(output, raw, 0600)
				}}
			}
			err = h.write(receipt, path, pin, faults)
			if err == nil {
				t.Fatal("invalid/uncertain handoff returned success", mode)
			}
			if mode == "first-cause-and-close" && (!errors.Is(err, first) || !errors.Is(err, closeErr) || strings.Index(err.Error(), first.Error()) > strings.Index(err.Error(), closeErr.Error())) {
				t.Fatal("the original first cause or close UNKNOWN was lost", err)
			}
			if after, err := os.ReadFile(f.catalog); err != nil || !bytes.Equal(after, catalogRaw) {
				t.Fatal("handoff failure replaced/deleted the registered catalog", err)
			}
			if mode == "binding" {
				if _, err := os.Lstat(output); !os.IsNotExist(err) {
					t.Fatal("binding rejection created handoff output", err)
				}
				return
			}
			retained, err := os.ReadFile(output)
			if err != nil || len(retained) == 0 {
				t.Fatal("partial/UNKNOWN handoff was erased", err)
			}
			if err = h.write(receipt, f.bindingPath, f.bindingPin, nil); err == nil {
				t.Fatal("retained UNKNOWN handoff was overwritten")
			}
			if after, err := os.ReadFile(output); err != nil || !bytes.Equal(after, retained) {
				t.Fatal("failed repeat changed original UNKNOWN bytes", err)
			}
		})
	}
}

func TestProofHostWalletHandoffNormalCommandRejectsBadOptionsBeforeRegistration(t *testing.T) {
	for _, mode := range []string{"duplicate", "wrong-name", "same-file"} {
		t.Run(mode, func(t *testing.T) {
			f := walletHandoffNegativeInputs(t)
			module := filepath.Join(f.parent, proofHostWalletModuleName)
			args := []string{"--delivery-manifest", f.manifest, "--delivery-manifest-sha256", f.manifestPin, "--binding", f.bindingPath, "--binding-sha256", f.bindingPin, "--output", f.catalog}
			switch mode {
			case "duplicate":
				args = append(args, "--wallet-main-registration-output", module, "--wallet-main-registration-output", module)
			case "wrong-name":
				args = append(args, "--wallet-main-registration-output", filepath.Join(f.parent, "foreign.mjs"))
			case "same-file":
				args = append(args, "--wallet-main-registration-output", f.catalog)
			}
			cmd := newRegisterProofHostSourceCommand()
			var out bytes.Buffer
			cmd.SetOut(&out)
			cmd.SetErr(&out)
			cmd.SetArgs(args)
			if err := cmd.Execute(); err == nil || strings.Contains(out.String(), "catalogSha256") {
				t.Fatal("bad optional handoff arguments emitted a successful registration")
			}
			for _, path := range []string{module, f.catalog} {
				if _, err := os.Lstat(path); !os.IsNotExist(err) {
					t.Fatal("bad option parsing created an original/UNKNOWN result", path, err)
				}
			}
		})
	}
}

type walletHandoffFailedStdout struct{ cause error }

func (w walletHandoffFailedStdout) Write([]byte) (int, error) { return 0, w.cause }

func TestProofHostWalletHandoffNormalCommandStdoutFailureKeepsCatalogAndModule(t *testing.T) {
	f := walletHandoffNegativeInputs(t)
	output := filepath.Join(f.parent, proofHostWalletModuleName)
	first := errors.New("PUBLIC_STDOUT_UNKNOWN")
	cmd := newRegisterProofHostSourceCommand()
	cmd.SetOut(walletHandoffFailedStdout{first})
	cmd.SetErr(&bytes.Buffer{})
	cmd.SetArgs([]string{"--delivery-manifest", f.manifest, "--delivery-manifest-sha256", f.manifestPin, "--binding", f.bindingPath, "--binding-sha256", f.bindingPin, "--output", f.catalog, "--wallet-main-registration-output", output})
	if err := cmd.Execute(); !errors.Is(err, first) || !strings.Contains(err.Error(), "retained") {
		t.Fatal("normal caller lost the original stdout failure/UNKNOWN", err)
	}
	for _, path := range []string{f.catalog, output} {
		if raw, err := os.ReadFile(path); err != nil || len(raw) == 0 {
			t.Fatal("normal stdout failure erased an exclusive result", path, err)
		}
	}
}

// The one positive qualification path uses the original retained, actually
// dual-signed ledger fixture, not the fake metadata used by negative controls.
func TestProofHostWalletHandoffNormalCommandRetainedFixture(t *testing.T) {
	root := os.Getenv("YNX_PROOF_HOST_SOURCE_FIXTURE_OUT")
	if root == "" {
		t.Skip("requires original retained Host ledger fixture; this skip is not handoff evidence")
	}
	walletHandoffTestOwner(t)
	metadataRaw, err := os.ReadFile(filepath.Join(root, "metadata.json"))
	var metadata map[string]string
	if err != nil || json.Unmarshal(metadataRaw, &metadata) != nil || len(metadata) != 7 {
		t.Fatal("original retained source metadata is unavailable", err)
	}
	planRaw, err := os.ReadFile(metadata["sourcePlanPath"])
	if err != nil || selectionCommandSHA(planRaw) != metadata["sourcePlanSHA256"] {
		t.Fatal("independent original plan pin changed", err)
	}
	plan, err := consensus.DecodeProofHostSourcePlan(planRaw, metadata["sourcePlanSHA256"])
	if err != nil {
		t.Fatal(err)
	}
	parent := filepath.Join(root, "source-wallet-handoff")
	if err := os.Mkdir(parent, 0700); err != nil {
		t.Fatal("existing/partial original handoff must be preserved", err)
	}
	var exported bytes.Buffer
	export := newExportProofHostSourceCommand()
	export.SetOut(&exported)
	export.SetErr(&exported)
	export.SetArgs([]string{"--source-plan", metadata["sourcePlanPath"], "--source-plan-sha256", metadata["sourcePlanSHA256"], "--output", filepath.Join(parent, "delivery")})
	if err := export.Execute(); err != nil {
		t.Fatal("normal original SourceOwner export failed", err)
	}
	var delivery consensus.ProofHostDeliveryReceipt
	if json.Unmarshal(exported.Bytes(), &delivery) != nil || !delivery.PublicDataOnly || delivery.NativeRootAuthorized || delivery.DeploymentVerified {
		t.Fatal("delivery was not source DATA only")
	}
	binding := consensus.ProofHostDeliveryBinding{OperationID: plan.OperationID, Account: plan.Account, NetworkID: plan.NetworkID, OriginalHash: plan.OriginalHash, NativeWireHash: plan.ExpectedTransaction.NativeWireHash, TransactionHash: plan.ExpectedTransaction.TransactionHash}
	bindingRaw, err := json.Marshal(binding)
	if err != nil || binding.OriginalHash != "0x"+binding.NativeWireHash || binding.NativeWireHash == binding.TransactionHash {
		t.Fatal("normal source binding collapsed its distinct transaction hashes", err)
	}
	bindingPath := filepath.Join(parent, "binding.json")
	selectionCommandWrite(t, bindingPath, bindingRaw)
	catalog := filepath.Join(parent, "catalog.json")
	module := filepath.Join(parent, proofHostWalletModuleName)
	args := []string{"register-proof-host-source", "--delivery-manifest", delivery.ManifestPath, "--delivery-manifest-sha256", delivery.ManifestSHA256, "--binding", bindingPath, "--binding-sha256", selectionCommandSHA(bindingRaw), "--output", catalog, "--wallet-main-registration-output", module}
	var out bytes.Buffer
	cmd := &cobra.Command{Use: "ynx-comet", PersistentPreRunE: func(*cobra.Command, []string) error { return errors.New("stock root setup must not run") }}
	cmd.AddCommand(newRegisterProofHostSourceCommand())
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs(args)
	if err := cmd.Execute(); err != nil {
		t.Fatal("normal registration-to-Main-source caller failed", err)
	}
	var receipt consensus.ProofHostSourceCatalogReceipt
	var fields map[string]json.RawMessage
	if json.Unmarshal(out.Bytes(), &receipt) != nil || json.Unmarshal(out.Bytes(), &fields) != nil || len(fields) != 2 || receipt.CatalogPath != catalog {
		t.Fatal("normal stdout changed its exact2 DATA interface")
	}
	catalogRaw, err := os.ReadFile(catalog)
	if err != nil || selectionCommandSHA(catalogRaw) != receipt.CatalogSHA256 {
		t.Fatal("catalog identity was not the original producer result", err)
	}
	moduleRaw, err := os.ReadFile(module)
	if err != nil || !bytes.HasPrefix(moduleRaw, []byte(proofHostWalletModulePrefix)) || !bytes.HasSuffix(moduleRaw, []byte(");\n")) {
		t.Fatal("fixed Main source module was not produced", err)
	}
	pairRaw := bytes.TrimSuffix(bytes.TrimPrefix(moduleRaw, []byte(proofHostWalletModulePrefix)), []byte(");\n"))
	var pair consensus.ProofHostSourceCatalogReceipt
	if json.Unmarshal(pairRaw, &pair) != nil || json.Unmarshal(pairRaw, &fields) != nil || len(fields) != 2 || pair != receipt {
		t.Fatal("Main source changed the exact original pair or added authority fields")
	}
	requestRaw, _ := json.Marshal(consensus.ProofHostSourceSelectionRequest{Version: consensus.ProofHostSourceSelectionRequestVersion, OperationID: binding.OperationID, Account: binding.Account, NetworkID: binding.NetworkID, TransactionHash: binding.TransactionHash, NativeWireHash: binding.NativeWireHash})
	selected, err := consensus.SelectRegisteredProofHostSource(pair.CatalogPath, pair.CatalogSHA256, requestRaw)
	if err != nil || selected.SourcePath != delivery.SourcePath || selected.SourceSHA256 != delivery.SourceSHA256 || selected.SourceID != delivery.SourceID || selected.Epoch != delivery.Epoch {
		t.Fatal("normal exact2 pair failed the original registered-source selection", err)
	}
	if info, err := os.Lstat(module); err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
		t.Fatal("Main source module did not retain private permissions", err)
	}
	repeat := newRegisterProofHostSourceCommand()
	repeat.SetOut(&bytes.Buffer{})
	repeat.SetErr(&bytes.Buffer{})
	repeat.SetArgs(args[1:])
	if err := repeat.Execute(); err == nil {
		t.Fatal("normal repeated handoff overwrote original results")
	}
	if after, _ := os.ReadFile(module); !bytes.Equal(after, moduleRaw) {
		t.Fatal("rejected repeat changed original source module")
	}
	if after, _ := os.ReadFile(catalog); !bytes.Equal(after, catalogRaw) {
		t.Fatal("rejected repeat changed original catalog")
	}
	t.Log("PROOF_HOST_WALLET_MAIN_SOURCE_HANDOFF_DATA_ONLY normalCLI=true exact2=true RootGrant=false HostQualification=false MainInstalled=false")
}
