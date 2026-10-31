// Normal-CI synthetic C caller inputs and independent public full-AND verifier.
// Only a fresh test device's DER is written; it must be removed by the owning
// CI EXIT cleanup, never copied into delivery. No Auth/Source/approval is used.
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
	"sort"
	"strings"
	"syscall"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	batch "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	fixtureOwner  = "0x1111111111111111111111111111111111111111"
	boundaryCases = 48
)

var inputNames = []string{
	"registration-original.json", "challenge-original.json", "network.bin", "owner.txt",
	"device-pk-a.bin", "device-pk-b.bin", "account-pk-a.bin", "account-pk-b.bin",
	"SYNTHETIC-ONLY-device-a.der", "SYNTHETIC-ONLY-device-b.der",
}

type outcome struct {
	Bytes   uint64 `json:"bytes"`
	Cleanup uint32 `json:"cleanup"`
	RC      int32  `json:"rc"`
}

type cResult struct {
	Authority    bool    `json:"authority"`
	Cases        uint32  `json:"cases"`
	Challenge    outcome `json:"challenge"`
	DataOnly     bool    `json:"dataOnly"`
	Registration outcome `json:"registration"`
	Version      uint32  `json:"version"`
}

func privateDirectory(path string) error {
	canonical, err := filepath.EvalSymlinks(path)
	if err != nil || !filepath.IsAbs(path) || filepath.Clean(path) != path || canonical != path {
		return errors.New("canonical private fixture directory required")
	}
	s, err := os.Lstat(path)
	if err != nil {
		return err
	}
	u, ok := s.Sys().(*syscall.Stat_t)
	if !s.IsDir() || s.Mode().Perm() != 0700 || !ok || uint64(u.Uid) != uint64(os.Geteuid()) {
		return errors.New("owned private0700 synthetic fixture directory required")
	}
	return nil
}

func closedDirectory(directory string, names []string) error {
	if err := privateDirectory(directory); err != nil {
		return err
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return err
	}
	want := append([]string(nil), names...)
	sort.Strings(want)
	if len(entries) != len(want) {
		return errors.New("fixture directory closed file set differs")
	}
	for i, e := range entries {
		if e.Name() != want[i] || e.Type()&os.ModeSymlink != 0 || e.IsDir() {
			return errors.New("fixture directory contains unexpected entry")
		}
	}
	return nil
}

