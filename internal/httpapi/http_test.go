package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/s4ros/s4cred/internal/store"
)

const origin = "https://notes.example"

func setup(t *testing.T, count, size int64) http.Handler {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "notes.db"), count, size)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return New(s, origin, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("index")},
		"app.js":     &fstest.MapFile{Data: []byte("script")},
		"style.css":  &fstest.MapFile{Data: []byte("style")},
	})
}

func enc(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func request(h http.Handler, method, path, body, originValue, contentType string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if originValue != "" {
		req.Header.Set("Origin", originValue)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func post(h http.Handler, path, body string) *httptest.ResponseRecorder {
	return request(h, "POST", path, body, origin, "application/json")
}

var codeSeq atomic.Int64

func nextCode() string {
	n := codeSeq.Add(1)
	alphabet := []byte("0123456789abcdefghjkmnpqrstvwxyz")
	out := bytes.Repeat([]byte{'0'}, 16)
	for i := 15; i >= 0 && n > 0; i-- {
		out[i] = alphabet[n%32]
		n /= 32
	}
	return string(out)
}

func testSecret(flags byte) []byte {
	n := 110
	if flags == 1 {
		n = 154
	}
	secret := bytes.Repeat([]byte{0x11}, n)
	secret[0] = 0x02
	secret[1] = flags
	return secret
}

func createBodyFor(t *testing.T, code string, ciphertext, nonce, token []byte, ttl int64) string {
	t.Helper()
	hash := sha256.Sum256(token)
	idHash := sha256.Sum256([]byte(code))
	b, err := json.Marshal(map[string]any{
		"ciphertext": enc(ciphertext), "nonce": enc(nonce), "ttl": ttl, "read_token_hash": enc(hash[:]),
		"id_hash": enc(idHash[:]), "link_secret": enc(testSecret(0)),
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func createBody(t *testing.T, ciphertext, nonce, token []byte, ttl int64) string {
	t.Helper()
	return createBodyFor(t, nextCode(), ciphertext, nonce, token, ttl)
}

func createNote(t *testing.T, h http.Handler, ciphertext, nonce, token []byte, ttl int64) string {
	t.Helper()
	code := nextCode()
	w := post(h, "/api/notes", createBodyFor(t, code, ciphertext, nonce, token, ttl))
	if w.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var response map[string]bool
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || len(response) != 1 || !response["ok"] {
		t.Fatalf("create response: %s, %v", w.Body.String(), err)
	}
	return code
}

func TestCreateConsumeAndMissingTokens(t *testing.T) {
	h := setup(t, 10, 10000)
	ciphertext, nonce, token := bytes.Repeat([]byte{0xa1}, 17), bytes.Repeat([]byte{0xb2}, 12), bytes.Repeat([]byte{0xc3}, 32)
	id := createNote(t, h, ciphertext, nonce, token, 3600)
	path := "/api/notes/" + id + "/consume"
	for _, body := range []string{
		`{}`, `null`, `[]`, `123`, `"string"`, `{"read_token":null}`, `{"read_token":123}`,
		`{"read_token":[]}`, `{"read_token":"bad"}`, `{"read_token":"` + enc(token) + `="}`,
		`{"read_token":"` + enc(make([]byte, 32))[:42] + `B"}`,
		`{"read_token":123,"read_token":"` + enc(token) + `"}`,
		`{"read_token":"` + enc(token) + `","read_token":123}`,
		`{"READ_TOKEN":"` + enc(token) + `"}`,
		`{"read_token":"` + enc(bytes.Repeat([]byte{9}, 32)) + `"}`,
		`{"read_token":"` + enc(token) + `","extra":true}`,
		`{"extra":null,"read_token":"` + enc(token) + `"}`,
		`{"read_token":"` + enc(token) + `","READ_TOKEN":"` + enc(token) + `"}`,
	} {
		w := post(h, path, body)
		if w.Code != 404 || w.Body.String() != "{\"error\":\"not_found\"}\n" {
			t.Fatalf("body %s: %d %s", body, w.Code, w.Body.String())
		}
	}
	if w := post(h, path, `{`); w.Code != 400 || !strings.Contains(w.Body.String(), "invalid_note") {
		t.Fatalf("malformed JSON: %d %s", w.Code, w.Body.String())
	}
	w := post(h, path, `{"read_token":"`+enc(token)+`"}`)
	var response map[string]string
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &response) != nil || len(response) != 2 || response["ciphertext"] != enc(ciphertext) || response["nonce"] != enc(nonce) {
		t.Fatalf("consume: %d %s", w.Code, w.Body.String())
	}
	if w = post(h, path, `{"read_token":"`+enc(token)+`"}`); w.Code != 404 || w.Body.String() != "{\"error\":\"not_found\"}\n" {
		t.Fatalf("second consume: %d %s", w.Code, w.Body.String())
	}
}

func TestEntireBodyLimitAndTrailingValues(t *testing.T) {
	h := setup(t, 10, 1000)
	seenChunked := make(chan bool, 20)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenChunked <- len(r.TransferEncoding) == 1 && r.TransferEncoding[0] == "chunked"
		h.ServeHTTP(w, r)
	}))
	defer server.Close()
	send := func(path, body string, chunked bool) (int, string) {
		t.Helper()
		var reader io.Reader = strings.NewReader(body)
		if chunked {
			reader = io.NopCloser(reader)
		}
		req, err := http.NewRequest("POST", server.URL+path, reader)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Origin", origin)
		req.Header.Set("Content-Type", "application/json")
		resp, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		response, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatal(err)
		}
		if got := <-seenChunked; got != chunked {
			t.Fatalf("chunked transfer = %v, want %v", got, chunked)
		}
		return resp.StatusCode, string(response)
	}
	token := make([]byte, 32)
	code := nextCode()
	create := createBodyFor(t, code, make([]byte, 17), make([]byte, 12), token, 3600)
	for _, chunked := range []bool{false, true} {
		for _, body := range []string{
			create + strings.Repeat(" ", maxBody+1-len(create)),
			create + strings.Repeat(" ", maxBody-len(create)) + "{}",
		} {
			if code, response := send("/api/notes", body, chunked); code != 413 || response != "{\"error\":\"too_large\"}\n" {
				t.Fatalf("oversize create (chunked=%v): %d %s", chunked, code, response)
			}
		}
		for _, body := range []string{create + "{}", create + " null", strings.Replace(create, `"ttl":3600`, `"ttl":3600,"ttl":3600`, 1)} {
			if code, response := send("/api/notes", body, chunked); code != 400 || response != "{\"error\":\"invalid_note\"}\n" {
				t.Fatalf("invalid create (chunked=%v): %d %s", chunked, code, response)
			}
		}
	}
	status, response := send("/api/notes", create+strings.Repeat(" ", maxBody-len(create)), true)
	var created map[string]bool
	if status != 201 || json.Unmarshal([]byte(response), &created) != nil || !created["ok"] {
		t.Fatalf("exact limit create: %d %s", status, response)
	}
	path := "/api/notes/" + code + "/consume"
	consume := `{"read_token":"` + enc(token) + `"}`
	for _, chunked := range []bool{false, true} {
		for _, body := range []string{
			consume + strings.Repeat(" ", maxBody+1-len(consume)),
			consume + strings.Repeat(" ", maxBody-len(consume)) + "{}",
		} {
			if code, response := send(path, body, chunked); code != 413 || response != "{\"error\":\"too_large\"}\n" {
				t.Fatalf("oversize consume (chunked=%v): %d %s", chunked, code, response)
			}
		}
		for _, body := range []string{consume + "{}", consume + " null"} {
			if code, response := send(path, body, chunked); code != 400 || response != "{\"error\":\"invalid_note\"}\n" {
				t.Fatalf("trailing value (chunked=%v): %d %s", chunked, code, response)
			}
		}
	}
	status, response = send(path, consume+strings.Repeat(" ", maxBody-len(consume)), true)
	if status != 200 {
		t.Fatalf("exact limit consume after rejected attempts: %d %s", status, response)
	}
}

func TestCreateValidation(t *testing.T) {
	h := setup(t, 100, 10_000_000)
	token := make([]byte, 32)
	valid := createBody(t, make([]byte, 17), make([]byte, 12), token, 3600)
	var data map[string]any
	if err := json.Unmarshal([]byte(valid), &data); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, field string
		value       any
	}{
		{"short ciphertext", "ciphertext", enc(make([]byte, 16))},
		{"long ciphertext", "ciphertext", enc(make([]byte, store.MaxCiphertext+1))},
		{"padded", "ciphertext", enc(make([]byte, 17)) + "="},
		{"newline", "ciphertext", enc(make([]byte, 17)) + "\n"},
		{"noncanonical bits", "read_token_hash", enc(make([]byte, 32))[:42] + "B"},
		{"short nonce", "nonce", enc(make([]byte, 11))},
		{"short hash", "read_token_hash", enc(make([]byte, 31))},
		{"bad ttl", "ttl", 3601},
		{"fractional ttl", "ttl", 3600.5},
		{"null ttl", "ttl", nil},
		{"unknown field", "password", "not accepted"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			copy := make(map[string]any)
			for k, v := range data {
				copy[k] = v
			}
			copy[tc.field] = tc.value
			body, _ := json.Marshal(copy)
			w := post(h, "/api/notes", string(body))
			if w.Code != 400 || w.Body.String() != "{\"error\":\"invalid_note\"}\n" {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
		})
	}
	for _, body := range []string{"", "{", valid + "{}", "[]", "null", strings.Replace(valid, `"ttl":3600`, `"ttl":1,"ttl":3600`, 1), strings.Replace(valid, `"nonce":`, `"Nonce":`, 1)} {
		if w := post(h, "/api/notes", body); w.Code != 400 {
			t.Fatalf("invalid JSON/body: %d", w.Code)
		}
	}
	for _, ttl := range []int64{3600, 86400, 604800} {
		createNote(t, h, make([]byte, 17), make([]byte, 12), token, ttl)
	}
}

