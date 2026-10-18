package ynxconsensusauth

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"fmt"
	"math"
)

const (
	registryAnchorDomain = "YNX-CONSENSUS-KEY-ANCHOR/v1\x00"
	registryRootDomain   = "YNX-CONSENSUS-KEY-HISTORY/v1\x00"
)

var ErrValidatorKeyUnavailable = errors.New("validator PQ key is not authorized at this height")

// RegistryAnchor must be taken from authenticated genesis/checkpoint state.
// A chain ID alone is insufficient to distinguish independently created chains.
type RegistryAnchor struct {
	GenesisID []byte
	ChainID   string
}

func (a RegistryAnchor) validate() error {
	if len(a.GenesisID) != 32 || regZero(a.GenesisID) {
		return errors.New("missing registry genesis identity")
	}
	return validateCoordinates(a.ChainID, make([]byte, validatorAddressSize), 1, 0)
}

// RegistrationState is a detached, authenticated membership view at the exact
// execution height. The legacy key is mandatory for the first registration.
// Positive power is membership, not a claimed signature-verification result.
type RegistrationState struct {
	GenesisID              []byte
	ChainID                string
	ValidatorAddress       []byte
	Height                 int64
	VotingPower            int64
	LegacyEd25519PublicKey []byte
}

// RegistrationStateSource is implemented by the ledger/engine, not a peer. It
// must read a consistent historical membership view under its own lock and
// return detached bytes. Replaying history needs the original membership at H;
// current validators and current time are not substitutes. This pure package
// cannot establish that a supplied source or resulting history is committed.
type RegistrationStateSource interface {
	ConsensusRegistrationStateAt(genesisID []byte, chainID string, address []byte, height int64) (RegistrationState, error)
}

type keyHistoryEvent struct {
	registration Registration
	wire         []byte
	hash         [32]byte
}

// KeyHistory is immutable. Append returns a candidate successor sharing only
// private immutable prior events. All exposed bytes are copies. It neither
// persists state nor controls a consensus signer/HRS file. A ledger must commit
// the complete operation, membership/activation effects and this root atomically
// before publishing the successor as its trusted Registry.
type KeyHistory struct {
	anchor    RegistryAnchor
	events    []keyHistoryEvent
	byAddress map[string][]int
	root      [32]byte
}

var _ Registry = (*KeyHistory)(nil)

func NewKeyHistory(anchor RegistryAnchor) (*KeyHistory, error) {
	if err := anchor.validate(); err != nil {
		return nil, err
	}
	anchor.GenesisID = bytes.Clone(anchor.GenesisID)
	wire, err := regEncode(256, []byte(registryAnchorDomain), regU32(RegistryVersion), anchor.GenesisID, []byte(anchor.ChainID))
	if err != nil {
		return nil, err
	}
	return &KeyHistory{anchor: anchor, byAddress: make(map[string][]int), root: sha256.Sum256(wire)}, nil
}

func (h *KeyHistory) Anchor() RegistryAnchor {
	if h == nil {
		return RegistryAnchor{}
	}
	return RegistryAnchor{GenesisID: bytes.Clone(h.anchor.GenesisID), ChainID: h.anchor.ChainID}
}

func (h *KeyHistory) Root() [32]byte {
	if h == nil {
		return [32]byte{}
	}
	return h.root
}
func (h *KeyHistory) EventCount() int {
	if h == nil {
		return 0
	}
	return len(h.events)
}

// EventWire provides exact original bytes for ledger replay/reconciliation.
// Append rejects duplicate events, including exact retries. A durable receipt
// lookup is the caller's responsibility and must not invent a new operation.
func (h *KeyHistory) EventWire(index int) ([]byte, error) {
	if h == nil || index < 0 || index >= len(h.events) {
		return nil, errors.New("registry event index outside history")
	}
	return bytes.Clone(h.events[index].wire), nil
}

// HasPQHistory stays true after revocation. It must not be interpreted as an
// active key, nor may a failed ConsensusKeysAt lookup trigger classic fallback.
func (h *KeyHistory) HasPQHistory(address []byte) bool {
	return h != nil && len(h.byAddress[string(address)]) != 0
}

