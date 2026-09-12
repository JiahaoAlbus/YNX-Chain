package finance

import (
	"math"
	"time"
)

// Available describes the latest bounded response, not a complete history.
// The current Explorer contract has no account-period coverage proof. Never
// infer completeness from an empty page, fewer than 100 records, or sync health.
const boundedActivityCoverage = "latest 100 global indexed transactions filtered to the authorized account; complete period history is not proven"

func addObservedAmount(total, value int64) (int64, bool) {
	if total < 0 || value < 0 || value > math.MaxInt64-total {
		return 0, false
	}
	return total + value, true
}

func budgetObservation(budget Budget, portfolio Portfolio, at time.Time) map[string]any {
	at = at.UTC()
	periodStart := time.Date(at.Year(), at.Month(), 1, 0, 0, 0, 0, time.UTC)
	if budget.Period == "weekly" {
		midnight := time.Date(at.Year(), at.Month(), at.Day(), 0, 0, 0, 0, time.UTC)
		periodStart = midnight.AddDate(0, 0, -(int(at.Weekday())+6)%7)
	}
	from := periodStart
	if budget.StartsAt.After(from) {
		from = budget.StartsAt.UTC()
	}
	result := map[string]any{
		"budgetId": budget.ID, "limitYnxt": budget.LimitYNXT,
		"periodStart": periodStart, "effectiveFrom": from, "asOf": at, "periodTimezone": "UTC",
		"spentYnxt": nil, "remainingYnxt": nil, "observedSpentYnxt": nil,
		"observedActivityCount": nil, "coverageComplete": false,
		"calculationStatus": "unknown", "reason": "activity-source-unavailable",
		"source":   "owned Explorer activity plus user-reviewed categories",
		"coverage": boundedActivityCoverage,
	}
	if budget.Period != "monthly" && budget.Period != "weekly" || budget.StartsAt.IsZero() || budget.LimitYNXT <= 0 {
		result["reason"] = "invalid-budget"
		return result
	}
	if from.After(at) {
		result["calculationStatus"], result["reason"] = "not-started", "budget-starts-in-future"
		return result
	}
	if !portfolio.ExplorerStatus.Available {
		return result
	}
	spent, count := int64(0), 0
	for _, item := range portfolio.Activity {
		if item.Direction != "outgoing" || item.Category != budget.CategoryID {
			continue
		}
		if item.Timestamp.IsZero() {
			result["reason"] = "observed-timestamp-unavailable"
			return result
		}
		if item.Timestamp.Before(from) || item.Timestamp.After(at) {
			continue
		}
		var ok bool
		spent, ok = addObservedAmount(spent, item.Amount)
		if ok {
			spent, ok = addObservedAmount(spent, item.Fee)
		}
		if !ok {
			result["reason"] = "invalid-or-overflowing-observed-amount"
			return result
		}
		count++
	}
	result["observedSpentYnxt"], result["observedActivityCount"] = spent, count
	result["calculationStatus"], result["reason"] = "partial", "bounded-history"
	return result
}

// monthlyActivityObservation separates returned-record sums from unknown full
// period totals. It changes no persisted profile or source records.
func monthlyActivityObservation(portfolio Portfolio, from, to time.Time) map[string]any {
	result := map[string]any{
		"activityCount": nil, "coverageComplete": false, "coverage": boundedActivityCoverage,
		"calculationStatus": "unknown", "reason": "activity-source-unavailable",
		"totals":            map[string]any{"incomingYnxt": nil, "outgoingYnxt": nil, "feesYnxt": nil},
		"categorySpendYnxt": nil, "observedTotals": nil, "observedCategorySpendYnxt": nil,
	}
	if !portfolio.ExplorerStatus.Available {
		return result
	}
	incoming, outgoing, fees, count := int64(0), int64(0), int64(0), 0
	byCategory := map[string]int64{}
	for _, item := range portfolio.Activity {
		if item.Timestamp.IsZero() {
			result["reason"] = "observed-timestamp-unavailable"
			return result
		}
		if item.Timestamp.Before(from) || !item.Timestamp.Before(to) {
			continue
		}
		var ok bool
		fees, ok = addObservedAmount(fees, item.Fee)
		if ok && item.Direction == "incoming" {
			incoming, ok = addObservedAmount(incoming, item.Amount)
		} else if ok && item.Direction == "outgoing" {
			outgoing, ok = addObservedAmount(outgoing, item.Amount)
			if ok {
				byCategory[item.Category], ok = addObservedAmount(byCategory[item.Category], item.Amount)
			}
			if ok {
				byCategory[item.Category], ok = addObservedAmount(byCategory[item.Category], item.Fee)
			}
		} else {
			ok = false
		}
		if !ok {
			result["reason"] = "invalid-or-overflowing-observed-amount"
			return result
		}
		count++
	}
	result["activityCount"] = count
	result["observedTotals"] = map[string]int64{"incomingYnxt": incoming, "outgoingYnxt": outgoing, "feesYnxt": fees}
	result["observedCategorySpendYnxt"] = byCategory
	result["calculationStatus"], result["reason"] = "partial", "bounded-history"
	return result
}
