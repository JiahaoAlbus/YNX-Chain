// Independent CI-only consumer of the actual C creator's fresh test material.
// Never use this fixture's file transport or synthetic resolver for real keys.
package main

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
	"strings"
	"syscall"

	batch "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

type privateRecord struct {
	path string
	info os.FileInfo
}
type publicPin struct {
	Bytes  int    `json:"bytes"`
	SHA256 string `json:"sha256"`
}

func pin(raw []byte) publicPin {
	h := sha256.Sum256(raw)
	return publicPin{len(raw), hex.EncodeToString(h[:])}
}

func readExact(path string, size int) ([]byte, os.FileInfo, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, nil, err
	}
	metadata, ok := info.Sys().(*syscall.Stat_t)
	if !ok || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() != int64(size) || metadata.Nlink != 1 || int(metadata.Uid) != os.Geteuid() {
		return nil, nil, errors.New("exact private test file metadata required")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return nil, nil, errors.New("fixture open identity changed")
	}
	raw := make([]byte, size)
	if _, err := io.ReadFull(f, raw); err != nil {
		clear(raw)
		return nil, nil, errors.New("fixture exact read failed")
	}
	var extra [1]byte
	if n, err := f.Read(extra[:]); n != 0 || err != io.EOF {
		clear(raw)
		return nil, nil, errors.New("fixture grew during read")
	}
	after, err := os.Lstat(path)
	if err != nil || !os.SameFile(info, after) || info.Size() != after.Size() || !info.ModTime().Equal(after.ModTime()) {
		clear(raw)
		return nil, nil, errors.New("fixture changed during read")
	}
	return raw, info, nil
}

func removeExact(records []privateRecord) error {
	for _, record := range records {
		current, err := os.Lstat(record.path)
		if err != nil || !os.SameFile(record.info, current) || current.Size() != record.info.Size() || !current.ModTime().Equal(record.info.ModTime()) {
			return errors.New("private test file identity changed; preserve it")
		}
		if err := os.Remove(record.path); err != nil {
			return err
		}
	}
	return nil
}

func registration(public batch.PublicKey) ([]byte, batch.ProductSessionDeviceV4Binding, error) {
	expected := batch.ProductSessionDeviceV4Binding{NetworkID: bytes.Repeat([]byte{0xab}, 32), Owner: "0x" + strings.Repeat("11", 20),
		PKA: bytes.Clone(public.PKA), PKB: bytes.Clone(public.PKB)}
	value := map[string]any{"version": "4", "registrationId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "networkId": hex.EncodeToString(expected.NetworkID),
		"canonicalOwner": expected.Owner, "productId": "developer", "clientId": "com.ynx.developer.macos", "platform": "macos",
		"applicationId": "com.ynx.developer", "bundleId": "com.ynx.developer", "packageId": nil, "origin": "https://developer.ynxweb4.com",
		"callback": "ynxdeveloper://callback", "deviceId": "SYNTHETIC-C-CREATED-v4", "generation": "1", "revision": "1",
		"pkA": hex.EncodeToString(public.PKA), "pkB": hex.EncodeToString(public.PKB), "registeredAt": "2026-10-31T08:00:00.000Z",
		"expiresAt": "2026-10-31T09:00:00.000Z", "revokedAt": nil}
	raw, err := json.Marshal(value)
	return raw, expected, err
}

