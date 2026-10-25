package consensus

import (
	"encoding/json"
	"sort"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

type legacyAIProvenance struct {
	SourceAnchor     string `json:"sourceAnchor"`
	SourceKind       string `json:"sourceKind"`
	Authorization    string `json:"authorization"`
	RequesterBinding string `json:"requesterBinding"`
	Writable         bool   `json:"writable"`
	MutationFence    string `json:"mutationFence"`
}

type sourceAIPermissionView struct {
	chain.AIPermissionGrant
	legacyAIProvenance
}
type sourceAIActionView struct {
	chain.AIActionProposal
	legacyAIProvenance
}
type sourceAIAuditView struct {
	chain.TransparencyEntry
	legacyAIProvenance
}

func sourceAIProvenance(anchor, requester string) legacyAIProvenance {
	binding := "opaque_requester_unbound"
	if IsNativeAddress(requester) {
		binding = "canonical_requester_unproven"
	}
	return legacyAIProvenance{SourceAnchor: anchor, SourceKind: "authoritative_producer_source",
		Authorization: "historical_claim_only", RequesterBinding: binding, Writable: false,
		MutationFence: "signed_principal_binding_missing"}
}

// The caller supplies its validated committed source segment under the normal
// query lock. A source action's original Executable flag remains intact, but
// the separate provenance explicitly refuses to turn it into BFT authority.
func queryLegacyAISource(response *abcitypes.ResponseQuery, path string, source *LegacyAISource, state CommittedState) bool {
	if path == "/ai/source" {
		response.Value, _ = json.Marshal(source)
		return true
	}
	if path == "/ai/source/authority-requirements" {
		response.Value, _ = json.Marshal(sourceAIAuthorityRequirements(source))
		return true
	}
	if source == nil {
		return false
	}
	type item struct {
		id    string
		value any
	}
	encode := func(items []item) {
		sort.Slice(items, func(i, j int) bool { return items[i].id < items[j].id })
		values := make([]any, len(items))
		for i := range items {
			values[i] = items[i].value
		}
		response.Value, _ = json.Marshal(values)
	}
	switch {
	case path == "/ai/permissions":
		items := make([]item, 0, len(source.Permissions)+len(state.AIPermissions))
		for id, value := range source.Permissions {
			items = append(items, item{id, sourceAIPermissionView{value, sourceAIProvenance(source.SourceAnchor, value.Requester)}})
		}
		for _, value := range state.AIPermissions {
			items = append(items, item{value.ID, value})
		}
		encode(items)
		return true
	case strings.HasPrefix(path, "/ai/permissions/"):
		id := strings.TrimSpace(strings.TrimPrefix(path, "/ai/permissions/"))
		if value, ok := source.Permissions[id]; ok {
			response.Key = []byte(id)
			response.Value, _ = json.Marshal(sourceAIPermissionView{value, sourceAIProvenance(source.SourceAnchor, value.Requester)})
			return true
		}
	case path == "/ai/actions":
		items := make([]item, 0, len(source.Actions)+len(state.AIActions))
		for id, value := range source.Actions {
			items = append(items, item{id, sourceAIActionView{value, sourceAIProvenance(source.SourceAnchor, value.Requester)}})
		}
		for _, value := range state.AIActions {
			items = append(items, item{value.ID, value})
		}
		encode(items)
		return true
	case strings.HasPrefix(path, "/ai/actions/"):
		id := strings.TrimSpace(strings.TrimPrefix(path, "/ai/actions/"))
		if value, ok := source.Actions[id]; ok {
			response.Key = []byte(id)
			response.Value, _ = json.Marshal(sourceAIActionView{value, sourceAIProvenance(source.SourceAnchor, value.Requester)})
			return true
		}
	case path == "/ai/audit":
		items := make([]item, 0, len(source.Transparency)+len(state.AIAuditEvents))
		for id, value := range source.Transparency {
			items = append(items, item{id, sourceAIAuditView{value, sourceAIProvenance(source.SourceAnchor, value.Subject)}})
		}
		for _, value := range state.AIAuditEvents {
			items = append(items, item{value.ID, value})
		}
		encode(items)
		return true
	}
	return false
}
