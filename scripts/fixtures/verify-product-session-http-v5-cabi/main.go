// Normal native-CI synthetic fixture and independent public AND verifier.
// Private DER exists only in this fresh CI directory until the shell EXIT
// cleanup. No real device/Wallet, Source, current, approval or HTTP is used.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"

	batch "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	fixtureOwner = "0x1111111111111111111111111111111111111111"
	// The C driver makes these exact fifty real export calls, including one
	// successful signature. This is not a minimum/zero-hit admission check.
	fixtureBoundaryCases = 50
)

func privateDirectory(path string) error {
	s, err := os.Lstat(path)
	if err != nil {
		return err
	}
	u, ok := s.Sys().(*syscall.Stat_t)
	if !s.IsDir() || s.Mode().Perm() != 0700 || !ok || uint64(u.Uid) != uint64(os.Geteuid()) {
		return errors.New("private original synthetic fixture directory required")
	}
	return nil
}

func writeExclusive(path string, raw []byte) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	n, writeErr := f.Write(raw)
	if writeErr == nil && n != len(raw) {
		writeErr = io.ErrShortWrite
	}
	return errors.Join(writeErr, f.Sync(), f.Close())
}

func sameFile(a, b os.FileInfo) bool {
	ax, aok := a.Sys().(*syscall.Stat_t)
	bx, bok := b.Sys().(*syscall.Stat_t)
	return aok && bok && os.SameFile(a, b) && a.Size() == b.Size() && a.Mode() == b.Mode() && a.ModTime().Equal(b.ModTime()) &&
		ax.Uid == bx.Uid && ax.Gid == bx.Gid && ax.Nlink == bx.Nlink
}

func readBounded(directory, name string, maximum int) ([]byte, error) {
	if err := privateDirectory(directory); err != nil {
		return nil, err
	}
	path := filepath.Join(directory, name)
	before, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	metadata, ok := before.Sys().(*syscall.Stat_t)
	if !ok || !before.Mode().IsRegular() || before.Mode().Perm() != 0600 || metadata.Nlink != 1 ||
		uint64(metadata.Uid) != uint64(os.Geteuid()) || before.Size() < 1 || before.Size() > int64(maximum) {
		return nil, errors.New("bounded owned single-link synthetic/public file required")
	}
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), path)
	defer f.Close()
	held, err := f.Stat()
	if err != nil || !sameFile(before, held) {
		return nil, errors.New("fixture file changed before read")
	}
	raw, err := io.ReadAll(io.LimitReader(f, int64(maximum)+1))
	if err != nil {
		return nil, err
	}
	heldAfter, heldErr := f.Stat()
	after, pathErr := os.Lstat(path)
	if heldErr != nil || pathErr != nil || !sameFile(before, heldAfter) || !sameFile(before, after) || len(raw) != int(before.Size()) {
		return nil, errors.New("fixture file changed during read")
	}
	return raw, nil
}

const goldenSHA = "caaf17f69d655d4cc2167767fc3130cac68fec579f00f87d79e4cce79be8aa2d"

type publicGolden struct{ UnsignedCanonicalJSON, BodyBase64url, ContentType string }

func digest(raw []byte) string { h := sha256.Sum256(raw); return hex.EncodeToString(h[:]) }

func golden() (publicGolden, []byte, error) {
	var g publicGolden
	raw, err := os.ReadFile("internal/ynxbatch/testdata/product-session-proof-v5-public.json")
	if err != nil {
		return g, nil, err
	}
	if digest(raw) != goldenSHA {
		return g, nil, errors.New("final full-path SDK original changed")
	}
	if err := json.Unmarshal(raw, &g); err != nil {
		return g, nil, err
	}
	body, err := base64.RawURLEncoding.DecodeString(g.BodyBase64url)
	return g, body, err
}

