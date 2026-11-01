package main

import (
	"bytes"
	"io"
	"io/fs"
	"net/http"
	"testing"

	networkweb "github.com/JiahaoAlbus/YNX-Chain/apps/network/web"
)

func TestNetworkNativeBridgeEmbeddedNormalEndpoint(t *testing.T) {
	expected, err := fs.ReadFile(networkweb.Assets(), "native-bridge.js")
	if err != nil {
		t.Fatal("normal embedded bridge missing", err)
	}
	_, server := fixture(t, "https://rpc.example")
	response, err := http.Get(server.URL + "/native-bridge.js")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	actual, err := io.ReadAll(io.LimitReader(response.Body, 128<<10))
	if err != nil || response.StatusCode != 200 || !bytes.Equal(actual, expected) {
		t.Fatalf("normal script endpoint mismatch status%d err%v", response.StatusCode, err)
	}
	if response.Header.Get("Cache-Control") != "no-store" || response.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("bridge changed normal origin/cache guards")
	}
}
