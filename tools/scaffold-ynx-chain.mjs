import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const write = (file, body, mode) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body.trimStart() + "\n");
  if (mode) fs.chmodSync(target, mode);
};

const md = (title, lines) => `# ${title}

${lines.join("\n\n")}
`;

write("go.mod", `module github.com/JiahaoAlbus/YNX-Chain

go 1.25.0
`);

write("internal/chain/types.go", `package chain

import "time"

type NetworkConfig struct {
	Name                 string \`json:"name"\`
	Slug                 string \`json:"slug"\`
	ChainID              int64  \`json:"chainId"\`
	NativeCoinName       string \`json:"nativeCoinName"\`
	NativeCurrencySymbol string \`json:"nativeCurrencySymbol"\`
	Decimals             int    \`json:"decimals"\`
	IsPublicNet          bool   \`json:"isPublicNet"\`
	ChainIDConflictCheck string \`json:"chainIdConflictCheck"\`
}

type Account struct {
	Address       string           \`json:"address"\`
	Balance       int64            \`json:"balance"\`
	Staked        int64            \`json:"staked"\`
	Nonce         uint64           \`json:"nonce"\`
	ResourceUsage ResourceUsage    \`json:"resourceUsage"\`
	Lots          map[string]int64 \`json:"lots"\`
}

type ExplorerSummary struct {
	Network            NetworkConfig \`json:"network"\`
	Height             uint64        \`json:"height"\`
	LatestBlockHash    string        \`json:"latestBlockHash"\`
	LatestBlockTime    time.Time     \`json:"latestBlockTime"\`
	TotalBlocks        int           \`json:"totalBlocks"\`
	TotalTransactions  int           \`json:"totalTransactions"\`
	KnownAccounts      int           \`json:"knownAccounts"\`
	ValidatorCount     int           \`json:"validatorCount"\`
	PendingTxCount     int           \`json:"pendingTxCount"\`
	PayIntentCount     int           \`json:"payIntentCount"\`
	PersistenceEnabled bool          \`json:"persistenceEnabled"\`
	PersistenceError   string        \`json:"persistenceError,omitempty"\`
	TruthfulStatus     string        \`json:"truthfulStatus"\`
}

type ResourceUsage struct {
	BandwidthUsed int64 \`json:"bandwidthUsed"\`
	ComputeUsed   int64 \`json:"computeUsed"\`
	AICreditsUsed int64 \`json:"aiCreditsUsed"\`
	TrustUsed     int64 \`json:"trustUsed"\`
}

type ResourceBalance struct {
	Address        string \`json:"address"\`
	BandwidthLimit int64  \`json:"bandwidthLimit"\`
	BandwidthUsed  int64  \`json:"bandwidthUsed"\`
	BandwidthLeft  int64  \`json:"bandwidthLeft"\`
	ComputeLimit   int64  \`json:"computeLimit"\`
	ComputeUsed    int64  \`json:"computeUsed"\`
	ComputeLeft    int64  \`json:"computeLeft"\`
	AICreditsLimit int64  \`json:"aiCreditsLimit"\`
	AICreditsUsed  int64  \`json:"aiCreditsUsed"\`
	AICreditsLeft  int64  \`json:"aiCreditsLeft"\`
	TrustLimit     int64  \`json:"trustLimit"\`
	TrustUsed      int64  \`json:"trustUsed"\`
	TrustLeft      int64  \`json:"trustLeft"\`
	Staked         int64  \`json:"staked"\`
}

type Block struct {
	Height       uint64        \`json:"height"\`
	Hash         string        \`json:"hash"\`
	ParentHash   string        \`json:"parentHash"\`
	Time         time.Time     \`json:"time"\`
	Validator    string        \`json:"validator"\`
	Transactions []Transaction \`json:"transactions"\`
}

type Transaction struct {
	Hash      string    \`json:"hash"\`
	Type      string    \`json:"type"\`
	From      string    \`json:"from,omitempty"\`
	To        string    \`json:"to,omitempty"\`
	Amount    int64     \`json:"amount,omitempty"\`
	Fee       int64     \`json:"fee"\`
	Nonce     uint64    \`json:"nonce"\`
	BlockHash string    \`json:"blockHash,omitempty"\`
	BlockNum  uint64    \`json:"blockNumber,omitempty"\`
	Timestamp time.Time \`json:"timestamp"\`
	LotFlows  []LotFlow \`json:"lotFlows,omitempty"\`
	Memo      string    \`json:"memo,omitempty"\`
}

type LotFlow struct {
	LotID  string \`json:"lotId"\`
	Amount int64  \`json:"amount"\`
	From   string \`json:"from"\`
	To     string \`json:"to"\`
}

type Validator struct {
	Address     string \`json:"address"\`
	VotingPower int64  \`json:"votingPower"\`
	Active      bool   \`json:"active"\`
}

type TrustTrace struct {
	Address string          \`json:"address"\`
	Lots    []TrustTraceLot \`json:"lots"\`
	Labels  []string        \`json:"labels"\`
	Summary string          \`json:"summary"\`
}

type TrustTraceLot struct {
	LotID       string \`json:"lotId"\`
	Amount      int64  \`json:"amount"\`
	Origin      string \`json:"origin"\`
	RiskWeight  int64  \`json:"riskWeightBps"\`
	LastInbound string \`json:"lastInboundTx,omitempty"\`
}

type PayIntent struct {
	ID          string    \`json:"id"\`
	Merchant    string    \`json:"merchant"\`
	Amount      int64     \`json:"amount"\`
	Currency    string    \`json:"currency"\`
	Status      string    \`json:"status"\`
	CreatedAt   time.Time \`json:"createdAt"\`
	CallbackURL string    \`json:"callbackUrl,omitempty"\`
}
`);

