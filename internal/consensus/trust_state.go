package consensus

import (
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func validateTrustCommittedState(s CommittedState) error {
	previous := ""
	for _, v := range s.GovernanceRequests {
		if !trustRecordIDPattern.MatchString(v.ID) || (previous != "" && v.ID <= previous) || !IsNativeAddress(v.Signer) || v.Requester != v.Signer || v.Subject == "" || v.Action == "" || v.Status == "" || v.CreatedAt.IsZero() || v.BlockHeight <= 0 || v.TxHash == "" || v.AuditHash == "" || !trustRecordIDPattern.MatchString(v.TransparencyEntryID) || governanceAuditHash(v) != v.AuditHash {
			return errors.New("committed governance requests must be complete, signer-bound, and sorted")
		}
		if nativeYNXTAsset(v.AssetType) && !v.NativeYNXTProtected {
			return errors.New("committed native YNXT governance request lost protection marker")
		}
		previous = v.ID
	}
	previous = ""
	for _, v := range s.TrustAppeals {
		if !trustRecordIDPattern.MatchString(v.ID) || (previous != "" && v.ID <= previous) || (v.RequestID == "") == (v.LabelID == "") || (v.RequestID != "" && !trustRecordIDPattern.MatchString(v.RequestID)) || (v.LabelID != "" && !trustRecordIDPattern.MatchString(v.LabelID)) || !IsNativeAddress(v.Signer) || v.Appellant != v.Signer || v.Claimant != v.Signer || v.Subject == "" || v.Reason == "" || v.Status == "" || v.CreatedAt.IsZero() || v.UpdatedAt.IsZero() || v.BlockHeight <= 0 || v.TxHash == "" || v.AuditHash == "" || !trustRecordIDPattern.MatchString(v.TransparencyEntryID) || trustAppealAuditHash(v) != v.AuditHash {
			return errors.New("committed Trust appeals must be complete, signer-bound, and sorted")
		}
		if v.Reviewer != "" && (v.Reviewer != v.ReviewerSigner || !IsNativeAddress(v.ReviewerSigner)) {
			return errors.New("committed Trust appeal reviewer is not signer-bound")
		}
		previous = v.ID
	}
	previous = ""
	for _, v := range s.TrustLabels {
		if !trustRecordIDPattern.MatchString(v.ID) || (previous != "" && v.ID <= previous) || !IsNativeAddress(v.Signer) || v.Issuer != v.Signer || v.Subject == "" || (v.SubjectType != "address" && v.SubjectType != "transaction") || v.Label == "" || v.Source == "" || v.EvidenceHash == "" || v.RiskWeightBps < 0 || v.RiskWeightBps > 10000 || v.ConfidenceBps < 0 || v.ConfidenceBps > 10000 || !v.AppealAvailable || v.AssetEffect != "none_advisory_only" || v.CreatedAt.IsZero() || v.UpdatedAt.Before(v.CreatedAt) || v.BlockHeight <= 0 || v.TxHash == "" || v.AuditHash == "" || trustLabelAuditHash(v) != v.AuditHash {
			return errors.New("committed Trust labels must be complete, signer-bound, appealable, advisory-only, and sorted")
		}
		if v.SubjectType == "transaction" && v.Address != "" {
			return errors.New("committed transaction Trust label must not claim an address")
		}
		previous = v.ID
	}
	previous = ""
	for _, v := range s.TrustEvidence {
		if !trustRecordIDPattern.MatchString(v.ID) || (previous != "" && v.ID <= previous) || !IsNativeAddress(v.Signer) || v.Requester != v.Signer || v.Subject == "" || len(v.JSONHash) != 64 || v.RiskSummary.Subject != v.Subject || v.RiskSummary.AssetEffect != "none_advisory_only" || v.GeneratedAt.IsZero() || v.BlockHeight <= 0 || v.TxHash == "" || v.AuditHash == "" {
			return errors.New("committed Trust evidence must be complete, signer-bound, advisory-only, and sorted")
		}
		if trustPacketJSONHash(v.EvidencePacket) != v.JSONHash {
			return errors.New("committed Trust evidence packet hash mismatch")
		}
		if trustEvidenceAuditHash(v) != v.AuditHash {
			return errors.New("committed Trust evidence audit hash mismatch")
		}
		previous = v.ID
	}
	previous = ""
	for _, v := range s.TrackingReviews {
		if !trustRecordIDPattern.MatchString(v.ID) || (previous != "" && v.ID <= previous) || !IsNativeAddress(v.Signer) || v.Requester != v.Signer || v.Subject == "" || v.Purpose == "" || v.QueryType == "" || v.Status == "" || v.AppealPath != "/trust/appeals" || v.CreatedAt.IsZero() || !trustRecordIDPattern.MatchString(v.TransparencyEntryID) || v.BlockHeight <= 0 || v.TxHash == "" || v.AuditHash == "" || trustTrackingAuditHash(v) != v.AuditHash {
			return errors.New("committed Trust tracking reviews must be complete, signer-bound, appealable, and sorted")
		}
		previous = v.ID
	}
	previous = ""
	for _, v := range s.TrustCorrections {
		if !trustRecordIDPattern.MatchString(v.ID) || (previous != "" && v.ID <= previous) || !trustRecordIDPattern.MatchString(v.AppealID) || v.Subject == "" || !correctionDecision(v.Decision) || len(v.EvidenceHash) != 64 || v.AssetEffect != "none_advisory_only" || !v.AppealAvailable || !IsNativeAddress(v.Signer) || v.BlockHeight <= 0 || v.TxHash == "" || v.AuditHash == "" || v.CreatedAt.IsZero() || trustCorrectionAuditHash(v) != v.AuditHash {
			return errors.New("committed Trust corrections must be complete, advisory-only, and sorted")
		}
		previous = v.ID
	}
	seen := map[string]struct{}{}
	for _, v := range s.Transparency {
		if !trustRecordIDPattern.MatchString(v.ID) || v.Type == "" || v.Status == "" || !IsNativeAddress(v.Signer) || v.BlockHeight <= 0 || v.TxHash == "" || v.AuditHash == "" || v.CreatedAt.IsZero() || transparencyAuditHash(v) != v.AuditHash {
			return errors.New("committed transparency entry is incomplete")
		}
		if _, ok := seen[v.ID]; ok {
			return errors.New("committed transparency entry IDs must be unique")
		}
		seen[v.ID] = struct{}{}
	}
	return nil
}

func cloneGovernanceRequests(values []BFTGovernanceRequest) []BFTGovernanceRequest {
	out := make([]BFTGovernanceRequest, len(values))
	for i, v := range values {
		out[i] = v
		out[i].Evidence = append([]string(nil), v.Evidence...)
		out[i].Reasons = append([]string(nil), v.Reasons...)
		out[i].RuleIDs = append([]string(nil), v.RuleIDs...)
		if v.ReviewedAt != nil {
			t := *v.ReviewedAt
			out[i].ReviewedAt = &t
		}
		if v.RejectedAt != nil {
			t := *v.RejectedAt
			out[i].RejectedAt = &t
		}
	}
	return out
}
func cloneTrustAppeals(values []BFTTrustAppeal) []BFTTrustAppeal {
	out := make([]BFTTrustAppeal, len(values))
	for i, v := range values {
		out[i] = v
		out[i].Evidence = append([]string(nil), v.Evidence...)
	}
	return out
}
func cloneTrustLabels(values []BFTTrustLabel) []BFTTrustLabel {
	out := make([]BFTTrustLabel, len(values))
	copy(out, values)
	for i := range out {
		if out[i].ExpiresAt != nil {
			expires := *out[i].ExpiresAt
			out[i].ExpiresAt = &expires
		}
	}
	return out
}
func cloneTrustEvidence(values []BFTTrustEvidence) []BFTTrustEvidence {
	out := make([]BFTTrustEvidence, len(values))
	for i, v := range values {
		out[i] = v
		out[i].Labels = append([]chain.RiskLabel(nil), v.Labels...)
		out[i].RelatedTxs = append([]chain.Transaction(nil), v.RelatedTxs...)
		out[i].ExportNotes = append([]string(nil), v.ExportNotes...)
		out[i].Trace.Lots = append([]chain.TrustTraceLot(nil), v.Trace.Lots...)
		out[i].Trace.Labels = append([]string(nil), v.Trace.Labels...)
		out[i].RiskSummary.ReviewerNotes = append([]string(nil), v.RiskSummary.ReviewerNotes...)
		out[i].RiskSummary.NonConclusiveLabelIDs = append([]string(nil), v.RiskSummary.NonConclusiveLabelIDs...)
		out[i].RiskSummary.ExpiredLabelIDs = append([]string(nil), v.RiskSummary.ExpiredLabelIDs...)
		out[i].RiskSummary.ActiveEvidenceHashes = append([]string(nil), v.RiskSummary.ActiveEvidenceHashes...)
	}
	return out
}
func cloneTrackingReviews(values []BFTTrackingReview) []BFTTrackingReview {
	out := make([]BFTTrackingReview, len(values))
	for i, v := range values {
		out[i] = v
		out[i].Evidence = append([]string(nil), v.Evidence...)
		out[i].Reasons = append([]string(nil), v.Reasons...)
		out[i].RuleIDs = append([]string(nil), v.RuleIDs...)
		if v.LabelExpiresAt != nil {
			expires := *v.LabelExpiresAt
			out[i].LabelExpiresAt = &expires
		}
	}
	return out
}
func cloneTransparencyEntries(values []BFTTransparencyEntry) []BFTTransparencyEntry {
	out := make([]BFTTransparencyEntry, len(values))
	for i, v := range values {
		out[i] = v
		out[i].Reasons = append([]string(nil), v.Reasons...)
	}
	return out
}
