package chain

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	FaucetAddress            = "ynx_faucet"
	ValidatorAddress         = "ynx_validator_0"
	ProtocolResourceProvider = "ynx_protocol_resource_pool"
	ProtocolResourceTreasury = "ynx_protocol_resource_treasury"
	resourceProviderShareBps = 8000
	resourceProtocolShareBps = 2000
)

var requestValidityRules = []RequestValidityRule{
	{ID: "protect-private-secrets", Name: "Protect private secrets", Classification: RequestIllegalOrAbusive, Description: "Requests for private keys, seed phrases, or mnemonics are illegal or abusive under YNX Chain Law.", RequiresUserNotice: true, Keywords: []string{"private key", "seed phrase", "mnemonic"}},
	{ID: "no-signature-bypass", Name: "No signature bypass", Classification: RequestIllegalOrAbusive, Description: "Requests cannot bypass user signatures or custody authorization.", RequiresUserNotice: true, Keywords: []string{"bypass signature", "without signature", "skip signature"}},
	{ID: "preserve-audit-transparency", Name: "Preserve audit transparency", Classification: RequestIllegalOrAbusive, Description: "Requests cannot delete audit logs, hide records, or erase transparency evidence.", RequiresUserNotice: true, Keywords: []string{"delete audit", "delete logs", "hide record", "remove transparency"}},
	{ID: "no-evidence-free-risk", Name: "No evidence-free risk conclusions", Classification: RequestIllegalOrAbusive, Description: "Requests cannot fabricate risk labels or unsupported Trust conclusions.", RequiresUserNotice: true, Keywords: []string{"fake risk", "fabricate risk", "unsupported conclusion"}},
	{ID: "no-ai-punishment", Name: "No AI punishment", Classification: RequestIllegalOrAbusive, Description: "AI or Trust systems cannot automatically punish users.", RequiresUserNotice: true, Keywords: []string{"ai automatically punish", "auto punish", "automatic punish", "automatically punish"}},
	{ID: "targeted-scope-required", Name: "Targeted scope required", Classification: RequestOverbroad, Description: "Requests must be targeted to a specific subject and evidence set, not all users or all wallets.", RequiresEvidence: true, RequiresUserNotice: true, Keywords: []string{"all users", "all wallets", "entire chain", "bulk trace", "mass tracking", "everyone"}},
	{ID: "native-ynxt-no-direct-freeze", Name: "Native YNXT no direct freeze", Classification: RequestIllegalOrAbusive, Description: "Native YNXT cannot be directly transferred, frozen, seized, confiscated, or blacklisted by request.", RequiresUserNotice: true, Keywords: []string{"direct transfer", "transfer user", "confiscate", "seize", "freeze", "blacklist"}},
	{ID: "evidence-required", Name: "Evidence required", Classification: RequestInsufficientEvidence, Description: "Requests need evidence references before review or action.", RequiresEvidence: true, RequiresUserNotice: true},
	{ID: "governance-review-user-rights", Name: "Governance review for user rights", Classification: RequestRequiresReview, Description: "Requests affecting user rights require governance review and user notice.", RequiresEvidence: true, RequiresUserNotice: true, Keywords: []string{"freeze", "blacklist", "seize", "punish", "risk label", "risk-label", "track", "trace"}},
	{ID: "requester-subject-required", Name: "Requester and subject required", Classification: RequestOutOfScope, Description: "Requester and subject are required for a request to be in scope.", RequiresUserNotice: true},
	{ID: "scoped-evidence-backed-valid", Name: "Scoped evidence-backed valid request", Classification: RequestValidUnderYNXChainLaw, Description: "Request is scoped, evidence-backed, and does not bypass custody or transparency.", RequiresEvidence: true},
	{ID: "tracking-evidence-required", Name: "Tracking evidence required", Classification: RequestInsufficientEvidence, Description: "Tracking policy reviews need evidence references.", RequiresEvidence: true},
	{ID: "tracking-minimum-necessary", Name: "Tracking minimum necessary", Classification: RequestOverbroad, Description: "Tracking policy reviews must use minimum necessary data.", RequiresEvidence: true, RequiresUserNotice: true},
	{ID: "tracking-no-bulk-profiling", Name: "No bulk profiling", Classification: RequestOverbroad, Description: "Tracking cannot profile all users, all wallets, or everyone in bulk.", RequiresEvidence: true, RequiresUserNotice: true},
	{ID: "tracking-no-unsupported-conclusions", Name: "No unsupported tracking conclusions", Classification: RequestIllegalOrAbusive, Description: "Tracking cannot infer guilt, permanent taint, sensitive personal facts, or bypass audit.", RequiresEvidence: true, RequiresUserNotice: true},
	{ID: "tracking-low-confidence-not-punitive", Name: "Low confidence is not punitive", Classification: RequestIllegalOrAbusive, Description: "Low-confidence taint cannot be used as a punitive or conclusive action.", RequiresEvidence: true, RequiresUserNotice: true},
	{ID: "tracking-institutional-review", Name: "Institutional tracking review", Classification: RequestRequiresReview, Description: "Institutional, sensitive, watchlist, or batch tracking requires audit and governance review.", RequiresEvidence: true, RequiresUserNotice: true},
	{ID: "tracking-purpose-limited-valid", Name: "Purpose-limited valid tracking", Classification: RequestValidUnderYNXChainLaw, Description: "Tracking request is purpose-limited, evidence-backed, scoped, and appealable.", RequiresEvidence: true},
}

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
	webhookSignatures    map[string]WebhookSignature
	payEvents            map[string]PayEvent
	riskLabels           map[string][]RiskLabel
	evidencePackets      map[string]EvidencePacket
	governanceRequests   map[string]GovernanceRequest
	trustAppeals         map[string]TrustAppeal
	trackingReviews      map[string]TrackingPolicyReview
	aiPermissions        map[string]AIPermissionGrant
	aiActions            map[string]AIActionProposal
	transparencyEntries  map[string]TransparencyEntry
	resourceDelegations  map[string]ResourceDelegation
	resourceRentals      map[string]ResourceRental
	resourceIncome       map[string]ResourceIncomeRecord
	contracts            map[string]ContractArtifact
	dataDir              string
	lastPersistenceError string
}

func DefaultValidators() []Validator {
	return []Validator{{Address: ValidatorAddress, Moniker: "ynx-local-validator-0", VotingPower: 1, Active: true}}
}

func ParseValidatorSet(raw string) ([]Validator, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var validators []Validator
	if strings.HasPrefix(raw, "[") {
		if err := json.Unmarshal([]byte(raw), &validators); err != nil {
			return nil, fmt.Errorf("parse YNX_VALIDATOR_SET JSON: %w", err)
		}
	} else {
		for _, item := range strings.Split(raw, ";") {
			item = strings.TrimSpace(item)
			if item == "" {
				continue
			}
			parts := strings.Split(item, "|")
			if len(parts) < 2 {
				return nil, fmt.Errorf("validator entry %q must use address|moniker|host|role|peerId", item)
			}
			validator := Validator{Address: strings.TrimSpace(parts[0]), Moniker: strings.TrimSpace(parts[1]), VotingPower: 1, Active: true}
			if len(parts) > 2 {
				validator.Host = strings.TrimSpace(parts[2])
			}
			if len(parts) > 3 {
				validator.Role = strings.TrimSpace(parts[3])
			}
			if len(parts) > 4 {
				validator.PeerID = strings.TrimSpace(parts[4])
			}
			validators = append(validators, validator)
		}
	}
	return NormalizeValidators(validators)
}

func NormalizeValidators(validators []Validator) ([]Validator, error) {
	if len(validators) == 0 {
		return nil, nil
	}
	out := make([]Validator, 0, len(validators))
	seen := map[string]struct{}{}
	for i, validator := range validators {
		validator.Address = strings.TrimSpace(validator.Address)
		validator.Moniker = strings.TrimSpace(validator.Moniker)
		validator.Host = strings.TrimSpace(validator.Host)
		validator.Role = strings.TrimSpace(validator.Role)
		validator.PeerID = strings.TrimSpace(validator.PeerID)
		if validator.Address == "" {
			return nil, fmt.Errorf("validator %d address is required", i)
		}
		if validator.Moniker == "" {
			return nil, fmt.Errorf("validator %s moniker is required", validator.Address)
		}
		if _, ok := seen[validator.Address]; ok {
			return nil, fmt.Errorf("duplicate validator address %s", validator.Address)
		}
		seen[validator.Address] = struct{}{}
		if validator.VotingPower <= 0 {
			validator.VotingPower = 1
		}
		out = append(out, validator)
	}
	return out, nil
}

