package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

var (
	trustRecordIDPattern        = regexp.MustCompile(`^[0-9a-f]{24}$`)
	trustTransactionHashPattern = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
	trustEvidenceHashPattern    = regexp.MustCompile(`^(sha256:)?[0-9a-f]{64}$`)
)

type GovernanceRequestPayload struct {
	Requester   string   `json:"requester"`
	Subject     string   `json:"subject"`
	Action      string   `json:"action"`
	AssetType   string   `json:"assetType"`
	Scope       string   `json:"scope"`
	Description string   `json:"description"`
	Evidence    []string `json:"evidence"`
}

type GovernanceDecisionPayload struct {
	RequestID string `json:"requestId"`
	Reviewer  string `json:"reviewer"`
	Reason    string `json:"reason,omitempty"`
}

type TrustAppealPayload struct {
	RequestID string   `json:"requestId"`
	LabelID   string   `json:"labelId,omitempty"`
	Subject   string   `json:"subject"`
	Appellant string   `json:"appellant"`
	Claimant  string   `json:"claimant"`
	Reason    string   `json:"reason"`
	Evidence  []string `json:"evidence"`
}

type TrustAppealDecisionPayload struct {
	AppealID         string `json:"appealId"`
	Reviewer         string `json:"reviewer"`
	Decision         string `json:"decision"`
	ResolutionReason string `json:"resolutionReason"`
}

type TrustLabelPayload struct {
	Issuer                           string `json:"issuer"`
	Subject                          string `json:"subject"`
	SubjectType                      string `json:"subjectType"`
	Address                          string `json:"address"`
	Label                            string `json:"label"`
	LabelType                        string `json:"labelType"`
	Severity                         string `json:"severity"`
	RiskWeightBps                    int64  `json:"riskWeightBps"`
	ConfidenceBps                    int64  `json:"confidenceBps"`
	Source                           string `json:"source"`
	EvidenceHash                     string `json:"evidenceHash"`
	ExpiryHours                      int64  `json:"expiryHours"`
	ReviewRequired                   bool   `json:"reviewRequired"`
	AppealAvailable                  bool   `json:"appealAvailable"`
	DisputeStatus                    string `json:"disputeStatus"`
	LegalStatusUnderYNXChainLaw      string `json:"legalStatusUnderYnxChainLaw"`
	RejectedExternalRequestReference string `json:"rejectedExternalRequestReference"`
	AssetEffect                      string `json:"assetEffect"`
}

type TrustEvidencePayload struct {
	Requester string `json:"requester"`
	Subject   string `json:"subject"`
}

type TrustTrackingPayload struct {
	Requester        string   `json:"requester"`
	Subject          string   `json:"subject"`
	Purpose          string   `json:"purpose"`
	QueryType        string   `json:"queryType"`
	Scope            string   `json:"scope"`
	Description      string   `json:"description"`
	Evidence         []string `json:"evidence"`
	Institutional    bool     `json:"institutional"`
	Sensitive        bool     `json:"sensitive"`
	MinimumNecessary bool     `json:"minimumNecessary"`
	ConfidenceBps    int64    `json:"confidenceBps"`
	ExpiryHours      int64    `json:"expiryHours"`
}

type BFTGovernanceRequest struct {
	chain.GovernanceRequest
	Signer      string `json:"signer"`
	Reviewer    string `json:"reviewer,omitempty"`
	BlockHeight int64  `json:"blockHeight"`
	TxHash      string `json:"txHash"`
	AuditHash   string `json:"auditHash"`
}

type BFTTrustAppeal struct {
	chain.TrustAppeal
	Signer         string `json:"signer"`
	ReviewerSigner string `json:"reviewerSigner,omitempty"`
	BlockHeight    int64  `json:"blockHeight"`
	TxHash         string `json:"txHash"`
	AuditHash      string `json:"auditHash"`
}

