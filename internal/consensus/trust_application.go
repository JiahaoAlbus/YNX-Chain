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
		if input.RequestID != "" {
			_, request, ok := findTrustRecord(state.governanceRequests, input.RequestID, func(v BFTGovernanceRequest) string { return v.ID })
			if !ok || request.Subject != input.Subject {
				_, tracking, trackingOK := findTrustRecord(state.trackingReviews, input.RequestID, func(v BFTTrackingReview) string { return v.ID })
				if !trackingOK || tracking.Subject != input.Subject {
					return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("appeal governance or tracking request is missing or subject does not match"))
				}
			}
		} else {
			_, label, ok := findTrustRecord(state.trustLabels, input.LabelID, func(v BFTTrustLabel) string { return v.ID })
			if !ok || label.Subject != input.Subject || !label.AppealAvailable {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("appeal Trust label is missing, unavailable, or subject does not match"))
			}
		}
		recordID = ApplicationActionRecordID("trust-appeal", txHash)
		appeal := BFTTrustAppeal{TrustAppeal: chain.TrustAppeal{ID: recordID, RequestID: input.RequestID, LabelID: input.LabelID, Subject: input.Subject, Appellant: input.Appellant, Claimant: input.Claimant, Reason: input.Reason, Evidence: append([]string(nil), input.Evidence...), Status: "SUBMITTED", CreatedAt: blockTime, UpdatedAt: blockTime}, Signer: tx.Signer, BlockHeight: height, TxHash: txHash}
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
			if appeal.LabelID != "" {
				labelIndex, label, ok := findTrustRecord(state.trustLabels, appeal.LabelID, func(v BFTTrustLabel) string { return v.ID })
				if !ok {
					return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("appealed Trust label disappeared"))
				}
				label.UpdatedAt, label.DisputeStatus = blockTime, "resolved_after_appeal"
				if input.Decision == "LABEL_REMOVED" || input.Decision == "ACCEPTED" {
					label.RiskWeightBps, label.LabelType, label.Severity = 0, "appeal_correction", "none"
				} else if input.Decision == "LABEL_REDUCED" && label.RiskWeightBps > 100 {
					label.RiskWeightBps, label.LabelType, label.Severity = 100, "appeal_correction", "low"
				}
				label.BlockHeight, label.TxHash, label.AuditHash = height, txHash, ""
				label.AuditHash = trustLabelAuditHash(label)
				state.trustLabels[labelIndex] = label
			}
		}
	case ActionTrustLabelCreate:
		var input TrustLabelPayload
		_ = json.Unmarshal(tx.Payload, &input)
		if input.Issuer != tx.Signer {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Trust label issuer must equal transaction signer"))
		}
		if input.RejectedExternalRequestReference != "" {
			_, request, ok := findTrustRecord(state.governanceRequests, input.RejectedExternalRequestReference, func(v BFTGovernanceRequest) string { return v.ID })
			if !ok || request.Status != "rejected" {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Trust label rejected request reference must identify a rejected governance request"))
			}
		}
		recordID = ApplicationActionRecordID("trust-label", txHash)
		var expiresAt *time.Time
		if input.ExpiryHours > 0 {
			expires := blockTime.Add(time.Duration(input.ExpiryHours) * time.Hour)
			expiresAt = &expires
		}
		label := BFTTrustLabel{RiskLabel: chain.RiskLabel{ID: recordID, Subject: input.Subject, SubjectType: input.SubjectType, Address: input.Address, Label: input.Label, LabelType: input.LabelType, Severity: input.Severity, RiskWeightBps: input.RiskWeightBps, ConfidenceBps: input.ConfidenceBps, Source: input.Source, EvidenceHash: input.EvidenceHash, CreatedAt: blockTime, UpdatedAt: blockTime, ExpiresAt: expiresAt, ReviewRequired: input.ReviewRequired, AppealAvailable: true, DisputeStatus: input.DisputeStatus, LegalStatusUnderYNXChainLaw: input.LegalStatusUnderYNXChainLaw, RejectedExternalRequestReference: input.RejectedExternalRequestReference, AssetEffect: "none_advisory_only"}, Issuer: tx.Signer, Signer: tx.Signer, BlockHeight: height, TxHash: txHash}
		label.AuditHash = trustLabelAuditHash(label)
		state.trustLabels = insertTrustRecord(state.trustLabels, label, func(v BFTTrustLabel) string { return v.ID })
		entry = newBFTTransparency(tx, txHash, height, blockTime, "trust_label", label.ID, "", label.Subject, label.Label, chain.RequestRequiresReview, label.DisputeStatus, []string{"advisory-only Trust label recorded with evidence hash and appeal path"})
	case ActionTrustEvidenceCreate:
		var input TrustEvidencePayload
		_ = json.Unmarshal(tx.Payload, &input)
		if input.Requester != tx.Signer {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Trust evidence requester must equal transaction signer"))
		}
		recordID = ApplicationActionRecordID("trust-evidence", txHash)
		labels := chainLabelsForSubject(state.trustLabels, input.Subject)
		if _, accountExists := accountIndex(state.accounts, input.Subject); !accountExists && len(labels) == 0 {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Trust evidence subject has no committed account or label state"))
		}
		packet := chain.EvidencePacket{ID: recordID, Subject: input.Subject, Trace: buildExecutionTrustTrace(state, input.Subject), Labels: labels, RiskSummary: chain.TrustRiskSummaryForLabels(input.Subject, labels, blockTime), RelatedTxs: []chain.Transaction{}, GeneratedAt: blockTime, ExportNotes: []string{"Evidence is generated from committed BFT application state.", "Related transaction bodies are not copied into consensus evidence packets; reviewers use referenced hashes and public transaction lookup.", "Risk scoring is advisory-only and cannot freeze, seize, confiscate, transfer, or criminally classify assets or users."}}
		packet.JSONHash = trustPacketJSONHash(packet)
		evidence := BFTTrustEvidence{EvidencePacket: packet, Requester: tx.Signer, Signer: tx.Signer, BlockHeight: height, TxHash: txHash}
		evidence.AuditHash = trustEvidenceAuditHash(evidence)
		state.trustEvidence = insertTrustRecord(state.trustEvidence, evidence, func(v BFTTrustEvidence) string { return v.ID })
		entry = newBFTTransparency(tx, txHash, height, blockTime, "trust_evidence", evidence.ID, "", evidence.Subject, "evidence_export", chain.RequestValidUnderYNXChainLaw, "generated", []string{"bounded evidence metadata generated from committed state"})
	case ActionTrustTrackingCreate:
		var input TrustTrackingPayload
		_ = json.Unmarshal(tx.Payload, &input)
		if input.Requester != tx.Signer {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("tracking requester must equal transaction signer"))
		}
		recordID = ApplicationActionRecordID("tracking-review", txHash)
		classification, status, reasons, ruleIDs := chain.ClassifyTrackingPolicyReview(chain.TrackingPolicyReviewInput{Requester: input.Requester, Subject: input.Subject, Purpose: input.Purpose, QueryType: input.QueryType, Scope: input.Scope, Description: input.Description, Evidence: input.Evidence, Institutional: input.Institutional, Sensitive: input.Sensitive, MinimumNecessary: input.MinimumNecessary, ConfidenceBps: input.ConfidenceBps, ExpiryHours: input.ExpiryHours})
		var expiresAt *time.Time
		if input.ExpiryHours > 0 {
			expires := blockTime.Add(time.Duration(input.ExpiryHours) * time.Hour)
			expiresAt = &expires
		}
		review := BFTTrackingReview{TrackingPolicyReview: chain.TrackingPolicyReview{ID: recordID, Requester: input.Requester, Subject: input.Subject, Purpose: input.Purpose, QueryType: input.QueryType, Scope: input.Scope, Description: input.Description, Evidence: append([]string(nil), input.Evidence...), Institutional: input.Institutional, Sensitive: input.Sensitive, MinimumNecessary: input.MinimumNecessary, Classification: classification, Status: status, Reasons: append([]string(nil), reasons...), RuleIDs: append([]string(nil), ruleIDs...), ConfidenceBps: input.ConfidenceBps, LabelExpiresAt: expiresAt, AppealPath: "/trust/appeals", CreatedAt: blockTime}, Signer: tx.Signer, BlockHeight: height, TxHash: txHash}
		entry = newBFTTransparency(tx, txHash, height, blockTime, "tracking_policy_review", review.ID, "", review.Subject, review.QueryType, review.Classification, review.Status, review.Reasons)
		review.TransparencyEntryID = entry.ID
		review.AuditHash = trustTrackingAuditHash(review)
		state.trackingReviews = insertTrustRecord(state.trackingReviews, review, func(v BFTTrackingReview) string { return v.ID })
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
func trustLabelAuditHash(v BFTTrustLabel) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_TRUST_LABEL_AUDIT_V1", v)
}
func trustEvidenceAuditHash(v BFTTrustEvidence) string {
	v.AuditHash = ""
	v.EvidencePacket = normalizeEvidencePacket(v.EvidencePacket)
	return recordAuditHash("YNX_TRUST_EVIDENCE_AUDIT_V1", v)
}
func trustTrackingAuditHash(v BFTTrackingReview) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_TRUST_TRACKING_AUDIT_V1", v)
}
func transparencyAuditHash(v BFTTransparencyEntry) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_TRANSPARENCY_AUDIT_V1", v)
}

