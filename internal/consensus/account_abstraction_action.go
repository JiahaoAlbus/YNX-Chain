package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/assetauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

const UserOperationFeeYNXT = uint64(1)

type SmartAccountCreatePayload struct {
	OwnerAlgorithm string                           `json:"ownerAlgorithm"`
	OwnerPublicKey []byte                           `json:"ownerPublicKey"`
	SessionKeys    []assetauth.SessionKey           `json:"sessionKeys"`
	Recovery       assetauth.GuardianRecoveryPolicy `json:"recovery"`
}

type PaymasterCreatePayload struct {
	ID                  string    `json:"id"`
	Products            []string  `json:"products"`
	Scopes              []string  `json:"scopes"`
	PerAccountBudget    uint64    `json:"perAccountBudgetYnxt"`
	GlobalBudget        uint64    `json:"globalBudgetYnxt"`
	RequiresAttestation bool      `json:"requiresAttestation"`
	ExpiresAt           time.Time `json:"expiresAt"`
}

type UserOperationExecutePayload struct {
	Operation       assetauth.UserOperation `json:"operation"`
	AttestationHash string                  `json:"attestationHash,omitempty"`
}

type BFTPaymaster struct {
	Policy      assetauth.PaymasterPolicy `json:"policy"`
	Lots        map[string]uint64         `json:"lots"`
	CreatedAt   time.Time                 `json:"createdAt"`
	BlockHeight int64                     `json:"blockHeight"`
	TxHash      string                    `json:"txHash"`
	AuditHash   string                    `json:"auditHash"`
}

type BFTUserOperationEvent struct {
	ID              string    `json:"id"`
	OperationHash   string    `json:"operationHash"`
	Account         string    `json:"account"`
	Bundler         string    `json:"bundler"`
	FeePayer        string    `json:"feePayer"`
	PaymasterID     string    `json:"paymasterId,omitempty"`
	CallCount       int       `json:"callCount"`
	ValueYNXT       uint64    `json:"valueYnxt"`
	FeeYNXT         uint64    `json:"feeYnxt"`
	BlockHeight     int64     `json:"blockHeight"`
	ExecutedAt      time.Time `json:"executedAt"`
	TransactionHash string    `json:"transactionHash"`
	AuditHash       string    `json:"auditHash"`
}

func isAccountAbstractionAction(action string) bool {
	return action == ActionSmartAccountCreate || action == ActionPaymasterCreate || action == ActionUserOperationExecute
}

func isZeroFeeApplicationAction(action string) bool {
	return isResourceSponsorAction(action) || action == ActionUserOperationExecute
}

