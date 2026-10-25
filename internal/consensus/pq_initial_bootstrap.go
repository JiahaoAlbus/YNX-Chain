package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const PQInitialAccountsVersion = "YNX-PQ-INITIAL-ACCOUNTS/v1"
const PQInitialAccountsGenesisField = "pq_initial_accounts"
const maxPQInitialAccountsBytes = 8 << 20

// PQInitialAccountBinding is an operator assignment of an unused canonical
// address to a complete pair. It does not define a key-to-address derivation.
type PQInitialAccountBinding struct {
	Owner string `json:"owner"`
	PKA   string `json:"pkA"`
	PKB   string `json:"pkB"`
}

// PQInitialAccountConfiguration is part of the exact independently pinned
// Genesis, never transaction/HTTP input. The finite allowlist only authorizes
// fee0/nonce1/zero-balance birth, not funding, delegation or ordinary execution.
type PQInitialAccountConfiguration struct {
	Version   string                    `json:"version"`
	NetworkID string                    `json:"networkId"`
	EnableAt  string                    `json:"enableAt"`
	BirthFee  string                    `json:"birthFee"`
	Accounts  []PQInitialAccountBinding `json:"accounts"`
}

func canonicalInitialKey(value string, length int) ([]byte, bool) {
	raw, err := hex.DecodeString(value)
	return raw, err == nil && len(raw) == length && hex.EncodeToString(raw) == value && !bytes.Equal(raw, make([]byte, length))
}

func (c PQInitialAccountConfiguration) validate(m chain.ConsensusMigrationState) error {
	if m.AccountPolicy == nil || m.AccountPolicy.Validate(m.AccountPolicy.NetworkID) != nil || c.Version != PQInitialAccountsVersion || c.NetworkID != m.OriginalGenesisHash || c.BirthFee != "0" || len(c.Accounts) == 0 || len(c.Accounts) > MaxPQWalletPolicyRecords {
		return errors.New("initial accounts require a finite pinned Genesis configuration and existing policy schedule")
	}
	network, err := canonicalBootstrapHash(c.NetworkID)
	if err != nil || !bytes.Equal(network, m.AccountPolicy.NetworkID) {
		return errors.New("initial accounts native genesis mismatch")
	}
	enable, err := strconv.ParseUint(c.EnableAt, 10, 64)
	if err != nil || enable == 0 || enable > math.MaxInt64 || strconv.FormatUint(enable, 10) != c.EnableAt || enable != m.AccountPolicy.EnableAt {
		return errors.New("initial accounts cannot rewrite the original policy admission height")
	}
	previous := ""
	for _, binding := range c.Accounts {
		if !accountaddress.IsCanonical(binding.Owner) || binding.Owner <= previous {
			return errors.New("initial account bindings must have unique sorted canonical owners")
		}
		previous = binding.Owner
		if _, ok := canonicalInitialKey(binding.PKA, ynxbatch.PublicKeyASize); !ok {
			return errors.New("initial account binding requires full canonical key A")
		}
		if _, ok := canonicalInitialKey(binding.PKB, ynxbatch.PublicKeyBSize); !ok {
			return errors.New("initial account binding requires full canonical key B")
		}
		if _, exists := accountIndex(m.Accounts, binding.Owner); exists {
			return errors.New("initial account binding cannot occupy an original account")
		}
		for _, record := range m.AccountPolicy.Records {
			if record.Owner == binding.Owner {
				return errors.New("initial account binding cannot replace an original policy owner")
			}
		}
		if m.Runtime != nil {
			if _, exists := m.Runtime.Contracts[binding.Owner]; exists {
				return errors.New("initial account binding cannot occupy an original contract")
			}
		}
	}
	return nil
}

