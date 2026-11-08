package aiproduct

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"reflect"

	originalclient "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-history-client/go"
	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	policy "ynx.local/authgrantpolicy"
)

// Only the zero-input original factory installs the concrete production
// client. This private interface also permits explicitly PUBLIC consumer tests.
type originalTaskBrokerClient interface {
	Current(context.Context) error
	AuthorizeAtEffect(context.Context, originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error)
	QueryOriginalEffect(context.Context, originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error)
}

type originalTaskAuthorityBroker struct{ client originalTaskBrokerClient }
type originalBrokerQueryMaterial struct {
	State   string
	Binding policy.TaskEffectBinding
	Call    originalclient.TaskAuthorityCall
}
type originalTaskQueryMaterialAuthority interface {
	queryOriginalTaskMaterial(context.Context, OriginalTaskAuthorizationRequest) (originalBrokerQueryMaterial, error)
}

func (b *originalTaskAuthorityBroker) current(ctx context.Context) error {
	if b == nil || missingTaskRuntimeOperand(b.client) || ctx == nil {
		return errTaskEffectSourceUnavailable
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return b.client.Current(ctx)
}
func (b *originalTaskAuthorityBroker) effectCurrent(ctx context.Context) error {
	if err := b.current(ctx); err != nil {
		return err
	}
	if client, ok := b.client.(interface{ NewEffectsCurrent(context.Context) error }); ok {
		return client.NewEffectsCurrent(ctx)
	}
	return nil
}

func (p *PreparedOriginalTaskRuntime) queryCurrent(ctx context.Context) error {
	if p == nil || ctx == nil || missingTaskRuntimeOperand(p.authority) {
		return errTaskEffectSourceUnavailable
	}
	if p.broker == nil {
		return p.current(ctx)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if source, ok := p.authority.(interface{ queryCurrent(context.Context) error }); ok {
		if err := source.queryCurrent(ctx); err != nil {
			return err
		}
	} else if err := p.authority.Current(ctx); err != nil {
		return err
	}
	return p.broker.current(ctx)
}

func (e *originalRuntimeToolEffects) taskToolAvailable(ctx context.Context, toolID string) error {
	if e == nil || e.runtime == nil {
		return errTaskEffectSourceUnavailable
	}
	if err := e.runtime.current(ctx); err != nil {
		return err
	}
	if e.runtime.broker != nil {
		// Readiness of the original registered Auth action is not an approval.
		// Full target/tool/proof selection and actual reservation remain Auth's.
		if toolID != shopOrderToolID && toolID != "ai.conversation.read" {
			return errTaskEffectSourceUnavailable
		}
		if toolID == "ai.conversation.read" {
			if err := e.originalReceiverCurrent(ctx); err != nil {
				return err
			}
		}
		return e.runtime.broker.effectCurrent(ctx)
	}
	// A native signature/read gate alone must never activate production
	// effects without the original authority's reservation and receipt CAS.
	if _, native := e.runtime.authority.(*nativeTaskRuntimeAuthority); native {
		return errTaskEffectSourceUnavailable
	}
	if toolID == "ai.conversation.read" || (toolID == shopOrderToolID && e.runtime.shop != nil) {
		return nil
	}
	return errTaskEffectSourceUnavailable
}

// Only the normal native composition requires its actual mounted borrower.
// Readiness is not an effect claim. Original reconciliation never calls this.
func (e *originalRuntimeToolEffects) originalReceiverCurrent(ctx context.Context) error {
	authority, native := e.runtime.authority.(*nativeTaskRuntimeAuthority)
	if !native {
		return nil // explicit PUBLIC/non-native composition has its own Source
	}
	e.receiverMu.Lock()
	receiver := e.receiver
	e.receiverMu.Unlock()
	if authority.localOwner == nil || receiver == nil {
		return errTaskEffectSourceUnavailable
	}
	if err := receiver.currentForExecution(ctx, e.store, authority.localOwner); err != nil {
		return errors.Join(errTaskEffectSourceUnavailable, err)
	}
	return nil
}

func originalBrokerShopProfile(binding policy.TaskEffectBinding) (OriginalShopOrderProfile, error) {
	if binding.Target.Service == "" || len(binding.Resources) != 1 || binding.Resources[0].Kind == "" || shopSDKTool(binding.Tool) != open.ShopOrderReadToolDescriptorDATA() {
		return OriginalShopOrderProfile{}, errToolConflict
	}
	// Target comes from native verified Grant/Source material. The original
	// broker independently checks its registered destination before sending.
	return OriginalShopOrderProfile{Tool: binding.Tool, Target: binding.Target, OrderKind: binding.Resources[0].Kind}, nil
}

func (b *originalTaskAuthorityBroker) selected(store *Store, call taskEffectCall, auth OriginalTaskGrantAuthorization, query bool) (OriginalShopOrderCall, error) {
	profile, err := originalBrokerShopProfile(auth.Binding)
	if err != nil {
		return OriginalShopOrderCall{}, err
	}
	return selectOriginalShopOrderCall(store, call, auth, profile, query)
}

func originalBrokerOperation(id string) bool {
	decoded, err := hex.DecodeString(id)
	return len(id) == 64 && err == nil && hex.EncodeToString(decoded) == id
}

func retainOriginalBrokerReference(store *Store, request OriginalTaskAuthorizationRequest, result originalclient.TaskAuthorityResult) error {
	if result.OriginalOperation == "" && result.State == "" {
		return nil
	}
	if !originalBrokerOperation(result.OriginalOperation) {
		return errToolConflict
	}
	return store.retainOriginalAuthorityReference(request, originalTaskOperationReference{State: result.State, OperationID: result.OriginalOperation})
}

func retainOriginalBrokerLocator(store *Store, selected OriginalShopOrderCall, result originalclient.TaskAuthorityResult) error {
	if result.Resource == nil {
		return nil
	}
	if result.Resource.OperationID != result.OriginalOperation || !originalBrokerOperation(result.OriginalOperation) {
		return errToolConflict
	}
	// A bounded partial locator is recovery metadata, never a receipt. Keep it
	// before a late original-current error, without accepting response content.
	return captureShopRemoteRef(store, selected, result.Resource.RemoteRef)
}

func (b *originalTaskAuthorityBroker) dispatch(ctx context.Context, e *originalRuntimeToolEffects, call taskEffectCall, ref string, auth OriginalTaskGrantAuthorization) (taskReadReceipt, error) {
	request, err := e.originalBoundRequest(ctx, call, ref, false)
	if err != nil {
		return taskReadReceipt{}, err
	}
	selected, err := b.selected(e.store, call, auth, false)
	if err != nil {
		return taskReadReceipt{}, err
	}
	profile, err := originalBrokerShopProfile(auth.Binding)
	if err != nil {
		return taskReadReceipt{}, err
	}
	if _, err := EncodeOriginalShopOrderRequestDATA(ctx, selected, profile); err != nil {
		return taskReadReceipt{}, err
	}
	grant, err := open.DecodeBoundGrant(auth.Grant.Payload)
	if err != nil {
		return taskReadReceipt{}, err
	}
	if err := e.runtime.current(ctx); err != nil {
		return taskReadReceipt{}, err
	}
	// NEW never carries either the local step or a caller-selected Node op.
	result, effectErr := b.client.AuthorizeAtEffect(ctx, originalclient.TaskAuthorityCall{Grant: selected.Grant, Holder: selected.Holder, RawInput: bytes.Clone(selected.Input), GrantRef: open.LegacyGrantRefV1{Realm: grant.Realm, Tenant: grant.Tenant, Kind: "grant", ID: grant.ID, Rev: grant.Rev}})
	retainErr := retainOriginalBrokerReference(e.store, request, result)
	var locatorErr error
	if retainErr == nil {
		locatorErr = retainOriginalBrokerLocator(e.store, selected, result)
	}
	if effectErr != nil || retainErr != nil || locatorErr != nil {
		return taskReadReceipt{}, errors.Join(effectErr, retainErr, locatorErr)
	}
	return b.accept(ctx, e, call, selected, result)
}

func (b *originalTaskAuthorityBroker) reconcile(ctx context.Context, e *originalRuntimeToolEffects, call taskEffectCall, ref string) (taskReadReceipt, error) {
	if call.OriginalStep.ToolStep != nil && call.OriginalStep.ToolStep.ToolID == "ai.conversation.read" {
		return b.reconcileConversation(ctx, e, call, ref)
	}
	request, err := e.originalQueryRequest(ctx, call, ref)
	if err != nil {
		return taskReadReceipt{}, err
	}
	source, ok := e.runtime.authority.(originalTaskQueryMaterialAuthority)
	if !ok {
		return taskReadReceipt{}, errTaskEffectSourceUnavailable
	}
	material, err := source.queryOriginalTaskMaterial(ctx, request)
	if err != nil {
		return taskReadReceipt{}, err
	}
	if !originalBrokerOperation(material.Call.OriginalOperation) {
		return taskReadReceipt{}, errToolConflict
	}
	if err := retainOriginalBrokerReference(e.store, request, originalclient.TaskAuthorityResult{State: material.State, OriginalOperation: material.Call.OriginalOperation}); err != nil {
		return taskReadReceipt{}, err
	}
	auth := OriginalTaskGrantAuthorization{Binding: material.Binding, Grant: material.Call.Grant, Holder: material.Call.Holder}
	selected, err := b.selected(e.store, call, auth, true)
	if err != nil {
		return taskReadReceipt{}, err
	}
	material.Call.RawInput = bytes.Clone(selected.Input)
	if err := e.runtime.queryCurrent(ctx); err != nil {
		return taskReadReceipt{}, err
	}
	result, queryErr := b.client.QueryOriginalEffect(ctx, material.Call)
	retainErr := retainOriginalBrokerReference(e.store, request, result)
	var locatorErr error
	if retainErr == nil {
		locatorErr = retainOriginalBrokerLocator(e.store, selected, result)
	}
	if queryErr != nil || retainErr != nil || locatorErr != nil {
		return taskReadReceipt{}, errors.Join(queryErr, retainErr, locatorErr)
	}
	if result.OriginalOperation != material.Call.OriginalOperation {
		return taskReadReceipt{}, errToolConflict
	}
	return b.accept(ctx, e, call, selected, result)
}

func (b *originalTaskAuthorityBroker) accept(ctx context.Context, e *originalRuntimeToolEffects, call taskEffectCall, selected OriginalShopOrderCall, result originalclient.TaskAuthorityResult) (taskReadReceipt, error) {
	if result.State != "COMMITTED" || !originalBrokerOperation(result.OriginalOperation) || result.Resource == nil {
		return taskReadReceipt{}, errTaskEffectUnresolved
	}
	resource := *result.Resource
	if len(resource.ResponseOriginal) == 0 || len(resource.ResponseOriginal) > 1<<20 || len(resource.SourceBytes) == 0 || len(resource.SourceBytes) > 1<<20 {
		return taskReadReceipt{}, errToolInvalid
	}
	resource.ResponseOriginal, resource.SourceBytes = bytes.Clone(resource.ResponseOriginal), bytes.Clone(resource.SourceBytes)
	resource.Source.Fields = append([]string(nil), resource.Source.Fields...)
	if resource.OperationID != result.OriginalOperation || resource.AuthScope != string(policy.EgressOnlyReadFence) || resource.ResponseBinding != shopAuthBind(resource.ResponseOriginal) || len(selected.Binding.Sources) != 1 || !reflect.DeepEqual(resource.Source, selected.Binding.Sources[0]) || resource.Source.Binding != shopAuthBind(resource.SourceBytes) {
		return taskReadReceipt{}, errToolConflict
	}
	profile, err := originalBrokerShopProfile(selected.Binding)
	if err != nil {
		return taskReadReceipt{}, err
	}
	response := OriginalShopOrderTransportResult{Body: resource.ResponseOriginal, ContentType: "application/json", RemoteRef: resource.RemoteRef}
	data, err := DecodeOriginalShopOrderResponseDATA(ctx, selected, response, profile)
	if err != nil {
		return taskReadReceipt{}, err
	}
	if !bytes.Equal(data.SourceBytes, resource.SourceBytes) || shopPolicyBind(data.ResponseBinding) != resource.ResponseBinding || data.AuthFence != resource.AuthScope {
		return taskReadReceipt{}, errToolConflict
	}
	var view struct {
		Projection json.RawMessage `json:"projection"`
	}
	if err := json.Unmarshal(data.ResponseOriginal, &view); err != nil {
		return taskReadReceipt{}, err
	}
	decoded := OriginalShopOrderDecodedResult{OriginalOperationID: resource.OperationID, RemoteRef: resource.RemoteRef, ResultJSON: bytes.Clone(view.Projection), SourceBytes: resource.SourceBytes, Source: resource.Source, AuthScope: policy.FenceScope(resource.AuthScope)}
	return acceptOriginalShopDecodedResult(ctx, e.runtime.queryCurrent, e.store, call, selected, response, decoded, resource.OperationID)
}
