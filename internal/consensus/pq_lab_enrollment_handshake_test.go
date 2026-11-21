//go:build unix

package consensus

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// These frames are private synthetic coordination, not an authorization or
// independently authenticated proof of the peer's durable transaction.
type enrollmentReserveReady struct {
	Version        string `json:"version"`
	SourceCommit   string `json:"sourceCommit"`
	Root           string `json:"root"`
	PlanPath       string `json:"planPath"`
	PlanSHA256     string `json:"planSHA256"`
	WorkloadPath   string `json:"workloadPath"`
	WorkloadSHA256 string `json:"workloadSHA256"`
	OwnerIndex     int    `json:"ownerIndex"`
	OwnerAddress   string `json:"ownerAddress"`
	NextNonce      string `json:"nextNonce"`
}

type enrollmentReserveInit struct {
	Version            string `json:"version"`
	SourceCommit       string `json:"sourceCommit"`
	Index              int    `json:"index"`
	FundingOperationID string `json:"fundingOperationId"`
	OwnerIndex         int    `json:"ownerIndex"`
	FundingNonce       string `json:"fundingNonce"`
}

type enrollmentReserveRequest struct {
	Version        string                 `json:"version"`
	SourceCommit   string                 `json:"sourceCommit"`
	Index          int                    `json:"index"`
	PlanSHA256     string                 `json:"planSHA256"`
	WorkloadSHA256 string                 `json:"workloadSHA256"`
	RequestSHA256  string                 `json:"requestSHA256"`
	Request        PQLabEnrollmentRequest `json:"request"`
}

type enrollmentReserveAck struct {
	Version              string `json:"version"`
	Status               string `json:"status"`
	SourceCommit         string `json:"sourceCommit"`
	Index                int    `json:"index"`
	RequestSHA256        string `json:"requestSHA256"`
	FundingOperationID   string `json:"fundingOperationId"`
	MigrationOperationID string `json:"migrationOperationId"`
	OwnerIndex           int    `json:"ownerIndex"`
	FundingNonce         string `json:"fundingNonce"`
	SigningAuthorized    bool   `json:"signingAuthorized"`
	NonceReleased        bool   `json:"nonceReleased"`
	AutomaticRetry       bool   `json:"automaticRetry"`
}

func enrollmentReserveID(value string) bool {
	raw, err := hex.DecodeString(value)
	return err == nil && len(raw) == 32 && value == hex.EncodeToString(raw) && !bytes.Equal(raw, make([]byte, 32))
}

func enrollmentReserveRead(r *bufio.Reader, value any) error {
	line, err := r.ReadSlice('\n')
	if err != nil || len(line) < 2 || len(line) > 32<<10 {
		return errors.New("bounded complete original reservation frame required")
	}
	line = line[:len(line)-1]
	decoder := json.NewDecoder(bytes.NewReader(line))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(value); err != nil {
		return err
	}
	canonical, err := json.Marshal(value)
	if err != nil || !bytes.Equal(canonical, line) {
		return errors.New("exact canonical original reservation frame required")
	}
	return nil
}

func enrollmentReserveWrite(w io.Writer, value any) error {
	raw, err := json.Marshal(value)
	if err != nil || len(raw) > 32<<10-1 {
		return errors.New("bounded original reservation frame required")
	}
	raw = append(raw, '\n')
	n, err := w.Write(raw)
	if err == nil && n != len(raw) {
		err = io.ErrShortWrite
	}
	return err
}

func enrollmentReserveSocket(fdValue string) (net.Conn, error) {
	fd, err := strconv.Atoi(fdValue)
	if err != nil || fd < 3 || fd > 4096 || strconv.Itoa(fd) != fdValue {
		return nil, errors.New("original inherited reservation socket fd required")
	}
	kind, err := unix.GetsockoptInt(fd, unix.SOL_SOCKET, unix.SO_TYPE)
	if err != nil || kind != unix.SOCK_STREAM {
		return nil, errors.New("original connected Unix stream socket required")
	}
	f := os.NewFile(uintptr(fd), "synthetic-reservation-peer")
	if f == nil {
		return nil, errors.New("missing inherited reservation socket")
	}
	conn, err := net.FileConn(f)
	closeErr := f.Close()
	if err != nil || closeErr != nil {
		if conn != nil {
			_ = conn.Close()
		}
		return nil, errors.Join(err, closeErr)
	}
	if _, ok := conn.(*net.UnixConn); !ok {
		_ = conn.Close()
		return nil, errors.New("original Unix socketpair required")
	}
	if err = conn.SetDeadline(time.Now().Add(90 * time.Second)); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return conn, nil
}

