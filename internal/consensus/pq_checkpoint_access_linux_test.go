//go:build linux

package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"reflect"
	"strconv"
	"syscall"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cmttypes "github.com/cometbft/cometbft/types"
	"golang.org/x/sys/unix"
)

// This is a source/permission regression, not Node.Start or a remote-signing
// window. Only the original normal Linux CI explicitly launches it as root;
// both actual file producer and consumer then run as different NON-root UIDs.
func TestPQCheckpointAccessTwoUIDOriginalStateLayouts(t *testing.T) {
	if os.Getenv("YNX_PQ_CHECKPOINT_DUAL_UID") != "authorized-source-only-two-uid" {
		t.Skip("explicit original CI dual-UID source test not selected")
	}
	if os.Geteuid() != 0 {
		t.Fatal("dual-UID coordinator requires explicit CI root, not a same-UID simulation")
	}
	parseUID := func(name string) uint32 {
		raw := os.Getenv(name)
		n, err := strconv.ParseUint(raw, 10, 32)
		if err != nil || n == 0 || strconv.FormatUint(n, 10) != raw {
			t.Fatal("missing canonical independent non-root UID", name)
		}
		return uint32(n)
	}
	engineUID, signerUID := parseUID("YNX_PQ_CHECKPOINT_ENGINE_UID"), parseUID("YNX_PQ_CHECKPOINT_SIGNER_UID")
	if engineUID == signerUID {
		t.Fatal("two actual distinct UIDs required")
	}
	binary := os.Getenv("YNX_PQ_CHECKPOINT_TEST_BINARY")
	self, err := os.Executable()
	if err != nil || !filepath.IsAbs(binary) || filepath.Clean(binary) != binary {
		t.Fatal("original compiled test binary is required", err)
	}
	a, errA := os.Stat(self)
	b, errB := os.Stat(binary)
	if errA != nil || errB != nil || !os.SameFile(a, b) || !b.Mode().IsRegular() || b.Mode().Perm()&0111 == 0 {
		t.Fatal("dual-UID helpers must run the SAME original compiled test binary")
	}
	base, err := os.MkdirTemp("/tmp", "ynx-checkpoint-two-uid-")
	if err != nil {
		t.Fatal(err)
	}
	// No source/key mode changes. This newly created traversal-only QA root
	// contains separate 0700 homes, each created for its actual helper UID.
	if err = os.Chmod(base, 0711); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 170*time.Second)
	defer cancel()
	var completed []checkpointUIDLayoutResult
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			access := PQCheckpointAccess{Address: fmt.Sprintf("@ynx-pq-checkpoint-test-%d-%s", os.Getpid(), layout), EngineUID: engineUID, SignerUID: signerUID, Timeout: time.Minute}
			engine := startCheckpointUIDHelper(t, ctx, binary, base, engineUID, checkpointUIDMessage{Role: "engine", Layout: layout, Access: access})
			defer engine.close(t)
			original := engine.receive(t)
			if original.UID != engineUID || original.Layout != layout {
				t.Fatal("actual producer UID/layout differs")
			}
			// A real third UID (the root coordinator) is not the approved signer.
			rogue, err := net.DialUnix("unixpacket", nil, &net.UnixAddr{Name: access.Address, Net: "unixpacket"})
			if err != nil {
				t.Fatal(err)
			}
			_ = rogue.SetDeadline(time.Now().Add(time.Second))
			_, _ = rogue.Write([]byte("capture"))
			packet := make([]byte, 128)
			if n, err := rogue.Read(packet); err == nil || n != 0 {
				t.Fatal("wrong actual peer UID received original checkpoint data")
			}
			_ = rogue.Close()
			original.Role = "signer"
			signer := startCheckpointUIDHelper(t, ctx, binary, base, signerUID, original)
			defer signer.close(t)
			ready := signer.receive(t)
			if ready.UID != signerUID || !ready.DirectDenied || !ready.DescriptorReadOnly || ready.PrivatePath == "" {
				t.Fatal("signer did not prove real distinct-UID file isolation and O_RDONLY capability")
			}
			engine.send(t, checkpointUIDMessage{Command: "custody-denied", PrivatePath: ready.PrivatePath})
			if !engine.receive(t).DirectDenied {
				t.Fatal("engine gained direct access to signer-owned private material")
			}
			signer.send(t, checkpointUIDMessage{Command: "valid", Height: original.Height, Hash: original.Hash})
			if !signer.receive(t).Verified {
				t.Fatal("initial exact H/AppHash source rejected")
			}
			before := engine.query(t)
			signer.send(t, checkpointUIDMessage{Command: "negative-pins", Height: original.Height, Hash: original.Hash})
			if !signer.receive(t).Rejected || engine.query(t).Inventory != before.Inventory {
				t.Fatal("bad source coordinates/UID/path changed the original source")
			}
			// Read bytes, release the normal SH lock, then actually Commit another
			// block in the producer. Final current-original validation must refuse.
			signer.send(t, checkpointUIDMessage{Command: "capture"})
			if !signer.receive(t).Captured {
				t.Fatal("could not capture original descriptor")
			}
			engine.send(t, checkpointUIDMessage{Command: "commit"})
			advanced := engine.receive(t)
			signer.send(t, checkpointUIDMessage{Command: "reject-captured"})
			if !signer.receive(t).Rejected {
				t.Fatal("concurrent committed write authorized a stale captured inode")
			}
			signer.send(t, checkpointUIDMessage{Command: "valid", Height: advanced.Height, Hash: advanced.Hash})
			if !signer.receive(t).Verified {
				t.Fatal("fresh successor source failed after normal writer update")
			}
			signer.send(t, checkpointUIDMessage{Command: "stale", Height: original.Height, Hash: original.Hash})
			if !signer.receive(t).Rejected {
				t.Fatal("old cached checkpoint was reused for signing")
			}
			engine.send(t, checkpointUIDMessage{Command: "compact"})
			compacted := engine.receive(t)
			if compacted.Inode == advanced.Inode {
				t.Fatal("normal atomic/compaction path did not actually replace the original inode")
			}
			signer.send(t, checkpointUIDMessage{Command: "valid", Height: compacted.Height, Hash: compacted.Hash})
			if !signer.receive(t).Verified {
				t.Fatal("engine-owned replacement did not remain readable through a fresh capability")
			}
			if engine.query(t).Inventory != compacted.Inventory {
				t.Fatal("fresh read changed original source bytes")
			}
			if layout != "atomic-json" {
				engine.send(t, checkpointUIDMessage{Command: "lock"})
				_ = engine.receive(t)
				signer.send(t, checkpointUIDMessage{Command: "stale", Height: compacted.Height, Hash: compacted.Hash})
				if !signer.receive(t).Rejected {
					t.Fatal("actual writer exclusive read lock was ignored")
				}
				engine.send(t, checkpointUIDMessage{Command: "unlock"})
				_ = engine.receive(t)
			}
			engine.send(t, checkpointUIDMessage{Command: "corrupt"})
			corrupt := engine.receive(t)
			signer.send(t, checkpointUIDMessage{Command: "stale", Height: compacted.Height, Hash: compacted.Hash})
			if !signer.receive(t).Rejected || engine.query(t).Inventory != corrupt.Inventory {
				t.Fatal("corrupt/torn original was repaired or replaced by cached authority")
			}
			signer.finish(t)
			engine.finish(t)
			completed = append(completed, checkpointUIDLayoutResult{layout, true, true, true, true, true, layout != "atomic-json", true})
		})
	}
	if len(completed) != 3 || t.Failed() {
		t.Fatal("all three actual different-UID layouts must finish")
	}
	result := struct {
		Version     string                      `json:"version"`
		EngineUID   string                      `json:"engineUID"`
		SignerUID   string                      `json:"signerUID"`
		NodeStarted bool                        `json:"nodeStarted"`
		Layouts     []checkpointUIDLayoutResult `json:"layouts"`
	}{"YNX-PQ-CHECKPOINT-DUAL-UID/v1", strconv.FormatUint(uint64(engineUID), 10), strconv.FormatUint(uint64(signerUID), 10), false, completed}
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("PQ_CHECKPOINT_DUAL_UID_SOURCE_PASS %s", raw)
}