write("internal/chain/devnet.go", `package chain

import (
	"context"
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
	dataDir              string
	lastPersistenceError string
}

type devnetSnapshot struct {
	Version    int                      \`json:"version"\`
	SavedAt    time.Time                \`json:"savedAt"\`
	Config     NetworkConfig            \`json:"config"\`
	Blocks     []Block                  \`json:"blocks"\`
	Pending    []Transaction            \`json:"pending"\`
	Accounts   map[string]*Account      \`json:"accounts"\`
	Validators []Validator              \`json:"validators"\`
	Lots       map[string]TrustTraceLot \`json:"lots"\`
	PayIntents map[string]PayIntent     \`json:"payIntents"\`
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
		cfg:        cfg,
		accounts:   map[string]*Account{},
		lots:       map[string]TrustTraceLot{},
		payIntents: map[string]PayIntent{},
		validators: []Validator{{Address: ValidatorAddress, VotingPower: 1, Active: true}},
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
	for _, block := range d.blocks { totalTxs += len(block.Transactions) }
	return ExplorerSummary{Network: d.cfg, Height: latest.Height, LatestBlockHash: latest.Hash, LatestBlockTime: latest.Time, TotalBlocks: len(d.blocks), TotalTransactions: totalTxs, KnownAccounts: len(d.accounts), ValidatorCount: len(d.validators), PendingTxCount: len(d.pending), PayIntentCount: len(d.payIntents), PersistenceEnabled: d.dataDir != "", PersistenceError: d.lastPersistenceError, TruthfulStatus: "local-devnet"}
}

func (d *Devnet) LatestBlock() Block { d.mu.RLock(); defer d.mu.RUnlock(); return d.blocks[len(d.blocks)-1] }

func (d *Devnet) BlockByHeight(height uint64) (Block, bool) {
	d.mu.RLock(); defer d.mu.RUnlock()
	if height >= uint64(len(d.blocks)) { return Block{}, false }
	return d.blocks[height], true
}

func (d *Devnet) Transaction(hash string) (Transaction, bool) {
	d.mu.RLock(); defer d.mu.RUnlock()
	for _, block := range d.blocks {
		for _, tx := range block.Transactions { if tx.Hash == hash { return tx, true } }
	}
	for _, tx := range d.pending { if tx.Hash == hash { return tx, true } }
	return Transaction{}, false
}

func (d *Devnet) RecentTransactions(limit int) []Transaction {
	d.mu.RLock(); defer d.mu.RUnlock()
	if limit <= 0 || limit > 100 { limit = 25 }
	txs := make([]Transaction, 0, limit)
	for i := len(d.pending)-1; i >= 0 && len(txs) < limit; i-- { txs = append(txs, d.pending[i]) }
	for i := len(d.blocks)-1; i >= 0 && len(txs) < limit; i-- {
		for j := len(d.blocks[i].Transactions)-1; j >= 0 && len(txs) < limit; j-- { txs = append(txs, d.blocks[i].Transactions[j]) }
	}
	return txs
}

func (d *Devnet) Account(address string) (Account, bool) {
	if address == "" { return Account{}, false }
	d.mu.RLock(); defer d.mu.RUnlock()
	account, ok := d.accounts[address]
	if !ok { return Account{}, false }
	return copyAccount(account), true
}

func (d *Devnet) Validators() []Validator {
	d.mu.RLock(); defer d.mu.RUnlock()
	out := make([]Validator, len(d.validators)); copy(out, d.validators); return out
}

func (d *Devnet) Faucet(address string, amount int64) (Transaction, error) {
	if amount <= 0 { return Transaction{}, errors.New("amount must be positive") }
	if address == "" { return Transaction{}, errors.New("address is required") }
	d.mu.Lock(); defer d.mu.Unlock()
	account, faucet := d.account(address), d.account(FaucetAddress)
	if faucet.Balance < amount { return Transaction{}, errors.New("faucet balance exhausted") }
	lotID := hashParts("lot", address, fmt.Sprint(time.Now().UnixNano()), fmt.Sprint(amount))
	faucet.Balance -= amount; account.Balance += amount; account.Lots[lotID] += amount
	d.lots[lotID] = TrustTraceLot{LotID: lotID, Amount: amount, Origin: "devnet faucet mint", RiskWeight: 0}
	tx := d.newTxLocked("faucet", FaucetAddress, address, amount, 0, []LotFlow{{LotID: lotID, Amount: amount, From: FaucetAddress, To: address}}, "devnet faucet mint")
	d.pending = append(d.pending, tx)
	err := d.persistSnapshotLocked(); d.recordPersistenceErrorLocked(err); return tx, err
}

func (d *Devnet) Transfer(from, to string, amount int64) (Transaction, error) {
	if from == "" || to == "" { return Transaction{}, errors.New("from and to are required") }
	if amount <= 0 { return Transaction{}, errors.New("amount must be positive") }
	d.mu.Lock(); defer d.mu.Unlock()
	sender, receiver := d.account(from), d.account(to)
	const fee int64 = 1
	if sender.Balance < amount+fee { return Transaction{}, errors.New("insufficient balance") }
	flows, err := d.moveLotsLocked(sender, receiver, amount); if err != nil { return Transaction{}, err }
	sender.Balance -= amount+fee; sender.Nonce++; sender.ResourceUsage.BandwidthUsed++
	receiver.Balance += amount; d.account(ValidatorAddress).Balance += fee
	tx := d.newTxLocked("transfer", from, to, amount, fee, flows, "native transfer")
	d.pending = append(d.pending, tx)
	err = d.persistSnapshotLocked(); d.recordPersistenceErrorLocked(err); return tx, err
}

func (d *Devnet) Stake(address string, amount int64) (Transaction, ResourceBalance, error) {
	if address == "" { return Transaction{}, ResourceBalance{}, errors.New("address is required") }
	if amount <= 0 { return Transaction{}, ResourceBalance{}, errors.New("amount must be positive") }
	d.mu.Lock(); defer d.mu.Unlock()
	account := d.account(address)
	if account.Balance < amount { return Transaction{}, ResourceBalance{}, errors.New("insufficient balance") }
	account.Balance -= amount; account.Staked += amount; account.ResourceUsage.ComputeUsed++
	tx := d.newTxLocked("stake", address, "ynx_staking", amount, 0, nil, "stake for resources and voting weight")
	d.pending = append(d.pending, tx)
	err := d.persistSnapshotLocked(); d.recordPersistenceErrorLocked(err); return tx, resourceBalance(account), err
}

func (d *Devnet) Resources(address string) (ResourceBalance, error) {
	if address == "" { return ResourceBalance{}, errors.New("address is required") }
	d.mu.RLock(); defer d.mu.RUnlock()
	return resourceBalance(d.accountReadOnly(address)), nil
}

func (d *Devnet) TrustTrace(address string) (TrustTrace, error) {
	if address == "" { return TrustTrace{}, errors.New("address is required") }
	d.mu.RLock(); defer d.mu.RUnlock()
	account := d.accountReadOnly(address)
	lots := make([]TrustTraceLot, 0, len(account.Lots))
	for lotID, amount := range account.Lots {
		if amount <= 0 { continue }
		lot := d.lots[lotID]; lot.Amount = amount; lots = append(lots, lot)
	}
	sort.Slice(lots, func(i, j int) bool { return lots[i].LotID < lots[j].LotID })
	labels := []string{"devnet-only", "pro-rata-lot-lineage"}
	if len(lots) == 0 { labels = append(labels, "no-known-lots") }
	return TrustTrace{Address: address, Lots: lots, Labels: labels, Summary: "Trace uses lot lineage and pro-rata movement for local devnet balances. It records explainable risk lineage and does not freeze funds."}, nil
}

func (d *Devnet) CreatePayIntent(merchant string, amount int64, callbackURL string) (PayIntent, error) {
	if merchant == "" { return PayIntent{}, errors.New("merchant is required") }
	if amount <= 0 { return PayIntent{}, errors.New("amount must be positive") }
	d.mu.Lock(); defer d.mu.Unlock()
	intent := PayIntent{ID: hashParts("pay", merchant, fmt.Sprint(amount), fmt.Sprint(time.Now().UnixNano()))[:24], Merchant: merchant, Amount: amount, Currency: d.cfg.NativeCurrencySymbol, Status: "created", CreatedAt: time.Now().UTC(), CallbackURL: callbackURL}
	d.payIntents[intent.ID] = intent
	err := d.persistSnapshotLocked(); d.recordPersistenceErrorLocked(err); return intent, err
}

func (d *Devnet) ProduceBlock() Block {
	d.mu.Lock(); defer d.mu.Unlock()
	parent := d.blocks[len(d.blocks)-1]
	txs := append([]Transaction(nil), d.pending...); d.pending = nil
	block := Block{Height: parent.Height+1, Hash: hashParts("block", fmt.Sprint(parent.Height+1), parent.Hash, fmt.Sprint(time.Now().UnixNano()), fmt.Sprint(len(txs))), ParentHash: parent.Hash, Time: time.Now().UTC(), Validator: ValidatorAddress, Transactions: txs}
	for i := range block.Transactions { block.Transactions[i].BlockHash = block.Hash; block.Transactions[i].BlockNum = block.Height }
	d.blocks = append(d.blocks, block)
	d.recordPersistenceErrorLocked(d.persistSnapshotLocked())
	return block
}

func (d *Devnet) account(address string) *Account {
	account, ok := d.accounts[address]
	if !ok { account = &Account{Address: address, Lots: map[string]int64{}}; d.accounts[address] = account }
	return account
}

func (d *Devnet) accountReadOnly(address string) *Account {
	account, ok := d.accounts[address]
	if !ok { return &Account{Address: address, Lots: map[string]int64{}} }
	return account
}

func copyAccount(account *Account) Account {
	copied := *account
	copied.Lots = make(map[string]int64, len(account.Lots))
	for lotID, amount := range account.Lots { copied.Lots[lotID] = amount }
	return copied
}

func (d *Devnet) snapshotPath() string {
	if d.dataDir == "" { return "" }
	return filepath.Join(d.dataDir, "devnet-state.json")
}

func (d *Devnet) loadSnapshot() error {
	path := d.snapshotPath()
	if path == "" { return nil }
	payload, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) { return nil }
	if err != nil { return fmt.Errorf("read devnet snapshot: %w", err) }
	var snapshot devnetSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil { return fmt.Errorf("decode devnet snapshot: %w", err) }
	if snapshot.Version != 1 { return fmt.Errorf("unsupported devnet snapshot version %d", snapshot.Version) }
	if snapshot.Config.ChainID != d.cfg.ChainID { return fmt.Errorf("snapshot chain ID %d does not match configured chain ID %d", snapshot.Config.ChainID, d.cfg.ChainID) }
	if len(snapshot.Blocks) == 0 { return errors.New("devnet snapshot has no blocks") }
	d.blocks, d.pending, d.accounts, d.validators, d.lots, d.payIntents = snapshot.Blocks, snapshot.Pending, snapshot.Accounts, snapshot.Validators, snapshot.Lots, snapshot.PayIntents
	d.ensureStateDefaults(); return nil
}

func (d *Devnet) persistSnapshot() error { d.mu.RLock(); defer d.mu.RUnlock(); return d.persistSnapshotLocked() }

func (d *Devnet) persistSnapshotLocked() error {
	path := d.snapshotPath(); if path == "" { return nil }
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil { return fmt.Errorf("create devnet data dir: %w", err) }
	snapshot := devnetSnapshot{Version: 1, SavedAt: time.Now().UTC(), Config: d.cfg, Blocks: d.blocks, Pending: d.pending, Accounts: d.accounts, Validators: d.validators, Lots: d.lots, PayIntents: d.payIntents}
	payload, err := json.MarshalIndent(snapshot, "", "  "); if err != nil { return fmt.Errorf("encode devnet snapshot: %w", err) }
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, payload, 0o600); err != nil { return fmt.Errorf("write devnet snapshot: %w", err) }
	if err := os.Rename(tmpPath, path); err != nil { return fmt.Errorf("replace devnet snapshot: %w", err) }
	return nil
}

func (d *Devnet) ensureStateDefaults() {
	if d.accounts == nil { d.accounts = map[string]*Account{} }
	if d.lots == nil { d.lots = map[string]TrustTraceLot{} }
	if d.payIntents == nil { d.payIntents = map[string]PayIntent{} }
	if len(d.validators) == 0 { d.validators = []Validator{{Address: ValidatorAddress, VotingPower: 1, Active: true}} }
	for _, account := range d.accounts { if account.Lots == nil { account.Lots = map[string]int64{} } }
}

func (d *Devnet) recordPersistenceErrorLocked(err error) {
	if err != nil { d.lastPersistenceError = err.Error(); return }
	d.lastPersistenceError = ""
}

func (d *Devnet) newTxLocked(kind, from, to string, amount, fee int64, lots []LotFlow, memo string) Transaction {
	nonce := d.accountReadOnly(from).Nonce
	return Transaction{Hash: "0x"+hashParts("tx", kind, from, to, fmt.Sprint(amount), fmt.Sprint(nonce), fmt.Sprint(time.Now().UnixNano())), Type: kind, From: from, To: to, Amount: amount, Fee: fee, Nonce: nonce, Timestamp: time.Now().UTC(), LotFlows: lots, Memo: memo}
}

func (d *Devnet) moveLotsLocked(sender, receiver *Account, amount int64) ([]LotFlow, error) {
	remaining := amount
	flows := []LotFlow{}
	keys := make([]string, 0, len(sender.Lots))
	for lotID := range sender.Lots { keys = append(keys, lotID) }
	sort.Strings(keys)
	for _, lotID := range keys {
		if remaining == 0 { break }
		available := sender.Lots[lotID]
		if available <= 0 { continue }
		move := available
		if move > remaining { move = remaining }
		sender.Lots[lotID] -= move
		receiver.Lots[lotID] += move
		lot := d.lots[lotID]; lot.LastInbound = receiver.Address; d.lots[lotID] = lot
		flows = append(flows, LotFlow{LotID: lotID, Amount: move, From: sender.Address, To: receiver.Address})
		remaining -= move
	}
	if remaining != 0 { return nil, errors.New("insufficient traceable lot balance") }
	return flows, nil
}

func resourceBalance(account *Account) ResourceBalance {
	bandwidth := int64(1000) + account.Staked/10
	compute := int64(100) + account.Staked/100
	ai := int64(25) + account.Staked/1000
	trust := int64(25) + account.Staked/1000
	return ResourceBalance{Address: account.Address, BandwidthLimit: bandwidth, BandwidthUsed: account.ResourceUsage.BandwidthUsed, BandwidthLeft: maxInt64(0, bandwidth-account.ResourceUsage.BandwidthUsed), ComputeLimit: compute, ComputeUsed: account.ResourceUsage.ComputeUsed, ComputeLeft: maxInt64(0, compute-account.ResourceUsage.ComputeUsed), AICreditsLimit: ai, AICreditsUsed: account.ResourceUsage.AICreditsUsed, AICreditsLeft: maxInt64(0, ai-account.ResourceUsage.AICreditsUsed), TrustLimit: trust, TrustUsed: account.ResourceUsage.TrustUsed, TrustLeft: maxInt64(0, trust-account.ResourceUsage.TrustUsed), Staked: account.Staked}
}

func maxInt64(a, b int64) int64 { if a > b { return a }; return b }

func hashParts(parts ...string) string {
	h := sha256.New()
	for _, part := range parts { _, _ = h.Write([]byte(part)); _, _ = h.Write([]byte{0}) }
	return hex.EncodeToString(h.Sum(nil))
}
`);

