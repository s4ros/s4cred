package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/s4ros/s4cred/internal/blob"
	"github.com/s4ros/s4cred/internal/store"
)

const maxBody = 1_400_000

const (
	maxHeader      = 8192
	maxMetaCipher  = 4112
	maxFileCipher  = 33_554_448
	maxFileRequest = 4 + maxHeader + maxFileCipher
	uploadType     = "application/vnd.s4cred.upload"
	payloadType    = "application/vnd.s4cred.payload"
)

type Server struct {
	store  *store.Store
	blobs  *blob.Dir
	origin string
	assets fs.FS
}

func New(notes *store.Store, blobs *blob.Dir, origin string, assets fs.FS) http.Handler {
	return &Server{store: notes, blobs: blobs, origin: origin, assets: assets}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	if r.Method == http.MethodPost && (r.URL.Path == "/api/files" || r.URL.Path == "/api/notes" || isConsumePath(r.URL.Path) || isMaterialPath(r.URL.Path)) {
		if !s.allowOrigin(w, r) {
			return
		}
		if r.URL.Path == "/api/files" {
			s.upload(w, r)
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
		switch {
		case r.URL.Path == "/api/notes":
			s.create(w, r, body)
		case isMaterialPath(r.URL.Path):
			s.material(w, r, body)
		default:
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
			data, err := fs.ReadFile(s.assets, name)
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

func (s *Server) allowOrigin(w http.ResponseWriter, r *http.Request) bool {
	origins := r.Header.Values("Origin")
	if len(origins) != 1 || origins[0] != s.origin {
		writeError(w, http.StatusForbidden, "origin_forbidden")
		return false
	}
	return true
}

func isNotePath(path string) bool {
	part := strings.TrimPrefix(path, "/n/")
	return part != path && part != "" && !strings.Contains(part, "/")
}

func isConsumePath(path string) bool { return noteAction(path, "/consume") }

func isMaterialPath(path string) bool { return noteAction(path, "/material") }

func noteAction(path, suffix string) bool {
	if !strings.HasPrefix(path, "/api/notes/") || !strings.HasSuffix(path, suffix) {
		return false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, "/api/notes/"), suffix)
	return id != "" && !strings.Contains(id, "/")
}

const shortAlphabet = "0123456789abcdefghjkmnpqrstvwxyz"

func shortCode(raw string) ([]byte, bool) {
	if len(raw) != 16 {
		return nil, false
	}
	out := make([]byte, 16)
	for i := 0; i < 16; i++ {
		c := raw[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		if !strings.ContainsRune(shortAlphabet, rune(c)) {
			return nil, false
		}
		out[i] = c
	}
	return out, true
}

func lookupID(raw string) ([]byte, bool) {
	if code, ok := shortCode(raw); ok {
		return code, true
	}
	return decode(raw, 32)
}

func validLinkSecret(secret []byte) bool {
	if len(secret) == 110 && secret[0] == 0x02 && secret[1] == 0x00 {
		return true
	}
	return len(secret) == 154 && secret[0] == 0x02 && secret[1] == 0x01
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
		IDHash        string `json:"id_hash"`
		LinkSecret    string `json:"link_secret"`
	}
	fields, ok := object(body)
	if !ok || len(fields) != 6 || fields["ciphertext"] == nil || fields["nonce"] == nil || fields["ttl"] == nil || fields["read_token_hash"] == nil || fields["id_hash"] == nil || fields["link_secret"] == nil || json.Unmarshal(body, &input) != nil {
		writeError(w, http.StatusBadRequest, "invalid_note")
		return
	}
	ciphertext, cOK := decode(input.Ciphertext, -1)
	nonce, nOK := decode(input.Nonce, 12)
	tokenHash, hOK := decode(input.ReadTokenHash, 32)
	idHash, iOK := decode(input.IDHash, 32)
	linkSecret, sOK := decode(input.LinkSecret, -1)
	if !cOK || !nOK || !hOK || !iOK || !sOK || !validLinkSecret(linkSecret) || len(ciphertext) < 17 || len(ciphertext) > store.MaxCiphertext || !store.ValidTTL(input.TTL) {
		writeError(w, http.StatusBadRequest, "invalid_note")
		return
	}
	err := s.store.CreateSealed(r.Context(), idHash, linkSecret, ciphertext, nonce, tokenHash, input.TTL)
	if errors.Is(err, store.ErrCapacity) {
		writeError(w, http.StatusServiceUnavailable, "capacity_exceeded")
	} else if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_note")
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error")
	} else {
		writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
	}
}

func (s *Server) material(w http.ResponseWriter, r *http.Request, body []byte) {
	if !json.Valid(body) {
		writeError(w, http.StatusBadRequest, "invalid_note")
		return
	}
	fields, ok := object(body)
	if !ok || len(fields) != 0 {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	code, ok := shortCode(strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/notes/"), "/material"))
	if !ok {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	got, err := s.store.Material(r.Context(), code)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found")
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error")
	} else {
		payload := map[string]any{"link_secret": base64.RawURLEncoding.EncodeToString(got.LinkSecret)}
		if got.Meta != nil {
			payload["file"] = map[string]string{
				"ciphertext": base64.RawURLEncoding.EncodeToString(got.Meta),
				"nonce":      base64.RawURLEncoding.EncodeToString(got.Nonce),
			}
		}
		writeJSON(w, http.StatusOK, payload)
	}
}

func (s *Server) consume(w http.ResponseWriter, r *http.Request, body []byte) {
	if !json.Valid(body) {
		writeError(w, http.StatusBadRequest, "invalid_note")
		return
	}
	input, ok := object(body)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	acceptFile := false
	switch len(input) {
	case 1:
		if input["read_token"] == nil {
			writeError(w, http.StatusNotFound, "not_found")
			return
		}
	case 2:
		raw, present := input["accept_file"]
		if input["read_token"] == nil || !present {
			writeError(w, http.StatusNotFound, "not_found")
			return
		}
		var flag bool
		if json.Unmarshal(raw, &flag) != nil || !flag {
			writeError(w, http.StatusNotFound, "not_found")
			return
		}
		acceptFile = true
	default:
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	var tokenString string
	_ = json.Unmarshal(input["read_token"], &tokenString)
	token, tokenOK := decode(tokenString, 32)
	idString := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/notes/"), "/consume")
	id, idOK := lookupID(idString)
	if !tokenOK || !idOK {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	secret, err := s.store.Consume(r.Context(), id, token, acceptFile)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error")
		return
	}
	if secret.FileID == nil {
		writeJSON(w, http.StatusOK, map[string]string{
			"ciphertext": base64.RawURLEncoding.EncodeToString(secret.Ciphertext),
			"nonce":      base64.RawURLEncoding.EncodeToString(secret.Nonce),
		})
		return
	}
	s.writeFilePayload(w, r, secret)
}

type payloadHead struct {
	Ciphertext string `json:"ciphertext"`
	Nonce      string `json:"nonce"`
	FileNonce  string `json:"file_nonce"`
	FileSize   int64  `json:"file_size"`
}

func (s *Server) writeFilePayload(w http.ResponseWriter, r *http.Request, secret store.Secret) {
	f, err := s.blobs.Open(secret.FileID)
	if err != nil {
		s.releaseFile(r.Context(), secret.FileID)
		writeError(w, http.StatusInternalServerError, "internal_error")
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.Size() != secret.FileSize {
		s.releaseFile(r.Context(), secret.FileID)
		writeError(w, http.StatusInternalServerError, "internal_error")
		return
	}
	head, err := json.Marshal(payloadHead{
		Ciphertext: base64.RawURLEncoding.EncodeToString(secret.Ciphertext),
		Nonce:      base64.RawURLEncoding.EncodeToString(secret.Nonce),
		FileNonce:  base64.RawURLEncoding.EncodeToString(secret.FileNonce),
		FileSize:   secret.FileSize,
	})
	if err != nil {
		s.releaseFile(r.Context(), secret.FileID)
		writeError(w, http.StatusInternalServerError, "internal_error")
		return
	}
	w.Header().Set("Content-Type", payloadType)
	w.Header().Set("Content-Length", strconv.FormatInt(4+int64(len(head))+secret.FileSize, 10))
	w.WriteHeader(http.StatusOK)
	var lenBuf [4]byte
	binary.BigEndian.PutUint32(lenBuf[:], uint32(len(head)))
	_, _ = w.Write(lenBuf[:])
	_, _ = w.Write(head)
	_, _ = io.CopyN(w, f, secret.FileSize)
	s.releaseFile(r.Context(), secret.FileID)
}

func (s *Server) releaseFile(ctx context.Context, fileID []byte) {
	_ = s.blobs.Remove(fileID)
	_ = s.store.ForgetDelivery(ctx, fileID)
}

type uploadFields struct {
	meta, nonce, fileNonce, tokenHash, idHash, linkSecret []byte
	fileSize, ttl                                         int64
}

func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	mediaType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != uploadType || len(params) != 0 {
		writeError(w, http.StatusBadRequest, "invalid_note")
		return
	}
	body := http.MaxBytesReader(w, r.Body, maxFileRequest)
	if r.ContentLength > maxFileRequest {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large")
		return
	}
	var lenBuf [4]byte
	if _, err := io.ReadFull(body, lenBuf[:]); err != nil {
		writeBodyErr(w, err)
		return
	}
	headerLen := binary.BigEndian.Uint32(lenBuf[:])
	if headerLen < 1 || headerLen > maxHeader {
		writeError(w, http.StatusBadRequest, "invalid_note")
		return
	}
	header := make([]byte, headerLen)
	if _, err := io.ReadFull(body, header); err != nil {
		writeBodyErr(w, err)
		return
	}
	fields, ok := parseUploadHeader(header)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_note")
		return
	}
	id, err := s.blobs.Write(body, fields.fileSize)
	if err != nil {
		writeBodyErr(w, err)
		return
	}
	var extra [1]byte
	n, err := body.Read(extra[:])
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		_ = s.blobs.Remove(id)
		writeError(w, http.StatusRequestEntityTooLarge, "too_large")
		return
	}
	if n > 0 || (err != nil && !errors.Is(err, io.EOF)) {
		_ = s.blobs.Remove(id)
		if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
			writeError(w, http.StatusInternalServerError, "internal_error")
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_note")
		return
	}
	err = s.store.CreateFile(r.Context(), fields.idHash, fields.linkSecret, fields.meta, fields.nonce, fields.tokenHash, id, fields.fileNonce, fields.fileSize, fields.ttl)
	if err != nil {
		_ = s.blobs.Remove(id)
		if errors.Is(err, store.ErrCapacity) {
			writeError(w, http.StatusServiceUnavailable, "capacity_exceeded")
		} else if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_note")
		} else {
			writeError(w, http.StatusInternalServerError, "internal_error")
		}
		return
	}
	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

func parseUploadHeader(header []byte) (uploadFields, bool) {
	raw, ok := object(header)
	if !ok || len(raw) != 8 {
		return uploadFields{}, false
	}
	for _, name := range []string{"ciphertext", "nonce", "file_nonce", "file_size", "ttl", "read_token_hash", "id_hash", "link_secret"} {
		if raw[name] == nil {
			return uploadFields{}, false
		}
	}
	var input struct {
		Ciphertext    string `json:"ciphertext"`
		Nonce         string `json:"nonce"`
		FileNonce     string `json:"file_nonce"`
		FileSize      int64  `json:"file_size"`
		TTL           int64  `json:"ttl"`
		ReadTokenHash string `json:"read_token_hash"`
		IDHash        string `json:"id_hash"`
		LinkSecret    string `json:"link_secret"`
	}
	if json.Unmarshal(header, &input) != nil {
		return uploadFields{}, false
	}
	meta, metaOK := decode(input.Ciphertext, -1)
	nonce, nonceOK := decode(input.Nonce, 12)
	fileNonce, fileNonceOK := decode(input.FileNonce, 12)
	tokenHash, tokenOK := decode(input.ReadTokenHash, 32)
	idHash, idOK := decode(input.IDHash, 32)
	linkSecret, secretOK := decode(input.LinkSecret, -1)
	if !metaOK || !nonceOK || !fileNonceOK || !tokenOK || !idOK || !secretOK || !validLinkSecret(linkSecret) || len(meta) < 17 || len(meta) > maxMetaCipher || bytes.Equal(nonce, fileNonce) || input.FileSize < 17 || input.FileSize > maxFileCipher || !store.ValidTTL(input.TTL) {
		return uploadFields{}, false
	}
	return uploadFields{
		meta: meta, nonce: nonce, fileNonce: fileNonce, tokenHash: tokenHash, idHash: idHash, linkSecret: linkSecret,
		fileSize: input.FileSize, ttl: input.TTL,
	}, true
}

func writeBodyErr(w http.ResponseWriter, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large")
		return
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		writeError(w, http.StatusBadRequest, "invalid_note")
		return
	}
	writeError(w, http.StatusInternalServerError, "internal_error")
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
