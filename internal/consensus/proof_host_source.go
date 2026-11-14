//go:build unix

package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	"golang.org/x/sys/unix"
)

const ProofHostSourcePlanVersion = "YNX-PROOF-HOST-SOURCE-PLAN/v1"
const MaxProofHostSourcePlanBytes = 48 << 20
const maxProofHostMigrationBytes = 1 << 30

// All coordinates, identities and trust parameters are operator inputs pinned
// by the caller over the complete plan bytes. None are taken from proof/RPC.
// OriginalHash is the Main journal identity, not an issuer or permission.
type ProofHostSourcePlan struct {
	Version                   string                       `json:"version"`
	SourceID                  string                       `json:"sourceId"`
	Epoch                     string                       `json:"epoch"`
	OperationID               string                       `json:"operationId"`
	Account                   string                       `json:"account"`
	NetworkID                 string                       `json:"networkId"`
	OriginalHash              string                       `json:"originalHash"`
	MigrationFile             string                       `json:"migrationFile"`
	MigrationSHA256           string                       `json:"migrationSHA256"`
	GenesisFile               string                       `json:"genesisFile"`
	ConsensusGenesisSHA256    string                       `json:"consensusGenesisSHA256"`
	OriginalGenesisHash       string                       `json:"originalGenesisHash"`
	MigrationStateHash        string                       `json:"migrationStateHash"`
	StateFile                 string                       `json:"stateFile"`
	StateLayout               string                       `json:"stateLayout"`
	CometDataDirectory        string                       `json:"cometDataDirectory"`
	SigningStatePath          string                       `json:"signingStatePath"`
	SigningLockKind           string                       `json:"signingLockKind"`
	ScheduleFile              string                       `json:"scheduleFile"`
	ScheduleHash              string                       `json:"scheduleHash"`
	ScheduleSHA256            string                       `json:"scheduleSHA256"`
	RuntimePlanFile           string                       `json:"runtimePlanFile"`
	RuntimePlanHash           string                       `json:"runtimePlanHash"`
	RuntimePlanSHA256         string                       `json:"runtimePlanSHA256"`
	EngineHeight              string                       `json:"engineHeight"`
	EngineAppHash             string                       `json:"engineAppHash"`
	TrustedHeight             string                       `json:"trustedHeight"`
	TrustedBlockHash          string                       `json:"trustedBlockHash"`
	TrustingPeriodNanoseconds string                       `json:"trustingPeriodNanoseconds"`
	MaxClockDriftNanoseconds  string                       `json:"maxClockDriftNanoseconds"`
	TrustLevelNumerator       string                       `json:"trustLevelNumerator"`
	TrustLevelDenominator     string                       `json:"trustLevelDenominator"`
	ExpectedTransaction       ProofHostExpectedTransaction `json:"expectedTransaction"`
}

type ProofHostExpectedHeader struct {
	ChainID      string `json:"chainId"`
	HeaderHeight string `json:"headerHeight"`
	BlockHash    string `json:"blockHash"`
	StateHeight  string `json:"stateHeight"`
	StateAppHash string `json:"stateAppHash"`
}

// Exact existing transaction Host/verifier eight-field ABI.
type ProofHostExpectedTransaction struct {
	Block           ProofHostExpectedHeader `json:"block"`
	Successor       ProofHostExpectedHeader `json:"successor"`
	TransactionType string                  `json:"transactionType"`
	Envelope        string                  `json:"envelope"`
	NativeWire      string                  `json:"nativeWire"`
	TransactionHash string                  `json:"transactionHash"`
	NativeWireHash  string                  `json:"nativeWireHash"`
	Index           string                  `json:"index"`
}

type ProofHostSourceFile struct {
	Role   string `json:"role"`
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
	Bytes  []byte `json:"bytes"`
}

