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
	"reflect"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/cometbft/cometbft/light"
	"golang.org/x/sys/unix"
)

const (
	hostSourceVersion    = "YNX-CONSENSUS-PROOF-HOST-SOURCE/v1"
	hostLifecycleVersion = "YNX-CONSENSUS-PROOF-HOST-LIFECYCLE/v1"
	hostContextVersion   = "YNX-CONSENSUS-PROOF-HOST-CONTEXT/v1"
)

// The original Host supplies this entire object through an independent pin.
// No field is accepted from an RPC proof. In particular a path or an internally
// consistent public manifest is not proof of Root/Host provenance.
type hostTrustSource struct {
	Version                 string `json:"version"`
	SourceID                string `json:"sourceId"`
	Epoch                   string `json:"epoch"`
	ContextFile             string `json:"contextFile"`
	ContextSHA256           string `json:"contextSHA256"`
	LifecycleFile           string `json:"lifecycleFile"`
	LifecycleSHA256         string `json:"lifecycleSHA256"`
	MigrationSHA256         string `json:"migrationSHA256"`
	GenesisSHA256           string `json:"genesisSHA256"`
	StateSHA256             string `json:"stateSHA256"`
	ScheduleSHA256          string `json:"scheduleSHA256"`
	RuntimePlanSHA256       string `json:"runtimePlanSHA256"`
	TrustedLightBlockSHA256 string `json:"trustedLightBlockSHA256"`
}

type hostLifecycle struct {
	Version  string `json:"version"`
	SourceID string `json:"sourceId"`
	Epoch    string `json:"epoch"`
	Status   string `json:"status"`
}

// ContextBytes are the EXACT original light/transaction context (including its
// original public paths), for the protected Main process only. The normal proof
// verifier still receives its unchanged --trust-context flags and stdin ABI.
// This DATA object is not an opaque cross-process lease or a Root certificate.
type hostContextExport struct {
	Version                   string               `json:"version"`
	Classification            string               `json:"classification"`
	SourceID                  string               `json:"sourceId"`
	Epoch                     string               `json:"epoch"`
	SourceFingerprint         string               `json:"sourceFingerprint"`
	SourceBytes               []byte               `json:"sourceBytes"`
	SourceSHA256              string               `json:"sourceSHA256"`
	LifecycleBytes            []byte               `json:"lifecycleBytes"`
	LifecycleSHA256           string               `json:"lifecycleSHA256"`
	ContextVersion            string               `json:"contextVersion"`
	ContextPath               string               `json:"contextPath"`
	ContextBytes              []byte               `json:"contextBytes"`
	ContextSHA256             string               `json:"contextSHA256"`
	ExpectedTransaction       *transactionExpected `json:"expectedTransaction"`
	ChainID                   string               `json:"chainId"`
	EngineHeight              string               `json:"engineHeight"`
	EngineAppHash             string               `json:"engineAppHash"`
	TrustedLightBlockSHA256   string               `json:"trustedLightBlockSHA256"`
	ExpiresAt                 string               `json:"expiresAt"`
	CurrentChecked            bool                 `json:"currentChecked"`
	NativeRootAuthorized      bool                 `json:"nativeRootAuthorized"`
	SourceDeploymentQualified bool                 `json:"sourceDeploymentQualified"`
	ProofVerified             bool                 `json:"proofVerified"`
}

type heldProofSource struct {
	name, path, digest string
	file               *os.File
	info               os.FileInfo
	device, inode      uint64
	changed            string
}

// Linux and Darwin expose the same timespec through differently named Stat_t
// fields across x/sys releases. Do not bind atime (our reads may change it), but
// do bind ctime so restoring old bytes/mtime cannot revive a captured epoch.
func hostSourceChangeStamp(stat unix.Stat_t) (string, error) {
	v := reflect.ValueOf(stat)
	for _, name := range []string{"Ctim", "Ctimespec"} {
		stamp := v.FieldByName(name)
		if stamp.IsValid() && stamp.Kind() == reflect.Struct {
			sec, nsec := stamp.FieldByName("Sec"), stamp.FieldByName("Nsec")
			if sec.IsValid() && nsec.IsValid() && sec.CanInt() && nsec.CanInt() {
				return strconv.FormatInt(sec.Int(), 10) + ":" + strconv.FormatInt(nsec.Int(), 10), nil
			}
		}
	}
	return "", errors.New("original source change identity is unavailable")
}

