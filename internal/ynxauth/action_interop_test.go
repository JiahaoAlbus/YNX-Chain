package ynxauth

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

type actionPublicInteropRow struct {
	Kind            string         `json:"kind"`
	Payload         map[string]any `json:"payload"`
	ChainID         string         `json:"chainId"`
	NativeChainID   string         `json:"nativeChainId"`
	Owner           string         `json:"owner"`
	Nonce           string         `json:"nonce"`
	Fee             string         `json:"fee"`
	PayloadHex      string         `json:"payloadHex"`
	SigningBytesHex string         `json:"signingBytesHex"`
	SHA256          string         `json:"sha256"`
}

type actionPublicInteropFixture struct {
	Version              string                   `json:"version"`
	Classification       string                   `json:"classification"`
	CodecOnly            bool                     `json:"codecOnly"`
	SigningPerformed     bool                     `json:"signingPerformed"`
	ExecutionPerformed   bool                     `json:"executionPerformed"`
	AuthorizationGranted bool                     `json:"authorizationGranted"`
	FeeSemantics         string                   `json:"feeSemantics"`
	RowCount             string                   `json:"rowCount"`
	KindCount            string                   `json:"kindCount"`
	Rows                 []actionPublicInteropRow `json:"rows"`
}

// This is only a JSON projection of the existing typed vector inputs. It does
// not encode fields, infer defaults, coerce through float64 or execute actions.
// All unsigned integer leaves and constructor arguments remain exact decimal
// strings for a JavaScript consumer, including values above 2^53 and MaxInt64.
func actionInteropTypedInput(t *testing.T, payload any) map[string]any {
	t.Helper()
	v := reflect.ValueOf(payload)
	if v.Kind() != reflect.Struct {
		t.Fatal("public interop input must retain its original typed value")
	}
	input := make(map[string]any, v.NumField())
	for i := 0; i < v.NumField(); i++ {
		field, definition := v.Field(i), v.Type().Field(i)
		if definition.PkgPath != "" {
			t.Fatal("public typed input contains an unexported field")
		}
		name := strings.ToLower(definition.Name[:1]) + definition.Name[1:]
		if definition.Name == "AICredits" {
			name = "aiCredits"
		}
		switch field.Kind() {
		case reflect.String:
			input[name] = field.String()
		case reflect.Uint32, reflect.Uint64:
			input[name] = strconv.FormatUint(field.Uint(), 10)
		case reflect.Slice:
			if field.Type().Elem().Kind() != reflect.Uint64 {
				t.Fatal("public interop accepts only the original uint64 constructor array")
			}
			values := make([]string, field.Len())
			for j := range values {
				values[j] = strconv.FormatUint(field.Index(j).Uint(), 10)
			}
			input[name] = values
		default:
			t.Fatal("public interop cannot silently omit an unsupported typed field", definition.Name)
		}
	}
	return input
}

// Existing or incomplete output is retained. There is no overwrite, remove,
// retry, rename over an old file, or attempt to recover a partial fixture.
func writeActionPublicInterop(path string, raw []byte) (err error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || len(raw) == 0 || len(raw) > 1<<20 {
		return errors.New("bounded public interop output requires a clean absolute new file")
	}
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer func() {
		err = errors.Join(err, f.Close())
	}()
	before, err := f.Stat()
	if err != nil {
		return err
	}
	if n, err := f.Write(raw); err != nil || n != len(raw) {
		return fmt.Errorf("incomplete public interop output retained: bytes=%d error=%v", n, err)
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	readback, err := io.ReadAll(io.LimitReader(f, int64(len(raw))+1))
	after, statErr := f.Stat()
	entry, pathErr := os.Lstat(path)
	if err != nil || statErr != nil || pathErr != nil || !after.Mode().IsRegular() || after.Mode().Perm() != 0600 || !os.SameFile(before, after) || !os.SameFile(after, entry) || !bytes.Equal(readback, raw) {
		return errors.New("public interop output readback failed; original attempt retained")
	}
	parent, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	syncErr := parent.Sync()
	return errors.Join(syncErr, parent.Close())
}

func TestActionPublicInteropFixture(t *testing.T) {
	fixture := actionPublicInteropFixture{
		Version: "YNX-NATIVE-ACTION-PUBLIC-INTEROP/v1", Classification: "data", CodecOnly: true,
		FeeSemantics: "Vector inputs only. Legacy fee 7 is syntax data, not an executor fee or default.",
		Rows:         make([]actionPublicInteropRow, 0, 18),
	}
	kinds := make(map[string]bool)
	appendRow := func(a Action, typed any, wireLength int, pinnedSHA256, payloadHex, signingHex string) {
		t.Helper()
		payload, err := EncodeActionPayload(a.Kind, typed)
		authOK(t, err)
		if !bytes.Equal(payload, a.Payload) {
			t.Fatal("public vector action does not contain its complete original typed payload")
		}
		wire, err := a.SigningBytes()
		authOK(t, err)
		digest := sha256.Sum256(wire)
		actualSHA256 := hex.EncodeToString(digest[:])
		if len(wire) != wireLength || actualSHA256 != pinnedSHA256 || payloadHex != "" && hex.EncodeToString(payload) != payloadHex || signingHex != "" && hex.EncodeToString(wire) != signingHex {
			t.Fatal("actual Go codec differs from its existing frozen independent public vector", a.Kind)
		}
		decoded, err := DecodeAction(wire)
		authOK(t, err)
		decodedPayload, err := DecodeActionPayload(a.Kind, payload)
		authOK(t, err)
		if !reflect.DeepEqual(a, decoded) || !reflect.DeepEqual(typed, decodedPayload) {
			t.Fatal("public fixture lost an original typed field during normal Go roundtrip", a.Kind)
		}
		fixture.Rows = append(fixture.Rows, actionPublicInteropRow{
			Kind: a.Kind, Payload: actionInteropTypedInput(t, typed), ChainID: hex.EncodeToString(a.ChainID),
			NativeChainID: strconv.FormatUint(a.NativeChainID, 10), Owner: a.Owner, Nonce: strconv.FormatUint(a.Nonce, 10), Fee: strconv.FormatUint(a.Fee, 10),
			PayloadHex: hex.EncodeToString(payload), SigningBytesHex: hex.EncodeToString(wire), SHA256: actualSHA256,
		})
		kinds[a.Kind] = true
	}
	for _, vector := range actionVectors() {
		appendRow(vectorAction(t, vector), vector.payload, vector.wireLength, vector.sha256, "", "")
	}
	for _, vector := range contractActionVectors() {
		appendRow(contractVectorAction(t, vector), vector.payload, vector.wireLength, vector.sha256, "", "")
	}
	for _, vector := range stakingActionVectors() {
		appendRow(stakingVectorAction(t, vector), vector.payload, vector.wireLength, vector.sha256, vector.payloadHex, vector.wireHex)
	}
	if len(fixture.Rows) != 18 || len(kinds) != 16 {
		t.Fatal("public interop fixture must retain the original 11, four contract and three staking rows")
	}
	fixture.RowCount, fixture.KindCount = strconv.Itoa(len(fixture.Rows)), strconv.Itoa(len(kinds))
	raw, err := json.MarshalIndent(fixture, "", "  ")
	authOK(t, err)
	raw = append(raw, '\n')
	if output := os.Getenv("YNX_ACTION_INTEROP_OUT"); output != "" {
		if err := writeActionPublicInterop(output, raw); err != nil {
			t.Fatal("public action fixture output was not completed; preserve any original/partial file", err)
		}
	}
}