func prepare(directory string) error {
	if err := os.Mkdir(directory, 0700); err != nil {
		return err
	}
	if err := privateDirectory(directory); err != nil {
		return err
	}
	g, body, err := golden()
	if err != nil {
		return err
	}
	key, pub, err := batch.KeyGen()
	if err != nil {
		return err
	}
	defer key.Destroy()
	m, err := batch.ExportKeyMaterial(key)
	if err != nil {
		return err
	}
	defer m.Clear()
	network := bytes.Repeat([]byte{0xab}, 32)
	if _, err := batch.BuildProductSessionHTTPV5Message([]byte(g.UnsignedCanonicalJSON), body, g.ContentType, batch.ProductSessionHTTPBinding{NetworkID: network, Owner: fixtureOwner, PKA: pub.PKA, PKB: pub.PKB}); err != nil {
		return err
	}
	for _, v := range []struct {
		name string
		raw  []byte
	}{
		{"unsigned.json", []byte(g.UnsignedCanonicalJSON)}, {"body.bin", body}, {"content-type.txt", []byte(g.ContentType)},
		{"network.bin", network}, {"owner.txt", []byte(fixtureOwner)}, {"pk-a.bin", pub.PKA}, {"pk-b.bin", pub.PKB},
		{"SYNTHETIC-ONLY-a.der", m.PKCS8A}, {"SYNTHETIC-ONLY-b.der", m.PKCS8B},
	} {
		if err := writeExclusive(filepath.Join(directory, v.name), v.raw); err != nil {
			return err
		}
	}
	return nil
}

func verify(directory string) error {
	inputs := map[string][]byte{}
	for _, v := range []struct {
		name string
		cap  int
	}{
		{"unsigned.json", 16384}, {"body.bin", batch.MaxProductSessionHTTPV5BodyBytes}, {"content-type.txt", 99},
		{"network.bin", 32}, {"owner.txt", 42}, {"pk-a.bin", 2592}, {"pk-b.bin", 64},
		{"memberOriginal.bin", 98304}, {"C-BOUNDARY-CASES.txt", 16},
	} {
		b, err := readBounded(directory, v.name, v.cap)
		if err != nil {
			return err
		}
		inputs[v.name] = b
	}
	g, body, err := golden()
	if err != nil {
		return err
	}
	if !bytes.Equal(inputs["unsigned.json"], []byte(g.UnsignedCanonicalJSON)) || !bytes.Equal(body, inputs["body.bin"]) || string(inputs["content-type.txt"]) != g.ContentType || !bytes.Equal(inputs["network.bin"], bytes.Repeat([]byte{0xab}, 32)) || string(inputs["owner.txt"]) != fixtureOwner || string(inputs["C-BOUNDARY-CASES.txt"]) != strconv.Itoa(fixtureBoundaryCases)+"\n" {
		return errors.New("actual C original differs from fixed synthetic request or exact case count")
	}
	b := batch.ProductSessionHTTPBinding{NetworkID: inputs["network.bin"], Owner: fixtureOwner, PKA: inputs["pk-a.bin"], PKB: inputs["pk-b.bin"]}
	message, err := batch.BuildProductSessionHTTPV5Message(inputs["unsigned.json"], inputs["body.bin"], string(inputs["content-type.txt"]), b)
	if err != nil {
		return err
	}
	member := inputs["memberOriginal.bin"]
	if _, err := batch.InspectProductSessionHTTPV5Member(member, b, message); err != nil {
		return err
	}
	for _, branch := range []int{0, 1, 2} {
		m, err := batch.DecodeMember(member)
		if err != nil {
			return err
		}
		switch branch {
		case 0:
			m.Certificate.SigmaA[0] ^= 1
		case 1:
			m.Certificate.SigmaB[0] ^= 1
		case 2:
			m.Certificate.Purpose = "TX-BATCH"
		}
		bad, err := batch.EncodeMember(m)
		if err != nil {
			return err
		}
		if _, err := batch.InspectProductSessionHTTPV5Member(bad, b, message); err == nil {
			return errors.New("bad AND branch or purpose admitted")
		}
	}
	for _, which := range []int{0, 1} {
		wrong := b
		wrong.PKA = bytes.Clone(b.PKA)
		wrong.PKB = bytes.Clone(b.PKB)
		if which == 0 {
			wrong.PKA[0] ^= 1
		} else {
			wrong.PKB[0] ^= 1
		}
		if _, err := batch.InspectProductSessionHTTPV5Member(member, wrong, message); err == nil {
			return errors.New("independent full pair mismatch admitted")
		}
	}
	public := map[string]any{"version": "YNX-HTTP-V5-CABI-PUBLIC-INTEROP/v1", "syntheticOnly": true, "sourceGoldenSHA256": goldenSHA,
		"unsignedCanonicalJSON": g.UnsignedCanonicalJSON, "contentType": g.ContentType, "bodyBase64url": g.BodyBase64url,
		"networkId": hex.EncodeToString(b.NetworkID), "owner": b.Owner, "pkA": hex.EncodeToString(b.PKA), "pkB": hex.EncodeToString(b.PKB),
		"messageBase64url": base64.RawURLEncoding.EncodeToString(message), "memberBase64url": base64.RawURLEncoding.EncodeToString(member),
		"messageSHA256": digest(message), "memberSHA256": digest(member), "messageBytes": len(message), "memberBytes": len(member),
		"actualCABI": true, "actualCCalls": fixtureBoundaryCases, "dualANDVerified": true, "purpose": "PRODUCT-SESSION-HTTP-PROOF", "path": batch.ProductSessionHTTPV5Path,
		"sourceAuthorized": false, "currentRegistrationVerified": false, "rootGranted": false, "nativeApproved": false, "keychainApproval": false, "onceConsumed": false, "httpExecuted": false, "deployed": false}
	raw, err := json.MarshalIndent(public, "", "  ")
	if err != nil {
		return err
	}
	return writeExclusive(filepath.Join(directory, "PUBLIC-INTEROP.json"), raw)
}