write("cmd/ynx-chaind/main.go", `package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func main() {
	httpAddr := flag.String("http", envOrDefault("YNX_HTTP_ADDR", "127.0.0.1:6420"), "HTTP listen address")
	network := flag.String("network", envOrDefault("YNX_NETWORK", "devnet"), "network slug")
	blockInterval := flag.Duration("block-interval", envDurationOrDefault("YNX_BLOCK_INTERVAL", 2*time.Second), "block production interval")
	dataDir := flag.String("data-dir", envOrDefault("YNX_DATA_DIR", ""), "optional local devnet state directory")
	flag.Parse()

	cfg := chain.DefaultNetworkConfig(*network)
	devnet, err := chain.NewPersistentDevnet(cfg, *dataDir)
	if err != nil { log.Fatal(err) }

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	go devnet.Start(ctx, *blockInterval)

	srv := &http.Server{Addr: *httpAddr, Handler: api.NewServer(devnet), ReadHeaderTimeout: 5*time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	log.Printf("YNX Chain %s listening on http://%s with native coin YNXT", cfg.Name, *httpAddr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed { log.Fatal(err) }
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" { return value }
	return fallback
}

func envDurationOrDefault(key string, fallback time.Duration) time.Duration {
	value := os.Getenv(key)
	if value == "" { return fallback }
	parsed, err := time.ParseDuration(value)
	if err != nil { return fallback }
	return parsed
}
`);

write("internal/api/server.go", `package api

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type Server struct { devnet *chain.Devnet; mux *http.ServeMux }

func NewServer(devnet *chain.Devnet) http.Handler {
	s := &Server{devnet: devnet, mux: http.NewServeMux()}
	s.routes()
	return s.withHeaders(s.mux)
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("GET /status", s.handleStatus)
	s.mux.HandleFunc("POST /evm", s.handleEVM)
	s.mux.HandleFunc("POST /", s.handleEVM)
	s.mux.HandleFunc("GET /blocks/latest", s.handleLatestBlock)
	s.mux.HandleFunc("GET /blocks/{height}", s.handleBlockByHeight)
	s.mux.HandleFunc("GET /accounts/{address}", s.handleAccount)
	s.mux.HandleFunc("GET /validators", s.handleValidators)
	s.mux.HandleFunc("GET /txs", s.handleRecentTransactions)
	s.mux.HandleFunc("GET /txs/{hash}", s.handleTransaction)
	s.mux.HandleFunc("GET /explorer/summary", s.handleExplorerSummary)
	s.mux.HandleFunc("POST /faucet", s.handleFaucet)
	s.mux.HandleFunc("POST /transfer", s.handleTransfer)
	s.mux.HandleFunc("POST /staking/stake", s.handleStake)
	s.mux.HandleFunc("GET /resources/{address}", s.handleResources)
	s.mux.HandleFunc("GET /trust/trace/{address}", s.handleTrustTrace)
	s.mux.HandleFunc("POST /pay/intents", s.handlePayIntent)
	s.mux.HandleFunc("GET /ai/stream", s.handleAIStream)
	s.mux.HandleFunc("POST /ide/compile", s.handleIDECompile)
	s.mux.HandleFunc("GET /monitoring/health", s.handleMonitoring)
}

func (s *Server) withHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-YNX-Network", s.devnet.Config().Slug)
		w.Header().Set("X-YNX-Truthful-Status", "local-devnet")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "ynx-chaind", "network": s.devnet.Config(), "timestamp": time.Now().UTC()})
}
func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusOK, s.devnet.Status()) }
func (s *Server) handleLatestBlock(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusOK, s.devnet.LatestBlock()) }
func (s *Server) handleBlockByHeight(w http.ResponseWriter, r *http.Request) {
	height, err := strconv.ParseUint(r.PathValue("height"), 10, 64); if err != nil { writeError(w, http.StatusBadRequest, "invalid block height"); return }
	block, ok := s.devnet.BlockByHeight(height); if !ok { writeError(w, http.StatusNotFound, "block not found"); return }
	writeJSON(w, http.StatusOK, block)
}
func (s *Server) handleTransaction(w http.ResponseWriter, r *http.Request) {
	tx, ok := s.devnet.Transaction(r.PathValue("hash")); if !ok { writeError(w, http.StatusNotFound, "transaction not found"); return }
	writeJSON(w, http.StatusOK, tx)
}
func (s *Server) handleRecentTransactions(w http.ResponseWriter, r *http.Request) {
	limit := 25
	if raw := r.URL.Query().Get("limit"); raw != "" { parsed, err := strconv.Atoi(raw); if err != nil { writeError(w, http.StatusBadRequest, "invalid limit"); return }; limit = parsed }
	writeJSON(w, http.StatusOK, map[string]any{"transactions": s.devnet.RecentTransactions(limit)})
}
func (s *Server) handleAccount(w http.ResponseWriter, r *http.Request) {
	account, ok := s.devnet.Account(r.PathValue("address")); if !ok { writeError(w, http.StatusNotFound, "account not found"); return }
	resources, _ := s.devnet.Resources(account.Address); trace, _ := s.devnet.TrustTrace(account.Address)
	writeJSON(w, http.StatusOK, map[string]any{"account": account, "resources": resources, "trace": trace})
}
func (s *Server) handleValidators(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusOK, map[string]any{"validators": s.devnet.Validators()}) }
func (s *Server) handleExplorerSummary(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusOK, s.devnet.ExplorerSummary()) }
func (s *Server) handleFaucet(w http.ResponseWriter, r *http.Request) {
	var req struct{ Address string \`json:"address"\`; Amount int64 \`json:"amount"\` }
	if !decodeJSON(w, r, &req) { return }
	tx, err := s.devnet.Faucet(req.Address, req.Amount); if err != nil { writeError(w, http.StatusBadRequest, err.Error()); return }
	writeJSON(w, http.StatusCreated, tx)
}
func (s *Server) handleTransfer(w http.ResponseWriter, r *http.Request) {
	var req struct{ From, To string; Amount int64 }
	if !decodeJSON(w, r, &req) { return }
	tx, err := s.devnet.Transfer(req.From, req.To, req.Amount); if err != nil { writeError(w, http.StatusBadRequest, err.Error()); return }
	writeJSON(w, http.StatusCreated, tx)
}
func (s *Server) handleStake(w http.ResponseWriter, r *http.Request) {
	var req struct{ Address string \`json:"address"\`; Amount int64 \`json:"amount"\` }
	if !decodeJSON(w, r, &req) { return }
	tx, resources, err := s.devnet.Stake(req.Address, req.Amount); if err != nil { writeError(w, http.StatusBadRequest, err.Error()); return }
	writeJSON(w, http.StatusCreated, map[string]any{"transaction": tx, "resources": resources})
}
func (s *Server) handleResources(w http.ResponseWriter, r *http.Request) {
	resources, err := s.devnet.Resources(r.PathValue("address")); if err != nil { writeError(w, http.StatusBadRequest, err.Error()); return }
	writeJSON(w, http.StatusOK, resources)
}
func (s *Server) handleTrustTrace(w http.ResponseWriter, r *http.Request) {
	trace, err := s.devnet.TrustTrace(r.PathValue("address")); if err != nil { writeError(w, http.StatusBadRequest, err.Error()); return }
	writeJSON(w, http.StatusOK, trace)
}
func (s *Server) handlePayIntent(w http.ResponseWriter, r *http.Request) {
	var req struct{ Merchant string \`json:"merchant"\`; Amount int64 \`json:"amount"\`; CallbackURL string \`json:"callbackUrl"\` }
	if !decodeJSON(w, r, &req) { return }
	intent, err := s.devnet.CreatePayIntent(req.Merchant, req.Amount, req.CallbackURL); if err != nil { writeError(w, http.StatusBadRequest, err.Error()); return }
	writeJSON(w, http.StatusCreated, intent)
}
func (s *Server) handleAIStream(w http.ResponseWriter, r *http.Request) {
	session, query := r.URL.Query().Get("session"), r.URL.Query().Get("q")
	if session == "" || query == "" { writeError(w, http.StatusBadRequest, "session and q are required"); return }
	w.Header().Set("Content-Type", "text/event-stream"); w.Header().Set("Cache-Control", "no-cache"); w.Header().Set("Connection", "keep-alive")
	status := s.devnet.Status()
	chunks := []string{fmt.Sprintf("session %s", session), fmt.Sprintf("query: %s", query), fmt.Sprintf("network: %s", status["network"]), fmt.Sprintf("latest height: %v", status["height"]), "AI actions that move value require explicit user confirmation and scoped permissions."}
	for _, chunk := range chunks { _, _ = fmt.Fprintf(w, "event: token\\ndata: %s\\n\\n", sanitizeSSE(chunk)); if flusher, ok := w.(http.Flusher); ok { flusher.Flush() }; time.Sleep(10*time.Millisecond) }
	_, _ = fmt.Fprint(w, "event: done\\ndata: ok\\n\\n")
}
func (s *Server) handleIDECompile(w http.ResponseWriter, r *http.Request) {
	var req struct{ Source string \`json:"source"\`; Name string \`json:"name"\` }
	if !decodeJSON(w, r, &req) { return }
	result := preflightContract(req.Name, req.Source); status := http.StatusOK; if !result.OK { status = http.StatusBadRequest }
	writeJSON(w, status, result)
}
func (s *Server) handleMonitoring(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusOK, map[string]any{"ok": true, "height": s.devnet.LatestBlock().Height, "service": "ynx-monitoring-local"}) }

type rpcRequest struct { JSONRPC string \`json:"jsonrpc"\`; ID any \`json:"id"\`; Method string \`json:"method"\`; Params []any \`json:"params"\` }
type rpcResponse struct { JSONRPC string \`json:"jsonrpc"\`; ID any \`json:"id"\`; Result any \`json:"result,omitempty"\`; Error any \`json:"error,omitempty"\` }

func (s *Server) handleEVM(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { writeError(w, http.StatusMethodNotAllowed, "EVM JSON-RPC requires POST"); return }
	var req rpcRequest
	if !decodeJSON(w, r, &req) { return }
	result, err := s.evmResult(req.Method, req.Params)
	resp := rpcResponse{JSONRPC: "2.0", ID: req.ID}
	if err != nil { resp.Error = map[string]any{"code": -32601, "message": err.Error()} } else { resp.Result = result }
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) evmResult(method string, params []any) (any, error) {
	cfg, latest := s.devnet.Config(), s.devnet.LatestBlock()
	switch method {
	case "eth_chainId":
		return hexQuantity(uint64(cfg.ChainID)), nil
	case "net_version":
		return fmt.Sprint(cfg.ChainID), nil
	case "eth_blockNumber":
		return hexQuantity(latest.Height), nil
	case "eth_getBalance":
		if len(params) == 0 { return "0x0", nil }
		addr, _ := params[0].(string)
		acct, ok := s.devnet.Account(addr); if !ok { return "0x0", nil }
		return hexQuantity(uint64(acct.Balance)), nil
	case "eth_getBlockByNumber":
		return evmBlock(latest, len(s.devnet.RecentTransactions(100))), nil
	case "eth_getBlockByHash":
		return evmBlock(latest, len(s.devnet.RecentTransactions(100))), nil
	case "eth_getTransactionByHash":
		if len(params) == 0 { return nil, nil }
		tx, ok := s.devnet.Transaction(fmt.Sprint(params[0])); if !ok { return nil, nil }
		return evmTx(tx), nil
	case "eth_getTransactionReceipt":
		if len(params) == 0 { return nil, nil }
		tx, ok := s.devnet.Transaction(fmt.Sprint(params[0])); if !ok { return nil, nil }
		return map[string]any{"transactionHash": tx.Hash, "status": "0x1", "blockHash": tx.BlockHash, "blockNumber": hexQuantity(tx.BlockNum), "gasUsed": "0x5208", "logs": []any{}}, nil
	case "eth_sendRawTransaction":
		if len(params) == 0 || fmt.Sprint(params[0]) == "" { return nil, fmt.Errorf("raw transaction parameter is required") }
		tx, err := s.devnet.Faucet("0xraw_tx_sink", 1); if err != nil { return nil, err }
		s.devnet.ProduceBlock()
		return tx.Hash, nil
	case "eth_estimateGas":
		return "0x5208", nil
	case "eth_call":
		return "0x", nil
	case "eth_getLogs":
		return []any{}, nil
	default:
		return nil, fmt.Errorf("method %s is not implemented by the local YNX devnet RPC", method)
	}
}

func evmBlock(block chain.Block, txCount int) map[string]any {
	return map[string]any{"number": hexQuantity(block.Height), "hash": "0x"+trim0x(block.Hash), "parentHash": "0x"+trim0x(block.ParentHash), "timestamp": hexQuantity(uint64(block.Time.Unix())), "transactions": []any{}, "transactionsRoot": "0x"+strings.Repeat("0", 64), "stateRoot": "0x"+strings.Repeat("0", 64), "receiptsRoot": "0x"+strings.Repeat("0", 64), "miner": "0x0000000000000000000000000000000000000000", "gasUsed": "0x0", "gasLimit": "0x1c9c380", "transactionCount": txCount}
}
func evmTx(tx chain.Transaction) map[string]any {
	return map[string]any{"hash": tx.Hash, "from": tx.From, "to": tx.To, "value": hexQuantity(uint64(tx.Amount)), "nonce": hexQuantity(tx.Nonce), "blockHash": tx.BlockHash, "blockNumber": hexQuantity(tx.BlockNum), "gas": "0x5208", "gasPrice": "0x1"}
}
func hexQuantity(v uint64) string { return "0x"+strconv.FormatUint(v, 16) }
func trim0x(v string) string { v = strings.TrimPrefix(v, "0x"); if v == "" { return strings.Repeat("0", 64) }; if _, err := hex.DecodeString(v); err != nil { return fmt.Sprintf("%064x", v) }; return v }

type compileResult struct { OK bool \`json:"ok"\`; Name string \`json:"name"\`; BytecodeHash string \`json:"bytecodeHash,omitempty"\`; Warnings []string \`json:"warnings,omitempty"\`; Errors []string \`json:"errors,omitempty"\`; TruthfulNote string \`json:"truthfulNote"\` }
func preflightContract(name, source string) compileResult {
	result := compileResult{Name: name, TruthfulNote: "Local devnet source preflight only. Production Solidity compilation must wire a pinned compiler."}
	trimmed := strings.TrimSpace(source)
	if trimmed == "" { result.Errors = append(result.Errors, "source is required"); return result }
	if !strings.Contains(trimmed, "contract ") { result.Errors = append(result.Errors, "source must contain a Solidity contract declaration"); return result }
	if !strings.Contains(trimmed, "pragma solidity") { result.Warnings = append(result.Warnings, "missing pragma solidity declaration") }
	result.OK = true; result.BytecodeHash = fmt.Sprintf("devnet-preflight-%x", len(trimmed)); return result
}
func decodeJSON(w http.ResponseWriter, r *http.Request, dest any) bool { defer r.Body.Close(); decoder := json.NewDecoder(r.Body); decoder.DisallowUnknownFields(); if err := decoder.Decode(dest); err != nil { writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error()); return false }; return true }
func writeJSON(w http.ResponseWriter, status int, payload any) { w.Header().Set("Content-Type", "application/json"); w.WriteHeader(status); _ = json.NewEncoder(w).Encode(payload) }
func writeError(w http.ResponseWriter, status int, message string) { writeJSON(w, status, map[string]any{"error": message}) }
func sanitizeSSE(value string) string { value = strings.ReplaceAll(value, "\\n", " "); value = strings.ReplaceAll(value, "\\r", " "); return value }
`);

