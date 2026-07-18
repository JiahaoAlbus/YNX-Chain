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
	"sync"
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
	store := &Store{path: path, secret: append([]byte(nil), secret...), state: storePayload{SchemaVersion: 1, Events: []Event{}}}
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
	if envelope.Payload.SchemaVersion != 1 || !hmac.Equal([]byte(envelope.Integrity), []byte(store.integrity(envelope.Payload))) {
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
	store.state = envelope.Payload
	return store, nil
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

func (store *Store) Pools() []Pool {
	store.mu.RLock()
	defer store.mu.RUnlock()
	latest := map[string]Pool{}
	for _, event := range store.state.Events {
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

func (store *Store) Positions(account string) []Position {
	store.mu.RLock()
	defer store.mu.RUnlock()
	type totals struct{ lp, add0, add1, remove0, remove1 *big.Int }
	byPool := map[string]*totals{}
	for _, event := range store.state.Events {
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