func TestMaximumAndRequestLimit(t *testing.T) {
	h := setup(t, 5, 3_000_000)
	ciphertext := bytes.Repeat([]byte{0x42}, store.MaxCiphertext)
	nonce, token := make([]byte, 12), make([]byte, 32)
	id := createNote(t, h, ciphertext, nonce, token, 86400)
	w := post(h, "/api/notes/"+id+"/consume", `{"read_token":"`+enc(token)+`"}`)
	var result map[string]string
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || result["ciphertext"] != enc(ciphertext) {
		t.Fatalf("maximum-size consume: %d", w.Code)
	}
	w = post(h, "/api/notes", strings.Repeat(" ", maxBody+1))
	if w.Code != 413 || w.Body.String() != "{\"error\":\"too_large\"}\n" {
		t.Fatalf("request limit: %d %s", w.Code, w.Body.String())
	}
}

func TestOriginContentTypeAndCapacity(t *testing.T) {
	h := setup(t, 1, 100)
	body := createBody(t, make([]byte, 17), make([]byte, 12), make([]byte, 32), 3600)
	for _, badOrigin := range []string{"", "null", "https://evil.example", "https://notes.example/", "https://notes.example.evil.example", origin + ", " + origin} {
		w := request(h, "POST", "/api/notes", body, badOrigin, "application/json")
		if w.Code != 403 || w.Body.String() != "{\"error\":\"origin_forbidden\"}\n" {
			t.Fatalf("origin %q: %d %s", badOrigin, w.Code, w.Body.String())
		}
		if w.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatal("unexpected CORS response")
		}
	}
	for _, ct := range []string{"", "text/plain", "application/jsonp", "application/json; bad"} {
		w := request(h, "POST", "/api/notes", body, origin, ct)
		if w.Code != 400 {
			t.Fatalf("content type %q: %d", ct, w.Code)
		}
	}
	if w := request(h, "POST", "/api/notes", body, origin, "application/json; charset=utf-8"); w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	if w := post(h, "/api/notes", body); w.Code != 503 || w.Body.String() != "{\"error\":\"capacity_exceeded\"}\n" {
		t.Fatalf("capacity: %d %s", w.Code, w.Body.String())
	}
}

