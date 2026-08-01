package payproduct

import (
	"errors"
	"fmt"
	"strings"
)

const merchantDeletionRedaction = "redacted after approved merchant deletion"

type MerchantDataHoldInput struct {
	MerchantID         string `json:"merchantId"`
	Reason             string `json:"reason"`
	AuthorityReference string `json:"authorityReference"`
	OperatorID         string `json:"operatorId"`
	IdempotencyKey     string `json:"idempotencyKey"`
}

type MerchantDataHoldReleaseInput struct {
	MerchantID string `json:"merchantId"`
	OperatorID string `json:"operatorId"`
	Reason     string `json:"reason"`
}

type MerchantDeletionApprovalInput struct {
	ConfirmMerchantID string `json:"confirmMerchantId"`
	OperatorID        string `json:"operatorId"`
	ApprovalReference string `json:"approvalReference"`
}

type MerchantDeletionExecutionInput struct {
	ConfirmMerchantID string `json:"confirmMerchantId"`
	OperatorID        string `json:"operatorId"`
	ApprovalReference string `json:"approvalReference"`
	IdempotencyKey    string `json:"idempotencyKey"`
}

func (s *Service) PlaceMerchantDataHold(input MerchantDataHoldInput) (MerchantDataHold, error) {
	merchantID, err := validMerchantLifecycleID(input.MerchantID)
	if err != nil {
		return MerchantDataHold{}, err
	}
	operatorID, err := validLifecycleOperator(input.OperatorID)
	if err != nil {
		return MerchantDataHold{}, err
	}
	reason, err := validLifecycleText(input.Reason, "legal hold reason", 8, 500)
	if err != nil {
		return MerchantDataHold{}, err
	}
	authority, err := validLifecycleText(input.AuthorityReference, "legal hold authority reference", 3, 200)
	if err != nil {
		return MerchantDataHold{}, err
	}
	key, err := validKey(input.IdempotencyKey)
	if err != nil {
		return MerchantDataHold{}, err
	}
	input.MerchantID = merchantID
	input.OperatorID = operatorID
	input.Reason = reason
	input.AuthorityReference = authority
	input.IdempotencyKey = key
	holdID := "mdh_" + hashString(merchantID, key)[:20]
	now := s.now().UTC()
	if err := s.idempotentUpdate("merchant-data-hold", merchantID, key, hashJSON(input), holdID, func(data *Snapshot) error {
		if _, ok := data.Merchants[merchantID]; !ok {
			return errors.New("merchant not found")
		}
		data.DataHolds[holdID] = MerchantDataHold{
			ID:                 holdID,
			MerchantID:         merchantID,
			Status:             "active",
			Reason:             reason,
			AuthorityReference: authority,
			PlacedBy:           operatorID,
			CreatedAt:          now,
		}
		appendAudit(data, merchantID, "operator:"+operatorID, "merchant.data.hold.place", holdID, "committed", "active legal hold prevents deletion approval and execution", now)
		return nil
	}); err != nil {
		return MerchantDataHold{}, err
	}
	return s.merchantDataHold(merchantID, holdID)
}

func (s *Service) ReleaseMerchantDataHold(holdID string, input MerchantDataHoldReleaseInput) (MerchantDataHold, error) {
	holdID = strings.TrimSpace(holdID)
	if !identifierRE.MatchString(holdID) || !strings.HasPrefix(holdID, "mdh_") {
		return MerchantDataHold{}, errors.New("valid merchant data hold ID required")
	}
	merchantID, err := validMerchantLifecycleID(input.MerchantID)
	if err != nil {
		return MerchantDataHold{}, err
	}
	operatorID, err := validLifecycleOperator(input.OperatorID)
	if err != nil {
		return MerchantDataHold{}, err
	}
	reason, err := validLifecycleText(input.Reason, "legal hold release reason", 8, 500)
	if err != nil {
		return MerchantDataHold{}, err
	}
	now := s.now().UTC()
	var out MerchantDataHold
	err = s.store.Update(func(data *Snapshot) error {
		hold, ok := data.DataHolds[holdID]
		if !ok || hold.MerchantID != merchantID {
			return errors.New("merchant data hold not found")
		}
		if hold.Status == "released" {
			out = hold
			return nil
		}
		if hold.Status != "active" {
			return errors.New("merchant data hold cannot be released")
		}
		hold.Status = "released"
		hold.ReleasedBy = operatorID
		hold.ReleasedAt = &now
		data.DataHolds[holdID] = hold
		appendAudit(data, merchantID, "operator:"+operatorID, "merchant.data.hold.release", holdID, "committed", reason, now)
		out = hold
		return nil
	})
	return out, err
}

