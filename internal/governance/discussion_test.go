package governance

import (
	"errors"
	"testing"
	"time"
)

func TestDiscussionIsAppendOnlyReplyBoundAndPersistent(t *testing.T) {
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	s := testService(t)
	p, err := s.Create(proposalInput(now), now)
	if err != nil {
		t.Fatal(err)
	}
	p, err = s.Deposit(p.ID, 100, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.AddDiscussion(DiscussionInput{Nonce: "discussion-nonce-0001", ProposalID: p.ID, Author: "ynx1reviewer", Kind: "technical_review", Statement: "Canary verification should include provider failover behavior.", Evidence: []string{"sha256:failover-test-plan"}}, now.Add(2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.AddDiscussion(first.Input, now.Add(3*time.Minute)); !errors.Is(err, ErrReplay) {
		t.Fatalf("replay: %v", err)
	}
	reply, err := s.AddDiscussion(DiscussionInput{Nonce: "discussion-nonce-0002", ProposalID: p.ID, Author: "ynx1author", Kind: "comment", Statement: "The simulation plan now includes bounded provider failover.", Evidence: []string{"sha256:updated-simulation-plan"}, ReplyTo: first.ID}, now.Add(3*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	items := s.ListDiscussion(p.ID)
	if len(items) != 2 || items[0].ID != first.ID || items[1].ID != reply.ID {
		t.Fatalf("discussion=%+v", items)
	}
	path := t.TempDir() + "/state.json"
	if err = s.Save(path, now.Add(4*time.Minute)); err != nil {
		t.Fatal(err)
	}
	restored, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := restored.ListDiscussion(p.ID); len(got) != 2 || got[1].Input.ReplyTo != first.ID {
		t.Fatalf("restored=%+v", got)
	}
}
