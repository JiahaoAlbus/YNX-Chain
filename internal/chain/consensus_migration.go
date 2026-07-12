package chain

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
)

const ConsensusMigrationVersion = 1

const ConsensusPubKeyTypeEd25519 = "tendermint/PubKeyEd25519"

// ConsensusMigrationState is the deterministic application-state boundary used
// to move the current runtime into a BFT engine without hashing peer operations.
type ConsensusMigrationState struct {
	Version          int                  `json:"version"`
	SourceFormat     string               `json:"sourceFormat"`
	Network          NetworkConfig        `json:"network"`
	Height           uint64               `json:"height"`
	LastBlockHash    string               `json:"lastBlockHash"`
	Accounts         []ConsensusAccount   `json:"accounts"`
	Validators       []ConsensusValidator `json:"validators"`
	ResourcePolicy   ResourceMarketPolicy `json:"resourcePolicy"`
	LiquidSupplyYNXT int64                `json:"liquidSupplyYnxt"`
	StakedSupplyYNXT int64                `json:"stakedSupplyYnxt"`
	StateHash        string               `json:"stateHash"`
}

type ConsensusAccount struct {
	Address       string           `json:"address"`
	Balance       int64            `json:"balance"`
	Staked        int64            `json:"staked"`
	Nonce         uint64           `json:"nonce"`
	ResourceUsage ResourceUsage    `json:"resourceUsage"`
	Lots          map[string]int64 `json:"lots"`
}

type ConsensusValidator struct {
	Address          string `json:"address"`
	Moniker          string `json:"moniker"`
	VotingPower      int64  `json:"votingPower"`
	Active           bool   `json:"active"`
	ConsensusKeyType string `json:"consensusKeyType,omitempty"`
	ConsensusPubKey  string `json:"consensusPubKey,omitempty"`
	ConsensusAddress string `json:"consensusAddress,omitempty"`
}

type ConsensusValidatorKeyBinding struct {
	ValidatorAddress string `json:"validatorAddress"`
	KeyType          string `json:"keyType"`
	PublicKey        string `json:"publicKey"`
	ConsensusAddress string `json:"consensusAddress"`
}

func (d *Devnet) ExportConsensusMigrationState() (ConsensusMigrationState, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if len(d.blocks) == 0 {
		return ConsensusMigrationState{}, errors.New("cannot export consensus state without a committed block")
	}

	accounts := make([]ConsensusAccount, 0, len(d.accounts))
	var liquidSupply int64
	var stakedSupply int64
	for _, account := range d.accounts {
		if account == nil {
			return ConsensusMigrationState{}, errors.New("cannot export nil account")
		}
		lots := make(map[string]int64, len(account.Lots))
		for lotID, amount := range account.Lots {
			lots[lotID] = amount
		}
		accounts = append(accounts, ConsensusAccount{
			Address:       account.Address,
			Balance:       account.Balance,
			Staked:        account.Staked,
			Nonce:         account.Nonce,
			ResourceUsage: account.ResourceUsage,
			Lots:          lots,
		})
		liquidSupply += account.Balance
		stakedSupply += account.Staked
	}
	sort.Slice(accounts, func(i, j int) bool { return accounts[i].Address < accounts[j].Address })

	validators := make([]ConsensusValidator, 0, len(d.validators))
	for _, validator := range d.validators {
		validators = append(validators, ConsensusValidator{
			Address:     validator.Address,
			Moniker:     validator.Moniker,
			VotingPower: validator.VotingPower,
			Active:      validator.Active,
		})
	}
	sort.Slice(validators, func(i, j int) bool { return validators[i].Address < validators[j].Address })

	latest := d.blocks[len(d.blocks)-1]
	state := ConsensusMigrationState{
		Version:          ConsensusMigrationVersion,
		SourceFormat:     "ynx-devnet-state-v1",
		Network:          d.cfg,
		Height:           latest.Height,
		LastBlockHash:    latest.Hash,
		Accounts:         accounts,
		Validators:       validators,
		ResourcePolicy:   d.resourcePolicy,
		LiquidSupplyYNXT: liquidSupply,
		StakedSupplyYNXT: stakedSupply,
	}
	hash, err := state.calculateHash()
	if err != nil {
		return ConsensusMigrationState{}, err
	}
	state.StateHash = hash
	if err := state.Validate(); err != nil {
		return ConsensusMigrationState{}, fmt.Errorf("validate exported consensus state: %w", err)
	}
	return state, nil
}

