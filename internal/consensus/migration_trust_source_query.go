package consensus

import (
	"encoding/json"
	"errors"
	"reflect"
	"sort"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

type sourceTrustProvenance struct {
	SourceAnchor               string                   `json:"sourceAnchor"`
	MigrationSource            string                   `json:"migrationSource"`
	Authority                  string                   `json:"authority"`
	ReviewerAuthorityAvailable bool                     `json:"reviewerAuthorityAvailable"`
	Continuation               *LegacyTrustSourceUpdate `json:"continuation,omitempty"`
}
type sourceTrustLabelView struct {
	chain.RiskLabel
	sourceTrustProvenance
}
type sourceTrustEvidenceView struct {
	chain.EvidencePacket
	sourceTrustProvenance
}
type sourceTrustGovernanceView struct {
	chain.GovernanceRequest
	sourceTrustProvenance
}
type sourceTrustAppealView struct {
	chain.TrustAppeal
	sourceTrustProvenance
}
type sourceTrustTrackingView struct {
	chain.TrackingPolicyReview
	sourceTrustProvenance
}
type sourceTrustTransparencyView struct {
	chain.TransparencyEntry
	sourceTrustProvenance
}

func trustSourceProvenance(source *LegacyTrustSource, id string) sourceTrustProvenance {
	p := sourceTrustProvenance{SourceAnchor: source.SourceAnchor, MigrationSource: "authoritative_producer_source", Authority: "historical_claim_only"}
	for _, event := range source.Updates {
		if event.RecordID == id || ApplicationActionRecordID("source-trust-transparency", event.TransactionHash) == id {
			copy := cloneLegacyTrustSource(&LegacyTrustSource{Updates: []LegacyTrustSourceUpdate{event}}).Updates[0]
			p.MigrationSource, p.Authority, p.Continuation = "signed_post_migration", "signed_claimant_only", &copy
			break
		}
	}
	return p
}

// Called under the parent's committed-state Query lock, before the normal
// Trust lookup. No source record is relabeled as an old BFT signed transaction.
func queryLegacyTrustSource(response *abci.ResponseQuery, path string, source *LegacyTrustSource, state CommittedState) bool {
	if source == nil {
		return false
	}
	if !strings.HasPrefix(path, "/trust/") && !strings.HasPrefix(path, "/governance/requests") && path != "/governance/transparency" {
		return false
	}
	if state.Version < 18 || source.SourceAnchor != state.MigrationStateHash || source.SourceChainID != state.ChainID {
		response.Code, response.Log = 1, "source Trust query lacks validated committed anchor"
		return true
	}
	view, err := replayValidatedLegacyTrustSource(source, state, nil)
	if err != nil {
		response.Code, response.Log = 1, err.Error()
		return true
	}
	encode := func(value any) bool {
		raw, err := json.Marshal(value)
		if err != nil {
			response.Code, response.Log = 1, err.Error()
		} else {
			response.Value = raw
		}
		return true
	}
	type item struct {
		id    string
		value any
	}
	encodeList := func(items []item) bool {
		sort.Slice(items, func(i, j int) bool { return items[i].id < items[j].id })
		values := make([]any, len(items))
		for i, v := range items {
			if i > 0 && items[i-1].id == v.id {
				response.Code, response.Log = 1, "source/current Trust ID collision"
				return true
			}
			values[i] = v.value
		}
		return encode(values)
	}
	switch {
	case path == "/trust/source":
		return encode(source)
	case strings.HasPrefix(path, "/governance/requests/"):
		id := strings.TrimPrefix(path, "/governance/requests/")
		if v, ok := view.Governance[id]; ok {
			return encode(sourceTrustGovernanceView{v, trustSourceProvenance(source, id)})
		}
	case strings.HasPrefix(path, "/trust/appeals/"):
		id := strings.TrimPrefix(path, "/trust/appeals/")
		if v, ok := view.Appeals[id]; ok {
			return encode(sourceTrustAppealView{v, trustSourceProvenance(source, id)})
		}
	case strings.HasPrefix(path, "/trust/labels/"):
		id := strings.TrimPrefix(path, "/trust/labels/")
		for _, values := range view.RiskLabels {
			for _, v := range values {
				if v.ID == id {
					return encode(sourceTrustLabelView{v, trustSourceProvenance(source, id)})
				}
			}
		}
	case strings.HasPrefix(path, "/trust/evidence/"):
		id := strings.TrimPrefix(path, "/trust/evidence/")
		if v, ok := view.Evidence[id]; ok {
			return encode(sourceTrustEvidenceView{v, trustSourceProvenance(source, id)})
		}
	case strings.HasPrefix(path, "/trust/tracking-reviews/"):
		id := strings.TrimPrefix(path, "/trust/tracking-reviews/")
		if v, ok := view.Tracking[id]; ok {
			return encode(sourceTrustTrackingView{v, trustSourceProvenance(source, id)})
		}
	case strings.HasPrefix(path, "/trust/trace/"):
		subject := strings.TrimSpace(strings.TrimPrefix(path, "/trust/trace/"))
		if subject == "" {
			response.Code, response.Log = 1, "Trust trace subject is required"
			return true
		}
		trace := buildBFTTrustTrace(state, subject)
		if len(view.RiskLabels[subject]) > 0 {
			trace.Labels = appendUniqueStrings(trace.Labels, "advisory-risk-labels-present", "source-advisory-labels-preserved")
		}
		return encode(trace)
	case path == "/governance/transparency":
		items := make([]item, 0, len(view.Transparency)+len(state.Transparency))
		for id, v := range view.Transparency {
			items = append(items, item{id, sourceTrustTransparencyView{v, trustSourceProvenance(source, id)}})
		}
		for _, v := range state.Transparency {
			items = append(items, item{v.ID, v})
		}
		return encodeList(items)
	case path == "/governance/requests":
		items := make([]item, 0, len(view.Governance)+len(state.GovernanceRequests))
		for id, v := range view.Governance {
			items = append(items, item{id, sourceTrustGovernanceView{v, trustSourceProvenance(source, id)}})
		}
		for _, v := range state.GovernanceRequests {
			items = append(items, item{v.ID, v})
		}
		return encodeList(items)
	case path == "/trust/appeals":
		items := make([]item, 0, len(view.Appeals)+len(state.TrustAppeals))
		for id, v := range view.Appeals {
			items = append(items, item{id, sourceTrustAppealView{v, trustSourceProvenance(source, id)}})
		}
		for _, v := range state.TrustAppeals {
			items = append(items, item{v.ID, v})
		}
		return encodeList(items)
	case path == "/trust/labels":
		items := make([]item, 0, len(state.TrustLabels))
		for _, values := range view.RiskLabels {
			for _, v := range values {
				items = append(items, item{v.ID, sourceTrustLabelView{v, trustSourceProvenance(source, v.ID)}})
			}
		}
		for _, v := range state.TrustLabels {
			items = append(items, item{v.ID, v})
		}
		return encodeList(items)
	case path == "/trust/evidence":
		items := make([]item, 0, len(view.Evidence)+len(state.TrustEvidence))
		for id, v := range view.Evidence {
			items = append(items, item{id, sourceTrustEvidenceView{v, trustSourceProvenance(source, id)}})
		}
		for _, v := range state.TrustEvidence {
			items = append(items, item{v.ID, v})
		}
		return encodeList(items)
	case path == "/trust/tracking-reviews":
		items := make([]item, 0, len(view.Tracking)+len(state.TrackingReviews))
		for id, v := range view.Tracking {
			items = append(items, item{id, sourceTrustTrackingView{v, trustSourceProvenance(source, id)}})
		}
		for _, v := range state.TrackingReviews {
			items = append(items, item{v.ID, v})
		}
		return encodeList(items)
	}
	return false
}

// The normal evidence creator must use this union instead of only newly
// created BFT labels. It changes no old packet or historical risk calculation.
func legacyTrustLabelsWithCurrent(source *LegacyTrustSource, migration chain.ConsensusMigrationState, state CommittedState, subject string) ([]chain.RiskLabel, error) {
	view, err := replayLegacyTrustSource(source, migration, state)
	if err != nil {
		return nil, err
	}
	labels := append([]chain.RiskLabel(nil), view.RiskLabels[subject]...)
	seen := make(map[string]bool, len(labels))
	for _, v := range labels {
		seen[v.ID] = true
	}
	for _, v := range state.TrustLabels {
		if v.Subject != subject {
			continue
		}
		if seen[v.ID] {
			return nil, errors.New("source/current Trust label ID collision")
		}
		seen[v.ID] = true
		labels = append(labels, cloneLegacyTrustValue(reflect.ValueOf(v.RiskLabel)).Interface().(chain.RiskLabel))
	}
	return labels, nil
}
