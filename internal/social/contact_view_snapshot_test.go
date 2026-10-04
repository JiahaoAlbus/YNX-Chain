package social

import (
	"testing"
	"time"
)

func TestContactRequestViewCannotMutateOriginalDeadline(t *testing.T) {
	deadline := time.Date(2030, 1, 2, 3, 4, 5, 0, time.UTC)
	original := ContactRequest{Status: "pending", ExpiresAt: &deadline}
	view := contactRequestAt(original, deadline.Add(-time.Second))
	*view.ExpiresAt = deadline.Add(time.Hour)
	if !original.ExpiresAt.Equal(time.Date(2030, 1, 2, 3, 4, 5, 0, time.UTC)) {
		t.Fatal("contact read view aliases original request deadline")
	}
}

func TestExpiredContactViewRetainsIndependentDeadlineAndClosedAt(t *testing.T) {
	deadline := time.Date(2030, 1, 2, 3, 4, 5, 0, time.UTC)
	expected := deadline
	original := ContactRequest{Status: "pending", ExpiresAt: &deadline}
	view := contactRequestAt(original, deadline)
	if view.Status != "expired" || view.ClosedAt == nil || !view.ClosedAt.Equal(deadline) {
		t.Fatal("expiry view lost the original terminal timestamp")
	}
	*view.ClosedAt = deadline.Add(time.Hour)
	if !original.ExpiresAt.Equal(expected) || !view.ExpiresAt.Equal(expected) || original.Status != "pending" || original.ClosedAt != nil {
		t.Fatal("expired view aliases original deadline or another result field")
	}
}

func TestClosedContactViewAndLegacyNoDeadlineRemainCompatible(t *testing.T) {
	closed := time.Date(2030, 1, 2, 3, 4, 5, 0, time.UTC)
	original := ContactRequest{Status: "accepted", ClosedAt: &closed}
	view := contactRequestAt(original, closed.Add(time.Hour))
	*view.ClosedAt = closed.Add(time.Hour)
	if !original.ClosedAt.Equal(time.Date(2030, 1, 2, 3, 4, 5, 0, time.UTC)) {
		t.Fatal("closed read view aliases original terminal timestamp")
	}
	legacy := contactRequestAt(ContactRequest{Status: "pending"}, closed)
	if legacy.Status != "pending" || legacy.ExpiresAt != nil || legacy.ClosedAt != nil {
		t.Fatal("legacy request without deadline was rewritten")
	}
}
