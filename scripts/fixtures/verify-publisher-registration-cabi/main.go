// CI-only public fixture and independent AND verifier. Publisher private C
// output never enters this process or disk; only the separate synthetic
// custodian DER files exist until the calling script's EXIT cleanup.
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

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	batch "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const atMS, custodianHeight = uint64(1001), uint64(9007199254740993)

func writeExclusive(path string, raw []byte) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	n, writeErr := f.Write(raw)
	if writeErr == nil && n != len(raw) {
		writeErr = io.ErrShortWrite
	}
	return errors.Join(writeErr, f.Sync(), f.Close())
}

func readBounded(directory, name string, maximum int) ([]byte, error) {
	p := filepath.Join(directory, name)
	s, err := os.Lstat(p)
	if err != nil || !s.Mode().IsRegular() || s.Mode().Perm() != 0600 || s.Size() < 1 || s.Size() > int64(maximum) {
		return nil, errors.New("bounded private synthetic/public fixture file required")
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	after, err := os.Lstat(p)
	if err != nil || !os.SameFile(s, after) || s.Size() != after.Size() || !s.ModTime().Equal(after.ModTime()) || len(raw) != int(s.Size()) {
		return nil, errors.New("fixture input changed")
	}
	return raw, nil
}

func digest(raw []byte) string { h := sha256.Sum256(raw); return hex.EncodeToString(h[:]) }

func prepare(directory string) error {
	if err := os.Mkdir(directory, 0700); err != nil {
		return err
	}
	account, err := accountaddress.Encode("0x" + strings.Repeat("11", 20))
	if err != nil {
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
	for name, raw := range map[string][]byte{"account.txt": []byte(account), "custodian-pk-a.bin": public.PKA, "custodian-pk-b.bin": public.PKB,
		"SYNTHETIC-ONLY-custodian-a.der": material.PKCS8A, "SYNTHETIC-ONLY-custodian-b.der": material.PKCS8B} {
		if err := writeExclusive(filepath.Join(directory, name), raw); err != nil {
			return err
		}
	}
	return nil
}

func publisher(directory string) (batch.ArtifactPublisherRegistration, []byte, error) {
	r, err := readBounded(directory, "publicOriginal.bin", 8192)
	if err != nil {
		return batch.ArtifactPublisherRegistration{}, nil, err
	}
	p, err := batch.DecodeArtifactPublisherRegistration(r)
	account, e := accountaddress.Encode("0x" + strings.Repeat("11", 20))
	if err != nil || e != nil || !bytes.Equal(p.NetworkID, bytes.Repeat([]byte{0x42}, 32)) || p.SubjectOwner != "0x"+strings.Repeat("11", 20) ||
		p.Account != account || p.ProjectID != "PUBLIC-project" || p.PublisherID != "PUBLIC-publisher" || p.PublisherKeyVersion != "1" {
		return p, nil, errors.New("actual C generation changed independently fixed publisher labels")
	}
	return p, r, nil
}

func originals(directory string) error {
	pub, r, err := publisher(directory)
	if err != nil {
		return err
	}
	p, err := json.Marshal(batch.ProjectControlPrincipal{Account: pub.Account, DeviceID: "PUBLIC-device", SessionRef: "PUBLIC-session", CurrentRef: "PUBLIC-publisher-current",
		AccountGeneration: ^uint64(0), SessionGeneration: 9007199254740993, ExpiresMS: 60000})
	if err != nil {
		return err
	}
	c, err := json.Marshal(batch.ProjectControlCommand{RequestID: "PUBLIC-request", Action: "project.publisher", ProjectID: pub.ProjectID, SubjectAccount: pub.Account,
		PublisherID: pub.PublisherID, ExpectedRevision: 7, GrantExpiresMS: 60000, ExpiresMS: 60000, PublicOriginalSHA256: digest(r)})
	if err != nil {
		return err
	}
	// The struct declaration's JSON tags are the original sorted body16 order.
	b := batch.PublisherRegistrationBody{Account: pub.Account, CallerIdentity: "PUBLIC-native", CommandSHA256: digest(c), CustodyCurrentRef: "PUBLIC-custodian-current",
		ExpiresAtMS: 20000, IssuedAtMS: 1000, KeyRole: batch.ArtifactPublisherKeyRole, Nonce: base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{3}, 32)),
		PrincipalSHA256: digest(p), ProjectID: pub.ProjectID, PublicSHA256: digest(r), PublisherID: pub.PublisherID, PublisherKeyVersion: pub.PublisherKeyVersion,
		RegistrationRef: "PUBLIC-independent-registration-ref", SourceCurrentRef: "PUBLIC-publisher-current", Version: batch.PublisherRegistrationBodyVersion}
	br, err := json.Marshal(b)
	if err != nil {
		return err
	}
	if _, err := batch.BuildPublisherRegistrationPoPMessage(r, p, c, br, pub, atMS); err != nil {
		return err
	}
	for name, raw := range map[string][]byte{"principal.json": p, "command.json": c, "registration.json": br} {
		if err := writeExclusive(filepath.Join(directory, name), raw); err != nil {
			return err
		}
	}
	return nil
}

