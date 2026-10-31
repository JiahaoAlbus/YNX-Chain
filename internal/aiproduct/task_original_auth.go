package aiproduct

import (
	"context"
	"errors"
	"reflect"
	"strconv"

	authgrant "ynx.local/authgrantpolicy"
)

// This normal consumer imports the exact original Auth supplier module. It
// installs no verifier/provider and does not make the production Source live.
type originalAuthReadOutcome struct {
	Receipt   taskReadReceipt
	AuthScope authgrant.FenceScope
}

func (s *Store) commitOriginalAuthTaskRead(ctx context.Context, verifier authgrant.OriginalTaskGrantVerifier, binding authgrant.TaskEffectBinding, grantProof, holderProof authgrant.Proof) (outcome originalAuthReadOutcome, err error) {
	check, err := authgrant.OpenTaskGrantAtEffect(ctx, verifier, binding, grantProof, holderProof)
	// Adopt and close even a non-nil partial returned alongside the first error.
	if check != nil {
		defer func() {
			if closeErr := check.Close(); closeErr != nil {
				if err == nil {
					err = closeErr
				} else if !errors.Is(err, closeErr) {
					err = errors.Join(err, closeErr)
				}
			}
		}()
	}
	if err != nil {
		return outcome, err
	}
	revision, err := strconv.ParseUint(binding.Task.Revision, 10, 64)
	if err != nil {
		return outcome, err
	}
	generation, err := strconv.ParseUint(binding.Generation, 10, 64)
	if err != nil {
		return outcome, err
	}
	bytes, err := strconv.ParseUint(binding.Input.Bytes, 10, 64)
	if err != nil {
		return outcome, err
	}
	if bytes > 32<<10 {
		return outcome, errToolInvalid
	}
	expected := taskReadExpectation{Account: binding.Account, TaskID: binding.Task.ID, StepID: binding.StepID, Holder: binding.Holder.ID, TaskRevision: revision, Generation: generation, Input: taskBytesBinding{Bytes: int(bytes), SHA3_512: binding.Input.SHA3_512, SHA512: binding.Input.SHA512}, Fields: append([]string(nil), binding.Fields...)}
	if len(binding.Resources) != 1 || len(binding.Sources) != 1 || binding.Sources[0].Resource != binding.Resources[0] || !reflect.DeepEqual(binding.Sources[0].Fields, binding.Fields) {
		return outcome, errToolConflict
	}
	sourceBytes, sourceErr := strconv.ParseUint(binding.Sources[0].Binding.Bytes, 10, 64)
	if sourceErr != nil || sourceBytes > 1<<20 {
		return outcome, errToolInvalid
	}
	expected.SourceBinding = &taskBytesBinding{Bytes: int(sourceBytes), SHA3_512: binding.Sources[0].Binding.SHA3_512, SHA512: binding.Sources[0].Binding.SHA512}
	outcome.Receipt, err = s.commitTaskReadAtEffectFence(ctx, expected, func() error {
		decision, checkErr := authgrant.CheckTaskGrantAtEffect(ctx, check)
		if checkErr == nil {
			outcome.AuthScope = decision.Scope
		}
		return checkErr
	})
	// Guard lifetime includes actual resource read AND encrypted receipt commit.
	// Its Auth scope is deliberately separate from local receipt atomicity.
	return outcome, err
}