type checkpointUIDLayoutResult struct {
	Layout                  string `json:"layout"`
	DirectSourceDenied      bool   `json:"directSourceDenied"`
	EngineCustodyDenied     bool   `json:"engineCustodyDenied"`
	ReadonlyFD              bool   `json:"readonlyFD"`
	ExactCheckpoint         bool   `json:"exactCheckpoint"`
	ReplacementReadable     bool   `json:"replacementReadable"`
	OriginalReadLock        bool   `json:"originalReadLock"`
	StaleAndCorruptRejected bool   `json:"staleAndCorruptRejected"`
}

type checkpointUIDMessage struct {
	Role, Command, Layout, Path, Hash, ScheduleHash, Inventory, PrivatePath string
	Access                                                                  PQCheckpointAccess
	Migration, Genesis, Schedule                                            []byte
	Pins                                                                    ConsensusBootstrapPins
	Height                                                                  int64
	UID                                                                     uint32
	Inode                                                                   uint64
	DirectDenied, DescriptorReadOnly, Verified, Rejected, Captured          bool
}

type checkpointUIDProcess struct {
	command *exec.Cmd
	input   *os.File
	output  *os.File
	encode  *json.Encoder
	decode  *json.Decoder
	logs    bytes.Buffer
	waited  bool
}

