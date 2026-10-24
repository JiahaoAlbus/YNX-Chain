package cloud

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

var ideRuntimeHandle = regexp.MustCompile(`^[0-9a-f]{64}$`)

// Runtime access must be authorized by genuine registered project/publication
// policy. Possession of a hostname/handle, DATA hash, or journal is not a grant.
type IDEProjectRuntimeAuthority interface {
	AssertProjectRuntimeOrigin(context.Context, string) error
	AuthorizeProjectRuntime(context.Context, *http.Request, IDEDeploymentOperation, string) error
}

type IDEProjectRuntimeExecutor interface {
	ProjectRuntimeOrigin() string
	RoundTripProject(context.Context, IDEDeploymentOperation, *http.Request) (*http.Response, error)
}

func validateIDEProjectOrigin(origin, cloud string) error {
	u, err := url.Parse(origin)
	v, cloudErr := url.Parse(cloud)
	if err != nil || cloudErr != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || net.ParseIP(u.Hostname()) != nil {
		return ErrInvalid
	}
	// Deliberately conservative cookie-site separation. Never host project HTML
	// on Cloud/Auth's origin or shared parent cookie domain. False-negative
	// admission is preferable to allowing an untrusted artifact into that site.
	tail := func(host string) string {
		parts := strings.Split(strings.ToLower(host), ".")
		if len(parts) < 2 {
			return ""
		}
		return strings.Join(parts[len(parts)-2:], ".")
	}
	if tail(u.Hostname()) == "" || tail(u.Hostname()) == tail(v.Hostname()) {
		return ErrInvalid
	}
	return nil
}

// This wraps the ORIGINAL Cloud listener. It adds no server, issuer, DNS entry,
// lease or static fallback. Without both original authority and an executor
// with an isolated registered origin it passes all traffic unchanged.
func (s *Server) WrapIDEProjectRuntime(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		d := s.ideDeployments
		if d == nil {
			next.ServeHTTP(w, r)
			return
		}
		executor, ok := d.executor.(IDEProjectRuntimeExecutor)
		if !ok || executor.ProjectRuntimeOrigin() == "" {
			next.ServeHTTP(w, r)
			return
		}
		origin := executor.ProjectRuntimeOrigin()
		base, err := url.Parse(origin)
		if err != nil {
			productReadFailure(w, 503, "IDE_RUNTIME_ORIGIN_UNAVAILABLE")
			return
		}
		host := strings.ToLower(r.Host)
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		suffix := "." + strings.ToLower(base.Hostname())
		if !strings.HasSuffix(host, suffix) && host != strings.ToLower(base.Hostname()) {
			next.ServeHTTP(w, r)
			return
		}
		label := strings.TrimSuffix(host, suffix)
		if len(label) != 65 || label[0] != 'h' || !ideRuntimeHandle.MatchString(label[1:]) {
			http.NotFound(w, r)
			return
		}
		authority, ok := d.authority.(IDEProjectRuntimeAuthority)
		if !ok {
			productReadFailure(w, 503, "IDE_RUNTIME_AUTHORITY_UNAVAILABLE")
			return
		}
		if d.authority.AssertCurrent(r.Context()) != nil {
			productReadFailure(w, 503, "IDE_RUNTIME_CURRENT_UNAVAILABLE")
			return
		}
		op, err := d.journal.lookupRuntime(label[1:])
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if op.State != "running" || op.RuntimeKind != "node-http-project" {
			productReadFailure(w, 410, "IDE_PROJECT_NOT_RUNNING")
			return
		}
		current := func() error {
			if err := r.Context().Err(); err != nil {
				return err
			}
			if err := d.authority.AssertCurrent(r.Context()); err != nil {
				return err
			}
			if err := authority.AssertProjectRuntimeOrigin(r.Context(), origin); err != nil {
				return err
			}
			return authority.AuthorizeProjectRuntime(r.Context(), r, op, origin)
		}
		if current() != nil {
			productReadFailure(w, 403, "IDE_RUNTIME_ACCESS_DENIED")
			return
		}
		// The project never receives Cloud/Auth bearer, cookie, proof, approval,
		// forwarded-header identities or control-plane environment credentials.
		request := r.Clone(r.Context())
		request.RequestURI = ""
		request.Header = make(http.Header)
		request.Header.Set("X-Forwarded-Proto", "https")
		request.Header.Set("X-Forwarded-Host", r.Host)
		for _, name := range []string{"Accept", "Accept-Language", "Accept-Encoding", "Content-Type", "If-None-Match", "If-Modified-Since", "Range", "User-Agent"} {
			for _, value := range r.Header.Values(name) {
				request.Header.Add(name, value)
			}
		}
		request.Body = http.MaxBytesReader(w, r.Body, MaxUploadBytes)
		if current() != nil {
			productReadFailure(w, 403, "IDE_RUNTIME_ACCESS_DENIED")
			return
		}
		response, err := executor.RoundTripProject(r.Context(), op, request)
		if err != nil || response == nil || response.Body == nil || response.StatusCode < 200 || response.StatusCode >= 600 {
			productReadFailure(w, 502, "IDE_RUNTIME_UPSTREAM_UNAVAILABLE")
			return
		}
		defer response.Body.Close()
		body, err := readIDEArtifactBounded(r.Context(), response.Body, MaxUploadBytes)
		if err != nil {
			productReadFailure(w, 502, "IDE_RUNTIME_RESPONSE_REJECTED")
			return
		}
		if current() != nil {
			productReadFailure(w, 403, "IDE_RUNTIME_ACCESS_DENIED")
			return
		}
		for _, name := range []string{"Content-Type", "Content-Encoding", "Cache-Control", "ETag", "Last-Modified", "Location", "Content-Range", "Accept-Ranges"} {
			for _, value := range response.Header.Values(name) {
				w.Header().Add(name, value)
			}
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
		w.WriteHeader(response.StatusCode)
		if r.Method != http.MethodHead {
			_, _ = io.Copy(w, &ideCurrentRuntimeReader{current: current, reader: bytes.NewReader(body)})
		}
	})
}

type ideCurrentRuntimeReader struct {
	current func() error
	reader  io.Reader
}

func (r *ideCurrentRuntimeReader) Read(p []byte) (int, error) {
	if err := r.current(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}
