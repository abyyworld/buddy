// A fake clock for Buddy for phones' tests: Date and the timers inside a device's vm "browser" (tests/solo/harness.mjs
// device(..., {clock})) follow it, so an afternoon of real timing, learning debounce and texts first runs in a second.
// Only the page's own code sees it (the fake Tinfoil SDK keeps real time). Fake data only.
//   const clock = new FakeClock(Date.UTC(2026, 9, 23, 10, 0));   clock.advance(ms) runs what came due, in order
export class FakeClock {
  constructor(start) { this.now = start; this.seq = 0; this.timers = new Map(); }
  install(sb) {
    const clock = this, Real = Date;
    class FakeDate extends Real {
      constructor(...a) { if (a.length) super(...a); else super(clock.now); }
      static now() { return clock.now; }
    }
    sb.Date = FakeDate;
    sb.setTimeout = (fn, ms, ...args) => clock.add(fn, ms, false, args);
    sb.setInterval = (fn, ms, ...args) => clock.add(fn, ms, true, args);
    sb.clearTimeout = sb.clearInterval = (id) => { clock.timers.delete(id); };
    return sb;
  }
  add(fn, ms, every, args) {
    const id = ++this.seq, d = Math.max(0, Number(ms) || 0);
    this.timers.set(id, { at: this.now + d, fn, every: every ? Math.max(1, d) : 0, args, id });
    return id;
  }
  async settle(n = 30) { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); }
  async advance(ms) {                                   // to now + ms, running each timer when its time comes
    const end = this.now + ms;
    for (;;) {
      let next = null;
      for (const t of this.timers.values()) if (t.at <= end && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t;
      if (!next) break;
      this.now = Math.max(this.now, next.at);
      if (next.every) next.at += next.every; else this.timers.delete(next.id);
      try { next.fn(...(next.args || [])); } catch (e) { /* (as a browser: the error stays in that callback) */ }
      await this.settle();
    }
    this.now = end;
    await this.settle();
  }
}
