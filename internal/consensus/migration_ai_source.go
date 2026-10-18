package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// LegacyAISource retains source claims in their original audit domain. None of
// these records contains a signed principal or a BFT transaction. In particular,
// Requester, ApprovedBy and Executable are historical data, never new authority.
// The state owner must include this segment in its new hash/version and query
// boundary before replacing the existing AI migration blocker.
type LegacyAISource struct {
	SourceAnchor string                             `json:"sourceAnchor"`
	Permissions  map[string]chain.AIPermissionGrant `json:"permissions"`
	Actions      map[string]chain.AIActionProposal  `json:"actions"`
	Transparency map[string]chain.TransparencyEntry `json:"transparency"`
}

// SourceAIAuthorityRequirement records missing authority, never a substitute
// issuer or approval. Even an address-shaped requester did not sign the old
// operation. A future continuation protocol must bind the original record and
// source anchor to an independently authenticated principal and a fresh intent.
type SourceAIAuthorityRequirement struct {
	RecordID         string `json:"recordId"`
	RecordType       string `json:"recordType"`
	Requester        string `json:"requester"`
	RequesterBinding string `json:"requesterBinding"`
	Reason           string `json:"reason"`
}

func sourceAIAuthorityRequirements(source *LegacyAISource) []SourceAIAuthorityRequirement {
	if source == nil {
		return nil
	}
	result := make([]SourceAIAuthorityRequirement, 0, len(source.Permissions)+len(source.Actions))
	add := func(id, kind, requester string) {
		result = append(result, SourceAIAuthorityRequirement{RecordID: id, RecordType: kind, Requester: requester,
			RequesterBinding: sourceAIProvenance(source.SourceAnchor, requester).RequesterBinding,
			Reason:           "source record has no signed principal; continuation requires an independently authorized binding to this source anchor and original record plus a fresh signed intent"})
	}
	for id, permission := range source.Permissions {
		add(id, "permission", permission.Requester)
	}
	for id, action := range source.Actions {
		add(id, "action", action.Requester)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].RecordID == result[j].RecordID {
			return result[i].RecordType < result[j].RecordType
		}
		return result[i].RecordID < result[j].RecordID
	})
	return result
}

func migrationAISource(m chain.ConsensusMigrationState) *LegacyAISource {
	if m.Runtime == nil {
		return nil
	}
	entries := make(map[string]chain.TransparencyEntry)
	for id, entry := range m.Runtime.Transp {
		if strings.HasPrefix(entry.Type, "ai_") {
			entries[id] = entry
		}
	}
	// Include referenced entries even when their type is corrupt. Validation
	// must reject them, not silently drop the only surviving source reference.
	for _, action := range m.Runtime.AIActions {
		if entry, ok := m.Runtime.Transp[action.TransparencyEntryID]; ok {
			entries[action.TransparencyEntryID] = entry
		}
	}
	if len(m.Runtime.AIPerms)+len(m.Runtime.AIActions)+len(entries) == 0 {
		return nil
	}
	return cloneLegacyAISource(&LegacyAISource{m.StateHash, m.Runtime.AIPerms, m.Runtime.AIActions, entries})
}

func cloneLegacyAISource(source *LegacyAISource) *LegacyAISource {
	if source == nil {
		return nil
	}
	out := &LegacyAISource{SourceAnchor: source.SourceAnchor}
	if source.Permissions != nil {
		out.Permissions = make(map[string]chain.AIPermissionGrant, len(source.Permissions))
		for id, value := range source.Permissions {
			out.Permissions[id] = value
		}
	}
	if source.Actions != nil {
		out.Actions = make(map[string]chain.AIActionProposal, len(source.Actions))
		for id, value := range source.Actions {
			value.Reasons = cloneLegacyAIReasons(value.Reasons)
			if value.ApprovedAt != nil {
				value.ApprovedAt = timePointer(*value.ApprovedAt)
			}
			if value.RejectedAt != nil {
				value.RejectedAt = timePointer(*value.RejectedAt)
			}
			out.Actions[id] = value
		}
	}
	if source.Transparency != nil {
		out.Transparency = make(map[string]chain.TransparencyEntry, len(source.Transparency))
		for id, value := range source.Transparency {
			value.Reasons = cloneLegacyAIReasons(value.Reasons)
			out.Transparency[id] = value
		}
	}
	return out
}

func cloneLegacyAIReasons(reasons []string) []string {
	if reasons == nil {
		return nil
	}
	out := make([]string, len(reasons))
	copy(out, reasons)
	return out
}

