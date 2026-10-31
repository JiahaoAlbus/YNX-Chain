//go:build unix

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// These are independent expectations for the existing public DATA carrier,
// not a projection of the implementation's portableOriginalPaths variable.
var portableTestOriginalPaths = []string{
	"context/PUBLIC-PROOF-INPUTS.json",
	"context/committed-state.json",
	"context/genesis.json",
	"context/migration.json",
	"context/request.json",
	"context/schedule.json",
	"context/trust-context.json",
	"context/trusted-light-block.json",
	"original-results/functional-owner-4-final-proof.json",
	"original-results/functional-owner-4-normal-verifier.log",
	"original-results/functional-owner-4-observation.json",
	"original-results/functional-owner-4-original-confirm.log",
	"original-results/functional-owner-4-original-export.log",
	"original-results/functional-owner-4-original-sign.log",
}

type portableTestFixture struct {
	source, output, contextPath, catalogPath string
	contextRaw, catalogRaw                   []byte
	context                                  transactionTrustContext
	catalog                                  portableFileCatalog
	originals                                map[string][]byte
}

func portableTestHash(raw []byte) string {
	h := sha256.Sum256(raw)
	return hex.EncodeToString(h[:])
}

func portableTestWrite(t *testing.T, path string, raw []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
}

func newPortableTestFixture(t *testing.T, runtime bool) *portableTestFixture {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	f := &portableTestFixture{
		source: filepath.Join(root, "source"), output: filepath.Join(root, "portable \"quoted\" \\ output"),
		catalogPath: filepath.Join(root, "file-catalog.json"), originals: make(map[string][]byte),
	}
	f.context = transactionContextSyntaxFixture("/old/input")
	f.context.LightTrust.MigrationFile = "/old/input/migration.json"
	f.context.LightTrust.GenesisFile = "/old/input/genesis.json"
	f.context.LightTrust.StateFile = "/old/input/committed-state.json"
	f.context.LightTrust.ScheduleFile = "/old/input/schedule.json"
	f.context.LightTrust.TrustedLightBlockFile = "/old/input/trusted-light-block.json"
	// Reuse a path as an independently bound, non-path string: a global string
	// replacement would silently retarget this chain and must fail this test.
	f.context.LightTrust.ChainID = f.context.LightTrust.MigrationFile
	f.context.ExpectedTransaction.Block.ChainID = f.context.LightTrust.ChainID
	f.context.ExpectedTransaction.Successor.ChainID = f.context.LightTrust.ChainID
	f.context.LightTrust.TrustingPeriodNanoseconds = "1"
	f.context.LightTrust.MaxClockDriftNanoseconds = "0"
	paths := append([]string(nil), portableTestOriginalPaths...)
	if runtime {
		f.context.LightTrust.RuntimePlanFile = "/old/input/runtime-plan.json"
		f.context.LightTrust.RuntimePlanHash = strings.Repeat("22", 32)
		paths = append(paths, "context/runtime-plan.json")
	}
	f.contextRaw, err = json.MarshalIndent(f.context, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	// Preserve deliberately noncanonical JSON whitespace. Only scalar path
	// tokens may change; canonicalizing this object would lose the original.
	f.contextRaw = bytes.Replace(f.contextRaw, []byte(`"trustLevelNumerator": "1"`), []byte("\"trustLevelNumerator\" \t: \t\"1\""), 1)
	f.contextRaw = append(f.contextRaw, '\n')
	if len(f.contextRaw) <= 32<<10 {
		t.Fatal("transaction context fixture failed to exercise the larger profile")
	}
	f.contextPath = filepath.Join(f.source, "context", "trust-context.json")
	sort.Strings(paths)
	for _, path := range paths {
		// Opaque public originals deliberately do not manufacture a valid
		// migration, trusted LightBlock, signature or normal-verifier success.
		raw := []byte("public DATA syntax fixture: " + path + "\n")
		if path == "context/trust-context.json" {
			raw = bytes.Clone(f.contextRaw)
		}
		if path == "context/request.json" {
			raw = transactionJSON(t, transactionInput{Version: transactionRequestVersion, Expected: f.context.ExpectedTransaction, Proof: json.RawMessage(`{}`)})
		}
		f.originals[path] = raw
		portableTestWrite(t, filepath.Join(f.source, filepath.FromSlash(path)), raw)
		f.catalog.Files = append(f.catalog.Files, portableFileEntry{Path: path, Bytes: strconv.Itoa(len(raw)), SHA256: portableTestHash(raw)})
	}
	f.catalog.Version = "YNX-CONSENSUS-PROOF-PORTABLE-FILES/v1"
	f.catalogRaw = transactionJSON(t, f.catalog)
	portableTestWrite(t, f.catalogPath, f.catalogRaw)
	// A carrier's old expiry/authorization statements are not current trust.
	portableTestWrite(t, filepath.Join(f.source, "MANIFEST.json"), []byte("{\"currentlyExpired\":true,\"nativeGrant\":false,\"sourceGrant\":false}\n"))
	return f
}

func (f *portableTestFixture) args() []string {
	return []string{"portable-import", "--trust-context", f.contextPath, "--trust-context-sha256", portableTestHash(f.contextRaw), "--file-catalog", f.catalogPath, "--file-catalog-sha256", portableTestHash(f.catalogRaw), "--source-dir", f.source, "--output-dir", f.output}
}

func (f *portableTestFixture) setCatalog(t *testing.T, raw []byte) {
	t.Helper()
	f.catalogRaw = raw
	portableTestWrite(t, f.catalogPath, raw)
}

func (f *portableTestFixture) assertOriginals(t *testing.T) {
	t.Helper()
	for path, original := range f.originals {
		raw, err := os.ReadFile(filepath.Join(f.source, filepath.FromSlash(path)))
		if err != nil || !bytes.Equal(raw, original) {
			t.Fatal("import changed an original public file", path, err)
		}
	}
}

func portableTestResult(t *testing.T, f *portableTestFixture, args []string) (int, portableImportResult) {
	t.Helper()
	var output bytes.Buffer
	status := runPortableImport(args, &output)
	var result portableImportResult
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal("import failed to return bounded structured DATA result", err)
	}
	if result.Version != "YNX-CONSENSUS-PROOF-PORTABLE-IMPORT/v1" || result.Classification != "data" || result.Code == "" {
		t.Fatal("import result lost its DATA type")
	}
	if result.SourceGrant || result.NativeRootAuthorized || result.SourceDeploymentQualified || result.ProofVerified {
		t.Fatal("DATA import manufactured authority, deployment or proof verification")
	}
	if status != 0 && (result.Error == "" || len([]rune(result.Error)) > 512 || strings.ContainsAny(result.Error, "\r\n\t")) {
		t.Fatal("rejection lost its bounded public first cause")
	}
	// Do not dump or log a raw context, original transaction or proof on failure.
	if bytes.Contains(output.Bytes(), f.contextRaw) || strings.Contains(result.Error, f.context.ExpectedTransaction.Envelope[:80]) {
		t.Fatal("import result disclosed an original transport body")
	}
	return status, result
}