func chainLabelsForSubject(values []BFTTrustLabel, subject string) []chain.RiskLabel {
	out := make([]chain.RiskLabel, 0)
	for _, value := range values {
		if value.Subject == subject {
			out = append(out, value.RiskLabel)
		}
	}
	return out
}

func buildExecutionTrustTrace(state executionState, subject string) chain.TrustTrace {
	lots := make([]chain.TrustTraceLot, 0)
	if index, ok := accountIndex(state.accounts, subject); ok {
		ids := make([]string, 0, len(state.accounts[index].Lots))
		for id := range state.accounts[index].Lots {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			lots = append(lots, chain.TrustTraceLot{LotID: id, Amount: state.accounts[index].Lots[id], Origin: "committed-chain-lineage"})
		}
	}
	labels := chainLabelsForSubject(state.trustLabels, subject)
	labelNames := []string{"bft-committed-lot-lineage"}
	if len(lots) == 0 {
		labelNames = append(labelNames, "no-known-lots")
	}
	if len(labels) > 0 {
		labelNames = append(labelNames, "advisory-risk-labels-present")
	}
	return chain.TrustTrace{Address: subject, Lots: lots, Labels: labelNames, Summary: "Trace uses committed lot lineage and advisory Trust label metadata. Labels require evidence, confidence, expiry, and appealability and cannot freeze, seize, or transfer funds."}
}

func buildBFTTrustTrace(state CommittedState, subject string) chain.TrustTrace {
	return buildExecutionTrustTrace(executionState{accounts: state.Accounts, trustLabels: state.TrustLabels}, subject)
}

func trustPacketJSONHash(packet chain.EvidencePacket) string {
	packet.JSONHash = ""
	packet = normalizeEvidencePacket(packet)
	return recordAuditHash("YNX_TRUST_EVIDENCE_PACKET_JSON_V1", packet)
}

func normalizeEvidencePacket(packet chain.EvidencePacket) chain.EvidencePacket {
	if packet.Labels == nil {
		packet.Labels = []chain.RiskLabel{}
	}
	if packet.RelatedTxs == nil {
		packet.RelatedTxs = []chain.Transaction{}
	}
	if packet.Trace.Lots == nil {
		packet.Trace.Lots = []chain.TrustTraceLot{}
	}
	if packet.Trace.Labels == nil {
		packet.Trace.Labels = []string{}
	}
	if packet.ExportNotes == nil {
		packet.ExportNotes = []string{}
	}
	return packet
}
