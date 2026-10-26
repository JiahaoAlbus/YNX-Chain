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
	"strconv"
	"strings"
	"syscall"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	batch "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	fixtureOwner = "0x1111111111111111111111111111111111111111"
	// The C driver makes these exact forty real export calls, including one
	// successful signature. This is not a minimum/zero-hit admission check.
	fixtureBoundaryCases = 40
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

func unsignedOriginal() ([]byte, error) {
	account, err := accountaddress.Encode(fixtureOwner)
	if err != nil {
		return nil, err
	}
	// Frozen sorted SDK49 unsigned21; full u64 revision is deliberately a
	// STRING. There is no live clock, registered slot or issuer in this DATA.
	return []byte(`{"account":"` + account + `","applicationId":"com.ynx.developer","bodyDigest":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","bundleId":"com.ynx.developer","callback":"ynxdeveloper://callback","canonicalOwner":"` + fixtureOwner + `","clientId":"com.ynx.developer.macos","deviceId":"PUBLIC-device-v4","deviceRegistrationDigest":"` + strings.Repeat("22", 32) + `","deviceRegistrationId":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","deviceRegistrationRevision":"18446744073709551615","expiresAt":"2026-10-26T08:00:30.000Z","issuedAt":"2026-10-26T08:00:00.000Z","method":"GET","nonce":"` + strings.Repeat("a", 43) + `","origin":"https://developer.ynxweb4.com","packageId":null,"path":"/v1/developer/projects","productId":"developer","sessionBinding":"` + strings.Repeat("33", 32) + `","version":"4"}`), nil
}

func prepare(directory string) error {
	if err := os.Mkdir(directory, 0700); err != nil {
		return err
	}
	if err := privateDirectory(directory); err != nil {
		return err
	}
	key, public, err := batch.KeyGen()
	if err != nil {
		return err
	}
	defer key.Destroy()
	material, err := batch.ExportKeyMaterial(key)
	if err != nil {
		return err
	}
	defer material.Clear()
	unsigned, err := unsignedOriginal()
	if err != nil {
		return err
	}
	network := bytes.Repeat([]byte{0xab}, 32)
	if _, err := batch.BuildProductSessionHTTPMessage(unsigned, batch.ProductSessionHTTPBinding{NetworkID: network, Owner: fixtureOwner, PKA: public.PKA, PKB: public.PKB}); err != nil {
		return err
	}
	for _, input := range []struct {
		name string
		raw  []byte
	}{
		{"unsigned.json", unsigned}, {"network.bin", network}, {"owner.txt", []byte(fixtureOwner)},
		{"pk-a.bin", public.PKA}, {"pk-b.bin", public.PKB},
		{"SYNTHETIC-ONLY-a.der", material.PKCS8A}, {"SYNTHETIC-ONLY-b.der", material.PKCS8B},
	} {
		if err := writeExclusive(filepath.Join(directory, input.name), input.raw); err != nil {
			return err
		}
	}
	return nil
}

func digest(raw []byte) string { h := sha256.Sum256(raw); return hex.EncodeToString(h[:]) }

