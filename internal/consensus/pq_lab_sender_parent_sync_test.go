//go:build unix

package consensus

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func senderParentFixture(t *testing.T, owners int) (PQLabNetworkPlan, string, []byte, *PQLabSenderCheckpoint) {
	t.Helper()
	source, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Owners: owners, Transfers: 2, BatchSize: 1, Online: true})
	if err != nil {
		t.Fatal(err)
	}
	defer source.Destroy()
	p, err := GeneratePQLabNetwork(source.Migration, PQLabNetworkOptions{RootDir: filepath.Join(pqLabWorkloadTemp(t), "network"), BaseP2P: 32656, BaseRPC: 32757})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(p.RootDir, "network-plan.json"))
	if err != nil {
		t.Fatal(err)
	}
	planPin := pqLabSHA(raw)
	_, migration, _, err := loadPQLab(p.RootDir, planPin)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = source.WriteCorpus(filepath.Join(p.RootDir, "workload"), migration); err != nil {
		t.Fatal(err)
	}
	persistPQLabTestCheckpoint(t, p, planPin, nil)
	raw, err = os.ReadFile(filepath.Join(p.RootDir, "workload", "PUBLIC-WORKLOAD.json"))
	if err != nil {
		t.Fatal(err)
	}
	workloadPin := pqLabSHA(raw)
	credential, err := os.ReadFile(filepath.Join(p.RootDir, "workload", "private-senders", "recovery.raw"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { clear(credential) })
	actual := publicOwnerState(t, p)
	reader := NewPQLabSenderCheckpointSource()
	t.Cleanup(func() { reader.Close() })
	checkpoint, err := reader.Load(p.RootDir, planPin, "", actual.Height, actual.AppHash, nil)
	if err != nil {
		t.Fatal(err)
	}
	return p, workloadPin, credential, checkpoint
}

func TestPQLabSenderPUBLICOperationParentPersistenceBarrier(t *testing.T) {
	p, pin, credential, checkpoint := senderParentFixture(t, 1)
	sender, err := OpenPQLabSender(filepath.Join(p.RootDir, "workload"), pin, 0, credential)
	if err != nil {
		t.Fatal(err)
	}
	defer sender.Close()
	request := PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("a", 64), OwnerIndex: 0, FirstNonce: 2, Members: 1}
	metrics := &PQLabMetrics{}
	result, err := sender.SignMeasured(request, checkpoint, metrics)
	if err != nil {
		t.Fatal(err)
	}
	stages := metrics.Snapshot().Stages
	if stages["sender.operationParentFsync"].Calls != 1 {
		t.Fatal("operation parent directory was not durably synchronized before signing")
	}
	if stages["sender.fileFsync"].Calls != 5 || stages["sender.directoryFsync"].Calls != 5 || stages["sender.dualSignEncodeAndSelfVerify"].Calls != 1 {
		t.Fatal("original five file/directory persistence barriers or AND signing changed", stages)
	}
	for _, role := range []string{"request", "intent", "wire", "envelope", "result"} {
		for _, phase := range []string{"total", "write", "fileFsync", "directoryFsync"} {
			if stages["sender.persistence."+role+"."+phase].Calls != 1 {
				t.Fatal("original role persistence changed", role, phase)
			}
		}
	}
	if result.AuthorityGranted {
		t.Fatal("synthetic signer granted authority")
	}
	if recovered, e := sender.Recover(request); e != nil || recovered.Transaction != result.Transaction {
		t.Fatal("durable original recovery changed transaction", e)
	}
}

