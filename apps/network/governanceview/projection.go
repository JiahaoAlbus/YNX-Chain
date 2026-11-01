package governanceview

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/governance"
)

var errReport = errors.New("invalid original governance report")

// Token parsing both rejects duplicate keys and keeps original integer lexemes.
// Its bounds precede any typed schema decoding or public projection allocation.
func decodeDocument(raw []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	nodes := 0
	var read func(int) (any, error)
	read = func(depth int) (any, error) {
		nodes++
		if depth > 32 || nodes > 150000 {
			return nil, errReport
		}
		token, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		if delimiter, ok := token.(json.Delim); ok {
			switch delimiter {
			case '{':
				object := make(map[string]any)
				for decoder.More() {
					key, err := decoder.Token()
					if err != nil {
						return nil, err
					}
					name, ok := key.(string)
					if !ok {
						return nil, errReport
					}
					if _, exists := object[name]; exists {
						return nil, errReport
					}
					value, err := read(depth + 1)
					if err != nil {
						return nil, err
					}
					object[name] = value
				}
				if _, err = decoder.Token(); err != nil {
					return nil, err
				}
				return object, nil
			case '[':
				array := []any{}
				for decoder.More() {
					value, err := read(depth + 1)
					if err != nil {
						return nil, err
					}
					array = append(array, value)
				}
				if _, err = decoder.Token(); err != nil {
					return nil, err
				}
				return array, nil
			default:
				return nil, errReport
			}
		}
		if number, ok := token.(json.Number); ok {
			text := number.String()
			digits := text
			if strings.HasPrefix(digits, "-") {
				digits = digits[1:]
				if digits == "0" {
					return nil, errReport
				}
			}
			if digits == "" || len(digits) > 20 || len(digits) > 1 && digits[0] == '0' {
				return nil, errReport
			}
			for _, c := range digits {
				if c < '0' || c > '9' {
					return nil, errReport
				}
			}
		}
		return token, nil
	}
	value, err := read(0)
	if err != nil {
		return nil, err
	}
	if _, err = decoder.Token(); err != io.EOF {
		return nil, errReport
	}
	return value, nil
}

func validStateMachine(value any) bool {
	array, ok := value.([]any)
	expected := governance.ProposalStatuses()
	if !ok || len(array) != len(expected) {
		return false
	}
	for i, status := range expected {
		if array[i] != string(status) {
			return false
		}
	}
	return true
}

func projectProposal(value any, expectedID string) (json.RawMessage, string, error) {
	object, ok := value.(map[string]any)
	if !ok {
		return nil, "", errReport
	}
	raw, err := json.Marshal(object)
	if err != nil {
		return nil, "", errReport
	}
	var proposal governance.Proposal
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&proposal) != nil || !ValidID(proposal.ID) || !ValidID(proposal.ActionHash) || expectedID != "" && proposal.ID != expectedID || proposal.CreatedAt.IsZero() || proposal.UpdatedAt.Before(proposal.CreatedAt) || proposal.Input.Summary == "" || proposal.Input.Scope == "" || proposal.Input.ProposalType == "" || proposal.Input.Proposer == "" {
		return nil, "", errReport
	}
	statusOK := false
	for _, status := range governance.ProposalStatuses() {
		if proposal.Status == status {
			statusOK = true
			break
		}
	}
	if !statusOK {
		return nil, "", errReport
	}
	// Original Go schema roundtrip detects missing required fields, unknown
	// fields, null integer substitutions, overflow and noncanonical numeric tokens.
	normalizedRaw, err := json.Marshal(proposal)
	if err != nil {
		return nil, "", errReport
	}
	normalized, err := decodeDocument(normalizedRaw)
	if err != nil || !reflect.DeepEqual(value, normalized) {
		return nil, "", errReport
	}
	projected := stringNumbers(value)
	out, err := json.Marshal(projected)
	if err != nil || len(out) > MaxProposalBytes {
		return nil, "", errReport
	}
	return out, proposal.ID, nil
}

func stringNumbers(value any) any {
	switch value := value.(type) {
	case json.Number:
		return value.String()
	case []any:
		out := make([]any, len(value))
		for i, item := range value {
			out[i] = stringNumbers(item)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(value))
		for key, item := range value {
			out[key] = stringNumbers(item)
		}
		return out
	default:
		return value
	}
}
