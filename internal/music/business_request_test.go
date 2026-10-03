package music

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func testBusinessLease(actor, nonce string, clock func() time.Time) *musicBusinessLease {
	if len(nonce) < 16 {
		nonce += strings.Repeat("0", 16-len(nonce))
	}
	return &musicBusinessLease{ctx: context.Background(), grant: MusicBusinessGrant{Actor: actor, Nonce: nonce, SessionBinding: strings.Repeat("a", 64), BodyDigest: strings.Repeat("b", 64), ExpiresAt: clock().Add(time.Minute), Revalidate: func(context.Context) error { return nil }}}
}
func TestBusinessNonceIsAtomicAndSurvivesRestart(t *testing.T) {
	s := testService(t)
	actor := testAccount(t, 1)
	lease := testBusinessLease(actor, "first_nonce_0001", s.cfg.Now)
	scoped := s.requestService(lease)
	if _, err := scoped.UpsertProfile(actor, Profile{DisplayName: "original"}); err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.UpsertProfile(actor, Profile{DisplayName: "same request"}); err != nil {
		t.Fatal(err)
	}
	recovered, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	replay := recovered.requestService(testBusinessLease(actor, lease.grant.Nonce, s.cfg.Now))
	if _, err = replay.UpsertProfile(actor, Profile{DisplayName: "replayed"}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("replay: %v", err)
	}
	profile, err := recovered.Profile(actor)
	if err != nil || profile.DisplayName != "same request" {
		t.Fatalf("original lost: %#v %v", profile, err)
	}
}
func TestBusinessFailedPersistenceDoesNotConsumeNonce(t *testing.T) {
	s := testService(t)
	actor := testAccount(t, 2)
	lease := testBusinessLease(actor, "failed_save_0001", s.cfg.Now)
	scoped := s.requestService(lease)
	original := s.cfg.StatePath
	blocker := filepath.Join(t.TempDir(), "blocker")
	os.WriteFile(blocker, []byte("x"), 0600)
	scoped.cfg.StatePath = filepath.Join(blocker, "state.json")
	if _, err := scoped.UpsertProfile(actor, Profile{DisplayName: "failed"}); err == nil {
		t.Fatal("expected failure")
	}
	if lease.consumed || len(s.state.BusinessNonces) != 0 || len(s.state.Audit) != 0 {
		t.Fatal("failed save changed shared state")
	}
	scoped.cfg.StatePath = original
	if _, err := scoped.UpsertProfile(actor, Profile{DisplayName: "retry"}); err != nil {
		t.Fatal(err)
	}
}
func TestBusinessRevalidationExpiryAndClockRollback(t *testing.T) {
	for _, mode := range []string{"expired while awaiting", "clock rollback", "revoked", "cancelled"} {
		t.Run(mode, func(t *testing.T) {
			s := testService(t)
			now := time.Now().UTC()
			s.cfg.Now = func() time.Time { return now }
			actor := testAccount(t, 3)
			lease := testBusinessLease(actor, "late_auth_000001", s.cfg.Now)
			floor := now
			s.state.BusinessClock = &floor
			switch mode {
			case "expired while awaiting":
				lease.grant.Revalidate = func(context.Context) error { now = now.Add(2 * time.Minute); return nil }
			case "clock rollback":
				lease.grant.Revalidate = func(context.Context) error { now = now.Add(-time.Minute); return nil }
			case "revoked":
				lease.grant.Revalidate = func(context.Context) error { return ErrUnauthorized }
			case "cancelled":
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				lease.ctx = ctx
			}
			if _, err := s.requestService(lease).UpsertProfile(actor, Profile{DisplayName: "forbidden"}); !errors.Is(err, ErrUnauthorized) {
				t.Fatalf("accepted: %v", err)
			}
			if len(s.state.Profiles) != 0 || len(s.state.BusinessNonces) != 0 || len(s.state.Audit) != 0 {
				t.Fatal("denial changed business state")
			}
		})
	}
}
func TestBusinessParallelRequestsCannotBorrowActor(t *testing.T) {
	s := testService(t)
	a, b := testAccount(t, 4), testAccount(t, 5)
	sa := s.requestService(testBusinessLease(a, "parallel_actor_A", s.cfg.Now))
	sb := s.requestService(testBusinessLease(b, "parallel_actor_B", s.cfg.Now))
	var wg sync.WaitGroup
	for _, entry := range []struct {
		s           *Service
		actor, name string
	}{{sa, a, "Alice"}, {sb, b, "Bob"}} {
		wg.Add(1)
		go func(e struct {
			s           *Service
			actor, name string
		}) {
			defer wg.Done()
			if _, err := e.s.UpsertProfile(e.actor, Profile{DisplayName: e.name}); err != nil {
				t.Error(err)
			}
		}(entry)
	}
	wg.Wait()
	if _, err := sa.UpsertProfile(b, Profile{DisplayName: "borrowed"}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("borrowed authority: %v", err)
	}
	p, _ := s.Profile(b)
	if p.DisplayName != "Bob" {
		t.Fatal("other actor changed")
	}
}
func TestBusinessResponseRechecksAfterHeaderAndSuppressesBody(t *testing.T) {
	now := time.Now()
	clock := func() time.Time { return now }
	lease := testBusinessLease("unused", "response_nonce01", clock)
	calls := 0
	lease.grant.Revalidate = func(context.Context) error {
		calls++
		if calls == 2 {
			return ErrUnauthorized
		}
		return nil
	}
	recorder := httptest.NewRecorder()
	w := &scopedResponse{ResponseWriter: recorder, lease: lease, now: clock}
	if _, err := w.Write([]byte("private")); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("body allowed: %v", err)
	}
	if recorder.Code != 401 || recorder.Body.Len() != 0 {
		t.Fatalf("private output leaked: %d %q", recorder.Code, recorder.Body.String())
	}
}

