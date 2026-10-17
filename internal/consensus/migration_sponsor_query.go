package consensus

import (
	"encoding/json"
	"sort"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

type sourceSponsorshipView struct {
	chain.ResourceSponsorship
	SourceAnchor string `json:"sourceAnchor"`
}
type sourceSponsorIDView struct {
	chain.ResourceSponsorIdempotency
	SourceAnchor string `json:"sourceAnchor"`
}
type sourceSponsorAuditView struct {
	chain.ResourceSponsorAuditEvent
	SourceAnchor string `json:"sourceAnchor"`
}
type sourceSponsorRefView struct {
	ActionReference string `json:"actionReference"`
	SponsorshipID   string `json:"sponsorshipId"`
	SourceAnchor    string `json:"sourceAnchor"`
}

// The existing live sponsor query paths include both source and new records.
// Source records carry an explicit checkpoint anchor and retain original
// fields; they never claim an invented native BFT transaction or signer.
func queryLegacySponsor(response *abcitypes.ResponseQuery, path string, s CommittedState) bool {
	source := s.LegacyResourceSponsor
	if path == "/resource/sponsor-source" {
		response.Value, _ = json.Marshal(source)
		return true
	}
	if source == nil {
		return false
	}
	switch {
	case path == "/resource/sponsorships":
		type item struct {
			id    string
			value any
		}
		items := make([]item, 0, len(source.Sponsors)+len(s.ResourceSponsorships))
		for id, value := range source.Sponsors {
			items = append(items, item{id, sourceSponsorshipView{value, source.SourceAnchor}})
		}
		for _, value := range s.ResourceSponsorships {
			items = append(items, item{value.ID, value})
		}
		sort.Slice(items, func(i, j int) bool { return items[i].id < items[j].id })
		values := make([]any, len(items))
		for i := range items {
			values[i] = items[i].value
		}
		response.Value, _ = json.Marshal(values)
		return true
	case strings.HasPrefix(path, "/resource/sponsorships/"):
		if value, ok := source.Sponsors[strings.TrimPrefix(path, "/resource/sponsorships/")]; ok {
			response.Value, _ = json.Marshal(sourceSponsorshipView{value, source.SourceAnchor})
			return true
		}
	case strings.HasPrefix(path, "/resource/sponsor-idempotency/"):
		id := strings.TrimPrefix(path, "/resource/sponsor-idempotency/")
		for _, value := range source.IDs {
			if value.ID == id || ResourceSponsorIdempotencyID(value.Signer, value.Key) == id {
				response.Value, _ = json.Marshal(sourceSponsorIDView{value, source.SourceAnchor})
				return true
			}
		}
	case path == "/resource/sponsor-audit":
		values := make([]any, 0, len(source.Audit)+len(s.ResourceSponsorAudit))
		for _, value := range source.Audit {
			values = append(values, sourceSponsorAuditView{value, source.SourceAnchor})
		}
		for _, value := range s.ResourceSponsorAudit {
			values = append(values, value)
		}
		response.Value, _ = json.Marshal(values)
		return true
	case path == "/resource/sponsor-action-refs":
		keys := make([]string, 0, len(source.ActionRefs))
		for ref := range source.ActionRefs {
			keys = append(keys, ref)
		}
		sort.Strings(keys)
		values := make([]any, 0, len(keys)+len(s.ResourceSponsorActionRefs))
		for _, key := range keys {
			values = append(values, sourceSponsorRefView{key, source.ActionRefs[key], source.SourceAnchor})
		}
		for _, value := range s.ResourceSponsorActionRefs {
			values = append(values, value)
		}
		response.Value, _ = json.Marshal(values)
		return true
	}
	return false
}
