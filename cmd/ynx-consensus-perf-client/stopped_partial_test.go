package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	db "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/store"
	cmt "github.com/cometbft/cometbft/types"
	"github.com/syndtr/goleveldb/leveldb/opt"
)

// Separate from completed-window acceptance: recovered writes never revise the
// live report, invent an ACK/latency or authorize resubmission.
func TestStoppedPartialNetworkReconciliation(t *testing.T) {
	work := os.Getenv("YNX_CHAIN_PARTIAL_STOPPED_WINDOW")
	if work == "" {
		t.Skip("explicit failed isolated window required")
	}
	read := func(file string, target any) []byte {
		t.Helper()
		raw, err := readBounded(file, 16<<20)
		if err != nil {
			t.Fatal(err)
		}
		if target != nil {
			if err = json.Unmarshal(raw, target); err != nil {
				t.Fatal(err)
			}
		}
		return raw
	}
	var receipt struct {
		AllGroupsGone bool
		FirstCause    *string
	}
	read(filepath.Join(work, "window-receipt.json"), &receipt)
	if !receipt.AllGroupsGone || receipt.FirstCause == nil {
		t.Fatal("requires failed, fully retired window")
	}
	manifestPath := filepath.Join(work, "network", "network-manifest.json")
	var m consensus.EphemeralNetworkManifest
	manifestRaw := read(manifestPath, &m)
	if err := validateManifest(m); err != nil {
		t.Fatal(err)
	}
	if err := validateLocalPaths(m, manifestPath); err != nil {
		t.Fatal(err)
	}
	migration, err := readMigration(m)
	if err != nil {
		t.Fatal(err)
	}
	trusted, err := loadTrustedValidators(m)
	if err != nil {
		t.Fatal(err)
	}
	var observed report
	reportRaw := read(filepath.Join(work, "transactions-result.json"), &observed)
	if observed.SenderMode != "ready-pool" {
		t.Fatal("requires ready pool identity journal")
	}
	initial, err := decodeTransactions(read(filepath.Join(work, "network", "transactions.json"), nil))
	if err != nil {
		t.Fatal(err)
	}
	journalRaw := read(filepath.Join(work, "network", readySenderJournalName), nil)
	recovered, err := decodeReadySenderJournal(context.Background(), journalRaw, manifestRaw, m, initial, observed.RoundsRequested)
	if err != nil {
		t.Fatal(err)
	}
	var terminalPrefix *terminalPrefixReadback
	var terminalEvidenceError string
	var reportedRows []terminalReportedObservation
	if observed.RetentionMode != "" {
		if observed.SchemaVersion != 12 || observed.RetentionMode != "latest_per_account_slots" || len(observed.Transactions) != len(initial) {
			t.Fatal("invalid partial slot report")
		}
		sum := sha256.Sum256(manifestRaw)
		binding := readySenderJournalHeader{"YNX_LOCAL_READY_SENDER_V1", hex.EncodeToString(sum[:]), m.MigrationStateHash, m.GenesisHash}
		prefix, prefixErr := readTerminalPrefix(filepath.Join(work, "transactions-result.json.terminal-stream"), binding, len(initial), recovered.Transactions)
		if prefixErr != nil {
			// Terminal diagnostics cannot manufacture outcomes, and must not
			// erase independently verifiable signed intents or node state.
			terminalEvidenceError = prefixErr.Error()
		}
		terminalPrefix = &prefix
		reportedRows, err = mergeTerminalPrefixAndLatest(prefix.Rows, observed.Transactions, len(initial), recovered.Transactions)
		if err != nil {
			t.Fatal(err)
		}
	} else {
		for _, r := range observed.Transactions {
			reportedRows = append(reportedRows, terminalReportedObservation{r, "full_report"})
		}
	}
	expected := map[string]cmt.Tx{}
	for _, raw := range recovered.Transactions {
		if len(raw) == 0 {
			continue
		}
		hash := fmt.Sprintf("%X", raw.Hash())
		if expected[hash] != nil {
			t.Fatal("duplicate signed intent")
		}
		expected[hash] = raw
	}
	type transaction struct {
		Hash               string   `json:"hash"`
		OriginalStatus     string   `json:"originalStatus"`
		Submitted          bool     `json:"submitted"`
		SubmissionRecorded bool     `json:"submissionRecorded"`
		ObservationSource  string   `json:"observationSource"`
		DurableNodes       []string `json:"durableNodes"`
	}
	rows := map[string]*transaction{}
	for hash := range expected {
		rows[hash] = &transaction{Hash: hash, OriginalStatus: "intent_only_outcome_unknown", ObservationSource: "signed_intent_only", DurableNodes: []string{}}
	}
	for _, observation := range reportedRows {
		r := observation.Result
		if r.SignedTransaction == "" {
			continue
		}
		raw, e := base64.StdEncoding.DecodeString(r.SignedTransaction)
		hash := strings.ToUpper(r.Hash)
		if e != nil || len(raw) == 0 || expected[hash] == nil || !bytes.Equal(expected[hash], raw) {
			t.Fatal("report identity differs from signed journal")
		}
		rows[hash].OriginalStatus = r.Status
		rows[hash].Submitted = r.SubmittedAt != nil
		rows[hash].SubmissionRecorded = true
		rows[hash].ObservationSource = observation.Source
	}
	type nodeEvidence struct {
		Name                string `json:"name"`
		DurableHeight       int64  `json:"durableHeight"`
		BlockstoreHeight    int64  `json:"blockstoreHeight"`
		DurableTransactions int    `json:"durableTransactions"`
		IncompleteTail      bool   `json:"incompleteTail"`
		StoreSHA256         string `json:"storeSha256"`
		SnapshotSHA256      string `json:"snapshotSha256"`
		ExactStateEqual     bool   `json:"exactStateEqual"`
	}
	var nodes []nodeEvidence
	for _, n := range m.Nodes {
		before := partialStoreDigest(t, n.Home, n.ABCIStatePath)
		raw := read(n.ABCIStatePath, nil)
		decoded, e := decodeDurableSnapshot(context.Background(), raw, migration)
		if e != nil {
			t.Fatal(e)
		}
		state := decoded.state
		if state.Height <= int64(migration.Height) || state.Height-int64(migration.Height) > 128 {
			t.Fatal("durable height outside bounds")
		}
		database, e := db.NewGoLevelDBWithOpts("blockstore", filepath.Join(n.Home, "data"), &opt.Options{ReadOnly: true})
		if e != nil {
			t.Fatal(e)
		}
		// Defer also handles fail-fast validation without leaving an open handle.
		t.Cleanup(func() { _ = database.Close() })
		blocks := store.NewBlockStore(database)
		tip := blocks.Height()
		if tip < state.Height || tip-int64(migration.Height) > 128 {
			t.Fatal("blockstore cannot authenticate bounded durable state")
		}
		replay, e := consensus.NewApplication(migration)
		if e != nil {
			t.Fatal(e)
		}
		seen := map[string]int64{}
		for h := int64(migration.Height) + 1; h <= state.Height; h++ {
			block := blocks.LoadBlock(h)
			if block == nil {
				t.Fatalf("missing block %d", h)
			}
			commit := blocks.LoadBlockCommit(h)
			if commit == nil {
				commit = blocks.LoadSeenCommit(h)
			}
			if commit == nil {
				t.Fatalf("missing commit %d", h)
			}
			signed := cmt.SignedHeader{Header: &block.Header, Commit: commit}
			if e = signed.ValidateBasic(m.ChainID); e != nil {
				t.Fatal(e)
			}
			if !bytes.Equal(block.Hash(), commit.BlockID.Hash) || !bytes.Equal(block.Header.ValidatorsHash, trusted.Hash()) || !bytes.Equal(block.Data.Hash(), block.Header.DataHash) {
				t.Fatal("block identity/data/validator mismatch")
			}
			if e = trusted.VerifyCommitLight(m.ChainID, commit.BlockID, h, commit); e != nil {
				t.Fatal(e)
			}
			info, e := replay.Info(context.Background(), &abci.RequestInfo{})
			if e != nil || !bytes.Equal(info.LastBlockAppHash, block.AppHash) {
				t.Fatal("signed prior AppHash differs", e)
			}
			for _, tx := range block.Data.Txs {
				hash := fmt.Sprintf("%X", tx.Hash())
				if !bytes.Equal(expected[hash], tx) || seen[hash] != 0 {
					t.Fatal("unexpected/duplicate block payload")
				}
				seen[hash] = h
			}
			finalized, e := replay.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h, Time: block.Time, Txs: block.Data.Txs.ToSliceOfBytes()})
			if e != nil {
				t.Fatal(e)
			}
			if len(finalized.TxResults) != len(block.Data.Txs) {
				t.Fatal("missing execution results")
			}
			for _, r := range finalized.TxResults {
				if r.Code != 0 {
					t.Fatal("offline execution rejected actual payload")
				}
			}
			if _, e = replay.Commit(context.Background(), &abci.RequestCommit{}); e != nil {
				t.Fatal(e)
			}
		}
		query, e := replay.Query(context.Background(), &abci.RequestQuery{Path: "/state"})
		if e != nil || query.Code != 0 {
			t.Fatal("state query failed", e)
		}
		canonical, e := json.Marshal(state)
		if e != nil || !bytes.Equal(canonical, query.Value) {
			t.Fatal("full durable state differs from authenticated replay", e)
		}
		if len(state.FeeEvents) != len(seen) {
			t.Fatal("fee history count differs from replay")
		}
		fees := map[durableFeeKey]bool{}
		for _, fee := range state.FeeEvents {
			fees[durableFeeKey{hash: fee.TxHash, payer: fee.Payer, kind: fee.TransactionType, height: fee.BlockHeight, fee: fee.GrossFeeYNXT}] = true
		}
		nonces := map[string]uint64{}
		for _, account := range state.Accounts {
			nonces[account.Address] = account.Nonce
		}
		for hash, h := range seen {
			raw := expected[hash]
			tx, e := consensus.DecodeSignedTransaction(raw)
			if e != nil || tx.Verify(migration.Network.ChainID) != nil || nonces[tx.From] < tx.Nonce || !fees[durableFeeKey{hash: consensus.SignedTransactionHash(raw), payer: tx.From, kind: consensus.SignedTransactionType, height: h, fee: tx.Fee}] {
				t.Fatal("missing actual signature/fee/nonce evidence")
			}
			rows[hash].DurableNodes = append(rows[hash].DurableNodes, n.Moniker)
		}
		if e = database.Close(); e != nil {
			t.Fatal(e)
		}
		if after := partialStoreDigest(t, n.Home, n.ABCIStatePath); after != before {
			t.Fatal("original database bytes changed during read-only reconciliation")
		}
		storeSum, snapshotSum := sha256.Sum256(raw), sha256.Sum256(decoded.payload)
		nodes = append(nodes, nodeEvidence{n.Moniker, state.Height, tip, len(seen), decoded.incompleteTail, hex.EncodeToString(storeSum[:]), hex.EncodeToString(snapshotSum[:]), true})
	}
	// Journal index order is deterministic even for an incomplete ready wave.
	var transactions []*transaction
	for _, raw := range recovered.Transactions {
		if len(raw) > 0 {
			transactions = append(transactions, rows[fmt.Sprintf("%X", raw.Hash())])
		}
	}
	sum := sha256.Sum256(reportRaw)
	output := struct {
		Schema                int                     `json:"schema"`
		VerifiedAt            time.Time               `json:"verifiedAt"`
		ObservationSHA256     string                  `json:"observationSha256"`
		SignedRecords         int                     `json:"signedRecords"`
		JournalIncompleteTail bool                    `json:"journalIncompleteTail"`
		Nodes                 []nodeEvidence          `json:"nodes"`
		Transactions          []*transaction          `json:"transactions"`
		TerminalPrefix        *terminalPrefixReadback `json:"terminalPrefix,omitempty"`
		TerminalEvidenceError string                  `json:"terminalEvidenceError,omitempty"`
		Interpretation        string                  `json:"interpretation"`
	}{2, time.Now().UTC(), hex.EncodeToString(sum[:]), recovered.Records, recovered.IncompleteTail, nodes, transactions, terminalPrefix, terminalEvidenceError, "Read-only authenticated replay through each node's actual durable height only. Original ACK/status/latency and partial-run TPS remain unchanged. Missing terminal evidence leaves signed-intent outcomes unknown, never unsubmitted by inference. A sealed terminal prefix is a structural observation record, not an observed writer Sync or consensus proof. Absence is not retry authorization; blocks above durable height are not promoted to persisted results."}
	encoded, e := json.MarshalIndent(output, "", "  ")
	if e != nil {
		t.Fatal(e)
	}
	file, e := os.OpenFile(filepath.Join(work, "partial-reconciliation.json"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = file.Write(append(encoded, '\n')); e != nil {
		t.Fatal(e)
	}
	if e = file.Close(); e != nil {
		t.Fatal(e)
	}
	t.Logf("reconciled %d signed intents against four authenticated durable prefixes", recovered.Records)
}

// Include every blockstore data file and application file; no writer is opened.
func partialStoreDigest(t *testing.T, home, state string) [32]byte {
	t.Helper()
	hash := sha256.New()
	visit := func(file string) {
		raw, err := readBounded(file, 32<<20)
		if err != nil {
			t.Fatal(err)
		}
		fmt.Fprintf(hash, "%s\x00%d\x00", file, len(raw))
		hash.Write(raw)
	}
	err := filepath.WalkDir(filepath.Join(home, "data"), func(file string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			if !d.Type().IsRegular() {
				return fmt.Errorf("nonregular database entry")
			}
			visit(file)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	visit(state)
	var sum [32]byte
	copy(sum[:], hash.Sum(nil))
	return sum
}
