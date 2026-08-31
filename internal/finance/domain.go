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

func domainEvidenceLabel(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 64 {
		return "not-reported"
	}
	for _, character := range value {
		if (character < 'a' || character > 'z') && (character < 'A' || character > 'Z') && (character < '0' || character > '9') && character != '-' && character != '_' {
			return "not-reported"
		}
	}
	return value
}

func domainSourceEvidence(portfolio Portfolio) (coverage string, syncStatus string, errorCode string) {
	coverage = "explorer:" + domainEvidenceLabel(portfolio.ExplorerStatus.Coverage) + ";pay:" + domainEvidenceLabel(portfolio.PayStatus.Coverage)
	switch {
	case portfolio.ExplorerStatus.Available && portfolio.PayStatus.Available:
		syncStatus = "aggregated-live"
		errorCode = "none"
	case portfolio.ExplorerStatus.Available:
		syncStatus = "aggregated-partial"
		errorCode = "pay-unavailable"
	case portfolio.PayStatus.Available:
		syncStatus = "aggregated-partial"
		errorCode = "explorer-unavailable"
	case strings.TrimSpace(portfolio.ExplorerStatus.SyncStatus) != "" || strings.TrimSpace(portfolio.PayStatus.SyncStatus) != "":
		syncStatus = "aggregated-stale"
		errorCode = "explorer-and-pay-unavailable"
	default:
		syncStatus = "aggregated-unavailable"
		errorCode = "explorer-and-pay-unavailable"
	}
	return coverage, syncStatus, errorCode
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
	coverage, syncStatus, errorCode := domainSourceEvidence(portfolio)
	return DomainSource{
		Owner:          "finance-consumer",
		System:         "ynx-finance",
		Version:        build,
		AsOf:           asOfValue,
		Classification: classification,
		Status:         status,
		Coverage:       coverage,
		SyncStatus:     syncStatus,
		Error:          errorCode,
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
