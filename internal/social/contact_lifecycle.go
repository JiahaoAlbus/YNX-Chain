package social

import "time"

// Derive expired views without a write on every read. The mutation path checks
// the same deadline under the service mutex and persists the expired terminal
// state before denying acceptance. Old requests without a deadline are kept.
func contactRequestAt(record ContactRequest, now time.Time) ContactRequest {
	if record.Status == "pending" && record.ExpiresAt != nil && !record.ExpiresAt.After(now) {
		record.Status = "expired"
		record.UpdatedAt = *record.ExpiresAt
		record.ClosedAt = record.ExpiresAt
	}
	return record
}
