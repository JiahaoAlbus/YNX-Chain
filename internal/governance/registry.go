package governance

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

// registryFS contains the immutable governance control-plane registries shipped
// with the binary. Runtime mutations must occur through proposals and produce a
// new versioned registry release; the daemon never accepts an ad-hoc admin
// override of these files.
//
//go:embed registry/*.json
var registryFS embed.FS

type AllowedRange struct {
	Minimum *int64   `json:"minimum,omitempty"`
	Maximum *int64   `json:"maximum,omitempty"`
	Enum    []string `json:"enum,omitempty"`
	Unit    string   `json:"unit,omitempty"`
}

type ChangeRateLimit struct {
	MaximumPerProposal int64  `json:"maximumPerProposal,omitempty"`
	MaximumPerWindow   int64  `json:"maximumPerWindow,omitempty"`
	Window             string `json:"window,omitempty"`
	Cooldown           string `json:"cooldown,omitempty"`
}

type GovernanceObjectDefinition struct {
	ObjectID             string          `json:"objectId"`
	Name                 string          `json:"name"`
	Owner                string          `json:"owner"`
	SchemaVersion        string          `json:"schemaVersion"`
	CurrentValue         json.RawMessage `json:"currentValue"`
	AllowedRange         AllowedRange    `json:"allowedRange"`
	ChangeRateLimit      ChangeRateLimit `json:"changeRateLimit"`
	RequiredRole         GovernanceRole  `json:"requiredRole"`
	RequiredThresholdBPS uint64          `json:"requiredThresholdBps"`
	RequiredQuorumBPS    uint64          `json:"requiredQuorumBps"`
	RequiredTimelock     string          `json:"requiredTimelock"`
	EmergencyScope       []string        `json:"emergencyScope"`
	MigrationRequirement string          `json:"migrationRequirement"`
	RollbackRequirement  string          `json:"rollbackRequirement"`
	SourceCommit         string          `json:"sourceCommit"`
	Release              string          `json:"release"`
	EffectiveAt          string          `json:"effectiveAt"`
	LastChangedBy        string          `json:"lastChangedBy"`
	Evidence             []string        `json:"evidence"`
	AuditID              string          `json:"auditId"`
	ParameterIDs         []string        `json:"parameterIds,omitempty"`
}

type GovernanceObjectRegistry struct {
	SchemaVersion string                       `json:"schemaVersion"`
	RegistryID    string                       `json:"registryId"`
	Objects       []GovernanceObjectDefinition `json:"objects"`
}

type ParameterRegistryEntry struct {
	ParameterID              string          `json:"parameterId"`
	ObjectID                 string          `json:"objectId"`
	Path                     string          `json:"path"`
	Scope                    Scope           `json:"scope"`
	ValueType                string          `json:"valueType"`
	CurrentValue             json.RawMessage `json:"currentValue"`
	AllowedRange             AllowedRange    `json:"allowedRange"`
	MaximumChangePerProposal int64           `json:"maximumChangePerProposal,omitempty"`
	MaximumChangePerWindow   int64           `json:"maximumChangePerWindow,omitempty"`
	Window                   string          `json:"window,omitempty"`
	Cooldown                 string          `json:"cooldown,omitempty"`
	Expiry                   string          `json:"expiry,omitempty"`
	RequiredRole             GovernanceRole  `json:"requiredRole"`
	RequiredThresholdBPS     uint64          `json:"requiredThresholdBps"`
	RequiredQuorumBPS        uint64          `json:"requiredQuorumBps"`
	RequiredTimelock         string          `json:"requiredTimelock"`
	SourceCommit             string          `json:"sourceCommit"`
	Release                  string          `json:"release"`
	Evidence                 []string        `json:"evidence"`
	AuditID                  string          `json:"auditId"`
}

type ParameterRegistry struct {
	SchemaVersion string                   `json:"schemaVersion"`
	RegistryID    string                   `json:"registryId"`
	Parameters    []ParameterRegistryEntry `json:"parameters"`
}

