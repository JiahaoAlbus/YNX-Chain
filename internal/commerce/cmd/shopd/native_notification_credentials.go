package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"

	"github.com/JiahaoAlbus/YNX-Chain/internal/commerce"
)

// The explicitly selected private file contains only the actual Pay merchant
// notification credential. It cannot configure a Buyer/Source, transport,
// receipt, signer, price or funds operation. No ENV/default path is consulted.
func loadOriginalNativePayNotificationReceivers(path string) ([]commerce.NativePayNotificationReceiver, error) {
	if path == "" {
		return nil, nil
	}
	invalid := errors.New("original Native Pay notification credential file unavailable or invalid")
	if !filepath.IsAbs(path) {
		return nil, invalid
	}
	before, err := os.Lstat(path)
	if err != nil || !before.Mode().IsRegular() || before.Mode().Perm()&0077 != 0 || before.Size() > 65536 {
		return nil, invalid
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, invalid
	}
	defer f.Close()
	held, err := f.Stat()
	if err != nil || !os.SameFile(before, held) || !held.Mode().IsRegular() || held.Mode().Perm()&0077 != 0 {
		return nil, invalid
	}
	raw, err := io.ReadAll(io.LimitReader(f, 65537))
	if err != nil || len(raw) > 65536 {
		return nil, invalid
	}
	var input struct {
		Version   string `json:"version"`
		Receivers []struct {
			MerchantID    string `json:"merchantId"`
			StoreID       string `json:"storeId"`
			SecretVersion int    `json:"secretVersion"`
			SecretHex     string `json:"secretHex"`
		} `json:"receivers"`
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || d.Decode(new(any)) != io.EOF || input.Version != "ynx.shop.native-pay-notification-receivers/v1" || len(input.Receivers) < 1 || len(input.Receivers) > 100 {
		return nil, invalid
	}
	id := regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)
	seen := map[string]bool{}
	out := make([]commerce.NativePayNotificationReceiver, 0, len(input.Receivers))
	for _, row := range input.Receivers {
		secret, err := hex.DecodeString(row.SecretHex)
		if err != nil || len(secret) < 32 || len(secret) > 1024 || hex.EncodeToString(secret) != row.SecretHex || row.SecretVersion < 1 || !id.MatchString(row.MerchantID) || !id.MatchString(row.StoreID) || seen[row.MerchantID] {
			return nil, invalid
		}
		seen[row.MerchantID] = true
		out = append(out, commerce.NativePayNotificationReceiver{MerchantID: row.MerchantID, StoreID: row.StoreID, SecretVersion: row.SecretVersion, Secret: secret})
	}
	return out, nil
}
