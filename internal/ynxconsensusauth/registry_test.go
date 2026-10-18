package ynxconsensusauth

import (
	"bytes"
	"errors"
	"math"
	"strings"
	"testing"
)

func TestKeyHistoryRealRotationRevocationSnapshotAndBindings(t *testing.T) {
	f := newRegistrationFixture(t)
	h0, err := NewKeyHistory(f.anchor)
	if err != nil {
		t.Fatal(err)
	}
	first := f.sign(t, f.first(), 0, 0)
	h1 := mustAppendRegistration(t, h0, first, f.source)
	root1 := h1.Root()
	rotation := f.sign(t, f.successor(t, first, RotateValidator, 2, 1, 2, 15, 20, 0, 1), 0, 1)
	h2 := mustAppendRegistration(t, h1, rotation, f.source)
	rotation2 := f.sign(t, f.successor(t, rotation, RotateValidator, 3, 2, 3, 20, 22, 1, 2), 1, 2)
	h3 := mustAppendRegistration(t, h2, rotation2, f.source)
	// A currently active pair can revoke the entire identity, including the
	// next pair pending for height 20. The original rotation remains in audit.
	revocation := f.sign(t, f.successor(t, rotation, RevokeValidator, 3, 1, 2, 16, 18, 0, 0), 0, 0)
	revoked := mustAppendRegistration(t, h2, revocation, f.source)

	for _, tc := range []struct {
		history     *KeyHistory
		height      int64
		epoch       uint64
		from, until int64
	}{
		{h1, 12, 1, 12, 0}, {h2, 19, 1, 12, 20}, {h2, 20, 2, 20, 0}, {h3, 19, 1, 12, 20}, {h3, 20, 2, 20, 22}, {h3, 22, 3, 22, 0}, {revoked, 12, 1, 12, 18}, {revoked, 17, 1, 12, 18},
	} {
		r, err := tc.history.ConsensusKeysAt(f.anchor.ChainID, f.address, tc.height)
		if err != nil || r.Epoch != tc.epoch || r.ValidFromHeight != tc.from || r.ValidUntilHeight != tc.until {
			t.Fatalf("wrong historical epoch at %d: %+v, %v", tc.height, r, err)
		}
	}
	for _, height := range []int64{18, 19, 20, math.MaxInt64} {
		if _, err := revoked.ConsensusKeysAt(f.anchor.ChainID, f.address, height); !errors.Is(err, ErrValidatorKeyUnavailable) {
			t.Fatalf("revoked identity returned a key at %d", height)
		}
	}
	if !revoked.HasPQHistory(f.address) || revoked.EventCount() != 3 || h1.Root() != root1 || h1.EventCount() != 1 || h0.EventCount() != 0 {
		t.Fatal("append rewrote history or lost terminal marker")
	}
	r, err := h1.ConsensusKeysAt(f.anchor.ChainID, f.address, math.MaxInt64)
	if err != nil || r.ValidUntilHeight != 0 {
		t.Fatal("successor mutated earlier immutable registry")
	}

	t.Run("detached inputs and outputs", func(t *testing.T) {
		ownedWire := bytes.Clone(first)
		independent := mustAppendRegistration(t, h0, ownedWire, f.source)
		clear(ownedWire)
		before, _ := independent.EventWire(0)
		if !bytes.Equal(before, first) {
			t.Fatal("history retained mutable incoming proof")
		}
		clear(before)
		again, _ := independent.EventWire(0)
		if !bytes.Equal(again, first) {
			t.Fatal("history exposed mutable proof")
		}
		a := independent.Anchor()
		clear(a.GenesisID)
		r, _ := independent.ConsensusKeysAt(f.anchor.ChainID, f.address, 12)
		clear(r.MLDSA87PublicKey)
		clear(r.SLHDSASHA2256fPublicKey)
		clear(r.ValidatorAddress)
		r, _ = independent.ConsensusKeysAt(f.anchor.ChainID, f.address, 12)
		if !bytes.Equal(r.MLDSA87PublicKey, f.pa[0]) || !bytes.Equal(r.SLHDSASHA2256fPublicKey, f.pb[0]) || !bytes.Equal(r.ValidatorAddress, f.address) || !bytes.Equal(independent.Anchor().GenesisID, f.anchor.GenesisID) {
			t.Fatal("exposed mutable registry authority")
		}
	})

	t.Run("pending rotation and terminal gates", func(t *testing.T) {
		r, _ := DecodeRegistration(rotation)
		hash, _ := RegistrationHash(rotation)
		r.Intent.Sequence = 3
		r.Intent.PreviousEventHash = bytes.Clone(hash[:])
		r.Intent.ApprovedAt = 16
		r.Intent.EffectiveAt = 18
		r.Intent.MLDSA87PublicKey = bytes.Clone(f.pa[2])
		r.Intent.SLHDSASHA2256fPublicKey = bytes.Clone(f.pb[2])
		wire, _ := r.MarshalBinary()
		if _, err := h2.Append(wire, 16, f.source); err == nil || !strings.Contains(err.Error(), "pending") {
			t.Fatalf("pending key overwrite not rejected before crypto: %v", err)
		}
		if _, err := revoked.Append(wire, 16, f.source); err == nil || !strings.Contains(err.Error(), "terminally revoked") {
			t.Fatalf("pending tombstone allowed successor: %v", err)
		}
		if _, err := revoked.Append(first, 10, f.source); err == nil {
			t.Fatal("revoked validator reentered with classic authority")
		}
		early, _ := DecodeRegistration(revocation)
		early.Intent = f.successor(t, first, RevokeValidator, 2, 1, 1, 10, 12, 0, 0)
		wire, _ = early.MarshalBinary()
		if _, err := h1.Append(wire, 10, f.source); !errors.Is(err, ErrValidatorKeyUnavailable) {
			t.Fatal("pending first key became current authority")
		}
		wrongPrevious, _ := DecodeRegistration(rotation)
		wrongPrevious.Intent.PreviousEventHash[0] ^= 1
		wire, _ = wrongPrevious.MarshalBinary()
		if _, err := h1.Append(wire, 15, f.source); err == nil || !strings.Contains(err.Error(), "previous event") {
			t.Fatal("event-chain splice accepted")
		}
	})

	t.Run("logical key is exact history binding", func(t *testing.T) {
		binding, err := h2.PublicKeyBindingAt(f.anchor.ChainID, f.address, 19)
		if err != nil {
			t.Fatal(err)
		}
		decoded, err := DecodeLogicalPublicKey(binding)
		if err != nil {
			t.Fatal(err)
		}
		roundtrip, err := decoded.MarshalBinary()
		if err != nil || !bytes.Equal(roundtrip, binding) {
			t.Fatal("logical key codec changed bytes")
		}
		if _, err := h2.AuthenticatePublicKeyBinding(binding, 19); err != nil {
			t.Fatal(err)
		}
		if _, err := h2.AuthenticatePublicKeyBinding(binding, 20); err == nil {
			t.Fatal("old public key authenticated after rotation")
		}
		if _, err := revoked.AuthenticatePublicKeyBinding(binding, 18); err == nil {
			t.Fatal("public key authenticated after revocation")
		}
		for name, mutate := range map[string]func(*LogicalPublicKey){
			"genesis": func(k *LogicalPublicKey) { k.GenesisID[0] ^= 1 }, "chain": func(k *LogicalPublicKey) { k.ChainID = "different" }, "address": func(k *LogicalPublicKey) { k.ValidatorAddress[0] ^= 1 }, "epoch": func(k *LogicalPublicKey) { k.Epoch++ }, "effective height": func(k *LogicalPublicKey) { k.ValidFromHeight++ }, "original registration": func(k *LogicalPublicKey) { k.RegistrationHash[0] ^= 1 }, "key A": func(k *LogicalPublicKey) { k.MLDSA87PublicKey[0] ^= 1 }, "key B": func(k *LogicalPublicKey) { k.SLHDSASHA2256fPublicKey[0] ^= 1 },
		} {
			t.Run(name, func(t *testing.T) {
				k, _ := DecodeLogicalPublicKey(binding)
				mutate(&k)
				wire, err := k.MarshalBinary()
				if err != nil {
					t.Fatal(err)
				}
				if _, err := h2.AuthenticatePublicKeyBinding(wire, 19); err == nil {
					t.Fatal("unauthenticated logical binding accepted")
				}
			})
		}
		clear(binding)
		if decoded.MLDSA87PublicKey[0] != f.pa[0][0] {
			t.Fatal("logical key decoder retained alias")
		}
	})

	t.Run("full proof snapshot restart and trusted root", func(t *testing.T) {
		limits := HistoryIngressLimits{MaxBytes: 1 << 20, MaxEvents: 4}
		wire, err := revoked.MarshalSnapshot(limits.MaxBytes)
		if err != nil {
			t.Fatal(err)
		}
		restored, err := DecodeKeyHistorySnapshot(wire, f.anchor, revoked.Root(), f.source, limits)
		if err != nil {
			t.Fatal(err)
		}
		roundtrip, err := restored.MarshalSnapshot(limits.MaxBytes)
		if err != nil || !bytes.Equal(wire, roundtrip) {
			t.Fatal("restart changed original proof bytes")
		}
		if _, err := restored.ConsensusKeysAt(f.anchor.ChainID, f.address, 18); err == nil {
			t.Fatal("restart forgot revocation")
		}
		if r, err := restored.ConsensusKeysAt(f.anchor.ChainID, f.address, 12); err != nil || r.Epoch != 1 {
			t.Fatal("restart lost historical authority")
		}
		root := revoked.Root()
		root[0] ^= 1
		if _, err := DecodeKeyHistorySnapshot(wire, f.anchor, root, f.source, limits); err == nil {
			t.Fatal("snapshot self-certified a different root")
		}
		if _, err := ReplayKeyHistory(f.anchor, [][]byte{first, rotation}, revoked.Root(), f.source, limits); err == nil {
			t.Fatal("deleted terminal event accepted")
		}
		if _, err := ReplayKeyHistory(f.anchor, [][]byte{rotation, first, revocation}, revoked.Root(), f.source, limits); err == nil {
			t.Fatal("reordered history accepted")
		}
		tampered := bytes.Clone(first)
		tampered[len(tampered)-17] ^= 1
		if _, err := ReplayKeyHistory(f.anchor, [][]byte{tampered, rotation, revocation}, revoked.Root(), f.source, limits); err == nil {
			t.Fatal("changed historical full proof accepted")
		}
		f.source.mutate = func(s *RegistrationState) {
			if s.Height == 15 {
				s.VotingPower = 0
			}
		}
		if _, err := DecodeKeyHistorySnapshot(wire, f.anchor, revoked.Root(), f.source, limits); err == nil {
			t.Fatal("replay used current instead of original membership")
		}
		f.source.mutate = nil
		f.source.calls = 0
		if _, err := DecodeKeyHistorySnapshot(wire, f.anchor, revoked.Root(), f.source, HistoryIngressLimits{MaxBytes: len(wire) - 1, MaxEvents: 4}); err == nil {
			t.Fatal("byte budget ignored")
		}
		if _, err := DecodeKeyHistorySnapshot(wire, f.anchor, revoked.Root(), f.source, HistoryIngressLimits{MaxBytes: 1 << 20, MaxEvents: 2}); err == nil {
			t.Fatal("event budget ignored")
		}
		fields, _ := regDecode(wire, 9, 1<<20)
		fields[4] = regU32(math.MaxUint32)
		bad, _ := regEncode(1<<20, fields...)
		if _, err := DecodeKeyHistorySnapshot(bad, f.anchor, revoked.Root(), f.source, limits); err == nil {
			t.Fatal("forged count allocated event list")
		}
		if f.source.calls != 0 {
			t.Fatal("oversized ingress reached membership/crypto")
		}
		if _, err := DecodeKeyHistorySnapshot(append(bytes.Clone(wire), 0), f.anchor, revoked.Root(), f.source, limits); err == nil {
			t.Fatal("snapshot trailing data accepted")
		}
		if _, err := revoked.MarshalSnapshot(len(wire) - 1); err == nil {
			t.Fatal("export byte budget ignored")
		}
		clear(wire)
		if restored.Root() != revoked.Root() {
			t.Fatal("import retained mutable root")
		}
	})

	t.Run("uses existing consensus verifier without fallback", func(t *testing.T) {
		vote := fixtureVote(12)
		vote.ValidatorAddress = bytes.Clone(f.address)
		request, err := NewVoteRequest(f.anchor.ChainID, vote)
		if err != nil {
			t.Fatal(err)
		}
		record, _ := h1.ConsensusKeysAt(f.anchor.ChainID, f.address, 12)
		signature, err := f.keys[0].signRequest(request, record)
		if err != nil {
			t.Fatal(err)
		}
		verifier, err := NewCIRCLVerifier(Policy{Version: Version, ChainID: f.anchor.ChainID, ActivationHeight: 12}, revoked, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := verifier.Verify(request, signature); err != nil {
			t.Fatal(err)
		}
		vote.Height = 18
		request, err = NewVoteRequest(f.anchor.ChainID, vote)
		if err != nil {
			t.Fatal(err)
		}
		if err := verifier.Verify(request, signature); err == nil {
			t.Fatal("retired key bypassed registry")
		}
		if err := verifier.Verify(request, make([]byte, 64)); err == nil {
			t.Fatal("revocation caused classic fallback")
		}
	})
}

func TestKeyHistoryEmptySnapshotAndUninitializedFailClosed(t *testing.T) {
	a := RegistryAnchor{GenesisID: bytes.Repeat([]byte{1}, 32), ChainID: "empty"}
	h, err := NewKeyHistory(a)
	if err != nil {
		t.Fatal(err)
	}
	clear(a.GenesisID)
	if regZero(h.Anchor().GenesisID) {
		t.Fatal("constructor retained caller anchor")
	}
	limits := HistoryIngressLimits{MaxBytes: 1024, MaxEvents: 1}
	wire, err := h.MarshalSnapshot(limits.MaxBytes)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := DecodeKeyHistorySnapshot(wire, h.Anchor(), h.Root(), nil, limits)
	if err != nil || restored.EventCount() != 0 {
		t.Fatal("empty authenticated checkpoint did not roundtrip")
	}
	if _, err := (&KeyHistory{}).ConsensusKeysAt("empty", make([]byte, 20), 1); err == nil {
		t.Fatal("zero history authorized")
	}
	if _, err := (&KeyHistory{}).Append(nil, 1, nil); err == nil {
		t.Fatal("zero history appended")
	}
	if _, err := NewKeyHistory(RegistryAnchor{GenesisID: make([]byte, 32), ChainID: "empty"}); err == nil {
		t.Fatal("zero genesis anchor accepted")
	}
	if _, err := h.EventWire(-1); err == nil {
		t.Fatal("negative audit index")
	}
}