func TestStaticHeadersAndGetDoesNotConsume(t *testing.T) {
	h := setup(t, 10, 1000)
	token := make([]byte, 32)
	id := createNote(t, h, make([]byte, 17), make([]byte, 12), token, 3600)
	for _, tc := range []struct{ path, body, contentType string }{
		{"/", "index", "text/html"}, {"/n/" + id, "index", "text/html"},
		{"/app.js", "script", "text/javascript"}, {"/style.css", "style", "text/css"},
	} {
		w := request(h, "GET", tc.path, "", "", "")
		if w.Code != 200 || w.Body.String() != tc.body || !strings.HasPrefix(w.Header().Get("Content-Type"), tc.contentType) {
			t.Fatalf("GET %s: %d %q", tc.path, w.Code, w.Body.String())
		}
		for key, value := range map[string]string{"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY"} {
			if w.Header().Get(key) != value {
				t.Fatalf("%s = %q", key, w.Header().Get(key))
			}
		}
		csp := w.Header().Get("Content-Security-Policy")
		for _, part := range []string{"script-src 'self'", "style-src 'self'", "connect-src 'self'", "frame-ancestors 'none'"} {
			if !strings.Contains(csp, part) {
				t.Fatalf("CSP missing %s", part)
			}
		}
	}
	w := post(h, "/api/notes/"+id+"/consume", fmt.Sprintf(`{"read_token":%q}`, enc(token)))
	if w.Code != 200 {
		t.Fatalf("GET consumed note: %d", w.Code)
	}
}

