//go:build unix

package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	"golang.org/x/sys/unix"
)

type capsuleSource struct {
	Identity capsuleIdentity `json:"identity"`
	SHA256   string          `json:"sha256,omitempty"`
}
type capsuleExportReceipt struct {
	Version                      string                                `json:"version"`
	OperationID                  string                                `json:"operationId"`
	Producer                     capsuleProducer                       `json:"producer"`
	OriginalPaths                ceremonyPaths                         `json:"originalPaths"`
	GenesisSHA256                string                                `json:"genesisSHA256"`
	BindingSHA256                string                                `json:"bindingSHA256"`
	PublicRecordSHA256           string                                `json:"publicRecordSHA256"`
	Sources                      map[string]capsuleSource              `json:"sources"`
	Snapshot                     ynxconsensusauth.HostRecoverySnapshot `json:"snapshot"`
	ExclusiveExistingWriterLease bool                                  `json:"exclusiveExistingWriterLease"`
	OriginalFilesUnchanged       bool                                  `json:"originalFilesUnchanged"`
	OffHostSourceVerified        bool                                  `json:"offHostSourceVerified"`
	AuthorityGranted             bool                                  `json:"authorityGranted"`
	SigningReady                 bool                                  `json:"signingReady"`
}
type capsuleResult struct {
	Version                       string                                `json:"version"`
	OperationID                   string                                `json:"operationId"`
	ManifestSHA256                string                                `json:"manifestSHA256"`
	ArchiveSHA256                 string                                `json:"archiveSHA256"`
	CryptographicRecoveryVerified bool                                  `json:"cryptographicRecoveryVerified"`
	Snapshot                      ynxconsensusauth.HostRecoverySnapshot `json:"snapshot"`
	OffHostSourceVerified         bool                                  `json:"offHostSourceVerified"`
	RegistryMembershipVerified    bool                                  `json:"registryMembershipVerified"`
	AntiRollbackFreshness         bool                                  `json:"antiRollbackFreshness"`
	AuthorityGranted              bool                                  `json:"authorityGranted"`
	SigningReady                  bool                                  `json:"signingReady"`
	RuntimeResume                 bool                                  `json:"runtimeResume"`
	SignaturesProduced            bool                                  `json:"signaturesProduced"`
	EpochCreated                  bool                                  `json:"epochCreated"`
	OriginalHRSWritten            bool                                  `json:"originalHRSWritten"`
}

