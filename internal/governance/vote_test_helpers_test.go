package governance

import (
	"crypto/ed25519"
	"crypto/sha256"
	"fmt"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

type testVoteIdentity struct {
	ID         string
	PublicKey  string
	PrivateKey ed25519.PrivateKey
}

func testVoter(label string) testVoteIdentity {
	seed := sha256.Sum256([]byte("ynx-governance-test-voter:" + label))
	privateKey := ed25519.NewKeyFromSeed(seed[:])
	publicKey := nativewallet.EncodePublicKey(privateKey.Public().(ed25519.PublicKey))
	id, err := GovernanceVoterID(publicKey)
	if err != nil {
		panic(err)
	}
	return testVoteIdentity{ID: id, PublicKey: publicKey, PrivateKey: privateKey}
}

func testVoterID(label string) string {
	return testVoter(label).ID
}

func normalizeTestSnapshot(snapshot VotingSnapshot) VotingSnapshot {
	out := VotingSnapshot{BasePower: map[string]uint64{}, Delegations: map[string]string{}}
	for label, power := range snapshot.BasePower {
		out.BasePower[testVoterID(label)] = power
	}
	for delegator, delegate := range snapshot.Delegations {
		out.Delegations[testVoterID(delegator)] = testVoterID(delegate)
	}
	return out
}

func makeTestVoteEnvelope(t *testing.T, service *Service, proposalID, voterLabel, choice, operation string, revision uint64, nonce, supersedes string, signedAt time.Time) SignedVoteEnvelope {
	t.Helper()
	proposal, err := service.Get(proposalID)
	if err != nil {
		t.Fatal(err)
	}
	identity := testVoter(voterLabel)
	if nonce == "" {
		nonce = fmt.Sprintf("test-vote-nonce-%s-%d-%d", voterLabel, revision, signedAt.UnixNano())
	}
	envelope := SignedVoteEnvelope{
		Version:                SignedVoteVersion,
		Domain:                 service.policy.VoteDomain,
		ChainID:                service.policy.ChainID,
		ProposalID:             proposal.ID,
		Voter:                  identity.ID,
		Choice:                 choice,
		Operation:              operation,
		Revision:               revision,
		Nonce:                  nonce,
		PublicKey:              identity.PublicKey,
		ElectorateEvidenceHash: proposal.Electorate.EvidenceHash,
		SignedAt:               signedAt.UTC(),
		ExpiresAt:              proposal.VotingEndsAt,
		SupersedesAuditHash:    supersedes,
	}
	envelope, err = SignVoteEnvelope(envelope, identity.PrivateKey)
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}

func castTestVote(t *testing.T, service *Service, proposalID, voterLabel, choice string, now time.Time) (Proposal, error) {
	t.Helper()
	envelope := makeTestVoteEnvelope(t, service, proposalID, voterLabel, choice, VoteOperationCast, 1, "", "", now)
	return service.CastSignedVote(envelope, now)
}

func replaceTestVote(t *testing.T, service *Service, proposalID, voterLabel, choice string, now time.Time) (Proposal, error) {
	t.Helper()
	proposal, err := service.Get(proposalID)
	if err != nil {
		return Proposal{}, err
	}
	current, ok := proposal.Votes[testVoterID(voterLabel)]
	if !ok {
		return Proposal{}, ErrNotFound
	}
	envelope := makeTestVoteEnvelope(t, service, proposalID, voterLabel, choice, VoteOperationReplace, current.Revision+1, "", current.AuditHash, now)
	return service.CastSignedVote(envelope, now)
}

func withdrawTestVote(t *testing.T, service *Service, proposalID, voterLabel string, now time.Time) (Proposal, error) {
	t.Helper()
	proposal, err := service.Get(proposalID)
	if err != nil {
		return Proposal{}, err
	}
	current, ok := proposal.Votes[testVoterID(voterLabel)]
	if !ok {
		return Proposal{}, ErrNotFound
	}
	envelope := makeTestVoteEnvelope(t, service, proposalID, voterLabel, "", VoteOperationWithdraw, current.Revision+1, "", current.AuditHash, now)
	return service.CastSignedVote(envelope, now)
}
