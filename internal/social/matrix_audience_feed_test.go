package social

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

type feedTestAuthority struct {
	original           MatrixAudienceAuthority
	peer               string
	event              MatrixAudienceEvent
	confirms, observes int
}

func (a *feedTestAuthority) ConfirmAudience(ctx context.Context, expected MatrixAudienceMetadata, room string) (MatrixAudienceObservation, error) {
	a.confirms++
	return a.original.ConfirmAudience(ctx, expected, room)
}
func (a *feedTestAuthority) ObserveEvent(context.Context, string, string) (MatrixAudienceEvent, error) {
	a.observes++
	return a.event, nil
}

// Original Social services and durable state; controlled HS observations only.
func indexedFeedFixture(t *testing.T) (*Service, string, *feedTestAuthority) {
	t.Helper()
	s, actor, peer, original := audienceFixture(t)
	authority := &feedTestAuthority{original: original, peer: peer}
	s.cfg.MatrixAudienceAuthority = authority
	expected, err := s.ResolveMatrixAudience(context.Background(), actor, MatrixAudienceSelection{Kind: "contacts"})
	if err != nil {
		t.Fatal(err)
	}
	const txn = "original_feed_index_transaction_001"
	if _, err = s.AuthorizeMatrixAudience(context.Background(), actor, matrixAudienceAuthorize{Action: "publish", TransactionID: txn, Expected: expected}); err != nil {
		t.Fatal(err)
	}
	authority.event = MatrixAudienceEvent{RoomID: expected.RoomID, EventID: "$original-feed-event", Sender: expected.Owner, Type: "m.room.encrypted", TransactionID: txn}
	if _, err = s.AuthorizeMatrixAudience(context.Background(), actor, matrixAudienceAuthorize{Action: "index", TransactionID: txn, Expected: expected, EventID: authority.event.EventID}); err != nil {
		t.Fatal(err)
	}
	authority.confirms = 0
	authority.observes = 0
	return s, actor, authority
}

func TestMatrixAudienceFeedOriginalIndexMetadataOnly(t *testing.T) {
	s, actor, authority := indexedFeedFixture(t)
	checks := 0
	feed, err := s.readMatrixAudienceIndexes(context.Background(), actor, "", func() error { checks++; return nil })
	if err != nil {
		t.Fatal(err)
	}
	if len(feed.Indexes) != 1 || feed.Indexes[0].EventID != authority.event.EventID || feed.Indexes[0].Sender != authority.event.Sender || authority.confirms != 1 || authority.observes != 1 || checks < 4 {
		t.Fatalf("missing original authority/read checks: feed=%+v checks=%d confirm=%d observe=%d", feed, checks, authority.confirms, authority.observes)
	}
	raw, err := json.Marshal(feed)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("syntheticFeed=%s", raw)
	for _, forbidden := range []string{`"text"`, `"body"`, `"ciphertext"`, `"key"`, `"accessToken"`} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("private content leaked in index: %s", forbidden)
		}
	}
}

func TestMatrixAudienceFeedAcceptedFriendThenDeleteContact(t *testing.T) {
	s, actor, authority := indexedFeedFixture(t)
	peer := authority.peer
	if peer == "" {
		t.Fatal("original fixture peer missing")
	}
	feed, err := s.readMatrixAudienceIndexes(context.Background(), peer, "", func() error { return nil })
	if err != nil || len(feed.Indexes) != 1 {
		t.Fatalf("accepted friend cannot read original encrypted index: %v %+v", err, feed)
	}
	if err := s.DeleteContact(Session{Account: actor, Scopes: []string{"social.contacts"}}, peer); err != nil {
		t.Fatal(err)
	}
	authority.confirms = 0
	authority.observes = 0
	feed, err = s.readMatrixAudienceIndexes(context.Background(), peer, "", func() error { return nil })
	if err != nil || len(feed.Indexes) != 0 || authority.confirms != 0 || authority.observes != 0 {
		t.Fatalf("deleted relation reached HS or returned index: %v %+v confirms=%d observes=%d", err, feed, authority.confirms, authority.observes)
	}
}

func TestMatrixAudienceFeedRevocationBeforeAndAfterHS(t *testing.T) {
	for _, at := range []int{1, 2, 3} {
		t.Run(string(rune('0'+at)), func(t *testing.T) {
			s, actor, authority := indexedFeedFixture(t)
			checks := 0
			_, err := s.readMatrixAudienceIndexes(context.Background(), actor, "", func() error {
				checks++
				if checks == at {
					return ErrUnauthorized
				}
				return nil
			})
			if !errors.Is(err, ErrUnauthorized) {
				t.Fatalf("revocation accepted: %v", err)
			}
			if at == 1 && (authority.confirms != 0 || authority.observes != 0) {
				t.Fatal("initial revocation reached HS")
			}
			if at == 2 && authority.observes != 0 {
				t.Fatal("post-confirm revocation reached event observation")
			}
			feed, err := s.readMatrixAudienceIndexes(context.Background(), actor, "", func() error { return nil })
			if err != nil || len(feed.Indexes) != 1 {
				t.Fatalf("read failure changed original durable index: %v %+v", err, feed)
			}
		})
	}
}

func TestMatrixAudienceFeedRejectsDifferentObservedSender(t *testing.T) {
	s, actor, authority := indexedFeedFixture(t)
	original := authority.event.Sender
	authority.event.Sender = "@substituted:fixture.invalid"
	if _, err := s.readMatrixAudienceIndexes(context.Background(), actor, "", func() error { return nil }); err == nil {
		t.Fatal("substituted event sender accepted")
	}
	authority.event.Sender = original
	feed, err := s.readMatrixAudienceIndexes(context.Background(), actor, "", func() error { return nil })
	if err != nil || len(feed.Indexes) != 1 {
		t.Fatal("original indexed event was not retained")
	}
}