func canonicalAccountAbstractionPayload(action string, raw []byte) ([]byte, error) {
	switch action {
	case ActionSmartAccountCreate:
		var input SmartAccountCreatePayload
		if err := decodeCanonicalPayload(raw, &input); err != nil {
			return nil, err
		}
		input.OwnerAlgorithm = strings.ToLower(strings.TrimSpace(input.OwnerAlgorithm))
		sort.Slice(input.SessionKeys, func(i, j int) bool { return input.SessionKeys[i].ID < input.SessionKeys[j].ID })
		sessions := make(map[string]assetauth.SessionKey, len(input.SessionKeys))
		for index := range input.SessionKeys {
			session := input.SessionKeys[index]
			session.ID = strings.TrimSpace(session.ID)
			session.Algorithm = strings.ToLower(strings.TrimSpace(session.Algorithm))
			session.NonceDomain = strings.TrimSpace(session.NonceDomain)
			session.Scopes = normalizedActionSet(session.Scopes)
			input.SessionKeys[index] = session
			if _, exists := sessions[session.ID]; exists {
				return nil, errors.New("smart account session IDs must be unique")
			}
			sessions[session.ID] = session
		}
		candidate := assetauth.SmartAccount{SchemaVersion: 1, ChainID: assetauth.MandateChainID, Address: "validation-account", OwnerAlgorithm: input.OwnerAlgorithm, OwnerPublicKey: input.OwnerPublicKey, NonceByDomain: map[string]uint64{}, SessionKeys: sessions, Recovery: input.Recovery, CreatedAt: time.Unix(1, 0).UTC()}
		if err := candidate.Validate(); err != nil {
			return nil, err
		}
		return json.Marshal(input)
	case ActionPaymasterCreate:
		var input PaymasterCreatePayload
		if err := decodeCanonicalPayload(raw, &input); err != nil {
			return nil, err
		}
		input.ID = strings.TrimSpace(input.ID)
		input.Products = normalizedActionSet(input.Products)
		input.Scopes = normalizedActionSet(input.Scopes)
		if !quantRecordIDPatternForConsensus(input.ID) || len(input.Products) == 0 || len(input.Scopes) == 0 || input.PerAccountBudget == 0 || input.GlobalBudget == 0 || input.PerAccountBudget > input.GlobalBudget || input.GlobalBudget > math.MaxInt64 || input.ExpiresAt.IsZero() {
			return nil, errors.New("paymaster policy is invalid")
		}
		for _, scope := range input.Scopes {
			if scope == "*" || strings.Contains(scope, "**") || !strings.Contains(scope, ":") {
				return nil, errors.New("paymaster wildcard or malformed scope is forbidden")
			}
		}
		return json.Marshal(input)
	case ActionUserOperationExecute:
		var input UserOperationExecutePayload
		if err := decodeCanonicalPayload(raw, &input); err != nil {
			return nil, err
		}
		if !IsNativeAddress(input.Operation.Account) || len(input.Operation.Calls) > 64 || len(input.Operation.Signature) == 0 || input.Operation.MaxFeeYNXT < UserOperationFeeYNXT {
			return nil, errors.New("user operation envelope is invalid")
		}
		if _, err := input.Operation.SigningBytes(); err != nil {
			return nil, err
		}
		input.AttestationHash = strings.ToLower(strings.TrimSpace(input.AttestationHash))
		if input.AttestationHash != "" && !payHashPattern.MatchString(input.AttestationHash) {
			return nil, errors.New("user operation attestation hash is invalid")
		}
		return json.Marshal(input)
	default:
		return nil, fmt.Errorf("unsupported account abstraction action %q", action)
	}
}

