package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// The upstream is an unmodified pinned official DAV server provisioned by
// webdav-interop-provision.py. The local proxy below only injects a lost ACK
// AFTER that upstream has handled the real request; it is not a DAV server.
func TestP08WebDAVOfficialDurableFlow(t *testing.T) {
	connection := os.Getenv("P08_WEBDAV_CONNECTION_FILE")
	if connection == "" {
		t.Skip("explicit isolated official upstream connection not supplied")
	}
	stat, err := os.Stat(connection)
	if err != nil || stat.Mode().Perm() != 0600 {
		t.Fatal("private PUBLIC connection file required")
	}
	var c struct{ URL, Username, Password string }
	raw, err := os.ReadFile(connection)
	if err != nil || json.Unmarshal(raw, &c) != nil {
		t.Fatal("invalid PUBLIC upstream connection")
	}
	upstream, err := url.Parse(c.URL)
	if err != nil || upstream.Scheme != "http" || upstream.Hostname() != "127.0.0.1" {
		t.Fatal("official upstream must be isolated numeric loopback")
	}
	f := newP08WebDAVRuntime(t)
	var puts, gets atomic.Int32
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "PUT" {
			puts.Add(1)
		} else if r.Method == "GET" {
			gets.Add(1)
		} else {
			t.Error("unexpected upstream operation")
			w.WriteHeader(405)
			return
		}
		target := *upstream
		target.Path = strings.TrimSuffix(upstream.Path, "/") + r.URL.Path
		request, e := http.NewRequestWithContext(r.Context(), r.Method, target.String(), r.Body)
		if e != nil {
			t.Error("proxy request failed")
			return
		}
		request.Header = r.Header.Clone()
		request.ContentLength = r.ContentLength
		response, e := client.Do(request)
		if e != nil {
			t.Error("official upstream request failed")
			w.WriteHeader(502)
			return
		}
		defer response.Body.Close()
		body, e := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		if e != nil {
			t.Error("official response failed")
			return
		}
		if r.Method == "PUT" {
			if response.StatusCode != 201 && response.StatusCode != 204 {
				t.Error("official PUT not acknowledged")
			}
			conn, _, e := w.(http.Hijacker).Hijack()
			if e == nil {
				conn.Close()
			}
			return
		}
		for k, vs := range response.Header {
			for _, v := range vs {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(response.StatusCode)
		_, _ = w.Write(body)
	}))
	defer proxy.Close()
	cfg := TaskWebDAVConfig{ProfileID: "PUBLIC-official", Origin: proxy.URL, User: c.Username, Password: c.Password, Root: "/", Object: randomID("p08-original") + ".txt", PublicLoopback: true}
	f.s.webDAV, err = PrepareOriginalTaskWebDAVRuntime(f.source, []TaskWebDAVConfig{cfg})
	if err != nil {
		t.Fatal(err)
	}
	f.input.DestinationID = cfg.ProfileID
	original, err := f.deliver()
	if err == nil || original.State != "UNKNOWN" || puts.Load() != 1 || gets.Load() != 0 {
		t.Fatal("actual lost ACK did not retain UNKNOWN")
	}
	reopened, err := NewStore(f.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	f.s.store = reopened
	recovered, err := f.s.executeTaskWebDAV(context.Background(), f.session, f.task.ID, TaskWebDAVInput{OperationID: f.input.OperationID}, "PUBLIC-explicit-egress", true)
	if err != nil || recovered.State != "CONTENT_PRESENT" || recovered.AuthorshipProven || recovered.ETag == "" || puts.Load() != 1 || gets.Load() != 1 {
		t.Fatalf("official original recovery failed, state=%s put=%d get=%d err=%v", recovered.State, puts.Load(), gets.Load(), err)
	}
	// Verify against the independently served real upstream directly too.
	u := *upstream
	u.Path = strings.TrimSuffix(u.Path, "/") + "/" + cfg.Object
	request, _ := http.NewRequest("GET", u.String(), nil)
	request.SetBasicAuth(c.Username, c.Password)
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	actual, err := io.ReadAll(response.Body)
	if err != nil || !bytes.Equal(actual, f.content) || response.Header.Get("ETag") != recovered.ETag {
		t.Fatal("independent official GET bytes/ETag differ")
	}
	stored, err := reopened.TaskWebDAVResult(f.session, f.task.ID, f.input.OperationID)
	if err != nil || stored != recovered {
		t.Fatal("official result did not survive original Store reopen")
	}
	t.Logf("actual official upstream PUT=1; lost ACK UNKNOWN; reopened original GET=1; exact bytes=%d; original=%s; remote=%s; digest=%s; authorship=false; scope=%s", len(actual), recovered.OperationID, recovered.RemoteID, recovered.SHA256, recovered.Scope)
}
