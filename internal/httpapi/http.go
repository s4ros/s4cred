package httpapi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"strings"

	"github.com/s4ros/s4cred/internal/store"
)

const maxBody = 1_400_000

type Server struct {
	store  *store.Store
	origin string
	files  fs.FS
}

func New(s *store.Store, origin string, files fs.FS) http.Handler {
	return &Server{store: s, origin: origin, files: files}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	if r.Method == http.MethodPost && (r.URL.Path == "/api/notes" || isConsumePath(r.URL.Path)) {
		origins := r.Header.Values("Origin")
		if len(origins) != 1 || origins[0] != s.origin {
			writeError(w, http.StatusForbidden, "origin_forbidden")
			return
		}
		contentType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || contentType != "application/json" {
			writeError(w, http.StatusBadRequest, "invalid_note")
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
		if err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				writeError(w, http.StatusRequestEntityTooLarge, "too_large")
			} else {
				writeError(w, http.StatusBadRequest, "invalid_note")
			}
			return
		}
		if r.URL.Path == "/api/notes" {
			s.create(w, r, body)
		} else {
			s.consume(w, r, body)
		}
		return
	}
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		name, contentType := "", ""
		switch {
		case r.URL.Path == "/" || isNotePath(r.URL.Path):
			name, contentType = "index.html", "text/html; charset=utf-8"
		case r.URL.Path == "/app.js":
			name, contentType = "app.js", "text/javascript; charset=utf-8"
		case r.URL.Path == "/style.css":
			name, contentType = "style.css", "text/css; charset=utf-8"
		}
		if name != "" {
			data, err := fs.ReadFile(s.files, name)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "internal_error")
				return
			}
			w.Header().Set("Content-Type", contentType)
			if r.Method == http.MethodGet {
				_, _ = w.Write(data)
			}
			return
		}
	}
	writeError(w, http.StatusNotFound, "not_found")
}

func isNotePath(path string) bool {
	part := strings.TrimPrefix(path, "/n/")
	return part != path && part != "" && !strings.Contains(part, "/")
}

func isConsumePath(path string) bool {
	if !strings.HasPrefix(path, "/api/notes/") || !strings.HasSuffix(path, "/consume") {
		return false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, "/api/notes/"), "/consume")
	return id != "" && !strings.Contains(id, "/")
}

func decode(s string, size int) ([]byte, bool) {
	data, err := base64.RawURLEncoding.DecodeString(s)
	return data, err == nil && (size < 0 || len(data) == size) && base64.RawURLEncoding.EncodeToString(data) == s
}

// object rejects duplicate keys so a request has one unambiguous interpretation.
func object(body []byte) (map[string]json.RawMessage, bool) {
	d := json.NewDecoder(bytes.NewReader(body))
	start, err := d.Token()
	if err != nil || start != json.Delim('{') {
		return nil, false
	}
	fields := make(map[string]json.RawMessage)
	for d.More() {
		key, err := d.Token()
		if err != nil {
			return nil, false
		}
		name, ok := key.(string)
		if !ok {
			return nil, false
		}
		if _, duplicate := fields[name]; duplicate {
			return nil, false
		}
		var value json.RawMessage
		if d.Decode(&value) != nil {
			return nil, false
		}
		fields[name] = value
	}
	end, err := d.Token()
	if err != nil || end != json.Delim('}') || d.Decode(new(any)) != io.EOF {
		return nil, false
	}
	return fields, true
}

func (s *Server) create(w http.ResponseWriter, r *http.Request, body []byte) {
	var input struct {
		Ciphertext    string `json:"ciphertext"`
		Nonce         string `json:"nonce"`
		TTL           int64  `json:"ttl"`
		ReadTokenHash string `json:"read_token_hash"`
	}
	fields, ok := object(body)
	if !ok || len(fields) != 4 || fields["ciphertext"] == nil || fields["nonce"] == nil || fields["ttl"] == nil || fields["read_token_hash"] == nil || json.Unmarshal(body, &input) != nil {
		writeError(w, http.StatusBadRequest, "invalid_note")
		return
	}
	ciphertext, cOK := decode(input.Ciphertext, -1)
	nonce, nOK := decode(input.Nonce, 12)
	tokenHash, hOK := decode(input.ReadTokenHash, 32)
	if !cOK || !nOK || !hOK || len(ciphertext) < 17 || len(ciphertext) > store.MaxCiphertext || !store.ValidTTL(input.TTL) {
		writeError(w, http.StatusBadRequest, "invalid_note")
		return
	}
	id, err := s.store.Create(r.Context(), ciphertext, nonce, tokenHash, input.TTL)
	if errors.Is(err, store.ErrCapacity) {
		writeError(w, http.StatusServiceUnavailable, "capacity_exceeded")
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error")
	} else {
		writeJSON(w, http.StatusCreated, map[string]string{"id": id})
	}
}

func (s *Server) consume(w http.ResponseWriter, r *http.Request, body []byte) {
	if !json.Valid(body) {
		writeError(w, http.StatusBadRequest, "invalid_note")
		return
	}
	input, ok := object(body)
	if !ok || len(input) != 1 || input["read_token"] == nil {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	var tokenString string
	_ = json.Unmarshal(input["read_token"], &tokenString)
	token, tokenOK := decode(tokenString, 32)
	idString := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/notes/"), "/consume")
	id, idOK := decode(idString, 32)
	if !tokenOK || !idOK {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	ciphertext, nonce, err := s.store.Consume(r.Context(), id, token)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found")
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error")
	} else {
		writeJSON(w, http.StatusOK, map[string]string{
			"ciphertext": base64.RawURLEncoding.EncodeToString(ciphertext),
			"nonce":      base64.RawURLEncoding.EncodeToString(nonce),
		})
	}
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
