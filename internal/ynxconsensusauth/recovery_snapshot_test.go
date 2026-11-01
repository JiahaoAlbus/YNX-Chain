//go:build unix

package ynxconsensusauth

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// All material in these fixtures is freshly generated PUBLIC test material.
func TestHostRecoverySnapshotPUBLICIsolatedPathAndNoAuthority(t *testing.T) {
	f := newHostVaultFixture(t)
	f.signer.Close()
	wire, err := os.ReadFile(f.binding.SignerStatePath)
	if err != nil {
		t.Fatal(err)
	}
	retained := f.binding.SignerStatePath + ".PUBLIC-retained"
	if err = os.Rename(f.binding.SignerStatePath, retained); err != nil {
		t.Fatal(err)
	}
	before, _ := os.Stat(retained)
	result, err := VerifyHostRecoverySnapshot(f.wire, wire, f.credential, f.binding)
	if err != nil || !result.VaultAuthenticated || !result.CompleteHRSValidated || !result.PublicStateOnly || result.Height != 0 {
		t.Fatal("complete isolated recovery failed", err)
	}
	if result.AuthorityGranted || result.RegistryMembershipVerified || result.AntiRollbackFreshness || result.OffHostSourceVerified || result.SigningReady || result.FilesWritten || result.SignaturesProduced || result.AcknowledgementKnown {
		t.Fatal("snapshot manufactured runtime or off-host authority")
	}
	if result.OriginalSignerStatePath != f.binding.SignerStatePath {
		t.Fatal("original absolute binding was rewritten")
	}
	if _, err = os.Lstat(f.binding.SignerStatePath); !os.IsNotExist(err) {
		t.Fatal("verification opened/created the original absolute HRS")
	}
	after, _ := os.Stat(retained)
	afterWire, _ := os.ReadFile(retained)
	if !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) || !bytes.Equal(wire, afterWire) {
		t.Fatal("isolated verifier changed retained original state")
	}
	wrong := f.binding
	wrong.SignerStatePath = filepath.Join(t.TempDir(), "retargeted.json")
	if _, err = VerifyHostRecoverySnapshot(f.wire, wire, f.credential, wrong); err == nil {
		t.Fatal("retargeted absolute HRS binding accepted")
	}
}

func TestHostRecoverySnapshotPUBLICPendingSignedUnknownAndCorruption(t *testing.T) {
	f := newHostVaultFixture(t)
	if _, err := f.signer.Sign(fixtureRequest(t, 100)); err != nil {
		t.Fatal(err)
	}
	wire, err := os.ReadFile(f.binding.SignerStatePath)
	if err != nil {
		t.Fatal(err)
	}
	result, err := VerifyHostRecoverySnapshot(f.wire, wire, f.credential, f.binding)
	if err != nil || result.SignatureBytes != EnvelopeSize || result.PendingUnsignedReservation || result.AcknowledgementKnown {
		t.Fatal("signed bytes or UNKNOWN delivery meaning changed", err)
	}
	hash := sha256.Sum256(wire)
	if result.StateSHA256 != hex.EncodeToString(hash[:]) {
		t.Fatal("full signed state was projected away")
	}
	var state signerState
	if err = json.Unmarshal(wire, &state); err != nil {
		t.Fatal(err)
	}
	state.Signature = nil // The original durable reservation before signing.
	pending, _ := json.Marshal(state)
	result, err = VerifyHostRecoverySnapshot(f.wire, pending, f.credential, f.binding)
	if err != nil || !result.PendingUnsignedReservation || result.SignatureBytes != 0 || result.MessageBytes == 0 {
		t.Fatal("original unsigned pending reservation was discarded", err)
	}
	if !bytes.Equal(wire, mustRecoveryState(t, f.binding.SignerStatePath)) {
		t.Fatal("verification completed or rewrote the original pending history")
	}
	wrongCredential := bytes.Clone(f.credential)
	wrongCredential[0] ^= 1
	defer clear(wrongCredential)
	if _, err = VerifyHostRecoverySnapshot(f.wire, wire, wrongCredential, f.binding); err == nil {
		t.Fatal("wrong credential accepted")
	}
	corruptVault := bytes.Clone(f.wire)
	corruptVault[len(corruptVault)-1] ^= 1
	if _, err = VerifyHostRecoverySnapshot(corruptVault, wire, f.credential, f.binding); err == nil {
		t.Fatal("corrupt ciphertext accepted")
	}
	json.Unmarshal(wire, &state)
	state.Signature[len(state.Signature)-1] ^= 1
	badSignature, _ := json.Marshal(state)
	for name, bad := range map[string][]byte{
		"corrupt-saved-signature": badSignature,
		"duplicate-height":        append(append(bytes.Clone(wire[:len(wire)-1]), []byte(`,"height":100`)...), '}'),
		"foreign-sequence":        append(append(bytes.Clone(wire[:len(wire)-1]), []byte(`,"sequence":19`)...), '}'),
		"foreign-private-field":   append(append(bytes.Clone(wire[:len(wire)-1]), []byte(`,"privateKey":"PUBLIC-NOT-A-SECRET"`)...), '}'),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := VerifyHostRecoverySnapshot(f.wire, bad, f.credential, f.binding); err == nil {
				t.Fatal("foreign/corrupt complete history accepted")
			}
		})
	}
}

func TestHostRecoverySnapshotPUBLICPreservesExtensionCompanion(t *testing.T) {
	f := newHostVaultFixture(t)
	vote := fixtureVote(100)
	ordinary, err := NewVoteRequestV2(f.binding.Policy.GenesisID, f.binding.Policy.ChainID, vote)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.signer.Sign(ordinary); err != nil {
		t.Fatal(err)
	}
	vote.Extension = []byte("PUBLIC recovery extension fixture")
	extension, err := NewVoteExtensionRequestV2(f.binding.Policy.GenesisID, f.binding.Policy.ChainID, vote)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.signer.Sign(extension); err != nil {
		t.Fatal(err)
	}
	wire := mustRecoveryState(t, f.binding.SignerStatePath)
	result, err := VerifyHostRecoverySnapshot(f.wire, wire, f.credential, f.binding)
	if err != nil || result.Kind != VoteExtension || result.SignatureBytes != EnvelopeSize || result.PrecommitSignatureBytes != EnvelopeSize || result.PrecommitMessageBytes == 0 {
		t.Fatal("ordinary precommit companion was lost", err)
	}
	var state signerState
	json.Unmarshal(wire, &state)
	state.PrecommitSignature = nil
	corrupt, _ := json.Marshal(state)
	if _, err = VerifyHostRecoverySnapshot(f.wire, corrupt, f.credential, f.binding); err == nil {
		t.Fatal("missing extension companion accepted")
	}
}

func mustRecoveryState(t *testing.T, path string) []byte {
	t.Helper()
	wire, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return wire
}
