//go:build unix

package main

import (
	"bytes"
	"io"
	"net"
	"path/filepath"
	"testing"
	"time"
)

func TestRemoteSignerCheckpointFlagsKeepOriginalModeAndBoundStartup(t *testing.T) {
	legacy, err := parseOptions(remoteOperatorArgs(), io.Discard)
	if err != nil || legacy.checkpointAccessConfigured() {
		t.Fatal("default file mode changed", err)
	}
	for _, args := range [][]string{{"--checkpoint-access-socket", ""}, {"--checkpoint-access-timeout", "0s"}, {"--checkpoint-startup-timeout", "0s"}} {
		if _, err := parseOptions(append(remoteOperatorArgs(), args...), io.Discard); err == nil {
			t.Fatal("explicit empty/zero capability fell through to file mode")
		}
	}
	group := []string{"--checkpoint-access-socket", "@ynx-pq-checkpoint-original-one", "--checkpoint-engine-uid", "1001", "--checkpoint-signer-uid", "1002", "--checkpoint-access-timeout", "12s", "--checkpoint-startup-timeout", "120s"}
	args := append(remoteOperatorArgs(), group...)
	o, err := parseOptions(args, io.Discard)
	if err != nil || !o.checkpointAccessConfigured() || o.checkpointStartup != 120*time.Second || o.checkpointAccessConfig().Timeout != 12*time.Second || o.transport.Timeout != 5*time.Second {
		t.Fatal("explicit source/startup changed connected request deadline", err)
	}
	for index := 0; index < len(group); index += 2 {
		if index == 6 {
			continue
		} // capture timeout retains its documented 5s default
		partial := append([]string{}, group[:index]...)
		partial = append(partial, group[index+2:]...)
		if _, err := parseOptions(append(remoteOperatorArgs(), partial...), io.Discard); err == nil {
			t.Fatal("partial split UID flags accepted", group[index])
		}
	}
	for _, extra := range [][]string{{"--checkpoint-engine-uid", "01001"}, {"--checkpoint-signer-uid", "1001"}, {"--checkpoint-engine-uid", "0"}, {"--checkpoint-access-timeout", "61s"}, {"--checkpoint-startup-timeout", "601s"}, {"--checkpoint-startup-timeout", "0s"}} {
		if _, err := parseOptions(append(append([]string{}, args...), extra...), io.Discard); err == nil {
			t.Fatal("unsafe capability/startup accepted", extra[0])
		}
	}
}

func TestRemoteSignerCheckpointReadinessRequiresActualSystemdNotification(t *testing.T) {
	t.Setenv("NOTIFY_SOCKET", "")
	if checkpointSystemdReady() == nil {
		t.Fatal("missing notify endpoint pretended Ready")
	}
	t.Setenv("NOTIFY_SOCKET", "relative-notify")
	if checkpointSystemdReady() == nil {
		t.Fatal("relative notify endpoint accepted")
	}
	path := filepath.Join(t.TempDir(), "notify")
	listener, err := net.ListenUnixgram("unixgram", &net.UnixAddr{Name: path, Net: "unixgram"})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	t.Setenv("NOTIFY_SOCKET", path)
	if err = checkpointSystemdReady(); err != nil {
		t.Fatal(err)
	}
	if err = listener.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 256)
	n, _, err := listener.ReadFromUnix(buf)
	want := []byte("READY=1\nSTATUS=Original custody loaded; waiting for one pinned engine session")
	if err != nil || !bytes.Equal(buf[:n], want) {
		t.Fatal("actual readiness datagram changed", err)
	}
}