func portableTestNoOutput(t *testing.T, output string) {
	t.Helper()
	if _, err := os.Lstat(output); !os.IsNotExist(err) {
		t.Fatal("preflight rejection created an output attempt", err)
	}
}

func portableTestNoReceipt(t *testing.T, output string) {
	t.Helper()
	if _, err := os.Lstat(filepath.Join(output, "PUBLIC-PORTABLE-IMPORT.json")); !os.IsNotExist(err) {
		t.Fatal("rejected import left a success receipt", err)
	}
}

func TestPortableImportPreservesOriginalBytesAndOnlyRebindsPaths(t *testing.T) {
	for _, runtime := range []bool{false, true} {
		t.Run(strconv.FormatBool(runtime), func(t *testing.T) {
			f := newPortableTestFixture(t, runtime)
			status, result := portableTestResult(t, f, f.args())
			if status != 0 || result.Code != "IMPORTED_DATA" || result.Error != "" || result.OriginalContextSHA256 != portableTestHash(f.contextRaw) || result.CatalogSHA256 != portableTestHash(f.catalogRaw) {
				t.Fatal("valid independently pinned DATA was not imported")
			}
			f.assertOriginals(t)
			want := f.context
			paths := map[string]string{
				"migrationFile": "context/migration.json", "genesisFile": "context/genesis.json", "stateFile": "context/committed-state.json",
				"scheduleFile": "context/schedule.json", "trustedLightBlockFile": "context/trusted-light-block.json",
			}
			if runtime {
				paths["runtimePlanFile"] = "context/runtime-plan.json"
			}
			expectedRaw := bytes.Clone(f.contextRaw)
			oldPaths := map[string]string{"migrationFile": f.context.LightTrust.MigrationFile, "genesisFile": f.context.LightTrust.GenesisFile, "stateFile": f.context.LightTrust.StateFile, "scheduleFile": f.context.LightTrust.ScheduleFile, "trustedLightBlockFile": f.context.LightTrust.TrustedLightBlockFile, "runtimePlanFile": f.context.LightTrust.RuntimePlanFile}
			for field, relative := range paths {
				newPath := filepath.Join(f.output, "original", filepath.FromSlash(relative))
				oldToken, newToken := transactionJSON(t, oldPaths[field]), transactionJSON(t, newPath)
				prefix := append(transactionJSON(t, field), []byte(": ")...)
				oldPair := append(bytes.Clone(prefix), oldToken...)
				newPair := append(bytes.Clone(prefix), newToken...)
				if bytes.Count(expectedRaw, oldPair) != 1 {
					t.Fatal("fixture lacks one exact path token", field)
				}
				expectedRaw = bytes.Replace(expectedRaw, oldPair, newPair, 1)
			}
			want.LightTrust.MigrationFile = filepath.Join(f.output, "original/context/migration.json")
			want.LightTrust.GenesisFile = filepath.Join(f.output, "original/context/genesis.json")
			want.LightTrust.StateFile = filepath.Join(f.output, "original/context/committed-state.json")
			want.LightTrust.ScheduleFile = filepath.Join(f.output, "original/context/schedule.json")
			want.LightTrust.TrustedLightBlockFile = filepath.Join(f.output, "original/context/trusted-light-block.json")
			if runtime {
				want.LightTrust.RuntimePlanFile = filepath.Join(f.output, "original/context/runtime-plan.json")
			}
			portablePath := filepath.Join(f.output, "portable-trust-context.json")
			portableRaw, err := os.ReadFile(portablePath)
			if err != nil || !bytes.Equal(portableRaw, expectedRaw) {
				t.Fatal("path projection changed non-path original bytes or escaping", err)
			}
			got, _, err := decodeTransactionTrustContext(portableRaw, portableTestHash(portableRaw))
			if err != nil || got != want || got.LightTrust.ChainID != f.context.LightTrust.ChainID {
				t.Fatal("path projection retargeted an original transaction, hash or trust parameter", err)
			}
			if result.ContextPath != portablePath || result.ContextSHA256 != portableTestHash(portableRaw) || len(result.Files) != len(f.originals)+1 {
				t.Fatal("new context result is not bound to the actual output")
			}
			wantFiles := map[string]bool{"portable-trust-context.json": true, "PUBLIC-PORTABLE-IMPORT.json": true}
			for path, raw := range f.originals {
				relative := "original/" + path
				wantFiles[relative] = true
				copied, e := os.ReadFile(filepath.Join(f.output, filepath.FromSlash(relative)))
				if e != nil || !bytes.Equal(copied, raw) {
					t.Fatal("raw original copy was rewritten", path, e)
				}
			}
			if err = filepath.WalkDir(f.output, func(path string, entry fs.DirEntry, e error) error {
				if e != nil {
					return e
				}
				if entry.IsDir() {
					return nil
				}
				relative, e := filepath.Rel(f.output, path)
				if e != nil {
					return e
				}
				relative = filepath.ToSlash(relative)
				if !wantFiles[relative] || !entry.Type().IsRegular() {
					t.Fatal("unexpected output or non-regular public original", relative)
				}
				delete(wantFiles, relative)
				return nil
			}); err != nil || len(wantFiles) != 0 {
				t.Fatal("portable output catalog was not closed and complete", err)
			}
			// Importing opaque originals cannot supply valid committed authority.
			if _, err = got.LightTrust.load(); err == nil {
				t.Fatal("schema-only DATA import manufactured a normal verifier authority")
			}
			carrier, err := os.ReadFile(filepath.Join(f.source, "MANIFEST.json"))
			if err != nil || !bytes.Contains(carrier, []byte(`"currentlyExpired":true`)) || !bytes.Contains(carrier, []byte(`"sourceGrant":false`)) {
				t.Fatal("import repaired the old expiry or authority statement", err)
			}
		})
	}
}

