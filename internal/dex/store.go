package dex

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type storePayload struct {
	SchemaVersion int     `json:"schemaVersion"`
	Sequence      uint64  `json:"sequence"`
	Events        []Event `json:"events"`
}

type storeEnvelope struct {
	Payload   storePayload `json:"payload"`
	Integrity string       `json:"integrity"`
}

type Store struct {
	mu     sync.RWMutex
	path   string
	secret []byte
	state  storePayload
}

func OpenStore(path string, secret []byte) (*Store, error) {
	if len(secret) < 32 {
		return nil, errors.New("DEX state HMAC secret must contain at least 32 bytes")
	}
	store := &Store{path: path, secret: append([]byte(nil), secret...), state: storePayload{SchemaVersion: 2, Events: []Event{}}}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, err
	}
	var envelope storeEnvelope
	if err := decodeExact(data, &envelope); err != nil {
		return nil, fmt.Errorf("decode DEX state: %w", err)
	}
	if (envelope.Payload.SchemaVersion != 1 && envelope.Payload.SchemaVersion != 2) || !hmac.Equal([]byte(envelope.Integrity), []byte(store.integrity(envelope.Payload))) {
		return nil, errors.New("DEX state integrity verification failed")
	}
	for _, event := range envelope.Payload.Events {
		if err := event.Validate(); err != nil {
			return nil, fmt.Errorf("invalid persisted event: %w", err)
		}
	}
	if envelope.Payload.Sequence != uint64(len(envelope.Payload.Events)) {
		return nil, errors.New("DEX state sequence mismatch")
	}
	if envelope.Payload.SchemaVersion == 1 {
		if err := preserveLegacyState(path+".schema-v1.bak", data); err != nil {
			return nil, fmt.Errorf("preserve DEX schema v1 rollback: %w", err)
		}
		envelope.Payload.SchemaVersion = 2
		if err := store.persist(envelope.Payload); err != nil {
			return nil, fmt.Errorf("migrate DEX state to schema v2: %w", err)
		}
	}
	store.state = envelope.Payload
	return store, nil
}