type RoleRegistryEntry struct {
	RoleID                     GovernanceRole `json:"roleId"`
	Scope                      []Scope        `json:"scope"`
	MaximumTerm                string         `json:"maximumTerm"`
	AppointmentMethod          string         `json:"appointmentMethod"`
	RemovalMethod              string         `json:"removalMethod"`
	VotingPower                string         `json:"votingPower"`
	ThresholdBPS               uint64         `json:"thresholdBps"`
	QuorumBPS                  uint64         `json:"quorumBps"`
	ConflictDisclosureRequired bool           `json:"conflictDisclosureRequired"`
	DelegationRules            string         `json:"delegationRules"`
	ExpiryRequired             bool           `json:"expiryRequired"`
	Revocable                  bool           `json:"revocable"`
	AuditRequired              bool           `json:"auditRequired"`
	EmergencyPermissions       []string       `json:"emergencyPermissions"`
	ForbiddenActions           []string       `json:"forbiddenActions"`
}

type RoleRegistry struct {
	SchemaVersion string              `json:"schemaVersion"`
	RegistryID    string              `json:"registryId"`
	Roles         []RoleRegistryEntry `json:"roles"`
}

type RegistrySet struct {
	Objects    GovernanceObjectRegistry `json:"objects"`
	Parameters ParameterRegistry        `json:"parameters"`
	Roles      RoleRegistry             `json:"roles"`
	Digest     string                   `json:"digest"`
}

func LoadEmbeddedRegistries() (RegistrySet, error) {
	var out RegistrySet
	if err := decodeRegistryFile("registry/roles.json", &out.Roles); err != nil {
		return RegistrySet{}, err
	}
	out.Objects, out.Parameters = defaultGovernanceRegistries(out.Roles)
	if err := validateRegistries(out); err != nil {
		return RegistrySet{}, err
	}
	digest, err := canonicalRegistryDigest(out)
	if err != nil {
		return RegistrySet{}, err
	}
	out.Digest = digest
	return out, nil
}

func canonicalRegistryDigest(registries RegistrySet) (string, error) {
	canonical, err := json.Marshal(struct {
		Objects    GovernanceObjectRegistry `json:"objects"`
		Parameters ParameterRegistry        `json:"parameters"`
		Roles      RoleRegistry             `json:"roles"`
	}{registries.Objects, registries.Parameters, registries.Roles})
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(canonical)
	return hex.EncodeToString(digest[:]), nil
}

func validateRegistryIntegrity(registries RegistrySet) error {
	if err := validateRegistries(registries); err != nil {
		return err
	}
	digest, err := canonicalRegistryDigest(registries)
	if err != nil {
		return err
	}
	if !strings.EqualFold(registries.Digest, digest) {
		return fmt.Errorf("%w: governance registry digest mismatch", ErrForbidden)
	}
	return nil
}

func decodeRegistryFile(path string, target any) error {
	data, err := registryFS.ReadFile(path)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(target); err != nil {
		return fmt.Errorf("%w: decode %s: %v", ErrInvalid, path, err)
	}
	return nil
}

