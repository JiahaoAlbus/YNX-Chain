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
