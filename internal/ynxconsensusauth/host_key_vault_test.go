//go:build unix

package ynxconsensusauth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

type hostVaultFixture struct {
	key              *CandidateKey
	material         CandidateKeyMaterial
	credential, wire []byte
	binding          HostKeyBinding
	registry         *registryFixture
	signer           *Signer
	vaultPath        string
}

func newHostVaultFixture(t *testing.T) *hostVaultFixture {
	t.Helper()
	key, material, err := GenerateCandidateKeyMaterial()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(key.Destroy)
	t.Cleanup(material.Clear)
	credential, err := GenerateHostRecoveryCredential()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { clear(credential) })
	r := fixtureRegistry()
	r.record.MLDSA87PublicKey, r.record.SLHDSASHA2256fPublicKey = bytes.Clone(material.PublicA), bytes.Clone(material.PublicB)
	path := filepath.Join(t.TempDir(), "original-state.json")
	b := HostKeyBinding{Policy: Policy{Version: ConsensusGenesisVersion, GenesisID: fixtureGenesis(), ChainID: r.record.ChainID, ActivationHeight: 100}, ValidatorAddress: bytes.Clone(r.record.ValidatorAddress), Epoch: r.record.Epoch, MLDSA87PublicKey: bytes.Clone(material.PublicA), SLHDSASHA2256fPublicKey: bytes.Clone(material.PublicB), SignerStatePath: path}
	signer, err := CreateSigner(path, key, b.Policy, r, b.ValidatorAddress, b.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { signer.Close() })
	wire, err := SealHostKeyEnvelope(material, b, credential)
	if err != nil {
		t.Fatal(err)
	}
	vault := filepath.Join(t.TempDir(), "validator.encrypted")
	if err = os.WriteFile(vault, wire, 0600); err != nil {
		t.Fatal(err)
	}
	return &hostVaultFixture{key: key, material: material, credential: credential, wire: wire, binding: b, registry: r, signer: signer, vaultPath: vault}
}

func TestHostKeyEnvelopeFixedProfileAndFullBinding(t *testing.T) {
	f := newHostVaultFixture(t)
	fields, err := regDecode(f.wire, 9, MaxHostKeyEnvelopeBytes)
	if err != nil {
		t.Fatal(err)
	}
	if string(fields[3]) != "PBKDF2-HMAC-SHA256" || !bytes.Equal(fields[4], regU32(600000)) || len(fields[5]) != 32 || string(fields[6]) != "AES-256-GCM" || len(fields[7]) != 12 || len(fields[8]) < 16 {
		t.Fatal("existing KDF/AEAD profile changed")
	}
	key, err := OpenHostKeyEnvelope(f.wire, f.credential, f.binding)
	if err != nil {
		t.Fatal(err)
	}
	key.Destroy()
	for _, name := range []string{"genesis", "chain", "address", "epoch", "activation", "publicA", "publicB", "HRSpath"} {
		t.Run(name, func(t *testing.T) {
			wire, err := f.binding.wire()
			if err != nil {
				t.Fatal(err)
			}
			b, err := decodeHostBinding(wire)
			if err != nil {
				t.Fatal(err)
			}
			switch name {
			case "genesis":
				b.Policy.GenesisID[0] ^= 1
			case "chain":
				b.Policy.ChainID += "-other"
			case "address":
				b.ValidatorAddress[0] ^= 1
			case "epoch":
				b.Epoch++
			case "activation":
				b.Policy.ActivationHeight++
			case "publicA":
				b.MLDSA87PublicKey[0] ^= 1
			case "publicB":
				b.SLHDSASHA2256fPublicKey[0] ^= 1
			case "HRSpath":
				b.SignerStatePath = filepath.Join(filepath.Dir(b.SignerStatePath), "replacement.json")
			}
			key, err := OpenHostKeyEnvelope(f.wire, f.credential, b)
			if err == nil || key != nil {
				t.Fatal("wrong independent complete binding accepted")
			}
		})
	}
	for _, index := range []int{0, 1, 3, 4, 5, 6, 7, 8} {
		changed := make([][]byte, len(fields))
		for i := range fields {
			changed[i] = bytes.Clone(fields[i])
		}
		changed[index][len(changed[index])-1] ^= 1
		wire, err := regEncode(MaxHostKeyEnvelopeBytes, changed...)
		if err != nil {
			t.Fatal(err)
		}
		if key, err = OpenHostKeyEnvelope(wire, f.credential, f.binding); err == nil || key != nil {
			t.Fatal("authenticated metadata/ciphertext tamper accepted", index)
		}
	}
	wrong := bytes.Clone(f.credential)
	wrong[0] ^= 1
	defer clear(wrong)
	for _, credential := range [][]byte{wrong, f.credential[:31], append(bytes.Clone(f.credential), 0), []byte("human password")} {
		if key, err = OpenHostKeyEnvelope(f.wire, credential, f.binding); err == nil || key != nil {
			t.Fatal("wrong credential accepted")
		}
	}
	for _, wire := range [][]byte{append(bytes.Clone(f.wire), 0), f.wire[:len(f.wire)-1], make([]byte, MaxHostKeyEnvelopeBytes+1), []byte(`{"format":"YNX-PQ-WALLET-BACKUP/v1"}`)} {
		if key, err = OpenHostKeyEnvelope(wire, f.credential, f.binding); err == nil || key != nil {
			t.Fatal("wrong/oversized envelope accepted")
		}
	}
}

