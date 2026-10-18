//go:build unix

package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
)

func proofHostDeliveryTestSHA(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func proofHostDeliveryTestParent(t *testing.T) string {
	t.Helper()
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(parent, 0700); err != nil {
		t.Fatal(err)
	}
	return parent
}

// These are serializer DATA controls, deliberately not a committed ledger,
// cryptographic fixture, proof of source provenance or activation authority.
// The real source publisher owns verification before this delivery boundary.
func proofHostDeliverySerializerFixture(t *testing.T, destination string, runtime bool) ProofHostSourceExport {
	t.Helper()
	captured := ProofHostSourceExport{
		Version: "YNX-PROOF-HOST-SOURCE-EXPORT/v1", SourceID: "serializer-data-only", Epoch: "9007199254740993",
		SourcePath: filepath.Join(destination, "host-source.json"), OperationID: "serializer-operation", Account: "0x" + strings.Repeat("11", 20), NetworkID: strings.Repeat("55", 32),
		OriginalHash: "0x" + strings.Repeat("22", 32), NativeWireHash: strings.Repeat("22", 32), TransactionHash: strings.Repeat("33", 32),
		Proof: json.RawMessage(`{"serializerDataOnly":true}`), SourceReadOnly: true, LedgerProofVerified: true,
	}
	items := [][2]string{{"migration", "migration.json"}, {"genesis", "genesis.json"}, {"state", "committed-state.json"}, {"schedule", "schedule.json"}}
	if runtime {
		items = append(items, [2]string{"runtime", "runtime-plan.json"})
	}
	items = append(items, [2]string{"trustedLightBlock", "trusted-light-block.json"}, [2]string{"context", "trust-context.json"}, [2]string{"lifecycle", "lifecycle.json"}, [2]string{"source", "host-source.json"})
	for _, item := range items {
		raw, err := json.Marshal(map[string]any{"serializerDataOnly": true, "role": item[0]})
		if err != nil {
			t.Fatal(err)
		}
		raw = append(raw, '\n')
		captured.Files = append(captured.Files, ProofHostSourceFile{Role: item[0], Name: item[1], SHA256: proofHostDeliveryTestSHA(raw), Bytes: raw})
	}
	captured.SourceSHA256 = captured.Files[len(captured.Files)-1].SHA256
	return captured
}

func proofHostDeliveryTestClone(captured ProofHostSourceExport) ProofHostSourceExport {
	copyExport := captured
	copyExport.Proof = bytes.Clone(captured.Proof)
	copyExport.Files = append([]ProofHostSourceFile(nil), captured.Files...)
	for i := range copyExport.Files {
		copyExport.Files[i].Bytes = bytes.Clone(captured.Files[i].Bytes)
	}
	return copyExport
}

type proofHostDeliveryTestRetained struct {
	Mode os.FileMode
	Body []byte
}

func proofHostDeliveryTestSnapshot(t *testing.T, directory string) map[string]proofHostDeliveryTestRetained {
	t.Helper()
	retained := make(map[string]proofHostDeliveryTestRetained)
	err := filepath.WalkDir(directory, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(directory, path)
		if err != nil {
			return err
		}
		item := proofHostDeliveryTestRetained{Mode: info.Mode()}
		if info.Mode()&os.ModeSymlink != 0 {
			target, err := os.Readlink(path)
			if err != nil {
				return err
			}
			item.Body = []byte(target)
		} else if entry.Type().IsRegular() {
			item.Body, err = os.ReadFile(path)
			if err != nil {
				return err
			}
		}
		retained[relative] = item
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return retained
}

func proofHostDeliveryTestExactKeys(t *testing.T, raw []byte, fields ...string) map[string]json.RawMessage {
	t.Helper()
	var value map[string]json.RawMessage
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	var got []string
	for key := range value {
		got = append(got, key)
	}
	sort.Strings(got)
	want := append([]string(nil), fields...)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("delivery object fields = %v, want %v", got, want)
	}
	return value
}

func proofHostDeliveryTestString(t *testing.T, raw json.RawMessage, want string) {
	t.Helper()
	var got string
	if err := json.Unmarshal(raw, &got); err != nil || got != want {
		t.Fatalf("delivery string = %q, want %q: %v", got, want, err)
	}
}

func TestProofHostDeliverySerializerWritesExactPrivateCatalogAndRefusesRepeat(t *testing.T) {
	for _, runtime := range []bool{false, true} {
		t.Run(strconv.FormatBool(runtime), func(t *testing.T) {
			destination := filepath.Join(proofHostDeliveryTestParent(t), "new-delivery")
			captured := proofHostDeliverySerializerFixture(t, destination, runtime)
			original := proofHostDeliveryTestClone(captured)
			receipt, err := WriteProofHostDelivery(destination, captured)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(captured, original) {
				t.Fatal("delivery writer mutated the captured source DATA")
			}
			info, err := os.Lstat(destination)
			if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
				t.Fatal("delivery destination is not a private directory", err)
			}
			entries, err := os.ReadDir(destination)
			if err != nil || len(entries) != len(captured.Files)+1 {
				t.Fatal("delivery must retain exactly the original files and final manifest", err)
			}
			var total int64
			for _, file := range captured.Files {
				path := filepath.Join(destination, file.Name)
				got, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(got, file.Bytes) || proofHostDeliveryTestSHA(got) != file.SHA256 {
					t.Fatal("delivery changed original source bytes", file.Role, err)
				}
				info, err := os.Lstat(path)
				if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
					t.Fatal("delivery source is not a private regular file", file.Role, err)
				}
				total += int64(len(file.Bytes))
			}
			manifestPath := filepath.Join(destination, "delivery.json")
			raw, err := os.ReadFile(manifestPath)
			if err != nil {
				t.Fatal(err)
			}
			if receipt.Version != "YNX-CONSENSUS-PROOF-HOST-DELIVERY-RECEIPT/v1" || receipt.ManifestPath != manifestPath || receipt.ManifestSHA256 != proofHostDeliveryTestSHA(raw) || receipt.SourcePath != captured.SourcePath || receipt.SourceSHA256 != captured.SourceSHA256 || receipt.SourceID != captured.SourceID || receipt.Epoch != captured.Epoch || !receipt.PublicDataOnly || receipt.NativeRootAuthorized || receipt.DeploymentVerified {
				t.Fatal("delivery receipt does not bind retained DATA or grants authority", receipt)
			}
			receiptRaw, err := json.Marshal(receipt)
			if err != nil {
				t.Fatal(err)
			}
			proofHostDeliveryTestExactKeys(t, receiptRaw, "version", "manifestPath", "manifestSHA256", "sourcePath", "sourceSHA256", "sourceId", "epoch", "publicDataOnly", "nativeRootAuthorized", "deploymentVerified")
			manifestInfo, err := os.Lstat(manifestPath)
			if err != nil || !manifestInfo.Mode().IsRegular() || manifestInfo.Mode().Perm() != 0600 {
				t.Fatal("delivery manifest is not a private final regular file", err)
			}
			manifest := proofHostDeliveryTestExactKeys(t, raw, "version", "sourceId", "epoch", "binding", "sourceFile", "sourceSHA256", "files", "totalBytes")
			proofHostDeliveryTestString(t, manifest["version"], "YNX-CONSENSUS-PROOF-HOST-DELIVERY/v1")
			proofHostDeliveryTestString(t, manifest["sourceId"], captured.SourceID)
			proofHostDeliveryTestString(t, manifest["epoch"], captured.Epoch)
			proofHostDeliveryTestString(t, manifest["sourceFile"], "host-source.json")
			proofHostDeliveryTestString(t, manifest["sourceSHA256"], captured.SourceSHA256)
			proofHostDeliveryTestString(t, manifest["totalBytes"], strconv.FormatInt(total, 10))
			binding := proofHostDeliveryTestExactKeys(t, manifest["binding"], "operationId", "account", "networkId", "originalHash", "nativeWireHash", "transactionHash")
			for field, want := range map[string]string{"operationId": captured.OperationID, "account": captured.Account, "networkId": captured.NetworkID, "originalHash": captured.OriginalHash, "nativeWireHash": captured.NativeWireHash, "transactionHash": captured.TransactionHash} {
				proofHostDeliveryTestString(t, binding[field], want)
			}
			var catalog []json.RawMessage
			if err := json.Unmarshal(manifest["files"], &catalog); err != nil || len(catalog) != len(captured.Files) {
				t.Fatal("delivery manifest does not contain the exact source catalog", err)
			}
			for i, raw := range catalog {
				entry := proofHostDeliveryTestExactKeys(t, raw, "role", "name", "bytes", "sha256")
				for field, want := range map[string]string{"role": captured.Files[i].Role, "name": captured.Files[i].Name, "bytes": strconv.Itoa(len(captured.Files[i].Bytes)), "sha256": captured.Files[i].SHA256} {
					proofHostDeliveryTestString(t, entry[field], want)
				}
			}
			before := proofHostDeliveryTestSnapshot(t, destination)
			if _, err := WriteProofHostDelivery(destination, captured); err == nil {
				t.Fatal("a second delivery replaced existing material")
			}
			if after := proofHostDeliveryTestSnapshot(t, destination); !reflect.DeepEqual(before, after) {
				t.Fatal("rejected repeat changed original delivery bytes or permissions")
			}
		})
	}
}

