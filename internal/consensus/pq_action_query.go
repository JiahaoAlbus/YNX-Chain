package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math"
	"reflect"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

const PQActionHistoryPath = "/pq-actions/originals/"

// PQActionHistoryView is a bounded observation of ONE committed state. The
// original history/effects are canonical JSON bytes, not JS numeric objects.
// Neither this view nor its AppHash authenticates the configured RPC server.
// A gateway must independently match Transport with Comet's real /tx index.
type PQActionHistoryView struct {
	Source              string              `json:"source"`
	Authorization       PQWalletAccountView `json:"authorization"`
	ABCITransactionHash string              `json:"abciTransactionHash"`
	ExecutionHeight     uint64              `json:"executionHeight,string"`
	Transport           []byte              `json:"transport"`
	History             []byte              `json:"history"`
	Effects             []byte              `json:"effects"`
}

type pqActionResourceEffects struct {
	Policy      chain.ResourceMarketPolicy `json:"policy"`
	Delegation  *BFTResourceDelegation     `json:"delegation"`
	Rental      *BFTResourceRental         `json:"rental"`
	Quote       *BFTResourceQuote          `json:"quote"`
	Income      []BFTResourceIncome        `json:"income"`
	Event       BFTResourceEvent           `json:"event"`
	Idempotency BFTResourceIdempotency     `json:"idempotency"`
}

// Prestate is the actual ordered DEX replay immediately before this event.
// It permits re-running the existing AMM math, not reconstructing imaginary
// native balances. The source validates its complete DEX history first.
type pqActionDexEffects struct {
	Assets   []BFTDexAsset   `json:"beforeAssets"`
	Balances []BFTDexBalance `json:"beforeBalances"`
	Pools    []BFTDexPool    `json:"beforePools"`
	Event    BFTDexEvent     `json:"event"`
}

type pqActionStakingEffects struct {
	Delegation BFTStakeDelegation  `json:"delegation"`
	Unbondings []BFTUnbondingEntry `json:"unbondings"`
}

type pqActionEffects struct {
	FeeRecipient string       `json:"feeRecipient"`
	Fee          *BFTFeeEvent `json:"fee"`
	// Original migration lineage after verifying that committed lineage retains
	// it. Mutable current LastInbound is not an original execution effect.
	TraceLots map[string]chain.TrustTraceLot `json:"traceLots"`
	Resource  *pqActionResourceEffects       `json:"resource"`
	DEX       *pqActionDexEffects            `json:"dex"`
	Contract  *BFTEVMReceipt                 `json:"contract"`
	Staking   *pqActionStakingEffects        `json:"staking,omitempty"`
}

// DecodePQActionTransport uses exactly the existing executor codecs. It does
// not impose N=1: a canonical Member's N/index/paths remain signed and intact.
func DecodePQActionTransport(raw []byte) ([]byte, ynxauth.Action, error) {
	var e PQTransaction
	var action ynxauth.Action
	if len(raw) == 0 || len(raw) > MaxPQContractTransactionBytes || json.Unmarshal(raw, &e) != nil {
		return nil, action, errors.New("invalid bounded PQ action transport")
	}
	wire, err := hex.DecodeString(e.WireHex)
	if err != nil || len(wire) > chain.MaxPQActionMemberBytes {
		return nil, action, errors.New("invalid bounded PQ action Member")
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return nil, action, err
	}
	action, err = ynxauth.DecodeAction(member.Message)
	if err != nil {
		return nil, action, err
	}
	if action.Kind == ynxauth.ActionContractDeploy || action.Kind == ynxauth.ActionContractExecute {
		_, wire, action, err = DecodePQContractTransaction(raw)
		return wire, action, err
	}
	return DecodePQNativeActionTransaction(raw)
}

