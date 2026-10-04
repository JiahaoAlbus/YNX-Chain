package video

import (
	"context"
	"errors"
	"sync"
	"testing"
)

type videoLocalTestTransaction func(context.Context, func(context.Context) error) error

func (f videoLocalTestTransaction) Execute(ctx context.Context, commit func(context.Context) error) error {
	return f(ctx, commit)
}

type videoTxMarker struct{}

func TestVideoOriginalTransactionPortDurableNonceAndContext(t *testing.T) {
	s, ch := fixture(t, nil)
	var gate sync.Mutex
	captures := 0
	g := videoTestGrant(s, "ynx1owner", "owned_transaction_nonce_001", func(context.Context) error {
		if !gate.TryLock() {
			return errors.New("remote preflight under gate")
		}
		gate.Unlock()
		return nil
	})
	g.Current = func(ctx context.Context) error {
		if s.store.mu.TryLock() {
			s.store.mu.Unlock()
			return nil
		}
		if ctx.Value(videoTxMarker{}) != true {
			return errors.New("marked transaction context missing under Store")
		}
		return nil
	}
	g.CaptureTransaction = func(context.Context) (VideoLocalTransaction, error) {
		if !s.store.mu.TryLock() {
			t.Fatal("capture under Store lock")
		}
		s.store.mu.Unlock()
		captures++
		return videoLocalTestTransaction(func(ctx context.Context, commit func(context.Context) error) error {
			gate.Lock()
			defer gate.Unlock()
			return commit(context.WithValue(ctx, videoTxMarker{}, true))
		}), nil
	}
	scoped := videoLease(t, s, context.Background(), g, false)
	for _, name := range []string{"first coordinated playlist", "second local phase"} {
		if _, err := scoped.CreatePlaylist(g.Actor, name); err != nil {
			t.Fatal(err)
		}
	}
	if captures != 2 {
		t.Fatal("fresh capture missing", captures)
	}
	record, err := s.ReadOriginalBusinessNonce(context.Background(), g.SessionBinding, g.Nonce)
	if err != nil || record.Actor != g.Actor {
		t.Fatal(record, err)
	}
	view, err := s.CopyOriginalCreatorMembership(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	role, version, ok := view.Lookup(ch.ID, ch.Owner)
	if !ok || role != CreatorRoleOwner || version != ch.AuthVersion {
		t.Fatal("not original channel membership")
	}
	// An immutable original copy cannot silently track later membership changes.
	if err = s.store.update(func(st *State) error { st.Channels[ch.ID].AuthVersion++; return nil }); err != nil {
		t.Fatal(err)
	}
	_, old, _ := view.Lookup(ch.ID, ch.Owner)
	fresh, err := s.CopyOriginalCreatorMembership(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	_, next, _ := fresh.Lookup(ch.ID, ch.Owner)
	if old == next {
		t.Fatal("membership copy aliased mutable Store")
	}
	recovered, err := NewService(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	replay := videoLease(t, recovered, context.Background(), g, false)
	if _, err = replay.CreatePlaylist(g.Actor, "replay"); err == nil {
		t.Fatal("original durable nonce replayed")
	}
}
func TestVideoOriginalTransactionPortUnavailableAndNoopClosed(t *testing.T) {
	for _, mode := range []string{"missing-current", "typed-nil", "noop", "reject"} {
		t.Run(mode, func(t *testing.T) {
			s, _ := fixture(t, nil)
			g := videoTestGrant(s, "ynx1owner", "closed_transaction_nonce_01", nil)
			g.Current = func(context.Context) error { return nil }
			g.CaptureTransaction = func(context.Context) (VideoLocalTransaction, error) {
				switch mode {
				case "typed-nil":
					var tx videoLocalTestTransaction
					return tx, nil
				case "noop":
					return videoLocalTestTransaction(func(context.Context, func(context.Context) error) error { return nil }), nil
				default:
					return nil, ErrVideoTransactionUnavailable
				}
			}
			if mode == "missing-current" {
				g.Current = nil
			}
			scoped := videoLease(t, s, context.Background(), g, false)
			if _, err := scoped.CreatePlaylist(g.Actor, "denied"); !errors.Is(err, ErrVideoTransactionUnavailable) {
				t.Fatal(err)
			}
			if len(s.store.state.BusinessNonces) != 0 || len(s.store.state.Playlists) != 0 {
				t.Fatal("refusal changed original Store")
			}
		})
	}
}
func TestVideoOriginalTransactionLocalCancellationBeforeNonce(t *testing.T) {
	s, _ := fixture(t, nil)
	g := videoTestGrant(s, "ynx1owner", "cancel_local_nonce_0001", nil)
	var cancel context.CancelFunc
	g.Current = func(ctx context.Context) error {
		if ctx.Value(videoTxMarker{}) == true {
			cancel()
		}
		return nil
	}
	g.CaptureTransaction = func(context.Context) (VideoLocalTransaction, error) {
		return videoLocalTestTransaction(func(ctx context.Context, commit func(context.Context) error) error {
			var local context.Context
			local, cancel = context.WithCancel(ctx)
			defer cancel()
			return commit(context.WithValue(local, videoTxMarker{}, true))
		}), nil
	}
	_, err := videoLease(t, s, context.Background(), g, false).CreatePlaylist(g.Actor, "canceled local transaction")
	if !errors.Is(err, context.Canceled) || len(s.store.state.BusinessNonces) != 0 || len(s.store.state.Playlists) != 0 {
		t.Fatal("local cancellation committed", err)
	}
}