func TestHostSignerResumeOnlyPreservesOriginalHRSAndSharedClosure(t *testing.T) {
	f := newHostVaultFixture(t)
	request := fixtureRequest(t, 100)
	original, err := f.signer.Sign(request)
	if err != nil {
		t.Fatal(err)
	}
	f.signer.Close()
	f.key.Destroy()
	f.material.Clear()
	before, err := os.ReadFile(f.binding.SignerStatePath)
	if err != nil {
		t.Fatal(err)
	}
	host, err := ResumeHostSigner(f.vaultPath, f.credential, f.binding, f.registry)
	if err != nil {
		t.Fatal(err)
	}
	defer host.Close()
	signer, err := host.Signer()
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := signer.Sign(request)
	if err != nil || !bytes.Equal(replayed, original) {
		t.Fatal("recovery changed original exact signature", err)
	}
	after, err := os.ReadFile(f.binding.SignerStatePath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("exact recovery changed original HRS bytes", err)
	}
	badVote := fixtureVote(100)
	badVote.BlockID.Hash[0] ^= 1
	bad, err := NewVoteRequestV2(f.binding.Policy.GenesisID, f.binding.Policy.ChainID, badVote)
	if err != nil {
		t.Fatal(err)
	}
	if sig, err := signer.Sign(bad); err == nil || len(sig) != 0 {
		t.Fatal("restored signer double-signed")
	}
	copy := *host
	if err = copy.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err = host.Signer(); err == nil {
		t.Fatal("copied host handle revived closed custody")
	}
	if sig, err := signer.Sign(request); err == nil || len(sig) != 0 {
		t.Fatal("escaped durable handle signed after custody close")
	}
}

func TestHostSignerRejectsMissingHistoryWrongInputsAndUnsafeFiles(t *testing.T) {
	f := newHostVaultFixture(t)
	f.signer.Close()
	before, err := os.ReadFile(f.binding.SignerStatePath)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"wrongEpoch", "wrongActivation", "wrongCredential", "missingHistory", "wrongAnchor", "symlinkVault", "hardlinkVault", "publicMode", "oversized", "heldLock"} {
		t.Run(name, func(t *testing.T) {
			b := f.binding
			credential := f.credential
			path := f.vaultPath
			registry := f.registry
			switch name {
			case "wrongEpoch":
				b.Epoch++
			case "wrongActivation":
				b.Policy.ActivationHeight++
			case "wrongCredential":
				credential = bytes.Clone(f.credential)
				credential[0] ^= 1
				defer clear(credential)
			case "missingHistory":
				b.SignerStatePath = filepath.Join(t.TempDir(), "absent-state.json")
			case "wrongAnchor":
				copy := *f.registry
				copy.anchor.GenesisID = bytes.Repeat([]byte{0x98}, 32)
				registry = &copy
			case "symlinkVault":
				path = filepath.Join(t.TempDir(), "link")
				if err := os.Symlink(f.vaultPath, path); err != nil {
					t.Fatal(err)
				}
			case "hardlinkVault":
				path = filepath.Join(t.TempDir(), "link")
				if err := os.Link(f.vaultPath, path); err != nil {
					t.Fatal(err)
				}
				defer os.Remove(path)
			case "publicMode":
				if err := os.Chmod(path, 0644); err != nil {
					t.Fatal(err)
				}
				defer os.Chmod(path, 0600)
			case "oversized":
				path = filepath.Join(t.TempDir(), "large")
				if err := os.WriteFile(path, make([]byte, MaxHostKeyEnvelopeBytes+1), 0600); err != nil {
					t.Fatal(err)
				}
			case "heldLock":
				lock, err := ResumeSigner(b.SignerStatePath, f.key, f.registry)
				if err != nil {
					t.Fatal(err)
				}
				defer lock.Close()
			}
			if host, err := ResumeHostSigner(path, credential, b, registry); err == nil || host != nil {
				if host != nil {
					host.Close()
				}
				t.Fatal("unsafe recovery accepted")
			}
			after, err := os.ReadFile(f.binding.SignerStatePath)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("rejected recovery changed original state", err)
			}
			if name == "missingHistory" {
				if _, err := os.Stat(b.SignerStatePath); !errors.Is(err, os.ErrNotExist) {
					t.Fatal("missing history was created")
				}
			}
		})
	}
}

