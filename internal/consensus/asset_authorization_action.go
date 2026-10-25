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

type StrategyMandateCreatePayload struct {
	ID                 string    `json:"id"`
	EngineIdentity     string    `json:"engineIdentity"`
	StrategyHash       string    `json:"strategyHash"`
	StrategyVersion    uint64    `json:"strategyVersion"`
	Venues             []string  `json:"venues"`
	Assets             []string  `json:"assets"`
	Markets            []string  `json:"markets"`
	Methods            []string  `json:"methods"`
	CapitalLimitYNXT   uint64    `json:"capitalLimitYnxt"`
	PositionLimitYNXT  uint64    `json:"positionLimitYnxt"`
	MaxLeverageBPS     uint64    `json:"maxLeverageBps"`
	MaxSlippageBPS     uint64    `json:"maxSlippageBps"`
	DailyLossLimitYNXT uint64    `json:"dailyLossLimitYnxt"`
	DrawdownLimitBPS   uint64    `json:"drawdownLimitBps"`
	ValidAfter         time.Time `json:"validAfter"`
	ExpiresAt          time.Time `json:"expiresAt"`
	NonceDomain        string    `json:"nonceDomain"`
}

type StrategyMandateControlPayload struct {
	MandateID string `json:"mandateId"`
}

type StrategyVaultCreatePayload struct {
	VaultID   string `json:"vaultId"`
	MandateID string `json:"mandateId"`
}

type StrategyVaultAmountPayload struct {
	VaultID    string `json:"vaultId"`
	AmountYNXT int64  `json:"amountYnxt"`
}

type BFTAssetAuditEvent struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	RecordID    string    `json:"recordId"`
	Signer      string    `json:"signer"`
	BlockHeight int64     `json:"blockHeight"`
	OccurredAt  time.Time `json:"occurredAt"`
	TxHash      string    `json:"txHash"`
	AuditHash   string    `json:"auditHash"`
}

func isAssetAuthorizationAction(action string) bool {
	switch action {
	case ActionStrategyMandateCreate, ActionStrategyMandateRevoke, ActionStrategyMandateKill,
		ActionStrategyVaultCreate, ActionStrategyVaultDeposit, ActionStrategyVaultWithdraw, ActionStrategyVaultExit:
		return true
	default:
		return false
	}
}

func canonicalAssetAuthorizationPayload(action string, raw []byte) ([]byte, error) {
	switch action {
	case ActionStrategyMandateCreate:
		var input StrategyMandateCreatePayload
		if err := decodeCanonicalPayload(raw, &input); err != nil {
			return nil, err
		}
		input.ID = strings.TrimSpace(input.ID)
		input.EngineIdentity = strings.TrimSpace(input.EngineIdentity)
		input.StrategyHash = strings.ToLower(strings.TrimSpace(input.StrategyHash))
		input.NonceDomain = strings.TrimSpace(input.NonceDomain)
		input.Venues = normalizedActionSet(input.Venues)
		input.Assets = normalizedActionSet(input.Assets)
		input.Markets = normalizedActionSet(input.Markets)
		input.Methods = normalizedActionSet(input.Methods)
		if _, err := mandateFromPayload(input, "validation-owner", input.ValidAfter); err != nil {
			return nil, err
		}
		return json.Marshal(input)
	case ActionStrategyMandateRevoke, ActionStrategyMandateKill:
		var input StrategyMandateControlPayload
		if err := decodeCanonicalPayload(raw, &input); err != nil {
			return nil, err
		}
		input.MandateID = strings.TrimSpace(input.MandateID)
		if input.MandateID == "" || len(input.MandateID) > 256 {
			return nil, errors.New("strategy mandate control payload is invalid")
		}
		return json.Marshal(input)
	case ActionStrategyVaultCreate:
		var input StrategyVaultCreatePayload
		if err := decodeCanonicalPayload(raw, &input); err != nil {
			return nil, err
		}
		input.VaultID, input.MandateID = strings.TrimSpace(input.VaultID), strings.TrimSpace(input.MandateID)
		if input.VaultID == "" || input.MandateID == "" || len(input.VaultID) > 256 || len(input.MandateID) > 256 {
			return nil, errors.New("strategy vault creation payload is invalid")
		}
		return json.Marshal(input)
	case ActionStrategyVaultDeposit, ActionStrategyVaultWithdraw:
		var input StrategyVaultAmountPayload
		if err := decodeCanonicalPayload(raw, &input); err != nil {
			return nil, err
		}
		input.VaultID = strings.TrimSpace(input.VaultID)
		if input.VaultID == "" || len(input.VaultID) > 256 || input.AmountYNXT <= 0 {
			return nil, errors.New("strategy vault amount payload is invalid")
		}
		return json.Marshal(input)
	case ActionStrategyVaultExit:
		var input StrategyVaultAmountPayload
		if err := decodeCanonicalPayload(raw, &input); err != nil {
			return nil, err
		}
		input.VaultID = strings.TrimSpace(input.VaultID)
		if input.VaultID == "" || len(input.VaultID) > 256 || input.AmountYNXT != 0 {
			return nil, errors.New("strategy vault emergency-exit payload is invalid")
		}
		return json.Marshal(input)
	default:
		return nil, fmt.Errorf("unsupported asset authorization action %q", action)
	}
}