// Values are parsed as exact option/value pairs. No duplicate flags, positional
// arguments, shorthand or ambient environment can select a protected input.
func capsuleOptions(args []string, allowed, required []string) (map[string]string, error) {
	permit := map[string]bool{}
	for _, k := range allowed {
		permit[k] = true
	}
	values := map[string]string{}
	if len(args)%2 != 0 {
		return nil, errors.New("exact recovery option/value pairs required")
	}
	for i := 0; i < len(args); i += 2 {
		if !permit[args[i]] || args[i+1] == "" {
			return nil, errors.New("unknown or empty recovery option")
		}
		if _, ok := values[args[i]]; ok {
			return nil, errors.New("duplicate recovery option")
		}
		values[args[i]] = args[i+1]
	}
	for _, k := range required {
		if values[k] == "" {
			return nil, errors.New("required independent recovery input not supplied")
		}
	}
	for k, v := range values {
		if len(k) >= 7 && k[len(k)-7:] == "-sha256" && !capsuleHex.MatchString(v) {
			return nil, errors.New("independent lowercase SHA256 required")
		}
		if k == "--producer-binary-sha256" && !capsuleNonzeroSHA256(v) {
			return nil, errors.New("independent nonzero lowercase producer SHA256 required")
		}
	}
	fd, err := strconv.Atoi(values["--recovery-fd"])
	if err != nil || fd < 3 || strconv.Itoa(fd) != values["--recovery-fd"] {
		return nil, errors.New("inherited credential descriptor >=3 required")
	}
	return values, nil
}
func capsuleCredential(value string) ([]byte, error) {
	fd, _ := strconv.Atoi(value)
	file := os.NewFile(uintptr(fd), "inherited-recovery-credential")
	if file == nil {
		return nil, errors.New("inherited recovery descriptor unavailable")
	}
	defer file.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	credential, err := readExternalCredential(ctx, file)
	// readExternalCredential owns no plaintext after returning. Close the inherited
	// descriptor before any KDF/IO work; only this caller owns and clears the bytes.
	closeErr := file.Close()
	if err != nil || closeErr != nil {
		clear(credential)
		return nil, errors.New("exact inherited recovery credential refused")
	}
	return credential, nil
}
func capsuleClose(held []*capsuleHeldFile) {
	for _, h := range held {
		if h != nil && h.file != nil {
			_ = h.file.Close()
		}
	}
}
func capsuleUnchanged(held []*capsuleHeldFile) error {
	for _, h := range held {
		if err := h.unchanged(); err != nil {
			return err
		}
	}
	return nil
}
func capsuleHeld(path string, maximum int64, private bool, held *[]*capsuleHeldFile) ([]byte, error) {
	h, err := capsuleOpen(path, maximum, false, private, false)
	if err != nil {
		return nil, err
	}
	*held = append(*held, h)
	return h.raw, nil
}
func capsulePathsValid(p ceremonyPaths) bool {
	if !capsuleCanonical(p.Directory) || !capsuleCanonical(p.State) {
		return false
	}
	if p.Marker != filepath.Join(p.Directory, "new-epoch-intent.json") || p.Vault != filepath.Join(p.Directory, "validator.encrypted") || p.Binding != filepath.Join(p.Directory, "validator-binding.json") || p.PublicRecord != filepath.Join(p.Directory, "new-epoch-public.json") || filepath.Base(p.State) != "original-sign-state.json" {
		return false
	}
	return filepath.Dir(p.State) == p.Directory || !capsuleOverlaps(p.Directory, filepath.Dir(p.State))
}
func capsuleClosedSource(p ceremonyPaths) error {
	expected := map[string]map[string]bool{p.Directory: {}}
	for _, path := range p.all() {
		dir := filepath.Dir(path)
		if expected[dir] == nil {
			expected[dir] = map[string]bool{}
		}
		expected[dir][filepath.Base(path)] = true
	}
	for dir, names := range expected {
		entries, err := os.ReadDir(dir)
		if err != nil || len(entries) != len(names) {
			return errors.New("original custody has missing, foreign or UNKNOWN files; preserve and reconcile")
		}
		for _, e := range entries {
			if !names[e.Name()] {
				return errors.New("foreign original custody entry refused")
			}
		}
	}
	return nil
}

