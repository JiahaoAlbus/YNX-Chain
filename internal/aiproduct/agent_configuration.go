package aiproduct

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	agentConfigurationModel      = "gateway.configured"
	agentConfigurationMaxIDBytes = 128
	agentConfigurationMaxTools   = 32
)

var (
	ErrAgentConfigurationInvalid     = errors.New("invalid agent configuration")
	ErrAgentConfigurationConflict    = ErrTaskConflict
	ErrAgentConfigurationUnavailable = errors.New("task agent configuration is unavailable, paused or stale")
)

// AgentConfiguration is an owner-scoped product CONFIG object. It is not an
// Auth agent principal, identity, delegation, Grant, approval or execution right.
// gateway.configured refers only to the existing pinned gateway configuration;
// selecting or enabling this object cannot switch its provider/model or mode.
type AgentConfiguration struct {
	ID        string    `json:"id"`
	Account   string    `json:"account"`
	Name      string    `json:"name"`
	ModelRef  string    `json:"modelRef"`
	State     string    `json:"state"`
	ToolIDs   []string  `json:"toolIds"`
	Revision  uint64    `json:"revision"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func cloneAgentConfiguration(configuration AgentConfiguration) AgentConfiguration {
	configuration.ToolIDs = append([]string(nil), configuration.ToolIDs...)
	return configuration
}

func validAgentConfigurationAccount(account string) bool {
	return strings.TrimSpace(account) != "" && len(account) <= 256 && utf8.ValidString(account)
}

func validateAgentConfigurationInput(name, modelRef string, toolIDs []string, state string) error {
	if strings.TrimSpace(name) == "" || !utf8.ValidString(name) || len(name) > 480 || utf8.RuneCountInString(name) > 120 ||
		modelRef != agentConfigurationModel || (state != "enabled" && state != "paused") || len(toolIDs) > agentConfigurationMaxTools {
		return ErrAgentConfigurationInvalid
	}
	seen := make(map[string]bool, len(toolIDs))
	for _, id := range toolIDs {
		if id == "" || len(id) > agentConfigurationMaxIDBytes || seen[id] {
			return ErrAgentConfigurationInvalid
		}
		if _, known := lookupTool(id); !known {
			return ErrAgentConfigurationInvalid
		}
		seen[id] = true
	}
	return nil
}

// ConfigureAgent's account must come from the parent's canonical product
// session, never the request body. Availability is independent of authorization.
// Updates invalidate existing revision-bound tasks until explicitly reassigned.
func (s *Store) ConfigureAgent(account, id string, expectedRevision uint64, name, modelRef string, toolIDs []string, state string) (AgentConfiguration, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !validAgentConfigurationAccount(account) || len(id) > agentConfigurationMaxIDBytes {
		return AgentConfiguration{}, os.ErrNotExist
	}
	var configuration AgentConfiguration
	if id != "" {
		var err error
		configuration, err = s.ownedAgentConfigurationLocked(account, id)
		if err != nil {
			return AgentConfiguration{}, err
		}
		if configuration.Revision != expectedRevision || configuration.Revision == ^uint64(0) {
			return AgentConfiguration{}, ErrAgentConfigurationConflict
		}
	} else if expectedRevision != 0 {
		return AgentConfiguration{}, ErrAgentConfigurationConflict
	}
	name = strings.TrimSpace(name)
	if err := validateAgentConfigurationInput(name, modelRef, toolIDs, state); err != nil {
		return AgentConfiguration{}, err
	}
	now := s.now().UTC()
	event := "agent_configuration_updated"
	if id == "" {
		id = randomID("agentcfg")
		if _, exists := s.state.AgentConfigurations[id]; exists {
			return AgentConfiguration{}, ErrAgentConfigurationConflict
		}
		configuration = AgentConfiguration{ID: id, Account: account, CreatedAt: now}
		event = "agent_configuration_created"
	}
	configuration.Name, configuration.ModelRef, configuration.State = name, modelRef, state
	configuration.ToolIDs = append([]string(nil), toolIDs...)
	configuration.Revision++
	configuration.UpdatedAt = now
	wasNil := s.state.AgentConfigurations == nil
	previous, existed := s.state.AgentConfigurations[id]
	audits, sequence := s.state.Audits, s.state.AuditSequence
	if wasNil {
		s.state.AgentConfigurations = make(map[string]AgentConfiguration)
	}
	s.state.AgentConfigurations[id] = configuration
	s.auditLocked(account, event, id, "product configuration changed; no identity or authority created")
	if err := s.saveLocked(); err != nil {
		if wasNil {
			s.state.AgentConfigurations = nil
		} else if existed {
			s.state.AgentConfigurations[id] = previous
		} else {
			delete(s.state.AgentConfigurations, id)
		}
		s.state.Audits, s.state.AuditSequence = audits, sequence
		return AgentConfiguration{}, fmt.Errorf("persist agent configuration: %w", err)
	}
	return cloneAgentConfiguration(configuration), nil
}

func (s *Store) ownedAgentConfigurationLocked(account, id string) (AgentConfiguration, error) {
	if !validAgentConfigurationAccount(account) || id == "" || len(id) > agentConfigurationMaxIDBytes {
		return AgentConfiguration{}, os.ErrNotExist
	}
	configuration, exists := s.state.AgentConfigurations[id]
	if !exists || configuration.Account != account {
		return AgentConfiguration{}, os.ErrNotExist
	}
	if configuration.ID != id || configuration.Revision == 0 || validateAgentConfigurationInput(configuration.Name, configuration.ModelRef, configuration.ToolIDs, configuration.State) != nil {
		return AgentConfiguration{}, ErrAgentConfigurationInvalid
	}
	return configuration, nil
}

func (s *Store) AgentConfiguration(account, id string) (AgentConfiguration, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	configuration, err := s.ownedAgentConfigurationLocked(account, id)
	if err != nil {
		return AgentConfiguration{}, err
	}
	return cloneAgentConfiguration(configuration), nil
}

func (s *Store) AgentConfigurations(account string) []AgentConfiguration {
	s.mu.Lock()
	defer s.mu.Unlock()
	configurations := []AgentConfiguration{}
	if !validAgentConfigurationAccount(account) {
		return configurations
	}
	for id := range s.state.AgentConfigurations {
		configuration, err := s.ownedAgentConfigurationLocked(account, id)
		if err == nil {
			configurations = append(configurations, cloneAgentConfiguration(configuration))
		}
	}
	sort.Slice(configurations, func(i, j int) bool {
		if configurations[i].Name == configurations[j].Name {
			return configurations[i].ID < configurations[j].ID
		}
		return configurations[i].Name < configurations[j].Name
	})
	return configurations
}

// assertTaskAgentConfigurationLocked is an additional availability fence, never
// an authorization check. Parent dispatch/model/resource paths must hold mu and
// continue their original task/grant/approval/outbox checks at the effect edge.
func (s *Store) assertTaskAgentConfigurationLocked(task TaskRecord, toolID string) error {
	if task.AgentConfigurationID == "" {
		return nil
	}
	configuration, err := s.ownedAgentConfigurationLocked(task.Account, task.AgentConfigurationID)
	if err != nil || configuration.State != "enabled" || configuration.Revision != task.AgentConfigurationRevision {
		return ErrAgentConfigurationUnavailable
	}
	if toolID != "" {
		for _, allowed := range configuration.ToolIDs {
			if allowed == toolID {
				return nil
			}
		}
		return ErrAgentConfigurationUnavailable
	}
	return nil
}
