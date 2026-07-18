package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/dex"
)

var buildCommit = "unknown"
var buildRelease = "local"
var buildTime = "unknown"

func main() {
	stateSecret, err := base64.RawStdEncoding.DecodeString(os.Getenv("YNX_DEX_STATE_HMAC_SECRET"))
	if err != nil {
		log.Fatal("YNX_DEX_STATE_HMAC_SECRET must be unpadded base64")
	}
	store, err := dex.OpenStore(env("YNX_DEX_STATE_PATH", "tmp/dex/indexer-state.json"), stateSecret)
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	authorizer := dex.SessionAuthorizer(dex.UnavailableAuthorizer{})
	if endpoint := strings.TrimSpace(os.Getenv("YNX_DEX_WALLET_INTROSPECTION_URL")); endpoint != "" {
		authorizer = dex.RemoteAuthorizer{URL: endpoint}
	}
	tokens, err := loadTokens(env("YNX_DEX_TOKEN_LIST_PATH", "token-lists/dex-testnet.json"))
	if err != nil {
		log.Fatal(err)
	}
	server, err := dex.NewServer(store, buildinfo.Info{Commit: buildCommit, Release: buildRelease, BuildTime: buildTime}, os.Getenv("YNX_DEX_INDEXER_INGESTION_KEY"), authorizer, tokens...)
	if err != nil {
		log.Fatal(err)
	}
	if factory := strings.TrimSpace(os.Getenv("DEX_FACTORY_ADDRESS")); factory != "" {
		startBlock, err := envUint("DEX_INDEXER_START_BLOCK", 0)
		if err != nil || startBlock == 0 {
			log.Fatal("DEX_INDEXER_START_BLOCK must be positive when DEX_FACTORY_ADDRESS is set")
		}
		confirmations, err := envUint("DEX_INDEXER_CONFIRMATIONS", 12)
		if err != nil || confirmations == 0 {
			log.Fatal("DEX_INDEXER_CONFIRMATIONS must be positive")
		}
		poller, err := dex.NewEVMPoller(store, dex.EVMPollerConfig{RPCURL: env("YNX_EVM_RPC_URL", "https://evm.ynxweb4.com"), Factory: factory, StartBlock: startBlock, Confirmations: confirmations, CursorPath: env("YNX_DEX_CURSOR_PATH", "tmp/dex/evm-cursor.json"), CursorSecret: stateSecret})
		if err != nil {
			log.Fatal(err)
		}
		go func() {
			ticker := time.NewTicker(5 * time.Second)
			defer ticker.Stop()
			for {
				advanced, err := poller.PollOnce(ctx)
				if err != nil {
					log.Printf("YNX DEX confirmed EVM poll failed: %v", err)
				} else if advanced {
					log.Printf("YNX DEX confirmed EVM cursor advanced")
				}
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
				}
			}
		}()
	}
	httpServer := &http.Server{Addr: env("YNX_DEX_HTTP_ADDR", "127.0.0.1:6436"), Handler: server.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdown)
	}()
	log.Printf("YNX DEX Indexer API listening on %s", httpServer.Addr)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func envUint(key string, fallback uint64) (uint64, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	return strconv.ParseUint(value, 10, 64)
}

type tokenList struct {
	SchemaVersion int         `json:"schemaVersion"`
	ProductID     string      `json:"productId"`
	ChainID       uint64      `json:"chainId"`
	Mainnet       bool        `json:"mainnet"`
	Tokens        []dex.Token `json:"tokens"`
	Status        string      `json:"status"`
}

func loadTokens(path string) ([]dex.Token, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open token list: %w", err)
	}
	defer file.Close()
	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	var list tokenList
	if err := decoder.Decode(&list); err != nil {
		return nil, fmt.Errorf("decode token list: %w", err)
	}
	if decoder.Decode(&struct{}{}) == nil {
		return nil, fmt.Errorf("decode token list: trailing JSON value")
	}
	if list.SchemaVersion != 1 || list.ProductID != "ynx-dex" || list.ChainID != dex.ChainID || list.Mainnet {
		return nil, fmt.Errorf("token list identity mismatch")
	}
	if len(list.Tokens) == 0 && list.Status != "no-owner-reviewed-test-tokens" {
		return nil, fmt.Errorf("empty token list must declare unavailable status")
	}
	if len(list.Tokens) > 0 && list.Status != "owner-reviewed-testnet" {
		return nil, fmt.Errorf("populated token list must declare reviewed status")
	}
	return list.Tokens, nil
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
