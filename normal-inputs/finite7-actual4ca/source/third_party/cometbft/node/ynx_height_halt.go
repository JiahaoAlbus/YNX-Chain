package node

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
	"sync"
	"syscall"
	"time"

	sm "github.com/cometbft/cometbft/state"
)

const MaxHeightHaltRequestBytes = 4096

// HeightHaltControl is supplied by the normal operator's independently pinned
// plan/session. A request file provides no root, signer or activation authority.
type HeightHaltControl struct {
	Path, ChainID, GenesisSHA256, OperatorPlanSHA256, SessionID string
}

// HeightHaltRequest has exactly six required string fields. The authorized
// local publisher must publish a complete fsynced file atomically without
// replacement (a private O_EXCL staging file, then RENAME_NOREPLACE and directory
// fsync). A partial or replaced request fails closed and is never removed.
type HeightHaltRequest struct {
	Version            string `json:"version"`
	TargetHeight       string `json:"targetHeight"`
	ChainID            string `json:"chainId"`
	GenesisSHA256      string `json:"genesisSHA256"`
	OperatorPlanSHA256 string `json:"operatorPlanSHA256"`
	SessionID          string `json:"sessionId"`
}

// HeightHaltResult describes a committed checkpoint, not completed shutdown.
// The caller must still finish normal Node.Stop, custody and writer-lease close
// and independently inspect the stopped stores. It must never auto-retry an
// unknown shutdown or discard an old control request on the next startup.
type HeightHaltResult struct {
	Version              string `json:"version"`
	TargetHeight         string `json:"targetHeight"`
	ChainID              string `json:"chainId"`
	GenesisSHA256        string `json:"genesisSHA256"`
	OperatorPlanSHA256   string `json:"operatorPlanSHA256"`
	SessionID            string `json:"sessionId"`
	ControlRequestSHA256 string `json:"controlRequestSHA256"`
	BlockHash            string `json:"blockHash"`
	AppHash              string `json:"appHash"`
	AppVersion           string `json:"appVersion"`
	CheckpointSaved      bool   `json:"checkpointSaved"`
	Stopped              bool   `json:"stopped"`
}

type heightHaltControl struct {
	config  HeightHaltControl
	parent  os.FileInfo
	barrier *sm.HeightHalt
	mu      sync.Mutex
	digest  string
	stop    chan struct{}
	wg      sync.WaitGroup
	once    sync.Once
}

// ConfigureHeightHalt must run once, before Node.Start. It does not create a
// file, start a watcher or open a network listener. Existing requests, including
// symlinks/partials/UNKNOWN, refuse startup. Snapshot state sync is incompatible
// with an exact local block-by-block stop boundary; block sync is supported.
func (n *Node) ConfigureHeightHalt(config HeightHaltControl) error {
	if n.IsRunning() || n.heightHalt != nil || n.stateSync || n.config.StateSync.Enable {
		return errors.New("height halt requires a fresh non-state-sync node before Start")
	}
	if config.ChainID != n.genesisDoc.ChainID {
		return errors.New("height halt chain differs from original genesis")
	}
	control, err := newHeightHaltControl(config)
	if err != nil {
		return err
	}
	// Hash the original file, not a reserialized genesis document. The normal
	// constructor has already authenticated the original bootstrap pins.
	genesisHash, err := heightHaltGenesisHash(n.config.GenesisFile())
	if err != nil {
		return fmt.Errorf("read original halt genesis: %w", err)
	}
	if genesisHash != config.GenesisSHA256 {
		return errors.New("height halt original genesis hash differs")
	}
	committed, err := n.stateStore.Load()
	if err != nil {
		return err
	}
	if committed.ChainID != config.ChainID || committed.LastBlockHeight != n.blockStore.Height() {
		return errors.New("height halt requires the actual matching application/state/block-store checkpoint")
	}
	control.barrier, err = sm.NewHeightHalt(committed)
	if err != nil {
		return err
	}
	bc, ok := n.bcReactor.(interface{ SetHeightHalt(*sm.HeightHalt) error })
	if !ok {
		return errors.New("block sync reactor does not support exact height halt")
	}
	if err := bc.SetHeightHalt(control.barrier); err != nil {
		return err
	}
	if err := n.consensusState.SetHeightHalt(control.barrier); err != nil {
		return err
	}
	n.heightHalt = control
	return nil
}

func (n *Node) HeightHaltDone() <-chan struct{} {
	if n.heightHalt == nil {
		return nil
	}
	return n.heightHalt.barrier.Done()
}