type fixtureBusinessAuthority func(context.Context, *http.Request, string, io.Reader, int64) (MusicBusinessGrant, error)

func (f fixtureBusinessAuthority) VerifyMusicBusiness(c context.Context, r *http.Request, s string, b io.Reader, n int64) (MusicBusinessGrant, error) {
	return f(c, r, s, b, n)
}
func TestBusinessAPIRequiresCompleteActualBodyAndInstalledAuthority(t *testing.T) {
	for _, mode := range []string{"absent", "partial", "wrong digest", "valid"} {
		t.Run(mode, func(t *testing.T) {
			s := testService(t)
			actor := testAccount(t, 6)
			if mode != "absent" {
				s.cfg.BusinessAuthority = fixtureBusinessAuthority(func(ctx context.Context, r *http.Request, scope string, body io.Reader, cap int64) (MusicBusinessGrant, error) {
					var data []byte
					var err error
					if mode == "partial" {
						data = make([]byte, 1)
						_, err = body.Read(data)
					} else {
						data, err = io.ReadAll(body)
					}
					if err != nil {
						return MusicBusinessGrant{}, err
					}
					hash := sha256.Sum256(data)
					grant := testBusinessLease(actor, "body_request_001", s.cfg.Now).grant
					grant.BodyDigest = hex.EncodeToString(hash[:])
					if mode == "wrong digest" {
						grant.BodyDigest = strings.Repeat("c", 64)
					}
					return grant, nil
				})
			}
			server := &Server{service: s}
			r := httptest.NewRequest("POST", "/api/profile", strings.NewReader(`{"displayName":"body"}`))
			r.Header.Set("X-YNX-Product-Session-Proof-V2", "fixture")
			r.Header.Set("X-YNX-Music-Business-Proof-V2", "fixture")
			w := httptest.NewRecorder()
			called := false
			server.businessAPI(w, r, "music.profile", func(scoped *Server, w http.ResponseWriter, r *http.Request, a string) {
				called = true
				raw, _ := io.ReadAll(r.Body)
				if string(raw) != `{"displayName":"body"}` || a != actor {
					t.Fatal("wire changed")
				}
				if _, err := scoped.service.UpsertProfile(a, Profile{DisplayName: "body"}); err != nil {
					t.Fatal(err)
				}
				w.Write([]byte("ok"))
			})
			if called != (mode == "valid") {
				t.Fatalf("unexpected route dispatch: %v %d", called, w.Code)
			}
			matches, _ := filepath.Glob(filepath.Join(s.cfg.MediaDir, ".music-v2-wire-*"))
			if len(matches) != 0 {
				t.Fatal("wire temp leaked")
			}
		})
	}
}