func verify(directory string) (result error) {
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		return errors.New("fresh0700 test case required")
	}
	var records []privateRecord
	defer func() {
		if len(records) > 0 {
			if err := removeExact(records); result == nil {
				result = err
			}
		}
	}()
	var publics []batch.PublicKey
	var cases []string
	var members [][]byte
	rejected := func(name string, err error) error {
		if err == nil {
			return errors.New("negative unexpectedly accepted: " + name)
		}
		cases = append(cases, name)
		return nil
	}
	for _, prefix := range []string{"first", "second"} {
		material := batch.KeyMaterial{}
		load := func(name string, size int, private bool) ([]byte, error) {
			raw, identity, err := readExact(filepath.Join(directory, name), size)
			if err == nil && private {
				records = append(records, privateRecord{filepath.Join(directory, name), identity})
			}
			return raw, err
		}
		material.PKCS8A, err = load("SYNTHETIC-ONLY-"+prefix+"-a.der", 54, true)
		if err != nil {
			return err
		}
		material.PKCS8B, err = load("SYNTHETIC-ONLY-"+prefix+"-b.der", 150, true)
		if err != nil {
			material.Clear()
			return err
		}
		material.PKA, err = load(prefix+"-pk-a.bin", 2592, false)
		if err != nil {
			material.Clear()
			return err
		}
		material.PKB, err = load(prefix+"-pk-b.bin", 64, false)
		if err != nil {
			material.Clear()
			return err
		}
		key, public, err := batch.ImportKeyMaterial(material)
		if err != nil {
			material.Clear()
			return errors.New("actual C keypair full DER derivation rejected")
		}
		original, expected, err := registration(public)
		if err != nil {
			key.Destroy()
			material.Clear()
			return err
		}
		message, err := batch.BuildProductSessionDeviceRegistrationV4Message(original, expected)
		if err != nil {
			key.Destroy()
			material.Clear()
			return err
		}
		purpose := "PRODUCT-SESSION-DEVICE-REGISTRATION"
		signed, err := batch.BatchSign(key, batch.Metadata{ChainID: expected.NetworkID, Owner: expected.Owner, Purpose: purpose}, [][]byte{message}, batch.SignOptions{Optimized: true})
		key.Destroy()
		material.Clear()
		if err != nil {
			return err
		}
		member, err := batch.Extract(signed, 0)
		if err != nil {
			signed.Discard()
			return err
		}
		wire, err := batch.EncodeMember(member)
		signed.Discard()
		if err != nil {
			return err
		}
		newVerifier := func(pka, pkb []byte) (*batch.Verifier, error) {
			return batch.NewVerifier(batch.VerifierOptions{ChainID: expected.NetworkID, Purpose: purpose, Optimized: true,
				ResolveTrustedOwner: func(request batch.TrustRequest) (batch.Registration, error) {
					if !bytes.Equal(request.ChainID, expected.NetworkID) || request.Owner != expected.Owner || request.Purpose != purpose || request.Height != 0 {
						return batch.Registration{}, errors.New("synthetic mathematical binding differs")
					}
					return batch.Registration{AlgorithmVersion: batch.Version, Owner: expected.Owner, Purpose: purpose, PolicyRevision: "SYNTHETIC-C-CREATOR-ONLY",
						ChainID: expected.NetworkID, PKA: pka, PKB: pkb, Enabled: true}, nil
				}})
		}
		v, err := newVerifier(public.PKA, public.PKB)
		if err != nil {
			return err
		}
		if err = v.VerifyOne(wire, 0); err != nil {
			return errors.New("C-created pair independent dual AND failed")
		}
		if _, err = batch.InspectProductSessionDeviceRegistrationV4Member(wire, original, expected); err != nil {
			return err
		}
		for _, branch := range []string{"A", "B"} {
			bad, err := batch.DecodeMember(wire)
			if err != nil {
				return err
			}
			if branch == "A" {
				bad.Certificate.SigmaA[0] ^= 1
			} else {
				bad.Certificate.SigmaB[0] ^= 1
			}
			changed, err := batch.EncodeMember(bad)
			if err != nil {
				return err
			}
			if err = rejected(prefix+"-signature-"+branch, v.VerifyOne(changed, 0)); err != nil {
				return err
			}
		}
		other := batch.ProductSessionDeviceV4Binding{NetworkID: bytes.Clone(expected.NetworkID), Owner: expected.Owner, PKA: bytes.Clone(public.PKA), PKB: bytes.Clone(public.PKB)}
		other.PKB[0] ^= 1
		_, err = batch.InspectProductSessionDeviceRegistrationV4Member(wire, original, other)
		if err = rejected(prefix+"-full-pair-binding", err); err != nil {
			return err
		}
		wrong, err := newVerifier(public.PKA, other.PKB)
		if err != nil {
			return err
		}
		if err = rejected(prefix+"-full-pair-math", wrong.VerifyOne(wire, 0)); err != nil {
			return err
		}
		bad, err := batch.DecodeMember(wire)
		if err != nil {
			return err
		}
		bad.Certificate.Purpose = "AUTH-PROTECTED-KEY-CALL"
		changed, err := batch.EncodeMember(bad)
		if err != nil {
			return err
		}
		if err = rejected(prefix+"-wrong-purpose", v.VerifyOne(changed, 0)); err != nil {
			return err
		}
		publics = append(publics, public)
		members = append(members, wire)
	}
	if bytes.Equal(publics[0].PKA, publics[1].PKA) || bytes.Equal(publics[0].PKB, publics[1].PKB) {
		return errors.New("creator reused a device branch")
	}
	raw, err := os.ReadFile(filepath.Join(directory, "C-RESULT.json"))
	if err != nil {
		return err
	}
	var c struct {
		Version       string `json:"version"`
		Cases         int    `json:"cases"`
		SyntheticOnly bool   `json:"syntheticOnly"`
		Authority     bool   `json:"authority"`
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err = d.Decode(&c); err != nil || c.Version != "YNX-PRODUCT-DEVICE-KEYPAIR-C-RESULT/v4" || c.Cases != 39 || !c.SyntheticOnly || c.Authority {
		return errors.New("real C boundary cases missing")
	}
	if err = removeExact(records); err != nil {
		return err
	}
	records = nil
	receipt := map[string]any{"version": "YNX-PRODUCT-DEVICE-KEYPAIR-PUBLIC-RESULT/v4", "purpose": "product-session-device-v4", "syntheticOnly": true,
		"actualCCreator": true, "cCases": c.Cases, "independentFullPairImport": true, "actualDualANDVerified": true, "typedRegistrationInspected": true,
		"negativeCases": cases, "privateTestFilesRemoved": true, "logicalCleanupOnly": true, "physicalEraseClaimed": false,
		"authProvisioningVerified": false, "visibleApprovalVerified": false, "osCustodyImported": false, "rootGrant": false,
		"publicPins": map[string]publicPin{"firstA": pin(publics[0].PKA), "firstB": pin(publics[0].PKB), "secondA": pin(publics[1].PKA), "secondB": pin(publics[1].PKB),
			"firstMember": pin(members[0]), "secondMember": pin(members[1])}}
	out, err := json.MarshalIndent(receipt, "", "  ")
	if err != nil {
		return err
	}
	out = append(out, '\n')
	f, err := os.OpenFile(filepath.Join(directory, "PUBLIC-RESULT.json"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if _, err = f.Write(out); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	fmt.Printf("YNX_PRODUCT_DEVICE_KEYPAIR_INTEROP_PASS C=%d GoNegative=%d actualFullAND=true authority=false\n", c.Cases, len(cases))
	return nil
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: independent-fixture CASE_DIR")
		os.Exit(2)
	}
	if err := verify(os.Args[1]); err != nil {
		fmt.Fprintln(os.Stderr, "PRODUCT_DEVICE_KEYPAIR_INTEROP_REFUSED", err)
		os.Exit(1)
	}
}
