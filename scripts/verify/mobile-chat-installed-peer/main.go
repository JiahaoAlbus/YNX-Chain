package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/appgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chat"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

const (
	nativeClient  = "ynx-mobile-v1"
	nativeBinding = "ynx-mobile://com.ynxweb4.mobile"
)

var httpClient = &http.Client{Timeout: 15 * time.Second}

type proofState struct {
	Version           int           `json:"version"`
	Account           string        `json:"account"`
	AccountPrivateKey string        `json:"accountPrivateKey"`
	Devices           []proofDevice `json:"devices"`
}

type proofDevice struct {
	ID                string `json:"id"`
	SigningPrivate    string `json:"signingPrivate"`
	SigningPublic     string `json:"signingPublic"`
	EncryptionPrivate string `json:"encryptionPrivate"`
	EncryptionPublic  string `json:"encryptionPublic"`
	SessionToken      string `json:"sessionToken"`
}

type verificationProof struct {
	Account              string   `json:"account"`
	Sender               string   `json:"sender"`
	ConversationID       string   `json:"conversationId"`
	MessageID            string   `json:"messageId"`
	ProtocolVersion      int      `json:"protocolVersion"`
	EnvelopeCount        int      `json:"envelopeCount"`
	RecipientDeviceIDs   []string `json:"recipientDeviceIds"`
	SenderContinuity     bool     `json:"senderContinuity"`
	SenderSignatureValid bool     `json:"senderSignatureValid"`
	AllDevicesDecrypted  bool     `json:"allDevicesDecrypted"`
	AllDevicesRead       bool     `json:"allDevicesRead"`
	CiphertextOnly       bool     `json:"ciphertextOnly"`
	VerifiedAt           string   `json:"verifiedAt"`
}

func main() {
	mode := flag.String("mode", "", "setup, verify, status, or cleanup")
	baseURL := flag.String("url", "https://api.ynxweb4.com", "App Gateway base URL")
	statePath := flag.String("state", "", "mode-0600 disposable peer state path")
	accountOutput := flag.String("account-output", "", "setup-only peer account output path")
	sender := flag.String("sender", "", "installed sender ynx1 account")
	plaintext := flag.String("plaintext", "", "expected installed-App plaintext")
	proofOutput := flag.String("proof-output", "", "verify/status proof output path")
	flag.Parse()
	if *statePath == "" {
		fail(errors.New("state path is required"))
	}
	url := strings.TrimRight(*baseURL, "/")
	var err error
	switch *mode {
	case "setup":
		err = setup(url, *statePath, *accountOutput)
	case "verify":
		err = verify(url, *statePath, *sender, *plaintext, *proofOutput, false)
	case "status":
		err = verify(url, *statePath, *sender, *plaintext, *proofOutput, true)
	case "cleanup":
		err = cleanup(url, *statePath)
	default:
		err = errors.New("mode must be setup, verify, status, or cleanup")
	}
	if err != nil {
		fail(err)
	}
	fmt.Printf("mobile Chat installed peer %s passed\n", *mode)
}

