package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/nativeconsent"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/ownednode"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/participation"
)

// This channel authenticates its native caller using kernel peer credentials.
// It grants no authority to a browser and never accepts a caller UID in JSON.
// Production effect handlers remain unavailable until their original authority
// adapters exist. A permission request is not an approval or execution permit.
type nodeConsent interface {
	Confirm(context.Context, ownednode.Intent, string) error
}

func startNativeService(ctx context.Context, directory string, service *participation.Service, node *ownednode.Manager, resource *contribution.Runner, consent ...nodeConsent) (*localipc.Server, error) {
	if len(consent) > 1 {
		return nil, errors.New("one trusted native visible consent producer required")
	}
	var prompt nodeConsent
	if len(consent) == 1 {
		prompt = consent[0]
	}
	return localipc.Start(ctx, localipc.Config{Directory: directory, Handler: func(ctx context.Context, peer localipc.Peer, r localipc.Request) (localipc.Result, error) {
		if !peer.Verified() {
			return localipc.Result{}, errors.New("native identity required")
		}
		switch r.Operation {
		case "status":
			state := "disabled"
			if resource == nil {
				state = "unavailable"
			}
			return localipc.Result{Status: &localipc.Status{Service: "YNX Network", NodeControl: "unavailable", ResourceContribution: state, Activity: nativeActivity(peer, service, node, resource)}}, nil
		case "request_permission":
			return localipc.Result{Permission: &localipc.PermissionResult{State: "unsupported"}}, nil
		default:
			if len(r.Operation) >= 9 && r.Operation[:9] == "resource_" {
				return nativeResource(ctx, resource, r)
			}
			if len(r.Operation) >= 5 && r.Operation[:5] == "node_" {
				return nativeNode(ctx, node, peer, r, prompt)
			}
			return nativeParticipation(ctx, service, r)
		}
	}})
}

func nativeResource(ctx context.Context, runner *contribution.Runner, r localipc.Request) (localipc.Result, error) {
	var empty struct{}
	if err := nativeDecode(r.Payload, &empty); err != nil {
		return localipc.Result{}, err
	}
	if runner == nil {
		return localipc.Result{}, errors.New("resource runner unavailable")
	}
	code := "OK"
	switch r.Operation {
	case "resource_stop":
		if err := runner.StopContribution(ctx); err != nil {
			code = "UNKNOWN"
		}
	case "resource_status", "resource_meter":
	default:
		return localipc.Result{}, errors.New("unsupported resource operation")
	}
	raw, err := json.Marshal(map[string]any{"code": code, "productionEnabled": false, "meter": runner.VerifyResourceMeter()})
	return localipc.Result{Payload: raw}, err
}

