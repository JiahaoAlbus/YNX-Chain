package developerauthority

// Re-exercise the R219 failed full-pinned normal caller chain against current
// production transport. Never use R221's caller-only publisher shortcut here.
// SQL/role/approval metadata remains explicitly PUBLIC, not Root or a live
// issuer/Source. Actual HTTP principal, Catalog, full original factory reader,
// held-file verification and bounded Node children do run.
import (
	"context"
	"testing"
	"time"
)

type r232FullPinnedSource struct {
	*r217PublicationSource
	fullPublisherCalls int
}

func (s *r232FullPinnedSource) AssertPublisherCurrent(ctx context.Context, p Principal, k Publisher) error {
	s.fullPublisherCalls++
	return s.factory.AssertPublisherCurrent(ctx, p, k)
}
func TestR232OriginalFailedNormalCallerWithFullPinnedCurrent(t *testing.T) {
	started := time.Now()
	c, base, manifest, packet := r217PublicationFixture(t)
	source := &r232FullPinnedSource{r217PublicationSource: base}
	c.source = source
	request := actualPrincipalRequest()
	request.Header.Set("x-request-id", "req_PUBLIC_R232_FULL_PIN_FIRST_12345")
	permit, e := c.AuthorizePublication(context.Background(), request, manifest, packet)
	if e != nil || permit == nil {
		t.Logf("PUBLIC full pin first phase: calls=%d elapsed=%s principalExpires=%d publisherExpires=%d now=%d", source.fullPublisherCalls, time.Since(started), base.p.ExpiresMS, base.key.ExpiresMS, time.Now().UnixMilli())
		v := base.factory.control.verifier
		t.Logf("PUBLIC original verifier failurePhase=%s", v.FailurePhase())
		t.Fatal("original full-pinned AuthorizePublication", e)
	}
	if base.authentications != 1 || base.artifactCalls != 1 || base.resourceCalls != 1 {
		t.Fatal("normal caller repeated authentication/approval")
	}
	second := actualPrincipalRequest()
	second.Header.Set("x-request-id", "req_PUBLIC_R232_FULL_PIN_SECOND_12345")
	if e = c.RecheckPermit(context.Background(), second, permit); e != nil {
		t.Logf("PUBLIC second phase: fullCalls=%d elapsed=%s phase=%s", source.fullPublisherCalls, time.Since(started), base.factory.control.verifier.FailurePhase())
		t.Fatal("full pinned original permit recheck", e)
	}
	if base.authentications != 2 || base.artifactCalls != 1 || base.resourceCalls != 1 || source.fullPublisherCalls != 10 || base.publisherCurrentCalls != 0 {
		t.Fatal("full reader bypass/repeated credential/approval", base.authentications, base.artifactCalls, base.resourceCalls, source.fullPublisherCalls, base.publisherCurrentCalls)
	}
	if len(base.factory.publisher.projectOriginals) != 20 {
		t.Fatal("actual before/after current children missing", len(base.factory.publisher.projectOriginals))
	}
	t.Logf("PUBLIC full normal call/recheck PASS: elapsed=%s fullFactoryCalls=%d actualCurrentOriginals=%d normalHTTPAuthentications=%d; Root=false liveIssuer=false Source13=false", time.Since(started), source.fullPublisherCalls, len(base.factory.publisher.projectOriginals), base.authentications)
}
