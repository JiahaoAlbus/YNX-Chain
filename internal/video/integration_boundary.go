package video

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
)

func videoIntegrationClient(endpoint string, supplied *http.Client) (*http.Client, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("Video integration requires an HTTPS server endpoint")
	}
	c := http.Client{}
	if supplied != nil {
		c = *supplied
	}
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &c, nil
}
func decodeVideoIntegration(body io.Reader, out any) error {
	raw, err := io.ReadAll(io.LimitReader(body, (1<<20)+1))
	if err != nil {
		return err
	}
	if len(raw) > 1<<20 {
		return errors.New("Video integration response exceeds limit")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err = d.Decode(out); err != nil {
		return err
	}
	if d.Decode(&struct{}{}) != io.EOF {
		return errors.New("Video integration response has trailing data")
	}
	return nil
}
