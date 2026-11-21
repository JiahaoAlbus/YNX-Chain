//go:build unix

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/sys/unix"
)

const portableDiagnosticCatalogVersion = "YNX-CONSENSUS-PROOF-DIAGNOSTIC-CATALOG/v1"

type portableDiagnosticResult struct {
	Version                   string   `json:"version"`
	Code                      string   `json:"code"`
	Classification            string   `json:"classification"`
	Scope                     string   `json:"scope"`
	CatalogSHA256             string   `json:"catalogSHA256"`
	Missing                   []string `json:"missing"`
	RuntimePlanStatus         string   `json:"runtimePlanStatus"`
	ProofVerified             bool     `json:"proofVerified"`
	NativeRootAuthorized      bool     `json:"nativeRootAuthorized"`
	SourceDeploymentQualified bool     `json:"sourceDeploymentQualified"`
	CurrentEligibility        string   `json:"currentEligibility"`
	FailureStage              string   `json:"failureStage,omitempty"`
	FailurePath               string   `json:"failurePath,omitempty"`
}

// A diagnostic catalog names only supplied public files. Missing legacy carrier
// entries are reported explicitly; this never manufactures an original result,
// changes source, creates an import, verifies a proof or decides current trust.
func decodePortableDiagnosticCatalog(raw []byte) (portableFileCatalog, []string, error) {
	var catalog portableFileCatalog
	fields, err := strictTransactionObject(raw, &catalog)
	if err != nil || catalog.Version != portableDiagnosticCatalogVersion || len(bytes.TrimSpace(fields["files"])) == 0 || bytes.TrimSpace(fields["files"])[0] != '[' {
		return catalog, nil, errors.New("closed diagnostic catalog required")
	}
	allowed := make(map[string]bool, len(portableOriginalPaths)+1)
	for _, name := range portableOriginalPaths {
		allowed[name] = true
	}
	allowed["context/runtime-plan.json"] = true
	if len(catalog.Files) > len(allowed) {
		return catalog, nil, errors.New("diagnostic catalog exceeds closed path set")
	}
	var rows []json.RawMessage
	if err = json.Unmarshal(fields["files"], &rows); err != nil {
		return catalog, nil, err
	}
	var total, other uint64
	seen := make(map[string]bool, len(rows))
	previous := ""
	for i, row := range catalog.Files {
		if err = strictStringObject(rows[i], &catalog.Files[i]); err != nil {
			return catalog, nil, err
		}
		if !allowed[row.Path] || (previous != "" && row.Path <= previous) {
			return catalog, nil, errors.New("diagnostic paths must be unique, sorted and public")
		}
		limit := uint64(maxPortableFileBytes)
		if row.Path == "context/migration.json" {
			limit = maxPortableMigrationBytes
		}
		n, e := decimal(row.Bytes, limit, true)
		if e != nil {
			return catalog, nil, e
		}
		total += n
		if row.Path != "context/migration.json" {
			other += n
		}
		if total > maxPortableTotalBytes || other > maxPortableOtherBytes {
			return catalog, nil, errors.New("diagnostic DATA total exceeds bound")
		}
		if _, e = hash32(row.SHA256); e != nil {
			return catalog, nil, e
		}
		seen[row.Path] = true
		previous = row.Path
	}
	missing := make([]string, 0)
	for _, name := range portableOriginalPaths {
		if !seen[name] {
			missing = append(missing, name)
		}
	}
	sort.Strings(missing)
	return catalog, missing, nil
}

func checkPortableDiagnosticFile(path string, row portableFileEntry) (result error) {
	bound, e := decimal(row.Bytes, maxPortableMigrationBytes, true)
	if e != nil {
		return e
	}
	f, before, e := openPublicFile(path, int64(bound))
	if e != nil {
		return e
	}
	defer func() { result = errors.Join(result, f.Close()) }()
	var original, current unix.Stat_t
	if before.Size() != int64(bound) || unix.Fstat(int(f.Fd()), &original) != nil || original.Nlink != 1 {
		return errors.New("diagnostic source identity or length differs")
	}
	h := sha256.New()
	n, e := io.CopyBuffer(h, io.LimitReader(f, int64(bound)+1), make([]byte, 128<<10))
	if e != nil {
		return e
	}
	if n != int64(bound) || hex.EncodeToString(h.Sum(nil)) != row.SHA256 {
		return errors.New("diagnostic public bytes or hash did not validate")
	}
	if e = checkPublicFile(f, path, before); e != nil {
		return e
	}
	if e = unix.Lstat(path, &current); e != nil || current.Nlink != 1 || current.Dev != original.Dev || current.Ino != original.Ino {
		return errors.New("diagnostic source identity changed")
	}
	return nil
}

