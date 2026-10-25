//go:build unix

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	"golang.org/x/sys/unix"
)

// This object is accepted ONLY from --trust-context plus the externally
// supplied SHA256 of its exact bytes. Paths point to public originals; no key,
// credential, HRS, RPC URL, peer callback or writable Application is needed.
type trustContext struct {
	Version                   string `json:"version"`
	ChainID                   string `json:"chainId"`
	MigrationFile             string `json:"migrationFile"`
	GenesisFile               string `json:"genesisFile"`
	StateFile                 string `json:"stateFile"`
	ScheduleFile              string `json:"scheduleFile"`
	ScheduleHash              string `json:"scheduleHash"`
	ConsensusGenesisSHA256    string `json:"consensusGenesisSHA256"`
	OriginalGenesisHash       string `json:"originalGenesisHash"`
	MigrationStateHash        string `json:"migrationStateHash"`
	RuntimePlanFile           string `json:"runtimePlanFile"`
	RuntimePlanHash           string `json:"runtimePlanHash"`
	EngineHeight              string `json:"engineHeight"`
	EngineAppHash             string `json:"engineAppHash"`
	ExpectedHeaderHeight      string `json:"expectedHeaderHeight"`
	ExpectedBlockHash         string `json:"expectedBlockHash"`
	ExpectedStateHeight       string `json:"expectedStateHeight"`
	ExpectedStateAppHash      string `json:"expectedStateAppHash"`
	TrustedLightBlockFile     string `json:"trustedLightBlockFile"`
	TrustedLightBlockSHA256   string `json:"trustedLightBlockSHA256"`
	TrustingPeriodNanoseconds string `json:"trustingPeriodNanoseconds"`
	MaxClockDriftNanoseconds  string `json:"maxClockDriftNanoseconds"`
	TrustLevelNumerator       string `json:"trustLevelNumerator"`
	TrustLevelDenominator     string `json:"trustLevelDenominator"`
}

func canonicalAbsolutePath(path string) bool {
	return path != "" && filepath.IsAbs(path) && filepath.Clean(path) == path
}

func hash32(value string) ([]byte, error) {
	raw, err := hex.DecodeString(value)
	if err != nil || len(raw) != sha256.Size || hex.EncodeToString(raw) != value || bytes.Equal(raw, make([]byte, sha256.Size)) {
		return nil, errors.New("nonzero lowercase 32-byte hash required")
	}
	return raw, nil
}

func decimal(value string, maximum uint64, nonzero bool) (uint64, error) {
	n, err := strconv.ParseUint(value, 10, 64)
	if err != nil || strconv.FormatUint(n, 10) != value || n > maximum || (nonzero && n == 0) {
		return 0, errors.New("bounded canonical unsigned decimal string required")
	}
	return n, nil
}

func (e expectedStatement) decode() (consensus.PQLightProofExpectation, error) {
	var result consensus.PQLightProofExpectation
	height, err := decimal(e.HeaderHeight, math.MaxInt64-1, true)
	if err != nil {
		return result, err
	}
	stateHeight, err := decimal(e.StateHeight, math.MaxInt64-2, false)
	if err != nil || height != stateHeight+1 || e.ChainID == "" {
		return result, errors.New("header must bind exactly the preceding committed state height")
	}
	blockHash, err := hash32(e.BlockHash)
	if err != nil {
		return result, err
	}
	stateHash, err := hash32(e.StateAppHash)
	if err != nil {
		return result, err
	}
	return consensus.PQLightProofExpectation{ChainID: e.ChainID, HeaderHeight: int64(height), BlockHash: blockHash, StateHeight: int64(stateHeight), StateAppHash: stateHash}, nil
}

func readTrustContext(o options) (trustContext, error) {
	var c trustContext
	raw, err := readPublicFile(o.contextPath, 32<<10)
	if err != nil {
		return c, err
	}
	if !matchesSHA256(raw, o.contextSHA256) {
		return c, errors.New("trust context differs from external pin")
	}
	if err = strictStringObject(raw, &c); err != nil {
		return c, err
	}
	return c, c.validate()
}

