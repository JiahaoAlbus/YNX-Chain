package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func runSenderRounds(ctx context.Context, rounds int, txs []cmttypes.Tx, pool *ephemeralSenderPool, results []transactionResult, run func([]cmttypes.Tx, []transactionResult)) (int, error) {
	if pool != nil && pool.stopped {
		return 0, errors.New("sender pool stopped")
	}
	if rounds < 1 || rounds > 32 || len(txs) == 0 || len(txs)*rounds > maxTransactions || len(results) != len(txs)*rounds || (rounds > 1 && pool == nil) {
		return 0, errors.New("invalid bounded round plan")
	}
	batch := len(txs)
	for round := 0; round < rounds; round++ {
		if err := ctx.Err(); err != nil {
			if pool != nil {
				pool.stopped = true
			}
			return round, err
		}
		if round > 0 {
			var err error
			txs, err = pool.advance(results[(round-1)*batch : round*batch])
			if err != nil {
				return round, err
			}
		}
		current := results[round*batch : (round+1)*batch]
		for i, tx := range txs {
			current[i].Hash = fmt.Sprintf("%X", tx.Hash())
			current[i].Bytes = len(tx)
			if pool != nil {
				current[i].SignedTransaction = base64.StdEncoding.EncodeToString(tx)
			}
		}
		if pool != nil {
			if err := pool.persistRound(round+1, txs); err != nil {
				pool.stopped = true
				return round, err
			}
		}
		if err := ctx.Err(); err != nil {
			if pool != nil {
				pool.stopped = true
			}
			return round, err
		}
		run(txs, current)
		if err := verifySenderRound(txs, current); err != nil {
			if pool != nil {
				pool.stopped = true
			}
			return round, errors.New("round incomplete; later rounds not submitted and no unknown transaction retried")
		}
	}
	if pool != nil {
		pool.stopped = true
	}
	return rounds, nil
}

type ephemeralSenderPool struct {
	root      string
	keys      []*secp256k1.PrivateKey
	templates []consensus.SignedTransaction
	pending   []cmttypes.Tx
	stopped   bool
}