func TestProofHostDeliveryRejectsInvalidCapturedDataBeforeCreatingDestination(t *testing.T) {
	mutations := map[string]func(*ProofHostSourceExport){
		"version":            func(c *ProofHostSourceExport) { c.Version = "another-export" },
		"empty-source-id":    func(c *ProofHostSourceExport) { c.SourceID = "" },
		"epoch-zero":         func(c *ProofHostSourceExport) { c.Epoch = "0" },
		"epoch-leading-zero": func(c *ProofHostSourceExport) { c.Epoch = "01" },
		"epoch-overflow":     func(c *ProofHostSourceExport) { c.Epoch = "18446744073709551616" },
		"source-path": func(c *ProofHostSourceExport) {
			c.SourcePath = filepath.Join(filepath.Dir(c.SourcePath), "another-source.json")
		},
		"relative-source":      func(c *ProofHostSourceExport) { c.SourcePath = "host-source.json" },
		"source-pin":           func(c *ProofHostSourceExport) { c.SourceSHA256 = strings.Repeat("44", 32) },
		"source-pin-zero":      func(c *ProofHostSourceExport) { c.SourceSHA256 = strings.Repeat("00", 32) },
		"source-pin-uppercase": func(c *ProofHostSourceExport) { c.SourceSHA256 = strings.ToUpper(c.SourceSHA256) },
		"original-hash":        func(c *ProofHostSourceExport) { c.OriginalHash = "0x" + strings.Repeat("44", 32) },
		"native-hash":          func(c *ProofHostSourceExport) { c.NativeWireHash = "0x" + c.NativeWireHash },
		"transaction-hash":     func(c *ProofHostSourceExport) { c.TransactionHash = "0xshort" },
		"transaction-prefix":   func(c *ProofHostSourceExport) { c.TransactionHash = "0x" + c.TransactionHash },
		"network-chain-id":     func(c *ProofHostSourceExport) { c.NetworkID = "6423" },
		"network-zero":         func(c *ProofHostSourceExport) { c.NetworkID = strings.Repeat("00", 32) },
		"empty-operation":      func(c *ProofHostSourceExport) { c.OperationID = "" },
		"empty-account":        func(c *ProofHostSourceExport) { c.Account = "" },
		"empty-network":        func(c *ProofHostSourceExport) { c.NetworkID = "" },
		"source-not-readonly":  func(c *ProofHostSourceExport) { c.SourceReadOnly = false },
		"ledger-not-verified":  func(c *ProofHostSourceExport) { c.LedgerProofVerified = false },
		"root-grant":           func(c *ProofHostSourceExport) { c.NativeRootAuthorized = true },
		"deployment-claim":     func(c *ProofHostSourceExport) { c.DeploymentVerified = true },
		"empty-files":          func(c *ProofHostSourceExport) { c.Files = nil },
		"missing-file":         func(c *ProofHostSourceExport) { c.Files = c.Files[1:] },
		"extra-file": func(c *ProofHostSourceExport) {
			c.Files = append(c.Files, ProofHostSourceFile{Role: "unapproved", Name: "extra.json", Bytes: []byte("extra"), SHA256: proofHostDeliveryTestSHA([]byte("extra"))})
		},
		"duplicate-role": func(c *ProofHostSourceExport) { c.Files[1].Role = c.Files[0].Role },
		"out-of-order":   func(c *ProofHostSourceExport) { c.Files[0], c.Files[1] = c.Files[1], c.Files[0] },
		"renamed-file":   func(c *ProofHostSourceExport) { c.Files[0].Name = "other.json" },
		"path-traversal": func(c *ProofHostSourceExport) { c.Files[0].Name = "../migration.json" },
		"absolute-file": func(c *ProofHostSourceExport) {
			c.Files[0].Name = filepath.Join(filepath.Dir(c.SourcePath), "migration.json")
		},
		"file-pin": func(c *ProofHostSourceExport) { c.Files[0].SHA256 = strings.Repeat("44", 32) },
		"empty-file": func(c *ProofHostSourceExport) {
			c.Files[0].Bytes = nil
			c.Files[0].SHA256 = proofHostDeliveryTestSHA(nil)
		},
		"changed-file": func(c *ProofHostSourceExport) { c.Files[0].Bytes[0] ^= 1 },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			parent := proofHostDeliveryTestParent(t)
			destination := filepath.Join(parent, "must-not-exist")
			captured := proofHostDeliverySerializerFixture(t, destination, false)
			mutate(&captured)
			original := proofHostDeliveryTestClone(captured)
			if receipt, err := WriteProofHostDelivery(destination, captured); err == nil || !reflect.DeepEqual(receipt, ProofHostDeliveryReceipt{}) {
				t.Fatal("invalid captured DATA was delivered")
			}
			if _, err := os.Lstat(destination); !os.IsNotExist(err) {
				t.Fatal("invalid source created a destination before all preflight checks", err)
			}
			if !reflect.DeepEqual(original, captured) {
				t.Fatal("rejected captured DATA was mutated")
			}
		})
	}
}

