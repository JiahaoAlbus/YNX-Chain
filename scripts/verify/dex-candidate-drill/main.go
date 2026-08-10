package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

var roles = []string{"primary", "singapore", "silicon-valley", "seoul"}

type roleEvidence struct {
	Role          string `json:"role"`
	StateSHA256   string `json:"stateSha256"`
	AppHash       string `json:"appHash"`
	RestartPassed bool   `json:"restartPassed"`
}

type evidence struct {
	SchemaVersion       int            `json:"schemaVersion"`
	Source              string         `json:"source"`
	MigrationSHA256     string         `json:"migrationSha256"`
	MigrationHeight     uint64         `json:"migrationHeight"`
	MigrationStateHash  string         `json:"migrationStateHash"`
	Signer              string         `json:"signer"`
	InitialBalanceYNXT  int64          `json:"initialBalanceYnxt"`
	InitialNonce        uint64         `json:"initialNonce"`
	CandidateHeight     int64          `json:"candidateHeight"`
	TransactionHashes   []string       `json:"transactionHashes"`
	AssetID             string         `json:"assetId"`
	PoolID              string         `json:"poolId"`
	EventCount          int            `json:"eventCount"`
	FourRoleDeterminism bool           `json:"fourRoleDeterminism"`
	ExpiredSwapRejected bool           `json:"expiredSwapRejected"`
	ConcurrentReadClass string         `json:"concurrentReadClass"`
	ConcurrentReadUsers int            `json:"concurrentReadUsers"`
	ConcurrentReadTotal int            `json:"concurrentReadTotal"`
	ConcurrentReadOK    int64          `json:"concurrentReadOk"`
	ConcurrentReadMs    int64          `json:"concurrentReadDurationMs"`
	Roles               []roleEvidence `json:"roles"`
	RecordedAt          time.Time      `json:"recordedAt"`
}

