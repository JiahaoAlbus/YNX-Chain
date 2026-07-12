package consensus

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func (a *Application) applyTrustAction(state executionState, raw []byte, tx SignedApplicationAction, height int64, blockTime time.Time) (executionState, transactionExecution, error) {
	if err := a.chargeApplicationAction(&state, tx); err != nil {
		return executionState{}, transactionExecution{}, err
	}
	txHash, recordID := ApplicationActionHash(raw), ""
	var entry BFTTransparencyEntry
	switch tx.Action {
	case ActionGovernanceCreate:
		var input GovernanceRequestPayload
		_ = json.Unmarshal(tx.Payload, &input)
		if input.Requester != tx.Signer {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("governance requester must equal transaction signer"))
		}
		recordID = ApplicationActionRecordID("governance-request", txHash)
		if _, _, ok := findTrustRecord(state.governanceRequests, recordID, func(v BFTGovernanceRequest) string { return v.ID }); ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("governance request already exists"))
		}
		classification, reasons, notice, ruleIDs := chain.ClassifyGovernanceRequest(chain.GovernanceRequestInput{Requester: input.Requester, Subject: input.Subject, Action: input.Action, AssetType: input.AssetType, Scope: input.Scope, Description: input.Description, Evidence: input.Evidence})
		status := "pending_review"
		if rejectedTrustClassification(classification) {
			status = "rejected"
		} else if classification == chain.RequestRequiresUserNotice {
			status = "notice_required"
		}
		request := BFTGovernanceRequest{GovernanceRequest: chain.GovernanceRequest{ID: recordID, Requester: input.Requester, Subject: input.Subject, Action: input.Action, AssetType: strings.ToLower(input.AssetType), Scope: input.Scope, Description: input.Description, Evidence: append([]string(nil), input.Evidence...), Classification: classification, Status: status, Reasons: append([]string(nil), reasons...), RuleIDs: append([]string(nil), ruleIDs...), RequiresAppeal: true, RequiresUserNotice: notice, NativeYNXTProtected: nativeYNXTAsset(input.AssetType), CreatedAt: blockTime}, Signer: tx.Signer, BlockHeight: height, TxHash: txHash}
		entry = newBFTTransparency(tx, txHash, height, blockTime, "governance_request", request.ID, "", request.Subject, request.Action, request.Classification, request.Status, request.Reasons)
		request.TransparencyEntryID = entry.ID
		request.AuditHash = governanceAuditHash(request)
		state.governanceRequests = insertTrustRecord(state.governanceRequests, request, func(v BFTGovernanceRequest) string { return v.ID })
	case ActionGovernanceReview, ActionGovernanceReject:
		var input GovernanceDecisionPayload
		_ = json.Unmarshal(tx.Payload, &input)
		if input.Reviewer != tx.Signer {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("governance reviewer must equal transaction signer"))
		}
		index, request, ok := findTrustRecord(state.governanceRequests, input.RequestID, func(v BFTGovernanceRequest) string { return v.ID })
		if !ok || request.Status == "rejected" {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("governance request is missing or already rejected"))
		}
		recordID = request.ID
		request.Reviewer, request.BlockHeight, request.TxHash = tx.Signer, height, txHash
		if tx.Action == ActionGovernanceReview {
			if request.Status == "reviewed" {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("governance request is already reviewed"))
			}
			request.Classification, request.Status = chain.RequestRequiresReview, "reviewed"
			request.Reasons = appendUniqueStrings(request.Reasons, "request requires governance review before any action can occur")
			request.ReviewedAt = timePointer(blockTime)
			entry = newBFTTransparency(tx, txHash, height, blockTime, "governance_review", request.ID, "", request.Subject, request.Action, request.Classification, request.Status, request.Reasons)
		} else {
			request.Classification, request.Status = chain.RequestRejected, "rejected"
			request.Reasons = appendUniqueStrings(request.Reasons, "request rejected under YNX Chain Law", input.Reason)
			request.RejectedAt = timePointer(blockTime)
			entry = newBFTTransparency(tx, txHash, height, blockTime, "governance_rejection", request.ID, "", request.Subject, request.Action, request.Classification, request.Status, request.Reasons)
		}
		request.TransparencyEntryID, request.AuditHash = entry.ID, ""
		request.AuditHash = governanceAuditHash(request)
		state.governanceRequests[index] = request
	case ActionTrustAppealCreate:
		var input TrustAppealPayload
		_ = json.Unmarshal(tx.Payload, &input)
		if input.Appellant != tx.Signer || input.Claimant != tx.Signer {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("appeal appellant and claimant must equal transaction signer"))
		}
		_, request, ok := findTrustRecord(state.governanceRequests, input.RequestID, func(v BFTGovernanceRequest) string { return v.ID })
		if !ok || request.Subject != input.Subject {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("appeal governance request is missing or subject does not match"))
		}
		recordID = ApplicationActionRecordID("trust-appeal", txHash)
		appeal := BFTTrustAppeal{TrustAppeal: chain.TrustAppeal{ID: recordID, RequestID: input.RequestID, Subject: input.Subject, Appellant: input.Appellant, Claimant: input.Claimant, Reason: input.Reason, Evidence: append([]string(nil), input.Evidence...), Status: "SUBMITTED", CreatedAt: blockTime, UpdatedAt: blockTime}, Signer: tx.Signer, BlockHeight: height, TxHash: txHash}
		entry = newBFTTransparency(tx, txHash, height, blockTime, "trust_appeal", appeal.RequestID, appeal.ID, appeal.Subject, "appeal", chain.RequestRequiresReview, appeal.Status, []string{"appeal opened for human review and false-positive correction"})
		appeal.TransparencyEntryID, appeal.AuditHash = entry.ID, ""
		appeal.AuditHash = trustAppealAuditHash(appeal)
		state.trustAppeals = insertTrustRecord(state.trustAppeals, appeal, func(v BFTTrustAppeal) string { return v.ID })
	case ActionTrustAppealResolve:
		var input TrustAppealDecisionPayload
		_ = json.Unmarshal(tx.Payload, &input)
		if input.Reviewer != tx.Signer {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("appeal reviewer must equal transaction signer"))
		}
		index, appeal, ok := findTrustRecord(state.trustAppeals, input.AppealID, func(v BFTTrustAppeal) string { return v.ID })
		if !ok || terminalAppealDecision(appeal.Status) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Trust appeal is missing or already terminal"))
		}
		recordID = appeal.ID
		appeal.Status, appeal.Reviewer, appeal.Decision = input.Decision, input.Reviewer, input.Decision
		appeal.ResolutionReason, appeal.UpdatedAt = input.ResolutionReason, blockTime
		appeal.ReviewerSigner, appeal.BlockHeight, appeal.TxHash = tx.Signer, height, txHash
		entry = newBFTTransparency(tx, txHash, height, blockTime, "appeal_resolution", appeal.RequestID, appeal.ID, appeal.Subject, "appeal_resolution", chain.RequestRequiresReview, appeal.Status, []string{appeal.ResolutionReason})
		appeal.TransparencyEntryID, appeal.AuditHash = entry.ID, ""
		appeal.AuditHash = trustAppealAuditHash(appeal)
		state.trustAppeals[index] = appeal
		if correctionDecision(input.Decision) {
			correction := BFTTrustCorrection{ID: ApplicationActionRecordID("trust-correction", txHash), AppealID: appeal.ID, RequestID: appeal.RequestID, Subject: appeal.Subject, Decision: input.Decision, EvidenceHash: trustEvidenceHash(appeal.Evidence, input.ResolutionReason), AssetEffect: "none_advisory_only", AppealAvailable: true, Signer: tx.Signer, BlockHeight: height, TxHash: txHash, CreatedAt: blockTime}
			correction.AuditHash = trustCorrectionAuditHash(correction)
			state.trustCorrections = insertTrustRecord(state.trustCorrections, correction, func(v BFTTrustCorrection) string { return v.ID })
		}
	default:
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("unsupported Trust application action"))
	}
	state.transparency = append(state.transparency, entry)
	return state, transactionExecution{typeName: tx.Type, event: abcitypes.Event{Type: "ynx.trust_action", Attributes: []abcitypes.EventAttribute{{Key: "action", Value: tx.Action, Index: true}, {Key: "signer", Value: tx.Signer, Index: true}, {Key: "record_id", Value: recordID, Index: true}}}}, nil
}