func mandateFromPayload(input StrategyMandateCreatePayload, owner string, createdAt time.Time) (assetauth.StrategyMandate, error) {
	return assetauth.NewStrategyMandate(assetauth.StrategyMandate{
		ID: input.ID, Owner: owner, EngineIdentity: input.EngineIdentity, StrategyHash: input.StrategyHash,
		StrategyVersion: input.StrategyVersion, Venues: input.Venues, Assets: input.Assets, Markets: input.Markets,
		Methods: input.Methods, CapitalLimitYNXT: input.CapitalLimitYNXT, PositionLimitYNXT: input.PositionLimitYNXT,
		MaxLeverageBPS: input.MaxLeverageBPS, MaxSlippageBPS: input.MaxSlippageBPS,
		DailyLossLimitYNXT: input.DailyLossLimitYNXT, DrawdownLimitBPS: input.DrawdownLimitBPS,
		ValidAfter: input.ValidAfter.UTC(), ExpiresAt: input.ExpiresAt.UTC(), NonceDomain: input.NonceDomain,
		NextNonce: 1, CreatedAt: createdAt.UTC(),
	})
}

func (a *Application) applyAssetAuthorizationAction(state executionState, payload []byte, tx SignedApplicationAction, height int64, blockTime time.Time, validationOnly bool) (executionState, transactionExecution, error) {
	if err := a.chargeApplicationAction(&state, tx); err != nil {
		return executionState{}, transactionExecution{}, err
	}
	txHash := ApplicationActionHash(payload)
	recordID := ""
	switch tx.Action {
	case ActionStrategyMandateCreate:
		var input StrategyMandateCreatePayload
		_ = json.Unmarshal(tx.Payload, &input)
		if _, exists := strategyMandateIndex(state.strategyMandates, input.ID); exists {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("strategy mandate already exists"))
		}
		mandate, err := mandateFromPayload(input, tx.Signer, blockTime)
		if err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		state.strategyMandates = insertStrategyMandate(state.strategyMandates, mandate)
		recordID = mandate.ID
	case ActionStrategyMandateRevoke, ActionStrategyMandateKill:
		var input StrategyMandateControlPayload
		_ = json.Unmarshal(tx.Payload, &input)
		index, exists := strategyMandateIndex(state.strategyMandates, input.MandateID)
		if !exists {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("strategy mandate not found"))
		}
		mandate := state.strategyMandates[index]
		controlTime := blockTime
		if validationOnly && controlTime.Before(mandate.CreatedAt) {
			// CheckTx has no deterministic proposal time. Clamp validation-only
			// owner controls to creation time so mempool admission never rejects a
			// valid revoke/kill solely because the synthetic timestamp predates the
			// committed record. FinalizeBlock still enforces the real block time.
			controlTime = mandate.CreatedAt
		}
		var err error
		if tx.Action == ActionStrategyMandateRevoke {
			mandate, err = mandate.Revoke(tx.Signer, controlTime)
		} else {
			mandate, err = mandate.Kill(tx.Signer, controlTime)
		}
		if err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		state.strategyMandates[index] = mandate
		recordID = mandate.ID
	case ActionStrategyVaultCreate:
		var input StrategyVaultCreatePayload
		_ = json.Unmarshal(tx.Payload, &input)
		if _, exists := strategyVaultIndex(state.strategyVaults, input.VaultID); exists {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("strategy vault already exists"))
		}
		mandateIndex, exists := strategyMandateIndex(state.strategyMandates, input.MandateID)
		if !exists || state.strategyMandates[mandateIndex].Owner != tx.Signer {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("strategy vault requires its mandate owner"))
		}
		if !mandateAllowsVaultFunding(state.strategyMandates[mandateIndex], blockTime) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("strategy vault cannot be created for a revoked, killed, or expired mandate"))
		}
		vault, err := assetauth.NewStrategyVault(input.VaultID, tx.Signer, input.MandateID, blockTime)
		if err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		state.strategyVaults = insertStrategyVault(state.strategyVaults, vault)
		recordID = vault.ID
	case ActionStrategyVaultDeposit:
		var input StrategyVaultAmountPayload
		_ = json.Unmarshal(tx.Payload, &input)
		index, exists := strategyVaultIndex(state.strategyVaults, input.VaultID)
		if !exists {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("strategy vault not found"))
		}
		signerIndex, exists := accountIndex(state.accounts, tx.Signer)
		if !exists || state.accounts[signerIndex].Balance < input.AmountYNXT {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("insufficient YNXT for strategy vault deposit"))
		}
		vault := state.strategyVaults[index]
		if vault.ClosedAt != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("strategy vault is closed"))
		}
		mandateIndex, mandateExists := strategyMandateIndex(state.strategyMandates, vault.MandateID)
		if !mandateExists || !mandateAllowsVaultFunding(state.strategyMandates[mandateIndex], blockTime) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("strategy vault funding is disabled by mandate state"))
		}
		if uint64(input.AmountYNXT) > math.MaxUint64-vault.BalanceYNXT {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("strategy vault balance overflow"))
		}
		if err := moveLotsIntoVault(&state.accounts[signerIndex], &vault, input.AmountYNXT); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, err)
		}
		state.accounts[signerIndex].Balance -= input.AmountYNXT
		vault.BalanceYNXT += uint64(input.AmountYNXT)
		state.strategyVaults[index] = vault
		recordID = vault.ID
	case ActionStrategyVaultWithdraw, ActionStrategyVaultExit:
		var input StrategyVaultAmountPayload
		_ = json.Unmarshal(tx.Payload, &input)
		index, exists := strategyVaultIndex(state.strategyVaults, input.VaultID)
		if !exists {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("strategy vault not found"))
		}
		vault := state.strategyVaults[index]
		if vault.Owner != tx.Signer {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("only the strategy vault owner can withdraw"))
		}
		amount := input.AmountYNXT
		if tx.Action == ActionStrategyVaultExit {
			if vault.BalanceYNXT > math.MaxInt64 {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("strategy vault balance exceeds execution range"))
			}
			amount = int64(vault.BalanceYNXT)
		}
		if amount <= 0 || uint64(amount) > vault.BalanceYNXT {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("strategy vault withdrawal exceeds balance"))
		}
		ownerIndex, _ := accountIndex(state.accounts, tx.Signer)
		if state.accounts[ownerIndex].Balance > math.MaxInt64-amount {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("strategy vault owner balance overflow"))
		}
		moveLotsOutOfVault(&vault, &state.accounts[ownerIndex], amount)
		vault.BalanceYNXT -= uint64(amount)
		state.accounts[ownerIndex].Balance += amount
		if tx.Action == ActionStrategyVaultExit {
			closed := blockTime
			vault.ClosedAt = &closed
		}
		state.strategyVaults[index] = vault
		recordID = vault.ID
	default:
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("unsupported asset authorization action"))
	}
	event := newAssetAuditEvent(tx.Action, recordID, tx.Signer, height, blockTime, txHash)
	state.assetAuditEvents = append(state.assetAuditEvents, event)
	return state, transactionExecution{typeName: tx.Type, event: abcitypes.Event{Type: "ynx.asset_authorization", Attributes: []abcitypes.EventAttribute{{Key: "action", Value: tx.Action, Index: true}, {Key: "signer", Value: tx.Signer, Index: true}, {Key: "record_id", Value: recordID, Index: true}, {Key: "audit_id", Value: event.ID, Index: true}}}}, nil
}

