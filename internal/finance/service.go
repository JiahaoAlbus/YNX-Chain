package finance

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"
)

var colorPattern = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
var idempotencyPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{16,128}$`)

type Service struct {
	Store     *Store
	Upstreams *Upstreams
	AI        AIProvider
	Support   SupportLinks
	aiMu      sync.Mutex
	aiCancels map[string]context.CancelFunc
}

type SupportLinks struct {
	HelpURL    string `json:"helpUrl"`
	PrivacyURL string `json:"privacyUrl"`
	DisputeURL string `json:"disputeUrl"`
}

func (s *Service) AddCategory(account, name, color, idempotencyKey string) (Category, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 48 || !colorPattern.MatchString(color) || !idempotencyPattern.MatchString(idempotencyKey) {
		return Category{}, errors.New("category name or color is invalid")
	}
	now := time.Now().UTC()
	category := Category{ID: newID("cat"), Name: name, Color: strings.ToUpper(color), CreatedAt: now}
	err := s.Store.Update(account, "category.created", category.ID, func(state *AccountState) error {
		if existing := state.Idempotency[idempotencyKey]; existing != "" {
			for _, value := range state.Categories {
				if value.ID == existing {
					category = value
					return nil
				}
			}
			return errors.New("idempotency record is inconsistent")
		}
		if len(state.Categories) >= 64 {
			return errors.New("category limit reached")
		}
		if len(state.Idempotency) >= 1024 {
			return errors.New("idempotency record limit reached")
		}
		for _, existing := range state.Categories {
			if strings.EqualFold(existing.Name, name) {
				return errors.New("category name already exists")
			}
		}
		state.Categories = append(state.Categories, category)
		state.Idempotency[idempotencyKey] = category.ID
		return nil
	})
	return category, err
}

func (s *Service) AddBudget(account, name, categoryID string, limit int64, period string, startsAt time.Time, idempotencyKey string) (Budget, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 64 || limit <= 0 || (period != "weekly" && period != "monthly") || startsAt.IsZero() || !idempotencyPattern.MatchString(idempotencyKey) {
		return Budget{}, errors.New("budget fields are invalid")
	}
	now := time.Now().UTC()
	budget := Budget{ID: newID("budget"), Name: name, CategoryID: categoryID, LimitYNXT: limit, Period: period, StartsAt: startsAt.UTC(), CreatedAt: now, UpdatedAt: now}
	err := s.Store.Update(account, "budget.created", budget.ID, func(state *AccountState) error {
		if existing := state.Idempotency[idempotencyKey]; existing != "" {
			for _, value := range state.Budgets {
				if value.ID == existing {
					budget = value
					return nil
				}
			}
			return errors.New("idempotency record is inconsistent")
		}
		if len(state.Budgets) >= 64 || !categoryExists(*state, categoryID) {
			return errors.New("budget limit reached or category does not exist")
		}
		if len(state.Idempotency) >= 1024 {
			return errors.New("idempotency record limit reached")
		}
		state.Budgets = append(state.Budgets, budget)
		state.Idempotency[idempotencyKey] = budget.ID
		return nil
	})
	return budget, err
}

func (s *Service) Classify(account, recordID, categoryID, idempotencyKey string, activity []Activity) error {
	if !idempotencyPattern.MatchString(idempotencyKey) || strings.TrimSpace(recordID) == "" || strings.TrimSpace(categoryID) == "" {
		return errors.New("record, category and idempotency key are required")
	}
	owned := false
	for _, item := range activity {
		if item.ID == recordID {
			owned = true
			break
		}
	}
	if !owned {
		return errors.New("activity is not owned by this account")
	}
	now := time.Now().UTC()
	return s.Store.Update(account, "activity.classified", recordID, func(state *AccountState) error {
		if existing, ok := state.Idempotency[idempotencyKey]; ok {
			if existing == recordID+":"+categoryID {
				return nil
			}
			return errors.New("idempotency key was already used for another classification")
		}
		if !categoryExists(*state, categoryID) {
			return errors.New("category does not exist")
		}
		state.Classifications[recordID] = Classification{RecordID: recordID, CategoryID: categoryID, Source: "user", UpdatedAt: now}
		state.Idempotency[idempotencyKey] = recordID + ":" + categoryID
		return nil
	})
}

func (s *Service) AddReminder(account, title, schedule, sourceRef string, amount *int64, next time.Time, idempotencyKey string) (Reminder, error) {
	title = strings.TrimSpace(title)
	if title == "" || len(title) > 80 || (schedule != "weekly" && schedule != "monthly" && schedule != "custom") || next.Before(time.Now().UTC().Add(-time.Minute)) || (amount != nil && *amount < 0) || !idempotencyPattern.MatchString(idempotencyKey) {
		return Reminder{}, errors.New("reminder fields are invalid")
	}
	now := time.Now().UTC()
	reminder := Reminder{ID: newID("reminder"), Title: title, Schedule: schedule, SourceRef: strings.TrimSpace(sourceRef), AmountYNXT: amount, NextDueAt: next.UTC(), Enabled: true, CreatedAt: now, UpdatedAt: now}
	err := s.Store.Update(account, "reminder.created", reminder.ID, func(state *AccountState) error {
		if existing := state.Idempotency[idempotencyKey]; existing != "" {
			for _, value := range state.Reminders {
				if value.ID == existing {
					reminder = value
					return nil
				}
			}
			return errors.New("idempotency record is inconsistent")
		}
		if len(state.Reminders) >= 128 {
			return errors.New("reminder limit reached")
		}
		if len(state.Idempotency) >= 1024 {
			return errors.New("idempotency record limit reached")
		}
		state.Reminders = append(state.Reminders, reminder)
		state.Idempotency[idempotencyKey] = reminder.ID
		return nil
	})
	return reminder, err
}

func (s *Service) SetPrivacy(account string, privacy Privacy) error {
	privacy.UpdatedAt = time.Now().UTC()
	return s.Store.Update(account, "privacy.updated", "privacy", func(state *AccountState) error {
		state.Privacy = privacy
		return nil
	})
}

func (s *Service) Alerts(account string, portfolio Portfolio) []map[string]any {
	state := s.Store.Account(account)
	if !state.Privacy.AlertsEnabled {
		return []map[string]any{}
	}
	alerts := []map[string]any{}
	if !portfolio.ExplorerStatus.Available {
		alerts = append(alerts, map[string]any{"id": "explorer-unavailable", "severity": "warning", "title": "Portfolio source unavailable", "detail": portfolio.ExplorerStatus.Error})
	}
	if !portfolio.PayStatus.Available {
		alerts = append(alerts, map[string]any{"id": "pay-unavailable", "severity": "info", "title": "Pay receipts unavailable", "detail": portfolio.PayStatus.Error})
	}
	for _, activity := range portfolio.Activity {
		if activity.Direction == "outgoing" && activity.Amount > portfolio.BalanceYNXT && portfolio.BalanceYNXT >= 0 {
			alerts = append(alerts, map[string]any{"id": "activity-" + activity.ID, "severity": "review", "title": "Large outgoing activity", "recordId": activity.ID, "detail": "Review the indexed transaction in Explorer. Finance cannot freeze or reverse it."})
		}
	}
	return alerts
}

func categoryExists(state AccountState, id string) bool {
	for _, category := range state.Categories {
		if category.ID == id {
			return true
		}
	}
	return false
}

func validateSupportLinks(links SupportLinks) error {
	for label, value := range map[string]string{"help": links.HelpURL, "privacy": links.PrivacyURL, "dispute": links.DisputeURL} {
		if _, err := requireHTTPURL(value); err != nil {
			return fmt.Errorf("%s support URL: %w", label, err)
		}
	}
	return nil
}