// Public materials only. An export is mathematical DATA, not a Root, running
// process qualification, deployment or permission. The external delivery
// owner writes these bytes exclusively and retains partial/UNKNOWN output.
type ProofHostSourceExport struct {
	Version              string                `json:"version"`
	SourceID             string                `json:"sourceId"`
	Epoch                string                `json:"epoch"`
	SourcePath           string                `json:"sourcePath"`
	SourceSHA256         string                `json:"sourceSHA256"`
	OperationID          string                `json:"operationId"`
	Account              string                `json:"account"`
	NetworkID            string                `json:"networkId"`
	OriginalHash         string                `json:"originalHash"`
	NativeWireHash       string                `json:"nativeWireHash"`
	TransactionHash      string                `json:"transactionHash"`
	Files                []ProofHostSourceFile `json:"files"`
	Proof                json.RawMessage       `json:"proof"`
	SourceReadOnly       bool                  `json:"sourceReadOnly"`
	LedgerProofVerified  bool                  `json:"ledgerProofVerified"`
	NativeRootAuthorized bool                  `json:"nativeRootAuthorized"`
	DeploymentVerified   bool                  `json:"deploymentVerified"`
}

func proofHostSHA(raw []byte) string { h := sha256.Sum256(raw); return hex.EncodeToString(h[:]) }
func proofHostHash(s string) ([]byte, error) {
	b, e := hex.DecodeString(s)
	if e != nil || len(b) != 32 || hex.EncodeToString(b) != s || bytes.Equal(b, make([]byte, 32)) {
		return nil, errors.New("expected nonzero lowercase SHA256")
	}
	return b, nil
}
func proofHostUint(s string, max uint64, zero bool) (uint64, error) {
	n, e := strconv.ParseUint(s, 10, 64)
	if e != nil || strconv.FormatUint(n, 10) != s || n > max || !zero && n == 0 {
		return 0, errors.New("expected bounded canonical decimal string")
	}
	return n, nil
}
func proofHostID(s string) bool {
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
func (h ProofHostExpectedHeader) expectation() (PQLightProofExpectation, error) {
	var e PQLightProofExpectation
	hh, err := proofHostUint(h.HeaderHeight, math.MaxInt64-2, false)
	if err != nil {
		return e, err
	}
	sh, err := proofHostUint(h.StateHeight, math.MaxInt64-2, true)
	if err != nil || sh+1 != hh {
		return e, errors.New("header must commit exact previous state height")
	}
	bh, err := proofHostHash(h.BlockHash)
	if err != nil {
		return e, err
	}
	ah, err := proofHostHash(h.StateAppHash)
	if err != nil {
		return e, err
	}
	if h.ChainID == "" || len(h.ChainID) > 50 {
		return e, errors.New("invalid expected chain")
	}
	return PQLightProofExpectation{ChainID: h.ChainID, HeaderHeight: int64(hh), BlockHash: bh, StateHeight: int64(sh), StateAppHash: ah}, nil
}
func (x ProofHostExpectedTransaction) expectation() (PQTransactionProofExpectation, error) {
	var e PQTransactionProofExpectation
	var err error
	if e.Block, err = x.Block.expectation(); err != nil {
		return e, err
	}
	if e.Successor, err = x.Successor.expectation(); err != nil {
		return e, err
	}
	if e.Block.ChainID != e.Successor.ChainID || e.Successor.HeaderHeight != e.Block.HeaderHeight+1 {
		return e, errors.New("expected adjacent same-chain headers")
	}
	decode := func(s string, max int) ([]byte, error) {
		if len(s) > base64.StdEncoding.EncodedLen(max) {
			return nil, errors.New("oversized expected bytes")
		}
		b, e := base64.StdEncoding.Strict().DecodeString(s)
		if e != nil || len(b) == 0 || base64.StdEncoding.EncodeToString(b) != s {
			return nil, errors.New("expected canonical base64")
		}
		return b, nil
	}
	if e.Envelope, err = decode(x.Envelope, MaxPQContractTransactionBytes); err != nil {
		return e, err
	}
	if e.NativeWire, err = decode(x.NativeWire, chain.MaxPQBatchBytes); err != nil {
		return e, err
	}
	if e.TransactionHash, err = proofHostHash(x.TransactionHash); err != nil {
		return e, err
	}
	if e.NativeWireHash, err = proofHostHash(x.NativeWireHash); err != nil {
		return e, err
	}
	if proofHostSHA(e.Envelope) != x.TransactionHash || proofHostSHA(e.NativeWire) != x.NativeWireHash {
		return e, errors.New("expected original hash mismatch")
	}
	index, err := proofHostUint(x.Index, math.MaxInt32, true)
	if err != nil {
		return e, err
	}
	e.Index = int64(index)
	kind, wire, err := pqTransactionWire(e.Envelope)
	if err != nil || kind != x.TransactionType || !bytes.Equal(wire, e.NativeWire) {
		return e, errors.New("expected exact native wire and normal ABCI envelope")
	}
	e.TransactionType = kind
	return e, nil
}

func DecodeProofHostSourcePlan(raw []byte, pin string) (ProofHostSourcePlan, error) {
	var p ProofHostSourcePlan
	if _, err := proofHostHash(pin); err != nil {
		return p, err
	}
	if len(raw) == 0 || len(raw) > MaxProofHostSourcePlanBytes || proofHostSHA(raw) != pin || pqLightUniqueJSON(raw) != nil || json.Unmarshal(raw, &p) != nil {
		return p, errors.New("invalid independently pinned source plan")
	}
	canonical, err := json.Marshal(p)
	if err != nil || !pqLightJSONEquivalent(raw, canonical) {
		return p, errors.New("unknown, missing or noncanonical source plan fields")
	}
	if p.Version != ProofHostSourcePlanVersion || !proofHostID(p.SourceID) || !proofHostID(p.OperationID) || strings.ContainsAny(p.OperationID, ".:") {
		return p, errors.New("invalid source plan identity")
	}
	if _, err = proofHostUint(p.Epoch, math.MaxUint64, false); err != nil {
		return p, err
	}
	for _, s := range []string{p.MigrationSHA256, p.ConsensusGenesisSHA256, p.OriginalGenesisHash, p.MigrationStateHash, p.EngineAppHash, p.TrustedBlockHash, p.ScheduleHash, p.ScheduleSHA256, p.NetworkID} {
		if _, err = proofHostHash(s); err != nil {
			return p, err
		}
	}
	if p.NetworkID != p.OriginalGenesisHash || p.OriginalHash != "0x"+p.ExpectedTransaction.NativeWireHash {
		return p, errors.New("operation does not bind original native network and wire identity")
	}
	if _, err = proofHostUint(p.EngineHeight, math.MaxInt64-2, false); err != nil {
		return p, err
	}
	if _, err = proofHostUint(p.TrustedHeight, math.MaxInt64-2, false); err != nil {
		return p, err
	}
	if _, err = proofHostUint(p.TrustingPeriodNanoseconds, math.MaxInt64, false); err != nil {
		return p, err
	}
	if _, err = proofHostUint(p.MaxClockDriftNanoseconds, math.MaxInt64, true); err != nil {
		return p, err
	}
	for _, s := range []string{p.TrustLevelNumerator, p.TrustLevelDenominator} {
		if _, err = proofHostUint(s, math.MaxInt64, false); err != nil {
			return p, err
		}
	}
	if p.StateLayout != "atomic-json" && p.StateLayout != "snapshot-journal" && p.StateLayout != "block-journal" {
		return p, errors.New("explicit original state layout required")
	}
	if p.SigningLockKind != "pq-signer" {
		return p, errors.New("postactivation source requires the original PQ signing lock identity")
	}
	for _, s := range []string{p.MigrationFile, p.GenesisFile, p.StateFile, p.CometDataDirectory, p.SigningStatePath, p.ScheduleFile} {
		if !filepath.IsAbs(s) || filepath.Clean(s) != s {
			return p, errors.New("canonical absolute original source path required")
		}
	}
	if p.RuntimePlanFile != "" || p.RuntimePlanHash != "" || p.RuntimePlanSHA256 != "" {
		if !filepath.IsAbs(p.RuntimePlanFile) || filepath.Clean(p.RuntimePlanFile) != p.RuntimePlanFile {
			return p, errors.New("complete runtime source pair required")
		}
		for _, s := range []string{p.RuntimePlanHash, p.RuntimePlanSHA256} {
			if _, err = proofHostHash(s); err != nil {
				return p, err
			}
		}
	}
	e, err := p.ExpectedTransaction.expectation()
	if err != nil {
		return p, err
	}
	if err = proofHostOriginalAccount(p, e); err != nil {
		return p, err
	}
	return p, nil
}

type proofHostOriginal struct {
	path    string
	info    os.FileInfo
	raw     []byte
	file    *os.File
	changed string
	// Bound once by the original constructor, not refreshed by current(). Raw
	// has internal mutable aliases, so every current FD stream is ALSO compared
	// byte-for-byte with raw; this digest alone never proves raw is unchanged.
	heldSHA256 [32]byte
}

func proofHostChangeStamp(stat unix.Stat_t) (string, error) {
	v := reflect.ValueOf(stat)
	for _, name := range []string{"Ctim", "Ctimespec"} {
		s := v.FieldByName(name)
		if s.IsValid() && s.Kind() == reflect.Struct {
			sec, nsec := s.FieldByName("Sec"), s.FieldByName("Nsec")
			if sec.IsValid() && nsec.IsValid() && sec.CanInt() && nsec.CanInt() {
				return strconv.FormatInt(sec.Int(), 10) + ":" + strconv.FormatInt(nsec.Int(), 10), nil
			}
		}
	}
	return "", errors.New("original source change identity unavailable")
}
func openProofHostOriginal(path string, limit int64) (_ *proofHostOriginal, err error) {
	if err = requireInspectionPath(path); err != nil {
		return nil, err
	}
	before, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !before.Mode().IsRegular() || before.Mode().Perm()&0022 != 0 || before.Size() <= 0 || before.Size() > limit {
		return nil, errors.New("invalid bounded immutable public source")
	}
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), "held-public-host-source")
	defer func() {
		if err != nil {
			_ = f.Close()
		}
	}()
	opened, err := f.Stat()
	if err != nil || !samePQStateFile(before, opened) {
		return nil, errors.New("source identity changed before read")
	}
	var stat unix.Stat_t
	if unix.Fstat(fd, &stat) != nil || stat.Nlink != 1 {
		return nil, errors.New("original public source must have one held inode")
	}
	stamp, err := proofHostChangeStamp(stat)
	if err != nil {
		return nil, err
	}
	return &proofHostOriginal{path: path, info: before, file: f, changed: stamp}, nil
}

