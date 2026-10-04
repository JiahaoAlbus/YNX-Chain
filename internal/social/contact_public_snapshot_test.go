package social

import (
	"testing"
	"time"
)

// Controlled existing business fixtures, not installed users or consent proof.
func TestPublicContactRequestResultsCannotMutateStoredTimes(t *testing.T) {
	for _, route := range []string{"new", "exact_key", "new_key", "opposite", "export", "list"} {
		t.Run(route, func(t *testing.T) {
			s, _ := testService(t)
			a, b := newFixture(t, 133), newFixture(t, 134)
			actor := Session{Account: a.account}
			input := ContactRequestInput{IdempotencyKey: "snapshot-original", TargetAccount: b.account, Source: "handle"}
			result, _, err := s.RequestContact(actor, input)
			if err != nil {
				t.Fatal(err)
			}
			switch route {
			case "exact_key":
				result, _, err = s.RequestContact(actor, input)
			case "new_key":
				input.IdempotencyKey = "snapshot-new-key"
				result, _, err = s.RequestContact(actor, input)
			case "opposite":
				result, _, err = s.RequestContact(Session{Account: b.account}, ContactRequestInput{IdempotencyKey: "snapshot-opposite", TargetAccount: a.account, Source: "qr"})
			case "export":
				records := s.Export(actor).Requests
				if len(records) != 1 {
					t.Fatal("original export missing")
				}
				result = records[0]
			case "list":
				records := s.Requests(actor)
				if len(records) != 1 {
					t.Fatal("original list missing")
				}
				result = records[0]
			}
			if err != nil || result.ExpiresAt == nil {
				t.Fatalf("original request unavailable: %v", err)
			}
			before := objectDigest(s.state)
			*result.ExpiresAt = result.ExpiresAt.Add(time.Hour)
			if objectDigest(s.state) != before {
				t.Fatal("public request result aliases stored deadline")
			}
		})
	}
}

func TestPublicContactTerminalResultsCannotMutateStoredTimes(t *testing.T) {
	for _, action := range []string{"accept", "reject", "withdraw"} {
		for _, route := range []string{"transition", "terminal_replay", "export"} {
			t.Run(action+"/"+route, func(t *testing.T) {
				s, _ := testService(t)
				a, b := newFixture(t, 135), newFixture(t, 136)
				request, _, err := s.RequestContact(Session{Account: a.account}, ContactRequestInput{IdempotencyKey: "terminal-snapshot", TargetAccount: b.account, Source: "handle"})
				if err != nil {
					t.Fatal(err)
				}
				actor := Session{Account: b.account}
				if action == "withdraw" {
					actor.Account = a.account
				}
				result, err := s.TransitionRequest(actor, request.ID, action)
				if err != nil {
					t.Fatal(err)
				}
				if route == "terminal_replay" {
					result, err = s.TransitionRequest(actor, request.ID, action)
				}
				if route == "export" {
					records := s.Export(actor).Requests
					if len(records) != 1 {
						t.Fatal("terminal export missing")
					}
					result = records[0]
				}
				if err != nil || result.ExpiresAt == nil || result.ClosedAt == nil {
					t.Fatalf("terminal snapshot unavailable: %v", err)
				}
				before := objectDigest(s.state)
				*result.ExpiresAt = result.ExpiresAt.Add(time.Hour)
				*result.ClosedAt = result.ClosedAt.Add(time.Hour)
				if objectDigest(s.state) != before {
					t.Fatal("public terminal result aliases stored timestamps")
				}
			})
		}
	}
}
