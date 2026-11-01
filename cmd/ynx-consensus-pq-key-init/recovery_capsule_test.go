//go:build unix

package main

import (
	"archive/tar"
	"bytes"
	"encoding/json"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
)

// These are fresh PUBLIC test epochs. No server, production key or recovery
// receiver is contacted; local mathematical recovery is not off-host evidence.
func capsulePUBLICFixture(t *testing.T) (*initFixture, publicRecord, string) {
	t.Helper()
	f := fixture(t)
	out, err := runFixture(t, f, realCeremonyIO())
	if err != nil {
		t.Fatal(err)
	}
	var record publicRecord
	if json.Unmarshal(out, &record) != nil {
		t.Fatal("PUBLIC fixture record")
	}
	parent := t.TempDir()
	if err = os.Chmod(parent, 0700); err != nil {
		t.Fatal(err)
	}
	parent, err = filepath.EvalSymlinks(parent)
	if err != nil {
		t.Fatal(err)
	}
	return f, record, parent
}
func capsulePUBLICExportArgs(t *testing.T, f *initFixture, directory string, credential []byte) []string {
	t.Helper()
	binding := capsulePUBLICRead(t, f.paths.Binding)
	record := capsulePUBLICRead(t, f.paths.PublicRecord)
	args := []string{"--out-dir", f.paths.Directory, "--binding-sha256", hash(binding), "--public-record-sha256", hash(record), "--genesis", f.options.genesis, "--genesis-sha256", f.options.genesisHash, "--recovery-fd", strconv.Itoa(credentialDescriptor(t, credential)), "--operation-id", "public-test-epoch1", "--export-dir", directory}
	if f.options.stateDirectory != "" {
		args = append(args, "--state-dir", f.options.stateDirectory)
	}
	return args
}
func capsulePUBLICRead(t *testing.T, path string) []byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func capsulePUBLICVerifyArgs(t *testing.T, f *initFixture, export, scratch string, credential []byte) []string {
	t.Helper()
	archive := filepath.Join(export, "capsule.tar")
	manifest := filepath.Join(export, "MANIFEST.json")
	var m capsuleManifest
	if capsuleJSON(capsulePUBLICRead(t, manifest), &m) != nil {
		t.Fatal("PUBLIC manifest")
	}
	return []string{"--archive", archive, "--archive-sha256", hash(capsulePUBLICRead(t, archive)), "--manifest", manifest, "--manifest-sha256", hash(capsulePUBLICRead(t, manifest)), "--binding", f.paths.Binding, "--binding-sha256", hash(capsulePUBLICRead(t, f.paths.Binding)), "--public-record", f.paths.PublicRecord, "--public-record-sha256", hash(capsulePUBLICRead(t, f.paths.PublicRecord)), "--genesis", f.options.genesis, "--genesis-sha256", f.options.genesisHash, "--producer-binary-sha256", m.Producer.BinarySHA256, "--recovery-fd", strconv.Itoa(credentialDescriptor(t, credential)), "--scratch-dir", scratch}
}
func capsulePUBLICCloseFD(args []string) {
	for i, k := range args {
		if k == "--recovery-fd" && i+1 < len(args) {
			fd, _ := strconv.Atoi(args[i+1])
			file := os.NewFile(uintptr(fd), "PUBLIC-test-owned-fd")
			if file != nil {
				file.Close()
			}
			return
		}
	}
}
func capsulePUBLICNoAuthority(t *testing.T, raw []byte) {
	t.Helper()
	var result capsuleResult
	if capsuleJSON(raw, &result) != nil || !result.CryptographicRecoveryVerified || !result.Snapshot.CompleteHRSValidated {
		t.Fatal("PUBLIC recovery not actually verified")
	}
	if result.AuthorityGranted || result.OffHostSourceVerified || result.RegistryMembershipVerified || result.AntiRollbackFreshness || result.SigningReady || result.RuntimeResume || result.SignaturesProduced || result.EpochCreated || result.OriginalHRSWritten || result.Snapshot.AcknowledgementKnown {
		t.Fatal("recovery manufactured transport/freshness/runtime authority")
	}
}

