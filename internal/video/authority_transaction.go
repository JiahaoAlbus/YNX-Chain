package video

import (
	"context"
	"errors"
	"reflect"
	"sync/atomic"
)

var ErrVideoTransactionUnavailable = errors.New("original Video transaction unavailable")

// This consumes an original protected transaction, never registers a writer.
// No callback means no success; preserve original commit errors and uncertainty.
func executeVideoLocalTransaction(ctx context.Context, tx VideoLocalTransaction, commit func(context.Context) error) error {
	if ctx == nil || ctx.Err() != nil || tx == nil {
		return ErrVideoTransactionUnavailable
	}
	v := reflect.ValueOf(tx)
	switch v.Kind() {
	case reflect.Pointer, reflect.Interface, reflect.Func, reflect.Map, reflect.Slice, reflect.Chan:
		if v.IsNil() {
			return ErrVideoTransactionUnavailable
		}
	}
	var entered, invalid atomic.Bool
	var originalErr error
	result := tx.Execute(ctx, func(local context.Context) error {
		if !entered.CompareAndSwap(false, true) || local == nil || local.Err() != nil || ctx.Err() != nil {
			invalid.Store(true)
			return ErrVideoTransactionUnavailable
		}
		originalErr = commit(local)
		return originalErr
	})
	if invalid.Load() || !entered.Load() && result == nil {
		return ErrVideoTransactionUnavailable
	}
	return errors.Join(result, originalErr)
}
