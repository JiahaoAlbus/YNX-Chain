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
	"time"

	batch "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	fixtureOwner = "0x1111111111111111111111111111111111111111"
	// Exact external C calls, including one successful fixed-purpose signature.
	fixtureBoundaryCases = 77
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

func canonical(v any) []byte {
	raw, err := json.Marshal(v)
	if err != nil {
		panic("public fixture JSON")
	}
	return raw
}
func digest(raw []byte) string { h := sha256.Sum256(raw); return hex.EncodeToString(h[:]) }
func inputs(public batch.PublicKey) (map[string][]byte, batch.ProductPairPendingOriginalQueryBinding) {
	actor := map[string]any{"networkId": strings.Repeat("ab", 32), "canonicalOwner": fixtureOwner, "productId": "developer", "clientId": "com.ynx.developer.macos", "platform": "macos", "applicationId": "com.ynx.developer", "bundleId": "com.ynx.developer", "packageId": nil, "origin": "https://developer.ynxweb4.com", "callback": "ynxdeveloper://callback", "deviceId": "PUBLIC-pending-device"}
	actorDigest := sha256.Sum256(canonical(actor))
	reg := map[string]any{}
	for k, v := range actor {
		reg[k] = v
	}
	for k, v := range map[string]any{"version": "4", "registrationId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "revision": "18446744073709551615", "generation": "18446744073709551615", "pkA": hex.EncodeToString(public.PKA), "pkB": hex.EncodeToString(public.PKB), "registeredAt": "2026-11-01T07:00:00.000Z", "expiresAt": "2026-11-01T09:00:00.000Z", "revokedAt": nil} {
		reg[k] = v
	}
	registration := canonical(reg)
	post := canonical(map[string]any{"operationId": strings.Repeat("a", 64), "registrationOriginal": string(registration), "registrationMember": "PUBLIC-syntax-only-no-grant", "request": map[string]any{}, "approval": map[string]any{}})
	query := canonical(map[string]any{"version": "1", "operationId": strings.Repeat("a", 64), "originalRequestBodyDigest": digest(post)})
	instant, _ := time.Parse(time.RFC3339Nano, "2026-11-01T08:00:00.000Z")
	at := uint64(instant.UnixMilli())
	b := batch.ProductPairPendingOriginalQueryBinding{NetworkID: bytes.Repeat([]byte{0xab}, 32), Owner: fixtureOwner, PKA: public.PKA, PKB: public.PKB, ActorDigest: hex.EncodeToString(actorDigest[:]), Origin: "https://wallet-auth.ynxweb4.com", Nonce: strings.Repeat("n", 43), IssuedAt: "2026-11-01T08:00:00.000Z", ExpiresAt: "2026-11-01T08:00:30.000Z", AtMS: at, SourceIssuedAtMS: at - 60000, SourceExpiresAtMS: at + 60000}
	return map[string][]byte{"query.json": query, "registration.json": registration, "original-pair.json": post, "network.bin": b.NetworkID, "owner.txt": []byte(b.Owner), "pk-a.bin": public.PKA, "pk-b.bin": public.PKB, "actor.bin": actorDigest[:], "origin.txt": []byte(b.Origin), "nonce.txt": []byte(b.Nonce), "issued.txt": []byte(b.IssuedAt), "expires.txt": []byte(b.ExpiresAt)}, b
}
func prepare(directory string) error {
	if err := os.Mkdir(directory, 0700); err != nil {
		return err
	}
	if err := privateDirectory(directory); err != nil {
		return err
	}
	key, pub, err := batch.KeyGen()
	if err != nil {
		return err
	}
	defer key.Destroy()
	material, err := batch.ExportKeyMaterial(key)
	if err != nil {
		return err
	}
	defer material.Clear()
	files, b := inputs(pub)
	if _, err = batch.BuildProductPairPendingOriginalQueryMessage(files["query.json"], files["registration.json"], files["original-pair.json"], b); err != nil {
		return err
	}
	files["SYNTHETIC-ONLY-a.der"] = material.PKCS8A
	files["SYNTHETIC-ONLY-b.der"] = material.PKCS8B
	for name, raw := range files {
		if err := writeExclusive(filepath.Join(directory, name), raw); err != nil {
			return err
		}
	}
	return nil
}
func verify(directory string) error {
	pa, err := readBounded(directory, "pk-a.bin", 2592)
	if err != nil {
		return err
	}
	pb, err := readBounded(directory, "pk-b.bin", 64)
	if err != nil {
		return err
	}
	if len(pa) != 2592 || len(pb) != 64 {
		return errors.New("public pair lengths")
	}
	files, b := inputs(batch.PublicKey{PKA: pa, PKB: pb})
	for name, want := range files {
		got, err := readBounded(directory, name, len(want))
		if err != nil || !bytes.Equal(got, want) {
			return errors.New("external C changed fixed independent public DATA")
		}
	}
	count, err := readBounded(directory, "C-BOUNDARY-CASES.txt", 16)
	if err != nil {
		return err
	}
	if string(count) != strconv.Itoa(fixtureBoundaryCases)+"\n" {
		return errors.New("external C boundary count")
	}
	wire, err := readBounded(directory, "memberOriginal.bin", 98304)
	if err != nil {
		return err
	}
	inspect := func(raw []byte, binding batch.ProductPairPendingOriginalQueryBinding, post []byte) error {
		_, err := batch.InspectProductPairPendingOriginalQueryMember(raw, files["query.json"], files["registration.json"], post, binding)
		return err
	}
	if err = inspect(wire, b, files["original-pair.json"]); err != nil {
		return fmt.Errorf("external C independent AND: %w", err)
	}
	actor, _ := hex.DecodeString(b.ActorDigest)
	// Spell out fixed E13 independently of the signing builder and returned data.
	want, err := batch.EncodeFields([]byte("YNX/PRODUCT-PAIR/PENDING-ORIGINAL-QUERY/V1"), batch.U32(1), b.NetworkID, []byte(b.Owner), actor, []byte(b.Origin), []byte("POST"), []byte("/v4/product-pairs/original-query"), []byte(b.Nonce), []byte(b.IssuedAt), []byte(b.ExpiresAt), files["query.json"], files["registration.json"])
	if err != nil {
		return err
	}
	member, err := batch.DecodeMember(wire)
	if err != nil || !bytes.Equal(member.Message, want) || member.Certificate.N != 1 || member.Index != 0 || len(member.PathA) != 0 || len(member.PathB) != 0 || member.Certificate.Purpose != "product-device-pending-original-query-v1" {
		return errors.New("external C fixed E13/N1")
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
			bad.Certificate.Purpose = "PRODUCT-SESSION-HTTP-PROOF"
		}
		raw, err := batch.EncodeMember(bad)
		if err != nil {
			return err
		}
		if inspect(raw, b, files["original-pair.json"]) == nil {
			return errors.New("external C corruption or purpose accepted")
		}
	}
	wrong := b
	wrong.Origin = "https://other.example"
	if inspect(wire, wrong, files["original-pair.json"]) == nil {
		return errors.New("external C wrong independent origin accepted")
	}
	wrong = b
	wrong.AtMS += 30000
	if inspect(wire, wrong, files["original-pair.json"]) == nil {
		return errors.New("external C expired observation accepted")
	}
	badPost := append(bytes.Clone(files["original-pair.json"]), ' ')
	if inspect(wire, b, badPost) == nil {
		return errors.New("external C wrong original POST accepted")
	}
	wrong = b
	wrong.PKB = bytes.Clone(b.PKB)
	wrong.PKB[0] ^= 1
	if inspect(wire, wrong, files["original-pair.json"]) == nil {
		return errors.New("external C wrong full pair accepted")
	}
	receipt := map[string]any{"version": "YNX-PENDING-ORIGINAL-QUERY-CABI-PUBLIC-RECEIPT/v1", "syntheticOnly": true, "actualCABIExecuted": true, "independentGoANDVerified": true, "fixedE13Verified": true, "boundaryCases": fixtureBoundaryCases, "negativeCases": 7, "purpose": batch.ProductPairPendingOriginalQueryPurpose, "memberCount": 1, "memberIndex": 0, "memberSHA256": digest(wire), "memberBytes": len(wire), "querySHA256": digest(files["query.json"]), "registrationSHA256": digest(files["registration.json"]), "originalPostSHA256": digest(files["original-pair.json"]), "messageSHA256": digest(want), "authorityGranted": false, "SourceAdmission": false, "registered": false, "current": false, "sessionAuthorized": false, "HTTPExecuted": false, "publicDeployment": false, "logicalCleanupOnly": true, "physicalEraseClaimed": false}
	interop := map[string]any{"version": "YNX-PENDING-ORIGINAL-QUERY-CABI-PUBLIC-INTEROP/v1", "syntheticOnly": true, "queryOriginalBase64": base64.StdEncoding.EncodeToString(files["query.json"]), "registrationOriginalBase64": base64.StdEncoding.EncodeToString(files["registration.json"]), "memberOriginalBase64": base64.StdEncoding.EncodeToString(wire), "messageOriginalBase64": base64.StdEncoding.EncodeToString(want), "originalPostSHA256": digest(files["original-pair.json"]),
		"originalPairPostBase64": base64.StdEncoding.EncodeToString(files["original-pair.json"]),
		"expected":               map[string]any{"networkId": hex.EncodeToString(b.NetworkID), "owner": b.Owner, "actorDigest": b.ActorDigest, "serviceOrigin": b.Origin, "pkA": hex.EncodeToString(b.PKA), "pkB": hex.EncodeToString(b.PKB), "nonce": b.Nonce, "issuedAt": b.IssuedAt, "expiresAt": b.ExpiresAt, "atMs": b.AtMS, "sourceIssuedAtMs": b.SourceIssuedAtMS, "sourceExpiresAtMs": b.SourceExpiresAtMS, "registrationIssuedAt": "2026-11-01T07:00:00.000Z", "registrationExpiresAt": "2026-11-01T09:00:00.000Z", "registrationRevokedAt": nil},
		"purpose":                batch.ProductPairPendingOriginalQueryPurpose, "method": "POST", "path": "/v4/product-pairs/original-query",
		"authorityGranted": false, "RootAdmission": false, "SourceAdmission": false, "sessionAuthorized": false}
	for name, value := range map[string]any{"PUBLIC-RECEIPT.json": receipt, "PUBLIC-INTEROP.json": interop} {
		raw, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			return err
		}
		if err = writeExclusive(filepath.Join(directory, name), append(raw, '\n')); err != nil {
			return err
		}
	}
	fmt.Printf("YNX_PENDING_QUERY_CABI_GO_AND_PASS C=%d GoNegative=7 authority=false\n", fixtureBoundaryCases)
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
		fmt.Fprintln(os.Stderr, "pending original query synthetic fixture failed:", err)
		os.Exit(1)
	}
}
