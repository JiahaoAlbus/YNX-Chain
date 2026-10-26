// Normal-CI public interoperability fixture. Only fresh synthetic signing is
// used to prepare public test inputs; no private material is written to disk.
// The C export under test is read-only and never receives a private key.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"

	batch "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const boundaryCases = 62

var inputNames = []string{
	"member.bin", "message.bin", "network.bin", "owner.txt", "purpose.txt", "pk-a.bin", "pk-b.bin",
	"bad-sig-a.bin", "bad-sig-b.bin", "bad-leaf.bin", "bad-message.bin", "member-n2.bin",
	"bad-index.bin", "bad-path-a.bin", "bad-path-b.bin", "bad-suite.bin", "member-empty.bin", "member-revoke.bin", "purpose-revoke.txt",
}

type publicFile struct {
	Name   string `json:"name"`
	Bytes  int    `json:"bytes"`
	SHA256 string `json:"sha256"`
}

type cResult struct {
	Version       uint32 `json:"version"`
	StructSize    uint32 `json:"structSize"`
	Verified      uint32 `json:"verified"`
	MemberCount   uint32 `json:"memberCount"`
	Index         uint32 `json:"index"`
	CleanupStatus uint32 `json:"cleanupStatus"`
	Reserved      uint64 `json:"reserved"`
	Cases         uint32 `json:"cases"`
	Authority     bool   `json:"authority"`
}

func privateDirectory(directory string) error {
	s, err := os.Lstat(directory)
	if err != nil {
		return err
	}
	u, ok := s.Sys().(*syscall.Stat_t)
	if !s.IsDir() || s.Mode().Perm() != 0700 || !ok || uint64(u.Uid) != uint64(os.Geteuid()) {
		return errors.New("original private synthetic directory required")
	}
	return nil
}