func (s *Service) ApproveMerchantDeletion(requestID string, input MerchantDeletionApprovalInput) (MerchantDataRequest, error) {
	requestID = strings.TrimSpace(requestID)
	if !identifierRE.MatchString(requestID) || !strings.HasPrefix(requestID, "mdr_") {
		return MerchantDataRequest{}, errors.New("valid merchant deletion request ID required")
	}
	merchantID, err := validMerchantLifecycleID(input.ConfirmMerchantID)
	if err != nil {
		return MerchantDataRequest{}, err
	}
	operatorID, err := validLifecycleOperator(input.OperatorID)
	if err != nil {
		return MerchantDataRequest{}, err
	}
	approvalReference, err := validLifecycleText(input.ApprovalReference, "approval reference", 3, 200)
	if err != nil {
		return MerchantDataRequest{}, err
	}
	now := s.now().UTC()
	var out MerchantDataRequest
	err = s.store.Update(func(data *Snapshot) error {
		request, ok := data.DataRequests[requestID]
		if !ok || request.MerchantID != merchantID || request.Type != "deletion" {
			return errors.New("merchant deletion request not found")
		}
		switch request.Status {
		case "canceled", "rejected":
			return errors.New("merchant deletion request cannot be approved")
		case "completed":
			out = request
			return nil
		case "approved":
			if request.ApprovedBy != operatorID || request.ApprovalReference != approvalReference {
				return errors.New("merchant deletion request already has a different approval")
			}
			out = request
			return nil
		}
		if _, ok := data.Merchants[merchantID]; !ok {
			return errors.New("merchant not found")
		}
		request.Blockers = merchantDeletionBlockers(*data, merchantID)
		request.UpdatedAt = now
		if request.EligibleAt == nil || now.Before(request.EligibleAt.UTC()) {
			request.Status = "cooling_off"
			data.DataRequests[requestID] = request
			appendAudit(data, merchantID, "operator:"+operatorID, "merchant.data.deletion.approve", requestID, "denied", "cooling-off period has not elapsed", now)
			out = request
			return nil
		}
		if len(request.Blockers) > 0 {
			request.Status = "retention_blocked"
			data.DataRequests[requestID] = request
			appendAudit(data, merchantID, "operator:"+operatorID, "merchant.data.deletion.approve", requestID, "denied", "retention or legal-hold blockers remain", now)
			out = request
			return nil
		}
		request.Status = "approved"
		request.ApprovedBy = operatorID
		request.ApprovalReference = approvalReference
		request.ApprovedAt = &now
		data.DataRequests[requestID] = request
		appendAudit(data, merchantID, "operator:"+operatorID, "merchant.data.deletion.approve", requestID, "committed", "local deletion approved after cooling-off and blocker verification", now)
		out = request
		return nil
	})
	return out, err
}

