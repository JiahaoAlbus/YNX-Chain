package chain

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	faucetAddress    = "ynx_faucet"
	validatorAddress = "ynx_validator_0"
)

type Devnet struct {
	mu         sync.RWMutex
	cfg        NetworkConfig
	blocks     []Block
	pending    []Transaction
	accounts   map[string]*Account
	validators []Validator
	lots       map[string]TrustTraceLot
	payIntents map[string]PayIntent
}

func DefaultNetworkConfig(slug string) NetworkConfig {
	switch strings.ToLower(slug) {
	case "mainnet":
		return NetworkConfig{Name: "YNX Mainnet", Slug: "mainnet", ChainID: 6420, Currency: "YNX", IsPublicNet: true}
	case "testnet":
		return NetworkConfig{Name: "YNX Testnet", Slug: "testnet", ChainID: 6423, Currency: "YNX", IsPublicNet: true}
	default:
		return NetworkConfig{Name: "YNX Devnet", Slug: "devnet", ChainID: 6425, Currency: "YNX", IsPublicNet: false}
	}
}

func NewDevnet(cfg NetworkConfig) *Devnet {
	d := &Devnet{
		cfg:        cfg,
		accounts:   map[string]*Account{},
		lots:       map[string]TrustTraceLot{},
		payIntents: map[string]PayIntent{},
		validators: []Validator{{Address: validatorAddress, VotingPower: 1, Active: true}},
	}
	d.accounts[faucetAddress] = &Account{Address: faucetAddress, Balance: 1_000_000_000, Lots: map[string]int64{}}
	d.accounts[validatorAddress] = &Account{Address: validatorAddress, Balance: 10_000_000, Staked: 10_000_000, Lots: map[string]int64{}}
	genesis := Block{
		Height:       0,
		Hash:         hashParts("genesis", cfg.Slug, fmt.Sprint(cfg.ChainID)),
		ParentHash:   "",
		Time:         time.Now().UTC(),
		Validator:    validatorAddress,
		Transactions: nil,
	}
	d.blocks = append(d.blocks, genesis)
	return d
}

func (d *Devnet) Start(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 2 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			d.ProduceBlock()
		}
	}
}

func (d *Devnet) Config() NetworkConfig {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.cfg
}

func (d *Devnet) Status() map[string]any {
	d.mu.RLock()
	defer d.mu.RUnlock()
	latest := d.blocks[len(d.blocks)-1]
	return map[string]any{
		"network":         d.cfg.Name,
		"slug":            d.cfg.Slug,
		"chainId":         d.cfg.ChainID,
		"currency":        d.cfg.Currency,
		"publicNetwork":   d.cfg.IsPublicNet,
		"height":          latest.Height,
		"latestBlockHash": latest.Hash,
		"latestBlockTime": latest.Time,
		"validatorCount":  len(d.validators),
		"pendingTxCount":  len(d.pending),
		"truthfulStatus":  "local-devnet",
	}
}

func (d *Devnet) LatestBlock() Block {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.blocks[len(d.blocks)-1]
}

func (d *Devnet) BlockByHeight(height uint64) (Block, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if height >= uint64(len(d.blocks)) {
		return Block{}, false
	}
	return d.blocks[height], true
}

func (d *Devnet) Transaction(hash string) (Transaction, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	for _, block := range d.blocks {
		for _, tx := range block.Transactions {
			if tx.Hash == hash {
				return tx, true
			}
		}
	}
	for _, tx := range d.pending {
		if tx.Hash == hash {
			return tx, true
		}
	}
	return Transaction{}, false
}

func (d *Devnet) Faucet(address string, amount int64) (Transaction, error) {
	if amount <= 0 {
		return Transaction{}, errors.New("amount must be positive")
	}
	if address == "" {
		return Transaction{}, errors.New("address is required")
	}
	d.mu.Lock()
	defer d.mu.Unlock()

	account := d.account(address)
	faucet := d.account(faucetAddress)
	if faucet.Balance < amount {
		return Transaction{}, errors.New("faucet balance exhausted")
	}
	lotID := hashParts("lot", address, fmt.Sprint(time.Now().UnixNano()), fmt.Sprint(amount))
	faucet.Balance -= amount
	account.Balance += amount
	account.Lots[lotID] += amount
	d.lots[lotID] = TrustTraceLot{
		LotID:      lotID,
		Amount:     amount,
		Origin:     "devnet faucet mint",
		RiskWeight: 0,
	}
	tx := d.newTxLocked("faucet", faucetAddress, address, amount, 0, []LotFlow{{LotID: lotID, Amount: amount, From: faucetAddress, To: address}}, "devnet faucet mint")
	d.pending = append(d.pending, tx)
	return tx, nil
}

