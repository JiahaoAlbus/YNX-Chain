package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"time"

	wallet "github.com/JiahaoAlbus/YNX-Chain/sdk/wallet/go"
)

// Central endpoint matrix d0f89797 freezes this as the canonical public EVM RPC.
const defaultRPC = "https://rpc.ynxweb4.com/evm"

func main() {
	if err := run(os.Args[1:], os.Stdout, &http.Client{}); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string, out io.Writer, client *http.Client) error {
	flags := flag.NewFlagSet("wallet-go-sdk-example", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	rpc := flags.String("rpc", defaultRPC, "YNX EVM HTTPS RPC")
	vectorPath := flags.String("vector", "packages/wallet-auth/testdata/product-session-http-proof-v1.json", "frozen Wallet Auth vector")
	timeout := flags.Duration("timeout", 10*time.Second, "RPC timeout")
	nativeChainID := flags.String("native-chain", wallet.YNXNativeChainID, "native YNX chain ID")
	chainID := flags.Int("chain-id", wallet.YNXChainID, "decimal YNX chain ID")
	evmChainID := flags.String("evm-chain-id", wallet.YNXEVMChainID, "hex EVM chain ID")
	nativeCurrency := flags.String("native-currency", wallet.YNXNativeCurrency, "native currency symbol")
	if err := flags.Parse(args); err != nil || flags.NArg() != 0 || *timeout <= 0 {
		return errors.New("invalid arguments")
	}
	parsedRPC, err := url.Parse(*rpc)
	if err != nil || parsedRPC.Scheme != "https" || parsedRPC.Host == "" || parsedRPC.User != nil {
		return errors.New("RPC must be an absolute HTTPS URL without userinfo")
	}
	config := wallet.NetworkConfig{NativeChainID: *nativeChainID, ChainID: *chainID, EVMChainID: *evmChainID, NativeCurrency: *nativeCurrency}
	if err := wallet.ValidateYNXNetworkConfig(config); err != nil {
		return err
	}

	vector, err := os.ReadFile(*vectorPath)
	if err != nil {
		return fmt.Errorf("read frozen vector: %w", err)
	}
	session, proof, method, path, body, expected, err := wallet.ParseVector(vector)
	if err != nil || wallet.SignBytes(proof) != expected {
		return errors.New("frozen Wallet Auth vector mismatch")
	}
	if err := wallet.VerifyProof(proof, session, method, path, body, time.Date(2026, 7, 15, 12, 0, 10, 0, time.UTC)); err != nil {
		return fmt.Errorf("verify frozen Wallet Auth vector: %w", err)
	}

	key, publicKey, err := wallet.GenerateDeviceIdentity()
	if err != nil {
		return err
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	selfSession := wallet.Session{SessionBinding: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ProductClientID: "ynx-go-example-v1", BundleID: "com.ynxweb4.go-example", ProductDeviceKey: publicKey}
	selfProof, err := wallet.SignProof(selfSession, wallet.Proof{Method: "POST", Path: "/v1/wallet/sessions/introspect", BodyDigest: wallet.BodyDigest([]byte("{}")), Nonce: "go_example_nonce_abcdefghijklmnopqr", IssuedAt: now.Format("2006-01-02T15:04:05.000Z"), ExpiresAt: now.Add(30 * time.Second).Format("2006-01-02T15:04:05.000Z")}, key)
	if err != nil || wallet.VerifyProof(selfProof, selfSession, selfProof.Method, selfProof.Path, []byte("{}"), now) != nil {
		return errors.New("ephemeral signing self-test failed")
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	client.Timeout = *timeout
	observedChainID, err := wallet.ProbeYNXTestnetRPCWithConfig(ctx, client, parsedRPC.String(), config)
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(map[string]any{"chainId": observedChainID, "connected": true, "ephemeralSigningVerified": true, "privateKeyPersisted": false, "protocol": "YNX_PRODUCT_SESSION_HTTP_PROOF_V1", "rpc": parsedRPC.String(), "vectorVerified": true})
}
