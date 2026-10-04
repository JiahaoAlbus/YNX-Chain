package social

import "time"

// Derive expired views without a write on every read. The mutation path checks
// the same deadline under the service mutex and persists the expired terminal
// state before denying acceptance. Old requests without a deadline are kept.
func copyContactRequestResult(record ContactRequest) ContactRequest {
	// Read views own timestamp values, never mutable pointers into stored rows.
	if record.ExpiresAt != nil {
		expires := *record.ExpiresAt
		record.ExpiresAt = &expires
	}
	if record.ClosedAt != nil {
		closed := *record.ClosedAt
		record.ClosedAt = &closed
	}
	return record
}

func contactRequestAt(record ContactRequest, now time.Time) ContactRequest {
	record = copyContactRequestResult(record)
	if record.Status == "pending" && record.ExpiresAt != nil && !record.ExpiresAt.After(now) {
		record.Status = "expired"
		record.UpdatedAt = *record.ExpiresAt
		closed := *record.ExpiresAt
		record.ClosedAt = &closed
	}
	return record
}
