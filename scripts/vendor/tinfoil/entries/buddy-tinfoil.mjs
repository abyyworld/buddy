// Buddy phone mode: Tinfoil's attested, end-to-end encrypted (EHBP/HPKE) fetch for the browser.
// Built into ONE self-contained ESM file by build.mjs; nothing is fetched at runtime except
// https://atc.tinfoil.sh/attestation (the attestation bundle, verified locally) and the inference enclave.
//
// Imported by file path on purpose: tinfoil's package index also re-exports the OpenAI SDK
// (~360 KB) and the Vercel AI SDK provider, which a bundler cannot drop. Buddy builds its four
// requests (chat SSE, models, speech PCM, transcriptions multipart) itself on SecureClient.fetch.
export { SecureClient } from "../node_modules/tinfoil/dist/secure-client.js";
export {
  Verifier,
  TinfoilError,
  ConfigurationError,
  FetchError,
  AttestationError,
} from "../node_modules/tinfoil/dist/verifier.js";
export { EhbpError, KeyConfigMismatchError, ProtocolError, DecryptionError } from "ehbp";