func newAssetAuditEvent(kind, recordID, signer string, height int64, at time.Time, txHash string) BFTAssetAuditEvent {
	event := BFTAssetAuditEvent{ID: ApplicationActionRecordID("asset-audit", txHash), Type: kind, RecordID: recordID, Signer: signer, BlockHeight: height, OccurredAt: at.UTC(), TxHash: txHash}
	event.AuditHash = recordAuditHash("YNX_ASSET_AUDIT_V1", event)
	return event
}

func mandateAllowsVaultFunding(mandate assetauth.StrategyMandate, at time.Time) bool {
	return mandate.RevokedAt == nil && mandate.KillSwitchAt == nil && at.Before(mandate.ExpiresAt)
}

func strategyMandateIndex(values []assetauth.StrategyMandate, id string) (int, bool) {
	index := sort.Search(len(values), func(index int) bool { return values[index].ID >= id })
	return index, index < len(values) && values[index].ID == id
}

func strategyVaultIndex(values []assetauth.StrategyVault, id string) (int, bool) {
	index := sort.Search(len(values), func(index int) bool { return values[index].ID >= id })
	return index, index < len(values) && values[index].ID == id
}

func insertStrategyMandate(values []assetauth.StrategyMandate, value assetauth.StrategyMandate) []assetauth.StrategyMandate {
	index, _ := strategyMandateIndex(values, value.ID)
	values = append(values, assetauth.StrategyMandate{})
	copy(values[index+1:], values[index:])
	values[index] = value
	return values
}