func (c trustContext) validate() error {
	if c.Version != contextVersion || c.ChainID == "" || len(c.ChainID) > 50 || !utf8.ValidString(c.ChainID) {
		return errors.New("invalid trust context identity")
	}
	for _, path := range []string{c.MigrationFile, c.GenesisFile, c.StateFile, c.ScheduleFile, c.TrustedLightBlockFile} {
		if !canonicalAbsolutePath(path) {
			return errors.New("original public paths must be canonical and absolute")
		}
	}
	for _, hash := range []string{c.ScheduleHash, c.ConsensusGenesisSHA256, c.OriginalGenesisHash, c.MigrationStateHash, c.EngineAppHash, c.TrustedLightBlockSHA256} {
		if _, err := hash32(hash); err != nil {
			return err
		}
	}
	if (c.RuntimePlanFile == "") != (c.RuntimePlanHash == "") {
		return errors.New("runtime plan requires both original file and independent pin")
	}
	if c.RuntimePlanFile != "" {
		if !canonicalAbsolutePath(c.RuntimePlanFile) {
			return errors.New("runtime plan path is not canonical and absolute")
		}
		if _, err := hash32(c.RuntimePlanHash); err != nil {
			return err
		}
	}
	if _, err := decimal(c.EngineHeight, math.MaxInt64-2, false); err != nil {
		return err
	}
	if _, err := c.expected().decode(); err != nil {
		return err
	}
	if _, err := decimal(c.TrustingPeriodNanoseconds, math.MaxInt64, true); err != nil {
		return err
	}
	if _, err := decimal(c.MaxClockDriftNanoseconds, math.MaxInt64, false); err != nil {
		return err
	}
	numerator, err := decimal(c.TrustLevelNumerator, math.MaxInt64, true)
	if err != nil {
		return err
	}
	denominator, err := decimal(c.TrustLevelDenominator, math.MaxInt64, true)
	if err != nil || numerator > denominator || numerator < denominator/3+boolUint64(denominator%3 != 0) {
		return errors.New("explicit trust fraction must be in [1/3,1]")
	}
	return nil
}

// Invocation coordinates are independently pinned with the trust context.
// stdin may echo them, but cannot choose a different otherwise valid proof.
// They remain separate from the source checkpoint that authenticates history.
func (c trustContext) expected() expectedStatement {
	return expectedStatement{ChainID: c.ChainID, HeaderHeight: c.ExpectedHeaderHeight, BlockHash: c.ExpectedBlockHash, StateHeight: c.ExpectedStateHeight, StateAppHash: c.ExpectedStateAppHash}
}

func boolUint64(b bool) uint64 {
	if b {
		return 1
	}
	return 0
}

func (c trustContext) load() (consensus.PQLightProofTrust, error) {
	var trust consensus.PQLightProofTrust
	if err := c.validate(); err != nil {
		return trust, err
	}
	// All authority inputs come from the externally pinned context. Read the
	// original migration and genesis, preserving their established wire/hash.
	migrationRaw, err := readPublicFile(c.MigrationFile, 1<<30)
	if err != nil {
		return trust, err
	}
	var migration chain.ConsensusMigrationState
	if err = strictJSON(migrationRaw, &migration); err != nil {
		return trust, err
	}
	genesisRaw, err := readPublicFile(c.GenesisFile, 64<<20)
	if err != nil {
		return trust, err
	}
	pins := consensus.ConsensusBootstrapPins{CometGenesisSHA256: c.ConsensusGenesisSHA256, OriginalGenesisHash: c.OriginalGenesisHash, MigrationStateHash: c.MigrationStateHash}
	bootstrap, err := consensus.NewConsensusBootstrap(genesisRaw, pins, migration)
	if err != nil {
		return trust, err
	}
	scheduleRaw, err := readPublicFile(c.ScheduleFile, 32<<10)
	if err != nil {
		return trust, err
	}
	engine, err := consensus.NewPQEngineAuthorization(scheduleRaw, c.ScheduleHash)
	if err != nil {
		return trust, err
	}
	var runtime *consensus.RuntimeUpgradeAuthorization
	if c.RuntimePlanFile != "" {
		raw, err := readPublicFile(c.RuntimePlanFile, consensus.MaxRuntimeUpgradePlanBytes)
		if err != nil {
			return trust, err
		}
		runtime, err = consensus.NewRuntimeUpgradeAuthorization(raw, c.RuntimePlanHash, bootstrap, migration)
		if err != nil {
			return trust, err
		}
	}
	resolvedState, err := filepath.EvalSymlinks(c.StateFile)
	if err != nil || resolvedState != c.StateFile {
		return trust, errors.New("committed state may not traverse symlinks")
	}
	source, err := consensus.NewPQEngineFileSourceWithRuntimeUpgrade(migration, c.StateFile, bootstrap, engine, runtime)
	if err != nil {
		return trust, err
	}
	height, _ := decimal(c.EngineHeight, math.MaxInt64-2, false)
	appHash, _ := hash32(c.EngineAppHash)
	authority, err := source.ConsensusAuthorityForState(c.ChainID, int64(height), appHash)
	if err != nil {
		return trust, err
	}
	var ok bool
	trust.Snapshot, ok = authority.(*consensus.PQEngineSnapshot)
	if !ok || trust.Snapshot == nil {
		return trust, errors.New("normal loader did not return immutable committed PQ authority")
	}
	trustedRaw, err := readPublicFile(c.TrustedLightBlockFile, consensus.MaxPQTrustedLightBlockBytes)
	if err != nil {
		return trust, err
	}
	if !matchesSHA256(trustedRaw, c.TrustedLightBlockSHA256) {
		return trust, errors.New("trusted LightBlock differs from independent exact-byte pin")
	}
	trust.TrustedLightBlock, err = consensus.DecodePQTrustedLightBlock(trustedRaw)
	if err != nil {
		return trust, err
	}
	period, _ := decimal(c.TrustingPeriodNanoseconds, math.MaxInt64, true)
	drift, _ := decimal(c.MaxClockDriftNanoseconds, math.MaxInt64, false)
	numerator, _ := decimal(c.TrustLevelNumerator, math.MaxInt64, true)
	denominator, _ := decimal(c.TrustLevelDenominator, math.MaxInt64, true)
	trust.TrustingPeriod, trust.MaxClockDrift = time.Duration(period), time.Duration(drift)
	trust.TrustLevel = cmtmath.Fraction{Numerator: numerator, Denominator: denominator}
	return trust, nil
}

