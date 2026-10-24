//go:build unix

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
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

type proofHostWalletRequestReader struct {
	raw   []byte
	err   error
	reads int
	bytes int
}

func (r *proofHostWalletRequestReader) Read(p []byte) (int, error) {
	r.reads++
	if r.err != nil {
		return 0, r.err
	}
	if len(r.raw) == 0 {
		return 0, io.EOF
	}
	n := copy(p, r.raw)
	r.raw = r.raw[n:]
	r.bytes += n
	return n, nil
}

func TestRegisterProofHostSourceWalletRequestStrictArguments(t *testing.T) {
	parent := t.TempDir()
	readFailure := errors.New("original Wallet request read failed")
	base := []string{"--delivery-manifest", filepath.Join(parent, "missing-delivery.json"), "--delivery-manifest-sha256", strings.Repeat("a", 64), "--binding", filepath.Join(parent, "missing-binding.json"), "--binding-sha256", strings.Repeat("b", 64), "--output", filepath.Join(parent, "catalog.json")}
	for _, tc := range []struct {
		name      string
		flags     []string
		raw       []byte
		readError error
		read      bool
	}{
		{name: "empty-request", flags: []string{"--wallet-request-stdin", "true"}, read: true},
		{name: "malformed-request", flags: []string{"--wallet-request-stdin", "true"}, raw: []byte(`{"operationId":`), read: true},
		{name: "4097-bytes", flags: []string{"--wallet-request-stdin", "true"}, raw: bytes.Repeat([]byte{'x'}, consensus.MaxProofHostSourceSelectionRequestBytes+1), read: true},
		{name: "read-error", flags: []string{"--wallet-request-stdin", "true"}, readError: readFailure, read: true},
		{name: "mutually-exclusive", flags: []string{"--wallet-request-stdin", "true", "--wallet-main-registration-output", filepath.Join(parent, "wallet-proof-host-source-registration.mjs")}},
		{name: "duplicate-wallet-flag", flags: []string{"--wallet-request-stdin", "true", "--wallet-request-stdin", "false"}},
		{name: "duplicate-original-flag", flags: []string{"--wallet-request-stdin", "true", "--binding", "/other"}},
		{name: "bare-wallet-flag", flags: []string{"--wallet-request-stdin"}},
		{name: "empty-wallet-flag", flags: []string{"--wallet-request-stdin="}},
		{name: "invalid-wallet-flag", flags: []string{"--wallet-request-stdin", "TRUE"}},
		{name: "whitespace-wallet-flag", flags: []string{"--wallet-request-stdin", " true"}},
		{name: "numeric-wallet-flag", flags: []string{"--wallet-request-stdin", "1"}},
		{name: "false-preserves-legacy", flags: []string{"--wallet-request-stdin", "false"}, readError: readFailure},
		{name: "legacy-does-not-read", readError: readFailure},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reader := &proofHostWalletRequestReader{raw: bytes.Clone(tc.raw), err: tc.readError}
			cmd := newRegisterProofHostSourceCommand()
			var out bytes.Buffer
			cmd.SetIn(reader)
			cmd.SetOut(&out)
			cmd.SetErr(&out)
			cmd.SetArgs(append(append([]string{}, base...), tc.flags...))
			err := cmd.Execute()
			if err == nil || strings.Contains(out.String(), "catalogSha256") {
				t.Fatal("invalid Wallet request registered source DATA", err)
			}
			if (reader.reads != 0) != tc.read {
				t.Fatal("Wallet request input was read outside the explicit true mode", reader.reads, err)
			}
			if tc.name == "read-error" && !errors.Is(err, readFailure) {
				t.Fatal("Wallet stdin read lost its original cause", err)
			}
			if tc.name == "4097-bytes" && reader.bytes != consensus.MaxProofHostSourceSelectionRequestBytes+1 {
				t.Fatal("Wallet stdin did not enforce the exact bounded read", reader.bytes)
			}
			for _, name := range []string{"catalog.json", "wallet-proof-host-source-registration.mjs"} {
				if _, err := os.Lstat(filepath.Join(parent, name)); !errors.Is(err, os.ErrNotExist) {
					t.Fatal("invalid Wallet request reserved an output", name, err)
				}
			}
		})
	}
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
	legacyInput := &proofHostWalletRequestReader{err: errors.New("legacy registration must not read stdin")}
	command.SetIn(legacyInput)
	command.SetArgs(args)
	if err := command.Execute(); err != nil {
		t.Fatal("normal operator registration command failed", err)
	}
	if legacyInput.reads != 0 {
		t.Fatal("normal legacy registration consumed Wallet stdin")
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

	// Reuse the actual original SourceOwner delivery and independent binding.
	// The Wallet's six-string request has no version or caller-selected paths.
	walletParent := filepath.Join(parent, "wallet-request")
	if err := os.Mkdir(walletParent, 0700); err != nil {
		t.Fatal("original/partial Wallet registration attempt must be retained", err)
	}
	walletRequestPath := filepath.Join(walletParent, "request.json")
	selectionCommandWrite(t, walletRequestPath, bindingRaw)
	deliveryRaw, err := os.ReadFile(delivery.ManifestPath)
	if err != nil {
		t.Fatal(err)
	}
	runWallet := func(input io.Reader, destination string, mode string, stdout ...io.Writer) ([]byte, error) {
		walletArgs := append([]string{}, args...)
		walletArgs[len(walletArgs)-1] = destination
		walletArgs = append(walletArgs, "--wallet-request-stdin", mode)
		var result bytes.Buffer
		root := &cobra.Command{Use: "ynx-comet", PersistentPreRunE: func(*cobra.Command, []string) error { return errors.New("normal Comet root setup must not run") }}
		root.AddCommand(newRegisterProofHostSourceCommand())
		root.SetIn(input)
		root.SetOut(&result)
		if len(stdout) != 0 {
			root.SetOut(stdout[0])
		}
		root.SetErr(&result)
		root.SetArgs(walletArgs)
		err := root.Execute()
		return result.Bytes(), err
	}
	walletCatalogPath := filepath.Join(walletParent, "catalog.json")
	walletOut, err := runWallet(bytes.NewReader(bindingRaw), walletCatalogPath, "true")
	if err != nil {
		t.Fatal("normal six-field Wallet stdin registration failed", err)
	}
	var walletReceipt consensus.ProofHostSourceCatalogReceipt
	var walletFields map[string]json.RawMessage
	if json.Unmarshal(walletOut, &walletReceipt) != nil || json.Unmarshal(walletOut, &walletFields) != nil || len(walletFields) != 2 || walletReceipt.CatalogPath != walletCatalogPath {
		t.Fatal("Wallet registration did not return exactly catalogPath and catalogSha256")
	}
	walletCatalogRaw, err := os.ReadFile(walletCatalogPath)
	if err != nil || selectionCommandSHA(walletCatalogRaw) != walletReceipt.CatalogSHA256 {
		t.Fatal("Wallet registration omitted the exact exclusive catalog pin", err)
	}
	walletSelected, err := consensus.SelectRegisteredProofHostSource(walletReceipt.CatalogPath, walletReceipt.CatalogSHA256, requestRaw)
	if err != nil || walletSelected != selected {
		t.Fatal("Wallet registration changed the original source or either transaction identity", err)
	}
	selectionCommandWrite(t, filepath.Join(walletParent, "registration.json"), walletOut)
	if _, err := runWallet(bytes.NewReader(bindingRaw), walletCatalogPath, "true"); err == nil {
		t.Fatal("Wallet registration overwrote an original/UNKNOWN catalog")
	}
	if after, err := os.ReadFile(walletCatalogPath); err != nil || !bytes.Equal(after, walletCatalogRaw) {
		t.Fatal("refused Wallet reentry changed the original catalog", err)
	}
	stdoutCatalogPath := filepath.Join(walletParent, "stdout-unknown-catalog.json")
	stdoutCause := errors.New("PUBLIC_WALLET_REQUEST_STDOUT_UNKNOWN")
	if _, err := runWallet(bytes.NewReader(bindingRaw), stdoutCatalogPath, "true", walletHandoffFailedStdout{cause: stdoutCause}); !errors.Is(err, stdoutCause) || !strings.Contains(err.Error(), "retained") {
		t.Fatal("Wallet stdin registration lost the original stdout failure/UNKNOWN", err)
	}
	stdoutCatalogRaw, err := os.ReadFile(stdoutCatalogPath)
	if err != nil || !bytes.Equal(stdoutCatalogRaw, walletCatalogRaw) {
		t.Fatal("Wallet stdout failure erased or changed the exclusive catalog", err)
	}
	stdoutSelected, err := consensus.SelectRegisteredProofHostSource(stdoutCatalogPath, selectionCommandSHA(stdoutCatalogRaw), requestRaw)
	if err != nil || stdoutSelected != selected {
		t.Fatal("retained Wallet stdout-UNKNOWN catalog cannot reconcile its original source", err)
	}
	if _, err := runWallet(bytes.NewReader(bindingRaw), stdoutCatalogPath, "true"); err == nil {
		t.Fatal("Wallet stdout UNKNOWN permitted replacement registration")
	}
	if after, err := os.ReadFile(stdoutCatalogPath); err != nil || !bytes.Equal(after, stdoutCatalogRaw) {
		t.Fatal("Wallet stdout UNKNOWN retry changed the retained catalog", err)
	}
	partialCatalogPath := filepath.Join(walletParent, "partial-catalog.json")
	partialCatalogRaw := bytes.Clone(walletCatalogRaw[:len(walletCatalogRaw)/2])
	selectionCommandWrite(t, partialCatalogPath, partialCatalogRaw)
	partialBefore, err := os.Lstat(partialCatalogPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runWallet(bytes.NewReader(bindingRaw), partialCatalogPath, "true"); err == nil {
		t.Fatal("Wallet stdin registration overwrote an original partial catalog")
	}
	partialAfter, err := os.Lstat(partialCatalogPath)
	if err != nil || !os.SameFile(partialBefore, partialAfter) {
		t.Fatal("refused Wallet registration replaced the original partial inode", err)
	}
	if after, err := os.ReadFile(partialCatalogPath); err != nil || !bytes.Equal(after, partialCatalogRaw) {
		t.Fatal("refused Wallet registration changed original partial bytes", err)
	}
	for _, field := range []string{"operationId", "account", "networkId", "originalHash", "nativeWireHash", "transactionHash"} {
		t.Run("wallet-binding-mismatch-"+field, func(t *testing.T) {
			var wrong map[string]string
			if err := json.Unmarshal(bindingRaw, &wrong); err != nil {
				t.Fatal(err)
			}
			switch field {
			case "operationId":
				wrong[field] += "_other"
			default:
				value := wrong[field]
				replacement := "a"
				if strings.HasSuffix(value, replacement) {
					replacement = "b"
				}
				wrong[field] = value[:len(value)-1] + replacement
			}
			if wrong[field] == map[string]string{"operationId": binding.OperationID, "account": binding.Account, "networkId": binding.NetworkID, "originalHash": binding.OriginalHash, "nativeWireHash": binding.NativeWireHash, "transactionHash": binding.TransactionHash}[field] {
				t.Fatal("Wallet mismatch fixture did not change its field")
			}
			raw, err := json.Marshal(wrong)
			if err != nil {
				t.Fatal(err)
			}
			destination := filepath.Join(walletParent, "mismatch-"+field+".json")
			if result, err := runWallet(bytes.NewReader(raw), destination, "true"); err == nil || strings.Contains(string(result), "catalogSha256") {
				t.Fatal("Wallet mismatch reached registration", field, err)
			}
			if _, err := os.Lstat(destination); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("Wallet binding mismatch reserved a catalog before equality", field, err)
			}
		})
	}
	for _, tc := range []struct {
		name string
		raw  []byte
	}{
		{name: "version-field", raw: append([]byte(`{"version":"unexpected",`), bindingRaw[1:]...)},
		{name: "duplicate-field", raw: append([]byte(`{"operationId":"other",`), bindingRaw[1:]...)},
		{name: "escaped-duplicate", raw: append([]byte(`{"\u006fperationId":"other",`), bindingRaw[1:]...)},
		{name: "missing-field", raw: bytes.Replace(bindingRaw, []byte(`"account":"`+binding.Account+`",`), nil, 1)},
		{name: "null-field", raw: bytes.Replace(bindingRaw, []byte(`"account":"`+binding.Account+`"`), []byte(`"account":null`), 1)},
		{name: "nonstring-field", raw: bytes.Replace(bindingRaw, []byte(`"account":"`+binding.Account+`"`), []byte(`"account":1`), 1)},
		{name: "trailing-object", raw: append(bytes.Clone(bindingRaw), []byte(`{}`)...)},
		{name: "array", raw: []byte(`[]`)},
	} {
		t.Run("wallet-malformed-"+tc.name, func(t *testing.T) {
			destination := filepath.Join(walletParent, "malformed-"+tc.name+".json")
			if result, err := runWallet(bytes.NewReader(tc.raw), destination, "true"); err == nil || strings.Contains(string(result), "catalogSha256") {
				t.Fatal("malformed six-field Wallet request reached registration", err)
			}
			if _, err := os.Lstat(destination); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("malformed Wallet request reserved a catalog", err)
			}
		})
	}
	falseInput := &proofHostWalletRequestReader{err: errors.New("false mode must preserve legacy stdin behavior")}
	if _, err := runWallet(falseInput, filepath.Join(walletParent, "false-mode-catalog.json"), "false"); err != nil || falseInput.reads != 0 {
		t.Fatal("explicit false did not retain normal legacy registration", err, falseInput.reads)
	}
	for path, original := range map[string][]byte{walletRequestPath: bindingRaw, bindingPath: bindingRaw, delivery.ManifestPath: deliveryRaw, catalogPath: catalogRaw} {
		if after, err := os.ReadFile(path); err != nil || !bytes.Equal(after, original) {
			t.Fatal("Wallet registration changed a retained original input or catalog", path, err)
		}
	}
	if t.Failed() {
		return
	}
	t.Log("PROOF_HOST_SOURCE_WALLET_REQUEST_REGISTERED_DATA_ONLY normalCLI=true exactBinding=true RootGrant=false HostQualification=false")
	t.Log("PROOF_HOST_SOURCE_REGISTERED_DATA_ONLY normalCLI=true RootGrant=false HostQualification=false")
}