func TestBusinessReplayCapacityAndExpiredCollection(t *testing.T) {
	s := testService(t)
	actor := testAccount(t, 7)
	now := time.Now().UTC()
	s.cfg.Now = func() time.Time { return now }
	s.state.BusinessNonces = map[string]MusicBusinessNonce{}
	for i := 0; i < 4096; i++ {
		s.state.BusinessNonces[fmt.Sprintf("%064x:capacity_%07d", i, i)] = MusicBusinessNonce{Actor: actor, BodyDigest: strings.Repeat("b", 64), ExpiresAt: now.Add(time.Minute)}
	}
	floor := now
	s.state.BusinessClock = &floor
	lease := testBusinessLease(actor, "capacity_new_001", s.cfg.Now)
	if _, err := s.requestService(lease).UpsertProfile(actor, Profile{DisplayName: "blocked"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("capacity: %v", err)
	}
	if len(s.state.Profiles) != 0 || lease.consumed {
		t.Fatal("capacity failure changed business")
	}
	now = now.Add(2 * time.Minute)
	lease = testBusinessLease(actor, "capacity_new_002", s.cfg.Now)
	if _, err := s.requestService(lease).UpsertProfile(actor, Profile{DisplayName: "collected"}); err != nil {
		t.Fatal(err)
	}
	if len(s.state.BusinessNonces) != 1 {
		t.Fatal("expired markers not collected")
	}
	if _, err := New(s.cfg); err != nil {
		t.Fatal(err)
	}
}

func TestBusinessIdempotentResponseWithoutMutationConsumesNonce(t *testing.T) {
	s := testService(t)
	actor := testAccount(t, 8)
	s.cfg.BusinessAuthority = fixtureBusinessAuthority(func(ctx context.Context, r *http.Request, scope string, body io.Reader, cap int64) (MusicBusinessGrant, error) {
		data, err := io.ReadAll(body)
		sum := sha256.Sum256(data)
		grant := testBusinessLease(actor, "idempotent_read1", s.cfg.Now).grant
		grant.BodyDigest = hex.EncodeToString(sum[:])
		return grant, err
	})
	server := &Server{service: s}
	for i := 0; i < 2; i++ {
		r := httptest.NewRequest("POST", "/api/playlists", nil)
		r.Header.Set("X-YNX-Product-Session-Proof-V2", "fixture")
		r.Header.Set("X-YNX-Music-Business-Proof-V2", "fixture")
		w := httptest.NewRecorder()
		server.businessAPI(w, r, "music.library", func(_ *Server, w http.ResponseWriter, _ *http.Request, _ string) { w.Write([]byte("existing result")) })
		if i == 0 && w.Body.String() != "existing result" {
			t.Fatal("first read rejected")
		}
		if i == 1 && (w.Code != 401 || w.Body.Len() != 0) {
			t.Fatal("replayed result leaked")
		}
	}
	if len(s.state.BusinessNonces) != 1 {
		t.Fatal("result nonce not saved")
	}
}

func TestBusinessV2ExternalEffectsAndUnsignedQueriesStayClosed(t *testing.T) {
	s := testService(t)
	called := false
	s.cfg.BusinessAuthority = fixtureBusinessAuthority(func(context.Context, *http.Request, string, io.Reader, int64) (MusicBusinessGrant, error) {
		called = true
		return MusicBusinessGrant{}, ErrUnauthorized
	})
	for _, target := range []string{"/api/me?account=other", "/api/catalog?q=a&q=b", "/api/catalog?owner=other"} {
		r := httptest.NewRequest("POST", target, nil)
		r.Header.Set("X-YNX-Product-Session-Proof-V2", "fixture")
		r.Header.Set("X-YNX-Music-Business-Proof-V2", "fixture")
		w := httptest.NewRecorder()
		(&Server{service: s}).businessAPI(w, r, "music.profile", func(*Server, http.ResponseWriter, *http.Request, string) { t.Fatal("closed route dispatched") })
		if called || w.Code == 200 {
			t.Fatalf("admitted %s", target)
		}
	}
}

func TestSchemaV2MigrationPreservesOriginalProfileAndIdempotency(t *testing.T) {
	s := testService(t)
	actor := testAccount(t, 9)
	if _, err := s.UpsertProfile(actor, Profile{DisplayName: "retained", PrivateHistory: true}); err != nil {
		t.Fatal(err)
	}
	original := s.state
	original.SchemaVersion = 2
	original.Idempotency["original-request"] = "original-result"
	if err := saveState(s.cfg.StatePath, &original); err != nil {
		t.Fatal(err)
	}
	recovered, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	p, _ := recovered.Profile(actor)
	if p.DisplayName != "retained" || !p.PrivateHistory || recovered.state.Idempotency["original-request"] != "original-result" || len(recovered.state.Audit) != len(original.Audit) || recovered.state.SchemaVersion != currentStateSchemaVersion {
		t.Fatal("migration lost original business")
	}
	if len(recovered.state.BusinessNonces) != 0 || recovered.state.BusinessClock != nil {
		t.Fatal("migration invented authorization")
	}
	policy := StateCompatibility()
	if len(policy.ReadableSchemaVersions) != currentStateSchemaVersion || policy.ReadableSchemaVersions[1] != 2 || len(policy.AutoMigratedSchemaVersions) != currentStateSchemaVersion-1 {
		t.Fatal("schema2 compatibility omitted")
	}
}

func TestSchemaV2BackupRestoresWithoutRewritingOriginalBackup(t *testing.T) {
	s := testService(t)
	actor := testAccount(t, 10)
	track := publishTrack(t, s, actor, false)
	dir := filepath.Join(t.TempDir(), "backup")
	manifest, err := s.CreateBackup(dir)
	if err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(dir, "state.json")
	data, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	var state persistentState
	if err := json.Unmarshal(data, &state); err != nil {
		t.Fatal(err)
	}
	state.SchemaVersion = 2
	if err := saveState(statePath, &state); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	manifest.StateSchemaVersion = 2
	manifest.StateIntegrityHash = state.IntegrityHash
	manifest.StateSHA256, manifest.StateBytes, err = hashPrivateRegularFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	policy := StateCompatibility()
	policy.CurrentSchemaVersion = 2
	policy.MinimumWritableSchemaVersion = 2
	policy.ReadableSchemaVersions = []int{1, 2}
	policy.WritableSchemaVersions = []int{2}
	policy.AutoMigratedSchemaVersions = []int{1}
	manifest.StateCompatibility = &policy
	encoded, _ := json.Marshal(manifest)
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), encoded, 0600); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(t.TempDir(), "restored")
	if err := RestoreBackup(dir, filepath.Join(root, "state.json"), filepath.Join(root, "media")); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(statePath)
	if !bytes.Equal(before, after) {
		t.Fatal("original schema2 backup rewritten")
	}
	restored, err := New(Config{StatePath: filepath.Join(root, "state.json"), MediaDir: filepath.Join(root, "media"), MaxUploadBytes: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	media, _, err := restored.Media(actor, track.ID, "audio")
	if err != nil {
		t.Fatal(err)
	}
	a, _ := os.ReadFile(media)
	b, _ := os.ReadFile(track.AudioFile)
	if !bytes.Equal(a, b) {
		t.Fatal("original media lost")
	}
}