func main() {
	migrationPath := flag.String("migration", "", "verified YNX consensus migration JSON")
	keyPath := flag.String("key", "", "mode-0600 raw 32-byte Testnet key")
	outputDir := flag.String("output", "", "new or empty evidence directory")
	flag.Parse()
	if err := run(*migrationPath, *keyPath, *outputDir); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(migrationPath, keyPath, outputDir string) error {
	if migrationPath == "" || keyPath == "" || outputDir == "" {
		return errors.New("-migration, -key, and -output are required")
	}
	if err := os.MkdirAll(outputDir, 0o700); err != nil {
		return err
	}
	if entries, err := os.ReadDir(outputDir); err != nil || len(entries) != 0 {
		return errors.New("evidence output directory must be empty")
	}
	migrationRaw, err := os.ReadFile(migrationPath)
	if err != nil {
		return err
	}
	var migration chain.ConsensusMigrationState
	if err := json.Unmarshal(migrationRaw, &migration); err != nil {
		return err
	}
	if err := migration.Validate(); err != nil {
		return err
	}
	keyRaw, err := readPrivateKey(keyPath)
	if err != nil {
		return err
	}
	key := secp256k1.PrivKeyFromBytes(keyRaw)
	signer, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		return err
	}
	var owner chain.ConsensusAccount
	found := false
	for _, account := range migration.Accounts {
		if account.Address == signer {
			owner, found = account, true
			break
		}
	}
	if !found || owner.Balance < 60 {
		return errors.New("candidate signer is not funded with at least 60 YNXT in the migration")
	}

	blockTime := time.Date(2026, 8, 10, 8, 0, 0, 0, time.UTC)
	deadline := blockTime.Add(time.Hour).Unix()
	assetID, poolID := "ynx-dex-drill", "dex_ynxt_drill"
	nonce := owner.Nonce
	payloads := []struct {
		action string
		value  any
	}{
		{consensus.ActionDexAssetCreate, consensus.DexAssetCreatePayload{AssetID: assetID, Symbol: "YDRILL", Name: "YNX DEX Candidate Drill", Decimals: 6, MaxSupply: 10_000, InitialSupply: 1_000}},
		{consensus.ActionDexPoolCreate, consensus.DexPoolCreatePayload{PoolID: poolID, Asset0: consensus.DexNativeAssetID, Asset1: assetID, FeeBps: 30}},
		{consensus.ActionDexLiquidityAdd, consensus.DexLiquidityPayload{PoolID: poolID, Amount0: 20, Amount1: 40, MinShares: 28, DeadlineUnix: deadline}},
		{consensus.ActionDexSwapExactInput, consensus.DexSwapExactInputPayload{PoolID: poolID, AssetIn: assetID, AmountIn: 5, MinAmountOut: 1, DeadlineUnix: deadline}},
		{consensus.ActionDexSwapExactOutput, consensus.DexSwapExactOutputPayload{PoolID: poolID, AssetOut: assetID, AmountOut: 2, MaxAmountIn: 3, DeadlineUnix: deadline}},
		{consensus.ActionDexLiquidityRemove, consensus.DexLiquidityRemovePayload{PoolID: poolID, Shares: 2, MinAmount0: 1, MinAmount1: 1, DeadlineUnix: deadline}},
	}
	txs := make([][]byte, 0, len(payloads))
	txHashes := make([]string, 0, len(payloads))
	for _, item := range payloads {
		nonce++
		tx, err := consensus.NewSignedApplicationAction(key, migration.Network.ChainID, item.action, item.value, nonce)
		if err != nil {
			return err
		}
		raw, err := consensus.EncodeSignedApplicationAction(tx)
		if err != nil {
			return err
		}
		txs = append(txs, raw)
		txHashes = append(txHashes, consensus.ApplicationActionHash(raw))
	}

	ctx := context.Background()
	height := int64(migration.Height) + 1
	var canonical []byte
	result := evidence{SchemaVersion: 1, Source: "current-public-state-copy-four-application-candidate", MigrationSHA256: sum(migrationRaw), MigrationHeight: migration.Height, MigrationStateHash: migration.StateHash, Signer: signer, InitialBalanceYNXT: owner.Balance, InitialNonce: owner.Nonce, CandidateHeight: height, TransactionHashes: txHashes, AssetID: assetID, PoolID: poolID, FourRoleDeterminism: true, ExpiredSwapRejected: true, ConcurrentReadClass: "local-one-process-current-public-state-copy-not-public-slo", ConcurrentReadUsers: 25, ConcurrentReadTotal: len(roles) * 100, RecordedAt: time.Now().UTC()}
	capacityStarted := time.Now()
	for _, role := range roles {
		roleDir := filepath.Join(outputDir, "roles", role)
		if err := os.MkdirAll(roleDir, 0o700); err != nil {
			return err
		}
		statePath := filepath.Join(roleDir, "state.json")
		app, err := consensus.NewPersistentApplication(migration, statePath)
		if err != nil {
			return fmt.Errorf("%s initialize: %w", role, err)
		}
		finalized, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: blockTime, Txs: txs})
		if err != nil || len(finalized.TxResults) != len(txs) {
			return fmt.Errorf("%s finalize: %w", role, err)
		}
		for index, txResult := range finalized.TxResults {
			if txResult.Code != 0 {
				return fmt.Errorf("%s transaction %d rejected: %s", role, index, txResult.Log)
			}
		}
		if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
			return fmt.Errorf("%s commit: %w", role, err)
		}
		snapshot, err := query(app, "/state")
		if err != nil {
			return err
		}
		if canonical == nil {
			canonical = snapshot
		} else if !bytes.Equal(canonical, snapshot) {
			return fmt.Errorf("%s committed state diverged", role)
		}
		var state consensus.CommittedState
		if err := json.Unmarshal(snapshot, &state); err != nil {
			return err
		}
		eventsRaw, err := query(app, "/dex/events")
		if err != nil {
			return err
		}
		var events []consensus.BFTDexEvent
		if err := json.Unmarshal(eventsRaw, &events); err != nil || len(events) != len(txs) {
			return fmt.Errorf("%s DEX event evidence is incomplete", role)
		}
		result.EventCount = len(events)
		expiredTx, err := consensus.NewSignedApplicationAction(key, migration.Network.ChainID, consensus.ActionDexSwapExactInput, consensus.DexSwapExactInputPayload{PoolID: poolID, AssetIn: assetID, AmountIn: 1, MinAmountOut: 1, DeadlineUnix: blockTime.Unix()}, nonce+1)
		if err != nil {
			return err
		}
		expired, err := consensus.EncodeSignedApplicationAction(expiredTx)
		if err != nil {
			return err
		}
		rejected, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height + 1, Time: blockTime.Add(time.Second), Txs: [][]byte{expired}})
		if err != nil || len(rejected.TxResults) != 1 || rejected.TxResults[0].Code == 0 {
			return fmt.Errorf("%s expired swap was not rejected", role)
		}
		restarted, err := consensus.NewPersistentApplication(migration, statePath)
		if err != nil {
			return fmt.Errorf("%s restart: %w", role, err)
		}
		restartedSnapshot, err := query(restarted, "/state")
		if err != nil || !bytes.Equal(snapshot, restartedSnapshot) {
			return fmt.Errorf("%s restart changed committed state", role)
		}
		completed, err := concurrentReadProbe(restarted, signer, result.ConcurrentReadUsers, 100)
		if err != nil {
			return fmt.Errorf("%s concurrent read probe: %w", role, err)
		}
		result.ConcurrentReadOK += int64(completed)
		stateRaw, err := os.ReadFile(statePath)
		if err != nil {
			return err
		}
		result.Roles = append(result.Roles, roleEvidence{Role: role, StateSHA256: sum(stateRaw), AppHash: state.AppHash, RestartPassed: true})
	}
	result.ConcurrentReadMs = time.Since(capacityStarted).Milliseconds()
	if result.ConcurrentReadOK != int64(result.ConcurrentReadTotal) {
		return errors.New("current-state concurrent reads were incomplete")
	}
	for _, role := range result.Roles[1:] {
		if role.AppHash != result.Roles[0].AppHash || role.StateSHA256 != result.Roles[0].StateSHA256 {
			return errors.New("four-role AppHash or durable-state digest diverged")
		}
	}
	out, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(outputDir, "dex-candidate-evidence.json"), append(out, '\n'), 0o600); err != nil {
		return err
	}
	fmt.Printf("DEX candidate drill passed: height=%d roles=4 transactions=%d events=%d appHash=%s\n", height, len(txs), result.EventCount, result.Roles[0].AppHash)
	return nil
}

