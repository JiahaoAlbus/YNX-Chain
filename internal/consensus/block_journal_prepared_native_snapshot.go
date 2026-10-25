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
	return prepareCanonicalNativeSnapshotWithTiming(state, nil)
}

func prepareCanonicalNativeSnapshotWithTiming(state CommittedState, phases *BlockJournalPrefixWorkPhases) (*preparedCanonicalNativeSnapshot, error) {
	var private CommittedState
	var ok bool
	_ = phases.measurePrepared("normalize", func() error {
		private, ok = cloneCanonicalNativeCommittedState(state)
		return nil
	})
	if !ok {
		return nil, nil
	} // Unsupported domain/schema/string/time: original route.
	var payload []byte
	err := phases.measurePrepared("jsonEncode", func() error {
		var err error
		payload, err = encodePreparedNativeStateJSON(private)
		return err
	})
	if err != nil {
		return nil, err
	}
	return &preparedCanonicalNativeSnapshot{payload: payload, state: private}, nil
}

func (d *BlockJournalPrefixDecoder) encodePreparedPrefixSnapshot(state CommittedState) ([]byte, *preparedCanonicalNativeSnapshot, error) {
	return d.encodePreparedPrefixSnapshotWithTiming(state, nil)
}

func (d *BlockJournalPrefixDecoder) encodePreparedPrefixSnapshotWithTiming(state CommittedState, phases *BlockJournalPrefixWorkPhases) ([]byte, *preparedCanonicalNativeSnapshot, error) {
	if d != nil && d.preparedNative {
		prepared, err := prepareCanonicalNativeSnapshotWithTiming(state, phases)
		if err != nil {
			return nil, nil, err
		}
		if prepared != nil {
			var public []byte
			_ = phases.measurePrepared("publicCopy", func() error {
				public = append([]byte(nil), prepared.payload...)
				return nil
			})
			return public, prepared, nil
		}
	}
	var payload []byte
	err := phases.measurePrepared("fallbackEncode", func() error {
		var err error
		payload, err = encodeCommittedStateJSON(state)
		return err
	})
	return payload, nil, err
}
