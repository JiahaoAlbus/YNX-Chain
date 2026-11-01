package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aigateway"
)

func taskWebDAVModelDefinition() aigateway.ToolDefinition {
	return aigateway.ToolDefinition{Name: taskWebDAVModelName, Description: "Deliver one already-stored attachment to one independently authorized fixed WebDAV destination. Select only resourceId and destinationId. Never supply URLs, paths, credentials, file content or authorship claims. CONTENT_PRESENT means a matching independent GET observation, not proof of who wrote the object. UNKNOWN must query the original object; never retry a PUT.", Parameters: json.RawMessage(`{"type":"object","properties":{"resourceId":{"type":"string"},"destinationId":{"type":"string"}},"required":["resourceId","destinationId"],"additionalProperties":false}`)}
}

func PrepareOriginalTaskRuntimeWithWebDAV(ctx context.Context, model *aigateway.Service, authority OriginalTaskRuntimeAuthority, external *PreparedTaskWebDAVRuntime) (*PreparedOriginalTaskRuntime, error) {
	if external == nil || missingTaskRuntimeOperand(external.authority) {
		return nil, ErrTaskWebDAVUnavailable
	}
	p, err := PrepareOriginalTaskRuntime(ctx, model, authority)
	if err != nil {
		return nil, err
	}
	p.webDAV = external
	return p, nil
}

func (e *taskModelExecutor) executeWebDAVTool(ctx context.Context, call aigateway.ToolCall) (aigateway.ToolExecution, error) {
	var in struct {
		ResourceID    string `json:"resourceId"`
		DestinationID string `json:"destinationId"`
	}
	if len(call.Function.Arguments) > 32<<10 || rejectDuplicateShopJSON([]byte(call.Function.Arguments)) != nil || strictToolJSON(bytes.NewBufferString(call.Function.Arguments), &in) != nil || !toolOperationID.MatchString(in.ResourceID) || !toolOperationID.MatchString(in.DestinationID) {
		return aigateway.ToolExecution{Status: aigateway.ToolStopped}, errToolInvalid
	}
	operation := modelToolOperation(e.run.TaskID, e.run.RunID, call.ID)
	e.steps = append(e.steps, operation)
	input := TaskWebDAVInput{OperationID: operation, ResourceID: in.ResourceID, DestinationID: in.DestinationID, TaskRevision: e.run.TaskRevision, Generation: e.run.Generation}
	receipt, err := e.s.executeTaskWebDAV(ctx, e.session, e.run.TaskID, input, e.authorizationRef, false)
	if errors.Is(err, ErrTaskWebDAVUnavailable) {
		return aigateway.ToolExecution{Status: aigateway.ToolNeedsApproval}, err
	}
	if err != nil || receipt.State != "CONTENT_PRESENT" {
		return aigateway.ToolExecution{Status: aigateway.ToolUnknown}, errors.Join(ErrTaskWebDAVUnknown, err)
	}
	raw, err := json.Marshal(receipt)
	// Framework completion means this tool returned its observation; the
	// payload stays CONTENT_PRESENT/authorshipProven:false, never COMMITTED.
	return aigateway.ToolExecution{Status: aigateway.ToolCompleted, Content: raw}, err
}
