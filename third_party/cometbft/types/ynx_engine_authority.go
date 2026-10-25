package types

import (
	"github.com/cometbft/cometbft/crypto"
	"github.com/cometbft/cometbft/crypto/ynxpq"
)

// ConsensusAuthority is a detached, immutable, independently authenticated
// application history. Binding preserves actual proposer priorities and checks
// the complete height-specific key/address/power set. Decoded peer keys never
// implement or supply this authority.
type ConsensusAuthority interface {
	BindValidatorSet(height int64, actual *ValidatorSet) (*ValidatorSet, error)
	ParamsAt(height int64) (ConsensusParams, error)
}

// ConsensusAuthoritySource must authenticate the exact committed application
// checkpoint requested by the engine. A current file at a different height is
// not a substitute. Implementations must not acquire the consensus state lock.
type ConsensusAuthoritySource interface {
	ConsensusAuthorityForState(chainID string, committedHeight int64, appHash []byte) (ConsensusAuthority, error)
}

// ConsensusEvidenceAuthority authenticates keys in a conflicting set without
// asserting its claimed membership or powers are the canonical set. A lunatic
// evidence proof may deliberately contain such a conflicting claim. It must
// never be used to bind the engine's real current/next/last sets.
type ConsensusEvidenceAuthority interface {
	BindEvidenceValidatorSet(height int64, actual *ValidatorSet) (*ValidatorSet, error)
}

// HeightPrivValidator selects the exact registered full key for the actual
// height; stock GetPubKey has no height and cannot select a rotation safely.
type HeightPrivValidator interface {
	GetPubKeyForHeight(chainID string, height int64) (crypto.PubKey, error)
}

// ConsensusSigningContextSetter receives the engine's real current-round set
// while the engine holds its own lock. The recipient must copy the view and
// cannot call back into that lock. This is not a network signing message.
type ConsensusSigningContextSetter interface {
	SetConsensusSigningContext(chainID string, height int64, round int32, validators *ValidatorSet) error
}

func ValidatorSetRequiresConsensusAuthority(set *ValidatorSet) bool {
	if set == nil {
		return false
	}
	for _, v := range set.Validators {
		if v != nil && v.PubKey != nil && v.PubKey.Type() == ynxpq.KeyType {
			return true
		}
	}
	return false
}