func preserveLegacyState(path string, data []byte) error {
	existing, err := os.ReadFile(path)
	if err == nil {
		if !bytes.Equal(existing, data) {
			return errors.New("existing rollback backup differs from source state")
		}
		return nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	return file.Close()
}

func (store *Store) Append(event Event) (bool, error) {
	if err := event.Validate(); err != nil {
		return false, err
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	for _, existing := range store.state.Events {
		if existing.ID == event.ID {
			left, _ := json.Marshal(existing)
			right, _ := json.Marshal(event)
			if bytes.Equal(left, right) {
				return false, nil
			}
			return false, errors.New("event replay conflicts with persisted event")
		}
		if existing.BlockNumber == event.BlockNumber && existing.LogIndex == event.LogIndex && existing.BlockHash != event.BlockHash {
			return false, errors.New("chain reorganization conflict requires explicit recovery")
		}
	}
	next := store.state
	next.Events = append(append([]Event(nil), store.state.Events...), event)
	sort.Slice(next.Events, func(i, j int) bool {
		if next.Events[i].BlockNumber == next.Events[j].BlockNumber {
			return next.Events[i].LogIndex < next.Events[j].LogIndex
		}
		return next.Events[i].BlockNumber < next.Events[j].BlockNumber
	})
	next.Sequence = uint64(len(next.Events))
	if err := store.persist(next); err != nil {
		return false, err
	}
	store.state = next
	return true, nil
}

func (store *Store) Events() []Event {
	store.mu.RLock()
	defer store.mu.RUnlock()
	return append([]Event(nil), store.state.Events...)
}

// Rewind removes events at and after a reorganization boundary and persists the
// result atomically. Only the confirmed-block poller should call this method.
func (store *Store) Rewind(fromBlock uint64) error {
	if fromBlock == 0 {
		return errors.New("rewind block must be positive")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	next := store.state
	next.Events = make([]Event, 0, len(store.state.Events))
	for _, event := range store.state.Events {
		if event.BlockNumber < fromBlock {
			next.Events = append(next.Events, event)
		}
	}
	next.Sequence = uint64(len(next.Events))
	if err := store.persist(next); err != nil {
		return err
	}
	store.state = next
	return nil
}

func (store *Store) Pools() []Pool {
	store.mu.RLock()
	defer store.mu.RUnlock()
	latest := map[string]Pool{}
	for _, event := range store.state.Events {
		if event.ContractVersion != "ynx-dex-cpmm-v1" {
			continue
		}
		pool := latest[event.Pool]
		pool.Address, pool.Token0, pool.Token1 = event.Pool, event.Token0, event.Token1
		pool.ContractVersion, pool.UpdatedBlock, pool.UpdatedAt = event.ContractVersion, event.BlockNumber, event.Timestamp
		if event.Reserve0 != "" {
			pool.Reserve0, pool.Reserve1 = event.Reserve0, event.Reserve1
		}
		latest[event.Pool] = pool
	}
	result := make([]Pool, 0, len(latest))
	for _, pool := range latest {
		result = append(result, pool)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Address < result[j].Address })
	return result
}

func (store *Store) VaultActions(vault string) []VaultAction {
	store.mu.RLock()
	defer store.mu.RUnlock()
	result := make([]VaultAction, 0)
	for _, event := range store.state.Events {
		if event.ContractVersion != "ynx-strategy-vault-v1" || !strings.EqualFold(event.Vault, vault) {
			continue
		}
		result = append(result, VaultAction{
			Vault: event.Vault, NonceDomain: event.NonceDomain, ActionNonce: event.ActionNonce, Method: event.Method, MethodSelector: event.MethodSelector,
			BeforeValue: event.BeforeValue, AfterValue: event.AfterValue, TransactionHash: event.TxHash,
			BlockHash: event.BlockHash, BlockNumber: event.BlockNumber, LogIndex: event.LogIndex, AsOf: event.Timestamp,
			Source: "confirmed YNX Testnet EVM logs", Version: "ynx-vault-action-v1", Confidence: "confirmed-on-chain",
			Coverage: "ActionExecuted vault, nonce domain, action nonce, method, values, transaction, block and log identity",
			Failure:  nil,
		})
	}
	return result
}

func (store *Store) Positions(account string) []Position {
	store.mu.RLock()
	defer store.mu.RUnlock()
	type totals struct{ lp, add0, add1, remove0, remove1 *big.Int }
	byPool := map[string]*totals{}
	for _, event := range store.state.Events {
		if event.ContractVersion != "ynx-dex-cpmm-v1" {
			continue
		}
		if event.Account != account || (event.Type != "liquidity-add" && event.Type != "liquidity-remove") {
			continue
		}
		item := byPool[event.Pool]
		if item == nil {
			item = &totals{new(big.Int), new(big.Int), new(big.Int), new(big.Int), new(big.Int)}
			byPool[event.Pool] = item
		}
		lp, _ := new(big.Int).SetString(event.LPAmount, 10)
		amount0, _ := new(big.Int).SetString(event.Amount0, 10)
		amount1, _ := new(big.Int).SetString(event.Amount1, 10)
		if event.Type == "liquidity-add" {
			item.lp.Add(item.lp, lp)
			item.add0.Add(item.add0, amount0)
			item.add1.Add(item.add1, amount1)
		} else {
			item.lp.Sub(item.lp, lp)
			item.remove0.Add(item.remove0, amount0)
			item.remove1.Add(item.remove1, amount1)
		}
	}
	result := make([]Position, 0, len(byPool))
	for pool, item := range byPool {
		result = append(result, Position{account, pool, item.lp.String(), item.add0.String(), item.add1.String(), item.remove0.String(), item.remove1.String()})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Pool < result[j].Pool })
	return result
}

func (store *Store) Analytics() Analytics {
	events := store.Events()
	pools := store.Pools()
	result := Analytics{Source: "YNX Testnet EVM events", IndexedEvents: len(events), Pools: len(pools)}
	for _, event := range events {
		if event.ContractVersion == "ynx-strategy-vault-v1" {
			result.VaultActions++
		}
		if event.Type == "swap" {
			result.Swaps++
		}
		if event.Type == "liquidity-add" || event.Type == "liquidity-remove" {
			result.LiquidityEvents++
		}
		if event.BlockNumber > result.LatestBlock {
			result.LatestBlock = event.BlockNumber
		}
	}
	return result
}

func (store *Store) SpotPrices() []SpotPrice {
	pools := store.Pools()
	result := make([]SpotPrice, 0, len(pools))
	for _, pool := range pools {
		if pool.Reserve0 == "" || pool.Reserve1 == "" || pool.Reserve0 == "0" || pool.Reserve1 == "0" {
			continue
		}
		result = append(result, SpotPrice{Pool: pool.Address, Token0: pool.Token0, Token1: pool.Token1, Price0Numerator: pool.Reserve1, Price0Denominator: pool.Reserve0, Price1Numerator: pool.Reserve0, Price1Denominator: pool.Reserve1, UpdatedBlock: pool.UpdatedBlock})
	}
	return result
}

func (store *Store) TWAPs() []TWAP {
	events := store.Events()
	type observations struct{ previous, latest *Event }
	byPool := map[string]observations{}
	for index := range events {
		event := &events[index]
		if event.ContractVersion != "ynx-dex-cpmm-v1" {
			continue
		}
		if event.Price0Cumulative == "" || event.Price1Cumulative == "" {
			continue
		}
		item := byPool[event.Pool]
		item.previous, item.latest = item.latest, event
		byPool[event.Pool] = item
	}
	result := make([]TWAP, 0, len(byPool))
	for pool, item := range byPool {
		if item.previous == nil || item.latest == nil || !item.latest.Timestamp.After(item.previous.Timestamp) {
			continue
		}
		price0Before, _ := new(big.Int).SetString(item.previous.Price0Cumulative, 10)
		price0After, _ := new(big.Int).SetString(item.latest.Price0Cumulative, 10)
		price1Before, _ := new(big.Int).SetString(item.previous.Price1Cumulative, 10)
		price1After, _ := new(big.Int).SetString(item.latest.Price1Cumulative, 10)
		seconds := uint64(item.latest.Timestamp.Sub(item.previous.Timestamp) / time.Second)
		if seconds < MinimumTWAPInterval || price0After.Cmp(price0Before) < 0 || price1After.Cmp(price1Before) < 0 {
			continue
		}
		average0 := new(big.Int).Sub(price0After, price0Before)
		average0.Div(average0, new(big.Int).SetUint64(seconds))
		average1 := new(big.Int).Sub(price1After, price1Before)
		average1.Div(average1, new(big.Int).SetUint64(seconds))
		result = append(result, TWAP{Pool: pool, Token0: item.latest.Token0, Token1: item.latest.Token1, Price0AverageX112: average0.String(), Price1AverageX112: average1.String(), IntervalSeconds: seconds, FromBlock: item.previous.BlockNumber, ToBlock: item.latest.BlockNumber})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Pool < result[j].Pool })
	return result
}