type BFTTrustCorrection struct {
	ID              string    `json:"id"`
	AppealID        string    `json:"appealId"`
	RequestID       string    `json:"requestId,omitempty"`
	Subject         string    `json:"subject"`
	Decision        string    `json:"decision"`
	EvidenceHash    string    `json:"evidenceHash"`
	AssetEffect     string    `json:"assetEffect"`
	AppealAvailable bool      `json:"appealAvailable"`
	Signer          string    `json:"signer"`
	BlockHeight     int64     `json:"blockHeight"`
	TxHash          string    `json:"txHash"`
	AuditHash       string    `json:"auditHash"`
	CreatedAt       time.Time `json:"createdAt"`
}

type BFTTrustLabel struct {
	chain.RiskLabel
	Issuer      string `json:"issuer"`
	Signer      string `json:"signer"`
	BlockHeight int64  `json:"blockHeight"`
	TxHash      string `json:"txHash"`
	AuditHash   string `json:"auditHash"`
}

type BFTTrustEvidence struct {
	chain.EvidencePacket
	Requester   string `json:"requester"`
	Signer      string `json:"signer"`
	BlockHeight int64  `json:"blockHeight"`
	TxHash      string `json:"txHash"`
	AuditHash   string `json:"auditHash"`
}

type BFTTrackingReview struct {
	chain.TrackingPolicyReview
	Signer      string `json:"signer"`
	BlockHeight int64  `json:"blockHeight"`
	TxHash      string `json:"txHash"`
	AuditHash   string `json:"auditHash"`
}

type BFTTransparencyEntry struct {
	chain.TransparencyEntry
	Signer      string `json:"signer"`
	BlockHeight int64  `json:"blockHeight"`
	TxHash      string `json:"txHash"`
	AuditHash   string `json:"auditHash"`
}

func isTrustAction(action string) bool {
	switch action {
	case ActionGovernanceCreate, ActionGovernanceReview, ActionGovernanceReject, ActionTrustAppealCreate, ActionTrustAppealResolve, ActionTrustLabelCreate, ActionTrustEvidenceCreate, ActionTrustTrackingCreate:
		return true
	default:
		return false
	}
}

