package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
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

const (
	smokeCreatorAccount   = "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	smokeEditorAccount    = "ynx1llllllllllllllllllllllllllllllllyj698f"
	smokeModeratorAccount = "ynx1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zcrwn4"
)

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
	inviteResponse := c.signed("creator", http.MethodPost, "/v1/channels/"+channelID+"/team/invites", "application/json", []byte(`{"account":"`+smokeEditorAccount+`","role":"editor"}`), "smoke-team-invite-0001", http.StatusOK)
	inviteID := jsonString(inviteResponse, "id", "ID")
	c.signedAs(smokeEditorAccount, "creator", http.MethodPost, "/v1/team/invites/"+inviteID+"/accept", "application/json", nil, "smoke-team-accept-0001", http.StatusOK)
	var multipartBody bytes.Buffer
	writer := multipart.NewWriter(&multipartBody)
	_ = writer.WriteField("channel_id", channelID)
	_ = writer.WriteField("size", fmt.Sprint(len(media)))
	_ = writer.WriteField("title", "Repository-owned transcode smoke")
	_ = writer.WriteField("description", "Owned test media; no production traffic or revenue.")
	_ = writer.WriteField("owned_content_declaration", "true")
	mediaHash := sha256.Sum256(media)
	_ = writer.WriteField("sha256", hex.EncodeToString(mediaHash[:]))
	_ = writer.WriteField("rights_basis", "owned")
	_ = writer.WriteField("rights_source", "repository-owned generated test media")
	_ = writer.WriteField("rights_license", "YNX test fixture; internal verification only")
	_ = writer.WriteField("rights_territories", "WORLDWIDE")
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
	uploadResponse := c.signedAs(smokeEditorAccount, "creator", http.MethodPost, "/v1/uploads", writer.FormDataContentType(), multipartBody.Bytes(), "smoke-owned-upload-0003", http.StatusOK)
	videoID := jsonString(uploadResponse, "id", "ID")
	if jsonString(uploadResponse, "status", "Status") != "ready" {
		fatal("real media processing did not reach ready")
	}
	variants, ok := uploadResponse["variants"].([]any)
	if !ok || len(variants) < 2 {
		fatal("adaptive and fallback variants were not returned")
	}
	sourceSHA256 := jsonString(uploadResponse, "sha256", "SHA256")
	rightsBody := []byte(`{"basis":"owned","territories":["worldwide"],"evidence_sha256":"` + strings.Repeat("c", 64) + `","source_sha256":"` + sourceSHA256 + `","contributor_splits":[{"account":"` + smokeCreatorAccount + `","basis_points":10000}]}`)
	rightsResponse := c.signedAs(smokeEditorAccount, "creator", http.MethodPost, "/v1/videos/"+videoID+"/rights", "application/json", rightsBody, "smoke-rights-declare-0001", http.StatusOK)
	rightsID := jsonString(rightsResponse, "id", "ID")
	c.signedAs(smokeCreatorAccount, "creator", http.MethodPost, "/v1/rights/"+rightsID+"/review", "application/json", []byte(`{"accepted":true,"reason":"creator self-review must fail"}`), "smoke-rights-self-review-0001", http.StatusForbidden)
	c.signedAs(smokeModeratorAccount, "creator", http.MethodPost, "/v1/rights/"+rightsID+"/review", "application/json", []byte(`{"accepted":true,"reason":"loopback repository-owned evidence verified"}`), "smoke-rights-review-0001", http.StatusOK)
	c.signedAs(smokeEditorAccount, "creator", http.MethodPost, "/v1/videos/"+videoID+"/publish", "application/json", []byte(`{"visibility":"public"}`), "smoke-video-publish-0001", http.StatusOK)
	c.signed("creator", http.MethodDelete, "/v1/channels/"+channelID+"/team/"+smokeEditorAccount, "", nil, "smoke-team-revoke-0001", http.StatusOK)
	c.signedAs(smokeEditorAccount, "creator", http.MethodPost, "/v1/videos/"+videoID+"/metadata", "application/json", []byte(`{"title":"revoked editor mutation","description":"must fail"}`), "smoke-revoked-editor-0001", http.StatusForbidden)
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
	result := map[string]any{"ok": true, "endpoint": endpoint, "health": json.RawMessage(health), "version": json.RawMessage(version), "channel_id": channelID, "team_invite_id": inviteID, "team_revoked": true, "video_id": videoID, "rights_id": rightsID, "rights_reviewed_by": smokeModeratorAccount, "input_bytes": len(media), "variants": len(variants), "comments": len(commentRecords), "revenue_ynxt": 0, "boundary": "loopback repository-owned media with team and rights gates; not staging, public deployment, production signing, or real-value revenue"}
	encoded, _ := json.MarshalIndent(result, "", "  ")
	fmt.Println(string(encoded))
}

func (c smokeClient) public(method, path string, body []byte, expected int) []byte {
	request, _ := http.NewRequest(method, c.endpoint+path, bytes.NewReader(body))
	return c.do(request, expected)
}

func (c smokeClient) signed(product, method, path, contentType string, body []byte, idempotency string, expected int) map[string]any {
	return c.signedAs(smokeCreatorAccount, product, method, path, contentType, body, idempotency, expected)
}

func (c smokeClient) signedAs(account, product, method, path, contentType string, body []byte, idempotency string, expected int) map[string]any {
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
	fields := map[string]string{"time": now.Format(time.RFC3339Nano), "issued": now.Add(-time.Minute).Format(time.RFC3339Nano), "expires": now.Add(time.Hour).Format(time.RFC3339Nano), "nonce": "smoke-" + hex.EncodeToString(random), "binding": strings.Repeat("a", 64), "requestDigest": strings.Repeat("b", 64), "chain": "ynx_6423-1", "algorithm": "p256-sha256", "deviceKey": base64.RawURLEncoding.EncodeToString(deviceKey), "account": account}
	if product == "creator" {
		fields["product"], fields["client"], fields["bundle"], fields["callback"], fields["scopes"] = "ynx-creator-studio", "ynx-creator-studio-web-v1", "com.ynxweb4.creator-studio.web", "https://web4.ynxweb4.com/video/studio/wallet-auth/callback", "ai.video.propose pay.payout.intent video.creator video.read"
	} else {
		fields["product"], fields["client"], fields["bundle"], fields["callback"], fields["scopes"] = "ynx-video", "ynx-video-web-v1", "com.ynxweb4.video.web", "https://web4.ynxweb4.com/video/wallet-auth/callback", "video.comment video.history video.read video.report video.subscribe"
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
