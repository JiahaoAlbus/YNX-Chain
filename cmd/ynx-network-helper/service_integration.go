package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/ownednode"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/participation"
)

// This channel authenticates its native caller using kernel peer credentials.
// It grants no authority to a browser and never accepts a caller UID in JSON.
// Production effect handlers remain unavailable until their original authority
// adapters exist. A permission request is not an approval or execution permit.
func startNativeService(ctx context.Context, directory string, service *participation.Service, node *ownednode.Manager, resource *contribution.Runner) (*localipc.Server, error) {
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
			return localipc.Result{Status: &localipc.Status{Service: "YNX Network", NodeControl: "unavailable", ResourceContribution: state}}, nil
		case "request_permission":
			return localipc.Result{Permission: &localipc.PermissionResult{State: "unsupported"}}, nil
		default:
			if len(r.Operation) >= 9 && r.Operation[:9] == "resource_" {
				return nativeResource(ctx, resource, r)
			}
			if len(r.Operation) >= 5 && r.Operation[:5] == "node_" {
				return nativeNode(ctx, node, peer, r)
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

func nativeNode(ctx context.Context, node *ownednode.Manager, peer localipc.Peer, r localipc.Request) (localipc.Result, error) {
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
	// Native IPC identifies a caller; neither a JSON boolean nor possession of
	// an intent is the trusted visible-consent entry. No approval is fabricated.
	var intent ownednode.Intent
	if err := nativeDecode(r.Payload, &intent); err != nil {
		return localipc.Result{}, err
	}
	var err error
	switch r.Operation {
	case "node_install":
		err = node.Install(ctx, peer, intent, nil)
	case "node_start":
		_, err = node.Start(ctx, peer, intent, nil)
	case "node_stop":
		err = node.Stop(ctx, peer, intent, nil)
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
