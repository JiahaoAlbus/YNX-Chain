package consensus

import (
	"encoding/hex"
	"errors"
	"reflect"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// PQInitialPreparedFunding binds only already committed source test funds.
// Values, balances and lots are never accepted from registration input. Both
// hashes are covered by the independent exact Genesis and migration pins.
type PQInitialPreparedFunding struct {
	SourceStateHash string `json:"sourceStateHash"`
	FaucetHash      string `json:"faucetHash"`
}

// PreparePQInitialPreparedFundingBinding prepares public candidate DATA from
// the normal Faucet's actual receipt and complete migration. It neither funds
// an account nor installs/approves its keys. Normal independent pins are still
// required before the resulting binding can authorize a registration.
func PreparePQInitialPreparedFundingBinding(m chain.ConsensusMigrationState, owner string, pkA, pkB []byte, faucetHash string) (PQInitialAccountBinding, error) {
	binding := PQInitialAccountBinding{Owner: owner, PKA: hex.EncodeToString(pkA), PKB: hex.EncodeToString(pkB), PreparedFunding: &PQInitialPreparedFunding{SourceStateHash: m.StateHash, FaucetHash: faucetHash}}
	if m.AccountPolicy == nil {
		return PQInitialAccountBinding{}, errors.New("prepared initial account requires an existing source policy schedule")
	}
	configuration := PQInitialAccountConfiguration{Version: PQInitialAccountsVersion, NetworkID: m.OriginalGenesisHash, EnableAt: strconv.FormatUint(m.AccountPolicy.EnableAt, 10), BirthFee: "0", Accounts: []PQInitialAccountBinding{binding}}
	if err := configuration.validate(m); err != nil {
		return PQInitialAccountBinding{}, err
	}
	return binding, nil
}

func initialSourceTransactionReferences(tx chain.Transaction, owner string) bool {
	if tx.From == owner || tx.To == owner || tx.Sponsor == owner {
		return true
	}
	for _, flow := range tx.LotFlows {
		if flow.From == owner || flow.To == owner {
			return true
		}
	}
	for _, event := range tx.Logs {
		if event.Address == owner {
			return true
		}
	}
	return false
}

func validatePQInitialPreparedFunding(m chain.ConsensusMigrationState, binding PQInitialAccountBinding) error {
	f := binding.PreparedFunding
	if f == nil || m.Network.Slug != "testnet" || m.Network.ChainID != 6423 || f.SourceStateHash != m.StateHash {
		return errors.New("prepared initial funding requires the exact independent testnet source state")
	}
	if _, err := canonicalBootstrapHash(f.SourceStateHash); err != nil {
		return err
	}
	if !strings.HasPrefix(f.FaucetHash, "0x") {
		return errors.New("prepared initial funding requires the original canonical Faucet hash")
	}
	if _, err := canonicalBootstrapHash(strings.TrimPrefix(f.FaucetHash, "0x")); err != nil {
		return err
	}
	// configuration.validate has validated the complete migration once. A
	// self-supplied balance/receipt summary never substitutes for that source.
	if m.Runtime == nil || len(m.Runtime.Blocks) == 0 || len(m.Runtime.Pending) != 0 {
		return errors.New("prepared initial funding requires complete committed original history")
	}
	last := m.Runtime.Blocks[len(m.Runtime.Blocks)-1]
	if last.Height != m.Height || last.Hash != m.LastBlockHash {
		return errors.New("prepared initial Faucet must be in the exact migration anchor block")
	}
	index, exists := accountIndex(m.Accounts, binding.Owner)
	if !exists {
		return errors.New("prepared initial Faucet recipient is absent from the source")
	}
	account := m.Accounts[index]
	if account.Balance <= 0 || account.Staked != 0 || account.Nonce != 0 || account.ResourceUsage != (chain.ResourceUsage{}) || len(account.Lots) != 1 {
		return errors.New("prepared initial source account is not a fresh unspent Faucet recipient")
	}
	var lotID string
	for id, amount := range account.Lots {
		if id == "" || amount != account.Balance {
			return errors.New("prepared initial source lots do not match the complete funded balance")
		}
		lotID = id
	}
	lot, issued := m.Runtime.Lots[lotID]
	if !issued || lot != (chain.TrustTraceLot{LotID: lotID, Amount: account.Balance, Origin: "devnet faucet mint"}) {
		return errors.New("prepared initial funding does not retain its original unused Faucet lot")
	}
	for _, other := range m.Accounts {
		if other.Address != binding.Owner {
			if _, duplicate := other.Lots[lotID]; duplicate {
				return errors.New("prepared initial Faucet lot is already held by another owner")
			}
		}
	}
	matched := 0
	for blockIndex, block := range m.Runtime.Blocks {
		var firstLog uint64
		for txIndex, tx := range block.Transactions {
			references := initialSourceTransactionReferences(tx, binding.Owner)
			isOriginal := tx.Hash == f.FaucetHash
			if references || isOriginal {
				if !isOriginal || !references || blockIndex != len(m.Runtime.Blocks)-1 || tx.Type != "faucet" || tx.From != chain.FaucetAddress || tx.To != binding.Owner || tx.Amount != account.Balance || tx.Fee != 0 || tx.Memo != "devnet faucet mint" || tx.Timestamp.IsZero() || tx.BlockNum != m.Height || tx.BlockHash != m.LastBlockHash || tx.Sponsor != "" || tx.SponsorPoolID != "" || tx.ResourceSource != "" || tx.ResourceType != "" || tx.ResourceConsumed != 0 || tx.ActionReference != "" || len(tx.LotFlows) != 1 || tx.LotFlows[0] != (chain.LotFlow{LotID: lotID, Amount: account.Balance, From: chain.FaucetAddress, To: binding.Owner}) {
					return errors.New("prepared initial owner has earlier history or lacks its unique original anchor Faucet")
				}
				// Preserve the normal source log, including its real block/tx/log
				// positions. It is not a synthetic receipt or BFT finality proof.
				if len(tx.Logs) != 1 || tx.Logs[0].BlockHash != "0x"+block.Hash || tx.Logs[0].BlockNumber != block.Height || tx.Logs[0].TransactionHash != tx.Hash || tx.Logs[0].TransactionIndex != uint64(txIndex) || tx.Logs[0].LogIndex != firstLog || tx.Logs[0].Removed {
					return errors.New("prepared initial Faucet log differs from its original source coordinates")
				}
				matched++
			} else {
				for _, flow := range tx.LotFlows {
					if flow.LotID == lotID {
						return errors.New("prepared initial Faucet lot has another issuance or movement")
					}
				}
			}
			firstLog += uint64(len(tx.Logs))
		}
	}
	if matched != 1 {
		return errors.New("prepared initial funding requires exactly one original Faucet receipt")
	}
	return nil
}

// This lookup consumes an already validated immutable bootstrap, never a
// transaction-supplied funding object. The source account remains the authority
// for the exact pre-birth balance, nonce, resources and full lot map.
func (b *ConsensusBootstrap) initialPreparedAccount(m chain.ConsensusMigrationState, owner string) (chain.ConsensusAccount, bool) {
	if b == nil || b.record.PQInitialAccounts == nil || m.StateHash != b.record.MigrationStateHash {
		return chain.ConsensusAccount{}, false
	}
	for _, binding := range b.record.PQInitialAccounts.Accounts {
		if binding.Owner == owner && binding.PreparedFunding != nil && binding.PreparedFunding.SourceStateHash == m.StateHash {
			if index, exists := accountIndex(m.Accounts, owner); exists {
				return m.Accounts[index], true
			}
		}
	}
	return chain.ConsensusAccount{}, false
}

func (a *Application) initialOwnerRequiresVacancy(state executionState, owner string) (bool, error) {
	prepared, exists := state.bootstrap.initialPreparedAccount(a.migration, owner)
	if !exists {
		return initialOwnerOccupied(state, owner), nil
	}
	actual, found := nativeAccountAt(state, owner)
	if !found || !reflect.DeepEqual(ownedNativeAccount(actual), prepared) {
		return true, errors.New("prepared initial account changed since the independently pinned source")
	}
	for _, contract := range state.contracts {
		if contract.Address == owner {
			return true, errors.New("prepared initial owner is occupied by a contract")
		}
	}
	for _, account := range state.smartAccounts {
		if account.Address == owner {
			return true, errors.New("prepared initial owner is occupied by a smart account")
		}
	}
	return false, nil
}