func writeExclusive(directory, name string, raw []byte) error {
	f, err := os.OpenFile(filepath.Join(directory, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	n, e := f.Write(raw)
	if e == nil && n != len(raw) {
		e = io.ErrShortWrite
	}
	return errors.Join(e, f.Sync(), f.Close())
}

func readPublic(directory, name string, maximum int64) ([]byte, error) {
	f, err := os.OpenFile(filepath.Join(directory, name), os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	s, err := f.Stat()
	if err != nil {
		return nil, err
	}
	u, ok := s.Sys().(*syscall.Stat_t)
	if !s.Mode().IsRegular() || s.Mode().Perm() != 0600 || !ok || u.Nlink != 1 || uint64(u.Uid) != uint64(os.Geteuid()) || s.Size() < 0 || s.Size() > maximum {
		return nil, errors.New("bounded owned public file required")
	}
	raw, err := io.ReadAll(io.LimitReader(f, maximum+1))
	if err != nil || int64(len(raw)) != s.Size() {
		return nil, errors.New("public input read changed")
	}
	after, err := f.Stat()
	if err != nil || !os.SameFile(s, after) || s.Size() != after.Size() || s.Mode() != after.Mode() || !s.ModTime().Equal(after.ModTime()) {
		return nil, errors.New("public input identity changed")
	}
	return raw, nil
}

func strictJSON(raw []byte, value any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		return err
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return errors.New("strict JSON requires EOF")
	}
	return nil
}

func generate(directory string) error {
	if err := privateDirectory(directory); err != nil {
		return err
	}
	entries, err := os.ReadDir(directory)
	if err != nil || len(entries) != 0 {
		return errors.New("fresh empty fixture directory required")
	}
	key, public, err := batch.KeyGen()
	if err != nil {
		return err
	}
	defer key.Destroy()
	metadata := batch.Metadata{ChainID: bytes.Repeat([]byte{0x41}, 32), Owner: "0x" + strings.Repeat("11", 20), Purpose: "SOURCE-ROOT-READ-V2"}
	message, err := batch.EncodeFields([]byte("SYNTHETIC-SOURCE-ROOT-READ-V2"), []byte("original-operation"))
	if err != nil {
		return err
	}
	sign := func(messages [][]byte, purpose string) ([]byte, error) {
		m := metadata
		m.Purpose = purpose
		b, err := batch.BatchSign(key, m, messages, batch.SignOptions{Optimized: true})
		if err != nil {
			return nil, err
		}
		defer b.Discard()
		member, err := batch.Extract(b, 0)
		if err != nil {
			return nil, err
		}
		return batch.EncodeMember(member)
	}
	wire, err := sign([][]byte{message}, metadata.Purpose)
	if err != nil {
		return err
	}
	values := map[string][]byte{"member.bin": wire, "message.bin": message, "network.bin": metadata.ChainID,
		"owner.txt": []byte(metadata.Owner), "purpose.txt": []byte(metadata.Purpose), "pk-a.bin": public.PKA, "pk-b.bin": public.PKB,
		"purpose-revoke.txt": []byte("SOURCE-DEVICE-REVOKE-V2")}
	for _, tc := range []struct {
		name string
		edit func(*batch.Member)
	}{
		{"bad-sig-a.bin", func(m *batch.Member) { m.Certificate.SigmaA[0] ^= 1 }},
		{"bad-sig-b.bin", func(m *batch.Member) { m.Certificate.SigmaB[0] ^= 1 }},
		{"bad-leaf.bin", func(m *batch.Member) { m.Message[len(m.Message)-1] ^= 1 }},
	} {
		m, err := batch.DecodeMember(wire)
		if err != nil {
			return err
		}
		tc.edit(&m)
		values[tc.name], err = batch.EncodeMember(m)
		if err != nil {
			return err
		}
		if tc.name == "bad-leaf.bin" {
			values["bad-message.bin"] = m.Message
		}
	}
	values["member-n2.bin"], err = sign([][]byte{message, []byte("second synthetic member")}, metadata.Purpose)
	if err != nil {
		return err
	}
	values["member-empty.bin"], err = sign([][]byte{nil}, metadata.Purpose)
	if err != nil {
		return err
	}
	values["member-revoke.bin"], err = sign([][]byte{message}, "SOURCE-DEVICE-REVOKE-V2")
	if err != nil {
		return err
	}
	for _, name := range []string{"bad-index.bin", "bad-path-a.bin", "bad-path-b.bin", "bad-suite.bin"} {
		outer, err := batch.DecodeFields(wire, 4, batch.MaxMemberBytes)
		if err != nil {
			return err
		}
		if name == "bad-suite.bin" {
			// Same-length wrong suite keeps framing valid, not an arbitrary byte
			// whose meaning depends on the provider's signature representation.
			at := bytes.Index(outer[1], []byte(batch.Suite))
			if at < 0 {
				return errors.New("fixture suite not found")
			}
			outer[1][at] ^= 1
		} else {
			proof, err := batch.DecodeFields(outer[3], 3, batch.MaxProofBytes)
			if err != nil {
				return err
			}
			switch name {
			case "bad-index.bin":
				binary.BigEndian.PutUint32(proof[0], 1)
			case "bad-path-a.bin":
				proof[1], err = batch.EncodeFields(make([]byte, 64))
			case "bad-path-b.bin":
				proof[2], err = batch.EncodeFields(make([]byte, 64))
			}
			if err != nil {
				return err
			}
			outer[3], err = batch.EncodeFields(proof...)
			if err != nil {
				return err
			}
		}
		values[name], err = batch.EncodeFields(outer...)
		if err != nil {
			return err
		}
	}
	var manifest []publicFile
	for _, name := range inputNames {
		raw, exists := values[name]
		if !exists || len(raw) == 0 || len(raw) > 98304 {
			return errors.New("incomplete bounded public fixture")
		}
		if err := writeExclusive(directory, name, raw); err != nil {
			return err
		}
		digest := sha256.Sum256(raw)
		manifest = append(manifest, publicFile{Name: name, Bytes: len(raw), SHA256: hex.EncodeToString(digest[:])})
	}
	encoded, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	return writeExclusive(directory, "PUBLIC-INPUTS.json", encoded)
}

func verify(directory string) error {
	if err := privateDirectory(directory); err != nil {
		return err
	}
	manifestRaw, err := readPublic(directory, "PUBLIC-INPUTS.json", 16384)
	if err != nil {
		return err
	}
	var manifest []publicFile
	if err := strictJSON(manifestRaw, &manifest); err != nil || len(manifest) != len(inputNames) {
		return errors.New("public input manifest shape")
	}
	manifestCanonical, err := json.Marshal(manifest)
	if err != nil || !bytes.Equal(manifestRaw, manifestCanonical) {
		return errors.New("public input manifest must be exact canonical JSON")
	}
	values := make(map[string][]byte, len(inputNames))
	for i, name := range inputNames {
		item := manifest[i]
		raw, err := readPublic(directory, name, 98304)
		if err != nil {
			return err
		}
		digest := sha256.Sum256(raw)
		if item.Name != name || item.Bytes != len(raw) || item.SHA256 != hex.EncodeToString(digest[:]) {
			return errors.New("C caller modified an original public input")
		}
		values[name] = raw
	}
	count, err := readPublic(directory, "C-BOUNDARY-CASES.txt", 32)
	if err != nil || string(count) != strconv.Itoa(boundaryCases)+"\n" {
		return errors.New("exact actual C call count required")
	}
	raw, err := readPublic(directory, "N1-C-RESULT.json", 1024)
	if err != nil {
		return err
	}
	var result cResult
	if err := strictJSON(raw, &result); err != nil {
		return err
	}
	expected := cResult{Version: 1, StructSize: 32, Verified: 1, MemberCount: 1, Cases: boundaryCases}
	canonical, _ := json.Marshal(result)
	want, _ := json.Marshal(expected)
	// Exact canonical bytes also reject duplicate fields, omitted explicit zero
	// fields, bool/string/number coercions, unknown keys and reordered receipts.
	if result != expected || !bytes.Equal(raw, canonical) || !bytes.Equal(canonical, want) {
		return errors.New("C result does not report complete mathematical success")
	}
	names := append(append([]string(nil), inputNames...), "PUBLIC-INPUTS.json", "N1-C-RESULT.json", "C-BOUNDARY-CASES.txt")
	sort.Strings(names)
	entries, err := os.ReadDir(directory)
	if err != nil || len(entries) != len(names) {
		return errors.New("fixture directory not closed")
	}
	for i := range entries {
		if entries[i].Name() != names[i] {
			return errors.New("unexpected fixture file")
		}
	}
	member, err := batch.DecodeMember(values["member.bin"])
	if err != nil || member.Certificate.N != 1 || member.Index != 0 || len(member.PathA) != 0 || len(member.PathB) != 0 ||
		!bytes.Equal(member.Message, values["message.bin"]) || !bytes.Equal(member.Certificate.ChainID, values["network.bin"]) ||
		member.Certificate.Owner != string(values["owner.txt"]) || member.Certificate.Purpose != string(values["purpose.txt"]) ||
		!bytes.Equal(member.Certificate.PKA, values["pk-a.bin"]) || !bytes.Equal(member.Certificate.PKB, values["pk-b.bin"]) {
		return errors.New("independent N1 full expected binding failed")
	}
	v, err := batch.NewVerifier(batch.VerifierOptions{ChainID: values["network.bin"], Purpose: string(values["purpose.txt"]),
		ResolveTrustedOwner: func(r batch.TrustRequest) (batch.Registration, error) {
			if !bytes.Equal(r.ChainID, values["network.bin"]) || r.Owner != string(values["owner.txt"]) || r.Purpose != string(values["purpose.txt"]) || r.Height != 12 {
				return batch.Registration{}, batch.ErrUntrusted
			}
			return batch.Registration{AlgorithmVersion: batch.Version, ChainID: values["network.bin"], Owner: string(values["owner.txt"]),
				Purpose: string(values["purpose.txt"]), PKA: values["pk-a.bin"], PKB: values["pk-b.bin"], PolicyRevision: "7", ActiveFrom: 10, Enabled: true}, nil
		}})
	if err != nil {
		return err
	}
	if err := v.VerifyOne(values["member.bin"], 12); err != nil || v.Stats().SignatureChecks != 2 || v.Stats().CacheHits != 0 {
		return errors.New("independent original full AND verification failed")
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"schema": "ynx-registered-n1-cabi-public-interop/v1", "actualCABI": true,
		"cases": boundaryCases, "fullANDChecks": 2, "N": 1, "index": 0, "authority": false, "keysRead": false, "signingByCABI": false})
}

func main() {
	if len(os.Args) != 3 || (os.Args[1] != "generate" && os.Args[1] != "verify") {
		fmt.Fprintln(os.Stderr, "usage: verify-registered-n1-cabi generate|verify ORIGINAL_PRIVATE_FIXTURE_DIRECTORY")
		os.Exit(2)
	}
	var err error
	if os.Args[1] == "generate" {
		err = generate(os.Args[2])
	} else {
		err = verify(os.Args[2])
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "YNX_REGISTERED_N1_PUBLIC_FIXTURE_REFUSED:", err)
		os.Exit(1)
	}
}