func startCheckpointUIDHelper(t *testing.T, ctx context.Context, binary, base string, uid uint32, message checkpointUIDMessage) *checkpointUIDProcess {
	t.Helper()
	account, err := user.LookupId(strconv.FormatUint(uint64(uid), 10))
	if err != nil {
		t.Fatal("test requires pre-existing independent CI user", err)
	}
	gid, err := strconv.ParseUint(account.Gid, 10, 32)
	if err != nil {
		t.Fatal(err)
	}
	home, err := os.MkdirTemp(base, message.Role+"-")
	if err != nil || os.Chown(home, int(uid), int(gid)) != nil {
		t.Fatal("cannot create new private synthetic helper directory", err)
	}
	inReader, inWriter, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	outReader, outWriter, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	p := &checkpointUIDProcess{input: inWriter, output: outReader, encode: json.NewEncoder(inWriter), decode: json.NewDecoder(outReader)}
	p.command = exec.CommandContext(ctx, binary, "-test.run=^TestPQCheckpointAccessUIDHelper$", "-test.count=1", "-test.timeout=160s", "-test.v")
	p.command.Env = []string{"PATH=/usr/bin:/bin", "TMPDIR=" + home, "YNX_PQ_CHECKPOINT_UID_HELPER=internal-two-uid-helper-v1"}
	p.command.ExtraFiles = []*os.File{inReader, outWriter}
	p.command.SysProcAttr = &syscall.SysProcAttr{Credential: &syscall.Credential{Uid: uid, Gid: uint32(gid), Groups: []uint32{}}}
	p.command.Stdout, p.command.Stderr = &p.logs, &p.logs
	if err = p.command.Start(); err != nil {
		_ = inReader.Close()
		_ = inWriter.Close()
		_ = outReader.Close()
		_ = outWriter.Close()
		t.Fatal("could not start actual non-root source helper", err)
	}
	_ = inReader.Close()
	_ = outWriter.Close()
	t.Cleanup(func() { p.close(t) })
	p.send(t, message)
	return p
}

func (p *checkpointUIDProcess) send(t *testing.T, value checkpointUIDMessage) {
	t.Helper()
	if err := p.encode.Encode(value); err != nil {
		p.close(t)
		t.Fatal("helper control send failed", err, p.logs.String())
	}
}
func (p *checkpointUIDProcess) receive(t *testing.T) checkpointUIDMessage {
	t.Helper()
	var value checkpointUIDMessage
	if err := p.decode.Decode(&value); err != nil {
		p.close(t)
		t.Fatal("helper control read failed", err, p.logs.String())
	}
	return value
}
func (p *checkpointUIDProcess) query(t *testing.T) checkpointUIDMessage {
	p.send(t, checkpointUIDMessage{Command: "query"})
	return p.receive(t)
}
func (p *checkpointUIDProcess) finish(t *testing.T) {
	t.Helper()
	p.send(t, checkpointUIDMessage{Command: "finish"})
	_ = p.receive(t)
	if err := p.command.Wait(); err != nil {
		p.waited = true
		t.Fatal("real UID helper failed:", err, p.logs.String())
	}
	p.waited = true
}
func (p *checkpointUIDProcess) close(t *testing.T) {
	_ = p.input.Close()
	_ = p.output.Close()
	if !p.waited {
		_ = p.command.Process.Kill()
		_ = p.command.Wait()
		p.waited = true
	}
}

