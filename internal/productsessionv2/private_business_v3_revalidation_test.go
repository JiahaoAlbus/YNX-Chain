package productsessionv2

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testPrivateBusinessV3RevalidationRealNodeAfterAwait(t *testing.T, productID, platform string) {
	source := os.Getenv("YNX_QA_CENTRAL_SOURCE")
	if source == "" {
		t.Skip("actual Node interoperability requires explicit reviewed YNX_QA_CENTRAL_SOURCE; source admission runs with it set")
	}
	public, key, _ := ed25519.GenerateKey(rand.Reader)
	der, _ := x509.MarshalPKIXPublicKey(public)
	publicPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	directory := t.TempDir()
	if err := os.Chmod(directory, 0700); err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(ctx, "node", "testdata/private-business-v3-revalidation-node.mjs")
	cmd.Env = append(os.Environ(), "YNX_QA_PRODUCT_ID="+productID, "YNX_QA_PLATFORM="+platform, "YNX_QA_PUBLIC_KEY="+string(publicPEM), "YNX_QA_STATE_PATH="+filepath.Join(directory, "authority"))
	var diagnostic bytes.Buffer
	cmd.Stderr = &diagnostic
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	var ready struct {
		URL     string  `json:"url"`
		Session Session `json:"session"`
		Initial string  `json:"initial"`
		Revoke  string  `json:"revoke"`
	}
	scanner := bufio.NewScanner(pipe)
	if !scanner.Scan() {
		_ = cmd.Wait()
		t.Fatal("Node QA authority did not initialize", diagnostic.String())
	}
	if json.Unmarshal(scanner.Bytes(), &ready) != nil {
		t.Fatal("invalid QA startup shape")
	}
	transport := roundTrip(func(r *http.Request) (*http.Response, error) {
		copy := r.Clone(r.Context())
		u := *r.URL
		copy.URL = &u
		local, _ := http.NewRequest("POST", ready.URL, nil)
		copy.URL.Scheme = local.URL.Scheme
		copy.URL.Host = local.URL.Host
		return http.DefaultTransport.RoundTrip(copy)
	})
	p := Policy{ProductID: ready.Session.ProductID, ClientID: ready.Session.ClientID, ApplicationID: ready.Session.ApplicationID, Platform: ready.Session.Platform, Origin: ready.Session.Origin, Callback: ready.Session.Callback, AllowedScopes: ready.Session.Scopes, BundleID: ready.Session.BundleID, PackageID: ready.Session.PackageID}
	client, err := NewClient("https://wallet-auth.ynxweb4.com", p, transport)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := NewPrivateBusinessRevalidator(client, p.ClientID+"-business-"+p.Platform+"-v1", "qa", key)
	if err != nil {
		t.Fatal(err)
	}
	incoming, _ := http.NewRequest("POST", p.Origin+"/business-operation", nil)
	incoming.Header.Set(ProofHeader, ready.Initial)
	incoming.Header.Set("Origin", p.Origin)
	original, err := client.Authorize(ctx, incoming, ready.Session.Scopes)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = client.Authorize(ctx, incoming, ready.Session.Scopes); err == nil {
		t.Fatal("consumed device proof replay accepted")
	}
	for i := 0; i < 2; i++ {
		current, e := reader.Revalidate(ctx, original, ready.Session.Scopes)
		if e != nil || current.SessionBinding != original.SessionBinding || current.ExpiresAt != original.ExpiresAt {
			t.Fatal("fresh backend read changed or refused original authorization", e)
		}
	}
	altered := original
	altered.State = strings.Repeat("A", 43)
	if _, err = reader.Revalidate(ctx, altered, ready.Session.Scopes); err == nil {
		t.Fatal("altered original session accepted")
	}
	revoke, _ := http.NewRequestWithContext(ctx, "POST", ready.URL+"/v2/product-sessions/revoke", strings.NewReader("{}"))
	revoke.Header.Set("Content-Type", "application/json")
	revoke.Header.Set("X-Request-Id", "req_revalidation_qa_revoke")
	if platform == "web" {
		revoke.Header.Set("Origin", p.Origin)
	}
	revoke.Header.Set(ProofHeader, ready.Revoke)
	response, err := http.DefaultClient.Do(revoke)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("original HTTP revoke failed")
	}
	_, err = reader.Revalidate(ctx, original, ready.Session.Scopes)
	var failure *Error
	if !errors.As(err, &failure) || failure.Code != "SESSION_REVOKED" || failure.Status != 401 {
		t.Fatal("revoked original session remained active or became transient error", err)
	}
}

func TestPrivateBusinessV3RevalidationActualNodeHTTP(t *testing.T) {
	for _, tuple := range [][2]string{{"music", "android"}, {"music", "ios"}, {"card", "web"}, {"pay-merchant", "web"}, {"shop", "web"}} {
		t.Run(tuple[0]+"/"+tuple[1], func(t *testing.T) { testPrivateBusinessV3RevalidationRealNodeAfterAwait(t, tuple[0], tuple[1]) })
	}
}
