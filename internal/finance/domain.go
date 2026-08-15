package finance

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

func toDecimalString(value int64) string {
	return strconv.FormatInt(value, 10)
}

func domainSourceFromUpstreams(portfolio Portfolio, build string) DomainSource {
	if strings.TrimSpace(build) == "" {
		build = "finance-service"
	}
	classification := "testnet"
	if portfolio.ExplorerStatus.Available && portfolio.PayStatus.Available {
		classification = "authoritative"
	} else if portfolio.ExplorerStatus.Available || portfolio.PayStatus.Available {
		classification = "verified-index"
	}
	status := "unavailable"
	switch {
	case portfolio.ExplorerStatus.Available && portfolio.PayStatus.Available:
		status = "live"
	case portfolio.ExplorerStatus.Available || portfolio.PayStatus.Available:
		status = "partial"
	case strings.TrimSpace(portfolio.ExplorerStatus.SyncStatus) != "" || strings.TrimSpace(portfolio.PayStatus.SyncStatus) != "":
		status = "stale"
	default:
		status = "unavailable"
	}
	asOf := portfolio.AsOf
	asOfValue := asOf.UTC().Format(time.RFC3339)
	if asOf.IsZero() {
		asOfValue = time.Now().UTC().Format(time.RFC3339)
	}
	return DomainSource{
		Owner:          "finance-consumer",
		System:         "ynx-finance",
		Version:        build,
		AsOf:           asOfValue,
		Classification: classification,
		Status:         status,
	}
}

func (s *Service) DomainPortfolio(account string, observed Portfolio, build string) DomainPortfolio {
	portfolioID := fmt.Sprintf("finance:%s:%s", ChainID, account)
	totalValue := observed.BalanceYNXT + observed.StakedYNXT
	holdings := make([]DomainHolding, 0, 2)
	if observed.BalanceYNXT != 0 || observed.StakedYNXT != 0 {
		holdings = append(holdings, DomainHolding{
			AssetID:   "YNXT",
			Available: toDecimalString(observed.BalanceYNXT),
			Staked:    toDecimalString(observed.StakedYNXT),
			Total:     toDecimalString(totalValue),
		})
	}
	return DomainPortfolio{
		SchemaVersion:    FinanceDomainVersion,
		Source:           domainSourceFromUpstreams(observed, build),
		PortfolioID:      portfolioID,
		AccountID:        account,
		ValuationAssetID: "YNXT",
		TotalValue:       toDecimalString(totalValue),
		Holdings:         holdings,
	}
}