func TestPQLabSenderPUBLICOperationParentFailurePreservesUnknown(t *testing.T) {
	type fault struct {
		name, file       string
		fileSyncs, signs uint64
	}
	faults := []fault{{"parent-sync", "", 0, 0}, {"parent-close", "", 0, 0}, {"parent-sync-and-close", "", 0, 0}, {"request", "request.json", 0, 0}, {"intent", "INTENT.json", 1, 0}, {"wire", "transaction.wire", 2, 1}, {"envelope", "transaction.abci", 3, 1}, {"result", "RESULT.json", 4, 1}, {"observed-normal-order", "", 5, 1}}
	p, pin, credential, checkpoint := senderParentFixture(t, len(faults))
	for index, tc := range faults {
		t.Run(tc.name, func(t *testing.T) {
			sender, err := OpenPQLabSender(filepath.Join(p.RootDir, "workload"), pin, index, credential)
			if err != nil {
				t.Fatal(err)
			}
			defer sender.Close()
			request := PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("b", 64), OwnerIndex: index, FirstNonce: 2, Members: 1}
			directory, err := sender.operation(request.OperationID)
			if err != nil {
				t.Fatal(err)
			}
			metrics := &PQLabMetrics{}
			faultErr := errors.New("controlled original parent sync failure")
			original := []byte("preserved-original-collision")
			if tc.name == "request" {
				original, err = json.Marshal(request)
				if err != nil {
					t.Fatal(err)
				}
			}
			barrierObserved := false
			sender.operationParentSync = func(parent *os.File) error {
				if parent.Name() != filepath.Dir(directory) {
					t.Fatal("wrong original parent")
				}
				entries, e := os.ReadDir(directory)
				if e != nil || len(entries) != 0 || metrics.Snapshot().Stages["sender.dualSignEncodeAndSelfVerify"].Calls != 0 || metrics.Snapshot().Stages["sender.exclusivePersistenceTotal"].Calls != 0 {
					t.Fatal("request/intent/file/sign preceded parent barrier", e)
				}
				if tc.name == "parent-sync" {
					return faultErr
				}
				if tc.name == "parent-sync-and-close" {
					if e = parent.Close(); e != nil {
						t.Fatal(e)
					}
					return faultErr
				}
				if e = parent.Sync(); e != nil {
					return e
				}
				barrierObserved = true
				if tc.name == "parent-close" {
					return parent.Close()
				}
				if tc.file != "" {
					return os.WriteFile(filepath.Join(directory, tc.file), original, 0600)
				}
				return nil
			}
			result, err := sender.SignMeasured(request, checkpoint, metrics)
			if tc.name == "observed-normal-order" {
				if err != nil || !barrierObserved || result.OperationID != request.OperationID || result.AuthorityGranted {
					t.Fatal("normal ordered persistence failed", err)
				}
			} else {
				if !errors.Is(err, ErrPQLabSenderUnknown) || result.OperationID != "" {
					t.Fatal("uncertain original IO reported success", err)
				}
				if (tc.name == "parent-sync" || tc.name == "parent-sync-and-close") && !errors.Is(err, faultErr) {
					t.Fatal("lost original sync first cause", err)
				}
				if (tc.name == "parent-close" || tc.name == "parent-sync-and-close") && !errors.Is(err, os.ErrClosed) {
					t.Fatal("lost original close first cause", err)
				}
				if tc.file != "" && !errors.Is(err, os.ErrExist) {
					t.Fatal("lost original exclusive-write first cause", err)
				}
			}
			stages := metrics.Snapshot().Stages
			if stages["sender.operationParentFsync"].Calls != 1 || stages["sender.fileFsync"].Calls != tc.fileSyncs || stages["sender.directoryFsync"].Calls != tc.fileSyncs || stages["sender.dualSignEncodeAndSelfVerify"].Calls != tc.signs {
				t.Fatal("failure crossed persistence/sign boundary or changed original syncs", stages)
			}
			if tc.name != "parent-sync" && tc.name != "parent-sync-and-close" && !barrierObserved {
				t.Fatal("actual parent barrier skipped")
			}
			if info, e := os.Stat(directory); e != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
				t.Fatal("partial original directory removed/changed", e)
			}
			before := senderParentOriginals(t, directory)
			if tc.file != "" && !bytes.Equal(before[tc.file], original) {
				t.Fatal("exclusive original overwritten")
			}
			if tc.name != "observed-normal-order" {
				// Existing partial operation cannot re-enter mkdir, parent sync,
				// signing or a fresh nonce. Cold import must retain the same debt.
				sender.operationParentSync = nil
				retryMetrics := &PQLabMetrics{}
				if _, e := sender.SignMeasured(request, checkpoint, retryMetrics); !errors.Is(e, ErrPQLabSenderUnknown) {
					t.Fatal("partial operation re-signed or escaped UNKNOWN", e)
				}
				if len(retryMetrics.Snapshot().Stages) != 1 {
					t.Fatal("partial retry performed side effects", retryMetrics.Snapshot())
				}
				if e := sender.Close(); e != nil {
					t.Fatal(e)
				}
				cold, e := OpenPQLabSender(filepath.Join(p.RootDir, "workload"), pin, index, credential)
				if e != nil {
					t.Fatal(e)
				}
				if _, e = cold.Recover(request); !errors.Is(e, ErrPQLabSenderUnknown) {
					cold.Close()
					t.Fatal("cold partial operation claimed original success", e)
				}
				if e = cold.Close(); e != nil {
					t.Fatal(e)
				}
				if !reflect.DeepEqual(before, senderParentOriginals(t, directory)) {
					t.Fatal("UNKNOWN/cold recovery rewrote or deleted original partial bytes")
				}
			}
		})
	}
	t.Run("attempted-mkdir-preserves-existing-original", func(t *testing.T) {
		parent := t.TempDir()
		if err := os.Chmod(parent, 0700); err != nil {
			t.Fatal(err)
		}
		directory := filepath.Join(parent, "original")
		if err := os.Mkdir(directory, 0700); err != nil {
			t.Fatal(err)
		}
		original := []byte("original-unknown")
		if err := os.WriteFile(filepath.Join(directory, "request.json"), original, 0600); err != nil {
			t.Fatal(err)
		}
		called := false
		err := pqLabFreshOperationDirectory(directory, nil, func(*os.File) error { called = true; return nil })
		if !errors.Is(err, ErrPQLabSenderUnknown) || !errors.Is(err, os.ErrExist) || called {
			t.Fatal("failed namespace mutation lost UNKNOWN/cause", err)
		}
		if got, e := os.ReadFile(filepath.Join(directory, "request.json")); e != nil || !bytes.Equal(got, original) {
			t.Fatal("existing original destroyed", e)
		}
	})
}

