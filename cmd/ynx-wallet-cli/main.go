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
	"os/signal"
	"syscall"
	"time"

	wallet "github.com/JiahaoAlbus/YNX-Chain/sdk/wallet/go"
)

var version = "dev"

// Central endpoint matrix d0f89797 freezes this as the canonical public EVM RPC.
const defaultRPC = "https://rpc.ynxweb4.com/evm"

const usageText = `YNX Wallet CLI (Testnet)

Usage:
  ynx-wallet-cli help
  ynx-wallet-cli version
  ynx-wallet-cli validate-config [--native-chain ynx_6423-1] [--chain-id 6423] [--evm-chain-id 0x1917]
  ynx-wallet-cli chain-status [--rpc https://rpc.ynxweb4.com/evm] [--timeout 8s]
  ynx-wallet-cli verify-vector [--file PATH]
  ynx-wallet-cli sign-self-test

Network: ynx_6423-1 / 6423 / 0x1917 / YNXT
Safety: read-only chain-status makes one request; it never requests an account, signs, or sends a transaction.
`

const (
	exitOK          = 0
	exitGeneral     = 1
	exitUsage       = 64
	exitData        = 65
	exitNoInput     = 66
	exitUnavailable = 69
	exitConfig      = 78
	exitTimeout     = 124
	exitCancelled   = 130
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(execute(ctx, os.Args[1:], os.Stdout, os.Stderr, &http.Client{}))
}

func run(args []string, out io.Writer, client *http.Client) error {
	return runContext(context.Background(), args, out, client)
}

func execute(ctx context.Context, args []string, out, errOut io.Writer, client *http.Client) int {
	err := runContext(ctx, args, out, client)
	if err == nil {
		return exitOK
	}
	_ = json.NewEncoder(errOut).Encode(map[string]any{"ok": false, "error": wallet.RedactedDiagnostic(err)})
	return exitCode(err)
}

func exitCode(err error) int {
	var classified *wallet.TransportError
	if !errors.As(err, &classified) {
		return exitUsage
	}
	switch classified.Code {
	case wallet.ErrorTransportCancelled:
		return exitCancelled
	case wallet.ErrorTransportTimeout:
		return exitTimeout
	case wallet.ErrorMalformedResponse:
		return exitData
	case wallet.ErrorAccountNotFound:
		return exitNoInput
	case wallet.ErrorWrongChain:
		return exitConfig
	case wallet.ErrorHTTP, wallet.ErrorJSONRPC, wallet.ErrorRPCUnavailable, wallet.ErrorTransportTLS:
		return exitUnavailable
	default:
		return exitGeneral
	}
}

func runContext(parent context.Context, args []string, out io.Writer, client *http.Client) error {
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" || args[0] == "-h" {
		_, err := io.WriteString(out, usageText)
		return err
	}
	switch args[0] {
	case "version":
		return json.NewEncoder(out).Encode(map[string]any{"name": "ynx-wallet-cli", "version": version, "protocol": "YNX_PRODUCT_SESSION_HTTP_PROOF_V1", "nativeChainId": wallet.YNXNativeChainID, "chainId": wallet.YNXChainID, "evmChainId": wallet.YNXEVMChainID, "productionSigned": false})
	case "validate-config":
		flags := flag.NewFlagSet("validate-config", flag.ContinueOnError)
		flags.SetOutput(io.Discard)
		nativeChainID := flags.String("native-chain", wallet.YNXNativeChainID, "native YNX chain ID")
		chainID := flags.Int("chain-id", wallet.YNXChainID, "decimal YNX chain ID")
		evmChainID := flags.String("evm-chain-id", wallet.YNXEVMChainID, "hex EVM chain ID")
		if err := flags.Parse(args[1:]); err != nil || flags.NArg() != 0 {
			return errors.New("invalid validate-config arguments")
		}
		if err := wallet.ValidateYNXTestnetConfig(*nativeChainID, *chainID, *evmChainID); err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(map[string]any{"valid": true, "nativeChainId": *nativeChainID, "chainId": *chainID, "evmChainId": *evmChainID, "nativeCurrency": "YNXT"})
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
		ctx, cancel := context.WithTimeout(parent, *timeout)
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