func readProofHostOriginal(path, pin string, limit int64) (_ *proofHostOriginal, err error) {
	r, err := openProofHostOriginal(path, limit)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = r.file.Close()
		}
	}()
	size := r.info.Size()
	if int64(int(size)) != size {
		return nil, errors.New("source exceeds addressable byte range")
	}
	r.raw = make([]byte, int(size))
	if _, err = io.ReadFull(r.file, r.raw); err != nil {
		return nil, errors.New("source read changed or exceeded bound")
	}
	var trailing [1]byte
	if n, readErr := r.file.Read(trailing[:]); n != 0 || readErr != io.EOF {
		return nil, errors.New("source read changed or exceeded bound")
	}
	r.heldSHA256 = sha256.Sum256(r.raw)
	if err = r.unchanged(); err != nil {
		return nil, err
	}
	if pin != "" && hex.EncodeToString(r.heldSHA256[:]) != pin {
		return nil, errors.New("original source differs from independent SHA256")
	}
	return r, nil
}

func (r *proofHostOriginal) unchanged() error {
	return r.checkCurrent(func(current io.Reader) error {
		if int64(len(r.raw)) != r.info.Size() {
			return errors.New("held original bytes changed")
		}
		_, err := proofHostCompareCurrentBytes(current, r.raw, r.heldSHA256)
		return err
	})
}

