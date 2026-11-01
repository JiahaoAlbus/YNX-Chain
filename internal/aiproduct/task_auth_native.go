package aiproduct

import (
	"context"
	"errors"
	tasklocal "github.com/JiahaoAlbus/YNX-Chain/internal/authtasklocal"
	originalclient "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-history-client/go"
	native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
)

// Actual native callee adapter. No Source, realm, tenant, issuer, key or clock
// is selected by caller input. The original zero-input factory owns admission.
type nativeTaskRuntimeAuthority struct {
	owner                    *native.Runtime
	queryOwner               *native.QueryRuntime
	localOwner               *tasklocal.Owner
	localHistory             *tasklocal.History
	localAcquireError        error
	localHistoryAcquireError error
}

func OpenOriginalTaskAuthority() (*nativeTaskRuntimeAuthority, error) {
	owner, err := native.OpenOriginalGrantRuntime()
	var result *nativeTaskRuntimeAuthority
	if owner != nil {
		result = &nativeTaskRuntimeAuthority{owner: owner}
	}
	if err != nil {
		return result, err
	}
	if result == nil {
		return nil, errTaskEffectSourceUnavailable
	}
	return result, nil
}
func (a *nativeTaskRuntimeAuthority) Current(ctx context.Context) error {
	if a == nil || a.owner == nil {
		return native.ErrUnavailable
	}
	return a.owner.Current(ctx)
}
func (a *nativeTaskRuntimeAuthority) request(ctx context.Context, input OriginalTaskAuthorizationRequest) (native.OriginalTaskRequest, error) {
	var zero native.OriginalTaskRequest
	if err := a.Current(ctx); err != nil {
		return zero, err
	}
	identity, err := bindOriginalGrantRequest(input)
	if err != nil {
		return zero, err
	}
	var scope native.TaskAuthorityProfile
	if input.Step.ToolStep != nil && input.Step.ToolStep.ToolID == "ai.conversation.read" && a.localOwner != nil {
		scope, err = a.localOwner.TaskAuthorityProfile(ctx)
	} else {
		scope, err = a.owner.TaskAuthorityProfile(ctx)
	}
	if err != nil {
		return zero, err
	}
	return native.OriginalTaskRequest{AuthorizationRef: input.AuthorizationRef, Realm: scope.Realm, Tenant: scope.Tenant, Account: identity.Account, TaskID: identity.TaskID, TaskRevision: identity.TaskRevision, Generation: identity.Generation, StepID: identity.StepID, Holder: identity.Holder, SessionID: identity.SessionID, Input: identity.Input}, nil
}
func (a *nativeTaskRuntimeAuthority) ResolveTaskGrant(ctx context.Context, input OriginalTaskAuthorizationRequest) (OriginalTaskGrantAuthorization, error) {
	var zero OriginalTaskGrantAuthorization
	if input.QueryOriginal {
		return zero, errTaskEffectUnresolved
	}
	request, err := a.request(ctx, input)
	if err != nil {
		return zero, err
	}
	var original native.TaskAuthorization
	if input.Step.ToolStep != nil && input.Step.ToolStep.ToolID == "ai.conversation.read" {
		if a.localAcquireError != nil {
			return zero, a.localAcquireError
		}
		if a.localOwner == nil {
			return zero, errTaskEffectSourceUnavailable
		}
		original, err = a.localOwner.ResolveTaskGrant(ctx, request)
	} else {
		original, err = a.owner.ResolveTaskGrant(ctx, request)
	}
	if err != nil {
		return zero, err
	}
	return OriginalTaskGrantAuthorization{Verifier: original.Verifier, Binding: original.Binding, Grant: original.Grant, Holder: original.Holder}, nil
}
func (a *nativeTaskRuntimeAuthority) queryOriginalTaskOperation(ctx context.Context, input OriginalTaskAuthorizationRequest) (originalTaskOperationReference, error) {
	if !input.QueryOriginal {
		return originalTaskOperationReference{}, errToolConflict
	}
	request, err := a.queryRequest(ctx, input)
	if err != nil {
		return originalTaskOperationReference{}, err
	}
	var original native.OriginalOperationReference
	if input.Step.ToolStep != nil && input.Step.ToolStep.ToolID == "ai.conversation.read" {
		if a.localHistoryAcquireError != nil {
			return originalTaskOperationReference{}, a.localHistoryAcquireError
		}
		if a.localHistory == nil {
			return originalTaskOperationReference{}, errTaskEffectSourceUnavailable
		}
		original, err = a.localHistory.QueryOriginalTaskRequest(ctx, request)
	} else {
		original, err = a.queryOwner.QueryOriginalTaskRequest(ctx, request)
	}
	// Keep a nonzero partial even when the original late current/close check fails.
	return originalTaskOperationReference{State: original.State, OperationID: original.OperationID}, err
}

