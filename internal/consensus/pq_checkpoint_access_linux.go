//go:build linux

package consensus

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/sys/unix"
)

const checkpointAccessVersion = "YNX-PQ-CHECKPOINT-FD/v1\n"

// The broker opens only its fixed original App and existing read lock. It does
// not decode a request path, create a file, change ownership or return authority.
// A signer receives only O_RDONLY, never the lock FD or a writable descriptor.
type PQCheckpointAccessServer struct {
	mu       sync.Mutex
	listener *net.UnixListener
	active   *net.UnixConn
	done     chan struct{}
	closed   bool
	path     string
	parent   os.FileInfo
	access   PQCheckpointAccess
}

func checkpointAccessClientIdentity(a PQCheckpointAccess) error {
	if uint32(os.Geteuid()) != a.SignerUID {
		return errors.New("checkpoint reader UID differs from independent signer UID pin")
	}
	return nil
}

func checkpointPeer(c *net.UnixConn, uid uint32) error {
	raw, err := c.SyscallConn()
	if err != nil {
		return err
	}
	var credential *unix.Ucred
	var inner error
	err = raw.Control(func(fd uintptr) { credential, inner = unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED) })
	if err != nil || inner != nil || credential == nil || credential.Pid <= 0 || credential.Uid != uid {
		return errors.New("checkpoint transport peer differs from independently pinned UID")
	}
	return nil
}

func checkpointFileInfo(info os.FileInfo) error {
	if info == nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 {
		return errors.New("original checkpoint descriptor must remain regular private 0600")
	}
	return nil
}

func checkpointFile(path string, uid uint32) (*os.File, unix.Stat_t, error) {
	var stat unix.Stat_t
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, stat, err
	}
	f := os.NewFile(uintptr(fd), path)
	info, infoErr := f.Stat()
	err = unix.Fstat(fd, &stat)
	if err != nil || infoErr != nil || checkpointFileInfo(info) != nil || stat.Uid != uid || stat.Nlink != 1 {
		_ = f.Close()
		return nil, stat, errors.New("original checkpoint requires engine-owned 0600 single-link regular file")
	}
	return f, stat, nil
}

func sameCheckpointStat(a, b unix.Stat_t) bool {
	return a.Dev == b.Dev && a.Ino == b.Ino && a.Mode == b.Mode && a.Uid == b.Uid && a.Gid == b.Gid && a.Nlink == b.Nlink && a.Size == b.Size && a.Mtim == b.Mtim && a.Ctim == b.Ctim
}

func StartPQCheckpointAccess(path string, access PQCheckpointAccess) (*PQCheckpointAccessServer, error) {
	if err := access.Validate(); err != nil {
		return nil, err
	}
	if err := checkpointAccessPath(path); err != nil {
		return nil, err
	}
	if uint32(os.Geteuid()) != access.EngineUID {
		return nil, errors.New("checkpoint producer must run as independently pinned engine UID")
	}
	parent, err := os.Lstat(filepath.Dir(path))
	canonical, resolveErr := filepath.EvalSymlinks(filepath.Dir(path))
	var parentStat unix.Stat_t
	statErr := unix.Lstat(filepath.Dir(path), &parentStat)
	if err != nil || resolveErr != nil || canonical != filepath.Dir(path) || statErr != nil || !parent.IsDir() || parent.Mode().Perm() != 0700 || parent.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 || parentStat.Uid != access.EngineUID {
		return nil, errors.New("checkpoint producer requires original engine-owned canonical private 0700 parent")
	}
	f, _, err := checkpointFile(path, access.EngineUID)
	if err != nil {
		return nil, err
	}
	if err = f.Close(); err != nil {
		return nil, err
	}
	l, err := net.ListenUnix("unixpacket", &net.UnixAddr{Name: access.Address, Net: "unixpacket"})
	if err != nil {
		return nil, err
	}
	s := &PQCheckpointAccessServer{listener: l, done: make(chan struct{}), path: path, parent: parent, access: access}
	go s.serve()
	return s, nil
}

func (s *PQCheckpointAccessServer) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	if !s.closed {
		s.closed = true
		_ = s.listener.Close()
		if s.active != nil {
			_ = s.active.Close()
		}
	}
	s.mu.Unlock()
	<-s.done
	return nil
}

func (s *PQCheckpointAccessServer) serve() {
	defer close(s.done)
	for {
		c, err := s.listener.AcceptUnix()
		if err != nil {
			return
		}
		s.mu.Lock()
		if s.closed {
			s.mu.Unlock()
			_ = c.Close()
			return
		}
		s.active = c
		s.mu.Unlock()
		// Single active capture. Every request has a fixed deadline and no retry.
		_ = c.SetDeadline(time.Now().Add(s.access.Timeout))
		if checkpointPeer(c, s.access.SignerUID) == nil {
			_ = s.capture(c)
		}
		_ = c.Close()
		s.mu.Lock()
		s.active = nil
		s.mu.Unlock()
	}
}

