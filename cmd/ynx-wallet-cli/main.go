package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	wallet "github.com/JiahaoAlbus/YNX-Chain/sdk/wallet/go"
)

var version = "dev"

// Central endpoint matrix d0f89797 freezes this as the canonical public EVM RPC.
const defaultRPC = "https://rpc.ynxweb4.com/evm"

func main() {
	if err := run(os.Args[1:], os.Stdout, &http.Client{}); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string, out io.Writer, client *http.Client) error {
	if len(args) == 0 {
		return errors.New("command required: version, verify-vector, sign-self-test, or chain-status")
	}
	switch args[0] {
	case "version":
		return json.NewEncoder(out).Encode(map[string]any{"name": "ynx-wallet-cli", "version": version, "protocol": "YNX_PRODUCT_SESSION_HTTP_PROOF_V1", "productionSigned": false})
	case "verify-vector":
		flags := flag.NewFlagSet("verify-vector", flag.ContinueOnError)
		flags.SetOutput(io.Discard)
		path := flags.String("file", "packages/wallet-auth/testdata/product-session-http-proof-v1.json", "frozen vector")
		if err := flags.Parse(args[1:]); err != nil || flags.NArg() != 0 {
			return errors.New("invalid verify-vector arguments")
		}
		data, err := os.ReadFile(*path)
		if err != nil {
			return err
		}
		session, proof, method, endpoint, body, expected, err := wallet.ParseVector(data)
		if err != nil {
			return err
		}
		if wallet.SignBytes(proof) != expected {
			return errors.New("frozen sign bytes mismatch")
		}
		if err := wallet.VerifyProof(proof, session, method, endpoint, body, time.Date(2026, 7, 15, 12, 0, 10, 0, time.UTC)); err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(map[string]any{"verified": true, "protocol": "YNX_PRODUCT_SESSION_HTTP_PROOF_V1", "source": *path})
	case "sign-self-test":
		key, publicKey, err := wallet.GenerateDeviceIdentity()
		if err != nil {
			return err
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		session := wallet.Session{SessionBinding: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ProductClientID: "ynx-cli-v1", BundleID: "com.ynxweb4.cli", ProductDeviceKey: publicKey}
		proof, err := wallet.SignProof(session, wallet.Proof{Method: "POST", Path: "/v1/wallet/sessions/introspect", BodyDigest: wallet.BodyDigest([]byte("{}")), Nonce: "proof_nonce_abcdefghijklmnopqrstu", IssuedAt: now.Format("2006-01-02T15:04:05.000Z"), ExpiresAt: now.Add(30 * time.Second).Format("2006-01-02T15:04:05.000Z")}, key)
		if err != nil {
			return err
		}
		if err := wallet.VerifyProof(proof, session, proof.Method, proof.Path, []byte("{}"), now); err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(map[string]any{"verified": true, "algorithm": "P-256/SHA-256", "privateKeyPersisted": false, "protocol": "YNX_PRODUCT_SESSION_HTTP_PROOF_V1"})
	case "chain-status":
		flags := flag.NewFlagSet("chain-status", flag.ContinueOnError)
		flags.SetOutput(io.Discard)
		rpc := flags.String("rpc", defaultRPC, "YNX EVM HTTPS RPC")
		timeout := flags.Duration("timeout", 8*time.Second, "request timeout")
		if err := flags.Parse(args[1:]); err != nil || flags.NArg() != 0 || *timeout <= 0 {
			return errors.New("invalid chain-status arguments")
		}
		if len(*rpc) < 8 || (*rpc)[:8] != "https://" {
			return errors.New("RPC must use HTTPS")
		}
		ctx, cancel := context.WithTimeout(context.Background(), *timeout)
		defer cancel()
		client.Timeout = *timeout
		chainID, err := wallet.ProbeYNXTestnetRPC(ctx, client, *rpc)
		if err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(map[string]any{"connected": true, "chainId": chainID, "network": "YNX Testnet", "rpc": *rpc, "source": "eth_chainId", "asOf": time.Now().UTC().Format(time.RFC3339Nano)})
	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
}
