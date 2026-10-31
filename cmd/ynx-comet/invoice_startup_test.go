package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

func TestPQInvoiceOperatorOptionsDefaultOffAndCompletePins(t *testing.T) {
	base := pqOptions{recoveryFD: -1}
	if base.enabled() || base.invoiceConfigured() {
		t.Fatal("default options enabled invoice mode")
	}
	complete := pqOptions{migration: "migration", state: "state", genesisHash: "genesis", originalGenesisHash: "native", migrationHash: "migration-pin", recoveryFD: -1, invoiceSchedule: "schedule", invoiceScheduleHash: "schedule-pin"}
	if !complete.enabled() || !complete.bootstrapOnly() || complete.validate() != nil {
		t.Fatal("complete bootstrap with independent invoice options was not selected")
	}
	for _, mode := range []string{"missing-file", "missing-pin", "missing-bootstrap", "unsupported-block"} {
		t.Run(mode, func(t *testing.T) {
			p := complete
			switch mode {
			case "missing-file":
				p.invoiceSchedule = ""
			case "missing-pin":
				p.invoiceScheduleHash = ""
			case "missing-bootstrap":
				p.genesisHash = ""
			case "unsupported-block":
				p.stateLayout = "block-journal"
			}
			if !p.enabled() || p.validate() == nil {
				t.Fatal("incomplete/unsupported invoice configuration fell back")
			}
		})
	}
}

func TestPQInvoiceOperatorNormalConstructorAndOriginalHistoryColdRecovery(t *testing.T) {
	f := newCometJournalFixture(t)
	ctx := context.Background()
	genesis, err := cmtjson.Marshal(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(genesis)
	validators := make([]*cmttypes.Validator, len(f.doc.Validators))
	for i, v := range f.doc.Validators {
		validators[i] = cmttypes.NewValidator(v.PubKey, v.Power)
	}
	nextHash := cmttypes.NewValidatorSet(validators).Hash()
	for _, layout := range []string{"atomic-json", "snapshot-journal"} {
		t.Run(layout, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "state")
			options := pqOptions{recoveryFD: -1, stateLayout: layout}
			lease, err := consensus.AcquireApplicationStateWriterLease(path)
			if err != nil {
				t.Fatal(err)
			}
			defer lease.Close()
			a, err := newOperatorApplication(f.migration, path, f.bootstrap, nil, options)
			if err != nil {
				t.Fatal(err)
			}
			f.init(t, a)
			res, err := a.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: f.doc.InitialHeight, Time: f.doc.GenesisTime, NextValidatorsHash: nextHash, Txs: [][]byte{f.transfer}})
			if err != nil || len(res.TxResults) != 1 || res.TxResults[0].Code != 0 {
				t.Fatal(res, err)
			}
			if _, err = a.Commit(ctx, &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			var before consensus.CommittedState
			cometJournalQuery(t, a, "/state", &before)
			s := consensus.PQInvoiceSchedule{Version: 1, ChainID: f.doc.ChainID, NativeChainID: f.migration.Network.ChainID, CometGenesisSHA256: hex.EncodeToString(sum[:]), OriginalGenesisHash: f.migration.OriginalGenesisHash, MigrationStateHash: f.migration.StateHash, PreviousHeight: before.Height, PreviousAppHash: before.AppHash, AuthorizedAt: before.Height + 1, ActivationHeight: before.Height + 1}
			raw, _ := json.Marshal(s)
			options.invoiceSchedule = filepath.Join(t.TempDir(), "invoice.json")
			options.invoiceScheduleHash, err = s.Hash()
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(options.invoiceSchedule, raw, 0600); err != nil {
				t.Fatal(err)
			}
			a, err = newOperatorApplication(f.migration, path, f.bootstrap, nil, options)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = a.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: s.AuthorizedAt, Time: f.doc.GenesisTime, NextValidatorsHash: nextHash}); err != nil {
				t.Fatal(err)
			}
			if _, err = a.Commit(ctx, &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			var current consensus.CommittedState
			cometJournalQuery(t, a, "/state", &current)
			if current.Version != consensus.PQInvoiceLedgerStateVersion || current.InvoiceLedger == nil || current.InvoiceLedger.Schedule.ActivationHeight != s.ActivationHeight || current.AppHash == before.AppHash {
				t.Fatal("normal operator did not install independently pinned schedule")
			}
			for name, pair := range map[string][2]any{"accounts": {before.Accounts, current.Accounts}, "fees": {before.FeeEvents, current.FeeEvents}, "traceLots": {before.TraceLots, current.TraceLots}, "nativeTransfers": {before.NativeTransfers, current.NativeTransfers}} {
				a, _ := json.Marshal(pair[0])
				b, _ := json.Marshal(pair[1])
				if !bytes.Equal(a, b) {
					t.Fatal("invoice admission changed original history", name)
				}
			}
			cold, err := newOperatorApplication(f.migration, path, f.bootstrap, nil, options)
			if err != nil {
				t.Fatal(err)
			}
			var restored consensus.CommittedState
			cometJournalQuery(t, cold, "/state", &restored)
			if restored.AppHash != current.AppHash || restored.Height != current.Height {
				t.Fatal("normal CLI factory cold checkpoint drift")
			}
			stored, _ := os.ReadFile(path)
			options.invoiceScheduleHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
			if _, err = newOperatorApplication(f.migration, path, f.bootstrap, nil, options); err == nil {
				t.Fatal("normal caller accepted wrong independent pin")
			}
			options.invoiceSchedule = ""
			options.invoiceScheduleHash = ""
			if _, err = newOperatorApplication(f.migration, path, f.bootstrap, nil, options); err == nil {
				t.Fatal("normal caller self-authorized persisted schedule")
			}
			if after, _ := os.ReadFile(path); !bytes.Equal(stored, after) {
				t.Fatal("failed normal startup changed original persistence")
			}
		})
	}
}
