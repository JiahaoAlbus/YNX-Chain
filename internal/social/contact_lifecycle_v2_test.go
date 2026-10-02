package social

import (
	"errors"
	"sync"
	"testing"
	"time"
)

// Business state-machine tests use synthetic actors, not real user acceptance.
func TestSocialV2ContactIdempotencyCannotChangeTarget(t *testing.T) {
	s, _ := testService(t)
	a, b, c := newFixture(t, 106), newFixture(t, 107), newFixture(t, 108)
	actor := Session{Account: a.account}
	in := ContactRequestInput{IdempotencyKey: "v2-target-bound", TargetAccount: b.account, Source: "handle"}
	first, _, err := s.RequestContact(actor, in)
	if err != nil {
		t.Fatal(err)
	}
	in.TargetAccount = c.account
	if _, _, err := s.RequestContact(actor, in); !errors.Is(err, ErrConflict) {
		t.Fatal("idempotency key silently changed target identity")
	}
	if len(s.state.Requests) != 1 || first.To != b.account {
		t.Fatal("conflicting replay mutated relationships")
	}
}

func TestSocialV2ContactOppositeRequestsCoalesceWithoutAutoConsent(t *testing.T) {
	s, _ := testService(t)
	a, b := newFixture(t, 109), newFixture(t, 110)
	actors := []Session{{Account: a.account}, {Account: b.account}}
	inputs := []ContactRequestInput{{IdempotencyKey: "v2-from-a", TargetAccount: b.account, Source: "handle"}, {IdempotencyKey: "v2-from-b", TargetAccount: a.account, Source: "qr"}}
	var wg sync.WaitGroup
	results := make([]ContactRequest, 2)
	errs := make([]error, 2)
	for index := range actors {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			results[index], _, errs[index] = s.RequestContact(actors[index], inputs[index])
		}(index)
	}
	wg.Wait()
	if errs[0] != nil || errs[1] != nil || results[0].ID != results[1].ID || len(s.state.Requests) != 1 || len(s.state.Contacts) != 0 {
		t.Fatal("opposite requests duplicated or auto-created friendship")
	}
	for index := range actors {
		result, replay, err := s.RequestContact(actors[index], inputs[index])
		if err != nil || !replay || result.ID != results[0].ID {
			t.Fatal("coalesced retry changed original request")
		}
	}
	request := results[0]
	accepted, err := s.TransitionRequest(Session{Account: request.To}, request.ID, "accept")
	if err != nil || accepted.Status != "accepted" || len(s.state.Contacts) != 1 {
		t.Fatal("recipient explicit consent did not create one bilateral relationship")
	}
	count := len(s.state.Audit)
	if retry, err := s.TransitionRequest(Session{Account: request.To}, request.ID, "accept"); err != nil || retry.ID != accepted.ID || len(s.state.Audit) != count {
		t.Fatal("repeated acceptance duplicated audit or failed")
	}
	if _, err := s.TransitionRequest(Session{Account: request.From}, request.ID, "withdraw"); !errors.Is(err, ErrConflict) {
		t.Fatal("withdraw overwrote accepted winner")
	}
}

func TestSocialV2ContactTerminalRetryAndReopenNeverRestoresDeletedFriend(t *testing.T) {
	for _, action := range []string{"accept", "reject", "withdraw"} {
		t.Run(action, func(t *testing.T) {
			s, _ := testService(t)
			a, b := newFixture(t, 111), newFixture(t, 112)
			in := ContactRequestInput{IdempotencyKey: "v2-terminal-" + action, TargetAccount: b.account, Source: "handle"}
			request, _, err := s.RequestContact(Session{Account: a.account}, in)
			if err != nil {
				t.Fatal(err)
			}
			actor := Session{Account: b.account}
			if action == "withdraw" {
				actor.Account = a.account
			}
			final, err := s.TransitionRequest(actor, request.ID, action)
			if err != nil {
				t.Fatal(err)
			}
			audit := len(s.state.Audit)
			if retry, err := s.TransitionRequest(actor, request.ID, action); err != nil || retry.Status != final.Status || len(s.state.Audit) != audit {
				t.Fatal("terminal retry was not idempotent")
			}
			if action == "accept" {
				if err := s.DeleteContact(Session{Account: a.account}, b.account); err != nil {
					t.Fatal(err)
				}
			}
			if _, _, err := s.RequestContact(Session{Account: a.account}, in); err != nil {
				t.Fatal("historical request receipt lost on retry")
			}
			if action == "accept" && len(s.state.Contacts) != 0 {
				t.Fatal("old accepted receipt resurrected deleted friendship")
			}
			restarted, err := New(s.cfg)
			if err != nil {
				t.Fatal(err)
			}
			if retry, err := restarted.TransitionRequest(actor, request.ID, action); err != nil || retry.Status != final.Status {
				t.Fatal("terminal retry did not survive restart")
			}
			if action == "accept" && len(restarted.state.Contacts) != 0 {
				t.Fatal("restart restored removed friendship")
			}
		})
	}
}

func TestSocialV2ContactAcceptWithdrawRaceHasOnePersistentWinner(t *testing.T) {
	s, _ := testService(t)
	a, b := newFixture(t, 113), newFixture(t, 114)
	request, _, err := s.RequestContact(Session{Account: a.account}, ContactRequestInput{IdempotencyKey: "v2-race", TargetAccount: b.account, Source: "handle"})
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make([]error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, results[0] = s.TransitionRequest(Session{Account: b.account}, request.ID, "accept")
	}()
	go func() {
		defer wg.Done()
		_, results[1] = s.TransitionRequest(Session{Account: a.account}, request.ID, "withdraw")
	}()
	wg.Wait()
	if (results[0] == nil) == (results[1] == nil) {
		t.Fatal("race did not have exactly one winner")
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	final := restarted.state.Requests[request.ID]
	if final.Status == "accepted" && len(restarted.state.Contacts) != 1 || final.Status == "withdrawn" && len(restarted.state.Contacts) != 0 {
		t.Fatal("winner and durable relationship disagreed")
	}
}

func TestSocialV2ContactRequestExpiresWithoutChangingLegacyPending(t *testing.T) {
	s, now := testService(t)
	a, b := newFixture(t, 115), newFixture(t, 116)
	request, _, err := s.RequestContact(Session{Account: a.account}, ContactRequestInput{IdempotencyKey: "v2-expiring", TargetAccount: b.account, Source: "handle"})
	if err != nil {
		t.Fatal(err)
	}
	s.cfg.Now = func() time.Time { return now.Add(8 * 24 * time.Hour) }
	if list := s.Requests(Session{Account: a.account}); len(list) != 1 || list[0].Status != "expired" {
		t.Fatal("expired pending request remained actionable")
	}
	if _, err := s.TransitionRequest(Session{Account: b.account}, request.ID, "accept"); err == nil || len(s.state.Contacts) != 0 {
		t.Fatal("expired request granted friendship")
	}
	legacy := request
	legacy.ID = "legacy-pending"
	legacy.ExpiresAt = nil
	legacy.Status = "pending"
	s.state.Requests[legacy.ID] = legacy
	if _, err := s.TransitionRequest(Session{Account: b.account}, legacy.ID, "accept"); err != nil {
		t.Fatal("legacy request was retroactively expired")
	}
}