func writeExclusive(directory, name string, raw []byte) error {
	f, err := os.OpenFile(filepath.Join(directory, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	n, e := f.Write(raw)
	if e == nil && n != len(raw) {
		e = io.ErrShortWrite
	}
	return errors.Join(e, f.Sync(), f.Close())
}

func sameFile(a, b os.FileInfo) bool {
	x, xok := a.Sys().(*syscall.Stat_t)
	y, yok := b.Sys().(*syscall.Stat_t)
	return xok && yok && os.SameFile(a, b) && a.Mode() == b.Mode() && a.Size() == b.Size() && a.ModTime().Equal(b.ModTime()) &&
		x.Uid == y.Uid && x.Gid == y.Gid && x.Nlink == y.Nlink
}

func readPublic(directory, name string, maximum int64) ([]byte, error) {
	path := filepath.Join(directory, name)
	before, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	u, ok := before.Sys().(*syscall.Stat_t)
	if !before.Mode().IsRegular() || before.Mode().Perm() != 0600 || !ok || u.Nlink != 1 || uint64(u.Uid) != uint64(os.Geteuid()) || before.Size() < 1 || before.Size() > maximum {
		return nil, errors.New("bounded owned private single-link public input required")
	}
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	held, err := f.Stat()
	if err != nil || !sameFile(before, held) {
		return nil, errors.New("public fixture changed before read")
	}
	raw, err := io.ReadAll(io.LimitReader(f, maximum+1))
	if err != nil {
		return nil, err
	}
	heldAfter, heldErr := f.Stat()
	after, pathErr := os.Lstat(path)
	if heldErr != nil || pathErr != nil || !sameFile(before, heldAfter) || !sameFile(before, after) || int64(len(raw)) != before.Size() {
		return nil, errors.New("public fixture changed during read")
	}
	return raw, nil
}

func canonical(v any) ([]byte, error) {
	var out bytes.Buffer
	e := json.NewEncoder(&out)
	e.SetEscapeHTML(false)
	if err := e.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(out.Bytes(), []byte{'\n'}), nil
}

func digest(raw []byte) string { sum := sha256.Sum256(raw); return hex.EncodeToString(sum[:]) }

func originals(device, account batch.PublicKey) (registration, challenge []byte, err error) {
	owner, err := accountaddress.Encode(fixtureOwner)
	if err != nil {
		return nil, nil, err
	}
	network := strings.Repeat("ab", 32)
	r := map[string]any{"version": "4", "registrationId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "networkId": network, "canonicalOwner": fixtureOwner,
		"productId": "developer", "clientId": "com.ynx.developer.macos", "platform": "macos", "applicationId": "com.ynx.developer", "bundleId": "com.ynx.developer", "packageId": nil,
		"origin": "https://developer.ynxweb4.com", "callback": "ynxdeveloper://callback", "deviceId": "PUBLIC-device-v4", "generation": "1", "revision": "18446744073709551615",
		"pkA": hex.EncodeToString(device.PKA), "pkB": hex.EncodeToString(device.PKB), "registeredAt": "2026-10-31T08:00:00.000Z", "expiresAt": "2026-10-31T09:00:00.000Z", "revokedAt": nil}
	registration, err = canonical(r)
	if err != nil {
		return nil, nil, err
	}
	c := map[string]any{"version": "4", "chainId": "ynx_6423-1", "account": owner, "deviceAlgorithm": batch.Suite,
		"deviceRegistrationId": r["registrationId"], "deviceRegistrationRevision": r["revision"], "deviceRegistrationDigest": digest(registration),
		"challenge": strings.Repeat("c", 43), "nonce": strings.Repeat("n", 43), "state": strings.Repeat("s", 43), "requestDigest": strings.Repeat("22", 32), "approvalDigest": strings.Repeat("33", 32),
		"issuedAt": "2026-10-31T08:01:00.000Z", "expiresAt": "2026-10-31T08:01:30.000Z", "sessionExpiresAt": "2026-10-31T08:05:00.000Z", "scopes": []string{"account:read"},
		"accountAuthorization": map[string]any{"policyVersion": "YNX-ACCOUNT-POLICY/v1", "algorithmVersion": batch.Version, "networkId": network, "canonicalOwner": fixtureOwner,
			"revision": "7", "registeredAt": "2", "activeFrom": "3", "pkA": hex.EncodeToString(account.PKA), "pkB": hex.EncodeToString(account.PKB)}}
	for _, k := range []string{"productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback", "deviceId"} {
		c[k] = r[k]
	}
	challenge, err = canonical(c)
	return registration, challenge, err
}

func generate(directory string) error {
	if err := closedDirectory(directory, nil); err != nil {
		return err
	}
	device, devicePublic, err := batch.KeyGen()
	if err != nil {
		return err
	}
	defer device.Destroy()
	account, accountPublic, err := batch.KeyGen()
	if err != nil {
		return err
	}
	defer account.Destroy()
	if bytes.Equal(devicePublic.PKA, accountPublic.PKA) || bytes.Equal(devicePublic.PKB, accountPublic.PKB) {
		return errors.New("synthetic device and account pairs must be independent")
	}
	material, err := batch.ExportKeyMaterial(device)
	if err != nil {
		return err
	}
	defer material.Clear()
	r, c, err := originals(devicePublic, accountPublic)
	if err != nil {
		return err
	}
	b := batch.ProductSessionDeviceV4Binding{NetworkID: bytes.Repeat([]byte{0xab}, 32), Owner: fixtureOwner, PKA: devicePublic.PKA, PKB: devicePublic.PKB}
	if _, err := batch.BuildProductSessionDeviceRegistrationV4Message(r, b); err != nil {
		return err
	}
	if _, err := batch.BuildProductSessionDeviceChallengeV4Message(c, r, b); err != nil {
		return err
	}
	values := [][]byte{r, c, b.NetworkID, []byte(fixtureOwner), devicePublic.PKA, devicePublic.PKB, accountPublic.PKA, accountPublic.PKB, material.PKCS8A, material.PKCS8B}
	for i, name := range inputNames {
		if err := writeExclusive(directory, name, values[i]); err != nil {
			return err
		}
	}
	return closedDirectory(directory, inputNames)
}

func verifyMath(wire []byte, b batch.ProductSessionDeviceV4Binding, purpose string) error {
	v, err := batch.NewVerifier(batch.VerifierOptions{ChainID: b.NetworkID, Purpose: purpose, CacheEntries: 0, Optimized: true,
		ResolveTrustedOwner: func(q batch.TrustRequest) (batch.Registration, error) {
			if q.Height != 0 || q.Owner != b.Owner || q.Purpose != purpose || !bytes.Equal(q.ChainID, b.NetworkID) {
				return batch.Registration{}, batch.ErrUntrusted
			}
			return batch.Registration{Enabled: true, AlgorithmVersion: batch.Version, ChainID: bytes.Clone(b.NetworkID), Owner: b.Owner, Purpose: purpose,
				PKA: bytes.Clone(b.PKA), PKB: bytes.Clone(b.PKB), PolicyRevision: "synthetic-product-device-v4-math-only"}, nil
		}})
	if err != nil {
		return err
	}
	defer v.Clear()
	return v.VerifyOne(wire, 0)
}

func verify(directory string) error {
	names := append(append([]string(nil), inputNames...), "registration-member.bin", "challenge-member.bin", "C-RESULT.json")
	if err := closedDirectory(directory, names); err != nil {
		return err
	}
	// Verify only the two synthetic private files' metadata, not their bodies.
	// The actual C caller snapshots each borrowed DER and compares it after
	// every invocation; its private buffers are wiped before exit.
	for i, name := range inputNames[8:] {
		s, err := os.Lstat(filepath.Join(directory, name))
		if err != nil {
			return err
		}
		u, ok := s.Sys().(*syscall.Stat_t)
		if !s.Mode().IsRegular() || s.Mode().Perm() != 0600 || !ok || u.Nlink != 1 || uint64(u.Uid) != uint64(os.Geteuid()) || s.Size() != []int64{54, 150}[i] {
			return errors.New("original synthetic DER metadata changed")
		}
	}
	inputs := make(map[string][]byte)
	for _, input := range []struct {
		name string
		cap  int64
	}{{"registration-original.json", 16384}, {"challenge-original.json", 16384}, {"network.bin", 32}, {"owner.txt", 42}, {"device-pk-a.bin", 2592}, {"device-pk-b.bin", 64},
		{"account-pk-a.bin", 2592}, {"account-pk-b.bin", 64}, {"registration-member.bin", 98304}, {"challenge-member.bin", 98304}, {"C-RESULT.json", 1024}} {
		raw, err := readPublic(directory, input.name, input.cap)
		if err != nil {
			return err
		}
		inputs[input.name] = raw
	}
	b := batch.ProductSessionDeviceV4Binding{NetworkID: inputs["network.bin"], Owner: fixtureOwner, PKA: inputs["device-pk-a.bin"], PKB: inputs["device-pk-b.bin"]}
	account := batch.PublicKey{PKA: inputs["account-pk-a.bin"], PKB: inputs["account-pk-b.bin"]}
	r, c, err := originals(batch.PublicKey{PKA: b.PKA, PKB: b.PKB}, account)
	if err != nil || !bytes.Equal(r, inputs["registration-original.json"]) || !bytes.Equal(c, inputs["challenge-original.json"]) || string(inputs["owner.txt"]) != fixtureOwner ||
		!bytes.Equal(b.NetworkID, bytes.Repeat([]byte{0xab}, 32)) || len(account.PKA) != 2592 || len(account.PKB) != 64 || bytes.Equal(b.PKA, account.PKA) || bytes.Equal(b.PKB, account.PKB) {
		return errors.New("original synthetic public input or independent account pair changed")
	}
	var result cResult
	d := json.NewDecoder(bytes.NewReader(inputs["C-RESULT.json"]))
	d.DisallowUnknownFields()
	if err := d.Decode(&result); err != nil {
		return err
	}
	var tail any
	if err := d.Decode(&tail); err != io.EOF {
		return errors.New("C result trailing JSON")
	}
	encoded, err := canonical(result)
	if err != nil || !bytes.Equal(append(encoded, '\n'), inputs["C-RESULT.json"]) || result.Cases != boundaryCases || result.Version != 4 || !result.DataOnly || result.Authority ||
		result.Registration.RC != 0 || result.Challenge.RC != 0 || result.Registration.Cleanup != 2 || result.Challenge.Cleanup != 2 ||
		result.Registration.Bytes != uint64(len(inputs["registration-member.bin"])) || result.Challenge.Bytes != uint64(len(inputs["challenge-member.bin"])) {
		return errors.New("exact C result or finite real invocation count differs")
	}
	rMessage, err := batch.BuildProductSessionDeviceRegistrationV4Message(r, b)
	if err != nil {
		return err
	}
	cMessage, err := batch.BuildProductSessionDeviceChallengeV4Message(c, r, b)
	if err != nil {
		return err
	}
	for i, domain := range []struct {
		wire, message []byte
		purpose       string
	}{
		{inputs["registration-member.bin"], rMessage, batch.ProductSessionDeviceRegistrationPurpose},
		{inputs["challenge-member.bin"], cMessage, batch.ProductSessionDeviceChallengePurpose},
	} {
		decoded, decodeErr := batch.DecodeMember(domain.wire)
		if decodeErr != nil || decoded.Certificate.Purpose != domain.purpose || !bytes.Equal(decoded.Certificate.ChainID, b.NetworkID) || decoded.Certificate.Owner != b.Owner ||
			!bytes.Equal(decoded.Certificate.PKA, b.PKA) || !bytes.Equal(decoded.Certificate.PKB, b.PKB) {
			return errors.New("actual C Member changed independent complete expected context")
		}
		var member batch.Member
		if i == 0 {
			member, err = batch.InspectProductSessionDeviceRegistrationV4Member(domain.wire, r, b)
		} else {
			member, err = batch.InspectProductSessionDeviceChallengeV4Member(domain.wire, c, r, b)
		}
		if err != nil {
			return err
		}
		if !bytes.Equal(member.Message, domain.message) || member.Certificate.N != 1 || member.Index != 0 || len(member.PathA) != 0 || len(member.PathB) != 0 {
			return errors.New("actual C Member changed fixed E5/N1/index/path")
		}
		if err := verifyMath(domain.wire, b, domain.purpose); err != nil {
			return fmt.Errorf("independent public full AND failed: %w", err)
		}
		for _, part := range []string{"A", "B", "purpose"} {
			bad, err := batch.DecodeMember(domain.wire)
			if err != nil {
				return err
			}
			switch part {
			case "A":
				bad.Certificate.SigmaA[0] ^= 1
			case "B":
				bad.Certificate.SigmaB[0] ^= 1
			default:
				bad.Certificate.Purpose = "TX-BATCH"
			}
			wire, err := batch.EncodeMember(bad)
			if err != nil || verifyMath(wire, b, domain.purpose) == nil {
				return errors.New("independent verifier did not reject corruption or purpose")
			}
		}
		wrong := b
		wrong.PKB = bytes.Clone(b.PKB)
		wrong.PKB[0] ^= 1
		if verifyMath(domain.wire, wrong, domain.purpose) == nil {
			return errors.New("independent verifier accepted a different full pair")
		}
	}
	interop := map[string]any{"version": "YNX-PRODUCT-DEVICE-V4-CABI-PUBLIC-INTEROP/v1", "classification": "data", "syntheticOnly": true,
		"networkId": hex.EncodeToString(b.NetworkID), "owner": fixtureOwner,
		"devicePkA": hex.EncodeToString(b.PKA), "devicePkB": hex.EncodeToString(b.PKB), "accountPkA": hex.EncodeToString(account.PKA), "accountPkB": hex.EncodeToString(account.PKB),
		"registrationOriginalBase64Url": base64.RawURLEncoding.EncodeToString(r), "challengeOriginalBase64Url": base64.RawURLEncoding.EncodeToString(c),
		"registrationMessageOriginalBase64Url": base64.RawURLEncoding.EncodeToString(rMessage), "challengeMessageOriginalBase64Url": base64.RawURLEncoding.EncodeToString(cMessage),
		"registrationMemberOriginalBase64Url": base64.RawURLEncoding.EncodeToString(inputs["registration-member.bin"]), "challengeMemberOriginalBase64Url": base64.RawURLEncoding.EncodeToString(inputs["challenge-member.bin"]),
		"memberCount": 1, "memberIndex": 0, "independentGoANDVerified": true, "sdkJSInteropExecuted": false,
		"authorityGranted": false, "RootAdmission": false, "SourceAdmission": false, "NativeAdmission": false, "registered": false, "current": false, "sessionAuthorized": false}
	receipt := map[string]any{"version": "YNX-PRODUCT-DEVICE-V4-CABI-PUBLIC-RECEIPT/v1", "classification": "data", "syntheticOnly": true,
		"actualCABIExecuted": true, "independentGoANDVerified": true, "sdkJSInteropExecuted": false, "boundaryCases": boundaryCases, "successfulCSignatures": 2,
		"registrationPurpose": batch.ProductSessionDeviceRegistrationPurpose, "challengePurpose": batch.ProductSessionDeviceChallengePurpose,
		"memberCount": 1, "memberIndex": 0, "registrationOriginalSHA256": digest(r), "challengeOriginalSHA256": digest(c),
		"registrationMessageSHA256": digest(rMessage), "challengeMessageSHA256": digest(cMessage),
		"registrationMemberSHA256": digest(inputs["registration-member.bin"]), "registrationMemberBytes": len(inputs["registration-member.bin"]),
		"challengeMemberSHA256": digest(inputs["challenge-member.bin"]), "challengeMemberBytes": len(inputs["challenge-member.bin"]),
		"corruptSignatureBranchesRejected": 4, "crossPurposesRejected": 2, "wrongFullPairsRejected": 2,
		"authorityGranted": false, "RootAdmission": false, "SourceAdmission": false, "NativeAdmission": false, "registered": false, "current": false, "sessionAuthorized": false, "installed": false, "publicDeployment": false}
	for _, output := range []struct {
		name string
		v    any
	}{{"PUBLIC-INTEROP.json", interop}, {"PUBLIC-RECEIPT.json", receipt}} {
		raw, err := json.MarshalIndent(output.v, "", "  ")
		if err != nil {
			return err
		}
		if err := writeExclusive(directory, output.name, append(raw, '\n')); err != nil {
			return err
		}
	}
	fmt.Println("PRODUCT_DEVICE_V4_CABI_INDEPENDENT_AND_DATA_ONLY")
	return nil
}

func main() {
	if len(os.Args) != 3 || !filepath.IsAbs(os.Args[2]) || os.Args[1] != "generate" && os.Args[1] != "verify" {
		fmt.Fprintln(os.Stderr, "generate|verify and canonical absolute synthetic directory required")
		os.Exit(2)
	}
	var err error
	if os.Args[1] == "generate" {
		err = generate(os.Args[2])
	} else {
		err = verify(os.Args[2])
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "product-device-v4 synthetic C fixture failed:", err)
		os.Exit(1)
	}
}
