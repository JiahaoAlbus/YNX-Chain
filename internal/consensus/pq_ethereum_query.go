package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

const PQEthereumValueOriginalPath = "/pq-ethereum/originals/"

// This is one committed-state observation from the configured RPC, not an
// independently authenticated state root. Canonical record bytes preserve all
// original integers without passing uint64 through JavaScript JSON numbers.
type PQEthereumValueOriginalView struct {
	Source                string              `json:"source"`
	Authorization         PQWalletAccountView `json:"authorization"`
	NativeTransactionHash string              `json:"nativeTransactionHash"`
	ABCITransactionHash   string              `json:"abciTransactionHash"`
	ExecutionHeight       uint64              `json:"executionHeight,string"`
	Transport             []byte              `json:"transport"`
	Wire                  []byte              `json:"wire"`
	History               []byte              `json:"history"`
	Receipt               []byte              `json:"receipt"`
	Fee                   []byte              `json:"fee"`
	FeeRecipient          string              `json:"feeRecipient"`
	TraceLots             []byte              `json:"traceLots"`
}

// ValidatePQEthereumValueOriginalView checks exact original bytes, historical
// dual authorization and executed effects. The producer also checks recipient
// and lineage against its immutable migration. A self-consistent dishonest RPC
// is not turned into an independently verified light-client proof here.
func ValidatePQEthereumValueOriginalView(v PQEthereumValueOriginalView, queryHeight int64) (chain.Transaction, ynxauth.EthereumValueIntent, error) {
	var tx chain.Transaction
	var intent ynxauth.EthereumValueIntent
	fail := func(reason string) (chain.Transaction, ynxauth.EthereumValueIntent, error) {
		return chain.Transaction{}, intent, errors.New(reason)
	}
	if v.Source != "comet-rpc" || queryHeight != v.Authorization.CommittedHeight || queryHeight < 1 || v.ExecutionHeight == 0 || v.ExecutionHeight > uint64(queryHeight) || v.ExecutionHeight > math.MaxInt64 {
		return fail("PQ Ethereum original provenance or committed height mismatch")
	}
	if err := strictPQActionJSON(v.History, &tx); err != nil {
		return tx, intent, err
	}
	entry := PQCommittedAuthorization{ABCITransactionHash: v.ABCITransactionHash, Transaction: tx}
	wire, intent, err := decodePQEthereumValueHistory(entry)
	if err != nil {
		return tx, intent, err
	}
	if tx.BlockNum != v.ExecutionHeight || tx.Hash != v.NativeTransactionHash || !bytes.Equal(wire, v.Wire) || tx.Memo != pqEthereumValueHistoryMemo+hex.EncodeToString(v.Transport) || SignedTransactionHash(v.Transport) != v.ABCITransactionHash {
		return fail("PQ Ethereum original hashes or complete transport differ")
	}
	if err := ValidatePQWalletAccountView(v.Authorization, intent.Owner); err != nil {
		return tx, intent, err
	}
	if v.Authorization.Policy == nil || intent.NativeChainID != uint64(v.Authorization.NativeChainID) || !bytes.Equal(intent.ChainID, v.Authorization.Policy.NetworkID) || tx.Nonce > v.Authorization.LedgerNonce {
		return fail("PQ Ethereum original differs from its committed account/network")
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return tx, intent, err
	}
	if err = chain.NewPQCertificateCache().VerifyDecodedMember(v.Authorization.Policy, intent.Owner, ynxauth.TransactionPurpose, member.Message, member, tx.BlockNum); err != nil {
		return tx, intent, err
	}
	var receipt BFTEVMReceipt
	var fee BFTFeeEvent
	var lots map[string]chain.TrustTraceLot
	if err = strictPQActionJSON(v.Receipt, &receipt); err != nil {
		return tx, intent, err
	}
	if err = strictPQActionJSON(v.Fee, &fee); err != nil {
		return tx, intent, err
	}
	if err = strictPQActionJSON(v.TraceLots, &lots); err != nil {
		return tx, intent, err
	}
	if v.FeeRecipient == "" || strings.TrimSpace(v.FeeRecipient) != v.FeeRecipient {
		return fail("PQ Ethereum fee recipient is missing")
	}
	expectedReceipt := BFTEVMReceipt{TxHash: v.ABCITransactionHash, From: tx.From, To: tx.To, Action: PQEthereumValueType, Status: "success", EncodedResult: "0x", Logs: []BFTEVMLog{}, BlockHeight: int64(tx.BlockNum)}
	expectedReceipt.AuditHash = bftEVMReceiptAuditHash(expectedReceipt)
	if !reflect.DeepEqual(receipt, expectedReceipt) || ValidateBFTEVMReceipt(receipt) != nil {
		return fail("PQ Ethereum receipt differs from original execution")
	}
	expectedFee := newFeeEvent(v.ABCITransactionHash, PQEthereumValueType, tx.From, v.FeeRecipient, tx.Fee, PQEthereumGasFeeSource, int64(tx.BlockNum), tx.Timestamp)
	if fee != expectedFee {
		return fail("PQ Ethereum gas payment differs from original execution")
	}
	if err = validatePQEthereumFlows(tx, v.FeeRecipient, lots); err != nil {
		return tx, intent, err
	}
	wanted := map[string]bool{}
	for _, flow := range tx.LotFlows {
		wanted[flow.LotID] = true
	}
	if len(wanted) != len(lots) {
		return fail("PQ Ethereum original contains unrelated trace lineage")
	}
	return tx, intent, nil
}