// The only allowed secret descriptor names the generated original synthetic
// workload credential, never a caller-provided replacement key.
func enrollmentSyntheticCredential(fdValue, path string) ([]byte, *os.File, error) {
	fd, err := strconv.Atoi(fdValue)
	if err != nil || fd < 3 || fd > 4096 || strconv.Itoa(fd) != fdValue || fdValue == os.Getenv("YNX_PQ_ENROLLMENT_RESERVATION_FD") {
		return nil, nil, errors.New("distinct inherited original credential fd required")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved != path {
		return nil, nil, errors.New("original synthetic credential path unavailable")
	}
	dup, err := unix.Dup(fd)
	if err != nil {
		return nil, nil, err
	}
	unix.CloseOnExec(dup)
	f := os.NewFile(uintptr(dup), "original-synthetic-credential")
	info, e := f.Stat()
	original, e2 := os.Lstat(path)
	var st unix.Stat_t
	if e != nil || e2 != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() != 32 || !os.SameFile(info, original) || unix.Fstat(dup, &st) != nil || st.Nlink != 1 || st.Uid != uint32(os.Getuid()) {
		_ = f.Close()
		return nil, nil, errors.New("exact original private synthetic credential required")
	}
	raw := make([]byte, 32)
	if n, e := f.ReadAt(raw, 0); e != nil || n != 32 {
		clear(raw)
		_ = f.Close()
		return nil, nil, errors.New("original synthetic credential read failed")
	}
	return raw, f, nil
}

// Called before SignPQLabEnrollmentOriginals; all bytes, IDs and nonce bind to
// the same connection. A disconnected/invalid peer is terminal for this
// attempt. It may not be reconnected, reconstructed from SQLite, or retried.
func enrollmentReserveBeforeSign(conn net.Conn, ready enrollmentReserveReady, request *PQLabEnrollmentRequest, retained *enrollmentReserveAck) error {
	if conn == nil || request == nil || retained == nil || ready.Version != "YNX-PQ-ENROLLMENT-RESERVE-READY/v1" || ready.Root == "" || ready.PlanPath == "" || ready.WorkloadPath == "" || ready.OwnerAddress == "" || !enrollmentReserveID(ready.PlanSHA256) || !enrollmentReserveID(ready.WorkloadSHA256) || ready.OwnerIndex != 4 || ready.NextNonce != "2" || request.OwnerIndex != 4 || request.FundingNonce != 2 || ready.SourceCommit == "" {
		return errors.New("fixed original synthetic owner required")
	}
	reader := bufio.NewReaderSize(conn, 32<<10)
	if err := enrollmentReserveWrite(conn, ready); err != nil {
		return err
	}
	var init enrollmentReserveInit
	if err := enrollmentReserveRead(reader, &init); err != nil {
		return err
	}
	if init.Version != "YNX-PQ-ENROLLMENT-RESERVE-INIT/v1" || init.SourceCommit != ready.SourceCommit || init.Index < 0 || init.OwnerIndex != ready.OwnerIndex || init.FundingNonce != ready.NextNonce || !enrollmentReserveID(init.FundingOperationID) {
		return errors.New("original sponsor reservation INIT differs")
	}
	request.FundingOperationID = init.FundingOperationID
	var migration [32]byte
	if _, err := rand.Read(migration[:]); err != nil {
		return err
	}
	request.MigrationOperationID = hex.EncodeToString(migration[:])
	if !enrollmentReserveID(request.MigrationOperationID) || request.MigrationOperationID == request.FundingOperationID {
		return errors.New("independent migration identity unavailable")
	}
	raw, err := json.Marshal(request)
	if err != nil {
		return err
	}
	pin := pqLabSHA(raw)
	frame := enrollmentReserveRequest{Version: "YNX-PQ-ENROLLMENT-RESERVE-REQUEST/v1", SourceCommit: ready.SourceCommit, Index: init.Index, PlanSHA256: ready.PlanSHA256, WorkloadSHA256: ready.WorkloadSHA256, RequestSHA256: pin, Request: *request}
	if err = enrollmentReserveWrite(conn, frame); err != nil {
		return err
	}
	var ack enrollmentReserveAck
	if err = enrollmentReserveRead(reader, &ack); err != nil {
		return err
	}
	if ack.Version != "YNX-PQ-ENROLLMENT-RESERVE-ACK/v1" || ack.Status != "LOCAL_RESERVATION_RETAINED" || ack.SourceCommit != ready.SourceCommit || ack.Index != init.Index || ack.RequestSHA256 != pin || ack.FundingOperationID != request.FundingOperationID || ack.MigrationOperationID != request.MigrationOperationID || ack.OwnerIndex != request.OwnerIndex || ack.FundingNonce != strconv.FormatUint(request.FundingNonce, 10) || ack.SigningAuthorized || ack.NonceReleased || ack.AutomaticRetry {
		return errors.New("original durable reservation ACK differs")
	}
	*retained = ack
	return nil
}

func TestSyntheticEnrollmentReservationFrameRefusals(t *testing.T) {
	for _, mode := range []string{"accept", "wrong-request", "wrong-source", "grant", "truncated", "lost-ack", "duplicate-field"} {
		t.Run(mode, func(t *testing.T) {
			client, peer := net.Pipe()
			defer client.Close()
			commit := strings.Repeat("1", 40)
			ready := enrollmentReserveReady{Version: "YNX-PQ-ENROLLMENT-RESERVE-READY/v1", SourceCommit: commit, Root: "/synthetic", PlanPath: "/synthetic/network-plan.json", PlanSHA256: strings.Repeat("2", 64), WorkloadPath: "/synthetic/workload/PUBLIC-WORKLOAD.json", WorkloadSHA256: strings.Repeat("3", 64), OwnerIndex: 4, OwnerAddress: "synthetic-owner", NextNonce: "2"}
			request := PQLabEnrollmentRequest{Version: "YNX-PQ-LAB-ENROLLMENT-REQUEST/v1", OwnerIndex: 4, FundingNonce: 2}
			peerResult := make(chan error, 1)
			go func() {
				defer peer.Close()
				r := bufio.NewReaderSize(peer, 32<<10)
				var got enrollmentReserveReady
				if err := enrollmentReserveRead(r, &got); err != nil {
					peerResult <- err
					return
				}
				init := enrollmentReserveInit{Version: "YNX-PQ-ENROLLMENT-RESERVE-INIT/v1", SourceCommit: commit, Index: 0, FundingOperationID: strings.Repeat("4", 64), OwnerIndex: 4, FundingNonce: "2"}
				if err := enrollmentReserveWrite(peer, init); err != nil {
					peerResult <- err
					return
				}
				var wanted enrollmentReserveRequest
				if err := enrollmentReserveRead(r, &wanted); err != nil {
					peerResult <- err
					return
				}
				ack := enrollmentReserveAck{Version: "YNX-PQ-ENROLLMENT-RESERVE-ACK/v1", Status: "LOCAL_RESERVATION_RETAINED", SourceCommit: commit, Index: 0, RequestSHA256: wanted.RequestSHA256, FundingOperationID: wanted.Request.FundingOperationID, MigrationOperationID: wanted.Request.MigrationOperationID, OwnerIndex: 4, FundingNonce: "2"}
				switch mode {
				case "wrong-request":
					ack.RequestSHA256 = strings.Repeat("5", 64)
				case "wrong-source":
					ack.SourceCommit = strings.Repeat("6", 40)
				case "grant":
					ack.SigningAuthorized = true
				case "lost-ack":
					peerResult <- nil
					return
				case "truncated":
					_, err := io.WriteString(peer, "{\"version\":")
					peerResult <- err
					return
				case "duplicate-field":
					_, err := io.WriteString(peer, "{\"version\":\"x\",\"version\":\"x\"}\n")
					peerResult <- err
					return
				}
				peerResult <- enrollmentReserveWrite(peer, ack)
			}()
			var ack enrollmentReserveAck
			err := enrollmentReserveBeforeSign(client, ready, &request, &ack)
			if (err == nil) != (mode == "accept") {
				t.Fatalf("unexpected synthetic ACK result: %v", err)
			}
			if e := <-peerResult; e != nil {
				t.Fatal(e)
			}
			if mode == "accept" && (request.FundingOperationID != strings.Repeat("4", 64) || !enrollmentReserveID(request.MigrationOperationID) || request.FundingOperationID == request.MigrationOperationID) {
				t.Fatal("original reservation IDs differ")
			}
		})
	}
}
