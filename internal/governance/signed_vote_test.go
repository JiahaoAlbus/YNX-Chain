package governance

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func resignTestEnvelope(t *testing.T, envelope SignedVoteEnvelope, voterLabel string) SignedVoteEnvelope {
	t.Helper()
	identity := testVoter(voterLabel)
	envelope.Signature = ""
	signed, err := SignVoteEnvelope(envelope, identity.PrivateKey)
	if err != nil {
		t.Fatal(err)
	}
	return signed
}

func TestSignedVoteRejectsBindingTamperExpiryReplayAndDuplicate(t *testing.T) {
	now := time.Date(2026, 7, 25, 17, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := proposalAtVoting(t, service, now, VotingSnapshot{BasePower: map[string]uint64{"alice": 100}})
	castAt := now.Add(4 * time.Minute)
	valid := makeTestVoteEnvelope(t, service, proposal.ID, "alice", "yes", VoteOperationCast, 1, "signed-vote-replay-nonce-0001", "", castAt)

	tests := []struct {
		name     string
		envelope SignedVoteEnvelope
		callAt   time.Time
		expected error
	}{
		{
			name: "wrong chain",
			envelope: func() SignedVoteEnvelope {
				candidate := valid
				candidate.ChainID = "wrong-chain"
				return resignTestEnvelope(t, candidate, "alice")
			}(),
			callAt: castAt, expected: ErrInvalid,
		},
		{
			name: "wrong domain",
			envelope: func() SignedVoteEnvelope {
				candidate := valid
				candidate.Domain = "wrong-governance-domain"
				return resignTestEnvelope(t, candidate, "alice")
			}(),
			callAt: castAt, expected: ErrInvalid,
		},
		{
			name: "wrong proposal",
			envelope: func() SignedVoteEnvelope {
				candidate := valid
				candidate.ProposalID = strings.Repeat("f", 64)
				return resignTestEnvelope(t, candidate, "alice")
			}(),
			callAt: castAt, expected: ErrNotFound,
		},
		{
			name: "wrong voter",
			envelope: func() SignedVoteEnvelope {
				candidate := valid
				candidate.Voter = testVoterID("bob")
				return resignTestEnvelope(t, candidate, "alice")
			}(),
			callAt: castAt, expected: ErrForbidden,
		},
		{
			name: "wrong public key",
			envelope: func() SignedVoteEnvelope {
				candidate := valid
				candidate.PublicKey = testVoter("bob").PublicKey
				return resignTestEnvelope(t, candidate, "bob")
			}(),
			callAt: castAt, expected: ErrForbidden,
		},
		{
			name: "choice tamper",
			envelope: func() SignedVoteEnvelope {
				candidate := valid
				candidate.Choice = "no"
				return candidate
			}(),
			callAt: castAt, expected: ErrForbidden,
		},
		{
			name: "wrong electorate snapshot",
			envelope: func() SignedVoteEnvelope {
				candidate := valid
				candidate.ElectorateEvidenceHash = strings.Repeat("8", 64)
				return resignTestEnvelope(t, candidate, "alice")
			}(),
			callAt: castAt, expected: ErrInvalid,
		},
		{
			name: "expired vote",
			envelope: func() SignedVoteEnvelope {
				candidate := valid
				candidate.Nonce = "signed-vote-expired-nonce-0001"
				candidate.SignedAt = castAt
				candidate.ExpiresAt = castAt.Add(30 * time.Second)
				return resignTestEnvelope(t, candidate, "alice")
			}(),
			callAt: castAt.Add(time.Minute), expected: ErrForbidden,
		},
		{
			name: "future signed timestamp",
			envelope: func() SignedVoteEnvelope {
				candidate := valid
				candidate.Nonce = "signed-vote-future-nonce-0001"
				candidate.SignedAt = castAt.Add(3 * time.Minute)
				return resignTestEnvelope(t, candidate, "alice")
			}(),
			callAt: castAt, expected: ErrForbidden,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := service.CastSignedVote(test.envelope, test.callAt); !errors.Is(err, test.expected) {
				t.Fatalf("got %v, expected %v", err, test.expected)
			}
		})
	}

	updated, err := service.CastSignedVote(valid, castAt)
	if err != nil {
		t.Fatal(err)
	}
	vote := updated.Votes[testVoterID("alice")]
	if vote.Operation != VoteOperationCast || vote.Revision != 1 || vote.Signature == "" || vote.PublicKey == "" || vote.Nonce != valid.Nonce || vote.ElectorateEvidenceHash != proposal.Electorate.EvidenceHash || vote.AuditHash == "" {
		t.Fatalf("incomplete signed vote: %+v", vote)
	}
	if _, err = service.CastSignedVote(valid, castAt.Add(time.Second)); !errors.Is(err, ErrReplay) {
		t.Fatalf("exact replay accepted: %v", err)
	}
	duplicate := makeTestVoteEnvelope(t, service, proposal.ID, "alice", "yes", VoteOperationCast, 1, "signed-vote-duplicate-nonce-0001", "", castAt.Add(2*time.Second))
	if _, err = service.CastSignedVote(duplicate, castAt.Add(2*time.Second)); !errors.Is(err, ErrReplay) {
		t.Fatalf("duplicate cast accepted: %v", err)
	}
}