func TestPortableImportExactFlagsRejectBeforeOutput(t *testing.T) {
	f := newPortableTestFixture(t, false)
	if !isPortableImportInvocation(f.args()) || isPortableImportInvocation(nil) || isPortableImportInvocation([]string{"--portable-import"}) {
		t.Fatal("portable DATA dispatch is not an exact subcommand")
	}
	if _, err := parsePortableImportOptions(f.args()); err != nil {
		t.Fatal("valid exact options rejected", err)
	}
	inline := []string{"portable-import"}
	for i := 1; i < len(f.args()); i += 2 {
		inline = append(inline, f.args()[i]+"="+f.args()[i+1])
	}
	if _, err := parsePortableImportOptions(inline); err != nil {
		t.Fatal("exact inline flags rejected", err)
	}
	cases := map[string][]string{
		"no-subcommand": f.args()[1:], "unknown": append(f.args(), "--source-grant", "true"),
		"extra-positional": append(f.args(), "activate"), "duplicate": append(f.args(), "--trust-context", f.contextPath),
		"missing-pair": f.args()[:len(f.args())-2], "missing-value": f.args()[:len(f.args())-1],
		"empty-inline": append(f.args()[:len(f.args())-2], "--output-dir="),
	}
	for name, index := range map[string]int{"context-pin": 4, "catalog-pin": 8} {
		args := f.args()
		args[index] = strings.Repeat("0", 64)
		cases[name] = args
	}
	for name, path := range map[string]string{"relative": "relative", "dot": f.output + "/../output", "control": f.output + "\n", "inside-source": filepath.Join(f.source, "new-output"), "same-source": f.source} {
		args := f.args()
		args[len(args)-1] = path
		cases[name] = args
	}
	for name, path := range map[string]string{"catalog-is-source": f.source, "catalog-inside-source": filepath.Join(f.source, "file-catalog.json")} {
		args := f.args()
		args[6] = path
		cases[name] = args
	}
	for name, args := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := parsePortableImportOptions(args); err == nil {
				t.Fatal("malformed or authority-changing options accepted")
			}
			status, result := portableTestResult(t, f, args)
			if status != 1 || result.Code != "INVALID_ARGUMENTS" {
				t.Fatal("malformed options reached import")
			}
			portableTestNoOutput(t, f.output)
		})
	}
	f.assertOriginals(t)
}

