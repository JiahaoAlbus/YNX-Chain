package chain

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	FaucetAddress    = "ynx_faucet"
	ValidatorAddress = "ynx_validator_0"
)

type Devnet struct {
	mu                   sync.RWMutex
	cfg                  NetworkConfig
	blocks               []Block
	pending              []Transaction
	accounts             map[string]*Account
	validators           []Validator
	lots                 map[string]TrustTraceLot
	payIntents           map[string]PayIntent
	invoices             map[string]Invoice
	refunds              map[string]RefundRecord
	riskLabels           map[string][]RiskLabel
	evidencePackets      map[string]EvidencePacket
	resourceRentals      map[string]ResourceRental
	contracts            map[string]ContractArtifact
	dataDir              string
	lastPersistenceError string
}

type devnetSnapshot struct {
	Version    int                         `json:"version"`
	SavedAt    time.Time                   `json:"savedAt"`
	Config     NetworkConfig               `json:"config"`
	Blocks     []Block                     `json:"blocks"`
	Pending    []Transaction               `json:"pending"`
	Accounts   map[string]*Account         `json:"accounts"`
	Validators []Validator                 `json:"validators"`
	Lots       map[string]TrustTraceLot    `json:"lots"`
	PayIntents map[string]PayIntent        `json:"payIntents"`
	Invoices   map[string]Invoice          `json:"invoices"`
	Refunds    map[string]RefundRecord     `json:"refunds"`
	RiskLabels map[string][]RiskLabel      `json:"riskLabels"`
	Evidence   map[string]EvidencePacket   `json:"evidencePackets"`
	Rentals    map[string]ResourceRental   `json:"resourceRentals"`
	Contracts  map[string]ContractArtifact `json:"contracts"`
}

func DefaultNetworkConfig(slug string) NetworkConfig {
	base := NetworkConfig{NativeCoinName: "YNXT", NativeCurrencySymbol: "YNXT", Decimals: 18, ChainIDConflictCheck: "chainid.network snapshot checked on 2026-07-01: 6420, 6423, 6425 not listed; repeat before mainnet launch"}
	switch strings.ToLower(slug) {
	case "mainnet":
		base.Name, base.Slug, base.ChainID, base.IsPublicNet = "YNX Mainnet", "mainnet", 6420, true
	case "testnet":
		base.Name, base.Slug, base.ChainID, base.IsPublicNet = "YNX Testnet", "testnet", 6423, true
	default:
		base.Name, base.Slug, base.ChainID, base.IsPublicNet = "YNX Devnet", "devnet", 6425, false
	}
	return base
}

func NewDevnet(cfg NetworkConfig) *Devnet {
	d := &Devnet{
		cfg:             cfg,
		accounts:        map[string]*Account{},
		lots:            map[string]TrustTraceLot{},
		payIntents:      map[string]PayIntent{},
		invoices:        map[string]Invoice{},
		refunds:         map[string]RefundRecord{},
		riskLabels:      map[string][]RiskLabel{},
		evidencePackets: map[string]EvidencePacket{},
		resourceRentals: map[string]ResourceRental{},
		contracts:       map[string]ContractArtifact{},
		validators:      []Validator{{Address: ValidatorAddress, VotingPower: 1, Active: true}},
	}
	d.accounts[FaucetAddress] = &Account{Address: FaucetAddress, Balance: 1_000_000_000, Lots: map[string]int64{}}
	d.accounts[ValidatorAddress] = &Account{Address: ValidatorAddress, Balance: 10_000_000, Staked: 10_000_000, Lots: map[string]int64{}}
	d.blocks = append(d.blocks, Block{
		Height: 0, Hash: hashParts("genesis", cfg.Slug, fmt.Sprint(cfg.ChainID)), Time: time.Now().UTC(), Validator: ValidatorAddress,
	})
	return d
}

