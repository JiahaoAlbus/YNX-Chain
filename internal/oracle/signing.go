package oracle

import (
	"crypto/ed25519"
	"encoding/hex"
	"errors"
)

func (observation *Observation) Sign(privateKey ed25519.PrivateKey) error {
	if observation == nil || len(privateKey) != ed25519.PrivateKeySize {
		return errors.New("valid Ed25519 reporter private key required")
	}
	if observation.Schema != SchemaVersion || observation.ID == "" || observation.Sequence == 0 ||
		!observation.Type.ProviderInput() || observation.NonceDomain == "" || observation.Scale <= 0 ||
		observation.ObservedAt.IsZero() || observation.Source == "" || observation.SourceVersion == "" {
		return errInvalid
	}
	if err := observation.validatePayload(); err != nil {
		return err
	}
	payload, err := observation.signingBytes()
	if err != nil {
		return err
	}
	observation.SignatureHex = hex.EncodeToString(ed25519.Sign(privateKey, payload))
	observation.Hash, err = observation.CalculatedHash()
	return err
}
