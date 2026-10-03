package quantlab

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf16"
)

// Match the integer domain of the research browser, without changing historical
// simulation or state decoding. Explicit invalid values are never defaults.
const researchMaxSafeInteger int64 = 9007199254740991

type researchParameterError struct{ field string }

func (e *researchParameterError) Error() string { return "invalid research parameter: " + e.field }
func (e *researchParameterError) Unwrap() error { return ErrInvalid }
func researchInvalid(field string) error        { return &researchParameterError{field: field} }
func researchSafe(v int64) bool                 { return v >= -researchMaxSafeInteger && v <= researchMaxSafeInteger }

func normalizeResearchParameters(strategy StrategySpec, a Assumptions) (StrategySpec, error) {
	if strings.TrimSpace(strategy.Name) == "" || len(utf16.Encode([]rune(strategy.Name))) > 80 {
		return strategy, researchInvalid("name")
	}
	if !researchSafe(strategy.Seed) || !researchSafe(a.Seed) {
		return strategy, researchInvalid("seed")
	}
	if a.FeeBPS < 0 || a.SlippageBPS < 0 || !researchSafe(a.FeeBPS) || !researchSafe(a.SlippageBPS) {
		return strategy, researchInvalid("cost")
	}
	strategy.Params = cloneParams(strategy.Params)
	if _, present := strategy.Params["fast"]; !present {
		strategy.Params["fast"] = 3
	}
	if _, present := strategy.Params["slow"]; !present {
		strategy.Params["slow"] = 8
	}
	fast, slow := strategy.Params["fast"], strategy.Params["slow"]
	if fast < 2 || slow <= fast || !researchSafe(fast) || !researchSafe(slow) {
		return strategy, researchInvalid("windows")
	}
	return strategy, nil
}

// Do not attach custom unmarshalling to persisted StrategySpec: old records must
// remain readable. Strict research HTTP decoding rejects null/duplicate fields
// instead of silently converting them into compatible omitted defaults.
func decodeResearch(w http.ResponseWriter, r *http.Request, v any) bool {
	var raw json.RawMessage
	if !decode(w, r, &raw) {
		return false
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	var scan func(string) error
	scan = func(path string) error {
		t, err := d.Token()
		if err != nil {
			return err
		}
		if t == nil {
			return researchInvalid(path)
		}
		if delim, ok := t.(json.Delim); ok {
			switch delim {
			case '{':
				seen := map[string]bool{}
				for d.More() {
					key, err := d.Token()
					if err != nil {
						return err
					}
					name, ok := key.(string)
					if !ok {
						return fmt.Errorf("object key")
					}
					canonical := canonicalJSONKey(name)
					if seen[canonical] {
						return researchInvalid("duplicate")
					}
					seen[canonical] = true
					if err := scan(path + "." + canonical); err != nil {
						return err
					}
				}
			case '[':
				for d.More() {
					if err := scan(path); err != nil {
						return err
					}
				}
			default:
				return fmt.Errorf("unexpected delimiter")
			}
			_, err = d.Token()
			return err
		}
		return nil
	}
	if err := scan("research"); err != nil {
		writeProblem(w, r, 400, "invalid_research_parameters")
		return false
	}
	strict := json.NewDecoder(bytes.NewReader(raw))
	strict.DisallowUnknownFields()
	if err := strict.Decode(v); err != nil {
		writeProblem(w, r, 400, "invalid_json")
		return false
	}
	return true
}
