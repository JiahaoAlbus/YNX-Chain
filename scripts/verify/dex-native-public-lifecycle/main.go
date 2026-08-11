package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

type client struct {
	base *url.URL
	http *http.Client
}

type actionEvidence struct {
	Action          string `json:"action"`
	Route           string `json:"route"`
	TransactionHash string `json:"transactionHash"`
	HTTPStatus      int    `json:"httpStatus,omitempty"`
}

type nodeEvidence struct {
	Height          uint64 `json:"height"`
	LatestBlockHash string `json:"latestBlockHash"`
	BuildCommit     string `json:"buildCommit"`
	Persistence     bool   `json:"persistence"`
}

type indexerEvidence struct {
	MarketSourceConfigured bool   `json:"marketSourceConfigured"`
	MarketAvailable        bool   `json:"marketAvailable"`
	ExecutionAvailable     bool   `json:"executionAvailable"`
	IndexedPools           int    `json:"indexedPools"`
	IndexedTransactions    int    `json:"indexedTransactions"`
	SwapCount              int    `json:"swapCount"`
	CandleCount            int    `json:"candleCount"`
	Source                 string `json:"source"`
}

type evidence struct {
	SchemaVersion   int                 `json:"schemaVersion"`
	ProductID       string              `json:"productId"`
	Network         string              `json:"network"`
	ChainID         uint64              `json:"chainId"`
	Mainnet         bool                `json:"mainnet"`
	RecordedAt      time.Time           `json:"recordedAt"`
	Issuer          string              `json:"issuer"`
	Trader          string              `json:"trader"`
	AssetID         string              `json:"assetId"`
	PoolID          string              `json:"poolId"`
	Actions         []actionEvidence    `json:"actions"`
	Pool            chain.NativeDexPool `json:"pool"`
	EventCount      int                 `json:"eventCount"`
	Node            nodeEvidence        `json:"node"`
	Indexer         indexerEvidence     `json:"indexer"`
	SecretsStored   bool                `json:"secretsStored"`
	ObservationMode string              `json:"observationMode"`
}

