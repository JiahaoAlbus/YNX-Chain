package types

// ConsensusCheckpointSigningContextSetter is the remote variant of the local
// context setter. Every value is captured from the engine's locked State,
// never from a peer message or from an uncommitted ABCI candidate.
type ConsensusCheckpointSigningContextSetter interface {
	SetConsensusCheckpointSigningContext(chainID string, committedHeight int64, appHash []byte, height int64, round int32, actual *ValidatorSet) error
}

// ConsensusSigningAuthoritySource must read the actual current committed
// checkpoint on every signing operation. A historical cache hit is not proof
// that a requested checkpoint is still current. This is intentionally distinct
// from ConsensusAuthoritySource, whose historical cache is useful to replay.
type ConsensusSigningAuthoritySource interface {
	ConsensusAuthorityForSigning(chainID string, committedHeight int64, appHash []byte) (ConsensusAuthority, error)
}
