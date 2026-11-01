package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/ownednode"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/participation"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/resourceauthority"
)

// These public in-process reader/Wallet controls exercise local journal state,
// never real approval, key custody, native signing or original chain effects.
type capabilitiesReader struct {
	network participation.Network
	calls   atomic.Int32
}

func (r *capabilitiesReader) Current(_ context.Context, q participation.Request) (participation.Conditions, error) {
	r.calls.Add(1)
	n, _ := strconv.Atoi(strings.TrimPrefix(q.RequestID, "entry-"))
	return participation.Conditions{Network: r.network, Owner: q.Owner, Action: q.Action, NativeAvailable: true, PolicyRevision: "1", NextNonce: strconv.Itoa(n + 1), ObservedHeight: "9007199254740993", FeeYNXT: "1", Validator: q.Validator, ObjectVersion: "1", AvailableYNXT: "1000000", UnbondingSeconds: "1", CommissionBPS: "0", ObservedAt: time.Now().UTC().Format(time.RFC3339Nano)}, nil
}
func (*capabilitiesReader) ReadResult(context.Context, participation.Intent, string) (participation.Observation, error) {
	return participation.Observation{}, participation.ErrUnsupported
}

type capabilitiesWallet struct {
	network            participation.Network
	publishes, lookups atomic.Int32
}

func (w *capabilitiesWallet) Capabilities(context.Context) (participation.WalletCapabilities, error) {
	return participation.WalletCapabilities{Publisher: "isolated-local-wallet-fixture", Network: w.network, Suite: "YNX-BATCH/v0.1", Actions: []string{"stake_delegate"}, PublishOriginalNativeAction: true, LookupOriginalOperation: true}, nil
}
func (w *capabilitiesWallet) Publish(context.Context, string, participation.Intent, participation.Binding) (participation.WalletResult, error) {
	w.publishes.Add(1)
	return participation.WalletResult{}, errors.New("isolated dropped original response")
}
func (w *capabilitiesWallet) Lookup(context.Context, string, participation.Binding) (participation.WalletResult, error) {
	w.lookups.Add(1)
	return participation.WalletResult{}, participation.ErrUnknown
}
func capabilitiesService(t *testing.T, wallet bool) (*participation.Service, *capabilitiesReader, *capabilitiesWallet, string) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("original local journal Unix owner required")
	}
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	n := participation.Network{Genesis: strings.Repeat("a", 64), NetworkID32: strings.Repeat("b", 64), NativeChainID: "6423", CometChainID: "independent-test-comet"}
	r, w := &capabilitiesReader{network: n}, &capabilitiesWallet{network: n}
	var publisher participation.Wallet
	if wallet {
		publisher = w
	}
	p := filepath.Join(dir, "participation.json")
	s, err := participation.New(p, r, publisher)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s, r, w, p
}
func capabilitiesPrepare(t *testing.T, s *participation.Service, index int) participation.Entry {
	t.Helper()
	q := participation.Request{RequestID: fmt.Sprintf("entry-%03d", index), Owner: "0x" + strings.Repeat("4", 40), Action: participation.Delegate, Validator: fmt.Sprintf("fixture-validator-%03d", index), AmountYNXT: "1", FeeCapYNXT: "1", ExpiresAt: time.Now().Add(5 * time.Minute).UTC().Format(time.RFC3339Nano)}
	e, err := s.Prepare(context.Background(), q)
	if err != nil && !errors.Is(err, participation.ErrUnsupported) {
		t.Fatal(err)
	}
	return e
}

