// ynx-consensus-perf-fixture creates a disposable loopback network and bounded
// signed transactions. It never reads an existing account, key or chain DB.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func main() {
	output := flag.String("output", "", "new local-only network directory; must not exist")
	count := flag.Int("count", 32, fmt.Sprintf("independent signed native transfers (1..%d)", consensus.EphemeralWorkloadMaxTransactions))
	ephemeral := flag.Bool("ephemeral", false, "required: all generated data is disposable local test data")
	retain := flag.Bool("retain-ephemeral-senders", false, "retain newly generated local test signing keys in an exclusive 0600 fixture file for bounded rounds")
	p2p := flag.Int("base-p2p-port", 31656, "first loopback P2P port")
	rpc := flag.Int("base-rpc-port", 31757, "first loopback RPC port")
	abci := flag.Int("base-abci-port", 31858, "first loopback ABCI port")
	flag.Parse()
	if err := runWithSenders(*output, *count, *ephemeral, *p2p, *rpc, *abci, *retain); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(output string, count int, ephemeral bool, p2p, rpc, abci int) error {
	return runWithSenders(output, count, ephemeral, p2p, rpc, abci, false)
}

func runWithSenders(output string, count int, ephemeral bool, p2p, rpc, abci int, retain bool) error {
	if !ephemeral || output == "" || count < 1 || count > consensus.EphemeralWorkloadMaxTransactions {
		return fmt.Errorf("require -ephemeral, a new -output directory and -count in 1..%d", consensus.EphemeralWorkloadMaxTransactions)
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		return errors.New("output must be a new directory; existing data is never reused")
	}
	validators := make([]chain.Validator, 4)
	for i := range validators {
		validators[i] = chain.Validator{Address: fmt.Sprintf("ynx_local_performance_validator_%d", i), Moniker: fmt.Sprintf("local-perf-%d", i), VotingPower: 1, Active: true}
	}
	devnet := chain.NewDevnetWithValidators(chain.DefaultNetworkConfig("testnet"), validators)
	recipientKey, err := secp256k1.GeneratePrivateKey()
	if err != nil {
		return err
	}
	recipient, err := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())
	if err != nil {
		return err
	}
	transactions := make([][]byte, 0, count)
	bundle := consensus.EphemeralSenderBundle{Purpose: consensus.EphemeralSenderPurpose}
	for i := 0; i < count; i++ {
		key, err := secp256k1.GeneratePrivateKey()
		if err != nil {
			return err
		}
		address, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
		if err != nil {
			return err
		}
		if _, err := devnet.Faucet(address, 10000); err != nil {
			return err
		}
		tx, err := consensus.NewSignedTransfer(key, 6423, recipient, 1, 1)
		if err != nil {
			return err
		}
		raw, err := consensus.EncodeSignedTransaction(tx)
		if err != nil {
			return err
		}
		transactions = append(transactions, raw)
		if retain {
			bundle.Senders = append(bundle.Senders, consensus.EphemeralSenderSecret{Address: address, PrivateKey: hex.EncodeToString(key.Serialize())})
		}
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		return err
	}
	manifest, err := consensus.GenerateEphemeralNetwork(migration, consensus.EphemeralNetworkOptions{RootDir: output, BaseP2P: p2p, BaseRPC: rpc, BaseABCI: abci})
	if err != nil {
		return err
	}
	if retain {
		manifestRaw, err := os.ReadFile(filepath.Join(output, "network-manifest.json"))
		if err != nil {
			return err
		}
		sum := sha256.Sum256(manifestRaw)
		bundle.ManifestSHA256 = hex.EncodeToString(sum[:])
		bundle.MigrationStateHash, bundle.GenesisHash = manifest.MigrationStateHash, manifest.GenesisHash
		secretRaw, err := json.Marshal(bundle)
		if err != nil {
			return err
		}
		secret, err := os.OpenFile(filepath.Join(output, consensus.EphemeralSenderFile), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			return err
		}
		_, writeErr := secret.Write(append(secretRaw, '\n'))
		syncErr := secret.Sync()
		if err := errors.Join(writeErr, syncErr, secret.Close()); err != nil {
			return err
		}
	}
	payload, err := json.MarshalIndent(struct {
		Transactions [][]byte `json:"transactions"`
	}{transactions}, "", "  ")
	if err != nil {
		return err
	}
	file, err := os.OpenFile(filepath.Join(output, "transactions.json"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, writeErr := file.Write(append(payload, '\n'))
	closeErr := file.Close()
	return errors.Join(writeErr, closeErr)
}
