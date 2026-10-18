package chain

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	MaxPQActionMemberBytes  = 128 << 10
	pqActionMemo            = "ynx-pq-action-v1:"
	maxPQActionPolicyBytes  = 8192
	maxPQActionHistoryBytes = MaxPQActionMemberBytes + maxPQContractReceiptBytes + 12
)

// SubmitPQAction authenticates the original complete MemberWire while holding
// the same ledger lock used for its business mutation. The private execution
// helpers cannot be selected through an exported verified flag or callback.
// This entrypoint supports a member of any legal protocol batch size; Whole
// admission of mixed actions is a separate operation and is not implied here.
func (d *Devnet) SubmitPQAction(wire []byte) (Transaction, bool, error) {
	if len(wire) == 0 || len(wire) > MaxPQActionMemberBytes {
		return Transaction{}, false, errors.New("PQ action member exceeds bound")
	}
	wire = bytes.Clone(wire)
	m, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return Transaction{}, false, err
	}
	a, err := ynxauth.DecodeAction(m.Message)
	if err != nil {
		return Transaction{}, false, err
	}
	hash := pqBatchHash(wire)
	d.mu.Lock()
	defer d.mu.Unlock()
	if existing, ok := d.transactionLocked(hash); ok {
		original, err := decodePQActionMemo(existing.Memo)
		if err != nil || !bytes.Equal(original.Wire, wire) {
			return Transaction{}, false, errors.New("PQ action hash conflict")
		}
		if _, uncertain := d.uncertainTransactions[hash]; uncertain || d.dataDir != "" && !d.transactionCheckpointCovers(existing) {
			if err := d.confirmTransactionPersistenceLocked(); err != nil {
				return existing, false, err
			}
		}
		return existing, true, nil
	}
	if d.accountPolicy == nil || a.NativeChainID != uint64(d.cfg.ChainID) || !bytes.Equal(a.ChainID, d.accountPolicy.NetworkID) {
		return Transaction{}, false, ynxauth.ErrPolicy
	}
	if err := d.accountPolicy.VerifyMember(a.Owner, ynxauth.TransactionPurpose, m.Message, wire, d.accountExecutionHeightLocked()); err != nil {
		return Transaction{}, false, err
	}
	sender := d.accounts[a.Owner]
	if sender == nil || sender.Nonce == math.MaxUint64 || a.Nonce != sender.Nonce+1 {
		return Transaction{}, false, errors.New("PQ action requires an existing account and its exact next nonce")
	}
	payload, err := ynxauth.DecodeActionPayload(a.Kind, a.Payload)
	if err != nil {
		return Transaction{}, false, err
	}
	if pqContractKind(a.Kind) {
		tx, err := d.submitPQContractActionLocked(a, payload, hash, wire)
		return tx, false, err
	}
	memo, err := encodePQActionMemo(a, wire, d.resourcePolicy.withCurrentHash())
	if err != nil {
		return Transaction{}, false, err
	}
	if strings.HasPrefix(a.Kind, "dex_") {
		if a.Fee != 1 {
			return Transaction{}, false, errors.New("native DEX action fee must be one")
		}
		input, err := pqNativeDexInput(a, hash, payload)
		if err != nil {
			return Transaction{}, false, err
		}
		tx, _, replayed, err := d.submitNativeDexActionLocked(input, memo)
		return tx, replayed, err
	}
	if a.Fee != 0 {
		return Transaction{}, false, errors.New("native stake and resource action fee must be zero")
	}
	tx, err := d.submitPQResourceActionLocked(a, payload, hash, memo)
	return tx, false, err
}