func TestPQRecoveryCapsulePUBLICRoundTripAndAbsentOriginalHRS(t *testing.T) {
	f, _, parent := capsulePUBLICFixture(t)
	export := filepath.Join(parent, "export")
	before := map[string][]byte{}
	identities := map[string]capsuleIdentity{}
	for _, path := range f.paths.all() {
		before[path] = capsulePUBLICRead(t, path)
		info, _ := os.Stat(path)
		identities[path], _ = capsuleFileIdentity(info)
	}
	var out, diagnostics bytes.Buffer
	args := capsulePUBLICExportArgs(t, f, export, f.credential)
	if err := capsulePUBLICRunExport(args, &out, &diagnostics); err != nil {
		t.Fatal(err)
	}
	capsulePUBLICNoAuthority(t, out.Bytes())
	for path, raw := range before {
		info, _ := os.Stat(path)
		id, _ := capsuleFileIdentity(info)
		if id != identities[path] || !bytes.Equal(raw, capsulePUBLICRead(t, path)) {
			t.Fatal("export changed original custody")
		}
	}
	var manifest capsuleManifest
	if capsuleJSON(capsulePUBLICRead(t, filepath.Join(export, "MANIFEST.json")), &manifest) != nil || len(manifest.Members) != 6 {
		t.Fatal("closed receiver manifest")
	}
	if bytes.Contains(capsulePUBLICRead(t, filepath.Join(export, "capsule.tar")), f.credential) || bytes.Contains(out.Bytes(), f.credential) {
		t.Fatal("raw credential exported")
	}
	// Independent public copies travel separately from the capsule. Original HRS
	// becomes absent; the authenticated absolute binding MUST NOT be retargeted.
	copies := filepath.Join(parent, "independent")
	if err := os.Mkdir(copies, 0700); err != nil {
		t.Fatal(err)
	}
	verify := capsulePUBLICVerifyArgs(t, f, export, filepath.Join(parent, "verify"), f.credential)
	for _, option := range []string{"--binding", "--public-record"} {
		for i, k := range verify {
			if k == option {
				target := filepath.Join(copies, filepath.Base(verify[i+1]))
				if err := os.WriteFile(target, capsulePUBLICRead(t, verify[i+1]), 0600); err != nil {
					t.Fatal(err)
				}
				verify[i+1] = target
			}
		}
	}
	retained := f.paths.State + ".PUBLIC-retained"
	if err := os.Rename(f.paths.State, retained); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	if err := capsulePUBLICRunVerify(verify, &out, &diagnostics); err != nil {
		t.Fatal(err)
	}
	capsulePUBLICNoAuthority(t, out.Bytes())
	if _, err := os.Stat(f.paths.State); !os.IsNotExist(err) {
		t.Fatal("isolated verification opened/recreated original HRS")
	}
	if !bytes.Equal(before[f.paths.State], capsulePUBLICRead(t, retained)) {
		t.Fatal("retained original HRS changed")
	}
	archiveBefore := capsulePUBLICRead(t, filepath.Join(export, "capsule.tar"))
	out.Reset()
	if err := capsulePUBLICRunVerify(verify, &out, &diagnostics); err == nil {
		t.Fatal("existing UNKNOWN/result scratch replay accepted")
	}
	if !bytes.Equal(archiveBefore, capsulePUBLICRead(t, filepath.Join(export, "capsule.tar"))) {
		t.Fatal("replay changed original archive")
	}
}