func TestPortableImportIndependentPinsAndContextMustAgree(t *testing.T) {
	for _, name := range []string{"context-pin", "catalog-pin", "catalog-context-pin", "catalog-context-bytes", "malformed-context", "duplicate-context", "runtime-hash-only", "runtime-file-only"} {
		t.Run(name, func(t *testing.T) {
			f := newPortableTestFixture(t, false)
			args := f.args()
			switch name {
			case "context-pin":
				args[4] = strings.Repeat("33", 32)
			case "catalog-pin":
				args[8] = strings.Repeat("33", 32)
			case "catalog-context-pin", "catalog-context-bytes":
				for i := range f.catalog.Files {
					if f.catalog.Files[i].Path == "context/trust-context.json" {
						if name == "catalog-context-pin" {
							f.catalog.Files[i].SHA256 = strings.Repeat("33", 32)
						} else {
							f.catalog.Files[i].Bytes = strconv.Itoa(len(f.contextRaw) - 1)
						}
					}
				}
				f.setCatalog(t, transactionJSON(t, f.catalog))
				args = f.args()
			case "malformed-context", "duplicate-context", "runtime-hash-only", "runtime-file-only":
				raw := bytes.Clone(f.contextRaw)
				switch name {
				case "malformed-context":
					raw = bytes.Replace(raw, []byte(`"trustLevelNumerator"`), []byte(`"TrustLevelNumerator"`), 1)
				case "duplicate-context":
					raw = bytes.Replace(raw, []byte(`"runtimePlanHash": ""`), []byte(`"runtimePlanHash":"","runtimePlanHash":""`), 1)
				case "runtime-hash-only":
					raw = bytes.Replace(raw, []byte(`"runtimePlanHash": ""`), []byte(`"runtimePlanHash":"`+strings.Repeat("33", 32)+`"`), 1)
				case "runtime-file-only":
					raw = bytes.Replace(raw, []byte(`"runtimePlanFile": ""`), []byte(`"runtimePlanFile":"/old/runtime.json"`), 1)
				}
				if bytes.Equal(raw, f.contextRaw) {
					t.Fatal("context negative did not mutate the fixture")
				}
				f.contextRaw = raw
				portableTestWrite(t, f.contextPath, raw)
				args = f.args()
			}
			status, _ := portableTestResult(t, f, args)
			if status != 1 {
				t.Fatal("independent pins or complete context schema were bypassed")
			}
			portableTestNoReceipt(t, f.output)
			if name != "catalog-context-bytes" {
				portableTestNoOutput(t, f.output)
			}
		})
	}
}

