package music

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
)

type musicLocalTestTransaction func(context.Context, func(context.Context) error) error

func (f musicLocalTestTransaction) Execute(ctx context.Context, commit func(context.Context) error) error {
	return f(ctx, commit)
}

type musicTxMarker struct{}

func installMusicTestTransaction(t *testing.T, s *Service, lease *musicBusinessLease, gate *sync.Mutex, captures *atomic.Int32) {
	t.Helper()
	lease.grant.Revalidate = func(context.Context) error {
		if !gate.TryLock() {
			return errors.New("network revalidation under authority gate")
		}
		gate.Unlock()
		return nil
	}
	lease.grant.Current = func(ctx context.Context) error {
		if s.mu.TryLock() {
			s.mu.Unlock()
			return nil
		}
		if ctx.Value(musicTxMarker{}) != true {
			return errors.New("marked transaction context missing under Store")
		}
		return nil
	}
	lease.grant.CaptureTransaction = func(context.Context) (MusicLocalTransaction, error) {
		if !s.mu.TryLock() {
			return nil, errors.New("capture under original Store")
		}
		s.mu.Unlock()
		captures.Add(1)
		return musicLocalTestTransaction(func(ctx context.Context, commit func(context.Context) error) error {
			gate.Lock()
			defer gate.Unlock()
			return commit(context.WithValue(ctx, musicTxMarker{}, true))
		}), nil
	}
}
func TestMusicOriginalTransactionPortDurableNonceAndFreshPhases(t *testing.T) {
	s := testService(t)
	actor := testAccount(t, 20)
	lease := testBusinessLease(actor, "coordinated_local_01", s.cfg.Now)
	var gate sync.Mutex
	var captures atomic.Int32
	installMusicTestTransaction(t, s, lease, &gate, &captures)
	scoped := s.requestService(lease)
	for _, name := range []string{"first phase", "second phase"} {
		if _, err := scoped.UpsertProfile(actor, Profile{DisplayName: name}); err != nil {
			t.Fatal(err)
		}
	}
	if captures.Load() != 2 {
		t.Fatal("lease reused", captures.Load())
	}
	record, err := s.ReadOriginalBusinessNonce(context.Background(), lease.grant.SessionBinding, lease.grant.Nonce)
	if err != nil || record.Actor != actor {
		t.Fatal(record, err)
	}
	recovered, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = recovered.requestService(testBusinessLease(actor, lease.grant.Nonce, s.cfg.Now)).UpsertProfile(actor, Profile{DisplayName: "replay"}); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("original nonce not durable", err)
	}
}
func TestMusicOriginalTransactionPortUnknownNeverResends(t *testing.T) {
	s, actor, v, input := effectFixture(t)
	var gate sync.Mutex
	var calls, captures atomic.Int32
	central := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !gate.TryLock() {
			t.Error("provider dispatched under authority gate")
		} else {
			gate.Unlock()
		}
		calls.Add(1)
		w.WriteHeader(503)
	}))
	defer central.Close()
	s.cfg.HTTPClient = central.Client()
	s.cfg.TrustGatewayURL = central.URL
	s.cfg.TrustGatewayKey = "fixture-central-key"
	lease := testBusinessLease(actor, "coordinated_dispatch01", s.cfg.Now)
	installMusicTestTransaction(t, s, lease, &gate, &captures)
	if err := runTrustEffect(s.requestService(lease), actor, v, input); err == nil {
		t.Fatal("unknown provider treated as complete")
	}
	record, err := s.ReadOriginalBusinessEffect(context.Background(), actor, "trust", v.ID)
	if err != nil || record.Status != "dispatch_admitted" {
		t.Fatal(record, err)
	}
	recovered, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	newLease := testBusinessLease(actor, "fresh_capture_retry_01", recovered.cfg.Now)
	installMusicTestTransaction(t, recovered, newLease, &gate, &captures)
	if err = runTrustEffect(recovered.requestService(newLease), actor, v, input); err == nil {
		t.Fatal("UNKNOWN promoted")
	}
	if calls.Load() != 1 {
		t.Fatal("fresh capture resent original UNKNOWN", calls.Load())
	}
}
func TestMusicOriginalTransactionPortMissingAndNoopClosed(t *testing.T) {
	for _, mode := range []string{"missing-current", "typed-nil", "noop", "reject"} {
		t.Run(mode, func(t *testing.T) {
			s := testService(t)
			actor := testAccount(t, 21)
			lease := testBusinessLease(actor, "closed_transaction01", s.cfg.Now)
			lease.grant.Current = func(context.Context) error { return nil }
			lease.grant.CaptureTransaction = func(context.Context) (MusicLocalTransaction, error) {
				switch mode {
				case "typed-nil":
					var tx musicLocalTestTransaction
					return tx, nil
				case "noop":
					return musicLocalTestTransaction(func(context.Context, func(context.Context) error) error { return nil }), nil
				default:
					return nil, ErrMusicAuthorityUnavailable
				}
			}
			if mode == "missing-current" {
				lease.grant.Current = nil
			}
			_, err := s.requestService(lease).UpsertProfile(actor, Profile{DisplayName: "denied"})
			if !errors.Is(err, ErrMusicAuthorityUnavailable) {
				t.Fatal(err)
			}
			if len(s.state.BusinessNonces) != 0 || len(s.state.Profiles) != 0 {
				t.Fatal("closed gate changed original state")
			}
		})
	}
}
func TestMusicOriginalTransactionLocalCancellationBeforeNonce(t *testing.T) {
	s := testService(t)
	actor := testAccount(t, 22)
	lease := testBusinessLease(actor, "cancel_local_nonce_01", s.cfg.Now)
	var cancel context.CancelFunc
	lease.grant.Current = func(ctx context.Context) error {
		if ctx.Value(musicTxMarker{}) == true {
			cancel()
		}
		return nil
	}
	lease.grant.CaptureTransaction = func(context.Context) (MusicLocalTransaction, error) {
		return musicLocalTestTransaction(func(ctx context.Context, commit func(context.Context) error) error {
			var local context.Context
			local, cancel = context.WithCancel(ctx)
			defer cancel()
			return commit(context.WithValue(local, musicTxMarker{}, true))
		}), nil
	}
	_, err := s.requestService(lease).UpsertProfile(actor, Profile{DisplayName: "canceled"})
	if !errors.Is(err, ErrUnauthorized) || len(s.state.BusinessNonces) != 0 || len(s.state.Profiles) != 0 {
		t.Fatal("local cancellation committed", err)
	}
}
