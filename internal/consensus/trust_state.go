package consensus

import (
	"errors"
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
		if !trustRecordIDPattern.MatchString(v.ID) || (previous != "" && v.ID <= previous) || !trustRecordIDPattern.MatchString(v.RequestID) || !IsNativeAddress(v.Signer) || v.Appellant != v.Signer || v.Claimant != v.Signer || v.Subject == "" || v.Reason == "" || v.Status == "" || v.CreatedAt.IsZero() || v.UpdatedAt.IsZero() || v.BlockHeight <= 0 || v.TxHash == "" || v.AuditHash == "" || !trustRecordIDPattern.MatchString(v.TransparencyEntryID) || trustAppealAuditHash(v) != v.AuditHash {
			return errors.New("committed Trust appeals must be complete, signer-bound, and sorted")
		}
		if v.Reviewer != "" && (v.Reviewer != v.ReviewerSigner || !IsNativeAddress(v.ReviewerSigner)) {
			return errors.New("committed Trust appeal reviewer is not signer-bound")
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
func cloneTransparencyEntries(values []BFTTransparencyEntry) []BFTTransparencyEntry {
	out := make([]BFTTransparencyEntry, len(values))
	for i, v := range values {
		out[i] = v
		out[i].Reasons = append([]string(nil), v.Reasons...)
	}
	return out
}
