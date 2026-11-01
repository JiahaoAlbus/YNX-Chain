package main_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/participation"
)

// Actual helper binary + original kernel peer and original HTTP read fixture.
// The seeded UNKNOWN is an isolated dropped fixture Wallet response, never a
// real account, approval, signature, public chain action or funds operation.
func TestNativeCapabilitiesParticipationHistoryNormalProcess(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("original Unix IPC required")
	}
	base := os.TempDir()
	if st, err := os.Stat("/Volumes/西部数据"); err == nil && st.IsDir() {
		base = "/Volumes/西部数据"
	}
	root, err := os.MkdirTemp(base, "p09-history-")
	if err != nil {
		t.Fatal(err)
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	data := filepath.Join(root, "data")
	f := newParticipationFixture(t, true)
	if err = f.service.Close(); err != nil {
		t.Fatal(err)
	}
	f.path = filepath.Join(data, "participation.json")
	f.service, err = participation.New(f.path, f.reader, f.wallet)
	if err != nil {
		t.Fatal(err)
	}
	var entries []participation.Entry
	for i := 0; i < 7; i++ {
		f.mu.Lock()
		f.nonce = uint64(i + 1)
		f.mu.Unlock()
		e, err := f.service.Prepare(context.Background(), f.request(fmt.Sprintf("normal-history-%d", i)))
		if err != nil {
			t.Fatal(err)
		}
		entries = append(entries, e)
	}
	f.mu.Lock()
	f.nonce = 1
	f.mu.Unlock()
	aliasRequest := entries[0].Intent.Request
	aliasRequest.RequestID = "normal-existing-alias"
	alias, err := f.service.Prepare(context.Background(), aliasRequest)
	if err != nil || alias.ID != entries[0].ID {
		t.Fatal("controlled original alias index unavailable", err)
	}
	f.mu.Lock()
	f.nonce = 7
	f.drop = true
	f.mu.Unlock()
	unknown, err := f.service.Submit(context.Background(), entries[6].ID)
	if !errors.Is(err, participation.ErrUnknown) || unknown.State != participation.Unknown {
		t.Fatalf("original controlled UNKNOWN unavailable %+v %v", unknown, err)
	}
	if err = f.service.Close(); err != nil {
		t.Fatal(err)
	}
	beforeEffects := func() [3]int { a, b, c := f.counts(); return [3]int{a, b, c} }()
	binary := filepath.Join(root, "ynx-network-helper")
	compile := exec.Command(filepath.Join(runtime.GOROOT(), "bin/go"), "build", "-mod=readonly", "-p", "1", "-o", binary, "./cmd/ynx-network-helper")
	compile.Dir, err = filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	if output, err := compile.CombinedOutput(); err != nil {
		t.Fatalf("normal helper compile: %v %s", err, output)
	}
	raw, _ := json.Marshal(map[string]any{"version": "YNX-NETWORK-PARTICIPATION-CONFIG/v1", "network": f.network})
	pin := sha256.Sum256(raw)
	config := filepath.Join(root, "network.json")
	if err = os.WriteFile(config, raw, 0600); err != nil {
		t.Fatal(err)
	}
	start := func() qaClientProcess {
		return qaClientStart(t, binary, data, f.server.URL, "--governance-rpc", f.server.URL, "--participation-config", config, "--participation-config-sha256", hex.EncodeToString(pin[:]))
	}
	call := func(op string, payload any) map[string]json.RawMessage {
		t.Helper()
		body, _ := json.Marshal(payload)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		reply, err := localipc.Call(ctx, filepath.Join(data, "ipc"), localipc.Request{Version: localipc.Version, ID: "history_" + op, Operation: op, Payload: body})
		if err != nil || !reply.Peer.NativeIPCVerified || reply.Peer.BrowserIdentityVerified || reply.Result == nil {
			t.Fatalf("actual kernel %s: %+v %v", op, reply, err)
		}
		var out map[string]json.RawMessage
		if err = json.Unmarshal(reply.Result.Payload, &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	readPages := func() (map[string]participation.HistoryEntry, string) {
		t.Helper()
		all := map[string]participation.HistoryEntry{}
		cursor := ""
		firstCursor := ""
		for page := 0; page < 10; page++ {
			out := call("participation_list", map[string]any{"limit": 2, "cursor": cursor})
			var code string
			json.Unmarshal(out["code"], &code)
			if code != "OK" || string(out["authority"]) != "false" || string(out["walletApproval"]) != "false" {
				t.Fatalf("history authority/code %+v", out)
			}
			var caps map[string]bool
			json.Unmarshal(out["capabilities"], &caps)
			if len(caps) != 8 || !caps["read"] || !caps["list"] || !caps["prepare"] || caps["submit"] {
				t.Fatalf("normal missing Wallet capabilities %+v", caps)
			}
			var rows []participation.HistoryEntry
			json.Unmarshal(out["entries"], &rows)
			if len(rows) > 2 {
				t.Fatal("limit not applied")
			}
			for _, row := range rows {
				if _, duplicate := all[row.ID]; duplicate {
					t.Fatal("original ID repeated")
				}
				all[row.ID] = row
				wire, _ := json.Marshal(row)
				var keys map[string]any
				json.Unmarshal(wire, &keys)
				if len(keys) != 6 {
					t.Fatal("protected history data leaked")
				}
			}
			cursor = ""
			json.Unmarshal(out["nextCursor"], &cursor)
			if page == 0 {
				firstCursor = cursor
			}
			if cursor == "" {
				return all, firstCursor
			}
		}
		t.Fatal("history did not terminate")
		return nil, ""
	}
	p := start()
	all, cursor := readPages()
	if len(all) != 7 || all[unknown.ID].State != participation.Unknown || cursor == "" {
		t.Fatal("normal helper omitted original UNKNOWN")
	}
	// Send a genuine kernel-authenticated prepare and deliberately never read
	// its response. Recover only through the original retained correlation ID.
	lost := f.request("normal-prepare-lost-ack")
	lost.Action = participation.Vote
	lost.Validator = ""
	lost.AmountYNXT = ""
	lost.Proposal = "fixture-proposal"
	lost.Choice = "yes"
	requestBody, _ := json.Marshal(lost)
	request, _ := json.Marshal(localipc.Request{Version: localipc.Version, ID: "unread_original_ack", Operation: "participation_prepare", Payload: requestBody})
	connection, err := net.Dial("unix", filepath.Join(data, "ipc", localipc.SocketName))
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	if _, err = fmt.Fprintf(connection, "POST /v1/call HTTP/1.1\r\nHost: localipc\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s", len(request), request); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	recovered := ""
	for {
		probe := call("participation_list", map[string]any{})
		var rows []participation.HistoryEntry
		json.Unmarshal(probe["entries"], &rows)
		for _, row := range rows {
			if row.RequestID == lost.RequestID {
				recovered = row.ID
			}
		}
		if recovered != "" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("unread original prepare ack was not recoverable from actual journal")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err = connection.Close(); err != nil {
		t.Fatal(err)
	}
	resolved := call("participation_resolve", map[string]string{"requestId": lost.RequestID})
	var resolvedCode, resolvedRequest string
	var resolvedEntry participation.Entry
	json.Unmarshal(resolved["code"], &resolvedCode)
	json.Unmarshal(resolved["resolvedRequestId"], &resolvedRequest)
	json.Unmarshal(resolved["entry"], &resolvedEntry)
	if resolvedCode != "OK" || resolvedRequest != lost.RequestID || resolvedEntry.ID != recovered {
		t.Fatal("lost ack did not resolve exact original correlation")
	}
	lookupAlias := func() {
		t.Helper()
		out := call("participation_resolve", map[string]string{"requestId": aliasRequest.RequestID})
		var code, requestID string
		var entry participation.Entry
		json.Unmarshal(out["code"], &code)
		json.Unmarshal(out["resolvedRequestId"], &requestID)
		json.Unmarshal(out["entry"], &entry)
		if code != "OK" || requestID != aliasRequest.RequestID || entry.ID != entries[0].ID || entry.Intent.Request.RequestID != entries[0].Intent.Request.RequestID {
			t.Fatal("normal alias resolve changed original intent")
		}
	}
	lookupAlias()
	unknownResolved := call("participation_resolve", map[string]string{"requestId": entries[6].Intent.Request.RequestID})
	var originalUnknown participation.Entry
	json.Unmarshal(unknownResolved["entry"], &originalUnknown)
	if originalUnknown.ID != unknown.ID || originalUnknown.State != participation.Unknown {
		t.Fatal("resolve rearmed UNKNOWN")
	}
	got := call("participation_get", map[string]string{"id": originalUnknown.ID})
	var gotUnknown participation.Entry
	json.Unmarshal(got["entry"], &gotUnknown)
	if gotUnknown.ID != unknown.ID || gotUnknown.State != participation.Unknown {
		t.Fatal("resolve/get lost original UNKNOWN")
	}
	_ = call("participation_reconcile", map[string]string{"id": unknown.ID})
	missing := call("participation_resolve", map[string]string{"requestId": "never-retained"})
	var missingCode string
	json.Unmarshal(missing["code"], &missingCode)
	if missingCode != "NOT_FOUND" || string(missing["entry"]) != "null" {
		t.Fatal("unknown request falsely resolved")
	}
	all, cursor = readPages()
	if len(all) != 8 || all[recovered].RequestID != lost.RequestID {
		t.Fatal("lost prepare correlation was guessed or recreated")
	}
	beforeRead, _ := os.ReadFile(f.path)
	_ = call("participation_list", map[string]any{})
	afterRead, _ := os.ReadFile(f.path)
	if !bytes.Equal(beforeRead, afterRead) {
		t.Fatal("normal history read rewrote original journal")
	}
	node := call("node_status", map[string]any{})
	var nodeCaps map[string]bool
	json.Unmarshal(node["capabilities"], &nodeCaps)
	if len(nodeCaps) != 7 || !nodeCaps["read"] || nodeCaps["install"] || nodeCaps["start"] || nodeCaps["stop"] || nodeCaps["restart"] {
		t.Fatalf("browser/prompt absence granted node control %+v", nodeCaps)
	}
	ticket := qaClientPair(t, p)
	for _, route := range []string{"/api/participation_list", "/api/participation_resolve"} {
		if status, _ := qaClientAPI(t, p, route, ticket, map[string]any{}); status != 404 {
			t.Fatal("paired browser gained native history route", route)
		}
	}
	for _, payload := range []any{map[string]any{"path": f.path}, map[string]any{"limit": 51}, map[string]any{"cursor": "../../outside.json"}} {
		body, _ := json.Marshal(payload)
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		res, err := localipc.Call(ctx, filepath.Join(data, "ipc"), localipc.Request{Version: localipc.Version, ID: "forged_history", Operation: "participation_list", Payload: body})
		cancel()
		if err == nil && res.Result != nil {
			var code string
			var parsed map[string]json.RawMessage
			json.Unmarshal(res.Result.Payload, &parsed)
			json.Unmarshal(parsed["code"], &code)
			if code == "OK" {
				t.Fatal("forged history request read arbitrary path")
			}
		}
	}
	p.stop()
	second := start()
	defer second.stop()
	lookupAlias()
	coldResolved := call("participation_resolve", map[string]string{"requestId": lost.RequestID})
	var coldEntry participation.Entry
	json.Unmarshal(coldResolved["entry"], &coldEntry)
	if coldEntry.ID != recovered || coldEntry.Intent.Request.RequestID != lost.RequestID {
		t.Fatal("cold original lost-ack correlation replaced")
	}
	resumed := call("participation_list", map[string]any{"cursor": cursor, "limit": 2})
	var resumedCode string
	json.Unmarshal(resumed["code"], &resumedCode)
	if resumedCode != "OK" {
		t.Fatal("cold original cursor changed without immutable rows changing")
	}
	restored, _ := readPages()
	if len(restored) != len(all) || restored[unknown.ID] != all[unknown.ID] {
		t.Fatal("cold reopen changed original UNKNOWN metadata")
	}
	for _, entry := range entries {
		if restored[entry.ID].ID != entry.ID || restored[entry.ID].Action != entry.Intent.Request.Action || restored[entry.ID].CreatedAt != entry.CreatedAt || restored[entry.ID].RequestID != entry.Intent.Request.RequestID {
			t.Fatal("normal original history binding changed")
		}
	}
	a, b, c := f.counts()
	if [3]int{a, b, c} != beforeEffects {
		t.Fatalf("history/capabilities re-signed/published/looked up original operation: before%v after%v", beforeEffects, [3]int{a, b, c})
	}
	t.Log("actual controlled helper/kernel list/capabilities/cold reopen; historical local projection only; no real Wallet or public effects")
}