func insertStrategyVault(values []assetauth.StrategyVault, value assetauth.StrategyVault) []assetauth.StrategyVault {
	index, _ := strategyVaultIndex(values, value.ID)
	values = append(values, assetauth.StrategyVault{})
	copy(values[index+1:], values[index:])
	values[index] = value
	return values
}

func cloneStrategyMandates(values []assetauth.StrategyMandate) []assetauth.StrategyMandate {
	clones := make([]assetauth.StrategyMandate, len(values))
	for index, value := range values {
		value.Venues = append([]string(nil), value.Venues...)
		value.Assets = append([]string(nil), value.Assets...)
		value.Markets = append([]string(nil), value.Markets...)
		value.Methods = append([]string(nil), value.Methods...)
		if value.RevokedAt != nil {
			copy := *value.RevokedAt
			value.RevokedAt = &copy
		}
		if value.KillSwitchAt != nil {
			copy := *value.KillSwitchAt
			value.KillSwitchAt = &copy
		}
		clones[index] = value
	}
	return clones
}

func cloneStrategyVaults(values []assetauth.StrategyVault) []assetauth.StrategyVault {
	clones := make([]assetauth.StrategyVault, len(values))
	for index, value := range values {
		lots := make(map[string]uint64, len(value.Lots))
		for id, amount := range value.Lots {
			lots[id] = amount
		}
		value.Lots = lots
		if value.ClosedAt != nil {
			copy := *value.ClosedAt
			value.ClosedAt = &copy
		}
		clones[index] = value
	}
	return clones
}

func normalizedActionSet(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if value != "" {
			result = append(result, value)
		}
	}
	sort.Strings(result)
	write := 0
	for _, value := range result {
		if write == 0 || value != result[write-1] {
			result[write] = value
			write++
		}
	}
	return result[:write]
}

