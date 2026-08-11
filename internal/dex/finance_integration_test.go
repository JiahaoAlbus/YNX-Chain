package dex

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/readintegration"
)

func TestFinanceReadReturnsOnlyAuthorizedDEXEvidenceAndRejectsReplay(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	if err != nil {
		t.Fatal(err)
	}
	accountHex := "0x1111111111111111111111111111111111111111"
	accountYNX, err := accountaddress.Encode(accountHex)
	if err != nil {
		t.Fatal(err)
	}
	otherHex := "0x2222222222222222222222222222222222222222"
	for index, setup := range []struct {
		kind, account string
	}{
		{"liquidity-add", accountHex}, {"swap", accountHex}, {"swap", otherHex},
	} {
		event := fixture(uint64(index+1), setup.kind)
		event.Account = setup.account
		if _, err := store.Append(event); err != nil {
			t.Fatal(err)
		}
	}
	server, err := NewServerWithSource(store, buildinfo.Info{Commit: strings.Repeat("a", 40), Release: "ynx-dex-test"}, strings.Repeat("i", 32), nil, NativeSource)
	if err != nil {
		t.Fatal(err)
	}
	secret := strings.Repeat("f", 32)
	if err := server.ConfigureFinanceRead(secret); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, FinanceReadRoute, nil)
	if err := readintegration.Sign(request, secret, "finance", "dex", accountYNX, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var envelope struct {
		SourceID          string            `json:"sourceId"`
		AuthorizedAccount string            `json:"authorizedAccount"`
		Payload           financeDEXPayload `json:"payload"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.SourceID != "dex" || envelope.AuthorizedAccount != accountHex || len(envelope.Payload.Positions) != 1 || len(envelope.Payload.Swaps) != 1 || len(envelope.Payload.Liquidity) != 1 || len(envelope.Payload.Pools) != 1 {
		t.Fatalf("unexpected authorized DEX evidence: %+v", envelope)
	}
	if strings.Contains(response.Body.String(), otherHex) || strings.Contains(response.Body.String(), "private") {
		t.Fatal("Finance DEX evidence leaked another account or secret material")
	}
	replay := httptest.NewRecorder()
	server.Handler().ServeHTTP(replay, request)
	if replay.Code != http.StatusUnauthorized {
		t.Fatalf("replayed credential status=%d body=%s", replay.Code, replay.Body.String())
	}
}

func TestFinanceReadFailsClosedWhenUnconfigured(t *testing.T) {
	store, _ := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	server, _ := NewServer(store, buildinfo.Info{}, strings.Repeat("i", 32), nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, FinanceReadRoute, nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured Finance read status=%d", response.Code)
	}
	if err := server.ConfigureFinanceRead("short"); err == nil {
		t.Fatal("short Finance read key was accepted")
	}
}
