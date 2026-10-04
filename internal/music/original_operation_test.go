package music

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
)

func operationMusicLease(actor string, s *Service) *musicBusinessLease {
	l := testBusinessLease(actor, "original_operation_nonce_001", s.cfg.Now)
	l.grant.ProductID = "music"
	l.grant.Scope = "music.write"
	l.grant.RequireOperationAssociation = true
	l.grant.Operation = &MusicOriginalOperationMetadata{OperationID: strings.Repeat("c", 64), SessionBinding: l.grant.SessionBinding, NodeRequestDigest: strings.Repeat("f", 64), ActionBodyDigest: l.grant.BodyDigest, Method: "POST", Path: "/api/profile"}
	l.grant.Current = func(context.Context) error { return nil }
	l.grant.CaptureTransaction = func(context.Context) (MusicLocalTransaction, error) {
		return musicLocalTestTransaction(func(c context.Context, f func(context.Context) error) error { return f(c) }), nil
	}
	return l
}
func TestMusicOriginalOperationDurableDetachedAndCollision(t *testing.T) {
	s := testService(t)
	actor := testAccount(t, 24)
	l := operationMusicLease(actor, s)
	sc := s.requestService(l)
	original := *l.grant.Operation
	l.grant.Operation.OperationID = strings.Repeat("d", 64)
	if _, err := sc.UpsertProfile(actor, Profile{DisplayName: "mapped"}); err != nil {
		t.Fatal(err)
	}
	n, err := s.ReadOriginalBusinessNonce(context.Background(), l.grant.SessionBinding, l.grant.Nonce)
	if err != nil || n.Operation == nil || *n.Operation != original || n.Operation.NodeRequestDigest == n.BodyDigest || n.Operation.ActionBodyDigest != n.BodyDigest {
		t.Fatal(n, err)
	}
	i := s.state.OriginalOperations[original.OperationID].Identity
	r, err := s.ReadOriginalBusinessOperation(context.Background(), i)
	if err != nil || len(r.Record.Steps) != 1 {
		t.Fatal(r, err)
	}
	r.Record.Steps[0].ObjectID = "foreign"
	recovered, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	r, err = recovered.ReadOriginalBusinessOperation(context.Background(), i)
	if err != nil || r.Record.Steps[0].ObjectID == "foreign" {
		t.Fatal(r, err)
	}
	foreign := i
	foreign.BodyDigest = strings.Repeat("f", 64)
	if _, err = recovered.ReadOriginalBusinessOperation(context.Background(), foreign); !errors.Is(err, ErrUnauthorized) {
		t.Fatal(err)
	}
	if err = recovered.mutate(actor, "test_expired_marker", actor, nil, func(st *persistentState) error { delete(st.BusinessNonces, i.BusinessKey); return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err = recovered.requestService(operationMusicLease(actor, recovered)).UpsertProfile(actor, Profile{DisplayName: "redispatch"}); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("same operation repeated", err)
	}
}
func TestMusicOriginalOperationProviderSubmissionAndUnknown(t *testing.T) {
	for _, status := range []int{200, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			s, actor, v, input := effectFixture(t)
			var calls atomic.Int32
			central := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(status)
				w.Write([]byte(`{"id":"original-submission-only"}`))
			}))
			defer central.Close()
			s.cfg.HTTPClient = central.Client()
			s.cfg.TrustGatewayURL = central.URL
			s.cfg.TrustGatewayKey = "controlled-key"
			l := operationMusicLease(actor, s)
			l.grant.Operation.Path = "/api/cases"
			sc := s.requestService(l)
			err := runTrustEffect(sc, actor, v, input)
			if (status == 200) != (err == nil) {
				t.Fatal(err)
			}
			i := s.state.OriginalOperations[l.grant.Operation.OperationID].Identity
			rb, err := s.ReadOriginalBusinessOperation(context.Background(), i)
			if err != nil || len(rb.Effects) != 1 {
				t.Fatal(rb, err)
			}
			e := rb.Effects[0]
			if e.EffectKey != effectKey(actor, "trust", v.ID) || e.Effect.Operation == nil || *e.Effect.Operation != i || e.Effect.WireDigest == "" || e.Effect.EndpointDigest == "" {
				t.Fatal(e)
			}
			expected := "dispatch_admitted"
			if status == 200 {
				expected = "receipt"
			}
			if e.Effect.Status != expected {
				t.Fatal(e)
			}
			e.Effect.Operation.Actor = "foreign"
			if len(e.Effect.Receipt) > 0 {
				e.Effect.Receipt[0] = 'x'
			}
			recovered, err := New(s.cfg)
			if err != nil {
				t.Fatal(err)
			}
			rb, err = recovered.ReadOriginalBusinessOperation(context.Background(), i)
			if err != nil || rb.Effects[0].Effect.Operation.Actor != actor {
				t.Fatal(rb, err)
			}
			fresh := operationMusicLease(actor, recovered)
			fresh.grant.Operation.OperationID = strings.Repeat("e", 64)
			fresh.grant.Nonce = "fresh_readback_nonce_01"
			runTrustEffect(recovered.requestService(fresh), actor, v, input)
			if calls.Load() != 1 || len(recovered.state.OriginalOperations) != 1 {
				t.Fatal("fresh request rebound/resubmitted original effect", calls.Load())
			}
		})
	}
}
func TestMusicOriginalOperationMissingAndLegacyUnavailable(t *testing.T) {
	s := testService(t)
	actor := testAccount(t, 25)
	l := operationMusicLease(actor, s)
	l.grant.Operation = nil
	if _, err := s.requestService(l).UpsertProfile(actor, Profile{DisplayName: "denied"}); !errors.Is(err, ErrMusicAuthorityUnavailable) || len(s.state.OriginalOperations) != 0 || len(s.state.BusinessNonces) != 0 {
		t.Fatal(err)
	}
	if _, err := s.ReadOriginalBusinessOperation(context.Background(), MusicOriginalOperationIdentity{}); !errors.Is(err, ErrMusicAuthorityUnavailable) {
		t.Fatal(err)
	}
	if _, err := s.requestService(testBusinessLease(actor, "legacy_nonce_mapping01", s.cfg.Now)).UpsertProfile(actor, Profile{DisplayName: "legacy"}); err != nil {
		t.Fatal(err)
	}
	recovered, err := New(s.cfg)
	if err != nil || len(recovered.state.Profiles) != 1 || len(recovered.state.OriginalOperations) != 0 {
		t.Fatal(err)
	}
}