func TestPQRecoveryCapsulePUBLICActiveWriterMissingLockForeignFiles(t *testing.T) {
	f, record, parent := capsulePUBLICFixture(t)
	history, err := ynxconsensusauth.NewKeyHistory(ynxconsensusauth.RegistryAnchor{GenesisID: record.Binding.Policy.GenesisID, ChainID: record.Binding.Policy.ChainID})
	if err != nil {
		t.Fatal(err)
	}
	host, err := ynxconsensusauth.ResumeHostSigner(f.paths.Vault, f.credential, record.Binding, history)
	if err != nil {
		t.Fatal(err)
	}
	args := capsulePUBLICExportArgs(t, f, filepath.Join(parent, "active"), f.credential)
	var out bytes.Buffer
	if err = capsulePUBLICRunExport(args, &out, io.Discard); err == nil {
		t.Fatal("active normal HostSigner exported")
	}
	host.Close()
	if _, err = os.Stat(filepath.Join(parent, "active", "FIRST-CAUSE.json")); err != nil {
		t.Fatal("first active writer refusal not retained")
	}
	lock := f.paths.State + ".lock"
	saved := lock + ".PUBLIC-retained"
	if err = os.Rename(lock, saved); err != nil {
		t.Fatal(err)
	}
	// Existing foreign/UNKNOWN state is refused, never traversed or omitted.
	args = capsulePUBLICExportArgs(t, f, filepath.Join(parent, "foreign"), f.credential)
	if err = capsulePUBLICRunExport(args, &out, io.Discard); err == nil {
		t.Fatal("foreign custody file silently omitted")
	}
	if _, err = os.Stat(lock); !os.IsNotExist(err) {
		t.Fatal("missing original lock recreated")
	}
	// Move the PUBLIC retained lock out of the directory to isolate missing-lock.
	if err = os.Rename(saved, filepath.Join(parent, "PUBLIC-retained-lock")); err != nil {
		t.Fatal(err)
	}
	args = capsulePUBLICExportArgs(t, f, filepath.Join(parent, "missing"), f.credential)
	if err = capsulePUBLICRunExport(args, &out, io.Discard); err == nil {
		t.Fatal("missing original lock treated as stopped")
	}
	if _, err = os.Stat(lock); !os.IsNotExist(err) {
		t.Fatal("missing original lock recreated")
	}
}

func TestPQRecoveryCapsulePUBLICWrongCredentialCorruptAndIndependentPins(t *testing.T) {
	f, _, parent := capsulePUBLICFixture(t)
	export := filepath.Join(parent, "export")
	args := capsulePUBLICExportArgs(t, f, export, f.credential)
	var out bytes.Buffer
	if err := capsulePUBLICRunExport(args, &out, io.Discard); err != nil {
		t.Fatal(err)
	}
	wrong := bytes.Clone(f.credential)
	wrong[0] ^= 1
	defer clear(wrong)
	for _, tc := range []string{"wrong-credential", "foreign-binding", "foreign-producer", "corrupt-archive", "trailing-archive", "duplicate-option"} {
		t.Run(tc, func(t *testing.T) {
			credential := f.credential
			if tc == "wrong-credential" {
				credential = wrong
			}
			scratch := filepath.Join(parent, tc)
			v := capsulePUBLICVerifyArgs(t, f, export, scratch, credential)
			for i, k := range v {
				switch {
				case tc == "foreign-binding" && k == "--binding-sha256":
					v[i+1] = hash([]byte("PUBLIC foreign binding"))
				case tc == "foreign-producer" && k == "--producer-binary-sha256":
					v[i+1] = hash([]byte("PUBLIC foreign producer"))
				case (tc == "corrupt-archive" || tc == "trailing-archive") && k == "--archive":
					raw := bytes.Clone(capsulePUBLICRead(t, v[i+1]))
					if tc == "corrupt-archive" {
						raw[600] ^= 1
					} else {
						raw = append(raw, 1)
					}
					path := filepath.Join(parent, tc+".tar")
					if err := os.WriteFile(path, raw, 0600); err != nil {
						t.Fatal(err)
					}
					v[i+1] = path
					for j, key := range v {
						if key == "--archive-sha256" {
							v[j+1] = hash(raw)
						}
					}
				}
			}
			if tc == "duplicate-option" {
				v = append(v, "--scratch-dir", scratch)
			}
			out.Reset()
			if err := capsulePUBLICRunVerify(v, &out, io.Discard); err == nil {
				t.Fatal("foreign/corrupt recovery accepted")
			}
			if out.Len() != 0 {
				t.Fatal("failed recovery produced success")
			}
			if tc == "wrong-credential" {
				entries, err := os.ReadDir(scratch)
				if err != nil || len(entries) != 1 || entries[0].Name() != "FIRST-CAUSE.json" {
					t.Fatal("failed decryption left unverified state or lost first cause")
				}
			}
		})
	}
}