func pqEthereumValueOriginalView(s CommittedState, m chain.ConsensusMigrationState, hash string) (PQEthereumValueOriginalView, error) {
	var v PQEthereumValueOriginalView
	if !walletHex(hash, 32, true) {
		return v, errors.New("canonical PQ Ethereum original wire hash required")
	}
	var entry *PQCommittedAuthorization
	for _, candidate := range s.PQHistory {
		if candidate.Transaction.Hash == hash {
			if entry != nil {
				return v, errors.New("duplicate PQ Ethereum original")
			}
			copy := candidate
			entry = &copy
		}
	}
	if entry == nil {
		return v, errors.New("PQ Ethereum original not found")
	}
	if err := validateConsensusPQEthereumValues(s, m); err != nil {
		return v, err
	}
	if err := validateMigrationTraceLots(s, m); err != nil {
		return v, err
	}
	wire, intent, err := decodePQEthereumValueHistory(*entry)
	if err != nil {
		return v, err
	}
	raw, err := hex.DecodeString(strings.TrimPrefix(entry.Transaction.Memo, pqEthereumValueHistoryMemo))
	if err != nil {
		return v, err
	}
	v = PQEthereumValueOriginalView{Source: "comet-rpc", NativeTransactionHash: hash, ABCITransactionHash: entry.ABCITransactionHash, ExecutionHeight: entry.Transaction.BlockNum, Transport: raw, Wire: bytes.Clone(wire)}
	v.Authorization, err = pqWalletAccountView(s, m, intent.Owner)
	if err != nil {
		return v, err
	}
	for _, validator := range m.Validators {
		if validator.Active {
			v.FeeRecipient = validator.Address
			break
		}
	}
	lots := map[string]chain.TrustTraceLot{}
	for _, flow := range entry.Transaction.LotFlows {
		if m.Runtime == nil {
			return v, errors.New("PQ Ethereum original requires source lineage")
		}
		lot, ok := m.Runtime.Lots[flow.LotID]
		if !ok {
			return v, errors.New("PQ Ethereum original lot is missing from migration")
		}
		lots[flow.LotID] = lot
	}
	v.History, err = json.Marshal(entry.Transaction)
	if err != nil {
		return v, err
	}
	v.TraceLots, err = json.Marshal(lots)
	if err != nil {
		return v, err
	}
	for _, receipt := range s.EVMReceipts {
		if receipt.TxHash == entry.ABCITransactionHash {
			if v.Receipt != nil {
				return v, errors.New("duplicate PQ Ethereum receipt")
			}
			v.Receipt, err = json.Marshal(receipt)
			if err != nil {
				return v, err
			}
		}
	}
	for _, fee := range s.FeeEvents {
		if fee.TxHash == entry.ABCITransactionHash {
			if v.Fee != nil {
				return v, errors.New("duplicate PQ Ethereum fee")
			}
			v.Fee, err = json.Marshal(fee)
			if err != nil {
				return v, err
			}
		}
	}
	_, _, err = ValidatePQEthereumValueOriginalView(v, s.Height)
	return v, err
}

// Called under Application.Query's existing RLock. This is latest committed
// state only; a request for a different height never receives relabeled data.
func queryPQEthereumValue(response *abcitypes.ResponseQuery, req *abcitypes.RequestQuery, s CommittedState, m chain.ConsensusMigrationState) bool {
	if !strings.HasPrefix(req.Path, PQEthereumValueOriginalPath) {
		return false
	}
	fail := func(err error) { response.Code, response.Log, response.Value = 1, err.Error(), nil }
	if req.Prove || len(req.Data) != 0 || req.Height < 0 || req.Height != 0 && req.Height != s.Height {
		fail(errors.New("PQ Ethereum original query supports exact current height only without proof/data"))
		return true
	}
	v, err := pqEthereumValueOriginalView(s, m, strings.TrimPrefix(req.Path, PQEthereumValueOriginalPath))
	if err != nil {
		fail(err)
		return true
	}
	response.Value, err = json.Marshal(v)
	if err != nil || len(response.Value) > MaxPQWalletQueryBytes {
		fail(errors.New("PQ Ethereum original query exceeds complete response bound"))
	}
	return true
}