func concurrentReadProbe(app *consensus.Application, signer string, users, total int) (int, error) {
	paths := []string{"/dex/assets", "/dex/pools", "/dex/events", "/accounts/" + signer}
	expected := make(map[string][]byte, len(paths))
	for _, path := range paths {
		value, err := query(app, path)
		if err != nil {
			return 0, err
		}
		expected[path] = value
	}
	jobs := make(chan int)
	errs := make(chan error, total)
	var completed atomic.Int64
	var group sync.WaitGroup
	for worker := 0; worker < users; worker++ {
		group.Add(1)
		go func() {
			defer group.Done()
			for index := range jobs {
				path := paths[index%len(paths)]
				value, err := query(app, path)
				if err != nil || !bytes.Equal(value, expected[path]) {
					if err == nil {
						err = errors.New("concurrent query returned divergent committed state")
					}
					errs <- err
					continue
				}
				completed.Add(1)
			}
		}()
	}
	for index := 0; index < total; index++ {
		jobs <- index
	}
	close(jobs)
	group.Wait()
	close(errs)
	for err := range errs {
		return int(completed.Load()), err
	}
	return int(completed.Load()), nil
}

func readPrivateKey(path string) ([]byte, error) {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return nil, errors.New("private key must be a regular mode-0600 file")
	}
	raw, err := os.ReadFile(path)
	if err != nil || len(raw) != 32 || bytes.Equal(raw, make([]byte, 32)) {
		return nil, errors.New("private key must contain one canonical 32-byte scalar")
	}
	key := secp256k1.PrivKeyFromBytes(raw)
	if !bytes.Equal(key.Serialize(), raw) {
		return nil, errors.New("private key scalar is outside the canonical range")
	}
	return raw, nil
}

func query(app *consensus.Application, path string) ([]byte, error) {
	response, err := app.Query(context.Background(), &abcitypes.RequestQuery{Path: path})
	if err != nil || response.Code != 0 {
		return nil, fmt.Errorf("query %s failed: %s: %w", path, response.Log, err)
	}
	return response.Value, nil
}

func sum(raw []byte) string {
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}
