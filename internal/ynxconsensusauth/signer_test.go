//go:build unix

package ynxconsensusauth

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
)

func TestSignerDurableReplayConflictsAndRestart(t *testing.T) {
	k, r, policy := realKeyFixture(t)
	path := filepath.Join(t.TempDir(), "sign-state.json")
	s, err := CreateSigner(path, k, policy, r, r.record.ValidatorAddress, r.record.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	if _, err := ResumeSigner(path, k, r); err == nil {
		t.Fatal("second writer acquired live signer")
	}
	request := fixtureRequest(t, 100)
	first, err := s.Sign(request)
	if err != nil {
		t.Fatal(err)
	}
	v, _ := NewCIRCLVerifier(policy, r, nil)
	if err := v.Verify(request, first); err != nil {
		t.Fatal(err)
	}
	again, err := s.Sign(request)
	if err != nil || !bytes.Equal(first, again) {
		t.Fatal("exact replay did not reuse signature")
	}
	conflict := fixtureRequest(t, 100)
	conflict.canonical[0] ^= 1
	if _, err := s.Sign(conflict); err == nil {
		t.Fatal("same HRS equivocation accepted")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = ResumeSigner(path, k, r)
	if err != nil {
		t.Fatal(err)
	}
	again, err = s.Sign(request)
	if err != nil || !bytes.Equal(first, again) {
		t.Fatal("restart did not preserve exact replay")
	}
	if _, err := s.Sign(conflict); err == nil {
		t.Fatal("restart forgot reserved bytes")
	}
	r.anchor.GenesisID[0] ^= 1
	if _, err := s.Sign(request); err == nil {
		t.Fatal("cached signature bypassed changed registry genesis")
	}
	r.anchor.GenesisID[0] ^= 1
	r.record.ValidUntilHeight = 100
	if _, err := s.Sign(request); err == nil {
		t.Fatal("cached signature bypassed current registry")
	}
	r.record.ValidUntilHeight = 0
	if _, err := s.Sign(fixtureRequest(t, 99)); err == nil {
		t.Fatal("height regression accepted")
	}
}

func TestSignerReservationAndUnknownNeverEmit(t *testing.T) {
	k, r, policy := realKeyFixture(t)
	for _, stage := range []string{"before-reserve", "reserve-unknown", "signature-write"} {
		t.Run(stage, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "state.json")
			s, err := CreateSigner(path, k, policy, r, r.record.ValidatorAddress, r.record.Epoch)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			writes := 0
			s.write = func(p string, st signerState, create bool) error {
				writes++
				if stage == "before-reserve" {
					return errors.New("pre-rename failure")
				}
				if stage == "reserve-unknown" {
					if err := writeSignerState(p, st, create); err != nil {
						return err
					}
					return ErrSignerDurabilityUncertain
				}
				if writes == 2 {
					return errors.New("signature persistence failed")
				}
				return writeSignerState(p, st, create)
			}
			request := fixtureRequest(t, 100)
			if sig, err := s.Sign(request); err == nil || len(sig) != 0 {
				t.Fatal("failed durable operation emitted signature")
			}
			if stage == "before-reserve" {
				if s.state.Height != 0 {
					t.Fatal("failed reservation changed state")
				}
			} else {
				if s.state.Height != 100 || len(s.state.Message) == 0 {
					t.Fatal("reservation lost")
				}
				conflict := fixtureRequest(t, 100)
				conflict.canonical[0] ^= 1
				if _, err := s.Sign(conflict); err == nil {
					t.Fatal("failed signature allowed different bytes")
				}
			}
			s.write = writeSignerState
			if _, err := s.Sign(request); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSignerExtensionBindsPrecommitAndRetry(t *testing.T) {
	k, r, policy := realKeyFixture(t)
	s, err := CreateSigner(filepath.Join(t.TempDir(), "state.json"), k, policy, r, r.record.ValidatorAddress, r.record.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	vote := fixtureVote(100)
	vote.Extension = []byte("extension")
	ext, err := NewVoteExtensionRequestV2(policy.GenesisID, policy.ChainID, vote)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Sign(ext); err == nil {
		t.Fatal("extension before ordinary precommit accepted")
	}
	base, err := NewVoteRequestV2(policy.GenesisID, policy.ChainID, vote)
	if err != nil {
		t.Fatal(err)
	}
	ordinary, err := s.Sign(base)
	if err != nil {
		t.Fatal(err)
	}
	other := fixtureVote(100)
	other.BlockID.Hash[0] ^= 1
	other.Extension = vote.Extension
	wrong, _ := NewVoteExtensionRequestV2(policy.GenesisID, policy.ChainID, other)
	if _, err := s.Sign(wrong); err == nil {
		t.Fatal("extension authorized a different base vote")
	}
	extSignature, err := s.Sign(ext)
	if err != nil {
		t.Fatal(err)
	}
	verify, _ := NewCIRCLVerifier(policy, r, nil)
	if err := verify.Verify(ext, extSignature); err != nil {
		t.Fatal(err)
	}
	if again, err := s.Sign(base); err != nil || !bytes.Equal(again, ordinary) {
		t.Fatal("whole vote retry lost ordinary signature")
	}
	if again, err := s.Sign(ext); err != nil || !bytes.Equal(again, extSignature) {
		t.Fatal("whole vote retry lost extension signature")
	}
	vote.Extension[0] ^= 1
	changed, _ := NewVoteExtensionRequestV2(policy.GenesisID, policy.ChainID, vote)
	if _, err := s.Sign(changed); err == nil {
		t.Fatal("extension equivocation accepted")
	}
	vote.Type = cmtproto.PrevoteType
	if _, err := NewVoteExtensionRequestV2(policy.GenesisID, policy.ChainID, vote); err == nil {
		t.Fatal("prevote accepted an extension")
	}
}

func TestSignerCorruptedCoordinatesAndMissingStateReject(t *testing.T) {
	k, r, policy := realKeyFixture(t)
	path := filepath.Join(t.TempDir(), "state.json")
	if _, err := ResumeSigner(path, k, r); err == nil {
		t.Fatal("missing sign history silently reset")
	}
	s, err := CreateSigner(path, k, policy, r, r.record.ValidatorAddress, r.record.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Sign(fixtureRequest(t, 100)); err != nil {
		t.Fatal(err)
	}
	st := s.state
	s.Close()
	st.Height = 101 // Full signed message still records height 100.
	b, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, b, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := ResumeSigner(path, k, r); err == nil {
		t.Fatal("corrupted last height accepted")
	}
}
