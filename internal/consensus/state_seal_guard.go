package consensus

import (
	"reflect"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// snapshotNativeSealState is a per-call, owned mutation witness, never a cached
// validation result. Only native-account/fee states are eligible. Other record
// families and future unsupported fields conservatively use full validation.
// The caller must compute AppHash before taking the snapshot, and must still
// run all semantic validation before consulting it.
func snapshotNativeSealState(s CommittedState) func(CommittedState) bool {
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
	fees := append([]BFTFeeEvent(nil), s.FeeEvents...)
	header := s
	header.Accounts, header.FeeEvents = nil, nil
	return func(current CommittedState) bool {
		currentHeader := current
		currentHeader.Accounts, currentHeader.FeeEvents = nil, nil
		if !reflect.DeepEqual(header, currentHeader) || !reflect.DeepEqual(accounts, current.Accounts) || len(fees) != len(current.FeeEvents) {
			return false
		}
		for i := range fees {
			// A new non-comparable fee field is a compile error, not an aliased
			// snapshot. time.Time is a value; its Location API is immutable.
			if fees[i] != current.FeeEvents[i] {
				return false
			}
		}
		return true
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
