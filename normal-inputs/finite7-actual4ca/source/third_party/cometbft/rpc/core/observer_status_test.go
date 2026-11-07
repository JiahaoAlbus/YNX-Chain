package core

import "testing"

func TestObserverStatusPUBLICNoValidatorKeyRequiresNoMembershipLookup(t *testing.T) {
	// Nil StateStore makes an accidental membership read observable. Only the
	// explicit observer Node supplies this no-key environment in normal code.
	env := &Environment{}
	for _, height := range []int64{0, 1, 9223372036854775807} {
		if env.validatorAtHeight(height) != nil {
			t.Fatal("observer acquired validator voting power")
		}
	}
}