func TestProofHostDeliveryRejectsOversizedPublicLeavesBeforeReservingOutput(t *testing.T) {
	for role, maximum := range map[string]int{"schedule": 32 << 10, "runtime": 4096, "lifecycle": 4096, "source": 16384} {
		t.Run(role, func(t *testing.T) {
			destination := filepath.Join(proofHostDeliveryTestParent(t), "must-not-exist")
			captured := proofHostDeliverySerializerFixture(t, destination, role == "runtime")
			for i := range captured.Files {
				if captured.Files[i].Role == role {
					captured.Files[i].Bytes = bytes.Repeat([]byte{'x'}, maximum+1)
					captured.Files[i].SHA256 = proofHostDeliveryTestSHA(captured.Files[i].Bytes)
					if role == "source" {
						captured.SourceSHA256 = captured.Files[i].SHA256
					}
				}
			}
			if receipt, err := WriteProofHostDelivery(destination, captured); err == nil || !reflect.DeepEqual(receipt, ProofHostDeliveryReceipt{}) {
				t.Fatal("oversized re-pinned leaf produced a delivery receipt")
			}
			if _, err := os.Lstat(destination); !os.IsNotExist(err) {
				t.Fatal("oversized leaf reserved output before validation", err)
			}
		})
	}
}

func TestProofHostDeliveryRequiresCanonicalAbsoluteDestination(t *testing.T) {
	parent := proofHostDeliveryTestParent(t)
	for _, destination := range []string{"relative-delivery", filepath.Join(parent, "new-delivery") + "/", parent + "/./new-delivery"} {
		t.Run(destination, func(t *testing.T) {
			captured := proofHostDeliverySerializerFixture(t, destination, false)
			before := proofHostDeliveryTestSnapshot(t, parent)
			if receipt, err := WriteProofHostDelivery(destination, captured); err == nil || !reflect.DeepEqual(receipt, ProofHostDeliveryReceipt{}) {
				t.Fatal("noncanonical destination was delivered")
			}
			if after := proofHostDeliveryTestSnapshot(t, parent); !reflect.DeepEqual(before, after) {
				t.Fatal("noncanonical destination changed retained source parent")
			}
		})
	}
}

