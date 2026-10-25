//go:build unix

package consensus

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

type proofSelectionFixture struct {
	root, bindingPath string
	binding           ProofHostDeliveryBinding
	delivery          ProofHostDeliveryReceipt
	request           ProofHostSourceSelectionRequest
}

func newProofSelectionFixture(t *testing.T) proofSelectionFixture {
	t.Helper()
	f := newProofHostSourceFixture(t, "atomic-json", "")
	// The normal publisher requires an existing private parent. testing.TempDir
	// supplies a temporary directory, not that explicit operator permission.
	if err := os.Chmod(f.root, 0700); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(f.root, "selection-delivery")
	captured, err := f.export(t, output)
	if err != nil {
		t.Fatal(err)
	}
	delivery, err := WriteProofHostDelivery(output, captured)
	if err != nil {
		t.Fatal(err)
	}
	binding := ProofHostDeliveryBinding{OperationID: captured.OperationID, Account: captured.Account, NetworkID: captured.NetworkID, OriginalHash: captured.OriginalHash, NativeWireHash: captured.NativeWireHash, TransactionHash: captured.TransactionHash}
	if binding.TransactionHash == binding.NativeWireHash || binding.OriginalHash != "0x"+binding.NativeWireHash {
		t.Fatal("real fixture must distinguish original v1 native wire from transport hash")
	}
	bindingPath := filepath.Join(f.root, "selection-binding.json")
	proofSourceWrite(t, bindingPath, proofSourceJSON(t, binding))
	return proofSelectionFixture{root: f.root, bindingPath: bindingPath, binding: binding, delivery: delivery,
		request: ProofHostSourceSelectionRequest{Version: ProofHostSourceSelectionRequestVersion, OperationID: binding.OperationID, Account: binding.Account, NetworkID: binding.NetworkID, TransactionHash: binding.TransactionHash, NativeWireHash: binding.NativeWireHash}}
}

func (f proofSelectionFixture) register(t *testing.T, output string) (ProofHostSourceCatalogReceipt, error) {
	t.Helper()
	return RegisterProofHostSourceCatalog(f.delivery.ManifestPath, f.delivery.ManifestSHA256, f.bindingPath, proofHostSHA(proofSourceJSON(t, f.binding)), output)
}