func TestHostSignerUnknownOriginalRecoveryNeverResets(t *testing.T) {
	for _, stage := range []string{"reservation", "signature"} {
		t.Run(stage, func(t *testing.T) {
			f := newHostVaultFixture(t)
			writes := 0
			f.signer.write = func(path string, st signerState, create bool) error {
				if err := writeSignerState(path, st, create); err != nil {
					return err
				}
				writes++
				if stage == "reservation" || writes == 2 {
					return ErrSignerDurabilityUncertain
				}
				return nil
			}
			request := fixtureRequest(t, 100)
			if sig, err := f.signer.Sign(request); !errors.Is(err, ErrSignerDurabilityUncertain) || len(sig) != 0 {
				t.Fatal("UNKNOWN leaked signature", err)
			}
			if f.signer.state.Height != 100 || len(f.signer.state.Message) == 0 || !f.signer.uncertain {
				t.Fatal("UNKNOWN original reservation lost")
			}
			originalSignature := bytes.Clone(f.signer.state.Signature)
			if (stage == "signature") != (len(originalSignature) != 0) {
				t.Fatal("fixture did not reach requested durable UNKNOWN stage")
			}
			f.signer.Close()
			f.key.Destroy()
			host, err := ResumeHostSigner(f.vaultPath, f.credential, f.binding, f.registry)
			if err != nil {
				t.Fatal(err)
			}
			defer host.Close()
			signer, err := host.Signer()
			if err != nil {
				t.Fatal(err)
			}
			if signer.state.Height != 100 || len(signer.state.Message) == 0 || !bytes.Equal(signer.state.Signature, originalSignature) {
				t.Fatal("cold recovery reset UNKNOWN HRS or stored signature")
			}
			bad := fixtureVote(100)
			bad.Timestamp = bad.Timestamp.Add(time.Nanosecond)
			r, err := NewVoteRequestV2(f.binding.Policy.GenesisID, f.binding.Policy.ChainID, bad)
			if err != nil {
				t.Fatal(err)
			}
			if sig, err := signer.Sign(r); err == nil || len(sig) != 0 {
				t.Fatal("UNKNOWN recovery accepted different original bytes")
			}
			sig, err := signer.Sign(request)
			if err != nil {
				t.Fatal(err)
			}
			if stage == "signature" && !bytes.Equal(sig, originalSignature) {
				t.Fatal("cold reconciliation changed already-written exact signature")
			}
			v, err := NewCIRCLVerifier(f.binding.Policy, f.registry, nil)
			if err != nil || v.Verify(request, sig) != nil {
				t.Fatal("reconciled original signature failed", err)
			}
		})
	}
}

func TestHostSignerRejectsOldOrNoncanonicalHistoryWithoutRewrite(t *testing.T) {
	f := newHostVaultFixture(t)
	f.signer.Close()
	original, err := os.ReadFile(f.binding.SignerStatePath)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"oldVersion", "duplicate", "unknown", "trailing", "whitespace"} {
		t.Run(name, func(t *testing.T) {
			wire := bytes.Clone(original)
			switch name {
			case "oldVersion":
				wire = bytes.Replace(wire, []byte(signerStateVersion), []byte("YNX-CONSENSUS-SIGNER/v1"), 1)
			case "duplicate":
				wire = append([]byte(`{"height":0,`), wire[1:]...)
			case "unknown":
				wire = append([]byte(`{"reset":true,`), wire[1:]...)
			case "trailing":
				wire = append(wire, []byte(`{}`)...)
			case "whitespace":
				wire = append(wire, '\n')
			}
			if err := os.WriteFile(f.binding.SignerStatePath, wire, 0600); err != nil {
				t.Fatal(err)
			}
			if host, err := ResumeHostSigner(f.vaultPath, f.credential, f.binding, f.registry); err == nil || host != nil {
				if host != nil {
					host.Close()
				}
				t.Fatal("incompatible history resumed")
			}
			after, err := os.ReadFile(f.binding.SignerStatePath)
			if err != nil || !bytes.Equal(after, wire) {
				t.Fatal("rejected history was rewritten", err)
			}
		})
	}
}