// validateLegacyAISource compares the entire source segment, not just the old
// audit hashes (which do not cover every field). The separately validated and
// pinned migration is the trust boundary; this helper cannot authenticate a
// self-reported migration. It never evaluates expiry against today's clock.
func validateLegacyAISource(source *LegacyAISource, state CommittedState, m chain.ConsensusMigrationState) error {
	if source != nil && state.Version < 18 {
		return errors.New("legacy committed version cannot carry source AI records")
	}
	if !reflect.DeepEqual(source, migrationAISource(m)) {
		return errors.New("source AI records differ from the complete migration checkpoint")
	}
	if source == nil {
		return nil
	}
	if !payHashPattern.MatchString(source.SourceAnchor) {
		return errors.New("source AI migration anchor is invalid")
	}
	for id, value := range source.Permissions {
		if id != value.ID || !payIDPattern.MatchString(id) || value.SessionID == "" || value.Requester == "" || value.Scope == "" || value.Purpose == "" || value.Status != "active" || value.CreatedAt.IsZero() || !value.ExpiresAt.After(value.CreatedAt) {
			return errors.New("source AI permission is incomplete")
		}
		if id != legacyAIHash("ai-permission", value.SessionID, value.Requester, value.Scope, fmt.Sprint(value.CreatedAt.UnixNano()))[:24] || value.AuditHash != legacyAIPermissionHash(value) {
			return errors.New("source AI permission original identity or audit hash mismatch")
		}
	}
	for id, value := range source.Actions {
		if id != value.ID || !payIDPattern.MatchString(id) || value.SessionID == "" || value.Requester == "" || value.Scope == "" || value.ActionType == "" || value.Description == "" || value.CreatedAt.IsZero() || !value.ExpiresAt.After(value.CreatedAt) || value.Sensitive != value.RequiresApproval {
			return errors.New("source AI action is incomplete")
		}
		if id != legacyAIHash("ai-action", value.SessionID, value.Requester, value.ActionType, fmt.Sprint(value.CreatedAt.UnixNano()))[:24] || value.AuditHash != legacyAIActionHash(value) {
			return errors.New("source AI action original identity or audit hash mismatch")
		}
		if err := validateLegacyAIDecisions(value, source.Permissions); err != nil {
			return err
		}
		entry, ok := source.Transparency[value.TransparencyEntryID]
		if !ok || entry.RequestID != id || entry.Status != value.Status || !reflect.DeepEqual(entry.Reasons, value.Reasons) {
			return errors.New("source AI action lost its final transparency entry")
		}
		want := "ai_action_proposal"
		if value.Status == "approved" {
			want = "ai_action_approval"
		} else if value.Status == "rejected" {
			want = "ai_action_rejection"
		}
		if entry.Type != want {
			return errors.New("source AI final transparency entry has the wrong operation")
		}
	}
	proposals, approvals, rejections := map[string]int{}, map[string]int{}, map[string]int{}
	for id, entry := range source.Transparency {
		action, ok := source.Actions[entry.RequestID]
		if id != entry.ID || !payIDPattern.MatchString(id) || !ok || entry.AppealID != "" || entry.Subject != action.Requester || entry.Action != action.ActionType || entry.CreatedAt.IsZero() || entry.CreatedAt.Before(action.CreatedAt) {
			return errors.New("source AI transparency entry has no matching original action")
		}
		switch entry.Type {
		case "ai_action_proposal":
			proposals[action.ID]++
			status, classification := "logged", chain.RequestValidUnderYNXChainLaw
			if action.Sensitive {
				status, classification = "pending_approval", chain.RequestRequiresReview
			}
			if entry.Status != status || entry.Classification != classification {
				return errors.New("source AI proposal transparency status is invalid")
			}
		case "ai_action_approval":
			approvals[action.ID]++
			if entry.Status != "approved" || entry.Classification != chain.RequestRequiresReview {
				return errors.New("source AI approval transparency status is invalid")
			}
		case "ai_action_rejection":
			rejections[action.ID]++
			if entry.Status != "rejected" || entry.Classification != chain.RequestRejected {
				return errors.New("source AI rejection transparency status is invalid")
			}
		default:
			return errors.New("unsupported source AI transparency operation")
		}
		// The source took separate clock samples for the ID and CreatedAt, so
		// CreatedAt cannot reconstruct its ID. Exact migration equality above
		// preserves those original bytes; do not invent a replacement ID.
	}
	for id, action := range source.Actions {
		if proposals[id] != 1 || (approvals[id] == 0) != (action.ApprovedAt == nil) || (rejections[id] == 0) != (action.RejectedAt == nil) {
			return errors.New("source AI decision history is incomplete")
		}
	}
	for _, value := range state.AIPermissions {
		if _, ok := source.Permissions[value.ID]; ok {
			return errors.New("BFT permission shadows an unsigned source AI permission")
		}
	}
	for _, value := range state.AIActions {
		if _, ok := source.Actions[value.ID]; ok {
			return errors.New("BFT action shadows an unsigned source AI action")
		}
		if _, ok := source.Permissions[value.PermissionID]; ok {
			return errors.New("BFT action claims authority from an unsigned source AI permission")
		}
	}
	for _, value := range state.AIAuditEvents {
		_, permission := source.Permissions[value.RecordID]
		_, action := source.Actions[value.RecordID]
		_, transparency := source.Transparency[value.ID]
		if permission || action || transparency {
			return errors.New("BFT audit event invents signer provenance for a source AI record")
		}
	}
	return nil
}