func TestProofHostDeliveryRequiresExactPrivateParentMode(t *testing.T) {
	for _, mode := range []os.FileMode{0500, 0300, 0750, 0700 | os.ModeSticky} {
		t.Run(mode.String(), func(t *testing.T) {
			parent := proofHostDeliveryTestParent(t)
			retained := filepath.Join(parent, "original-public-source.json")
			original := []byte("retain exact parent material")
			if err := os.WriteFile(retained, original, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(parent, mode); err != nil {
				t.Fatal(err)
			}
			defer func() {
				if err := os.Chmod(parent, 0700); err != nil {
					t.Error(err)
				}
			}()
			destination := filepath.Join(parent, "must-not-exist")
			captured := proofHostDeliverySerializerFixture(t, destination, false)
			if receipt, err := WriteProofHostDelivery(destination, captured); err == nil || !reflect.DeepEqual(receipt, ProofHostDeliveryReceipt{}) {
				t.Fatal("non-0700 or sticky parent produced delivery output")
			}
			if _, err := os.Lstat(destination); !os.IsNotExist(err) {
				t.Fatal("invalid private parent reserved delivery output", err)
			}
			info, err := os.Lstat(parent)
			if err != nil || info.Mode().Perm() != mode.Perm() || info.Mode()&os.ModeSticky != mode&os.ModeSticky {
				t.Fatal("rejected delivery changed parent protection", err)
			}
			got, err := os.ReadFile(retained)
			if err != nil || !bytes.Equal(got, original) {
				t.Fatal("rejected delivery changed retained parent source", err)
			}
		})
	}
}

func TestProofHostDeliveryPreservesExistingDestinationAndPartialMaterial(t *testing.T) {
	for _, kind := range []string{"empty-directory", "directory", "partial", "unknown", "regular-file", "destination-symlink", "broken-destination-symlink", "parent-symlink", "public-parent", "missing-parent"} {
		t.Run(kind, func(t *testing.T) {
			parent := proofHostDeliveryTestParent(t)
			destination := filepath.Join(parent, "delivery")
			snapshotRoot := parent
			switch kind {
			case "empty-directory", "directory", "partial", "unknown":
				if err := os.Mkdir(destination, 0700); err != nil {
					t.Fatal(err)
				}
				if kind == "empty-directory" {
					break
				}
				name := "existing.json"
				if kind == "partial" {
					name = "migration.json.partial"
				} else if kind == "unknown" {
					name = "UNKNOWN"
				}
				if err := os.WriteFile(filepath.Join(destination, name), []byte("retain exact original effect\x00\xff"), 0600); err != nil {
					t.Fatal(err)
				}
			case "regular-file":
				if err := os.WriteFile(destination, []byte("retain original file"), 0600); err != nil {
					t.Fatal(err)
				}
			case "destination-symlink":
				retained := filepath.Join(parent, "retained")
				if err := os.Mkdir(retained, 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(retained, "original.json"), []byte("retain symlink destination"), 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(retained, destination); err != nil {
					t.Fatal(err)
				}
			case "broken-destination-symlink":
				if err := os.Symlink(filepath.Join(parent, "absent-original"), destination); err != nil {
					t.Fatal(err)
				}
			case "parent-symlink":
				actual := filepath.Join(parent, "actual")
				if err := os.Mkdir(actual, 0700); err != nil {
					t.Fatal(err)
				}
				alias := filepath.Join(parent, "alias")
				if err := os.Symlink(actual, alias); err != nil {
					t.Fatal(err)
				}
				destination = filepath.Join(alias, "delivery")
			case "public-parent":
				if err := os.Chmod(parent, 0755); err != nil {
					t.Fatal(err)
				}
			case "missing-parent":
				destination = filepath.Join(parent, "absent", "delivery")
			}
			captured := proofHostDeliverySerializerFixture(t, destination, false)
			before := proofHostDeliveryTestSnapshot(t, snapshotRoot)
			if _, err := WriteProofHostDelivery(destination, captured); err == nil {
				t.Fatal("delivery accepted pre-existing, aliased or unprotected material")
			}
			if after := proofHostDeliveryTestSnapshot(t, snapshotRoot); !reflect.DeepEqual(before, after) {
				t.Fatal("rejected delivery changed retained material or created output")
			}
		})
	}
}