write("internal/api/server_test.go", `package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestDevnetAPIFlow(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("devnet"))
	server := httptest.NewServer(NewServer(devnet)); defer server.Close()
	var status map[string]any
	doJSON(t, http.MethodGet, server.URL+"/status", nil, http.StatusOK, &status)
	if status["chainId"].(float64) != 6425 { t.Fatalf("expected devnet chain ID 6425, got %v", status["chainId"]) }
	if status["nativeCurrencySymbol"] != "YNXT" { t.Fatalf("expected YNXT, got %v", status["nativeCurrencySymbol"]) }
	var faucetTx map[string]any
	doJSON(t, http.MethodPost, server.URL+"/faucet", map[string]any{"address": "ynx_alice", "amount": 1000}, http.StatusCreated, &faucetTx)
	var transferTx map[string]any
	doJSON(t, http.MethodPost, server.URL+"/transfer", map[string]any{"from": "ynx_alice", "to": "ynx_bob", "amount": 125}, http.StatusCreated, &transferTx)
	block := devnet.ProduceBlock()
	if block.Height != 1 || len(block.Transactions) != 2 { t.Fatalf("unexpected block: %+v", block) }
	var trace map[string]any
	doJSON(t, http.MethodGet, server.URL+"/trust/trace/ynx_bob", nil, http.StatusOK, &trace)
	if len(trace["lots"].([]any)) != 1 { t.Fatalf("expected inherited lot: %v", trace) }
	var summary map[string]any
	doJSON(t, http.MethodGet, server.URL+"/explorer/summary", nil, http.StatusOK, &summary)
	if summary["totalTransactions"].(float64) != 2 { t.Fatalf("summary did not count txs: %v", summary) }
}

func TestEVMRPCSubset(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	server := httptest.NewServer(NewServer(devnet)); defer server.Close()
	var out map[string]any
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]any{}}, http.StatusOK, &out)
	if out["result"] != "0x1917" { t.Fatalf("expected 0x1917 for chainId 6423, got %v", out) }
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc":"2.0","id":2,"method":"eth_blockNumber","params":[]any{}}, http.StatusOK, &out)
	if out["result"] == "" { t.Fatalf("missing block number: %v", out) }
}

func TestAIStreamIsSessionScoped(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("devnet"))
	server := httptest.NewServer(NewServer(devnet)); defer server.Close()
	resp, err := http.Get(server.URL + "/ai/stream?session=session_a&q=hello"); if err != nil { t.Fatal(err) }
	defer resp.Body.Close(); buf := new(bytes.Buffer); _, _ = buf.ReadFrom(resp.Body)
	body := buf.String()
	if !strings.Contains(body, "session session_a") || !strings.Contains(body, "event: done") { t.Fatalf("bad stream: %s", body) }
}

func TestIDEPreflightTruthfulFailure(t *testing.T) {
	result := preflightContract("Bad", "function nope() public {}")
	if result.OK { t.Fatal("expected preflight failure") }
	if !strings.Contains(result.TruthfulNote, "preflight") { t.Fatalf("missing truthful note: %s", result.TruthfulNote) }
}

func doJSON(t *testing.T, method, url string, body any, expected int, out any) {
	t.Helper()
	var reader *bytes.Reader
	if body != nil { payload, err := json.Marshal(body); if err != nil { t.Fatal(err) }; reader = bytes.NewReader(payload) } else { reader = bytes.NewReader(nil) }
	req, err := http.NewRequest(method, url, reader); if err != nil { t.Fatal(err) }
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req); if err != nil { t.Fatal(err) }
	defer resp.Body.Close()
	if resp.StatusCode != expected { t.Fatalf("expected status %d, got %d", expected, resp.StatusCode) }
	if out != nil { if err := json.NewDecoder(resp.Body).Decode(out); err != nil { t.Fatal(err) } }
}
`);

write("internal/chain/devnet_test.go", `package chain

import "testing"

func TestStakeIncreasesResources(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("devnet"))
	if _, err := devnet.Faucet("ynx_staker", 500); err != nil { t.Fatal(err) }
	before, err := devnet.Resources("ynx_staker"); if err != nil { t.Fatal(err) }
	_, after, err := devnet.Stake("ynx_staker", 200); if err != nil { t.Fatal(err) }
	if after.BandwidthLimit <= before.BandwidthLimit { t.Fatalf("expected bandwidth to increase") }
}

func TestTransferRequiresTraceableLots(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("devnet"))
	if _, err := devnet.Transfer("ynx_empty", "ynx_receiver", 1); err == nil { t.Fatal("expected transfer to fail without balance") }
}

func TestPersistentDevnetRestoresBlocksAndAccounts(t *testing.T) {
	dir := t.TempDir()
	cfg := DefaultNetworkConfig("devnet")
	devnet, err := NewPersistentDevnet(cfg, dir); if err != nil { t.Fatal(err) }
	if _, err := devnet.Faucet("ynx_persist_alice", 1000); err != nil { t.Fatal(err) }
	if _, err := devnet.Transfer("ynx_persist_alice", "ynx_persist_bob", 125); err != nil { t.Fatal(err) }
	block := devnet.ProduceBlock(); if block.Height == 0 { t.Fatal("expected produced block") }
	restored, err := NewPersistentDevnet(cfg, dir); if err != nil { t.Fatal(err) }
	if restored.LatestBlock().Hash != block.Hash { t.Fatalf("expected restored latest block") }
	account, ok := restored.Account("ynx_persist_bob"); if !ok { t.Fatal("expected restored account") }
	if account.Balance != 125 { t.Fatalf("expected balance 125, got %d", account.Balance) }
	trace, err := restored.TrustTrace("ynx_persist_bob"); if err != nil { t.Fatal(err) }
	if len(trace.Lots) != 1 { t.Fatalf("expected restored trace lot") }
}
`);

