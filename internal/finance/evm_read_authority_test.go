package finance

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestEVMReadAuthorityRequiresExactDurableCallback(t *testing.T) {
	script := filepath.Join(t.TempDir(), "authority.sh")
	content := `#!/bin/sh
IFS= read -r initial || exit 2
printf '%s\n' '{"kind":"commit","operation":"read","proposal":{"nonce":"finance_read_nonce_0123456789abcdef"}}'
IFS= read -r answer || exit 3
if [ "$answer" = '{"approved":true}' ]; then
  printf '%s\n' '{"kind":"result","authorized":true}'
else
  printf '%s\n' '{"kind":"error","code":"REPLAY"}'
  exit 1
fi
`
	if err := os.WriteFile(script, []byte(content), 0700); err != nil {
		t.Fatal(err)
	}
	authority, err := NewNodeEVMReadAuthority("/bin/sh", script, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	commits := 0
	result, err := authority.Invoke(context.Background(), map[string]string{"action": "read"}, "read", func(proposal json.RawMessage) bool {
		commits++
		return strings.Contains(string(proposal), "finance_read_nonce_")
	})
	if err != nil || commits != 1 || !strings.Contains(string(result), `"authorized":true`) {
		t.Fatalf("exact durable callback not observed: result=%s commits=%d err=%v", result, commits, err)
	}
	if _, err := authority.Invoke(context.Background(), map[string]string{"action": "read"}, "issue", func(json.RawMessage) bool { return true }); err == nil {
		t.Fatal("cross-operation commit accepted")
	}
	if _, err := authority.Invoke(context.Background(), map[string]string{"action": "read"}, "read", func(json.RawMessage) bool { return false }); err == nil {
		t.Fatal("rejected durable commit authorized the request")
	}
	if _, err := authority.Invoke(context.Background(), map[string]string{"action": "read"}, "read", nil); err == nil {
		t.Fatal("missing durable callback authorized the request")
	}
}

func TestEVMReadAuthorityRejectsSilentSuccess(t *testing.T) {
	script := filepath.Join(t.TempDir(), "silent.sh")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nIFS= read -r initial\nexit 0\n"), 0700); err != nil {
		t.Fatal(err)
	}
	authority, err := NewNodeEVMReadAuthority("/bin/sh", script, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authority.Invoke(context.Background(), map[string]string{"action": "read"}, "read", func(json.RawMessage) bool { return true }); err == nil {
		t.Fatal("silent zero was accepted as a verified request")
	}
}