func openHeldProofSource(name, path, pin string, maximum int64) (_ *heldProofSource, err error) {
	if !canonicalAbsolutePath(path) {
		return nil, errors.New("original canonical source path required")
	}
	if _, err = hash32(pin); err != nil {
		return nil, err
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved != path {
		return nil, errors.New("source symlink refused")
	}
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), "held-public-proof-source")
	ok := false
	defer func() {
		if !ok {
			_ = f.Close()
		}
	}()
	info, err := f.Stat()
	var stat unix.Stat_t
	if err != nil || unix.Fstat(fd, &stat) != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0022 != 0 || stat.Nlink != 1 || info.Size() <= 0 || info.Size() > maximum {
		return nil, errors.New("bounded immutable regular source required")
	}
	changed, err := hostSourceChangeStamp(stat)
	if err != nil {
		return nil, err
	}
	r := &heldProofSource{name: name, path: path, digest: pin, file: f, info: info, device: uint64(stat.Dev), inode: uint64(stat.Ino), changed: changed}
	if err = r.current(); err != nil {
		return nil, err
	}
	ok = true
	return r, nil
}

// Read the held inode and require that the normal path still denotes it. A
// replaced snapshot, journal append/partial tail, changed lifecycle record or
// failed read invalidates the reference; this never repairs or falls back.
func (r *heldProofSource) current() error {
	before, err := r.file.Stat()
	pathInfo, pathErr := os.Lstat(r.path)
	resolved, resolveErr := filepath.EvalSymlinks(r.path)
	if err != nil || pathErr != nil || resolveErr != nil || resolved != r.path || !samePublicFile(r.info, before) || !samePublicFile(r.info, pathInfo) || pathInfo.Mode()&os.ModeSymlink != 0 {
		return errors.New("held proof source is no longer current")
	}
	var stat unix.Stat_t
	if unix.Fstat(int(r.file.Fd()), &stat) != nil || stat.Nlink != 1 {
		return errors.New("held source link identity changed")
	}
	if changed, err := hostSourceChangeStamp(stat); err != nil || changed != r.changed {
		return errors.New("held source change identity no longer matches")
	}
	h := sha256.New()
	n, err := io.Copy(h, io.NewSectionReader(r.file, 0, r.info.Size()+1))
	after, statErr := r.file.Stat()
	pathAfter, pathErr := os.Lstat(r.path)
	if err != nil || statErr != nil || pathErr != nil || n != r.info.Size() || !samePublicFile(r.info, after) || !samePublicFile(r.info, pathAfter) || hex.EncodeToString(h.Sum(nil)) != r.digest {
		return errors.New("held proof source bytes changed")
	}
	if unix.Fstat(int(r.file.Fd()), &stat) != nil {
		return errors.New("held source final identity unavailable")
	}
	if changed, err := hostSourceChangeStamp(stat); err != nil || changed != r.changed {
		return errors.New("held source changed during read")
	}
	return nil
}

func (r *heldProofSource) bytes(maximum int64) ([]byte, error) {
	if r.info.Size() > maximum {
		return nil, errors.New("source exceeds decoder bound")
	}
	raw, err := io.ReadAll(io.NewSectionReader(r.file, 0, r.info.Size()+1))
	if err != nil || int64(len(raw)) != r.info.Size() || !matchesSHA256(raw, r.digest) {
		return nil, errors.New("source changed during decoder read")
	}
	return raw, r.current()
}

// Private Go reference: callers cannot manufacture it from a JSON export.
// Revoke/Retire immediately deny new work and post-work publication. Join waits
// for every accepted operation; Close then releases descriptors. The bounded
// CLI closes this reference before exit and never advertises it across IPC.
type proofHostRef struct {
	mu     sync.Mutex
	readMu sync.Mutex
	cond   *sync.Cond
	active int
	state  string
	files  []*heldProofSource
	export hostContextExport
	trust  consensus.PQLightProofTrust
	clock  func() time.Time
}

func (r *proofHostRef) begin() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.state != "current" {
		return errors.New("proof host reference is not current")
	}
	r.active++
	return nil
}

func (r *proofHostRef) finish() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.active--
	r.cond.Broadcast()
	if r.state != "current" {
		return errors.New("proof host reference revoked or retired during use")
	}
	return nil
}

func (r *proofHostRef) Revoke() {
	r.mu.Lock()
	if r.state != "closed" {
		r.state = "revoked"
	}
	r.mu.Unlock()
}
func (r *proofHostRef) Retire() {
	r.mu.Lock()
	if r.state == "current" {
		r.state = "retired"
	}
	r.mu.Unlock()
}
func (r *proofHostRef) Join() {
	r.mu.Lock()
	for r.active != 0 {
		r.cond.Wait()
	}
	r.mu.Unlock()
}
func (r *proofHostRef) Close() error {
	r.Retire()
	r.Join()
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.state == "closed" {
		return nil
	}
	r.state = "closed"
	var errs []error
	for _, f := range r.files {
		errs = append(errs, f.file.Close())
	}
	r.files = nil
	r.export = hostContextExport{}
	r.trust = consensus.PQLightProofTrust{}
	return errors.Join(errs...)
}