// Exact typed conversion is performed only after the binary payload has been
// validated. No user JSON enters the existing DEX parser and no u64 is narrowed
// before the canonical codec has enforced its int64/u8/u16 range.
func pqNativeDexInput(a ynxauth.Action, hash string, value any) (NativeDexSignedActionInput, error) {
	var p any
	switch v := value.(type) {
	case ynxauth.DexAssetCreatePayload:
		p = NativeDexAssetCreatePayload{v.AssetID, v.Symbol, v.Name, uint8(v.Decimals), int64(v.MaxSupply), int64(v.InitialSupply)}
	case ynxauth.DexAssetAmountPayload:
		p = NativeDexAssetAmountPayload{v.AssetID, int64(v.Amount)}
	case ynxauth.DexAssetTransferPayload:
		p = NativeDexAssetTransferPayload{v.AssetID, v.Recipient, int64(v.Amount)}
	case ynxauth.DexPoolCreatePayload:
		p = NativeDexPoolCreatePayload{v.PoolID, v.Asset0, v.Asset1, uint16(v.FeeBps)}
	case ynxauth.DexLiquidityPayload:
		p = NativeDexLiquidityPayload{v.PoolID, int64(v.Amount0), int64(v.Amount1), int64(v.MinShares), int64(v.DeadlineUnix)}
	case ynxauth.DexLiquidityRemovePayload:
		p = NativeDexLiquidityRemovePayload{v.PoolID, int64(v.Shares), int64(v.MinAmount0), int64(v.MinAmount1), int64(v.DeadlineUnix)}
	case ynxauth.DexSwapExactInputPayload:
		p = NativeDexSwapExactInputPayload{v.PoolID, v.AssetIn, int64(v.AmountIn), int64(v.MinAmountOut), int64(v.DeadlineUnix)}
	case ynxauth.DexSwapExactOutputPayload:
		p = NativeDexSwapExactOutputPayload{v.PoolID, v.AssetOut, int64(v.AmountOut), int64(v.MaxAmountIn), int64(v.DeadlineUnix)}
	default:
		return NativeDexSignedActionInput{}, ynxauth.ErrAction
	}
	raw, err := json.Marshal(p)
	return NativeDexSignedActionInput{Hash: hash, Signer: a.Owner, Action: a.Kind, Nonce: a.Nonce, Fee: int64(a.Fee), Payload: raw}, err
}

type pqActionHistory struct {
	Action        ynxauth.Action
	Message, Wire []byte
	Policy        *ResourceMarketPolicy
	Contract      *pqContractReceipt
}

func encodePQActionMemo(a ynxauth.Action, wire []byte, policy ResourceMarketPolicy) (string, error) {
	var policyJSON []byte
	if a.Kind == ynxauth.ActionResourceDelegate || a.Kind == ynxauth.ActionResourceRent {
		if err := policy.Validate(); err != nil {
			return "", err
		}
		// Bound trusted policy text before JSON allocation as well as after JSON
		// escaping. These small execution receipts cannot retain arbitrary notes.
		textSize := len(policy.ID) + len(policy.Version) + len(policy.GovernanceStatus) + len(policy.Currency) + len(policy.PolicyHash)
		if len(policy.Notes) > 128 || textSize > maxPQActionPolicyBytes {
			return "", errors.New("PQ resource policy history exceeds bound")
		}
		for _, note := range policy.Notes {
			if len(note) > maxPQActionPolicyBytes-textSize {
				return "", errors.New("PQ resource policy history exceeds bound")
			}
			textSize += len(note)
		}
		var err error
		policyJSON, err = json.Marshal(policy)
		if err != nil || len(policyJSON) > maxPQActionPolicyBytes {
			return "", errors.New("PQ resource policy history exceeds bound")
		}
	}
	raw, err := ynxbatch.EncodeFields(wire, policyJSON)
	if err != nil {
		return "", err
	}
	return pqActionMemo + hex.EncodeToString(raw), nil
}

