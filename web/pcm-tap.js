// Buddy's call microphone: passes the page small blocks of raw sound (about 20 ms each) as they come in, so it can
// tell when you start and stop talking and send exactly what you said. Nothing leaves the device from here.
class PcmTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Float32Array(1024); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor("pcm-tap", PcmTap);
