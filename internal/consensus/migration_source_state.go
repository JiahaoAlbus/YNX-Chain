package consensus

import (
	"errors"
	"reflect"
)

// Source imports are part of the committed value, never disposable query
// caches. Pay/AI preserve immutable original records; Trust may only append
// fully replayable, newly signed updates. No continuation grants the missing
// original principals or removes the migration execution closure.
func validateLegacySourceContinuation(previous, next CommittedState) error {
	if !reflect.DeepEqual(previous.LegacyPaySource, next.LegacyPaySource) {
		return errors.New("source Pay records cannot be replaced or removed")
	}
	if !reflect.DeepEqual(previous.LegacyAISource, next.LegacyAISource) {
		return errors.New("source AI records cannot be replaced or removed")
	}
	if previous.LegacyTrustSource == nil && next.LegacyTrustSource != nil {
		return errors.New("source Trust import cannot be introduced after initialization")
	}
	return validateLegacyTrustSourceContinuation(previous.LegacyTrustSource, next.LegacyTrustSource)
}