func (s ConsensusMigrationState) Validate() error {
	if s.Version != ConsensusMigrationVersion {
		return fmt.Errorf("unsupported consensus migration version %d", s.Version)
	}
	if s.SourceFormat != "ynx-devnet-state-v1" {
		return fmt.Errorf("unsupported consensus source format %q", s.SourceFormat)
	}
	if s.Network.ChainID <= 0 || strings.TrimSpace(s.Network.Slug) == "" {
		return errors.New("consensus migration network identity is incomplete")
	}
	if s.Network.NativeCurrencySymbol != "YNXT" {
		return fmt.Errorf("consensus migration native symbol must be YNXT, got %q", s.Network.NativeCurrencySymbol)
	}
	if s.Height == 0 || strings.TrimSpace(s.LastBlockHash) == "" {
		return errors.New("consensus migration requires a non-genesis committed block")
	}
	if len(s.Accounts) == 0 {
		return errors.New("consensus migration requires accounts")
	}
	if len(s.Validators) == 0 {
		return errors.New("consensus migration requires validators")
	}

	var liquidSupply int64
	var stakedSupply int64
	previousAddress := ""
	for _, account := range s.Accounts {
		if strings.TrimSpace(account.Address) == "" {
			return errors.New("consensus migration account address is required")
		}
		if previousAddress != "" && account.Address <= previousAddress {
			return errors.New("consensus migration accounts must be unique and sorted by address")
		}
		if account.Balance < 0 || account.Staked < 0 {
			return fmt.Errorf("consensus migration account %s has a negative YNXT amount", account.Address)
		}
		if account.ResourceUsage.BandwidthUsed < 0 || account.ResourceUsage.ComputeUsed < 0 || account.ResourceUsage.AICreditsUsed < 0 || account.ResourceUsage.TrustUsed < 0 || account.ResourceUsage.PayCreditsUsed < 0 {
			return fmt.Errorf("consensus migration account %s has negative resource usage", account.Address)
		}
		for lotID, amount := range account.Lots {
			if strings.TrimSpace(lotID) == "" || amount < 0 {
				return fmt.Errorf("consensus migration account %s has invalid lot state", account.Address)
			}
		}
		previousAddress = account.Address
		if account.Balance > math.MaxInt64-liquidSupply || account.Staked > math.MaxInt64-stakedSupply {
			return errors.New("consensus migration YNXT supply totals overflow int64")
		}
		liquidSupply += account.Balance
		stakedSupply += account.Staked
	}
	if liquidSupply != s.LiquidSupplyYNXT || stakedSupply != s.StakedSupplyYNXT {
		return fmt.Errorf("consensus migration YNXT supply totals do not match accounts")
	}

	previousAddress = ""
	activeVotingPower := int64(0)
	for _, validator := range s.Validators {
		if strings.TrimSpace(validator.Address) == "" || strings.TrimSpace(validator.Moniker) == "" {
			return errors.New("consensus migration validator identity is incomplete")
		}
		if previousAddress != "" && validator.Address <= previousAddress {
			return errors.New("consensus migration validators must be unique and sorted by address")
		}
		if validator.VotingPower <= 0 {
			return fmt.Errorf("consensus migration validator %s has non-positive voting power", validator.Address)
		}
		if validator.Active {
			if activeVotingPower > math.MaxInt64-validator.VotingPower {
				return errors.New("consensus migration active voting power overflows int64")
			}
			activeVotingPower += validator.VotingPower
		}
		if err := validateConsensusValidatorKey(validator); err != nil {
			return fmt.Errorf("consensus migration validator %s: %w", validator.Address, err)
		}
		previousAddress = validator.Address
	}
	if activeVotingPower == 0 {
		return errors.New("consensus migration requires active validator voting power")
	}
	if err := s.ResourcePolicy.Validate(); err != nil {
		return fmt.Errorf("consensus migration resource policy: %w", err)
	}
	expectedHash, err := s.calculateHash()
	if err != nil {
		return err
	}
	if !strings.EqualFold(s.StateHash, expectedHash) {
		return fmt.Errorf("consensus migration state hash mismatch: expected %s", expectedHash)
	}
	return nil
}

