// buddy-tailnet: Buddy's own private door into your tailnet (Tailscale's open-source tsnet library), so your phone
// (with the Tailscale app, signed in to the same account) can open Buddy without the Tailscale app on this Mac.
// Run by buddy_server.py (tailnet.py) only after you turn on "Phone" in Buddy's settings.
//
//   - Only devices of your own Tailscale account get through (same user as this node; not tagged or shared-in
//     devices), only over HTTPS, and only to Buddy's server on this Mac (127.0.0.1:12400), and only after it proved
//     it is this Buddy (it can answer for .mac_token). Buddy still asks every device to pair.
//   - Never on the public internet (no Funnel), and nothing is logged to Tailscale (TS_NO_LOGS_NO_SUPPORT).
//   - Prints its state as JSON lines on stdout ({"event":"status","state":"login"|"approve"|"starting"|"ready"|
//     "error",...}); never anything you say to Buddy.
//   - Stops when its stdin closes (Buddy stopped).
//   - With --logout: signs this node out of your tailnet and forgets its keys.
package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"tailscale.com/client/local"
	"tailscale.com/envknob"
	"tailscale.com/tailcfg"
	"tailscale.com/tsnet"
)

type config struct {
	state, buddy, hostname, target, controlURL string
	listen                                     func(*tsnet.Server) (net.Listener, error)
	out                                        io.Writer
}

// reporter prints the node's state whenever it changes.
type reporter struct {
	mu        sync.Mutex
	out       io.Writer
	last      string
	listening bool
	listenErr string
	host      string
	owner     tailcfg.UserID // the Tailscale user this node belongs to (only their devices get in)
}

func (r *reporter) update(st, url, msg string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ev := map[string]string{"event": "status", "state": st}
	if url != "" {
		ev["url"] = url
	}
	if msg != "" {
		ev["msg"] = msg
	}
	if st == "ready" {
		ev["host"] = r.host
	}
	b, _ := json.Marshal(ev)
	if string(b) == r.last {
		return
	}
	r.last = string(b)
	r.out.Write(append(b, '\n'))
}

func (r *reporter) set(f func(r *reporter)) {
	r.mu.Lock()
	f(r)
	r.mu.Unlock()
}

func (r *reporter) currentOwner() tailcfg.UserID {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.owner
}

// watch reports the backend state (sign-in link, approval needed, ready, why not) until ctx ends. When this node's
// sign-in runs out (after 180 days, by default) it asks Tailscale for a new sign-in link.
func (r *reporter) watch(ctx context.Context, lc *local.Client) {
	var noLink, asked time.Time
	for ctx.Err() == nil {
		if st, err := lc.Status(ctx); err == nil {
			r.mu.Lock()
			listening, listenErr := r.listening, r.listenErr
			if st.Self != nil {
				r.host = strings.TrimSuffix(st.Self.DNSName, ".")
				if st.BackendState == "Running" {
					r.owner = st.Self.UserID
				}
			}
			r.mu.Unlock()
			if st.BackendState != "NeedsLogin" || st.AuthURL != "" {
				noLink = time.Time{}
			} else if noLink.IsZero() {
				noLink = time.Now()
			} else if time.Since(noLink) > 10*time.Second && time.Since(asked) > time.Minute {
				asked = time.Now()
				lc.StartLoginInteractive(ctx)
			}
			switch {
			case st.BackendState == "NeedsLogin" && st.AuthURL != "": // (the link comes a moment after)
				r.update("login", st.AuthURL, "")
			case st.BackendState == "NeedsMachineAuth":
				r.update("approve", "", "")
			case st.BackendState == "Running" && listening:
				r.update("ready", "", "")
			case st.BackendState == "Running" && listenErr != "":
				r.update("error", "", listenErr)
			default:
				r.update("starting", "", "")
			}
		}
		select {
		case <-ctx.Done():
		case <-time.After(time.Second):
		}
	}
}

func main() {
	state := flag.String("state", "", "folder for this node's keys (readable only by you)")
	buddy := flag.String("buddy", "", "Buddy's folder (where .mac_token is)")
	hostname := flag.String("hostname", "buddy", "this node's name on your tailnet")
	logout := flag.Bool("logout", false, "sign this node out of your tailnet and forget it")
	flag.Parse()
	if *state == "" || *buddy == "" {
		fmt.Fprintln(os.Stderr, "usage: buddy-tailnet --state DIR --buddy DIR [--hostname NAME] [--logout]")
		os.Exit(2)
	}
	envknob.SetNoLogsNoSupport() // no logs or metrics go to Tailscale
	cfg := config{state: *state, buddy: *buddy, hostname: *hostname, target: "127.0.0.1:12400", out: os.Stdout,
		listen: func(s *tsnet.Server) (net.Listener, error) { return s.ListenTLS("tcp", ":443") }}
	if *logout {
		os.Exit(doLogout(cfg))
	}
	go func() { io.Copy(io.Discard, os.Stdin); os.Exit(0) }() // Buddy stopped: so does its door
	if err := run(context.Background(), cfg); err != nil {
		b, _ := json.Marshal(map[string]string{"event": "status", "state": "error", "msg": err.Error()})
		os.Stdout.Write(append(b, '\n'))
		os.Exit(1)
	}
}