func TestPQCheckpointAccessUIDHelper(t *testing.T) {
	if os.Getenv("YNX_PQ_CHECKPOINT_UID_HELPER") != "internal-two-uid-helper-v1" {
		t.Skip("only the original two-UID coordinator may select this helper")
	}
	input, output := os.NewFile(3, "coordinator-input"), os.NewFile(4, "coordinator-output")
	if input == nil || output == nil || os.Geteuid() == 0 {
		t.Fatal("helper requires private inherited controls and an actual non-root UID")
	}
	defer input.Close()
	defer output.Close()
	d, e := json.NewDecoder(input), json.NewEncoder(output)
	var init checkpointUIDMessage
	if err := d.Decode(&init); err != nil || init.Access.Validate() != nil {
		t.Fatal("invalid original helper configuration", err)
	}
	if init.Role == "engine" {
		checkpointEngineUIDHelper(t, init, d, e)
	} else if init.Role == "signer" {
		checkpointSignerUIDHelper(t, init, d, e)
	} else {
		t.Fatal("unknown helper role")
	}
}

func checkpointEngineUIDHelper(t *testing.T, init checkpointUIDMessage, d *json.Decoder, e *json.Encoder) {
	if uint32(os.Geteuid()) != init.Access.EngineUID {
		t.Fatal("not actual engine UID")
	}
	r := newPQReadFixture(t, init.Layout)
	server, err := StartPQCheckpointAccess(r.path, init.Access)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	init.Path, init.UID, init.Genesis, init.Pins = r.path, uint32(os.Geteuid()), r.f.raw, r.f.pins
	init.Migration, err = r.f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	init.Schedule, err = json.Marshal(r.schedule)
	if err != nil {
		t.Fatal(err)
	}
	init.ScheduleHash, err = r.schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	reply := func(message checkpointUIDMessage) {
		message.Height, message.Hash, message.Layout = r.app.committed.Height, r.app.committed.AppHash, r.layout
		inventory := pqReadInventory(t, r.path)
		for name := range inventory {
			var stat unix.Stat_t
			if unix.Lstat(filepath.Join(filepath.Dir(r.path), name), &stat) != nil || stat.Uid != init.Access.EngineUID || stat.Mode&0777 != 0600 {
				t.Fatal("writer changed original 0600 engine ownership")
			}
		}
		raw, _ := json.Marshal(inventory)
		sum := sha256.Sum256(raw)
		message.Inventory = hex.EncodeToString(sum[:])
		var stat unix.Stat_t
		if unix.Lstat(r.path, &stat) != nil {
			t.Fatal("original path disappeared")
		}
		message.Inode = stat.Ino
		if err := e.Encode(message); err != nil {
			t.Fatal(err)
		}
	}
	reply(init)
	var held *os.File
	defer func() {
		if held != nil {
			unlockSnapshotJournal(held)
			_ = held.Close()
		}
	}()
	for {
		var request checkpointUIDMessage
		if err := d.Decode(&request); err != nil {
			t.Fatal(err)
		}
		switch request.Command {
		case "finish":
			reply(checkpointUIDMessage{})
			return
		case "query":
		case "custody-denied":
			_, err := os.ReadFile(request.PrivatePath)
			if !errors.Is(err, os.ErrPermission) {
				t.Fatal("engine could open signer private file", err)
			}
			request.DirectDenied = true
		case "commit":
			r.commit(t)
		case "compact":
			switch r.layout {
			case "snapshot-journal":
				r.app.journal.targetBytes = 1 // force original normal compaction path, no fake frame
				r.commit(t)
			case "block-journal":
				if err := r.app.blockJournal.replaceCheckpoint(r.app.committed, r.f.migration); err != nil {
					t.Fatal(err)
				}
			default:
				r.commit(t)
			}
		case "lock":
			held, err = journalRegularFile(r.path+".read.lock", os.O_RDWR)
			if err != nil || lockSnapshotJournal(held) != nil {
				t.Fatal("cannot acquire original writer read lock", err)
			}
		case "unlock":
			if held == nil {
				t.Fatal("missing held read lock")
			}
			unlockSnapshotJournal(held)
			_ = held.Close()
			held = nil
		case "corrupt":
			f, err := os.OpenFile(r.path, os.O_WRONLY|os.O_APPEND, 0)
			if err != nil {
				t.Fatal(err)
			}
			_, err = f.Write([]byte("{incomplete"))
			if err = errors.Join(err, f.Sync(), f.Close()); err != nil {
				t.Fatal(err)
			}
		default:
			t.Fatal("unknown engine control")
		}
		reply(request)
	}
}