func runPortableDiagnose(args []string, output io.Writer) int {
	fail := func(stage, path string) int {
		_ = json.NewEncoder(output).Encode(portableDiagnosticResult{Version: "YNX-CONSENSUS-PROOF-PORTABLE-DIAGNOSIS/v1", Code: "DIAGNOSTIC_REJECTED", Classification: "data", Scope: "selected-public-source-only", Missing: []string{}, RuntimePlanStatus: "NOT_EVALUATED", CurrentEligibility: "UNKNOWN", FailureStage: stage, FailurePath: path})
		return 1
	}
	if len(args) != 7 || args[0] != "portable-diagnose" {
		return fail("arguments", "")
	}
	seen := map[string]bool{}
	allowed := map[string]bool{"--file-catalog": true, "--file-catalog-sha256": true, "--source-dir": true}
	for i := 1; i < len(args); i += 2 {
		if !allowed[args[i]] || seen[args[i]] || strings.HasPrefix(args[i+1], "--") {
			return fail("arguments", "")
		}
		seen[args[i]] = true
	}
	f := flag.NewFlagSet("portable-diagnose", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	catalogPath := f.String("file-catalog", "", "independently pinned diagnostic public catalog")
	pin := f.String("file-catalog-sha256", "", "exact independent catalog hash")
	source := f.String("source-dir", "", "original public files")
	if f.Parse(args[1:]) != nil || f.NArg() != 0 || !portableAbsolutePath(*catalogPath) || !portableAbsolutePath(*source) {
		return fail("arguments", "")
	}
	if *catalogPath == *source || strings.HasPrefix(*catalogPath, *source+string(os.PathSeparator)) {
		return fail("arguments", "")
	}
	if _, e := hash32(*pin); e != nil {
		return fail("arguments", "")
	}
	identity, e := portableDirectory(*source)
	if e != nil {
		return fail("source-directory", "")
	}
	raw, e := portableReadPublicFile(*catalogPath, 32<<10, nil)
	if e != nil || !matchesSHA256(raw, *pin) {
		return fail("catalog-pin", "")
	}
	catalog, missing, e := decodePortableDiagnosticCatalog(raw)
	if e != nil {
		return fail("catalog-schema", "")
	}
	if portableSourceTree(*source, catalog) != nil {
		return fail("source-tree", "")
	}
	for _, row := range catalog.Files {
		if checkPortableDiagnosticFile(filepath.Join(*source, filepath.FromSlash(row.Path)), row) != nil {
			return fail("original-file", row.Path)
		}
	}
	current, e := portableDirectory(*source)
	if e != nil || !os.SameFile(identity, current) || portableSourceTree(*source, catalog) != nil {
		return fail("source-recheck", "")
	}
	again, e := portableReadPublicFile(*catalogPath, 32<<10, nil)
	if e != nil || !bytes.Equal(raw, again) {
		return fail("catalog-recheck", "")
	}
	code := "INCOMPLETE_PUBLIC_DATA"
	if len(missing) == 0 {
		code = "PRESENT_UNVERIFIED_DATA"
	}
	result := portableDiagnosticResult{Version: "YNX-CONSENSUS-PROOF-PORTABLE-DIAGNOSIS/v1", Code: code, Classification: "data", Scope: "selected-public-source-only", CatalogSHA256: *pin, Missing: missing, RuntimePlanStatus: "NOT_EVALUATED", CurrentEligibility: "UNKNOWN"}
	if json.NewEncoder(output).Encode(result) != nil {
		return 1
	}
	return 0
}
