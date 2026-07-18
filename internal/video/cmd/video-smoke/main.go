package main

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/video"
)

const smokeAccount = "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"

type smokeClient struct {
	endpoint string
	key      []byte
	client   *http.Client
}

func main() {
	endpoint := strings.TrimSuffix(os.Getenv("YNX_VIDEO_SMOKE_ENDPOINT"), "/")
	if endpoint == "" {
		endpoint = "http://127.0.0.1:8423"
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") {
		fatal("smoke endpoint must be loopback")
	}
	key := []byte(os.Getenv("YNX_VIDEO_GATEWAY_ATTESTATION_KEY"))
	if len(key) < 32 {
		fatal("YNX_VIDEO_GATEWAY_ATTESTATION_KEY must be at least 32 bytes")
	}
	mediaPath := os.Getenv("YNX_VIDEO_SMOKE_MEDIA")
	if mediaPath == "" {
		mediaPath = "internal/video/testdata/ynx-owned-test.mp4"
	}
	media, err := os.ReadFile(mediaPath)
	if err != nil {
		fatal(err.Error())
	}
	c := smokeClient{endpoint: endpoint, key: key, client: &http.Client{Timeout: 5 * time.Minute}}
	health := c.public(http.MethodGet, "/health", nil, http.StatusOK)
	version := c.public(http.MethodGet, "/version", nil, http.StatusOK)
	channelResponse := c.signed("creator", http.MethodPost, "/v1/channels", "application/json", []byte(`{"handle":"owned-smoke","name":"Owned smoke channel"}`), "smoke-channel-create-0001", http.StatusOK)
	channelID := jsonString(channelResponse, "ID", "id")
	var multipartBody bytes.Buffer
	writer := multipart.NewWriter(&multipartBody)
	_ = writer.WriteField("channel_id", channelID)
	_ = writer.WriteField("size", fmt.Sprint(len(media)))
	_ = writer.WriteField("title", "Repository-owned transcode smoke")
	_ = writer.WriteField("description", "Owned test media; no production traffic or revenue.")
	_ = writer.WriteField("owned_content_declaration", "true")
	partHeader := textproto.MIMEHeader{}
	partHeader.Set("Content-Disposition", fmt.Sprintf(`form-data; name="media"; filename="%s"`, filepath.Base(mediaPath)))
	partHeader.Set("Content-Type", "video/mp4")
	part, err := writer.CreatePart(partHeader)
	if err != nil {
		fatal(err.Error())
	}
	if _, err = part.Write(media); err != nil {
		fatal(err.Error())
	}
	if err = writer.Close(); err != nil {
		fatal(err.Error())
	}
	uploadResponse := c.signed("creator", http.MethodPost, "/v1/uploads", writer.FormDataContentType(), multipartBody.Bytes(), "smoke-owned-upload-0003", http.StatusOK)
	videoID := jsonString(uploadResponse, "id", "ID")
	if jsonString(uploadResponse, "status", "Status") != "ready" {
		fatal("real media processing did not reach ready")
	}
	variants, ok := uploadResponse["variants"].([]any)
	if !ok || len(variants) < 2 {
		fatal("adaptive and fallback variants were not returned")
	}
	c.signed("creator", http.MethodPost, "/v1/videos/"+videoID+"/publish", "application/json", []byte(`{"visibility":"public"}`), "smoke-video-publish-0001", http.StatusOK)
	discover := c.public(http.MethodGet, "/v1/videos", nil, http.StatusOK)
	if !bytes.Contains(discover, []byte(videoID)) {
		fatal("published video is absent from public discovery")
	}
	videoResponse := c.public(http.MethodGet, "/v1/videos/"+videoID, nil, http.StatusOK)
	var publicVideo map[string]any
	if err = json.Unmarshal(videoResponse, &publicVideo); err != nil {
		fatal(err.Error())
	}
	for _, raw := range publicVideo["variants"].([]any) {
		variant := raw.(map[string]any)
		if variant["mime"] == "application/vnd.apple.mpegurl" {
			playlist := c.public(http.MethodGet, "/media/"+variant["object_key"].(string), nil, http.StatusOK)
			if !bytes.Contains(playlist, []byte("#EXTM3U")) {
				fatal("served HLS playlist is invalid")
			}
		}
	}
	commentBody := []byte(`{"body":"Persisted smoke comment"}`)
	firstComment := c.signed("viewer", http.MethodPost, "/v1/videos/"+videoID+"/comments", "application/json", commentBody, "smoke-comment-write-0001", http.StatusOK)
	replayedComment := c.signed("viewer", http.MethodPost, "/v1/videos/"+videoID+"/comments", "application/json", commentBody, "smoke-comment-write-0001", http.StatusOK)
	if jsonString(firstComment, "id", "ID") != jsonString(replayedComment, "id", "ID") {
		fatal("idempotent live replay changed response")
	}
	comments := c.public(http.MethodGet, "/v1/videos/"+videoID+"/comments", nil, http.StatusOK)
	var commentRecords []any
	if json.Unmarshal(comments, &commentRecords) != nil || len(commentRecords) != 1 {
		fatal("idempotent live replay duplicated the comment")
	}
	studio := c.signed("creator", http.MethodGet, "/v1/studio", "", nil, "", http.StatusOK)
	analytics := studio["analytics"].(map[string]any)
	if analytics["revenue_ynxt"].(float64) != 0 {
		fatal("smoke state invented revenue")
	}
	result := map[string]any{"ok": true, "endpoint": endpoint, "health": json.RawMessage(health), "version": json.RawMessage(version), "channel_id": channelID, "video_id": videoID, "input_bytes": len(media), "variants": len(variants), "comments": len(commentRecords), "revenue_ynxt": 0, "boundary": "loopback owned-media smoke; not staging or production"}
	encoded, _ := json.MarshalIndent(result, "", "  ")
	fmt.Println(string(encoded))
}