func strictPQActionJSON(raw []byte, out any) error {
	if len(raw) == 0 || len(raw) > MaxPQWalletQueryBytes {
		return errors.New("PQ action evidence exceeds complete query bound")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	if d.Decode(&struct{}{}) != io.EOF {
		return errors.New("trailing PQ action evidence")
	}
	b, err := json.Marshal(out)
	if err != nil || !bytes.Equal(b, raw) {
		return errors.New("noncanonical PQ action evidence")
	}
	return nil
}

func pqActionOriginal(entry PQCommittedAuthorization) ([]byte, error) {
	tx := entry.Transaction
	if isPQContractHistory(tx) {
		r, _, _, err := decodePQContractHistory(tx)
		return r.Transport, err
	}
	for _, prefix := range []string{pqNativeActionHistoryMemo, pqResourceHistoryMemo, pqDexHistoryMemo, pqStakingHistoryMemo} {
		if strings.HasPrefix(tx.Memo, prefix) && len(tx.Memo) <= 4*chain.MaxPQActionMemberBytes+1024 {
			raw, err := hex.DecodeString(strings.TrimPrefix(tx.Memo, prefix))
			if err != nil || tx.Memo != prefix+hex.EncodeToString(raw) {
				return nil, errors.New("noncanonical action history original")
			}
			return raw, nil
		}
	}
	return nil, errors.New("history has no standalone ABCI action original")
}

// ValidatePQActionHistoryView performs actual historical dual verification and
// reuses the real executor's record/math/bytecode replay. It makes no independent
// finality claim. Returned history is safe to project only after index matching.
func ValidatePQActionHistoryView(v PQActionHistoryView, queryHeight int64) (chain.Transaction, ynxauth.Action, error) {
	var tx chain.Transaction
	var effects pqActionEffects
	var action ynxauth.Action
	fail := func(err error) (chain.Transaction, ynxauth.Action, error) { return tx, action, err }
	if err := strictPQActionJSON(v.History, &tx); err != nil {
		return fail(err)
	}
	if err := strictPQActionJSON(v.Effects, &effects); err != nil {
		return fail(err)
	}
	wire, action, err := DecodePQActionTransport(v.Transport)
	if err != nil {
		return fail(err)
	}
	auth := v.Authorization
	if v.Source != "comet-rpc" || queryHeight != auth.CommittedHeight || queryHeight < 0 || v.ExecutionHeight == 0 || v.ExecutionHeight > uint64(queryHeight) || tx.BlockNum != v.ExecutionHeight || tx.Hash != SignedTransactionHash(wire) || v.ABCITransactionHash != SignedTransactionHash(v.Transport) || tx.From != action.Owner || tx.Nonce != action.Nonce || tx.Nonce == 0 || tx.Nonce > auth.LedgerNonce || tx.Fee != int64(action.Fee) || action.Fee > math.MaxInt64 || tx.Timestamp.IsZero() || tx.Timestamp.Location() != time.UTC {
		return fail(errors.New("action history identity, height, nonce or executed fields mismatch"))
	}
	if err := ValidatePQWalletAccountView(auth, action.Owner); err != nil {
		return fail(err)
	}
	if auth.Policy == nil || action.NativeChainID != uint64(auth.NativeChainID) || !bytes.Equal(action.ChainID, auth.Policy.NetworkID) {
		return fail(errors.New("action history has wrong network or no historical authority"))
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return fail(err)
	}
	if err = chain.NewPQCertificateCache().VerifyDecodedMember(auth.Policy, action.Owner, ynxauth.TransactionPurpose, member.Message, member, tx.BlockNum); err != nil {
		return fail(err)
	}
	entry := PQCommittedAuthorization{ABCITransactionHash: v.ABCITransactionHash, Transaction: tx}
	original, err := pqActionOriginal(entry)
	if err != nil || !bytes.Equal(original, v.Transport) {
		return fail(errors.New("action history differs from complete original transport"))
	}
	if tx.BlockHash != "" || len(tx.Logs) != 0 || tx.Sponsor != "" || tx.SponsorPoolID != "" || tx.ResourceSource != "" || tx.ResourceType != "" || tx.ResourceConsumed != 0 || tx.ActionReference != "" {
		return fail(errors.New("action history contains unexecuted metadata"))
	}
	feeBearing := isDexAction(action.Kind) || isStakingAction(action.Kind) || action.Kind == ynxauth.ActionContractDeploy || action.Kind == ynxauth.ActionContractExecute
	if feeBearing {
		if err := validatePQActionFee(entry, effects); err != nil {
			return fail(err)
		}
	} else if effects.Fee != nil || effects.FeeRecipient != "" || len(effects.TraceLots) != 0 || len(tx.LotFlows) != 0 || tx.Fee != 0 {
		return fail(errors.New("fee-zero action acquired unexecuted fee or lot effects"))
	}
	switch {
	case action.Kind == ynxauth.ActionStake:
		if effects.Resource != nil || effects.DEX != nil || effects.Contract != nil || effects.Staking != nil {
			return fail(errors.New("stake acquired another action's effects"))
		}
		_, _, err = decodePQNativeActionHistory(entry)
	case action.Kind == ynxauth.ActionResourceDelegate || action.Kind == ynxauth.ActionResourceRent:
		if effects.Resource == nil || effects.DEX != nil || effects.Contract != nil || effects.Staking != nil {
			return fail(errors.New("resource action lacks exclusive original effects"))
		}
		var r authorizedResourceRecords
		_, _, r, err = decodePQResourceHistory(entry, effects.Resource.Policy)
		expected := resourceActionEffects(effects.Resource.Policy, r)
		if err == nil && !reflect.DeepEqual(expected, effects.Resource) {
			err = errors.New("resource quote, income, event or idempotency differs from actual computation")
		}
	case isDexAction(action.Kind):
		if effects.DEX == nil || effects.Resource != nil || effects.Contract != nil || effects.Staking != nil {
			return fail(errors.New("DEX action lacks exclusive original effects"))
		}
		var a authorizedDexAction
		_, _, a, err = decodePQDexHistory(entry)
		if err != nil {
			break
		}
		d := effects.DEX
		if _, err := validateDexState(d.Assets, d.Balances, d.Pools, nil); err != nil {
			return fail(err)
		}
		if !reflect.DeepEqual(tx, dexHistoryTransaction(action, tx.Hash, d.Event, v.Transport, tx.LotFlows)) {
			return fail(errors.New("DEX history differs from original execution event"))
		}
		mover, used := replayDexNativeMovement(d.Event.NativeFlows, effects.TraceLots)
		var next executionState
		next, _, err = applyAuthorizedDexBusiness(executionState{dexAssets: d.Assets, dexBalances: d.Balances, dexPools: d.Pools}, a, v.ABCITransactionHash, int64(tx.BlockNum), tx.Timestamp, false, mover)
		if err == nil && (len(d.Event.NativeFlows) > 0 && !*used || !reflect.DeepEqual(next.dexEvents[len(next.dexEvents)-1], d.Event)) {
			err = errors.New("DEX result differs from actual AMM math or original native escrow")
		}
		if err == nil {
			_, err = validateDexState(next.dexAssets, next.dexBalances, next.dexPools, next.dexEvents)
		}
	case action.Kind == ynxauth.ActionContractDeploy || action.Kind == ynxauth.ActionContractExecute:
		if effects.Contract == nil || effects.Resource != nil || effects.DEX != nil || effects.Staking != nil {
			return fail(errors.New("contract action lacks exclusive original execution receipt"))
		}
		err = validatePQActionContract(entry, effects, action, wire)
	case isStakingAction(action.Kind):
		if effects.Staking == nil || effects.Resource != nil || effects.DEX != nil || effects.Contract != nil {
			return fail(errors.New("staking action lacks exclusive original business effects"))
		}
		err = validatePQActionStaking(entry, *effects.Staking, auth)
	default:
		err = errors.New("unsupported PQ action kind")
	}
	return tx, action, err
}

func validatePQActionFee(entry PQCommittedAuthorization, e pqActionEffects) error {
	tx := entry.Transaction
	if tx.Fee <= 0 || strings.TrimSpace(e.FeeRecipient) == "" || e.Fee == nil || *e.Fee != newCurrentFeeEvent(entry.ABCITransactionHash, PQActionType, tx.From, e.FeeRecipient, tx.Fee, int64(tx.BlockNum), tx.Timestamp) {
		return errors.New("action fee event differs from original execution")
	}
	var total int64
	previous := ""
	for _, flow := range tx.LotFlows {
		lot, exists := e.TraceLots[flow.LotID]
		if flow.LotID == "" || flow.LotID <= previous || flow.From != tx.From || flow.To != e.FeeRecipient || flow.Amount <= 0 || flow.Amount > tx.Fee-total || !exists || lot.LotID != flow.LotID || lot.Amount < flow.Amount {
			return errors.New("action fee lacks exact traceable lot coverage")
		}
		previous, total = flow.LotID, total+flow.Amount
	}
	if total != tx.Fee {
		return errors.New("action fee lot coverage is incomplete")
	}
	return nil
}

func validatePQActionContract(entry PQCommittedAuthorization, e pqActionEffects, action ynxauth.Action, wire []byte) error {
	tx := entry.Transaction
	r, _, _, err := decodePQContractHistory(tx)
	if err != nil {
		return err
	}
	post, err := chain.ReplayConsensusPQContract(tx, wire, r.Receipt)
	if err != nil {
		return err
	}
	if action.Kind == ynxauth.ActionContractDeploy {
		envelope, _, _, err := DecodePQContractTransaction(r.Transport)
		if err != nil {
			return err
		}
		expected, err := chain.BuildConsensusPQContractDeployment(action, tx.Hash, tx.Timestamp, envelope.Source, *envelope.Material)
		if err != nil || !reflect.DeepEqual(expected, r.Receipt) {
			return errors.New("deployment differs from original signed compiler materials")
		}
		receipt := BFTEVMReceipt{TxHash: entry.ABCITransactionHash, From: action.Owner, Action: ActionIDEContractDeploy, Status: "success", ContractAddress: post.Address, Logs: []BFTEVMLog{}, BlockHeight: int64(tx.BlockNum)}
		receipt.AuditHash = bftEVMReceiptAuditHash(receipt)
		if !reflect.DeepEqual(*e.Contract, receipt) {
			return errors.New("deployment receipt differs from original runtime execution")
		}
		return nil
	}
	if e.Contract.TxHash != entry.ABCITransactionHash || e.Contract.From != action.Owner || e.Contract.BlockHeight != int64(tx.BlockNum) || r.Receipt.Transition == nil {
		return errors.New("contract call receipt original identity mismatch")
	}
	return pqContractReceiptMatchesTransition(*e.Contract, post.Address, *r.Receipt.Transition)
}

func resourceActionEffects(policy chain.ResourceMarketPolicy, r authorizedResourceRecords) *pqActionResourceEffects {
	return &pqActionResourceEffects{Policy: policy, Delegation: r.delegation, Rental: r.rental, Quote: r.quote, Income: r.income, Event: r.event, Idempotency: r.idempotency}
}

// Called after the complete real DEX validator, so each prior classic/PQ
// authorization and event already has its original ordered binding checked.
func pqActionDexPrestate(s CommittedState, m chain.ConsensusMigrationState, hash string) (*pqActionDexEffects, error) {
	assets, balances, pools, events := dexStateFromMigration(m)
	replay := executionState{dexAssets: assets, dexBalances: balances, dexPools: pools, dexEvents: events}
	entries := map[string]PQCommittedAuthorization{}
	for _, entry := range s.PQHistory {
		entries[entry.ABCITransactionHash] = entry
	}
	for _, event := range s.DexEvents[len(events):] {
		if event.TxHash == hash {
			return &pqActionDexEffects{Assets: replay.dexAssets, Balances: replay.dexBalances, Pools: replay.dexPools, Event: event}, nil
		}
		var auth authorizedDexAction
		if entry, exists := entries[event.TxHash]; exists {
			_, _, a, err := decodePQDexHistory(entry)
			if err != nil {
				return nil, err
			}
			auth = a
		} else {
			raw, err := hex.DecodeString(event.ClassicAuthorization)
			if err != nil {
				return nil, err
			}
			tx, err := DecodeSignedApplicationAction(raw)
			if err != nil {
				return nil, err
			}
			auth = authorizedDexAction{Signer: tx.Signer, Action: tx.Action, Payload: bytes.Clone(tx.Payload), ClassicAuthorization: event.ClassicAuthorization}
		}
		mover, _ := replayDexNativeMovement(event.NativeFlows, s.TraceLots)
		next, _, err := applyAuthorizedDexBusiness(replay, auth, event.TxHash, event.BlockHeight, event.OccurredAt, false, mover)
		if err != nil {
			return nil, err
		}
		replay = next
	}
	return nil, errors.New("DEX original has no committed event")
}

func pqActionHistoryView(s CommittedState, m chain.ConsensusMigrationState, hash string) (PQActionHistoryView, error) {
	var v PQActionHistoryView
	if !walletHex(hash, 32, true) {
		return v, errors.New("canonical native Action Member hash is required")
	}
	if _, exists := sourceHistoryTransaction(m, hash); exists {
		return v, errors.New("imported source action has no Comet execution identity")
	}
	var entry PQCommittedAuthorization
	count := 0
	for _, e := range s.PQHistory {
		if e.Transaction.Hash == hash {
			entry, count = e, count+1
		}
	}
	if count != 1 || entry.Transaction.BlockNum <= m.Height {
		return v, errors.New("standalone committed ABCI action original not found or duplicated")
	}
	raw, err := pqActionOriginal(entry)
	if err != nil {
		return v, err
	}
	_, action, err := DecodePQActionTransport(raw)
	if err != nil {
		return v, err
	}
	effects := pqActionEffects{}
	switch {
	case action.Kind == ynxauth.ActionStake:
		err = validateConsensusPQNativeActions(s, m)
	case isStakingAction(action.Kind):
		err = validateConsensusPQStaking(s, m)
		if err == nil {
			effects.Staking, err = pqActionStakingEffectsFor(s, entry.ABCITransactionHash)
		}
	case action.Kind == ynxauth.ActionResourceDelegate || action.Kind == ynxauth.ActionResourceRent:
		err = validateConsensusPQResources(s, m)
		if err == nil {
			var records authorizedResourceRecords
			_, _, records, err = decodePQResourceHistory(entry, m.ResourcePolicy)
			effects.Resource = resourceActionEffects(m.ResourcePolicy, records)
		}
	case isDexAction(action.Kind):
		err = validateConsensusPQDex(s, m)
		if err == nil {
			effects.DEX, err = pqActionDexPrestate(s, m, entry.ABCITransactionHash)
		}
	case action.Kind == ynxauth.ActionContractDeploy || action.Kind == ynxauth.ActionContractExecute:
		err = validateConsensusPQContracts(s, m)
		for _, receipt := range s.EVMReceipts {
			if receipt.TxHash == entry.ABCITransactionHash {
				if effects.Contract != nil {
					return v, errors.New("duplicate original contract execution receipt")
				}
				copy := receipt
				effects.Contract = &copy
			}
		}
	default:
		err = errors.New("unsupported action original")
	}
	if err != nil {
		return v, err
	}
	if isDexAction(action.Kind) || isStakingAction(action.Kind) || isPQContractHistory(entry.Transaction) {
		if m.Runtime == nil {
			return v, errors.New("action fee lacks complete original source lineage")
		}
		if err := validateMigrationTraceLots(s, m); err != nil {
			return v, err
		}
		for _, validator := range m.Validators {
			if validator.Active {
				effects.FeeRecipient = validator.Address
				break
			}
		}
		for _, fee := range s.FeeEvents {
			if fee.TxHash == entry.ABCITransactionHash {
				if effects.Fee != nil {
					return v, errors.New("duplicate original action fee event")
				}
				copy := fee
				effects.Fee = &copy
			}
		}
		effects.TraceLots = map[string]chain.TrustTraceLot{}
		flows := append([]chain.LotFlow(nil), entry.Transaction.LotFlows...)
		if effects.DEX != nil {
			flows = append(flows, effects.DEX.Event.NativeFlows...)
		}
		for _, flow := range flows {
			lot, exists := m.Runtime.Lots[flow.LotID]
			if !exists {
				return v, errors.New("original action flow lacks committed lineage")
			}
			effects.TraceLots[flow.LotID] = lot
		}
	}
	v = PQActionHistoryView{Source: "comet-rpc", ABCITransactionHash: entry.ABCITransactionHash, ExecutionHeight: entry.Transaction.BlockNum, Transport: bytes.Clone(raw)}
	v.Authorization, err = pqWalletAccountView(s, m, action.Owner)
	if err != nil {
		return v, err
	}
	v.History, err = json.Marshal(entry.Transaction)
	if err != nil {
		return v, err
	}
	v.Effects, err = json.Marshal(effects)
	if err != nil {
		return v, err
	}
	_, _, err = ValidatePQActionHistoryView(v, s.Height)
	return v, err
}

// Application.Query already holds RLock. No nested application calls, pending
// state, mutation, historical-height substitution, or fabricated proof occurs.
func queryPQAction(response *abcitypes.ResponseQuery, req *abcitypes.RequestQuery, s CommittedState, m chain.ConsensusMigrationState) bool {
	if !strings.HasPrefix(req.Path, PQActionHistoryPath) {
		return false
	}
	fail := func(err error) { response.Code, response.Log, response.Value = 1, err.Error(), nil }
	if req.Prove || len(req.Data) != 0 || req.Height < 0 || req.Height != 0 && req.Height != s.Height {
		fail(errors.New("PQ action query supports only current committed height without data or proof"))
		return true
	}
	v, err := pqActionHistoryView(s, m, strings.TrimPrefix(req.Path, PQActionHistoryPath))
	if err != nil {
		fail(err)
		return true
	}
	response.Value, err = json.Marshal(v)
	if err != nil || len(response.Value) > MaxPQWalletQueryBytes {
		fail(errors.New("complete PQ action original exceeds bounded query response"))
	}
	return true
}
