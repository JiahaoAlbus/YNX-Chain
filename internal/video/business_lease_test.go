package video

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func videoTestGrant(s *Service, actor, nonce string, revalidate func(context.Context) error) VideoBusinessGrant {
	if revalidate == nil {
		revalidate = func(context.Context) error { return nil }
	}
	return VideoBusinessGrant{Actor: actor, Nonce: nonce, SessionBinding: "original-video-session-binding", BodyDigest: strings.Repeat("a", 64), ExpiresAt: s.cfg.Now().Add(time.Minute), Revalidate: revalidate}
}
func videoLease(t *testing.T, s *Service, ctx context.Context, g VideoBusinessGrant, read bool) *Service {
	t.Helper()
	scoped, err := s.withBusinessGrant(ctx, g, read)
	if err != nil {
		t.Fatal(err)
	}
	return scoped
}
func TestVideoBusinessOriginalTransactionAndReplay(t *testing.T) {
	s, _ := fixture(t, nil)
	g := videoTestGrant(s, "ynx1owner", "original_request_nonce_001", nil)
	scoped := videoLease(t, s, context.Background(), g, false)
	first, err := scoped.CreatePlaylist(g.Actor, "Original library")
	if err != nil {
		t.Fatal(err)
	}
	if scoped.store.videoStateStore != s.store.videoStateStore || scoped.videoServiceControls != s.videoServiceControls {
		t.Fatal("shared state/locks copied")
	}
	if _, err = scoped.CreatePlaylist(g.Actor, "Same request second write"); err != nil {
		t.Fatal(err)
	}
	if len(s.store.state.BusinessNonces) != 1 || s.store.state.Playlists[first.ID].Owner != g.Actor {
		t.Fatal("nonce and original business write not atomic")
	}
	restarted, err := NewService(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	replay := videoLease(t, restarted, context.Background(), g, false)
	if _, err = replay.CreatePlaylist(g.Actor, "Replay"); err == nil {
		t.Fatal("durable nonce replay accepted")
	}
	records, _ := restarted.Playlists(g.Actor)
	if len(records) != 2 {
		t.Fatal("replay changed original data")
	}
}
func TestVideoBusinessWaitCancellationAndFinalRevocation(t *testing.T) {
	for _, kind := range []string{"wait-cancel", "after-candidate-revoke"} {
		t.Run(kind, func(t *testing.T) {
			s, _ := fixture(t, nil)
			old, _ := s.CreatePlaylist("ynx1owner", "Retained old playlist")
			before, _ := os.ReadFile(s.store.statePath)
			var checks atomic.Int32
			ready := make(chan struct{})
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			g := videoTestGrant(s, "ynx1owner", "cancel_revoke_nonce_00001", func(context.Context) error {
				n := checks.Add(1)
				if kind == "wait-cancel" && n == 2 {
					close(ready)
				}
				if kind == "after-candidate-revoke" && n >= 4 {
					return ErrUnauthorized
				}
				return nil
			})
			scoped := videoLease(t, s, ctx, g, false)
			if kind == "wait-cancel" {
				s.store.mu.Lock()
				done := make(chan error, 1)
				go func() { _, err := scoped.CreatePlaylist(g.Actor, "Cannot save"); done <- err }()
				<-ready
				cancel()
				s.store.mu.Unlock()
				if err := <-done; !errors.Is(err, context.Canceled) {
					t.Fatalf("waiting write not canceled: %v", err)
				}
			} else if _, err := scoped.CreatePlaylist(g.Actor, "Cannot save"); err == nil {
				t.Fatal("revoked candidate committed")
			}
			after, _ := os.ReadFile(s.store.statePath)
			if !bytes.Equal(before, after) || len(s.store.state.BusinessNonces) != 0 || s.store.state.Playlists[old.ID] == nil {
				t.Fatal("failed grant changed original state or consumed nonce")
			}
		})
	}
}
func TestVideoBusinessPersistenceFailureDoesNotConsume(t *testing.T) {
	s, _ := fixture(t, nil)
	g := videoTestGrant(s, "ynx1owner", "save_failure_nonce_000001", nil)
	scoped := videoLease(t, s, context.Background(), g, false)
	if err := os.Mkdir(s.store.statePath+".tmp", 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.CreatePlaylist(g.Actor, "Retained attempt"); err == nil {
		t.Fatal("unwritable store succeeded")
	}
	if len(s.store.state.BusinessNonces) != 0 || scoped.store.business.consumed.Load() {
		t.Fatal("failed persistence consumed nonce")
	}
	if err := os.Remove(s.store.statePath + ".tmp"); err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.CreatePlaylist(g.Actor, "Retried original request"); err != nil {
		t.Fatal(err)
	}
}
func TestVideoBusinessReadReplayAndConcurrentAccountIsolation(t *testing.T) {
	s, _ := fixture(t, nil)
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, actor := range []string{"ynx1owner", "ynx1other"} {
		scoped := videoLease(t, s, context.Background(), videoTestGrant(s, actor, "concurrent_nonce_"+actor, nil), false)
		wg.Add(1)
		go func(actor string, scoped *Service) {
			defer wg.Done()
			_, err := scoped.CreatePlaylist(actor, "Private "+actor)
			errs <- err
		}(actor, scoped)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, actor := range []string{"ynx1owner", "ynx1other"} {
		g := videoTestGrant(s, actor, "read_account_nonce_"+actor, nil)
		scoped := videoLease(t, s, context.Background(), g, true)
		records, err := scoped.Playlists(actor)
		if err != nil || len(records) != 1 || records[0].Owner != actor {
			t.Fatal("accounts mixed")
		}
		replay := videoLease(t, s, context.Background(), g, true)
		if _, err = replay.Playlists(actor); err == nil {
			t.Fatal("GET grant replayed")
		}
	}
}
func TestVideoBusinessActorClockAndExpiryFences(t *testing.T) {
	s, _ := fixture(t, nil)
	g := videoTestGrant(s, "ynx1owner", "original_actor_nonce_001", nil)
	scoped := videoLease(t, s, context.Background(), g, false)
	if _, err := scoped.CreatePlaylist("ynx1other", "Wrong actor"); err == nil {
		t.Fatal("different audited actor committed")
	}
	if len(s.store.state.BusinessNonces) != 0 {
		t.Fatal("actor mismatch consumed nonce")
	}
	if _, err := scoped.CreatePlaylist(g.Actor, "Own actor"); err != nil {
		t.Fatal(err)
	}
	clock := s.cfg.Now
	scoped.store.business.now = func() time.Time { return clock().Add(-time.Second) }
	if _, err := scoped.CreatePlaylist(g.Actor, "Clock rollback"); err == nil {
		t.Fatal("durable clock floor ignored")
	}
	expiry := videoTestGrant(s, g.Actor, "expires_after_await_001", nil)
	expiring := videoLease(t, s, context.Background(), expiry, false)
	expiring.store.business.now = func() time.Time { return expiry.ExpiresAt }
	if _, err := expiring.Playlists(g.Actor); err == nil {
		t.Fatal("expired lease read private records")
	}
}
func TestHistoricalVideoBackupDoesNotRewriteSource(t *testing.T) {
	root := t.TempDir()
	key := []byte(strings.Repeat("b", 32))
	old := emptyState()
	old.SchemaVersion = 2
	old.Playlists["pl_retained"] = &Playlist{ID: "pl_retained", Owner: "ynx1owner", Name: "Original backup"}
	persistStateFixture(t, root, key, old)
	before, err := os.ReadFile(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	var backup bytes.Buffer
	if err := CreateBackup(root, key, &backup, time.Now()); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(filepath.Join(root, "state.json"))
	if !bytes.Equal(before, after) {
		t.Fatal("backup validation rewrote original historical state")
	}
	target := filepath.Join(t.TempDir(), "restored")
	if err := RestoreBackup(target, key, bytes.NewReader(backup.Bytes())); err != nil {
		t.Fatal(err)
	}
	restored, err := OpenStore(target, key)
	if err != nil {
		t.Fatal(err)
	}
	if restored.state.SchemaVersion != currentStateSchemaVersion || restored.state.Playlists["pl_retained"].Name != "Original backup" {
		t.Fatal("new target lost historical object")
	}
	final, _ := os.ReadFile(filepath.Join(root, "state.json"))
	if !bytes.Equal(before, final) {
		t.Fatal("restore rewrote source")
	}
}

func TestVideoSessionNoncePairIndependentSessionsAndDurableReplay(t *testing.T) {
	s, _ := fixture(t, nil)
	g := videoTestGrant(s, "ynx1owner", "same_original_nonce_00001", nil)
	first := videoLease(t, s, context.Background(), g, false)
	if _, e := first.CreatePlaylist(g.Actor, "Original first session"); e != nil {
		t.Fatal(e)
	}
	secondGrant := g
	secondGrant.SessionBinding = "original-independent-session-binding"
	second := videoLease(t, s, context.Background(), secondGrant, false)
	if _, e := second.CreatePlaylist(g.Actor, "Independent second session"); e != nil {
		t.Fatal("one session blocked another session's nonce", e)
	}
	if len(s.store.state.BusinessNonces) != 2 {
		t.Fatal("nonce pair records collapsed")
	}
	for _, grant := range []VideoBusinessGrant{g, secondGrant} {
		record, ok := s.store.state.BusinessNonces[videoBusinessNonceKey(grant.SessionBinding, grant.Nonce)]
		if !ok || record.Nonce != grant.Nonce || record.SessionBinding != grant.SessionBinding {
			t.Fatal("original pair not persisted")
		}
	}
	restarted, e := NewService(s.cfg)
	if e != nil {
		t.Fatal(e)
	}
	for _, grant := range []VideoBusinessGrant{g, secondGrant} {
		scoped := videoLease(t, restarted, context.Background(), grant, false)
		if _, e = scoped.CreatePlaylist(grant.Actor, "Replay must not appear"); e == nil {
			t.Fatal("same session nonce replay accepted after restart")
		}
	}
	lists, e := restarted.Playlists(g.Actor)
	if e != nil || len(lists) != 2 {
		t.Fatal("replay changed original business records")
	}
}
func TestVideoHistoricalSchema4NonceBackupAndMigrationPreserveReplay(t *testing.T) {
	s, _ := fixture(t, nil)
	g := videoTestGrant(s, "ynx1owner", "retained_schema4_nonce_001", nil)
	legacy := emptyState()
	legacy.SchemaVersion = 4
	legacy.BusinessClockFloor = s.cfg.Now().UTC()
	legacy.BusinessNonces = map[string]VideoBusinessNonce{g.Nonce: {Actor: g.Actor, BodyDigest: g.BodyDigest, SessionBinding: g.SessionBinding, ExpiresAt: g.ExpiresAt, ConsumedAt: s.cfg.Now().UTC()}}
	legacy.Playlists["pl_original"] = &Playlist{ID: "pl_original", Owner: g.Actor, Name: "Original schema4 playlist"}
	persistStateFixture(t, s.store.root, s.cfg.IntegrityKey, legacy)
	before, e := os.ReadFile(s.store.statePath)
	if e != nil {
		t.Fatal(e)
	}
	if bytes.Contains(before, []byte(`"nonce":`)) {
		t.Fatal("historical fixture contains new nonce format field")
	}
	var backup bytes.Buffer
	if e = CreateBackup(s.store.root, s.cfg.IntegrityKey, &backup, s.cfg.Now()); e != nil {
		t.Fatal(e)
	}
	after, _ := os.ReadFile(s.store.statePath)
	if !bytes.Equal(before, after) {
		t.Fatal("backup migrated original schema4 source")
	}
	target := filepath.Join(t.TempDir(), "restored")
	if e = RestoreBackup(target, s.cfg.IntegrityKey, bytes.NewReader(backup.Bytes())); e != nil {
		t.Fatal(e)
	}
	cfg := s.cfg
	cfg.Root = target
	restored, e := NewService(cfg)
	if e != nil {
		t.Fatal(e)
	}
	if restored.store.state.SchemaVersion != 5 || len(restored.store.state.BusinessNonces) != 1 || restored.store.state.Playlists["pl_original"].Name != "Original schema4 playlist" {
		t.Fatal("schema4 restore lost original business or nonce")
	}
	if _, e = videoLease(t, restored, context.Background(), g, false).CreatePlaylist(g.Actor, "Historical replay"); e == nil {
		t.Fatal("migration discarded original replay fence")
	}
	fresh := g
	fresh.SessionBinding = "another-original-session-binding"
	if _, e = videoLease(t, restored, context.Background(), fresh, false).CreatePlaylist(g.Actor, "New independent session"); e != nil {
		t.Fatal(e)
	}
	final, _ := os.ReadFile(s.store.statePath)
	if !bytes.Equal(before, final) {
		t.Fatal("restoring target touched old signed source")
	}
	if _, e = migrateState(&restored.store.state, 4); e == nil {
		t.Fatal("downgrade discarded nonce pairs")
	}
}
func TestVideoSchema5RejectsLegacyAndTamperedPairIndex(t *testing.T) {
	s, _ := fixture(t, nil)
	g := videoTestGrant(s, "ynx1owner", "valid_nonce_pair_0000001", nil)
	if _, e := videoLease(t, s, context.Background(), g, false).CreatePlaylist(g.Actor, "Original"); e != nil {
		t.Fatal(e)
	}
	key := videoBusinessNonceKey(g.SessionBinding, g.Nonce)
	record := s.store.state.BusinessNonces[key]
	for _, kind := range []string{"legacy-key", "wrong-session", "missing-nonce"} {
		t.Run(kind, func(t *testing.T) {
			st := s.store.state
			st.BusinessNonces = map[string]VideoBusinessNonce{}
			changed := record
			index := key
			switch kind {
			case "legacy-key":
				index = g.Nonce
			case "wrong-session":
				changed.SessionBinding = "different-session"
			case "missing-nonce":
				changed.Nonce = ""
			}
			st.BusinessNonces[index] = changed
			if e := validateVideoBusinessState(st); e == nil {
				t.Fatal("invalid schema5 pair accepted")
			}
		})
	}
}