func (a *Application) applyAccountAbstractionAction(state executionState, raw []byte, tx SignedApplicationAction, height int64, blockTime time.Time, validationOnly bool) (executionState, transactionExecution, error) {
	if err := a.chargeApplicationAction(&state, tx); err != nil {
		return executionState{}, transactionExecution{}, err
	}
	txHash := ApplicationActionHash(raw)
	recordID := ""
	switch tx.Action {
	case ActionSmartAccountCreate:
		var input SmartAccountCreatePayload
		_ = json.Unmarshal(tx.Payload, &input)
		if _, exists := smartAccountIndex(state.smartAccounts, tx.Signer); exists {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("smart account already exists"))
		}
		sessions := make(map[string]assetauth.SessionKey, len(input.SessionKeys))
		for _, session := range input.SessionKeys {
			sessions[session.ID] = session
		}
		account := assetauth.SmartAccount{SchemaVersion: 1, ChainID: assetauth.MandateChainID, Address: tx.Signer, OwnerAlgorithm: input.OwnerAlgorithm, OwnerPublicKey: append([]byte(nil), input.OwnerPublicKey...), NonceByDomain: map[string]uint64{}, SessionKeys: sessions, Recovery: input.Recovery, CreatedAt: blockTime}
		if err := account.Validate(); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		state.smartAccounts = insertSmartAccount(state.smartAccounts, account)
		recordID = account.Address
	case ActionPaymasterCreate:
		var input PaymasterCreatePayload
		_ = json.Unmarshal(tx.Payload, &input)
		if !input.ExpiresAt.After(blockTime) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("paymaster policy expiry must follow creation"))
		}
		if _, exists := paymasterIndex(state.paymasters, input.ID); exists {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("paymaster policy already exists"))
		}
		sponsorIndex, _ := accountIndex(state.accounts, tx.Signer)
		budget := int64(input.GlobalBudget)
		if state.accounts[sponsorIndex].Balance < budget {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("insufficient YNXT for paymaster budget after fee"))
		}
		paymaster := BFTPaymaster{Policy: assetauth.PaymasterPolicy{ID: input.ID, Sponsor: tx.Signer, Products: input.Products, Scopes: input.Scopes, PerAccountBudget: input.PerAccountBudget, GlobalBudget: input.GlobalBudget, AccountSpent: map[string]uint64{}, RequiresAttestation: input.RequiresAttestation, ExpiresAt: input.ExpiresAt}, Lots: map[string]uint64{}, CreatedAt: blockTime, BlockHeight: height, TxHash: txHash}
		if err := moveLotsIntoPaymaster(&state.accounts[sponsorIndex], &paymaster, budget); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, err)
		}
		state.accounts[sponsorIndex].Balance -= budget
		paymaster.AuditHash = paymasterAuditHash(paymaster)
		state.paymasters = insertPaymaster(state.paymasters, paymaster)
		recordID = input.ID
	case ActionUserOperationExecute:
		var input UserOperationExecutePayload
		_ = json.Unmarshal(tx.Payload, &input)
		accountIndexInState, exists := smartAccountIndex(state.smartAccounts, input.Operation.Account)
		if !exists {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("smart account not found"))
		}
		authorizationTime := blockTime
		if validationOnly {
			authorizationTime = input.Operation.ValidAfter
		}
		updated, err := state.smartAccounts[accountIndexInState].AuthorizeUserOperation(input.Operation, authorizationTime)
		if err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		var total uint64
		for _, call := range input.Operation.Calls {
			if !IsNativeAddress(call.Target) || strings.ToLower(strings.TrimSpace(call.Method)) != "transfer" || (call.Asset != "" && strings.ToLower(strings.TrimSpace(call.Asset)) != "ynxt") || call.ValueYNXT == 0 || call.ValueYNXT > math.MaxInt64 || total > math.MaxUint64-call.ValueYNXT {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("user operation contains an unsupported call"))
			}
			total += call.ValueYNXT
		}
		if total > math.MaxInt64 {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("user operation value exceeds execution range"))
		}
		chainAccountIndex, exists := accountIndex(state.accounts, input.Operation.Account)
		if !exists {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("smart account has no chain balance"))
		}
		feePayer := input.Operation.Account
		if input.Operation.PaymasterPolicy == "" {
			if total > math.MaxInt64-UserOperationFeeYNXT {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("smart account calls and fee exceed execution range"))
			}
			if state.accounts[chainAccountIndex].Balance < int64(total+UserOperationFeeYNXT) {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("smart account balance cannot cover calls and fee"))
			}
		} else {
			if state.accounts[chainAccountIndex].Balance < int64(total) {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("smart account balance cannot cover calls"))
			}
			paymasterStateIndex, exists := paymasterIndex(state.paymasters, input.Operation.PaymasterPolicy)
			if !exists {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("paymaster policy not found"))
			}
			paymaster := state.paymasters[paymasterStateIndex]
			policy, err := paymaster.Policy.SponsorOperation(input.Operation, UserOperationFeeYNXT, input.AttestationHash, authorizationTime)
			if err != nil {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
			}
			state.accounts, _ = ensureAccount(state.accounts, a.feeRecipient)
			feeIndex, _ := accountIndex(state.accounts, a.feeRecipient)
			if err := movePaymasterLotsToAccount(&paymaster, &state.accounts[feeIndex], UserOperationFeeYNXT); err != nil {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, err)
			}
			state.accounts[feeIndex].Balance += int64(UserOperationFeeYNXT)
			paymaster.Policy = policy
			paymaster.BlockHeight = height
			paymaster.TxHash = txHash
			paymaster.AuditHash = paymasterAuditHash(paymaster)
			state.paymasters[paymasterStateIndex] = paymaster
			feePayer = paymaster.Policy.Sponsor
		}
		for _, call := range input.Operation.Calls {
			state.accounts, _ = ensureAccount(state.accounts, call.Target)
			chainAccountIndex, _ = accountIndex(state.accounts, input.Operation.Account)
			recipientIndex, _ := accountIndex(state.accounts, call.Target)
			amount := int64(call.ValueYNXT)
			if err := moveTraceableLots(&state.accounts[chainAccountIndex], &state.accounts[recipientIndex], amount); err != nil {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, err)
			}
			state.accounts[chainAccountIndex].Balance -= amount
			state.accounts[recipientIndex].Balance += amount
		}
		if input.Operation.PaymasterPolicy == "" {
			state.accounts, _ = ensureAccount(state.accounts, a.feeRecipient)
			chainAccountIndex, _ = accountIndex(state.accounts, input.Operation.Account)
			feeIndex, _ := accountIndex(state.accounts, a.feeRecipient)
			if err := moveTraceableLots(&state.accounts[chainAccountIndex], &state.accounts[feeIndex], int64(UserOperationFeeYNXT)); err != nil {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, err)
			}
			state.accounts[chainAccountIndex].Balance -= int64(UserOperationFeeYNXT)
			state.accounts[feeIndex].Balance += int64(UserOperationFeeYNXT)
		}
		state.smartAccounts[accountIndexInState] = updated
		operationHash := UserOperationHash(input.Operation)
		event := BFTUserOperationEvent{ID: ApplicationActionRecordID("user-operation", txHash), OperationHash: operationHash, Account: input.Operation.Account, Bundler: tx.Signer, FeePayer: feePayer, PaymasterID: input.Operation.PaymasterPolicy, CallCount: len(input.Operation.Calls), ValueYNXT: total, FeeYNXT: UserOperationFeeYNXT, BlockHeight: height, ExecutedAt: blockTime, TransactionHash: txHash}
		event.AuditHash = userOperationAuditHash(event)
		state.userOperationEvents = append(state.userOperationEvents, event)
		state.feeEvents = append(state.feeEvents, newCurrentFeeEvent(txHash, "user_operation", feePayer, a.feeRecipient, int64(UserOperationFeeYNXT), height, blockTime))
		recordID = event.ID
	default:
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("unsupported account abstraction action"))
	}
	return state, transactionExecution{typeName: tx.Type, event: abcitypes.Event{Type: "ynx.account_abstraction", Attributes: []abcitypes.EventAttribute{{Key: "action", Value: tx.Action, Index: true}, {Key: "bundler", Value: tx.Signer, Index: true}, {Key: "record_id", Value: recordID, Index: true}}}}, nil
}

