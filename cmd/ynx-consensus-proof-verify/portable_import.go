//go:build unix

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
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
	maxPortableFileBytes      = 64 << 20
	maxPortableMigrationBytes = 1 << 30 // same bound as the normal verifier
	maxPortableOtherBytes     = 256 << 20
	maxPortableTotalBytes     = maxPortableMigrationBytes + maxPortableOtherBytes
	portableMetadataAllowance = 1 << 20
	// Existing local-window admission keeps a 1 GiB free floor and a 425 MiB
	// root reserve. This DATA writer uses the same conservative safety margin;
	// Statfs is a point-in-time check, not a reservation against other writers.
	portableFreeFloorBytes   = 1 << 30
	portableRootReserveBytes = 425 << 20
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
	var total, other uint64
	for i, row := range c.Files {
		if err = strictStringObject(rows[i], &c.Files[i]); err != nil {
			return c, err
		}
		if row.Path != want[i] {
			return c, errors.New("catalog paths must be the closed sorted public set")
		}
		limit := uint64(maxPortableFileBytes)
		if row.Path == "context/migration.json" {
			limit = maxPortableMigrationBytes
		}
		n, e := decimal(row.Bytes, limit, true)
		if e != nil {
			return c, e
		}
		total += n
		if row.Path != "context/migration.json" {
			other += n
		}
		if total > maxPortableTotalBytes || other > maxPortableOtherBytes {
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
		return nil, errors.Join(errors.New("output directory identity changed"), root.Close())
	}
	p := &portableOutput{dirs: map[string]*os.File{"": root}}
	for _, n := range []string{"original", "original/context", "original/original-results"} {
		base := filepath.Dir(n)
		if base == "." {
			base = ""
		}
		f := p.dirs[base]
		if err = unix.Mkdirat(int(f.Fd()), filepath.Base(n), 0700); err != nil {
			return nil, errors.Join(err, p.close())
		}
		child, e := unix.Openat(int(f.Fd()), filepath.Base(n), unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		if e != nil {
			return nil, errors.Join(e, p.close())
		}
		p.dirs[n] = os.NewFile(uintptr(child), "portable-data-directory")
	}
	return p, nil
}

func (p *portableOutput) close() error {
	var err error
	for _, name := range []string{"original/context", "original/original-results", "original", ""} {
		if f := p.dirs[name]; f != nil {
			err = errors.Join(err, f.Close())
		}
	}
	return err
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
	return errors.Join(err, f.Close())
}

// Copy the pinned migration through a fixed buffer, retaining both file
// identities until hash, length and original-current checks have succeeded.
// A failure retains only the partial output and never publishes a receipt.
func (p *portableOutput) writeMigration(name, sourcePath string, row portableFileEntry, hooks *portableImportHooks) (result error) {
	bound, err := strconv.ParseInt(row.Bytes, 10, 64)
	if err != nil || bound <= 0 || bound > maxPortableMigrationBytes {
		return errors.New("invalid migration bound")
	}
	source, before, err := openPublicFile(sourcePath, bound)
	if err != nil {
		return err
	}
	defer func() {
		if hooks != nil && hooks.migrationSourceBeforeClose != nil {
			result = errors.Join(result, hooks.migrationSourceBeforeClose(source))
		}
		result = errors.Join(result, source.Close())
	}()
	var original unix.Stat_t
	if before.Size() != bound || unix.Fstat(int(source.Fd()), &original) != nil || original.Nlink != 1 {
		return errors.New("public migration identity or length differs")
	}
	dir := p.dirs[filepath.Dir(name)]
	if dir == nil {
		return errors.New("closed portable output path required")
	}
	fd, err := unix.Openat(int(dir.Fd()), filepath.Base(name), unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return err
	}
	dest := os.NewFile(uintptr(fd), "portable-public-migration")
	defer func() {
		if hooks != nil && hooks.migrationDestBeforeClose != nil {
			result = errors.Join(result, hooks.migrationDestBeforeClose(dest))
		}
		result = errors.Join(result, dest.Close())
	}()
	digest := sha256.New()
	var target io.Writer = dest
	if hooks != nil && hooks.migrationWriter != nil {
		target = hooks.migrationWriter(dest)
	}
	n, err := io.CopyBuffer(io.MultiWriter(target, digest), io.LimitReader(source, bound+1), make([]byte, 128<<10))
	if err != nil {
		return fmt.Errorf("copy public migration: %w", err)
	}
	if n != bound || hex.EncodeToString(digest.Sum(nil)) != row.SHA256 {
		return errors.New("catalog public file bytes or hash did not validate")
	}
	if hooks != nil && hooks.migrationAfterCopy != nil {
		if err = hooks.migrationAfterCopy(sourcePath); err != nil {
			return err
		}
	}
	var current unix.Stat_t
	if err = checkPublicFile(source, sourcePath, before); err != nil {
		return err
	}
	if err = unix.Lstat(sourcePath, &current); err != nil || current.Nlink != 1 || current.Dev != original.Dev || current.Ino != original.Ino {
		return errors.New("public source link identity changed")
	}
	return dest.Sync()
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

type portableImportHooks struct {
	spaceCheck                 func(string, uint64) error
	outputSync                 func(*portableOutput) error
	outputClose                func(*portableOutput) error
	parentSync                 func(*os.File) error
	migrationAfterCopy         func(string) error
	migrationWriter            func(io.Writer) io.Writer
	migrationSourceBeforeClose func(*os.File) error
	migrationDestBeforeClose   func(*os.File) error
	parentBeforeClose          func(*os.File) error
	sourceClose                func(string, *os.File) error
}

// Import/diagnosis need the original read capability's close result as part
// of DATA completion. The normal verifier's separate reader stays unchanged.
func portableReadPublicFile(path string, maximum int64, closeFn func(string, *os.File) error) (raw []byte, result error) {
	f, before, err := openPublicFile(path, maximum)
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeFn != nil {
			result = errors.Join(result, closeFn(path, f))
		} else {
			result = errors.Join(result, f.Close())
		}
	}()
	raw, err = io.ReadAll(io.LimitReader(f, maximum+1))
	if err != nil {
		return nil, fmt.Errorf("read public file: %w", err)
	}
	if int64(len(raw)) > maximum || int64(len(raw)) != before.Size() {
		return nil, errors.New("public file changed or exceeded its bound during read")
	}
	if err = checkPublicFile(f, path, before); err != nil {
		return nil, err
	}
	return raw, nil
}

func importPortableData(o portableImportOptions) (portableImportResult, error) {
	return importPortableDataWithHooks(o, nil)
}

// This preflight does not reserve capacity against other writers. Every write
// still handles ENOSPC and a failed attempt is retained without a success reply.
func portableSpaceEnough(blocks, blockSize, bytes uint64) bool {
	if blockSize == 0 {
		return false
	}
	return bytes/blockSize <= blocks && (bytes%blockSize == 0 || bytes/blockSize < blocks)
}

func checkPortableSpace(path string, required uint64) error {
	var space unix.Statfs_t
	if err := unix.Statfs(path, &space); err != nil {
		return err
	}
	if !portableSpaceEnough(uint64(space.Bavail), uint64(space.Bsize), required) {
		return errors.New("insufficient available space for bounded portable DATA")
	}
	return nil
}

func importPortableDataWithHooks(o portableImportOptions, hooks *portableImportHooks) (r portableImportResult, resultErr error) {
	r = portableImportResult{Version: portableResultVersion, Code: "IMPORTED_DATA", Classification: "data", OriginalContextSHA256: o.contextSHA256, CatalogSHA256: o.catalogSHA256}
	var closeFn func(string, *os.File) error
	if hooks != nil {
		closeFn = hooks.sourceClose
	}
	readOriginal := func(path string, maximum int64) ([]byte, error) {
		return portableReadPublicFile(path, maximum, closeFn)
	}
	sourceIdentity, err := portableDirectory(o.sourceDir)
	if err != nil {
		return r, err
	}
	contextRaw, err := readOriginal(o.contextPath, maxTransactionContextBytes)
	if err != nil {
		return r, err
	}
	c, _, err := decodeTransactionTrustContext(contextRaw, o.contextSHA256)
	if err != nil {
		return r, err
	}
	catalogRaw, err := readOriginal(o.catalogPath, 32<<10)
	if err != nil {
		return r, fmt.Errorf("read independent portable catalog: %w", err)
	}
	if !matchesSHA256(catalogRaw, o.catalogSHA256) {
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
	var required uint64 = uint64(len(portableRaw)) + portableMetadataAllowance + portableFreeFloorBytes + portableRootReserveBytes
	for _, row := range catalog.Files {
		n, _ := strconv.ParseUint(row.Bytes, 10, 64)
		required += n
	}
	if hooks != nil && hooks.spaceCheck != nil {
		err = hooks.spaceCheck(filepath.Dir(o.outputDir), required)
	} else {
		err = checkPortableSpace(filepath.Dir(o.outputDir), required)
	}
	if err != nil {
		return r, err
	}
	out, err := newPortableOutput(o.outputDir)
	if err != nil {
		return r, err
	}
	defer func() {
		if hooks != nil && hooks.outputClose != nil {
			resultErr = errors.Join(resultErr, hooks.outputClose(out))
		} else {
			resultErr = errors.Join(resultErr, out.close())
		}
	}()
	for _, row := range catalog.Files {
		sourcePath := filepath.Join(o.sourceDir, filepath.FromSlash(row.Path))
		if row.Path == "context/migration.json" {
			if err = out.writeMigration("original/"+row.Path, sourcePath, row, hooks); err != nil {
				return r, err
			}
			r.Files = append(r.Files, portableFileEntry{Path: "original/" + row.Path, Bytes: row.Bytes, SHA256: row.SHA256})
			continue
		}
		var before unix.Stat_t
		if e := unix.Lstat(sourcePath, &before); e != nil {
			return r, e
		}
		if before.Nlink != 1 {
			return r, errors.New("public source must have one original link")
		}
		bound, _ := strconv.ParseInt(row.Bytes, 10, 64)
		raw, e := readOriginal(sourcePath, bound)
		if e != nil {
			return r, fmt.Errorf("read catalog public file: %w", e)
		}
		if int64(len(raw)) != bound || !matchesSHA256(raw, row.SHA256) {
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
		raw, e := readOriginal(pin.path, pin.limit)
		if e != nil {
			return r, fmt.Errorf("recheck independent import metadata: %w", e)
		}
		if !matchesSHA256(raw, pin.sha) {
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
	if hooks != nil && hooks.outputSync != nil {
		err = hooks.outputSync(out)
	} else {
		err = out.sync()
	}
	if err != nil {
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
	if hooks != nil && hooks.parentSync != nil {
		err = hooks.parentSync(parent)
	} else {
		err = parent.Sync()
	}
	if hooks != nil && hooks.parentBeforeClose != nil {
		err = errors.Join(err, hooks.parentBeforeClose(parent))
	}
	err = errors.Join(err, parent.Close())
	return r, err
}

func runPortableImport(args []string, output io.Writer) int {
	return runPortableImportWithHooks(args, output, nil)
}

func runPortableImportWithHooks(args []string, output io.Writer, hooks *portableImportHooks) int {
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
	r, err := importPortableDataWithHooks(o, hooks)
	if err != nil {
		// A created or uninspectable original output may contain a partial
		// attempt or even a visible receipt after sync failure. Never frame it
		// as permission to replace or retry the original output.
		if _, statErr := os.Lstat(o.outputDir); statErr == nil || !errors.Is(statErr, os.ErrNotExist) {
			return failure("IMPORT_UNKNOWN", err)
		}
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
