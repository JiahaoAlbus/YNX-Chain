//go:build unix

package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	"github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

type initFixture struct {
	options    options
	request    epochRequest
	paths      ceremonyPaths
	credential []byte
	legacy     ed25519.PrivKey
}

func fixture(t *testing.T) *initFixture {
	t.Helper()
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	dir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatal(err)
	}
	files := t.TempDir()
	legacy := ed25519.GenPrivKey()
	pub := legacy.PubKey()
	doc := cmttypes.GenesisDoc{ChainID: "ynx-pq-init-isolated-test", InitialHeight: 1, GenesisTime: time.Unix(1700000000, 0).UTC(), ConsensusParams: cmttypes.DefaultConsensusParams(), Validators: []cmttypes.GenesisValidator{{Address: pub.Address(), PubKey: pub, Power: 10, Name: "isolated-original-validator"}}}
	raw, err := cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	genesis := filepath.Join(files, "genesis.json")
	if err = os.WriteFile(genesis, raw, 0600); err != nil {
		t.Fatal(err)
	}
	genesisID := mustHex(t, hash(raw))
	request := epochRequest{Format: requestFormat, ChainID: doc.ChainID, ValidatorAddress: bytes.Clone(pub.Address()), Epoch: 1, ActivationHeight: 100, Registration: ynxconsensusauth.RegistrationIntent{Kind: ynxconsensusauth.RegisterValidator, GenesisID: genesisID, ChainID: doc.ChainID, ValidatorAddress: bytes.Clone(pub.Address()), Sequence: 1, Epoch: 1, ApprovedAt: 10, EffectiveAt: 12, PreviousEventHash: make([]byte, 32), LegacyEd25519PublicKey: bytes.Clone(pub.Bytes())}}
	requestWire, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	requestPath := filepath.Join(files, "request.json")
	if err = os.WriteFile(requestPath, requestWire, 0600); err != nil {
		t.Fatal(err)
	}
	p, err := newPaths(dir)
	if err != nil {
		t.Fatal(err)
	}
	credential, err := ynxconsensusauth.GenerateHostRecoveryCredential()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { clear(credential); clear(legacy) })
	return &initFixture{options: options{newEpoch: true, request: requestPath, requestHash: hash(requestWire), genesis: genesis, genesisHash: hash(raw), directory: dir, credentialFD: -1}, request: request, paths: p, credential: credential, legacy: legacy}
}

func mustHex(t *testing.T, value string) []byte {
	t.Helper()
	// Keep fixture genesis conversion independent of production pin matching.
	var out []byte
	for i := 0; i < len(value); i += 2 {
		v, err := strconv.ParseUint(value[i:i+2], 16, 8)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, byte(v))
	}
	return out
}

func credentialDescriptor(t *testing.T, raw []byte) int {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = w.Write(raw); err != nil {
		r.Close()
		w.Close()
		t.Fatal(err)
	}
	w.Close()
	fd, err := syscall.Dup(int(r.Fd()))
	r.Close()
	if err != nil {
		t.Fatal(err)
	}
	return fd
}

func (f *initFixture) args(fd int) []string {
	return []string{"--new-epoch", "--request", f.options.request, "--request-sha256", f.options.requestHash, "--genesis", f.options.genesis, "--genesis-sha256", f.options.genesisHash, "--out-dir", f.paths.Directory, "--recovery-fd", strconv.Itoa(fd)}
}

func runFixture(t *testing.T, f *initFixture, disk ceremonyIO) ([]byte, error) {
	t.Helper()
	fd := credentialDescriptor(t, f.credential)
	var out, diagnostics bytes.Buffer
	err := run(f.args(fd), &out, &diagnostics, disk)
	if bytes.Contains(out.Bytes(), f.credential) || bytes.Contains(diagnostics.Bytes(), f.credential) || bytes.Contains(out.Bytes(), []byte(base64.RawURLEncoding.EncodeToString(f.credential))) {
		t.Fatal("credential reached public output")
	}
	return out.Bytes(), err
}