// Pure public-record verification. Original absolute paths remain authenticated
// data: this function never resolves/opens them on the recovery machine.
func capsuleValidatePublic(contents map[string][]byte, genesis, bindingWire, recordWire []byte) (ceremonyPaths, ynxconsensusauth.HostKeyBinding, error) {
	var p ceremonyPaths
	var binding ynxconsensusauth.HostKeyBinding
	var record publicRecord
	var marker intentMarker
	fail := func() (ceremonyPaths, ynxconsensusauth.HostKeyBinding, error) {
		return p, binding, errors.New("original public epoch, binding or possession differs")
	}
	if !bytes.Equal(bindingWire, contents["epoch/validator-binding.json"]) || !bytes.Equal(recordWire, contents["epoch/new-epoch-public.json"]) || decodeCanonical(bindingWire, &binding) != nil || decodeCanonical(recordWire, &record) != nil || decodeCanonical(contents["epoch/new-epoch-intent.json"], &marker) != nil {
		return fail()
	}
	p = record.Paths
	recordBinding, err := json.Marshal(record.Binding)
	request, requestErr := json.Marshal(marker.Request)
	if err != nil || requestErr != nil || !bytes.Equal(recordBinding, bindingWire) || binding.Validate() != nil || !capsulePathsValid(p) || marker.Paths != p || record.Format != "YNX-CONSENSUS-PQ-CEREMONY-PUBLIC/v1" || record.Status != "new_epoch_files_durable_registration_not_authorized" || marker.Format != "YNX-CONSENSUS-PQ-CEREMONY-INTENT/v1" || marker.RequestHash != hash(request) || marker.GenesisHash != hash(genesis) || marker.GenesisHash != hex.EncodeToString(binding.Policy.GenesisID) || validateEpochRequest(marker.Request, genesis) != nil || len(record.FileSHA256) != 5 {
		return fail()
	}
	for _, pair := range []struct{ path, name string }{{p.Marker, "epoch/new-epoch-intent.json"}, {p.Vault, "epoch/validator.encrypted"}, {p.Binding, "epoch/validator-binding.json"}} {
		if record.FileSHA256[pair.path] != hash(contents[pair.name]) {
			return fail()
		}
	}
	if !capsuleHex.MatchString(record.FileSHA256[p.State]) || record.FileSHA256[p.State+".lock"] != hash(nil) {
		return fail()
	}
	i, err := ynxconsensusauth.DecodeRegistrationIntent(record.IntentWire)
	if err != nil {
		return fail()
	}
	expected := marker.Request.Registration
	expected.MLDSA87PublicKey = binding.MLDSA87PublicKey
	expected.SLHDSASHA2256fPublicKey = binding.SLHDSASHA2256fPublicKey
	wire, err := expected.MarshalBinary()
	if err != nil || !bytes.Equal(wire, record.IntentWire) || !bytes.Equal(i.GenesisID, binding.Policy.GenesisID) || i.ChainID != binding.Policy.ChainID || i.Epoch != binding.Epoch || !bytes.Equal(i.ValidatorAddress, binding.ValidatorAddress) || binding.SignerStatePath != p.State || binding.Policy.ActivationHeight != marker.Request.ActivationHeight {
		return fail()
	}
	message, err := i.PossessionSigningBytes()
	if err != nil {
		return fail()
	}
	provider := ynxconsensusauth.CIRCLProvider{}
	a := provider.VerifyMLDSA87(i.MLDSA87PublicKey, message, record.PossessionA)
	b := provider.VerifySLHDSASHA2256f(i.SLHDSASHA2256fPublicKey, message, record.PossessionB)
	if a != nil || b != nil {
		return fail()
	}
	return p, binding, nil
}
func capsuleSnapshot(contents map[string][]byte, credential []byte, binding ynxconsensusauth.HostKeyBinding, recordWire []byte) (ynxconsensusauth.HostRecoverySnapshot, error) {
	snapshot, err := ynxconsensusauth.VerifyHostRecoverySnapshot(contents["epoch/validator.encrypted"], contents["epoch/original-sign-state.json"], credential, binding)
	if err != nil {
		return snapshot, errors.New("original encrypted vault or complete HRS recovery validation failed")
	}
	var record publicRecord
	if decodeCanonical(recordWire, &record) != nil || snapshot.Height == 0 && snapshot.StateSHA256 != record.FileSHA256[binding.SignerStatePath] {
		return ynxconsensusauth.HostRecoverySnapshot{}, errors.New("initial HRS differs from original public epoch record")
	}
	return snapshot, nil
}