func (n *Node) HeightHaltResult() (HeightHaltResult, error) {
	if n.heightHalt == nil {
		return HeightHaltResult{}, errors.New("height halt was not configured")
	}
	h := n.heightHalt
	state, target, err := h.barrier.Result()
	if err != nil {
		return HeightHaltResult{}, err
	}
	h.mu.Lock()
	digest := h.digest
	h.mu.Unlock()
	if digest == "" {
		return HeightHaltResult{}, errors.New("height halt lacks its original request hash")
	}
	return HeightHaltResult{Version: "YNX-OPERATOR-HEIGHT-HALT-RESULT/v1", TargetHeight: strconv.FormatInt(target, 10),
		ChainID: state.ChainID, GenesisSHA256: h.config.GenesisSHA256, OperatorPlanSHA256: h.config.OperatorPlanSHA256,
		SessionID: h.config.SessionID, ControlRequestSHA256: digest, BlockHash: hex.EncodeToString(state.LastBlockID.Hash),
		AppHash: hex.EncodeToString(state.AppHash), AppVersion: strconv.FormatUint(state.Version.Consensus.App, 10),
		CheckpointSaved: true, Stopped: false}, nil
}

func newHeightHaltControl(config HeightHaltControl) (*heightHaltControl, error) {
	if !filepath.IsAbs(config.Path) || filepath.Clean(config.Path) != config.Path || config.ChainID == "" || len(config.ChainID) > 50 ||
		!heightHaltHash(config.GenesisSHA256) || !heightHaltHash(config.OperatorPlanSHA256) || !heightHaltHash(config.SessionID) {
		return nil, errors.New("height halt requires exact path, chain and independent genesis/plan/session pins")
	}
	parent := filepath.Dir(config.Path)
	resolved, err := filepath.EvalSymlinks(parent)
	if err != nil || resolved != parent {
		return nil, errors.New("height halt parent must be canonical and must not traverse symlinks")
	}
	info, err := os.Lstat(parent)
	if err != nil {
		return nil, err
	}
	if !heightHaltPrivate(info, true) {
		return nil, errors.New("height halt parent must be an owned private 0700 directory")
	}
	// A new process must not cross an unfinished or uncertain publication.
	// This check belongs only to startup: a running poll must allow the normal
	// publisher's transient private staging file before its atomic rename.
	for _, suffix := range []string{"", ".partial", ".UNKNOWN", ".tmp"} {
		if _, err := os.Lstat(config.Path + suffix); !errors.Is(err, os.ErrNotExist) {
			if err != nil {
				return nil, err
			}
			return nil, errors.New("height halt request or retained publication marker already exists; preserve it and use an independently approved new session/path")
		}
	}
	return &heightHaltControl{config: config, parent: info, stop: make(chan struct{})}, nil
}

func heightHaltHash(s string) bool {
	b, err := hex.DecodeString(s)
	return err == nil && len(b) == 32 && hex.EncodeToString(b) == s && !bytes.Equal(b, make([]byte, 32))
}