func TestPQKeyInitRealNewEpochPublicPoPAndResumeOnly(t *testing.T) {
	f := fixture(t)
	out, err := runFixture(t, f, realCeremonyIO())
	if err != nil {
		t.Fatal(err)
	}
	var record publicRecord
	if err = json.Unmarshal(out, &record); err != nil {
		t.Fatal(err)
	}
	if record.Status != "new_epoch_files_durable_registration_not_authorized" || len(record.Binding.MLDSA87PublicKey) != ynxconsensusauth.MLDSA87PublicKeySize || len(record.Binding.SLHDSASHA2256fPublicKey) != ynxconsensusauth.SLHDSASHA2256fPublicKeySize || len(record.PossessionA) != ynxconsensusauth.MLDSA87SignatureSize || len(record.PossessionB) != ynxconsensusauth.SLHDSASHA2256fSignatureSize {
		t.Fatal("normal entry omitted complete public material or proofs")
	}
	for _, path := range f.paths.all() {
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatal("missing private-mode original file", path, err)
		}
	}
	report, err := inspectCeremony(f.paths.Directory)
	if err != nil || report.Status != "complete_original_public_hashes_and_possession_observed" || !report.ReadOnly || report.PrivateMaterialOpened || report.RegistrationAuthorized {
		t.Fatal("inspection invented authority or missed original files", err)
	}
	before := snapshotFiles(t, f.paths)
	if _, err = runFixture(t, f, realCeremonyIO()); !errors.Is(err, errRetained) {
		t.Fatal("second new-epoch invocation did not refuse originals", err)
	}
	assertFilesEqual(t, before, snapshotFiles(t, f.paths))
	empty, err := ynxconsensusauth.NewKeyHistory(ynxconsensusauth.RegistryAnchor{GenesisID: f.request.Registration.GenesisID, ChainID: f.request.ChainID})
	if err != nil {
		t.Fatal(err)
	}
	host, err := ynxconsensusauth.ResumeHostSigner(f.paths.Vault, f.credential, record.Binding, empty)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := host.Signer()
	if err != nil {
		t.Fatal(err)
	}
	vote := &cmtproto.Vote{Type: cmtproto.PrecommitType, Height: 100, Round: 0, ValidatorAddress: bytes.Clone(f.request.ValidatorAddress), ValidatorIndex: 0, BlockID: cmtproto.BlockID{Hash: bytes.Repeat([]byte{7}, 32), PartSetHeader: cmtproto.PartSetHeader{Total: 1, Hash: bytes.Repeat([]byte{8}, 32)}}, Timestamp: time.Unix(1700000100, 0).UTC()}
	request, err := ynxconsensusauth.NewVoteRequestV2(f.request.Registration.GenesisID, f.request.ChainID, vote)
	if err != nil {
		t.Fatal(err)
	}
	if signature, err := signer.Sign(request); err == nil || len(signature) != 0 {
		t.Fatal("empty genesis anchor authorized consensus signing")
	}
	host.Close()
	assertFilesEqual(t, before, snapshotFiles(t, f.paths))
	// Real old-key approval plus both new PoPs enter the real pure immutable
	// registry. The fixture source is the pinned original QA member at H=10;
	// this is not an ABCI commit or deployment assertion.
	i, err := ynxconsensusauth.DecodeRegistrationIntent(record.IntentWire)
	if err != nil {
		t.Fatal(err)
	}
	message, err := i.AuthoritySigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	approval, err := f.legacy.Sign(message)
	if err != nil {
		t.Fatal(err)
	}
	op := ynxconsensusauth.Registration{Intent: i, LegacyApproval: approval, PossessionMLDSA87: record.PossessionA, PossessionSLHDSASHA2256f: record.PossessionB}
	wire, err := op.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	history, err := empty.Append(wire, 10, initMembership{f.request})
	if err != nil {
		t.Fatal(err)
	}
	host, err = ynxconsensusauth.ResumeHostSigner(f.paths.Vault, f.credential, record.Binding, history)
	if err != nil {
		t.Fatal(err)
	}
	defer host.Close()
	signer, err = host.Signer()
	if err != nil {
		t.Fatal(err)
	}
	sig, err := signer.Sign(request)
	if err != nil {
		t.Fatal(err)
	}
	verifier, err := ynxconsensusauth.NewCIRCLVerifier(record.Binding.Policy, history, nil)
	if err != nil || verifier.Verify(request, sig) != nil {
		t.Fatal("normal initialized vault could not use original HRS after real registration proofs", err)
	}
}