func (s *Service) ExecuteMerchantDeletion(requestID string, input MerchantDeletionExecutionInput) (MerchantDataRequest, error) {
	requestID = strings.TrimSpace(requestID)
	if !identifierRE.MatchString(requestID) || !strings.HasPrefix(requestID, "mdr_") {
		return MerchantDataRequest{}, errors.New("valid merchant deletion request ID required")
	}
	merchantID, err := validMerchantLifecycleID(input.ConfirmMerchantID)
	if err != nil {
		return MerchantDataRequest{}, err
	}
	operatorID, err := validLifecycleOperator(input.OperatorID)
	if err != nil {
		return MerchantDataRequest{}, err
	}
	approvalReference, err := validLifecycleText(input.ApprovalReference, "approval reference", 3, 200)
	if err != nil {
		return MerchantDataRequest{}, err
	}
	key, err := validKey(input.IdempotencyKey)
	if err != nil {
		return MerchantDataRequest{}, err
	}
	input.ConfirmMerchantID = merchantID
	input.OperatorID = operatorID
	input.ApprovalReference = approvalReference
	input.IdempotencyKey = key

	s.mutation.Lock()
	defer s.mutation.Unlock()

	runIDs := []string{}
	_ = s.store.View(func(data Snapshot) error {
		for id, run := range data.AIRuns {
			if run.MerchantID == merchantID {
				runIDs = append(runIDs, id)
			}
		}
		return nil
	})
	now := s.now().UTC()
	if err := s.idempotentUpdate("merchant-data-deletion-execute", merchantID, key, hashJSON(input), requestID, func(data *Snapshot) error {
		request, ok := data.DataRequests[requestID]
		if !ok || request.MerchantID != merchantID || request.Type != "deletion" {
			return errors.New("merchant deletion request not found")
		}
		if request.Status == "completed" {
			return nil
		}
		if request.Status != "approved" || request.ApprovedBy != operatorID || request.ApprovalReference != approvalReference || request.ApprovedAt == nil {
			return errors.New("matching approved merchant deletion request required")
		}
		if request.EligibleAt == nil || now.Before(request.EligibleAt.UTC()) {
			return errors.New("merchant deletion cooling-off period has not elapsed")
		}
		if blockers := merchantDeletionBlockers(*data, merchantID); len(blockers) > 0 {
			return fmt.Errorf("merchant deletion remains blocked: %s", strings.Join(blockers, ","))
		}
		summary := purgeMerchantLocalData(data, merchantID, requestID)
		request = data.DataRequests[requestID]
		request.Status = "completed"
		request.RequestedBy = ""
		request.Reason = merchantDeletionRedaction
		request.Blockers = []string{}
		request.ExecutedBy = operatorID
		request.ExecutedAt = &now
		request.UpdatedAt = now
		request.ExecutionSummary = &summary
		data.DataRequests[requestID] = request
		appendAudit(data, merchantID, "operator:"+operatorID, "merchant.data.deletion.execute", requestID, "committed", "approved local merchant data removed; retained audit/request/hold evidence is redacted; no provider or public-chain deletion claimed", now)
		summary.RetainedAuditEntries = merchantAuditCount(*data, merchantID)
		request.ExecutionSummary = &summary
		data.DataRequests[requestID] = request
		return nil
	}); err != nil {
		return MerchantDataRequest{}, err
	}

	s.aiMu.Lock()
	for _, runID := range runIDs {
		if cancel := s.aiCancels[runID]; cancel != nil {
			cancel()
		}
		delete(s.aiCancels, runID)
	}
	s.aiMu.Unlock()

	var out MerchantDataRequest
	err = s.store.View(func(data Snapshot) error {
		var ok bool
		out, ok = data.DataRequests[requestID]
		if !ok {
			return errors.New("merchant deletion completion evidence not found")
		}
		return nil
	})
	return out, err
}

func (s *Service) merchantDataHold(merchantID, holdID string) (MerchantDataHold, error) {
	var out MerchantDataHold
	err := s.store.View(func(data Snapshot) error {
		var ok bool
		out, ok = data.DataHolds[holdID]
		if !ok || out.MerchantID != merchantID {
			return errors.New("merchant data hold not found")
		}
		return nil
	})
	return out, err
}

