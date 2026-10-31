package aiproduct

import (
	"bytes"
	"strconv"

	policy "ynx.local/authgrantpolicy"
)

// Original resource request identity only, not a Grant, Source or authority
// profile. Realm/tenant/channel are supplied by the protected runtime itself.
// The concrete callee adapter maps these fields to its original request type.
type originalGrantRequestIdentity struct {
	Account, TaskID, TaskRevision, Generation, StepID, Holder, SessionID string
	OriginalTaskRevision, OriginalGeneration                             string
	Input                                                                policy.Bind
}

func bindOriginalGrantRequest(request OriginalTaskAuthorizationRequest) (originalGrantRequestIdentity, error) {
	var zero originalGrantRequestIdentity
	task, step, session := request.Task, request.Step, request.Session
	binding := step.ToolStep
	if request.AuthorizationRef == "" || len(request.AuthorizationRef) > 256 || task.ID == "" || task.Account == "" || binding == nil || step.ID == "" || step.Account != task.Account || step.ConversationID != task.ConversationID || session.ID == "" || session.Account != task.Account || session.DeviceID == "" || session.DeviceID != task.Holder || binding.TaskID != task.ID || binding.TaskRevision == 0 || binding.Generation == 0 || binding.Holder == "" || len(request.Input) == 0 || len(request.Input) > 32<<10 || request.OriginalOperationID != step.ID {
		return zero, errToolConflict
	}
	if request.QueryOriginal {
		// The actual query API fences the CURRENT task revision/generation while
		// retaining the immutable signed original slot separately. This metadata
		// mapping grants no holder transfer or query authorization.
		if binding.RemoteOperationID != step.ID || (step.Status != "UNKNOWN" && step.Status != "DISPATCHING" && step.Status != "RECONCILING") {
			return zero, errToolConflict
		}
	} else {
		if task.Revision != binding.TaskRevision || task.Generation != binding.Generation || task.Holder != binding.Holder || !task.CancelledAt.IsZero() || (step.Status != "NEEDS_APPROVAL" && step.Status != "approved_not_executed" && step.Status != "DISPATCHING") {
			return zero, errToolConflict
		}
		canonical, _, err := canonicalTaskToolInput(binding.ToolID, request.Input)
		if err != nil || binding.ToolVersion != "1" || !bytes.Equal(canonical, request.Input) {
			return zero, errToolConflict
		}
	}
	raw := bindTaskBytes(request.Input)
	return originalGrantRequestIdentity{Account: task.Account, TaskID: task.ID, TaskRevision: strconv.FormatUint(task.Revision, 10), Generation: strconv.FormatUint(task.Generation, 10), OriginalTaskRevision: strconv.FormatUint(binding.TaskRevision, 10), OriginalGeneration: strconv.FormatUint(binding.Generation, 10), StepID: step.ID, Holder: binding.Holder, SessionID: session.ID, Input: policy.Bind{Bytes: strconv.Itoa(raw.Bytes), SHA3_512: raw.SHA3_512, SHA512: raw.SHA512}}, nil
}
