package consensus

import (
	"encoding/json"
	"sort"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

type sourceResourceDelegationView struct {
	chain.ResourceDelegation
	SourceAnchor string `json:"sourceAnchor"`
}
type sourceResourceRentalView struct {
	chain.ResourceRental
	SourceAnchor string `json:"sourceAnchor"`
}
type sourceResourceIncomeView struct {
	chain.ResourceIncomeRecord
	SourceAnchor string `json:"sourceAnchor"`
}

func queryLegacyResourceMarket(response *abcitypes.ResponseQuery, path string, source *LegacyResourceMarket, state CommittedState) bool {
	if path == "/resource/market-source" {
		response.Value, _ = json.Marshal(source)
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
	case path == "/resource/delegations":
		items := make([]item, 0, len(source.Delegations)+len(state.ResourceDelegations))
		for id, value := range source.Delegations {
			items = append(items, item{id, sourceResourceDelegationView{value, source.SourceAnchor}})
		}
		for _, value := range state.ResourceDelegations {
			items = append(items, item{value.ID, value})
		}
		encode(items)
		return true
	case strings.HasPrefix(path, "/resource/delegations/"):
		if value, ok := source.Delegations[strings.TrimPrefix(path, "/resource/delegations/")]; ok {
			response.Value, _ = json.Marshal(sourceResourceDelegationView{value, source.SourceAnchor})
			return true
		}
	case path == "/resource/rentals":
		items := make([]item, 0, len(source.Rentals)+len(state.ResourceRentals))
		for id, value := range source.Rentals {
			items = append(items, item{id, sourceResourceRentalView{value, source.SourceAnchor}})
		}
		for _, value := range state.ResourceRentals {
			items = append(items, item{value.ID, value})
		}
		encode(items)
		return true
	case strings.HasPrefix(path, "/resource/rentals/"):
		if value, ok := source.Rentals[strings.TrimPrefix(path, "/resource/rentals/")]; ok {
			response.Value, _ = json.Marshal(sourceResourceRentalView{value, source.SourceAnchor})
			return true
		}
	case path == "/resource/income":
		items := make([]item, 0, len(source.Income)+len(state.ResourceIncome))
		for id, value := range source.Income {
			items = append(items, item{id, sourceResourceIncomeView{value, source.SourceAnchor}})
		}
		for _, value := range state.ResourceIncome {
			items = append(items, item{value.ID, value})
		}
		encode(items)
		return true
	case strings.HasPrefix(path, "/resource/quotes/"):
		id := strings.TrimPrefix(path, "/resource/quotes/")
		if _, _, ok := findResourceRecord(state.ResourceQuotes, id, func(v BFTResourceQuote) string { return v.ID }); ok {
			return false
		}
		for _, value := range source.Rentals {
			if value.QuoteID == id {
				response.Code, response.Log = 1, "historical source quote body and expiry were not persisted"
				response.Value, _ = json.Marshal(map[string]string{"sourceAnchor": source.SourceAnchor, "quoteId": id, "status": "source_quote_body_not_persisted"})
				return true
			}
		}
	}
	return false
}