func canonicalTrustActionPayload(action string, raw []byte) ([]byte, error) {
	switch action {
	case ActionGovernanceCreate:
		var p GovernanceRequestPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.Requester, p.Subject, p.Action = strings.ToLower(strings.TrimSpace(p.Requester)), strings.TrimSpace(p.Subject), strings.TrimSpace(p.Action)
		p.AssetType, p.Scope, p.Description = strings.ToLower(strings.TrimSpace(p.AssetType)), strings.TrimSpace(p.Scope), strings.TrimSpace(p.Description)
		var err error
		p.Evidence, err = canonicalBoundedStrings(p.Evidence)
		if err != nil {
			return nil, err
		}
		if !IsNativeAddress(p.Requester) || p.Subject == "" || p.Action == "" {
			return nil, errors.New("governance request requires canonical requester, subject, and action")
		}
		if len(p.Subject) > 256 || len(p.Action) > 256 || len(p.AssetType) > 128 || len(p.Scope) > 512 || len(p.Description) > 2048 || len(p.Evidence) > 16 {
			return nil, errors.New("governance request field exceeds limit")
		}
		return json.Marshal(p)
	case ActionGovernanceReview, ActionGovernanceReject:
		var p GovernanceDecisionPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.RequestID, p.Reviewer, p.Reason = strings.TrimSpace(p.RequestID), strings.ToLower(strings.TrimSpace(p.Reviewer)), strings.TrimSpace(p.Reason)
		if !trustRecordIDPattern.MatchString(p.RequestID) || !IsNativeAddress(p.Reviewer) || len(p.Reason) > 1024 {
			return nil, errors.New("invalid governance decision payload")
		}
		if action == ActionGovernanceReview && p.Reason != "" {
			return nil, errors.New("governance review payload must not include reason")
		}
		return json.Marshal(p)
	case ActionTrustAppealCreate:
		var p TrustAppealPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.RequestID, p.LabelID, p.Subject = strings.TrimSpace(p.RequestID), strings.TrimSpace(p.LabelID), strings.TrimSpace(p.Subject)
		p.Appellant, p.Claimant, p.Reason = strings.ToLower(strings.TrimSpace(p.Appellant)), strings.ToLower(strings.TrimSpace(p.Claimant)), strings.TrimSpace(p.Reason)
		var err error
		p.Evidence, err = canonicalBoundedStrings(p.Evidence)
		if err != nil {
			return nil, err
		}
		if (p.RequestID == "") == (p.LabelID == "") || (p.RequestID != "" && !trustRecordIDPattern.MatchString(p.RequestID)) || (p.LabelID != "" && !trustRecordIDPattern.MatchString(p.LabelID)) || p.Subject == "" || !IsNativeAddress(p.Appellant) || p.Claimant != p.Appellant || p.Reason == "" {
			return nil, errors.New("BFT appeal requires exactly one governance request or Trust label, plus a subject and signer-bound appellant/claimant")
		}
		if len(p.Subject) > 256 || len(p.Reason) > 2048 || len(p.Evidence) > 16 {
			return nil, errors.New("Trust appeal field exceeds limit")
		}
		return json.Marshal(p)
	case ActionTrustLabelCreate:
		var p TrustLabelPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.Issuer = strings.ToLower(strings.TrimSpace(p.Issuer))
		p.Subject, p.SubjectType, p.Address = strings.TrimSpace(p.Subject), strings.ToLower(strings.TrimSpace(p.SubjectType)), strings.TrimSpace(p.Address)
		p.Label, p.LabelType, p.Severity = strings.TrimSpace(p.Label), strings.ToLower(strings.TrimSpace(p.LabelType)), strings.ToLower(strings.TrimSpace(p.Severity))
		p.Source, p.EvidenceHash = strings.TrimSpace(p.Source), strings.ToLower(strings.TrimSpace(p.EvidenceHash))
		p.DisputeStatus, p.LegalStatusUnderYNXChainLaw = strings.ToLower(strings.TrimSpace(p.DisputeStatus)), strings.ToLower(strings.TrimSpace(p.LegalStatusUnderYNXChainLaw))
		p.RejectedExternalRequestReference = strings.TrimSpace(p.RejectedExternalRequestReference)
		p.AssetEffect = strings.ToLower(strings.TrimSpace(p.AssetEffect))
		if p.SubjectType == "" {
			p.SubjectType = "address"
		}
		if p.Subject == "" && p.SubjectType == "address" {
			p.Subject = p.Address
		}
		if p.Address == "" && p.SubjectType == "address" {
			p.Address = p.Subject
		}
		if p.LabelType == "" {
			p.LabelType = "risk"
		}
		if p.Severity == "" {
			p.Severity = chain.SeverityForRiskWeight(p.RiskWeightBps)
		}
		if p.ConfidenceBps == 0 {
			p.ConfidenceBps = 5000
		}
		if p.DisputeStatus == "" {
			p.DisputeStatus = "not_disputed"
		}
		if p.LegalStatusUnderYNXChainLaw == "" {
			p.LegalStatusUnderYNXChainLaw = "advisory_label_only_not_criminal_determination"
		}
		if p.AssetEffect == "" {
			p.AssetEffect = "none_advisory_only"
		}
		if !IsNativeAddress(p.Issuer) || p.Subject == "" || p.Label == "" || p.Source == "" || p.EvidenceHash == "" || !p.AppealAvailable {
			return nil, errors.New("Trust label requires signer-bound issuer, subject, label, source, evidence hash, and appeal path")
		}
		if p.SubjectType != "address" && p.SubjectType != "transaction" || p.SubjectType == "transaction" && (p.Address != "" || !trustTransactionHashPattern.MatchString(strings.ToLower(p.Subject))) || !trustEvidenceHashPattern.MatchString(p.EvidenceHash) || p.RiskWeightBps < 0 || p.RiskWeightBps > 10000 || p.ConfidenceBps < 0 || p.ConfidenceBps > 10000 || p.ExpiryHours < 0 || p.ExpiryHours > 24*365 || p.AssetEffect != "none_advisory_only" || p.LegalStatusUnderYNXChainLaw != "advisory_label_only_not_criminal_determination" {
			return nil, errors.New("Trust label violates subject, score, expiry, or advisory-only boundaries")
		}
		if len(p.Subject) > 256 || len(p.Label) > 128 || len(p.Source) > 256 || len(p.EvidenceHash) > 128 || len(p.LegalStatusUnderYNXChainLaw) > 256 || len(p.RejectedExternalRequestReference) > 256 {
			return nil, errors.New("Trust label field exceeds limit")
		}
		return json.Marshal(p)
	case ActionTrustEvidenceCreate:
		var p TrustEvidencePayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.Requester, p.Subject = strings.ToLower(strings.TrimSpace(p.Requester)), strings.TrimSpace(p.Subject)
		if !IsNativeAddress(p.Requester) || p.Subject == "" || len(p.Subject) > 256 {
			return nil, errors.New("Trust evidence requires signer-bound requester and bounded subject")
		}
		return json.Marshal(p)
	case ActionTrustTrackingCreate:
		var p TrustTrackingPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.Requester = strings.ToLower(strings.TrimSpace(p.Requester))
		p.Subject, p.Purpose, p.QueryType = strings.TrimSpace(p.Subject), strings.TrimSpace(p.Purpose), strings.ToLower(strings.TrimSpace(p.QueryType))
		p.Scope, p.Description = strings.TrimSpace(p.Scope), strings.TrimSpace(p.Description)
		var err error
		p.Evidence, err = canonicalBoundedStrings(p.Evidence)
		if err != nil {
			return nil, err
		}
		if !IsNativeAddress(p.Requester) || p.Subject == "" || p.Purpose == "" || p.QueryType == "" || p.ConfidenceBps < 0 || p.ConfidenceBps > 10000 || p.ExpiryHours < 0 || p.ExpiryHours > 24*365 || len(p.Subject) > 256 || len(p.Purpose) > 512 || len(p.QueryType) > 128 || len(p.Scope) > 512 || len(p.Description) > 2048 || len(p.Evidence) > 16 {
			return nil, errors.New("invalid Trust tracking review payload")
		}
		return json.Marshal(p)
	case ActionTrustAppealResolve:
		var p TrustAppealDecisionPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.AppealID, p.Reviewer = strings.TrimSpace(p.AppealID), strings.ToLower(strings.TrimSpace(p.Reviewer))
		p.Decision, p.ResolutionReason = strings.ToUpper(strings.TrimSpace(p.Decision)), strings.TrimSpace(p.ResolutionReason)
		if !trustRecordIDPattern.MatchString(p.AppealID) || !IsNativeAddress(p.Reviewer) || p.ResolutionReason == "" || len(p.ResolutionReason) > 2048 || !validAppealDecision(p.Decision) {
			return nil, errors.New("invalid Trust appeal decision payload")
		}
		return json.Marshal(p)
	default:
		return nil, errors.New("unsupported Trust application action")
	}
}

func canonicalBoundedStrings(values []string) ([]string, error) {
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if len(value) > 256 {
			return nil, errors.New("Trust evidence reference exceeds limit")
		}
		if value != "" {
			out = append(out, value)
		}
	}
	return out, nil
}

func validAppealDecision(value string) bool {
	switch value {
	case "UNDER_REVIEW", "NEEDS_MORE_EVIDENCE", "ACCEPTED", "REJECTED", "LABEL_REMOVED", "LABEL_REDUCED":
		return true
	default:
		return false
	}
}

func trustEvidenceHash(values []string, reason string) string {
	payload, _ := json.Marshal(struct {
		Domain   string   `json:"domain"`
		Evidence []string `json:"evidence"`
		Reason   string   `json:"reason"`
	}{"YNX_TRUST_CORRECTION_EVIDENCE_V1", values, reason})
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}
