"""Test-only: runs ref.py for the protocol tests with a clock they can move forward (POST /_test/clock
{advance_ms}) and the daily clean-up on demand (POST /_test/housekeep {accts}). ref.py itself has no such hooks.
Used by run.mjs; never for serving."""
import argparse, importlib.util, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("buddy_relay_ref", os.path.join(HERE, "..", "ref.py"))
ref = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ref)

offset = [0]
real_now = ref.now_ms
ref.now_ms = lambda: real_now() + offset[0]


class TestHandler(ref.Handler):
    def go(self, method):
        if not self.path.startswith("/_test/"):
            return super().go(method)
        n = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        if self.path == "/_test/clock":
            offset[0] += int(body.get("advance_ms", 0))
        elif self.path == "/_test/housekeep":
            self.server.relay.housekeep(body.get("accts"))
        out = json.dumps({"now": ref.now_ms()}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True)
    p.add_argument("--origins", required=True)
    p.add_argument("--quotas", default="{}")
    a = p.parse_args()
    relay = ref.Relay(a.data, a.origins.split(","), json.loads(a.quotas), housekeep_every=None)
    srv = ref.Server(("127.0.0.1", 0), relay, ip_header="X-Test-IP")
    srv.RequestHandlerClass = TestHandler
    print("listening %d" % srv.server_address[1], flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