func validateRegistries(registries RegistrySet) error {
	if registries.Objects.SchemaVersion != "ynx-governance-object-registry/v1" || registries.Parameters.SchemaVersion != "ynx-governance-parameter-registry/v1" || registries.Roles.SchemaVersion != "ynx-governance-role-registry/v1" {
		return fmt.Errorf("%w: unsupported governance registry version", ErrInvalid)
	}
	if strings.TrimSpace(registries.Objects.RegistryID) == "" || strings.TrimSpace(registries.Parameters.RegistryID) == "" || strings.TrimSpace(registries.Roles.RegistryID) == "" {
		return fmt.Errorf("%w: registry id required", ErrInvalid)
	}
	roles := map[GovernanceRole]RoleRegistryEntry{}
	for _, role := range registries.Roles.Roles {
		if role.RoleID == "" || len(role.Scope) == 0 || role.ThresholdBPS == 0 || role.ThresholdBPS > 10000 || role.QuorumBPS == 0 || role.QuorumBPS > 10000 || !role.ExpiryRequired || !role.Revocable || !role.AuditRequired || strings.TrimSpace(role.AppointmentMethod) == "" || strings.TrimSpace(role.RemovalMethod) == "" || strings.TrimSpace(role.MaximumTerm) == "" || len(role.ForbiddenActions) == 0 {
			return fmt.Errorf("%w: unsafe role registry entry %q", ErrInvalid, role.RoleID)
		}
		if _, err := time.ParseDuration(role.MaximumTerm); err != nil {
			return fmt.Errorf("%w: invalid role term %q", ErrInvalid, role.RoleID)
		}
		if _, exists := roles[role.RoleID]; exists {
			return fmt.Errorf("%w: duplicate role %q", ErrConflict, role.RoleID)
		}
		roles[role.RoleID] = role
	}
	objects := map[string]GovernanceObjectDefinition{}
	for _, object := range registries.Objects.Objects {
		if !strings.HasPrefix(object.ObjectID, "govobj.") || strings.TrimSpace(object.Name) == "" || object.Owner != "ynx-governance" || object.SchemaVersion == "" || len(object.CurrentValue) == 0 || object.RequiredThresholdBPS == 0 || object.RequiredThresholdBPS > 10000 || object.RequiredQuorumBPS == 0 || object.RequiredQuorumBPS > 10000 || strings.TrimSpace(object.MigrationRequirement) == "" || strings.TrimSpace(object.RollbackRequirement) == "" || strings.TrimSpace(object.SourceCommit) == "" || strings.TrimSpace(object.Release) == "" || strings.TrimSpace(object.EffectiveAt) == "" || strings.TrimSpace(object.LastChangedBy) == "" || len(object.Evidence) == 0 || strings.TrimSpace(object.AuditID) == "" {
			return fmt.Errorf("%w: incomplete governance object %q", ErrInvalid, object.ObjectID)
		}
		if _, ok := roles[object.RequiredRole]; !ok {
			return fmt.Errorf("%w: governance object %q references unknown role", ErrInvalid, object.ObjectID)
		}
		if delay, err := time.ParseDuration(object.RequiredTimelock); err != nil || delay <= 0 {
			return fmt.Errorf("%w: governance object %q requires a positive timelock", ErrInvalid, object.ObjectID)
		}
		if _, err := time.Parse(time.RFC3339, object.EffectiveAt); err != nil {
			return fmt.Errorf("%w: governance object %q has invalid effective time", ErrInvalid, object.ObjectID)
		}
		if _, exists := objects[object.ObjectID]; exists {
			return fmt.Errorf("%w: duplicate governance object %q", ErrConflict, object.ObjectID)
		}
		objects[object.ObjectID] = object
	}
	parameters := map[string]ParameterRegistryEntry{}
	paths := map[string]bool{}
	for _, parameter := range registries.Parameters.Parameters {
		if !strings.HasPrefix(parameter.ParameterID, "govparam.") || !strings.HasPrefix(parameter.Path, "/") || parameter.Scope == "" || strings.TrimSpace(parameter.ValueType) == "" || len(parameter.CurrentValue) == 0 || parameter.RequiredThresholdBPS == 0 || parameter.RequiredThresholdBPS > 10000 || parameter.RequiredQuorumBPS == 0 || parameter.RequiredQuorumBPS > 10000 || len(parameter.Evidence) == 0 || strings.TrimSpace(parameter.AuditID) == "" {
			return fmt.Errorf("%w: incomplete parameter registry entry %q", ErrInvalid, parameter.ParameterID)
		}
		if _, ok := objects[parameter.ObjectID]; !ok {
			return fmt.Errorf("%w: parameter %q references unknown object", ErrInvalid, parameter.ParameterID)
		}
		if _, ok := roles[parameter.RequiredRole]; !ok {
			return fmt.Errorf("%w: parameter %q references unknown role", ErrInvalid, parameter.ParameterID)
		}
		if delay, err := time.ParseDuration(parameter.RequiredTimelock); err != nil || delay <= 0 {
			return fmt.Errorf("%w: parameter %q requires a positive timelock", ErrInvalid, parameter.ParameterID)
		}
		switch parameter.ValueType {
		case "integer":
			if parameter.AllowedRange.Minimum == nil || parameter.AllowedRange.Maximum == nil || *parameter.AllowedRange.Minimum >= *parameter.AllowedRange.Maximum || parameter.MaximumChangePerProposal <= 0 || parameter.MaximumChangePerWindow <= 0 {
				return fmt.Errorf("%w: integer parameter %q lacks authoritative bounds", ErrInvalid, parameter.ParameterID)
			}
			var current int64
			if err := json.Unmarshal(parameter.CurrentValue, &current); err != nil || current < *parameter.AllowedRange.Minimum || current > *parameter.AllowedRange.Maximum {
				return fmt.Errorf("%w: integer parameter %q has invalid current value", ErrInvalid, parameter.ParameterID)
			}
		case "sha256":
			var current string
			if err := json.Unmarshal(parameter.CurrentValue, &current); err != nil || (current != "" && (!validHash(current) || current != strings.ToLower(current))) || parameter.AllowedRange.Minimum != nil || parameter.AllowedRange.Maximum != nil || parameter.MaximumChangePerProposal != 0 || parameter.MaximumChangePerWindow != 0 || parameter.Window != "" || parameter.Cooldown != "" {
				return fmt.Errorf("%w: sha256 parameter %q has invalid type bounds", ErrInvalid, parameter.ParameterID)
			}
		default:
			return fmt.Errorf("%w: unsupported parameter value type %q", ErrInvalid, parameter.ValueType)
		}
		if parameter.Cooldown != "" {
			if cooldown, err := time.ParseDuration(parameter.Cooldown); err != nil || cooldown < 0 {
				return fmt.Errorf("%w: parameter %q has invalid cooldown", ErrInvalid, parameter.ParameterID)
			}
		}
		if parameter.Window != "" {
			if window, err := time.ParseDuration(parameter.Window); err != nil || window <= 0 {
				return fmt.Errorf("%w: parameter %q has invalid rate window", ErrInvalid, parameter.ParameterID)
			}
		}
		if _, exists := parameters[parameter.ParameterID]; exists || paths[parameter.Path] {
			return fmt.Errorf("%w: duplicate parameter id or path %q", ErrConflict, parameter.ParameterID)
		}
		parameters[parameter.ParameterID] = parameter
		paths[parameter.Path] = true
	}
	for _, object := range registries.Objects.Objects {
		for _, parameterID := range object.ParameterIDs {
			if parameter, ok := parameters[parameterID]; !ok || parameter.ObjectID != object.ObjectID {
				return fmt.Errorf("%w: object %q has invalid parameter binding %q", ErrInvalid, object.ObjectID, parameterID)
			}
		}
	}
	return nil
}