func senderParentOriginals(t *testing.T, directory string) map[string][]byte {
	t.Helper()
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	result := make(map[string][]byte)
	for _, entry := range entries {
		if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			t.Fatal("unexpected original operation entry")
		}
		raw, e := os.ReadFile(filepath.Join(directory, entry.Name()))
		if e != nil {
			t.Fatal(e)
		}
		result[entry.Name()] = raw
	}
	return result
}

func TestPQLabSenderPUBLICWorkloadPublicationAncestorBarriers(t *testing.T) {
	for _, name := range []string{"online-order", "sender-public-sync-failure", "workload-root-sync-failure", "workload-root-close-failure", "presigned-order"} {
		t.Run(name, func(t *testing.T) {
			online := name != "presigned-order"
			source, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Owners: 2, Transfers: 2, BatchSize: 1, Online: online})
			if err != nil {
				t.Fatal(err)
			}
			defer source.Destroy()
			plan, err := GeneratePQLabNetwork(source.Migration, PQLabNetworkOptions{RootDir: filepath.Join(pqLabWorkloadTemp(t), "network"), BaseP2P: 33656, BaseRPC: 33757})
			if err != nil {
				t.Fatal(err)
			}
			raw, err := os.ReadFile(filepath.Join(plan.RootDir, "network-plan.json"))
			if err != nil {
				t.Fatal(err)
			}
			_, bound, _, err := loadPQLab(plan.RootDir, pqLabSHA(raw))
			if err != nil {
				t.Fatal(err)
			}
			directory := filepath.Join(plan.RootDir, "workload")
			publication := filepath.Join(directory, "PUBLIC-WORKLOAD.json")
			faultErr := errors.New("controlled workload publication barrier failure")
			var order []string
			var descriptors []*os.File
			source.publicationSync = func(d *os.File) error {
				descriptors = append(descriptors, d)
				if _, e := os.Lstat(publication); !os.IsNotExist(e) {
					t.Fatal("manifest published before all ancestor barriers", e)
				}
				switch d.Name() {
				case filepath.Join(directory, "sender-public"):
					order = append(order, "sender-public")
					for i := 0; i < 2; i++ {
						if info, e := os.Stat(filepath.Join(d.Name(), fmt.Sprintf("%04d", i))); e != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
							t.Fatal("owner directory missing before batch barrier", e)
						}
						if info, e := os.Stat(filepath.Join(directory, "private-senders", fmt.Sprintf("owner-%04d.writer.lock", i))); e != nil || info.Size() != 0 || info.Mode().Perm() != 0600 {
							t.Fatal("original lease missing before batch barrier", e)
						}
					}
					if name == "sender-public-sync-failure" {
						return faultErr
					}
				case plan.RootDir:
					order = append(order, "root")
					if online && (len(order) != 2 || order[0] != "sender-public") {
						t.Fatal("workload ancestor publication reordered", order)
					}
					if name == "workload-root-sync-failure" {
						return faultErr
					}
					if name == "workload-root-close-failure" {
						return d.Close()
					}
				default:
					t.Fatal("unbounded ancestor selected")
				}
				return d.Sync()
			}
			manifest, err := source.WriteCorpus(directory, bound)
			failed := strings.Contains(name, "failure")
			if failed {
				if err == nil || manifest.Version != "" {
					t.Fatal("failed barrier returned successful manifest", err)
				}
				if name == "workload-root-close-failure" {
					if !errors.Is(err, os.ErrClosed) {
						t.Fatal("publication close cause lost", err)
					}
				} else if !errors.Is(err, faultErr) {
					t.Fatal("publication sync first cause lost", err)
				}
				if _, e := os.Lstat(publication); !os.IsNotExist(e) {
					t.Fatal("failed publication created manifest", e)
				}
				for _, original := range []string{"keys.vault", "recovery.raw", "owner-0000.writer.lock", "owner-0001.writer.lock"} {
					if info, e := os.Stat(filepath.Join(directory, "private-senders", original)); e != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
						t.Fatal("partial original custody was removed/changed", e)
					}
				}
				if sender, e := OpenPQLabSender(directory, strings.Repeat("a", 64), 0, make([]byte, 32)); e == nil {
					sender.Close()
					t.Fatal("unpublished partial setup opened a signer")
				}
			} else {
				if err != nil || manifest.Version != PQLabWorkloadVersion || manifest.AuthorityGranted {
					t.Fatal("normal original publication failed", err)
				}
				want := []string{"root"}
				if online {
					want = []string{"sender-public", "root"}
				}
				if !reflect.DeepEqual(order, want) {
					t.Fatal("setup barrier count depends on owner count or misses ancestor", order)
				}
				if _, e := os.ReadFile(publication); e != nil {
					t.Fatal(e)
				}
			}
			for _, d := range descriptors {
				if _, e := d.Stat(); !errors.Is(e, os.ErrClosed) {
					t.Fatal("publication retained descriptor", e)
				}
			}
			if len(source.materials) != 0 {
				t.Fatal("setup retained transient original key material")
			}
		})
	}
}