func TestConcurrentAPIConsume(t *testing.T) {
	h := setup(t, 5, 1000)
	token := bytes.Repeat([]byte{1}, 32)
	id := createNote(t, h, make([]byte, 17), make([]byte, 12), token, 3600)
	path := "/api/notes/" + id + "/consume"
	body := fmt.Sprintf(`{"read_token":%q}`, enc(token))
	var success, missing, bad atomic.Int64
	var wg sync.WaitGroup
	for range 50 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			switch post(h, path, body).Code {
			case 200:
				success.Add(1)
			case 404:
				missing.Add(1)
			default:
				bad.Add(1)
			}
		}()
	}
	wg.Wait()
	if success.Load() != 1 || missing.Load() != 49 || bad.Load() != 0 {
		t.Fatalf("success %d missing %d bad %d", success.Load(), missing.Load(), bad.Load())
	}
}

func TestConcurrentCanceledConsumesDoNotDelete(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notes.db")
	s, err := store.Open(path, 10, 1000)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	h := New(s, origin, fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("index")}})
	token := make([]byte, 32)
	id := createNote(t, h, make([]byte, 17), make([]byte, 12), token, 3600)
	other, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	conn, err := other.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(context.Background(), "BEGIN IMMEDIATE"); err != nil {
		t.Fatal(err)
	}
	defer conn.ExecContext(context.Background(), "ROLLBACK")
	consumePath := "/api/notes/" + id + "/consume"
	body := fmt.Sprintf(`{"read_token":%q}`, enc(token))
	const n = 7
	results := make(chan *httptest.ResponseRecorder, n)
	for range n {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
			defer cancel()
			req := httptest.NewRequest("POST", consumePath, strings.NewReader(body)).WithContext(ctx)
			req.Header.Set("Origin", origin)
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			results <- w
		}()
	}
	for range n {
		select {
		case w := <-results:
			if w.Code != 500 || w.Body.String() != "{\"error\":\"internal_error\"}\n" {
				t.Errorf("canceled consume: %d %s", w.Code, w.Body.String())
			}
		case <-time.After(2 * time.Second):
			t.Fatal("consume did not stop while external write lock was held")
		}
	}
	if _, err := conn.ExecContext(context.Background(), "ROLLBACK"); err != nil {
		t.Fatal(err)
	}
	if w := post(h, consumePath, body); w.Code != 200 {
		t.Fatalf("canceled attempts consumed note: %d %s", w.Code, w.Body.String())
	}
}

func TestExpiredAndMissingHaveSameResponse(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notes.db")
	s, err := store.Open(path, 10, 1000)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	h := New(s, origin, fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("index")}})
	token := make([]byte, 32)
	id := createNote(t, h, make([]byte, 17), make([]byte, 12), token, 3600)
	other, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	if _, err := other.Exec(`UPDATE notes SET expires_at = 0`); err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`{"read_token":%q}`, enc(token))
	expired := post(h, "/api/notes/"+id+"/consume", body)
	missing := post(h, "/api/notes/"+enc(bytes.Repeat([]byte{0xff}, 32))+"/consume", body)
	if expired.Code != 404 || missing.Code != 404 || expired.Body.String() != missing.Body.String() {
		t.Fatalf("expired: %d %s; missing: %d %s", expired.Code, expired.Body, missing.Code, missing.Body)
	}
}

func TestForbiddenConsumeDoesNotDelete(t *testing.T) {
	h := setup(t, 5, 1000)
	token := make([]byte, 32)
	id := createNote(t, h, make([]byte, 17), make([]byte, 12), token, 3600)
	path, body := "/api/notes/"+id+"/consume", fmt.Sprintf(`{"read_token":%q}`, enc(token))
	for _, badOrigin := range []string{"", "null", "https://evil.example"} {
		w := request(h, "POST", path, body, badOrigin, "application/json")
		if w.Code != 403 {
			t.Fatalf("origin %q: %d", badOrigin, w.Code)
		}
	}
	req := httptest.NewRequest("POST", path, strings.NewReader(body))
	req.Header.Add("Origin", origin)
	req.Header.Add("Origin", origin)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Fatalf("multiple origins: %d", w.Code)
	}
	if w = post(h, path, body); w.Code != 200 {
		t.Fatalf("forbidden requests consumed note: %d", w.Code)
	}
}