func decodePQActionMemo(memo string) (pqActionHistory, error) {
	var h pqActionHistory
	if !strings.HasPrefix(memo, pqActionMemo) || len(memo) > len(pqActionMemo)+2*maxPQActionHistoryBytes {
		return h, ynxauth.ErrAction
	}
	encoded := strings.TrimPrefix(memo, pqActionMemo)
	raw, err := hex.DecodeString(encoded)
	if err != nil || hex.EncodeToString(raw) != encoded {
		return h, ynxauth.ErrAction
	}
	fields, err := ynxbatch.DecodeFields(raw, 2, maxPQActionHistoryBytes)
	if err != nil || len(fields[0]) > MaxPQActionMemberBytes || len(fields[1]) > maxPQContractReceiptBytes {
		return h, ynxauth.ErrAction
	}
	h.Wire = fields[0]
	m, err := ynxbatch.DecodeMember(h.Wire)
	if err != nil {
		return h, err
	}
	h.Action, err = ynxauth.DecodeAction(m.Message)
	if err != nil {
		return h, err
	}
	h.Message = m.Message
	if pqContractKind(h.Action.Kind) {
		h.Contract, err = decodePQContractReceipt(fields[1])
		return h, err
	}
	if len(fields[1]) > maxPQActionPolicyBytes {
		return h, errors.New("PQ historical resource policy exceeds its original bound")
	}
	resource := h.Action.Kind == ynxauth.ActionResourceDelegate || h.Action.Kind == ynxauth.ActionResourceRent
	if resource {
		var policy ResourceMarketPolicy
		if err := json.Unmarshal(fields[1], &policy); err != nil {
			return h, err
		}
		canonical, err := json.Marshal(policy)
		if err != nil || !bytes.Equal(canonical, fields[1]) || policy.PolicyHash == "" {
			return h, errors.New("noncanonical PQ historical resource policy")
		}
		if err := policy.Validate(); err != nil {
			return h, err
		}
		h.Policy = &policy
	} else if len(fields[1]) != 0 {
		return h, errors.New("non-resource PQ history contains a resource policy")
	}
	return h, nil
}