func (r *proofHostRef) Current() (out hostContextExport, err error) {
	if err = r.begin(); err != nil {
		return out, err
	}
	defer func() {
		if end := r.finish(); end != nil {
			out = hostContextExport{}
			err = end
		}
	}()
	r.readMu.Lock()
	defer r.readMu.Unlock()
	for _, f := range r.files {
		if err = f.current(); err != nil {
			r.Revoke()
			return hostContextExport{}, err
		}
	}
	if r.clock == nil {
		r.Revoke()
		return out, errors.New("independent local clock unavailable")
	}
	now := r.clock().UTC()
	if now.IsZero() || light.HeaderExpired(r.trust.TrustedLightBlock.SignedHeader, r.trust.TrustingPeriod, now) || r.trust.TrustedLightBlock.Time.After(now.Add(r.trust.MaxClockDrift)) {
		r.Revoke()
		return out, errors.New("trusted checkpoint expired or exceeds local clock drift")
	}
	out = r.export
	out.ContextBytes = bytes.Clone(r.export.ContextBytes)
	out.SourceBytes = bytes.Clone(r.export.SourceBytes)
	out.LifecycleBytes = bytes.Clone(r.export.LifecycleBytes)
	if r.export.ExpectedTransaction != nil {
		copyExpected := *r.export.ExpectedTransaction
		out.ExpectedTransaction = &copyExpected
	}
	out.CurrentChecked = true
	return out, nil
}

func validHostSourceID(s string) bool {
	if len(s) < 1 || len(s) > 128 {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("._:-", r)) {
			return false
		}
	}
	return true
}

