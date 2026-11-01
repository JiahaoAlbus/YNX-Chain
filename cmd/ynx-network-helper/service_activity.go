package main

import (
	"encoding/json"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/ownednode"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/participation"
)

// Observes the actual local modules, without calling a publisher or starting
// any worker. None of these fields is consumed as execution authority.
func nativeActivity(peer localipc.Peer, service *participation.Service, node *ownednode.Manager, resource *contribution.Runner) *localipc.Activity {
	a := &localipc.Activity{Version: "YNX-NETWORK-LOCAL-ACTIVITY/v1", Node: localipc.NodeActivity{Code: "NOT_SUPPLIED"}, Participation: localipc.ParticipationActivity{Code: "NOT_SUPPLIED"}, Resource: localipc.ResourceActivity{Code: "UNAVAILABLE", Rewards: "NOT_AUTHORIZED"}}
	if node != nil {
		state, err := node.Status(peer)
		if err != nil {
			a.Node.Code = "UNAVAILABLE"
		} else {
			// This original manager deliberately has no production release adapter.
			a.Node = localipc.NodeActivity{Code: "UNSUPPORTED", Stage: state.Stage, Mode: state.Mode, ProcessOwned: state.ProcessOwned, CapacityComplete: state.Capacity.Complete}
			if raw, err := json.Marshal(state.Diagnostics); err == nil && len(raw) <= 8192 {
				a.Node.Diagnostics = raw
			}
			if state.Capacity.Complete {
				a.Node.UsedBytes = strconv.FormatUint(state.Capacity.UsedBytes, 10)
				a.Node.LimitBytes = strconv.FormatUint(state.Capacity.LimitBytes, 10)
				a.Node.FreeBytes = strconv.FormatUint(state.Capacity.FreeBytes, 10)
			}
		}
	}
	if service != nil {
		s := service.LocalStatus()
		a.Participation = localipc.ParticipationActivity{Code: s.Code, Configured: s.Configured, WalletPublisherConfigured: s.WalletPublisherConfigured, Stopped: s.Stopped, Entries: s.Entries, UnknownEntries: s.UnknownEntries}
	}
	if resource != nil {
		m := resource.VerifyResourceMeter()
		code := "DISABLED"
		if m.State == "running" {
			code = "CONTROLLED_SANDBOX"
		}
		if m.Accounting == "UNKNOWN_LOCAL_PERSISTENCE" {
			code = "UNKNOWN"
		}
		a.Resource = localipc.ResourceActivity{Code: code, State: m.State, ActiveWorkers: strconv.FormatUint(m.ActiveWorkers, 10), VerifiedJobs: strconv.FormatUint(m.VerifiedJobs, 10), VerifiedBytes: strconv.FormatUint(m.VerifiedBytes, 10), Rewards: "NOT_AUTHORIZED"}
		a.Resource.ContainmentMode = contribution.ProcessContainmentSupport().Mode
		a.Resource.OSMeasuredChildren = strconv.FormatUint(m.OSMeasuredChildren, 10)
		a.Resource.OSUserMicros = strconv.FormatUint(m.OSUserMicros, 10)
		a.Resource.OSSystemMicros = strconv.FormatUint(m.OSSystemMicros, 10)
		a.Resource.OSPeakRSSBytes = strconv.FormatUint(m.OSPeakRSSBytes, 10)
	}
	return a
}
