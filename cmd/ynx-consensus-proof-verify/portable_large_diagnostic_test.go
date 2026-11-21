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
	"strconv"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
)

func portableTestFileSHA(t *testing.T, path string) string {
	t.Helper()
	f, e := os.Open(path)
	if e != nil {
		t.Fatal(e)
	}
	defer f.Close()
	h := sha256.New()
	if _, e = io.Copy(h, f); e != nil {
		t.Fatal(e)
	}
	return hex.EncodeToString(h.Sum(nil))
}

func TestPortableImportLargeMigrationAndExactBound(t *testing.T) {
	f := newPortableTestFixture(t, false)
	path := filepath.Join(f.source, "context", "migration.json")
	file, e := os.OpenFile(path, os.O_WRONLY|os.O_TRUNC, 0600)
	if e != nil {
		t.Fatal(e)
	}
	const size int64 = 70298614
	if e = file.Truncate(size); e != nil {
		t.Fatal(e)
	}
	if e = file.Close(); e != nil {
		t.Fatal(e)
	}
	sha := portableTestFileSHA(t, path)
	for i := range f.catalog.Files {
		if f.catalog.Files[i].Path == "context/migration.json" {
			f.catalog.Files[i].Bytes = strconv.FormatInt(size, 10)
			f.catalog.Files[i].SHA256 = sha
		}
	}
	f.setCatalog(t, transactionJSON(t, f.catalog))
	status, result := portableTestResult(t, f, f.args())
	if status != 0 || result.Code != "IMPORTED_DATA" {
		t.Fatalf("large DATA import failed: %d %+v", status, result)
	}
	copyPath := filepath.Join(f.output, "original", "context", "migration.json")
	info, e := os.Stat(copyPath)
	if e != nil || info.Size() != size || portableTestFileSHA(t, copyPath) != sha || portableTestFileSHA(t, path) != sha {
		t.Fatal("large exact bytes did not survive", e)
	}
	if result.ProofVerified || result.SourceGrant || result.NativeRootAuthorized || result.SourceDeploymentQualified {
		t.Fatal("DATA import gained authority")
	}
	for _, change := range []struct {
		path string
		size int64
	}{{"context/migration.json", maxPortableMigrationBytes + 1}, {"context/genesis.json", maxPortableFileBytes + 1}} {
		bad := f.catalog
		bad.Files = append([]portableFileEntry(nil), f.catalog.Files...)
		for i := range bad.Files {
			if bad.Files[i].Path == change.path {
				bad.Files[i].Bytes = strconv.FormatInt(change.size, 10)
			}
		}
		if _, e = decodePortableCatalog(transactionJSON(t, bad), false); e == nil {
			t.Fatal("oversized file accepted", change.path)
		}
	}
	exact := f.catalog
	exact.Files = append([]portableFileEntry(nil), f.catalog.Files...)
	for i := range exact.Files {
		if exact.Files[i].Path == "context/migration.json" {
			exact.Files[i].Bytes = strconv.Itoa(maxPortableMigrationBytes)
		}
	}
	if _, e = decodePortableCatalog(transactionJSON(t, exact), false); e != nil {
		t.Fatal("exact migration catalog bound refused", e)
	}
	other := f.catalog
	other.Files = append([]portableFileEntry(nil), f.catalog.Files...)
	count := 0
	for i := range other.Files {
		if other.Files[i].Path != "context/migration.json" && count < 4 {
			other.Files[i].Bytes = strconv.Itoa(maxPortableFileBytes)
			count++
		}
	}
	if _, e = decodePortableCatalog(transactionJSON(t, other), false); e == nil {
		t.Fatal("other files exceeded their combined 256MiB bound")
	}
}

func TestPortableImportMigrationMismatchPreservesPartialWithoutReceipt(t *testing.T) {
	f := newPortableTestFixture(t, false)
	for i := range f.catalog.Files {
		if f.catalog.Files[i].Path == "context/migration.json" {
			f.catalog.Files[i].SHA256 = strings.Repeat("0", 64)
		}
	}
	f.setCatalog(t, transactionJSON(t, f.catalog))
	status, _ := portableTestResult(t, f, f.args())
	if status == 0 {
		t.Fatal("mismatched migration accepted")
	}
	portableTestNoReceipt(t, f.output)
	f.assertOriginals(t)
}

