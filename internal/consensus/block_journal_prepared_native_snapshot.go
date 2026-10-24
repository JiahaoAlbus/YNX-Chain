package consensus

// This private candidate is not selected by a decoder or a public API. It
// prepares an independently owned JSON-normalized native state and encodes that
// same owned object once. Arbitrary input bytes still require strict decoding;
// this object cannot be made from caller-supplied JSON. Callers must retain full
// state/signature/history validation and independent public-result ownership.
type preparedCanonicalNativeSnapshot struct {
	payload []byte
	state   CommittedState
}

func prepareCanonicalNativeSnapshot(state CommittedState) (*preparedCanonicalNativeSnapshot, error) {
	private, ok := cloneCanonicalNativeCommittedState(state)
	if !ok {
		return nil, nil
	} // Unsupported domain/schema/string/time: original route.
	payload, err := encodeCommittedStateJSON(private)
	if err != nil {
		return nil, err
	}
	return &preparedCanonicalNativeSnapshot{payload: payload, state: private}, nil
}
