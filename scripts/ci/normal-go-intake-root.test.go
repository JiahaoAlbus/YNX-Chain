package normalgraph

import (
 "encoding/json"
 "errors"
 "os"
 "os/exec"
 "path/filepath"
 "testing"
 "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
 core "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
 runtime "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
 open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
 policy "ynx.local/authgrantpolicy"
)

var _ policy.OriginalTaskGrantVerifier = (*runtime.Runtime)(nil)
var _ = core.NewVerifier
var _ = open.EncodeShopOrderReadRequestDATA
var _ = open.DecodeShopOrderReadResponseDATA

func TestNormalPhysicalRootAndOriginalAdmission(t *testing.T) {
 wd,e:=os.Getwd();if e!=nil {t.Fatal(e)};root:=filepath.Clean(filepath.Join(wd,"../.."))
 cmd:=exec.Command("go","list","-mod=readonly","-json","github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch")
 raw,e:=cmd.Output();if e!=nil {t.Fatal(e)}
 var pkg struct { Dir string; Module struct {Main bool;Dir string} }
 if e=json.Unmarshal(raw,&pkg);e!=nil {t.Fatal(e)}
 if !pkg.Module.Main||pkg.Module.Dir!=root||pkg.Dir!=filepath.Join(root,"internal/ynxbatch") {t.Fatalf("Core must be in actual main-module root: %s",raw)}
 r,e:=runtime.OpenOriginalGrantRuntime();if r!=nil||!errors.Is(e,runtime.ErrUnavailable) {t.Fatalf("missing original Source must remain unavailable: %v",e)}
 c,e:=securelink.NewFixedPeerClient(securelink.FixedPeerClientConfig{});if c!=nil||e==nil {t.Fatal("missing trusted profile and credentials cannot create LINK client")}
}
