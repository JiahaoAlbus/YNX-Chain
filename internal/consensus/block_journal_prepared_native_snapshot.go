package consensus

// This private candidate is selected only by the explicit prepared decoder. It
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

func (d *BlockJournalPrefixDecoder) encodePreparedPrefixSnapshot(state CommittedState) ([]byte, *preparedCanonicalNativeSnapshot, error) {
	if d != nil && d.preparedNative {
		prepared, err := prepareCanonicalNativeSnapshot(state)
		if err != nil {
			return nil, nil, err
		}
		if prepared != nil {
			return append([]byte(nil), prepared.payload...), prepared, nil
		}
	}
	payload, err := encodeCommittedStateJSON(state)
	return payload, nil, err
}
