package aiproduct

import (
	"encoding/json"
	"reflect"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aigateway"
)

// Fixed service-owned selection schema only. Semantic validation additionally
// enforces the original ID byte bound, 128-lowercase-hex snapshot, and exact
// nine-field allowlist before a proposal or protected operation can be made.
// This provider-facing supported schema subset is not the registered schema
// hash: the Auth Tool binds the exact original Shop schema artifact bytes.
func taskShopOrderModelDefinition() aigateway.ToolDefinition {
	return aigateway.ToolDefinition{Name: shopOrderModelName, Description: "Read exactly one authorized Shop order. Shop derives buyer/seller permissions from the authenticated account; never supply role. orderId must contain 1 to 256 UTF-8 bytes. snapshot must be the selected original 128 lowercase hex snapshot. fields must select only status, currency, totalYNXT, subtotalYNXT, shippingYNXT, taxYNXT, createdAt, updatedAt, reservationExpiresAt. Never choose account, tenant, risk, schema, provider, URL or credentials.", Parameters: json.RawMessage(`{"type":"object","properties":{"orderId":{"type":"string"},"snapshot":{"type":"string"},"fields":{"type":"array","items":{"type":"string"}}},"required":["orderId","snapshot","fields"],"additionalProperties":false}`)}
}

func taskModelToolID(name string) string {
	switch name {
	case taskWebDAVModelName:
		return taskWebDAVToolID
	case "ynx_conversation_read_v1":
		return "ai.conversation.read"
	case shopOrderModelName:
		return shopOrderToolID
	}
	return ""
}

func taskModelDefinitionsForRun(run taskModelRun) ([]aigateway.ToolDefinition, error) {
	ids := run.ToolIDs
	if len(ids) == 0 {
		ids = []string{"ai.conversation.read"}
	} // Legacy checkpoints remain pinned.
	definitions := []aigateway.ToolDefinition{}
	if len(ids) > 3 {
		return nil, errToolInvalid
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			return nil, errToolInvalid
		}
		seen[id] = true
		found := false
		for _, definition := range taskModelTools() {
			if taskModelToolID(definition.Name) == id {
				definitions = append(definitions, definition)
				found = true
				break
			}
		}
		if !found {
			return nil, errToolInvalid
		}
	}
	return definitions, nil
}

func (s *Store) taskModelSelectedToolsLocked(task TaskRecord, requested []string) ([]string, error) {
	if len(requested) == 0 {
		requested = []string{"ai.conversation.read"} // Original default unchanged.
		if task.AgentConfigurationID != "" {
			requested = s.state.AgentConfigurations[task.AgentConfigurationID].ToolIDs
		}
	}
	if len(requested) == 0 || len(requested) > 3 {
		return nil, errToolInvalid
	}
	seen := map[string]bool{}
	ids := append([]string(nil), requested...)
	for _, id := range ids {
		if _, known := lookupTool(id); !known || seen[id] {
			return nil, errToolInvalid
		}
		seen[id] = true
		if err := s.assertTaskAgentConfigurationLocked(task, id); err != nil {
			return nil, err
		}
	}
	return ids, nil
}

func validateTaskModelRequestedTools(run taskModelRun, requested []string) error {
	if len(requested) == 0 {
		return nil
	}
	ids := run.ToolIDs
	if len(ids) == 0 {
		ids = []string{"ai.conversation.read"}
	}
	if !reflect.DeepEqual(ids, requested) {
		return errToolConflict
	}
	return nil
}