func (h *KeyHistory) Append(wire []byte, executionHeight int64, source RegistrationStateSource) (*KeyHistory, error) {
	if h == nil || h.byAddress == nil || source == nil {
		return nil, errors.New("missing initialized registry or trusted membership source")
	}
	r, err := DecodeRegistration(wire)
	if err != nil {
		return nil, err
	}
	i := r.Intent
	if executionHeight != i.ApprovedAt || i.ChainID != h.anchor.ChainID || !bytes.Equal(i.GenesisID, h.anchor.GenesisID) {
		return nil, errors.New("registration differs from trusted network or execution height")
	}
	if len(h.events) > 0 && executionHeight < h.events[len(h.events)-1].registration.Intent.ApprovedAt {
		return nil, errors.New("registration execution height regressed")
	}
	state, err := source.ConsensusRegistrationStateAt(bytes.Clone(h.anchor.GenesisID), h.anchor.ChainID, bytes.Clone(i.ValidatorAddress), executionHeight)
	if err != nil {
		return nil, fmt.Errorf("resolve registration-height membership: %w", err)
	}
	if state.ChainID != h.anchor.ChainID || !bytes.Equal(state.GenesisID, h.anchor.GenesisID) || !bytes.Equal(state.ValidatorAddress, i.ValidatorAddress) || state.Height != executionHeight || state.VotingPower <= 0 {
		return nil, errors.New("registration source does not authorize membership at execution height")
	}
	indices := h.byAddress[string(i.ValidatorAddress)]
	if i.Kind == RegisterValidator {
		if len(indices) != 0 {
			return nil, errors.New("logical validator has already entered PQ history")
		}
		legacy := bytes.Clone(state.LegacyEd25519PublicKey)
		if len(legacy) != ed25519.PublicKeySize || !bytes.Equal(legacy, i.LegacyEd25519PublicKey) {
			return nil, errors.New("first registration is not approved by the trusted old key")
		}
		addressHash := sha256.Sum256(legacy)
		if !bytes.Equal(addressHash[:validatorAddressSize], i.ValidatorAddress) {
			return nil, errors.New("legacy authority does not derive the stable logical address")
		}
	} else {
		if len(indices) == 0 {
			return nil, ErrValidatorKeyUnavailable
		}
		last := h.events[indices[len(indices)-1]]
		if last.registration.Intent.Kind == RevokeValidator {
			return nil, errors.New("terminally revoked validator cannot append another key operation")
		}
		if last.registration.Intent.Sequence == math.MaxUint64 || i.Sequence != last.registration.Intent.Sequence+1 || !bytes.Equal(i.PreviousEventHash, last.hash[:]) {
			return nil, errors.New("registration sequence or previous event differs from complete history")
		}
		current, err := h.ConsensusKeysAt(h.anchor.ChainID, i.ValidatorAddress, executionHeight)
		if err != nil {
			return nil, err
		}
		if current.Epoch != i.AuthorizingEpoch || !bytes.Equal(current.MLDSA87PublicKey, i.AuthorityMLDSA87PublicKey) || !bytes.Equal(current.SLHDSASHA2256fPublicKey, i.AuthoritySLHDSASHA2256fPublicKey) {
			return nil, errors.New("registration authority is not the active complete pair")
		}
		if i.Kind == RotateValidator {
			if last.registration.Intent.EffectiveAt > executionHeight || last.registration.Intent.Epoch == math.MaxUint64 || i.Epoch != last.registration.Intent.Epoch+1 {
				return nil, errors.New("rotation conflicts with a pending or exhausted epoch")
			}
		} else if i.Epoch != last.registration.Intent.Epoch {
			return nil, errors.New("revocation must cover the latest registered epoch, including pending keys")
		}
	}
	if i.Kind != RevokeValidator {
		// Both keys must be fresh across this anchored history, including keys
		// retired/revoked under any other logical validator. No resurrection.
		for _, previous := range h.events {
			p := previous.registration.Intent
			if p.Kind != RevokeValidator && (bytes.Equal(i.MLDSA87PublicKey, p.MLDSA87PublicKey) || bytes.Equal(i.SLHDSASHA2256fPublicKey, p.SLHDSASHA2256fPublicKey)) {
				return nil, errors.New("registration reuses a historical key branch")
			}
		}
	}
	if err := verifyRegistration(r); err != nil {
		return nil, fmt.Errorf("validator-key proof rejected: %w", err)
	}
	eventHash, err := RegistrationHash(wire)
	if err != nil {
		return nil, err
	}
	rootWire, err := regEncode(256, []byte(registryRootDomain), regU32(RegistryVersion), h.root[:], eventHash[:])
	if err != nil {
		return nil, err
	}
	next := &KeyHistory{anchor: h.anchor, root: sha256.Sum256(rootWire), events: make([]keyHistoryEvent, len(h.events)+1), byAddress: make(map[string][]int, len(h.byAddress)+1)}
	copy(next.events, h.events)
	next.events[len(h.events)] = keyHistoryEvent{registration: r, wire: bytes.Clone(wire), hash: eventHash}
	for address, oldIndices := range h.byAddress {
		next.byAddress[address] = oldIndices
	}
	newIndices := make([]int, len(indices)+1)
	copy(newIndices, indices)
	newIndices[len(indices)] = len(h.events)
	next.byAddress[string(i.ValidatorAddress)] = newIndices
	return next, nil
}