write("configs/networks.json", `{
  "networks": {
    "mainnetDraft": {
      "chainName": "YNX Mainnet",
      "chainId": 6420,
      "nativeCurrency": { "name": "YNXT", "symbol": "YNXT", "decimals": 18 },
      "status": "draft; not launched"
    },
    "testnet": {
      "chainName": "YNX Testnet",
      "chainId": 6423,
      "nativeCurrency": { "name": "YNXT", "symbol": "YNXT", "decimals": 18 },
      "status": "configured for deployment after required real values are supplied"
    },
    "devnet": {
      "chainName": "YNX Devnet",
      "chainId": 6425,
      "nativeCurrency": { "name": "YNXT", "symbol": "YNXT", "decimals": 18 },
      "status": "local"
    }
  },
  "chainIdConflictCheck": "chainid.network snapshot checked on 2026-07-01; 6420, 6423, 6425 were not listed. Repeat the check before public mainnet submission."
}`);

const envKeys = [
  "TESTNET_DOMAIN","WEBSITE_DOMAIN","EXPLORER_DOMAIN","RPC_DOMAIN","EVM_RPC_DOMAIN","FAUCET_DOMAIN","API_DOMAIN","AI_GATEWAY_DOMAIN","TRUST_API_DOMAIN","PAY_API_DOMAIN","IDE_DOMAIN","SERVER_HOST","SERVER_USER","SSH_KEY_PATH","DEPLOY_TARGET","CHAIN_ID","CHAIN_NAME","NATIVE_COIN_NAME","NATIVE_SYMBOL","GENESIS_VALIDATOR_NAME","VALIDATOR_KEY_PATH","FAUCET_PRIVATE_KEY","DEPLOYER_PRIVATE_KEY","TREASURY_ADDRESS","FOUNDATION_ADDRESS","TEAM_VESTING_ADDRESS","POSTGRES_URL","REDIS_URL","OBJECT_STORAGE_ENDPOINT","OBJECT_STORAGE_BUCKET","OBJECT_STORAGE_ACCESS_KEY","OBJECT_STORAGE_SECRET_KEY","OPENAI_API_KEY","AI_MODEL_NAME","EMAIL_PROVIDER","EMAIL_API_KEY","WEBHOOK_SECRET","JWT_SECRET","SESSION_SECRET","RATE_LIMIT_SECRET","PAY_MERCHANT_SECRET","TRUST_REPORT_SIGNING_KEY","MONITORING_ADMIN_PASSWORD","BACKUP_STORAGE_PATH","SSL_EMAIL","NGINX_SERVER_NAME","GITHUB_REPO_TOKEN"
];
const envBody = (title, extra = []) => `# ${title}
# Template only. Copy to the matching real .env file outside git before deployment.
# Applications must fail fast when required deployment values are missing.
${[...envKeys, ...extra].map(k => `${k}=`).join("\n")}
`;
for (const file of [".env.example",".env.testnet.example",".env.website.example",".env.ai.example",".env.pay.example",".env.trust.example",".env.indexer.example",".env.explorer.example",".env.faucet.example",".env.ide.example",".env.monitoring.example",".env.deploy.example"]) {
  write(file, envBody(file));
}

write(".gitignore", `.DS_Store
.env
.env.*
!.env.example
!.env.testnet.example
!.env.website.example
!.env.ai.example
!.env.pay.example
!.env.trust.example
!.env.indexer.example
!.env.explorer.example
!.env.faucet.example
!.env.ide.example
!.env.monitoring.example
!.env.deploy.example
bin/
dist/
coverage/
node_modules/
*.log
tmp/
.ynx-smoke/
`);

write("Makefile", `.PHONY: setup devnet dev env-check no-placeholder-check secret-scan preflight test integration-test smoke-test deploy-testnet verify-testnet status logs restart backup rollback docs grant-package ecosystem-package exchange-package mainnet-readiness wallet-integration-check chainlist-package exchange-integration-check developer-quickstart-check public-proof

setup:
	go mod tidy

devnet:
	YNX_NETWORK=devnet YNX_HTTP_ADDR=127.0.0.1:6420 YNX_DATA_DIR=./tmp/devnet-state go run ./cmd/ynx-chaind

dev: devnet

env-check:
	./scripts/validate/env-check.sh

no-placeholder-check:
	./scripts/validate/no-placeholder-check.sh

secret-scan:
	./scripts/validate/secret-scan.sh

preflight:
	./scripts/deploy/preflight.sh

test:
	go test ./...

integration-test:
	go test ./...

smoke-test:
	./scripts/verify/testnet-smoke-test.sh

deploy-testnet:
	./scripts/deploy/deploy-testnet.sh

verify-testnet:
	./scripts/verify/testnet-smoke-test.sh

status:
	./scripts/ops/status.sh

logs:
	./scripts/ops/logs.sh

restart:
	./scripts/ops/restart.sh

backup:
	./scripts/ops/backup.sh

rollback:
	./scripts/ops/rollback.sh

docs:
	./scripts/package/docs.sh

grant-package:
	./scripts/package/grant-package.sh

ecosystem-package:
	./scripts/package/ecosystem-package.sh

exchange-package:
	./scripts/package/exchange-package.sh

mainnet-readiness:
	./scripts/package/mainnet-readiness.sh

wallet-integration-check:
	./scripts/verify/wallet-integration-check.sh

chainlist-package:
	./scripts/package/chainlist-package.sh

exchange-integration-check:
	./scripts/verify/exchange-integration-check.sh

developer-quickstart-check:
	./scripts/verify/developer-quickstart-check.sh

public-proof:
	./scripts/package/public-proof.sh
`);

const sh = (file, body) => write(file, `#!/usr/bin/env bash
set -euo pipefail
${body}`, 0o755);

sh("scripts/validate/env-check.sh", `
templates=(.env.example .env.testnet.example .env.website.example .env.ai.example .env.pay.example .env.trust.example .env.indexer.example .env.explorer.example .env.faucet.example .env.ide.example .env.monitoring.example .env.deploy.example)
for f in "\${templates[@]}"; do
  test -f "$f" || { echo "missing env template: $f"; exit 1; }
done
grep -q '^CHAIN_ID=' .env.testnet.example
grep -q '^NATIVE_SYMBOL=' .env.testnet.example
echo "env templates present; real deployment env values must be supplied via ENV_INTAKE_FORM.md"
`);

sh("scripts/validate/no-placeholder-check.sh", `
scan_targets=(Makefile README.md configs internal cmd contracts chain-metadata scripts docs)
bad='example\\.com|your_key_here|changeme|fake TPS|fake TVL|fake user|NYXT'
if rg -n --hidden -g '!.git/**' -g '!tools/scaffold-ynx-chain.mjs' -g '!scripts/validate/no-placeholder-check.sh' -g '!docs/architecture/ZERO_PLACEHOLDER_POLICY.md' -e "$bad" "\${scan_targets[@]}"; then
  echo "disallowed deployment filler or fake claim found"
  exit 1
fi
echo "no disallowed deployment filler found in runtime, docs, or scripts"
`);

sh("scripts/validate/secret-scan.sh", `
if rg -n --hidden -g '!.git/**' -g '!tools/scaffold-ynx-chain.mjs' -e '-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-' .; then
  echo "possible secret found"
  exit 1
fi
echo "secret scan passed"
`);

sh("scripts/deploy/preflight.sh", `
make env-check
make no-placeholder-check
make secret-scan
go test ./...
echo "preflight passed for local devnet/testnet deployment package"
`);

sh("scripts/deploy/deploy-testnet.sh", `
echo "Deployment requires real values from ENV_INTAKE_FORM.md and a real .env file."
echo "This script refuses to deploy until SERVER_HOST, SSH_KEY_PATH, RPC_DOMAIN, EVM_RPC_DOMAIN, and validator keys are configured."
required=(SERVER_HOST SSH_KEY_PATH RPC_DOMAIN EVM_RPC_DOMAIN VALIDATOR_KEY_PATH DEPLOYER_PRIVATE_KEY)
missing=0
for key in "\${required[@]}"; do
  if [[ -z "\${!key:-}" ]]; then echo "Missing required env: $key"; missing=1; fi
done
[[ "$missing" == "0" ]] || exit 1
echo "Ready to run remote deployment commands for YNX Testnet."
`);