func TestNativeCapabilitiesFollowActualAssemblyAndEntry(t *testing.T) {
	if nodeCapabilities(nil, localipc.Peer{}, nil) != (nodeCapabilitySet{}) || participationCapabilities(nil) != (participationCapabilitySet{}) || resourceCapabilities(nil, nil) != (resourceCapabilitySet{}) {
		t.Fatal("absent object gained capability")
	}
	for _, wallet := range []bool{false, true} {
		t.Run(strconv.FormatBool(wallet), func(t *testing.T) {
			s, _, w, _ := capabilitiesService(t, wallet)
			caps := participationCapabilities(s)
			if !caps.Prepare || !caps.Read || !caps.Review || !caps.Cancel || !caps.Reconcile || !caps.Revoke || !caps.List || caps.Submit != wallet {
				t.Fatalf("assembly capabilities %+v", caps)
			}
			e := capabilitiesPrepare(t, s, 1)
			if participationEntryCapabilities(caps, e, "OK").Submit != wallet {
				t.Fatal("wrong prepared capability")
			}
			for _, state := range []string{participation.Unknown, participation.AwaitingWallet, participation.Revoked, participation.Cancelled, participation.ReportedCommitted} {
				copy := e
				copy.State = state
				if participationEntryCapabilities(caps, copy, "OK").Submit {
					t.Fatal("non-prepared original became submit capable", state)
				}
			}
			copy := e
			copy.PublishAttemptedAt = e.CreatedAt
			if participationEntryCapabilities(caps, copy, "OK").Submit {
				t.Fatal("attempted operation rearmed")
			}
			if participationEntryCapabilities(caps, e, "UNKNOWN").Submit {
				t.Fatal("error response rearmed submit")
			}
			if err := s.Revoke(); err != nil {
				t.Fatal(err)
			}
			caps = participationCapabilities(s)
			if caps.Prepare || caps.Submit || caps.Revoke || !caps.Read || !caps.List || !caps.Reconcile {
				t.Fatalf("revoke hid history/reconcile or enabled dispatch %+v", caps)
			}
			if err := s.Close(); err != nil {
				t.Fatal(err)
			}
			if participationCapabilities(s) != (participationCapabilitySet{}) {
				t.Fatal("closed service looked available")
			}
			if w.publishes.Load() != 0 || w.lookups.Load() != 0 {
				t.Fatal("capability read called Wallet")
			}
		})
	}
	for _, stage := range []string{"not_installed", "installed", "stopped", "running", "starting", "reconcile_required"} {
		status := ownednode.Status{Mode: "production", Stage: stage, ProductionSupported: false, ProcessOwned: stage == "running"}
		caps := nodeCapabilitiesFromStatus(status, true)
		if caps.Install || caps.Start || caps.Restart || caps.Stop != (stage == "running") || !caps.Read || !caps.VisibleConsent {
			t.Fatalf("missing release promoted by prompt %+v", caps)
		}
		status.Mode = "isolated-lifecycle-fixture"
		status.ProductionSupported = true
		caps = nodeCapabilitiesFromStatus(status, true)
		if caps.Install || caps.Start || caps.Restart {
			t.Fatal("fixture mode posed as production")
		}
	}
	status := ownednode.Status{Mode: "production", Stage: "running", ProductionSupported: true, ProcessOwned: true}
	if caps := nodeCapabilitiesFromStatus(status, false); caps.Stop || caps.Restart || caps.VisibleConsent {
		t.Fatal("bridge presence replaced actual producer")
	}
	if caps := nodeCapabilitiesFromStatus(status, true); !caps.Stop || !caps.Restart || caps.Start {
		t.Fatal("owned running restart/read mapping wrong")
	}
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	runner, err := contribution.NewDisabled(filepath.Join(root, "resource.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer runner.Close()
	source := resourceauthority.Open(context.Background())
	defer source.Close(context.Background())
	caps := resourceCapabilities(runner, source)
	if !caps.Read || !caps.Meter || !caps.Stop || caps.Review || caps.ProductionDispatch {
		t.Fatalf("default off Source became authority %+v", caps)
	}
	if err := runner.StopContribution(context.Background()); err != nil {
		t.Fatal(err)
	}
	if resourceCapabilities(runner, source).Stop {
		t.Fatal("stopped runner can be started through stop")
	}
	for _, value := range []any{nodeCapabilitySet{}, participationCapabilitySet{}, resourceCapabilitySet{}} {
		raw, _ := json.Marshal(value)
		var fields map[string]any
		json.Unmarshal(raw, &fields)
		for key, v := range fields {
			if _, ok := v.(bool); !ok {
				t.Fatal("nonboolean capability", key)
			}
		}
	}
}

func TestParticipationHistoryOriginalJournalPaginationAndColdUnknown(t *testing.T) {
	s, r, w, p := capabilitiesService(t, true)
	var originals []participation.Entry
	for i := 0; i < 70; i++ {
		originals = append(originals, capabilitiesPrepare(t, s, i))
	}
	unknown, err := s.Submit(context.Background(), originals[69].ID)
	if !errors.Is(err, participation.ErrUnknown) || unknown.State != participation.Unknown {
		t.Fatalf("controlled original outcome %+v %v", unknown, err)
	}
	before, _ := os.ReadFile(p)
	info, _ := os.Stat(p)
	calls, publishes := r.calls.Load(), w.publishes.Load()
	first, err := s.ListHistory("", 50)
	if err != nil || first.NextCursor == "" || len(first.Entries) > 50 {
		t.Fatalf("first bounded page %+v %v", first, err)
	}
	collect := func(service *participation.Service) map[string]participation.HistoryEntry {
		t.Helper()
		out := map[string]participation.HistoryEntry{}
		cursor := ""
		var prior time.Time
		priorID := ""
		for pages := 0; pages < 130; pages++ {
			page, err := service.ListHistory(cursor, 50)
			if err != nil {
				t.Fatal(err)
			}
			raw, _ := json.Marshal(page.Entries)
			if len(raw) > participation.MaxHistoryPageBytes || len(page.Entries) > 50 {
				t.Fatal("wire budget exceeded")
			}
			for _, e := range page.Entries {
				created, _ := time.Parse(time.RFC3339Nano, e.CreatedAt)
				if created.Before(prior) || created.Equal(prior) && e.ID <= priorID {
					t.Fatal("unstable history order")
				}
				prior, priorID = created, e.ID
				if _, exists := out[e.ID]; exists {
					t.Fatal("duplicate history row")
				}
				out[e.ID] = e
				wire, _ := json.Marshal(e)
				var fields map[string]any
				json.Unmarshal(wire, &fields)
				if len(fields) != 6 {
					t.Fatal("history leaked protected fields", string(wire))
				}
			}
			if page.NextCursor == "" {
				return out
			}
			if page.NextCursor == cursor {
				t.Fatal("cursor did not advance")
			}
			cursor = page.NextCursor
		}
		t.Fatal("unbounded pagination")
		return nil
	}
	all := collect(s)
	if len(all) != 70 || all[unknown.ID].State != participation.Unknown {
		t.Fatal("original UNKNOWN omitted")
	}
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.ListHistory("", 20)
			if err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	after, _ := os.ReadFile(p)
	afterInfo, _ := os.Stat(p)
	if !bytes.Equal(before, after) || !os.SameFile(info, afterInfo) || !info.ModTime().Equal(afterInfo.ModTime()) || r.calls.Load() != calls || w.publishes.Load() != publishes || w.lookups.Load() != 0 {
		t.Fatal("history read changed original Store or called authority")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ListHistory("", 20); !errors.Is(err, participation.ErrUnavailable) {
		t.Fatal("closed history returned fake empty success")
	}
	reopened, err := participation.New(p, r, w)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if page, err := reopened.ListHistory(first.NextCursor, 50); err != nil || len(page.Entries) == 0 {
		t.Fatal("normal cold reopen invalidated immutable cursor", err)
	}
	all = collect(reopened)
	if len(all) != 70 || all[unknown.ID].State != participation.Unknown {
		t.Fatal("cold history lost original UNKNOWN")
	}
	for _, e := range originals {
		if all[e.ID].CreatedAt != e.CreatedAt || all[e.ID].Action != e.Intent.Request.Action || all[e.ID].RequestID != e.Intent.Request.RequestID {
			t.Fatal("original ID/action/createdAt changed")
		}
	}
}

func TestParticipationHistoryBoundsConfigurationAndRefresh(t *testing.T) {
	s, r, _, p := capabilitiesService(t, false)
	for i := 0; i < 3; i++ {
		capabilitiesPrepare(t, s, i)
	}
	page, err := s.ListHistory("", 1)
	if err != nil || page.NextCursor == "" {
		t.Fatal(err)
	}
	capabilitiesPrepare(t, s, 4)
	if _, err := s.ListHistory(page.NextCursor, 1); !errors.Is(err, participation.ErrConflict) {
		t.Fatal("insertion silently skipped new history")
	}
	for _, limit := range []int{-1, 51, 1000000} {
		if _, err := s.ListHistory("", limit); !errors.Is(err, participation.ErrInvalid) {
			t.Fatal("unbounded limit accepted")
		}
	}
	for _, cursor := range []string{"../../outside.json", strings.Repeat("A", 513), "e30"} {
		if _, err := s.ListHistory(cursor, 1); !errors.Is(err, participation.ErrInvalid) {
			t.Fatal("forged cursor accepted", err)
		}
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	one, err := participation.NewHTTPReader("http://127.0.0.1:1", "http://127.0.0.1:1", r.network, nil)
	if err != nil {
		t.Fatal(err)
	}
	a, err := participation.New(p, one, nil)
	if err != nil {
		t.Fatal(err)
	}
	page, err = a.ListHistory("", 1)
	if err != nil {
		t.Fatal(err)
	}
	if err = a.Close(); err != nil {
		t.Fatal(err)
	}
	other := r.network
	other.NetworkID32 = strings.Repeat("c", 64)
	two, err := participation.NewHTTPReader("http://127.0.0.1:1", "http://127.0.0.1:1", other, nil)
	if err != nil {
		t.Fatal(err)
	}
	b, err := participation.New(p, two, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if _, err = b.ListHistory(page.NextCursor, 1); !errors.Is(err, participation.ErrConflict) {
		t.Fatal("cursor crossed independently configured network")
	}
	// No request to either closed port is made by ListHistory.
}

func TestNativeParticipationHistoryStrictRequest(t *testing.T) {
	for _, raw := range []string{`{}`, `{"limit":20}`, `{"cursor":"opaque","limit":1}`, `{"limit":50,"cursor":""}`} {
		if _, _, err := decodeParticipationHistory([]byte(raw)); err != nil {
			t.Fatal("valid explicit request", raw, err)
		}
	}
	for _, raw := range []string{`null`, `[]`, `{"path":"/private/journal"}`, `{"limit":0}`, `{"limit":51}`, `{"limit":1.5}`, `{"limit":"20"}`, `{"limit":null}`, `{"cursor":null}`, `{"cursor":"a","cursor":"b"}`, `{"limit":1} {}`} {
		if _, _, err := decodeParticipationHistory([]byte(raw)); err == nil {
			t.Fatal("forged request accepted", raw)
		}
	}
	result, err := nativeParticipation(context.Background(), nil, localipc.Request{Operation: "participation_list", Payload: json.RawMessage(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	var reply struct {
		Code                      string                       `json:"code"`
		Entries                   []participation.HistoryEntry `json:"entries"`
		Capabilities              participationCapabilitySet   `json:"capabilities"`
		Authority, WalletApproval bool
	}
	if err = json.Unmarshal(result.Payload, &reply); err != nil || reply.Code != "NOT_SUPPLIED" || reply.Entries == nil || len(reply.Entries) != 0 || reply.Capabilities != (participationCapabilitySet{}) || reply.Authority || reply.WalletApproval {
		t.Fatalf("missing service became fake empty history %s %v", result.Payload, err)
	}
}

func TestParticipationHistoryLongCorrelationWireBound(t *testing.T) {
	s, _, _, _ := capabilitiesService(t, true)
	var original participation.Entry
	for i := 0; i < 50; i++ {
		q := participation.Request{RequestID: strings.Repeat("q", 124) + fmt.Sprintf("%04d", i), Owner: "0x" + strings.Repeat("4", 40), Action: participation.Delegate, Validator: fmt.Sprintf("long-target-%d", i), AmountYNXT: "1", FeeCapYNXT: "1", ExpiresAt: time.Now().Add(5 * time.Minute).UTC().Format(time.RFC3339Nano)}
		var err error
		original, err = s.Prepare(context.Background(), q)
		if err != nil {
			t.Fatal(err)
		}
	}
	unknown, err := s.Submit(context.Background(), original.ID)
	if !errors.Is(err, participation.ErrUnknown) {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	cursor := ""
	pages := 0
	for {
		result, err := nativeParticipation(context.Background(), s, localipc.Request{Operation: "participation_list", Payload: json.RawMessage(fmt.Sprintf(`{"limit":50,"cursor":%q}`, cursor))})
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Payload) > 12<<10 {
			t.Fatal("correlation DTO exceeded original IPC payload bound")
		}
		var page struct {
			participation.HistoryPage
			Code string `json:"code"`
		}
		if err = json.Unmarshal(result.Payload, &page); err != nil || page.Code != "OK" {
			t.Fatal(err, string(result.Payload))
		}
		if pages == 0 && (len(page.Entries) >= 50 || page.NextCursor == "") {
			t.Fatal("byte budget did not reduce long-correlation page")
		}
		for _, entry := range page.Entries {
			if len(entry.RequestID) != 128 || seen[entry.ID] {
				t.Fatal("correlation was clipped or duplicated")
			}
			seen[entry.ID] = true
			if entry.ID == unknown.ID && entry.State != participation.Unknown {
				t.Fatal("UNKNOWN changed during pagination")
			}
		}
		pages++
		if page.NextCursor == "" {
			break
		}
		if pages > 51 {
			t.Fatal("unbounded long-correlation pagination")
		}
		cursor = page.NextCursor
	}
	if len(seen) != 50 || !seen[unknown.ID] {
		t.Fatal("byte pagination dropped original rows or UNKNOWN")
	}
}

func TestParticipationResolveOriginalCorrelationAliasAndUnknown(t *testing.T) {
	s, r, w, p := capabilitiesService(t, true)
	first := capabilitiesPrepare(t, s, 0)
	query := first.Intent.Request
	query.RequestID = "legitimate-alias"
	alias, err := s.Prepare(context.Background(), query)
	if err != nil || alias.ID != first.ID || alias.Intent.Request.RequestID != first.Intent.Request.RequestID {
		t.Fatal("original semantic alias fixture failed", err)
	}
	second := capabilitiesPrepare(t, s, 1)
	unknown, err := s.Submit(context.Background(), second.ID)
	if !errors.Is(err, participation.ErrUnknown) {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(p)
	calls, publishes, lookups := r.calls.Load(), w.publishes.Load(), w.lookups.Load()
	for _, requestID := range []string{first.Intent.Request.RequestID, query.RequestID, second.Intent.Request.RequestID} {
		entry, found, err := s.ResolveRequest(requestID)
		if err != nil || !found {
			t.Fatal("original index not read", requestID, err)
		}
		if requestID == query.RequestID && (entry.ID != first.ID || entry.Intent.Request.RequestID != first.Intent.Request.RequestID) {
			t.Fatal("alias rewrote first original intent")
		}
		if requestID == second.Intent.Request.RequestID && (entry.ID != unknown.ID || entry.State != participation.Unknown) {
			t.Fatal("UNKNOWN rearmed by resolve")
		}
		if len(entry.Intent.CanonicalPayload) > 0 {
			entry.Intent.CanonicalPayload[0] ^= 1
		}
		payload, _ := json.Marshal(map[string]string{"requestId": requestID})
		result, err := nativeParticipation(context.Background(), s, localipc.Request{Operation: "participation_resolve", Payload: payload})
		if err != nil {
			t.Fatal(err)
		}
		var reply struct {
			Code      string                     `json:"code"`
			Entry     participation.Entry        `json:"entry"`
			Resolved  string                     `json:"resolvedRequestId"`
			Caps      participationCapabilitySet `json:"capabilities"`
			Authority bool                       `json:"authority"`
			Wallet    bool                       `json:"walletApproval"`
		}
		if err = json.Unmarshal(result.Payload, &reply); err != nil || reply.Code != "OK" || reply.Resolved != requestID || reply.Caps.Submit || reply.Authority || reply.Wallet {
			t.Fatal("resolve became approval", string(result.Payload), err)
		}
	}
	if _, found, err := s.ResolveRequest("not-retained"); err != nil || found {
		t.Fatal("miss guessed existing action")
	}
	for _, raw := range []string{`{}`, `{"requestId":null}`, `{"requestId":"x","path":"outside"}`, `{"requestId":"x","requestId":"y"}`, `{"requestId":"../outside"}`, `{"requestId":123}`} {
		if _, err := decodeParticipationResolve([]byte(raw)); err == nil {
			t.Fatal("forged resolve accepted", raw)
		}
	}
	if value, err := decodeParticipationResolve([]byte(`{"requestId":"` + strings.Repeat("x", 128) + `"}`)); err != nil || len(value) != 128 {
		t.Fatal("request correlation mistaken for80-byte packet id")
	}
	after, _ := os.ReadFile(p)
	if !bytes.Equal(before, after) || r.calls.Load() != calls || w.publishes.Load() != publishes || w.lookups.Load() != lookups {
		t.Fatal("resolve called reader/Wallet or modified journal")
	}
	entry, _, _ := s.ResolveRequest(first.Intent.Request.RequestID)
	if !bytes.Equal(entry.Intent.CanonicalPayload, first.Intent.CanonicalPayload) {
		t.Fatal("resolve returned borrowed canonical payload")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.ResolveRequest(query.RequestID); !errors.Is(err, participation.ErrUnavailable) {
		t.Fatal("closed resolver appeared current")
	}
	reopened, err := participation.New(p, r, w)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	entry, found, err := reopened.ResolveRequest(query.RequestID)
	if err != nil || !found || entry.ID != first.ID || entry.Intent.Request.RequestID != first.Intent.Request.RequestID {
		t.Fatal("cold alias index was replaced")
	}
	entry, found, err = reopened.ResolveRequest(second.Intent.Request.RequestID)
	if err != nil || !found || entry.State != participation.Unknown || entry.ID != unknown.ID {
		t.Fatal("cold UNKNOWN original lost")
	}
}
