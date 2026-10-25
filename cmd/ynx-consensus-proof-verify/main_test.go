//go:build unix

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"golang.org/x/sys/unix"
)

func proofContextSyntaxFixture(dir string) trustContext {
	hash := strings.Repeat("11", 32)
	return trustContext{Version: contextVersion, ChainID: "offline-pq-proof-test", MigrationFile: filepath.Join(dir, "migration.json"), GenesisFile: filepath.Join(dir, "genesis.json"), StateFile: filepath.Join(dir, "committed.state"), ScheduleFile: filepath.Join(dir, "schedule.json"), ScheduleHash: hash, ConsensusGenesisSHA256: hash, OriginalGenesisHash: hash, MigrationStateHash: hash, EngineHeight: "9007199254740993", EngineAppHash: hash, ExpectedHeaderHeight: "9007199254740993", ExpectedBlockHash: hash, ExpectedStateHeight: "9007199254740992", ExpectedStateAppHash: hash, TrustedLightBlockFile: filepath.Join(dir, "trusted.json"), TrustedLightBlockSHA256: hash, TrustingPeriodNanoseconds: "3600000000000", MaxClockDriftNanoseconds: "1000000000", TrustLevelNumerator: "1", TrustLevelDenominator: "3"}
}

func proofContextFile(t *testing.T, path string, raw []byte) options {
	t.Helper()
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	return options{contextPath: path, contextSHA256: hex.EncodeToString(sum[:])}
}

func TestProofVerifierExternalContextPinAndStrictStrings(t *testing.T) {
	dir := t.TempDir()
	c := proofContextSyntaxFixture(dir)
	raw, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "trust.json")
	o := proofContextFile(t, path, raw)
	got, err := readTrustContext(o)
	if err != nil || !reflect.DeepEqual(got, c) {
		t.Fatal("exact external context pin did not preserve string fields", err)
	}
	// This only validates configuration syntax, never a proof or trust source.
	if _, err = got.load(); err == nil {
		t.Fatal("configuration syntax supplied absent original authority material")
	}
	tampered := bytes.Replace(raw, []byte(`"engineHeight":"9007199254740993"`), []byte(`"engineHeight":"9007199254740994"`), 1)
	proofContextFile(t, path, tampered)
	if _, err = readTrustContext(o); err == nil {
		t.Fatal("same file changed its trust root without a new external pin")
	}
	if after, err := os.ReadFile(path); err != nil || !bytes.Equal(after, tampered) {
		t.Fatal("refused trust context was rewritten", err)
	}

	bad := map[string][]byte{
		"duplicate":      bytes.Replace(raw, []byte(`"version":`), []byte(`"version":"ignored","version":`), 1),
		"case_alias":     bytes.Replace(raw, []byte(`"engineHeight":`), []byte(`"EngineHeight":`), 1),
		"case_duplicate": bytes.Replace(raw, []byte(`"engineHeight":`), []byte(`"EngineHeight":"1","engineHeight":`), 1),
		"unknown_now":    append([]byte(`{"now":"2026-10-18T00:00:00Z",`), raw[1:]...),
		"missing":        bytes.Replace(raw, []byte(`"runtimePlanFile":"",`), nil, 1),
		"null":           bytes.Replace(raw, []byte(`"runtimePlanFile":""`), []byte(`"runtimePlanFile":null`), 1),
		"number":         bytes.Replace(raw, []byte(`"engineHeight":"9007199254740993"`), []byte(`"engineHeight":9007199254740993`), 1),
		"leading_zero":   bytes.Replace(raw, []byte(`"trustLevelNumerator":"1"`), []byte(`"trustLevelNumerator":"01"`), 1),
		"bad_fraction":   bytes.Replace(raw, []byte(`"trustLevelDenominator":"3"`), []byte(`"trustLevelDenominator":"4"`), 1),
		"unsafe_period":  bytes.Replace(raw, []byte(`"trustingPeriodNanoseconds":"3600000000000"`), []byte(`"trustingPeriodNanoseconds":"9223372036854775808"`), 1),
		"future_source":  bytes.Replace(raw, []byte(`"engineHeight":"9007199254740993"`), []byte(`"engineHeight":"9223372036854775807"`), 1),
		"trailing":       append(bytes.Clone(raw), []byte(`{}`)...),
	}
	for name, wire := range bad {
		t.Run(name, func(t *testing.T) {
			if bytes.Equal(wire, raw) {
				t.Fatal("negative fixture failed to change the original context")
			}
			// Pin the malformed bytes independently to isolate schema checks.
			pinned := proofContextFile(t, path, wire)
			if _, err := readTrustContext(pinned); err == nil {
				t.Fatal("malformed independently pinned context accepted")
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(after, wire) {
				t.Fatal("refused context was mutated", err)
			}
		})
	}
}