func (r *proofHostOriginal) checkCurrent(checkBytes func(io.Reader) error) error {
	now, err := os.Lstat(r.path)
	if err != nil || !samePQStateFile(r.info, now) {
		return errors.New("original source changed during publication")
	}
	held, err := r.file.Stat()
	var stat unix.Stat_t
	if err != nil || !samePQStateFile(r.info, held) || unix.Fstat(int(r.file.Fd()), &stat) != nil || stat.Nlink != 1 {
		return errors.New("held original source identity changed")
	}
	stamp, err := proofHostChangeStamp(stat)
	if err != nil || stamp != r.changed {
		return errors.New("original source change epoch changed")
	}
	if err = checkBytes(io.NewSectionReader(r.file, 0, r.info.Size())); err != nil {
		return err
	}
	after, err := os.Lstat(r.path)
	if err != nil || !samePQStateFile(r.info, after) {
		return errors.New("source replaced during final hash read")
	}
	var final unix.Stat_t
	if unix.Fstat(int(r.file.Fd()), &final) != nil {
		return errors.New("held source final identity unavailable")
	}
	stamp, err = proofHostChangeStamp(final)
	if err != nil || stamp != r.changed || final.Nlink != 1 {
		return errors.New("held source changed during final hash read")
	}
	return nil
}