func validatePolicyParameterRules(rules map[string]ParameterRule, registries RegistrySet) error {
	if err := validateRegistryIntegrity(registries); err != nil {
		return err
	}
	parameters := make(map[string]ParameterRegistryEntry, len(registries.Parameters.Parameters))
	for _, parameter := range registries.Parameters.Parameters {
		parameters[parameter.Path] = parameter
	}
	for path, rule := range rules {
		parameter, ok := parameters[path]
		if !ok {
			return fmt.Errorf("%w: policy parameter %s is absent from the authoritative registry", ErrForbidden, path)
		}
		numeric := parameter.ValueType == "integer"
		if rule.Scope != parameter.Scope || rule.Numeric != numeric {
			return fmt.Errorf("%w: policy parameter %s diverges from authoritative type or scope", ErrForbidden, path)
		}
		if numeric {
			if parameter.AllowedRange.Minimum == nil || parameter.AllowedRange.Maximum == nil || rule.Minimum != *parameter.AllowedRange.Minimum || rule.Maximum != *parameter.AllowedRange.Maximum {
				return fmt.Errorf("%w: policy parameter %s diverges from authoritative bounds", ErrForbidden, path)
			}
		} else if rule.Minimum != 0 || rule.Maximum != 0 {
			return fmt.Errorf("%w: non-numeric policy parameter %s cannot define numeric bounds", ErrForbidden, path)
		}
	}
	return nil
}