func TestPortableImportCatalogIsClosedTypedAndCanonical(t *testing.T) {
	mutations := map[string]func(*testing.T, *portableTestFixture) []byte{
		"unknown-field": func(t *testing.T, f *portableTestFixture) []byte {
			return append([]byte(`{"sourceGrant":true,`), f.catalogRaw[1:]...)
		},
		"duplicate-top": func(t *testing.T, f *portableTestFixture) []byte {
			return bytes.Replace(f.catalogRaw, []byte(`"files":`), []byte(`"files":[],"files":`), 1)
		},
		"null-files": func(t *testing.T, f *portableTestFixture) []byte {
			return []byte(`{"version":"YNX-CONSENSUS-PROOF-PORTABLE-FILES/v1","files":null}`)
		},
		"wrong-version": func(t *testing.T, f *portableTestFixture) []byte {
			f.catalog.Version = "YNX-SYNTHETIC-PQ-PUBLIC-HANDOFF/v1"
			return transactionJSON(t, f.catalog)
		},
		"missing-file": func(t *testing.T, f *portableTestFixture) []byte {
			f.catalog.Files = f.catalog.Files[:len(f.catalog.Files)-1]
			return transactionJSON(t, f.catalog)
		},
		"extra-file": func(t *testing.T, f *portableTestFixture) []byte {
			f.catalog.Files = append(f.catalog.Files, portableFileEntry{Path: "materials.json", Bytes: "1", SHA256: strings.Repeat("11", 32)})
			return transactionJSON(t, f.catalog)
		},
		"duplicate-path": func(t *testing.T, f *portableTestFixture) []byte {
			f.catalog.Files[1] = f.catalog.Files[0]
			return transactionJSON(t, f.catalog)
		},
		"unsorted": func(t *testing.T, f *portableTestFixture) []byte {
			f.catalog.Files[0], f.catalog.Files[1] = f.catalog.Files[1], f.catalog.Files[0]
			return transactionJSON(t, f.catalog)
		},
		"traversal": func(t *testing.T, f *portableTestFixture) []byte {
			f.catalog.Files[0].Path = "context/../outside.json"
			return transactionJSON(t, f.catalog)
		},
		"absolute-path": func(t *testing.T, f *portableTestFixture) []byte {
			f.catalog.Files[0].Path = "/context/PUBLIC-PROOF-INPUTS.json"
			return transactionJSON(t, f.catalog)
		},
		"aliased-case": func(t *testing.T, f *portableTestFixture) []byte {
			return bytes.Replace(f.catalogRaw, []byte(`"path":`), []byte(`"Path":`), 1)
		},
		"unknown-row-field": func(t *testing.T, f *portableTestFixture) []byte {
			return bytes.Replace(f.catalogRaw, []byte(`"path":`), []byte(`"approved":true,"path":`), 1)
		},
		"duplicate-row-field": func(t *testing.T, f *portableTestFixture) []byte {
			return bytes.Replace(f.catalogRaw, []byte(`"bytes":`), []byte(`"bytes":"1","bytes":`), 1)
		},
		"null-bytes": func(t *testing.T, f *portableTestFixture) []byte {
			return bytes.Replace(f.catalogRaw, []byte(`"bytes":"`+f.catalog.Files[0].Bytes+`"`), []byte(`"bytes":null`), 1)
		},
		"number-bytes": func(t *testing.T, f *portableTestFixture) []byte {
			return bytes.Replace(f.catalogRaw, []byte(`"bytes":"`+f.catalog.Files[0].Bytes+`"`), []byte(`"bytes":1`), 1)
		},
		"leading-zero": func(t *testing.T, f *portableTestFixture) []byte {
			f.catalog.Files[0].Bytes = "01"
			return transactionJSON(t, f.catalog)
		},
		"zero-bytes": func(t *testing.T, f *portableTestFixture) []byte {
			f.catalog.Files[0].Bytes = "0"
			return transactionJSON(t, f.catalog)
		},
		"per-file-bound": func(t *testing.T, f *portableTestFixture) []byte {
			f.catalog.Files[0].Bytes = "67108865"
			return transactionJSON(t, f.catalog)
		},
		"total-bound": func(t *testing.T, f *portableTestFixture) []byte {
			for i := range f.catalog.Files {
				f.catalog.Files[i].Bytes = "67108864"
			}
			return transactionJSON(t, f.catalog)
		},
		"uppercase-hash": func(t *testing.T, f *portableTestFixture) []byte {
			f.catalog.Files[0].SHA256 = strings.Repeat("AB", 32)
			return transactionJSON(t, f.catalog)
		},
		"zero-hash": func(t *testing.T, f *portableTestFixture) []byte {
			f.catalog.Files[0].SHA256 = strings.Repeat("00", 32)
			return transactionJSON(t, f.catalog)
		},
		"trailing-json": func(t *testing.T, f *portableTestFixture) []byte {
			return append(bytes.Clone(f.catalogRaw), []byte(`{}`)...)
		},
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			f := newPortableTestFixture(t, false)
			raw := mutate(t, f)
			if bytes.Equal(raw, f.catalogRaw) {
				t.Fatal("catalog negative did not mutate the fixture")
			}
			f.setCatalog(t, raw)
			if status, _ := portableTestResult(t, f, f.args()); status != 1 {
				t.Fatal("nonclosed or ambiguous catalog accepted")
			}
			portableTestNoOutput(t, f.output)
		})
	}
}