// Receipt readback authenticates every byte on the held original without
// retaining a copy of the proof body in the persistent live lane.
func verifyProofHostOriginalReceipt(receipt PQLabWorkloadFile, limit int64) (err error) {
	if _, err = proofHostHash(receipt.SHA256); err != nil {
		return err
	}
	r, err := openProofHostOriginal(receipt.Path, limit)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, r.file.Close()) }()
	if strconv.FormatInt(r.info.Size(), 10) != receipt.Bytes {
		return errors.New("live original length mismatch")
	}
	return r.checkCurrent(func(current io.Reader) error {
		digest := sha256.New()
		if n, err := io.Copy(digest, current); err != nil || n != r.info.Size() || hex.EncodeToString(digest.Sum(nil)) != receipt.SHA256 {
			return errors.New("live original bytes changed")
		}
		return nil
	})
}

type proofHostCurrentBytesWriter struct {
	raw    []byte
	offset int
	hash   hash.Hash
}

func (w *proofHostCurrentBytesWriter) Write(p []byte) (int, error) {
	if len(p) > len(w.raw)-w.offset || !bytes.Equal(p, w.raw[w.offset:w.offset+len(p)]) {
		return 0, errors.New("held original bytes changed")
	}
	n, err := w.hash.Write(p)
	w.offset += n
	return n, err
}

// One bounded FD stream still hashes every current byte. Its exact comparison
// also detects mutations through the existing raw/captured-state aliases,
// without rehashing the entire held buffer on every call. io.Copy uses a fixed
// 32 KiB buffer for the SectionReader supplied by unchanged; no file-sized copy
// or reusable permission is retained. The byte count is useful to narrow tests.
func proofHostCompareCurrentBytes(current io.Reader, raw []byte, expected [32]byte) (int64, error) {
	h := sha256.New()
	w := &proofHostCurrentBytesWriter{raw: raw, hash: h}
	n, err := io.Copy(w, current)
	var actual [32]byte
	h.Sum(actual[:0])
	if err != nil || n != int64(len(raw)) || w.offset != len(raw) || actual != expected {
		return n, errors.New("held original bytes changed")
	}
	return n, nil
}