func TestProofVerifierExactIntegerAndHashCoordinates(t *testing.T) {
	hash := strings.Repeat("12", 32)
	e := expectedStatement{ChainID: "test", HeaderHeight: "9007199254740993", BlockHash: hash, StateHeight: "9007199254740992", StateAppHash: hash}
	got, err := e.decode()
	if err != nil || got.HeaderHeight != 9007199254740993 || got.StateHeight != 9007199254740992 {
		t.Fatal("header/state height lost precision above JavaScript safe integer", err)
	}
	for _, value := range []string{"", "-1", "+1", "01", "1.0", "1e3", " 1", "18446744073709551616", "9223372036854775808"} {
		bad := e
		bad.HeaderHeight = value
		if _, err := bad.decode(); err == nil {
			t.Fatal("noncanonical or out-of-range height accepted", value)
		}
	}
	for _, value := range []string{strings.Repeat("00", 32), strings.Repeat("AB", 32), "0x" + hash, hash[:62]} {
		bad := e
		bad.BlockHash = value
		if _, err := bad.decode(); err == nil {
			t.Fatal("noncanonical block hash accepted")
		}
	}
	bad := e
	bad.StateHeight = e.HeaderHeight
	if _, err := bad.decode(); err == nil {
		t.Fatal("header not exactly stateHeight+1 accepted")
	}
	if value, err := decimal("18446744073709551615", math.MaxUint64, false); err != nil || value != math.MaxUint64 {
		t.Fatal("uint64 parser used a float or signed intermediate", err)
	}
}

type observedInput struct{ reads int }

func (r *observedInput) Read([]byte) (int, error) { r.reads++; return 0, io.EOF }

func TestProofVerifierCLIRejectsAuthorityFromProofAndRepeatedFlags(t *testing.T) {
	path := filepath.Join(t.TempDir(), "trust.json")
	args := []string{"--trust-context", path, "--trust-context-sha256", strings.Repeat("11", 32)}
	if _, err := parseOptions(args); err != nil {
		t.Fatal("explicit syntax refused", err)
	}
	for _, bad := range [][]string{nil, {"--trust-context", path}, append(append([]string{}, args...), "--trust-context", path), append(append([]string{}, args...), "--now", "2026-10-18T00:00:00Z"), append(append([]string{}, args...), "--rpc", "https://peer.invalid"), append(append([]string{}, args...), "--private-key", "not-a-public-input")} {
		var output bytes.Buffer
		input := &observedInput{}
		if status := run(bad, input, &output, time.Now); status != 1 || input.reads != 0 {
			t.Fatal("invalid startup consumed proof or succeeded")
		}
		assertProofFailure(t, output.Bytes(), "INVALID_ARGUMENTS")
	}
	hash := strings.Repeat("12", 32)
	base := `{"version":"` + requestVersion + `","expected":{"chainId":"test","headerHeight":"2","blockHash":"` + hash + `","stateHeight":"1","stateAppHash":"` + hash + `"},"proof":{}}`
	for _, wire := range []string{
		`{"trustContext":{},` + base[1:],
		`{"now":"2026-10-18T00:00:00Z",` + base[1:],
		strings.Replace(base, `"headerHeight":"2"`, `"headerHeight":2`, 1),
		strings.Replace(base, `"headerHeight":"2"`, `"HeaderHeight":"2"`, 1),
		strings.Replace(base, `"stateHeight":"1"`, `"stateHeight":"0","stateHeight":"1"`, 1),
		strings.Replace(base, `"chainId":"test"`, `"chainId":null`, 1),
		base + `{}`,
	} {
		var output bytes.Buffer
		clockCalled := false
		status := run(args, strings.NewReader(wire), &output, func() time.Time { clockCalled = true; return time.Now() })
		if status != 1 || clockCalled {
			t.Fatal("invalid request reached the verifier or supplied its own authority")
		}
		assertProofFailure(t, output.Bytes(), "INVALID_REQUEST")
	}
}