func heightHaltPrivate(info os.FileInfo, directory bool) bool {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || st.Uid != uint32(os.Geteuid()) || info.Mode()&(os.ModeSymlink|os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 {
		return false
	}
	if directory {
		return info.IsDir() && info.Mode().Perm() == 0700
	}
	return info.Mode().IsRegular() && info.Mode().Perm() == 0600 && st.Nlink == 1
}

func (h *heightHaltControl) poll() (bool, error) {
	resolved, err := filepath.EvalSymlinks(filepath.Dir(h.config.Path))
	if err != nil || resolved != filepath.Dir(h.config.Path) {
		return false, errors.New("height halt private parent path changed")
	}
	parent, err := os.Lstat(filepath.Dir(h.config.Path))
	if err != nil {
		return false, err
	}
	if !heightHaltPrivate(parent, true) || !os.SameFile(parent, h.parent) {
		return false, errors.New("height halt private parent changed")
	}
	before, err := os.Lstat(h.config.Path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !heightHaltPrivate(before, false) || before.Size() < 1 || before.Size() > MaxHeightHaltRequestBytes {
		return false, errors.New("height halt request is not a bounded owned 0600 regular single-link file")
	}
	f, err := os.OpenFile(h.config.Path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return false, err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(before, opened) {
		return false, errors.New("height halt request changed while opening")
	}
	raw, err := io.ReadAll(io.LimitReader(f, MaxHeightHaltRequestBytes+1))
	if err != nil {
		return false, err
	}
	after, err := f.Stat()
	if err != nil {
		return false, err
	}
	current, err := os.Lstat(h.config.Path)
	if err != nil {
		return false, err
	}
	if !sameHeightHaltFile(before, after) || !sameHeightHaltFile(after, current) || int64(len(raw)) != before.Size() {
		return false, errors.New("height halt request changed while reading")
	}
	height, err := ValidateHeightHaltRequest(raw, h.config)
	if err != nil {
		return false, err
	}
	digest := sha256.Sum256(raw)
	h.mu.Lock()
	h.digest = hex.EncodeToString(digest[:])
	h.mu.Unlock()
	if err := h.barrier.Arm(height); err != nil {
		return false, err
	}
	return true, nil
}

func sameHeightHaltFile(a, b os.FileInfo) bool {
	// Reading may update atime. Only identity, ownership, size, permissions,
	// modification time and change time belong to this immutability check.
	changeTime := func(info os.FileInfo) any {
		value := reflect.ValueOf(info.Sys()).Elem()
		for _, name := range []string{"Ctim", "Ctimespec"} {
			if field := value.FieldByName(name); field.IsValid() && field.CanInterface() {
				return field.Interface()
			}
		}
		return nil
	}
	ca, cb := changeTime(a), changeTime(b)
	sa, sb := a.Sys().(*syscall.Stat_t), b.Sys().(*syscall.Stat_t)
	return heightHaltPrivate(b, false) && os.SameFile(a, b) && a.Size() == b.Size() && a.Mode() == b.Mode() &&
		a.ModTime().Equal(b.ModTime()) && sa.Uid == sb.Uid && sa.Gid == sb.Gid && sa.Nlink == sb.Nlink &&
		ca != nil && cb != nil && reflect.DeepEqual(ca, cb)
}

func heightHaltGenesisHash(path string) (string, error) {
	before, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !before.Mode().IsRegular() || before.Size() < 1 || before.Size() > 64<<20 {
		return "", errors.New("original height halt genesis must be a bounded regular file")
	}
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return "", err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(before, opened) {
		return "", errors.New("original height halt genesis changed while opening")
	}
	digest := sha256.New()
	n, err := io.Copy(digest, io.LimitReader(f, (64<<20)+1))
	if err != nil {
		return "", err
	}
	after, err := f.Stat()
	if err != nil {
		return "", err
	}
	current, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if n != before.Size() || n > 64<<20 || !os.SameFile(before, after) || !os.SameFile(after, current) ||
		after.Size() != n || current.Size() != n || before.Mode() != after.Mode() || after.Mode() != current.Mode() ||
		!before.ModTime().Equal(after.ModTime()) || !after.ModTime().Equal(current.ModTime()) {
		return "", errors.New("original height halt genesis changed while hashing")
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

// ValidateHeightHaltRequest is shared by the normal publisher and consumer.
// It is pure: it does not read files, touch a node, decide whether the height is
// still in the future, or grant authority from the request's own fields.
func ValidateHeightHaltRequest(raw []byte, expected HeightHaltControl) (int64, error) {
	if expected.ChainID == "" || len(expected.ChainID) > 50 || !heightHaltHash(expected.GenesisSHA256) ||
		!heightHaltHash(expected.OperatorPlanSHA256) || !heightHaltHash(expected.SessionID) {
		return 0, errors.New("height halt request needs independent chain/genesis/plan/session pins")
	}
	if len(raw) == 0 || len(raw) > MaxHeightHaltRequestBytes {
		return 0, errors.New("height halt request size is invalid")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return 0, errors.New("height halt request must be a JSON object")
	}
	fields := make(map[string]string, 6)
	for d.More() {
		token, err = d.Token()
		key, ok := token.(string)
		if err != nil || !ok {
			return 0, errors.New("height halt request field is invalid")
		}
		switch key {
		case "version", "targetHeight", "chainId", "genesisSHA256", "operatorPlanSHA256", "sessionId":
		default:
			return 0, errors.New("height halt request contains an unknown field")
		}
		if _, exists := fields[key]; exists {
			return 0, errors.New("height halt request contains a duplicate field")
		}
		var value string
		if err := d.Decode(&value); err != nil || value == "" {
			return 0, errors.New("height halt request fields must be nonempty strings")
		}
		fields[key] = value
	}
	if _, err := d.Token(); err != nil {
		return 0, err
	}
	if _, err := d.Token(); !errors.Is(err, io.EOF) || len(fields) != 6 {
		return 0, errors.New("height halt request has missing fields or trailing data")
	}
	if fields["version"] != "YNX-OPERATOR-HEIGHT-HALT/v1" || fields["chainId"] != expected.ChainID ||
		fields["genesisSHA256"] != expected.GenesisSHA256 || fields["operatorPlanSHA256"] != expected.OperatorPlanSHA256 || fields["sessionId"] != expected.SessionID {
		return 0, errors.New("height halt request differs from the independently configured chain/genesis/plan/session")
	}
	height, err := strconv.ParseInt(fields["targetHeight"], 10, 64)
	if err != nil || height < 1 || strconv.FormatInt(height, 10) != fields["targetHeight"] {
		return 0, errors.New("height halt target must be a canonical positive decimal height")
	}
	return height, nil
}

func (h *heightHaltControl) start() {
	if h == nil {
		return
	}
	h.wg.Add(1)
	go func() {
		defer h.wg.Done()
		timer := time.NewTicker(100 * time.Millisecond)
		defer timer.Stop()
		for {
			armed, err := h.poll()
			if err != nil {
				h.barrier.Fail(fmt.Errorf("height halt control refused: %w", err))
				return
			}
			if armed {
				return
			}
			select {
			case <-h.stop:
				return
			case <-h.barrier.Done():
				return
			case <-timer.C:
			}
		}
	}()
}

func (h *heightHaltControl) close() {
	if h != nil {
		h.once.Do(func() { close(h.stop) })
		h.wg.Wait()
	}
}