func main() {
	rest := flag.String("rest", "http://127.0.0.1:6420", "authoritative YNX REST origin")
	indexer := flag.String("indexer", "http://127.0.0.1:6482", "DEX indexer origin")
	output := flag.String("output", "", "new JSON evidence path")
	observeExisting := flag.Bool("observe-existing", false, "observe and verify the existing canonical Testnet lifecycle without signing new actions")
	flag.Parse()
	var err error
	if *observeExisting {
		err = observe(*rest, *indexer, *output)
	} else {
		err = run(*rest, *indexer, *output)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(restOrigin, indexerOrigin, output string) error {
	if output == "" {
		return errors.New("-output is required")
	}
	if _, err := os.Stat(output); !errors.Is(err, os.ErrNotExist) {
		return errors.New("evidence output must not already exist")
	}
	rest, err := newClient(restOrigin, 45*time.Second)
	if err != nil {
		return err
	}
	indexer, err := newClient(indexerOrigin, 15*time.Second)
	if err != nil {
		return err
	}
	issuerKey, err := randomKey()
	if err != nil {
		return err
	}
	defer zero(issuerKey.Serialize())
	traderKey, err := randomKey()
	if err != nil {
		return err
	}
	defer zero(traderKey.Serialize())
	issuer, err := consensus.NativeAddress(issuerKey.PubKey().SerializeCompressed())
	if err != nil {
		return err
	}
	trader, err := consensus.NativeAddress(traderKey.PubKey().SerializeCompressed())
	if err != nil {
		return err
	}
	for _, address := range []string{issuer, trader} {
		var funded chain.Transaction
		if status, err := rest.post("/faucet", map[string]any{"address": address, "amount": 100}, &funded); err != nil || status != http.StatusCreated || funded.To != address || funded.Amount != 100 {
			return fmt.Errorf("fund %s: status=%d transaction=%+v: %w", address, status, funded, err)
		}
	}

	const assetID, poolID = "ynx-usd-test", "dex_ynxt_yusdt"
	deadline := time.Now().UTC().Add(30 * time.Minute).Unix()
	actions := []struct {
		key     *secp256k1.PrivateKey
		action  string
		payload any
		nonce   uint64
		route   string
		status  int
	}{
		{issuerKey, consensus.ActionDexAssetCreate, consensus.DexAssetCreatePayload{AssetID: assetID, Symbol: "YUSDT", Name: "YNX USD Test Asset", Decimals: 6, MaxSupply: 10_000_000, InitialSupply: 1_000_000}, 1, "/dex/assets", http.StatusCreated},
		{issuerKey, consensus.ActionDexAssetTransfer, consensus.DexAssetTransferPayload{AssetID: assetID, Recipient: trader, Amount: 200_000}, 2, "/dex/assets/" + assetID + "/transfer", http.StatusOK},
		{issuerKey, consensus.ActionDexPoolCreate, consensus.DexPoolCreatePayload{PoolID: poolID, Asset0: consensus.DexNativeAssetID, Asset1: assetID, FeeBps: 30}, 3, "/dex/pools", http.StatusCreated},
		{issuerKey, consensus.ActionDexLiquidityAdd, consensus.DexLiquidityPayload{PoolID: poolID, Amount0: 50, Amount1: 100_000, MinShares: 2_200, DeadlineUnix: deadline}, 4, "/dex/pools/" + poolID + "/liquidity/add", http.StatusOK},
		{traderKey, consensus.ActionDexSwapExactInput, consensus.DexSwapExactInputPayload{PoolID: poolID, AssetIn: assetID, AmountIn: 10_000, MinAmountOut: 4, DeadlineUnix: deadline}, 1, "/dex/pools/" + poolID + "/swaps/exact-input", http.StatusOK},
		{traderKey, consensus.ActionDexSwapExactOutput, consensus.DexSwapExactOutputPayload{PoolID: poolID, AssetOut: assetID, AmountOut: 2_000, MaxAmountIn: 2, DeadlineUnix: deadline}, 2, "/dex/pools/" + poolID + "/swaps/exact-output", http.StatusOK},
		{issuerKey, consensus.ActionDexLiquidityRemove, consensus.DexLiquidityRemovePayload{PoolID: poolID, Shares: 100, MinAmount0: 1, MinAmount1: 1, DeadlineUnix: deadline}, 5, "/dex/pools/" + poolID + "/liquidity/remove", http.StatusOK},
	}
	result := evidence{SchemaVersion: 1, ProductID: "ynx-dex", Network: "YNX Testnet", ChainID: 6423, Mainnet: false, RecordedAt: time.Now().UTC(), Issuer: issuer, Trader: trader, AssetID: assetID, PoolID: poolID, SecretsStored: false, ObservationMode: "signed-live-lifecycle"}
	for _, item := range actions {
		signed, err := consensus.NewSignedApplicationAction(item.key, 6423, item.action, item.payload, item.nonce)
		if err != nil {
			return err
		}
		raw, err := consensus.EncodeSignedApplicationAction(signed)
		if err != nil {
			return err
		}
		var response struct {
			Transaction chain.Transaction `json:"transaction"`
			Replayed    bool              `json:"replayed"`
		}
		status, err := rest.postRaw(item.route, raw, &response)
		if err != nil || status != item.status || response.Replayed || response.Transaction.Hash != consensus.ApplicationActionHash(raw) {
			return fmt.Errorf("%s: status=%d response=%+v: %w", item.action, status, response, err)
		}
		result.Actions = append(result.Actions, actionEvidence{Action: item.action, Route: item.route, TransactionHash: response.Transaction.Hash, HTTPStatus: status})
	}

	if err := waitFor(90*time.Second, 2*time.Second, func() (bool, error) {
		var events struct {
			Items []chain.NativeDexEvent `json:"items"`
		}
		if err := rest.get("/dex/events", &events); err != nil {
			return false, nil
		}
		if len(events.Items) != len(actions) {
			return false, nil
		}
		for _, event := range events.Items {
			if event.BlockHeight == 0 || event.BlockHash == "" || event.AuditHash == "" {
				return false, nil
			}
		}
		result.EventCount = len(events.Items)
		return true, nil
	}); err != nil {
		return fmt.Errorf("wait for committed DEX events: %w", err)
	}
	if err := rest.get("/dex/pools/"+poolID, &result.Pool); err != nil {
		return err
	}
	if result.Pool.Reserve0 <= 0 || result.Pool.Reserve1 <= 0 || result.Pool.TotalShares <= 0 || result.Pool.BlockHeight == 0 || result.Pool.BlockHash == "" {
		return fmt.Errorf("committed pool is incomplete: %+v", result.Pool)
	}
	var status struct {
		Height           uint64 `json:"height"`
		LatestBlockHash  string `json:"latestBlockHash"`
		Persistence      bool   `json:"persistence"`
		PersistenceError string `json:"persistenceError"`
		Build            struct {
			Commit string `json:"commit"`
		} `json:"build"`
	}
	if err := rest.get("/status", &status); err != nil || !status.Persistence || status.PersistenceError != "" || status.Height == 0 || status.LatestBlockHash == "" {
		return fmt.Errorf("authoritative node is not durable: %+v: %w", status, err)
	}
	result.Node = nodeEvidence{Height: status.Height, LatestBlockHash: status.LatestBlockHash, BuildCommit: status.Build.Commit, Persistence: status.Persistence}

	if err := waitFor(90*time.Second, 2*time.Second, func() (bool, error) {
		var health struct {
			MarketSourceConfigured bool   `json:"marketSourceConfigured"`
			MarketAvailable        bool   `json:"marketAvailable"`
			ExecutionAvailable     bool   `json:"executionAvailable"`
			IndexedPools           int    `json:"indexedPools"`
			Source                 string `json:"source"`
		}
		if err := indexer.get("/health", &health); err != nil {
			return false, nil
		}
		if !health.MarketSourceConfigured || !health.MarketAvailable || !health.ExecutionAvailable || health.IndexedPools != 1 {
			return false, nil
		}
		result.Indexer.MarketSourceConfigured, result.Indexer.MarketAvailable, result.Indexer.ExecutionAvailable = health.MarketSourceConfigured, health.MarketAvailable, health.ExecutionAvailable
		result.Indexer.IndexedPools, result.Indexer.Source = health.IndexedPools, health.Source
		return true, nil
	}); err != nil {
		return fmt.Errorf("wait for market indexer: %w", err)
	}
	for path, target := range map[string]*int{"/v1/transactions?limit=100": &result.Indexer.IndexedTransactions, "/v1/swaps?limit=100": &result.Indexer.SwapCount, "/v1/candles?pool=" + poolID + "&interval=60&limit=100": &result.Indexer.CandleCount} {
		var envelope struct {
			Items []json.RawMessage `json:"items"`
		}
		if err := indexer.get(path, &envelope); err != nil {
			return err
		}
		*target = len(envelope.Items)
	}
	if result.Indexer.IndexedTransactions != len(actions)-1 || result.Indexer.SwapCount != 2 || result.Indexer.CandleCount == 0 {
		return fmt.Errorf("indexer market history is incomplete: %+v", result.Indexer)
	}

	payload, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(output, append(payload, '\n'), 0o600); err != nil {
		return err
	}
	fmt.Printf("public native DEX lifecycle passed: actions=%d swaps=%d pool=%s height=%d\n", len(result.Actions), result.Indexer.SwapCount, poolID, result.Node.Height)
	return nil
}

func observe(restOrigin, indexerOrigin, output string) error {
	if output == "" {
		return errors.New("-output is required")
	}
	if _, err := os.Stat(output); !errors.Is(err, os.ErrNotExist) {
		return errors.New("evidence output must not already exist")
	}
	rest, err := newClient(restOrigin, 30*time.Second)
	if err != nil {
		return err
	}
	indexer, err := newClient(indexerOrigin, 15*time.Second)
	if err != nil {
		return err
	}
	const assetID, poolID = "ynx-usd-test", "dex_ynxt_yusdt"
	var envelope struct {
		Items []chain.NativeDexEvent `json:"items"`
	}
	if err := rest.get("/dex/events", &envelope); err != nil {
		return err
	}
	expected := []struct{ action, route string }{
		{consensus.ActionDexAssetCreate, "/dex/assets"},
		{consensus.ActionDexAssetTransfer, "/dex/assets/" + assetID + "/transfer"},
		{consensus.ActionDexPoolCreate, "/dex/pools"},
		{consensus.ActionDexLiquidityAdd, "/dex/pools/" + poolID + "/liquidity/add"},
		{consensus.ActionDexSwapExactInput, "/dex/pools/" + poolID + "/swaps/exact-input"},
		{consensus.ActionDexSwapExactOutput, "/dex/pools/" + poolID + "/swaps/exact-output"},
		{consensus.ActionDexLiquidityRemove, "/dex/pools/" + poolID + "/liquidity/remove"},
	}
	if len(envelope.Items) != len(expected) {
		return fmt.Errorf("canonical lifecycle event count is %d, want %d", len(envelope.Items), len(expected))
	}
	result := evidence{SchemaVersion: 1, ProductID: "ynx-dex", Network: "YNX Testnet", ChainID: 6423, Mainnet: false, RecordedAt: time.Now().UTC(), AssetID: assetID, PoolID: poolID, SecretsStored: false, ObservationMode: "authoritative-post-commit"}
	for index, event := range envelope.Items {
		if event.Type != expected[index].action || event.TxHash == "" || event.BlockHeight == 0 || event.BlockHash == "" || event.AuditHash == "" {
			return fmt.Errorf("canonical lifecycle event %d is incomplete: %+v", index, event)
		}
		result.Actions = append(result.Actions, actionEvidence{Action: event.Type, Route: expected[index].route, TransactionHash: event.TxHash})
	}
	result.Issuer, result.Trader, result.EventCount = envelope.Items[0].Signer, envelope.Items[4].Signer, len(envelope.Items)
	if result.Issuer == "" || result.Trader == "" || result.Issuer == result.Trader {
		return errors.New("canonical issuer and trader identities are invalid")
	}
	if err := rest.get("/dex/pools/"+poolID, &result.Pool); err != nil {
		return err
	}
	if result.Pool.Reserve0 <= 0 || result.Pool.Reserve1 <= 0 || result.Pool.TotalShares <= 0 || result.Pool.BlockHeight == 0 || result.Pool.BlockHash == "" {
		return fmt.Errorf("committed pool is incomplete: %+v", result.Pool)
	}
	var status struct {
		Height           uint64 `json:"height"`
		LatestBlockHash  string `json:"latestBlockHash"`
		Persistence      bool   `json:"persistence"`
		PersistenceError string `json:"persistenceError"`
		Build            struct {
			Commit string `json:"commit"`
		} `json:"build"`
	}
	if err := rest.get("/status", &status); err != nil || !status.Persistence || status.PersistenceError != "" || status.Height == 0 || status.LatestBlockHash == "" {
		return fmt.Errorf("authoritative node is not durable: %+v: %w", status, err)
	}
	result.Node = nodeEvidence{Height: status.Height, LatestBlockHash: status.LatestBlockHash, BuildCommit: status.Build.Commit, Persistence: status.Persistence}
	if err := waitFor(90*time.Second, 2*time.Second, func() (bool, error) {
		var health struct {
			MarketSourceConfigured bool   `json:"marketSourceConfigured"`
			MarketAvailable        bool   `json:"marketAvailable"`
			ExecutionAvailable     bool   `json:"executionAvailable"`
			IndexedPools           int    `json:"indexedPools"`
			Source                 string `json:"source"`
		}
		if err := indexer.get("/health", &health); err != nil {
			return false, nil
		}
		var transactions, swaps, candles struct {
			Items []json.RawMessage `json:"items"`
		}
		if indexer.get("/v1/transactions?limit=100", &transactions) != nil || indexer.get("/v1/swaps?limit=100", &swaps) != nil || indexer.get("/v1/candles?pool="+poolID+"&interval=60&limit=100", &candles) != nil {
			return false, nil
		}
		if !health.MarketSourceConfigured || !health.MarketAvailable || !health.ExecutionAvailable || health.IndexedPools != 1 || len(transactions.Items) != 6 || len(swaps.Items) != 2 || len(candles.Items) == 0 {
			return false, nil
		}
		result.Indexer = indexerEvidence{MarketSourceConfigured: true, MarketAvailable: true, ExecutionAvailable: true, IndexedPools: 1, IndexedTransactions: len(transactions.Items), SwapCount: len(swaps.Items), CandleCount: len(candles.Items), Source: health.Source}
		return true, nil
	}); err != nil {
		return fmt.Errorf("wait for complete market index: %w", err)
	}
	payload, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(output, append(payload, '\n'), 0o600); err != nil {
		return err
	}
	fmt.Printf("public native DEX observation passed: actions=%d swaps=%d pool=%s height=%d\n", len(result.Actions), result.Indexer.SwapCount, poolID, result.Node.Height)
	return nil
}

func newClient(origin string, timeout time.Duration) (*client, error) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(origin), "/"))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("origin must be an absolute HTTP(S) origin")
	}
	return &client{base: parsed, http: &http.Client{Timeout: timeout}}, nil
}