func validateHistoricalPQAction(tx Transaction, state *ynxauth.State, height uint64, chainID int64) error {
	h, err := decodePQActionMemo(tx.Memo)
	if err != nil {
		return err
	}
	a := h.Action
	if state == nil || a.NativeChainID != uint64(chainID) || !bytes.Equal(a.ChainID, state.NetworkID) || tx.Hash != pqBatchHash(h.Wire) || tx.From != a.Owner || tx.Nonce != a.Nonce || tx.Fee != int64(a.Fee) || tx.Timestamp.IsZero() {
		return errors.New("PQ action history differs from signed execution identity")
	}
	p, err := ynxauth.DecodeActionPayload(a.Kind, a.Payload)
	if err != nil {
		return err
	}
	if pqContractKind(a.Kind) {
		return validateHistoricalPQContractAction(tx, h, p, state, height)
	}
	typeName, to, amount := a.Kind, "", int64(0)
	switch v := p.(type) {
	case ynxauth.StakePayload:
		to, amount = "ynx_staking", int64(v.Amount)
	case ynxauth.ResourceDelegationPayload:
		typeName, to, amount = "resource_delegate", v.Beneficiary, int64(v.AmountYNXT)
		if h.Policy == nil || v.PolicyHash != h.Policy.PolicyHash || v.RequestHash != pqDelegationRequestHash(v) {
			return errors.New("PQ historical delegation request hash mismatch")
		}
	case ynxauth.ResourceRentalPayload:
		typeName, to, amount = "resource_rent", v.Provider, tx.Amount
		if amount <= 0 || uint64(amount) > v.MaxPriceYNXT || v.RequestHash != pqRentalRequestHash(v) {
			return errors.New("PQ historical rental request hash or price mismatch")
		}
		if h.Policy == nil {
			return errors.New("missing original PQ rental policy")
		}
		quote, err := pqRentalQuote(*h.Policy, v, tx.Timestamp)
		if err != nil || quote.PriceYNXT != amount {
			return errors.New("historical PQ quote differs from original execution")
		}
	case ynxauth.DexAssetCreatePayload:
		to = v.AssetID
	case ynxauth.DexAssetAmountPayload:
		to = v.AssetID
	case ynxauth.DexAssetTransferPayload:
		to = v.AssetID
	case ynxauth.DexPoolCreatePayload:
		to = v.PoolID
	case ynxauth.DexLiquidityPayload:
		to = v.PoolID
	case ynxauth.DexLiquidityRemovePayload:
		to = v.PoolID
	case ynxauth.DexSwapExactInputPayload:
		to = v.PoolID
	case ynxauth.DexSwapExactOutputPayload:
		to = v.PoolID
	default:
		return ynxauth.ErrAction
	}
	wantFee := int64(0)
	if strings.HasPrefix(a.Kind, "dex_") {
		wantFee = 1
	}
	if tx.Type != typeName || tx.To != to || tx.Amount != amount || tx.Fee != wantFee {
		return errors.New("PQ historical action execution fields mismatch")
	}
	if tx.Sponsor != "" || tx.SponsorPoolID != "" || tx.ResourceSource != "" || tx.ResourceType != "" || tx.ResourceConsumed != 0 || tx.ActionReference != "" {
		return errors.New("PQ action history contains unsigned execution metadata")
	}
	// ProduceBlock adds the deterministic system log after admission. Check its
	// full projection here; the complete snapshot pass separately binds both
	// positional indices to the actual containing block, not to these claims.
	var txIndex, logIndex uint64
	if len(tx.Logs) == 1 {
		txIndex, logIndex = tx.Logs[0].TransactionIndex, tx.Logs[0].LogIndex
	}
	if err := validatePQActionLogs(tx, txIndex, logIndex); err != nil {
		return err
	}
	var feeLots int64
	for _, flow := range tx.LotFlows {
		if flow.From != a.Owner || flow.To == "" || flow.LotID == "" || flow.Amount <= 0 || flow.Amount > wantFee-feeLots {
			return errors.New("PQ action fee lot history mismatch")
		}
		feeLots += flow.Amount
	}
	if feeLots != wantFee {
		return errors.New("PQ action fee lacks exact provenance")
	}
	return state.VerifyMember(a.Owner, ynxauth.TransactionPurpose, h.Message, h.Wire, height)
}

func validatePQActionLogs(tx Transaction, txIndex, firstLogIndex uint64) error {
	if tx.Type == "contract_deploy" || tx.Type == "contract_call" {
		h, err := decodePQActionMemo(tx.Memo)
		if err != nil {
			return err
		}
		return validatePQContractLogs(tx, h.Contract, txIndex, firstLogIndex)
	}
	if tx.BlockNum == 0 {
		if tx.BlockHash != "" || len(tx.Logs) != 0 {
			return errors.New("pending PQ action contains block identity or logs")
		}
		return nil
	}
	if tx.BlockHash == "" {
		return errors.New("mined PQ action lacks block identity")
	}
	// These actions generate exactly the ordinary system projection. Contract
	// execution logs and arbitrary caller metadata are outside this dispatch.
	switch tx.Type {
	case "stake", "resource_delegate", "resource_rent",
		NativeDexActionAssetCreate, NativeDexActionAssetMint, NativeDexActionAssetTransfer,
		NativeDexActionPoolCreate, NativeDexActionLiquidityAdd, NativeDexActionLiquidityRemove,
		NativeDexActionSwapExactInput, NativeDexActionSwapExactOutput:
	default:
		return errors.New("unsupported PQ action log projection")
	}
	projection := Devnet{}
	expected := projection.evmLogsForTransactionLocked(tx, txIndex, firstLogIndex)
	if len(expected) != 1 || !reflect.DeepEqual(tx.Logs, expected) {
		return errors.New("PQ action log differs from deterministic execution projection")
	}
	return nil
}