func NewPersistentDevnet(cfg NetworkConfig, dataDir string) (*Devnet, error) {
	if strings.TrimSpace(dataDir) == "" {
		return NewDevnet(cfg), nil
	}
	d := NewDevnet(cfg)
	d.dataDir = dataDir
	if err := d.loadSnapshot(); err != nil {
		return nil, err
	}
	if err := d.persistSnapshot(); err != nil {
		return nil, err
	}
	return d, nil
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

func (d *Devnet) Config() NetworkConfig { d.mu.RLock(); defer d.mu.RUnlock(); return d.cfg }

func (d *Devnet) Status() map[string]any {
	d.mu.RLock()
	defer d.mu.RUnlock()
	latest := d.blocks[len(d.blocks)-1]
	return map[string]any{
		"network": d.cfg.Name, "slug": d.cfg.Slug, "chainId": d.cfg.ChainID,
		"nativeCoinName": d.cfg.NativeCoinName, "nativeCurrencySymbol": d.cfg.NativeCurrencySymbol,
		"decimals": d.cfg.Decimals, "publicNetwork": d.cfg.IsPublicNet,
		"height": latest.Height, "latestBlockHash": latest.Hash, "latestBlockTime": latest.Time,
		"validatorCount": len(d.validators), "pendingTxCount": len(d.pending),
		"persistence": d.dataDir != "", "persistenceError": d.lastPersistenceError,
		"truthfulStatus": "local-devnet", "mainnetReady": false,
		"chainIdConflictCheck": d.cfg.ChainIDConflictCheck,
	}
}

func (d *Devnet) ExplorerSummary() ExplorerSummary {
	d.mu.RLock()
	defer d.mu.RUnlock()
	latest := d.blocks[len(d.blocks)-1]
	totalTxs := len(d.pending)
	for _, block := range d.blocks {
		totalTxs += len(block.Transactions)
	}
	return ExplorerSummary{Network: d.cfg, Height: latest.Height, LatestBlockHash: latest.Hash, LatestBlockTime: latest.Time, TotalBlocks: len(d.blocks), TotalTransactions: totalTxs, KnownAccounts: len(d.accounts), ValidatorCount: len(d.validators), PendingTxCount: len(d.pending), PayIntentCount: len(d.payIntents), InvoiceCount: len(d.invoices), TrustEvidenceCount: len(d.evidencePackets), ContractCount: len(d.contracts), PersistenceEnabled: d.dataDir != "", PersistenceError: d.lastPersistenceError, TruthfulStatus: "local-devnet"}
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

func (d *Devnet) RecentTransactions(limit int) []Transaction {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	txs := make([]Transaction, 0, limit)
	for i := len(d.pending) - 1; i >= 0 && len(txs) < limit; i-- {
		txs = append(txs, d.pending[i])
	}
	for i := len(d.blocks) - 1; i >= 0 && len(txs) < limit; i-- {
		for j := len(d.blocks[i].Transactions) - 1; j >= 0 && len(txs) < limit; j-- {
			txs = append(txs, d.blocks[i].Transactions[j])
		}
	}
	return txs
}

func (d *Devnet) Account(address string) (Account, bool) {
	if address == "" {
		return Account{}, false
	}
	d.mu.RLock()
	defer d.mu.RUnlock()
	account, ok := d.accounts[address]
	if !ok {
		return Account{}, false
	}
	return copyAccount(account), true
}

func (d *Devnet) Validators() []Validator {
	d.mu.RLock()
	defer d.mu.RUnlock()
	out := make([]Validator, len(d.validators))
	copy(out, d.validators)
	return out
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
	account, faucet := d.account(address), d.account(FaucetAddress)
	if faucet.Balance < amount {
		return Transaction{}, errors.New("faucet balance exhausted")
	}
	lotID := hashParts("lot", address, fmt.Sprint(time.Now().UnixNano()), fmt.Sprint(amount))
	faucet.Balance -= amount
	account.Balance += amount
	account.Lots[lotID] += amount
	d.lots[lotID] = TrustTraceLot{LotID: lotID, Amount: amount, Origin: "devnet faucet mint", RiskWeight: 0}
	tx := d.newTxLocked("faucet", FaucetAddress, address, amount, 0, []LotFlow{{LotID: lotID, Amount: amount, From: FaucetAddress, To: address}}, "devnet faucet mint")
	d.pending = append(d.pending, tx)
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return tx, err
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
	sender, receiver := d.account(from), d.account(to)
	const fee int64 = 1
	if sender.Balance < amount+fee {
		return Transaction{}, errors.New("insufficient balance")
	}
	flows, err := d.moveLotsLocked(sender, receiver, amount)
	if err != nil {
		return Transaction{}, err
	}
	sender.Balance -= amount + fee
	sender.Nonce++
	sender.ResourceUsage.BandwidthUsed++
	receiver.Balance += amount
	d.account(ValidatorAddress).Balance += fee
	tx := d.newTxLocked("transfer", from, to, amount, fee, flows, "native transfer")
	d.pending = append(d.pending, tx)
	err = d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return tx, err
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
	account.ResourceUsage.ComputeUsed++
	tx := d.newTxLocked("stake", address, "ynx_staking", amount, 0, nil, "stake for resources and voting weight")
	d.pending = append(d.pending, tx)
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return tx, resourceBalance(account), err
}

func (d *Devnet) Resources(address string) (ResourceBalance, error) {
	if address == "" {
		return ResourceBalance{}, errors.New("address is required")
	}
	d.mu.RLock()
	defer d.mu.RUnlock()
	return resourceBalance(d.accountReadOnly(address)), nil
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
	return TrustTrace{Address: address, Lots: lots, Labels: labels, Summary: "Trace uses lot lineage and pro-rata movement for local devnet balances. It records explainable risk lineage and does not freeze funds."}, nil
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
	intent := PayIntent{ID: hashParts("pay", merchant, fmt.Sprint(amount), fmt.Sprint(time.Now().UnixNano()))[:24], Merchant: merchant, Amount: amount, Currency: d.cfg.NativeCurrencySymbol, Status: "created", CreatedAt: time.Now().UTC(), CallbackURL: callbackURL}
	d.payIntents[intent.ID] = intent
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return intent, err
}

func (d *Devnet) PayIntent(id string) (PayIntent, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	intent, ok := d.payIntents[id]
	return intent, ok
}

func (d *Devnet) CreateInvoice(intentID string, dueInHours int64) (Invoice, error) {
	if intentID == "" {
		return Invoice{}, errors.New("intentId is required")
	}
	if dueInHours <= 0 {
		dueInHours = 24
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	intent, ok := d.payIntents[intentID]
	if !ok {
		return Invoice{}, errors.New("payment intent not found")
	}
	invoice := Invoice{
		ID:        hashParts("invoice", intent.ID, fmt.Sprint(time.Now().UnixNano()))[:24],
		IntentID:  intent.ID,
		Merchant:  intent.Merchant,
		Amount:    intent.Amount,
		Currency:  intent.Currency,
		Status:    "issued",
		DueAt:     time.Now().UTC().Add(time.Duration(dueInHours) * time.Hour),
		CreatedAt: time.Now().UTC(),
	}
	invoice.PaymentLink = "/pay/checkout/" + invoice.ID
	d.invoices[invoice.ID] = invoice
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return invoice, err
}

func (d *Devnet) Invoice(id string) (Invoice, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	invoice, ok := d.invoices[id]
	return invoice, ok
}

func (d *Devnet) CreateRefund(intentID string, amount int64, reason string) (RefundRecord, error) {
	if intentID == "" {
		return RefundRecord{}, errors.New("intentId is required")
	}
	if amount <= 0 {
		return RefundRecord{}, errors.New("amount must be positive")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	intent, ok := d.payIntents[intentID]
	if !ok {
		return RefundRecord{}, errors.New("payment intent not found")
	}
	if amount > intent.Amount {
		return RefundRecord{}, errors.New("refund exceeds payment intent amount")
	}
	refund := RefundRecord{
		ID:        hashParts("refund", intentID, fmt.Sprint(amount), fmt.Sprint(time.Now().UnixNano()))[:24],
		IntentID:  intentID,
		Amount:    amount,
		Currency:  intent.Currency,
		Reason:    reason,
		Status:    "recorded",
		CreatedAt: time.Now().UTC(),
	}
	d.refunds[refund.ID] = refund
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return refund, err
}

func (d *Devnet) SignWebhook(intentID, eventType, signingKey string) (WebhookSignature, error) {
	if intentID == "" || eventType == "" || signingKey == "" {
		return WebhookSignature{}, errors.New("intentId, eventType, and signingKey are required")
	}
	d.mu.RLock()
	defer d.mu.RUnlock()
	if _, ok := d.payIntents[intentID]; !ok {
		return WebhookSignature{}, errors.New("payment intent not found")
	}
	signedAt := time.Now().UTC()
	eventID := hashParts("event", intentID, eventType, fmt.Sprint(signedAt.UnixNano()))[:24]
	payload := strings.Join([]string{eventID, intentID, eventType, signedAt.Format(time.RFC3339Nano)}, ".")
	mac := hmac.New(sha256.New, []byte(signingKey))
	_, _ = mac.Write([]byte(payload))
	return WebhookSignature{EventID: eventID, IntentID: intentID, Signature: hex.EncodeToString(mac.Sum(nil)), SignedAt: signedAt, Algorithm: "hmac-sha256"}, nil
}

func (d *Devnet) AddRiskLabel(subject, label string, riskWeightBps int64, source string) (RiskLabel, error) {
	if subject == "" || label == "" {
		return RiskLabel{}, errors.New("subject and label are required")
	}
	if riskWeightBps < 0 || riskWeightBps > 10000 {
		return RiskLabel{}, errors.New("riskWeightBps must be between 0 and 10000")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	risk := RiskLabel{Subject: subject, Label: label, RiskWeightBps: riskWeightBps, Source: source, CreatedAt: time.Now().UTC()}
	d.riskLabels[subject] = append(d.riskLabels[subject], risk)
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return risk, err
}

func (d *Devnet) EvidencePacket(subject string) (EvidencePacket, error) {
	if subject == "" {
		return EvidencePacket{}, errors.New("subject is required")
	}
	trace, err := d.TrustTrace(subject)
	if err != nil {
		return EvidencePacket{}, err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	related := make([]Transaction, 0)
	for _, block := range d.blocks {
		for _, tx := range block.Transactions {
			if tx.From == subject || tx.To == subject {
				related = append(related, tx)
			}
		}
	}
	for _, tx := range d.pending {
		if tx.From == subject || tx.To == subject {
			related = append(related, tx)
		}
	}
	labels := append([]RiskLabel(nil), d.riskLabels[subject]...)
	packet := EvidencePacket{
		ID:          hashParts("evidence", subject, fmt.Sprint(time.Now().UnixNano()))[:24],
		Subject:     subject,
		Trace:       trace,
		Labels:      labels,
		RelatedTxs:  related,
		GeneratedAt: time.Now().UTC(),
		ExportNotes: []string{"JSON evidence is generated from local devnet state.", "PDF export is a deterministic local evidence rendering for reviewer smoke tests."},
	}
	payload, _ := json.Marshal(packet)
	packet.JSONHash = hashParts("evidence-json", string(payload))
	d.evidencePackets[packet.ID] = packet
	err = d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return packet, err
}

func (d *Devnet) StoredEvidencePacket(id string) (EvidencePacket, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	packet, ok := d.evidencePackets[id]
	return packet, ok
}

func (d *Devnet) ResourceQuote(address string, bandwidth, compute, aiCredits, trustCredits int64) (ResourceQuote, error) {
	if address == "" {
		return ResourceQuote{}, errors.New("address is required")
	}
	if bandwidth < 0 || compute < 0 || aiCredits < 0 || trustCredits < 0 {
		return ResourceQuote{}, errors.New("resource amounts cannot be negative")
	}
	price := bandwidth/100 + compute/10 + aiCredits*2 + trustCredits*2
	if price <= 0 {
		price = 1
	}
	return ResourceQuote{
		ID:            hashParts("resource-quote", address, fmt.Sprint(bandwidth), fmt.Sprint(compute), fmt.Sprint(aiCredits), fmt.Sprint(trustCredits))[:24],
		Address:       address,
		Bandwidth:     bandwidth,
		Compute:       compute,
		AICredits:     aiCredits,
		TrustCredits:  trustCredits,
		PriceYNXT:     price,
		ExpiresAt:     time.Now().UTC().Add(15 * time.Minute),
		TruthfulNotes: []string{"Quote is computed from local devnet resource pricing.", "Public market pricing must be governed and configured before production use."},
	}, nil
}

func (d *Devnet) RentResources(address string, bandwidth, compute, aiCredits, trustCredits int64) (ResourceRental, ResourceBalance, error) {
	quote, err := d.ResourceQuote(address, bandwidth, compute, aiCredits, trustCredits)
	if err != nil {
		return ResourceRental{}, ResourceBalance{}, err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	account := d.account(address)
	if account.Balance < quote.PriceYNXT {
		return ResourceRental{}, ResourceBalance{}, errors.New("insufficient balance for resource rental")
	}
	account.Balance -= quote.PriceYNXT
	account.ResourceUsage.BandwidthUsed = maxInt64(0, account.ResourceUsage.BandwidthUsed-bandwidth)
	account.ResourceUsage.ComputeUsed = maxInt64(0, account.ResourceUsage.ComputeUsed-compute)
	account.ResourceUsage.AICreditsUsed = maxInt64(0, account.ResourceUsage.AICreditsUsed-aiCredits)
	account.ResourceUsage.TrustUsed = maxInt64(0, account.ResourceUsage.TrustUsed-trustCredits)
	rental := ResourceRental{
		ID:           hashParts("resource-rental", quote.ID, fmt.Sprint(time.Now().UnixNano()))[:24],
		QuoteID:      quote.ID,
		Address:      address,
		PriceYNXT:    quote.PriceYNXT,
		Status:       "active",
		CreatedAt:    time.Now().UTC(),
		Bandwidth:    bandwidth,
		Compute:      compute,
		AICredits:    aiCredits,
		TrustCredits: trustCredits,
	}
	d.resourceRentals[rental.ID] = rental
	err = d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return rental, resourceBalance(account), err
}

func (d *Devnet) DeployContract(deployer, name, source string) (ContractArtifact, Transaction, error) {
	if deployer == "" || name == "" || strings.TrimSpace(source) == "" {
		return ContractArtifact{}, Transaction{}, errors.New("deployer, name, and source are required")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	account := d.account(deployer)
	const fee int64 = 10
	if account.Balance < fee {
		return ContractArtifact{}, Transaction{}, errors.New("insufficient balance for contract deployment fee")
	}
	account.Balance -= fee
	account.Nonce++
	account.ResourceUsage.ComputeUsed += 5
	sourceHash := hashParts("source", source)
	artifact := ContractArtifact{
		Address:      "0x" + hashParts("contract", deployer, name, sourceHash, fmt.Sprint(time.Now().UnixNano()))[:40],
		Name:         name,
		Deployer:     deployer,
		SourceHash:   sourceHash,
		BytecodeHash: hashParts("bytecode", sourceHash),
		Verified:     false,
		DeployedAt:   time.Now().UTC(),
	}
	d.contracts[artifact.Address] = artifact
	tx := d.newTxLocked("contract_deploy", deployer, artifact.Address, 0, fee, nil, "local devnet contract deployment")
	d.pending = append(d.pending, tx)
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return artifact, tx, err
}

func (d *Devnet) VerifyContract(address, source string) (ContractArtifact, error) {
	if address == "" || strings.TrimSpace(source) == "" {
		return ContractArtifact{}, errors.New("address and source are required")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	artifact, ok := d.contracts[address]
	if !ok {
		return ContractArtifact{}, errors.New("contract not found")
	}
	if artifact.SourceHash != hashParts("source", source) {
		return ContractArtifact{}, errors.New("source hash does not match deployed contract")
	}
	verifiedAt := time.Now().UTC()
	artifact.Verified = true
	artifact.VerifiedAt = &verifiedAt
	d.contracts[address] = artifact
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return artifact, err
}

func (d *Devnet) Contract(address string) (ContractArtifact, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	artifact, ok := d.contracts[address]
	return artifact, ok
}

func (d *Devnet) ProduceBlock() Block {
	d.mu.Lock()
	defer d.mu.Unlock()
	parent := d.blocks[len(d.blocks)-1]
	txs := append([]Transaction(nil), d.pending...)
	d.pending = nil
	block := Block{Height: parent.Height + 1, Hash: hashParts("block", fmt.Sprint(parent.Height+1), parent.Hash, fmt.Sprint(time.Now().UnixNano()), fmt.Sprint(len(txs))), ParentHash: parent.Hash, Time: time.Now().UTC(), Validator: ValidatorAddress, Transactions: txs}
	for i := range block.Transactions {
		block.Transactions[i].BlockHash = block.Hash
		block.Transactions[i].BlockNum = block.Height
	}
	d.blocks = append(d.blocks, block)
	d.recordPersistenceErrorLocked(d.persistSnapshotLocked())
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

func copyAccount(account *Account) Account {
	copied := *account
	copied.Lots = make(map[string]int64, len(account.Lots))
	for lotID, amount := range account.Lots {
		copied.Lots[lotID] = amount
	}
	return copied
}

func (d *Devnet) snapshotPath() string {
	if d.dataDir == "" {
		return ""
	}
	return filepath.Join(d.dataDir, "devnet-state.json")
}

func (d *Devnet) loadSnapshot() error {
	path := d.snapshotPath()
	if path == "" {
		return nil
	}
	payload, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read devnet snapshot: %w", err)
	}
	var snapshot devnetSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		return fmt.Errorf("decode devnet snapshot: %w", err)
	}
	if snapshot.Version != 1 {
		return fmt.Errorf("unsupported devnet snapshot version %d", snapshot.Version)
	}
	if snapshot.Config.ChainID != d.cfg.ChainID {
		return fmt.Errorf("snapshot chain ID %d does not match configured chain ID %d", snapshot.Config.ChainID, d.cfg.ChainID)
	}
	if len(snapshot.Blocks) == 0 {
		return errors.New("devnet snapshot has no blocks")
	}
	d.blocks, d.pending, d.accounts, d.validators, d.lots, d.payIntents = snapshot.Blocks, snapshot.Pending, snapshot.Accounts, snapshot.Validators, snapshot.Lots, snapshot.PayIntents
	d.invoices, d.refunds, d.riskLabels, d.evidencePackets = snapshot.Invoices, snapshot.Refunds, snapshot.RiskLabels, snapshot.Evidence
	d.resourceRentals, d.contracts = snapshot.Rentals, snapshot.Contracts
	d.ensureStateDefaults()
	return nil
}

func (d *Devnet) persistSnapshot() error {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.persistSnapshotLocked()
}

func (d *Devnet) persistSnapshotLocked() error {
	path := d.snapshotPath()
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create devnet data dir: %w", err)
	}
	snapshot := devnetSnapshot{Version: 1, SavedAt: time.Now().UTC(), Config: d.cfg, Blocks: d.blocks, Pending: d.pending, Accounts: d.accounts, Validators: d.validators, Lots: d.lots, PayIntents: d.payIntents, Invoices: d.invoices, Refunds: d.refunds, RiskLabels: d.riskLabels, Evidence: d.evidencePackets, Rentals: d.resourceRentals, Contracts: d.contracts}
	payload, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return fmt.Errorf("encode devnet snapshot: %w", err)
	}
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, payload, 0o600); err != nil {
		return fmt.Errorf("write devnet snapshot: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("replace devnet snapshot: %w", err)
	}
	return nil
}

func (d *Devnet) ensureStateDefaults() {
	if d.accounts == nil {
		d.accounts = map[string]*Account{}
	}
	if d.lots == nil {
		d.lots = map[string]TrustTraceLot{}
	}
	if d.payIntents == nil {
		d.payIntents = map[string]PayIntent{}
	}
	if d.invoices == nil {
		d.invoices = map[string]Invoice{}
	}
	if d.refunds == nil {
		d.refunds = map[string]RefundRecord{}
	}
	if d.riskLabels == nil {
		d.riskLabels = map[string][]RiskLabel{}
	}
	if d.evidencePackets == nil {
		d.evidencePackets = map[string]EvidencePacket{}
	}
	if d.resourceRentals == nil {
		d.resourceRentals = map[string]ResourceRental{}
	}
	if d.contracts == nil {
		d.contracts = map[string]ContractArtifact{}
	}
	if len(d.validators) == 0 {
		d.validators = []Validator{{Address: ValidatorAddress, VotingPower: 1, Active: true}}
	}
	for _, account := range d.accounts {
		if account.Lots == nil {
			account.Lots = map[string]int64{}
		}
	}
}

func (d *Devnet) recordPersistenceErrorLocked(err error) {
	if err != nil {
		d.lastPersistenceError = err.Error()
		return
	}
	d.lastPersistenceError = ""
}

func (d *Devnet) newTxLocked(kind, from, to string, amount, fee int64, lots []LotFlow, memo string) Transaction {
	nonce := d.accountReadOnly(from).Nonce
	return Transaction{Hash: "0x" + hashParts("tx", kind, from, to, fmt.Sprint(amount), fmt.Sprint(nonce), fmt.Sprint(time.Now().UnixNano())), Type: kind, From: from, To: to, Amount: amount, Fee: fee, Nonce: nonce, Timestamp: time.Now().UTC(), LotFlows: lots, Memo: memo}
}

func (d *Devnet) moveLotsLocked(sender, receiver *Account, amount int64) ([]LotFlow, error) {
	remaining := amount
	flows := []LotFlow{}
	keys := make([]string, 0, len(sender.Lots))
	for lotID := range sender.Lots {
		keys = append(keys, lotID)
	}
	sort.Strings(keys)
	for _, lotID := range keys {
		if remaining == 0 {
			break
		}
		available := sender.Lots[lotID]
		if available <= 0 {
			continue
		}
		move := available
		if move > remaining {
			move = remaining
		}
		sender.Lots[lotID] -= move
		receiver.Lots[lotID] += move
		lot := d.lots[lotID]
		lot.LastInbound = receiver.Address
		d.lots[lotID] = lot
		flows = append(flows, LotFlow{LotID: lotID, Amount: move, From: sender.Address, To: receiver.Address})
		remaining -= move
	}
	if remaining != 0 {
		return nil, errors.New("insufficient traceable lot balance")
	}
	return flows, nil
}

func resourceBalance(account *Account) ResourceBalance {
	bandwidth := int64(1000) + account.Staked/10
	compute := int64(100) + account.Staked/100
	ai := int64(25) + account.Staked/1000
	trust := int64(25) + account.Staked/1000
	return ResourceBalance{Address: account.Address, BandwidthLimit: bandwidth, BandwidthUsed: account.ResourceUsage.BandwidthUsed, BandwidthLeft: maxInt64(0, bandwidth-account.ResourceUsage.BandwidthUsed), ComputeLimit: compute, ComputeUsed: account.ResourceUsage.ComputeUsed, ComputeLeft: maxInt64(0, compute-account.ResourceUsage.ComputeUsed), AICreditsLimit: ai, AICreditsUsed: account.ResourceUsage.AICreditsUsed, AICreditsLeft: maxInt64(0, ai-account.ResourceUsage.AICreditsUsed), TrustLimit: trust, TrustUsed: account.ResourceUsage.TrustUsed, TrustLeft: maxInt64(0, trust-account.ResourceUsage.TrustUsed), Staked: account.Staked}
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func hashParts(parts ...string) string {
	h := sha256.New()
	for _, part := range parts {
		_, _ = h.Write([]byte(part))
		_, _ = h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}