func checkpointPacket(c *net.UnixConn, want string) error {
	data, oob := make([]byte, 128), make([]byte, unix.CmsgSpace(4))
	n, oobn, flags, _, err := c.ReadMsgUnix(data, oob)
	if oobn != 0 {
		closeCheckpointRights(oob[:oobn])
	}
	if err != nil || flags&(unix.MSG_TRUNC|unix.MSG_CTRUNC) != 0 || oobn != 0 || string(data[:n]) != want {
		return errors.New("invalid bounded checkpoint capability packet")
	}
	return nil
}

func closeCheckpointRights(oob []byte) {
	messages, _ := unix.ParseSocketControlMessage(oob)
	for _, message := range messages {
		fds, _ := unix.ParseUnixRights(&message)
		for _, fd := range fds {
			_ = unix.Close(fd)
		}
	}
}

func (s *PQCheckpointAccessServer) capture(c *net.UnixConn) error {
	if err := checkpointPacket(c, "capture"); err != nil {
		return err
	}
	parent, err := os.Lstat(filepath.Dir(s.path))
	if err != nil || !os.SameFile(parent, s.parent) || parent.Mode() != s.parent.Mode() {
		return errors.New("original checkpoint directory changed")
	}
	probe, _, err := checkpointFile(s.path, s.access.EngineUID)
	if err != nil {
		return err
	}
	prefix := make([]byte, len(snapshotJournalMagic)+len(blockJournalMagic))
	n, readErr := probe.Read(prefix)
	err = probe.Close()
	if readErr != nil && readErr != io.EOF {
		return readErr
	}
	if err != nil {
		return err
	}
	layout := pqStateLayout(prefix[:n])
	var lock *os.File
	var lockStat unix.Stat_t
	if layout != "atomic-json" {
		lock, lockStat, err = checkpointFile(s.path+".read.lock", s.access.EngineUID)
		if err != nil {
			return err
		}
		defer lock.Close()
		if err = lockSnapshotJournalReader(lock); err != nil {
			return err
		}
		defer unlockSnapshotJournal(lock)
	}
	f, original, err := checkpointFile(s.path, s.access.EngineUID)
	if err != nil {
		return err
	}
	defer f.Close()
	n, readErr = f.ReadAt(prefix, 0)
	if (readErr != nil && readErr != io.EOF) || pqStateLayout(prefix[:n]) != layout {
		return errors.New("checkpoint format changed before descriptor capture")
	}
	check := func() error {
		current, e := os.Lstat(filepath.Dir(s.path))
		var parentStat unix.Stat_t
		if e != nil || !os.SameFile(current, s.parent) || current.Mode() != s.parent.Mode() || unix.Lstat(filepath.Dir(s.path), &parentStat) != nil || parentStat.Uid != s.access.EngineUID {
			return errors.New("original checkpoint directory changed")
		}
		var pathStat, heldStat unix.Stat_t
		if unix.Lstat(s.path, &pathStat) != nil || unix.Fstat(int(f.Fd()), &heldStat) != nil || !sameCheckpointStat(original, pathStat) || !sameCheckpointStat(original, heldStat) {
			return errors.New("original checkpoint changed; no stale capability fallback")
		}
		if lock != nil {
			var now unix.Stat_t
			if unix.Lstat(s.path+".read.lock", &now) != nil || !sameCheckpointStat(lockStat, now) {
				return errors.New("original checkpoint read lock changed")
			}
		}
		return nil
	}
	pathHash := sha256.Sum256([]byte(s.path))
	packet := append([]byte(checkpointAccessVersion), pathHash[:]...)
	if n, _, err = c.WriteMsgUnix(packet, unix.UnixRights(int(f.Fd())), nil); err != nil || n != len(packet) {
		return errors.New("checkpoint descriptor transfer incomplete")
	}
	if err = checkpointPacket(c, "read-complete"); err != nil {
		return err
	}
	if err = check(); err != nil {
		return err
	}
	if lock != nil {
		unlockSnapshotJournal(lock)
	}
	if _, err = c.Write([]byte("read-released")); err != nil {
		return err
	}
	// Do not block journal writes during full decode/PQ verification. Reacquire
	// the SAME existing lock and recheck the original inode before acceptance.
	if err = checkpointPacket(c, "verify-original"); err != nil {
		return err
	}
	if lock != nil {
		if err = lockSnapshotJournalReader(lock); err != nil {
			return err
		}
	}
	if err = check(); err != nil {
		return err
	}
	_, err = c.Write([]byte("original-unchanged"))
	return err
}

