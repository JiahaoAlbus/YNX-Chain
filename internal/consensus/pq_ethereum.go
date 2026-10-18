package consensus

import (
	"bytes"
	"encoding/hex"
	"errors"
	"math"
	"reflect"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	PQEthereumValueType           = "pq_ethereum_value"
	pqEthereumValueHistoryMemo    = "ynx-pq-ethereum-value-v1:"
	MaxPQEthereumMemberBytes      = 20 + len(ynxbatch.Version+"/MEMBER") + ynxbatch.MaxCertificateBytes + ynxauth.MaxEthereumValueIntentBytes + ynxbatch.MaxProofBytes
	MaxPQEthereumTransactionBytes = 2*MaxPQEthereumMemberBytes + 256
)

// DecodePQEthereumValueTransaction parses the existing canonical PQ transport,
// not an Ethereum signed RLP envelope. A Member may have any legal N/index;
// authentication still requires both complete branches and the current policy.
func DecodePQEthereumValueTransaction(raw []byte) ([]byte, ynxauth.EthereumValueIntent, error) {
	var intent ynxauth.EthereumValueIntent
	if len(raw) == 0 || len(raw) > MaxPQEthereumTransactionBytes {
		return nil, intent, errors.New("PQ Ethereum transport size is invalid")
	}
	envelope, wire, err := DecodePQTransaction(raw)
	if err != nil {
		return nil, intent, err
	}
	if envelope.Type != PQEthereumValueType || len(wire) > MaxPQEthereumMemberBytes {
		return nil, intent, errors.New("unexpected or oversized PQ Ethereum Member")
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return nil, intent, err
	}
	intent, err = ynxauth.DecodeEthereumValueIntent(member.Message)
	if err != nil {
		return nil, ynxauth.EthereumValueIntent{}, err
	}
	return wire, intent, nil
}

func pqEthereumFees(intent ynxauth.EthereumValueIntent) (actual, maximum int64, err error) {
	if err = intent.Validate(); err != nil {
		return 0, 0, err
	}
	price, cap := intent.GasPrice, intent.GasPrice
	if intent.TxType == 2 {
		price, cap = intent.MaxPriorityFeePerGas, intent.MaxFeePerGas
	}
	// Validate checks multiplication and value+maximum in the signed ledger.
	return int64(price * intent.GasLimit), int64(cap * intent.GasLimit), nil
}

// pqEthereumLotPlan uses the original mover on three detached account views.
// The two stages remain separate even when To is also the fee recipient. A
// self-paid fee has zero net lot movement, but the original mover still checks
// its available traceable amount. No synthetic self-flow is manufactured.
func pqEthereumLotPlan(accounts []chain.ConsensusAccount, owner, to, feeRecipient string, value, fee int64) ([]chain.LotFlow, map[string]*chain.ConsensusAccount, error) {
	views := map[string]*chain.ConsensusAccount{}
	for _, address := range []string{owner, to, feeRecipient} {
		if _, exists := views[address]; exists {
			continue
		}
		account := chain.ConsensusAccount{Address: address, Lots: map[string]int64{}}
		if i, ok := accountIndex(accounts, address); ok {
			account = accounts[i]
			account.Lots = cloneInt64Map(account.Lots)
			if account.Lots == nil {
				account.Lots = map[string]int64{}
			}
		}
		views[address] = &account
	}
	var flows []chain.LotFlow
	for _, stage := range []struct {
		to     string
		amount int64
	}{{to, value}, {feeRecipient, fee}} {
		before := cloneInt64Map(views[owner].Lots)
		if err := moveTraceableLots(views[owner], views[stage.to], stage.amount); err != nil {
			return nil, nil, err
		}
		if stage.to == owner {
			continue
		}
		for _, id := range sortedLotKeys(before) {
			moved := before[id] - views[owner].Lots[id]
			if moved > 0 {
				flows = append(flows, chain.LotFlow{LotID: id, From: owner, To: stage.to, Amount: moved})
			}
		}
	}
	return flows, views, nil
}