func TestMusicOriginalOperationPublishedUncertaintyPreservesAssociation(t *testing.T) {
	s := testService(t)
	actor := testAccount(t, 26)
	if _, err := s.UpsertProfile(actor, Profile{DisplayName: "before"}); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(s.cfg.StatePath)
	if err != nil {
		t.Fatal(err)
	}
	l := operationMusicLease(actor, s)
	l.grant.Current = func(context.Context) error {
		b, e := os.ReadFile(s.cfg.StatePath)
		if e == nil && !bytes.Equal(b, before) {
			return ErrUnauthorized
		}
		return nil
	}
	if _, err = s.requestService(l).UpsertProfile(actor, Profile{DisplayName: "published unknown"}); !errors.Is(err, ErrMusicStatePublicationUnconfirmed) {
		t.Fatal(err)
	}
	recovered, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	i := recovered.state.OriginalOperations[l.grant.Operation.OperationID].Identity
	r, err := recovered.ReadOriginalBusinessOperation(context.Background(), i)
	if err != nil || len(r.Record.Steps) != 1 {
		t.Fatal(r, err)
	}
	if _, err = recovered.requestService(operationMusicLease(actor, recovered)).UpsertProfile(actor, Profile{DisplayName: "replay"}); !errors.Is(err, ErrUnauthorized) {
		t.Fatal(err)
	}
}

func TestMusicOriginalOperationLegacyProviderNotRebound(t *testing.T) {
	for _, status := range []int{200, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			s, actor, v, input := effectFixture(t)
			var calls atomic.Int32
			central := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(status)
				w.Write([]byte(`{"id":"retained-legacy-ACK"}`))
			}))
			defer central.Close()
			s.cfg.HTTPClient = central.Client()
			s.cfg.TrustGatewayURL = central.URL
			s.cfg.TrustGatewayKey = "controlled-key"
			runTrustEffect(s.requestService(testBusinessLease(actor, "legacy_provider_nonce01", s.cfg.Now)), actor, v, input)
			before, err := s.ReadOriginalBusinessEffect(context.Background(), actor, "trust", v.ID)
			if err != nil || before.Operation != nil {
				t.Fatal(before, err)
			}
			err = runTrustEffect(s.requestService(operationMusicLease(actor, s)), actor, v, input)
			if !errors.Is(err, ErrMusicAuthorityUnavailable) {
				t.Fatal(err)
			}
			after, err := s.ReadOriginalBusinessEffect(context.Background(), actor, "trust", v.ID)
			if err != nil || after.Operation != nil || after.Status != before.Status || !bytes.Equal(after.Receipt, before.Receipt) || calls.Load() != 1 || len(s.state.OriginalOperations) != 0 {
				t.Fatal("legacy effect was rebound", after, err)
			}
		})
	}
}
