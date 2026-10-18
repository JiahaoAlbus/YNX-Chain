package consensus

import (
	"reflect"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// sealWitnessMode selects only private, per-call measurement paths. It is not
// serialized and grants no authority to public Validate or Commit.
type sealWitnessMode int

const (
	sealWitnessNone sealWitnessMode = iota
	sealWitnessFullCopy
	sealWitnessCompact
)

// snapshotNativeSealState is a per-call, owned mutation witness, never a cached
// validation result. Only native-account/fee states are eligible. Other record
// families and future unsupported fields conservatively use full validation.
// The caller must compute AppHash before taking the snapshot, and must still
// run all semantic validation before consulting it.
func snapshotNativeSealState(s CommittedState) func(CommittedState) bool {
	return snapshotNativeSealStateWithFeeMode(s, false)
}

func snapshotNativeSealStateCompact(s CommittedState) func(CommittedState) bool {
	return snapshotNativeSealStateWithFeeMode(s, true)
}

func snapshotNativeSealStateWithFeeMode(s CommittedState, compact bool) func(CommittedState) bool {
	if len(s.FeeEvents) == 0 {
		return nil
	}
	// Do not infer future mutable fields from hasApplicationRecords: changes to
	// the schema must fall back even if that helper has not yet been updated.
	v := reflect.ValueOf(s)
	typ := v.Type()
	for i := 0; i < v.NumField(); i++ {
		name, field := typ.Field(i).Name, v.Field(i)
		if name == "Accounts" || name == "FeeEvents" {
			continue
		}
		switch field.Kind() {
		case reflect.Slice:
			if field.Len() != 0 {
				return nil
			}
		case reflect.Bool, reflect.Int, reflect.Int64, reflect.String:
		default:
			return nil
		}
	}
	// Check reference ownership against the account schema explicitly. Future
	// account maps/pointers or mutable fields inside ResourceUsage fall back.
	accountType := reflect.TypeOf(chain.ConsensusAccount{})
	expectedType := reflect.TypeOf(struct {
		Address       string              `json:"address"`
		Balance       int64               `json:"balance"`
		Staked        int64               `json:"staked"`
		Nonce         uint64              `json:"nonce"`
		ResourceUsage chain.ResourceUsage `json:"resourceUsage"`
		Lots          map[string]int64    `json:"lots"`
	}{})
	if accountType.NumField() != expectedType.NumField() {
		return nil
	}
	for i := 0; i < accountType.NumField(); i++ {
		a, b := accountType.Field(i), expectedType.Field(i)
		if a.Name != b.Name || a.Type != b.Type || a.Tag != b.Tag || a.Anonymous != b.Anonymous {
			return nil
		}
	}
	if !sealValueOnlySchema(reflect.TypeOf(chain.ResourceUsage{})) || !sealValueOnlySchema(reflect.TypeOf(BFTFeeEvent{})) {
		return nil
	}
	accounts := make([]chain.ConsensusAccount, len(s.Accounts))
	for i, account := range s.Accounts {
		accounts[i] = account
		if account.Lots != nil {
			accounts[i].Lots = make(map[string]int64, len(account.Lots))
			for key, amount := range account.Lots {
				accounts[i].Lots[key] = amount
			}
		}
	}
	var feesUnchanged func([]BFTFeeEvent) bool
	if compact {
		feesUnchanged = snapshotCompactFeeRows(s.FeeEvents)
	} else {
		feesUnchanged = snapshotFullFeeRows(s.FeeEvents)
	}
	header := s
	header.Accounts, header.FeeEvents = nil, nil
	return func(current CommittedState) bool {
		currentHeader := current
		currentHeader.Accounts, currentHeader.FeeEvents = nil, nil
		return reflect.DeepEqual(header, currentHeader) &&
			reflect.DeepEqual(accounts, current.Accounts) &&
			feesUnchanged(current.FeeEvents)
	}
}

// time.Time has an immutable public API; all other supported nested structs
// must recursively contain only values. No map, pointer, interface or slice is
// silently accepted as an immutable copy.
func sealValueOnlySchema(typ reflect.Type) bool {
	if typ == reflect.TypeOf(time.Time{}) {
		return true
	}
	switch typ.Kind() {
	case reflect.Bool, reflect.Int, reflect.Int64, reflect.Uint64, reflect.String:
		return true
	case reflect.Struct:
		for i := 0; i < typ.NumField(); i++ {
			if !sealValueOnlySchema(typ.Field(i).Type) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

// These fields vary across otherwise identical native fee records. The shared
// metadata is retained as a complete BFTFeeEvent, so future value fields remain
// part of exact reconstruction and comparison instead of being silently lost.
type sealFeeVariableValues struct {
	ID, TxHash, Payer, Recipient, AuditHash string
	BlockHeight                             int64
	RecordedAt                              time.Time
}

func splitSealFeeValues(event BFTFeeEvent) (BFTFeeEvent, sealFeeVariableValues) {
	values := sealFeeVariableValues{event.ID, event.TxHash, event.Payer, event.Recipient, event.AuditHash, event.BlockHeight, event.RecordedAt}
	event.ID, event.TxHash, event.Payer, event.Recipient, event.AuditHash = "", "", "", "", ""
	event.BlockHeight, event.RecordedAt = 0, time.Time{}
	return event, values
}

func snapshotFullFeeRows(input []BFTFeeEvent) func([]BFTFeeEvent) bool {
	owned := append([]BFTFeeEvent(nil), input...)
	return func(current []BFTFeeEvent) bool {
		if len(current) != len(owned) {
			return false
		}
		for i := range owned {
			if current[i] != owned[i] {
				return false
			}
		}
		return true
	}
}

func snapshotCompactFeeRows(input []BFTFeeEvent) func([]BFTFeeEvent) bool {
	if len(input) == 0 {
		return snapshotFullFeeRows(input)
	}
	metadata, _ := splitSealFeeValues(input[0])
	// Verify all shared values before making the smaller allocation. Mixed
	// metadata uses the exact previous full-copy witness, with no validation
	// or fee-policy restriction imposed on the state.
	for _, event := range input[1:] {
		other, _ := splitSealFeeValues(event)
		if other != metadata {
			return snapshotFullFeeRows(input)
		}
	}
	owned := make([]sealFeeVariableValues, len(input))
	for i, event := range input {
		_, owned[i] = splitSealFeeValues(event)
	}
	return func(current []BFTFeeEvent) bool {
		if len(current) != len(owned) {
			return false
		}
		for i, values := range owned {
			expected := metadata
			expected.ID, expected.TxHash, expected.Payer, expected.Recipient, expected.AuditHash = values.ID, values.TxHash, values.Payer, values.Recipient, values.AuditHash
			expected.BlockHeight, expected.RecordedAt = values.BlockHeight, values.RecordedAt
			// Complete value equality, never an audit digest, authorizes reuse.
			if current[i] != expected {
				return false
			}
		}
		return true
	}
}