func verify(directory string) error {
	inputs := make(map[string][]byte)
	for _, input := range []struct {
		name string
		cap  int
	}{{"unsigned.json", 16384}, {"network.bin", 32}, {"owner.txt", 42}, {"pk-a.bin", 2592}, {"pk-b.bin", 64}, {"memberOriginal.bin", 98304}, {"C-BOUNDARY-CASES.txt", 16}} {
		raw, err := readBounded(directory, input.name, input.cap)
		if err != nil {
			return err
		}
		inputs[input.name] = raw
	}
	unsigned, err := unsignedOriginal()
	if err != nil || !bytes.Equal(unsigned, inputs["unsigned.json"]) || !bytes.Equal(inputs["network.bin"], bytes.Repeat([]byte{0xab}, 32)) || string(inputs["owner.txt"]) != fixtureOwner {
		return errors.New("C caller changed independently fixed synthetic public request")
	}
	cases, err := strconv.ParseUint(strings.TrimSuffix(string(inputs["C-BOUNDARY-CASES.txt"]), "\n"), 10, 32)
	if err != nil || cases != fixtureBoundaryCases || strconv.FormatUint(cases, 10)+"\n" != string(inputs["C-BOUNDARY-CASES.txt"]) {
		return errors.New("actual C boundary cases incomplete")
	}
	binding := batch.ProductSessionHTTPBinding{NetworkID: inputs["network.bin"], Owner: fixtureOwner, PKA: inputs["pk-a.bin"], PKB: inputs["pk-b.bin"]}
	wire := inputs["memberOriginal.bin"]
	view, err := batch.InspectProductSessionHTTPMember(wire, binding, unsigned)
	if err != nil {
		return fmt.Errorf("actual C HTTP Member failed independent Go dual AND: %w", err)
	}
	// The independent fixture spells out E5's five fields; no C-returned
	// message, purpose, owner or hash can select the expected request.
	want, err := batch.EncodeFields([]byte("YNX-PRODUCT-SESSION-HTTP-PROOF/v4"), batch.U32(4), binding.NetworkID, []byte(fixtureOwner), unsigned)
	if err != nil || !bytes.Equal(view.MessageOriginal, want) {
		return errors.New("actual C output differs from the fixed original E5")
	}
	member, err := batch.DecodeMember(wire)
	if err != nil || member.Certificate.Purpose != "PRODUCT-SESSION-HTTP-PROOF" || member.Certificate.N != 1 || member.Index != 0 || len(member.PathA) != 0 || len(member.PathB) != 0 {
		return errors.New("actual C output changed the fixed N1 purpose")
	}
	for _, branch := range []string{"A", "B", "purpose"} {
		bad, err := batch.DecodeMember(wire)
		if err != nil {
			return err
		}
		switch branch {
		case "A":
			bad.Certificate.SigmaA[0] ^= 1
		case "B":
			bad.Certificate.SigmaB[0] ^= 1
		default:
			bad.Certificate.Purpose = "TX-BATCH"
		}
		mutated, err := batch.EncodeMember(bad)
		if err != nil {
			return err
		}
		if _, err := batch.InspectProductSessionHTTPMember(mutated, binding, unsigned); err == nil {
			return errors.New("independent verifier accepted corruption or another purpose")
		}
	}
	wrong := binding
	wrong.PKB = bytes.Clone(binding.PKB)
	wrong.PKB[0] ^= 1
	if _, err := batch.InspectProductSessionHTTPMember(wire, wrong, unsigned); err == nil {
		return errors.New("independent verifier accepted another complete public pair")
	}
	public := map[string]any{
		"version": "YNX-PRODUCT-SESSION-HTTP-CABI-PUBLIC-INTEROP/v4", "classification": "data", "syntheticOnly": true,
		"networkId": hex.EncodeToString(binding.NetworkID), "owner": fixtureOwner,
		"pkA": hex.EncodeToString(binding.PKA), "pkB": hex.EncodeToString(binding.PKB),
		"unsignedOriginalBase64": base64.StdEncoding.EncodeToString(unsigned), "messageOriginalBase64": base64.StdEncoding.EncodeToString(want),
		"memberOriginalBase64": base64.StdEncoding.EncodeToString(wire), "purpose": batch.ProductSessionHTTPPurpose,
		"memberCount": 1, "memberIndex": 0, "signatureVerified": true,
		"authorityGranted": false, "SourceAdmission": false, "NativeAdmission": false, "registered": false, "current": false,
	}
	receipt := map[string]any{
		"version": "YNX-PRODUCT-SESSION-HTTP-CABI-PUBLIC-RECEIPT/v4", "classification": "data", "syntheticOnly": true,
		"actualCABIExecuted": true, "independentGoANDVerified": true, "boundaryCases": cases,
		"purpose": batch.ProductSessionHTTPPurpose, "memberCount": 1, "memberIndex": 0,
		"unsignedSHA256": digest(unsigned), "messageSHA256": digest(want), "memberSHA256": digest(wire), "memberBytes": len(wire),
		"corruptBranchesRejected": 2, "crossPurposeRejected": true, "wrongFullPairRejected": true,
		"authorityGranted": false, "RootAdmission": false, "SourceAdmission": false, "NativeAdmission": false,
		"registered": false, "current": false, "HTTPExecuted": false, "installed": false, "publicDeployment": false,
	}
	for _, output := range []struct {
		name  string
		value any
	}{{"PUBLIC-INTEROP.json", public}, {"PUBLIC-RECEIPT.json", receipt}} {
		raw, err := json.MarshalIndent(output.value, "", "  ")
		if err != nil {
			return err
		}
		if err := writeExclusive(filepath.Join(directory, output.name), append(raw, '\n')); err != nil {
			return err
		}
	}
	fmt.Printf("YNX_PRODUCT_SESSION_HTTP_CABI_GO_AND_PASS cases=%d authority=false\n", cases)
	return nil
}

func main() {
	if len(os.Args) != 3 || !filepath.IsAbs(os.Args[2]) || (os.Args[1] != "prepare" && os.Args[1] != "verify") {
		fmt.Fprintln(os.Stderr, "explicit fixture mode and absolute private synthetic directory required")
		os.Exit(2)
	}
	var err error
	if os.Args[1] == "prepare" {
		err = prepare(os.Args[2])
	} else {
		err = verify(os.Args[2])
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "product-session HTTP synthetic fixture failed:", err)
		os.Exit(1)
	}
}
