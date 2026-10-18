package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/crypto/ed25519"
	cryptoenc "github.com/cometbft/cometbft/crypto/encoding"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

// ConsensusBootstrapPins are independent operator configuration. Never derive
// the expected values from the incoming genesis, migration, or a peer response.
type ConsensusBootstrapPins struct {
	CometGenesisSHA256  string
	OriginalGenesisHash string
	MigrationStateHash  string
}

// ConsensusBootstrap is immutable after construction. Its consensus GenesisID
// is SHA256(exact raw Comet genesis); the native genesis identity stays distinct.
// It authorizes registration against a fixed original Ed25519 membership only.
// It does not authorize PQ consensus or any validator-set/parameter update.
type ConsensusBootstrap struct {
	record           ValidatorBootstrapRecord
	appState         []byte
	genesisID        []byte
	validatorSetHash []byte
	members          map[string]ValidatorBootstrapMember
}

type ValidatorBootstrapMember struct {
	NativeValidator string `json:"nativeValidator"`
	Address         []byte `json:"address"`
	Ed25519         []byte `json:"ed25519"`
	Power           int64  `json:"power"`
}

// ValidatorBootstrapRecord is persisted evidence, never a substitute for
// independent operator pins. Restoring it requires an explicit Bootstrap.
type ValidatorBootstrapRecord struct {
	CometGenesisSHA256  string                     `json:"cometGenesisSHA256"`
	OriginalGenesisHash string                     `json:"originalGenesisHash"`
	MigrationStateHash  string                     `json:"migrationStateHash"`
	ValidatorSetHash    string                     `json:"validatorSetHash"`
	ChainID             string                     `json:"chainId"`
	InitialHeight       int64                      `json:"initialHeight"`
	GenesisTime         time.Time                  `json:"genesisTime"`
	Params              cmtproto.ConsensusParams   `json:"params"`
	Members             []ValidatorBootstrapMember `json:"members"`
}

func canonicalBootstrapHash(value string) ([]byte, error) {
	raw, err := hex.DecodeString(value)
	if err != nil || len(raw) != sha256.Size || hex.EncodeToString(raw) != value || bytes.Equal(raw, make([]byte, sha256.Size)) {
		return nil, errors.New("bootstrap pin must be a nonzero lowercase 32-byte hex hash")
	}
	return raw, nil
}