type devnetSnapshot struct {
	Version    int                             `json:"version"`
	SavedAt    time.Time                       `json:"savedAt"`
	Config     NetworkConfig                   `json:"config"`
	Blocks     []Block                         `json:"blocks"`
	Pending    []Transaction                   `json:"pending"`
	Accounts   map[string]*Account             `json:"accounts"`
	Validators []Validator                     `json:"validators"`
	Lots       map[string]TrustTraceLot        `json:"lots"`
	PayIntents map[string]PayIntent            `json:"payIntents"`
	Invoices   map[string]Invoice              `json:"invoices"`
	Refunds    map[string]RefundRecord         `json:"refunds"`
	Webhooks   map[string]WebhookSignature     `json:"webhookSignatures"`
	PayEvents  map[string]PayEvent             `json:"payEvents"`
	RiskLabels map[string][]RiskLabel          `json:"riskLabels"`
	Evidence   map[string]EvidencePacket       `json:"evidencePackets"`
	Governance map[string]GovernanceRequest    `json:"governanceRequests"`
	Appeals    map[string]TrustAppeal          `json:"trustAppeals"`
	Tracking   map[string]TrackingPolicyReview `json:"trackingPolicyReviews"`
	AIPerms    map[string]AIPermissionGrant    `json:"aiPermissions"`
	AIActions  map[string]AIActionProposal     `json:"aiActions"`
	Transp     map[string]TransparencyEntry    `json:"transparencyEntries"`
	Delegation map[string]ResourceDelegation   `json:"resourceDelegations"`
	Rentals    map[string]ResourceRental       `json:"resourceRentals"`
	Income     map[string]ResourceIncomeRecord `json:"resourceIncome"`
	Contracts  map[string]ContractArtifact     `json:"contracts"`
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

func TruthfulStatus(cfg NetworkConfig) string {
	switch cfg.Slug {
	case "mainnet":
		return "ynx-mainnet-node"
	case "testnet":
		return "ynx-testnet-node"
	default:
		return "local-devnet"
	}
}

func NewDevnet(cfg NetworkConfig) *Devnet {
	return NewDevnetWithValidators(cfg, nil)
}

func NewDevnetWithValidators(cfg NetworkConfig, validators []Validator) *Devnet {
	normalized, err := NormalizeValidators(validators)
	if err != nil || len(normalized) == 0 {
		normalized = DefaultValidators()
	}
	d := &Devnet{
		cfg:                 cfg,
		accounts:            map[string]*Account{},
		lots:                map[string]TrustTraceLot{},
		payIntents:          map[string]PayIntent{},
		invoices:            map[string]Invoice{},
		refunds:             map[string]RefundRecord{},
		webhookSignatures:   map[string]WebhookSignature{},
		payEvents:           map[string]PayEvent{},
		riskLabels:          map[string][]RiskLabel{},
		evidencePackets:     map[string]EvidencePacket{},
		governanceRequests:  map[string]GovernanceRequest{},
		trustAppeals:        map[string]TrustAppeal{},
		trackingReviews:     map[string]TrackingPolicyReview{},
		aiPermissions:       map[string]AIPermissionGrant{},
		aiActions:           map[string]AIActionProposal{},
		transparencyEntries: map[string]TransparencyEntry{},
		resourceDelegations: map[string]ResourceDelegation{},
		resourceRentals:     map[string]ResourceRental{},
		resourceIncome:      map[string]ResourceIncomeRecord{},
		contracts:           map[string]ContractArtifact{},
		validators:          normalized,
	}
	d.accounts[FaucetAddress] = &Account{Address: FaucetAddress, Balance: 1_000_000_000, Lots: map[string]int64{}}
	for _, validator := range normalized {
		d.accounts[validator.Address] = &Account{Address: validator.Address, Balance: 10_000_000, Staked: 10_000_000, Lots: map[string]int64{}}
	}
	d.accounts[ProtocolResourceProvider] = &Account{Address: ProtocolResourceProvider, Balance: 0, Staked: 10_000_000, Lots: map[string]int64{}}
	d.accounts[ProtocolResourceTreasury] = &Account{Address: ProtocolResourceTreasury, Balance: 0, Lots: map[string]int64{}}
	d.blocks = append(d.blocks, Block{
		Height: 0, Hash: hashParts("genesis", cfg.Slug, fmt.Sprint(cfg.ChainID)), Time: time.Now().UTC(), Validator: normalized[0].Address,
	})
	return d
}

func NewPersistentDevnet(cfg NetworkConfig, dataDir string) (*Devnet, error) {
	return NewPersistentDevnetWithValidators(cfg, dataDir, nil)
}

func NewPersistentDevnetWithValidators(cfg NetworkConfig, dataDir string, validators []Validator) (*Devnet, error) {
	if strings.TrimSpace(dataDir) == "" {
		return NewDevnetWithValidators(cfg, validators), nil
	}
	d := NewDevnetWithValidators(cfg, validators)
	d.dataDir = dataDir
	if err := d.loadSnapshot(); err != nil {
		return nil, err
	}
	if normalized, err := NormalizeValidators(validators); err != nil {
		return nil, err
	} else if len(normalized) > 0 {
		d.validators = normalized
		d.ensureValidatorAccountsLocked()
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
		"truthfulStatus": TruthfulStatus(d.cfg), "mainnetReady": false,
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
	return ExplorerSummary{Network: d.cfg, Height: latest.Height, LatestBlockHash: latest.Hash, LatestBlockTime: latest.Time, TotalBlocks: len(d.blocks), TotalTransactions: totalTxs, KnownAccounts: len(d.accounts), ValidatorCount: len(d.validators), PendingTxCount: len(d.pending), PayIntentCount: len(d.payIntents), InvoiceCount: len(d.invoices), TrustEvidenceCount: len(d.evidencePackets), GovernanceRequests: len(d.governanceRequests), AppealCount: len(d.trustAppeals), TransparencyCount: len(d.transparencyEntries), ContractCount: len(d.contracts), PersistenceEnabled: d.dataDir != "", PersistenceError: d.lastPersistenceError, TruthfulStatus: TruthfulStatus(d.cfg)}
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

func (d *Devnet) EVMLogs(filter EVMLogFilter) []EVMLog {
	d.mu.RLock()
	defer d.mu.RUnlock()
	logs := make([]EVMLog, 0)
	for _, block := range d.blocks {
		if filter.FromBlock != nil && block.Height < *filter.FromBlock {
			continue
		}
		if filter.ToBlock != nil && block.Height > *filter.ToBlock {
			continue
		}
		for _, tx := range block.Transactions {
			for _, log := range tx.Logs {
				if evmLogMatchesFilter(log, filter) {
					logs = append(logs, log)
				}
			}
		}
	}
	return logs
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
	d.account(d.nextValidatorAddressLocked()).Balance += fee
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
	if len(d.riskLabels[address]) > 0 {
		labels = append(labels, "advisory-risk-labels-present")
	}
	return TrustTrace{Address: address, Lots: lots, Labels: labels, Summary: "Trace uses lot lineage, pro-rata movement, and advisory Trust label metadata. Labels require source, evidence, confidence, expiry, and appealability; they do not freeze, seize, or transfer funds."}, nil
}

func (d *Devnet) CreatePayIntent(merchant string, amount int64, callbackURL string) (PayIntent, error) {
	return d.CreatePayIntentWithIdempotency(merchant, amount, callbackURL, "")
}

func (d *Devnet) CreatePayIntentWithIdempotency(merchant string, amount int64, callbackURL, idempotencyKey string) (PayIntent, error) {
	merchant = strings.TrimSpace(merchant)
	callbackURL = strings.TrimSpace(callbackURL)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if merchant == "" {
		return PayIntent{}, errors.New("merchant is required")
	}
	if amount <= 0 {
		return PayIntent{}, errors.New("amount must be positive")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if existing, ok := d.findPayIntentByIdempotencyLocked(merchant, idempotencyKey); ok {
		return existing, nil
	}
	now := time.Now().UTC()
	intent := PayIntent{ID: hashParts("pay", merchant, fmt.Sprint(amount), fmt.Sprint(now.UnixNano()))[:24], Merchant: merchant, Amount: amount, Currency: d.cfg.NativeCurrencySymbol, Status: "created", CreatedAt: now, CallbackURL: callbackURL, IdempotencyKey: idempotencyKey}
	d.payIntents[intent.ID] = intent
	d.recordPayEventLocked("payment_intent.created", intent.ID, intent.ID, intent.Merchant, intent.Amount, intent.Currency, intent.IdempotencyKey, now)
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
	return d.CreateInvoiceWithIdempotency(intentID, dueInHours, "")
}

func (d *Devnet) CreateInvoiceWithIdempotency(intentID string, dueInHours int64, idempotencyKey string) (Invoice, error) {
	intentID = strings.TrimSpace(intentID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
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
	if existing, ok := d.findInvoiceByIdempotencyLocked(intentID, idempotencyKey); ok {
		return existing, nil
	}
	now := time.Now().UTC()
	invoice := Invoice{
		ID:             hashParts("invoice", intent.ID, fmt.Sprint(now.UnixNano()))[:24],
		IntentID:       intent.ID,
		Merchant:       intent.Merchant,
		Amount:         intent.Amount,
		Currency:       intent.Currency,
		Status:         "issued",
		DueAt:          now.Add(time.Duration(dueInHours) * time.Hour),
		CreatedAt:      now,
		IdempotencyKey: idempotencyKey,
	}
	invoice.PaymentLink = "/pay/checkout/" + invoice.ID
	d.invoices[invoice.ID] = invoice
	d.recordPayEventLocked("invoice.issued", invoice.IntentID, invoice.ID, invoice.Merchant, invoice.Amount, invoice.Currency, invoice.IdempotencyKey, now)
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
	return d.CreateRefundWithIdempotency(intentID, amount, reason, "")
}

func (d *Devnet) CreateRefundWithIdempotency(intentID string, amount int64, reason, idempotencyKey string) (RefundRecord, error) {
	intentID = strings.TrimSpace(intentID)
	reason = strings.TrimSpace(reason)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
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
	if existing, ok := d.findRefundByIdempotencyLocked(intentID, idempotencyKey); ok {
		return existing, nil
	}
	now := time.Now().UTC()
	refund := RefundRecord{
		ID:             hashParts("refund", intentID, fmt.Sprint(amount), fmt.Sprint(now.UnixNano()))[:24],
		IntentID:       intentID,
		Amount:         amount,
		Currency:       intent.Currency,
		Reason:         reason,
		Status:         "recorded",
		CreatedAt:      now,
		IdempotencyKey: idempotencyKey,
	}
	d.refunds[refund.ID] = refund
	d.recordPayEventLocked("refund.recorded", refund.IntentID, refund.ID, intent.Merchant, refund.Amount, refund.Currency, refund.IdempotencyKey, now)
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return refund, err
}

func (d *Devnet) SignWebhook(intentID, eventType, signingKey string) (WebhookSignature, error) {
	return d.SignWebhookWithIdempotency(intentID, eventType, signingKey, "")
}

func (d *Devnet) SignWebhookWithIdempotency(intentID, eventType, signingKey, idempotencyKey string) (WebhookSignature, error) {
	intentID = strings.TrimSpace(intentID)
	eventType = strings.TrimSpace(eventType)
	signingKey = strings.TrimSpace(signingKey)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if intentID == "" || eventType == "" || signingKey == "" {
		return WebhookSignature{}, errors.New("intentId, eventType, and signingKey are required")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	intent, ok := d.payIntents[intentID]
	if !ok {
		return WebhookSignature{}, errors.New("payment intent not found")
	}
	if existing, ok := d.findWebhookByIdempotencyLocked(intentID, eventType, idempotencyKey); ok {
		return existing, nil
	}
	signedAt := time.Now().UTC()
	eventID := hashParts("event", intentID, eventType, fmt.Sprint(signedAt.UnixNano()))[:24]
	payload := strings.Join([]string{eventID, intentID, eventType, signedAt.Format(time.RFC3339Nano)}, ".")
	mac := hmac.New(sha256.New, []byte(signingKey))
	_, _ = mac.Write([]byte(payload))
	payloadHash := hashParts("webhook-payload", payload)
	signature := WebhookSignature{EventID: eventID, IntentID: intentID, EventType: eventType, Signature: hex.EncodeToString(mac.Sum(nil)), PayloadHash: payloadHash, SignedAt: signedAt, Algorithm: "hmac-sha256", IdempotencyKey: idempotencyKey, ReplaySafe: idempotencyKey != ""}
	d.webhookSignatures[eventID] = signature
	d.recordPayEventLocked("webhook.signed", intentID, eventID, intent.Merchant, 0, intent.Currency, idempotencyKey, signedAt)
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return signature, err
}

func (d *Devnet) WebhookSignature(eventID string) (WebhookSignature, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	signature, ok := d.webhookSignatures[eventID]
	return signature, ok
}

func (d *Devnet) PayEvent(id string) (PayEvent, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	event, ok := d.payEvents[id]
	return event, ok
}

func (d *Devnet) PayEvents(intentID string) []PayEvent {
	d.mu.RLock()
	defer d.mu.RUnlock()
	events := make([]PayEvent, 0)
	for _, event := range d.payEvents {
		if intentID == "" || event.IntentID == intentID {
			events = append(events, event)
		}
	}
	sort.Slice(events, func(i, j int) bool { return events[i].CreatedAt.Before(events[j].CreatedAt) })
	return events
}

func (d *Devnet) AddRiskLabel(subject, label string, riskWeightBps int64, source string) (RiskLabel, error) {
	return d.AddRiskLabelFromInput(RiskLabelInput{
		Subject:       subject,
		Label:         label,
		RiskWeightBps: riskWeightBps,
		Source:        source,
		EvidenceHash:  hashParts("legacy-risk-label", subject, label, source),
	})
}

func (d *Devnet) AddRiskLabelFromInput(input RiskLabelInput) (RiskLabel, error) {
	input.Subject = strings.TrimSpace(input.Subject)
	input.Address = strings.TrimSpace(input.Address)
	input.Label = strings.TrimSpace(input.Label)
	input.LabelType = strings.TrimSpace(input.LabelType)
	input.Severity = strings.TrimSpace(input.Severity)
	input.Source = strings.TrimSpace(input.Source)
	input.EvidenceHash = strings.TrimSpace(input.EvidenceHash)
	input.DisputeStatus = strings.TrimSpace(input.DisputeStatus)
	input.LegalStatusUnderYNXChainLaw = strings.TrimSpace(input.LegalStatusUnderYNXChainLaw)
	input.RejectedExternalRequestReference = strings.TrimSpace(input.RejectedExternalRequestReference)
	input.AssetEffect = strings.TrimSpace(input.AssetEffect)
	if input.Subject == "" && input.Address != "" {
		input.Subject = input.Address
	}
	if input.Address == "" {
		input.Address = input.Subject
	}
	if input.Subject == "" || input.Label == "" {
		return RiskLabel{}, errors.New("subject/address and label are required")
	}
	if input.Source == "" {
		return RiskLabel{}, errors.New("source is required")
	}
	if input.EvidenceHash == "" {
		return RiskLabel{}, errors.New("evidenceHash is required")
	}
	if input.RiskWeightBps < 0 || input.RiskWeightBps > 10000 {
		return RiskLabel{}, errors.New("riskWeightBps must be between 0 and 10000")
	}
	if input.ConfidenceBps < 0 || input.ConfidenceBps > 10000 {
		return RiskLabel{}, errors.New("confidenceBps must be between 0 and 10000")
	}
	if input.ConfidenceBps == 0 {
		input.ConfidenceBps = 5000
	}
	if input.LabelType == "" {
		input.LabelType = "risk"
	}
	if input.Severity == "" {
		input.Severity = severityForRiskWeight(input.RiskWeightBps)
	}
	if input.DisputeStatus == "" {
		input.DisputeStatus = "not_disputed"
	}
	if input.LegalStatusUnderYNXChainLaw == "" {
		input.LegalStatusUnderYNXChainLaw = "advisory_label_only_not_criminal_determination"
	}
	if input.AssetEffect == "" {
		input.AssetEffect = "none_advisory_only"
	}
	if input.AssetEffect != "none_advisory_only" {
		return RiskLabel{}, errors.New("risk labels cannot freeze, seize, confiscate, or transfer assets")
	}
	appealAvailable := true
	if input.AppealAvailable != nil {
		appealAvailable = *input.AppealAvailable
	}
	if !appealAvailable {
		return RiskLabel{}, errors.New("appealAvailable must remain true for Trust risk labels")
	}
	now := time.Now().UTC()
	var expiresAt *time.Time
	if input.ExpiryHours > 0 {
		expiry := now.Add(time.Duration(input.ExpiryHours) * time.Hour)
		expiresAt = &expiry
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	risk := RiskLabel{
		ID:                               hashParts("risk-label", input.Subject, input.Label, input.Source, fmt.Sprint(now.UnixNano()))[:24],
		Subject:                          input.Subject,
		Address:                          input.Address,
		Label:                            input.Label,
		LabelType:                        input.LabelType,
		Severity:                         input.Severity,
		RiskWeightBps:                    input.RiskWeightBps,
		ConfidenceBps:                    input.ConfidenceBps,
		Source:                           input.Source,
		EvidenceHash:                     input.EvidenceHash,
		CreatedAt:                        now,
		UpdatedAt:                        now,
		ExpiresAt:                        expiresAt,
		ReviewRequired:                   input.ReviewRequired,
		AppealAvailable:                  appealAvailable,
		DisputeStatus:                    input.DisputeStatus,
		LegalStatusUnderYNXChainLaw:      input.LegalStatusUnderYNXChainLaw,
		RejectedExternalRequestReference: input.RejectedExternalRequestReference,
		AssetEffect:                      input.AssetEffect,
	}
	d.riskLabels[input.Subject] = append(d.riskLabels[input.Subject], risk)
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return risk, err
}

func RequestValidityRules() []RequestValidityRule {
	out := make([]RequestValidityRule, len(requestValidityRules))
	copy(out, requestValidityRules)
	return out
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
	generatedAt := time.Now().UTC()
	packet := EvidencePacket{
		ID:          hashParts("evidence", subject, fmt.Sprint(time.Now().UnixNano()))[:24],
		Subject:     subject,
		Trace:       trace,
		Labels:      labels,
		RiskSummary: trustRiskSummary(subject, labels, generatedAt),
		RelatedTxs:  related,
		GeneratedAt: generatedAt,
		ExportNotes: []string{
			"JSON evidence is generated from local devnet state.",
			"PDF export is a deterministic local evidence rendering for reviewer smoke tests.",
			"Risk scoring is advisory-only and cannot freeze, seize, confiscate, transfer, or criminally classify assets or users.",
			"Expired labels and labels below 5000 confidence bps are listed for reviewer context but are not treated as conclusive risk.",
		},
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

func (d *Devnet) CreateGovernanceRequest(input GovernanceRequestInput) (GovernanceRequest, error) {
	input.Requester = strings.TrimSpace(input.Requester)
	input.Subject = strings.TrimSpace(input.Subject)
	input.Action = strings.TrimSpace(input.Action)
	input.AssetType = strings.TrimSpace(input.AssetType)
	input.Scope = strings.TrimSpace(input.Scope)
	input.Description = strings.TrimSpace(input.Description)
	if input.Requester == "" || input.Subject == "" || input.Action == "" {
		return GovernanceRequest{}, errors.New("requester, subject, and action are required")
	}
	classification, reasons, notice, ruleIDs := classifyGovernanceRequest(input)
	now := time.Now().UTC()
	status := "pending_review"
	if isRejectedClassification(classification) {
		status = "rejected"
	}
	req := GovernanceRequest{
		ID:                  hashParts("governance-request", input.Requester, input.Subject, input.Action, fmt.Sprint(now.UnixNano()))[:24],
		Requester:           input.Requester,
		Subject:             input.Subject,
		Action:              input.Action,
		AssetType:           normalizeLower(input.AssetType),
		Scope:               input.Scope,
		Description:         input.Description,
		Evidence:            cleanStrings(input.Evidence),
		Classification:      classification,
		Status:              status,
		Reasons:             reasons,
		RuleIDs:             ruleIDs,
		RequiresAppeal:      true,
		RequiresUserNotice:  notice,
		NativeYNXTProtected: isNativeYNXT(input.AssetType),
		CreatedAt:           now,
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	entry := d.newTransparencyEntryLocked("governance_request", req.ID, "", req.Subject, req.Action, req.Classification, req.Status, req.Reasons)
	req.TransparencyEntryID = entry.ID
	d.governanceRequests[req.ID] = req
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return req, err
}

func (d *Devnet) GovernanceRequest(id string) (GovernanceRequest, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	req, ok := d.governanceRequests[id]
	return req, ok
}

func (d *Devnet) ReviewGovernanceRequest(id string) (GovernanceRequest, error) {
	return d.updateGovernanceRequestStatus(id, "governance_review", RequestRequiresReview, "reviewed", []string{"request requires governance review before any action can occur"})
}

func (d *Devnet) RejectGovernanceRequest(id string, reason string) (GovernanceRequest, error) {
	reasons := []string{"request rejected under YNX Chain Law"}
	if strings.TrimSpace(reason) != "" {
		reasons = append(reasons, strings.TrimSpace(reason))
	}
	return d.updateGovernanceRequestStatus(id, "governance_rejection", RequestRejected, "rejected", reasons)
}

func (d *Devnet) updateGovernanceRequestStatus(id, entryType string, classification RequestValidityStatus, status string, reasons []string) (GovernanceRequest, error) {
	if strings.TrimSpace(id) == "" {
		return GovernanceRequest{}, errors.New("request id is required")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	req, ok := d.governanceRequests[id]
	if !ok {
		return GovernanceRequest{}, errors.New("governance request not found")
	}
	now := time.Now().UTC()
	req.Classification = classification
	req.Status = status
	req.Reasons = appendUnique(req.Reasons, reasons...)
	if status == "reviewed" {
		req.ReviewedAt = &now
	}
	if status == "rejected" {
		req.RejectedAt = &now
	}
	entry := d.newTransparencyEntryLocked(entryType, req.ID, "", req.Subject, req.Action, req.Classification, req.Status, req.Reasons)
	req.TransparencyEntryID = entry.ID
	d.governanceRequests[id] = req
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return req, err
}

func (d *Devnet) CreateTrustAppeal(input TrustAppealInput) (TrustAppeal, error) {
	input.Subject = strings.TrimSpace(input.Subject)
	input.Appellant = strings.TrimSpace(input.Appellant)
	input.Claimant = strings.TrimSpace(input.Claimant)
	input.Reason = strings.TrimSpace(input.Reason)
	if input.Claimant == "" {
		input.Claimant = input.Appellant
	}
	if input.Subject == "" || input.Appellant == "" || input.Reason == "" {
		return TrustAppeal{}, errors.New("subject, appellant, and reason are required")
	}
	now := time.Now().UTC()
	appeal := TrustAppeal{
		ID:        hashParts("trust-appeal", input.Subject, input.Appellant, fmt.Sprint(now.UnixNano()))[:24],
		RequestID: strings.TrimSpace(input.RequestID),
		LabelID:   strings.TrimSpace(input.LabelID),
		Subject:   input.Subject,
		Appellant: input.Appellant,
		Claimant:  input.Claimant,
		Reason:    input.Reason,
		Evidence:  cleanStrings(input.Evidence),
		Status:    "SUBMITTED",
		CreatedAt: now,
		UpdatedAt: now,
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	entry := d.newTransparencyEntryLocked("trust_appeal", appeal.RequestID, appeal.ID, appeal.Subject, "appeal", RequestRequiresReview, appeal.Status, []string{"appeal opened for human review and false-positive correction"})
	appeal.TransparencyEntryID = entry.ID
	d.trustAppeals[appeal.ID] = appeal
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return appeal, err
}

func (d *Devnet) ResolveTrustAppeal(id string, input TrustAppealDecisionInput) (TrustAppeal, error) {
	input.Reviewer = strings.TrimSpace(input.Reviewer)
	input.Decision = strings.ToUpper(strings.TrimSpace(input.Decision))
	input.ResolutionReason = strings.TrimSpace(input.ResolutionReason)
	if id == "" || input.Reviewer == "" || input.Decision == "" || input.ResolutionReason == "" {
		return TrustAppeal{}, errors.New("appeal id, reviewer, decision, and resolutionReason are required")
	}
	allowed := map[string]struct{}{
		"UNDER_REVIEW":        {},
		"NEEDS_MORE_EVIDENCE": {},
		"ACCEPTED":            {},
		"REJECTED":            {},
		"LABEL_REMOVED":       {},
		"LABEL_REDUCED":       {},
	}
	if _, ok := allowed[input.Decision]; !ok {
		return TrustAppeal{}, errors.New("decision must be UNDER_REVIEW, NEEDS_MORE_EVIDENCE, ACCEPTED, REJECTED, LABEL_REMOVED, or LABEL_REDUCED")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	appeal, ok := d.trustAppeals[id]
	if !ok {
		return TrustAppeal{}, errors.New("trust appeal not found")
	}
	now := time.Now().UTC()
	appeal.Status = input.Decision
	appeal.Reviewer = input.Reviewer
	appeal.Decision = input.Decision
	appeal.ResolutionReason = input.ResolutionReason
	appeal.UpdatedAt = now
	if input.Decision == "LABEL_REMOVED" || input.Decision == "ACCEPTED" {
		correction := newRiskLabelLocked(RiskLabelInput{Subject: appeal.Subject, Address: appeal.Subject, Label: "false-positive-corrected", LabelType: "appeal_correction", Severity: "none", RiskWeightBps: 0, ConfidenceBps: 10000, Source: "appeal:" + appeal.ID, EvidenceHash: hashParts("appeal-resolution", appeal.ID, appeal.ResolutionReason), ReviewRequired: false, DisputeStatus: "resolved", LegalStatusUnderYNXChainLaw: "false_positive_corrected_by_appeal", RejectedExternalRequestReference: appeal.RequestID, AssetEffect: "none_advisory_only"}, now)
		d.riskLabels[appeal.Subject] = append(d.riskLabels[appeal.Subject], correction)
	}
	if input.Decision == "LABEL_REDUCED" {
		correction := newRiskLabelLocked(RiskLabelInput{Subject: appeal.Subject, Address: appeal.Subject, Label: "risk-reduced-after-appeal", LabelType: "appeal_correction", Severity: "low", RiskWeightBps: 100, ConfidenceBps: 10000, Source: "appeal:" + appeal.ID, EvidenceHash: hashParts("appeal-resolution", appeal.ID, appeal.ResolutionReason), ReviewRequired: false, DisputeStatus: "resolved", LegalStatusUnderYNXChainLaw: "risk_reduced_by_appeal_not_criminal_determination", RejectedExternalRequestReference: appeal.RequestID, AssetEffect: "none_advisory_only"}, now)
		d.riskLabels[appeal.Subject] = append(d.riskLabels[appeal.Subject], correction)
	}
	entry := d.newTransparencyEntryLocked("appeal_resolution", appeal.RequestID, appeal.ID, appeal.Subject, "appeal_resolution", RequestRequiresReview, appeal.Status, []string{appeal.ResolutionReason})
	appeal.TransparencyEntryID = entry.ID
	d.trustAppeals[id] = appeal
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return appeal, err
}

func (d *Devnet) TrustAppeal(id string) (TrustAppeal, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	appeal, ok := d.trustAppeals[id]
	return appeal, ok
}

func (d *Devnet) CreateTrackingPolicyReview(input TrackingPolicyReviewInput) (TrackingPolicyReview, error) {
	input.Requester = strings.TrimSpace(input.Requester)
	input.Subject = strings.TrimSpace(input.Subject)
	input.Purpose = strings.TrimSpace(input.Purpose)
	input.QueryType = strings.TrimSpace(input.QueryType)
	input.Scope = strings.TrimSpace(input.Scope)
	input.Description = strings.TrimSpace(input.Description)
	if input.Requester == "" || input.Subject == "" || input.Purpose == "" || input.QueryType == "" {
		return TrackingPolicyReview{}, errors.New("requester, subject, purpose, and queryType are required")
	}
	classification, status, reasons, ruleIDs := classifyTrackingPolicyReview(input)
	now := time.Now().UTC()
	var expiresAt *time.Time
	if input.ExpiryHours > 0 {
		expiry := now.Add(time.Duration(input.ExpiryHours) * time.Hour)
		expiresAt = &expiry
	}
	review := TrackingPolicyReview{
		ID:               hashParts("tracking-review", input.Requester, input.Subject, input.Purpose, fmt.Sprint(now.UnixNano()))[:24],
		Requester:        input.Requester,
		Subject:          input.Subject,
		Purpose:          input.Purpose,
		QueryType:        input.QueryType,
		Scope:            input.Scope,
		Description:      input.Description,
		Evidence:         cleanStrings(input.Evidence),
		Institutional:    input.Institutional,
		Sensitive:        input.Sensitive,
		MinimumNecessary: input.MinimumNecessary,
		Classification:   classification,
		Status:           status,
		Reasons:          reasons,
		RuleIDs:          ruleIDs,
		ConfidenceBps:    input.ConfidenceBps,
		LabelExpiresAt:   expiresAt,
		AppealPath:       "/trust/appeals",
		CreatedAt:        now,
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	entry := d.newTransparencyEntryLocked("tracking_policy_review", review.ID, "", review.Subject, review.QueryType, review.Classification, review.Status, review.Reasons)
	review.TransparencyEntryID = entry.ID
	d.trackingReviews[review.ID] = review
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return review, err
}

func (d *Devnet) TrackingPolicyReview(id string) (TrackingPolicyReview, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	review, ok := d.trackingReviews[id]
	return review, ok
}

func (d *Devnet) RequestAIPermission(input AIPermissionInput) (AIPermissionGrant, error) {
	input.SessionID = strings.TrimSpace(input.SessionID)
	input.Requester = strings.TrimSpace(input.Requester)
	input.Scope = normalizeLower(input.Scope)
	input.Purpose = strings.TrimSpace(input.Purpose)
	if input.SessionID == "" || input.Requester == "" || input.Scope == "" || input.Purpose == "" {
		return AIPermissionGrant{}, errors.New("sessionId, requester, scope, and purpose are required")
	}
	now := time.Now().UTC()
	expiryHours := input.ExpiryHours
	if expiryHours <= 0 {
		expiryHours = 1
	}
	grant := AIPermissionGrant{
		ID:        hashParts("ai-permission", input.SessionID, input.Requester, input.Scope, fmt.Sprint(now.UnixNano()))[:24],
		SessionID: input.SessionID,
		Requester: input.Requester,
		Scope:     input.Scope,
		Purpose:   input.Purpose,
		Status:    "active",
		CreatedAt: now,
		ExpiresAt: now.Add(time.Duration(expiryHours) * time.Hour),
	}
	grant.AuditHash = hashParts("ai-permission-audit", grant.ID, grant.SessionID, grant.Requester, grant.Scope, grant.Purpose, grant.Status, grant.ExpiresAt.Format(time.RFC3339Nano))
	d.mu.Lock()
	defer d.mu.Unlock()
	d.aiPermissions[grant.ID] = grant
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return grant, err
}

func (d *Devnet) AIPermission(id string) (AIPermissionGrant, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	grant, ok := d.aiPermissions[id]
	return grant, ok
}

func (d *Devnet) ProposeAIAction(input AIActionProposalInput) (AIActionProposal, error) {
	input.SessionID = strings.TrimSpace(input.SessionID)
	input.Requester = strings.TrimSpace(input.Requester)
	input.Scope = normalizeLower(input.Scope)
	input.ActionType = normalizeLower(input.ActionType)
	input.Description = strings.TrimSpace(input.Description)
	if input.SessionID == "" || input.Requester == "" || input.Scope == "" || input.ActionType == "" || input.Description == "" {
		return AIActionProposal{}, errors.New("sessionId, requester, scope, actionType, and description are required")
	}
	now := time.Now().UTC()
	expiryHours := input.ExpiryHours
	if expiryHours <= 0 {
		expiryHours = 1
	}
	sensitive, reasons := classifyAIActionSensitivity(input)
	proposal := AIActionProposal{
		ID:               hashParts("ai-action", input.SessionID, input.Requester, input.ActionType, fmt.Sprint(now.UnixNano()))[:24],
		SessionID:        input.SessionID,
		Requester:        input.Requester,
		Scope:            input.Scope,
		ActionType:       input.ActionType,
		Description:      input.Description,
		Status:           "pending_approval",
		Executable:       false,
		Sensitive:        sensitive,
		RequiresApproval: sensitive,
		Reasons:          reasons,
		CreatedAt:        now,
		ExpiresAt:        now.Add(time.Duration(expiryHours) * time.Hour),
	}
	if !sensitive {
		proposal.Status = "logged"
		proposal.Executable = true
		proposal.Reasons = []string{"non-sensitive AI action is logged for audit"}
	}
	proposal.AuditHash = aiActionAuditHash(proposal)
	d.mu.Lock()
	defer d.mu.Unlock()
	classification := RequestRequiresReview
	if !proposal.RequiresApproval {
		classification = RequestValidUnderYNXChainLaw
	}
	entry := d.newTransparencyEntryLocked("ai_action_proposal", proposal.ID, "", proposal.Requester, proposal.ActionType, classification, proposal.Status, proposal.Reasons)
	proposal.TransparencyEntryID = entry.ID
	d.aiActions[proposal.ID] = proposal
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return proposal, err
}

func (d *Devnet) ApproveAIAction(id string, input AIActionApprovalInput) (AIActionProposal, error) {
	input.Approver = strings.TrimSpace(input.Approver)
	input.PermissionID = strings.TrimSpace(input.PermissionID)
	if strings.TrimSpace(id) == "" || input.Approver == "" || input.PermissionID == "" {
		return AIActionProposal{}, errors.New("action id, approver, and permissionId are required")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	proposal, ok := d.aiActions[id]
	if !ok {
		return AIActionProposal{}, errors.New("AI action proposal not found")
	}
	if proposal.Status == "approved" && proposal.Executable {
		return proposal, nil
	}
	grant, ok := d.aiPermissions[input.PermissionID]
	if !ok {
		return AIActionProposal{}, errors.New("AI permission not found")
	}
	if !aiPermissionMatchesAction(grant, proposal, time.Now().UTC()) {
		return AIActionProposal{}, errors.New("AI permission does not match this action or is expired")
	}
	now := time.Now().UTC()
	proposal.PermissionID = grant.ID
	proposal.Status = "approved"
	proposal.Executable = true
	proposal.ApprovedAt = &now
	proposal.ApprovedBy = input.Approver
	proposal.Reasons = appendUnique(proposal.Reasons, "explicit scoped permission approved this sensitive AI action")
	proposal.AuditHash = aiActionAuditHash(proposal)
	entry := d.newTransparencyEntryLocked("ai_action_approval", proposal.ID, "", proposal.Requester, proposal.ActionType, RequestRequiresReview, proposal.Status, proposal.Reasons)
	proposal.TransparencyEntryID = entry.ID
	d.aiActions[id] = proposal
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return proposal, err
}

func (d *Devnet) RejectAIAction(id string, input AIActionApprovalInput) (AIActionProposal, error) {
	input.Approver = strings.TrimSpace(input.Approver)
	if strings.TrimSpace(id) == "" || input.Approver == "" {
		return AIActionProposal{}, errors.New("action id and approver are required")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	proposal, ok := d.aiActions[id]
	if !ok {
		return AIActionProposal{}, errors.New("AI action proposal not found")
	}
	now := time.Now().UTC()
	proposal.Status = "rejected"
	proposal.Executable = false
	proposal.RejectedAt = &now
	proposal.RejectedBy = input.Approver
	proposal.Reasons = appendUnique(proposal.Reasons, "AI action rejected by explicit reviewer decision")
	proposal.AuditHash = aiActionAuditHash(proposal)
	entry := d.newTransparencyEntryLocked("ai_action_rejection", proposal.ID, "", proposal.Requester, proposal.ActionType, RequestRejected, proposal.Status, proposal.Reasons)
	proposal.TransparencyEntryID = entry.ID
	d.aiActions[id] = proposal
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return proposal, err
}

func (d *Devnet) AIAction(id string) (AIActionProposal, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	proposal, ok := d.aiActions[id]
	return proposal, ok
}

func (d *Devnet) AIActions(sessionID string) []AIActionProposal {
	d.mu.RLock()
	defer d.mu.RUnlock()
	actions := make([]AIActionProposal, 0)
	for _, proposal := range d.aiActions {
		if sessionID == "" || proposal.SessionID == sessionID {
			actions = append(actions, proposal)
		}
	}
	sort.Slice(actions, func(i, j int) bool { return actions[i].CreatedAt.Before(actions[j].CreatedAt) })
	return actions
}

func (d *Devnet) TransparencyReport() TransparencyReport {
	d.mu.RLock()
	defer d.mu.RUnlock()
	entries := make([]TransparencyEntry, 0, len(d.transparencyEntries))
	report := TransparencyReport{Network: d.cfg, GeneratedAt: time.Now().UTC(), TruthfulStatus: TruthfulStatus(d.cfg)}
	for _, entry := range d.transparencyEntries {
		entries = append(entries, entry)
		if entry.Status == "rejected" {
			report.RejectedCount++
		}
		if entry.Type == "trust_appeal" {
			report.AppealCount++
		}
		if entry.Classification == RequestRequiresReview || entry.Status == "reviewed" {
			report.ReviewCount++
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].CreatedAt.Before(entries[j].CreatedAt) })
	report.Entries = entries
	report.EntryCount = len(entries)
	return report
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

func (d *Devnet) DelegateResources(provider, beneficiary string, amount int64) (ResourceDelegation, Transaction, ResourceBalance, error) {
	if provider == "" {
		return ResourceDelegation{}, Transaction{}, ResourceBalance{}, errors.New("provider is required")
	}
	if beneficiary == "" {
		beneficiary = provider
	}
	if amount <= 0 {
		return ResourceDelegation{}, Transaction{}, ResourceBalance{}, errors.New("amount must be positive")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	providerAccount := d.account(provider)
	if providerAccount.Balance < amount {
		return ResourceDelegation{}, Transaction{}, ResourceBalance{}, errors.New("insufficient balance for resource delegation")
	}
	beneficiaryAccount := d.account(beneficiary)
	providerAccount.Balance -= amount
	providerAccount.Nonce++
	beneficiaryAccount.Staked += amount
	delegation := ResourceDelegation{
		ID:           hashParts("resource-delegation", provider, beneficiary, fmt.Sprint(amount), fmt.Sprint(time.Now().UnixNano()))[:24],
		Provider:     provider,
		Beneficiary:  beneficiary,
		AmountYNXT:   amount,
		Bandwidth:    amount / 10,
		Compute:      amount / 100,
		AICredits:    amount / 1000,
		TrustCredits: amount / 1000,
		Status:       "active",
		CreatedAt:    time.Now().UTC(),
	}
	d.resourceDelegations[delegation.ID] = delegation
	tx := d.newTxLocked("resource_delegate", provider, beneficiary, amount, 0, nil, "delegate YNXT into resource capacity")
	d.pending = append(d.pending, tx)
	err := d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return delegation, tx, resourceBalance(beneficiaryAccount), err
}

func (d *Devnet) ResourceDelegations(address string) []ResourceDelegation {
	d.mu.RLock()
	defer d.mu.RUnlock()
	delegations := make([]ResourceDelegation, 0)
	for _, delegation := range d.resourceDelegations {
		if address == "" || delegation.Provider == address || delegation.Beneficiary == address {
			delegations = append(delegations, delegation)
		}
	}
	sort.Slice(delegations, func(i, j int) bool { return delegations[i].CreatedAt.Before(delegations[j].CreatedAt) })
	return delegations
}

func (d *Devnet) RentResources(address, provider string, bandwidth, compute, aiCredits, trustCredits int64) (ResourceRental, ResourceBalance, error) {
	quote, err := d.ResourceQuote(address, bandwidth, compute, aiCredits, trustCredits)
	if err != nil {
		return ResourceRental{}, ResourceBalance{}, err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if provider == "" {
		provider = ProtocolResourceProvider
	}
	if provider != ProtocolResourceProvider && d.activeDelegatedYNXTLocked(provider) <= 0 {
		return ResourceRental{}, ResourceBalance{}, errors.New("provider has no active delegated resources")
	}
	account := d.account(address)
	if account.Balance < quote.PriceYNXT {
		return ResourceRental{}, ResourceBalance{}, errors.New("insufficient balance for resource rental")
	}
	providerIncome := int64(0)
	if provider != ProtocolResourceProvider {
		providerIncome = quote.PriceYNXT * resourceProviderShareBps / 10000
	}
	protocolFee := quote.PriceYNXT - providerIncome
	account.Balance -= quote.PriceYNXT
	d.account(provider).Balance += providerIncome
	d.account(ProtocolResourceTreasury).Balance += protocolFee
	account.ResourceUsage.BandwidthUsed = maxInt64(0, account.ResourceUsage.BandwidthUsed-bandwidth)
	account.ResourceUsage.ComputeUsed = maxInt64(0, account.ResourceUsage.ComputeUsed-compute)
	account.ResourceUsage.AICreditsUsed = maxInt64(0, account.ResourceUsage.AICreditsUsed-aiCredits)
	account.ResourceUsage.TrustUsed = maxInt64(0, account.ResourceUsage.TrustUsed-trustCredits)
	rental := ResourceRental{
		ID:                 hashParts("resource-rental", quote.ID, provider, fmt.Sprint(time.Now().UnixNano()))[:24],
		QuoteID:            quote.ID,
		Address:            address,
		Provider:           provider,
		PriceYNXT:          quote.PriceYNXT,
		ProviderIncomeYNXT: providerIncome,
		ProtocolFeeYNXT:    protocolFee,
		Status:             "active",
		CreatedAt:          time.Now().UTC(),
		Bandwidth:          bandwidth,
		Compute:            compute,
		AICredits:          aiCredits,
		TrustCredits:       trustCredits,
	}
	d.resourceRentals[rental.ID] = rental
	if providerIncome > 0 {
		income := ResourceIncomeRecord{
			ID:        hashParts("resource-income", provider, rental.ID, fmt.Sprint(providerIncome))[:24],
			Provider:  provider,
			RentalID:  rental.ID,
			Source:    "resource-rental",
			Amount:    providerIncome,
			Currency:  d.cfg.NativeCurrencySymbol,
			CreatedAt: time.Now().UTC(),
		}
		d.resourceIncome[income.ID] = income
	}
	if protocolFee > 0 {
		income := ResourceIncomeRecord{
			ID:        hashParts("resource-income", ProtocolResourceTreasury, rental.ID, fmt.Sprint(protocolFee))[:24],
			Provider:  ProtocolResourceTreasury,
			RentalID:  rental.ID,
			Source:    "protocol-resource-fee",
			Amount:    protocolFee,
			Currency:  d.cfg.NativeCurrencySymbol,
			CreatedAt: time.Now().UTC(),
		}
		d.resourceIncome[income.ID] = income
	}
	err = d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	return rental, resourceBalance(account), err
}

func (d *Devnet) ResourceIncome(address string) []ResourceIncomeRecord {
	d.mu.RLock()
	defer d.mu.RUnlock()
	income := make([]ResourceIncomeRecord, 0)
	for _, record := range d.resourceIncome {
		if address == "" || record.Provider == address {
			income = append(income, record)
		}
	}
	sort.Slice(income, func(i, j int) bool { return income[i].CreatedAt.Before(income[j].CreatedAt) })
	return income
}

func (d *Devnet) ResourceAnalytics() ResourceAnalytics {
	d.mu.RLock()
	defer d.mu.RUnlock()
	analytics := ResourceAnalytics{Network: d.cfg, TruthfulStatus: "local-devnet"}
	for _, delegation := range d.resourceDelegations {
		if delegation.Status == "active" {
			analytics.ActiveDelegationCount++
			analytics.DelegatedYNXT += delegation.AmountYNXT
		}
	}
	for _, rental := range d.resourceRentals {
		analytics.ResourceRentalCount++
		analytics.RentalVolumeYNXT += rental.PriceYNXT
		analytics.ProviderIncomeYNXT += rental.ProviderIncomeYNXT
		analytics.ProtocolFeeYNXT += rental.ProtocolFeeYNXT
	}
	analytics.ResourceIncomeRecordCount = len(d.resourceIncome)
	return analytics
}

func (d *Devnet) DeployContract(deployer, name, source string) (ContractArtifact, Transaction, error) {
	return d.DeployContractWithArgs(deployer, name, source, nil)
}

func (d *Devnet) DeployContractWithArgs(deployer, name, source string, constructorArgs []string) (ContractArtifact, Transaction, error) {
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
	address := "0x" + hashParts("contract", deployer, name, sourceHash, fmt.Sprint(time.Now().UnixNano()))[:40]
	artifact := buildContractArtifactWithArgs(address, deployer, name, source, false, nil, constructorArgs)
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
	deployedAt := artifact.DeployedAt
	constructorArgs := append([]string(nil), artifact.ConstructorArgs...)
	artifact = buildContractArtifactWithArgs(artifact.Address, artifact.Deployer, artifact.Name, source, true, &verifiedAt, constructorArgs)
	artifact.DeployedAt = deployedAt
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

func (d *Devnet) ContractVerification(address string) (ContractVerificationEvidence, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	artifact, ok := d.contracts[address]
	if !ok {
		return ContractVerificationEvidence{}, false
	}
	return contractVerificationEvidence(artifact), true
}

func (d *Devnet) CallContract(address, function string) (ContractCallResult, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	artifact, ok := d.contracts[address]
	if !ok {
		return ContractCallResult{}, errors.New("contract not found")
	}
	function = strings.TrimSpace(function)
	normalizedCallData := normalizeHex(function)
	callSelector := ""
	if len(normalizedCallData) >= 10 {
		callSelector = normalizedCallData[:10]
	}
	for _, candidate := range artifact.Functions {
		candidateSelector := strings.ToLower(candidate.Selector)
		if candidate.Name == function || candidate.Signature == function || candidateSelector == strings.ToLower(function) || (callSelector != "" && candidateSelector == callSelector) {
			if candidate.StateMutability != "pure" && candidate.StateMutability != "view" {
				return ContractCallResult{}, errors.New("local devnet runtime only supports pure/view function calls")
			}
			if artifact.ArtifactKind == contractPinnedArtifactKind {
				if !candidate.BytecodeSelectorMatched {
					return ContractCallResult{}, errors.New("compiled bytecode selector was not found in local deployed bytecode artifact")
				}
				if len(candidate.Inputs) > 0 && callSelector == "" {
					return ContractCallResult{}, errors.New("artifact-backed local runtime requires ABI calldata for functions with inputs")
				}
				if bytecode, ok := hardhatDeployedBytecode(artifact.CompilerArtifact.ArtifactPath); ok {
					callData := candidate.Selector
					if callSelector != "" {
						callData = normalizedCallData
					}
					staticResult, err := runStaticEVMSubset(bytecode, callData, artifact.RuntimeStorage)
					if err == nil {
						return ContractCallResult{
							Address:                 artifact.Address,
							Function:                candidate.Name,
							Signature:               candidate.Signature,
							Selector:                candidate.Selector,
							ReturnValue:             decodeContractReturn(staticResult.EncodedResult, candidate.Outputs),
							EncodedResult:           staticResult.EncodedResult,
							RuntimeMode:             artifact.RuntimeMode,
							ArtifactKind:            artifact.ArtifactKind,
							ExecutionStatus:         "evm_opcode_interpreter_staticcall_subset",
							ExecutionEngine:         "local-bounded-evm-opcode-interpreter",
							OpcodeStepCount:         staticResult.StepCount,
							BytecodeSelectorMatched: candidate.BytecodeSelectorMatched,
							Limitations:             artifact.Limitations,
						}, nil
					}
					if callSelector != "" || len(candidate.Inputs) > 0 {
						return ContractCallResult{}, fmt.Errorf("artifact-backed local EVM subset does not support this calldata/staticcall path: %w", err)
					}
				}
			}
			executionStatus := "source_analyzer_literal_return"
			if artifact.ArtifactKind == contractPinnedArtifactKind {
				executionStatus = "hardhat_abi_selector_matched_deployed_bytecode_staticcall_subset"
			}
			return ContractCallResult{
				Address:                 artifact.Address,
				Function:                candidate.Name,
				Signature:               candidate.Signature,
				Selector:                candidate.Selector,
				ReturnValue:             candidate.ReturnValue,
				EncodedResult:           encodeContractReturn(candidate.ReturnValue, candidate.Outputs),
				RuntimeMode:             artifact.RuntimeMode,
				ArtifactKind:            artifact.ArtifactKind,
				ExecutionStatus:         executionStatus,
				BytecodeSelectorMatched: candidate.BytecodeSelectorMatched,
				Limitations:             artifact.Limitations,
			}, nil
		}
	}
	return ContractCallResult{}, errors.New("function not found in local contract artifact")
}

func (d *Devnet) ExecuteContract(caller, address, callData string) (ContractCallResult, Transaction, error) {
	if strings.TrimSpace(caller) == "" || strings.TrimSpace(address) == "" || strings.TrimSpace(callData) == "" {
		return ContractCallResult{}, Transaction{}, errors.New("caller, address, and calldata are required")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	artifact, ok := d.contracts[address]
	if !ok {
		artifact, ok = d.contracts[evmAddressForLog(address)]
	}
	if !ok {
		return ContractCallResult{}, Transaction{}, errors.New("contract not found")
	}
	normalizedCallData := normalizeHex(callData)
	if len(normalizedCallData) < 10 {
		return ContractCallResult{}, Transaction{}, errors.New("contract execution requires ABI calldata")
	}
	callSelector := normalizedCallData[:10]
	for _, candidate := range artifact.Functions {
		if strings.ToLower(candidate.Selector) != callSelector {
			continue
		}
		if artifact.ArtifactKind != contractPinnedArtifactKind {
			return ContractCallResult{}, Transaction{}, errors.New("bounded local contract execution requires a pinned Hardhat artifact")
		}
		if !candidate.BytecodeSelectorMatched {
			return ContractCallResult{}, Transaction{}, errors.New("compiled bytecode selector was not found in local deployed bytecode artifact")
		}
		if candidate.StateMutability == "pure" || candidate.StateMutability == "view" {
			return ContractCallResult{}, Transaction{}, errors.New("bounded local contract execution only supports write-call state transitions; use eth_call or /ide/call for pure/view functions")
		}
		var transferTo string
		var transferAmount *big.Int
		var transferFromKey string
		var transferToKey string
		if candidate.Signature == "transfer(address,uint256)" {
			var err error
			transferTo, transferAmount, err = decodeERC20TransferCalldata(normalizedCallData)
			if err != nil {
				return ContractCallResult{}, Transaction{}, err
			}
			balanceSlot, ok := artifact.RuntimeStorageSlots["balanceOf"]
			if !ok {
				return ContractCallResult{}, Transaction{}, errors.New("balanceOf mapping storage slot is not recorded")
			}
			transferFromKey, ok = solidityMappingStorageKey(evmAddressForLog(caller), balanceSlot)
			if !ok {
				return ContractCallResult{}, Transaction{}, errors.New("caller is not a valid EVM address for balanceOf mapping storage")
			}
			transferToKey, ok = solidityMappingStorageKey(transferTo, balanceSlot)
			if !ok {
				return ContractCallResult{}, Transaction{}, errors.New("recipient is not a valid EVM address for balanceOf mapping storage")
			}
		}
		bytecode, ok := hardhatDeployedBytecode(artifact.CompilerArtifact.ArtifactPath)
		if !ok {
			return ContractCallResult{}, Transaction{}, errors.New("bounded local contract execution requires deployed bytecode")
		}
		transition, err := runStatefulEVMSubset(bytecode, normalizedCallData, caller, artifact.RuntimeStorage)
		if err != nil {
			return ContractCallResult{}, Transaction{}, fmt.Errorf("bounded local EVM state-transition subset does not support this calldata/write path: %w", err)
		}
		if candidate.Signature == "transfer(address,uint256)" && transition.EncodedResult != encodeContractReturn("true", candidate.Outputs) {
			return ContractCallResult{}, Transaction{}, errors.New("bounded local EVM state-transition subset did not return expected ERC20 transfer success")
		}
		if len(transition.StorageWrites) == 0 && transition.LogCount == 0 {
			return ContractCallResult{}, Transaction{}, errors.New("bounded local EVM state-transition subset did not record storage writes or logs")
		}
		if candidate.Signature == "transfer(address,uint256)" {
			if len(transition.StorageWrites) < 2 {
				return ContractCallResult{}, Transaction{}, errors.New("bounded local EVM state-transition subset did not record expected SSTORE writes")
			}
			if _, ok := transition.Storage[transferFromKey]; !ok {
				return ContractCallResult{}, Transaction{}, errors.New("bounded local EVM state-transition subset did not update caller balance storage")
			}
			if _, ok := transition.Storage[transferToKey]; !ok {
				return ContractCallResult{}, Transaction{}, errors.New("bounded local EVM state-transition subset did not update recipient balance storage")
			}
		}
		artifact.RuntimeStorage = transition.Storage
		d.contracts[artifact.Address] = artifact
		memo := boundedContractCallMemo(candidate.Signature)
		if candidate.Signature == "transfer(address,uint256)" {
			memo = contractCallMemo("erc20-transfer", caller, transferTo, transferAmount, transferEventTopic(artifact))
		}
		tx := d.newTxLocked("contract_call", caller, artifact.Address, 0, 2, nil, memo)
		d.pending = append(d.pending, tx)
		err = d.persistSnapshotLocked()
		d.recordPersistenceErrorLocked(err)
		result := ContractCallResult{
			Address:                 artifact.Address,
			Function:                candidate.Name,
			Signature:               candidate.Signature,
			Selector:                candidate.Selector,
			ReturnValue:             decodeContractReturn(transition.EncodedResult, candidate.Outputs),
			EncodedResult:           transition.EncodedResult,
			RuntimeMode:             artifact.RuntimeMode,
			ArtifactKind:            artifact.ArtifactKind,
			ExecutionStatus:         "bounded_local_evm_sstore_state_transition_subset",
			ExecutionEngine:         "local-bounded-evm-sstore-transition-interpreter",
			OpcodeStepCount:         transition.StepCount,
			TransactionHash:         tx.Hash,
			StateTransition:         "bytecode-subset-sstore-updated-local-storage-and-pending-contract-call-created",
			StorageWrites:           transition.StorageWrites,
			LogCount:                transition.LogCount,
			BytecodeSelectorMatched: candidate.BytecodeSelectorMatched,
			Limitations:             artifact.Limitations,
		}
		return result, tx, err
	}
	return ContractCallResult{}, Transaction{}, errors.New("function selector not found in local contract artifact")
}

func (d *Devnet) ProduceBlock() Block {
	d.mu.Lock()
	defer d.mu.Unlock()
	parent := d.blocks[len(d.blocks)-1]
	txs := append([]Transaction(nil), d.pending...)
	d.pending = nil
	validator := d.nextValidatorAddressLocked()
	block := Block{Height: parent.Height + 1, Hash: hashParts("block", fmt.Sprint(parent.Height+1), parent.Hash, fmt.Sprint(time.Now().UnixNano()), fmt.Sprint(len(txs)), validator), ParentHash: parent.Hash, Time: time.Now().UTC(), Validator: validator, Transactions: txs}
	logIndex := uint64(0)
	for i := range block.Transactions {
		block.Transactions[i].BlockHash = block.Hash
		block.Transactions[i].BlockNum = block.Height
		block.Transactions[i].Logs = d.evmLogsForTransactionLocked(block.Transactions[i], uint64(i), logIndex)
		logIndex += uint64(len(block.Transactions[i].Logs))
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

func (d *Devnet) nextValidatorAddressLocked() string {
	if len(d.validators) == 0 {
		return ValidatorAddress
	}
	active := make([]Validator, 0, len(d.validators))
	for _, validator := range d.validators {
		if validator.Active {
			active = append(active, validator)
		}
	}
	if len(active) == 0 {
		return d.validators[0].Address
	}
	blockIndex := len(d.blocks) - 1
	if blockIndex < 0 {
		blockIndex = 0
	}
	return active[blockIndex%len(active)].Address
}

func (d *Devnet) ensureValidatorAccountsLocked() {
	for _, validator := range d.validators {
		account := d.account(validator.Address)
		if account.Staked == 0 {
			account.Staked = validator.VotingPower * 10_000_000
		}
		if account.Balance == 0 {
			account.Balance = 10_000_000
		}
	}
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
	d.invoices, d.refunds, d.webhookSignatures, d.payEvents = snapshot.Invoices, snapshot.Refunds, snapshot.Webhooks, snapshot.PayEvents
	d.riskLabels, d.evidencePackets = snapshot.RiskLabels, snapshot.Evidence
	d.governanceRequests, d.trustAppeals, d.trackingReviews = snapshot.Governance, snapshot.Appeals, snapshot.Tracking
	d.aiPermissions, d.aiActions, d.transparencyEntries = snapshot.AIPerms, snapshot.AIActions, snapshot.Transp
	d.resourceDelegations, d.resourceRentals, d.resourceIncome, d.contracts = snapshot.Delegation, snapshot.Rentals, snapshot.Income, snapshot.Contracts
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
	snapshot := devnetSnapshot{Version: 1, SavedAt: time.Now().UTC(), Config: d.cfg, Blocks: d.blocks, Pending: d.pending, Accounts: d.accounts, Validators: d.validators, Lots: d.lots, PayIntents: d.payIntents, Invoices: d.invoices, Refunds: d.refunds, Webhooks: d.webhookSignatures, PayEvents: d.payEvents, RiskLabels: d.riskLabels, Evidence: d.evidencePackets, Governance: d.governanceRequests, Appeals: d.trustAppeals, Tracking: d.trackingReviews, AIPerms: d.aiPermissions, AIActions: d.aiActions, Transp: d.transparencyEntries, Delegation: d.resourceDelegations, Rentals: d.resourceRentals, Income: d.resourceIncome, Contracts: d.contracts}
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
	if d.webhookSignatures == nil {
		d.webhookSignatures = map[string]WebhookSignature{}
	}
	if d.payEvents == nil {
		d.payEvents = map[string]PayEvent{}
	}
	if d.riskLabels == nil {
		d.riskLabels = map[string][]RiskLabel{}
	}
	if d.evidencePackets == nil {
		d.evidencePackets = map[string]EvidencePacket{}
	}
	if d.governanceRequests == nil {
		d.governanceRequests = map[string]GovernanceRequest{}
	}
	if d.trustAppeals == nil {
		d.trustAppeals = map[string]TrustAppeal{}
	}
	if d.trackingReviews == nil {
		d.trackingReviews = map[string]TrackingPolicyReview{}
	}
	if d.aiPermissions == nil {
		d.aiPermissions = map[string]AIPermissionGrant{}
	}
	if d.aiActions == nil {
		d.aiActions = map[string]AIActionProposal{}
	}
	if d.transparencyEntries == nil {
		d.transparencyEntries = map[string]TransparencyEntry{}
	}
	if d.resourceDelegations == nil {
		d.resourceDelegations = map[string]ResourceDelegation{}
	}
	if d.resourceRentals == nil {
		d.resourceRentals = map[string]ResourceRental{}
	}
	if d.resourceIncome == nil {
		d.resourceIncome = map[string]ResourceIncomeRecord{}
	}
	if d.contracts == nil {
		d.contracts = map[string]ContractArtifact{}
	}
	if len(d.validators) == 0 {
		d.validators = DefaultValidators()
	}
	for i := range d.validators {
		if strings.TrimSpace(d.validators[i].Moniker) == "" {
			d.validators[i].Moniker = fmt.Sprintf("ynx-validator-%d", i)
		}
		if d.validators[i].VotingPower <= 0 {
			d.validators[i].VotingPower = 1
		}
	}
	for _, account := range d.accounts {
		if account.Lots == nil {
			account.Lots = map[string]int64{}
		}
	}
	if _, ok := d.accounts[ProtocolResourceProvider]; !ok {
		d.accounts[ProtocolResourceProvider] = &Account{Address: ProtocolResourceProvider, Balance: 0, Staked: 10_000_000, Lots: map[string]int64{}}
	}
	if _, ok := d.accounts[ProtocolResourceTreasury]; !ok {
		d.accounts[ProtocolResourceTreasury] = &Account{Address: ProtocolResourceTreasury, Balance: 0, Lots: map[string]int64{}}
	}
	d.ensureValidatorAccountsLocked()
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

func (d *Devnet) activeDelegatedYNXTLocked(provider string) int64 {
	total := int64(0)
	for _, delegation := range d.resourceDelegations {
		if delegation.Provider == provider && delegation.Status == "active" {
			total += delegation.AmountYNXT
		}
	}
	return total
}

func (d *Devnet) newTransparencyEntryLocked(entryType, requestID, appealID, subject, action string, classification RequestValidityStatus, status string, reasons []string) TransparencyEntry {
	entry := TransparencyEntry{
		ID:             hashParts("transparency", entryType, requestID, appealID, subject, action, fmt.Sprint(time.Now().UnixNano()))[:24],
		Type:           entryType,
		RequestID:      requestID,
		AppealID:       appealID,
		Subject:        subject,
		Action:         action,
		Classification: classification,
		Status:         status,
		Reasons:        append([]string(nil), reasons...),
		CreatedAt:      time.Now().UTC(),
	}
	d.transparencyEntries[entry.ID] = entry
	return entry
}

func (d *Devnet) findPayIntentByIdempotencyLocked(merchant, idempotencyKey string) (PayIntent, bool) {
	if idempotencyKey == "" {
		return PayIntent{}, false
	}
	for _, intent := range d.payIntents {
		if intent.Merchant == merchant && intent.IdempotencyKey == idempotencyKey {
			return intent, true
		}
	}
	return PayIntent{}, false
}

func (d *Devnet) findInvoiceByIdempotencyLocked(intentID, idempotencyKey string) (Invoice, bool) {
	if idempotencyKey == "" {
		return Invoice{}, false
	}
	for _, invoice := range d.invoices {
		if invoice.IntentID == intentID && invoice.IdempotencyKey == idempotencyKey {
			return invoice, true
		}
	}
	return Invoice{}, false
}

func (d *Devnet) findRefundByIdempotencyLocked(intentID, idempotencyKey string) (RefundRecord, bool) {
	if idempotencyKey == "" {
		return RefundRecord{}, false
	}
	for _, refund := range d.refunds {
		if refund.IntentID == intentID && refund.IdempotencyKey == idempotencyKey {
			return refund, true
		}
	}
	return RefundRecord{}, false
}

func (d *Devnet) findWebhookByIdempotencyLocked(intentID, eventType, idempotencyKey string) (WebhookSignature, bool) {
	if idempotencyKey == "" {
		return WebhookSignature{}, false
	}
	for _, signature := range d.webhookSignatures {
		if signature.IntentID == intentID && signature.EventType == eventType && signature.IdempotencyKey == idempotencyKey {
			return signature, true
		}
	}
	return WebhookSignature{}, false
}

func (d *Devnet) recordPayEventLocked(eventType, intentID, objectID, merchant string, amount int64, currency, idempotencyKey string, createdAt time.Time) PayEvent {
	event := PayEvent{
		ID:             hashParts("pay-event", eventType, intentID, objectID, idempotencyKey, fmt.Sprint(createdAt.UnixNano()))[:24],
		Type:           eventType,
		IntentID:       intentID,
		ObjectID:       objectID,
		Merchant:       merchant,
		Amount:         amount,
		Currency:       currency,
		IdempotencyKey: idempotencyKey,
		CreatedAt:      createdAt,
	}
	event.AuditHash = hashParts("pay-event-audit", event.Type, event.IntentID, event.ObjectID, event.Merchant, fmt.Sprint(event.Amount), event.Currency, event.IdempotencyKey, event.CreatedAt.Format(time.RFC3339Nano))
	d.payEvents[event.ID] = event
	return event
}

func (d *Devnet) evmLogsForTransactionLocked(tx Transaction, txIndex, firstLogIndex uint64) []EVMLog {
	if tx.Hash == "" || tx.BlockHash == "" || tx.BlockNum == 0 {
		return nil
	}
	log := EVMLog{
		Address:          evmAddressForLog(tx.To),
		Topics:           []string{evmTopic("ynx.tx." + tx.Type), evmTopic(tx.From), evmTopic(tx.To)},
		Data:             evmLogData(tx.Amount),
		BlockHash:        evmHash(tx.BlockHash),
		BlockNumber:      tx.BlockNum,
		TransactionHash:  tx.Hash,
		TransactionIndex: txIndex,
		LogIndex:         firstLogIndex,
		Removed:          false,
	}
	if tx.Type == "faucet" {
		log.Address = evmAddressForLog(FaucetAddress)
	}
	if tx.Type == "resource_delegate" || tx.Type == "resource_rent" {
		log.Address = evmAddressForLog(ProtocolResourceProvider)
	}
	if strings.HasPrefix(tx.Type, "contract_") && strings.HasPrefix(tx.To, "0x") {
		log.Address = evmAddressForLog(tx.To)
	}
	logs := []EVMLog{log}
	if tx.Type == "contract_call" && strings.HasPrefix(tx.Memo, "erc20-transfer:") {
		if transferLog, ok := erc20TransferLogFromMemo(tx, txIndex, firstLogIndex+uint64(len(logs))); ok {
			logs = append(logs, transferLog)
		}
	}
	if tx.Type == "contract_deploy" && strings.HasPrefix(tx.To, "0x") {
		artifact, ok := d.contracts[tx.To]
		if ok {
			logs = append(logs, contractEventLogs(tx, artifact, txIndex, firstLogIndex+uint64(len(logs)))...)
		}
	}
	return logs
}

func contractEventLogs(tx Transaction, artifact ContractArtifact, txIndex, firstLogIndex uint64) []EVMLog {
	address := evmAddressForLog(artifact.Address)
	logs := []EVMLog{{
		Address:          address,
		Topics:           []string{evmTopic("event:YNXContractDeployed(address,string)"), evmTopic(artifact.Deployer), evmTopic(artifact.Address)},
		Data:             evmHexData(artifact.SourceHash),
		BlockHash:        evmHash(tx.BlockHash),
		BlockNumber:      tx.BlockNum,
		TransactionHash:  tx.Hash,
		TransactionIndex: txIndex,
		LogIndex:         firstLogIndex,
		Removed:          false,
	}}
	nextIndex := firstLogIndex + 1
	for _, event := range artifact.Events {
		topics := []string{event.Topic, evmTopic(artifact.Deployer), evmTopic(artifact.Address)}
		logs = append(logs, EVMLog{
			Address:          address,
			Topics:           topics,
			Data:             evmHexData(event.Signature),
			BlockHash:        evmHash(tx.BlockHash),
			BlockNumber:      tx.BlockNum,
			TransactionHash:  tx.Hash,
			TransactionIndex: txIndex,
			LogIndex:         nextIndex,
			Removed:          false,
		})
		nextIndex++
	}
	return logs
}

func erc20TransferLogFromMemo(tx Transaction, txIndex, logIndex uint64) (EVMLog, bool) {
	parts := strings.Split(tx.Memo, ":")
	if len(parts) != 6 || parts[0] != "erc20-transfer" {
		return EVMLog{}, false
	}
	amount, ok := new(big.Int).SetString(parts[4], 10)
	if !ok {
		return EVMLog{}, false
	}
	return EVMLog{
		Address:          evmAddressForLog(tx.To),
		Topics:           []string{parts[5], evmTopic(parts[2]), evmTopic(parts[3])},
		Data:             "0x" + hex.EncodeToString(intToBytes32(amount)),
		BlockHash:        evmHash(tx.BlockHash),
		BlockNumber:      tx.BlockNum,
		TransactionHash:  tx.Hash,
		TransactionIndex: txIndex,
		LogIndex:         logIndex,
		Removed:          false,
	}, true
}

var contractEventPattern = regexp.MustCompile(`(?s)event\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*?)\)\s*;`)
var contractFunctionPattern = regexp.MustCompile(`(?s)function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*?)\)\s*(public|external|internal|private)?\s*(pure|view|payable)?\s*(?:returns\s*\((.*?)\))?\s*\{(.*?)\}`)

func buildContractArtifact(address, deployer, name, source string, verified bool, verifiedAt *time.Time) ContractArtifact {
	return buildContractArtifactWithArgs(address, deployer, name, source, verified, verifiedAt, nil)
}

func buildContractArtifactWithArgs(address, deployer, name, source string, verified bool, verifiedAt *time.Time, constructorArgs []string) ContractArtifact {
	sourceHash := hashParts("source", source)
	compiler := SolidityCompilerConfig()
	compilerArtifact, hasCompilerArtifact := resolvePinnedCompilerArtifact(name, source)
	events := extractContractEvents(source)
	functions := extractContractFunctions(source)
	runtimeStorageSlots := extractRuntimeStorageSlots(source)
	runtimeStorage := extractRuntimeStorage(source, deployer, constructorArgs)
	if hasCompilerArtifact {
		functions = mergeCompilerArtifactFunctions(compilerArtifact.ABIFunctions, functions, source)
	}
	abi := make([]ContractABIEntry, 0, len(events)+len(functions))
	for _, event := range events {
		abi = append(abi, ContractABIEntry{Type: "event", Name: event.Name, Signature: event.Signature, Topic: event.Topic, Inputs: event.Inputs})
	}
	for _, function := range functions {
		abi = append(abi, ContractABIEntry{Type: "function", Name: function.Name, Signature: function.Signature, Selector: function.Selector, Inputs: function.Inputs, Outputs: function.Outputs, StateMutability: function.StateMutability})
	}
	status := "unverified"
	reproducibilityStatus := "unverified; pinned compiler config recorded but source match has not been checked"
	artifactKind := contractArtifactKind
	compilerMode := compiler.CompilerMode
	compilerExecutionStatus := "hardhat_artifact_not_found_for_submitted_source"
	bytecodeHash := hashParts("bytecode", compiler.ConfigHash, contractArtifactKind, sourceHash, strings.Join(contractFunctionSignatures(functions), "|"))
	deployedBytecodeHash := hashParts("deployed-bytecode", compiler.ConfigHash, contractArtifactKind, sourceHash, strings.Join(contractFunctionSignatures(functions), "|"))
	deployedComparisonStatus := "not_checked_no_pinned_solc_artifact"
	if hasCompilerArtifact {
		artifactKind = contractPinnedArtifactKind
		compilerMode = contractPinnedCompilerMode
		compilerExecutionStatus = "matched_existing_hardhat_solc_0_8_24_artifact"
		bytecodeHash = compilerArtifact.BytecodeHash
		deployedBytecodeHash = compilerArtifact.DeployedBytecodeHash
		deployedComparisonStatus = "not_checked_until_verify"
		reproducibilityStatus = "pinned Hardhat artifact matched submitted source; deployed bytecode comparison not checked until verification"
	}
	if verified {
		status = "source_hash_and_pinned_compiler_config_matched_local_artifact"
		reproducibilityStatus = "source hash and pinned compiler config matched local deterministic artifact"
		if hasCompilerArtifact {
			status = "source_hash_compiler_config_and_deployed_bytecode_matched_local_artifact"
			reproducibilityStatus = "source hash, pinned compiler config, artifact bytecode, and local deployed bytecode hash matched"
			deployedComparisonStatus = "matched_local_deployed_bytecode_hash"
		}
	}
	limitations := append([]string{
		"compiler version/settings are pinned and hashed; arbitrary IDE snippets remain analyzer artifacts unless they match a Hardhat artifact",
		"runtime supports simple pure/view return literals for devnet verification",
	}, compiler.Limitations...)
	if hasCompilerArtifact {
		limitations = append([]string{
			"matched repository Hardhat artifact with pinned Solidity 0.8.24 bytecode hashes",
			"artifact-backed local staticcall subset requires the ABI selector to appear in solc deployed bytecode",
			"local devnet interprets a bounded read-only EVM opcode subset for supported static calls, simple constructor-seeded storage, and mapping/SHA3-backed reads; it also supports a generic pinned-artifact write-call subset for supported nonpayable/payable calldata through the local EVM subset with CALLER, SLOAD, SSTORE, LOG, and RETURN coverage, but it does not support full EVM bytecode state transitions, arbitrary opcode coverage, complex dynamic storage layouts, or remote public proof",
		}, compiler.Limitations...)
	}
	runtimeMode := "deterministic-devnet-pure-view-runtime"
	if hasCompilerArtifact {
		runtimeMode = "hardhat-artifact-local-evm-opcode-staticcall-subset"
	}
	return ContractArtifact{
		Address:                          address,
		Name:                             name,
		Deployer:                         deployer,
		SourceHash:                       sourceHash,
		BytecodeHash:                     bytecodeHash,
		DeployedBytecodeHash:             deployedBytecodeHash,
		ArtifactHash:                     hashParts("artifact", compiler.ConfigHash, artifactKind, name, sourceHash, bytecodeHash, deployedBytecodeHash, fmt.Sprint(len(abi))),
		ArtifactKind:                     artifactKind,
		CompilerMode:                     compilerMode,
		CompilerConfigHash:               compiler.ConfigHash,
		Compiler:                         compiler,
		CompilerArtifact:                 compilerArtifact,
		CompilerExecutionStatus:          compilerExecutionStatus,
		RuntimeMode:                      runtimeMode,
		VerifierMode:                     compiler.VerifierMode,
		ReproducibleBuild:                verified,
		ReproducibilityStatus:            reproducibilityStatus,
		DeployedBytecodeComparisonStatus: deployedComparisonStatus,
		ConstructorArgs:                  cleanConstructorArgs(constructorArgs),
		RuntimeStorage:                   runtimeStorage,
		RuntimeStorageSlots:              runtimeStorageSlots,
		ABI:                              abi,
		Events:                           events,
		Functions:                        functions,
		Limitations:                      limitations,
		Verified:                         verified,
		VerifierStatus:                   status,
		DeployedAt:                       time.Now().UTC(),
		VerifiedAt:                       verifiedAt,
	}
}

func AnalyzeContractSource(name, source string) ContractArtifact {
	return buildContractArtifact("", "", name, source, false, nil)
}

func mergeCompilerArtifactFunctions(abiFunctions, sourceFunctions []ContractFunctionABI, source string) []ContractFunctionABI {
	returnValues := contractReturnValuesBySignature(sourceFunctions, source)
	functions := make([]ContractFunctionABI, 0, len(abiFunctions))
	for _, function := range abiFunctions {
		if value, ok := returnValues[function.Signature]; ok {
			function.ReturnValue = value
		}
		functions = append(functions, function)
	}
	return functions
}

func contractReturnValuesBySignature(sourceFunctions []ContractFunctionABI, source string) map[string]string {
	values := map[string]string{}
	for _, function := range sourceFunctions {
		if function.ReturnValue != "" {
			values[function.Signature] = function.ReturnValue
		}
	}
	for signature, value := range extractPublicGetterReturnValues(source) {
		values[signature] = value
	}
	return values
}

var publicGetterPattern = regexp.MustCompile(`(?m)\b(string|bool|uint(?:8|16|32|64|128|256)?)\s+public\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*([^;]+))?;`)
var publicStateSlotPattern = regexp.MustCompile(`(?m)\b((?:mapping\s*\([^;]+?\))|string|bool|uint(?:8|16|32|64|128|256)?)\s+public\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*([^;]+))?;`)

func extractPublicGetterReturnValues(source string) map[string]string {
	values := map[string]string{}
	matches := publicGetterPattern.FindAllStringSubmatch(source, -1)
	for _, match := range matches {
		if len(match) != 4 {
			continue
		}
		name := strings.TrimSpace(match[2])
		rawValue := strings.TrimSpace(match[3])
		if rawValue == "" {
			switch match[1] {
			case "string":
				rawValue = ""
			case "bool":
				rawValue = "false"
			default:
				rawValue = "0"
			}
		}
		values[name+"()"] = strings.Trim(strings.TrimSpace(rawValue), `"`)
	}
	return values
}

func extractRuntimeStorage(source, deployer string, constructorArgs []string) map[string]string {
	storage := map[string]string{}
	stateSlots := extractRuntimeStorageSlotMetadata(source)
	matches := publicStateSlotPattern.FindAllStringSubmatch(source, -1)
	for slot, match := range matches {
		if len(match) != 4 {
			continue
		}
		kind := strings.TrimSpace(match[1])
		rawValue := strings.Trim(strings.TrimSpace(match[3]), `"`)
		switch {
		case strings.HasPrefix(kind, "uint"):
			if rawValue == "" {
				rawValue = "0"
			}
			parsed, err := strconv.ParseUint(rawValue, 10, 64)
			if err == nil {
				storage[storageKey(big.NewInt(int64(slot)))] = fmt.Sprintf("0x%064x", parsed)
			}
		case kind == "bool":
			if strings.EqualFold(rawValue, "true") {
				storage[storageKey(big.NewInt(int64(slot)))] = "0x" + strings.Repeat("0", 63) + "1"
			} else {
				storage[storageKey(big.NewInt(int64(slot)))] = "0x" + strings.Repeat("0", 64)
			}
		}
	}
	applyConstructorArgsToRuntimeStorage(source, deployer, constructorArgs, stateSlots, storage)
	if len(storage) == 0 {
		return nil
	}
	return storage
}

func extractRuntimeStorageSlots(source string) map[string]int {
	slots := map[string]int{}
	for name, slot := range extractRuntimeStorageSlotMetadata(source) {
		slots[name] = slot.Slot
	}
	if len(slots) == 0 {
		return nil
	}
	return slots
}

func extractRuntimeStorageSlotMetadata(source string) map[string]struct {
	Kind string
	Slot int
} {
	stateSlots := map[string]struct {
		Kind string
		Slot int
	}{}
	matches := publicStateSlotPattern.FindAllStringSubmatch(source, -1)
	for slot, match := range matches {
		if len(match) != 4 {
			continue
		}
		stateSlots[strings.TrimSpace(match[2])] = struct {
			Kind string
			Slot int
		}{Kind: strings.TrimSpace(match[1]), Slot: slot}
	}
	return stateSlots
}

var constructorPattern = regexp.MustCompile(`(?s)constructor\s*\((.*?)\)\s*\{(.*?)\}`)
var constructorAssignmentPattern = regexp.MustCompile(`(?m)\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*;`)
var constructorMappingSenderAssignmentPattern = regexp.MustCompile(`(?m)\b([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*msg\.sender\s*\]\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*;`)

func applyConstructorArgsToRuntimeStorage(source, deployer string, constructorArgs []string, stateSlots map[string]struct {
	Kind string
	Slot int
}, storage map[string]string) {
	if len(constructorArgs) == 0 {
		return
	}
	match := constructorPattern.FindStringSubmatch(source)
	if len(match) != 3 {
		return
	}
	inputs := parseContractEventInputs(match[1])
	argValues := map[string]string{}
	for i, input := range inputs {
		if i >= len(constructorArgs) {
			break
		}
		argValues[input.Name] = strings.TrimSpace(constructorArgs[i])
	}
	for _, assignment := range constructorAssignmentPattern.FindAllStringSubmatch(match[2], -1) {
		if len(assignment) != 3 {
			continue
		}
		stateName := strings.TrimSpace(assignment[1])
		argName := strings.TrimSpace(assignment[2])
		slot, ok := stateSlots[stateName]
		if !ok || !strings.HasPrefix(slot.Kind, "uint") {
			continue
		}
		parsed, err := strconv.ParseUint(argValues[argName], 10, 64)
		if err != nil {
			continue
		}
		storage[storageKey(big.NewInt(int64(slot.Slot)))] = fmt.Sprintf("0x%064x", parsed)
	}
	for _, assignment := range constructorMappingSenderAssignmentPattern.FindAllStringSubmatch(match[2], -1) {
		if len(assignment) != 3 {
			continue
		}
		stateName := strings.TrimSpace(assignment[1])
		argName := strings.TrimSpace(assignment[2])
		slot, ok := stateSlots[stateName]
		if !ok || !strings.HasPrefix(slot.Kind, "mapping") || !strings.Contains(slot.Kind, "address") || !strings.Contains(slot.Kind, "uint") {
			continue
		}
		parsed, err := strconv.ParseUint(argValues[argName], 10, 64)
		if err != nil {
			continue
		}
		key, ok := solidityMappingStorageKey(evmAddressForLog(deployer), slot.Slot)
		if !ok {
			continue
		}
		storage[key] = fmt.Sprintf("0x%064x", parsed)
	}
}

func solidityMappingStorageKey(address string, slot int) (string, bool) {
	address = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(address)), "0x")
	if len(address) != 40 {
		return "", false
	}
	addressBytes, err := hex.DecodeString(address)
	if err != nil {
		return "", false
	}
	preimage := make([]byte, 64)
	copy(preimage[32-len(addressBytes):32], addressBytes)
	copy(preimage[32:64], intToBytes32(big.NewInt(int64(slot))))
	return "0x" + hex.EncodeToString(legacyKeccak256(preimage)), true
}

func decodeERC20TransferCalldata(callData string) (string, *big.Int, error) {
	raw, err := hex.DecodeString(strings.TrimPrefix(callData, "0x"))
	if err != nil || len(raw) != 68 {
		return "", nil, errors.New("transfer(address,uint256) calldata must be selector plus two ABI words")
	}
	recipient := "0x" + hex.EncodeToString(raw[16:36])
	amount := new(big.Int).SetBytes(raw[36:68])
	return recipient, amount, nil
}

func contractCallMemo(kind, from, to string, amount *big.Int, eventTopic string) string {
	return strings.Join([]string{kind, "v1", evmAddressForLog(from), evmAddressForLog(to), amount.Text(10), eventTopic}, ":")
}

func boundedContractCallMemo(signature string) string {
	return strings.Join([]string{"bounded-evm-call", "v1", strings.ReplaceAll(signature, ":", "_")}, ":")
}

func transferEventTopic(artifact ContractArtifact) string {
	for _, event := range artifact.Events {
		if event.Signature == "Transfer(address,address,uint256)" {
			return event.Topic
		}
	}
	return evmTopic("event:Transfer(address,address,uint256)")
}

func mustDecodeHexWord(value string) []byte {
	decoded, _ := hex.DecodeString(strings.TrimPrefix(value, "0x"))
	return decoded
}

func cleanConstructorArgs(args []string) []string {
	cleaned := make([]string, 0, len(args))
	for _, arg := range args {
		arg = strings.TrimSpace(arg)
		if arg != "" {
			cleaned = append(cleaned, arg)
		}
	}
	if len(cleaned) == 0 {
		return nil
	}
	return cleaned
}

func normalizeHex(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return ""
	}
	if !strings.HasPrefix(value, "0x") {
		value = "0x" + value
	}
	for _, char := range strings.TrimPrefix(value, "0x") {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return ""
		}
	}
	return value
}

func contractVerificationEvidence(artifact ContractArtifact) ContractVerificationEvidence {
	localStatus := "local-verifier-evidence"
	if artifact.CompilerArtifact != nil {
		localStatus = "local-hardhat-artifact-verifier-evidence"
	}
	return ContractVerificationEvidence{
		Address:                          artifact.Address,
		Name:                             artifact.Name,
		Verified:                         artifact.Verified,
		VerifierStatus:                   artifact.VerifierStatus,
		ArtifactKind:                     artifact.ArtifactKind,
		SourceHash:                       artifact.SourceHash,
		BytecodeHash:                     artifact.BytecodeHash,
		DeployedBytecodeHash:             artifact.DeployedBytecodeHash,
		ArtifactHash:                     artifact.ArtifactHash,
		CompilerConfigHash:               artifact.CompilerConfigHash,
		Compiler:                         artifact.Compiler,
		CompilerArtifact:                 artifact.CompilerArtifact,
		CompilerExecutionStatus:          artifact.CompilerExecutionStatus,
		VerifierMode:                     artifact.VerifierMode,
		ReproducibleBuild:                artifact.ReproducibleBuild,
		ReproducibilityStatus:            artifact.ReproducibilityStatus,
		DeployedBytecodeComparisonStatus: artifact.DeployedBytecodeComparisonStatus,
		LocalServiceStatus:               localStatus,
		RemotePublicProofStatus:          "not_remote_public_proof",
		Limitations: append([]string{
			"local verifier evidence only; public proof requires a deployed remote verifier or explorer-backed bytecode check",
			"local devnet does not claim mainnet launch or third-party verification",
		}, artifact.Limitations...),
		GeneratedAt: time.Now().UTC(),
	}
}

func extractContractEvents(source string) []ContractEventABI {
	matches := contractEventPattern.FindAllStringSubmatch(source, -1)
	events := make([]ContractEventABI, 0, len(matches))
	for _, match := range matches {
		if len(match) != 3 {
			continue
		}
		name := strings.TrimSpace(match[1])
		inputs := parseContractEventInputs(match[2])
		types := make([]string, 0, len(inputs))
		for _, input := range inputs {
			types = append(types, input.Type)
		}
		signature := fmt.Sprintf("%s(%s)", name, strings.Join(types, ","))
		events = append(events, ContractEventABI{Name: name, Signature: signature, Topic: evmTopic("event:" + signature), Inputs: inputs, Source: "solidity-source"})
	}
	return events
}

func parseContractEventInputs(raw string) []ContractEventInput {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	inputs := make([]ContractEventInput, 0, len(parts))
	for i, part := range parts {
		tokens := strings.Fields(strings.TrimSpace(part))
		if len(tokens) == 0 {
			continue
		}
		input := ContractEventInput{Name: fmt.Sprintf("arg%d", i), Type: tokens[0]}
		for _, token := range tokens[1:] {
			switch token {
			case "indexed":
				input.Indexed = true
			default:
				input.Name = token
			}
		}
		inputs = append(inputs, input)
	}
	return inputs
}

func extractContractFunctions(source string) []ContractFunctionABI {
	matches := contractFunctionPattern.FindAllStringSubmatch(source, -1)
	functions := make([]ContractFunctionABI, 0, len(matches))
	for _, match := range matches {
		if len(match) != 7 {
			continue
		}
		name := strings.TrimSpace(match[1])
		inputs := parseContractEventInputs(match[2])
		stateMutability := strings.TrimSpace(match[4])
		if stateMutability == "" {
			stateMutability = "nonpayable"
		}
		outputs := parseContractReturnTypes(match[5])
		types := make([]string, 0, len(inputs))
		for _, input := range inputs {
			types = append(types, input.Type)
		}
		signature := fmt.Sprintf("%s(%s)", name, strings.Join(types, ","))
		functions = append(functions, ContractFunctionABI{
			Name:            name,
			Signature:       signature,
			Selector:        "0x" + hashParts("evm-selector", signature)[:8],
			SelectorSource:  "local-deterministic-source-signature",
			Inputs:          inputs,
			Outputs:         outputs,
			StateMutability: stateMutability,
			ReturnValue:     extractSimpleReturnValue(match[6]),
		})
	}
	return functions
}

func parseContractReturnTypes(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	outputs := make([]string, 0, len(parts))
	for _, part := range parts {
		tokens := strings.Fields(strings.TrimSpace(part))
		if len(tokens) > 0 {
			outputs = append(outputs, tokens[0])
		}
	}
	return outputs
}

var simpleReturnPattern = regexp.MustCompile(`(?s)return\s+([^;]+)\s*;`)

func extractSimpleReturnValue(body string) string {
	match := simpleReturnPattern.FindStringSubmatch(body)
	if len(match) != 2 {
		return ""
	}
	return strings.Trim(strings.TrimSpace(match[1]), `"`)
}

func encodeContractReturn(value string, outputs []string) string {
	if len(outputs) == 0 {
		return "0x"
	}
	switch outputs[0] {
	case "uint256", "uint", "uint64", "uint32", "uint8":
		parsed, err := strconv.ParseUint(value, 10, 64)
		if err != nil {
			return "0x" + strings.Repeat("0", 64)
		}
		return fmt.Sprintf("0x%064x", parsed)
	case "bool":
		if strings.EqualFold(value, "true") {
			return "0x" + strings.Repeat("0", 63) + "1"
		}
		return "0x" + strings.Repeat("0", 64)
	default:
		return evmHexData(value)
	}
}

func decodeContractReturn(encoded string, outputs []string) string {
	if len(outputs) == 0 {
		return ""
	}
	payload, err := hex.DecodeString(strings.TrimPrefix(encoded, "0x"))
	if err != nil || len(payload) < 32 {
		return ""
	}
	word := new(big.Int).SetBytes(payload[:32])
	switch outputs[0] {
	case "uint256", "uint", "uint64", "uint32", "uint16", "uint8":
		return word.Text(10)
	case "bool":
		return strconv.FormatBool(word.Sign() != 0)
	default:
		return encoded
	}
}

func contractFunctionSignatures(functions []ContractFunctionABI) []string {
	signatures := make([]string, 0, len(functions))
	for _, function := range functions {
		signatures = append(signatures, function.Signature)
	}
	return signatures
}

func evmLogMatchesFilter(log EVMLog, filter EVMLogFilter) bool {
	if len(filter.Addresses) > 0 {
		matched := false
		for _, address := range filter.Addresses {
			if strings.EqualFold(log.Address, evmAddressForLog(address)) || strings.EqualFold(log.Address, address) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	for i, accepted := range filter.Topics {
		if len(accepted) == 0 {
			continue
		}
		if i >= len(log.Topics) {
			return false
		}
		matched := false
		for _, topic := range accepted {
			if strings.EqualFold(log.Topics[i], topic) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	return true
}

func evmAddressForLog(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if strings.HasPrefix(value, "0x") && len(value) == 42 {
		if _, err := hex.DecodeString(strings.TrimPrefix(value, "0x")); err == nil {
			return value
		}
	}
	return "0x" + hashParts("evm-address", value)[:40]
}

func evmTopic(value string) string {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "0x") && len(value) == 66 {
		if _, err := hex.DecodeString(strings.TrimPrefix(value, "0x")); err == nil {
			return strings.ToLower(value)
		}
	}
	return "0x" + hashParts("evm-topic", value)
}

func evmHash(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.TrimPrefix(value, "0x")
	if len(value) == 64 {
		if _, err := hex.DecodeString(value); err == nil {
			return "0x" + value
		}
	}
	return "0x" + hashParts("evm-hash", value)
}

func evmLogData(amount int64) string {
	if amount < 0 {
		amount = 0
	}
	return fmt.Sprintf("0x%064x", amount)
}

func evmHexData(value string) string {
	sum := sha256.Sum256([]byte(value))
	return "0x" + hex.EncodeToString(sum[:])
}

func classifyGovernanceRequest(input GovernanceRequestInput) (RequestValidityStatus, []string, bool, []string) {
	text := normalizeLower(strings.Join([]string{input.Action, input.AssetType, input.Scope, input.Description}, " "))
	reasons := []string{}
	notice := false
	if containsAny(text, "private key", "private keys", "seed phrase", "seed phrases", "mnemonic") {
		return RequestIllegalOrAbusive, []string{"request asks for private keys or seed phrases"}, true, []string{"protect-private-secrets"}
	}
	if containsAny(text, "bypass signature", "bypass user signature", "without signature", "skip signature") {
		return RequestIllegalOrAbusive, []string{"request asks to bypass user signatures"}, true, []string{"no-signature-bypass"}
	}
	if containsAny(text, "delete audit", "delete logs", "hide record", "hide request", "erase audit", "remove transparency") {
		return RequestIllegalOrAbusive, []string{"request asks to delete audit logs or hide request records"}, true, []string{"preserve-audit-transparency"}
	}
	if containsAny(text, "fake risk", "fabricate risk", "unsupported conclusion", "unsupported conclusions") {
		return RequestIllegalOrAbusive, []string{"request asks for fake risk labels or unsupported Trust conclusions"}, true, []string{"no-evidence-free-risk"}
	}
	if containsAny(text, "ai automatically punish", "auto punish", "automatic punish", "automatically punish") {
		return RequestIllegalOrAbusive, []string{"request asks AI or Trust to automatically punish users"}, true, []string{"no-ai-punishment"}
	}
	if containsAny(text, "all users", "all wallets", "entire chain", "bulk trace", "mass tracking", "everyone") {
		return RequestOverbroad, []string{"request scope is overbroad and not targeted to a specific subject or evidence set"}, true, []string{"targeted-scope-required"}
	}
	if isNativeYNXT(input.AssetType) && containsAny(text, "direct transfer", "transfer user", "confiscate", "seize", "freeze", "blacklist") {
		return RequestIllegalOrAbusive, []string{"native YNXT cannot be directly transferred, frozen, seized, or blacklisted by request"}, true, []string{"native-ynxt-no-direct-freeze"}
	}
	if len(cleanStrings(input.Evidence)) == 0 {
		return RequestInsufficientEvidence, []string{"request has no evidence references"}, true, []string{"evidence-required"}
	}
	if containsAny(text, "freeze", "blacklist", "seize", "punish", "risk label", "risk-label", "track", "trace") {
		reasons = append(reasons, "request affects user rights and requires governance review")
		notice = true
		return RequestRequiresReview, reasons, notice, []string{"governance-review-user-rights"}
	}
	if input.Subject == "" || input.Requester == "" {
		return RequestOutOfScope, []string{"request is missing requester or subject"}, true, []string{"requester-subject-required"}
	}
	return RequestValidUnderYNXChainLaw, []string{"request is scoped, evidence-backed, and does not bypass user custody"}, notice, []string{"scoped-evidence-backed-valid"}
}

func classifyTrackingPolicyReview(input TrackingPolicyReviewInput) (RequestValidityStatus, string, []string, []string) {
	text := normalizeLower(strings.Join([]string{input.Purpose, input.QueryType, input.Scope, input.Description}, " "))
	if len(cleanStrings(input.Evidence)) == 0 {
		return RequestInsufficientEvidence, "rejected", []string{"tracking request has no evidence references"}, []string{"tracking-evidence-required"}
	}
	if !input.MinimumNecessary {
		return RequestOverbroad, "rejected", []string{"tracking request does not satisfy minimum necessary data limits"}, []string{"tracking-minimum-necessary"}
	}
	if containsAny(text, "all users", "all wallets", "everyone", "bulk profile", "bulk profiling", "mass profile", "mass tracking") {
		return RequestOverbroad, "rejected", []string{"tracking request is overbroad or asks for bulk user profiling"}, []string{"tracking-no-bulk-profiling"}
	}
	if containsAny(text, "guilt", "convict", "co-conspirator", "accomplice", "permanent taint", "permanently taint", "sensitive inference", "personal sensitive", "bypass audit") {
		return RequestIllegalOrAbusive, "rejected", []string{"tracking request asks for unsupported conclusions, sensitive inference, permanent pollution, or audit bypass"}, []string{"tracking-no-unsupported-conclusions"}
	}
	if input.ConfidenceBps > 0 && input.ConfidenceBps < 5000 && containsAny(text, "punish", "block", "reject", "deny", "freeze") {
		return RequestIllegalOrAbusive, "rejected", []string{"low-confidence taint cannot be used as punitive or conclusive action"}, []string{"tracking-low-confidence-not-punitive"}
	}
	if input.Institutional || input.Sensitive || containsAny(text, "risk list", "watchlist", "batch", "enterprise api", "institutional") {
		return RequestRequiresReview, "pending_review", []string{"institutional, sensitive, or batch tracking requires audit and governance review"}, []string{"tracking-institutional-review"}
	}
	return RequestValidUnderYNXChainLaw, "logged", []string{"tracking request is purpose-limited, evidence-backed, scoped, and appealable"}, []string{"tracking-purpose-limited-valid"}
}

func classifyAIActionSensitivity(input AIActionProposalInput) (bool, []string) {
	text := normalizeLower(strings.Join([]string{input.Scope, input.ActionType, input.Description}, " "))
	reasons := []string{}
	if containsAny(text, "transfer", "send funds", "move value", "withdraw", "refund", "pay", "payment", "settle", "faucet", "mint") {
		reasons = append(reasons, "AI action may move value or change balances")
	}
	if containsAny(text, "trust label", "risk label", "label user", "taint", "appeal decision", "false positive", "tracking conclusion") {
		reasons = append(reasons, "AI action may affect Trust labels or user risk state")
	}
	if containsAny(text, "private", "sensitive data", "personal data", "seed phrase", "private key", "pii", "export evidence", "case file") {
		reasons = append(reasons, "AI action may expose sensitive data or protected evidence")
	}
	if len(reasons) == 0 {
		return false, []string{"AI action is non-sensitive but remains audit logged"}
	}
	return true, append(reasons, "explicit scoped permission is required before execution")
}

func aiPermissionMatchesAction(grant AIPermissionGrant, proposal AIActionProposal, now time.Time) bool {
	if grant.Status != "active" || !grant.ExpiresAt.After(now) {
		return false
	}
	if grant.SessionID != proposal.SessionID || grant.Requester != proposal.Requester {
		return false
	}
	return grant.Scope == proposal.Scope || grant.Scope == "all_sensitive_actions"
}

func aiActionAuditHash(proposal AIActionProposal) string {
	approvedAt := ""
	if proposal.ApprovedAt != nil {
		approvedAt = proposal.ApprovedAt.Format(time.RFC3339Nano)
	}
	rejectedAt := ""
	if proposal.RejectedAt != nil {
		rejectedAt = proposal.RejectedAt.Format(time.RFC3339Nano)
	}
	return hashParts("ai-action-audit", proposal.ID, proposal.SessionID, proposal.Requester, proposal.Scope, proposal.ActionType, proposal.Status, fmt.Sprint(proposal.Executable), proposal.PermissionID, approvedAt, proposal.ApprovedBy, rejectedAt, proposal.RejectedBy, strings.Join(proposal.Reasons, "|"))
}

func newRiskLabelLocked(input RiskLabelInput, now time.Time) RiskLabel {
	appealAvailable := true
	if input.AppealAvailable != nil {
		appealAvailable = *input.AppealAvailable
	}
	var expiresAt *time.Time
	if input.ExpiryHours > 0 {
		expiry := now.Add(time.Duration(input.ExpiryHours) * time.Hour)
		expiresAt = &expiry
	}
	if input.ConfidenceBps == 0 {
		input.ConfidenceBps = 5000
	}
	if input.LabelType == "" {
		input.LabelType = "risk"
	}
	if input.Severity == "" {
		input.Severity = severityForRiskWeight(input.RiskWeightBps)
	}
	if input.DisputeStatus == "" {
		input.DisputeStatus = "not_disputed"
	}
	if input.LegalStatusUnderYNXChainLaw == "" {
		input.LegalStatusUnderYNXChainLaw = "advisory_label_only_not_criminal_determination"
	}
	if input.AssetEffect == "" {
		input.AssetEffect = "none_advisory_only"
	}
	return RiskLabel{
		ID:                               hashParts("risk-label", input.Subject, input.Label, input.Source, fmt.Sprint(now.UnixNano()))[:24],
		Subject:                          input.Subject,
		Address:                          input.Address,
		Label:                            input.Label,
		LabelType:                        input.LabelType,
		Severity:                         input.Severity,
		RiskWeightBps:                    input.RiskWeightBps,
		ConfidenceBps:                    input.ConfidenceBps,
		Source:                           input.Source,
		EvidenceHash:                     input.EvidenceHash,
		CreatedAt:                        now,
		UpdatedAt:                        now,
		ExpiresAt:                        expiresAt,
		ReviewRequired:                   input.ReviewRequired,
		AppealAvailable:                  appealAvailable,
		DisputeStatus:                    input.DisputeStatus,
		LegalStatusUnderYNXChainLaw:      input.LegalStatusUnderYNXChainLaw,
		RejectedExternalRequestReference: input.RejectedExternalRequestReference,
		AssetEffect:                      input.AssetEffect,
	}
}

func trustRiskSummary(subject string, labels []RiskLabel, now time.Time) TrustRiskSummary {
	summary := TrustRiskSummary{
		Subject:     subject,
		AppealPath:  "/trust/appeals",
		AssetEffect: "none_advisory_only",
		Conclusion:  "NO_ACTIVE_CONCLUSIVE_RISK",
		GeneratedAt: now,
		ReviewerNotes: []string{
			"Trust labels are advisory metadata only and cannot freeze, seize, confiscate, transfer, or criminally classify users.",
			"Reviewers must inspect source, evidence hash, confidence, expiry, and appeal status before relying on any label.",
		},
	}
	for _, label := range labels {
		if label.RiskWeightBps > summary.HighestLabelRiskWeightBps {
			summary.HighestLabelRiskWeightBps = label.RiskWeightBps
		}
		if label.ConfidenceBps > summary.HighestConfidenceBps {
			summary.HighestConfidenceBps = label.ConfidenceBps
		}
		if label.ExpiresAt != nil && !label.ExpiresAt.After(now) {
			summary.ExpiredLabelCount++
			summary.ExpiredLabelIDs = append(summary.ExpiredLabelIDs, label.ID)
			summary.NonConclusiveLabelIDs = append(summary.NonConclusiveLabelIDs, label.ID)
			continue
		}
		if strings.Contains(label.LabelType, "correction") || strings.Contains(label.Label, "false-positive") || strings.Contains(label.Label, "reduced") {
			summary.CorrectionLabelCount++
		}
		if label.ReviewRequired || label.DisputeStatus == "disputed" || label.DisputeStatus == "under_review" {
			summary.HasOpenReview = true
		}
		if label.ConfidenceBps < 5000 {
			summary.LowConfidenceLabelCount++
			summary.NonConclusiveLabelIDs = append(summary.NonConclusiveLabelIDs, label.ID)
			continue
		}
		if label.EvidenceHash != "" && !containsStringValue(summary.ActiveEvidenceHashes, label.EvidenceHash) {
			summary.ActiveEvidenceHashes = append(summary.ActiveEvidenceHashes, label.EvidenceHash)
		}
		summary.ActiveLabelCount++
		weighted := label.RiskWeightBps * label.ConfidenceBps / 10000
		if weighted > summary.EffectiveRiskWeightBps {
			summary.EffectiveRiskWeightBps = weighted
		}
	}
	if summary.ActiveLabelCount > 0 {
		switch {
		case summary.EffectiveRiskWeightBps >= 7500:
			summary.Conclusion = "HIGH_ADVISORY_RISK_REQUIRES_HUMAN_REVIEW"
		case summary.EffectiveRiskWeightBps >= 1000:
			summary.Conclusion = "ADVISORY_RISK_REQUIRES_CONTEXT_REVIEW"
		default:
			summary.Conclusion = "LOW_ADVISORY_RISK_NOT_CONCLUSIVE"
		}
	}
	if summary.ExpiredLabelCount > 0 {
		summary.ReviewerNotes = append(summary.ReviewerNotes, "Expired labels are retained for audit history but excluded from active risk scoring.")
	}
	if summary.LowConfidenceLabelCount > 0 {
		summary.ReviewerNotes = append(summary.ReviewerNotes, "Labels below 5000 confidence bps are non-conclusive and cannot be used for punitive decisions.")
	}
	if summary.CorrectionLabelCount > 0 {
		summary.ReviewerNotes = append(summary.ReviewerNotes, "Appeal correction labels reduce or remove prior risk and must be shown to reviewers.")
	}
	if summary.HasOpenReview {
		summary.ReviewerNotes = append(summary.ReviewerNotes, "At least one label requires review or is disputed; use the appeal path before any external action.")
	}
	return summary
}

func severityForRiskWeight(riskWeightBps int64) string {
	switch {
	case riskWeightBps >= 7500:
		return "critical"
	case riskWeightBps >= 5000:
		return "high"
	case riskWeightBps >= 1000:
		return "medium"
	case riskWeightBps > 0:
		return "low"
	default:
		return "none"
	}
}

func containsStringValue(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func isRejectedClassification(status RequestValidityStatus) bool {
	switch status {
	case RequestInsufficientEvidence, RequestOutOfScope, RequestOverbroad, RequestIllegalOrAbusive, RequestRejected:
		return true
	default:
		return false
	}
}

func containsAny(text string, terms ...string) bool {
	for _, term := range terms {
		if strings.Contains(text, term) {
			return true
		}
	}
	return false
}

func isNativeYNXT(assetType string) bool {
	asset := normalizeLower(assetType)
	return asset == "" || asset == "ynxt" || asset == "native" || asset == "native ynxt" || asset == "native_ynxt"
}

func normalizeLower(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func cleanStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func appendUnique(values []string, additions ...string) []string {
	out := append([]string(nil), values...)
	seen := map[string]struct{}{}
	for _, value := range out {
		seen[value] = struct{}{}
	}
	for _, value := range additions {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
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