func validateLegacyAIDecisions(value chain.AIActionProposal, permissions map[string]chain.AIPermissionGrant) error {
	if (value.ApprovedAt == nil) != (value.ApprovedBy == "") || (value.RejectedAt == nil) != (value.RejectedBy == "") {
		return errors.New("source AI decision timestamp and reviewer are incomplete")
	}
	if value.ApprovedAt != nil {
		permission, ok := permissions[value.PermissionID]
		if !ok || value.ApprovedAt.Before(value.CreatedAt) || permission.SessionID != value.SessionID || permission.Requester != value.Requester || permission.Scope != value.Scope && permission.Scope != "all_sensitive_actions" {
			return errors.New("source AI approval lost its original scoped permission")
		}
		// The old producer checked expiry before taking a second time.Now for
		// ApprovedAt. The precise check instant was not persisted; do not claim
		// a fresh or historical signed authorization from these timestamps.
	} else if value.PermissionID != "" {
		return errors.New("source AI permission reference lacks its approval metadata")
	}
	if value.RejectedAt != nil && value.RejectedAt.Before(value.CreatedAt) {
		return errors.New("source AI rejection predates its proposal")
	}
	switch value.Status {
	case "pending_approval":
		if value.Executable || !value.Sensitive || value.ApprovedAt != nil || value.RejectedAt != nil {
			return errors.New("source AI pending state is inconsistent")
		}
	case "logged":
		if !value.Executable || value.Sensitive || value.ApprovedAt != nil || value.RejectedAt != nil {
			return errors.New("source AI logged state is inconsistent")
		}
	case "approved":
		if !value.Executable || value.ApprovedAt == nil {
			return errors.New("source AI approved state is inconsistent")
		}
	case "rejected":
		if value.Executable || value.RejectedAt == nil {
			return errors.New("source AI rejected state is inconsistent")
		}
	default:
		return errors.New("unsupported source AI action status")
	}
	return nil
}

// Called after normal SignedApplicationAction verification and before charging
// fees or changing a candidate. It grants no authority and mutates no state.
// Even a canonical Requester is not evidence that the source operation was
// signed. New native records continue through their original signed path.
func rejectLegacyAIActionWrite(source *LegacyAISource, tx SignedApplicationAction, txHash string) error {
	if source == nil {
		return nil
	}
	switch tx.Action {
	case ActionAIPermissionCreate:
		if _, ok := source.Permissions[ApplicationActionRecordID("ai-permission", txHash)]; ok {
			return errors.New("new AI permission would shadow source history")
		}
	case ActionAIProposalCreate:
		if _, ok := source.Actions[ApplicationActionRecordID("ai-action", txHash)]; ok {
			return errors.New("new AI proposal would shadow source history")
		}
	case ActionAIProposalApprove, ActionAIProposalReject:
		var input AIActionDecisionPayload
		if err := json.Unmarshal(tx.Payload, &input); err != nil {
			return err
		}
		if _, ok := source.Actions[input.ActionID]; ok {
			return errors.New("source AI action has no signed principal binding; new decision is fenced")
		}
		if _, ok := source.Permissions[input.PermissionID]; ok {
			return errors.New("unsigned source AI permission cannot authorize a new BFT decision")
		}
	}
	return nil
}

func legacyAIHash(parts ...string) string {
	h := sha256.New()
	for _, part := range parts {
		_, _ = h.Write([]byte(part))
		_, _ = h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

func legacyAIPermissionHash(value chain.AIPermissionGrant) string {
	return legacyAIHash("ai-permission-audit", value.ID, value.SessionID, value.Requester, value.Scope, value.Purpose, value.Status, value.ExpiresAt.Format(time.RFC3339Nano))
}

func legacyAIActionHash(value chain.AIActionProposal) string {
	approved, rejected := "", ""
	if value.ApprovedAt != nil {
		approved = value.ApprovedAt.Format(time.RFC3339Nano)
	}
	if value.RejectedAt != nil {
		rejected = value.RejectedAt.Format(time.RFC3339Nano)
	}
	return legacyAIHash("ai-action-audit", value.ID, value.SessionID, value.Requester, value.Scope, value.ActionType, value.Status, fmt.Sprint(value.Executable), value.PermissionID, approved, value.ApprovedBy, rejected, value.RejectedBy, strings.Join(value.Reasons, "|"))
}
