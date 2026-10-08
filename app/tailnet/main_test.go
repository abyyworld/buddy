package main

// End-to-end against Tailscale's own test control and relay servers (nothing reaches the internet): signing in
// through the reported link, your phone getting through to Buddy, another account's device and a program posing as
// Buddy on its port being refused.

import (
	"bufio"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"tailscale.com/ipn/store/mem"
	"tailscale.com/net/netns"
	"tailscale.com/tailcfg"
	"tailscale.com/tsnet"
	"tailscale.com/tstest/integration"
	"tailscale.com/tstest/integration/testcontrol"
	"tailscale.com/types/logger"
)

func startControl(t *testing.T, requireAuth, sameUser bool) (string, *testcontrol.Server) {
	netns.SetEnabled(false)
	t.Cleanup(func() { netns.SetEnabled(true) })
	derpMap := integration.RunDERPAndSTUN(t, logger.Discard, "127.0.0.1")
	c := &testcontrol.Server{DERPMap: derpMap, DNSConfig: &tailcfg.DNSConfig{Proxied: true},
		MagicDNSDomain: "tail-scale.ts.net", RequireAuth: requireAuth, AllNodesSameUser: sameUser, Logf: logger.Discard}
	c.HTTPTestServer = httptest.NewUnstartedServer(c)
	c.HTTPTestServer.Start()
	t.Cleanup(c.HTTPTestServer.Close)
	return c.HTTPTestServer.URL, c
}

// fakeBuddy answers /api/hello like buddy_server.py (an HMAC of the nonce with .mac_token) when it knows the token.
func fakeBuddy(t *testing.T, dir string, knowsToken bool) string {
	token := "test-mac-token-123"
	if err := os.WriteFile(filepath.Join(dir, ".mac_token"), []byte(token+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/hello" {
			key := token
			if !knowsToken {
				key = "some-other-token"
			}
			m := hmac.New(sha256.New, []byte(key))
			m.Write([]byte(r.URL.Query().Get("nonce")))
			json.NewEncoder(w).Encode(map[string]string{"proof": hex.EncodeToString(m.Sum(nil))})
			return
		}
		fmt.Fprintf(w, "buddy host=%s path=%s tsheader=%q", r.Host, r.URL.Path, r.Header.Get("Tailscale-User-Login"))
	}))
	t.Cleanup(srv.Close)
	return strings.TrimPrefix(srv.URL, "http://")
}

type events struct {
	mu   sync.Mutex
	list []map[string]string
	pw   *io.PipeWriter
}

func newEvents() *events {
	pr, pw := io.Pipe()
	e := &events{pw: pw}
	go func() {
		sc := bufio.NewScanner(pr)
		for sc.Scan() {
			var m map[string]string
			if json.Unmarshal(sc.Bytes(), &m) == nil {
				e.mu.Lock()
				e.list = append(e.list, m)
				e.mu.Unlock()
			}
		}
	}()
	return e
}

