package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/resourceauthority"
)

// The caller is the existing kernel-authenticated native channel. It can only
// observe/cancel the original Source's unsigned review; this is not an approval
// transport, signer, consent production, HTTP entry or worker-dispatch route.
func nativeResourceReview(ctx context.Context, source *resourceauthority.Owner, request localipc.Request, runners ...*contribution.Runner) (localipc.Result, error) {
	var runner *contribution.Runner
	if len(runners) > 1 {
		return localipc.Result{}, contribution.ErrInvalid
	}
	if len(runners) == 1 {
		runner = runners[0]
	}
	var empty struct{}
	if err := nativeDecode(request.Payload, &empty); err != nil {
		return localipc.Result{}, err
	}
	response := struct {
		Capabilities      resourceCapabilitySet `json:"capabilities"`
		Code              string                `json:"code"`
		Authority         bool                  `json:"authority"`
		ProductionEnabled bool                  `json:"productionEnabled"`
		ConsentProduced   bool                  `json:"consentProduced"`
		PhysicalComplete  bool                  `json:"physicalComplete"`
		PreviewBytes      string                `json:"previewBytes,omitempty"`
		PreviewSHA256     string                `json:"previewSHA256,omitempty"`
	}{Code: "NOT_SUPPLIED", Capabilities: resourceCapabilities(runner, source)}
	if source != nil {
		if request.Operation == "resource_review_cancel" {
			complete, err := source.CancelOriginalReview(ctx)
			response.PhysicalComplete = complete
			response.Code = "RETIRED"
			if !complete {
				response.Code = "CLEANUP_PENDING"
			}
			if err != nil && complete {
				response.Code = "RETIRED_WITH_PRIOR_FAILURE"
			}
		} else if request.Operation == "resource_review" {
			state := source.Observe(ctx)
			if !state.Current {
				response.Code = state.Code
				response.PhysicalComplete = state.PhysicalComplete
			} else {
				review, err := source.PrepareOriginalReview(ctx)
				response.Code = "NOT_ADMITTED"
				if err == nil {
					raw, readErr := review.ReadOriginalPreview(ctx)
					if readErr == nil {
						digest := sha256.Sum256(raw)
						response.Code = "UNSIGNED_PREVIEW_ONLY"
						response.PreviewBytes = strconv.Itoa(len(raw))
						response.PreviewSHA256 = hex.EncodeToString(digest[:])
					} else {
						response.PhysicalComplete, _ = review.Close(ctx)
					}
				}
			}
		}
	}
	response.Capabilities = resourceCapabilities(runner, source)
	raw, err := json.Marshal(response)
	return localipc.Result{Payload: raw}, err
}