func TestPQRecoveryCapsulePUBLICIndependentProvenancePins(t *testing.T) {
	f, _, parent := capsulePUBLICFixture(t)
	export := filepath.Join(parent, "export")
	if err := capsulePUBLICRunExport(capsulePUBLICExportArgs(t, f, export, f.credential), io.Discard, io.Discard); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []string{"zero-producer", "zero-genesis", "noncanonical-genesis"} {
		t.Run(tc, func(t *testing.T) {
			var manifest capsuleManifest
			if capsuleJSON(capsulePUBLICRead(t, filepath.Join(export, "MANIFEST.json")), &manifest) != nil {
				t.Fatal("PUBLIC manifest")
			}
			contents, err := capsuleReadArchive(capsulePUBLICRead(t, filepath.Join(export, "capsule.tar")), manifest)
			if err != nil {
				t.Fatal(err)
			}
			if tc == "zero-producer" {
				manifest.Producer.BinarySHA256 = strings.Repeat("0", 64)
				var receipt capsuleExportReceipt
				if capsuleJSON(contents["public/export-receipt.json"], &receipt) != nil {
					t.Fatal("PUBLIC receipt")
				}
				receipt.Producer = manifest.Producer
				contents["public/export-receipt.json"], err = capsuleJSONBytes(receipt)
				if err != nil {
					t.Fatal(err)
				}
			} else if tc == "zero-genesis" {
				manifest.Epoch.GenesisSHA256 = strings.Repeat("0", 64)
			} else {
				manifest.Epoch.GenesisSHA256 = strings.Repeat("A", 64)
			}
			// Recompute every affected closed-member, archive and manifest hash.
			// A self-consistent zero pin must still fail as independent provenance.
			manifest.Members = nil
			for _, spec := range capsuleCatalog {
				raw := contents[spec.path]
				manifest.Members = append(manifest.Members, capsuleMember{spec.path, spec.kind, len(raw), hash(raw)})
			}
			archive, err := capsuleArchive(contents)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = capsuleReadArchive(archive, manifest); err == nil {
				t.Error("closed archive accepted absent or noncanonical independent provenance")
			}
			wire, err := capsuleJSONBytes(manifest)
			if err != nil {
				t.Fatal(err)
			}
			inputs := filepath.Join(parent, tc+"-inputs")
			if err = os.Mkdir(inputs, 0700); err != nil {
				t.Fatal(err)
			}
			for name, raw := range map[string][]byte{"capsule.tar": archive, "MANIFEST.json": wire} {
				if err = os.WriteFile(filepath.Join(inputs, name), raw, 0600); err != nil {
					t.Fatal(err)
				}
			}
			scratch := filepath.Join(parent, tc+"-scratch")
			args := capsulePUBLICVerifyArgs(t, f, inputs, scratch, f.credential)
			fd := -1
			for i, key := range args {
				if key == "--recovery-fd" {
					fd, _ = strconv.Atoi(args[i+1])
				}
			}
			var out bytes.Buffer
			if err = runVerifyRecoveryCapsule(args, &out, io.Discard); err == nil {
				t.Error("consistently re-encoded absent provenance accepted by normal verifier")
				return // The accepted verifier has already consumed and closed this FD.
			}
			credentialFD := os.NewFile(uintptr(fd), "PUBLIC-unconsumed-provenance-rejection")
			remaining, readErr := io.ReadAll(credentialFD)
			closeErr := credentialFD.Close()
			if readErr != nil || closeErr != nil || !bytes.Equal(remaining, f.credential) {
				t.Error("provenance refusal consumed or closed the inherited credential")
			}
			clear(remaining)
			if _, statErr := os.Lstat(scratch); !os.IsNotExist(statErr) || out.Len() != 0 {
				t.Error("provenance refusal created scratch or a success result")
			}
		})
	}
}