func (c *client) endpoint(path string) string {
	endpoint := *c.base
	parsed, _ := url.Parse(path)
	endpoint.Path, endpoint.RawQuery = parsed.Path, parsed.RawQuery
	return endpoint.String()
}

func (c *client) get(path string, output any) error {
	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, c.endpoint(path), nil)
	if err != nil {
		return err
	}
	return c.do(request, http.StatusOK, output)
}

func (c *client) post(path string, body any, output any) (int, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return 0, err
	}
	return c.postRaw(path, raw, output)
}

func (c *client) postRaw(path string, raw []byte, output any) (int, error) {
	request, err := http.NewRequestWithContext(context.Background(), http.MethodPost, c.endpoint(path), bytes.NewReader(raw))
	if err != nil {
		return 0, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return response.StatusCode, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return response.StatusCode, fmt.Errorf("HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(data)))
	}
	if err := json.Unmarshal(data, output); err != nil {
		return response.StatusCode, err
	}
	return response.StatusCode, nil
}

func (c *client) do(request *http.Request, expected int, output any) error {
	response, err := c.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return err
	}
	if response.StatusCode != expected {
		return fmt.Errorf("%s returned HTTP %d: %s", request.URL.Path, response.StatusCode, strings.TrimSpace(string(data)))
	}
	return json.Unmarshal(data, output)
}

func randomKey() (*secp256k1.PrivateKey, error) {
	for {
		raw := make([]byte, 32)
		if _, err := rand.Read(raw); err != nil {
			return nil, err
		}
		key := secp256k1.PrivKeyFromBytes(raw)
		zero(raw)
		if !key.Key.IsZero() {
			return key, nil
		}
	}
}

func zero(value []byte) {
	for index := range value {
		value[index] = 0
	}
}

func waitFor(timeout, interval time.Duration, check func() (bool, error)) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		ok, err := check()
		if err != nil {
			return err
		}
		if ok {
			return nil
		}
		time.Sleep(interval)
	}
	return errors.New("timed out")
}
