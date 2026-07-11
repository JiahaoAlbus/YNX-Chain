package chain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
)

const ConsensusMigrationVersion = 1

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
	Address     string `json:"address"`
	Moniker     string `json:"moniker"`
	VotingPower int64  `json:"votingPower"`
	Active      bool   `json:"active"`
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
		if account.ResourceUsage.BandwidthUsed < 0 || account.ResourceUsage.ComputeUsed < 0 || account.ResourceUsage.AICreditsUsed < 0 || account.ResourceUsage.TrustUsed < 0 {
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
			activeVotingPower += validator.VotingPower
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