func TestPQKeyInitRotationCreatesFreshPairBoundToCompleteOriginalIntent(t *testing.T) {
	f := fixture(t)
	old, a, b, err := ynxconsensusauth.GenerateCandidateKey()
	if err != nil {
		t.Fatal(err)
	}
	defer old.Destroy()
	r := f.request
	r.Epoch = 2
	r.Registration.Kind = ynxconsensusauth.RotateValidator
	r.Registration.Sequence = 2
	r.Registration.AuthorizingEpoch = 1
	r.Registration.Epoch = 2
	r.Registration.ApprovedAt, r.Registration.EffectiveAt = 200, 202
	r.Registration.PreviousEventHash = bytes.Repeat([]byte{0x37}, 32)
	r.Registration.LegacyEd25519PublicKey = nil
	r.Registration.AuthorityMLDSA87PublicKey, r.Registration.AuthoritySLHDSASHA2256fPublicKey = a, b
	wire, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(f.options.request, wire, 0600); err != nil {
		t.Fatal(err)
	}
	f.options.requestHash = hash(wire)
	out, err := runFixture(t, f, realCeremonyIO())
	if err != nil {
		t.Fatal(err)
	}
	var record publicRecord
	if err = json.Unmarshal(out, &record); err != nil {
		t.Fatal(err)
	}
	intent, err := ynxconsensusauth.DecodeRegistrationIntent(record.IntentWire)
	if err != nil {
		t.Fatal(err)
	}
	if intent.Kind != ynxconsensusauth.RotateValidator || record.Binding.Epoch != 2 || !bytes.Equal(intent.PreviousEventHash, r.Registration.PreviousEventHash) || !bytes.Equal(intent.AuthorityMLDSA87PublicKey, a) || !bytes.Equal(intent.AuthoritySLHDSASHA2256fPublicKey, b) || bytes.Equal(intent.MLDSA87PublicKey, a) || bytes.Equal(intent.SLHDSASHA2256fPublicKey, b) {
		t.Fatal("rotation lost full prior binding or reused an old pair")
	}
	report, err := inspectCeremony(f.paths.Directory)
	if err != nil || report.Status != "complete_original_public_hashes_and_possession_observed" || report.RegistrationAuthorized {
		t.Fatal("rotation possession was not independently checked", err)
	}
	// No current-authority approval was manufactured by a new-key ceremony.
	if _, err = (ynxconsensusauth.Registration{Intent: intent, PossessionMLDSA87: record.PossessionA, PossessionSLHDSASHA2256f: record.PossessionB}).MarshalBinary(); err == nil {
		t.Fatal("new-key-only rotation became an admissible registration")
	}
}

type initMembership struct{ request epochRequest }

func (m initMembership) ConsensusRegistrationStateAt(genesis []byte, chain string, address []byte, height int64) (ynxconsensusauth.RegistrationState, error) {
	i := m.request.Registration
	if !bytes.Equal(genesis, i.GenesisID) || chain != i.ChainID || !bytes.Equal(address, i.ValidatorAddress) || height != i.ApprovedAt {
		return ynxconsensusauth.RegistrationState{}, errors.New("wrong original QA membership request")
	}
	return ynxconsensusauth.RegistrationState{GenesisID: bytes.Clone(genesis), ChainID: chain, ValidatorAddress: bytes.Clone(address), Height: height, VotingPower: 10, LegacyEd25519PublicKey: bytes.Clone(i.LegacyEd25519PublicKey)}, nil
}