func TestProofHostSelectionRealDeliveryExactDataAndRetainedAttempts(t *testing.T) {
	f := newProofSelectionFixture(t)
	before := proofHostDeliveryTestSnapshot(t, filepath.Dir(f.delivery.ManifestPath))
	output := filepath.Join(f.root, "registered-source.json")
	receipt, err := f.register(t, output)
	if err != nil {
		t.Fatal(err)
	}
	catalogRaw, err := os.ReadFile(output)
	if err != nil || receipt.CatalogPath != output || receipt.CatalogSHA256 != proofHostSHA(catalogRaw) {
		t.Fatal("registered catalog readback is not exact", err)
	}
	info, err := os.Lstat(output)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("catalog is not original private 0600", err)
	}
	proofHostDeliveryTestExactKeys(t, proofSourceJSON(t, receipt), "catalogPath", "catalogSha256")
	selected, err := SelectRegisteredProofHostSource(output, receipt.CatalogSHA256, proofSourceJSON(t, f.request))
	want := ProofHostSourceSelection{SourcePath: f.delivery.SourcePath, SourceSHA256: f.delivery.SourceSHA256, SourceID: f.delivery.SourceID, Epoch: f.delivery.Epoch}
	if err != nil || selected != want {
		t.Fatal("real original source selection failed", err)
	}
	proofHostDeliveryTestExactKeys(t, proofSourceJSON(t, selected), "sourcePath", "sourceSha256", "sourceId", "epoch")
	if _, err := f.register(t, output); err == nil {
		t.Fatal("registration replaced an existing catalog")
	}
	if got, _ := os.ReadFile(output); !bytes.Equal(got, catalogRaw) {
		t.Fatal("repeat changed original catalog")
	}
	for _, name := range []string{"partial.json", "UNKNOWN"} {
		path := filepath.Join(f.root, name)
		retained := []byte("original uncertain operation\x00\xff")
		proofSourceWrite(t, path, retained)
		if _, err := f.register(t, path); err == nil {
			t.Fatal("registration overwrote partial/UNKNOWN material")
		}
		if got, _ := os.ReadFile(path); !bytes.Equal(got, retained) {
			t.Fatal("uncertain material was changed")
		}
	}
	if !reflect.DeepEqual(before, proofHostDeliveryTestSnapshot(t, filepath.Dir(f.delivery.ManifestPath))) {
		t.Fatal("registration or selection mutated the original real delivery")
	}
	for _, field := range []string{"operation", "owner", "network", "transaction", "native-wire"} {
		bad := f.request
		switch field {
		case "operation":
			bad.OperationID += "-other"
		case "owner":
			bad.Account = "0x" + strings.Repeat("a", 40)
		case "network":
			bad.NetworkID = strings.Repeat("a", 64)
		case "transaction":
			bad.TransactionHash = bad.NativeWireHash
		case "native-wire":
			bad.NativeWireHash = bad.TransactionHash
		}
		if got, err := SelectRegisteredProofHostSource(output, receipt.CatalogSHA256, proofSourceJSON(t, bad)); err == nil || got != (ProofHostSourceSelection{}) {
			t.Fatal("foreign original binding selected a source", field)
		}
	}
	requestRaw := proofSourceJSON(t, f.request)
	for _, bad := range [][]byte{
		append([]byte(`{"sourcePath":"/untrusted",`), requestRaw[1:]...),
		bytes.Replace(requestRaw, []byte(`"version":`), []byte(`"version":"other","version":`), 1),
		bytes.Replace(requestRaw, []byte(f.request.NativeWireHash), []byte("0x"+f.request.NativeWireHash), 1),
		append(bytes.Clone(requestRaw), []byte(`{}`)...),
	} {
		if _, err := SelectRegisteredProofHostSource(output, receipt.CatalogSHA256, bad); err == nil {
			t.Fatal("extra, duplicate, prefixed or trailing request JSON accepted")
		}
	}
	var catalog ProofHostSourceCatalog
	if err := json.Unmarshal(catalogRaw, &catalog); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"extra", "duplicate", "epoch", "source-id", "source-pin", "manifest-pin", "partial"} {
		bad := catalog
		switch kind {
		case "epoch":
			bad.Epoch = "2"
		case "source-id":
			bad.SourceID = "other-source"
		case "source-pin":
			bad.SourceSHA256 = strings.Repeat("a", 64)
		case "manifest-pin":
			bad.ManifestSHA256 = strings.Repeat("A", 64)
		}
		raw := proofSourceJSON(t, bad)
		if kind == "extra" {
			raw = append([]byte(`{"current":true,`), raw[1:]...)
		} else if kind == "duplicate" {
			raw = bytes.Replace(raw, []byte(`"epoch":`), []byte(`"epoch":"1","epoch":`), 1)
		} else if kind == "partial" {
			raw = raw[:len(raw)-1]
		}
		if err := os.WriteFile(output, raw, 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := SelectRegisteredProofHostSource(output, proofHostSHA(raw), requestRaw); err == nil {
			t.Fatal("re-pinned invalid catalog selected a source", kind)
		}
		if got, _ := os.ReadFile(output); !bytes.Equal(got, raw) {
			t.Fatal("selector repaired or changed invalid catalog", kind)
		}
	}
	if err := os.WriteFile(output, catalogRaw, 0600); err != nil {
		t.Fatal(err)
	}
	for _, pin := range []string{"", strings.Repeat("A", 64), strings.Repeat("0", 64), strings.Repeat("a", 64)} {
		if _, err := SelectRegisteredProofHostSource(output, pin, requestRaw); err == nil {
			t.Fatal("invalid or unrelated external catalog SHA accepted")
		}
	}
	if err := os.Chmod(output, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := SelectRegisteredProofHostSource(output, receipt.CatalogSHA256, requestRaw); err == nil {
		t.Fatal("public catalog accepted")
	}
	if err := os.Chmod(output, 0600); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(f.root, "catalog-alias.json")
	if err := os.Symlink(output, alias); err != nil {
		t.Fatal(err)
	}
	if _, err := SelectRegisteredProofHostSource(alias, receipt.CatalogSHA256, requestRaw); err == nil {
		t.Fatal("catalog symlink accepted")
	}
}

func TestProofHostSelectionRegistrationRejectsBindingAndMetadataBeforeOutput(t *testing.T) {
	f := newProofSelectionFixture(t)
	for _, field := range []string{"operation", "account", "network", "native-wire", "transaction"} {
		bad := f.binding
		switch field {
		case "operation":
			bad.OperationID += "-other"
		case "account":
			bad.Account = "0x" + strings.Repeat("a", 40)
		case "network":
			bad.NetworkID = strings.Repeat("a", 64)
		case "native-wire":
			bad.NativeWireHash, bad.OriginalHash = bad.TransactionHash, "0x"+bad.TransactionHash
		case "transaction":
			bad.TransactionHash = bad.NativeWireHash
		}
		path, output := filepath.Join(f.root, field+"-binding.json"), filepath.Join(f.root, field+"-catalog.json")
		raw := proofSourceJSON(t, bad)
		proofSourceWrite(t, path, raw)
		if _, err := RegisterProofHostSourceCatalog(f.delivery.ManifestPath, f.delivery.ManifestSHA256, path, proofHostSHA(raw), output); err == nil {
			t.Fatal("foreign independently pinned binding registered", field)
		}
		if _, err := os.Lstat(output); !os.IsNotExist(err) {
			t.Fatal("failed binding reserved catalog output", field)
		}
	}
	manifestRaw, err := os.ReadFile(f.delivery.ManifestPath)
	if err != nil {
		t.Fatal(err)
	}
	sourceRaw, err := os.ReadFile(f.delivery.SourcePath)
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"epoch", "state-pin", "context-path"} {
		directory := filepath.Join(f.root, "bad-header-"+kind)
		if err := os.Mkdir(directory, 0700); err != nil {
			t.Fatal(err)
		}
		var header map[string]string
		var manifest ProofHostDeliveryManifest
		if json.Unmarshal(sourceRaw, &header) != nil || json.Unmarshal(manifestRaw, &manifest) != nil {
			t.Fatal("real fixture header/manifest unavailable")
		}
		header["contextFile"] = filepath.Join(directory, "trust-context.json")
		header["lifecycleFile"] = filepath.Join(directory, "lifecycle.json")
		switch kind {
		case "epoch":
			header["epoch"] = "2"
		case "state-pin":
			header["stateSHA256"] = strings.Repeat("a", 64)
		case "context-path":
			header["contextFile"] = filepath.Join(directory, "unregistered-context.json")
		}
		badSource := proofSourceJSON(t, header)
		manifest.SourceSHA256 = proofHostSHA(badSource)
		var total uint64
		for index := range manifest.Files {
			entry := &manifest.Files[index]
			if entry.Role == "source" {
				entry.Bytes, entry.SHA256 = strconv.Itoa(len(badSource)), manifest.SourceSHA256
			}
			size, _ := strconv.ParseUint(entry.Bytes, 10, 64)
			total += size
		}
		manifest.TotalBytes = strconv.FormatUint(total, 10)
		badManifest := proofSourceJSON(t, manifest)
		proofSourceWrite(t, filepath.Join(directory, "host-source.json"), badSource)
		proofSourceWrite(t, filepath.Join(directory, "delivery.json"), badManifest)
		output := filepath.Join(f.root, kind+"-header-catalog.json")
		_, err := RegisterProofHostSourceCatalog(filepath.Join(directory, "delivery.json"), proofHostSHA(badManifest), f.bindingPath, proofHostSHA(proofSourceJSON(t, f.binding)), output)
		if err == nil || !strings.Contains(err.Error(), "source header differs") {
			t.Fatal("re-pinned source header mismatch was not rejected at its actual boundary", kind, err)
		}
		if _, err := os.Lstat(output); !os.IsNotExist(err) {
			t.Fatal("bad source header reserved catalog output", kind)
		}
	}
	publicParent := filepath.Join(f.root, "public-catalog-parent")
	if err := os.Mkdir(publicParent, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(publicParent, 0755); err != nil {
		t.Fatal(err)
	}
	publicOutput := filepath.Join(publicParent, "catalog.json")
	if _, err := f.register(t, publicOutput); err == nil {
		t.Fatal("non-private output parent accepted")
	}
	if _, err := os.Lstat(publicOutput); !os.IsNotExist(err) {
		t.Fatal("unprotected parent reserved output")
	}
	// A delivery serializer's metadata fixture is deliberately not an original
	// source header. Its self-reported verification boolean cannot register it.
	fakeOutput := filepath.Join(f.root, "fake-delivery")
	fake := proofHostDeliverySerializerFixture(t, fakeOutput, false)
	fakeDelivery, err := WriteProofHostDelivery(fakeOutput, fake)
	if err != nil {
		t.Fatal(err)
	}
	fakeBinding := ProofHostDeliveryBinding{OperationID: fake.OperationID, Account: fake.Account, NetworkID: fake.NetworkID, OriginalHash: fake.OriginalHash, NativeWireHash: fake.NativeWireHash, TransactionHash: fake.TransactionHash}
	path := filepath.Join(f.root, "fake-binding.json")
	raw := proofSourceJSON(t, fakeBinding)
	proofSourceWrite(t, path, raw)
	output := filepath.Join(f.root, "fake-catalog.json")
	if _, err := RegisterProofHostSourceCatalog(fakeDelivery.ManifestPath, fakeDelivery.ManifestSHA256, path, proofHostSHA(raw), output); err == nil {
		t.Fatal("fake metadata verification claim registered as a real original header")
	}
	if _, err := os.Lstat(output); !os.IsNotExist(err) {
		t.Fatal("fake metadata created output")
	}
}

func TestProofHostSelectionWalletRequestRegistersRealDeliveryAndRetainsAttempts(t *testing.T) {
	f := newProofSelectionFixture(t)
	before := proofHostDeliveryTestSnapshot(t, filepath.Dir(f.delivery.ManifestPath))
	requestRaw := proofSourceJSON(t, f.binding)
	proofHostDeliveryTestExactKeys(t, requestRaw, "operationId", "account", "networkId", "originalHash", "nativeWireHash", "transactionHash")
	bindingPin := proofHostSHA(requestRaw)
	register := func(request []byte, output string) (ProofHostSourceCatalogReceipt, error) {
		return RegisterProofHostSourceCatalogForWallet(request, f.delivery.ManifestPath, f.delivery.ManifestSHA256, f.bindingPath, bindingPin, output)
	}
	output := filepath.Join(f.root, "wallet-request-catalog.json")
	receipt, err := register(requestRaw, output)
	if err != nil {
		t.Fatal("real six-field Wallet request could not register original DATA", err)
	}
	catalogRaw, err := os.ReadFile(output)
	if err != nil || receipt.CatalogPath != output || receipt.CatalogSHA256 != proofHostSHA(catalogRaw) {
		t.Fatal("Wallet request receipt differs from exact retained catalog", err)
	}
	proofHostDeliveryTestExactKeys(t, proofSourceJSON(t, receipt), "catalogPath", "catalogSha256")
	selected, err := SelectRegisteredProofHostSource(receipt.CatalogPath, receipt.CatalogSHA256, proofSourceJSON(t, f.request))
	if err != nil || selected != (ProofHostSourceSelection{SourcePath: f.delivery.SourcePath, SourceSHA256: f.delivery.SourceSHA256, SourceID: f.delivery.SourceID, Epoch: f.delivery.Epoch}) {
		t.Fatal("registered Wallet request could not select the same original source", err)
	}
	if got, err := register(requestRaw, output); err == nil || got != (ProofHostSourceCatalogReceipt{}) {
		t.Fatal("Wallet request replay replaced or acknowledged an existing catalog")
	}
	if after, _ := os.ReadFile(output); !bytes.Equal(after, catalogRaw) {
		t.Fatal("Wallet request replay changed original catalog bytes")
	}
	for _, name := range []string{"wallet-partial.json", "wallet-UNKNOWN"} {
		path := filepath.Join(f.root, name)
		retained := []byte("original Wallet registration partial/UNKNOWN\x00\xff")
		proofSourceWrite(t, path, retained)
		if got, err := register(requestRaw, path); err == nil || got != (ProofHostSourceCatalogReceipt{}) {
			t.Fatal("Wallet request overwrote partial/UNKNOWN output", name)
		}
		if after, _ := os.ReadFile(path); !bytes.Equal(after, retained) {
			t.Fatal("Wallet request altered uncertain output", name)
		}
	}
	// This is the existing transport budget, not a new protocol limit. Exact
	// budget JSON with harmless trailing whitespace remains valid; one byte over
	// it must fail before the registrar reserves another output.
	bounded := append(bytes.Clone(requestRaw), bytes.Repeat([]byte{' '}, MaxProofHostSourceSelectionRequestBytes-len(requestRaw))...)
	if _, err := register(bounded, filepath.Join(f.root, "wallet-boundary-catalog.json")); err != nil {
		t.Fatal("exact-budget original Wallet request was rejected", err)
	}
	overflowOutput := filepath.Join(f.root, "wallet-overflow-catalog.json")
	if got, err := register(append(bounded, ' '), overflowOutput); err == nil || got != (ProofHostSourceCatalogReceipt{}) {
		t.Fatal("over-budget Wallet request registered a catalog")
	}
	if _, err := os.Lstat(overflowOutput); !os.IsNotExist(err) {
		t.Fatal("over-budget Wallet request reserved output")
	}
	if !reflect.DeepEqual(before, proofHostDeliveryTestSnapshot(t, filepath.Dir(f.delivery.ManifestPath))) {
		t.Fatal("Wallet registration changed original delivery bytes or metadata")
	}
}

func TestProofHostSelectionWalletRequestRejectsClosedBindingBeforeOutput(t *testing.T) {
	f := newProofSelectionFixture(t)
	requestRaw := proofSourceJSON(t, f.binding)
	bindingPin := proofHostSHA(requestRaw)
	outputs := filepath.Join(f.root, "wallet-rejected-outputs")
	if err := os.Mkdir(outputs, 0700); err != nil {
		t.Fatal(err)
	}
	badRequests := map[string][]byte{
		"empty":         nil,
		"null":          []byte("null"),
		"array":         []byte("[]"),
		"partial":       requestRaw[:len(requestRaw)-1],
		"trailing-json": append(bytes.Clone(requestRaw), []byte("{}")...),
		"extra-version": append([]byte(`{"version":"YNX-CONSENSUS-PROOF-HOST-SELECTION-REQUEST/v1",`), requestRaw[1:]...),
		"extra-path":    append([]byte(`{"sourcePath":"/untrusted",`), requestRaw[1:]...),
		"extra-grant":   append([]byte(`{"root":true,`), requestRaw[1:]...),
		"case-alias":    bytes.Replace(requestRaw, []byte(`"operationId":`), []byte(`"OperationId":`), 1),
		"over-budget":   bytes.Repeat([]byte{' '}, MaxProofHostSourceSelectionRequestBytes+1),
	}
	fields := []string{"operationId", "account", "networkId", "originalHash", "nativeWireHash", "transactionHash"}
	for _, field := range fields {
		var values map[string]json.RawMessage
		if err := json.Unmarshal(requestRaw, &values); err != nil {
			t.Fatal(err)
		}
		delete(values, field)
		badRequests["missing-"+field] = proofSourceJSON(t, values)
		badRequests["duplicate-"+field] = append([]byte(`{"`+field+`":"duplicate",`), requestRaw[1:]...)
		values[field] = json.RawMessage(`123`)
		badRequests["wrong-type-"+field] = proofSourceJSON(t, values)
	}
	for _, field := range []string{"operation", "account", "network", "original-hash", "native-wire", "transaction"} {
		bad := f.binding
		switch field {
		case "operation":
			bad.OperationID += "-other"
		case "account":
			bad.Account = "0x" + strings.Repeat("a", 40)
		case "network":
			bad.NetworkID = strings.Repeat("a", 64)
		case "original-hash":
			bad.OriginalHash = "0x" + bad.TransactionHash
		case "native-wire":
			bad.NativeWireHash, bad.OriginalHash = bad.TransactionHash, "0x"+bad.TransactionHash
		case "transaction":
			bad.TransactionHash = bad.NativeWireHash
		}
		badRequests["foreign-"+field] = proofSourceJSON(t, bad)
	}
	for _, kind := range []string{"zero", "uppercase", "prefixed", "short", "overlong-operation", "account-alias"} {
		bad := f.binding
		switch kind {
		case "zero":
			bad.TransactionHash = strings.Repeat("0", 64)
		case "uppercase":
			bad.NetworkID = strings.Repeat("A", 64)
		case "prefixed":
			bad.TransactionHash = "0x" + bad.TransactionHash
		case "short":
			bad.NativeWireHash = bad.NativeWireHash[:63]
			bad.OriginalHash = "0x" + bad.NativeWireHash
		case "overlong-operation":
			bad.OperationID = strings.Repeat("a", 129)
		case "account-alias":
			bad.Account = "0X" + strings.Repeat("a", 40)
		}
		badRequests["invalid-"+kind] = proofSourceJSON(t, bad)
	}
	for name, raw := range badRequests {
		t.Run(name, func(t *testing.T) {
			output := filepath.Join(outputs, name+".json")
			got, err := RegisterProofHostSourceCatalogForWallet(raw, f.delivery.ManifestPath, f.delivery.ManifestSHA256, f.bindingPath, bindingPin, output)
			if err == nil || got != (ProofHostSourceCatalogReceipt{}) {
				t.Fatal("invalid or foreign Wallet request returned a catalog receipt")
			}
			if _, err := os.Lstat(output); !os.IsNotExist(err) {
				t.Fatal("invalid Wallet request reserved any catalog output")
			}
		})
	}
	for name, pins := range map[string][2]string{
		"binding-pin":  {f.delivery.ManifestSHA256, strings.Repeat("a", 64)},
		"manifest-pin": {strings.Repeat("a", 64), bindingPin},
	} {
		output := filepath.Join(outputs, name+".json")
		if got, err := RegisterProofHostSourceCatalogForWallet(requestRaw, f.delivery.ManifestPath, pins[0], f.bindingPath, pins[1], output); err == nil || got != (ProofHostSourceCatalogReceipt{}) {
			t.Fatal("Wallet request supplied or replaced an independent source pin", name)
		}
		if _, err := os.Lstat(output); !os.IsNotExist(err) {
			t.Fatal("bad independent pin reserved output", name)
		}
	}
	badBindingPath := filepath.Join(f.root, "wallet-duplicate-binding.json")
	badBinding := append([]byte(`{"operationId":"duplicate",`), requestRaw[1:]...)
	proofSourceWrite(t, badBindingPath, badBinding)
	output := filepath.Join(outputs, "bad-independent-binding.json")
	if got, err := RegisterProofHostSourceCatalogForWallet(requestRaw, f.delivery.ManifestPath, f.delivery.ManifestSHA256, badBindingPath, proofHostSHA(badBinding), output); err == nil || got != (ProofHostSourceCatalogReceipt{}) {
		t.Fatal("re-pinned nonclosed independent binding registered a Wallet request")
	}
	if entries, err := os.ReadDir(outputs); err != nil || len(entries) != 0 {
		t.Fatal("rejected Wallet requests left reserved output", err)
	}
}

func TestProofHostSelectionWalletReconcileColdCatalogAndFailuresAreReadOnly(t *testing.T) {
	f := newProofSelectionFixture(t)
	request := proofSourceJSON(t, f.binding)
	bindingPin := proofHostSHA(request)
	directory := filepath.Join(f.root, "wallet-reconcile")
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	catalogPath := filepath.Join(directory, "catalog.json")
	registered, err := f.register(t, catalogPath)
	if err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(catalogPath)
	if err != nil {
		t.Fatal(err)
	}
	// Observe real original files and directory entries around every call. The
	// cold reader must not create, replace, chmod, truncate or change mtime on
	// success or failure. Read-induced atime is deliberately not an identity.
	reconcile := func(t *testing.T, raw []byte, path, manifestPin, independentBindingPin string) (ProofHostSourceCatalogReceipt, error) {
		t.Helper()
		infos := make(map[string]os.FileInfo)
		bodies := make(map[string][]byte)
		for _, input := range []string{f.bindingPath, f.delivery.ManifestPath, f.delivery.SourcePath, catalogPath, path} {
			info, statErr := os.Lstat(input)
			if statErr != nil && !os.IsNotExist(statErr) {
				t.Fatal(statErr)
			}
			infos[input] = info
			if info != nil {
				bodies[input], err = os.ReadFile(input)
				if err != nil {
					t.Fatal(err)
				}
			}
		}
		before, readErr := os.ReadDir(filepath.Dir(path))
		if readErr != nil {
			t.Fatal(readErr)
		}
		got, callErr := ReconcileProofHostSourceCatalogForWallet(raw, f.delivery.ManifestPath, manifestPin, f.bindingPath, independentBindingPin, path)
		for input, info := range infos {
			after, statErr := os.Lstat(input)
			if info == nil {
				if !os.IsNotExist(statErr) {
					t.Fatal("read-only Wallet recovery created a missing catalog", input, statErr)
				}
				continue
			}
			body, readErr := os.ReadFile(input)
			if statErr != nil || readErr != nil || !samePQStateFile(info, after) || !bytes.Equal(body, bodies[input]) {
				t.Fatal("Wallet recovery changed original inode, bytes, mode or mtime", input, statErr, readErr)
			}
		}
		after, readErr := os.ReadDir(filepath.Dir(path))
		if readErr != nil || len(before) != len(after) {
			t.Fatal("Wallet recovery created or removed directory entries", readErr)
		}
		for index := range before {
			if before[index].Name() != after[index].Name() {
				t.Fatal("Wallet recovery replaced a directory entry")
			}
		}
		return got, callErr
	}
	for call := 0; call < 2; call++ {
		got, err := reconcile(t, request, catalogPath, f.delivery.ManifestSHA256, bindingPin)
		if err != nil || got != registered {
			t.Fatal("cold read-only Wallet recovery did not reproduce exact registration DATA", call, err)
		}
		proofHostDeliveryTestExactKeys(t, proofSourceJSON(t, got), "catalogPath", "catalogSha256")
	}
	bounded := append(bytes.Clone(request), bytes.Repeat([]byte{' '}, MaxProofHostSourceSelectionRequestBytes-len(request))...)
	if got, err := reconcile(t, bounded, catalogPath, f.delivery.ManifestSHA256, bindingPin); err != nil || got != registered {
		t.Fatal("exact-budget Wallet recovery rejected the original binding", err)
	}
	badRequests := map[string][]byte{
		"duplicate":   append([]byte(`{"operationId":"other",`), request[1:]...),
		"extra":       append([]byte(`{"root":true,`), request[1:]...),
		"missing":     bytes.Replace(request, []byte(`"account":"`+f.binding.Account+`",`), nil, 1),
		"over-budget": append(bytes.Clone(bounded), ' '),
	}
	for _, field := range []string{"operation", "account", "network", "original-hash", "native-wire", "transaction"} {
		bad := f.binding
		switch field {
		case "operation":
			bad.OperationID += "-other"
		case "account":
			bad.Account = "0x" + strings.Repeat("a", 40)
		case "network":
			bad.NetworkID = strings.Repeat("a", 64)
		case "original-hash":
			bad.OriginalHash = "0x" + bad.TransactionHash
		case "native-wire":
			bad.NativeWireHash, bad.OriginalHash = bad.TransactionHash, "0x"+bad.TransactionHash
		case "transaction":
			bad.TransactionHash = bad.NativeWireHash
		}
		badRequests[field] = proofSourceJSON(t, bad)
	}
	for name, raw := range badRequests {
		t.Run(name, func(t *testing.T) {
			if got, err := reconcile(t, raw, catalogPath, f.delivery.ManifestSHA256, bindingPin); err == nil || got != (ProofHostSourceCatalogReceipt{}) {
				t.Fatal("foreign or nonclosed request recovered a Wallet catalog")
			}
		})
	}
	for _, pins := range [][2]string{{strings.Repeat("a", 64), bindingPin}, {f.delivery.ManifestSHA256, strings.Repeat("a", 64)}} {
		if got, err := reconcile(t, request, catalogPath, pins[0], pins[1]); err == nil || got != (ProofHostSourceCatalogReceipt{}) {
			t.Fatal("existing catalog replaced an independently supplied source pin")
		}
	}
	for name, raw := range map[string][]byte{
		"partial":      original[:len(original)/2],
		"tampered":     bytes.Replace(original, []byte(f.binding.Account), []byte("0x"+strings.Repeat("a", 40)), 1),
		"noncanonical": bytes.TrimSuffix(original, []byte{'\n'}),
		"empty":        nil,
	} {
		path := filepath.Join(directory, name+".json")
		proofSourceWrite(t, path, raw)
		if got, err := reconcile(t, request, path, f.delivery.ManifestSHA256, bindingPin); err == nil || got != (ProofHostSourceCatalogReceipt{}) {
			t.Fatal("recovery adopted a partial, altered or self-reported catalog", name)
		}
	}
	unsafe := filepath.Join(directory, "nonprivate.json")
	proofSourceWrite(t, unsafe, original)
	if err := os.Chmod(unsafe, 0644); err != nil {
		t.Fatal(err)
	}
	if got, err := reconcile(t, request, unsafe, f.delivery.ManifestSHA256, bindingPin); err == nil || got != (ProofHostSourceCatalogReceipt{}) {
		t.Fatal("read-only recovery accepted a nonprivate catalog")
	}
	alias := filepath.Join(directory, "symlink.json")
	if err := os.Symlink(catalogPath, alias); err != nil {
		t.Fatal(err)
	}
	if got, err := reconcile(t, request, alias, f.delivery.ManifestSHA256, bindingPin); err == nil || got != (ProofHostSourceCatalogReceipt{}) {
		t.Fatal("read-only recovery followed a catalog symlink")
	}
	missing := filepath.Join(directory, "missing.json")
	if got, err := reconcile(t, request, missing, f.delivery.ManifestSHA256, bindingPin); err == nil || got != (ProofHostSourceCatalogReceipt{}) {
		t.Fatal("read-only recovery created or registered a missing catalog")
	}
}

func TestProofHostSelectionWalletReconcileHeldCatalogRejectsSameBytesReplacement(t *testing.T) {
	f := newProofSelectionFixture(t)
	path := filepath.Join(f.root, "wallet-replaced-catalog.json")
	registered, err := f.register(t, path)
	if err != nil {
		t.Fatal(err)
	}
	reads := &proofSelectionReads{}
	defer reads.close()
	original, _, err := reads.walletDelivery(proofSourceJSON(t, f.binding), f.delivery.ManifestPath, f.delivery.ManifestSHA256, f.bindingPath, proofHostSHA(proofSourceJSON(t, f.binding)))
	if err != nil {
		t.Fatal(err)
	}
	expected, err := encodeProofHostSourceCatalog(original)
	if err != nil || proofHostSHA(expected) != registered.CatalogSHA256 {
		t.Fatal("recovery encoder changed the original registrar's exact bytes", err)
	}
	if _, err = reads.read(path, proofHostSHA(expected), MaxProofHostSourceCatalogBytes); err != nil {
		t.Fatal(err)
	}
	held, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	replacement := filepath.Join(f.root, "replacement.json")
	proofSourceWrite(t, replacement, expected)
	if err := os.Chtimes(replacement, held.ModTime(), held.ModTime()); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(replacement, path); err != nil {
		t.Fatal(err)
	}
	replaced, err := os.Lstat(path)
	if err != nil || os.SameFile(held, replaced) {
		t.Fatal("replacement counterexample did not change the original inode", err)
	}
	// Exercise the exact final identity guard used by reconciliation after its
	// separate selector read. No testing callback or production retry is added.
	if err := reads.unchanged(); err == nil {
		t.Fatal("same bytes and mtime revived a replaced held catalog")
	}
	after, err := os.Lstat(path)
	raw, readErr := os.ReadFile(path)
	if err != nil || readErr != nil || !samePQStateFile(replaced, after) || !bytes.Equal(raw, expected) {
		t.Fatal("failed original identity check repaired or removed replacement DATA", err, readErr)
	}
}