func validateProposalParameterChanges(input ProposalInput, registries RegistrySet) error {
	if err := validateRegistryIntegrity(registries); err != nil {
		return err
	}
	parameters := make(map[string]ParameterRegistryEntry, len(registries.Parameters.Parameters))
	for _, parameter := range registries.Parameters.Parameters {
		parameters[parameter.Path] = parameter
	}
	for _, change := range input.Changes {
		parameter, ok := parameters[change.Path]
		if !ok || parameter.Scope != input.Scope {
			return fmt.Errorf("%w: parameter path is not registered for proposal scope", ErrForbidden)
		}
		switch parameter.ValueType {
		case "integer":
			if change.Numeric == nil || parameter.AllowedRange.Minimum == nil || parameter.AllowedRange.Maximum == nil {
				return fmt.Errorf("%w: integer parameter %s requires a canonical numeric value", ErrInvalid, change.Path)
			}
			before, err := strconv.ParseInt(strings.TrimSpace(change.Before), 10, 64)
			if err != nil {
				return fmt.Errorf("%w: integer parameter %s has invalid prior value", ErrInvalid, change.Path)
			}
			after, err := strconv.ParseInt(strings.TrimSpace(change.After), 10, 64)
			if err != nil || after != *change.Numeric {
				return fmt.Errorf("%w: integer parameter %s has inconsistent machine diff", ErrInvalid, change.Path)
			}
			if after < *parameter.AllowedRange.Minimum || after > *parameter.AllowedRange.Maximum {
				return fmt.Errorf("%w: parameter %s outside authoritative registry bounds", ErrForbidden, change.Path)
			}
			delta := after - before
			if delta < 0 {
				delta = -delta
			}
			if parameter.MaximumChangePerProposal > 0 && delta > parameter.MaximumChangePerProposal {
				return fmt.Errorf("%w: parameter %s exceeds authoritative per-proposal change limit", ErrForbidden, change.Path)
			}
			if (change.Minimum != 0 || change.Maximum != 0) && (change.Minimum != *parameter.AllowedRange.Minimum || change.Maximum != *parameter.AllowedRange.Maximum) {
				return fmt.Errorf("%w: proposal cannot redefine authoritative registry bounds", ErrForbidden)
			}
		case "sha256":
			before := strings.TrimSpace(change.Before)
			after := strings.TrimSpace(change.After)
			if change.Numeric != nil || after != strings.ToLower(after) || !validHash(after) || (before != "" && (before != strings.ToLower(before) || !validHash(before))) {
				return fmt.Errorf("%w: parameter %s requires a canonical sha256 machine diff", ErrInvalid, change.Path)
			}
			if (input.Scope == ScopeProtocolUpgrade || input.Scope == ScopeConsensusUpgrade) && !strings.EqualFold(after, input.UpgradeHash) {
				return fmt.Errorf("%w: upgrade manifest parameter does not match proposal upgrade hash", ErrForbidden)
			}
		default:
			return fmt.Errorf("%w: unsupported authoritative parameter type", ErrForbidden)
		}
	}
	return nil
}

func cloneRegistrySet(in RegistrySet) RegistrySet {
	encoded, _ := json.Marshal(in)
	var out RegistrySet
	_ = json.Unmarshal(encoded, &out)
	return out
}

func (s *Service) RegistrySet() RegistrySet {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneRegistrySet(s.registries)
}

func (s *Service) GovernanceObjects() []GovernanceObjectDefinition {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := append([]GovernanceObjectDefinition(nil), s.registries.Objects.Objects...)
	sort.Slice(out, func(i, j int) bool { return out[i].ObjectID < out[j].ObjectID })
	return cloneRegistrySet(RegistrySet{Objects: GovernanceObjectRegistry{Objects: out}}).Objects.Objects
}

func (s *Service) Parameters() []ParameterRegistryEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := append([]ParameterRegistryEntry(nil), s.registries.Parameters.Parameters...)
	sort.Slice(out, func(i, j int) bool { return out[i].ParameterID < out[j].ParameterID })
	return cloneRegistrySet(RegistrySet{Parameters: ParameterRegistry{Parameters: out}}).Parameters.Parameters
}

func (s *Service) RoleDefinitions() []RoleRegistryEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := append([]RoleRegistryEntry(nil), s.registries.Roles.Roles...)
	sort.Slice(out, func(i, j int) bool { return out[i].RoleID < out[j].RoleID })
	return cloneRegistrySet(RegistrySet{Roles: RoleRegistry{Roles: out}}).Roles.Roles
}