func TestShortLinkMaterialAndLegacyConsume(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notes.db")
	db, err := store.Open(path, 10, 10000)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := New(db, origin, fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("index")}})
	ciphertext, nonce, token := bytes.Repeat([]byte{0xa1}, 17), bytes.Repeat([]byte{0xb2}, 12), bytes.Repeat([]byte{0xc3}, 32)
	code := "k7hm2pqx9vjw4nrt"
	body := createBodyFor(t, code, ciphertext, nonce, token, 3600)
	var without map[string]any
	if err := json.Unmarshal([]byte(body), &without); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"id_hash", "link_secret"} {
		copy := mapsClone(without)
		delete(copy, field)
		encoded, _ := json.Marshal(copy)
		if w := post(h, "/api/notes", string(encoded)); w.Code != 400 || !strings.Contains(w.Body.String(), "invalid_note") {
			t.Fatalf("missing %s: %d %s", field, w.Code, w.Body.String())
		}
	}
	badSecret := testSecret(0)
	badSecret[0] = 0x01
	bad := mapsClone(without)
	bad["link_secret"] = enc(badSecret)
	encoded, _ := json.Marshal(bad)
	if w := post(h, "/api/notes", string(encoded)); w.Code != 400 {
		t.Fatalf("bad seal: %d %s", w.Code, w.Body.String())
	}
	mismatch := mapsClone(without)
	mismatch["link_secret"] = enc(testSecret(1)[:110])
	encoded, _ = json.Marshal(mismatch)
	if w := post(h, "/api/notes", string(encoded)); w.Code != 400 {
		t.Fatalf("flag mismatch: %d %s", w.Code, w.Body.String())
	}
	if w := post(h, "/api/notes", body); w.Code != 201 || w.Body.String() != "{\"ok\":true}\n" || strings.Contains(w.Body.String(), code) {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	if w := request(h, "GET", "/n/"+code, "", "", ""); w.Code != 200 || w.Body.String() != "index" {
		t.Fatalf("GET note page: %d %s", w.Code, w.Body.String())
	}
	material := "/api/notes/" + strings.ToUpper(code) + "/material"
	if w := request(h, "POST", material, `{}`, "", "application/json"); w.Code != 403 {
		t.Fatalf("material origin: %d", w.Code)
	}
	if w := post(h, material, `{"extra":1}`); w.Code != 404 {
		t.Fatalf("material body: %d %s", w.Code, w.Body.String())
	}
	if w := post(h, material, `{`); w.Code != 400 {
		t.Fatalf("malformed material: %d %s", w.Code, w.Body.String())
	}
	secret := enc(testSecret(0))
	for range 2 {
		w := post(h, material, `{}`)
		var got map[string]string
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &got) != nil || got["link_secret"] != secret {
			t.Fatalf("material: %d %s", w.Code, w.Body.String())
		}
	}
	if w := post(h, "/api/notes/iiiiiiiiiiiiiiii/material", `{}`); w.Code != 404 {
		t.Fatalf("malformed code: %d", w.Code)
	}
	if w := post(h, "/api/notes/"+code+"/consume", `{"read_token":"`+enc(token)+`"}`); w.Code != 200 {
		t.Fatalf("consume: %d %s", w.Code, w.Body.String())
	}
	if w := post(h, material, `{}`); w.Code != 404 || w.Body.String() != "{\"error\":\"not_found\"}\n" {
		t.Fatalf("material after consume: %d %s", w.Code, w.Body.String())
	}
	legacyToken := bytes.Repeat([]byte{0x44}, 32)
	legacyHash := sha256.Sum256(legacyToken)
	legacyID, err := db.Create(context.Background(), ciphertext, nonce, legacyHash[:], 86400)
	if err != nil {
		t.Fatal(err)
	}
	if w := post(h, "/api/notes/"+legacyID+"/material", `{}`); w.Code != 404 {
		t.Fatalf("legacy material: %d", w.Code)
	}
	if w := post(h, "/api/notes/"+legacyID+"/consume", `{"read_token":"`+enc(legacyToken)+`"}`); w.Code != 200 {
		t.Fatalf("legacy consume: %d %s", w.Code, w.Body.String())
	}
	if w := post(h, "/api/notes/"+legacyID+"/consume", `{"read_token":"`+enc(legacyToken)+`"}`); w.Code != 404 {
		t.Fatalf("second legacy consume: %d", w.Code)
	}
}

func mapsClone(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}