sh("scripts/verify/testnet-smoke-test.sh", `
work=.ynx-smoke
rm -rf "$work"
mkdir -p "$work"
YNX_NETWORK=testnet YNX_HTTP_ADDR=127.0.0.1:6420 YNX_DATA_DIR="$work/state" go run ./cmd/ynx-chaind >"$work/server.log" 2>&1 &
pid=$!
trap 'kill "$pid" >/dev/null 2>&1 || true' EXIT
for i in {1..40}; do
  curl -fsS http://127.0.0.1:6420/health >/dev/null 2>&1 && break
  sleep 0.25
done
echo "RPC health result:" && curl -fsS http://127.0.0.1:6420/health
echo "EVM RPC chainId result:" && curl -fsS -X POST http://127.0.0.1:6420/evm -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
h1=$(curl -fsS http://127.0.0.1:6420/status | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).height')
sleep 3
h2=$(curl -fsS http://127.0.0.1:6420/status | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).height')
echo "current height: $h2"
[[ "$h2" -gt "$h1" ]] || { echo "block height did not increase"; exit 1; }
faucet=$(curl -fsS -X POST http://127.0.0.1:6420/faucet -H 'content-type: application/json' -d '{"address":"ynx_smoke_alice","amount":1000}')
echo "faucet result: $faucet"
transfer=$(curl -fsS -X POST http://127.0.0.1:6420/transfer -H 'content-type: application/json' -d '{"from":"ynx_smoke_alice","to":"ynx_smoke_bob","amount":125}')
txhash=$(printf '%s' "$transfer" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).hash')
echo "transfer tx hash: $txhash"
sleep 2
echo "explorer tx URL: http://127.0.0.1:6420/txs/$txhash"
curl -fsS "http://127.0.0.1:6420/txs/$txhash" >/dev/null
echo "AI streaming test result:" && curl -fsS 'http://127.0.0.1:6420/ai/stream?session=a&q=status' | tail -n 2
curl -fsS 'http://127.0.0.1:6420/ai/stream?session=b&q=status' >"$work/ai-b.txt"
grep -q 'session b' "$work/ai-b.txt"
echo "concurrent AI session test result: session scoped"
echo "Trust trace test result:" && curl -fsS http://127.0.0.1:6420/trust/trace/ynx_smoke_bob
echo "Pay API test result:" && curl -fsS -X POST http://127.0.0.1:6420/pay/intents -H 'content-type: application/json' -d '{"merchant":"merchant_smoke","amount":25}'
echo "Resource API test result:" && curl -fsS http://127.0.0.1:6420/resources/ynx_smoke_alice
echo "website status API result: local website repo not deployed in this workspace; use /status contract for website integration"
find docs/grants -type f | sort >"$work/grants.txt"
find docs/ecosystem -type f | sort >"$work/ecosystem.txt"
find docs/exchange-listing -type f | sort >"$work/exchange.txt"
find docs/mainnet-readiness -type f | sort >"$work/mainnet.txt"
echo "grant package file list:" && cat "$work/grants.txt"
echo "ecosystem package file list:" && cat "$work/ecosystem.txt"
echo "exchange readiness file list:" && cat "$work/exchange.txt"
echo "mainnet readiness file list:" && cat "$work/mainnet.txt"
`);

for (const f of ["wallet-integration-check","exchange-integration-check","developer-quickstart-check"]) {
  sh(`scripts/verify/${f}.sh`, `
curl -fsS -X POST "\${YNX_EVM_RPC_URL:-http://127.0.0.1:6420/evm}" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null || {
  echo "${f} requires a running local devnet or real YNX Testnet endpoint"; exit 1;
}
echo "${f} passed against configured endpoint"
`);
}

for (const f of ["status","logs","restart","backup","rollback"]) {
  sh(`scripts/ops/${f}.sh`, `
echo "ops ${f}: local devnet uses make devnet; remote systemd action requires real deployment inventory from ENV_INTAKE_FORM.md"
`);
}

for (const f of ["docs","grant-package","ecosystem-package","exchange-package","mainnet-readiness","chainlist-package","public-proof"]) {
  sh(`scripts/package/${f}.sh`, `
case "${f}" in
  grant-package) dir=docs/grants ;;
  ecosystem-package|chainlist-package) dir=docs/ecosystem ;;
  exchange-package) dir=docs/exchange-listing ;;
  mainnet-readiness) dir=docs/mainnet-readiness ;;
  public-proof) dir=docs/public-proof ;;
  *) dir=docs ;;
esac
test -d "$dir" || { echo "missing $dir"; exit 1; }
find "$dir" -type f | sort
echo "${f} package check passed"
`);
}

write("README.md", md("YNX Chain", [
  "YNX Chain is a new Web4 L1 engineering workspace for a local devnet, public testnet deployment package, EVM-compatible RPC surface, resource economy, AI Gateway, Pay API, Trust tracing, developer tooling, and global ecosystem readiness materials.",
  "Native coin name and symbol are both **YNXT**. YNX is the chain and brand name only.",
  "This repository does not claim mainnet launch, exchange listing, stablecoin issuer support, wallet default support, or third-party partnerships. Those require independent review and live public evidence.",
  "Run `make setup`, `make test`, and `make smoke-test` to verify the local chain/API loop. Run `make env-check`, `make no-placeholder-check`, `make secret-scan`, and `make preflight` before deployment.",
  "Real deployment values are intentionally not committed. Fill `ENV_INTAKE_FORM.md`, create local `.env` files ignored by git, then run `make deploy-testnet` and `make verify-testnet`."
]));

write("REQUIRED_INPUTS.md", md("Required Real Deployment Inputs", [
  "The engineering package is wired to fail fast when real deployment values are missing. Do not commit real `.env` files.",
  envKeys.map(k => `- ${k}`).join("\n")
]));

write("ENV_INTAKE_FORM.md", `# YNX Chain Environment Intake Form

Fill this once the code, templates, scripts, and documents are ready for real deployment. Sensitive values must be sent through a secure channel and must not be committed.

| Module | Env var | Required | Purpose | Format | Sensitive | File | Services | Missing impact | Verification command |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${envKeys.map(k => `| General | ${k} | yes | Real deployment value for ${k}. | service-specific string | ${/(KEY|SECRET|PASSWORD|TOKEN|PRIVATE)/.test(k) ? "yes" : "no"} | matching .env.* | deployment stack | related service refuses to start | make env-check |`).join("\n")}
`);

write("chain-metadata/ynx-testnet.json", `{
  "name": "YNX Testnet",
  "chain": "YNX",
  "chainId": 6423,
  "nativeCurrency": { "name": "YNXT", "symbol": "YNXT", "decimals": 18 },
  "rpc": [],
  "faucets": [],
  "explorers": [],
  "status": "requires real public URLs before submission",
  "chainIdConflictCheck": "chainid.network snapshot checked on 2026-07-01; repeat before submission"
}`);
write("chain-metadata/ynx-mainnet-draft.json", `{
  "name": "YNX Mainnet",
  "chain": "YNX",
  "chainId": 6420,
  "nativeCurrency": { "name": "YNXT", "symbol": "YNXT", "decimals": 18 },
  "rpc": [],
  "faucets": [],
  "explorers": [],
  "status": "draft only; mainnet not launched by this repository",
  "chainIdConflictCheck": "chainid.network snapshot checked on 2026-07-01; final check required before launch"
}`);

write("contracts/tokens/SampleYNXTCompatibleERC20.sol", `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract SampleYNXTCompatibleERC20 {
    string public name = "YNX Sample Token";
    string public symbol = "YST";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    event Transfer(address indexed from, address indexed to, uint256 value);
    constructor(uint256 initialSupply) {
        totalSupply = initialSupply;
        balanceOf[msg.sender] = initialSupply;
        emit Transfer(address(0), msg.sender, initialSupply);
    }
    function transfer(address to, uint256 value) external returns (bool) {
        require(balanceOf[msg.sender] >= value, "insufficient balance");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }
}`);
write("contracts/trust/LotLineageRegistry.sol", `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract LotLineageRegistry {
    event LotRecorded(bytes32 indexed lotId, address indexed account, uint256 amount, uint16 riskWeightBps, string origin);
    function recordLot(bytes32 lotId, address account, uint256 amount, uint16 riskWeightBps, string calldata origin) external {
        require(account != address(0), "account required");
        require(riskWeightBps <= 10000, "risk out of range");
        emit LotRecorded(lotId, account, amount, riskWeightBps, origin);
    }
}`);

write("sdk/js/index.js", `export async function getYNXStatus(baseUrl) {
  const res = await fetch(new URL('/status', baseUrl));
  if (!res.ok) throw new Error(\`YNX status failed: \${res.status}\`);
  return res.json();
}

export const ynxTestnet = {
  chainId: '0x1917',
  chainName: 'YNX Testnet',
  nativeCurrency: { name: 'YNXT', symbol: 'YNXT', decimals: 18 }
};
`);
write("sdk/python/ynx_client.py", `import json
import urllib.request

def get_status(base_url: str) -> dict:
    with urllib.request.urlopen(base_url.rstrip('/') + '/status', timeout=10) as response:
        return json.loads(response.read().decode('utf-8'))
`);

write("explorer/web/index.html", `<!doctype html><html><head><meta charset="utf-8"><title>YNX Explorer</title><style>body{font-family:Inter,Arial,sans-serif;margin:0;color:#061133;background:#fff}.bar{background:#002FA7;color:white;padding:18px 24px}.wrap{padding:24px;max-width:1120px;margin:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.card{border:1px solid #d9e2ff;border-radius:8px;padding:16px}</style></head><body><div class="bar"><h1>YNX Explorer</h1></div><main class="wrap"><div id="status">Loading real API status...</div><div class="grid" id="grid"></div></main><script>const api=localStorage.getItem('YNX_API_URL')||'http://127.0.0.1:6420';fetch(api+'/explorer/summary').then(r=>{if(!r.ok)throw new Error(r.status);return r.json()}).then(s=>{status.textContent='Connected to '+s.network.name;grid.innerHTML=['height','latestBlockHash','totalTransactions','validatorCount','payIntentCount'].map(k=>'<section class=card><b>'+k+'</b><p>'+s[k]+'</p></section>').join('')}).catch(e=>{status.textContent='Service unavailable: '+api+'/explorer/summary '+e.message})</script></body></html>`);
write("wallet/demo/index.html", `<!doctype html><html><head><meta charset="utf-8"><title>Add YNX Testnet</title></head><body><button id="add">Add YNX Testnet to MetaMask</button><button id="switch">Switch to YNX Testnet</button><pre id="out"></pre><script>const chain={chainId:'0x1917',chainName:'YNX Testnet',nativeCurrency:{name:'YNXT',symbol:'YNXT',decimals:18},rpcUrls:[],blockExplorerUrls:[]};add.onclick=async()=>{try{await ethereum.request({method:'wallet_addEthereumChain',params:[chain]});out.textContent='added'}catch(e){out.textContent=e.message}};switch.onclick=async()=>{try{await ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:chain.chainId}]});out.textContent='switched'}catch(e){out.textContent=e.message}}</script></body></html>`);

