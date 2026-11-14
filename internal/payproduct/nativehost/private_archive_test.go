//go:build pay_pq && pay_cloud && pay_auth_source && pay_securelink && securelink_openssl && cgo

package nativehost

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPrivateNormalArchiveRegistrationKeepsMissingEngineClosed(t *testing.T) {
	root := os.Getenv("PAY_ARCHIVE_UNIX_SOCKET_ROOT")
	if !filepath.IsAbs(root) {
		t.Fatal("owned short external socket root required")
	}
	dir, err := os.MkdirTemp(root, "p06-host-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	// Original normal constructors and explicit PUBLIC temporary TLS material;
	// no engine, Root resource, service credentials or real account is invented.
	products, err := OpenProducts(context.Background(), productsNormalConfig(t), buildinfo.Info{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	path := "/v5/pay/products/shop.order/order%3A001/invoices/0x" + strings.Repeat("a", 40) + "/invoice%3A001/archive-reconciliation"
	cfg := PrivateConfig{SocketPath: filepath.Join(dir, "pay.sock"), Service: "pay-products", PeerUID: uint32(os.Geteuid()), PeerPID: os.Getpid(), Routes: []securelink.LocalCallerRoute{{Method: http.MethodGet, Path: path, MaxBodyBytes: 0, Timeout: 2 * time.Second}}}
	private, err := OpenPrivate(products, cfg)
	if private == nil || err != nil {
		if private != nil {
			_ = private.Shutdown(context.Background())
		}
		t.Fatal("normal Product archive registration unavailable", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if e := private.Shutdown(ctx); e != nil {
			t.Error(e)
		}
		if !private.Closed() {
			t.Error("normal original products retained unexpectedly")
		}
	})
	request := func(target string) (int, []byte) {
		t.Helper()
		conn, e := net.DialTimeout("unix", cfg.SocketPath, time.Second)
		if e != nil {
			t.Fatal(e)
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
		_, e = fmt.Fprintf(conn, "GET %s HTTP/1.1\r\nHost: pay-products\r\nConnection: close\r\n\r\n", target)
		if e != nil {
			t.Fatal(e)
		}
		r, e := http.ReadResponse(bufio.NewReader(conn), nil)
		if e != nil {
			t.Fatal(e)
		}
		defer r.Body.Close()
		b, e := io.ReadAll(io.LimitReader(r.Body, 1<<16))
		if e != nil {
			t.Fatal(e)
		}
		return r.StatusCode, b
	}
	code, body := request(path)
	if code != 503 || !bytes.Contains(body, []byte("NATIVE_PAY_AUTHORITY_UNAVAILABLE")) || products.NativeSourceStatus() != ErrOriginalEngineResourcesNotSupplied {
		t.Fatal("canonical registration bypassed actual missing engine/Source", code, string(body), products.NativeSourceStatus())
	}
	for _, target := range []string{strings.ReplaceAll(path, "%3A", "%253A"), strings.ReplaceAll(path, "%3A", "%3a"), strings.ReplaceAll(path, "%3A", "%2F")} {
		status, _ := request(target)
		if status < 400 || status == 503 {
			t.Fatal("alias reached normal products", status, target)
		}
	}
	t.Log("ACTUAL_NORMAL_OPEN_PRIVATE ProductArchiveRegistered=true canonicalUnixSource0=503 aliasesBeforeProduct=3 SourceAdmission=false noTCP=true")
}
