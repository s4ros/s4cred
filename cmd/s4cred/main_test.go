package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/s4ros/s4cred/internal/httpapi"
	"github.com/s4ros/s4cred/internal/store"
	"github.com/s4ros/s4cred/web"
)

func TestEmbeddedApplicationOverHTTP(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "notes.db"), 10, 10000)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	server := httptest.NewUnstartedServer(nil)
	origin := "http://" + server.Listener.Addr().String()
	server.Config.Handler = httpapi.New(db, origin, web.Files)
	server.Start()
	defer server.Close()
	client := server.Client()
	for _, path := range []string{"/", "/app.js", "/style.css"} {
		resp, err := client.Get(origin + path)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil || resp.StatusCode != 200 || len(body) == 0 || resp.Header.Get("Cache-Control") != "no-store" {
			t.Fatalf("GET %s: status %d, size %d, error %v", path, resp.StatusCode, len(body), err)
		}
	}
	encode := base64.RawURLEncoding.EncodeToString
	token := bytes.Repeat([]byte{1}, 32)
	hash := sha256.Sum256(token)
	ciphertext, nonce := bytes.Repeat([]byte{2}, 17), bytes.Repeat([]byte{3}, 12)
	code := "0123456789abcdef"
	idHash := sha256.Sum256([]byte(code))
	secret := bytes.Repeat([]byte{0x11}, 110)
	secret[0], secret[1] = 0x02, 0x00
	create, _ := json.Marshal(map[string]any{
		"ciphertext": encode(ciphertext), "nonce": encode(nonce), "ttl": 86400, "read_token_hash": encode(hash[:]),
		"id_hash": encode(idHash[:]), "link_secret": encode(secret),
	})
	post := func(path string, body []byte) (*http.Response, map[string]any) {
		t.Helper()
		req, err := http.NewRequest("POST", origin+path, bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", origin)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var result map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
		return resp, result
	}
	resp, result := post("/api/notes", create)
	if resp.StatusCode != 201 || result["ok"] != true {
		t.Fatalf("create: %d %v", resp.StatusCode, result)
	}
	id := code
	resp, err = client.Get(origin + "/n/" + id)
	if err != nil {
		t.Fatal(err)
	}
	page, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil || resp.StatusCode != 200 || !strings.Contains(string(page), "/app.js") {
		t.Fatalf("note page: %d %v", resp.StatusCode, err)
	}
	consume, _ := json.Marshal(map[string]string{"read_token": encode(token)})
	resp, result = post("/api/notes/"+id+"/consume", consume)
	if resp.StatusCode != 200 || result["ciphertext"] != encode(ciphertext) || result["nonce"] != encode(nonce) {
		t.Fatalf("consume: %d %v", resp.StatusCode, result)
	}
	resp, result = post("/api/notes/"+id+"/consume", consume)
	if resp.StatusCode != 404 || result["error"] != "not_found" {
		t.Fatalf("second consume: %d %v", resp.StatusCode, result)
	}
}