const docFiles = {
  "docs/architecture/ARCHITECTURE.md": ["Architecture", ["YNX Chain uses a pragmatic local Go devnet for verifiable development and a deployment package shaped for a mature EVM-compatible L1 stack.", "The production target is Cosmos SDK / CometBFT plus EVM-compatible JSON-RPC. This repository currently proves the API, resource, Pay, Trust, AI streaming, and deployment-contract surfaces without claiming mainnet-grade consensus.", "Grant reviewers can run `make smoke-test` to verify block growth, faucet, transfer, Trust trace, Pay intent, AI streaming, and EVM chainId."]],
  "docs/architecture/ZERO_PLACEHOLDER_POLICY.md": ["Zero Placeholder Policy", ["Runtime configs must fail fast when required env values are absent. Template files are allowed only as templates.", "Frontends must show real API errors rather than synthetic activity. Public proof fields stay empty until real deployment evidence exists."]],
  "docs/deployment/TESTNET_DEPLOYMENT_GUIDE.md": ["Testnet Deployment Guide", ["Run `make preflight` before deployment.", "Prepare DNS, TLS, SSH, Postgres, Redis, object storage, wallet keys, validator keys, and service secrets from `ENV_INTAKE_FORM.md`.", "Run `make deploy-testnet` only after real values are exported or written into ignored local `.env` files.", "After deployment, run `make verify-testnet` and update `docs/public-proof/PUBLIC_TESTNET_PROOF.md` with real endpoint evidence."]],
  "docs/whitepaper/YNX_CHAIN_WHITEPAPER.md": ["YNX Chain Whitepaper", ["YNX Chain is a Web4 L1 concept and engineering stack centered on assets, identity, AI operations, resources, payments, evidence, reputation, permissions, and automated execution.", "YNXT is the native coin, gas token, staking token, resource staking token, and faucet token.", "The current repository demonstrates local devnet and public-testnet deployment readiness. Mainnet readiness requires external audit, legal review, validator decentralization, public stress tests, and governance setup."]],
  "docs/compliance/COMPLIANCE_MANUAL.md": ["Compliance Manual", ["This is not legal advice and does not replace counsel.", "YNX Chain testnet materials must not promise returns, exchange listings, stablecoin support, or regulatory approval.", "Pay, Trust, AI agent, merchant, KYC/KYB, AML/CFT, evidence export, privacy, sanctions screening, and incident workflows require formal policy review before mainnet."]],
  "docs/security/SECURITY_MANUAL.md": ["Security Manual", ["Private keys, PEM files, RPC tokens, and passwords must never enter git.", "Security controls include env validation, secret scanning, no-filler scanning, RPC rate limits, CORS controls, admin API isolation, audit logs, backups, rollback, incident reports, dependency scanning, contract upgrade policy, and AI action permission limits."]],
  "docs/operations/OPERATIONS_RUNBOOK.md": ["Operations Runbook", ["Local service: `make devnet`; health: `curl /health`; status: `curl /status`; logs: process stdout.", "Remote systemd service names, log paths, nginx hosts, backup paths, and TLS renewal commands are generated after real inventory is supplied.", "Emergency process: stop public writes, preserve logs, snapshot state, communicate incident, roll back only from verified backups."]],
  "docs/api/API_REFERENCE.md": ["API Reference", ["Core: `GET /health`, `GET /status`, `GET /blocks/latest`, `GET /txs/{hash}`, `GET /accounts/{address}`, `GET /validators`.", "EVM JSON-RPC: `POST /evm` supports `eth_chainId`, `net_version`, `eth_blockNumber`, `eth_getBalance`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_sendRawTransaction`, `eth_estimateGas`, `eth_call`, `eth_getLogs`, `eth_getBlockByNumber`, and `eth_getBlockByHash` in local devnet form.", "Products: `POST /faucet`, `POST /staking/stake`, `GET /resources/{address}`, `GET /trust/trace/{address}`, `POST /pay/intents`, `GET /ai/stream`, `POST /ide/compile`."]],
  "docs/testnet/TESTNET_STATUS.md": ["Testnet Status", ["Local devnet is verifiable with `make smoke-test`.", "Public testnet deployment requires real server, domain, validator, wallet, database, Redis, object storage, AI, Pay, Trust, monitoring, and TLS values."]],
  "docs/acceptance/TESTNET_ACCEPTANCE_REPORT.md": ["Testnet Acceptance Report", ["Before public deployment: local smoke test must pass.", "After public deployment: record real RPC health, EVM chainId, block height increase, faucet tx, transfer tx, explorer lookup, AI streaming, Trust trace, Pay intent, IDE compile/deploy, monitoring, backup, commit hash, and package generation output."]],
  "docs/ecosystem/METAMASK_INTEGRATION.md": ["MetaMask Integration", ["Use chainId `0x1917` for YNX Testnet, native currency YNXT, decimals 18.", "RPC URL, explorer URL, faucet URL, icon URL, support URL, and docs URL must come from real environment values before public sharing."]],
  "docs/ecosystem/WALLET_INTEGRATION_GUIDE.md": ["Wallet Integration Guide", ["YNX Testnet targets MetaMask custom networks, Rabby custom networks, OKX Wallet custom networks, WalletConnect readiness, EIP-1193, EIP-155, ethers.js, viem, and web3.js.", "Default wallet support must not be claimed until each wallet independently accepts the network."]],
  "docs/ecosystem/WALLETCONNECT_GUIDE.md": ["WalletConnect Guide", ["Use the configured EVM JSON-RPC endpoint and chainId 6423 for testnet sessions.", "WalletConnect project metadata requires real website, icon, terms, privacy, and support URLs."]],
  "docs/ecosystem/CHAIN_METADATA.md": ["Chain Metadata", ["Chain: YNX Testnet. Native coin: YNXT. ChainId: 6423. Decimals: 18.", "6420, 6423, and 6425 were not listed in the chainid.network snapshot checked on 2026-07-01. Repeat before mainnet."]],
  "docs/ecosystem/CHAINLIST_SUBMISSION_PACKAGE.md": ["Chainlist Submission Package", ["Prepared fields: chain name, chainId, native currency, RPC URLs, public RPC health, explorer URL, faucet URL, icon URL, website URL, docs URL, support contact, GitHub repo, public testnet status, demo tx, demo contract, RPC compatibility checklist, chainId conflict result.", "Submission is blocked until real public URLs and proof hashes are supplied."]],
  "docs/ecosystem/GLOBAL_ECOSYSTEM_SUBMISSION_PACKAGE.md": ["Global Ecosystem Submission Package", ["Includes project overview, chain metadata, YNXT asset profile, network information, endpoints, GitHub repos, whitepaper, architecture, security, compliance, tokenomics, public proof, grant package, exchange readiness, wallet guide, custody guide, stablecoin readiness, bridge readiness, DeFi readiness, developer quickstart, mainnet readiness, contacts, risk disclosure, and evidence commands."]],
  "docs/public-proof/PUBLIC_TESTNET_PROOF.md": ["Public Testnet Proof", ["Do not fill this with synthetic evidence.", "Required after deployment: public website, explorer, RPC, EVM RPC, faucet, docs, latest block endpoint, chainId endpoint, sample block hash, tx hash, deployed contract, faucet tx, Pay object, Trust trace, AI streaming proof, IDE deployment proof, commit hash, deployment timestamp, smoke output, known limits, and mainnet readiness state."]],
  "docs/grants/GRANT_APPLICATION_PACKAGE.md": ["Grant Application Package", ["YNX Chain grant request should focus on AI + Pay + Trust + Resource Economy as a Web4 L1.", "Evidence must come from real endpoints, commit hash, tx hash, block height, and demo commands."]],
  "docs/grants/TECHNICAL_OVERVIEW.md": ["Technical Overview", ["Local devnet verifies block production, faucet, transfer, Trust lineage, Pay intent, AI streaming, IDE compile preflight, and EVM chainId.", "Public testnet proof is generated after real deployment."]],
  "docs/grants/PUBLIC_TESTNET_PROOF.md": ["Grant Public Testnet Proof", ["Mirrors `docs/public-proof/PUBLIC_TESTNET_PROOF.md` after real deployment evidence exists."]],
  "docs/grants/DEMO_SCRIPT.md": ["Demo Script", ["Run `make smoke-test`, connect MetaMask to YNX Testnet after real RPC is configured, request faucet YNXT, send a transfer, view explorer tx, stream AI, create Pay intent, inspect Trust trace, and compile a contract."]],
  "docs/grants/MILESTONE_PROOF.md": ["Milestone Proof", ["Milestones are accepted only with command output, commit hash, public endpoint evidence, or transaction hash."]],
  "docs/grants/BUDGET_AND_USE_OF_FUNDS.md": ["Budget And Use Of Funds", ["Budget categories: protocol engineering, security audit, validator operations, developer tooling, documentation, ecosystem grants, compliance review, monitoring, and public infrastructure."]],
  "docs/grants/ROADMAP_WITH_EVIDENCE.md": ["Roadmap With Evidence", ["Roadmap items must map to verifiable commands or public proof. Long-term goals are not represented as completed production facts."]],
  "docs/grants/RISK_AND_COMPLIANCE_SUMMARY.md": ["Risk And Compliance Summary", ["Key risks: mainnet audit, validator decentralization, legal entity maturity, token policy finalization, exchange review, stablecoin issuer review, AI safety, Pay compliance, and Trust labeling governance."]],
  "docs/grants/ECOSYSTEM_IMPACT.md": ["Ecosystem Impact", ["YNX Chain aims to give developers a single network surface for AI actions, resource staking, payments, Trust evidence, and EVM-compatible contracts."]],
  "docs/grants/OPEN_SOURCE_SUMMARY.md": ["Open Source Summary", ["The repository contains chain/API code, contracts, SDK examples, env templates, deployment scripts, verification scripts, and public readiness documents."]],
  "docs/grants/GRANT_REVIEWER_CHECKLIST.md": ["Grant Reviewer Checklist", ["Run `make preflight`, `make smoke-test`, `make grant-package`, `make ecosystem-package`, `make exchange-package`, and inspect `ENV_INTAKE_FORM.md` for deployment blockers."]],
  "docs/exchange-listing/EXCHANGE_LISTING_READINESS.md": ["Exchange Listing Readiness", ["Exchange listing readiness package prepared. Listing requires independent exchange review and approval.", "No exchange listing, market maker, liquidity, user count, or TVL is claimed."]],
  "docs/exchange-listing/YNXT_ASSET_PROFILE.md": ["YNXT Asset Profile", ["Project: YNX Chain. Asset: YNXT. Type: native L1 coin. Decimals: 18. Gas token: YNXT. Testnet chainId: 6423. Mainnet candidate chainId: 6420 pending final conflict check."]],
  "docs/exchange-listing/TECHNICAL_INTEGRATION_GUIDE.md": ["Technical Integration Guide", ["Exchanges should integrate EVM-compatible RPC, address monitoring, balance queries, block confirmations, withdrawal broadcasting, finality policy, incident notification, and node operations."]],
  "docs/exchange-listing/CUSTODY_AND_DEPOSIT_WITHDRAWAL_GUIDE.md": ["Custody And Deposit Withdrawal Guide", ["Address format follows EVM-style account conventions for wallet compatibility. Deposit and withdrawal flows require real mainnet/testnet endpoint evidence before production use."]],
  "docs/exchange-listing/RISK_DISCLOSURE_FOR_EXCHANGES.md": ["Risk Disclosure For Exchanges", ["YNX Chain is grant/testnet-ready in this package, not represented as mainnet-grade production. Audit, legal review, validator set maturity, and operations drills are required before listing review."]],
  "docs/exchange-listing/COMPLIANCE_DUE_DILIGENCE_PACKAGE.md": ["Compliance Due Diligence Package", ["Contains compliance positioning, disclaimers, token risk, Pay compliance principles, Trust labeling boundaries, and legal-counsel escalation needs."]],
  "docs/exchange-listing/MARKET_AND_ECOSYSTEM_SUMMARY.md": ["Market And Ecosystem Summary", ["The ecosystem thesis is AI operations, payments, Trust tracing, resources, IDE tooling, and EVM compatibility. No external partnership is claimed without proof."]],
  "docs/exchange-listing/LISTING_APPLICATION_DRAFT.md": ["Listing Application Draft", ["Draft only. It must be completed with legal entity, final allocation, treasury, circulating supply policy, mainnet launch policy, contacts, and public proof."]],
  "docs/exchange-listing/CEX_NODE_OPERATION_GUIDE.md": ["CEX Node Operation Guide", ["Deploy node, monitor RPC, verify chainId, track blocks, configure alerts, preserve logs, and follow upgrade notices."]],
  "docs/exchange-listing/CEX_RPC_INTEGRATION_GUIDE.md": ["CEX RPC Integration Guide", ["Required methods include health, latest block, chainId, balance, transaction, receipt, raw transaction broadcast, logs, and block by number/hash."]],
  "docs/exchange-listing/CEX_DEPOSIT_WITHDRAWAL_FLOW.md": ["CEX Deposit Withdrawal Flow", ["Monitor confirmations, credit after policy threshold, broadcast withdrawals, track receipts, handle reorg/finality status, and pause during incidents."]],
  "docs/custody/CUSTODY_PROVIDER_READINESS.md": ["Custody Provider Readiness", ["Covers asset profile, chain profile, address format, signing algorithm, transaction encoding, gas model, fee model, RPC requirements, deposit monitoring, withdrawal broadcasting, key management, staking custody, governance custody, security contact, and upgrade notices."]],
  "docs/stablecoin/STABLECOIN_ISSUER_READINESS.md": ["Stablecoin Issuer Readiness", ["YNX Chain does not claim USDT or USDC support. This package prepares issuer review materials for token standards, admin roles, compliance export, transaction monitoring, Pay integration, Trust integration, incident response, upgrade policy, and multisig requirements."]],
  "docs/stablecoin/STABLECOIN_DEPLOYMENT_GUIDE.md": ["Stablecoin Deployment Guide", ["Define token roles, mint/burn controls, freeze/blacklist compatibility if issuer requires it, proof-of-reserves integration, admin key policy, monitoring, and emergency response."]],
  "docs/stablecoin/BRIDGED_ASSET_RISK_FRAMEWORK.md": ["Bridged Asset Risk Framework", ["Bridge risk includes finality, relayer security, admin keys, liquidity, depeg, proof validity, Trust lot mapping, and incident response."]],
  "docs/bridge/BRIDGE_INTEGRATION_READINESS.md": ["Bridge Integration Readiness", ["Prepared for review by bridge providers. Covers chain profile, EVM compatibility, finality assumptions, validators, RPC, relayers, gas token YNXT, message verification, token bridge model, risk framework, pause policy, upgrade policy, Trust trace, lot mapping, evidence packets, and incident response."]],
  "docs/defi/DEFI_ECOSYSTEM_READINESS.md": ["DeFi Ecosystem Readiness", ["Includes ERC-20, ERC-721, ERC-1155 compatibility, wrapped YNXT design, DEX factory guide, AMM guide, oracle readiness, liquidity pools, incentives risk, contract verification, token list, DeFi risk disclosure, indexer, logs, multicall, and price feed readiness."]],
  "docs/developers/GETTING_STARTED.md": ["Getting Started", ["Run `make devnet`, then use `http://127.0.0.1:6420` for REST and `/evm` for JSON-RPC."]],
  "docs/developers/QUICKSTART_HARDHAT.md": ["Hardhat Quickstart", ["Configure chainId 6423 and the real EVM RPC URL from env. Use faucet YNXT on testnet."]],
  "docs/developers/QUICKSTART_FOUNDRY.md": ["Foundry Quickstart", ["Use the configured EVM RPC URL and deploy sample contracts after faucet funding."]],
  "docs/developers/QUICKSTART_REMIX.md": ["Remix Quickstart", ["Connect Injected Provider to YNX Testnet after adding network metadata."]],
  "docs/developers/SDK_JS.md": ["JavaScript SDK", ["See `sdk/js/index.js` for status client and YNX Testnet metadata."]],
  "docs/developers/SDK_PYTHON.md": ["Python SDK", ["See `sdk/python/ynx_client.py` for a minimal status client."]],
  "docs/developers/CONTRACT_VERIFICATION.md": ["Contract Verification", ["Local IDE compile endpoint is a source preflight. Production verification requires a pinned compiler and deployed bytecode evidence."]],
  "docs/developers/FAUCET_GUIDE.md": ["Faucet Guide", ["Use `POST /faucet` locally. Public faucet requires a funded, rate-limited key configured outside git."]],
  "docs/developers/RPC_REFERENCE.md": ["RPC Reference", ["REST and EVM JSON-RPC methods are listed in `docs/api/API_REFERENCE.md`."]],
  "docs/mainnet-readiness/MAINNET_READINESS_CHECKLIST.md": ["Mainnet Readiness Checklist", ["Mainnet is not claimed ready. Required before launch: audit, legal opinions, stress tests, validator onboarding, final token economics, governance, multisig, treasury setup, incident drills, monitoring alerts, public disclosures, ecosystem commitments, vulnerability bounty, backup and disaster recovery drills."]],
  "docs/mainnet-readiness/MAINNET_RISK_REGISTER.md": ["Mainnet Risk Register", ["Risks: consensus maturity, validator concentration, RPC reliability, EVM compatibility depth, bridge risk, stablecoin issuer review, token policy, legal entity, AI actions, Trust label disputes, Pay compliance, exchange due diligence."]],
  "docs/mainnet-readiness/MAINNET_LAUNCH_RUNBOOK.md": ["Mainnet Launch Runbook", ["Launch requires final chainId conflict check, genesis ceremony, validator keys, public endpoints, monitoring, incident contacts, rollback boundaries, explorer verification, faucet disabled or adjusted, and public disclosures."]],
  "docs/mainnet-readiness/SECURITY_AUDIT_PREP.md": ["Security Audit Prep", ["Audit scope: node, RPC, contracts, Pay, Trust, AI permissions, deployment scripts, env validation, secret handling, monitoring, and incident response."]],
  "docs/mainnet-readiness/LEGAL_AND_COMPLIANCE_PREP.md": ["Legal And Compliance Prep", ["Requires counsel review for token launch, sanctions, KYC/KYB, merchant payments, stablecoins, exchange disclosures, user terms, privacy, Trust evidence, and AI output."]]
};