func (e *events) wait(t *testing.T, state string, d time.Duration) map[string]string {
	t.Helper()
	end := time.Now().Add(d)
	for time.Now().Before(end) {
		e.mu.Lock()
		for _, m := range e.list {
			if m["state"] == state {
				e.mu.Unlock()
				return m
			}
		}
		e.mu.Unlock()
		time.Sleep(100 * time.Millisecond)
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	t.Fatalf("no %q event within %v; got %v", state, d, e.list)
	return nil
}

// startBuddyDoor runs the helper's run() with a plain listener (the test control can't issue HTTPS certificates).
func startBuddyDoor(t *testing.T, ctx context.Context, controlURL, target, buddyDir string) *events {
	ev := newEvents()
	cfg := config{state: filepath.Join(t.TempDir(), "tailnet"), buddy: buddyDir, hostname: "buddy", target: target,
		controlURL: controlURL, out: ev.pw,
		listen: func(s *tsnet.Server) (net.Listener, error) {
			if _, err := s.Up(context.Background()); err != nil {
				return nil, err
			}
			return s.Listen("tcp", ":80")
		}}
	go func() {
		if err := run(ctx, cfg); err != nil && ctx.Err() == nil {
			t.Errorf("run: %v", err)
		}
	}()
	return ev
}

func phone(t *testing.T, ctx context.Context, controlURL, name string) *tsnet.Server {
	s := &tsnet.Server{Dir: filepath.Join(t.TempDir(), name), ControlURL: controlURL, Hostname: name,
		Store: new(mem.Store), Ephemeral: true, UserLogf: logger.Discard}
	t.Cleanup(func() { s.Close() })
	if _, err := s.Up(ctx); err != nil {
		t.Fatal(err)
	}
	return s
}

func get(ctx context.Context, s *tsnet.Server, host string) (int, string, error) {
	c := s.HTTPClient()
	c.Timeout = 10 * time.Second
	var last error
	for i := 0; i < 40; i++ { // (the first packets can race the relay handshake)
		req, _ := http.NewRequestWithContext(ctx, "GET", "http://"+host+"/phone", nil)
		req.Header.Set("Tailscale-User-Login", "spoofed@example.com")
		resp, err := c.Do(req)
		if err == nil {
			b, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			return resp.StatusCode, string(b), nil
		}
		last = err
		time.Sleep(250 * time.Millisecond)
	}
	return 0, "", last
}

func TestSignInAndYourPhone(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	controlURL, control := startControl(t, true, true)
	dir := t.TempDir()
	ev := startBuddyDoor(t, ctx, controlURL, fakeBuddy(t, dir, true), dir)
	login := ev.wait(t, "login", 30*time.Second)
	if !strings.Contains(login["url"], "/auth/") {
		t.Fatalf("login event without a sign-in link: %v", login)
	}
	if !control.CompleteAuth(login["url"]) {
		t.Fatalf("CompleteAuth(%q) failed", login["url"])
	}
	ready := ev.wait(t, "ready", 30*time.Second)
	if !strings.HasPrefix(ready["host"], "buddy.") {
		t.Fatalf("ready without host: %v", ready)
	}
	control.RequireAuth = false
	p := phone(t, ctx, controlURL, "iphone")
	code, body, err := get(ctx, p, ready["host"])
	if err != nil || code != 200 || !strings.Contains(body, "host="+ready["host"]) || !strings.Contains(body, `tsheader=""`) {
		t.Fatalf("your phone: code=%d body=%q err=%v", code, body, err)
	}
}

func TestOtherAccountRefused(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	controlURL, _ := startControl(t, false, false) // every node its own user
	dir := t.TempDir()
	ev := startBuddyDoor(t, ctx, controlURL, fakeBuddy(t, dir, true), dir)
	ready := ev.wait(t, "ready", 30*time.Second)
	p := phone(t, ctx, controlURL, "someone-elses-phone")
	code, body, err := get(ctx, p, ready["host"])
	if err != nil || code != 403 || strings.Contains(body, "buddy host=") {
		t.Fatalf("another account's device: code=%d body=%q err=%v", code, body, err)
	}
}

func TestImpostorOnBuddysPort(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	controlURL, _ := startControl(t, false, true)
	dir := t.TempDir()
	ev := startBuddyDoor(t, ctx, controlURL, fakeBuddy(t, dir, false), dir) // doesn't know .mac_token
	ready := ev.wait(t, "ready", 30*time.Second)
	p := phone(t, ctx, controlURL, "iphone")
	code, body, err := get(ctx, p, ready["host"])
	if err != nil || code != 503 || strings.Contains(body, "buddy host=") {
		t.Fatalf("impostor on Buddy's port: code=%d body=%q err=%v", code, body, err)
	}
}

// After this node's sign-in runs out (180 days by default), a new sign-in link shows up and signing in brings it back.
func TestSignInAgainAfterExpiry(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Second)
	defer cancel()
	controlURL, control := startControl(t, true, true)
	dir := t.TempDir()
	ev := startBuddyDoor(t, ctx, controlURL, fakeBuddy(t, dir, true), dir)
	control.CompleteAuth(ev.wait(t, "login", 30*time.Second)["url"])
	ev.wait(t, "ready", 30*time.Second)
	ev.mu.Lock()
	n0 := len(ev.list)
	ev.mu.Unlock()
	setBuddyExpiry(control, time.Now().Add(-time.Minute))
	after := func(state string, d time.Duration, from int) (map[string]string, int) {
		for end := time.Now().Add(d); time.Now().Before(end); time.Sleep(200 * time.Millisecond) {
			ev.mu.Lock()
			for i, m := range ev.list[from:] {
				if m["state"] == state && (state != "login" || m["url"] != "") {
					ev.mu.Unlock()
					return m, from + i + 1
				}
			}
			ev.mu.Unlock()
		}
		t.Fatalf("no %q event %v after the key expired", state, d)
		return nil, 0
	}
	login, n1 := after("login", 45*time.Second, n0)
	if !control.CompleteAuth(login["url"]) {
		t.Fatalf("CompleteAuth(%q) failed", login["url"])
	}
	time.Sleep(2 * time.Second)
	setBuddyExpiry(control, time.Now().Add(180*24*time.Hour)) // (the real control gives the new key a fresh expiry)
	after("ready", 30*time.Second, n1)
}

func setBuddyExpiry(c *testcontrol.Server, when time.Time) {
	for _, n := range c.AllNodes() {
		if strings.HasPrefix(n.Name, "buddy.") {
			n.KeyExpiry = when
			c.UpdateNode(n)
		}
	}
}