// Retain the exact already-captured state bytes and a held descriptor without
// reading another full checkpoint into memory. The normal layout reader below
// still performs its own strict replay; final hash/ctime checks bind it to this
// original inode rather than trusting only restored size and modification time.
func holdProofHostCapturedState(captured *pqEngineStateRead) (*proofHostOriginal, error) {
	fd, err := unix.Open(captured.path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), "held-original-committed-source")
	ok := false
	defer func() {
		if !ok {
			_ = f.Close()
		}
	}()
	held, err := f.Stat()
	var stat unix.Stat_t
	if err != nil || !samePQStateFile(captured.info, held) || unix.Fstat(fd, &stat) != nil || stat.Nlink != 1 {
		return nil, errors.New("captured original state identity changed")
	}
	stamp, err := proofHostChangeStamp(stat)
	if err != nil {
		return nil, err
	}
	r := &proofHostOriginal{path: captured.path, info: captured.info, raw: captured.data, file: f, changed: stamp, heldSHA256: sha256.Sum256(captured.data)}
	if err = r.unchanged(); err != nil {
		return nil, err
	}
	ok = true
	return r, nil
}

type proofHostInputs struct {
	ctx           context.Context
	plan          ProofHostSourcePlan
	migration     chain.ConsensusMigrationState
	bootstrap     *ConsensusBootstrap
	engine        *PQEngineAuthorization
	runtime       *RuntimeUpgradeAuthorization
	originals     map[string]*proofHostOriginal
	heldMigration *pqLabProofMigration // only the live synthetic owner may lend this
}

func (in *proofHostInputs) contextErr() error {
	if in.ctx != nil {
		return in.ctx.Err()
	}
	return nil
}

func loadProofHostInputs(raw []byte, pin string) (_ *proofHostInputs, resultErr error) {
	p, err := DecodeProofHostSourcePlan(raw, pin)
	if err != nil {
		return nil, err
	}
	return loadProofHostOriginalInputs(p, p.ExpectedTransaction.Block.ChainID)
}

// Shared original-file admission only. Each public entry validates its own
// complete independently pinned plan before calling this private helper.
func loadProofHostOriginalInputs(p ProofHostSourcePlan, chainID string) (*proofHostInputs, error) {
	return loadProofHostInputsWithMigration(p, chainID, nil)
}

func loadProofHostInputsWithMigration(p ProofHostSourcePlan, chainID string, held *pqLabProofMigration) (_ *proofHostInputs, resultErr error) {
	var err error
	in := &proofHostInputs{plan: p, originals: map[string]*proofHostOriginal{}, heldMigration: held}
	defer func() {
		if resultErr != nil {
			resultErr = errors.Join(resultErr, in.close())
		}
	}()
	for _, s := range []struct {
		role, path, pin string
		limit           int64
	}{{"migration", p.MigrationFile, p.MigrationSHA256, maxProofHostMigrationBytes}, {"genesis", p.GenesisFile, p.ConsensusGenesisSHA256, 64 << 20}, {"schedule", p.ScheduleFile, p.ScheduleSHA256, 32 << 10}} {
		if s.role == "migration" && held != nil {
			if err = held.checkPlan(p, chainID); err != nil {
				return nil, err
			}
			in.originals[s.role] = held.original
			continue
		}
		r, e := readProofHostOriginal(s.path, s.pin, s.limit)
		if e != nil {
			return nil, e
		}
		in.originals[s.role] = r
	}
	if held == nil {
		in.migration, err = decodeProofHostMigration(in.originals["migration"].raw)
		if err != nil {
			return nil, err
		}
		in.bootstrap, err = NewConsensusBootstrap(in.originals["genesis"].raw, ConsensusBootstrapPins{p.ConsensusGenesisSHA256, p.OriginalGenesisHash, p.MigrationStateHash}, in.migration)
		if err != nil {
			return nil, err
		}
	} else {
		in.migration, in.bootstrap = held.witness.migration, held.witness.bootstrap
	}
	in.engine, err = NewPQEngineAuthorization(in.originals["schedule"].raw, p.ScheduleHash)
	if err != nil {
		return nil, err
	}
	if p.RuntimePlanFile != "" {
		r, e := readProofHostOriginal(p.RuntimePlanFile, p.RuntimePlanSHA256, MaxRuntimeUpgradePlanBytes)
		if e != nil {
			return nil, e
		}
		in.originals["runtime"] = r
		in.runtime, err = NewRuntimeUpgradeAuthorization(r.raw, p.RuntimePlanHash, in.bootstrap, in.migration)
		if err != nil {
			return nil, err
		}
	}
	if in.bootstrap.record.ChainID != chainID {
		return nil, errors.New("plan chain differs from independently pinned genesis")
	}
	return in, nil
}