func TestPortableImportRuntimePlanRequiresExactlyOneAdditionalFile(t *testing.T) {
	for _, runtime := range []bool{false, true} {
		t.Run(strconv.FormatBool(runtime), func(t *testing.T) {
			f := newPortableTestFixture(t, runtime)
			if runtime {
				for i := range f.catalog.Files {
					if f.catalog.Files[i].Path == "context/runtime-plan.json" {
						f.catalog.Files = append(f.catalog.Files[:i], f.catalog.Files[i+1:]...)
						break
					}
				}
			} else {
				f.catalog.Files = append(f.catalog.Files, portableFileEntry{Path: "context/runtime-plan.json", Bytes: "1", SHA256: strings.Repeat("11", 32)})
				sort.Slice(f.catalog.Files, func(i, j int) bool { return f.catalog.Files[i].Path < f.catalog.Files[j].Path })
			}
			f.setCatalog(t, transactionJSON(t, f.catalog))
			if status, _ := portableTestResult(t, f, f.args()); status != 1 {
				t.Fatal("runtime plan file was inferred, omitted or accepted without a context binding")
			}
			portableTestNoOutput(t, f.output)
		})
	}
}

func TestPortableImportSourceLinksTamperingAndUnknownPathsReject(t *testing.T) {
	for _, name := range []string{"leaf-symlink", "parent-symlink", "hardlink", "changed-bytes", "missing-file", "extra-file", "extra-directory", "source-symlink"} {
		t.Run(name, func(t *testing.T) {
			f := newPortableTestFixture(t, false)
			path := filepath.Join(f.source, "context", "migration.json")
			switch name {
			case "leaf-symlink":
				target := filepath.Join(filepath.Dir(f.source), "public-target.json")
				portableTestWrite(t, target, f.originals["context/migration.json"])
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, path); err != nil {
					t.Fatal(err)
				}
			case "parent-symlink":
				target := filepath.Join(filepath.Dir(f.source), "original-context")
				if err := os.Rename(filepath.Join(f.source, "context"), target); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, filepath.Join(f.source, "context")); err != nil {
					t.Fatal(err)
				}
			case "hardlink":
				if err := os.Link(path, filepath.Join(filepath.Dir(f.source), "second-migration-link")); err != nil {
					t.Fatal(err)
				}
			case "changed-bytes":
				raw := bytes.Clone(f.originals["context/migration.json"])
				raw[0] ^= 1
				portableTestWrite(t, path, raw)
			case "missing-file":
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
			case "extra-file":
				portableTestWrite(t, filepath.Join(f.source, "context", "private-key.json"), []byte("no key is present\n"))
			case "extra-directory":
				if err := os.Mkdir(filepath.Join(f.source, "unexpected"), 0700); err != nil {
					t.Fatal(err)
				}
			case "source-symlink":
				alias := filepath.Join(filepath.Dir(f.source), "source-alias")
				if err := os.Symlink(f.source, alias); err != nil {
					t.Fatal(err)
				}
				f.source = alias
			}
			if status, _ := portableTestResult(t, f, f.args()); status != 1 {
				t.Fatal("linked, changed or unlisted original was imported")
			}
			portableTestNoReceipt(t, f.output)
		})
	}
}

