package consensus

import (
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type MigrationModuleBlocker struct {
	Module  string `json:"module"`
	Records int    `json:"records"`
	Reason  string `json:"reason"`
}

// MigrationExecutionBlockers is an explicit executor compatibility manifest.
// A preserved source document is not evidence that an ABCI module can safely
// operate on it. Missing authority, code or quote provenance must never be
// replaced by fabricated BFT metadata or by empty initial module slices.
func MigrationExecutionBlockers(m chain.ConsensusMigrationState) []MigrationModuleBlocker {
	var blockers []MigrationModuleBlocker
	if m.Runtime == nil {
		return []MigrationModuleBlocker{{Module: "source_runtime", Records: 1, Reason: "account-only migration does not prove complete business state or absence of account policy"}}
	}
	r := m.Runtime
	add := func(module string, n int, reason string) {
		if n > 0 {
			blockers = append(blockers, MigrationModuleBlocker{module, n, reason})
		}
	}
	add("pay", len(r.PayIntents)+len(r.Invoices)+len(r.Refunds)+len(r.PaySettlements)+len(r.Webhooks)+len(r.PayEvents), "source merchant records lack BFT signer/action provenance; refund totals and original webhook identity require a source-compatible execution adapter")
	add("ai", len(r.AIPerms)+len(r.AIActions), "source permissions have no signed principal or transaction; cannot create BFT signer authority during import")
	add("trust_governance", len(r.RiskLabels)+len(r.Evidence)+len(r.Governance)+len(r.Appeals)+len(r.Tracking)+len(r.Transp), "source IDs, authority and audit domains differ; original evidence and correction semantics require an adapter")
	if err := validateLegacyResourceMarket(migrationResourceMarket(m), CommittedState{Version: CommittedStateVersion}, m); err != nil {
		add("resource_market", 1, err.Error())
	}
	if err := validateSourceSponsorReplayCoverage(migrationResourceSponsor(m), m); err != nil {
		add("resource_sponsor", 1, err.Error())
	}
	blockers = append(blockers, migrationContractBlockers(m)...)
	return blockers
}

func validateMigrationExecutionClosure(m chain.ConsensusMigrationState) error {
	blockers := MigrationExecutionBlockers(m)
	if len(blockers) == 0 {
		return nil
	}
	names := make([]string, len(blockers))
	for i, b := range blockers {
		names[i] = fmt.Sprintf("%s(%d): %s", b.Module, b.Records, b.Reason)
	}
	return errors.New("ABCI migration blocked to preserve source business state: " + strings.Join(names, "; "))
}

func migrationTraceLots(m chain.ConsensusMigrationState) map[string]chain.TrustTraceLot {
	if m.Runtime == nil {
		return nil
	}
	return cloneTraceLots(m.Runtime.Lots)
}

func cloneTraceLots(input map[string]chain.TrustTraceLot) map[string]chain.TrustTraceLot {
	if input == nil {
		return nil
	}
	copy := make(map[string]chain.TrustTraceLot, len(input))
	for id, value := range input {
		copy[id] = value
	}
	return copy
}

func validateMigrationTraceLots(s CommittedState, migration chain.ConsensusMigrationState) error {
	if s.Version < 15 && s.TraceLots != nil {
		return errors.New("legacy state must not contain v15 trace metadata")
	}
	if migration.Runtime == nil {
		return nil
	}
	if s.Version <= 13 {
		// The original state commits its source migration hash, not a v15 trace map.
		// Preserve that exact checkpoint; source lineage is imported only in the next execution view.
		return nil
	}
	if len(s.TraceLots) != len(migration.Runtime.Lots) {
		return errors.New("committed trace lineage inventory differs from source")
	}
	for id, original := range migration.Runtime.Lots {
		current, ok := s.TraceLots[id]
		if !ok || current.LotID != original.LotID || current.Amount != original.Amount || current.Origin != original.Origin || current.RiskWeight != original.RiskWeight {
			return errors.New("committed trace lineage rewrites original source metadata")
		}
	}
	return nil
}

// Original source history stays queryable under its own heights/hashes. It is
// never replayed as new transfers or relabeled as Comet-committed history.
func sourceHistoryTransaction(m chain.ConsensusMigrationState, hash string) (chain.Transaction, bool) {
	if m.Runtime != nil {
		for _, block := range m.Runtime.Blocks {
			for _, tx := range block.Transactions {
				if tx.Hash == hash {
					return tx, true
				}
			}
		}
	}
	return chain.Transaction{}, false
}

func sourceLotIDs(m chain.ConsensusMigrationState) []string {
	ids := make([]string, 0)
	if m.Runtime != nil {
		for id := range m.Runtime.Lots {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}
