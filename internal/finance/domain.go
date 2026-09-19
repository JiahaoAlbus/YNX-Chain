package finance

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

func toDecimalString(value int64) string {
	return strconv.FormatInt(value, 10)
}

func observedYNXTTotal(portfolio Portfolio) (int64, string, bool) {
	accountEvidenceAvailable := portfolio.ExplorerStatus.Available || portfolio.ExplorerStatus.SyncStatus == "partial-account-only"
	if !accountEvidenceAvailable {
		return 0, "explorer_account_evidence_unavailable", false
	}
	if portfolio.BalanceYNXT < 0 || portfolio.StakedYNXT < 0 || portfolio.BalanceYNXT > math.MaxInt64-portfolio.StakedYNXT {
		return 0, "explorer_account_amount_invalid", false
	}
	return portfolio.BalanceYNXT + portfolio.StakedYNXT, "", true
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
	holdings := make([]DomainHolding, 0, 1)
	valuationStatus := "unavailable"
	valuationReason := "explorer_account_evidence_unavailable"
	totalValue := ""
	if observedTotal, reason, ok := observedYNXTTotal(observed); ok {
		valuationStatus = "observed"
		valuationReason = ""
		totalValue = toDecimalString(observedTotal)
		holdings = append(holdings, DomainHolding{
			AssetID:   "YNXT",
			Available: toDecimalString(observed.BalanceYNXT),
			Staked:    toDecimalString(observed.StakedYNXT),
			Total:     toDecimalString(observedTotal),
		})
	} else {
		valuationReason = reason
	}
	return DomainPortfolio{
		SchemaVersion:    FinanceDomainVersion,
		Source:           domainSourceFromUpstreams(observed, build),
		PortfolioID:      portfolioID,
		AccountID:        account,
		ValuationAssetID: "YNXT",
		ValuationStatus:  valuationStatus,
		ValuationReason:  valuationReason,
		TotalValue:       totalValue,
		Holdings:         holdings,
	}
}
