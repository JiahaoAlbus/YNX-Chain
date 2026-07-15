package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/appgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chat"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/JiahaoAlbus/YNX-Chain/internal/square"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

func main() {
	baseURL := flag.String("url", "http://127.0.0.1:17437", "App Gateway base URL")
	origin := flag.String("origin", "https://www.ynxweb4.com", "Exact allowed browser origin")
	signedPost := flag.Bool("signed-post", false, "Create a signed Square post; use only with disposable local state")
	flag.Parse()
	if err := run(strings.TrimRight(*baseURL, "/"), *origin, *signedPost); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("account-bound app session smoke passed: ynx1 account proof, device binding, Square/Chat registration and revocation, session revocation")
}

func run(baseURL, origin string, signedPost bool) error {
	accountPrivate, err := secp256k1.GeneratePrivateKeyFromRand(rand.Reader)
	if err != nil {
		return err
	}
	accountPublic := accountPrivate.PubKey().SerializeCompressed()
	canonical, err := consensus.NativeAddress(accountPublic)
	if err != nil {
		return err
	}
	account, err := accountaddress.Encode(canonical)
	if err != nil {
		return err
	}
	deviceKeys, err := nativewallet.GenerateDeviceKeys(rand.Reader)
	if err != nil {
		return err
	}
	randomID := make([]byte, 6)
	if _, err := io.ReadFull(rand.Reader, randomID); err != nil {
		return err
	}
	suffix := hex.EncodeToString(randomID)
	deviceID := "app-gateway-smoke-" + suffix
	devicePublic := nativewallet.EncodePublicKey(deviceKeys.SigningPublic)

	challengeBody, _ := json.Marshal(appgateway.ChallengeRequest{Account: account, DeviceID: deviceID, DeviceSigningPublicKey: devicePublic})
	var challenge appgateway.ChallengeResponse
	if err := requestJSON(baseURL+"/app/session/challenges", origin, "", "", challengeBody, http.StatusCreated, &challenge); err != nil {
		return err
	}
	if challenge.Account != account || challenge.SignDoc.Origin != origin || challenge.SignDoc.ChainID != 6423 || challenge.SignDoc.DeviceID != deviceID {
		return fmt.Errorf("challenge binding mismatch")
	}
	signBytes, err := base64.RawStdEncoding.DecodeString(challenge.SignBytes)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(signBytes)
	verifyBody, _ := json.Marshal(appgateway.VerifyChallengeRequest{
		AccountPublicKey: hex.EncodeToString(accountPublic),
		AccountSignature: hex.EncodeToString(ecdsa.Sign(accountPrivate, digest[:]).Serialize()),
		DeviceSignature:  nativewallet.Sign(deviceKeys.SigningPrivate, signBytes),
	})
	var session appgateway.SessionResponse
	if err := requestJSON(baseURL+"/app/session/challenges/"+challenge.ChallengeID+"/verify", origin, "", "", verifyBody, http.StatusCreated, &session); err != nil {
		return err
	}
	if session.Account != account || session.DeviceID != deviceID || session.Token == "" {
		return fmt.Errorf("session binding mismatch")
	}

	squareRegistration := square.RegisterDeviceRequest{IdempotencyKey: "square-register-" + suffix, Account: account, DeviceID: deviceID, SigningPublicKey: devicePublic}
	squareRegistration.ProofSignature = nativewallet.Sign(deviceKeys.SigningPrivate, square.DeviceRegistrationPayload(squareRegistration))
	body, _ := json.Marshal(squareRegistration)
	if err := requestJSON(baseURL+"/app/square/devices", origin, session.Token, deviceID, body, http.StatusCreated, nil); err != nil {
		return err
	}
	chatRegistration := chat.RegisterDeviceRequest{IdempotencyKey: "chat-register-" + suffix, Account: account, DeviceID: deviceID, SigningPublicKey: devicePublic, EncryptionPublicKey: nativewallet.EncodePublicKey(deviceKeys.EncryptionPublic)}
	chatRegistration.ProofSignature = nativewallet.Sign(deviceKeys.SigningPrivate, chat.DeviceRegistrationPayload(chatRegistration))
	body, _ = json.Marshal(chatRegistration)
	if err := requestJSON(baseURL+"/app/chat/devices", origin, session.Token, deviceID, body, http.StatusCreated, nil); err != nil {
		return err
	}
	if err := signedServiceRead(baseURL, origin, session.Token, deviceID, "/app/chat/conversations", "/chat/conversations", deviceKeys.SigningPrivate, chat.RequestSignaturePayload, http.StatusOK); err != nil {
		return err
	}
	if err := signedServiceRead(baseURL, origin, session.Token, deviceID, "/app/chat/accounts/"+account+"/devices", "/chat/accounts/"+account+"/devices", deviceKeys.SigningPrivate, chat.RequestSignaturePayload, http.StatusOK); err != nil {
		return err
	}
	if err := signedServiceRead(baseURL, origin, session.Token, deviceID, "/app/chat/device-rotations", "/chat/device-rotations", deviceKeys.SigningPrivate, chat.RequestSignaturePayload, http.StatusOK); err != nil {
		return err
	}

	if signedPost {
		postBody, _ := json.Marshal(square.CreatePostRequest{IdempotencyKey: "post-" + suffix, Content: "YNX account ownership local verification"})
		if err := signedServiceRequest(baseURL, origin, session.Token, deviceID, "/app/square/posts", "/square/posts", postBody, deviceKeys.SigningPrivate, square.RequestSignaturePayload, http.StatusCreated); err != nil {
			return err
		}
	}
	if err := signedServiceRequest(baseURL, origin, session.Token, deviceID, "/app/square/devices/"+deviceID+"/revoke", "/square/devices/"+deviceID+"/revoke", nil, deviceKeys.SigningPrivate, square.RequestSignaturePayload, http.StatusOK); err != nil {
		return err
	}
	if err := signedServiceRequest(baseURL, origin, session.Token, deviceID, "/app/chat/devices/"+deviceID+"/revoke", "/chat/devices/"+deviceID+"/revoke", nil, deviceKeys.SigningPrivate, chat.RequestSignaturePayload, http.StatusOK); err != nil {
		return err
	}

	if err := requestJSON(baseURL+"/app/session/revoke", origin, session.Token, deviceID, nil, http.StatusOK, nil); err != nil {
		return err
	}
	request, _ := http.NewRequest(http.MethodPost, baseURL+"/app/square/posts", bytes.NewReader([]byte(`{}`)))
	setHeaders(request, origin, session.Token, deviceID)
	if err := do(request, http.StatusUnauthorized, nil); err != nil {
		return fmt.Errorf("revoked session accepted: %w", err)
	}
	return nil
}

