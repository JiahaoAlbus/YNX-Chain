package main

import (
	"context"
	"encoding/json"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
)

// Private kernel channel DATA only. No request can initialize/rebind a
// resource, choose counters, register/sign an issuer or turn on execution.
// The original registered publisher/sole SDK must independently authenticate
// and frame the returned nine fields; this transport supplies no authority.
func nativeResourceCurrent(ctx context.Context, runner *contribution.Runner, request localipc.Request) (localipc.Result, error) {
	var empty struct{}
	if err := nativeDecode(request.Payload, &empty); err != nil {
		return localipc.Result{}, err
	}
	response := struct {
		Code              string                            `json:"code"`
		Classification    string                            `json:"classification"`
		Authority         bool                              `json:"authority"`
		RegisteredIssuer  bool                              `json:"registeredIssuer"`
		ProductionEnabled bool                              `json:"productionEnabled"`
		ResourceCurrent   *contribution.ResourceCurrentDATA `json:"resourceCurrent,omitempty"`
	}{Code: "NOT_SUPPLIED", Classification: "UNSIGNED_LOCAL_RESOURCE_CURRENT_DATA"}
	if runner != nil {
		data, err := runner.ReadCurrentResourceDATA(ctx)
		response.Code = "UNAVAILABLE"
		if err == nil {
			response.Code = "DATA_ONLY"
			response.ResourceCurrent = &data
		}
	}
	raw, err := json.Marshal(response)
	return localipc.Result{Payload: raw}, err
}