func UserOperationHash(operation assetauth.UserOperation) string {
	payload, _ := json.Marshal(operation)
	sum := sha256.Sum256(append([]byte("YNX_USER_OPERATION_HASH_V1\x00"), payload...))
	return hex.EncodeToString(sum[:])
}

func smartAccountIndex(values []assetauth.SmartAccount, address string) (int, bool) {
	index := sort.Search(len(values), func(i int) bool { return values[i].Address >= address })
	return index, index < len(values) && values[index].Address == address
}

func insertSmartAccount(values []assetauth.SmartAccount, value assetauth.SmartAccount) []assetauth.SmartAccount {
	index, _ := smartAccountIndex(values, value.Address)
	values = append(values, assetauth.SmartAccount{})
	copy(values[index+1:], values[index:])
	values[index] = value
	return values
}

func paymasterIndex(values []BFTPaymaster, id string) (int, bool) {
	index := sort.Search(len(values), func(i int) bool { return values[i].Policy.ID >= id })
	return index, index < len(values) && values[index].Policy.ID == id
}

func insertPaymaster(values []BFTPaymaster, value BFTPaymaster) []BFTPaymaster {
	index, _ := paymasterIndex(values, value.Policy.ID)
	values = append(values, BFTPaymaster{})
	copy(values[index+1:], values[index:])
	values[index] = value
	return values
}

func cloneSmartAccounts(values []assetauth.SmartAccount) []assetauth.SmartAccount {
	clones := make([]assetauth.SmartAccount, len(values))
	for index, value := range values {
		raw, _ := json.Marshal(value)
		_ = json.Unmarshal(raw, &clones[index])
	}
	return clones
}

func clonePaymasters(values []BFTPaymaster) []BFTPaymaster {
	clones := make([]BFTPaymaster, len(values))
	for index, value := range values {
		raw, _ := json.Marshal(value)
		_ = json.Unmarshal(raw, &clones[index])
	}
	return clones
}

func moveLotsIntoPaymaster(sender *chain.ConsensusAccount, paymaster *BFTPaymaster, amount int64) error {
	if paymaster.Lots == nil {
		paymaster.Lots = map[string]uint64{}
	}
	remaining := amount
	lotIDs := sortedAccountLotIDs(sender.Lots)
	for _, lotID := range lotIDs {
		if remaining == 0 {
			break
		}
		moved := sender.Lots[lotID]
		if moved > remaining {
			moved = remaining
		}
		sender.Lots[lotID] -= moved
		paymaster.Lots[lotID] += uint64(moved)
		remaining -= moved
	}
	if remaining != 0 {
		return errors.New("account traceable lots do not cover paymaster budget")
	}
	return nil
}

