package dex

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const NativeSource = "indexed authoritative chain-native YNX Testnet DEX state"

type NativePollerConfig struct {
	RESTURL string
	Client  *http.Client
}

type NativePoller struct {
	store    *Store
	base     *url.URL
	client   *http.Client
	mu       sync.RWMutex
	tokens   []Token
	snapshot NativeSnapshot
}

type nativePool struct {
	ID          string    `json:"id"`
	Asset0      string    `json:"asset0"`
	Asset1      string    `json:"asset1"`
	Reserve0    int64     `json:"reserve0"`
	Reserve1    int64     `json:"reserve1"`
	FeeBps      uint16    `json:"feeBps"`
	TotalShares int64     `json:"totalShares"`
	UpdatedAt   time.Time `json:"updatedAt"`
	TxHash      string    `json:"transactionHash"`
	BlockHeight uint64    `json:"blockHeight"`
	BlockHash   string    `json:"blockHash"`
	AuditHash   string    `json:"auditHash"`
}

type nativeEvent struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	PoolID      string    `json:"poolId"`
	Signer      string    `json:"signer"`
	Asset0      string    `json:"asset0"`
	Asset1      string    `json:"asset1"`
	Amount0     int64     `json:"amount0"`
	Amount1     int64     `json:"amount1"`
	Shares      int64     `json:"shares"`
	OccurredAt  time.Time `json:"occurredAt"`
	TxHash      string    `json:"transactionHash"`
	BlockHeight uint64    `json:"blockHeight"`
	BlockHash   string    `json:"blockHash"`
	AuditHash   string    `json:"auditHash"`
}

type nativeAsset struct {
	ID          string `json:"id"`
	Symbol      string `json:"symbol"`
	Name        string `json:"name"`
	Decimals    uint8  `json:"decimals"`
	Issuer      string `json:"issuer"`
	MaxSupply   int64  `json:"maxSupply"`
	TotalSupply int64  `json:"totalSupply"`
	TxHash      string `json:"transactionHash"`
	BlockHeight uint64 `json:"blockHeight"`
	AuditHash   string `json:"auditHash"`
}

type NativeSnapshot struct {
	Assets             []nativeAsset `json:"assets"`
	Pools              []nativePool  `json:"pools"`
	Events             []nativeEvent `json:"events"`
	UpdatedAt          time.Time     `json:"updatedAt"`
	Source             string        `json:"source"`
	Fresh              bool          `json:"fresh"`
	SnapshotAgeSeconds int64         `json:"snapshotAgeSeconds"`
}

func NewNativePoller(store *Store, cfg NativePollerConfig) (*NativePoller, error) {
	if store == nil || strings.TrimSpace(cfg.RESTURL) == "" {
		return nil, errors.New("store and native DEX REST URL are required")
	}
	for _, event := range store.Events() {
		if event.ContractVersion != "ynx-native-dex-cpmm-v1" {
			return nil, errors.New("native DEX poller refuses a state store containing another authority source")
		}
	}
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(cfg.RESTURL), "/"))
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return nil, errors.New("native DEX REST URL must be an absolute HTTP(S) origin")
	}
	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	return &NativePoller{store: store, base: base, client: client}, nil
}

func (poller *NativePoller) PollOnce(ctx context.Context) (bool, error) {
	var assetEnvelope struct {
		Items []nativeAsset `json:"items"`
	}
	if err := poller.get(ctx, "/dex/assets", &assetEnvelope); err != nil {
		return false, err
	}
	tokens := []Token{{ChainID: ChainID, Address: "YNXT", Symbol: "YNXT", Name: "YNX Testnet", Decimals: 0, Standard: "YNX-NATIVE", ReviewStatus: "authoritative-chain-native-testnet"}}
	for _, asset := range assetEnvelope.Items {
		token := Token{ChainID: ChainID, Address: asset.ID, Symbol: asset.Symbol, Name: asset.Name, Decimals: asset.Decimals, Standard: "YNX-NATIVE", ReviewStatus: "authoritative-chain-native-testnet"}
		if err := token.Validate(); err != nil {
			return false, fmt.Errorf("native DEX asset %q: %w", asset.ID, err)
		}
		tokens = append(tokens, token)
	}
	var poolEnvelope struct {
		Items []nativePool `json:"items"`
	}
	if err := poller.get(ctx, "/dex/pools", &poolEnvelope); err != nil {
		return false, err
	}
	pools := make(map[string]nativePool, len(poolEnvelope.Items))
	for _, pool := range poolEnvelope.Items {
		if !nativePoolPattern.MatchString(pool.ID) || !nativeAssetPattern.MatchString(pool.Asset0) || !nativeAssetPattern.MatchString(pool.Asset1) || pool.Asset0 >= pool.Asset1 || pool.BlockHeight == 0 || pool.BlockHash == "" || pool.TxHash == "" {
			return false, fmt.Errorf("native DEX pool %q is invalid", pool.ID)
		}
		pools[pool.ID] = pool
	}
	poolItems := make([]nativePool, 0, len(pools))
	for _, pool := range pools {
		poolItems = append(poolItems, pool)
	}
	sort.Slice(poolItems, func(i, j int) bool { return poolItems[i].ID < poolItems[j].ID })
	var eventEnvelope struct {
		Items []nativeEvent `json:"items"`
	}
	if err := poller.get(ctx, "/dex/events", &eventEnvelope); err != nil {
		return false, err
	}
	advanced := false
	for index, native := range eventEnvelope.Items {
		pool, ok := pools[native.PoolID]
		if !ok {
			continue // Asset lifecycle events are not pool market events.
		}
		event, ok := nativeIndexedEvent(native, pool, uint64(index+1))
		if !ok {
			continue
		}
		created, err := poller.store.Append(event)
		if err != nil {
			return false, fmt.Errorf("append native DEX event %s: %w", native.ID, err)
		}
		advanced = advanced || created
	}
	for _, pool := range poolEnvelope.Items {
		created, err := poller.store.Append(nativePoolSyncEvent(pool))
		if err != nil {
			return false, fmt.Errorf("append native DEX pool sync %s: %w", pool.ID, err)
		}
		advanced = advanced || created
	}
	poller.mu.Lock()
	poller.tokens = tokens
	poller.snapshot = NativeSnapshot{
		Assets:    append([]nativeAsset(nil), assetEnvelope.Items...),
		Pools:     append([]nativePool(nil), poolItems...),
		Events:    append([]nativeEvent(nil), eventEnvelope.Items...),
		UpdatedAt: time.Now().UTC(),
		Source:    "authoritative chain-native YNX Testnet state",
	}
	poller.mu.Unlock()
	return advanced, nil
}

