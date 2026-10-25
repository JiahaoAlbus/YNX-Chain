package types

import (
	"errors"

	"github.com/cometbft/cometbft/crypto/ynxpq"
)

// WithConsensusAuthorizer returns a detached validator set with the local
// trusted-history reader attached to PQ keys. Network/JSON/protobuf decoders
// never call this. An engine integration must call it with the authenticated
// history for every current or historical set used by consensus, evidence,
// block sync and light verification; omitting it fails signature verification.
// The callback must enforce the independently pinned genesis and actual
// activation/membership/epoch/revocation at each requested height.
//
// Neither the source set nor its hash changes. No global resolver is installed.
func (vals *ValidatorSet) WithConsensusAuthorizer(authorizer ynxpq.Authorizer) (*ValidatorSet, error) {
	if vals == nil {
		return nil, errors.New("nil validator set")
	}
	copy := vals.Copy()
	// Upstream ValidatorSet.Copy deliberately aliases Proposer.
	if copy.Proposer != nil {
		copy.Proposer = copy.Proposer.Copy()
	}
	bind := func(v *Validator) error {
		if v == nil {
			return nil
		}
		if key, ok := v.PubKey.(ynxpq.PubKey); ok {
			if authorizer == nil {
				return errors.New("PQ validator set requires trusted consensus authorizer")
			}
			if _, err := ynxpq.DecodePubKey(key.Bytes()); err != nil {
				return err
			}
			if err := v.ValidateBasic(); err != nil {
				return err
			}
			v.PubKey = key.WithAuthorizer(authorizer)
		}
		return nil
	}
	for _, v := range copy.Validators {
		if err := bind(v); err != nil {
			return nil, err
		}
	}
	if err := bind(copy.Proposer); err != nil {
		return nil, err
	}
	return copy, nil
}