func TestPortableImportMigrationOriginalReplacementFailsClosed(t *testing.T) {
	f := newPortableTestFixture(t, false)
	hooks := &portableImportHooks{migrationAfterCopy: func(path string) error {
		original, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if err = os.Rename(path, path+".original"); err != nil {
			return err
		}
		return os.WriteFile(path, original, 0600)
	}}
	var output bytes.Buffer
	if runPortableImportWithHooks(f.args(), &output, hooks) == 0 {
		t.Fatal("same-byte source inode replacement accepted")
	}
	var result portableImportResult
	if json.Unmarshal(output.Bytes(), &result) != nil || result.Code != "IMPORT_UNKNOWN" || result.ProofVerified || result.SourceGrant {
		t.Fatal("original replacement lost UNKNOWN", output.String())
	}
	portableTestNoReceipt(t, f.output)
	path := filepath.Join(f.source, "context", "migration.json")
	before, err := os.ReadFile(path + ".original")
	if err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("fixture replacement changed data", err)
	}
}

type portableENOSPCWriter struct {
	writer    io.Writer
	remaining int
}

func (w *portableENOSPCWriter) Write(p []byte) (int, error) {
	if w.remaining <= 0 {
		return 0, unix.ENOSPC
	}
	limit := len(p)
	if limit > w.remaining {
		limit = w.remaining
	}
	n, err := w.writer.Write(p[:limit])
	w.remaining -= n
	if err == nil && n < len(p) {
		err = unix.ENOSPC
	}
	return n, err
}

func TestPortableActualWriteAndCloseFailuresPreserveOriginals(t *testing.T) {
	for _, mode := range []string{"source-before", "source-after", "migration-source", "migration-dest", "write-enospc", "output-close", "parent-close"} {
		t.Run(mode, func(t *testing.T) {
			f := newPortableTestFixture(t, false)
			hooks := new(portableImportHooks)
			wantCause := os.ErrClosed
			switch mode {
			case "source-before", "source-after":
				wantPath := f.contextPath
				if mode == "source-after" {
					wantPath = filepath.Join(f.source, "context", "genesis.json")
				}
				hooks.sourceClose = func(path string, file *os.File) error {
					if path == wantPath {
						if e := file.Close(); e != nil {
							return e
						}
					}
					return file.Close()
				}
			case "migration-source":
				hooks.migrationSourceBeforeClose = func(file *os.File) error { return file.Close() }
			case "migration-dest":
				hooks.migrationDestBeforeClose = func(file *os.File) error { return file.Close() }
			case "write-enospc":
				wantCause = unix.ENOSPC
				hooks.migrationWriter = func(w io.Writer) io.Writer { return &portableENOSPCWriter{writer: w, remaining: 4} }
			case "output-close":
				hooks.outputClose = func(p *portableOutput) error {
					if e := p.dirs["original/context"].Close(); e != nil {
						return e
					}
					return p.close()
				}
			case "parent-close":
				hooks.parentBeforeClose = func(file *os.File) error { return file.Close() }
			}
			var output bytes.Buffer
			if runPortableImportWithHooks(f.args(), &output, hooks) == 0 {
				t.Fatal("I/O failure returned success")
			}
			var result portableImportResult
			wantCode := "IMPORT_UNKNOWN"
			if mode == "source-before" {
				wantCode = "IMPORT_REJECTED"
			}
			if json.Unmarshal(output.Bytes(), &result) != nil || result.Code != wantCode || !strings.Contains(result.Error, wantCause.Error()) || result.ProofVerified || result.SourceGrant || result.NativeRootAuthorized || result.SourceDeploymentQualified {
				t.Fatal("actual close/write failure lost cause or gained authority", output.String())
			}
			f.assertOriginals(t)
			if mode == "source-before" {
				portableTestNoOutput(t, f.output)
			} else if mode == "parent-close" || mode == "output-close" {
				if _, e := os.Stat(filepath.Join(f.output, "PUBLIC-PORTABLE-IMPORT.json")); e != nil {
					t.Fatal("visible completed-copy receipt unexpectedly removed", e)
				}
			} else {
				portableTestNoReceipt(t, f.output)
			}
			if mode == "write-enospc" {
				p := filepath.Join(f.output, "original/context/migration.json")
				info, e := os.Stat(p)
				if e != nil || info.Size() != 4 {
					t.Fatal("partial original write was removed or altered", e)
				}
			}
		})
	}
}