// initialGenesisField rejects duplicates without interpreting any other Genesis
// value as authority. Old Genesis without this explicit field remains unchanged.
func initialGenesisField(raw []byte) (json.RawMessage, bool, error) {
	d := json.NewDecoder(bytes.NewReader(raw))
	start, err := d.Token()
	if err != nil || start != json.Delim('{') {
		return nil, false, errors.New("invalid Genesis object")
	}
	seen := map[string]bool{}
	duplicate := false
	var value json.RawMessage
	found := false
	for d.More() {
		token, err := d.Token()
		if err != nil {
			return nil, false, err
		}
		key, ok := token.(string)
		if !ok {
			return nil, false, errors.New("invalid Genesis field")
		}
		duplicate = duplicate || seen[key]
		seen[key] = true
		var field json.RawMessage
		if err := d.Decode(&field); err != nil {
			return nil, false, err
		}
		if key == PQInitialAccountsGenesisField {
			value, found = field, true
		}
	}
	if _, err := d.Token(); err != nil {
		return nil, false, err
	}
	if d.Decode(new(any)) != io.EOF || found && duplicate {
		return nil, false, errors.New("duplicate or trailing initial account Genesis fields")
	}
	return value, found, nil
}

func decodePQInitialAccountConfiguration(rawGenesis []byte, m chain.ConsensusMigrationState) (*PQInitialAccountConfiguration, error) {
	raw, found, err := initialGenesisField(rawGenesis)
	if err != nil || !found {
		return nil, err
	}
	var configuration PQInitialAccountConfiguration
	if len(raw) == 0 || len(raw) > maxPQInitialAccountsBytes || json.Unmarshal(raw, &configuration) != nil {
		return nil, errors.New("invalid bounded initial account Genesis configuration")
	}
	canonical, err := json.Marshal(configuration)
	var compact bytes.Buffer
	if err != nil || json.Compact(&compact, raw) != nil || !bytes.Equal(compact.Bytes(), canonical) {
		return nil, errors.New("initial account Genesis configuration requires exact canonical fields")
	}
	if err := configuration.validate(m); err != nil {
		return nil, err
	}
	return &configuration, nil
}

// EncodePQInitialAccountGenesis prepares candidate public bytes only. Its caller
// must independently approve/pin the resulting exact Genesis before use; this
// encoder neither chooses the assignments nor installs authority in an App.
func EncodePQInitialAccountGenesis(rawGenesis []byte, m chain.ConsensusMigrationState, configuration PQInitialAccountConfiguration) ([]byte, error) {
	if len(rawGenesis) == 0 || len(rawGenesis) > MaxCometGenesisBytes {
		return nil, errors.New("initial account Genesis exceeds existing input bound")
	}
	if _, found, err := initialGenesisField(rawGenesis); err != nil || found {
		return nil, errors.New("initial account Genesis candidate cannot replace an existing assignment")
	}
	if err := configuration.validate(m); err != nil {
		return nil, err
	}
	bindings, err := json.Marshal(configuration)
	if err != nil || len(bindings) > maxPQInitialAccountsBytes {
		return nil, errors.New("initial account configuration exceeds bound")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(rawGenesis, &fields); err != nil {
		return nil, err
	}
	fields[PQInitialAccountsGenesisField] = bindings
	raw, err := json.Marshal(fields)
	if err != nil || len(raw) > MaxCometGenesisBytes {
		return nil, errors.New("initial account Genesis exceeds existing input bound")
	}
	return raw, nil
}

func (b *ConsensusBootstrap) initialAccountRegistration(owner string, height uint64) (ynxbatch.Registration, error) {
	if b == nil || b.record.PQInitialAccounts == nil {
		return ynxbatch.Registration{}, errors.New("initial account requires independent Genesis binding")
	}
	configuration := b.record.PQInitialAccounts
	enable, _ := strconv.ParseUint(configuration.EnableAt, 10, 64)
	if height < enable || height < uint64(b.record.InitialHeight) {
		return ynxbatch.Registration{}, errors.New("initial account is before the trusted admission height")
	}
	for _, binding := range configuration.Accounts {
		if binding.Owner == owner {
			network, _ := hex.DecodeString(configuration.NetworkID)
			pa, _ := hex.DecodeString(binding.PKA)
			pb, _ := hex.DecodeString(binding.PKB)
			return ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, Owner: owner, Purpose: "TX-BATCH", PolicyRevision: "GENESIS:" + b.record.CometGenesisSHA256, ChainID: network, PKA: pa, PKB: pb, Enabled: true, ActiveFrom: enable}, nil
		}
	}
	return ynxbatch.Registration{}, errors.New("initial owner is absent from the pinned Genesis allowlist")
}