func nativeNode(ctx context.Context, node *ownednode.Manager, peer localipc.Peer, r localipc.Request, prompt nodeConsent) (localipc.Result, error) {
	pack := func(value any, code string) (localipc.Result, error) {
		raw, err := json.Marshal(map[string]any{"code": code, "node": value, "productionGrant": false})
		return localipc.Result{Payload: raw}, err
	}
	if node == nil {
		return pack(nil, "NOT_SUPPLIED")
	}
	if r.Operation == "node_status" {
		var empty struct{}
		if err := nativeDecode(r.Payload, &empty); err != nil {
			return localipc.Result{}, err
		}
		status, err := node.Status(peer)
		if err != nil {
			return pack(nil, "UNAVAILABLE")
		}
		return pack(status, "OK")
	}
	if r.Operation == "node_artifact" {
		var empty struct{}
		if err := nativeDecode(r.Payload, &empty); err != nil {
			return localipc.Result{}, err
		}
		status, err := node.Status(peer)
		if err != nil {
			return pack(nil, "UNAVAILABLE")
		}
		if status.Stage == "not_installed" {
			return pack(nil, "NOT_INSTALLED")
		}
		artifact, err := node.ManagedArtifactReadback(peer)
		if err != nil {
			return pack(nil, "RECONCILING")
		}
		return pack(artifact, "OK")
	}
	if r.Operation == "node_prepare" {
		var in struct {
			Action         string `json:"action"`
			ArtifactSHA256 string `json:"artifactSHA256"`
		}
		if err := nativeDecode(r.Payload, &in); err != nil {
			return localipc.Result{}, err
		}
		intent, err := node.Prepare(peer, in.Action, in.ArtifactSHA256)
		if err != nil {
			return pack(nil, "DENIED")
		}
		return pack(intent, "PREPARED")
	}
	// Only a fresh decision from the fixed native visible producer may reach
	// Approve. The IPC caller supplies an exact intent, never an allow boolean.
	var intent ownednode.Intent
	if err := nativeDecode(r.Payload, &intent); err != nil {
		return localipc.Result{}, err
	}
	actions := map[string]string{"node_install": "install", "node_start": "start", "node_stop": "stop"}
	action, known := actions[r.Operation]
	if !known || intent.Action != action {
		return pack(nil, "DENIED")
	}
	current, err := node.Prepare(peer, action, intent.ArtifactSHA256)
	if err != nil || current != intent {
		return pack(nil, "DENIED")
	}
	status, err := node.Status(peer)
	if err != nil {
		return pack(nil, "UNAVAILABLE")
	}
	// Do not ask a person to authorize an effect that the original release
	// gate cannot perform. Stop remains possible only for an owned local run.
	if !status.ProductionSupported && status.Mode == "production" && action != "stop" {
		return pack(nil, "UNSUPPORTED")
	}
	if action == "stop" && !status.ProcessOwned {
		if status.Stage == "reconcile_required" {
			return pack(nil, "RECONCILING")
		}
		return pack(nil, "NOT_RUNNING")
	}
	if prompt == nil {
		return pack(nil, "CONSENT_UNAVAILABLE")
	}
	if err = prompt.Confirm(ctx, intent, status.Mode); err != nil {
		if errors.Is(err, nativeconsent.ErrCancelled) {
			return pack(nil, "CANCELLED")
		}
		if errors.Is(err, nativeconsent.ErrBusy) {
			return pack(nil, "BUSY")
		}
		return pack(nil, "DENIED")
	}
	if ctx.Err() != nil {
		return pack(nil, "CANCELLED")
	}
	approval, err := node.Approve(peer, intent, true, 15*time.Second)
	if err != nil {
		return pack(nil, "DENIED")
	}
	switch r.Operation {
	case "node_install":
		err = node.Install(ctx, peer, intent, approval)
	case "node_start":
		_, err = node.Start(ctx, peer, intent, approval)
	case "node_stop":
		err = node.Stop(ctx, peer, intent, approval)
	default:
		return localipc.Result{}, errors.New("unsupported node operation")
	}
	if errors.Is(err, ownednode.ErrOriginalReleaseMissing) {
		return pack(nil, "UNSUPPORTED")
	}
	if errors.Is(err, ownednode.ErrReconcile) {
		return pack(nil, "RECONCILING")
	}
	if err != nil {
		return pack(nil, "DENIED")
	}
	return pack(nil, "OK")
}

func nativeDecode(raw []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("trailing native request")
	}
	return nil
}
func nativeParticipation(ctx context.Context, service *participation.Service, r localipc.Request) (localipc.Result, error) {
	pack := func(entry any, code string) (localipc.Result, error) {
		raw, err := json.Marshal(map[string]any{"code": code, "entry": entry, "walletApproval": false})
		return localipc.Result{Payload: raw}, err
	}
	if service == nil {
		return pack(nil, "NOT_SUPPLIED")
	}
	codeFor := func(err error) string {
		switch {
		case err == nil:
			return "OK"
		case errors.Is(err, participation.ErrUnsupported):
			return "UNSUPPORTED"
		case errors.Is(err, participation.ErrUnknown):
			return "UNKNOWN"
		case errors.Is(err, participation.ErrRevoked):
			return "REVOKED"
		case errors.Is(err, participation.ErrConflict):
			return "CONFLICT"
		case errors.Is(err, participation.ErrStale):
			return "STALE"
		case errors.Is(err, participation.ErrUnavailable):
			return "UNAVAILABLE"
		case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
			return "CANCELLED"
		default:
			return "INVALID"
		}
	}
	if r.Operation == "participation_prepare" {
		var req participation.Request
		if err := nativeDecode(r.Payload, &req); err != nil {
			return localipc.Result{}, err
		}
		entry, err := service.Prepare(ctx, req)
		return pack(entry, codeFor(err))
	}
	if r.Operation == "participation_revoke" {
		var req struct{}
		if err := nativeDecode(r.Payload, &req); err != nil {
			return localipc.Result{}, err
		}
		err := service.Revoke()
		return pack(nil, codeFor(err))
	}
	var req struct {
		ID string `json:"id"`
	}
	if err := nativeDecode(r.Payload, &req); err != nil || req.ID == "" {
		return localipc.Result{}, errors.New("participation request ID required")
	}
	switch r.Operation {
	case "participation_get":
		entry, ok := service.Get(req.ID)
		if !ok {
			return pack(nil, "NOT_FOUND")
		}
		return pack(entry, "OK")
	case "participation_submit":
		entry, err := service.Submit(ctx, req.ID)
		return pack(entry, codeFor(err))
	case "participation_reconcile":
		entry, err := service.Reconcile(ctx, req.ID)
		return pack(entry, codeFor(err))
	default:
		return localipc.Result{}, errors.New("unsupported native operation")
	}
}
