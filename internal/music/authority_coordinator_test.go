//go:build ynx_canonical_media && ynx_media_combined_authority

package music

import (
	"context"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"os"
	"testing"
	"time"
)

// No real enrollment producer is claimed: controlled binding compatibility
// exercises actual original Music persistence with the exact Shared component.
type musicOwnedCoordinatorSource struct{ session productsessionv2.Session }

func (s *musicOwnedCoordinatorSource) AssertOriginalMediaSourceCurrent(context.Context) error {
	return nil
}
func (s *musicOwnedCoordinatorSource) ReadOriginalMediaAuthority(context.Context, productsessionv2.Session, *productsessionv2.BrowserGrant) (productsessionv2.MediaAuthoritySnapshot, error) {
	return productsessionv2.MediaAuthoritySnapshot{Session: s.session, FamilyID: "controlled-integration-model-not-enrollment", PrivateGeneration: 0, GenerationAvailable: true, Enrolled: true, MembershipAvailable: true, MembershipRevision: 0}, nil
}
func TestMusicOriginalCoordinatorFreshCommitPhasesAndDurableReadback(t *testing.T) {
	b, err := os.ReadFile("../productsessionv2/testdata/finance-v2.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct{ Session productsessionv2.Session }
	if err = json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	issued, err := time.Parse(time.RFC3339Nano, f.Session.IssuedAt)
	if err != nil {
		t.Fatal(err)
	}
	now := issued.Add(time.Second)
	s := testService(t)
	s.cfg.Now = func() time.Time { return now }
	c := productsessionv2.NewMediaAuthorityCoordinator(func() time.Time { return now })
	_, err = c.RegisterOriginalWriter(context.Background(), &musicOwnedCoordinatorSource{f.Session})
	if err != nil {
		t.Fatal(err)
	}
	lease := testBusinessLease(f.Session.Account, "coordinator_music_nonce_01", s.cfg.Now)
	lease.grant.Current = func(context.Context) error { return nil }
	captures := 0
	lease.grant.CaptureTransaction = func(ctx context.Context) (MusicLocalTransaction, error) {
		captures++
		return c.Capture(ctx, f.Session, nil)
	}
	scoped := s.requestService(lease)
	for _, name := range []string{"original first phase", "original second phase"} {
		if _, err = scoped.UpsertProfile(f.Session.Account, Profile{DisplayName: name}); err != nil {
			t.Fatal(err)
		}
	}
	if captures != 2 {
		t.Fatal("one-shot lease reused", captures)
	}
	recovered, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	record, err := recovered.ReadOriginalBusinessNonce(context.Background(), lease.grant.SessionBinding, lease.grant.Nonce)
	if err != nil || record.Actor != f.Session.Account {
		t.Fatal("original nonce not durable", record, err)
	}
}
