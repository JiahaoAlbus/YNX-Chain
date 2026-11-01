package ynxconsensusauth

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
)

// HostRecoverySnapshot is evidence about the supplied ciphertext and complete
// public H/R/S bytes. It grants no freshness, registry, transport or signing
// authority. In particular, a previously exported valid snapshot may be stale.
type HostRecoverySnapshot struct {
	Version                    string `json:"version"`
	StateSHA256                string `json:"stateSHA256"`
	StateBytes                 int    `json:"stateBytes"`
	OriginalSignerStatePath    string `json:"originalSignerStatePath"`
	Height                     int64  `json:"height"`
	Round                      int32  `json:"round"`
	Kind                       Kind   `json:"kind"`
	PendingUnsignedReservation bool   `json:"pendingUnsignedReservation"`
	MessageBytes               int    `json:"messageBytes"`
	SignatureBytes             int    `json:"signatureBytes"`
	PrecommitMessageBytes      int    `json:"precommitMessageBytes"`
	PrecommitSignatureBytes    int    `json:"precommitSignatureBytes"`
	VaultAuthenticated         bool   `json:"vaultAuthenticated"`
	CompleteHRSValidated       bool   `json:"completeHRSValidated"`
	PublicStateOnly            bool   `json:"publicStateOnly"`
	AcknowledgementKnown       bool   `json:"acknowledgementKnown"`
	RegistryMembershipVerified bool   `json:"registryMembershipVerified"`
	AntiRollbackFreshness      bool   `json:"antiRollbackFreshness"`
	OffHostSourceVerified      bool   `json:"offHostSourceVerified"`
	SigningReady               bool   `json:"signingReady"`
	AuthorityGranted           bool   `json:"authorityGranted"`
	FilesWritten               bool   `json:"filesWritten"`
	SignaturesProduced         bool   `json:"signaturesProduced"`
}

// VerifyHostRecoverySnapshot authenticates the original HostVault and validates
// every original H/R/S field using the SAME validator as ResumeSigner. It does
// not open expected.SignerStatePath, acquire/create a lock, reconfirm durability,
// sign, reset an epoch or return a private-key/signer capability. The absolute
// path remains in the independently expected binding and authenticated AAD.
//
// This deliberately does not resolve current registry membership. The empty
// history below supplies only the independently supplied genesis/chain anchor
// required by the existing mathematical state validator; no registration is
// installed. Runtime resume still requires the original independent Registry.
func VerifyHostRecoverySnapshot(vaultWire, stateWire, credential []byte, expected HostKeyBinding) (HostRecoverySnapshot, error) {
	var result HostRecoverySnapshot
	if len(vaultWire) == 0 || len(vaultWire) > MaxHostKeyEnvelopeBytes || len(stateWire) == 0 || len(stateWire) > maxSignerStateBytes || len(credential) != 32 {
		return result, errors.New("bounded original recovery ciphertext, complete HRS and raw credential required")
	}
	bindingWire, err := expected.wire()
	if err != nil {
		return result, err
	}
	expected, err = decodeHostBinding(bindingWire)
	if err != nil {
		return result, err
	}
	// No input buffer supplied by the caller is retained or cleared by us.
	ownedVault, ownedState, ownedCredential := bytes.Clone(vaultWire), bytes.Clone(stateWire), bytes.Clone(credential)
	defer clear(ownedVault)
	defer clear(ownedState)
	defer clear(ownedCredential)
	key, err := OpenHostKeyEnvelope(ownedVault, ownedCredential, expected)
	if err != nil {
		return result, err
	}
	defer key.Destroy()
	var state signerState
	decoder := json.NewDecoder(bytes.NewReader(ownedState))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&state) != nil || decoder.Decode(new(any)) != io.EOF || !hostIdentityMatches(state, expected) {
		return result, errors.New("recovery HRS differs from complete independently expected identity")
	}
	canonical, err := json.Marshal(state)
	if err != nil || !bytes.Equal(canonical, ownedState) {
		return result, errors.New("recovery requires exact complete canonical HRS; unknown or duplicate fields forbidden")
	}
	anchor, err := NewKeyHistory(RegistryAnchor{GenesisID: bytes.Clone(expected.Policy.GenesisID), ChainID: expected.Policy.ChainID})
	if err != nil {
		return result, err
	}
	// This in-memory checker has no path, lock or write function. It never
	// escapes, and cannot perform a durable Sign operation. Do not call Resume.
	checker := &Signer{signerCore: &signerCore{key: key, registry: anchor, state: state}}
	if err = checker.validateState(); err != nil {
		return result, err
	}
	digest := sha256.Sum256(ownedState)
	return HostRecoverySnapshot{
		Version: "YNX-CONSENSUS-HOST-RECOVERY-SNAPSHOT/v1", StateSHA256: hex.EncodeToString(digest[:]), StateBytes: len(ownedState),
		OriginalSignerStatePath: expected.SignerStatePath, Height: state.Height, Round: state.Round, Kind: state.Kind,
		PendingUnsignedReservation: state.Height != 0 && len(state.Signature) == 0,
		MessageBytes:               len(state.Message), SignatureBytes: len(state.Signature), PrecommitMessageBytes: len(state.PrecommitMessage), PrecommitSignatureBytes: len(state.PrecommitSignature),
		VaultAuthenticated: true, CompleteHRSValidated: true, PublicStateOnly: true,
	}, nil
}