func capturePQCheckpointAccess(path string, access PQCheckpointAccess) (_ *pqEngineStateRead, result error) {
	if err := access.Validate(); err != nil {
		return nil, err
	}
	if err := checkpointAccessClientIdentity(access); err != nil {
		return nil, err
	}
	connection, err := (&net.Dialer{Timeout: access.Timeout}).Dial("unixpacket", access.Address)
	if err != nil {
		return nil, err
	}
	c, ok := connection.(*net.UnixConn)
	if !ok {
		_ = connection.Close()
		return nil, errors.New("unexpected checkpoint capability transport")
	}
	var f *os.File
	success := false
	defer func() {
		if !success {
			_ = c.Close()
			if f != nil {
				_ = f.Close()
			}
		}
	}()
	if err = c.SetDeadline(time.Now().Add(access.Timeout)); err != nil {
		return nil, err
	}
	if err = checkpointPeer(c, access.EngineUID); err != nil {
		return nil, err
	}
	if _, err = c.Write([]byte("capture")); err != nil {
		return nil, err
	}
	packet, oob := make([]byte, 128), make([]byte, unix.CmsgSpace(4))
	n, oobn, flags, _, err := c.ReadMsgUnix(packet, oob)
	pathHash := sha256.Sum256([]byte(path))
	want := append([]byte(checkpointAccessVersion), pathHash[:]...)
	if err != nil || flags&(unix.MSG_TRUNC|unix.MSG_CTRUNC) != 0 || !bytes.Equal(packet[:n], want) {
		closeCheckpointRights(oob[:oobn])
		return nil, errors.New("invalid checkpoint descriptor response or original path mismatch")
	}
	messages, err := unix.ParseSocketControlMessage(oob[:oobn])
	if err != nil || len(messages) != 1 {
		closeCheckpointRights(oob[:oobn])
		return nil, errors.New("checkpoint response requires exactly one read-only descriptor")
	}
	fds, err := unix.ParseUnixRights(&messages[0])
	if err != nil || len(fds) != 1 {
		closeCheckpointRights(oob[:oobn])
		return nil, errors.New("checkpoint response requires one original descriptor")
	}
	unix.CloseOnExec(fds[0])
	f = os.NewFile(uintptr(fds[0]), "original-committed-checkpoint")
	status, err := unix.FcntlInt(f.Fd(), unix.F_GETFL, 0)
	var stat unix.Stat_t
	if err != nil || status&unix.O_ACCMODE != unix.O_RDONLY || unix.Fstat(int(f.Fd()), &stat) != nil || stat.Uid != access.EngineUID || stat.Nlink != 1 {
		return nil, errors.New("checkpoint capability is not engine-owned read-only original")
	}
	info, err := f.Stat()
	if err != nil || checkpointFileInfo(info) != nil || info.Size() <= 0 {
		return nil, errors.New("checkpoint capability is not an unchanged private regular file")
	}
	prefix := make([]byte, len(snapshotJournalMagic)+len(blockJournalMagic))
	n, err = f.ReadAt(prefix, 0)
	if err != nil && err != io.EOF {
		return nil, err
	}
	layout := pqStateLayout(prefix[:n])
	var capacity int64
	switch layout {
	case "snapshot-journal":
		capacity = int64(len(snapshotJournalMagic) + 65 + (snapshotJournalHeader+snapshotJournalMaxPayload)*snapshotJournalCompactRecords)
	case "block-journal":
		capacity = int64(len(blockJournalMagic) + 65 + blockJournalMaxFrame + blockJournalCheckpointBlocks*(2*blockJournalMaxRequest+snapshotJournalHeader))
	}
	if capacity != 0 && info.Size() > capacity {
		return nil, errors.New("original journal capacity exceeded")
	}
	data, err := io.ReadAll(io.LimitReader(f, info.Size()+1))
	var after unix.Stat_t
	if err != nil || int64(len(data)) != info.Size() || unix.Fstat(int(f.Fd()), &after) != nil || !sameCheckpointStat(stat, after) || pqStateLayout(data) != layout {
		return nil, errors.New("original checkpoint changed during descriptor read")
	}
	if _, err = c.Write([]byte("read-complete")); err != nil {
		return nil, err
	}
	if err = checkpointPacket(c, "read-released"); err != nil {
		return nil, err
	}
	checked := false
	r := &pqEngineStateRead{path: path, info: info, layout: layout, data: data}
	r.checkOriginal = func() error {
		if checked {
			return errors.New("checkpoint capability cannot be replayed")
		}
		checked = true
		if _, err := c.Write([]byte("verify-original")); err != nil {
			return err
		}
		if err := checkpointPacket(c, "original-unchanged"); err != nil {
			return fmt.Errorf("fresh original checkpoint unavailable: %w", err)
		}
		return nil
	}
	r.closeOriginal = func() error { return errors.Join(f.Close(), c.Close()) }
	success = true
	return r, nil
}
