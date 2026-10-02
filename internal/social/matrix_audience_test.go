package social

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type syntheticAudienceAuthority struct {
	observe func(MatrixAudienceMetadata)
	event   MatrixAudienceEvent
}

func (a *syntheticAudienceAuthority) ConfirmAudience(_ context.Context, m MatrixAudienceMetadata, _ string) (MatrixAudienceObservation, error) {
	if a.observe != nil {
		a.observe(m)
	}
	return MatrixAudienceObservation{"!synthetic:example.invalid", append([]string(nil), m.Members...), "m.megolm.v1.aes-sha2", "joined"}, nil
}
func (a *syntheticAudienceAuthority) ObserveEvent(context.Context, string, string) (MatrixAudienceEvent, error) {
	return a.event, nil
}

func audienceFixture(t *testing.T) (*Service, string, string, *syntheticAudienceAuthority) {
	t.Helper()
	s, _ := testService(t)
	a, b := newFixture(t, 142), newFixture(t, 143)
	request, _, err := s.RequestContact(Session{Account: a.account}, ContactRequestInput{IdempotencyKey: "audience-contact", TargetAccount: b.account, Source: "handle"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.TransitionRequest(Session{Account: b.account}, request.ID, "accept"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.publicIdentity(b.account); err != nil {
		t.Fatal(err)
	}
	s.cfg.MatrixDirectory = &MatrixDirectory{identities: map[string]MatrixIdentity{
		a.account: {a.account, "https://example.invalid/", "example.invalid", "@alice:example.invalid"},
		b.account: {b.account, "https://example.invalid/", "example.invalid", "@bob:example.invalid"},
	}}
	authority := &syntheticAudienceAuthority{}
	s.cfg.MatrixAudienceAuthority = authority
	return s, a.account, b.account, authority
}

func TestMatrixAudienceOriginalStoreDurableBindingIndexAndReaderGate(t *testing.T) {
	s, actor, _, authority := audienceFixture(t)
	ctx := context.Background()
	metadata, err := s.ResolveMatrixAudience(ctx, actor, MatrixAudienceSelection{Kind: "contacts"})
	if err != nil {
		t.Fatal(err)
	}
	if metadata.Owner != "@alice:example.invalid" || len(metadata.Members) != 2 {
		t.Fatal("existing directory/contacts not used")
	}
	txn := "original_transaction_001"
	authority.event = MatrixAudienceEvent{metadata.RoomID, "$event", metadata.Owner, "m.room.encrypted", txn}
	input := matrixAudienceAuthorize{Action: "index", TransactionID: txn, Expected: metadata, EventID: "$event"}
	if _, err = s.AuthorizeMatrixAudience(ctx, actor, input); err != nil {
		t.Fatal(err)
	}
	if _, err = s.AuthorizeMatrixAudience(ctx, actor, input); err != nil {
		t.Fatal("exact index replay", err)
	}
	if len(s.state.RestrictedMomentIndexes) != 1 {
		t.Fatal("duplicate index")
	}
	encoded, _ := json.Marshal(s.state.RestrictedMomentIndexes)
	for _, forbidden := range []string{`"text"`, `"body"`, `"file"`, `"key"`, `"mimetype"`} {
		if bytes.Contains(encoded, []byte(forbidden)) {
			t.Fatal("secret content in index")
		}
	}
	if _, err = CheckSocialState(s.cfg.StatePath, s.cfg.TokenKey, 6, "check"); err == nil {
		t.Fatal("schema6 admitted new bindings")
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = restarted.AuthorizeMatrixAudience(ctx, actor, input); err != nil {
		t.Fatal("restart lost exact binding", err)
	}
	input.EventID = "$different"
	authority.event.EventID = input.EventID
	if _, err = restarted.AuthorizeMatrixAudience(ctx, actor, input); !errors.Is(err, ErrConflict) {
		t.Fatal("transaction substituted index", err)
	}
}

func TestMatrixAudiencePolicyEpochRejectsRemoveRestoreABA(t *testing.T) {
	s, actor, _, _ := audienceFixture(t)
	ctx := context.Background()
	metadata, err := s.ResolveMatrixAudience(ctx, actor, MatrixAudienceSelection{Kind: "contacts"})
	if err != nil {
		t.Fatal(err)
	}
	original := cloneState(s.state)
	epoch := s.state.AudiencePolicyRevision
	before := cloneState(s.state)
	s.state.Contacts = map[string]Contact{}
	if err = s.saveOrRollbackLocked(before); err != nil {
		t.Fatal(err)
	}
	before = cloneState(s.state)
	s.state.Contacts = original.Contacts
	if err = s.saveOrRollbackLocked(before); err != nil {
		t.Fatal(err)
	}
	if s.state.AudiencePolicyRevision != epoch+2 {
		t.Fatal("remove/restore did not advance persisted policy epoch")
	}
	_, err = s.AuthorizeMatrixAudience(ctx, actor, matrixAudienceAuthorize{Action: "publish", TransactionID: "original_transaction_001", Expected: metadata})
	if !errors.Is(err, ErrConflict) {
		t.Fatal("old audience survived relationship ABA", err)
	}
}

func TestMatrixAudienceConcurrentPolicyChangeDuringRoomConfirmationFailsClosed(t *testing.T) {
	s, actor, _, authority := audienceFixture(t)
	authority.observe = func(MatrixAudienceMetadata) {
		before := cloneState(s.state)
		s.state.Blocks["synthetic-policy-change"] = time.Now()
		if err := s.saveOrRollbackLocked(before); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.ResolveMatrixAudience(context.Background(), actor, MatrixAudienceSelection{Kind: "contacts"}); !errors.Is(err, ErrConflict) {
		t.Fatal("stale room policy confirmed", err)
	}
	if len(s.state.MatrixAudiences) != 0 {
		t.Fatal("stale room binding persisted")
	}
	s.cfg.MatrixAudienceAuthority = nil
	if _, err := s.ResolveMatrixAudience(context.Background(), actor, MatrixAudienceSelection{Kind: "private"}); !errors.Is(err, ErrConflict) {
		t.Fatal("missing real room authority did not block", err)
	}
}

func TestMatrixAudienceStrictMountedRoutesRejectMalformedAndUnapprovedRequests(t *testing.T) {
	s, _, _, _ := audienceFixture(t)
	handler := (&Server{service: s}).Handler()
	for _, path := range []string{"resolve", "authorize"} {
		for _, body := range []string{`{"kind":"private","kind":"contacts"}`, `{"kind":"private","owner":"@caller:invalid"}`, `{"expected":{"owner":"a","owner":"b"}}`, string([]byte{'{', '"', 'k', '"', ':', '"', 0xff, '"', '}'})} {
			request := httptest.NewRequest(http.MethodPost, "/social/v3/matrix/audience/"+path, strings.NewReader(body))
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("strict route %s accepted malformed body: %d", path, response.Code)
			}
		}
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/social/v3/matrix/audience/resolve", strings.NewReader(`{"kind":"private"}`)))
	if response.Code != http.StatusUnauthorized {
		t.Fatal("unapproved identity published audience", response.Code)
	}
}

func TestMatrixAudienceSelectedAndGroupComeFromOriginalState(t *testing.T) {
	s, actor, peer, _ := audienceFixture(t)
	ctx := context.Background()
	id := s.state.PublicIdentities[peer]
	selected, err := s.ResolveMatrixAudience(ctx, actor, MatrixAudienceSelection{Kind: "selected", Selected: []string{id}})
	if err != nil || len(selected.Members) != 2 {
		t.Fatal("opaque accepted identity was not resolved", err)
	}
	if _, err = s.ResolveMatrixAudience(ctx, actor, MatrixAudienceSelection{Kind: "selected", Selected: []string{peer}}); !errors.Is(err, ErrInvalid) {
		t.Fatal("funding account accepted as selected identity", err)
	}
	before := cloneState(s.state)
	s.state.Groups["existing-group"] = GroupConversation{ID: "existing-group", CreatedBy: actor, Members: []string{actor, peer}, CreatedAt: s.cfg.Now(), UpdatedAt: s.cfg.Now()}
	if err = s.saveOrRollbackLocked(before); err != nil {
		t.Fatal(err)
	}
	group, err := s.ResolveMatrixAudience(ctx, actor, MatrixAudienceSelection{Kind: "group", GroupID: "existing-group"})
	if err != nil || len(group.Members) != 2 {
		t.Fatal("original group membership not used", err)
	}
	if _, err = s.ResolveMatrixAudience(ctx, peer, MatrixAudienceSelection{Kind: "group", GroupID: "existing-group"}); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("group outsider/owner substitution accepted", err)
	}
}

func TestMatrixAudienceSchemaSixUpgradePreservesOriginalRelationships(t *testing.T) {
	s, actor, peer, _ := audienceFixture(t)
	legacy := cloneState(s.state)
	legacy.SchemaVersion = 6
	legacy.AudiencePolicyRevision = 0
	legacy.MatrixAudiences = nil
	legacy.RestrictedMomentIndexes = nil
	if err := saveState(s.cfg.StatePath, &legacy, s.cfg.TokenKey); err != nil {
		t.Fatal(err)
	}
	if _, err := CheckSocialState(s.cfg.StatePath, s.cfg.TokenKey, 6, "check"); err != nil {
		t.Fatal("original schema6 reader gate changed", err)
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.state.SchemaVersion != 7 || !restarted.contactLocked(actor, peer) || restarted.state.PublicIdentities[peer] != legacy.PublicIdentities[peer] {
		t.Fatal("schema6 upgrade lost relationship or public identity")
	}
	if _, err := CheckSocialState(s.cfg.StatePath, s.cfg.TokenKey, 6, "check"); err == nil {
		t.Fatal("old reader admitted upgraded state")
	}
}