func custodian(directory string) (batch.PublisherRegistrationCustodianBinding, error) {
	a, err := readBounded(directory, "custodian-pk-a.bin", batch.PublicKeyASize)
	if err != nil {
		return batch.PublisherRegistrationCustodianBinding{}, err
	}
	b, err := readBounded(directory, "custodian-pk-b.bin", batch.PublicKeyBSize)
	return batch.PublisherRegistrationCustodianBinding{NetworkID: bytes.Repeat([]byte{0x42}, 32), Owner: "0x" + strings.Repeat("22", 20),
		KeyVersion: "18446744073709551615", ExecutionHeight: "9007199254740993", CallerIdentity: "PUBLIC-native", SourceCurrentRef: "PUBLIC-custodian-current", PKA: a, PKB: b}, err
}

func mathematicalVerifier(network []byte, owner, purpose, version string, a, b []byte, height uint64) (*batch.Verifier, error) {
	return batch.NewVerifier(batch.VerifierOptions{ChainID: network, Purpose: purpose, Optimized: true,
		ResolveTrustedOwner: func(r batch.TrustRequest) (batch.Registration, error) {
			if !bytes.Equal(r.ChainID, network) || r.Owner != owner || r.Purpose != purpose || r.Height != height {
				return batch.Registration{}, errors.New("independent synthetic verifier context differs")
			}
			return batch.Registration{AlgorithmVersion: batch.Version, ChainID: bytes.Clone(network), Owner: owner, Purpose: purpose, PKA: bytes.Clone(a), PKB: bytes.Clone(b), PolicyRevision: version, Enabled: true, ActiveFrom: height}, nil
		}})
}