// The source has already checked the independently pinned file bytes. The
// complete migration has its own byte limit and must still reject duplicates,
// unknown fields and trailing data before any bootstrap or proof is accepted.
func decodeProofHostMigration(raw []byte) (chain.ConsensusMigrationState, error) {
	if err := proofHostCompleteUniqueJSON(raw, maxProofHostMigrationBytes); err != nil {
		return chain.ConsensusMigrationState{}, fmt.Errorf("duplicate or malformed original migration JSON: %w", err)
	}
	migration, err := chain.ReadConsensusMigrationState(bytes.NewReader(raw))
	if err != nil {
		return chain.ConsensusMigrationState{}, err
	}
	return migration, nil
}

func (in *proofHostInputs) unchanged() error {
	for _, r := range in.originals {
		if e := r.unchanged(); e != nil {
			return e
		}
	}
	return nil
}
func (in *proofHostInputs) close() error {
	var err error
	for _, r := range in.originals {
		if in.heldMigration == nil || r != in.heldMigration.original {
			err = errors.Join(err, r.file.Close())
		}
	}
	return err
}

func (in *proofHostInputs) trust(snapshot *PQEngineSnapshot) PQLightProofTrust {
	p := in.plan
	period, _ := strconv.ParseInt(p.TrustingPeriodNanoseconds, 10, 64)
	drift, _ := strconv.ParseInt(p.MaxClockDriftNanoseconds, 10, 64)
	n, _ := strconv.ParseUint(p.TrustLevelNumerator, 10, 64)
	d, _ := strconv.ParseUint(p.TrustLevelDenominator, 10, 64)
	return PQLightProofTrust{Snapshot: snapshot, TrustingPeriod: time.Duration(period), MaxClockDrift: time.Duration(drift), TrustLevel: cmtmath.Fraction{Numerator: n, Denominator: d}}
}

func proofHostFile(role, name string, raw []byte) ProofHostSourceFile {
	// Inputs are exclusively owned original reads or fresh encodings. Transfer
	// their read-only ownership; copying a complete migration/state here would
	// unnecessarily duplicate hundreds of MB. Callers must not mutate the export
	// concurrently; the delivery writer hashes the actual bytes again.
	return ProofHostSourceFile{Role: role, Name: name, SHA256: proofHostSHA(raw), Bytes: raw}
}
func proofHostJSON(v any) ([]byte, error) { return json.Marshal(v) }
func proofHostDirectory(path string) error {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return errors.New("canonical exclusive public destination required")
	}
	parent := filepath.Dir(path)
	if err := requireInspectionPath(parent); err != nil {
		return err
	}
	if _, e := os.Lstat(path); !os.IsNotExist(e) {
		return errors.New("source export destination already exists or is unknown")
	}
	return nil
}