func newServer(cfg config) *tsnet.Server {
	return &tsnet.Server{Dir: cfg.state, Hostname: cfg.hostname, ControlURL: cfg.controlURL,
		UserLogf: func(string, ...any) {}} // (the sign-in link is reported as JSON instead)
}

func run(ctx context.Context, cfg config) error {
	if err := os.MkdirAll(cfg.state, 0o700); err != nil {
		return err
	}
	s := newServer(cfg)
	defer s.Close()
	lc, err := s.LocalClient()
	if err != nil {
		return err
	}
	rep := &reporter{out: cfg.out}
	go rep.watch(ctx, lc)
	var ln net.Listener
	for {
		ln, err = cfg.listen(s) // waits until this node is on your tailnet (signed in)
		if err == nil {
			break
		}
		rep.set(func(r *reporter) { r.listenErr = friendly(err) })
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(10 * time.Second): // e.g. until HTTPS is turned on for the tailnet
		}
	}
	st, err := lc.Status(ctx)
	if err != nil {
		return err
	}
	if st.Self == nil {
		return errors.New("no node status")
	}
	rep.set(func(r *reporter) { r.listening, r.listenErr, r.owner = true, "", st.Self.UserID })
	srv := &http.Server{Handler: handler(lc, rep.currentOwner, cfg), ReadHeaderTimeout: 30 * time.Second,
		IdleTimeout: 2 * time.Minute, ErrorLog: log.New(io.Discard, "", 0)}
	go func() { <-ctx.Done(); srv.Close() }()
	return srv.Serve(ln)
}

func friendly(err error) string {
	m := err.Error()
	switch {
	case strings.Contains(m, "MagicDNS"):
		return "turn on MagicDNS for your tailnet (Tailscale admin console: DNS)"
	case strings.Contains(m, "HTTPS"):
		return "turn on HTTPS certificates for your tailnet (Tailscale admin console: DNS)"
	}
	return m
}

// handler lets only your own devices through, and only to this Buddy.
func handler(lc *local.Client, owner func() tailcfg.UserID, cfg config) http.Handler {
	target := &url.URL{Scheme: "http", Host: cfg.target}
	direct := &http.Transport{Proxy: nil, MaxIdleConns: 8, IdleConnTimeout: 30 * time.Second} // never through a proxy
	rp := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(target)
			r.Out.Host = r.In.Host // Buddy only answers to its own names (here: <this node>.<tailnet>.ts.net)
			for k := range r.Out.Header {
				if strings.HasPrefix(strings.ToLower(k), "tailscale-") { // only Tailscale itself may set these
					r.Out.Header.Del(k)
				}
			}
		},
		Transport:     direct,
		FlushInterval: -1, // replies stream (chat)
		ErrorLog:      log.New(io.Discard, "", 0),
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, "Buddy isn't running on the Mac right now.", http.StatusBadGateway)
		},
	}
	check := &buddyCheck{buddy: cfg.buddy, target: cfg.target, client: &http.Client{Transport: direct, Timeout: 3 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		who, err := lc.WhoIs(r.Context(), r.RemoteAddr)
		if err != nil || who.Node == nil || who.UserProfile == nil || who.Node.IsTagged() || who.UserProfile.ID != owner() {
			w.Header().Set("Connection", "close") // (and don't keep the connection open for them)
			http.Error(w, "Only your own devices can open Buddy.", http.StatusForbidden)
			return
		}
		if !check.ok() {
			http.Error(w, "Buddy isn't running on the Mac right now.", http.StatusServiceUnavailable)
			return
		}
		rp.ServeHTTP(w, r)
	})
}

// buddyCheck: what answers on Buddy's port proves it knows this Buddy's .mac_token (an HMAC of a fresh nonce, the same
// check the Mac app makes), so nothing is passed to some other program that took the port while Buddy was down.
type buddyCheck struct {
	mu            sync.Mutex
	until         time.Time
	buddy, target string
	client        *http.Client
}

func (c *buddyCheck) ok() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Now().Before(c.until) {
		return true
	}
	key, err := os.ReadFile(filepath.Join(c.buddy, ".mac_token"))
	if err != nil || len(bytes.TrimSpace(key)) == 0 {
		return false
	}
	n := make([]byte, 16)
	rand.Read(n)
	nonce := hex.EncodeToString(n)
	resp, err := c.client.Get("http://" + c.target + "/api/hello?nonce=" + nonce)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var j struct {
		Proof string `json:"proof"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&j) != nil {
		return false
	}
	m := hmac.New(sha256.New, bytes.TrimSpace(key))
	m.Write([]byte(nonce))
	if !hmac.Equal([]byte(j.Proof), []byte(hex.EncodeToString(m.Sum(nil)))) {
		return false
	}
	c.until = time.Now().Add(10 * time.Second)
	return true
}

// doLogout: 0 signed out (or nothing to sign out), 3 the keys are gone but Tailscale couldn't be told (the node stays
// listed in your admin console until it expires: remove it there), 1 the keys couldn't be deleted.
func doLogout(cfg config) int {
	var lerr error
	if _, err := os.Stat(cfg.state); err == nil {
		s := newServer(cfg)
		lc, err := s.LocalClient()
		if err == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			err = lc.Logout(ctx)
			cancel()
		}
		lerr = err
		s.Close()
	}
	if err := os.RemoveAll(cfg.state); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if lerr != nil {
		return 3
	}
	return 0
}