func TestPQLabNetworkPUBLICFreshRootParentPersistence(t *testing.T) {
	for _, name := range []string{"normal", "sync-failure", "close-failure", "existing-original", "aliased-parent"} {
		t.Run(name, func(t *testing.T) {
			parent := t.TempDir()
			if err := os.Chmod(parent, 0700); err != nil {
				t.Fatal(err)
			}
			root := filepath.Join(parent, "network")
			faultErr := errors.New("controlled root parent barrier failure")
			original := []byte("original-no-replace")
			if name == "existing-original" {
				if err := os.Mkdir(root, 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(root, "original"), original, 0600); err != nil {
					t.Fatal(err)
				}
			}
			if name == "aliased-parent" {
				alias := filepath.Join(parent, "alias")
				if err := os.Symlink(parent, alias); err != nil {
					t.Fatal(err)
				}
				root = filepath.Join(alias, "network")
			}
			var descriptor *os.File
			calls := 0
			err := pqLabNetworkFreshDirectoryWithSync(root, func(d *os.File) error {
				calls++
				descriptor = d
				if d.Name() != parent {
					t.Fatal("root barrier retargeted ancestor")
				}
				if entries, e := os.ReadDir(root); e != nil || len(entries) != 0 {
					t.Fatal("custody/plan published before root barrier", e)
				}
				if name == "sync-failure" {
					return faultErr
				}
				if e := d.Sync(); e != nil {
					return e
				}
				if name == "close-failure" {
					return d.Close()
				}
				return nil
			})
			switch name {
			case "normal":
				if err != nil || calls != 1 {
					t.Fatal("new root parent not synchronized exactly once", err, calls)
				}
			case "sync-failure":
				if !errors.Is(err, faultErr) || calls != 1 {
					t.Fatal("root sync cause lost", err)
				}
			case "close-failure":
				if !errors.Is(err, os.ErrClosed) || calls != 1 {
					t.Fatal("root close cause lost", err)
				}
			default:
				if err == nil || calls != 0 {
					t.Fatal("existing/alias root bypassed original guards", err)
				}
			}
			if descriptor != nil {
				if _, e := descriptor.Stat(); !errors.Is(e, os.ErrClosed) {
					t.Fatal("root barrier descriptor leaked", e)
				}
			}
			if name == "aliased-parent" {
				if _, e := os.Lstat(root); !os.IsNotExist(e) {
					t.Fatal("alias refusal mutated root", e)
				}
			} else {
				if info, e := os.Stat(root); e != nil || info.Mode().Perm() != 0700 {
					t.Fatal("original partial root removed/changed", e)
				}
			}
			if name == "existing-original" {
				if got, e := os.ReadFile(filepath.Join(root, "original")); e != nil || !bytes.Equal(got, original) {
					t.Fatal("existing root changed", e)
				}
			}
		})
	}
}