func TestPortableImportLateRejectionPreservesPartialWithoutReplay(t *testing.T) {
	f := newPortableTestFixture(t, false)
	last := "original-results/functional-owner-4-original-sign.log"
	changed := bytes.Clone(f.originals[last])
	changed[0] ^= 1
	portableTestWrite(t, filepath.Join(f.source, filepath.FromSlash(last)), changed)
	if status, _ := portableTestResult(t, f, f.args()); status != 1 {
		t.Fatal("late changed original produced success")
	}
	portableTestNoReceipt(t, f.output)
	prefix := filepath.Join(f.output, "original/context/PUBLIC-PROOF-INPUTS.json")
	before, err := os.Stat(prefix)
	if err != nil {
		t.Fatal("late rejection erased the exact partial prefix", err)
	}
	raw, err := os.ReadFile(prefix)
	if err != nil || !bytes.Equal(raw, f.originals["context/PUBLIC-PROOF-INPUTS.json"]) {
		t.Fatal("late rejection changed the retained partial bytes", err)
	}
	if status, _ := portableTestResult(t, f, f.args()); status != 1 {
		t.Fatal("retained partial attempt was implicitly resumed")
	}
	after, err := os.Stat(prefix)
	if err != nil || !samePublicFile(before, after) {
		t.Fatal("second invocation replaced the retained partial", err)
	}
	portableTestNoReceipt(t, f.output)
}