func checkpointSignerUIDHelper(t *testing.T, init checkpointUIDMessage, d *json.Decoder, e *json.Encoder) {
	if uint32(os.Geteuid()) != init.Access.SignerUID {
		t.Fatal("not actual signer UID")
	}
	var migration chain.ConsensusMigrationState
	if err := json.Unmarshal(init.Migration, &migration); err != nil {
		t.Fatal(err)
	}
	bootstrap, err := NewConsensusBootstrap(init.Genesis, init.Pins, migration)
	if err != nil {
		t.Fatal(err)
	}
	auth, err := NewPQEngineAuthorization(init.Schedule, init.ScheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	// Normal construction is lazy: no engine listener is required for signer
	// custody recovery/READY. It must not read a previous copied checkpoint.
	absent := init.Access
	absent.Address += "-absent"
	if _, err := NewPQEngineCheckpointAccessSource(migration, init.Path, bootstrap, auth, nil, absent); err != nil {
		t.Fatal("lazy source startup unexpectedly contacted engine", err)
	}
	source, err := NewPQEngineCheckpointAccessSource(migration, init.Path, bootstrap, auth, nil, init.Access)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{init.Path, init.Path + ".read.lock"} {
		_, err := os.ReadFile(path)
		if !errors.Is(err, os.ErrPermission) {
			t.Fatal("signer directly opened engine-owned private source", err)
		}
	}
	privatePath := filepath.Join(os.Getenv("TMPDIR"), "custody-permission-sentinel")
	if err := os.WriteFile(privatePath, []byte("synthetic permission sentinel, not a real key"), 0600); err != nil {
		t.Fatal(err)
	}
	checkpointReadOnlyDescriptor(t, init)
	reply := func(m checkpointUIDMessage) {
		if err := e.Encode(m); err != nil {
			t.Fatal(err)
		}
	}
	reply(checkpointUIDMessage{UID: uint32(os.Geteuid()), DirectDenied: true, DescriptorReadOnly: true, PrivatePath: privatePath})
	var captured *pqEngineStateRead
	defer func() {
		if captured != nil {
			_ = captured.closeOriginal()
		}
	}()
	for {
		var request checkpointUIDMessage
		if err := d.Decode(&request); err != nil {
			t.Fatal(err)
		}
		hash, err := hex.DecodeString(request.Hash)
		if request.Hash != "" && err != nil {
			t.Fatal(err)
		}
		switch request.Command {
		case "finish":
			reply(checkpointUIDMessage{})
			return
		case "valid":
			got, err := source.ConsensusAuthorityForSigning(bootstrap.record.ChainID, request.Height, hash)
			if err != nil || got == nil {
				t.Fatal("fresh actual UID source rejected", err)
			}
			request.Verified = true
		case "stale":
			if _, err := source.ConsensusAuthorityForSigning(bootstrap.record.ChainID, request.Height, hash); err == nil {
				t.Fatal("stale/corrupt/locked source accepted")
			}
			request.Rejected = true
		case "negative-pins":
			wrongHash := bytes.Clone(hash)
			wrongHash[0] ^= 1
			for _, q := range []struct {
				chain string
				h     int64
				hash  []byte
			}{{"wrong-chain", request.Height, hash}, {bootstrap.record.ChainID, request.Height + 1, hash}, {bootstrap.record.ChainID, request.Height, wrongHash}} {
				if _, err := source.ConsensusAuthorityForSigning(q.chain, q.h, q.hash); err == nil {
					t.Fatal("incorrect independent coordinates accepted")
				}
			}
			wrongUID := init.Access
			wrongUID.EngineUID = 1
			for wrongUID.EngineUID == init.Access.EngineUID || wrongUID.EngineUID == init.Access.SignerUID {
				wrongUID.EngineUID++
			}
			if r, err := capturePQCheckpointAccess(init.Path, wrongUID); err == nil {
				_ = r.closeOriginal()
				t.Fatal("wrong actual engine UID accepted")
			}
			if r, err := capturePQCheckpointAccess(init.Path+"-retarget", init.Access); err == nil {
				_ = r.closeOriginal()
				t.Fatal("another source path accepted")
			}
			request.Rejected = true
		case "capture":
			captured, err = capturePQCheckpointAccess(init.Path, init.Access)
			if err != nil {
				t.Fatal(err)
			}
			request.Captured = true
		case "reject-captured":
			if captured == nil || captured.unchanged() == nil {
				t.Fatal("source changed during decode but old capture accepted")
			}
			_ = captured.closeOriginal()
			captured = nil
			request.Rejected = true
		default:
			t.Fatal("unknown signer control")
		}
		reply(request)
	}
}

func checkpointReadOnlyDescriptor(t *testing.T, init checkpointUIDMessage) {
	t.Helper()
	c, err := net.DialUnix("unixpacket", nil, &net.UnixAddr{Name: init.Access.Address, Net: "unixpacket"})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(time.Second))
	if err := checkpointPeer(c, init.Access.EngineUID); err != nil {
		t.Fatal(err)
	}
	_, _ = c.Write([]byte("capture"))
	data, control := make([]byte, 128), make([]byte, unix.CmsgSpace(4))
	_, count, flags, _, err := c.ReadMsgUnix(data, control)
	if err != nil || flags&(unix.MSG_CTRUNC|unix.MSG_TRUNC) != 0 {
		t.Fatal(err)
	}
	defer closeCheckpointRights(control[:count])
	messages, err := unix.ParseSocketControlMessage(control[:count])
	if err != nil || len(messages) != 1 {
		t.Fatal("missing original FD", err)
	}
	fds, err := unix.ParseUnixRights(&messages[0])
	if err != nil || len(fds) != 1 {
		t.Fatal("missing one original FD", err)
	}
	if _, err := unix.Write(fds[0], []byte("forbidden")); !errors.Is(err, unix.EBADF) {
		t.Fatal("received writable original checkpoint capability", err)
	}
	if fd, err := unix.Open(fmt.Sprintf("/proc/self/fd/%d", fds[0]), unix.O_RDWR, 0); err == nil {
		_ = unix.Close(fd)
		t.Fatal("read-only capability upgraded to writable original file")
	} else if !errors.Is(err, unix.EACCES) {
		t.Fatal("unexpected write-upgrade refusal", err)
	}
}