// loadSenderPool accepts only fixture-local, manifest-bound, newly funded keys.
// No key path or wallet can be selected through this interface.
func loadSenderPool(manifestPath string, manifestRaw []byte, m consensus.EphemeralNetworkManifest, migration chain.ConsensusMigrationState, txs []cmttypes.Tx, rounds int) (*ephemeralSenderPool, error) {
	if rounds < 2 || rounds > 32 || len(txs) == 0 || len(txs)*rounds > maxTransactions {
		return nil, errors.New("invalid repeated sender plan")
	}
	path := filepath.Join(filepath.Dir(manifestPath), consensus.EphemeralSenderFile)
	before, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !before.Mode().IsRegular() || before.Mode().Perm() != 0o600 {
		return nil, errors.New("sender bundle must be a regular 0600 file")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	after, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !os.SameFile(before, after) || after.Mode().Perm() != 0o600 {
		return nil, errors.New("sender bundle changed during open")
	}
	raw, err := io.ReadAll(io.LimitReader(f, 1024*1024+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > 1024*1024 {
		return nil, errors.New("sender bundle exceeds bound")
	}
	var bundle consensus.EphemeralSenderBundle
	if err := strictJSON(raw, &bundle); err != nil {
		return nil, errors.New("invalid sender bundle JSON")
	}
	sum := sha256.Sum256(manifestRaw)
	if bundle.Purpose != consensus.EphemeralSenderPurpose || bundle.ManifestSHA256 != hex.EncodeToString(sum[:]) || bundle.MigrationStateHash != m.MigrationStateHash || bundle.GenesisHash != m.GenesisHash || len(bundle.Senders) != len(txs) {
		return nil, errors.New("sender bundle identity does not match fixture")
	}
	accounts := make(map[string]chain.ConsensusAccount, len(migration.Accounts))
	for _, account := range migration.Accounts {
		accounts[account.Address] = account
	}
	p := &ephemeralSenderPool{root: filepath.Dir(manifestPath), pending: make([]cmttypes.Tx, len(txs))}
	seen := map[string]bool{}
	for i, secret := range bundle.Senders {
		keyRaw, err := hex.DecodeString(secret.PrivateKey)
		if err != nil || len(keyRaw) != 32 || bytes.Equal(keyRaw, make([]byte, 32)) {
			return nil, errors.New("invalid fixture signing key")
		}
		key := secp256k1.PrivKeyFromBytes(keyRaw)
		if !bytes.Equal(key.Serialize(), keyRaw) {
			return nil, errors.New("noncanonical fixture signing key")
		}
		address, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
		if err != nil || address != secret.Address || seen[address] {
			return nil, errors.New("invalid or duplicate fixture sender")
		}
		seen[address] = true
		tx, err := consensus.DecodeSignedTransaction(txs[i])
		if err != nil || tx.Verify(migration.Network.ChainID) != nil || tx.From != address || tx.Nonce != 1 || tx.Amount != 1 || tx.Fee != 1 {
			return nil, errors.New("sender does not match initial signed fixture transaction")
		}
		account, ok := accounts[address]
		if !ok || account.Nonce != 0 || account.Balance < int64(rounds)*2 {
			return nil, errors.New("fixture sender lacks initial nonce or bounded round balance")
		}
		p.keys = append(p.keys, key)
		p.templates = append(p.templates, tx)
		p.pending[i] = append(cmttypes.Tx(nil), txs[i]...)
	}
	return p, nil
}

// Write public signed envelopes durably before the first submission of a round.
// A process crash can lose observations, but cannot erase the recovery identity
// for a transaction that this driver might have submitted. This is never a retry
// queue, and only read-only reconciliation may inspect an uncertain outcome.
func (p *ephemeralSenderPool) persistRound(round int, txs []cmttypes.Tx) error {
	raw, err := json.Marshal(struct {
		Round        int           `json:"round"`
		Transactions []cmttypes.Tx `json:"transactions"`
	}{round, txs})
	if err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(p.root, fmt.Sprintf("sender-round-%02d.signed.json", round)), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, writeErr := f.Write(append(raw, '\n'))
	syncErr := f.Sync()
	closeErr := f.Close()
	dir, err := os.Open(p.root)
	if err != nil {
		return errors.Join(writeErr, syncErr, closeErr, err)
	}
	return errors.Join(writeErr, syncErr, closeErr, dir.Sync(), dir.Close())
}

// The exclusive durable claim survives errors/crashes. A stopped driver never
// guesses whether an earlier submission happened and never resumes this fixture.
func claimSenderPool(manifestPath string) error {
	f, err := os.OpenFile(filepath.Join(filepath.Dir(manifestPath), "sender-pool-run.claim"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("sender pool already claimed or unavailable: %w", err)
	}
	_, writeErr := f.WriteString("isolated bounded sender run; preserve after completion, error or unknown submission\n")
	syncErr := f.Sync()
	closeErr := f.Close()
	dir, err := os.Open(filepath.Dir(manifestPath))
	if err != nil {
		return errors.Join(writeErr, syncErr, closeErr, err)
	}
	return errors.Join(writeErr, syncErr, closeErr, dir.Sync(), dir.Close())
}

// advance validates the entire previous round before signing any later nonce.
// One incomplete/unknown result permanently retires this in-memory pool.
func (p *ephemeralSenderPool) advance(results []transactionResult) ([]cmttypes.Tx, error) {
	if p.stopped {
		return nil, errors.New("sender pool stopped")
	}
	p.stopped = true
	if err := verifySenderRound(p.pending, results); err != nil {
		return nil, err
	}
	next := make([]cmttypes.Tx, len(p.pending))
	for i := range next {
		template := p.templates[i]
		tx, err := consensus.NewSignedTransfer(p.keys[i], template.ChainID, template.To, template.Amount, template.Nonce+1)
		if err != nil {
			return nil, err
		}
		raw, err := consensus.EncodeSignedTransaction(tx)
		if err != nil {
			return nil, err
		}
		next[i] = raw
		p.templates[i] = tx
	}
	p.pending = next
	p.stopped = false
	return next, nil
}

func verifySenderRound(txs []cmttypes.Tx, results []transactionResult) error {
	if len(results) != len(txs) {
		return errors.New("sender round result count mismatch")
	}
	for i, r := range results {
		if isJournalLayout(r.DurableStoreFormat) && (!r.DurableInfoVerified || r.DurableInfoHeight < r.DurableStateHeight) {
			return errors.New("journal sender round lacks published committed height")
		}
		if r.Hash != fmt.Sprintf("%X", txs[i].Hash()) || r.Status != "confirmed" || !r.CheckTxIdentityVerified || r.CheckTxCode == nil || *r.CheckTxCode != 0 || r.ExecutionCode == nil || *r.ExecutionCode != 0 || !r.QuorumVerified || !r.TransactionProofVerified || !r.DurableStateVerified || r.ConfirmedObservedAt == nil || r.Height <= 0 || r.DurableStateHeight < r.Height || r.DurableSnapshotSHA256 == "" {
			return errors.New("sender round incomplete: no later nonce will be signed or retried")
		}
	}
	return nil
}
