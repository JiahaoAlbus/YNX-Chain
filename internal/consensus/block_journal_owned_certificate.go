package consensus

import "github.com/JiahaoAlbus/YNX-Chain/internal/chain"

// Called only while publishing the explicit private native prefix certificate.
// Strict JSON decoding remains mandatory. No caller can reach the local result
// until it has been published as the private certificate's owned state.
func decodeOwnedNativeCertificate(payload []byte, expected CommittedState) (CommittedState, bool, error) {
	var canonical CommittedState
	if nativeCommittedStateCloneSupported(expected) {
		if n := len(expected.Accounts); n > 0 && n <= len(payload)/2 {
			canonical.Accounts = make([]chain.ConsensusAccount, 0, n)
		}
		if n := len(expected.FeeEvents); n > 0 && n <= len(payload)/2 {
			canonical.FeeEvents = make([]BFTFeeEvent, 0, n)
		}
	}
	if err := decodeStrictJSON(payload, &canonical); err != nil {
		return CommittedState{}, false, err
	}
	// Hints are never validation authority. An absent/null/differently sized
	// field must retain the original fresh-target nil/empty decoding semantics.
	if len(canonical.Accounts) != len(expected.Accounts) || len(canonical.FeeEvents) != len(expected.FeeEvents) {
		canonical = CommittedState{}
		if err := decodeStrictJSON(payload, &canonical); err != nil {
			return CommittedState{}, false, err
		}
	}
	// A grown decoder buffer must not increase retained slice capacity compared
	// with the original exact-length clone. Unsupported domains/schema retain
	// the original clone/fallback path as well.
	owned := nativeCommittedStateCloneSupported(canonical) &&
		cap(canonical.Accounts) == len(canonical.Accounts) &&
		cap(canonical.FeeEvents) == len(canonical.FeeEvents)
	return canonical, owned, nil
}
