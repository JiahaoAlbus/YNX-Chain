//go:build pay_pq && pay_cloud && pay_auth_source

package nativehost

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/cloud"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
)

// OperatorConfig is deployment configuration, never a grant to use Pay.
// Secret values remain in the original Pay daemon environment and are not
// accepted in the configuration file or returned in errors.
type OperatorConfig struct {
	ExpectedChainID   string            `json:"expectedChainId"`
	Endpoint          BFTEndpointConfig `json:"endpoint"`
	PayStore          string            `json:"payStore"`
	PayPublicURL      string            `json:"payPublicUrl"`
	CentralMerchantID string            `json:"centralMerchantId"`
	CentralOrigin     string            `json:"centralOrigin"`
	CentralLINKConfig string            `json:"centralLinkConfig"`
	CloudState        string            `json:"cloudState"`
	CloudObjects      string            `json:"cloudObjects"`
	Private           PrivateConfig     `json:"private"`
}

func readOperatorKey(name string) ([]byte, error) {
	value := strings.TrimSpace(os.Getenv(name))
	hexValue := strings.TrimPrefix(value, "0x")
	isHex := hexValue != "" && len(hexValue)%2 == 0
	for _, c := range hexValue {
		if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
			isHex = false
			break
		}
	}
	var raw []byte
	var err error
	if isHex {
		raw, err = hex.DecodeString(hexValue)
	} else {
		raw, err = base64.RawStdEncoding.DecodeString(value)
	}
	if err != nil || len(raw) < 32 {
		return nil, errors.New("PAY_OPERATOR_KEY_INVALID")
	}
	return raw, nil
}

// ReadOperatorConfig rejects unknown or duplicate JSON fields, symlinks and
// writable-by-others files. It consumes only the operator's explicit file;
// an absent file never turns into a default Source or an alternative ledger.
func ReadOperatorConfig(path string) (OperatorConfig, BFTPrivateProductsConfig, error) {
	var input OperatorConfig
	var out BFTPrivateProductsConfig
	bad := func() (OperatorConfig, BFTPrivateProductsConfig, error) {
		return input, out, errors.New("PAY_OPERATOR_CONFIG_INVALID")
	}
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return bad()
	}
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if err != nil {
		return bad()
	}
	f := os.NewFile(uintptr(fd), path)
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() || st.Mode().Perm()&0022 != 0 || st.Size() <= 0 || st.Size() > 1<<20 {
		return bad()
	}
	stat, ok := st.Sys().(*syscall.Stat_t)
	if !ok || (stat.Uid != 0 && stat.Uid != uint32(os.Getuid())) || stat.Nlink != 1 {
		return bad()
	}
	data, err := io.ReadAll(io.LimitReader(f, 1<<20+1))
	if err != nil || int64(len(data)) != st.Size() {
		return bad()
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if dec.Decode(&input) != nil || dec.Decode(new(any)) != io.EOF {
		return bad()
	}
	canonical, err := json.Marshal(input)
	if err != nil || !bytes.Equal(canonical, bytes.TrimSpace(data)) {
		return bad()
	}
	if strings.TrimSpace(input.ExpectedChainID) != input.ExpectedChainID || input.ExpectedChainID == "" || input.CentralMerchantID == "" || input.PayPublicURL == "" || input.CentralOrigin == "" {
		return bad()
	}
	for _, p := range []string{input.PayStore, input.CloudState, input.CloudObjects, input.CentralLINKConfig, input.Private.SocketPath} {
		if !filepath.IsAbs(p) || filepath.Clean(p) != p {
			return bad()
		}
	}
	integrity, err := readOperatorKey("YNX_PAY_PRODUCT_INTEGRITY_KEY")
	if err != nil {
		return bad()
	}
	gateway, err := readOperatorKey("YNX_PAY_PRODUCT_GATEWAY_ASSERTION_KEY")
	if err != nil {
		return bad()
	}
	bootstrap := strings.TrimSpace(os.Getenv("YNX_PAY_PRODUCT_BOOTSTRAP_KEY"))
	centralKey := strings.TrimSpace(os.Getenv("YNX_PAY_PRODUCT_CENTRAL_KEY"))
	if len(bootstrap) < 24 || centralKey == "" {
		return bad()
	}
	out.Endpoint = input.Endpoint
	out.Private = input.Private
	out.Products = ProductsConfig{
		Pay:           payproduct.Config{StorePath: input.PayStore, IntegrityKey: integrity, GatewayKey: gateway, BootstrapKey: bootstrap, PublicBaseURL: input.PayPublicURL, CentralMerchantID: input.CentralMerchantID},
		Central:       payproduct.NormalCentralPayEndpoint{Origin: input.CentralOrigin, APIKey: centralKey, LINKConfigPath: input.CentralLINKConfig},
		Cloud:         cloud.OriginalPrivateHostConfig{Cloud: cloud.Config{StatePath: input.CloudState, ObjectDir: input.CloudObjects}},
		RetryInterval: 15 * time.Second,
	}
	return input, out, nil
}