func verify(directory string) error {
	pub, r, err := publisher(directory)
	if err != nil {
		return err
	}
	cu, err := custodian(directory)
	if err != nil || bytes.Equal(cu.PKA, pub.PKA) || bytes.Equal(cu.PKB, pub.PKB) {
		return errors.New("synthetic publisher and independently generated custodian pair not distinct")
	}
	inputs := make(map[string][]byte)
	for _, n := range []string{"principal.json", "command.json", "registration.json", "popMemberOriginal.bin", "custodianMemberOriginal.bin", "C-BOUNDARY-CASES.txt"} {
		inputs[n], err = readBounded(directory, n, 131072)
		if err != nil {
			return err
		}
	}
	p, c, b, pop, proof := inputs["principal.json"], inputs["command.json"], inputs["registration.json"], inputs["popMemberOriginal.bin"], inputs["custodianMemberOriginal.bin"]
	if !bytes.Contains(p, []byte(`"AccountGeneration":18446744073709551615`)) || !bytes.Contains(p, []byte(`"SessionGeneration":9007199254740993`)) {
		return errors.New("full original Go principal uint64 tokens changed")
	}
	pm, err := batch.InspectPublisherRegistrationPoPMember(pop, pub, r, p, c, b, atMS)
	if err != nil {
		return err
	}
	cm, err := batch.InspectPublisherRegistrationCustodianMember(proof, cu, pub, r, p, c, b, pop, atMS)
	if err != nil {
		return err
	}
	wantPoP, err := batch.EncodeFields([]byte(batch.PublisherRegistrationPoPVersion), []byte(batch.Version), []byte(batch.Suite), []byte(batch.PublisherRegistrationPoPPurpose),
		pub.NetworkID, []byte(pub.SubjectOwner), []byte(pub.PublisherKeyVersion), r, b)
	if err != nil || !bytes.Equal(pm.Message, wantPoP) {
		return errors.New("actual C PoP differs from fixed SDK E9")
	}
	wantCustodian, err := batch.EncodeFields([]byte(batch.PublisherRegistrationCustodianVersion), []byte(batch.Version), []byte(batch.Suite), []byte(batch.PublisherRegistrationCustodianPurpose),
		cu.NetworkID, []byte(cu.Owner), []byte(cu.KeyVersion), []byte(cu.ExecutionHeight), p, c, b, []byte(digest(pop)))
	if err != nil || !bytes.Equal(cm.Message, wantCustodian) {
		return errors.New("actual C custodian differs from E12 or full raw PoP hash")
	}
	checks := 0
	for _, entry := range []struct {
		wire, network           []byte
		owner, purpose, version string
		a, b                    []byte
		height                  uint64
	}{{pop, pub.NetworkID, pub.SubjectOwner, batch.PublisherRegistrationPoPPurpose, pub.PublisherKeyVersion, pub.PKA, pub.PKB, 0},
		{proof, cu.NetworkID, cu.Owner, batch.PublisherRegistrationCustodianPurpose, cu.KeyVersion, cu.PKA, cu.PKB, custodianHeight}} {
		v, err := mathematicalVerifier(entry.network, entry.owner, entry.purpose, entry.version, entry.a, entry.b, entry.height)
		if err != nil {
			return err
		}
		defer v.Clear()
		if v.VerifyOne(entry.wire, entry.height) != nil {
			return errors.New("actual C member failed independent dual AND verifier")
		}
		for _, branch := range []string{"A", "B", "purpose"} {
			m, err := batch.DecodeMember(entry.wire)
			if err != nil {
				return err
			}
			switch branch {
			case "A":
				m.Certificate.SigmaA[0] ^= 1
			case "B":
				m.Certificate.SigmaB[0] ^= 1
			default:
				m.Certificate.Purpose = "TX-BATCH"
			}
			bad, err := batch.EncodeMember(m)
			if err != nil {
				return err
			}
			if v.VerifyOne(bad, entry.height) == nil {
				return errors.New("tampered branch or cross-purpose member accepted")
			}
			var inspected error
			if entry.purpose == batch.PublisherRegistrationPoPPurpose {
				_, inspected = batch.InspectPublisherRegistrationPoPMember(bad, pub, r, p, c, b, atMS)
			} else {
				_, inspected = batch.InspectPublisherRegistrationCustodianMember(bad, cu, pub, r, p, c, b, pop, atMS)
			}
			if (branch == "purpose") != (inspected != nil) {
				return errors.New("typed purpose check or signature-only negative did not reach its intended boundary")
			}
			checks++
		}
	}
	wrong := pub
	wrong.PKA = bytes.Clone(pub.PKA)
	wrong.PKA[0] ^= 1
	if _, err := batch.InspectPublisherRegistrationPoPMember(pop, wrong, r, p, c, b, atMS); err == nil {
		return errors.New("wrong independently selected publisher accepted")
	}
	checks++
	changedMember, err := batch.DecodeMember(pop)
	if err != nil {
		return err
	}
	changedMember.Certificate.SigmaB[0] ^= 1
	changedPop, err := batch.EncodeMember(changedMember)
	if err != nil {
		return err
	}
	if _, err := batch.InspectPublisherRegistrationCustodianMember(proof, cu, pub, r, p, c, b, changedPop, atMS); err == nil {
		return errors.New("E12 did not bind entire raw PoP")
	}
	checks++
	wrongCustodian := cu
	wrongCustodian.PKB = bytes.Clone(pub.PKB)
	if _, err := batch.InspectPublisherRegistrationCustodianMember(proof, wrongCustodian, pub, r, p, c, b, pop, atMS); err == nil {
		return errors.New("publisher branch used as custodian accepted")
	}
	checks++
	countText := strings.TrimSpace(string(inputs["C-BOUNDARY-CASES.txt"]))
	count, err := strconv.Atoi(countText)
	if err != nil || strconv.Itoa(count) != countText || count < 20 {
		return errors.New("real C boundary controls missing")
	}
	interop, err := json.Marshal(map[string]any{"version": "YNX-PUBLISHER-REGISTRATION-CABI-PUBLIC-INTEROP/v1", "syntheticOnly": true,
		"publicOriginalBase64Url": base64.RawURLEncoding.EncodeToString(r), "principalOriginalBase64Url": base64.RawURLEncoding.EncodeToString(p),
		"commandOriginalBase64Url": base64.RawURLEncoding.EncodeToString(c), "registrationOriginalBase64Url": base64.RawURLEncoding.EncodeToString(b),
		"popMemberOriginalBase64Url": base64.RawURLEncoding.EncodeToString(pop), "custodianMemberOriginalBase64Url": base64.RawURLEncoding.EncodeToString(proof),
		"custodian": cu, "observedAtMs": atMS, "authorityGranted": false})
	if err != nil {
		return err
	}
	receipt, err := json.Marshal(map[string]any{"version": "YNX-PUBLISHER-REGISTRATION-CABI-PUBLIC-RECEIPT/v1", "syntheticOnly": true,
		"actualCGeneration": true, "actualCPoP": true, "actualCCustodian": true, "independentANDVerified": true, "fixedE9E12Verified": true,
		"publicOriginalSHA256": digest(r), "popMemberSHA256": digest(pop), "custodianMemberSHA256": digest(proof), "cBoundaryCases": count, "goNegativeCases": checks,
		"publisherPrivateOutputPersisted": false, "SourceAdmission": false, "registeredCurrentCustodian": false, "authorityGranted": false, "installed": false})
	if err != nil {
		return err
	}
	if err := writeExclusive(filepath.Join(directory, "PUBLIC-INTEROP.json"), append(interop, '\n')); err != nil {
		return err
	}
	if err := writeExclusive(filepath.Join(directory, "PUBLIC-RECEIPT.json"), append(receipt, '\n')); err != nil {
		return err
	}
	fmt.Printf("YNX_PUBLISHER_REGISTRATION_CABI_INDEPENDENT_AND_PASS cCases=%d goNegatives=%d authority=false\n", count, checks)
	return nil
}

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "fixed fixture mode and directory required")
		os.Exit(1)
	}
	var err error
	switch os.Args[1] {
	case "prepare":
		err = prepare(os.Args[2])
	case "originals":
		err = originals(os.Args[2])
	case "verify":
		err = verify(os.Args[2])
	default:
		err = errors.New("unknown fixture mode")
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