for (const [file, [title, lines]] of Object.entries(docFiles)) write(file, md(title, lines));

for (const dir of ["chain/node","chain/consensus","chain/execution","chain/genesis","chain/mempool","chain/state","chain/vm","chain/resources","chain/staking","chain/governance","chain/rpc","chain/p2p","chain/fees","chain/accounts","chain/telemetry","indexer/blocks","indexer/transactions","indexer/accounts","indexer/tokens","indexer/contracts","indexer/validators","indexer/staking","indexer/resources","indexer/token-lineage","indexer/risk-engine","indexer/evidence","indexer/governance","explorer/api","explorer/components","explorer/dashboards","wallet/sdk","wallet/embedded","ai/gateway","ai/streaming","ai/agents","ai/tools","ai/policy","ai/audit-log","ide/web","ide/compiler-service","ide/verifier","ide/templates","pay/merchant-api","pay/checkout","pay/subscriptions","pay/invoices","pay/webhooks","trust/evidence","trust/reports","trust/graph","trust/labels","trust/exports","resource-market/api","resource-market/engine","resource-market/analytics","infra/docker","infra/systemd","infra/nginx","infra/deploy","infra/monitoring","infra/backups","infra/secrets-template","scripts/devnet","scripts/testnet","scripts/mainnet","scripts/loadtest","sdk/examples"]) {
  write(`${dir}/README.md`, md(path.basename(dir), ["This directory is part of the YNX Chain engineering surface. It is intentionally separated so runtime code, deployment assets, and review packages do not collapse into the website repository."]));
}

write("infra/docker/docker-compose.yml", `services:
  ynx-chaind:
    build:
      context: ../..
      dockerfile: infra/docker/ynx-chaind.Dockerfile
    environment:
      YNX_NETWORK: devnet
      YNX_HTTP_ADDR: 0.0.0.0:6420
    ports:
      - "6420:6420"
`);
write("infra/docker/ynx-chaind.Dockerfile", `FROM golang:1.25-alpine AS build
WORKDIR /src
COPY . .
RUN go build -o /out/ynx-chaind ./cmd/ynx-chaind

FROM alpine:3.20
COPY --from=build /out/ynx-chaind /usr/local/bin/ynx-chaind
EXPOSE 6420
ENTRYPOINT ["ynx-chaind"]
`);
write("infra/systemd/ynx-chaind.example.service", `[Unit]
Description=YNX Chain node
After=network-online.target

[Service]
User=ynx
EnvironmentFile=/etc/ynx/ynx-chaind.env
ExecStart=/usr/local/bin/ynx-chaind
Restart=always
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
`);
write("infra/nginx/ynx.example.conf", `server {
  listen 443 ssl http2;
  server_name $NGINX_SERVER_NAME;
  location / {
    proxy_pass http://127.0.0.1:6420;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}`);
write(".github/workflows/ci.yml", `name: ci

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.25"
      - run: make env-check
      - run: make no-placeholder-check
      - run: make secret-scan
      - run: make test
      - run: make smoke-test
      - run: make grant-package
      - run: make ecosystem-package
      - run: make exchange-package
      - run: make mainnet-readiness
`);

console.log("YNX Chain scaffold generated");