func snapshotFiles(t *testing.T, p ceremonyPaths) map[string][]byte {
	t.Helper()
	out := map[string][]byte{}
	for _, path := range p.all() {
		raw, err := os.ReadFile(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		out[path] = raw
	}
	return out
}
func assertFilesEqual(t *testing.T, a, b map[string][]byte) {
	t.Helper()
	if len(a) != len(b) {
		t.Fatal("original file inventory changed")
	}
	for path, raw := range a {
		if !bytes.Equal(raw, b[path]) {
			t.Fatal("original file changed", path)
		}
	}
}

func TestPQKeyInitPartialAndUnknownPreserveOriginalFiles(t *testing.T) {
	for _, stage := range []string{"marker-partial", "binding-before", "binding-unknown", "vault-partial", "vault-unknown", "lock-unknown", "hrs-unknown", "record-partial", "record-unknown"} {
		t.Run(stage, func(t *testing.T) {
			f := fixture(t)
			disk := realCeremonyIO()
			realWrite := disk.writeExclusive
			disk.writeExclusive = func(path string, raw []byte) error {
				match := path == f.paths.Marker && stage == "marker-partial" || path == f.paths.Binding && (stage == "binding-before" || stage == "binding-unknown") || path == f.paths.Vault && (stage == "vault-partial" || stage == "vault-unknown") || path == f.paths.State+".lock" && stage == "lock-unknown" || path == f.paths.PublicRecord && (stage == "record-partial" || stage == "record-unknown")
				if !match {
					return realWrite(path, raw)
				}
				if stage == "binding-before" {
					return errors.New("isolated pre-create filesystem failure")
				}
				if stage == "marker-partial" || stage == "vault-partial" || stage == "record-partial" {
					raw = raw[:len(raw)/2]
				}
				if err := realWrite(path, raw); err != nil {
					return err
				}
				return ynxconsensusauth.ErrSignerDurabilityUncertain
			}
			if stage == "hrs-unknown" {
				realCreate := disk.createState
				disk.createState = func(path string, key *ynxconsensusauth.CandidateKey, policy ynxconsensusauth.Policy, registry ynxconsensusauth.Registry, address []byte, epoch uint64) (*ynxconsensusauth.Signer, error) {
					signer, err := realCreate(path, key, policy, registry, address, epoch)
					if err != nil {
						return signer, err
					}
					return signer, ynxconsensusauth.ErrSignerDurabilityUncertain
				}
			}
			out, err := runFixture(t, f, disk)
			if err == nil || !errors.Is(err, errRetained) || len(out) != 0 {
				t.Fatal("partial ceremony exposed a success result", err)
			}
			if stage != "binding-before" && !errors.Is(err, ynxconsensusauth.ErrSignerDurabilityUncertain) {
				t.Fatal("UNKNOWN cause was lost", err)
			}
			before := snapshotFiles(t, f.paths)
			if _, ok := before[f.paths.Marker]; !ok {
				t.Fatal("exclusion marker removed after failure")
			}
			if _, err = runFixture(t, f, realCeremonyIO()); !errors.Is(err, errRetained) {
				t.Fatal("partial originals were regenerated", err)
			}
			assertFilesEqual(t, before, snapshotFiles(t, f.paths))
			report, err := inspectCeremony(f.paths.Directory)
			if err != nil {
				t.Fatal(err)
			}
			if stage == "record-unknown" {
				if report.Status != "complete_original_public_hashes_and_possession_observed" {
					t.Fatal("original completed UNKNOWN cannot be reconciled by readback")
				}
			} else if report.Status != "incomplete_or_uncertain_original_result" {
				t.Fatal("partial ceremony became complete")
			}
			assertFilesEqual(t, before, snapshotFiles(t, f.paths))
			if stage == "hrs-unknown" {
				var binding ynxconsensusauth.HostKeyBinding
				if err = decodeCanonical(before[f.paths.Binding], &binding); err != nil {
					t.Fatal(err)
				}
				empty, err := ynxconsensusauth.NewKeyHistory(ynxconsensusauth.RegistryAnchor{GenesisID: binding.Policy.GenesisID, ChainID: binding.Policy.ChainID})
				if err != nil {
					t.Fatal(err)
				}
				host, err := ynxconsensusauth.ResumeHostSigner(f.paths.Vault, f.credential, binding, empty)
				if err != nil {
					t.Fatal("original HRS UNKNOWN could not resume without regeneration", err)
				}
				host.Close()
				assertFilesEqual(t, before, snapshotFiles(t, f.paths))
			}
		})
	}
}

func TestPQKeyInitRejectsInvalidIntentBeforeAnyOutput(t *testing.T) {
	for _, name := range []string{"no-explicit-new", "wrong-request-pin", "wrong-genesis-pin", "genesis-chain", "wrong-address", "old-key", "supplied-new-key", "wrong-epoch", "unsupported-kind", "zero-activation", "h-plus-one", "duplicate-json", "unknown-json", "trailing-json", "credential31", "credential33", "public-directory"} {
		t.Run(name, func(t *testing.T) {
			f := fixture(t)
			request := f.request
			switch name {
			case "genesis-chain":
				request.ChainID += "other"
				request.Registration.ChainID = request.ChainID
			case "wrong-address":
				request.ValidatorAddress = bytes.Repeat([]byte{9}, 20)
				request.Registration.ValidatorAddress = bytes.Clone(request.ValidatorAddress)
			case "old-key":
				request.Registration.LegacyEd25519PublicKey = bytes.Repeat([]byte{6}, 32)
			case "supplied-new-key":
				request.Registration.MLDSA87PublicKey = make([]byte, ynxconsensusauth.MLDSA87PublicKeySize)
			case "wrong-epoch":
				request.Epoch = 2
			case "unsupported-kind":
				request.Registration.Kind = ynxconsensusauth.RevokeValidator
			case "zero-activation":
				request.ActivationHeight = 0
			case "h-plus-one":
				request.Registration.EffectiveAt = 11
			}
			raw, err := json.Marshal(request)
			if err != nil {
				t.Fatal(err)
			}
			switch name {
			case "duplicate-json":
				raw = append([]byte(`{"format":"ignored",`), raw[1:]...)
			case "unknown-json":
				raw = append([]byte(`{"autoReset":true,`), raw[1:]...)
			case "trailing-json":
				raw = append(raw, []byte(`{}`)...)
			}
			if err = os.WriteFile(f.options.request, raw, 0600); err != nil {
				t.Fatal(err)
			}
			f.options.requestHash = hash(raw)
			if name == "wrong-request-pin" {
				f.options.requestHash = string(bytes.Repeat([]byte{'a'}, 64))
			}
			if name == "wrong-genesis-pin" {
				f.options.genesisHash = string(bytes.Repeat([]byte{'b'}, 64))
			}
			credential := f.credential
			if name == "credential31" {
				credential = credential[:31]
			}
			if name == "credential33" {
				credential = append(bytes.Clone(credential), 0)
				defer clear(credential)
			}
			if name == "public-directory" {
				os.Chmod(f.paths.Directory, 0755)
			}
			fd := credentialDescriptor(t, credential)
			args := f.args(fd)
			if name == "no-explicit-new" {
				args = args[1:]
			}
			var out bytes.Buffer
			err = run(args, &out, io.Discard, realCeremonyIO())
			if err == nil || out.Len() != 0 {
				t.Fatal("invalid new epoch accepted")
			}
			if files := snapshotFiles(t, f.paths); len(files) != 0 {
				t.Fatal("rejected preflight created output files")
			}
		})
	}
}

func TestPQKeyInitAnyExistingTargetAndSymlinkRefusesWithoutMutation(t *testing.T) {
	for _, name := range []string{"marker", "vault", "binding", "state", "lock", "record", "dangling-symlink"} {
		t.Run(name, func(t *testing.T) {
			f := fixture(t)
			path := map[string]string{"marker": f.paths.Marker, "vault": f.paths.Vault, "binding": f.paths.Binding, "state": f.paths.State, "lock": f.paths.State + ".lock", "record": f.paths.PublicRecord, "dangling-symlink": f.paths.Vault}[name]
			original := []byte("existing-original-must-not-be-touched")
			if name == "dangling-symlink" {
				if err := os.Symlink(filepath.Join(t.TempDir(), "missing"), path); err != nil {
					t.Fatal(err)
				}
			} else if err := os.WriteFile(path, original, 0600); err != nil {
				t.Fatal(err)
			}
			out, err := runFixture(t, f, realCeremonyIO())
			if err == nil || !errors.Is(err, errRetained) || len(out) != 0 {
				t.Fatal("existing target accepted", err)
			}
			if name == "dangling-symlink" {
				if info, err := os.Lstat(path); err != nil || info.Mode()&os.ModeSymlink == 0 {
					t.Fatal("existing symlink changed")
				}
			} else if raw, err := os.ReadFile(path); err != nil || !bytes.Equal(raw, original) {
				t.Fatal("existing original replaced", err)
			}
		})
	}
}

func TestPQKeyInitInspectionCannotRepairOrAuthorizeTamperedProof(t *testing.T) {
	f := fixture(t)
	out, err := runFixture(t, f, realCeremonyIO())
	if err != nil {
		t.Fatal(err)
	}
	var record publicRecord
	if err = json.Unmarshal(out, &record); err != nil {
		t.Fatal(err)
	}
	record.PossessionB[0] ^= 1
	wire, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(f.paths.PublicRecord, wire, 0600); err != nil {
		t.Fatal(err)
	}
	before := snapshotFiles(t, f.paths)
	var printed bytes.Buffer
	if err = run([]string{"--inspect", "--out-dir", f.paths.Directory}, &printed, io.Discard, realCeremonyIO()); err != nil {
		t.Fatal(err)
	}
	var report inspection
	if err = json.Unmarshal(printed.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	if report.Status != "incomplete_or_uncertain_original_result" || report.RegistrationAuthorized || report.PrivateMaterialOpened {
		t.Fatal("tampered public proof accepted")
	}
	assertFilesEqual(t, before, snapshotFiles(t, f.paths))
}

type failedPublicOutput struct{}

func (failedPublicOutput) Write([]byte) (int, error) {
	return 0, errors.New("isolated public output failure")
}

func TestPQKeyInitOutputFailureRetainsTheCompletedOriginalResult(t *testing.T) {
	f := fixture(t)
	fd := credentialDescriptor(t, f.credential)
	if err := run(f.args(fd), failedPublicOutput{}, io.Discard, realCeremonyIO()); err == nil {
		t.Fatal("failed output was reported delivered")
	}
	before := snapshotFiles(t, f.paths)
	report, err := inspectCeremony(f.paths.Directory)
	if err != nil || report.Status != "complete_original_public_hashes_and_possession_observed" {
		t.Fatal("lost reply lost original durable result", err)
	}
	if _, err = runFixture(t, f, realCeremonyIO()); !errors.Is(err, errRetained) {
		t.Fatal("lost public reply regenerated keys", err)
	}
	assertFilesEqual(t, before, snapshotFiles(t, f.paths))
}
