package types

// ConsensusRuntimeCheckpointConsumer is an optional in-process application
// hook. Only the engine's durable state store or normal handshake replay may
// call it, after authenticating these coordinates from local engine history.
// ABCI Info, Finalize responses, peer messages and pending state are not a
// substitute. The application independently pins the original raw genesis and
// upgrade plan; this interface does not configure either.
type ConsensusRuntimeCheckpointConsumer interface {
	ConfirmConsensusRuntimeCheckpoint(chainID string, height int64, appHash []byte, appVersion uint64) error
}