func (s ConsensusMigrationState) BindConsensusValidatorKeys(bindings []ConsensusValidatorKeyBinding) (ConsensusMigrationState, error) {
	if err := s.Validate(); err != nil {
		return ConsensusMigrationState{}, err
	}
	s.Validators = append([]ConsensusValidator(nil), s.Validators...)
	if len(bindings) != len(s.Validators) {
		return ConsensusMigrationState{}, fmt.Errorf("consensus key bindings %d must match validators %d", len(bindings), len(s.Validators))
	}
	byAddress := make(map[string]ConsensusValidatorKeyBinding, len(bindings))
	for _, binding := range bindings {
		binding.ValidatorAddress = strings.TrimSpace(binding.ValidatorAddress)
		binding.KeyType = strings.TrimSpace(binding.KeyType)
		binding.PublicKey = strings.TrimSpace(binding.PublicKey)
		binding.ConsensusAddress = strings.TrimSpace(binding.ConsensusAddress)
		if binding.ValidatorAddress == "" {
			return ConsensusMigrationState{}, errors.New("consensus key binding validator address is required")
		}
		if _, exists := byAddress[binding.ValidatorAddress]; exists {
			return ConsensusMigrationState{}, fmt.Errorf("duplicate consensus key binding for %s", binding.ValidatorAddress)
		}
		byAddress[binding.ValidatorAddress] = binding
	}
	for index, validator := range s.Validators {
		binding, ok := byAddress[validator.Address]
		if !ok {
			return ConsensusMigrationState{}, fmt.Errorf("missing consensus key binding for %s", validator.Address)
		}
		validator.ConsensusKeyType = binding.KeyType
		validator.ConsensusPubKey = binding.PublicKey
		validator.ConsensusAddress = binding.ConsensusAddress
		if err := validateConsensusValidatorKey(validator); err != nil {
			return ConsensusMigrationState{}, fmt.Errorf("bind consensus key for %s: %w", validator.Address, err)
		}
		s.Validators[index] = validator
	}
	hash, err := s.calculateHash()
	if err != nil {
		return ConsensusMigrationState{}, err
	}
	s.StateHash = hash
	if err := s.ValidateConsensusValidatorKeys(); err != nil {
		return ConsensusMigrationState{}, err
	}
	return s, nil
}

func (s ConsensusMigrationState) ValidateConsensusValidatorKeys() error {
	if err := s.Validate(); err != nil {
		return err
	}
	for _, validator := range s.Validators {
		if validator.ConsensusKeyType == "" || validator.ConsensusPubKey == "" || validator.ConsensusAddress == "" {
			return fmt.Errorf("consensus validator %s is not bound to a public key", validator.Address)
		}
	}
	return nil
}

func validateConsensusValidatorKey(validator ConsensusValidator) error {
	fields := []string{validator.ConsensusKeyType, validator.ConsensusPubKey, validator.ConsensusAddress}
	nonEmpty := 0
	for _, field := range fields {
		if strings.TrimSpace(field) != "" {
			nonEmpty++
		}
	}
	if nonEmpty == 0 {
		return nil
	}
	if nonEmpty != len(fields) {
		return errors.New("consensus key type, public key, and address must be provided together")
	}
	if validator.ConsensusKeyType != ConsensusPubKeyTypeEd25519 {
		return fmt.Errorf("unsupported consensus key type %q", validator.ConsensusKeyType)
	}
	publicKey, err := base64.StdEncoding.DecodeString(validator.ConsensusPubKey)
	if err != nil || len(publicKey) != 32 || base64.StdEncoding.EncodeToString(publicKey) != validator.ConsensusPubKey {
		return errors.New("consensus public key must be canonical base64 for 32-byte ed25519")
	}
	sum := sha256.Sum256(publicKey)
	expectedAddress := strings.ToUpper(hex.EncodeToString(sum[:20]))
	if validator.ConsensusAddress != expectedAddress {
		return fmt.Errorf("consensus address %q does not match public key address %q", validator.ConsensusAddress, expectedAddress)
	}
	return nil
}

func (s ConsensusMigrationState) CanonicalJSON() ([]byte, error) {
	if err := s.Validate(); err != nil {
		return nil, err
	}
	return json.MarshalIndent(s, "", "  ")
}

func (s ConsensusMigrationState) calculateHash() (string, error) {
	s.StateHash = ""
	payload, err := json.Marshal(s)
	if err != nil {
		return "", fmt.Errorf("encode consensus migration state: %w", err)
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}
