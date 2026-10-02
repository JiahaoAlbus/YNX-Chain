package social

import (
	"errors"
	"strings"
	"testing"
)

func TestContactMessageBoundToOriginalRequestAndRetry(t *testing.T) {
	s, _ := testService(t)
	a, b := newFixture(t, 132), newFixture(t, 133)
	in := ContactRequestInput{IdempotencyKey: "contact-note", TargetAccount: b.account, Source: "handle", Message: " Hello Bob "}
	first, _, err := s.RequestContact(Session{Account: a.account}, in)
	if err != nil || first.Message != "Hello Bob" {
		t.Fatal("message was not stored")
	}
	if retry, replay, err := s.RequestContact(Session{Account: a.account}, in); err != nil || !replay || retry.Message != first.Message {
		t.Fatal("message retry changed original")
	}
	in.Message = "changed"
	if _, _, err := s.RequestContact(Session{Account: a.account}, in); !errors.Is(err, ErrConflict) {
		t.Fatal("idempotency key changed message")
	}
	opposite, _, err := s.RequestContact(Session{Account: b.account}, ContactRequestInput{IdempotencyKey: "contact-note-opposite", TargetAccount: a.account, Source: "qr", Message: "Other person's note"})
	if err != nil || opposite.ID != first.ID || opposite.Message != first.Message {
		t.Fatal("opposite request overwrote original note")
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.state.Requests[first.ID].Message != first.Message || len(restarted.state.Contacts) != 0 {
		t.Fatal("message lost on restart or created consent")
	}
}

func TestContactMessageBoundsDoNotCreateRequests(t *testing.T) {
	s, _ := testService(t)
	a, b := newFixture(t, 134), newFixture(t, 135)
	for _, message := range []string{strings.Repeat("界", 201), "unsafe\x00note", string([]byte{0xff})} {
		if _, _, err := s.RequestContact(Session{Account: a.account}, ContactRequestInput{IdempotencyKey: "invalid-note", TargetAccount: b.account, Source: "handle", Message: message}); !errors.Is(err, ErrInvalid) {
			t.Fatal("invalid message accepted")
		}
	}
	if len(s.state.Requests) != 0 {
		t.Fatal("invalid note mutated requests")
	}
	if _, _, err := s.RequestContact(Session{Account: a.account}, ContactRequestInput{IdempotencyKey: "valid-note", TargetAccount: b.account, Source: "handle", Message: strings.Repeat("界", 200)}); err != nil {
		t.Fatal("200-character unicode note rejected")
	}
}