func movePaymasterLotsToAccount(paymaster *BFTPaymaster, receiver *chain.ConsensusAccount, amount uint64) error {
	if receiver.Lots == nil {
		receiver.Lots = map[string]int64{}
	}
	remaining := amount
	lotIDs := make([]string, 0, len(paymaster.Lots))
	for lotID := range paymaster.Lots {
		lotIDs = append(lotIDs, lotID)
	}
	sort.Strings(lotIDs)
	for _, lotID := range lotIDs {
		if remaining == 0 {
			break
		}
		moved := paymaster.Lots[lotID]
		if moved > remaining {
			moved = remaining
		}
		paymaster.Lots[lotID] -= moved
		receiver.Lots[lotID] += int64(moved)
		remaining -= moved
	}
	if remaining != 0 {
		return errors.New("paymaster traceable lots do not cover sponsored fee")
	}
	return nil
}

func sortedAccountLotIDs(lots map[string]int64) []string {
	ids := make([]string, 0, len(lots))
	for id := range lots {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func quantRecordIDPatternForConsensus(id string) bool {
	if id == "" || len(id) > 128 {
		return false
	}
	for index, value := range id {
		if (value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z') || (value >= '0' && value <= '9') || (index > 0 && strings.ContainsRune("._:-", value)) {
			continue
		}
		return false
	}
	return true
}

func paymasterAuditHash(value BFTPaymaster) string {
	value.AuditHash = ""
	return recordAuditHash("YNX_PAYMASTER_V1", value)
}

func userOperationAuditHash(value BFTUserOperationEvent) string {
	value.AuditHash = ""
	return recordAuditHash("YNX_USER_OPERATION_EVENT_V1", value)
}

func validateAccountAbstractionState(accounts []assetauth.SmartAccount, paymasters []BFTPaymaster, events []BFTUserOperationEvent, feeEvents []BFTFeeEvent) (uint64, error) {
	previous := ""
	for _, account := range accounts {
		if !IsNativeAddress(account.Address) || (previous != "" && account.Address <= previous) || account.ChainID != assetauth.MandateChainID {
			return 0, errors.New("smart accounts must be canonical and sorted")
		}
		if err := account.Validate(); err != nil {
			return 0, err
		}
		previous = account.Address
	}
	previous = ""
	var locked uint64
	for _, paymaster := range paymasters {
		policy := paymaster.Policy
		if !quantRecordIDPatternForConsensus(policy.ID) || (previous != "" && policy.ID <= previous) || !IsNativeAddress(policy.Sponsor) || len(policy.Products) == 0 || len(policy.Scopes) == 0 || !normalizedSetEqual(policy.Products) || !normalizedSetEqual(policy.Scopes) || policy.PerAccountBudget == 0 || policy.GlobalBudget == 0 || policy.PerAccountBudget > policy.GlobalBudget || policy.GlobalSpent > policy.GlobalBudget || policy.AccountSpent == nil || paymaster.CreatedAt.IsZero() || !policy.ExpiresAt.After(paymaster.CreatedAt) || paymaster.BlockHeight <= 0 || paymaster.TxHash == "" || paymaster.AuditHash != paymasterAuditHash(paymaster) {
			return 0, errors.New("paymaster state is invalid")
		}
		for _, scope := range policy.Scopes {
			if scope == "*" || strings.Contains(scope, "**") || !strings.Contains(scope, ":") {
				return 0, errors.New("paymaster scope state is invalid")
			}
		}
		var accountSpent uint64
		for account, amount := range policy.AccountSpent {
			if !IsNativeAddress(account) || amount > policy.PerAccountBudget || accountSpent > math.MaxUint64-amount {
				return 0, errors.New("paymaster account budget state is invalid")
			}
			accountSpent += amount
		}
		if accountSpent != policy.GlobalSpent {
			return 0, errors.New("paymaster account and global spend do not reconcile")
		}
		remaining := policy.GlobalBudget - policy.GlobalSpent
		var lotTotal uint64
		for lotID, amount := range paymaster.Lots {
			if strings.TrimSpace(lotID) == "" || lotTotal > math.MaxUint64-amount {
				return 0, errors.New("paymaster lot state is invalid")
			}
			lotTotal += amount
		}
		if lotTotal != remaining || locked > math.MaxUint64-remaining {
			return 0, errors.New("paymaster budget and lots do not reconcile")
		}
		locked += remaining
		previous = policy.ID
	}
	seen := map[string]struct{}{}
	seenOperations := map[string]struct{}{}
	paymasterGlobalSpent := map[string]uint64{}
	paymasterAccountSpent := map[string]map[string]uint64{}
	for _, event := range events {
		if event.ID != ApplicationActionRecordID("user-operation", event.TransactionHash) || len(event.OperationHash) != 64 || !IsNativeAddress(event.Account) || !IsNativeAddress(event.Bundler) || !IsNativeAddress(event.FeePayer) || event.CallCount < 1 || event.ValueYNXT == 0 || event.FeeYNXT != UserOperationFeeYNXT || event.BlockHeight <= 0 || event.ExecutedAt.IsZero() || event.TransactionHash == "" || event.AuditHash != userOperationAuditHash(event) {
			return 0, errors.New("user operation event is invalid")
		}
		if _, err := hex.DecodeString(event.OperationHash); err != nil {
			return 0, errors.New("user operation hash is invalid")
		}
		if _, exists := smartAccountIndex(accounts, event.Account); !exists {
			return 0, errors.New("user operation references a missing smart account")
		}
		if _, duplicate := seen[event.ID]; duplicate {
			return 0, errors.New("user operation event IDs must be unique")
		}
		if _, duplicate := seenOperations[event.OperationHash]; duplicate {
			return 0, errors.New("user operation hashes must be unique")
		}
		seen[event.ID] = struct{}{}
		seenOperations[event.OperationHash] = struct{}{}
		if event.PaymasterID == "" {
			if event.FeePayer != event.Account {
				return 0, errors.New("unsponsored user operation fee payer is invalid")
			}
		} else {
			index, exists := paymasterIndex(paymasters, event.PaymasterID)
			if !exists || event.FeePayer != paymasters[index].Policy.Sponsor {
				return 0, errors.New("sponsored user operation paymaster evidence is invalid")
			}
			if paymasterGlobalSpent[event.PaymasterID] > math.MaxUint64-event.FeeYNXT {
				return 0, errors.New("paymaster derived global spend overflows")
			}
			paymasterGlobalSpent[event.PaymasterID] += event.FeeYNXT
			if paymasterAccountSpent[event.PaymasterID] == nil {
				paymasterAccountSpent[event.PaymasterID] = map[string]uint64{}
			}
			if paymasterAccountSpent[event.PaymasterID][event.Account] > math.MaxUint64-event.FeeYNXT {
				return 0, errors.New("paymaster derived account spend overflows")
			}
			paymasterAccountSpent[event.PaymasterID][event.Account] += event.FeeYNXT
		}
		feeMatched := false
		for _, fee := range feeEvents {
			if fee.TxHash == event.TransactionHash && fee.TransactionType == "user_operation" && fee.Payer == event.FeePayer && fee.GrossFeeYNXT == int64(event.FeeYNXT) && fee.BlockHeight == event.BlockHeight && fee.RecordedAt.Equal(event.ExecutedAt) {
				feeMatched = true
				break
			}
		}
		if !feeMatched {
			return 0, errors.New("user operation fee event is missing or inconsistent")
		}
	}
	for _, paymaster := range paymasters {
		if paymasterGlobalSpent[paymaster.Policy.ID] != paymaster.Policy.GlobalSpent {
			return 0, errors.New("paymaster sponsored events do not reconcile to global spend")
		}
		derived := paymasterAccountSpent[paymaster.Policy.ID]
		if len(derived) != len(paymaster.Policy.AccountSpent) {
			return 0, errors.New("paymaster sponsored events do not reconcile to account spend")
		}
		for account, amount := range paymaster.Policy.AccountSpent {
			if derived[account] != amount {
				return 0, errors.New("paymaster sponsored events do not reconcile to account spend")
			}
		}
	}
	return locked, nil
}

func normalizedSetEqual(values []string) bool {
	normalized := normalizedActionSet(values)
	if len(normalized) != len(values) {
		return false
	}
	for index := range values {
		if values[index] != normalized[index] {
			return false
		}
	}
	return true
}