func (store *Store) Fees() []FeeSummary {
	events := store.Events()
	type totals struct {
		token0, token1                   string
		swap0, swap1, claimed0, claimed1 *big.Int
	}
	byPool := map[string]*totals{}
	for _, event := range events {
		if event.ContractVersion != "ynx-dex-cpmm-v1" {
			continue
		}
		item := byPool[event.Pool]
		if item == nil {
			item = &totals{event.Token0, event.Token1, new(big.Int), new(big.Int), new(big.Int), new(big.Int)}
			byPool[event.Pool] = item
		}
		fee0, _ := new(big.Int).SetString(event.Fee0, 10)
		fee1, _ := new(big.Int).SetString(event.Fee1, 10)
		if event.Type == "swap" {
			item.swap0.Add(item.swap0, fee0)
			item.swap1.Add(item.swap1, fee1)
		} else if event.Type == "protocol-fee-claimed" {
			item.claimed0.Add(item.claimed0, fee0)
			item.claimed1.Add(item.claimed1, fee1)
		}
	}
	result := make([]FeeSummary, 0, len(byPool))
	for pool, item := range byPool {
		result = append(result, FeeSummary{pool, item.token0, item.token1, item.swap0.String(), item.swap1.String(), item.claimed0.String(), item.claimed1.String()})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Pool < result[j].Pool })
	return result
}

func (store *Store) persist(payload storePayload) error {
	envelope := storeEnvelope{Payload: payload, Integrity: store.integrity(payload)}
	data, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(store.path), 0o700); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(store.path), ".dex-state-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, store.path)
}

func (store *Store) integrity(payload storePayload) string {
	data, _ := json.Marshal(payload)
	mac := hmac.New(sha256.New, store.secret)
	_, _ = mac.Write(data)
	return hex.EncodeToString(mac.Sum(nil))
}

func decodeExact(data []byte, output any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("multiple JSON values")
	}
	return nil
}