func setup(baseURL, statePath, accountOutput string) error {
	if accountOutput == "" {
		return errors.New("account-output is required for setup")
	}
	if _, err := os.Stat(statePath); err == nil {
		return errors.New("refusing to overwrite existing peer state")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	accountPrivate, err := secp256k1.GeneratePrivateKeyFromRand(rand.Reader)
	if err != nil {
		return err
	}
	account, err := accountForPrivate(accountPrivate)
	if err != nil {
		return err
	}
	randomID := make([]byte, 6)
	if _, err := io.ReadFull(rand.Reader, randomID); err != nil {
		return err
	}
	suffix := hex.EncodeToString(randomID)
	state := proofState{Version: 1, Account: account, AccountPrivateKey: hex.EncodeToString(accountPrivate.Serialize())}
	if err := writePrivateJSON(statePath, state); err != nil {
		return err
	}
	for index := 1; index <= 2; index++ {
		keys, err := nativewallet.GenerateDeviceKeys(rand.Reader)
		if err != nil {
			return err
		}
		device := proofDevice{
			ID:                fmt.Sprintf("installed-peer-%s-%d", suffix, index),
			SigningPrivate:    base64.RawStdEncoding.EncodeToString(keys.SigningPrivate),
			SigningPublic:     nativewallet.EncodePublicKey(keys.SigningPublic),
			EncryptionPrivate: base64.RawStdEncoding.EncodeToString(keys.EncryptionPrivate),
			EncryptionPublic:  nativewallet.EncodePublicKey(keys.EncryptionPublic),
		}
		device.SessionToken, err = createSession(baseURL, state, device)
		if err != nil {
			return fmt.Errorf("create peer device %d session: %w", index, err)
		}
		state.Devices = append(state.Devices, device)
		if err := writePrivateJSON(statePath, state); err != nil {
			return err
		}
		request := chat.RegisterDeviceRequest{IdempotencyKey: "register-" + device.ID, Account: account, DeviceID: device.ID, SigningPublicKey: device.SigningPublic, EncryptionPublicKey: device.EncryptionPublic}
		request.ProofSignature = nativewallet.Sign(mustSigningPrivate(device), chat.DeviceRegistrationPayload(request))
		body, _ := json.Marshal(request)
		if err := serviceRequest(baseURL, device, http.MethodPost, "/app/chat/devices", "/chat/devices", body, http.StatusCreated, nil); err != nil {
			return fmt.Errorf("register peer device %d: %w", index, err)
		}
	}
	if err := writePrivateFile(accountOutput, []byte(account+"\n")); err != nil {
		return err
	}
	return nil
}

func verify(baseURL, statePath, sender, plaintext, proofOutput string, statusOnly bool) error {
	if sender == "" || plaintext == "" || proofOutput == "" {
		return errors.New("sender, plaintext, and proof-output are required")
	}
	state, err := readState(statePath)
	if err != nil {
		return err
	}
	if len(state.Devices) != 2 {
		return errors.New("peer proof requires exactly two devices")
	}
	for index := range state.Devices {
		state.Devices[index].SessionToken, err = createSession(baseURL, state, state.Devices[index])
		if err != nil {
			return fmt.Errorf("refresh peer session: %w", err)
		}
	}
	if err := writePrivateJSON(statePath, state); err != nil {
		return err
	}
	var conversations struct {
		Conversations []chat.Conversation `json:"conversations"`
	}
	if err := serviceRequest(baseURL, state.Devices[0], http.MethodGet, "/app/chat/conversations", "/chat/conversations", nil, http.StatusOK, &conversations); err != nil {
		return err
	}
	var conversation *chat.Conversation
	for index := range conversations.Conversations {
		record := &conversations.Conversations[index]
		if contains(record.Members, state.Account) && contains(record.Members, sender) {
			if conversation != nil {
				return errors.New("multiple retained conversations match the proof accounts")
			}
			conversation = record
		}
	}
	if conversation == nil {
		return errors.New("installed-App conversation is not visible to peer devices")
	}
	var messages struct {
		Messages []chat.Message `json:"messages"`
	}
	publicMessages := "/app/chat/conversations/" + conversation.ID + "/messages"
	signedMessages := "/chat/conversations/" + conversation.ID + "/messages"
	if err := serviceRequest(baseURL, state.Devices[0], http.MethodGet, publicMessages, signedMessages, nil, http.StatusOK, &messages); err != nil {
		return err
	}
	var message *chat.Message
	for index := range messages.Messages {
		candidate := &messages.Messages[index]
		if candidate.Sender != sender || candidate.ProtocolVersion != 2 {
			continue
		}
		matched := true
		for _, device := range state.Devices {
			plain, decryptErr := decryptForDevice(*candidate, device)
			if decryptErr != nil || string(plain) != plaintext {
				matched = false
				break
			}
		}
		if matched {
			if message != nil {
				return errors.New("multiple messages match the installed proof plaintext")
			}
			message = candidate
		}
	}
	if message == nil {
		return errors.New("both peer devices could not authenticate and decrypt the installed-App message")
	}
	var senderDirectory struct {
		Devices []chat.Device `json:"devices"`
	}
	publicSender := "/app/chat/accounts/" + sender + "/devices"
	signedSender := "/chat/accounts/" + sender + "/devices"
	if err := serviceRequest(baseURL, state.Devices[0], http.MethodGet, publicSender, signedSender, nil, http.StatusOK, &senderDirectory); err != nil {
		return err
	}
	var senderDevice *chat.Device
	for index := range senderDirectory.Devices {
		if senderDirectory.Devices[index].ID == message.SenderDeviceID {
			senderDevice = &senderDirectory.Devices[index]
			break
		}
	}
	if senderDevice == nil {
		return errors.New("message sender device is absent from the member-visible directory")
	}
	signatureValid := nativewallet.Verify(senderDevice.SigningPublicKey, chat.MessageSignaturePayload(conversation.ID, sender, message.SenderDeviceID, chat.SendMessageRequest{MessageID: message.ID, Envelopes: message.Envelopes, SenderSignature: message.SenderSignature}), message.SenderSignature)
	if !signatureValid {
		return errors.New("installed-App message sender signature failed independent verification")
	}
	recipientIDs := make([]string, 0, len(message.Envelopes))
	senderContinuity := false
	for _, envelope := range message.Envelopes {
		recipientIDs = append(recipientIDs, envelope.RecipientDeviceID)
		if envelope.RecipientAccount == sender && envelope.RecipientDeviceID == message.SenderDeviceID {
			senderContinuity = true
		}
	}
	if !senderContinuity {
		return errors.New("installed sender continuity envelope is missing")
	}
	if !statusOnly {
		for _, device := range state.Devices {
			for _, acknowledgement := range []string{"delivered", "read"} {
				publicPath := fmt.Sprintf("/app/chat/conversations/%s/messages/%s/%s", conversation.ID, message.ID, acknowledgement)
				signedPath := strings.TrimPrefix(publicPath, "/app")
				if err := serviceRequest(baseURL, device, http.MethodPost, publicPath, signedPath, nil, http.StatusOK, nil); err != nil {
					return fmt.Errorf("%s acknowledgement for %s: %w", acknowledgement, device.ID, err)
				}
			}
		}
		if err := serviceRequest(baseURL, state.Devices[0], http.MethodGet, publicMessages, signedMessages, nil, http.StatusOK, &messages); err != nil {
			return err
		}
		for index := range messages.Messages {
			if messages.Messages[index].ID == message.ID {
				message = &messages.Messages[index]
				break
			}
		}
	}
	allRead := true
	for _, device := range state.Devices {
		if _, ok := message.ReadAt[device.ID]; !ok {
			allRead = false
		}
	}
	proof := verificationProof{Account: state.Account, Sender: sender, ConversationID: conversation.ID, MessageID: message.ID, ProtocolVersion: message.ProtocolVersion, EnvelopeCount: len(message.Envelopes), RecipientDeviceIDs: recipientIDs, SenderContinuity: senderContinuity, SenderSignatureValid: signatureValid, AllDevicesDecrypted: true, AllDevicesRead: allRead, CiphertextOnly: message.Ciphertext == "" && message.Nonce == "", VerifiedAt: time.Now().UTC().Format(time.RFC3339)}
	if !proof.CiphertextOnly || (!statusOnly && !proof.AllDevicesRead) {
		return errors.New("ciphertext-only or per-device acknowledgement proof failed")
	}
	return writePrivateJSON(proofOutput, proof)
}

func cleanup(baseURL, statePath string) error {
	state, err := readState(statePath)
	if err != nil {
		return err
	}
	var failures []error
	for index := range state.Devices {
		device := &state.Devices[index]
		device.SessionToken, err = createSession(baseURL, state, *device)
		if err != nil {
			failures = append(failures, err)
			continue
		}
		publicPath := "/app/chat/devices/" + device.ID + "/revoke"
		if err := serviceRequestAllowed(baseURL, *device, http.MethodPost, publicPath, strings.TrimPrefix(publicPath, "/app"), nil, []int{http.StatusOK, http.StatusNotFound}); err != nil {
			failures = append(failures, err)
		}
		if err := plainRequest(baseURL+"/app/session/revoke", *device, http.MethodPost, nil, http.StatusOK, nil); err != nil {
			failures = append(failures, err)
		}
	}
	if len(failures) > 0 {
		return errors.Join(failures...)
	}
	return os.Remove(statePath)
}

func createSession(baseURL string, state proofState, device proofDevice) (string, error) {
	request := appgateway.ChallengeRequest{Account: state.Account, DeviceID: device.ID, DeviceSigningPublicKey: device.SigningPublic}
	body, _ := json.Marshal(request)
	var challenge appgateway.ChallengeResponse
	if err := plainRequest(baseURL+"/app/session/challenges", device, http.MethodPost, body, http.StatusCreated, &challenge); err != nil {
		return "", err
	}
	if challenge.Account != state.Account || challenge.SignDoc.Origin != nativeBinding || challenge.SignDoc.DeviceID != device.ID || challenge.SignDoc.ChainID != 6423 {
		return "", errors.New("native challenge binding mismatch")
	}
	signBytes, err := base64.RawStdEncoding.DecodeString(challenge.SignBytes)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(signBytes)
	accountPrivateBytes, err := hex.DecodeString(state.AccountPrivateKey)
	if err != nil || len(accountPrivateBytes) != 32 {
		return "", errors.New("invalid disposable account private key")
	}
	accountPrivate := secp256k1.PrivKeyFromBytes(accountPrivateBytes)
	verify := appgateway.VerifyChallengeRequest{AccountPublicKey: hex.EncodeToString(accountPrivate.PubKey().SerializeCompressed()), AccountSignature: hex.EncodeToString(ecdsa.Sign(accountPrivate, digest[:]).Serialize()), DeviceSignature: nativewallet.Sign(mustSigningPrivate(device), signBytes)}
	body, _ = json.Marshal(verify)
	var session appgateway.SessionResponse
	if err := plainRequest(baseURL+"/app/session/challenges/"+challenge.ChallengeID+"/verify", device, http.MethodPost, body, http.StatusCreated, &session); err != nil {
		return "", err
	}
	if session.Account != state.Account || session.DeviceID != device.ID || session.Token == "" {
		return "", errors.New("native session binding mismatch")
	}
	return session.Token, nil
}

func serviceRequest(baseURL string, device proofDevice, method, publicPath, signedPath string, body []byte, want int, out any) error {
	timestamp := time.Now().UTC().Format(time.RFC3339)
	request, err := http.NewRequest(method, baseURL+publicPath, bytes.NewReader(body))
	if err != nil {
		return err
	}
	setHeaders(request, device)
	request.Header.Set("X-YNX-Timestamp", timestamp)
	request.Header.Set("X-YNX-Device-Signature", nativewallet.Sign(mustSigningPrivate(device), chat.RequestSignaturePayload(method, signedPath, timestamp, body)))
	return do(request, want, out)
}

func serviceRequestAllowed(baseURL string, device proofDevice, method, publicPath, signedPath string, body []byte, allowed []int) error {
	timestamp := time.Now().UTC().Format(time.RFC3339)
	request, err := http.NewRequest(method, baseURL+publicPath, bytes.NewReader(body))
	if err != nil {
		return err
	}
	setHeaders(request, device)
	request.Header.Set("X-YNX-Timestamp", timestamp)
	request.Header.Set("X-YNX-Device-Signature", nativewallet.Sign(mustSigningPrivate(device), chat.RequestSignaturePayload(method, signedPath, timestamp, body)))
	response, err := httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 1024*1024))
	if err != nil {
		return err
	}
	for _, status := range allowed {
		if response.StatusCode == status {
			return nil
		}
	}
	return fmt.Errorf("%s %s returned %d: %s", method, publicPath, response.StatusCode, strings.TrimSpace(string(data)))
}