func matchesSHA256(raw []byte, expected string) bool {
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:]) == expected
}

// Public files are read only once through their original inode, with bounds
// and before/after identity checks. No symlink, FIFO, directory or source repair.
func readPublicFile(path string, maximum int64) ([]byte, error) {
	if !canonicalAbsolutePath(path) {
		return nil, errors.New("canonical absolute public file required")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved != path {
		return nil, errors.New("public source may not traverse symlinks")
	}
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), "public-consensus-proof-input")
	defer f.Close()
	before, err := f.Stat()
	if err != nil || !before.Mode().IsRegular() || before.Size() <= 0 || before.Size() > maximum {
		return nil, errors.New("public file is empty, non-regular or exceeds its bound")
	}
	raw, err := io.ReadAll(io.LimitReader(f, maximum+1))
	if err != nil || int64(len(raw)) > maximum || int64(len(raw)) != before.Size() {
		return nil, errors.New("public file changed or exceeded its bound during read")
	}
	after, err := f.Stat()
	current, pathErr := os.Lstat(path)
	if err != nil || pathErr != nil || !samePublicFile(before, after) || !samePublicFile(before, current) {
		return nil, errors.New("public file changed during read")
	}
	return raw, nil
}

func samePublicFile(a, b os.FileInfo) bool {
	return a != nil && b != nil && os.SameFile(a, b) && a.Mode() == b.Mode() && a.Size() == b.Size() && a.ModTime() == b.ModTime()
}

// These two wire DTOs have only required string fields. Check exact key case
// and reject null: encoding/json otherwise accepts case-folded field aliases
// and silently decodes null into an empty string. This is not used to rewrite
// the original migration/genesis/state serialization.
func strictStringObject(raw []byte, value any) error {
	if err := strictJSON(raw, value); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	t := reflect.TypeOf(value)
	if t == nil || t.Kind() != reflect.Pointer || t.Elem().Kind() != reflect.Struct {
		return errors.New("string DTO requires a struct pointer")
	}
	t = t.Elem()
	if len(fields) != t.NumField() {
		return errors.New("missing or extra string DTO fields")
	}
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		rawValue, ok := fields[field.Tag.Get("json")]
		rawValue = bytes.TrimSpace(rawValue)
		if !ok || field.Type.Kind() != reflect.String || len(rawValue) == 0 || rawValue[0] != '"' {
			return errors.New("field name, type or case differs from the exact string schema")
		}
	}
	return nil
}

// Reject duplicate keys recursively before decoding into typed DTOs; Go's
// ordinary decoder otherwise silently chooses the last duplicate. Object key
// order and JSON whitespace are immaterial; decimal strings remain exact.
func strictJSON(raw []byte, value any) error {
	if !utf8.Valid(raw) {
		return errors.New("JSON must be valid UTF-8")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if err := scanJSON(d, 0); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return errors.New("trailing JSON value or bytes")
	}
	d = json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("trailing JSON value or bytes")
	}
	return nil
}

func scanJSON(d *json.Decoder, depth int) error {
	if depth > 64 {
		return errors.New("JSON nesting exceeds bound")
	}
	token, err := d.Token()
	if err != nil {
		return err
	}
	delim, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delim {
	case '{':
		seen := make(map[string]bool)
		for d.More() {
			key, err := d.Token()
			name, ok := key.(string)
			if err != nil || !ok || seen[name] {
				return errors.New("duplicate or invalid JSON object key")
			}
			seen[name] = true
			if err := scanJSON(d, depth+1); err != nil {
				return err
			}
		}
	case '[':
		for d.More() {
			if err := scanJSON(d, depth+1); err != nil {
				return err
			}
		}
	default:
		return errors.New("unexpected JSON delimiter")
	}
	_, err = d.Token()
	return err
}
