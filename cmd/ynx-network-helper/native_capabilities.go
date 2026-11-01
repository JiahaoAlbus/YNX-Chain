package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"reflect"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/ownednode"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/participation"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/resourceauthority"
)

// Capabilities describe calls the actual local service can currently attempt.
// They are observations, never permission, native consent, funds or finality.
// Every request still passes the original per-operation gates and generation.
type nodeCapabilitySet struct {
	Install        bool `json:"install"`
	Start          bool `json:"start"`
	Stop           bool `json:"stop"`
	Restart        bool `json:"restart"`
	VisibleConsent bool `json:"visibleConsent"`
	Read           bool `json:"read"`
	Logs           bool `json:"logs"`
}
type participationCapabilitySet struct {
	Prepare   bool `json:"prepare"`
	Read      bool `json:"read"`
	Review    bool `json:"review"`
	Cancel    bool `json:"cancel"`
	Reconcile bool `json:"reconcile"`
	Submit    bool `json:"submit"`
	Revoke    bool `json:"revoke"`
	List      bool `json:"list"`
}
type resourceCapabilitySet struct {
	Read               bool `json:"read"`
	Meter              bool `json:"meter"`
	Stop               bool `json:"stop"`
	Review             bool `json:"review"`
	CancelReview       bool `json:"cancelReview"`
	ProductionDispatch bool `json:"productionDispatch"`
}

func nodeCapabilities(node *ownednode.Manager, peer localipc.Peer, prompt nodeConsent) nodeCapabilitySet {
	if node == nil {
		return nodeCapabilitySet{}
	}
	status, err := node.Status(peer)
	if err != nil {
		return nodeCapabilitySet{}
	}
	present := prompt != nil
	if present {
		value := reflect.ValueOf(prompt)
		switch value.Kind() {
		case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
			present = !value.IsNil()
		}
	}
	return nodeCapabilitiesFromStatus(status, present)
}
func nodeCapabilitiesFromStatus(status ownednode.Status, present bool) nodeCapabilitySet {
	production := present && status.Mode == "production" && status.ProductionSupported
	logs := status.Diagnostics.Logs
	return nodeCapabilitySet{
		Install:        production && status.Stage == "not_installed" && !status.ProcessOwned,
		Start:          production && (status.Stage == "installed" || status.Stage == "stopped") && !status.ProcessOwned,
		Stop:           present && status.ProcessOwned && status.Stage == "running",
		Restart:        production && status.ProcessOwned && status.Stage == "running",
		VisibleConsent: present, Read: true,
		Logs: (logs.Code == "CAPTURING" || logs.Code == "CAPTURED" || logs.Code == "INCOMPLETE") && (logs.Stdout != nil || logs.Stderr != nil),
	}
}
func participationCapabilities(service *participation.Service) participationCapabilitySet {
	if service == nil {
		return participationCapabilitySet{}
	}
	status := service.LocalStatus()
	if !status.Configured || status.Code == "UNAVAILABLE" {
		return participationCapabilitySet{}
	}
	return participationCapabilitySet{
		Prepare: !status.Stopped, Read: true, Review: true, Cancel: true,
		Reconcile: true, Submit: !status.Stopped && status.Code == "CONFIGURED" && status.WalletPublisherConfigured,
		Revoke: !status.Stopped, List: true,
	}
}
func participationEntryCapabilities(caps participationCapabilitySet, entry participation.Entry, code string) participationCapabilitySet {
	known := entry.ID != ""
	caps.Submit = caps.Submit && code == "OK" && known && entry.State == participation.Prepared && entry.PublishAttemptedAt == "" && entry.CancelRequestedAt == ""
	caps.Review = caps.Review && known
	caps.Cancel = caps.Cancel && known && entry.CancelRequestedAt == "" && (entry.State == participation.Prepared || entry.State == participation.Unsupported || entry.State == participation.Unknown || entry.State == participation.AwaitingWallet)
	caps.Reconcile = caps.Reconcile && known && (entry.State == participation.Unknown || entry.State == participation.AwaitingWallet)
	return caps
}
func resourceCapabilities(runner *contribution.Runner, source *resourceauthority.Owner) resourceCapabilitySet {
	var out resourceCapabilitySet
	if runner != nil {
		meter := runner.VerifyResourceMeter()
		out.Read, out.Meter = true, true
		out.Stop = meter.State != "stopped"
	}
	if source != nil {
		// Observe the actual same-attempt selection and physical review owner;
		// Source-current alone cannot tell whether a once-only review is used.
		out.Review, out.CancelReview = source.ReviewAvailability()
	}
	return out // ProductionDispatch is always false, including controlled tests.
}

func decodeParticipationHistory(raw []byte) (string, int, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return "", 0, participation.ErrInvalid
	}
	seen := map[string]bool{}
	cursor, limit := "", participation.DefaultHistoryLimit
	for decoder.More() {
		token, err = decoder.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return "", 0, participation.ErrInvalid
		}
		seen[key] = true
		var value json.RawMessage
		if decoder.Decode(&value) != nil || bytes.Equal(value, []byte("null")) {
			return "", 0, participation.ErrInvalid
		}
		switch key {
		case "cursor":
			if json.Unmarshal(value, &cursor) != nil || len(cursor) > participation.MaxHistoryCursorBytes {
				return "", 0, participation.ErrInvalid
			}
		case "limit":
			if json.Unmarshal(value, &limit) != nil || limit < 1 || limit > participation.MaxHistoryLimit {
				return "", 0, participation.ErrInvalid
			}
		default:
			return "", 0, participation.ErrInvalid
		}
	}
	if token, err = decoder.Token(); err != nil || token != json.Delim('}') || decoder.Decode(new(any)) != io.EOF {
		return "", 0, participation.ErrInvalid
	}
	return cursor, limit, nil
}
func historyCode(err error) string {
	switch {
	case err == nil:
		return "OK"
	case errors.Is(err, participation.ErrConflict):
		return "CONFLICT"
	case errors.Is(err, participation.ErrUnavailable):
		return "UNAVAILABLE"
	default:
		return "INVALID"
	}
}

func decodeParticipationResolve(raw []byte) (string, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') || !decoder.More() {
		return "", participation.ErrInvalid
	}
	token, err = decoder.Token()
	if err != nil || token != "requestId" {
		return "", participation.ErrInvalid
	}
	var value json.RawMessage
	var requestID string
	if decoder.Decode(&value) != nil || bytes.Equal(value, []byte("null")) || json.Unmarshal(value, &requestID) != nil || len(requestID) == 0 || len(requestID) > 128 || decoder.More() {
		return "", participation.ErrInvalid
	}
	for _, c := range requestID {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-' || c == '.' || c == ':') {
			return "", participation.ErrInvalid
		}
	}
	if token, err = decoder.Token(); err != nil || token != json.Delim('}') || decoder.Decode(new(any)) != io.EOF {
		return "", participation.ErrInvalid
	}
	return requestID, nil
}