// ConsensusKeysAt derives an interval without rewriting any registration.
// Revocation invalidates every epoch from its effective height, including a
// rotation that was pending when the current authority revoked the identity.
func (h *KeyHistory) ConsensusKeysAt(chainID string, address []byte, height int64) (KeyRecord, error) {
	record, _, err := h.keyAt(chainID, address, height)
	return record, err
}

func (h *KeyHistory) keyAt(chainID string, address []byte, height int64) (KeyRecord, [32]byte, error) {
	if h == nil || h.byAddress == nil || chainID != h.anchor.ChainID || len(address) != validatorAddressSize || height <= 0 {
		return KeyRecord{}, [32]byte{}, ErrValidatorKeyUnavailable
	}
	indices := h.byAddress[string(address)]
	selected := -1
	var until int64
	for _, index := range indices {
		i := h.events[index].registration.Intent
		if i.Kind == RevokeValidator {
			if height >= i.EffectiveAt {
				return KeyRecord{}, [32]byte{}, ErrValidatorKeyUnavailable
			}
			if until == 0 || i.EffectiveAt < until {
				until = i.EffectiveAt
			}
			continue
		}
		if i.EffectiveAt <= height {
			selected = index
		} else if until == 0 || i.EffectiveAt < until {
			until = i.EffectiveAt
		}
	}
	if selected < 0 {
		return KeyRecord{}, [32]byte{}, ErrValidatorKeyUnavailable
	}
	event := h.events[selected]
	i := event.registration.Intent
	return KeyRecord{Version: Version, ChainID: chainID, ValidatorAddress: bytes.Clone(address), Epoch: i.Epoch, ValidFromHeight: i.EffectiveAt, ValidUntilHeight: until, MLDSA87PublicKey: bytes.Clone(i.MLDSA87PublicKey), SLHDSASHA2256fPublicKey: bytes.Clone(i.SLHDSASHA2256fPublicKey)}, event.hash, nil
}

// HistoryIngressLimits apply to ONE untrusted import, not to total lifetime
// ledger admission. The caller chooses a budget before parsing its outer frame.
type HistoryIngressLimits struct {
	MaxBytes  int
	MaxEvents int
}

// ReplayKeyHistory cryptographically checks every original operation and its
// historical membership. expectedRoot must come from an authenticated ledger
// checkpoint; a root supplied alongside untrusted history proves nothing.
func ReplayKeyHistory(anchor RegistryAnchor, wires [][]byte, expectedRoot [32]byte, source RegistrationStateSource, limits HistoryIngressLimits) (*KeyHistory, error) {
	if limits.MaxBytes <= 0 || limits.MaxEvents <= 0 || len(wires) > limits.MaxEvents {
		return nil, errors.New("registry import exceeds event limit")
	}
	total := 0
	for _, wire := range wires {
		if len(wire) > MaxRegistrationBytes || len(wire) > limits.MaxBytes-total {
			return nil, errors.New("registry import exceeds byte limit")
		}
		total += len(wire)
	}
	h, err := NewKeyHistory(anchor)
	if err != nil {
		return nil, err
	}
	for _, wire := range wires {
		r, err := DecodeRegistration(wire)
		if err != nil {
			return nil, err
		}
		h, err = h.Append(wire, r.Intent.ApprovedAt, source)
		if err != nil {
			return nil, err
		}
	}
	if h.root != expectedRoot {
		return nil, errors.New("registry history differs from trusted checkpoint root")
	}
	return h, nil
}