func plainRequest(url string, device proofDevice, method string, body []byte, want int, out any) error {
	request, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	setHeaders(request, device)
	return do(request, want, out)
}

func setHeaders(request *http.Request, device proofDevice) {
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-YNX-Client", nativeClient)
	if device.SessionToken != "" {
		request.Header.Set("X-YNX-App-Session", device.SessionToken)
		request.Header.Set("X-YNX-Device-ID", device.ID)
	}
}

func do(request *http.Request, want int, out any) error {
	response, err := httpClient.Do(request)
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
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("decode %s: %w", request.URL.Path, err)
		}
	}
	return nil
}

func decryptForDevice(message chat.Message, device proofDevice) ([]byte, error) {
	var envelope *chat.MessageEnvelope
	for index := range message.Envelopes {
		if message.Envelopes[index].RecipientDeviceID == device.ID {
			envelope = &message.Envelopes[index]
			break
		}
	}
	if envelope == nil {
		return nil, errors.New("device envelope missing")
	}
	privateKey, err := base64.RawStdEncoding.DecodeString(device.EncryptionPrivate)
	if err != nil || len(privateKey) != 32 {
		return nil, errors.New("invalid disposable encryption private key")
	}
	ephemeral, err := nativewallet.DecodePublicKey(envelope.EphemeralPublicKey, 32)
	if err != nil {
		return nil, err
	}
	aad := chat.MessageEnvelopeAAD(message.ConversationID, message.ID, message.SenderDeviceID, envelope.RecipientAccount, envelope.RecipientDeviceID, envelope.Algorithm, envelope.EphemeralPublicKey)
	return nativewallet.Decrypt(privateKey, ephemeral, aad, nativewallet.EncryptedEnvelope{Algorithm: envelope.Algorithm, Nonce: envelope.Nonce, Ciphertext: envelope.Ciphertext})
}

