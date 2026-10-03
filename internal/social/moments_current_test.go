package social

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// Compile the actual accepted combined reader contract, not a substitute.
var _ ProductBrowserSessionRevalidator = (*productsessionv2.RegisteredClientSet)(nil)

func TestMountedMomentListPreservesCurrentAuthorityError(t *testing.T) {
	f := newFixture(t, 100)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	a.session.Scopes = append(a.session.Scopes, "social.feed")
	s := bridgeService(t, a, nil)
	if _, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", ""); err != nil {
		t.Fatal(err)
	}
	s.cfg.ProductSessionRevalidator = productRevalidationReaderFunc(func(context.Context, productsessionv2.Session, []string) (productsessionv2.Session, error) {
		return productsessionv2.Session{}, &productsessionv2.Error{Status: 503, Code: "AUTHORITY_UNAVAILABLE"}
	})
	response := httptest.NewRecorder()
	NewServer(s, s).Handler().ServeHTTP(response, bridgeRequest("android", "/social/v1/feed", http.MethodGet, nil))
	if response.Code != 503 {
		t.Fatalf("current authority failure was not surfaced: %d %s", response.Code, response.Body.String())
	}
}

func TestOriginalProductBindingCannotBeReplacedAfterCurrentRead(t *testing.T) {
	f := newFixture(t, 101)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	s := bridgeService(t, a, nil)
	if _, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", ""); err != nil {
		t.Fatal(err)
	}
	before := objectDigest(s.state.Settings)
	s.cfg.ProductSessionRevalidator = productRevalidationReaderFunc(func(context.Context, productsessionv2.Session, []string) (productsessionv2.Session, error) {
		s.mu.Lock()
		key := bridgeDigest(a.session.SessionBinding)
		binding := s.state.ProductBindings[key]
		binding.BrowserGrantDigest = "replacement-family"
		s.state.ProductBindings[key] = binding
		s.mu.Unlock()
		return a.session, nil
	})
	response := httptest.NewRecorder()
	NewServer(s, s).Handler().ServeHTTP(response, bridgeRequest("android", "/social/v1/settings", http.MethodPut, ProfileSettingsInput{IdempotencyKey: "no-rebind-rescue", AllowRequestsFrom: "nobody"}))
	if response.Code != 401 || objectDigest(s.state.Settings) != before {
		t.Fatalf("replacement binding rescued old request: %d %s", response.Code, response.Body.String())
	}
}

func TestMomentBusinessCurrentReaderUnavailableLeavesOriginalState(t *testing.T) {
	for _, operation := range []string{"create-private", "create-public", "delete", "read", "comment", "comments-read", "reaction", "report", "report-read", "appeal"} {
		t.Run(operation, func(t *testing.T) {
			f := newFixture(t, 98)
			a := &bridgeAuthority{session: bridgeSession(f, "android")}
			a.session.Scopes = append(a.session.Scopes, "social.feed")
			s := bridgeService(t, a, nil)
			actor, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
			if err != nil {
				t.Fatal(err)
			}
			moment, _, err := s.CreateMoment(actor, "existing-moment", "Original moment", "private", nil)
			if err != nil {
				t.Fatal(err)
			}
			report, _, err := s.CreateSocialReport(actor, "existing-report", "moment", moment.ID, "spam", "Original report", nil)
			if err != nil {
				t.Fatal(err)
			}
			before := objectDigest(s.state)
			calls := 0
			actor.revalidateProduct = func(scope string) error {
				calls++
				if scope != "social.feed" {
					t.Fatal("moment scope widened")
				}
				if !s.mu.TryLock() {
					t.Fatal("reader called under Social mutex")
				}
				s.mu.Unlock()
				return &productsessionv2.Error{Status: 503, Code: "AUTHORITY_UNAVAILABLE"}
			}
			switch operation {
			case "create-private":
				_, _, err = s.CreateMoment(actor, "new-moment", "New moment", "private", nil)
			case "create-public":
				_, _, err = s.CreateMoment(actor, "new-moment", "New moment", "public", nil)
			case "delete":
				err = s.DeleteMoment(actor, moment.ID)
			case "read":
				_, err = s.Moment(actor, moment.ID)
			case "comment":
				_, _, err = s.CreateMomentComment(actor, moment.ID, "new-comment", "New comment")
			case "comments-read":
				_, err = s.MomentComments(actor, moment.ID)
			case "reaction":
				_, _, err = s.SetMomentReaction(actor, moment.ID, "new-reaction", "like", true)
			case "report":
				_, _, err = s.CreateSocialReport(actor, "new-report", "moment", moment.ID, "spam", "New report", nil)
			case "report-read":
				_, err = s.SocialReport(actor, report.ID)
			case "appeal":
				_, err = s.AppealSocialReport(actor, report.ID, "Original correction")
			}
			var typed *productsessionv2.Error
			if !errors.As(err, &typed) || typed.Status != 503 || calls != 1 {
				t.Fatalf("current authority bypassed: %v calls=%d", err, calls)
			}
			if objectDigest(s.state) != before {
				t.Fatal("failed authority changed moment/report state")
			}
		})
	}
}

func TestPublicMomentUnknownEffectRetainsOriginalIntentForExplicitRetry(t *testing.T) {
	f := newFixture(t, 99)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	a.session.Scopes = append(a.session.Scopes, "social.feed")
	s := bridgeService(t, a, nil)
	actor, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(filepath.Dir(s.cfg.StatePath), "square.json")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	actor.requestContext = ctx
	actor.revalidateProduct = func(string) error { return nil }
	originalNow := s.cfg.Now
	s.cfg.Now = func() time.Time {
		after, err := os.ReadFile(path)
		if err == nil && !bytes.Equal(before, after) {
			cancel()
		}
		return originalNow()
	}
	_, _, err = s.CreateMoment(actor, "public-original-intent", "Public original intent", "public", nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected original cancellation after Square effect: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || bytes.Equal(before, after) {
		t.Fatal("actual Square effect was not observed")
	}
	if len(s.state.Moments) != 0 {
		t.Fatal("cancelled moment was committed")
	}
	prepared := s.state.Idempotency[idempotencyStateKey(actor.Account, "public-original-intent")]
	if prepared.Action != "moment_create_prepared" {
		t.Fatal("unknown original intent discarded")
	}
	s.cfg.Now = originalNow
	actor.requestContext = context.Background()
	if _, _, err := s.CreateMoment(actor, "replacement-intent", "Public original intent", "public", nil); !errors.Is(err, ErrConflict) {
		t.Fatalf("unknown intent replaced: %v", err)
	}
	result, replay, err := s.CreateMoment(actor, "public-original-intent", "Public original intent", "public", nil)
	if err != nil || replay || result.SquarePostID == "" {
		t.Fatalf("explicit original settlement failed: %v", err)
	}
	settled, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(after, settled) {
		t.Fatal("Square effect repeated during settlement")
	}
	if _, replay, err := s.CreateMoment(actor, "public-original-intent", "Public original intent", "public", nil); err != nil || !replay {
		t.Fatal("original completed receipt missing")
	}
}