func (d *Devnet) Transfer(from, to string, amount int64) (Transaction, error) {
	if from == "" || to == "" {
		return Transaction{}, errors.New("from and to are required")
	}
	if amount <= 0 {
		return Transaction{}, errors.New("amount must be positive")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	sender := d.account(from)
	receiver := d.account(to)
	const fee int64 = 1
	total := amount + fee
	if sender.Balance < total {
		return Transaction{}, errors.New("insufficient balance")
	}
	flows, err := d.moveLotsLocked(sender, receiver, amount)
	if err != nil {
		return Transaction{}, err
	}
	sender.Balance -= total
	sender.Nonce++
	sender.ResourceUsage.BandwidthUsed += 1
	receiver.Balance += amount
	validator := d.account(validatorAddress)
	validator.Balance += fee
	tx := d.newTxLocked("transfer", from, to, amount, fee, flows, "native transfer")
	d.pending = append(d.pending, tx)
	return tx, nil
}

func (d *Devnet) Stake(address string, amount int64) (Transaction, ResourceBalance, error) {
	if address == "" {
		return Transaction{}, ResourceBalance{}, errors.New("address is required")
	}
	if amount <= 0 {
		return Transaction{}, ResourceBalance{}, errors.New("amount must be positive")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	account := d.account(address)
	if account.Balance < amount {
		return Transaction{}, ResourceBalance{}, errors.New("insufficient balance")
	}
	account.Balance -= amount
	account.Staked += amount
	account.ResourceUsage.ComputeUsed += 1
	tx := d.newTxLocked("stake", address, "ynx_staking", amount, 0, nil, "stake for resources and voting weight")
	d.pending = append(d.pending, tx)
	return tx, resourceBalance(account), nil
}

func (d *Devnet) Resources(address string) (ResourceBalance, error) {
	if address == "" {
		return ResourceBalance{}, errors.New("address is required")
	}
	d.mu.RLock()
	defer d.mu.RUnlock()
	account := d.accountReadOnly(address)
	return resourceBalance(account), nil
}

func (d *Devnet) TrustTrace(address string) (TrustTrace, error) {
	if address == "" {
		return TrustTrace{}, errors.New("address is required")
	}
	d.mu.RLock()
	defer d.mu.RUnlock()
	account := d.accountReadOnly(address)
	lots := make([]TrustTraceLot, 0, len(account.Lots))
	for lotID, amount := range account.Lots {
		if amount <= 0 {
			continue
		}
		lot := d.lots[lotID]
		lot.Amount = amount
		lots = append(lots, lot)
	}
	sort.Slice(lots, func(i, j int) bool { return lots[i].LotID < lots[j].LotID })
	labels := []string{"devnet-only", "pro-rata-lot-lineage"}
	if len(lots) == 0 {
		labels = append(labels, "no-known-lots")
	}
	return TrustTrace{
		Address: address,
		Lots:    lots,
		Labels:  labels,
		Summary: "Trace uses lot lineage and pro-rata movement for local devnet balances. It does not freeze or restrict funds.",
	}, nil
}

func (d *Devnet) CreatePayIntent(merchant string, amount int64, callbackURL string) (PayIntent, error) {
	if merchant == "" {
		return PayIntent{}, errors.New("merchant is required")
	}
	if amount <= 0 {
		return PayIntent{}, errors.New("amount must be positive")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	intent := PayIntent{
		ID:          hashParts("pay", merchant, fmt.Sprint(amount), fmt.Sprint(time.Now().UnixNano()))[:24],
		Merchant:    merchant,
		Amount:      amount,
		Currency:    d.cfg.Currency,
		Status:      "created",
		CreatedAt:   time.Now().UTC(),
		CallbackURL: callbackURL,
	}
	d.payIntents[intent.ID] = intent
	return intent, nil
}

func (d *Devnet) ProduceBlock() Block {
	d.mu.Lock()
	defer d.mu.Unlock()
	parent := d.blocks[len(d.blocks)-1]
	height := parent.Height + 1
	txs := append([]Transaction(nil), d.pending...)
	d.pending = nil
	block := Block{
		Height:       height,
		Hash:         hashParts("block", fmt.Sprint(height), parent.Hash, fmt.Sprint(time.Now().UnixNano()), fmt.Sprint(len(txs))),
		ParentHash:   parent.Hash,
		Time:         time.Now().UTC(),
		Validator:    validatorAddress,
		Transactions: txs,
	}
	d.blocks = append(d.blocks, block)
	return block
}

func (d *Devnet) account(address string) *Account {
	account, ok := d.accounts[address]
	if !ok {
		account = &Account{Address: address, Lots: map[string]int64{}}
		d.accounts[address] = account
	}
	return account
}

func (d *Devnet) accountReadOnly(address string) *Account {
	account, ok := d.accounts[address]
	if !ok {
		return &Account{Address: address, Lots: map[string]int64{}}
	}
	return account
}

func (d *Devnet) newTxLocked(txType, from, to string, amount, fee int64, flows []LotFlow, memo string) Transaction {
	nonce := d.accounts[from].Nonce
	timestamp := time.Now().UTC()
	hash := hashParts(txType, from, to, fmt.Sprint(amount), fmt.Sprint(fee), fmt.Sprint(nonce), fmt.Sprint(timestamp.UnixNano()))
	return Transaction{Hash: hash, Type: txType, From: from, To: to, Amount: amount, Fee: fee, Nonce: nonce, Timestamp: timestamp, LotFlows: flows, Memo: memo}
}

func (d *Devnet) moveLotsLocked(sender, receiver *Account, amount int64) ([]LotFlow, error) {
	remaining := amount
	lotIDs := make([]string, 0, len(sender.Lots))
	for lotID, lotAmount := range sender.Lots {
		if lotAmount > 0 {
			lotIDs = append(lotIDs, lotID)
		}
	}
	sort.Strings(lotIDs)
	flows := make([]LotFlow, 0, len(lotIDs))
	for _, lotID := range lotIDs {
		if remaining == 0 {
			break
		}
		available := sender.Lots[lotID]
		move := available
		if move > remaining {
			move = remaining
		}
		sender.Lots[lotID] -= move
		receiver.Lots[lotID] += move
		remaining -= move
		flows = append(flows, LotFlow{LotID: lotID, Amount: move, From: sender.Address, To: receiver.Address})
	}
	if remaining != 0 {
		return nil, errors.New("insufficient traceable lot balance")
	}
	return flows, nil
}

func resourceBalance(account *Account) ResourceBalance {
	bandwidth := int64(1000) + account.Staked*10
	compute := int64(100) + account.Staked*2
	aiCredits := int64(20) + account.Staked/10
	trust := int64(10) + account.Staked/20
	return ResourceBalance{
		Address:        account.Address,
		BandwidthLimit: bandwidth,
		BandwidthUsed:  account.ResourceUsage.BandwidthUsed,
		BandwidthLeft:  maxInt64(0, bandwidth-account.ResourceUsage.BandwidthUsed),
		ComputeLimit:   compute,
		ComputeUsed:    account.ResourceUsage.ComputeUsed,
		ComputeLeft:    maxInt64(0, compute-account.ResourceUsage.ComputeUsed),
		AICreditsLimit: aiCredits,
		AICreditsUsed:  account.ResourceUsage.AICreditsUsed,
		AICreditsLeft:  maxInt64(0, aiCredits-account.ResourceUsage.AICreditsUsed),
		TrustLimit:     trust,
		TrustUsed:      account.ResourceUsage.TrustUsed,
		TrustLeft:      maxInt64(0, trust-account.ResourceUsage.TrustUsed),
		Staked:         account.Staked,
	}
}

func hashParts(parts ...string) string {
	h := sha256.New()
	for _, part := range parts {
		h.Write([]byte(part))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
