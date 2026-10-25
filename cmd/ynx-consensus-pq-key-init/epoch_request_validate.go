//go:build unix

package main

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	"github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

// Both the public producer and the original secret-consuming ceremony apply
// this exact validation. Producing request bytes installs no authority.
func validateEpochRequest(request epochRequest, genesis []byte) error {
	genesisID := sha256.Sum256(genesis)
	i := request.Registration
	if request.Format != requestFormat || request.Epoch == 0 || request.ActivationHeight <= 0 || len(request.ValidatorAddress) != 20 || i.ChainID != request.ChainID || !bytes.Equal(i.GenesisID, genesisID[:]) || !bytes.Equal(i.ValidatorAddress, request.ValidatorAddress) || i.Epoch != request.Epoch || len(i.MLDSA87PublicKey) != 0 || len(i.SLHDSASHA2256fPublicKey) != 0 || (i.Kind != ynxconsensusauth.RegisterValidator && i.Kind != ynxconsensusauth.RotateValidator) {
		return errors.New("new-epoch request must bind complete original identity and registration/rotation with empty new-key fields")
	}
	// Check all non-key intent syntax before generating secrets. These temporary
	// fixed-size public placeholders grant no authority and are never signed.
	i.MLDSA87PublicKey = make([]byte, ynxconsensusauth.MLDSA87PublicKeySize)
	i.SLHDSASHA2256fPublicKey = make([]byte, ynxconsensusauth.SLHDSASHA2256fPublicKeySize)
	if err := i.Validate(); err != nil {
		return err
	}
	var doc cmttypes.GenesisDoc
	if err := cmtjson.Unmarshal(genesis, &doc); err != nil {
		return errors.New("invalid pinned Comet genesis")
	}
	if doc.ChainID != request.ChainID || doc.InitialHeight <= 0 || request.ActivationHeight < doc.InitialHeight || i.ApprovedAt < doc.InitialHeight || doc.GenesisTime.IsZero() || doc.ConsensusParams == nil || len(doc.Validators) == 0 || doc.ConsensusParams.ValidateBasic() != nil {
		return errors.New("pinned genesis has incomplete or different chain parameters")
	}
	if len(doc.ConsensusParams.Validator.PubKeyTypes) != 1 || doc.ConsensusParams.Validator.PubKeyTypes[0] != ed25519.KeyType {
		return errors.New("new epoch requires the original pinned Ed25519 genesis set")
	}
	found := false
	seen := make(map[string]bool, len(doc.Validators))
	for _, member := range doc.Validators {
		pub, ok := member.PubKey.(ed25519.PubKey)
		if !ok || len(pub) != ed25519.PubKeySize || member.Power <= 0 {
			return errors.New("invalid original genesis validator")
		}
		h := sha256.Sum256(pub)
		if !bytes.Equal(member.Address, h[:20]) || seen[string(member.Address)] {
			return errors.New("duplicate or mismatched original consensus address")
		}
		seen[string(member.Address)] = true
		if bytes.Equal(member.Address, request.ValidatorAddress) {
			found = true
			if i.Kind == ynxconsensusauth.RegisterValidator && !bytes.Equal(i.LegacyEd25519PublicKey, pub) {
				return errors.New("first registration names a different original public authority")
			}
		}
	}
	if !found {
		return errors.New("logical validator is absent from independently pinned original genesis")
	}
	return nil
}