func acquireProofHost(sourcePath, sourcePin string, clock func() time.Time) (_ *proofHostRef, err error) {
	r := &proofHostRef{state: "acquiring", clock: clock}
	r.cond = sync.NewCond(&r.mu)
	ok := false
	defer func() {
		if !ok {
			_ = r.Close()
		}
	}()
	add := func(name, path, pin string, limit int64) (*heldProofSource, error) {
		for _, held := range r.files {
			if held.path == path {
				return nil, errors.New("distinct original source roles required")
			}
		}
		f, e := openHeldProofSource(name, path, pin, limit)
		if e == nil {
			r.files = append(r.files, f)
		}
		return f, e
	}
	f, err := add("hostSource", sourcePath, sourcePin, 16<<10)
	if err != nil {
		return nil, err
	}
	raw, err := f.bytes(16 << 10)
	if err != nil {
		return nil, err
	}
	sourceRaw := bytes.Clone(raw)
	var s hostTrustSource
	if err = strictStringObject(raw, &s); err != nil || s.Version != hostSourceVersion || !validHostSourceID(s.SourceID) {
		return nil, errors.New("invalid independently pinned host source")
	}
	if _, err = decimal(s.Epoch, ^uint64(0), true); err != nil {
		return nil, err
	}
	f, err = add("lifecycle", s.LifecycleFile, s.LifecycleSHA256, 4<<10)
	if err != nil {
		return nil, err
	}
	raw, err = f.bytes(4 << 10)
	if err != nil {
		return nil, err
	}
	lifecycleRaw := bytes.Clone(raw)
	var life hostLifecycle
	if err = strictStringObject(raw, &life); err != nil || life.Version != hostLifecycleVersion || life.SourceID != s.SourceID || life.Epoch != s.Epoch || life.Status != "current" {
		return nil, errors.New("original host lifecycle is not current at the pinned epoch")
	}
	f, err = add("context", s.ContextFile, s.ContextSHA256, maxTransactionContextBytes)
	if err != nil {
		return nil, err
	}
	contextRaw, err := f.bytes(maxTransactionContextBytes)
	if err != nil {
		return nil, err
	}
	var discriminator struct {
		Version string `json:"version"`
	}
	if json.Unmarshal(contextRaw, &discriminator) != nil {
		return nil, errors.New("invalid original trust context")
	}
	var c trustContext
	var expectedTransaction *transactionExpected
	switch discriminator.Version {
	case contextVersion:
		if len(contextRaw) > 32<<10 {
			return nil, errors.New("light context exceeds original bound")
		}
		if err = strictStringObject(contextRaw, &c); err != nil {
			return nil, err
		}
		if err = c.validate(); err != nil {
			return nil, err
		}
	case transactionContextVersion:
		tx, _, e := decodeTransactionTrustContext(contextRaw, s.ContextSHA256)
		if e != nil {
			return nil, e
		}
		c = tx.LightTrust
		expectedTransaction = &tx.ExpectedTransaction
	default:
		return nil, errors.New("unsupported original context version")
	}
	if s.GenesisSHA256 != c.ConsensusGenesisSHA256 || s.TrustedLightBlockSHA256 != c.TrustedLightBlockSHA256 || (s.RuntimePlanSHA256 == "") != (c.RuntimePlanFile == "") {
		return nil, errors.New("source pins disagree with original context")
	}
	for _, item := range []struct {
		name, path, pin string
		limit           int64
	}{
		{"migration", c.MigrationFile, s.MigrationSHA256, 1 << 30}, {"genesis", c.GenesisFile, s.GenesisSHA256, 64 << 20},
		{"state", c.StateFile, s.StateSHA256, 1 << 30}, {"schedule", c.ScheduleFile, s.ScheduleSHA256, 32 << 10},
		{"trustedLightBlock", c.TrustedLightBlockFile, s.TrustedLightBlockSHA256, consensus.MaxPQTrustedLightBlockBytes},
	} {
		if _, err = add(item.name, item.path, item.pin, item.limit); err != nil {
			return nil, err
		}
	}
	if c.RuntimePlanFile != "" {
		if _, err = add("runtimePlan", c.RuntimePlanFile, s.RuntimePlanSHA256, consensus.MaxRuntimeUpgradePlanBytes); err != nil {
			return nil, err
		}
	}
	// This is the existing production loader: complete migration/bootstrap,
	// independent schedule/runtime and exact engine H/AppHash; all three state
	// layouts retain their original strict readonly journal reconstruction.
	r.trust, err = c.load()
	if err != nil {
		return nil, err
	}
	policy, err := r.trust.Snapshot.Policy()
	if err != nil {
		return nil, err
	}
	expected, err := c.expected().decode()
	if err != nil || expected.HeaderHeight < policy.ActivationHeight {
		return nil, errors.New("original expectation is outside the enabled PQ profile")
	}
	trusted, err := light.BindLightBlock(r.trust.Snapshot, r.trust.TrustedLightBlock)
	if err != nil {
		return nil, err
	}
	params, err := r.trust.Snapshot.ParamsAt(trusted.Height)
	if err != nil || trusted.Version.App != params.Version.App || trusted.ChainID != c.ChainID || expected.HeaderHeight <= trusted.Height {
		return nil, errors.New("trusted checkpoint parameters or target height mismatch")
	}
	if err = trusted.ValidatorSet.VerifyCommit(c.ChainID, trusted.Commit.BlockID, trusted.Height, trusted.Commit); err != nil {
		return nil, err
	}
	r.trust.TrustedLightBlock = trusted
	// The fingerprint binds original inode identity as well as every full byte
	// pin. It is comparable on this host only, not a provenance certificate.
	type fingerprintFile struct{ Name, Path, SHA256, Device, Inode, Bytes, Modified, Changed string }
	files := make([]fingerprintFile, 0, len(r.files))
	for _, held := range r.files {
		if err = held.current(); err != nil {
			return nil, err
		}
		files = append(files, fingerprintFile{held.name, held.path, held.digest, strconv.FormatUint(held.device, 10), strconv.FormatUint(held.inode, 10), strconv.FormatInt(held.info.Size(), 10), held.info.ModTime().UTC().Format(time.RFC3339Nano), held.changed})
	}
	fingerprintRaw, err := json.Marshal(struct {
		Version string
		Files   []fingerprintFile
	}{"YNX-CONSENSUS-PROOF-HOST-SOURCE-FINGERPRINT/v1", files})
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(fingerprintRaw)
	r.export = hostContextExport{Version: hostContextVersion, Classification: "data", SourceID: s.SourceID, Epoch: s.Epoch, SourceFingerprint: hex.EncodeToString(digest[:]), ContextVersion: discriminator.Version, ContextBytes: bytes.Clone(contextRaw), ContextSHA256: s.ContextSHA256, ChainID: c.ChainID, EngineHeight: c.EngineHeight, EngineAppHash: c.EngineAppHash, TrustedLightBlockSHA256: c.TrustedLightBlockSHA256, ExpiresAt: trusted.Time.Add(r.trust.TrustingPeriod).UTC().Format(time.RFC3339Nano)}
	r.export.SourceBytes = sourceRaw
	r.export.SourceSHA256 = sourcePin
	r.export.LifecycleBytes = lifecycleRaw
	r.export.LifecycleSHA256 = s.LifecycleSHA256
	r.export.ContextPath = s.ContextFile
	r.export.ExpectedTransaction = expectedTransaction
	r.state = "current"
	if _, err = r.Current(); err != nil {
		return nil, err
	}
	ok = true
	return r, nil
}
