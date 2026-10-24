package developerauthority

import (
	"context"
	"testing"
)

func TestR221PublicationCallerStillChecksPublisherAfterIndependentApprovals(t *testing.T) {
	c, s, manifest, packet := r217PublicationFixture(t)
	s.denyPublisherAtCall = 3
	r := actualPrincipalRequest()
	r.Header.Set("x-request-id", "req_PUBLIC_POST_APPROVAL_REVOKE_12345")
	if p, e := c.AuthorizePublication(context.Background(), r, manifest, packet); e == nil || p != nil {
		t.Fatal("current guard after independent approvals skipped")
	}
	if s.authentications != 1 || s.artifactCalls != 1 || s.resourceCalls != 1 || s.publisherCurrentCalls != 3 {
		t.Fatal("did not actually reach third original current call", s.authentications, s.artifactCalls, s.resourceCalls, s.publisherCurrentCalls)
	}
	t.Logf("PUBLIC rejected continuation: authentication=%d artifact=%d resource=%d current=%d", s.authentications, s.artifactCalls, s.resourceCalls, s.publisherCurrentCalls)
}