func TestPQCheckpointAccessConfigurationRemainsFailClosed(t *testing.T) {
	valid := PQCheckpointAccess{Address: "@ynx-pq-checkpoint-valid-test", EngineUID: 1001, SignerUID: 1002, Timeout: time.Second}
	if err := valid.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*PQCheckpointAccess){func(a *PQCheckpointAccess) { a.EngineUID = 0 }, func(a *PQCheckpointAccess) { a.SignerUID = a.EngineUID }, func(a *PQCheckpointAccess) { a.Address = "/tmp/checkpoint" }, func(a *PQCheckpointAccess) { a.Timeout = 0 }, func(a *PQCheckpointAccess) { a.Timeout = time.Minute + 1 }} {
		bad := valid
		change(&bad)
		if bad.Validate() == nil {
			t.Fatal("partial/unsafe access configuration accepted")
		}
	}
	if !reflect.DeepEqual(valid, PQCheckpointAccess{Address: "@ynx-pq-checkpoint-valid-test", EngineUID: 1001, SignerUID: 1002, Timeout: time.Second}) {
		t.Fatal("validation mutated independent configuration")
	}
}

type checkpointNotYetAvailable struct{ calls int }

func (s *checkpointNotYetAvailable) ConsensusAuthorityForSigning(string, int64, []byte) (cmttypes.ConsensusAuthority, error) {
	s.calls++
	return nil, errors.New("original engine has not started; no authority available")
}

func TestPQCheckpointSignerReadinessPrecedesAnySourceRead(t *testing.T) {
	_, config := remoteRuntimeConfigs(t)
	reservation, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := reservation.Addr().String()
	_ = reservation.Close()
	config.Address = "tcp://" + address
	source := &checkpointNotYetAvailable{}
	sentinel := errors.New("intentional readiness failure preserves no-session outcome")
	calls := 0
	err = ListenPQRemoteSignerReady(context.Background(), config, "test-chain", source, cmttypes.NewMockPV(), time.Second, func() error {
		calls++
		// The ORIGINAL normal TCP listener must already exist. No peer handshake
		// or signer action is attempted; source is deliberately unavailable.
		c, e := net.DialTimeout("tcp", address, time.Second)
		if e != nil {
			return fmt.Errorf("readiness emitted before listen: %w", e)
		}
		_ = c.Close()
		return sentinel
	})
	if !errors.Is(err, sentinel) || calls != 1 || source.calls != 0 {
		t.Fatal("startup queried unavailable source, retried or ignored readiness failure", err, calls, source.calls)
	}
	if c, e := net.DialTimeout("tcp", address, time.Second); e == nil {
		_ = c.Close()
		t.Fatal("readiness failure left listener active")
	}
}