func TestVoteReplacementWithdrawalHistoryAndTallyIntegrity(t *testing.T) {
	now := time.Date(2026, 7, 25, 18, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := proposalAtVoting(t, service, now, VotingSnapshot{BasePower: map[string]uint64{"alice": 60, "bob": 40}})

	proposal, err := castTestVote(t, service, proposal.ID, "alice", "yes", now.Add(4*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	first := proposal.Votes[testVoterID("alice")]
	proposal, err = replaceTestVote(t, service, proposal.ID, "alice", "no", now.Add(5*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	second := proposal.Votes[testVoterID("alice")]
	if second.Revision != 2 || second.Operation != VoteOperationReplace || second.SupersedesAuditHash != first.AuditHash || len(proposal.VoteHistory[testVoterID("alice")]) != 2 {
		t.Fatalf("replacement chain invalid: %+v", proposal.VoteHistory[testVoterID("alice")])
	}
	if _, err = replaceTestVote(t, service, proposal.ID, "alice", "no", now.Add(6*time.Minute)); !errors.Is(err, ErrForbidden) {
		t.Fatalf("no-op replacement accepted: %v", err)
	}
	if _, err = castTestVote(t, service, proposal.ID, "bob", "yes", now.Add(6*time.Minute)); err != nil {
		t.Fatal(err)
	}
	proposal, err = withdrawTestVote(t, service, proposal.ID, "alice", now.Add(7*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	withdrawn := proposal.Votes[testVoterID("alice")]
	if withdrawn.Operation != VoteOperationWithdraw || withdrawn.Choice != "" || withdrawn.Revision != 3 || withdrawn.SupersedesAuditHash != second.AuditHash || len(proposal.VoteHistory[testVoterID("alice")]) != 3 {
		t.Fatalf("withdrawal chain invalid: %+v", proposal.VoteHistory[testVoterID("alice")])
	}
	if _, err = withdrawTestVote(t, service, proposal.ID, "alice", now.Add(8*time.Minute)); !errors.Is(err, ErrForbidden) {
		t.Fatalf("duplicate withdrawal accepted: %v", err)
	}
	publicVotes := service.PublicVotes()
	if len(publicVotes) != 4 {
		t.Fatalf("public signed revision count=%d", len(publicVotes))
	}
	currentCount := 0
	for _, publicVote := range publicVotes {
		if publicVote.Signature == "" || publicVote.PublicKey == "" || publicVote.Nonce == "" || publicVote.AuditHash == "" {
			t.Fatalf("public vote proof incomplete: %+v", publicVote)
		}
		if publicVote.CurrentRevision {
			currentCount++
		}
	}
	if currentCount != 2 {
		t.Fatalf("current revision count=%d", currentCount)
	}
	proposal, err = service.Finalize(proposal.ID, proposal.VotingEndsAt)
	if err != nil || proposal.Status != StatusQuorumFailed {
		t.Fatalf("withdrawn power was counted in tally: status=%s err=%v", proposal.Status, err)
	}
}

func TestVoteReplayRegistryPersistsAcrossRestore(t *testing.T) {
	now := time.Date(2026, 7, 25, 19, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := proposalAtVoting(t, service, now, VotingSnapshot{BasePower: map[string]uint64{"alice": 100}})
	envelope := makeTestVoteEnvelope(t, service, proposal.ID, "alice", "yes", VoteOperationCast, 1, "signed-vote-persisted-nonce-0001", "", now.Add(4*time.Minute))
	if _, err := service.CastSignedVote(envelope, now.Add(4*time.Minute)); err != nil {
		t.Fatal(err)
	}
	path := t.TempDir() + "/state.json"
	if err := service.Save(path, now.Add(5*time.Minute)); err != nil {
		t.Fatal(err)
	}
	restored, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(restored.PublicVotes()) != 1 || len(restored.voteNonces) != 1 {
		t.Fatalf("signed vote persistence incomplete: votes=%v nonces=%v", restored.PublicVotes(), restored.voteNonces)
	}
	if _, err = restored.CastSignedVote(envelope, now.Add(6*time.Minute)); !errors.Is(err, ErrReplay) {
		t.Fatalf("restored replay accepted: %v", err)
	}
	if _, err = replaceTestVote(t, restored, proposal.ID, "alice", "no", now.Add(7*time.Minute)); err != nil {
		t.Fatalf("valid post-restore replacement failed: %v", err)
	}
}

func TestRestoreRejectsSignedVoteTamperAndNonceRegistryMismatch(t *testing.T) {
	now := time.Date(2026, 7, 25, 20, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := proposalAtVoting(t, service, now, VotingSnapshot{BasePower: map[string]uint64{"alice": 100}})
	if _, err := castTestVote(t, service, proposal.ID, "alice", "yes", now.Add(4*time.Minute)); err != nil {
		t.Fatal(err)
	}

	t.Run("signed payload tamper", func(t *testing.T) {
		path := t.TempDir() + "/state.json"
		if err := service.Save(path, now.Add(5*time.Minute)); err != nil {
			t.Fatal(err)
		}
		rewriteSnapshot(t, path, func(envelope *snapshotEnvelope) {
			stored := &envelope.Payload.Proposals[0]
			voter := testVoterID("alice")
			vote := stored.VoteHistory[voter][0]
			vote.Choice = "no"
			vote.AuditHash = voteAudit(vote)
			stored.VoteHistory[voter][0] = vote
			stored.Votes[voter] = vote
		})
		if _, err := Load(path); !errors.Is(err, ErrForbidden) || !strings.Contains(err.Error(), "signed vote") {
			t.Fatalf("tampered signed vote was not rejected: %v", err)
		}
	})

	t.Run("nonce registry removal", func(t *testing.T) {
		path := t.TempDir() + "/state.json"
		if err := service.Save(path, now.Add(5*time.Minute)); err != nil {
			t.Fatal(err)
		}
		rewriteSnapshot(t, path, func(envelope *snapshotEnvelope) {
			envelope.Payload.VoteNonces = nil
		})
		if _, err := Load(path); !errors.Is(err, ErrForbidden) || !strings.Contains(err.Error(), "nonce registry") {
			t.Fatalf("missing vote nonce registry was not rejected: %v", err)
		}
	})
}
