package consensus

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// A historical name (even one formatted as a native address) is not proof that
// a newly signed transaction is authorized to review the original object.
type LegacyTrustAuthorityError struct {
	Action   string
	ObjectID string
}

func (e *LegacyTrustAuthorityError) Error() string {
	return fmt.Sprintf("source Trust %s for %s requires independently authenticated reviewer authority; original requester/reviewer text supplies no signed binding", e.Action, e.ObjectID)
}

// applyLegacyTrustRecord is deterministic replay, not a signer or an authority
// resolver. Its caller verifies the actual envelope and original-height policy.
// Only new signer-bound appeals are currently admitted against source objects.
// Review/rejection/resolution cannot adopt the source operator's authority.
func applyLegacyTrustRecord(view *LegacyTrustRecords, tx SignedApplicationAction, hash string, height int64, at time.Time) (string, bool, error) {
	if view == nil {
		return "", false, nil
	}
	switch tx.Action {
	case ActionGovernanceReview, ActionGovernanceReject:
		var p GovernanceDecisionPayload
		if err := json.Unmarshal(tx.Payload, &p); err != nil {
			return "", true, err
		}
		if _, exists := view.Governance[p.RequestID]; !exists {
			return "", false, nil
		}
		return "", true, &LegacyTrustAuthorityError{Action: tx.Action, ObjectID: p.RequestID}
	case ActionTrustAppealResolve:
		var p TrustAppealDecisionPayload
		if err := json.Unmarshal(tx.Payload, &p); err != nil {
			return "", true, err
		}
		if _, exists := view.Appeals[p.AppealID]; !exists {
			return "", false, nil
		}
		return "", true, &LegacyTrustAuthorityError{Action: tx.Action, ObjectID: p.AppealID}
	case ActionTrustAppealCreate:
		var p TrustAppealPayload
		if err := json.Unmarshal(tx.Payload, &p); err != nil {
			return "", true, err
		}
		matched, subject, appealAvailable := false, "", true
		if p.RequestID != "" {
			if v, ok := view.Governance[p.RequestID]; ok {
				matched, subject = true, v.Subject
			}
			if v, ok := view.Tracking[p.RequestID]; ok {
				if matched {
					return "", true, errors.New("ambiguous original governance/tracking ID")
				}
				matched, subject = true, v.Subject
			}
		} else {
			for _, labels := range view.RiskLabels {
				for _, v := range labels {
					if v.ID == p.LabelID {
						matched, subject, appealAvailable = true, v.Subject, v.AppealAvailable
					}
				}
			}
		}
		if !matched {
			return "", false, nil
		}
		if p.Appellant != tx.Signer || p.Claimant != tx.Signer || p.Subject != subject || !appealAvailable {
			return "", true, errors.New("source appeal requires actual signer-bound claimant and exact original subject/appeal permission")
		}
		if height <= 0 || at.IsZero() || !trustTransactionHashPattern.MatchString(hash) {
			return "", true, errors.New("source appeal lacks actual execution coordinates")
		}
		id := ApplicationActionRecordID("trust-appeal", hash)
		entryID := ApplicationActionRecordID("source-trust-transparency", hash)
		if _, exists := view.Appeals[id]; exists {
			return "", true, errors.New("source appeal ID already exists")
		}
		if _, exists := view.Transparency[entryID]; exists {
			return "", true, errors.New("source transparency ID already exists")
		}
		if view.Appeals == nil {
			view.Appeals = make(map[string]chain.TrustAppeal)
		}
		if view.Transparency == nil {
			view.Transparency = make(map[string]chain.TransparencyEntry)
		}
		view.Appeals[id] = chain.TrustAppeal{ID: id, RequestID: p.RequestID, LabelID: p.LabelID, Subject: p.Subject, Appellant: tx.Signer, Claimant: tx.Signer, Reason: p.Reason, Evidence: append([]string(nil), p.Evidence...), Status: "SUBMITTED", CreatedAt: at, UpdatedAt: at, TransparencyEntryID: entryID}
		view.Transparency[entryID] = chain.TransparencyEntry{ID: entryID, Type: "trust_appeal", RequestID: p.RequestID, AppealID: id, Subject: p.Subject, Action: "appeal", Classification: chain.RequestRequiresReview, Status: "SUBMITTED", Reasons: []string{"appeal opened by the newly signed claimant; source reviewer authority is not inferred"}, CreatedAt: at}
		return id, true, nil
	default:
		return "", false, nil
	}
}

// A complete data import does not claim that privileged source transitions are
// executable. Keep this separate from structural validation and from new writes.
func legacyTrustAuthorityBlockers(source *LegacyTrustSource) []MigrationModuleBlocker {
	if source == nil {
		return nil
	}
	count := len(source.Records.Governance) + len(source.Records.Appeals) + len(source.Updates)
	if count == 0 {
		return nil
	}
	return []MigrationModuleBlocker{{Module: "trust_source_reviewer_authority", Records: count, Reason: "source governance/appeal records contain no authenticated reviewer role binding; signed new claims are allowed, but review/reject/resolve remain fail-closed"}}
}