func (c smokeClient) public(method, path string, body []byte, expected int) []byte {
	request, _ := http.NewRequest(method, c.endpoint+path, bytes.NewReader(body))
	return c.do(request, expected)
}

func (c smokeClient) signed(product, method, path, contentType string, body []byte, idempotency string, expected int) map[string]any {
	request, _ := http.NewRequest(method, c.endpoint+path, bytes.NewReader(body))
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	if idempotency != "" {
		request.Header.Set("Idempotency-Key", idempotency)
	}
	now := time.Now().UTC()
	random := make([]byte, 16)
	_, _ = rand.Read(random)
	deviceKey := append([]byte{2}, make([]byte, 32)...)
	fields := map[string]string{"time": now.Format(time.RFC3339Nano), "issued": now.Add(-time.Minute).Format(time.RFC3339Nano), "expires": now.Add(time.Hour).Format(time.RFC3339Nano), "nonce": "smoke-" + hex.EncodeToString(random), "binding": strings.Repeat("a", 64), "requestDigest": strings.Repeat("b", 64), "chain": "ynx_6423-1", "algorithm": "p256-sha256", "deviceKey": base64.RawURLEncoding.EncodeToString(deviceKey), "account": smokeAccount}
	if product == "creator" {
		fields["product"], fields["client"], fields["bundle"], fields["callback"], fields["scopes"] = "ynx-creator-studio", "ynx-creator-studio-web-v1", "com.ynxweb4.creator-studio.web", "https://creator.video.ynxweb4.com/wallet-auth/callback", "ai.video.propose pay.payout.intent video.creator video.read"
	} else {
		fields["product"], fields["client"], fields["bundle"], fields["callback"], fields["scopes"] = "ynx-video", "ynx-video-web-v1", "com.ynxweb4.video.web", "https://video.ynxweb4.com/wallet-auth/callback", "video.comment video.history video.read video.report video.subscribe"
	}
	headers, err := video.SignGatewayRequest(c.key, request, body, fields)
	if err != nil {
		fatal(err.Error())
	}
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response := c.do(request, expected)
	var decoded map[string]any
	if err = json.Unmarshal(response, &decoded); err != nil {
		fatal(err.Error())
	}
	return decoded
}

func (c smokeClient) do(request *http.Request, expected int) []byte {
	response, err := c.client.Do(request)
	if err != nil {
		fatal(err.Error())
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 10<<20))
	if err != nil {
		fatal(err.Error())
	}
	if response.StatusCode != expected {
		fatal(fmt.Sprintf("%s %s returned %d: %s", request.Method, request.URL.Path, response.StatusCode, body))
	}
	return body
}

func jsonString(value map[string]any, keys ...string) string {
	for _, key := range keys {
		if text, ok := value[key].(string); ok && text != "" {
			return text
		}
	}
	fatal("required JSON string is missing")
	return ""
}

func fatal(message string) {
	panic(errors.New("video-smoke: " + message))
}
