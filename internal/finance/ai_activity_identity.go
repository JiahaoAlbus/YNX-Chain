package finance

import (
	"errors"
	"strings"
)

// Preserve the ORIGINAL indexed Activity.ID used by classifications, statement
// and budgets. No map overwrite, chosen row, synthesized ID or silent sum can
// make an unavailable/ambiguous source observation suitable for AI context.
func selectOriginalAIActivityContext(activity []Activity, recordIDs []string) ([]Activity, error) {
	original := make(map[string]Activity, len(activity))
	for _, item := range activity {
		if item.ID == "" || strings.TrimSpace(item.ID) != item.ID {
			return nil, errors.New("AI_ACTIVITY_IDENTITY_UNAVAILABLE")
		}
		if _, exists := original[item.ID]; exists {
			return nil, errors.New("AI_ACTIVITY_IDENTITY_AMBIGUOUS")
		}
		original[item.ID] = item
	}
	selected := make([]Activity, 0, len(recordIDs))
	seen := make(map[string]bool, len(recordIDs))
	for _, id := range recordIDs {
		if id == "" || strings.TrimSpace(id) != id || seen[id] {
			return nil, errors.New("AI_SELECTED_ACTIVITY_IDENTITY_AMBIGUOUS")
		}
		seen[id] = true
		item, exists := original[id]
		if !exists {
			return nil, errors.New("AI context contains a record not owned by this account")
		}
		selected = append(selected, item)
	}
	return selected, nil
}