func runExportRecoveryCapsule(args []string, output, diagnostics io.Writer) (resultErr error) {
	required := []string{"--out-dir", "--binding-sha256", "--public-record-sha256", "--genesis", "--genesis-sha256", "--recovery-fd", "--operation-id", "--export-dir"}
	allowed := append(append([]string{}, required...), "--state-dir")
	o, err := capsuleOptions(args, allowed, required)
	if err != nil {
		return err
	}
	if !capsuleOperation.MatchString(o["--operation-id"]) {
		return errors.New("canonical recovery operation identifier required")
	}
	p, err := newPathsWithStateDirectory(o["--out-dir"], o["--state-dir"])
	if err != nil {
		return errors.New("original protected epoch directories required")
	}
	var held []*capsuleHeldFile
	defer func() { capsuleClose(held) }()
	// Hold both directory identities, and the EXISTING normal lock inode. Missing
	// or active locks are refused; no lock, epoch or HRS is created by export.
	dirs := []string{p.Directory}
	if filepath.Dir(p.State) != p.Directory {
		dirs = append(dirs, filepath.Dir(p.State))
	}
	for _, dir := range dirs {
		h, e := capsuleOpen(dir, 0, true, true, true)
		if e != nil {
			return e
		}
		held = append(held, h)
	}
	if err = capsuleClosedSource(p); err != nil {
		return err
	}
	if err = capsuleCreateCase(o["--export-dir"], p.Directory, filepath.Dir(p.State)); err != nil {
		return errors.New("new exclusive export case unavailable; preserve prior attempt")
	}
	stage := "existing-writer-lease"
	defer func() {
		if resultErr != nil {
			capsuleFirstCause(o["--export-dir"], stage)
		}
	}()
	lock, err := capsuleOpen(p.State+".lock", 0, true, true, false)
	if err != nil {
		return err
	}
	held = append(held, lock)
	if unix.Flock(int(lock.file.Fd()), unix.LOCK_EX|unix.LOCK_NB) != nil {
		return errors.New("original signer writer active or exclusive existing lease unavailable")
	}
	defer unix.Flock(int(lock.file.Fd()), unix.LOCK_UN)
	stage = "original-protected-read"
	contents := map[string][]byte{}
	sources := map[string]capsuleSource{}
	for _, spec := range []struct {
		path, name string
		maximum    int64
	}{{p.Vault, "epoch/validator.encrypted", 32768}, {p.Binding, "epoch/validator-binding.json", 256 << 10}, {p.State, "epoch/original-sign-state.json", 2 << 20}, {p.PublicRecord, "epoch/new-epoch-public.json", 256 << 10}, {p.Marker, "epoch/new-epoch-intent.json", 256 << 10}} {
		raw, e := capsuleHeld(spec.path, spec.maximum, true, &held)
		if e != nil {
			return e
		}
		contents[spec.name] = raw
	}
	for _, h := range held {
		digest := "" // Directory identity is metadata, not a hash of directory bytes.
		if h.id.Mode&uint32(os.ModeDir) == 0 {
			digest = hash(h.raw)
		}
		sources[h.path] = capsuleSource{h.id, digest}
	}
	genesis, err := capsuleHeld(o["--genesis"], 64<<20, false, &held)
	if err != nil || !pinMatches(genesis, o["--genesis-sha256"]) || !pinMatches(contents["epoch/validator-binding.json"], o["--binding-sha256"]) || !pinMatches(contents["epoch/new-epoch-public.json"], o["--public-record-sha256"]) {
		return errors.New("independent original public input pin differs")
	}
	stage = "public-origin-validation"
	actual, binding, err := capsuleValidatePublic(contents, genesis, contents["epoch/validator-binding.json"], contents["epoch/new-epoch-public.json"])
	if err != nil || actual != p {
		return errors.New("original complete public epoch validation failed")
	}
	exe, err := os.Executable()
	if err != nil {
		return errors.New("producer binary identity unavailable")
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return errors.New("producer binary identity unavailable")
	}
	binary, err := capsuleHeld(exe, 128<<20, false, &held)
	if err != nil {
		return errors.New("producer binary identity unavailable")
	}
	producer := capsuleProducer{"ynx-consensus-pq-key-init", capsuleContract, hash(binary)}
	stage = "credential-and-complete-recovery"
	credential, err := capsuleCredential(o["--recovery-fd"])
	if err != nil {
		return err
	}
	defer clear(credential)
	snapshot, err := capsuleSnapshot(contents, credential, binding, contents["epoch/new-epoch-public.json"])
	clear(credential)
	if err != nil {
		return err
	}
	stage = "source-final-snapshot"
	if err = capsuleClosedSource(p); err != nil {
		return err
	}
	if err = capsuleUnchanged(held); err != nil {
		return err
	}
	receipt := capsuleExportReceipt{Version: capsuleContract, OperationID: o["--operation-id"], Producer: producer, OriginalPaths: p, GenesisSHA256: hash(genesis), BindingSHA256: o["--binding-sha256"], PublicRecordSHA256: o["--public-record-sha256"], Sources: sources, Snapshot: snapshot, ExclusiveExistingWriterLease: true, OriginalFilesUnchanged: true}
	contents["public/export-receipt.json"], err = capsuleJSONBytes(receipt)
	if err != nil {
		return err
	}
	manifest := capsuleManifest{Schema: "YNX_OFFHOST_RECOVERY_RECEIVE/v1", OperationID: o["--operation-id"], Purpose: "NORMAL_ENCRYPTED_BACKUP_TRANSPORT", Producer: producer, Epoch: capsuleEpoch{binding.Policy.ChainID, binding.Epoch, hash(genesis)}}
	for _, spec := range capsuleCatalog {
		raw := contents[spec.path]
		manifest.Members = append(manifest.Members, capsuleMember{spec.path, spec.kind, len(raw), hash(raw)})
	}
	manifestWire, err := capsuleJSONBytes(manifest)
	if err != nil {
		return err
	}
	archive, err := capsuleArchive(contents)
	if err != nil {
		return err
	}
	stage = "exclusive-archive-write"
	if err = writeExclusive(filepath.Join(o["--export-dir"], "capsule.tar"), archive); err != nil {
		return errors.New("archive persistence uncertain; retain original case")
	}
	if err = writeExclusive(filepath.Join(o["--export-dir"], "MANIFEST.json"), manifestWire); err != nil {
		return errors.New("manifest persistence uncertain; retain original case")
	}
	for _, item := range []struct {
		name string
		raw  []byte
	}{{"capsule.tar", archive}, {"MANIFEST.json", manifestWire}} {
		written, readErr := capsuleHeld(filepath.Join(o["--export-dir"], item.name), capsuleMaxArchive, true, &held)
		if readErr != nil || !bytes.Equal(written, item.raw) {
			return errors.New("exclusive export readback differs; retain original case")
		}
	}
	if err = capsuleClosedSource(p); err != nil {
		return err
	}
	if err = capsuleUnchanged(held); err != nil {
		return err
	}
	result := capsuleResult{Version: capsuleContract, OperationID: manifest.OperationID, ManifestSHA256: hash(manifestWire), ArchiveSHA256: hash(archive), CryptographicRecoveryVerified: true, Snapshot: snapshot}
	wire, err := capsuleJSONBytes(result)
	if err != nil {
		return err
	}
	if err = writeExclusive(filepath.Join(o["--export-dir"], "RESULT.json"), wire); err != nil {
		return errors.New("export result persistence uncertain; retain original case")
	}
	if err = capsuleUnchanged(held); err != nil {
		return err
	}
	_, err = output.Write(wire)
	return err
}