func (a *nativeTaskRuntimeAuthority) queryOriginalTaskMaterial(ctx context.Context, input OriginalTaskAuthorizationRequest) (originalBrokerQueryMaterial, error) {
	if !input.QueryOriginal {
		return originalBrokerQueryMaterial{}, errToolConflict
	}
	request, err := a.queryRequest(ctx, input)
	if err != nil {
		return originalBrokerQueryMaterial{}, err
	}
	original, err := a.queryOwner.ResolveOriginalTaskQueryMaterial(ctx, request)
	if err != nil {
		return originalBrokerQueryMaterial{}, err
	}
	return originalBrokerQueryMaterial{State: original.State, Binding: original.Binding, Call: originalclient.TaskAuthorityCall{Grant: original.Grant, Holder: original.Holder, GrantRef: original.CurrentGrantRef, OriginalOperation: original.OriginalOperationID}}, nil
}

func (a *nativeTaskRuntimeAuthority) queryCurrent(ctx context.Context) error {
	if a == nil || a.queryOwner == nil {
		return native.ErrUnavailable
	}
	return a.queryOwner.Current(ctx)
}

func (a *nativeTaskRuntimeAuthority) queryRequest(ctx context.Context, input OriginalTaskAuthorizationRequest) (native.OriginalTaskRequest, error) {
	var zero native.OriginalTaskRequest
	if err := a.queryCurrent(ctx); err != nil {
		return zero, err
	}
	if !input.QueryOriginal {
		return zero, errToolConflict
	}
	identity, err := bindOriginalGrantRequest(input)
	if err != nil {
		return zero, err
	}
	scope, err := a.queryOwner.TaskAuthorityQueryProfile(ctx)
	if err != nil {
		return zero, err
	}
	return native.OriginalTaskRequest{AuthorizationRef: input.AuthorizationRef, Realm: scope.Realm, Tenant: scope.Tenant, Account: identity.Account, TaskID: identity.TaskID, TaskRevision: identity.TaskRevision, Generation: identity.Generation, StepID: identity.StepID, Holder: identity.Holder, SessionID: identity.SessionID, Input: identity.Input}, nil
}
func (a *nativeTaskRuntimeAuthority) CheckTaskModelDisclosure(ctx context.Context, session ProductSession, task TaskRecord, url, model string, body []byte) error {
	if err := a.Current(ctx); err != nil {
		return err
	}
	if task.Account != session.Account || task.Holder != session.DeviceID || session.ID == "" {
		return errToolConflict
	}
	return a.owner.CheckTaskModelDisclosure(ctx, native.ModelDisclosureRequest{Account: session.Account, TaskID: task.ID, SessionID: session.ID, URL: url, Model: model, Body: append([]byte(nil), body...)})
}
func (a *nativeTaskRuntimeAuthority) Retire() error {
	if a == nil {
		return nil
	}
	var err error
	if a.owner != nil {
		err = errors.Join(err, a.owner.Retire())
	}
	if a.queryOwner != nil {
		err = errors.Join(err, a.queryOwner.Retire())
	}
	if a.localOwner != nil {
		err = errors.Join(err, a.localOwner.Retire())
	}
	if a.localHistory != nil {
		err = errors.Join(err, a.localHistory.Retire())
	}
	return err
}
func (a *nativeTaskRuntimeAuthority) Close() error {
	if a == nil {
		return nil
	}
	var err error
	if a.localOwner != nil {
		err = errors.Join(err, a.localOwner.Join(), a.localOwner.Close())
	}
	if a.localHistory != nil {
		err = errors.Join(err, a.localHistory.Close())
	}
	if a.queryOwner != nil {
		err = errors.Join(err, a.queryOwner.Join(), a.queryOwner.Close())
	}
	if a.owner != nil {
		err = errors.Join(err, a.owner.Close())
	}
	return err
}
func (a *nativeTaskRuntimeAuthority) retireAndClose() error {
	return errors.Join(a.Retire(), a.Close())
}

var _ OriginalTaskRuntimeAuthority = (*nativeTaskRuntimeAuthority)(nil)
var _ originalTaskOperationQueryAuthority = (*nativeTaskRuntimeAuthority)(nil)
var _ originalTaskQueryMaterialAuthority = (*nativeTaskRuntimeAuthority)(nil)