func (a *Application) applyPQEthereumValueTransaction(state executionState, raw []byte, height int64, at time.Time) (executionState, transactionExecution, error) {
	fail := func(err error) (executionState, transactionExecution, error) {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	wire, intent, err := DecodePQEthereumValueTransaction(raw)
	if err != nil {
		return fail(err)
	}
	if height <= 0 || state.accountPolicy == nil || intent.NativeChainID != uint64(a.migration.Network.ChainID) || !bytes.Equal(intent.ChainID, state.accountPolicy.NetworkID) || intent.Nonce == math.MaxUint64 {
		return fail(errors.New("PQ Ethereum requires actual network, policy, height and consumable nonce"))
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return fail(err)
	}
	if err = a.pqCertificateCache.VerifyDecodedMember(state.accountPolicy, intent.Owner, ynxauth.TransactionPurpose, member.Message, member, uint64(height)); err != nil {
		return fail(err)
	}
	nativeHash, abciHash := SignedTransactionHash(wire), SignedTransactionHash(raw)
	for _, prior := range state.pqHistory {
		if prior.Transaction.Hash == nativeHash || prior.ABCITransactionHash == abciHash {
			return fail(errors.New("PQ Ethereum original authorization already executed"))
		}
	}
	fee, maximum, err := pqEthereumFees(intent)
	if err != nil {
		return fail(err)
	}
	if at.IsZero() {
		at = time.Unix(height, 0)
	}
	at = at.UTC()
	// The exported caller's candidate may borrow committed maps/slices. Neither
	// a successful speculative CheckTx nor any late failure may mutate them.
	next := a.cloneTransactionState(state)
	flows, planned, err := pqEthereumLotPlan(next.accounts, intent.Owner, intent.To, a.feeRecipient, int64(intent.Value), fee)
	if err != nil {
		return fail(err)
	}
	execution := authorizedEthereumValueTransfer{EnvelopeType: PQEthereumValueType, From: intent.Owner, To: intent.To, Hash: abciHash, Nonce: intent.Nonce, GasLimit: intent.GasLimit, Value: int64(intent.Value), Fee: fee, MaximumGasFee: maximum}
	next, result, err := a.applyAuthorizedEthereumValueTransfer(next, execution, height, at)
	if err != nil {
		return executionState{}, transactionExecution{}, err
	}
	for address, expected := range planned {
		i, ok := accountIndex(next.accounts, address)
		if !ok || !reflect.DeepEqual(expected.Lots, next.accounts[i].Lots) {
			return fail(errors.New("PQ Ethereum lot receipt differs from the actual business execution"))
		}
	}
	tx := chain.Transaction{Hash: nativeHash, Type: PQEthereumValueType, From: intent.Owner, To: intent.To, Amount: int64(intent.Value), Fee: fee, Nonce: intent.Nonce + 1, BlockNum: uint64(height), Timestamp: at, Memo: pqEthereumValueHistoryMemo + hex.EncodeToString(raw), LotFlows: flows}
	next.pqHistory = append(clonePQHistory(state.pqHistory), PQCommittedAuthorization{ABCITransactionHash: abciHash, Transaction: tx})
	result.hash = abciHash
	return next, result, nil
}

func isPQEthereumValueHistory(tx chain.Transaction) bool {
	// Type also selects the validator: stripping the memo must not downgrade a
	// PQ record into a legacy history branch.
	return tx.Type == PQEthereumValueType || strings.HasPrefix(tx.Memo, pqEthereumValueHistoryMemo)
}

func decodePQEthereumValueHistory(entry PQCommittedAuthorization) ([]byte, ynxauth.EthereumValueIntent, error) {
	var intent ynxauth.EthereumValueIntent
	tx := entry.Transaction
	if !strings.HasPrefix(tx.Memo, pqEthereumValueHistoryMemo) || len(tx.Memo) > len(pqEthereumValueHistoryMemo)+2*MaxPQEthereumTransactionBytes {
		return nil, intent, errors.New("missing or oversized PQ Ethereum original transport")
	}
	raw, err := hex.DecodeString(strings.TrimPrefix(tx.Memo, pqEthereumValueHistoryMemo))
	if err != nil || tx.Memo != pqEthereumValueHistoryMemo+hex.EncodeToString(raw) {
		return nil, intent, errors.New("noncanonical PQ Ethereum original transport")
	}
	wire, intent, err := DecodePQEthereumValueTransaction(raw)
	if err != nil {
		return nil, intent, err
	}
	fee, _, err := pqEthereumFees(intent)
	if err != nil {
		return nil, intent, err
	}
	if intent.Nonce == math.MaxUint64 || tx.Timestamp.IsZero() || tx.Timestamp.Location() != time.UTC || tx.BlockNum > math.MaxInt64 || SignedTransactionHash(raw) != entry.ABCITransactionHash {
		return nil, intent, errors.New("PQ Ethereum inclusion, nonce or transport hash mismatch")
	}
	expected := chain.Transaction{Hash: SignedTransactionHash(wire), Type: PQEthereumValueType, From: intent.Owner, To: intent.To, Amount: int64(intent.Value), Fee: fee, Nonce: intent.Nonce + 1, BlockNum: tx.BlockNum, Timestamp: tx.Timestamp, Memo: tx.Memo, LotFlows: tx.LotFlows}
	if !reflect.DeepEqual(tx, expected) {
		return nil, intent, errors.New("PQ Ethereum history differs from its exact signed execution fields")
	}
	return wire, intent, nil
}

func validatePQEthereumFlows(tx chain.Transaction, feeRecipient string, trace map[string]chain.TrustTraceLot) error {
	at := 0
	for _, stage := range []struct {
		to     string
		amount int64
	}{{tx.To, tx.Amount}, {feeRecipient, tx.Fee}} {
		if stage.to == tx.From {
			continue // self-paid fee: the actual mover leaves all lots unchanged
		}
		var total int64
		previous := ""
		for total < stage.amount {
			if at == len(tx.LotFlows) {
				return errors.New("PQ Ethereum value or fee lot coverage is incomplete")
			}
			flow := tx.LotFlows[at]
			lot, ok := trace[flow.LotID]
			if flow.LotID == "" || flow.LotID <= previous || flow.From != tx.From || flow.To != stage.to || flow.Amount <= 0 || flow.Amount > stage.amount-total || !ok || lot.LotID != flow.LotID || lot.Amount < flow.Amount {
				return errors.New("PQ Ethereum lot identity, stage order or amount mismatch")
			}
			previous, total = flow.LotID, total+flow.Amount
			at++
		}
	}
	if at != len(tx.LotFlows) {
		return errors.New("PQ Ethereum history contains additional unexecuted lot flows")
	}
	return nil
}

// validateConsensusPQEthereumValues binds original authorization, exact ledger
// receipt and fee in both directions. It does not invent missing classic
// prestate: full historical native balance/lot replay requires those originals
// or an independently trusted checkpoint, beyond the existing snapshot format.
func validateConsensusPQEthereumValues(s CommittedState, migration chain.ConsensusMigrationState) error {
	feeRecipient := ""
	for _, validator := range migration.Validators {
		if validator.Active {
			feeRecipient = validator.Address
			break
		}
	}
	cache := chain.NewPQCertificateCache()
	proofs := map[string]PQCommittedAuthorization{}
	nativeHashes, tracked := map[string]bool{}, map[string]bool{}
	for _, entry := range s.PQHistory {
		tx := entry.Transaction
		if !isPQEthereumValueHistory(tx) {
			continue
		}
		wire, intent, err := decodePQEthereumValueHistory(entry)
		if err != nil {
			return err
		}
		if s.AccountPolicy == nil || feeRecipient == "" || intent.NativeChainID != uint64(s.ChainID) || !bytes.Equal(intent.ChainID, s.AccountPolicy.NetworkID) || tx.BlockNum <= migration.Height || tx.BlockNum > uint64(s.Height) || nativeHashes[tx.Hash] {
			return errors.New("PQ Ethereum history network, height or original identity mismatch")
		}
		if _, duplicate := proofs[entry.ABCITransactionHash]; duplicate {
			return errors.New("duplicate PQ Ethereum original transport")
		}
		member, err := ynxbatch.DecodeMember(wire)
		if err != nil {
			return err
		}
		if err = cache.VerifyDecodedMember(s.AccountPolicy, intent.Owner, ynxauth.TransactionPurpose, member.Message, member, tx.BlockNum); err != nil {
			return err
		}
		if err = validatePQEthereumFlows(tx, feeRecipient, s.TraceLots); err != nil {
			return err
		}
		proofs[entry.ABCITransactionHash], nativeHashes[tx.Hash], tracked[tx.From] = entry, true, true
	}
	receipts, fees := map[string]int{}, map[string]int{}
	for _, receipt := range s.EVMReceipts {
		entry, found := proofs[receipt.TxHash]
		if receipt.Action == PQEthereumValueType || found {
			if !found {
				return errors.New("PQ Ethereum receipt lacks its original proof")
			}
			tx := entry.Transaction
			expected := BFTEVMReceipt{TxHash: entry.ABCITransactionHash, From: tx.From, To: tx.To, Action: PQEthereumValueType, Status: "success", EncodedResult: "0x", Logs: []BFTEVMLog{}, BlockHeight: int64(tx.BlockNum)}
			expected.AuditHash = bftEVMReceiptAuditHash(expected)
			if !reflect.DeepEqual(receipt, expected) {
				return errors.New("PQ Ethereum receipt differs from its original execution")
			}
			receipts[receipt.TxHash]++
		} else if receipt.Action == EthereumLegacyTransferType || receipt.Action == EthereumAccessListTransferType || receipt.Action == EthereumDynamicFeeTransferType {
			if err := requireConsensusLegacy(s.AccountPolicy, receipt.From, receipt.BlockHeight); err != nil {
				return errors.New("classic Ethereum receipt crosses active PQ account policy")
			}
		}
	}
	for _, fee := range s.FeeEvents {
		entry, found := proofs[fee.TxHash]
		if fee.TransactionType == PQEthereumValueType || fee.Source == PQEthereumGasFeeSource || found {
			if !found {
				return errors.New("PQ Ethereum fee lacks its original proof")
			}
			tx := entry.Transaction
			expected := newFeeEvent(entry.ABCITransactionHash, PQEthereumValueType, tx.From, feeRecipient, tx.Fee, PQEthereumGasFeeSource, int64(tx.BlockNum), tx.Timestamp)
			if fee != expected {
				return errors.New("PQ Ethereum fee differs from actual gas payment")
			}
			fees[fee.TxHash]++
		} else if fee.TransactionType == EthereumLegacyTransferType || fee.TransactionType == EthereumAccessListTransferType || fee.TransactionType == EthereumDynamicFeeTransferType {
			if err := requireConsensusLegacy(s.AccountPolicy, fee.Payer, fee.BlockHeight); err != nil {
				return errors.New("classic Ethereum fee crosses active PQ account policy")
			}
		}
	}
	for hash := range proofs {
		if receipts[hash] != 1 || fees[hash] != 1 {
			return errors.New("PQ Ethereum requires exactly one original receipt and fee")
		}
	}
	lastNonce, activeSequence := map[string]uint64{}, map[string]bool{}
	for owner := range tracked {
		if i, ok := accountIndex(migration.Accounts, owner); ok {
			lastNonce[owner] = migration.Accounts[i].Nonce
		}
		// The authenticated source already fixes this owner's next nonce when
		// PQ was active at its boundary. Do not invent a classic gap there.
		if migration.AccountPolicy != nil && migration.Height < math.MaxUint64 {
			_, bound := migration.AccountPolicy.PolicyAt(owner, migration.Height+1)
			activeSequence[owner] = bound && migration.AccountPolicy.RequireLegacy(owner, migration.Height+1) != nil
		}
	}
	for _, entry := range s.PQHistory {
		tx := entry.Transaction
		if !tracked[tx.From] {
			continue
		}
		if tx.Nonce <= lastNonce[tx.From] || activeSequence[tx.From] && (lastNonce[tx.From] == math.MaxUint64 || tx.Nonce != lastNonce[tx.From]+1) {
			return errors.New("PQ Ethereum original ledger nonce sequence changed")
		}
		lastNonce[tx.From] = tx.Nonce
		// All non-migration entries are original PQ authorizations checked by
		// the complete state validators. Activation is permanent: another PQ
		// operation must establish continuity before the first Ethereum intent.
		// A first registration may still have a lawful pending classic window.
		if tx.Type != PQMigrationType || s.AccountPolicy.RequireLegacy(tx.From, tx.BlockNum) != nil {
			activeSequence[tx.From] = true
		}
	}
	for owner, nonce := range lastNonce {
		i, ok := accountIndex(s.Accounts, owner)
		if !ok || s.Accounts[i].Nonce != nonce {
			return errors.New("PQ Ethereum final nonce differs from complete active authorization history")
		}
	}
	return nil
}
