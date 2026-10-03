package chaincrypto

func boundedKeys(k PublicKeys) bool { return len(k.Classical) <= 33 && len(k.PostQuantum) <= 2592 }
func boundedSignatures(s Signatures) bool {
	return len(s.Classical) <= 72 && len(s.PostQuantum) <= 4627
}

// Each verification decision owns its byte inputs before invoking an external
// provider. Callers must not concurrently mutate inputs during this initial
// snapshot; after that boundary no caller-owned slice is retained or consulted.
func snapshotKeys(k PublicKeys) PublicKeys {
	return PublicKeys{append([]byte(nil), k.Classical...), append([]byte(nil), k.PostQuantum...)}
}
func snapshotSignatures(s Signatures) Signatures {
	return Signatures{append([]byte(nil), s.Classical...), append([]byte(nil), s.PostQuantum...)}
}
func snapshotPolicy(p AuthPolicy) AuthPolicy { p.Keys = snapshotKeys(p.Keys); return p }
func snapshotConsensus(m ConsensusMessage) ConsensusMessage {
	m.OriginalSignBytes = append([]byte(nil), m.OriginalSignBytes...)
	return m
}