func purgeMerchantLocalData(data *Snapshot, merchantID, requestID string) MerchantDeletionExecutionSummary {
	removed := map[string]int{}
	deletedObjects := map[string]bool{merchantID: true}
	if _, ok := data.Merchants[merchantID]; ok {
		delete(data.Merchants, merchantID)
		removed["merchants"]++
	}
	for id, member := range data.MerchantMembers {
		if member.MerchantID == merchantID {
			deletedObjects[id] = true
			delete(data.MerchantMembers, id)
			removed["members"]++
		}
	}
	for id, session := range data.ConsoleSessions {
		if session.MerchantID == merchantID {
			deletedObjects[id] = true
			delete(data.ConsoleSessions, id)
			removed["sessions"]++
		}
	}
	for id, item := range data.Catalog {
		if item.MerchantID == merchantID {
			deletedObjects[id] = true
			delete(data.Catalog, id)
			removed["catalogItems"]++
		}
	}
	for id, invoice := range data.Invoices {
		if invoice.MerchantID == merchantID {
			deletedObjects[id] = true
			delete(data.Invoices, id)
			removed["invoices"]++
		}
	}
	for id, refund := range data.Refunds {
		if refund.MerchantID == merchantID {
			deletedObjects[id] = true
			delete(data.Refunds, id)
			removed["refunds"]++
		}
	}
	for id, dispute := range data.Disputes {
		if dispute.MerchantID == merchantID {
			deletedObjects[id] = true
			delete(data.Disputes, id)
			removed["disputes"]++
		}
	}
	for id, delivery := range data.Deliveries {
		if delivery.MerchantID == merchantID {
			deletedObjects[id] = true
			delete(data.Deliveries, id)
			removed["webhookDeliveries"]++
		}
	}
	for id, run := range data.AIRuns {
		if run.MerchantID == merchantID {
			deletedObjects[id] = true
			delete(data.AIRuns, id)
			removed["aiRuns"]++
		}
	}
	for id, provider := range data.Providers {
		if provider.MerchantID == merchantID {
			deletedObjects[id] = true
			delete(data.Providers, id)
			removed["providers"]++
		}
	}
	for id, operation := range data.BulkOperations {
		if operation.MerchantID == merchantID {
			deletedObjects[id] = true
			delete(data.BulkOperations, id)
			removed["bulkOperations"]++
		}
	}
	for id, nonce := range data.Nonces {
		if nonce.MerchantID == merchantID {
			delete(data.Nonces, id)
			removed["nonces"]++
		}
	}
	for id, request := range data.DataRequests {
		if request.MerchantID != merchantID {
			continue
		}
		request.RequestedBy = ""
		request.Reason = merchantDeletionRedaction
		request.Blockers = []string{}
		if id != requestID && request.Status != "canceled" && request.Status != "rejected" && request.Status != "completed" {
			request.Status = "superseded_by_deletion"
		}
		data.DataRequests[id] = request
	}
	for id, hold := range data.DataHolds {
		if hold.MerchantID != merchantID {
			continue
		}
		hold.Reason = merchantDeletionRedaction
		data.DataHolds[id] = hold
	}
	for id, record := range data.Idempotency {
		if strings.Contains(id, ":"+merchantID+":") || deletedObjects[record.ObjectID] {
			delete(data.Idempotency, id)
			removed["idempotencyRecords"]++
		}
	}
	for i := range data.Audit {
		if data.Audit[i].MerchantID != merchantID {
			continue
		}
		if !strings.HasPrefix(data.Audit[i].Actor, "operator:") && data.Audit[i].Actor != "system-recovery" {
			data.Audit[i].Actor = "deleted-merchant"
		}
		data.Audit[i].Detail = "retained action metadata after approved local deletion"
	}

	retainedRequests := 0
	for _, request := range data.DataRequests {
		if request.MerchantID == merchantID {
			retainedRequests++
		}
	}
	retainedHolds := 0
	for _, hold := range data.DataHolds {
		if hold.MerchantID == merchantID && hold.Status == "released" {
			retainedHolds++
		}
	}
	return MerchantDeletionExecutionSummary{
		RemovedRecords:             removed,
		RetainedAuditEntries:       merchantAuditCount(*data, merchantID),
		RetainedDataRequests:       retainedRequests,
		RetainedReleasedHolds:      retainedHolds,
		ProviderDeletionClaimed:    false,
		PublicChainDeletionClaimed: false,
		Source:                     "approved-local-merchant-deletion-v1",
	}
}

func merchantAuditCount(data Snapshot, merchantID string) int {
	count := 0
	for _, entry := range data.Audit {
		if entry.MerchantID == merchantID {
			count++
		}
	}
	return count
}

func validMerchantLifecycleID(value string) (string, error) {
	value = strings.TrimSpace(value)
	if !identifierRE.MatchString(value) || !strings.HasPrefix(value, "mrc_") {
		return "", errors.New("valid merchant ID required")
	}
	return value, nil
}

func validLifecycleOperator(value string) (string, error) {
	value = strings.TrimSpace(value)
	if !identifierRE.MatchString(value) {
		return "", errors.New("valid operator ID required")
	}
	return value, nil
}

func validLifecycleText(value, label string, minLength, maxLength int) (string, error) {
	value = strings.TrimSpace(value)
	if len(value) < minLength || len(value) > maxLength {
		return "", fmt.Errorf("%s must contain %d to %d characters", label, minLength, maxLength)
	}
	return value, nil
}