func TestPQRecoveryCapsulePUBLICClosedTarRejectsAlternateMetadata(t *testing.T) {
	f, _, parent := capsulePUBLICFixture(t)
	export := filepath.Join(parent, "export")
	args := capsulePUBLICExportArgs(t, f, export, f.credential)
	if err := capsulePUBLICRunExport(args, io.Discard, io.Discard); err != nil {
		t.Fatal(err)
	}
	raw := capsulePUBLICRead(t, filepath.Join(export, "capsule.tar"))
	var m capsuleManifest
	if capsuleJSON(capsulePUBLICRead(t, filepath.Join(export, "MANIFEST.json")), &m) != nil {
		t.Fatal("manifest")
	}
	for _, kind := range []string{"symlink", "pax", "extra-member", "trailing-zero", "truncated"} {
		t.Run(kind, func(t *testing.T) {
			if kind == "trailing-zero" {
				if _, err := capsuleReadArchive(append(bytes.Clone(raw), make([]byte, 512)...), m); err == nil {
					t.Fatal("noncanonical trailing bytes accepted")
				}
				return
			}
			if kind == "truncated" {
				if _, err := capsuleReadArchive(raw[:len(raw)-512], m); err == nil {
					t.Fatal("missing complete EOF accepted")
				}
				return
			}
			var b bytes.Buffer
			w := tar.NewWriter(&b)
			r := tar.NewReader(bytes.NewReader(raw))
			index := 0
			for {
				h, err := r.Next()
				if err == io.EOF {
					break
				}
				if err != nil {
					t.Fatal(err)
				}
				data, err := io.ReadAll(r)
				if err != nil {
					t.Fatal(err)
				}
				if index == 0 && kind == "symlink" {
					h.Typeflag = tar.TypeSymlink
					h.Linkname = "/PUBLIC-foreign"
					h.Size = 0
					data = nil
				}
				if index == 0 && kind == "pax" {
					h.Format = tar.FormatPAX
					h.PAXRecords = map[string]string{"comment": "PUBLIC alternate metadata"}
				}
				if err = w.WriteHeader(h); err != nil {
					t.Fatal(err)
				}
				if _, err = w.Write(data); err != nil {
					t.Fatal(err)
				}
				index++
			}
			if kind == "extra-member" {
				if err := w.WriteHeader(&tar.Header{Name: "foreign.txt", Mode: 0600, Size: 1, Format: tar.FormatUSTAR}); err != nil {
					t.Fatal(err)
				}
				w.Write([]byte("x"))
			}
			if err := w.Close(); err != nil {
				t.Fatal(err)
			}
			if _, err := capsuleReadArchive(b.Bytes(), m); err == nil {
				t.Fatal("foreign archive metadata accepted")
			}
		})
	}
}

func capsulePUBLICRunExport(args []string, out, diagnostics io.Writer) error {
	defer capsulePUBLICCloseFD(args)
	return runExportRecoveryCapsule(args, out, diagnostics)
}
func capsulePUBLICRunVerify(args []string, out, diagnostics io.Writer) error {
	defer capsulePUBLICCloseFD(args)
	return runVerifyRecoveryCapsule(args, out, diagnostics)
}

