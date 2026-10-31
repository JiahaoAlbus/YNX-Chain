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
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/sys/unix"
)

const (
	portableCatalogVersion = "YNX-CONSENSUS-PROOF-PORTABLE-FILES/v1"
	portableResultVersion  = "YNX-CONSENSUS-PROOF-PORTABLE-IMPORT/v1"
	// DATA transport limits; these do not change any transaction, proof or
	// normal verifier admission rule. Originals exceeding them are not imported.
	maxPortableFileBytes  = 64 << 20
	maxPortableTotalBytes = 256 << 20
)

var portableOriginalPaths = []string{
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

type portableImportOptions struct {
	contextPath, contextSHA256, catalogPath, catalogSHA256, sourceDir, outputDir string
}

type portableFileEntry struct {
	Path   string `json:"path"`
	Bytes  string `json:"bytes"`
	SHA256 string `json:"sha256"`
}

type portableFileCatalog struct {
	Version string              `json:"version"`
	Files   []portableFileEntry `json:"files"`
}

// No field in a DATA import attests Source/current, grants a native root or
// verifies a proof. The new exact-byte context pin must be independently passed
// to the unchanged normal verifier, which uses its own current clock.
type portableImportResult struct {
	Version                   string              `json:"version"`
	Code                      string              `json:"code"`
	Error                     string              `json:"error,omitempty"`
	Classification            string              `json:"classification"`
	OriginalContextSHA256     string              `json:"originalContextSHA256"`
	CatalogSHA256             string              `json:"catalogSHA256"`
	ContextPath               string              `json:"contextPath"`
	ContextSHA256             string              `json:"contextSHA256"`
	Files                     []portableFileEntry `json:"files"`
	SourceGrant               bool                `json:"sourceGrant"`
	NativeRootAuthorized      bool                `json:"nativeRootAuthorized"`
	SourceDeploymentQualified bool                `json:"sourceDeploymentQualified"`
	ProofVerified             bool                `json:"proofVerified"`
}

func isPortableImportInvocation(args []string) bool {
	return len(args) != 0 && args[0] == "portable-import"
}

func portableAbsolutePath(path string) bool {
	if !canonicalAbsolutePath(path) || !utf8.ValidString(path) {
		return false
	}
	for _, r := range path {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

func parsePortableImportOptions(args []string) (portableImportOptions, error) {
	var o portableImportOptions
	if !isPortableImportInvocation(args) {
		return o, errors.New("portable-import subcommand required")
	}
	seen := make(map[string]bool)
	allowed := map[string]bool{"--trust-context": true, "--trust-context-sha256": true, "--file-catalog": true, "--file-catalog-sha256": true, "--source-dir": true, "--output-dir": true}
	for i := 1; i < len(args); i++ {
		name, value, inline := strings.Cut(args[i], "=")
		if !allowed[name] || seen[name] {
			return o, errors.New("exact portable-import flags required")
		}
		seen[name] = true
		if inline {
			if value == "" {
				return o, errors.New("missing flag value")
			}
		} else {
			i++
			if i == len(args) || strings.HasPrefix(args[i], "--") {
				return o, errors.New("missing flag value")
			}
		}
	}
	f := flag.NewFlagSet("portable-import", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	f.StringVar(&o.contextPath, "trust-context", "", "original independently pinned transaction context")
	f.StringVar(&o.contextSHA256, "trust-context-sha256", "", "external original context SHA256")
	f.StringVar(&o.catalogPath, "file-catalog", "", "independent closed public file catalog")
	f.StringVar(&o.catalogSHA256, "file-catalog-sha256", "", "external exact catalog SHA256")
	f.StringVar(&o.sourceDir, "source-dir", "", "canonical public originals directory")
	f.StringVar(&o.outputDir, "output-dir", "", "new exclusive portable DATA directory")
	if err := f.Parse(args[1:]); err != nil {
		return o, err
	}
	if len(seen) != 6 || f.NArg() != 0 {
		return o, errors.New("all six independent flags required")
	}
	for _, p := range []string{o.contextPath, o.catalogPath, o.sourceDir, o.outputDir} {
		if !portableAbsolutePath(p) {
			return o, errors.New("canonical absolute paths required")
		}
	}
	for _, p := range []string{o.contextSHA256, o.catalogSHA256} {
		if _, err := hash32(p); err != nil {
			return o, err
		}
	}
	if o.sourceDir == o.outputDir || strings.HasPrefix(o.outputDir, o.sourceDir+string(os.PathSeparator)) {
		return o, errors.New("output may not alter the source tree")
	}
	if o.catalogPath == o.sourceDir || strings.HasPrefix(o.catalogPath, o.sourceDir+string(os.PathSeparator)) {
		return o, errors.New("independent file catalog must be outside the source directory")
	}
	return o, nil
}

func portableDirectory(path string) (os.FileInfo, error) {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved != path {
		return nil, errors.New("directory may not traverse symlinks")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() {
		return nil, errors.New("existing canonical directory required")
	}
	return info, nil
}

func decodePortableCatalog(raw []byte, runtime bool) (portableFileCatalog, error) {
	var c portableFileCatalog
	fields, err := strictTransactionObject(raw, &c)
	if err != nil || c.Version != portableCatalogVersion || len(bytes.TrimSpace(fields["files"])) == 0 || bytes.TrimSpace(fields["files"])[0] != '[' {
		return c, errors.New("closed portable DATA catalog required")
	}
	want := append([]string(nil), portableOriginalPaths...)
	if runtime {
		want = append(want, "context/runtime-plan.json")
	}
	sort.Strings(want)
	if len(c.Files) != len(want) {
		return c, errors.New("catalog must contain exactly the original public payload")
	}
	var rows []json.RawMessage
	if err = json.Unmarshal(fields["files"], &rows); err != nil {
		return c, err
	}
	var total uint64
	for i, row := range c.Files {
		if err = strictStringObject(rows[i], &c.Files[i]); err != nil {
			return c, err
		}
		if row.Path != want[i] {
			return c, errors.New("catalog paths must be the closed sorted public set")
		}
		n, e := decimal(row.Bytes, maxPortableFileBytes, true)
		if e != nil {
			return c, e
		}
		total += n
		if total > maxPortableTotalBytes {
			return c, errors.New("portable DATA total exceeds bound")
		}
		if _, err = hash32(row.SHA256); err != nil {
			return c, err
		}
	}
	return c, nil
}

func portableDigest(raw []byte) string { h := sha256.Sum256(raw); return hex.EncodeToString(h[:]) }

func portableSourceTree(root string, catalog portableFileCatalog) error {
	allowed := make(map[string]bool, len(catalog.Files))
	for _, row := range catalog.Files {
		allowed[row.Path] = true
	}
	return filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if rel == "." || rel == "context" || rel == "original-results" {
			if !entry.IsDir() {
				return errors.New("closed source directories required")
			}
			return nil
		}
		// The original carrier MANIFEST is not an authority input, is not
		// parsed, and is never imported. Its public payload is pinned only by
		// the independently supplied strict catalog.
		if rel == "MANIFEST.json" && !entry.IsDir() && entry.Type().IsRegular() {
			return nil
		}
		if !allowed[rel] || entry.IsDir() || !entry.Type().IsRegular() {
			return errors.New("unexpected or linked public source path")
		}
		return nil
	})
}

// Patch only the exact JSON value tokens belonging to the five source paths
// (and optional original runtime plan). All other original context bytes,
// including expectedTransaction, hashes, durations and whitespace, survive.
func portableContextPaths(raw []byte, paths map[string]string) ([]byte, error) {
	type patch struct {
		start, end int
		value      []byte
	}
	var patches []patch
	valueStart := func(b []byte, n int) (int, error) {
		for n < len(b) && (b[n] == ' ' || b[n] == '\n' || b[n] == '\r' || b[n] == '\t') {
			n++
		}
		if n == len(b) || b[n] != ':' {
			return 0, errors.New("invalid context field boundary")
		}
		n++
		for n < len(b) && (b[n] == ' ' || b[n] == '\n' || b[n] == '\r' || b[n] == '\t') {
			n++
		}
		return n, nil
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	if _, err := d.Token(); err != nil {
		return nil, err
	}
	for d.More() {
		key, err := d.Token()
		if err != nil {
			return nil, err
		}
		start, err := valueStart(raw, int(d.InputOffset()))
		if err != nil {
			return nil, err
		}
		var v json.RawMessage
		if err = d.Decode(&v); err != nil {
			return nil, err
		}
		if key != "lightTrust" {
			continue
		}
		v = raw[start:int(d.InputOffset())]
		inner := json.NewDecoder(bytes.NewReader(v))
		if _, err = inner.Token(); err != nil {
			return nil, err
		}
		for inner.More() {
			k, e := inner.Token()
			if e != nil {
				return nil, e
			}
			field, ok := k.(string)
			if !ok {
				return nil, errors.New("invalid context path key")
			}
			pos, e := valueStart(v, int(inner.InputOffset()))
			if e != nil {
				return nil, e
			}
			var old json.RawMessage
			if e = inner.Decode(&old); e != nil {
				return nil, e
			}
			if path, ok := paths[field]; ok {
				replacement, e := json.Marshal(path)
				if e != nil {
					return nil, e
				}
				patches = append(patches, patch{start + pos, start + int(inner.InputOffset()), replacement})
			}
		}
	}
	if len(patches) != len(paths) {
		return nil, errors.New("incomplete original path projection")
	}
	sort.Slice(patches, func(i, j int) bool { return patches[i].start > patches[j].start })
	out := bytes.Clone(raw)
	for _, p := range patches {
		out = append(append(append([]byte(nil), out[:p.start]...), p.value...), out[p.end:]...)
	}
	return out, nil
}

// Exclusive directory-relative writes prevent link following and replacement
// of any prior attempt. Failures retain the original partial directory; there
// is no remove, resume, source mutation or implicit verification path here.
type portableOutput struct{ dirs map[string]*os.File }

func newPortableOutput(path string) (*portableOutput, error) {
	parent, err := portableDirectory(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	if err = os.Mkdir(path, 0700); err != nil {
		return nil, err
	}
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	root := os.NewFile(uintptr(fd), "portable-data-output")
	current, e := os.Lstat(path)
	opened, e2 := root.Stat()
	parentNow, e3 := os.Lstat(filepath.Dir(path))
	if e != nil || e2 != nil || e3 != nil || !os.SameFile(opened, current) || !os.SameFile(parent, parentNow) {
		root.Close()
		return nil, errors.New("output directory identity changed")
	}
	p := &portableOutput{dirs: map[string]*os.File{"": root}}
	for _, n := range []string{"original", "original/context", "original/original-results"} {
		base := filepath.Dir(n)
		if base == "." {
			base = ""
		}
		f := p.dirs[base]
		if err = unix.Mkdirat(int(f.Fd()), filepath.Base(n), 0700); err != nil {
			p.close()
			return nil, err
		}
		child, e := unix.Openat(int(f.Fd()), filepath.Base(n), unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		if e != nil {
			p.close()
			return nil, e
		}
		p.dirs[n] = os.NewFile(uintptr(child), "portable-data-directory")
	}
	return p, nil
}

func (p *portableOutput) close() {
	for _, f := range p.dirs {
		_ = f.Close()
	}
}
func (p *portableOutput) write(name string, raw []byte) error {
	base := filepath.Dir(name)
	if base == "." {
		base = ""
	}
	dir := p.dirs[base]
	if dir == nil {
		return errors.New("closed portable output path required")
	}
	fd, err := unix.Openat(int(dir.Fd()), filepath.Base(name), unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return err
	}
	f := os.NewFile(uintptr(fd), "portable-public-data")
	n, err := f.Write(raw)
	if err == nil && n != len(raw) {
		err = io.ErrShortWrite
	}
	if err == nil {
		err = f.Sync()
	}
	closed := f.Close()
	if err == nil {
		err = closed
	}
	return err
}
func (p *portableOutput) sync() error {
	for _, n := range []string{"original/context", "original/original-results", "original", ""} {
		if err := p.dirs[n].Sync(); err != nil {
			return err
		}
	}
	return nil
}

func (p *portableOutput) current(path string) error {
	for name, f := range p.dirs {
		original, err := f.Stat()
		if err != nil {
			return err
		}
		now, err := portableDirectory(filepath.Join(path, name))
		if err != nil || !os.SameFile(original, now) {
			return errors.New("portable output directory identity changed")
		}
	}
	return nil
}

func importPortableData(o portableImportOptions) (portableImportResult, error) {
	r := portableImportResult{Version: portableResultVersion, Code: "IMPORTED_DATA", Classification: "data", OriginalContextSHA256: o.contextSHA256, CatalogSHA256: o.catalogSHA256}
	sourceIdentity, err := portableDirectory(o.sourceDir)
	if err != nil {
		return r, err
	}
	contextRaw, err := readPublicFile(o.contextPath, maxTransactionContextBytes)
	if err != nil {
		return r, err
	}
	c, _, err := decodeTransactionTrustContext(contextRaw, o.contextSHA256)
	if err != nil {
		return r, err
	}
	catalogRaw, err := readPublicFile(o.catalogPath, 32<<10)
	if err != nil || !matchesSHA256(catalogRaw, o.catalogSHA256) {
		return r, errors.New("independent portable catalog pin did not validate")
	}
	catalog, err := decodePortableCatalog(catalogRaw, c.LightTrust.RuntimePlanFile != "")
	if err != nil {
		return r, err
	}
	for _, row := range catalog.Files {
		if row.Path == "context/trust-context.json" && row.SHA256 != o.contextSHA256 {
			return r, errors.New("catalog and independent context disagree")
		}
	}
	if err = portableSourceTree(o.sourceDir, catalog); err != nil {
		return r, err
	}
	paths := map[string]string{"migrationFile": "context/migration.json", "genesisFile": "context/genesis.json", "stateFile": "context/committed-state.json", "scheduleFile": "context/schedule.json", "trustedLightBlockFile": "context/trusted-light-block.json"}
	if c.LightTrust.RuntimePlanFile != "" {
		paths["runtimePlanFile"] = "context/runtime-plan.json"
	}
	for field, rel := range paths {
		paths[field] = filepath.Join(o.outputDir, "original", rel)
	}
	portableRaw, err := portableContextPaths(contextRaw, paths)
	if err != nil {
		return r, err
	}
	if _, _, err = decodeTransactionTrustContext(portableRaw, portableDigest(portableRaw)); err != nil {
		return r, err
	}
	out, err := newPortableOutput(o.outputDir)
	if err != nil {
		return r, err
	}
	defer out.close()
	for _, row := range catalog.Files {
		sourcePath := filepath.Join(o.sourceDir, filepath.FromSlash(row.Path))
		var before unix.Stat_t
		if e := unix.Lstat(sourcePath, &before); e != nil {
			return r, e
		}
		if before.Nlink != 1 {
			return r, errors.New("public source must have one original link")
		}
		bound, _ := strconv.ParseInt(row.Bytes, 10, 64)
		raw, e := readPublicFile(sourcePath, bound)
		if e != nil || int64(len(raw)) != bound || !matchesSHA256(raw, row.SHA256) {
			return r, errors.New("catalog public file bytes or hash did not validate")
		}
		var after unix.Stat_t
		if e = unix.Lstat(sourcePath, &after); e != nil || after.Nlink != 1 || after.Dev != before.Dev || after.Ino != before.Ino {
			return r, errors.New("public source link identity changed")
		}
		if row.Path == "context/trust-context.json" && !bytes.Equal(raw, contextRaw) {
			return r, errors.New("original context bytes differ")
		}
		if err = out.write("original/"+row.Path, raw); err != nil {
			return r, err
		}
		r.Files = append(r.Files, portableFileEntry{Path: "original/" + row.Path, Bytes: row.Bytes, SHA256: row.SHA256})
	}
	current, err := portableDirectory(o.sourceDir)
	if err != nil || !os.SameFile(sourceIdentity, current) {
		return r, errors.New("public source directory identity changed")
	}
	if err = portableSourceTree(o.sourceDir, catalog); err != nil {
		return r, err
	}
	// A second bounded read pins the two independent metadata originals across
	// the copy; changed inputs never produce a complete import receipt.
	for _, pin := range []struct {
		path, sha string
		limit     int64
	}{{o.contextPath, o.contextSHA256, maxTransactionContextBytes}, {o.catalogPath, o.catalogSHA256, 32 << 10}} {
		raw, e := readPublicFile(pin.path, pin.limit)
		if e != nil || !matchesSHA256(raw, pin.sha) {
			return r, errors.New("independent import metadata changed")
		}
	}
	r.ContextPath = filepath.Join(o.outputDir, "portable-trust-context.json")
	r.ContextSHA256 = portableDigest(portableRaw)
	if err = out.write("portable-trust-context.json", portableRaw); err != nil {
		return r, err
	}
	r.Files = append(r.Files, portableFileEntry{Path: "portable-trust-context.json", Bytes: strconv.Itoa(len(portableRaw)), SHA256: r.ContextSHA256})
	receipt, err := json.Marshal(r)
	if err != nil {
		return r, err
	}
	receipt = append(receipt, '\n')
	if err = out.write("PUBLIC-PORTABLE-IMPORT.json", receipt); err != nil {
		return r, err
	}
	if err = out.sync(); err != nil {
		return r, err
	}
	if err = out.current(o.outputDir); err != nil {
		return r, err
	}
	parentFD, err := unix.Open(filepath.Dir(o.outputDir), unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return r, err
	}
	parent := os.NewFile(uintptr(parentFD), "portable-data-parent")
	err = parent.Sync()
	closeErr := parent.Close()
	if err == nil {
		err = closeErr
	}
	return r, err
}

func runPortableImport(args []string, output io.Writer) int {
	failure := func(code string, cause error) int {
		// Causes are bounded public parser/filesystem diagnostics, never raw
		// context, proof, envelope or signature bytes. Keep the first cause.
		detail := []rune(cause.Error())
		if len(detail) > 512 {
			detail = detail[:512]
		}
		for i, r := range detail {
			if unicode.IsControl(r) {
				detail[i] = ' '
			}
		}
		_ = json.NewEncoder(output).Encode(portableImportResult{Version: portableResultVersion, Code: code, Error: string(detail), Classification: "data"})
		return 1
	}
	o, err := parsePortableImportOptions(args)
	if err != nil {
		return failure("INVALID_ARGUMENTS", err)
	}
	r, err := importPortableData(o)
	if err != nil {
		return failure("IMPORT_REJECTED", err)
	}
	raw, err := json.Marshal(r)
	if err != nil {
		return 1
	}
	raw = append(raw, '\n')
	if n, err := output.Write(raw); err != nil || n != len(raw) {
		return 1
	}
	return 0
}