func TestPortableSpacePreflightAndDurabilityFailuresAreNotSuccess(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	var real unix.Statfs_t
	if err = unix.Statfs(root, &real); err != nil {
		t.Fatal(err)
	}
	free := uint64(real.Bavail) * uint64(real.Bsize)
	if free < ^uint64(0)-uint64(real.Bsize) && checkPortableSpace(root, free+uint64(real.Bsize)) == nil {
		t.Fatal("actual filesystem insufficient capacity was accepted")
	}
	if portableSpaceEnough(0, 4096, 1) || !portableSpaceEnough(1, 4096, 4096) || portableSpaceEnough(1, 4096, 4097) || portableSpaceEnough(1, 0, 1) {
		t.Fatal("space arithmetic differs")
	}
	for _, mode := range []string{"space", "output-sync", "output-close", "parent-sync"} {
		t.Run(mode, func(t *testing.T) {
			f := newPortableTestFixture(t, false)
			cause := errors.New("injected " + mode + " failure")
			hooks := new(portableImportHooks)
			switch mode {
			case "space":
				hooks.spaceCheck = func(_ string, required uint64) error {
					if required < portableFreeFloorBytes+portableRootReserveBytes+portableMetadataAllowance {
						return errors.New("portable reserve omitted")
					}
					return cause
				}
			case "output-sync":
				hooks.outputSync = func(*portableOutput) error { return cause }
			case "output-close":
				hooks.outputClose = func(p *portableOutput) error {
					if e := p.dirs["original/context"].Close(); e != nil {
						return e
					}
					return errors.Join(cause, p.close())
				}
			case "parent-sync":
				hooks.parentSync = func(*os.File) error { return cause }
			}
			var output bytes.Buffer
			if runPortableImportWithHooks(f.args(), &output, hooks) == 0 {
				t.Fatal("failure reported success")
			}
			var result portableImportResult
			wantCode := "IMPORT_UNKNOWN"
			if mode == "space" {
				wantCode = "IMPORT_REJECTED"
			}
			if json.Unmarshal(output.Bytes(), &result) != nil || result.Code != wantCode || !strings.Contains(result.Error, cause.Error()) || result.ProofVerified || result.SourceGrant || result.NativeRootAuthorized || result.SourceDeploymentQualified {
				t.Fatal("failure lost original cause or gained authority", output.String())
			}
			f.assertOriginals(t)
			if mode == "space" {
				portableTestNoOutput(t, f.output)
			} else {
				// Old receipt is visible after all copies even when a later sync
				// fails. Only the process outcome is authoritative for this attempt.
				if _, err := os.Stat(filepath.Join(f.output, "PUBLIC-PORTABLE-IMPORT.json")); err != nil {
					t.Fatal("failed attempt unexpectedly discarded its original", err)
				}
				var second bytes.Buffer
				if runPortableImport(f.args(), &second) == 0 {
					t.Fatal("failed attempt implicitly retried")
				}
			}
		})
	}
}

func portableDiagnosticArgs(f *portableTestFixture) []string {
	return []string{"portable-diagnose", "--file-catalog", f.catalogPath, "--file-catalog-sha256", portableTestHash(f.catalogRaw), "--source-dir", f.source}
}

func TestPortableDiagnoseReportsMissingWithoutAuthority(t *testing.T) {
	for _, partial := range []bool{false, true} {
		t.Run(strconv.FormatBool(partial), func(t *testing.T) {
			f := newPortableTestFixture(t, false)
			f.catalog.Version = portableDiagnosticCatalogVersion
			if partial {
				keep := f.catalog.Files[:0]
				for _, row := range f.catalog.Files {
					if strings.HasPrefix(row.Path, "original-results/") {
						if e := os.Remove(filepath.Join(f.source, filepath.FromSlash(row.Path))); e != nil {
							t.Fatal(e)
						}
					} else {
						keep = append(keep, row)
					}
				}
				f.catalog.Files = keep
			}
			f.setCatalog(t, transactionJSON(t, f.catalog))
			var output bytes.Buffer
			if status := runPortableDiagnose(portableDiagnosticArgs(f), &output); status != 0 {
				t.Fatal("diagnostic refused", output.String())
			}
			var r portableDiagnosticResult
			if e := json.Unmarshal(output.Bytes(), &r); e != nil {
				t.Fatal(e)
			}
			if r.ProofVerified || r.NativeRootAuthorized || r.SourceDeploymentQualified || r.CurrentEligibility != "UNKNOWN" || r.Scope != "selected-public-source-only" || r.RuntimePlanStatus != "NOT_EVALUATED" {
				t.Fatal("diagnostic gained authority", r)
			}
			if partial && (r.Code != "INCOMPLETE_PUBLIC_DATA" || len(r.Missing) != 6) || !partial && (r.Code != "PRESENT_UNVERIFIED_DATA" || len(r.Missing) != 0) {
				t.Fatal("wrong DATA classification", r)
			}
			if _, e := os.Lstat(f.output); !os.IsNotExist(e) {
				t.Fatal("diagnostic created import output", e)
			}
			wrong := portableDiagnosticArgs(f)
			wrong[4] = strings.Repeat("1", 64)
			output.Reset()
			if runPortableDiagnose(wrong, &output) == 0 {
				t.Fatal("bad catalog pin accepted")
			}
			if json.Unmarshal(output.Bytes(), &r) != nil || r.Code != "DIAGNOSTIC_REJECTED" || r.FailureStage != "catalog-pin" || r.ProofVerified {
				t.Fatal("bad pin lost diagnostic failure stage", output.String())
			}
		})
	}
}