func (in *proofHostInputs) bundle(output string, state []byte, trusted []byte, proof PQTransactionProofRequest) (ProofHostSourceExport, error) {
	var out ProofHostSourceExport
	if err := in.contextErr(); err != nil {
		return out, err
	}
	if err := proofHostDirectory(output); err != nil {
		return out, err
	}
	p := in.plan
	files := []ProofHostSourceFile{proofHostFile("migration", "migration.json", in.originals["migration"].raw), proofHostFile("genesis", "genesis.json", in.originals["genesis"].raw), proofHostFile("state", "committed-state.json", state), proofHostFile("schedule", "schedule.json", in.originals["schedule"].raw)}
	runtimePath, runtimeSHA := "", ""
	if r := in.originals["runtime"]; r != nil {
		files = append(files, proofHostFile("runtime", "runtime-plan.json", r.raw))
		runtimePath = filepath.Join(output, "runtime-plan.json")
		runtimeSHA = proofHostSHA(r.raw)
	}
	files = append(files, proofHostFile("trustedLightBlock", "trusted-light-block.json", trusted))
	x := p.ExpectedTransaction.Block
	light := map[string]string{"version": "YNX-CONSENSUS-PROOF-TRUST/v1", "chainId": x.ChainID, "migrationFile": filepath.Join(output, "migration.json"), "genesisFile": filepath.Join(output, "genesis.json"), "stateFile": filepath.Join(output, "committed-state.json"), "scheduleFile": filepath.Join(output, "schedule.json"), "scheduleHash": p.ScheduleHash, "consensusGenesisSHA256": p.ConsensusGenesisSHA256, "originalGenesisHash": p.OriginalGenesisHash, "migrationStateHash": p.MigrationStateHash, "runtimePlanFile": runtimePath, "runtimePlanHash": p.RuntimePlanHash, "engineHeight": p.EngineHeight, "engineAppHash": p.EngineAppHash, "expectedHeaderHeight": x.HeaderHeight, "expectedBlockHash": x.BlockHash, "expectedStateHeight": x.StateHeight, "expectedStateAppHash": x.StateAppHash, "trustedLightBlockFile": filepath.Join(output, "trusted-light-block.json"), "trustedLightBlockSHA256": proofHostSHA(trusted), "trustingPeriodNanoseconds": p.TrustingPeriodNanoseconds, "maxClockDriftNanoseconds": p.MaxClockDriftNanoseconds, "trustLevelNumerator": p.TrustLevelNumerator, "trustLevelDenominator": p.TrustLevelDenominator}
	context, err := proofHostJSON(map[string]any{"version": "YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1", "lightTrust": light, "expectedTransaction": p.ExpectedTransaction})
	if err != nil {
		return out, err
	}
	lifecycle, err := proofHostJSON(map[string]string{"version": "YNX-CONSENSUS-PROOF-HOST-LIFECYCLE/v1", "sourceId": p.SourceID, "epoch": p.Epoch, "status": "current"})
	if err != nil {
		return out, err
	}
	source, err := proofHostJSON(map[string]string{"version": "YNX-CONSENSUS-PROOF-HOST-SOURCE/v1", "sourceId": p.SourceID, "epoch": p.Epoch, "contextFile": filepath.Join(output, "trust-context.json"), "contextSHA256": proofHostSHA(context), "lifecycleFile": filepath.Join(output, "lifecycle.json"), "lifecycleSHA256": proofHostSHA(lifecycle), "migrationSHA256": p.MigrationSHA256, "genesisSHA256": p.ConsensusGenesisSHA256, "stateSHA256": proofHostSHA(state), "scheduleSHA256": p.ScheduleSHA256, "runtimePlanSHA256": runtimeSHA, "trustedLightBlockSHA256": proofHostSHA(trusted)})
	if err != nil {
		return out, err
	}
	files = append(files, proofHostFile("context", "trust-context.json", context), proofHostFile("lifecycle", "lifecycle.json", lifecycle), proofHostFile("source", "host-source.json", source))
	rawProof, err := json.Marshal(proof)
	if err != nil {
		return out, err
	}
	out = ProofHostSourceExport{Version: "YNX-PROOF-HOST-SOURCE-EXPORT/v1", SourceID: p.SourceID, Epoch: p.Epoch, SourcePath: filepath.Join(output, "host-source.json"), SourceSHA256: proofHostSHA(source), OperationID: p.OperationID, Account: p.Account, NetworkID: p.NetworkID, OriginalHash: p.OriginalHash, NativeWireHash: p.ExpectedTransaction.NativeWireHash, TransactionHash: p.ExpectedTransaction.TransactionHash, Files: files, Proof: rawProof, SourceReadOnly: true, LedgerProofVerified: true}
	if err = in.unchanged(); err != nil {
		return ProofHostSourceExport{}, fmt.Errorf("publication source changed: %w", err)
	}
	if err = in.contextErr(); err != nil {
		return ProofHostSourceExport{}, err
	}
	return out, nil
}