func runVerifyRecoveryCapsule(args []string, output, diagnostics io.Writer) (resultErr error) {
	required := []string{"--archive", "--archive-sha256", "--manifest", "--manifest-sha256", "--binding", "--binding-sha256", "--public-record", "--public-record-sha256", "--genesis", "--genesis-sha256", "--producer-binary-sha256", "--recovery-fd", "--scratch-dir"}
	o, err := capsuleOptions(args, required, required)
	if err != nil {
		return err
	}
	var held []*capsuleHeldFile
	defer func() { capsuleClose(held) }()
	wires := map[string][]byte{}
	for _, input := range []struct {
		key string
		max int64
	}{{"--archive", capsuleMaxArchive}, {"--manifest", 256 << 10}, {"--binding", 256 << 10}, {"--public-record", 256 << 10}, {"--genesis", 64 << 20}} {
		raw, e := capsuleHeld(o[input.key], input.max, false, &held)
		if e != nil || !pinMatches(raw, o[input.key+"-sha256"]) {
			return errors.New("independent recovery input readback or pin differs")
		}
		wires[input.key] = raw
	}
	var manifest capsuleManifest
	if capsuleJSON(wires["--manifest"], &manifest) != nil || manifest.Producer.BinarySHA256 != o["--producer-binary-sha256"] {
		return errors.New("independently pinned original producer differs")
	}
	contents, err := capsuleReadArchive(wires["--archive"], manifest)
	if err != nil {
		return err
	}
	p, binding, err := capsuleValidatePublic(contents, wires["--genesis"], wires["--binding"], wires["--public-record"])
	if err != nil {
		return err
	}
	if manifest.Epoch != (capsuleEpoch{binding.Policy.ChainID, binding.Epoch, hash(wires["--genesis"])}) {
		return errors.New("manifest epoch differs from independent original genesis/binding")
	}
	if err = capsuleCreateCase(o["--scratch-dir"], p.Directory, filepath.Dir(p.State)); err != nil {
		return errors.New("new exclusive isolated recovery case unavailable; preserve prior attempt")
	}
	stage := "credential-and-complete-recovery"
	defer func() {
		if resultErr != nil {
			capsuleFirstCause(o["--scratch-dir"], stage)
		}
	}()
	credential, err := capsuleCredential(o["--recovery-fd"])
	if err != nil {
		return err
	}
	defer clear(credential)
	snapshot, err := capsuleSnapshot(contents, credential, binding, wires["--public-record"])
	clear(credential)
	if err != nil {
		return err
	}
	stage = "producer-receipt-validation"
	var receipt capsuleExportReceipt
	if capsuleJSON(contents["public/export-receipt.json"], &receipt) != nil || receipt.Version != capsuleContract || receipt.OperationID != manifest.OperationID || receipt.Producer != manifest.Producer || receipt.OriginalPaths != p || receipt.GenesisSHA256 != hash(wires["--genesis"]) || receipt.BindingSHA256 != hash(wires["--binding"]) || receipt.PublicRecordSHA256 != hash(wires["--public-record"]) || !reflect.DeepEqual(receipt.Snapshot, snapshot) || !receipt.ExclusiveExistingWriterLease || !receipt.OriginalFilesUnchanged || receipt.OffHostSourceVerified || receipt.AuthorityGranted || receipt.SigningReady {
		return errors.New("original complete producer receipt differs")
	}
	sourceNames := map[string]string{p.Vault: "epoch/validator.encrypted", p.Binding: "epoch/validator-binding.json", p.State: "epoch/original-sign-state.json", p.PublicRecord: "epoch/new-epoch-public.json", p.Marker: "epoch/new-epoch-intent.json", p.State + ".lock": ""}
	directoryCount := 1
	if filepath.Dir(p.State) != p.Directory {
		directoryCount = 2
	}
	if len(receipt.Sources) != len(sourceNames)+directoryCount {
		return errors.New("original source identity catalog differs")
	}
	for path, name := range sourceNames {
		source, ok := receipt.Sources[path]
		if !ok || source.SHA256 != hash(contents[name]) || source.Identity.Bytes != int64(len(contents[name])) || source.Identity.Links != 1 || source.Identity.Mode != 0600 {
			return errors.New("original source snapshot identity differs")
		}
	}
	for _, dir := range []string{p.Directory, filepath.Dir(p.State)} {
		s, ok := receipt.Sources[dir]
		if !ok || s.Identity.Mode != uint32(os.ModeDir|0700) || s.SHA256 != "" {
			return errors.New("original source directory identity differs")
		}
	}
	if err = capsuleUnchanged(held); err != nil {
		return err
	}
	// Only authenticated ciphertext and COMPLETE verified public state are written.
	// Original absolute HRS AAD is not rewritten to this scratch location.
	stage = "isolated-ciphertext-public-readback"
	for _, dir := range []string{"epoch", "public"} {
		if err = os.Mkdir(filepath.Join(o["--scratch-dir"], dir), 0700); err != nil {
			return errors.New("isolated recovery directory persistence uncertain")
		}
	}
	for _, spec := range capsuleCatalog {
		path := filepath.Join(o["--scratch-dir"], filepath.FromSlash(spec.path))
		if err = writeExclusive(path, contents[spec.path]); err != nil {
			return errors.New("isolated recovery readback persistence uncertain")
		}
		raw, e := capsuleHeld(path, int64(spec.maximum), true, &held)
		if e != nil || !bytes.Equal(raw, contents[spec.path]) {
			return errors.New("isolated encrypted/public readback differs")
		}
	}
	result := capsuleResult{Version: capsuleContract, OperationID: manifest.OperationID, ManifestSHA256: hash(wires["--manifest"]), ArchiveSHA256: hash(wires["--archive"]), CryptographicRecoveryVerified: true, Snapshot: snapshot}
	wire, err := capsuleJSONBytes(result)
	if err != nil {
		return err
	}
	if err = writeExclusive(filepath.Join(o["--scratch-dir"], "RESULT.json"), wire); err != nil {
		return errors.New("recovery result persistence uncertain")
	}
	if err = capsuleUnchanged(held); err != nil {
		return err
	}
	_, err = output.Write(wire)
	return err
}