func signedServiceRead(baseURL, origin, token, deviceID, publicPath, signedPath string, privateKey ed25519.PrivateKey, payload func(string, string, string, []byte) []byte, want int) error {
	timestamp := time.Now().UTC().Format(time.RFC3339)
	request, err := http.NewRequest(http.MethodGet, baseURL+publicPath, nil)
	if err != nil {
		return err
	}
	setHeaders(request, origin, token, deviceID)
	request.Header.Set("X-YNX-Timestamp", timestamp)
	request.Header.Set("X-YNX-Device-Signature", nativewallet.Sign(privateKey, payload(http.MethodGet, signedPath, timestamp, nil)))
	return do(request, want, nil)
}

func signedServiceRequest(baseURL, origin, token, deviceID, publicPath, signedPath string, body []byte, privateKey ed25519.PrivateKey, payload func(string, string, string, []byte) []byte, want int) error {
	timestamp := time.Now().UTC().Format(time.RFC3339)
	request, err := http.NewRequest(http.MethodPost, baseURL+publicPath, bytes.NewReader(body))
	if err != nil {
		return err
	}
	setHeaders(request, origin, token, deviceID)
	request.Header.Set("X-YNX-Timestamp", timestamp)
	request.Header.Set("X-YNX-Device-Signature", nativewallet.Sign(privateKey, payload(http.MethodPost, signedPath, timestamp, body)))
	return do(request, want, nil)
}

func requestJSON(url, origin, token, deviceID string, body []byte, want int, out any) error {
	request, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	setHeaders(request, origin, token, deviceID)
	return do(request, want, out)
}

func setHeaders(request *http.Request, origin, token, deviceID string) {
	request.Header.Set("Origin", origin)
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("X-YNX-App-Session", token)
	}
	if deviceID != "" {
		request.Header.Set("X-YNX-Device-ID", deviceID)
	}
}

func do(request *http.Request, want int, out any) error {
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 1024*1024))
	if err != nil {
		return err
	}
	if response.StatusCode != want {
		return fmt.Errorf("%s %s returned %d, want %d: %s", request.Method, request.URL.Path, response.StatusCode, want, strings.TrimSpace(string(data)))
	}
	if out != nil {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("decode %s: %w", request.URL.Path, err)
		}
	}
	return nil
}