func NewConsensusBootstrap(rawGenesis []byte, pins ConsensusBootstrapPins, migration chain.ConsensusMigrationState) (*ConsensusBootstrap, error) {
	genesisID, err := canonicalBootstrapHash(pins.CometGenesisSHA256)
	if err != nil {
		return nil, err
	}
	for _, pin := range []string{pins.OriginalGenesisHash, pins.MigrationStateHash} {
		if _, err := canonicalBootstrapHash(pin); err != nil {
			return nil, err
		}
	}
	sum := sha256.Sum256(rawGenesis)
	if len(rawGenesis) == 0 || !bytes.Equal(sum[:], genesisID) {
		return nil, errors.New("raw Comet genesis differs from independent operator pin")
	}
	if err := migration.ValidateConsensusValidatorKeys(); err != nil {
		return nil, fmt.Errorf("bootstrap bound migration: %w", err)
	}
	if migration.OriginalGenesisHash != pins.OriginalGenesisHash || migration.StateHash != pins.MigrationStateHash || migration.Height >= math.MaxInt64 {
		return nil, errors.New("bootstrap native genesis or bound migration pin mismatch")
	}
	// Do not call GenesisDocFromJSON: its completion defaults can invent a
	// genesis time, initial height or params not present in the pinned bytes.
	var doc cmttypes.GenesisDoc
	if err := cmtjson.Unmarshal(rawGenesis, &doc); err != nil {
		return nil, fmt.Errorf("decode pinned Comet genesis: %w", err)
	}
	if doc.GenesisTime.IsZero() || doc.InitialHeight != int64(migration.Height)+1 || doc.ConsensusParams == nil || doc.ChainID != fmt.Sprintf("ynx_%d-1", migration.Network.ChainID) {
		return nil, errors.New("pinned genesis has incomplete or mismatched time/height/params/chain")
	}
	if err := doc.ConsensusParams.ValidateBasic(); err != nil {
		return nil, err
	}
	if !reflect.DeepEqual(doc.ConsensusParams.Validator.PubKeyTypes, []string{ed25519.KeyType}) {
		return nil, errors.New("fixed bootstrap only supports the original Ed25519 consensus profile")
	}
	appHash, _ := hex.DecodeString(migration.StateHash)
	if !bytes.Equal(doc.AppHash, appHash) {
		return nil, errors.New("pinned genesis AppHash differs from bound migration")
	}
	var embedded chain.ConsensusMigrationState
	if err := json.Unmarshal(doc.AppState, &embedded); err != nil {
		return nil, fmt.Errorf("decode pinned genesis AppState: %w", err)
	}
	if err := embedded.ValidateConsensusValidatorKeys(); err != nil {
		return nil, err
	}
	canonical, err := migration.CanonicalJSON()
	if err != nil {
		return nil, err
	}
	embeddedCanonical, err := embedded.CanonicalJSON()
	if err != nil || !bytes.Equal(canonical, embeddedCanonical) {
		return nil, errors.New("pinned genesis AppState is not the complete bound migration")
	}
	expected := make(map[string]chain.ConsensusValidator)
	for _, validator := range migration.Validators {
		if validator.Active {
			address := strings.ToUpper(validator.ConsensusAddress)
			if _, duplicate := expected[address]; duplicate {
				return nil, errors.New("active migration validators share a consensus identity")
			}
			expected[address] = validator
		}
	}
	if len(doc.Validators) != len(expected) || len(expected) == 0 {
		return nil, errors.New("pinned genesis must contain exactly the active migration validator set")
	}
	b := &ConsensusBootstrap{
		record:   ValidatorBootstrapRecord{CometGenesisSHA256: pins.CometGenesisSHA256, OriginalGenesisHash: pins.OriginalGenesisHash, MigrationStateHash: pins.MigrationStateHash, ChainID: doc.ChainID, InitialHeight: doc.InitialHeight, GenesisTime: doc.GenesisTime.UTC(), Params: doc.ConsensusParams.ToProto()},
		appState: bytes.Clone(canonical), genesisID: bytes.Clone(genesisID), members: make(map[string]ValidatorBootstrapMember),
	}
	var totalPower int64
	for _, validator := range doc.Validators {
		publicKey, ok := validator.PubKey.(ed25519.PubKey)
		if !ok || len(publicKey) != ed25519.PubKeySize {
			return nil, errors.New("pinned genesis requires complete Ed25519 validator keys")
		}
		address := sha256.Sum256(publicKey)
		migrated, exists := expected[strings.ToUpper(hex.EncodeToString(validator.Address))]
		expectedKey, _ := base64.StdEncoding.DecodeString(migrated.ConsensusPubKey)
		if !exists || !bytes.Equal(validator.Address, address[:20]) || !bytes.Equal(publicKey, expectedKey) || validator.Power <= 0 || validator.Power != migrated.VotingPower || validator.Name != migrated.Address {
			return nil, errors.New("pinned genesis validator key/address/power/name mismatch")
		}
		if _, duplicate := b.members[string(validator.Address)]; duplicate {
			return nil, errors.New("duplicate pinned genesis validator")
		}
		if validator.Power > cmttypes.MaxTotalVotingPower-totalPower {
			return nil, errors.New("pinned genesis voting power overflow")
		}
		totalPower += validator.Power
		member := ValidatorBootstrapMember{NativeValidator: migrated.Address, Address: bytes.Clone(validator.Address), Ed25519: bytes.Clone(publicKey), Power: validator.Power}
		b.members[string(member.Address)] = member
		b.record.Members = append(b.record.Members, member)
	}
	sort.Slice(b.record.Members, func(i, j int) bool {
		return bytes.Compare(b.record.Members[i].Address, b.record.Members[j].Address) < 0
	})
	b.validatorSetHash = bytes.Clone(doc.ValidatorHash())
	b.record.ValidatorSetHash = hex.EncodeToString(b.validatorSetHash)
	return b, nil
}

