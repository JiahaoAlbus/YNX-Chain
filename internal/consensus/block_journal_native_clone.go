package consensus

import (
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"reflect"
	"time"
)

// cloneNativeCommittedState is deliberately limited to native accounts and fee
// history. Any populated other domain falls back to the original strict JSON
// path. Empty slices retain nil/empty identity but never share append capacity.
// Reflection checks the whole schema so future mutable fields cannot silently
// become shared by this candidate.
func cloneNativeCommittedState(state CommittedState) (CommittedState, bool) {
	v := reflect.ValueOf(state)
	t := v.Type()
	for i := 0; i < v.NumField(); i++ {
		f := v.Field(i)
		switch t.Field(i).Name {
		case "Accounts", "FeeEvents":
			if !nativeCloneType(f.Type().Elem()) {
				return CommittedState{}, false
			}
		default:
			if f.Kind() == reflect.Slice {
				if f.Len() != 0 {
					return CommittedState{}, false
				}
			} else if !nativeCloneScalar(f.Kind()) {
				return CommittedState{}, false
			}
		}
	}
	out := state
	w := reflect.ValueOf(&out).Elem()
	for i := 0; i < w.NumField(); i++ {
		f := w.Field(i)
		if f.Kind() == reflect.Slice && !f.IsNil() {
			private := reflect.MakeSlice(f.Type(), f.Len(), f.Len())
			reflect.Copy(private, f)
			f.Set(private)
		}
	}
	for i := range out.Accounts {
		if state.Accounts[i].Lots != nil {
			out.Accounts[i].Lots = make(map[string]int64, len(state.Accounts[i].Lots))
			for key, amount := range state.Accounts[i].Lots {
				out.Accounts[i].Lots[key] = amount
			}
		}
	}
	return out, true
}

func nativeCloneScalar(k reflect.Kind) bool {
	switch k {
	case reflect.String, reflect.Bool, reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return true
	}
	return false
}

func nativeCloneType(t reflect.Type) bool {
	if nativeCloneScalar(t.Kind()) || t == reflect.TypeOf(time.Time{}) {
		return true
	}
	if t.Kind() != reflect.Struct {
		return false
	}
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		if t == reflect.TypeOf(chain.ConsensusAccount{}) && f.Name == "Lots" && f.Type == reflect.TypeOf(map[string]int64{}) {
			continue
		}
		if !nativeCloneType(f.Type) {
			return false
		}
	}
	return true
}