func (poller *NativePoller) Tokens() []Token {
	poller.mu.RLock()
	defer poller.mu.RUnlock()
	return append([]Token(nil), poller.tokens...)
}

func (poller *NativePoller) NativeSnapshot() NativeSnapshot {
	poller.mu.RLock()
	defer poller.mu.RUnlock()
	value := poller.snapshot
	value.Assets = append([]nativeAsset(nil), value.Assets...)
	value.Pools = append([]nativePool(nil), value.Pools...)
	value.Events = append([]nativeEvent(nil), value.Events...)
	return value
}

func nativeIndexedEvent(value nativeEvent, pool nativePool, logIndex uint64) (Event, bool) {
	typeName := ""
	switch value.Type {
	case "dex_pool_create":
		typeName = "pool-created"
	case "dex_liquidity_add":
		typeName = "liquidity-add"
	case "dex_liquidity_remove":
		typeName = "liquidity-remove"
	case "dex_swap_exact_input", "dex_swap_exact_output":
		typeName = "swap"
	default:
		return Event{}, false
	}
	amount0, amount1 := value.Amount0, value.Amount1
	fee0, fee1 := int64(0), int64(0)
	if typeName == "swap" {
		if value.Asset0 == pool.Asset0 && value.Asset1 == pool.Asset1 {
			amount1 = -amount1
			fee0 = value.Amount0 * int64(pool.FeeBps) / 10_000
		} else if value.Asset0 == pool.Asset1 && value.Asset1 == pool.Asset0 {
			amount0, amount1 = -value.Amount1, value.Amount0
			fee1 = value.Amount0 * int64(pool.FeeBps) / 10_000
		} else {
			return Event{}, false
		}
	}
	event := Event{
		ID: "native:" + value.ID, ChainID: ChainID, ContractVersion: "ynx-native-dex-cpmm-v1",
		BlockNumber: value.BlockHeight, BlockHash: value.BlockHash, TxHash: value.TxHash, LogIndex: logIndex,
		Type: typeName, Pool: pool.ID, Account: value.Signer, Token0: pool.Asset0, Token1: pool.Asset1,
		Amount0: strconv.FormatInt(amount0, 10), Amount1: strconv.FormatInt(amount1, 10), LPAmount: strconv.FormatInt(value.Shares, 10),
		Fee0: strconv.FormatInt(fee0, 10), Fee1: strconv.FormatInt(fee1, 10), FeeBps: pool.FeeBps, Timestamp: value.OccurredAt,
	}
	// Historical events must not depend on the mutable current pool snapshot.
	// Pool creation retains a canonical zero snapshot for compatibility with
	// already persisted native events. Current reserves use a separate sync.
	if typeName == "pool-created" {
		event.Reserve0, event.Reserve1 = "0", "0"
	}
	return event, true
}

func nativePoolSyncEvent(pool nativePool) Event {
	digest := sha256.Sum256([]byte(pool.ID))
	return Event{
		ID:              "native-sync:" + pool.ID + ":" + strings.TrimPrefix(pool.TxHash, "0x"),
		ChainID:         ChainID,
		ContractVersion: "ynx-native-dex-cpmm-v1",
		BlockNumber:     pool.BlockHeight,
		BlockHash:       pool.BlockHash,
		TxHash:          pool.TxHash,
		LogIndex:        (uint64(1) << 63) | (binary.BigEndian.Uint64(digest[:8]) >> 1),
		Type:            "sync",
		Pool:            pool.ID,
		Token0:          pool.Asset0,
		Token1:          pool.Asset1,
		Amount0:         "0",
		Amount1:         "0",
		LPAmount:        "0",
		Fee0:            "0",
		Fee1:            "0",
		FeeBps:          pool.FeeBps,
		Reserve0:        strconv.FormatInt(pool.Reserve0, 10),
		Reserve1:        strconv.FormatInt(pool.Reserve1, 10),
		Timestamp:       pool.UpdatedAt,
	}
}

func (poller *NativePoller) get(ctx context.Context, path string, output any) error {
	endpoint := *poller.base
	endpoint.Path = strings.TrimRight(endpoint.Path, "/") + path
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	response, err := poller.client.Do(request)
	if err != nil {
		return fmt.Errorf("native DEX GET %s: %w", path, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("native DEX GET %s returned HTTP %d", path, response.StatusCode)
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return err
	}
	if len(payload) == 8<<20 {
		return errors.New("native DEX response exceeds 8 MiB")
	}
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	if err := decoder.Decode(output); err != nil {
		return fmt.Errorf("decode native DEX %s: %w", path, err)
	}
	if decoder.Decode(&struct{}{}) == nil {
		return fmt.Errorf("decode native DEX %s: trailing JSON value", path)
	}
	return nil
}