func (b *ConsensusBootstrap) validateFixedMembership(nextValidatorsHash []byte) error {
	if !bytes.Equal(nextValidatorsHash, b.validatorSetHash) {
		return errors.New("fixed-bootstrap registry refuses missing or changed validator-set hash; H+2 membership history is not implemented")
	}
	return nil
}

func (b *ConsensusBootstrap) matchesMigration(m chain.ConsensusMigrationState) error {
	if b == nil || b.record.MigrationStateHash != m.StateHash || b.record.OriginalGenesisHash != m.OriginalGenesisHash {
		return errors.New("missing or mismatched independent consensus bootstrap")
	}
	canonical, err := m.CanonicalJSON()
	if err != nil || !bytes.Equal(canonical, b.appState) {
		return errors.New("bootstrap migration changed")
	}
	return nil
}

// membershipAt never acquires Application.mu. Callers already hold that lock
// and give a detached upper bound at the actual execution/replay height.
func (b *ConsensusBootstrap) membershipAt(through int64) fixedBootstrapMembership {
	return fixedBootstrapMembership{bootstrap: b, through: through}
}

type fixedBootstrapMembership struct {
	bootstrap *ConsensusBootstrap
	through   int64
}

func (s fixedBootstrapMembership) ConsensusRegistrationStateAt(genesisID []byte, chainID string, address []byte, height int64) (ynxconsensusauth.RegistrationState, error) {
	b := s.bootstrap
	if b == nil || height < b.record.InitialHeight || height > s.through || chainID != b.record.ChainID || !bytes.Equal(genesisID, b.genesisID) {
		return ynxconsensusauth.RegistrationState{}, errors.New("registration outside pinned fixed-membership history")
	}
	member, ok := b.members[string(address)]
	if !ok {
		return ynxconsensusauth.RegistrationState{}, errors.New("registration validator absent from pinned genesis")
	}
	return ynxconsensusauth.RegistrationState{GenesisID: bytes.Clone(b.genesisID), ChainID: b.record.ChainID, ValidatorAddress: bytes.Clone(member.Address), Height: height, VotingPower: member.Power, LegacyEd25519PublicKey: bytes.Clone(member.Ed25519)}, nil
}

func (b *ConsensusBootstrap) validateInitChain(req *abci.RequestInitChain) error {
	if req == nil || req.ChainId != b.record.ChainID || req.InitialHeight != b.record.InitialHeight || !req.Time.Equal(b.record.GenesisTime) || req.ConsensusParams == nil || !reflect.DeepEqual(*req.ConsensusParams, b.record.Params) {
		return errors.New("InitChain differs from pinned genesis chain/height/time/params")
	}
	var state chain.ConsensusMigrationState
	if err := json.Unmarshal(req.AppStateBytes, &state); err != nil {
		return err
	}
	if err := b.matchesMigration(state); err != nil {
		return err
	}
	if len(req.Validators) != len(b.members) {
		return errors.New("InitChain validator count differs from pinned genesis")
	}
	seen := make(map[string]bool)
	for _, update := range req.Validators {
		key, err := cryptoenc.PubKeyFromProto(update.PubKey)
		if err != nil || key.Type() != ed25519.KeyType {
			return errors.New("InitChain requires pinned full Ed25519 keys")
		}
		member, ok := b.members[string(key.Address())]
		if !ok || seen[string(key.Address())] || !bytes.Equal(member.Ed25519, key.Bytes()) || member.Power != update.Power {
			return errors.New("InitChain substituted validator key/power or duplicate")
		}
		seen[string(key.Address())] = true
	}
	return nil
}