func TestHostSignerLockedExpectationRejectsChangedHistoryWithoutRewrite(t *testing.T) {
	f := newHostVaultFixture(t)
	f.signer.Close()
	if err := preflightHostHistory(f.binding); err != nil {
		t.Fatal(err)
	}
	// Deterministically reproduce a change after successful preflight but before
	// the original OS lock is acquired, without a timing-dependent race hook.
	st := f.signer.state
	st.Policy.ActivationHeight++
	wire, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(f.binding.SignerStatePath, wire, 0600); err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(f.binding.SignerStatePath)
	if err != nil {
		t.Fatal(err)
	}
	expected := SignerIdentity{Policy: f.binding.Policy, ValidatorAddress: f.binding.ValidatorAddress, Epoch: f.binding.Epoch, MLDSA87PublicKey: f.binding.MLDSA87PublicKey, SLHDSASHA2256fPublicKey: f.binding.SLHDSASHA2256fPublicKey}
	if signer, err := resumeSigner(f.binding.SignerStatePath, f.key, f.registry, &expected); err == nil || signer != nil {
		if signer != nil {
			signer.Close()
		}
		t.Fatal("changed identity after preflight was resumed")
	}
	after, err := os.Stat(f.binding.SignerStatePath)
	if err != nil || !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) {
		t.Fatal("rejected locked identity replaced or wrote original history", err)
	}
	actual, err := os.ReadFile(f.binding.SignerStatePath)
	if err != nil || !bytes.Equal(actual, wire) {
		t.Fatal("rejected locked identity changed original bytes", err)
	}
	// Refusal releases the same OS lock. The matching new expectation succeeds;
	// no independent lock/history implementation is needed for custody.
	expected.Policy.ActivationHeight++
	signer, err := resumeSigner(f.binding.SignerStatePath, f.key, f.registry, &expected)
	if err != nil {
		t.Fatal("refused recovery leaked original lock", err)
	}
	signer.Close()
}

// Only the public binding/paths are carried in the child environment. The raw
// credential crosses an inherited FD, never arguments/environment/output.
func TestHostSignerFreshProcessRestoresBothKeysAndOriginalSignature(t *testing.T) {
	if os.Getenv("YNX_HOST_CUSTODY_QA_CHILD") == "1" {
		dir := os.Getenv("YNX_HOST_CUSTODY_QA_DIR")
		data, err := os.ReadFile(filepath.Join(dir, "binding.json"))
		if err != nil {
			t.Fatal(err)
		}
		var binding HostKeyBinding
		if err = json.Unmarshal(data, &binding); err != nil {
			t.Fatal(err)
		}
		fd := os.NewFile(3, "inherited-qa-credential")
		if fd == nil {
			t.Fatal("missing inherited credential FD")
		}
		credential, err := io.ReadAll(io.LimitReader(fd, 33))
		fd.Close()
		defer clear(credential)
		if err != nil || len(credential) != 32 {
			t.Fatal("invalid inherited credential length")
		}
		r := fixtureRegistry()
		r.record.MLDSA87PublicKey, r.record.SLHDSASHA2256fPublicKey = bytes.Clone(binding.MLDSA87PublicKey), bytes.Clone(binding.SLHDSASHA2256fPublicKey)
		host, err := ResumeHostSigner(filepath.Join(dir, "validator.encrypted"), credential, binding, r)
		if err != nil {
			t.Fatal(err)
		}
		defer host.Close()
		signer, err := host.Signer()
		if err != nil {
			t.Fatal(err)
		}
		sig, err := signer.Sign(fixtureRequest(t, 100))
		if err != nil {
			t.Fatal(err)
		}
		original, err := os.ReadFile(filepath.Join(dir, "signature.bin"))
		if err != nil || !bytes.Equal(sig, original) {
			t.Fatal("fresh process changed original signature", err)
		}
		v, err := NewCIRCLVerifier(binding.Policy, r, nil)
		if err != nil || v.Verify(fixtureRequest(t, 100), sig) != nil {
			t.Fatal("fresh process dual verification failed", err)
		}
		return
	}
	f := newHostVaultFixture(t)
	sig, err := f.signer.Sign(fixtureRequest(t, 100))
	if err != nil {
		t.Fatal(err)
	}
	f.signer.Close()
	f.key.Destroy()
	f.material.Clear()
	dir := filepath.Dir(f.vaultPath)
	data, err := json.Marshal(f.binding)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, "binding.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, "signature.bin"), sig, 0600); err != nil {
		t.Fatal(err)
	}
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer read.Close()
	if _, err = write.Write(f.credential); err != nil {
		write.Close()
		t.Fatal(err)
	}
	write.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, exe, "-test.run=^TestHostSignerFreshProcessRestoresBothKeysAndOriginalSignature$", "-test.count=1")
	cmd.Env = append(os.Environ(), "YNX_HOST_CUSTODY_QA_CHILD=1", "YNX_HOST_CUSTODY_QA_DIR="+dir)
	cmd.ExtraFiles = []*os.File{read}
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("fresh process custody recovery failed: %v; %s", err, output)
	}
}
