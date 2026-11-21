//go:build unix

package consensus

import (
	"bytes"
	"crypto/sha256"
	"debug/buildinfo"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime/debug"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// This opt-in retains newly generated synthetic custody in place. It is never
// an authorization, a Perf pre-sign reservation, or a public CI artifact.
func privateEnrollmentFixtureRoot(t *testing.T) (string, string, bool) {
	t.Helper()
	root := os.Getenv("YNX_PQ_ENROLLMENT_PRIVATE_FIXTURE_ROOT")
	ack := os.Getenv("YNX_PQ_ENROLLMENT_PRIVATE_FIXTURE_MODE")
	if root == "" && ack == "" {
		return filepath.Join(pqLabWorkloadTemp(t), "original-lab"), "", false
	}
	if ack == "synthetic-perf-handshake" {
		if err := validateExistingPrivateEnrollmentRoot(root); err != nil {
			t.Fatal(err)
		}
	} else if err := validatePrivateEnrollmentFixtureRoot(root, ack); err != nil {
		t.Fatal(err)
	}
	commit, err := privateEnrollmentCleanSource()
	if err != nil {
		t.Fatal(err)
	}
	if ack == "synthetic-perf-handshake" && os.Getenv("YNX_PQ_ENROLLMENT_SOURCE_COMMIT") != commit {
		t.Fatal("independent exact source commit required")
	}
	return root, commit, true
}

func validateExistingPrivateEnrollmentRoot(root string) error {
	if !filepath.IsAbs(root) || filepath.Clean(root) != root {
		return errors.New("original private root must be canonical and absolute")
	}
	parent := filepath.Dir(root)
	real, err := filepath.EvalSymlinks(root)
	p, e := os.Lstat(parent)
	r, e2 := os.Lstat(root)
	var ps, rs unix.Stat_t
	if err != nil || real != root || e != nil || e2 != nil || !p.IsDir() || !r.IsDir() || p.Mode().Perm() != 0700 || r.Mode().Perm() != 0700 || unix.Lstat(parent, &ps) != nil || unix.Lstat(root, &rs) != nil || ps.Uid != uint32(os.Getuid()) || rs.Uid != uint32(os.Getuid()) {
		return errors.New("original synthetic root and parent must be unaliased private owner directories")
	}
	return nil
}

func privateEnrollmentCleanSource() (string, error) {
	commitRaw, err := exec.Command("git", "rev-parse", "HEAD").Output()
	commit := strings.TrimSpace(string(commitRaw))
	status, statusErr := exec.Command("git", "status", "--porcelain", "--untracked-files=all").Output()
	_, hexErr := hex.DecodeString(commit)
	if err != nil || len(commit) != 40 || hexErr != nil || strings.ToLower(commit) != commit || statusErr != nil || len(status) != 0 {
		return "", errors.New("private fixture requires one exact clean source checkout")
	}
	return commit, nil
}

func validatePrivateEnrollmentFixtureRoot(root, ack string) error {
	if ack != "synthetic-only" || !filepath.IsAbs(root) || filepath.Clean(root) != root {
		return errors.New("private fixture requires synthetic-only mode and a canonical absolute fresh root")
	}
	parent := filepath.Dir(root)
	resolved, err := filepath.EvalSymlinks(parent)
	info, statErr := os.Lstat(parent)
	var stat unix.Stat_t
	if err != nil || resolved != parent || statErr != nil || !info.IsDir() || info.Mode().Perm() != 0700 || unix.Lstat(parent, &stat) != nil || stat.Uid != uint32(os.Getuid()) {
		return errors.New("private fixture parent must be an existing unaliased 0700 directory owned by this user")
	}
	if _, err = os.Lstat(root); !os.IsNotExist(err) {
		return errors.New("private fixture original root must not exist; never replace a previous attempt")
	}
	return nil
}

func TestPrivateEnrollmentFixturePathRefusals(t *testing.T) {
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(parent, 0700); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(parent, "fresh")
	if err = validatePrivateEnrollmentFixtureRoot(root, "synthetic-only"); err != nil {
		t.Fatal(err)
	}
	if validatePrivateEnrollmentFixtureRoot(root, "") == nil || validatePrivateEnrollmentFixtureRoot("relative", "synthetic-only") == nil {
		t.Fatal("missing opt-in or relative root accepted")
	}
	if err = os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err = validateExistingPrivateEnrollmentRoot(root); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(root, "SYNTHETIC-ENROLLMENT-ATTEMPT.json")
	if err = pqLabWrite(marker, []byte("UNKNOWN")); err != nil {
		t.Fatal(err)
	}
	if err = pqLabWrite(marker, []byte("replacement")); err == nil {
		t.Fatal("original attempt marker replaced")
	}
	if raw, err := os.ReadFile(marker); err != nil || string(raw) != "UNKNOWN" {
		t.Fatal("original marker changed", err)
	}
	if validatePrivateEnrollmentFixtureRoot(root, "synthetic-only") == nil {
		t.Fatal("existing original accepted")
	}
	if err = os.Chmod(parent, 0755); err != nil {
		t.Fatal(err)
	}
	if validatePrivateEnrollmentFixtureRoot(filepath.Join(parent, "other"), "synthetic-only") == nil {
		t.Fatal("non-private parent accepted")
	}
	if err = os.Chmod(parent, 0700); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(parent, "alias")
	if err = os.Symlink(parent, link); err != nil {
		t.Fatal(err)
	}
	if validatePrivateEnrollmentFixtureRoot(filepath.Join(link, "other"), "synthetic-only") == nil {
		t.Fatal("aliased parent accepted")
	}
}

func verifyPrivateEnrollmentFixtureBinary(t *testing.T, path, commit string) string {
	t.Helper()
	info, err := buildinfo.ReadFile(path)
	if err != nil {
		t.Fatal("normal CLI build identity unavailable", err)
	}
	binding, err := validatePrivateEnrollmentBuildInfo(info, commit)
	if err != nil {
		t.Fatal(err)
	}
	return binding
}

func validatePrivateEnrollmentBuildInfo(info *buildinfo.BuildInfo, commit string) (string, error) {
	if info == nil || info.Path != "github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-consensus-pq-lab" || info.Main.Path != "github.com/JiahaoAlbus/YNX-Chain" {
		return "", errors.New("normal original synthetic CLI build required")
	}
	settings := map[string]string{}
	for _, setting := range info.Settings {
		if _, duplicate := settings[setting.Key]; duplicate {
			return "", errors.New("duplicate CLI build setting")
		}
		settings[setting.Key] = setting.Value
	}
	revision, hasRevision := settings["vcs.revision"]
	modified, hasModified := settings["vcs.modified"]
	if !hasRevision && !hasModified {
		return "EXTERNAL_ONLY", nil
	}
	if !hasRevision || !hasModified || revision != commit || modified != "false" {
		return "", errors.New("embedded CLI source identity differs")
	}
	return "EMBEDDED_VCS", nil
}

func TestPrivateEnrollmentBuildIdentityMissingAndConflicting(t *testing.T) {
	commit := strings.Repeat("a", 40)
	info := &debug.BuildInfo{Path: "github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-consensus-pq-lab", Main: debug.Module{Path: "github.com/JiahaoAlbus/YNX-Chain"}}
	if binding, err := validatePrivateEnrollmentBuildInfo(info, commit); err != nil || binding != "EXTERNAL_ONLY" {
		t.Fatal("missing VCS must remain external-only", binding, err)
	}
	info.Settings = []debug.BuildSetting{{Key: "vcs.revision", Value: commit}, {Key: "vcs.modified", Value: "false"}}
	if binding, err := validatePrivateEnrollmentBuildInfo(info, commit); err != nil || binding != "EMBEDDED_VCS" {
		t.Fatal("matching embedded identity refused", binding, err)
	}
	info.Settings[0].Value = strings.Repeat("b", 40)
	if _, err := validatePrivateEnrollmentBuildInfo(info, commit); err == nil {
		t.Fatal("different embedded revision accepted")
	}
	info.Settings[0].Value = commit
	info.Settings[1].Value = "true"
	if _, err := validatePrivateEnrollmentBuildInfo(info, commit); err == nil {
		t.Fatal("modified source accepted")
	}
	info.Settings = info.Settings[:1]
	if _, err := validatePrivateEnrollmentBuildInfo(info, commit); err == nil {
		t.Fatal("partial VCS identity accepted")
	}
	for _, settings := range [][]debug.BuildSetting{
		{{Key: "vcs.revision", Value: strings.Repeat("b", 40)}, {Key: "vcs.revision", Value: commit}, {Key: "vcs.modified", Value: "false"}},
		{{Key: "vcs.revision", Value: commit}, {Key: "vcs.revision", Value: strings.Repeat("b", 40)}, {Key: "vcs.modified", Value: "false"}},
		{{Key: "vcs.revision", Value: commit}, {Key: "vcs.modified", Value: "true"}, {Key: "vcs.modified", Value: "false"}},
		{{Key: "vcs.revision", Value: commit}, {Key: "vcs.modified", Value: "false"}, {Key: "vcs.modified", Value: "true"}},
	} {
		info.Settings = settings
		if _, err := validatePrivateEnrollmentBuildInfo(info, commit); err == nil {
			t.Fatal("duplicate build identity accepted")
		}
	}
	info.Settings = nil
	info.Path = "unrelated"
	if _, err := validatePrivateEnrollmentBuildInfo(info, commit); err == nil {
		t.Fatal("wrong command accepted")
	}
}

func retainPrivateEnrollmentFixture(t *testing.T, root, binary, commit, cliSourceBinding, planPin, workloadPin string, proofExpiry time.Time, request []byte, confirm, recover any, response, recovery []byte) {
	t.Helper()
	current, err := privateEnrollmentCleanSource()
	if err != nil || current != commit {
		t.Fatal("fixture source changed during generation", err)
	}
	// Commands and replies contain public synthetic data and original paths;
	// they remain in the same 0700 private root as its generated credentials.
	files := []struct {
		name string
		raw  []byte
	}{}
	for _, entry := range []struct {
		name string
		v    any
	}{{"fixture-confirm-command.json", confirm}, {"fixture-recover-command.json", recover}} {
		raw, err := json.Marshal(entry.v)
		if err != nil {
			t.Fatal(err)
		}
		files = append(files, struct {
			name string
			raw  []byte
		}{entry.name, raw})
	}
	files = append(files, struct {
		name string
		raw  []byte
	}{"fixture-confirm-reply.json", bytes.TrimSpace(response)}, struct {
		name string
		raw  []byte
	}{"fixture-recover-reply.json", bytes.TrimSpace(recovery)})
	for _, f := range files {
		if err := pqLabWrite(filepath.Join(root, f.name), f.raw); err != nil {
			t.Fatal("retain original fixture output", err)
		}
	}
	binarySHA, err := privateEnrollmentFixtureFileSHA(binary)
	if err != nil {
		t.Fatal(err)
	}
	testBinary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	testBinarySHA, err := privateEnrollmentFixtureFileSHA(testBinary)
	if err != nil {
		t.Fatal(err)
	}
	header, err := json.Marshal(struct {
		Version                string `json:"version"`
		SourceCommit           string `json:"sourceCommit"`
		BinarySHA256           string `json:"binarySHA256"`
		CLISourceBinding       string `json:"cliSourceBinding"`
		TestBinarySHA256       string `json:"testBinarySHA256"`
		TestSourceBinding      string `json:"testSourceBinding"`
		PlanSHA256             string `json:"planSHA256"`
		WorkloadSHA256         string `json:"workloadSHA256"`
		RequestSHA256          string `json:"requestSHA256"`
		ProofTrustExpiresAt    string `json:"proofTrustExpiresAt"`
		TestOutcome            string `json:"testOutcome"`
		CurrentEligibility     string `json:"currentEligibility"`
		SyntheticOnly          bool   `json:"syntheticOnly"`
		PreSignPerfReservation bool   `json:"preSignPerfReservation"`
		AuthorityGranted       bool   `json:"authorityGranted"`
	}{"YNX-PRIVATE-SYNTHETIC-ENROLLMENT-FIXTURE/v1", commit, binarySHA, cliSourceBinding, testBinarySHA, "NOT_ATTESTED", planPin, workloadPin, pqLabSHA(request), proofExpiry.UTC().Format(time.RFC3339Nano), "NOT_ATTESTED", "UNKNOWN", true, false, false})
	if err != nil {
		t.Fatal(err)
	}
	if err = pqLabWrite(filepath.Join(root, "fixture-public-identity.json"), header); err != nil {
		t.Fatal("retain fixture identity", err)
	}
}

func privateEnrollmentFixtureFileSHA(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	_, copyErr := io.Copy(h, f)
	if err = errors.Join(copyErr, f.Close()); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