func TestPQRecoveryCapsulePUBLICAdvancedSignedUnknownAndPendingRoundTrip(t *testing.T) {
	f, record, parent := capsulePUBLICFixture(t)
	empty, err := ynxconsensusauth.NewKeyHistory(ynxconsensusauth.RegistryAnchor{GenesisID: record.Binding.Policy.GenesisID, ChainID: record.Binding.Policy.ChainID})
	if err != nil {
		t.Fatal(err)
	}
	intent, err := ynxconsensusauth.DecodeRegistrationIntent(record.IntentWire)
	if err != nil {
		t.Fatal(err)
	}
	message, err := intent.AuthoritySigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	approval, err := f.legacy.Sign(message)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := (ynxconsensusauth.Registration{Intent: intent, LegacyApproval: approval, PossessionMLDSA87: record.PossessionA, PossessionSLHDSASHA2256f: record.PossessionB}).MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	history, err := empty.Append(wire, 10, initMembership{f.request})
	if err != nil {
		t.Fatal(err)
	}
	host, err := ynxconsensusauth.ResumeHostSigner(f.paths.Vault, f.credential, record.Binding, history)
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
	signature, err := signer.Sign(request)
	if err != nil {
		t.Fatal(err)
	}
	if err = host.Close(); err != nil {
		t.Fatal(err)
	}
	signed := capsulePUBLICRead(t, f.paths.State)
	encoded, _ := json.Marshal(signature)
	pending := bytes.Replace(signed, append([]byte(`,"signature":`), encoded...), nil, 1)
	if bytes.Equal(signed, pending) {
		t.Fatal("PUBLIC real signed HRS fixture did not have complete signature")
	}
	for _, tc := range []struct {
		name    string
		state   []byte
		pending bool
	}{{"saved-signature-unknown-ack", signed, false}, {"pending-unsigned-reservation", pending, true}} {
		t.Run(tc.name, func(t *testing.T) {
			if err := os.WriteFile(f.paths.State, tc.state, 0600); err != nil {
				t.Fatal(err)
			}
			export := filepath.Join(parent, tc.name+"-export")
			args := capsulePUBLICExportArgs(t, f, export, f.credential)
			var out bytes.Buffer
			if err := capsulePUBLICRunExport(args, &out, io.Discard); err != nil {
				t.Fatal(err)
			}
			var result capsuleResult
			if capsuleJSON(out.Bytes(), &result) != nil || result.Snapshot.Height != 100 || result.Snapshot.PendingUnsignedReservation != tc.pending || result.Snapshot.StateSHA256 != hash(tc.state) || result.Snapshot.AcknowledgementKnown {
				t.Fatal("advanced/pending/UNKNOWN HRS meaning changed")
			}
			v := capsulePUBLICVerifyArgs(t, f, export, filepath.Join(parent, tc.name+"-verify"), f.credential)
			out.Reset()
			if err := capsulePUBLICRunVerify(v, &out, io.Discard); err != nil {
				t.Fatal(err)
			}
			capsulePUBLICNoAuthority(t, out.Bytes())
			if !bytes.Equal(capsulePUBLICRead(t, filepath.Join(parent, tc.name+"-verify", "epoch", "original-sign-state.json")), tc.state) || !bytes.Equal(capsulePUBLICRead(t, f.paths.State), tc.state) {
				t.Fatal("complete current state projected or original rewritten")
			}
		})
	}
}

func TestPQRecoveryCapsulePUBLICOriginalFDChangeRefused(t *testing.T) {
	parent := t.TempDir()
	path := filepath.Join(parent, "PUBLIC-original.json")
	if err := os.WriteFile(path, []byte("PUBLIC original"), 0600); err != nil {
		t.Fatal(err)
	}
	path, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatal(err)
	}
	held, err := capsuleOpen(path, 1024, false, true, false)
	if err != nil {
		t.Fatal(err)
	}
	defer held.file.Close()
	replacement := filepath.Join(filepath.Dir(path), "PUBLIC replacement")
	if err = os.WriteFile(replacement, []byte("PUBLIC original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(replacement, path); err != nil {
		t.Fatal(err)
	}
	if err = held.unchanged(); err == nil {
		t.Fatal("same bytes from foreign replacement inode accepted")
	}
}