func accountForPrivate(private *secp256k1.PrivateKey) (string, error) {
	canonical, err := consensus.NativeAddress(private.PubKey().SerializeCompressed())
	if err != nil {
		return "", err
	}
	return accountaddress.Encode(canonical)
}

func mustSigningPrivate(device proofDevice) ed25519.PrivateKey {
	value, err := base64.RawStdEncoding.DecodeString(device.SigningPrivate)
	if err != nil || len(value) != ed25519.PrivateKeySize {
		panic("invalid disposable signing private key")
	}
	return ed25519.PrivateKey(value)
}

func readState(path string) (proofState, error) {
	info, err := os.Stat(path)
	if err != nil {
		return proofState{}, err
	}
	if info.Mode().Perm() != 0o600 {
		return proofState{}, errors.New("peer state must have mode 0600")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return proofState{}, err
	}
	var state proofState
	if err := json.Unmarshal(data, &state); err != nil {
		return proofState{}, err
	}
	if state.Version != 1 || state.Account == "" || state.AccountPrivateKey == "" {
		return proofState{}, errors.New("peer state is invalid")
	}
	return state, nil
}

func writePrivateJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return writePrivateFile(path, append(data, '\n'))
}

func writePrivateFile(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return err
	}
	if err := os.Chmod(temporary, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
