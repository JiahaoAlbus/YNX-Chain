package httpdrain

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

// The helper is a real subprocess: SIGTERM exercises the OS signal handler,
// real TCP listener, active HTTP response, cancellation, and process exit.
func TestDrainChild(t *testing.T) {
	mode := os.Getenv("YNX_DRAIN_TEST_CHILD")
	if mode == "" {
		return
	}
	log.SetOutput(os.Stdout)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		os.Exit(3)
	}
	fmt.Println("http://" + listener.Addr().String())
	done := make(chan struct{})
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hold" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		defer close(done)
		_, _ = io.WriteString(w, "started\n")
		w.(http.Flusher).Flush()
		delay := 300 * time.Millisecond
		if mode == "timeout" {
			delay = 10 * time.Second
		}
		select {
		case <-time.After(delay):
			if err := os.WriteFile(os.Getenv("YNX_DRAIN_TEST_MARKER"), []byte("persisted"), 0600); err != nil {
				_, _ = io.WriteString(w, "persistence-error\n")
				return
			}
			_, _ = io.WriteString(w, "finished\n")
		case <-r.Context().Done():
			_ = os.WriteFile(os.Getenv("YNX_DRAIN_TEST_MARKER"), []byte("cancelled"), 0600)
		}
	})}
	timeout := 2 * time.Second
	if mode == "timeout" {
		timeout = 80 * time.Millisecond
	}
	err = Serve(server, listener, timeout)
	if err != nil {
		// Only the test process waits to record observed request cancellation.
		select {
		case <-done:
		case <-time.After(time.Second):
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	os.Exit(0)
}

func TestSIGTERMDrainsActualHTTPAndRejectsNewConnections(t *testing.T) {
	for _, mode := range []string{"complete", "timeout"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			marker := filepath.Join(t.TempDir(), "result")
			command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDrainChild$")
			command.Env = append(os.Environ(), "YNX_DRAIN_TEST_CHILD="+mode, "YNX_DRAIN_TEST_MARKER="+marker)
			stdout, err := command.StdoutPipe()
			if err != nil {
				t.Fatal(err)
			}
			if err := command.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = command.Process.Kill() })
			reader := bufio.NewReader(stdout)
			url, err := reader.ReadString('\n')
			if err != nil {
				t.Fatal(err)
			}
			url = strings.TrimSpace(url)
			client := &http.Client{Timeout: 4 * time.Second}
			response, err := client.Get(url + "/hold")
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body := bufio.NewReader(response.Body)
			if line, err := body.ReadString('\n'); err != nil || line != "started\n" {
				t.Fatalf("request not in flight: %q %v", line, err)
			}
			if err := command.Process.Signal(syscall.SIGTERM); err != nil {
				t.Fatal(err)
			}
			if line, err := reader.ReadString('\n'); err != nil || !strings.Contains(line, "drain started") {
				t.Fatalf("no drain event: %q %v", line, err)
			}
			probe := &http.Client{Timeout: 300 * time.Millisecond, Transport: &http.Transport{DisableKeepAlives: true}}
			deadline := time.Now().Add(time.Second)
			for {
				res, err := probe.Get(url + "/probe")
				if err != nil {
					break
				}
				_ = res.Body.Close()
				if res.StatusCode == http.StatusServiceUnavailable {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("new requests still admitted")
				}
				time.Sleep(5 * time.Millisecond)
			}
			rest, readErr := io.ReadAll(body)
			waitErr := command.Wait()
			result, err := os.ReadFile(marker)
			if err != nil {
				t.Fatal(err)
			}
			if mode == "complete" {
				if waitErr != nil || readErr != nil || string(rest) != "finished\n" || string(result) != "persisted" {
					t.Fatalf("drain lost request: exit=%v read=%v body=%q marker=%q", waitErr, readErr, rest, result)
				}
			} else {
				if waitErr == nil || string(result) != "cancelled" || strings.Contains(string(rest), "finished") {
					t.Fatalf("deadline did not cancel and fail: exit=%v marker=%q", waitErr, result)
				}
			}
		})
	}
}