func newBFTTransparency(tx SignedApplicationAction, txHash string, height int64, at time.Time, entryType, requestID, appealID, subject, action string, classification chain.RequestValidityStatus, status string, reasons []string) BFTTransparencyEntry {
	entry := BFTTransparencyEntry{TransparencyEntry: chain.TransparencyEntry{ID: ApplicationActionRecordID("transparency", txHash), Type: entryType, RequestID: requestID, AppealID: appealID, Subject: subject, Action: action, Classification: classification, Status: status, Reasons: append([]string(nil), reasons...), CreatedAt: at}, Signer: tx.Signer, BlockHeight: height, TxHash: txHash}
	entry.AuditHash = transparencyAuditHash(entry)
	return entry
}

func findTrustRecord[T any](values []T, id string, idOf func(T) string) (int, T, bool) {
	index := sort.Search(len(values), func(i int) bool { return idOf(values[i]) >= id })
	var zero T
	if index < len(values) && idOf(values[index]) == id {
		return index, values[index], true
	}
	return index, zero, false
}
func insertTrustRecord[T any](values []T, value T, idOf func(T) string) []T {
	index, _, _ := findTrustRecord(values, idOf(value), idOf)
	values = append(values, value)
	copy(values[index+1:], values[index:])
	values[index] = value
	return values
}

func rejectedTrustClassification(v chain.RequestValidityStatus) bool {
	switch v {
	case chain.RequestInsufficientEvidence, chain.RequestOutOfScope, chain.RequestOverbroad, chain.RequestIllegalOrAbusive, chain.RequestRejected:
		return true
	default:
		return false
	}
}
func nativeYNXTAsset(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "ynxt", "native", "native ynxt", "native_ynxt":
		return true
	default:
		return false
	}
}
func terminalAppealDecision(value string) bool {
	switch value {
	case "ACCEPTED", "REJECTED", "LABEL_REMOVED", "LABEL_REDUCED":
		return true
	default:
		return false
	}
}
func correctionDecision(value string) bool {
	return value == "ACCEPTED" || value == "LABEL_REMOVED" || value == "LABEL_REDUCED"
}
func appendUniqueStrings(values []string, additions ...string) []string {
	for _, addition := range additions {
		addition = strings.TrimSpace(addition)
		if addition == "" {
			continue
		}
		found := false
		for _, existing := range values {
			if existing == addition {
				found = true
				break
			}
		}
		if !found {
			values = append(values, addition)
		}
	}
	return values
}
func governanceAuditHash(v BFTGovernanceRequest) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_GOVERNANCE_REQUEST_AUDIT_V1", v)
}
func trustAppealAuditHash(v BFTTrustAppeal) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_TRUST_APPEAL_AUDIT_V1", v)
}
func trustCorrectionAuditHash(v BFTTrustCorrection) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_TRUST_CORRECTION_AUDIT_V1", v)
}
func transparencyAuditHash(v BFTTransparencyEntry) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_TRANSPARENCY_AUDIT_V1", v)
}