func assertProofFailure(t *testing.T, raw []byte, expectedCode string) {
	t.Helper()
	var result commandResult
	if err := strictJSON(raw, &result); err != nil || result.Version != resultVersion || result.Code != expectedCode || result.Error == "" || result.Result != nil {
		t.Fatal("failure did not use stable JSON or carried a verified result", err, string(raw))
	}
}

func TestProofVerifierCLIRejectsRetargetingAgainstExternalContext(t *testing.T) {
	dir := t.TempDir()
	c := proofContextSyntaxFixture(dir)
	raw, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	o := proofContextFile(t, filepath.Join(dir, "trust.json"), raw)
	args := []string{"--trust-context", o.contextPath, "--trust-context-sha256", o.contextSHA256}
	// This is valid transport only, not a positive commit fixture. Every case
	// must fail the independent invocation match BEFORE opening source material
	// or trying crypto; no fixture is labelled a verified proof.
	proof, err := json.Marshal(consensus.PQLightProofRequest{Version: consensus.PQLightProofVersion, CommitResult: []byte(`{}`), ValidatorsResult: []byte(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"chain", "heights", "block_hash", "state_hash"} {
		t.Run(mode, func(t *testing.T) {
			e := c.expected()
			switch mode {
			case "chain":
				e.ChainID = "different-chain"
			case "heights":
				e.HeaderHeight, e.StateHeight = "9007199254740994", "9007199254740993"
			case "block_hash":
				e.BlockHash = strings.Repeat("22", 32)
			case "state_hash":
				e.StateAppHash = strings.Repeat("22", 32)
			}
			request, err := json.Marshal(proofInput{Version: requestVersion, Expected: e, Proof: proof})
			if err != nil {
				t.Fatal(err)
			}
			var output bytes.Buffer
			clockCalled := false
			status := run(args, bytes.NewReader(request), &output, func() time.Time { clockCalled = true; return time.Now() })
			if status != 1 || clockCalled {
				t.Fatal("untrusted proof selected its invocation target")
			}
			assertProofFailure(t, output.Bytes(), "INVALID_REQUEST")
			var response commandResult
			if err := json.Unmarshal(output.Bytes(), &response); err != nil || !strings.Contains(response.Error, "independently pinned invocation target") {
				t.Fatal("case did not reach the actual invocation binding check", err)
			}
			if after, err := os.ReadFile(o.contextPath); err != nil || !bytes.Equal(after, raw) {
				t.Fatal("target refusal altered independent context", err)
			}
		})
	}
}

func TestProofVerifierPublicReadsNeverRepairOrFollowSpecialFiles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "public.json")
	wire := []byte(`{"public":"fixture"}`)
	if err := os.WriteFile(path, wire, 0600); err != nil {
		t.Fatal(err)
	}
	before, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	got, err := readPublicFile(path, int64(len(wire)))
	after, statErr := os.Lstat(path)
	if err != nil || statErr != nil || !bytes.Equal(wire, got) || !samePublicFile(before, after) {
		t.Fatal("bounded normal public read changed original source", err, statErr)
	}
	if _, err := readPublicFile(path, int64(len(wire)-1)); err == nil {
		t.Fatal("oversized public file accepted")
	}
	link := filepath.Join(dir, "link.json")
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	fifo := filepath.Join(dir, "fifo")
	if err := unix.Mkfifo(fifo, 0600); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{link, fifo, dir, filepath.Join(dir, "absent.json"), "relative.json"} {
		if _, err := readPublicFile(bad, 1024); err == nil {
			t.Fatal("non-original or special source accepted", bad)
		}
	}
	got, err = os.ReadFile(path)
	if err != nil || !bytes.Equal(got, wire) {
		t.Fatal("refused read rewrote public input", err)
	}
	if _, err = os.Stat(filepath.Join(dir, "absent.json")); !os.IsNotExist(err) {
		t.Fatal("read path created an absent source")
	}
}