// Remove only the two original synthetic DER files. A substituted/symlinked
// file is an error and is preserved. No recursive removal or wildcard cleanup.
func cleanup(directory string) error {
	if _, err := os.Lstat(directory); errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err := privateDirectory(directory); err != nil {
		return err
	}
	for _, v := range []struct {
		name string
		size int
	}{{"SYNTHETIC-ONLY-a.der", 54}, {"SYNTHETIC-ONLY-b.der", 150}} {
		path := filepath.Join(directory, v.name)
		before, err := os.Lstat(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		raw, err := readBounded(directory, v.name, v.size)
		if err != nil {
			return err
		}
		clear(raw)
		current, err := os.Lstat(path)
		if err != nil || !sameFile(before, current) {
			return errors.New("synthetic cleanup original changed")
		}
		if err := os.Remove(path); err != nil {
			return err
		}
	}
	d, err := os.Open(directory)
	if err != nil {
		return err
	}
	return errors.Join(d.Sync(), d.Close())
}

func result(directory, archiveSHA, archiveBytes string) error {
	sha, err := hex.DecodeString(archiveSHA)
	if err != nil || len(sha) != 32 || hex.EncodeToString(sha) != archiveSHA {
		return errors.New("actual shared archive SHA required")
	}
	n, err := strconv.ParseUint(archiveBytes, 10, 64)
	if err != nil || n == 0 || strconv.FormatUint(n, 10) != archiveBytes {
		return errors.New("actual shared archive bytes required")
	}
	for _, name := range []string{"SYNTHETIC-ONLY-a.der", "SYNTHETIC-ONLY-b.der"} {
		if _, err := os.Lstat(filepath.Join(directory, name)); !errors.Is(err, os.ErrNotExist) {
			return errors.New("synthetic private cleanup incomplete")
		}
	}
	raw, err := readBounded(directory, "PUBLIC-INTEROP.json", 256<<10)
	if err != nil {
		return err
	}
	out := struct {
		Version      string          `json:"version"`
		ArchiveSHA   string          `json:"archiveSHA256"`
		ArchiveBytes string          `json:"archiveBytes"`
		Target       string          `json:"target"`
		Cleanup      bool            `json:"syntheticPrivateFilesRemoved"`
		Interop      json.RawMessage `json:"interop"`
	}{"YNX-HTTP-V5-CABI-PUBLIC-RESULT/v1", archiveSHA, archiveBytes, runtime.GOOS + "/" + runtime.GOARCH, true, raw}
	encoded, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return err
	}
	return writeExclusive(filepath.Join(filepath.Dir(directory), "PUBLIC-RESULT.json"), encoded)
}

func main() {
	if len(os.Args) < 3 || !filepath.IsAbs(os.Args[2]) || filepath.Clean(os.Args[2]) != os.Args[2] {
		fmt.Fprintln(os.Stderr, "V5 fixture mode and canonical absolute synthetic directory required")
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "prepare":
		err = prepare(os.Args[2])
	case "verify":
		err = verify(os.Args[2])
	case "cleanup":
		err = cleanup(os.Args[2])
	case "result":
		if len(os.Args) != 5 {
			err = errors.New("original archive metadata required")
		} else {
			err = result(os.Args[2], os.Args[3], os.Args[4])
		}
	default:
		err = errors.New("unknown fixture mode")
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "V5 synthetic fixture failed:", err)
		os.Exit(1)
	}
	fmt.Printf("YNX_HTTP_V5_FIXTURE_%s_PASS synthetic=true authority=false\n", os.Args[1])
}