func moveLotsIntoVault(sender *chain.ConsensusAccount, vault *assetauth.StrategyVault, amount int64) error {
	if vault.Lots == nil {
		vault.Lots = map[string]uint64{}
	}
	remaining := amount
	lotIDs := make([]string, 0, len(sender.Lots))
	for lotID := range sender.Lots {
		lotIDs = append(lotIDs, lotID)
	}
	sort.Strings(lotIDs)
	for _, lotID := range lotIDs {
		if remaining == 0 {
			break
		}
		available := sender.Lots[lotID]
		moved := available
		if moved > remaining {
			moved = remaining
		}
		sender.Lots[lotID] -= moved
		vault.Lots[lotID] += uint64(moved)
		remaining -= moved
	}
	if remaining != 0 {
		return errors.New("account traceable lots do not cover strategy vault deposit")
	}
	return nil
}

func moveLotsOutOfVault(vault *assetauth.StrategyVault, owner *chain.ConsensusAccount, amount int64) {
	if owner.Lots == nil {
		owner.Lots = map[string]int64{}
	}
	remaining := uint64(amount)
	lotIDs := make([]string, 0, len(vault.Lots))
	for lotID := range vault.Lots {
		lotIDs = append(lotIDs, lotID)
	}
	sort.Strings(lotIDs)
	for _, lotID := range lotIDs {
		if remaining == 0 {
			break
		}
		available := vault.Lots[lotID]
		moved := available
		if moved > remaining {
			moved = remaining
		}
		vault.Lots[lotID] -= moved
		owner.Lots[lotID] += int64(moved)
		remaining -= moved
	}
}

func validateAssetAuthorizationState(mandates []assetauth.StrategyMandate, vaults []assetauth.StrategyVault, events []BFTAssetAuditEvent) error {
	previous := ""
	for _, mandate := range mandates {
		if previous != "" && mandate.ID <= previous {
			return errors.New("strategy mandates must be sorted by unique ID")
		}
		if err := mandate.Validate(); err != nil {
			return fmt.Errorf("invalid strategy mandate %s: %w", mandate.ID, err)
		}
		previous = mandate.ID
	}
	previous = ""
	for _, vault := range vaults {
		if previous != "" && vault.ID <= previous {
			return errors.New("strategy vaults must be sorted by unique ID")
		}
		if err := vault.Validate(); err != nil {
			return fmt.Errorf("invalid strategy vault %s: %w", vault.ID, err)
		}
		var lots uint64
		for id, amount := range vault.Lots {
			if strings.TrimSpace(id) == "" || math.MaxUint64-lots < amount {
				return errors.New("strategy vault traceable lots are invalid")
			}
			lots += amount
		}
		if lots != vault.BalanceYNXT {
			return errors.New("strategy vault lots do not reconcile to balance")
		}
		if _, exists := strategyMandateIndex(mandates, vault.MandateID); !exists {
			return errors.New("strategy vault references a missing mandate")
		}
		previous = vault.ID
	}
	seen := map[string]struct{}{}
	for _, event := range events {
		expected := event
		expected.AuditHash = ""
		if event.ID == "" || !isAssetAuthorizationAction(event.Type) || event.RecordID == "" || !IsNativeAddress(event.Signer) || event.BlockHeight <= 0 || event.OccurredAt.IsZero() || event.TxHash == "" || event.AuditHash != recordAuditHash("YNX_ASSET_AUDIT_V1", expected) {
			return errors.New("asset authorization audit event is invalid")
		}
		if _, duplicate := seen[event.ID]; duplicate {
			return errors.New("asset authorization audit event IDs must be unique")
		}
		seen[event.ID] = struct{}{}
	}
	return nil
}

func assetAuthorizationStateHash(mandates []assetauth.StrategyMandate, vaults []assetauth.StrategyVault, events []BFTAssetAuditEvent) string {
	payload, _ := json.Marshal(struct {
		Mandates []assetauth.StrategyMandate `json:"mandates"`
		Vaults   []assetauth.StrategyVault   `json:"vaults"`
		Events   []BFTAssetAuditEvent        `json:"events"`
	}{mandates, vaults, events})
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}