func TestPortableImportNeverOverwritesExistingOrSymlinkedOutput(t *testing.T) {
	for _, name := range []string{"existing-dir", "existing-file", "output-symlink", "parent-symlink"} {
		t.Run(name, func(t *testing.T) {
			f := newPortableTestFixture(t, false)
			sentinel := []byte("previous UNKNOWN DATA attempt must remain\n")
			protected := f.output
			switch name {
			case "existing-dir":
				protected = filepath.Join(f.output, "UNKNOWN")
				portableTestWrite(t, protected, sentinel)
			case "existing-file":
				portableTestWrite(t, protected, sentinel)
			case "output-symlink":
				protected = filepath.Join(filepath.Dir(f.output), "existing-target")
				portableTestWrite(t, protected, sentinel)
				if err := os.Symlink(protected, f.output); err != nil {
					t.Fatal(err)
				}
			case "parent-symlink":
				parent := filepath.Join(filepath.Dir(f.output), "actual-output-parent")
				protected = filepath.Join(parent, "UNKNOWN")
				portableTestWrite(t, protected, sentinel)
				alias := filepath.Join(filepath.Dir(f.output), "output-parent-alias")
				if err := os.Symlink(parent, alias); err != nil {
					t.Fatal(err)
				}
				f.output = filepath.Join(alias, "new-output")
			}
			before, err := os.Lstat(protected)
			if err != nil {
				t.Fatal(err)
			}
			if status, _ := portableTestResult(t, f, f.args()); status != 1 {
				t.Fatal("prior output or symlinked parent was accepted")
			}
			after, err := os.Lstat(protected)
			raw, readErr := os.ReadFile(protected)
			if err != nil || readErr != nil || !samePublicFile(before, after) || !bytes.Equal(raw, sentinel) {
				t.Fatal("rejection changed an existing attempt", err, readErr)
			}
			f.assertOriginals(t)
		})
	}
}

func TestPortableImportReceiptMatchesDiskWithoutGrant(t *testing.T) {
	f := newPortableTestFixture(t, false)
	status, result := portableTestResult(t, f, f.args())
	if status != 0 {
		t.Fatal("DATA fixture import rejected")
	}
	raw, err := os.ReadFile(filepath.Join(f.output, "PUBLIC-PORTABLE-IMPORT.json"))
	if err != nil {
		t.Fatal(err)
	}
	var stored portableImportResult
	if err = json.Unmarshal(raw, &stored); err != nil || !reflect.DeepEqual(stored, result) {
		t.Fatal("stdout and durable DATA receipt disagree", err)
	}
	for _, file := range stored.Files {
		raw, err := os.ReadFile(filepath.Join(f.output, filepath.FromSlash(file.Path)))
		if err != nil || file.Bytes != strconv.Itoa(len(raw)) || file.SHA256 != portableTestHash(raw) {
			t.Fatal("receipt did not bind the actual public output", file.Path, err)
		}
	}
	// A second invocation is a new request, not approval to overwrite success.
	before, err := os.Stat(filepath.Join(f.output, "PUBLIC-PORTABLE-IMPORT.json"))
	if err != nil {
		t.Fatal(err)
	}
	if status, _ = portableTestResult(t, f, f.args()); status != 1 {
		t.Fatal("existing successful attempt was replayed")
	}
	after, err := os.Stat(filepath.Join(f.output, "PUBLIC-PORTABLE-IMPORT.json"))
	if err != nil || !samePublicFile(before, after) {
		t.Fatal("existing receipt was changed", err)
	}
}

type portableTestShortWriter struct{}

func (portableTestShortWriter) Write(raw []byte) (int, error) {
	if len(raw) == 0 {
		return 0, nil
	}
	return len(raw) - 1, nil
}

func TestPortableImportShortResultWriteCannotReportSuccess(t *testing.T) {
	f := newPortableTestFixture(t, false)
	if status := runPortableImport(f.args(), portableTestShortWriter{}); status != 1 {
		t.Fatal("short result write was reported as a successful invocation")
	}
	// The filesystem operation already completed. Retain its real receipt and
	// never infer that an output transport failure authorizes another import.
	before, err := os.Stat(filepath.Join(f.output, "PUBLIC-PORTABLE-IMPORT.json"))
	if err != nil {
		t.Fatal("output failure erased the completed DATA receipt", err)
	}
	if status, _ := portableTestResult(t, f, f.args()); status != 1 {
		t.Fatal("short output implicitly authorized replay")
	}
	after, err := os.Stat(filepath.Join(f.output, "PUBLIC-PORTABLE-IMPORT.json"))
	if err != nil || !samePublicFile(before, after) {
		t.Fatal("short output replay replaced prior DATA", err)
	}
}
