// tinfoil@1.2.1 (Apache-2.0) and dependencies, bundled for Buddy by build.mjs with esbuild 0.28.2. Do not edit; rebuild.
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

// node_modules/@tinfoilsh/verifier/dist/errors.js
function wrapOrThrow(e, ErrorClass, message) {
  if (e instanceof TinfoilError) {
    throw e;
  }
  throw new ErrorClass(message, { cause: e });
}
var TinfoilError, ConfigurationError, FetchError, AttestationError;
var init_errors = __esm({
  "node_modules/@tinfoilsh/verifier/dist/errors.js"() {
    TinfoilError = class extends Error {
      constructor(message, options) {
        super(message);
        this.name = "TinfoilError";
        if (options?.cause) {
          this.cause = options.cause;
        }
      }
    };
    ConfigurationError = class extends TinfoilError {
      constructor(message, options) {
        super(message, options);
        this.name = "ConfigurationError";
      }
    };
    FetchError = class extends TinfoilError {
      constructor(message, options) {
        super(message, options);
        this.name = "FetchError";
      }
    };
    AttestationError = class extends TinfoilError {
      constructor(message, options) {
        super(message, options);
        this.name = "AttestationError";
      }
    };
  }
});

// node_modules/@tinfoilsh/verifier/dist/types.js
function compareMeasurements(a, b) {
  if (a.type === b.type) {
    if (a.registers.length !== b.registers.length || !a.registers.every((reg, i) => reg === b.registers[i])) {
      throw new AttestationError("Code measurement mismatch: The enclave is running different code than the expected release");
    }
    return;
  }
  if (a.type === PredicateType.SnpTdxMultiplatformV1 && b.type === PredicateType.SevGuestV2) {
    if (a.registers.length < 1 || b.registers.length < 1) {
      throw new AttestationError("Invalid measurement data: Missing measurement registers");
    }
    if (a.registers[0] !== b.registers[0]) {
      throw new AttestationError("Code measurement mismatch: The SNP measurement from the enclave does not match the expected measurement from the signed release");
    }
    return;
  }
  if (a.type === PredicateType.SevGuestV2 && b.type === PredicateType.SnpTdxMultiplatformV1) {
    if (a.registers.length < 1 || b.registers.length < 1) {
      throw new AttestationError("Invalid measurement data: Missing measurement registers");
    }
    if (a.registers[0] !== b.registers[0]) {
      throw new AttestationError("Code measurement mismatch: The SNP measurement from the enclave does not match the expected measurement from the signed release");
    }
    return;
  }
  throw new AttestationError(`Cannot compare measurements: Incompatible measurement types "${a.type}" and "${b.type}"`);
}
async function measurementFingerprint(m) {
  if (m.registers.length === 1) {
    return m.registers[0];
  }
  const allData = m.type + m.registers.join("");
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(allData));
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hashAttestationDocument(doc) {
  const data = doc.format + doc.body;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map((b) => b.toString(16).padStart(2, "0")).join("");
}
var PredicateType;
var init_types = __esm({
  "node_modules/@tinfoilsh/verifier/dist/types.js"() {
    init_errors();
    (function(PredicateType2) {
      PredicateType2["SevGuestV1"] = "https://tinfoil.sh/predicate/sev-snp-guest/v1";
      PredicateType2["SevGuestV2"] = "https://tinfoil.sh/predicate/sev-snp-guest/v2";
      PredicateType2["SnpTdxMultiplatformV1"] = "https://tinfoil.sh/predicate/snp-tdx-multiplatform/v1";
    })(PredicateType || (PredicateType = {}));
  }
});

// node_modules/@tinfoilsh/verifier/dist/sev/constants.js
var POLICY_RESERVED_1_BIT, REPORT_SIZE, SIGNATURE_OFFSET, ECDSA_RS_SIZE, ECDSA_P384_SHA384_SIGNATURE_SIZE, ZEN3ZEN4_FAMILY, ZEN5_FAMILY, MILAN_MODEL, GENOA_MODEL, TURIN_MODEL, ReportSigner;
var init_constants = __esm({
  "node_modules/@tinfoilsh/verifier/dist/sev/constants.js"() {
    POLICY_RESERVED_1_BIT = 17;
    REPORT_SIZE = 1184;
    SIGNATURE_OFFSET = 672;
    ECDSA_RS_SIZE = 72;
    ECDSA_P384_SHA384_SIGNATURE_SIZE = ECDSA_RS_SIZE + ECDSA_RS_SIZE;
    ZEN3ZEN4_FAMILY = 25;
    ZEN5_FAMILY = 26;
    MILAN_MODEL = 0 | 1;
    GENOA_MODEL = 1 << 4 | 1;
    TURIN_MODEL = 2;
    (function(ReportSigner2) {
      ReportSigner2[ReportSigner2["VcekReportSigner"] = 0] = "VcekReportSigner";
      ReportSigner2[ReportSigner2["VlekReportSigner"] = 1] = "VlekReportSigner";
      ReportSigner2[ReportSigner2["endorseReserved2"] = 2] = "endorseReserved2";
      ReportSigner2[ReportSigner2["endorseReserved3"] = 3] = "endorseReserved3";
      ReportSigner2[ReportSigner2["endorseReserved4"] = 4] = "endorseReserved4";
      ReportSigner2[ReportSigner2["endorseReserved5"] = 5] = "endorseReserved5";
      ReportSigner2[ReportSigner2["endorseReserved6"] = 6] = "endorseReserved6";
      ReportSigner2[ReportSigner2["NoneReportSigner"] = 7] = "NoneReportSigner";
    })(ReportSigner || (ReportSigner = {}));
  }
});

// node_modules/@tinfoilsh/verifier/dist/sev/utils.js
function tcbFromInt(tcb) {
  return {
    ucodeSpl: Number(tcb >> 56n & 0xffn),
    snpSpl: Number(tcb >> 48n & 0xffn),
    teeSpl: Number(tcb >> 8n & 0xffn),
    blSpl: Number(tcb & 0xffn)
  };
}
function tcbMeetsMinimum(tcb, minimum) {
  return tcb.blSpl >= minimum.blSpl && tcb.teeSpl >= minimum.teeSpl && tcb.snpSpl >= minimum.snpSpl && tcb.ucodeSpl >= minimum.ucodeSpl;
}
function platformInfoFromInt(value) {
  return {
    smtEnabled: !!(value & 1n),
    tsmeEnabled: !!(value & 2n),
    eccEnabled: !!(value & 4n),
    raplDisabled: !!(value & 8n),
    ciphertextHidingDramEnabled: !!(value & 16n),
    aliasCheckComplete: !!(value & 32n),
    tioEnabled: !!(value & 128n)
  };
}
function policyFromInt(value) {
  return {
    abiMinor: Number(value & 0xffn),
    abiMajor: Number(value >> 8n & 0xffn),
    smt: !!(value & 1n << 16n),
    migrateMa: !!(value & 1n << 18n),
    debug: !!(value & 1n << 19n),
    singleSocket: !!(value & 1n << 20n),
    cxlAllowed: !!(value & 1n << 21n),
    memAes256Xts: !!(value & 1n << 22n),
    raplDis: !!(value & 1n << 23n),
    ciphertextHidingDram: !!(value & 1n << 24n),
    pageSwapDisabled: !!(value & 1n << 25n)
  };
}
function bytesToHex4(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
var init_utils = __esm({
  "node_modules/@tinfoilsh/verifier/dist/sev/utils.js"() {
  }
});

// node_modules/@tinfoilsh/verifier/dist/sev/report.js
function findNonZero(data, lo, hi) {
  for (let i = lo; i < hi; i++) {
    if (data[i] !== 0)
      return i;
  }
  return hi;
}
function mbz(data, lo, hi) {
  const firstNonZero = findNonZero(data, lo, hi);
  if (firstNonZero !== hi) {
    const hexStr = Array.from(data.slice(lo, hi)).map((b) => b.toString(16).padStart(2, "0")).join("");
    throw new AttestationError(`reserved bytes at offset 0x${lo.toString(16)}-0x${hi.toString(16)} contain non-zero data: ${hexStr}`);
  }
}
function mbz64(data, base, hi, lo) {
  const mask = (1n << BigInt(hi - lo + 1)) - 1n;
  const bits = data >> BigInt(lo) & mask;
  if (bits !== 0n) {
    throw new AttestationError(`Reserved bits in ${base} field contain non-zero data: 0x${data.toString(16)}`);
  }
}
var Report;
var init_report = __esm({
  "node_modules/@tinfoilsh/verifier/dist/sev/report.js"() {
    init_constants();
    init_utils();
    init_errors();
    Report = class {
      /**
       * Parse an attestation report from raw bytes in SEV SNP ABI format.
       *
       * @param data - Raw bytes of the attestation report
       * @returns Report object containing parsed data
       * @throws Error if data is malformed or validation fails
       */
      constructor(data) {
        if (data.length < REPORT_SIZE) {
          throw new AttestationError(`Invalid attestation report: Data size (${data.length} bytes) is smaller than expected SEV-SNP report size (${REPORT_SIZE} bytes)`);
        }
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        this.version = view.getUint32(0, true);
        this.guestSvn = view.getUint32(4, true);
        this.policy = view.getBigUint64(8, true);
        if (!(this.policy & 1n << BigInt(POLICY_RESERVED_1_BIT))) {
          throw new AttestationError("Invalid attestation report: Policy field has invalid reserved bit (must be 1)");
        }
        if (this.policy >> 26n) {
          throw new AttestationError("Invalid attestation report: Policy field has non-zero reserved bits");
        }
        this.familyId = data.slice(16, 32);
        this.imageId = data.slice(32, 48);
        this.vmpl = view.getUint32(48, true);
        this.signatureAlgo = view.getUint32(52, true);
        this.currentTcb = view.getBigUint64(56, true);
        try {
          mbz64(this.currentTcb, "current_tcb", 47, 16);
        } catch (e) {
          throw new AttestationError("Invalid attestation report: TCB (Trusted Computing Base) version field is malformed", { cause: e });
        }
        this.platformInfo = view.getBigUint64(64, true);
        this.policyParsed = policyFromInt(this.policy);
        this.platformInfoParsed = platformInfoFromInt(this.platformInfo);
        this.signerInfo = view.getUint32(72, true);
        try {
          mbz64(BigInt(this.signerInfo), "signer_info", 31, 5);
        } catch (e) {
          throw new AttestationError("Invalid attestation report: Signer info field is malformed", { cause: e });
        }
        const signingKey = this.signerInfo >> 2 & 7;
        if (signingKey !== ReportSigner.VcekReportSigner) {
          throw new AttestationError(`Unsupported signing key type: This verifier only supports VCEK-signed attestation reports (got signing key type ${signingKey})`);
        }
        this.signerInfoParsed = {
          signingKey,
          maskChipKey: !!(this.signerInfo & 2),
          authorKeyEn: !!(this.signerInfo & 1)
        };
        try {
          mbz(data, 76, 80);
        } catch (e) {
          throw new AttestationError("Invalid attestation report: Reserved bytes at offset 0x4C are not zeroed", { cause: e });
        }
        this.reportData = data.slice(80, 144);
        this.measurement = data.slice(144, 192);
        this.hostData = data.slice(192, 224);
        this.idKeyDigest = data.slice(224, 272);
        this.authorKeyDigest = data.slice(272, 320);
        this.reportId = data.slice(320, 352);
        this.reportIdMa = data.slice(352, 384);
        this.reportedTcb = view.getBigUint64(384, true);
        try {
          mbz64(this.reportedTcb, "reported_tcb", 47, 16);
        } catch (e) {
          throw new AttestationError("Invalid attestation report: Reported TCB field is malformed", { cause: e });
        }
        let mbzLo = 392;
        if (this.version >= 3) {
          this.family = view.getUint8(392);
          this.model = view.getUint8(393);
          this.stepping = view.getUint8(394);
          this.productName = this.initProductName();
          mbzLo = 395;
        } else if (this.version === 2) {
          this.family = ZEN3ZEN4_FAMILY;
          this.model = GENOA_MODEL;
          this.stepping = 1;
          this.productName = "Genoa";
        } else {
          throw new AttestationError(`Unsupported attestation report version: ${this.version}. Only version 2 (revision 1.55) and version 3+ are supported`);
        }
        try {
          mbz(data, mbzLo, 416);
        } catch (e) {
          throw new AttestationError("Invalid attestation report: Reserved bytes in version section are not zeroed", { cause: e });
        }
        this.chipId = data.slice(416, 480);
        this.committedTcb = view.getBigUint64(480, true);
        try {
          mbz64(this.committedTcb, "committed_tcb", 47, 16);
        } catch (e) {
          throw new AttestationError("Invalid attestation report: Committed TCB field is malformed", { cause: e });
        }
        this.currentBuild = view.getUint8(488);
        this.currentMinor = view.getUint8(489);
        this.currentMajor = view.getUint8(490);
        try {
          mbz(data, 491, 492);
        } catch (e) {
          throw new AttestationError("Invalid attestation report: Reserved bytes after current version are not zeroed", { cause: e });
        }
        this.committedBuild = view.getUint8(492);
        this.committedMinor = view.getUint8(493);
        this.committedMajor = view.getUint8(494);
        try {
          mbz(data, 495, 496);
        } catch (e) {
          throw new AttestationError("Invalid attestation report: Reserved bytes after committed version are not zeroed", { cause: e });
        }
        this.launchTcb = view.getBigUint64(496, true);
        try {
          mbz64(this.launchTcb, "launch_tcb", 47, 16);
        } catch (e) {
          throw new AttestationError("Invalid attestation report: Launch TCB field is malformed", { cause: e });
        }
        const mbzBeforeSig = this.version < 5 ? 504 : 520;
        try {
          mbz(data, mbzBeforeSig, SIGNATURE_OFFSET);
        } catch (e) {
          throw new AttestationError("Invalid attestation report: Reserved bytes before signature are not zeroed", { cause: e });
        }
        if (this.signatureAlgo === 1) {
          try {
            mbz(data, SIGNATURE_OFFSET + ECDSA_P384_SHA384_SIGNATURE_SIZE, REPORT_SIZE);
          } catch (e) {
            throw new AttestationError("Invalid attestation report: Reserved bytes after signature are not zeroed", { cause: e });
          }
        }
        this.signedData = data.slice(0, SIGNATURE_OFFSET);
        this.signature = data.slice(SIGNATURE_OFFSET, REPORT_SIZE);
      }
      initProductName() {
        if (this.family === ZEN3ZEN4_FAMILY) {
          if (this.model === MILAN_MODEL)
            return "Milan";
          if (this.model === GENOA_MODEL)
            return "Genoa";
        } else if (this.family === ZEN5_FAMILY) {
          if (this.model === TURIN_MODEL)
            return "Turin";
        }
        return "Unknown";
      }
    };
  }
});

// node_modules/@tinfoilsh/verifier/dist/sev/certs.js
var ARK_CERT, ASK_CERT;
var init_certs = __esm({
  "node_modules/@tinfoilsh/verifier/dist/sev/certs.js"() {
    ARK_CERT = `-----BEGIN CERTIFICATE-----
MIIGYzCCBBKgAwIBAgIDAgAAMEYGCSqGSIb3DQEBCjA5oA8wDQYJYIZIAWUDBAIC
BQChHDAaBgkqhkiG9w0BAQgwDQYJYIZIAWUDBAICBQCiAwIBMKMDAgEBMHsxFDAS
BgNVBAsMC0VuZ2luZWVyaW5nMQswCQYDVQQGEwJVUzEUMBIGA1UEBwwLU2FudGEg
Q2xhcmExCzAJBgNVBAgMAkNBMR8wHQYDVQQKDBZBZHZhbmNlZCBNaWNybyBEZXZp
Y2VzMRIwEAYDVQQDDAlBUkstR2Vub2EwHhcNMjIwMTI2MTUzNDM3WhcNNDcwMTI2
MTUzNDM3WjB7MRQwEgYDVQQLDAtFbmdpbmVlcmluZzELMAkGA1UEBhMCVVMxFDAS
BgNVBAcMC1NhbnRhIENsYXJhMQswCQYDVQQIDAJDQTEfMB0GA1UECgwWQWR2YW5j
ZWQgTWljcm8gRGV2aWNlczESMBAGA1UEAwwJQVJLLUdlbm9hMIICIjANBgkqhkiG
9w0BAQEFAAOCAg8AMIICCgKCAgEA3Cd95S/uFOuRIskW9vz9VDBF69NDQF79oRhL
/L2PVQGhK3YdfEBgpF/JiwWFBsT/fXDhzA01p3LkcT/7LdjcRfKXjHl+0Qq/M4dZ
kh6QDoUeKzNBLDcBKDDGWo3v35NyrxbA1DnkYwUKU5AAk4P94tKXLp80oxt84ahy
HoLmc/LqsGsp+oq1Bz4PPsYLwTG4iMKVaaT90/oZ4I8oibSru92vJhlqWO27d/Rx
c3iUMyhNeGToOvgx/iUo4gGpG61NDpkEUvIzuKcaMx8IdTpWg2DF6SwF0IgVMffn
vtJmA68BwJNWo1E4PLJdaPfBifcJpuBFwNVQIPQEVX3aP89HJSp8YbY9lySS6PlV
EqTBBtaQmi4ATGmMR+n2K/e+JAhU2Gj7jIpJhOkdH9firQDnmlA2SFfJ/Cc0mGNz
W9RmIhyOUnNFoclmkRhl3/AQU5Ys9Qsan1jT/EiyT+pCpmnA+y9edvhDCbOG8F2o
xHGRdTBkylungrkXJGYiwGrR8kaiqv7NN8QhOBMqYjcbrkEr0f8QMKklIS5ruOfq
lLMCBw8JLB3LkjpWgtD7OpxkzSsohN47Uom86RY6lp72g8eXHP1qYrnvhzaG1S70
vw6OkbaaC9EjiH/uHgAJQGxon7u0Q7xgoREWA/e7JcBQwLg80Hq/sbRuqesxz7wB
WSY254cCAwEAAaN+MHwwDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBSfXfn+Ddjz
WtAzGiXvgSlPvjGoWzAPBgNVHRMBAf8EBTADAQH/MDoGA1UdHwQzMDEwL6AtoCuG
KWh0dHBzOi8va2RzaW50Zi5hbWQuY29tL3ZjZWsvdjEvR2Vub2EvY3JsMEYGCSqG
SIb3DQEBCjA5oA8wDQYJYIZIAWUDBAICBQChHDAaBgkqhkiG9w0BAQgwDQYJYIZI
AWUDBAICBQCiAwIBMKMDAgEBA4ICAQAdIlPBC7DQmvH7kjlOznFx3i21SzOPDs5L
7SgFjMC9rR07292GQCA7Z7Ulq97JQaWeD2ofGGse5swj4OQfKfVv/zaJUFjvosZO
nfZ63epu8MjWgBSXJg5QE/Al0zRsZsp53DBTdA+Uv/s33fexdenT1mpKYzhIg/cK
tz4oMxq8JKWJ8Po1CXLzKcfrTphjlbkh8AVKMXeBd2SpM33B1YP4g1BOdk013kqb
7bRHZ1iB2JHG5cMKKbwRCSAAGHLTzASgDcXr9Fp7Z3liDhGu/ci1opGmkp12QNiJ
uBbkTU+xDZHm5X8Jm99BX7NEpzlOwIVR8ClgBDyuBkBC2ljtr3ZSaUIYj2xuyWN9
5KFY49nWxcz90CFa3Hzmy4zMQmBe9dVyls5eL5p9bkXcgRMDTbgmVZiAf4afe8DL
dmQcYcMFQbHhgVzMiyZHGJgcCrQmA7MkTwEIds1wx/HzMcwU4qqNBAoZV7oeIIPx
dqFXfPqHqiRlEbRDfX1TG5NFVaeByX0GyH6jzYVuezETzruaky6fp2bl2bczxPE8
HdS38ijiJmm9vl50RGUeOAXjSuInGR4bsRufeGPB9peTa9BcBOeTWzstqTUB/F/q
aZCIZKr4X6TyfUuSDz/1JDAGl+lxdM0P9+lLaP9NahQjHCVf0zf1c1salVuGFk2w
/wMz1R1BHg==
-----END CERTIFICATE-----`;
    ASK_CERT = `-----BEGIN CERTIFICATE-----
MIIGiTCCBDigAwIBAgIDAgACMEYGCSqGSIb3DQEBCjA5oA8wDQYJYIZIAWUDBAIC
BQChHDAaBgkqhkiG9w0BAQgwDQYJYIZIAWUDBAICBQCiAwIBMKMDAgEBMHsxFDAS
BgNVBAsMC0VuZ2luZWVyaW5nMQswCQYDVQQGEwJVUzEUMBIGA1UEBwwLU2FudGEg
Q2xhcmExCzAJBgNVBAgMAkNBMR8wHQYDVQQKDBZBZHZhbmNlZCBNaWNybyBEZXZp
Y2VzMRIwEAYDVQQDDAlBUkstR2Vub2EwHhcNMjIxMDMxMTMzMzQ4WhcNNDcxMDMx
MTMzMzQ4WjB7MRQwEgYDVQQLDAtFbmdpbmVlcmluZzELMAkGA1UEBhMCVVMxFDAS
BgNVBAcMC1NhbnRhIENsYXJhMQswCQYDVQQIDAJDQTEfMB0GA1UECgwWQWR2YW5j
ZWQgTWljcm8gRGV2aWNlczESMBAGA1UEAwwJU0VWLUdlbm9hMIICIjANBgkqhkiG
9w0BAQEFAAOCAg8AMIICCgKCAgEAoHJhvk4Fwwkwb03AMfLySXJSXmEaCZMTRbLg
Paj4oEzaD9tGfxCSw/nsCAiXHQaWUt++bnbjJO05TKT5d+Cdrz4/fiRBpbhf0xzv
h11O+wJTBPj3uCzDm48vEZ8l5SXMO4wd/QqwsrejFERPD/Hdfv1mGCMW7ac0ug8t
rDzqGe+l+p8NMjp/EqBDY2vd8hLaVLmS+XjAqlYVNRksh9aTzSYL19/cTrBDmqQ2
y8k23zNl2lW6q/BtQOpWGVs3EWvBHb/Qnf3f3S9+lC4H2jdDy9yn7kqyTWq4WCBn
E4qhYJRokulYtzMZM1Ilk4Z6RPkOTR1MJ4gdFtj7lKmrkSuOoJYmqhJIsQJ854lA
bJybgU7zyzWAwu3uaslkYKUEAQf2ja5Hyl3IBqOzpqY31SpKzbl8NXveZybRMklw
fe4iDLI25T9ku9CVetDYifCbdGeuHdTwZBBemW4NE57L7iEV8+zz8nxng8OMX//4
pXntWqmQbEAnBLv2ToTgd1H2zYRthyDLc3V119/+FnTW17LK6bKzTCgEnCHQEcAt
0hDQLLF799+2lZTxxfBEoduAZax6IjgAMCi6e1ZfKPJSkdvb2m3BwfP8bniG7+AE
Jv1WOEmnBJc1pVQCttbJUodbi07Vfen5JRUqAvSM3ObWQOzSAGzsGnpIigwFpW6m
9F7uYVUCAwEAAaOBozCBoDAdBgNVHQ4EFgQUssZ7pDW7HJVkHAmgQf/F3EmGFVow
HwYDVR0jBBgwFoAUn135/g3Y81rQMxol74EpT74xqFswEgYDVR0TAQH/BAgwBgEB
/wIBADAOBgNVHQ8BAf8EBAMCAQQwOgYDVR0fBDMwMTAvoC2gK4YpaHR0cHM6Ly9r
ZHNpbnRmLmFtZC5jb20vdmNlay92MS9HZW5vYS9jcmwwRgYJKoZIhvcNAQEKMDmg
DzANBglghkgBZQMEAgIFAKEcMBoGCSqGSIb3DQEBCDANBglghkgBZQMEAgIFAKID
AgEwowMCAQEDggIBAIgu3V2tQJOo0/6GvNmwLXbLDrsLKXqHUqdGyOZUpPHM3ujT
aex1G+8bEgBswwBa+wNvl1SQqRqy2x2QwP+i//BcWr3lMrUxci4G7/P8hZBV821n
rAUZtbvfqla5MrRH9AKJXWW/pmtd10czqCHkzdLQNZNjt2dnZHMQAMtGs1AtynRE
HNwEBiH2KAt7gUc/sKWnSCipztKE76puN/XXbSx+Ws+VPiFw6CBAeI9dqnEiQ1tp
EgqtWEtcKm7Ggb1XH6oWbISoowvc00/ADWfNom0xl6v2C6RIWYgUoZ2f7PCyV3Dt
bu/fQfyyZvmtVLA4gB2Ehc6Omjy21Y55WY9IweHlKENMPEUVtRqOvRVI0ml9Wbal
f049joCu2j33XPqwp3IrzevmPBDGpR2Stdm3K66a/g/BSY7Wc9/VeykP3RXlxY1T
MMJ8F1lpg6Tmu+c+vow7cliyqOoayAnR71U8+rWrL3HRHheSVX8GPYOaDNBTt831
Z027vDWv3811vMoxYxhuTRaokvNWCSzmJ2EWrPYHcHOtkjSFKN7ot0Rc70fIRZEY
c2rb3ywLSicEq3JQCnnz6iCZ1tMfplzcrJ2LnW2F1C8yRV+okylyORlsaxOLKYOW
jaDTSFaq1NIwodHp7X9fOG48uRuJWS8GmifD969sC4Ut2FJFoklceBVUNCHR
-----END CERTIFICATE-----`;
  }
});

// node_modules/@freedomofpress/crypto-browser/dist/asn1/error.js
var ASN1ParseError, ASN1TypeError;
var init_error = __esm({
  "node_modules/@freedomofpress/crypto-browser/dist/asn1/error.js"() {
    ASN1ParseError = class extends Error {
    };
    ASN1TypeError = class extends Error {
    };
  }
});

// node_modules/@freedomofpress/crypto-browser/dist/asn1/tag.js
var UNIVERSAL_TAG, TAG_CLASS, ASN1Tag;
var init_tag = __esm({
  "node_modules/@freedomofpress/crypto-browser/dist/asn1/tag.js"() {
    init_error();
    UNIVERSAL_TAG = {
      BOOLEAN: 1,
      INTEGER: 2,
      BIT_STRING: 3,
      OCTET_STRING: 4,
      OBJECT_IDENTIFIER: 6,
      SEQUENCE: 16,
      SET: 17,
      PRINTABLE_STRING: 19,
      UTC_TIME: 23,
      GENERALIZED_TIME: 24
    };
    TAG_CLASS = {
      UNIVERSAL: 0,
      APPLICATION: 1,
      CONTEXT_SPECIFIC: 2,
      PRIVATE: 3
    };
    ASN1Tag = class {
      constructor(enc) {
        this.number = enc & 31;
        this.constructed = (enc & 32) === 32;
        this.class = enc >> 6;
        if (this.number === 31) {
          throw new ASN1ParseError("long form tags not supported");
        }
        if (this.class === TAG_CLASS.UNIVERSAL && this.number === 0) {
          throw new ASN1ParseError("unsupported tag 0x00");
        }
      }
      isUniversal() {
        return this.class === TAG_CLASS.UNIVERSAL;
      }
      isContextSpecific(num) {
        const res = this.class === TAG_CLASS.CONTEXT_SPECIFIC;
        return num !== void 0 ? res && this.number === num : res;
      }
      isBoolean() {
        return this.isUniversal() && this.number === UNIVERSAL_TAG.BOOLEAN;
      }
      isInteger() {
        return this.isUniversal() && this.number === UNIVERSAL_TAG.INTEGER;
      }
      isBitString() {
        return this.isUniversal() && this.number === UNIVERSAL_TAG.BIT_STRING;
      }
      isOctetString() {
        return this.isUniversal() && this.number === UNIVERSAL_TAG.OCTET_STRING;
      }
      isOID() {
        return this.isUniversal() && this.number === UNIVERSAL_TAG.OBJECT_IDENTIFIER;
      }
      isUTCTime() {
        return this.isUniversal() && this.number === UNIVERSAL_TAG.UTC_TIME;
      }
      isGeneralizedTime() {
        return this.isUniversal() && this.number === UNIVERSAL_TAG.GENERALIZED_TIME;
      }
      toDER() {
        return this.number | (this.constructed ? 32 : 0) | this.class << 6;
      }
    };
  }
});

// node_modules/@freedomofpress/crypto-browser/dist/asn1/length.js
function decodeLength(stream) {
  const buf = stream.getUint8();
  if ((buf & 128) === 0) {
    return buf;
  }
  const byteCount = buf & 127;
  if (byteCount > 6) {
    throw new ASN1ParseError("length exceeds 6 byte limit");
  }
  let len = 0;
  for (let i = 0; i < byteCount; i++) {
    const byte = stream.getUint8();
    if (i === 0 && byte === 0) {
      throw new ASN1ParseError("non-minimal length encoding");
    }
    len = len * 256 + byte;
  }
  if (byteCount === 1 && len < 128) {
    throw new ASN1ParseError("non-minimal length encoding");
  }
  if (len === 0) {
    throw new ASN1ParseError("indefinite length encoding not supported");
  }
  return len;
}
function encodeLength(len) {
  if (len < 128) {
    return new Uint8Array([len]);
  }
  let val = BigInt(len);
  const bytes = [];
  while (val > 0n) {
    bytes.unshift(Number(val & 255n));
    val = val >> 8n;
  }
  return new Uint8Array([128 | bytes.length, ...bytes]);
}
var init_length = __esm({
  "node_modules/@freedomofpress/crypto-browser/dist/asn1/length.js"() {
    init_error();
  }
});

// node_modules/@freedomofpress/crypto-browser/dist/encoding.js
function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const length = binaryString.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
function base64UrlToUint8Array(base64url) {
  let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return base64ToUint8Array(base64);
}
function Uint8ArrayToBase64(uint8Array) {
  let binaryString = "";
  for (let i = 0; i < uint8Array.length; i++) {
    binaryString += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binaryString);
}
function hexToUint8Array(hex) {
  if (hex.length % 2 !== 0) {
    throw new Error("Hex string must have an even length");
  }
  const length = hex.length / 2;
  const uint8Array = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    uint8Array[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return uint8Array;
}
function Uint8ArrayToHex(data) {
  let hexString = "";
  for (let i = 0; i < data.length; i++) {
    let hex = data[i].toString(16);
    if (hex.length === 1) {
      hex = "0" + hex;
    }
    hexString += hex;
  }
  return hexString;
}
function stringToUint8Array(str) {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}
function Uint8ArrayToString(uint8Array) {
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(uint8Array);
}
function readBigInt64BE(uint8Array, offset) {
  if (offset === void 0) {
    offset = 0;
  }
  const hex = Uint8ArrayToHex(uint8Array.slice(offset, offset + 8));
  return BigInt(`0x${hex}`);
}
function base64Decode(str) {
  return Uint8ArrayToString(base64ToUint8Array(str));
}
function uint8ArrayEqual(a, b) {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.byteLength; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}
var init_encoding = __esm({
  "node_modules/@freedomofpress/crypto-browser/dist/encoding.js"() {
  }
});

// node_modules/@freedomofpress/crypto-browser/dist/asn1/parse.js
function parseInteger(buf) {
  const end = buf.length;
  if (end === 0 || end > 1 && (buf[0] === 0 && buf[1] < 128 || buf[0] === 255 && buf[1] >= 128)) {
    throw new Error("non-minimal integer encoding");
  }
  let n = BigInt(buf[0] > 127 ? buf[0] - 256 : buf[0]);
  for (let i = 1; i < end; ++i) {
    n = n * 256n + BigInt(buf[i]);
  }
  return n;
}
function parseStringASCII(buf) {
  return Uint8ArrayToString(buf);
}
function parseTime(buf, shortYear) {
  const timeStr = parseStringASCII(buf);
  const m = shortYear ? RE_TIME_SHORT_YEAR.exec(timeStr) : RE_TIME_LONG_YEAR.exec(timeStr);
  if (!m) {
    throw new Error("invalid time");
  }
  if (shortYear) {
    let year = Number(m[1]);
    year += year >= 50 ? 1900 : 2e3;
    m[1] = year.toString();
  }
  return /* @__PURE__ */ new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
}
function parseOID(buf) {
  let pos = 0;
  const end = buf.length;
  let n = buf[pos++];
  const first = Math.floor(n / 40);
  const second = n % 40;
  let oid = `${first}.${second}`;
  let val = 0;
  for (; pos < end; ++pos) {
    n = buf[pos];
    val = (val << 7) + (n & 127);
    if ((n & 128) === 0) {
      oid += `.${val}`;
      val = 0;
    }
  }
  return oid;
}
function parseBoolean(buf) {
  if (buf.length !== 1 || buf[0] !== 0 && buf[0] !== 255) {
    throw new Error("invalid boolean encoding");
  }
  return buf[0] === 255;
}
function parseBitString(buf) {
  const unused = buf[0];
  const start = 1;
  const end = buf.length;
  const bits = [];
  for (let i = start; i < end; ++i) {
    const byte = buf[i];
    const skip = i === end - 1 ? unused : 0;
    for (let j = 7; j >= skip; --j) {
      bits.push(byte >> j & 1);
    }
  }
  return bits;
}
var RE_TIME_SHORT_YEAR, RE_TIME_LONG_YEAR;
var init_parse = __esm({
  "node_modules/@freedomofpress/crypto-browser/dist/asn1/parse.js"() {
    init_encoding();
    RE_TIME_SHORT_YEAR = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d{3})?Z$/;
    RE_TIME_LONG_YEAR = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d{3})?Z$/;
  }
});

// node_modules/@freedomofpress/crypto-browser/dist/stream.js
var StreamError, ByteStream;
var init_stream = __esm({
  "node_modules/@freedomofpress/crypto-browser/dist/stream.js"() {
    StreamError = class extends Error {
    };
    ByteStream = class _ByteStream {
      constructor(buffer) {
        this.start = 0;
        this.view = buffer ?? new Uint8Array(0);
      }
      get buffer() {
        return this.view.subarray(0, this.start);
      }
      get length() {
        return this.view.byteLength;
      }
      get position() {
        return this.start;
      }
      seek(position) {
        this.start = position;
      }
      slice(start, len) {
        const end = start + len;
        if (end > this.length) {
          throw new StreamError("request past end of buffer");
        }
        return this.view.subarray(start, end);
      }
      appendChar(char) {
        this.ensureCapacity(1);
        this.view[this.start] = char;
        this.start += 1;
      }
      appendUint16(num) {
        this.ensureCapacity(2);
        const value = new Uint16Array([num]);
        const view = new Uint8Array(value.buffer);
        this.view[this.start] = view[1];
        this.view[this.start + 1] = view[0];
        this.start += 2;
      }
      appendUint24(num) {
        this.ensureCapacity(3);
        const value = new Uint32Array([num]);
        const view = new Uint8Array(value.buffer);
        this.view[this.start] = view[2];
        this.view[this.start + 1] = view[1];
        this.view[this.start + 2] = view[0];
        this.start += 3;
      }
      appendView(view) {
        this.ensureCapacity(view.length);
        this.view.set(view, this.start);
        this.start += view.length;
      }
      getBlock(size) {
        if (size <= 0) {
          return new Uint8Array(0);
        }
        if (this.start + size > this.view.length) {
          throw new Error("request past end of buffer");
        }
        const result = this.view.subarray(this.start, this.start + size);
        this.start += size;
        return result;
      }
      getUint8() {
        return this.getBlock(1)[0];
      }
      getUint16() {
        const block = this.getBlock(2);
        return block[0] << 8 | block[1];
      }
      ensureCapacity(size) {
        if (this.start + size > this.view.byteLength) {
          const blockSize = _ByteStream.BLOCK_SIZE + (size > _ByteStream.BLOCK_SIZE ? size : 0);
          this.realloc(this.view.byteLength + blockSize);
        }
      }
      realloc(size) {
        const newView = new Uint8Array(size);
        newView.set(this.view);
        this.view = newView;
      }
    };
    ByteStream.BLOCK_SIZE = 1024;
  }
});

// node_modules/@freedomofpress/crypto-browser/dist/asn1/obj.js
function parseStream(stream, depth) {
  if (depth > MAX_DEPTH) {
    throw new ASN1ParseError("nesting too deep");
  }
  const tag = new ASN1Tag(stream.getUint8());
  const len = decodeLength(stream);
  const value = stream.slice(stream.position, len);
  const start = stream.position;
  let subs = [];
  if (tag.constructed) {
    subs = collectSubs(stream, len, depth + 1);
  } else if (tag.isOctetString()) {
    try {
      subs = collectSubs(stream, len, depth + 1);
    } catch (e) {
    }
  }
  if (subs.length === 0) {
    stream.seek(start + len);
  }
  return new ASN1Obj(tag, value, subs);
}
function collectSubs(stream, len, depth) {
  const end = stream.position + len;
  if (end > stream.length) {
    throw new ASN1ParseError("invalid length");
  }
  const subs = [];
  while (stream.position < end) {
    subs.push(parseStream(stream, depth));
  }
  if (stream.position !== end) {
    throw new ASN1ParseError("invalid length");
  }
  return subs;
}
var ASN1Obj, MAX_DEPTH;
var init_obj = __esm({
  "node_modules/@freedomofpress/crypto-browser/dist/asn1/obj.js"() {
    init_stream();
    init_error();
    init_length();
    init_parse();
    init_tag();
    ASN1Obj = class {
      constructor(tag, value, subs) {
        this.tag = tag;
        this.value = value;
        this.subs = subs;
      }
      // Constructs an ASN.1 object from DER-encoded bytes. The whole buffer must be one object.
      static parseBuffer(buf) {
        const stream = new ByteStream(buf);
        const obj = parseStream(stream, 0);
        if (stream.position !== buf.length) {
          throw new ASN1ParseError("trailing bytes after ASN.1 object");
        }
        return obj;
      }
      toDER() {
        const valueStream = new ByteStream();
        if (this.subs.length > 0) {
          for (const sub of this.subs) {
            valueStream.appendView(sub.toDER());
          }
        } else {
          valueStream.appendView(this.value);
        }
        const value = valueStream.buffer;
        const obj = new ByteStream();
        obj.appendChar(this.tag.toDER());
        obj.appendView(encodeLength(value.length));
        obj.appendView(value);
        return obj.buffer;
      }
      /////////////////////////////////////////////////////////////////////////////
      // Convenience methods for parsing ASN.1 primitives into JS types
      // Returns the ASN.1 object's value as a boolean. Throws an error if the
      // object is not a boolean.
      toBoolean() {
        if (!this.tag.isBoolean()) {
          throw new ASN1TypeError("not a boolean");
        }
        return parseBoolean(this.value);
      }
      // Returns the ASN.1 object's value as a BigInt. Throws an error if the
      // object is not an integer.
      toInteger() {
        if (!this.tag.isInteger()) {
          throw new ASN1TypeError("not an integer");
        }
        return parseInteger(this.value);
      }
      // Returns the ASN.1 object's value as an OID string. Throws an error if the
      // object is not an OID.
      toOID() {
        if (!this.tag.isOID()) {
          throw new ASN1TypeError("not an OID");
        }
        return parseOID(this.value);
      }
      // Returns the ASN.1 object's value as a Date. Throws an error if the object
      // is not either a UTCTime or a GeneralizedTime.
      toDate() {
        switch (true) {
          case this.tag.isUTCTime():
            return parseTime(this.value, true);
          case this.tag.isGeneralizedTime():
            return parseTime(this.value, false);
          default:
            throw new ASN1TypeError("not a date");
        }
      }
      // Returns the ASN.1 object's value as a number[] where each number is the
      // value of a bit in the bit string. Throws an error if the object is not a
      // bit string.
      toBitString() {
        if (!this.tag.isBitString()) {
          throw new ASN1TypeError("not a bit string");
        }
        return parseBitString(this.value);
      }
    };
    MAX_DEPTH = 32;
  }
});

// node_modules/@freedomofpress/crypto-browser/dist/pem.js
function toDER(certificate) {
  let der = "";
  certificate.split("\n").forEach((line) => {
    if (line.match(PEM_HEADER) || line.match(PEM_FOOTER)) {
      return;
    }
    der += line;
  });
  return base64ToUint8Array(der);
}
var PEM_HEADER, PEM_FOOTER;
var init_pem = __esm({
  "node_modules/@freedomofpress/crypto-browser/dist/pem.js"() {
    init_encoding();
    PEM_HEADER = /-----BEGIN (.*)-----/;
    PEM_FOOTER = /-----END (.*)-----/;
  }
});

// node_modules/@freedomofpress/crypto-browser/dist/canonicalize.js
function canonicalizeString(string) {
  const escapedString = string.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return '"' + escapedString + '"';
}
function canonicalize(object) {
  const buffer = [];
  if (typeof object === "string") {
    buffer.push(canonicalizeString(object));
  } else if (typeof object === "boolean") {
    buffer.push(JSON.stringify(object));
  } else if (Number.isInteger(object)) {
    buffer.push(JSON.stringify(object));
  } else if (object === null) {
    buffer.push(JSON.stringify(object));
  } else if (Array.isArray(object)) {
    buffer.push(LEFT_SQUARE_BRACKET);
    let first = true;
    object.forEach((element) => {
      if (!first) {
        buffer.push(COMMA);
      }
      first = false;
      buffer.push(canonicalize(element));
    });
    buffer.push(RIGHT_SQUARE_BRACKET);
  } else if (typeof object === "object") {
    buffer.push(LEFT_CURLY_BRACKET);
    let first = true;
    Object.keys(object).sort().forEach((property) => {
      if (!first) {
        buffer.push(COMMA);
      }
      first = false;
      buffer.push(canonicalizeString(property));
      buffer.push(COLON);
      buffer.push(canonicalize(object[property]));
    });
    buffer.push(RIGHT_CURLY_BRACKET);
  } else {
    throw new TypeError("cannot encode " + object);
  }
  return buffer.join("");
}
var COMMA, COLON, LEFT_SQUARE_BRACKET, RIGHT_SQUARE_BRACKET, LEFT_CURLY_BRACKET, RIGHT_CURLY_BRACKET;
var init_canonicalize = __esm({
  "node_modules/@freedomofpress/crypto-browser/dist/canonicalize.js"() {
    COMMA = ",";
    COLON = ":";
    LEFT_SQUARE_BRACKET = "[";
    RIGHT_SQUARE_BRACKET = "]";
    LEFT_CURLY_BRACKET = "{";
    RIGHT_CURLY_BRACKET = "}";
  }
});

// node_modules/@freedomofpress/crypto-browser/dist/asn1/index.js
var init_asn1 = __esm({
  "node_modules/@freedomofpress/crypto-browser/dist/asn1/index.js"() {
    init_obj();
  }
});

// node_modules/@freedomofpress/crypto-browser/dist/interfaces.js
var KeyTypes, EcdsaTypes, HashAlgorithms, RsaAlgorithms, RsaSchemes;
var init_interfaces = __esm({
  "node_modules/@freedomofpress/crypto-browser/dist/interfaces.js"() {
    (function(KeyTypes2) {
      KeyTypes2["Ecdsa"] = "ECDSA";
      KeyTypes2["Ed25519"] = "Ed25519";
      KeyTypes2["RSA"] = "RSA";
    })(KeyTypes || (KeyTypes = {}));
    (function(EcdsaTypes2) {
      EcdsaTypes2["P256"] = "P-256";
      EcdsaTypes2["P384"] = "P-384";
      EcdsaTypes2["P521"] = "P-521";
    })(EcdsaTypes || (EcdsaTypes = {}));
    (function(HashAlgorithms2) {
      HashAlgorithms2["SHA256"] = "SHA-256";
      HashAlgorithms2["SHA384"] = "SHA-384";
      HashAlgorithms2["SHA512"] = "SHA-512";
    })(HashAlgorithms || (HashAlgorithms = {}));
    (function(RsaAlgorithms2) {
      RsaAlgorithms2["PKCS1v15"] = "RSASSA-PKCS1-v1_5";
      RsaAlgorithms2["PSS"] = "RSA-PSS";
    })(RsaAlgorithms || (RsaAlgorithms = {}));
    (function(RsaSchemes2) {
      RsaSchemes2["PKCS1"] = "PKCS1";
      RsaSchemes2["RSAPKCS1"] = "RSAPKCS1";
    })(RsaSchemes || (RsaSchemes = {}));
  }
});

// node_modules/@freedomofpress/crypto-browser/node_modules/@noble/hashes/esm/crypto.js
var crypto2;
var init_crypto = __esm({
  "node_modules/@freedomofpress/crypto-browser/node_modules/@noble/hashes/esm/crypto.js"() {
    crypto2 = typeof globalThis === "object" && "crypto" in globalThis ? globalThis.crypto : void 0;
  }
});

// node_modules/@freedomofpress/crypto-browser/node_modules/@noble/hashes/esm/utils.js
function isBytes4(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function anumber4(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("positive integer expected, got " + n);
}
function abytes4(b, ...lengths) {
  if (!isBytes4(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function ahash2(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new Error("Hash should be wrapped by utils.createHasher");
  anumber4(h.outputLen);
  anumber4(h.blockLen);
}
function aexists3(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput3(out, instance) {
  abytes4(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error("digestInto() expects output buffer of length at least " + min);
  }
}
function clean3(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView3(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr2(word, shift) {
  return word << 32 - shift | word >>> shift;
}
function bytesToHex5(bytes) {
  abytes4(bytes);
  if (hasHexBuiltin2)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes2[bytes[i]];
  }
  return hex;
}
function asciiToBase162(ch) {
  if (ch >= asciis._0 && ch <= asciis._9)
    return ch - asciis._0;
  if (ch >= asciis.A && ch <= asciis.F)
    return ch - (asciis.A - 10);
  if (ch >= asciis.a && ch <= asciis.f)
    return ch - (asciis.a - 10);
  return;
}
function hexToBytes4(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  if (hasHexBuiltin2)
    return Uint8Array.fromHex(hex);
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new Error("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase162(hex.charCodeAt(hi));
    const n2 = asciiToBase162(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes(data);
  abytes4(data);
  return data;
}
function concatBytes4(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes4(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
function createHasher2(hashCons) {
  const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}
function randomBytes3(bytesLength = 32) {
  if (crypto2 && typeof crypto2.getRandomValues === "function") {
    return crypto2.getRandomValues(new Uint8Array(bytesLength));
  }
  if (crypto2 && typeof crypto2.randomBytes === "function") {
    return Uint8Array.from(crypto2.randomBytes(bytesLength));
  }
  throw new Error("crypto.getRandomValues must be defined");
}
var hasHexBuiltin2, hexes2, asciis, Hash;
var init_utils2 = __esm({
  "node_modules/@freedomofpress/crypto-browser/node_modules/@noble/hashes/esm/utils.js"() {
    init_crypto();
    hasHexBuiltin2 = /* @__PURE__ */ (() => (
      // @ts-ignore
      typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
    ))();
    hexes2 = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
    asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
    Hash = class {
    };
  }
});

// node_modules/@freedomofpress/crypto-browser/node_modules/@noble/hashes/esm/_md.js
function setBigUint64(view, byteOffset, value, isLE2) {
  if (typeof view.setBigUint64 === "function")
    return view.setBigUint64(byteOffset, value, isLE2);
  const _32n2 = BigInt(32);
  const _u32_max = BigInt(4294967295);
  const wh = Number(value >> _32n2 & _u32_max);
  const wl = Number(value & _u32_max);
  const h = isLE2 ? 4 : 0;
  const l = isLE2 ? 0 : 4;
  view.setUint32(byteOffset + h, wh, isLE2);
  view.setUint32(byteOffset + l, wl, isLE2);
}
function Chi2(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj2(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD2, SHA256_IV2, SHA384_IV2, SHA512_IV2;
var init_md = __esm({
  "node_modules/@freedomofpress/crypto-browser/node_modules/@noble/hashes/esm/_md.js"() {
    init_utils2();
    HashMD2 = class extends Hash {
      constructor(blockLen, outputLen, padOffset, isLE2) {
        super();
        this.finished = false;
        this.length = 0;
        this.pos = 0;
        this.destroyed = false;
        this.blockLen = blockLen;
        this.outputLen = outputLen;
        this.padOffset = padOffset;
        this.isLE = isLE2;
        this.buffer = new Uint8Array(blockLen);
        this.view = createView3(this.buffer);
      }
      update(data) {
        aexists3(this);
        data = toBytes(data);
        abytes4(data);
        const { view, buffer, blockLen } = this;
        const len = data.length;
        for (let pos = 0; pos < len; ) {
          const take = Math.min(blockLen - this.pos, len - pos);
          if (take === blockLen) {
            const dataView = createView3(data);
            for (; blockLen <= len - pos; pos += blockLen)
              this.process(dataView, pos);
            continue;
          }
          buffer.set(data.subarray(pos, pos + take), this.pos);
          this.pos += take;
          pos += take;
          if (this.pos === blockLen) {
            this.process(view, 0);
            this.pos = 0;
          }
        }
        this.length += data.length;
        this.roundClean();
        return this;
      }
      digestInto(out) {
        aexists3(this);
        aoutput3(out, this);
        this.finished = true;
        const { buffer, view, blockLen, isLE: isLE2 } = this;
        let { pos } = this;
        buffer[pos++] = 128;
        clean3(this.buffer.subarray(pos));
        if (this.padOffset > blockLen - pos) {
          this.process(view, 0);
          pos = 0;
        }
        for (let i = pos; i < blockLen; i++)
          buffer[i] = 0;
        setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE2);
        this.process(view, 0);
        const oview = createView3(out);
        const len = this.outputLen;
        if (len % 4)
          throw new Error("_sha2: outputLen should be aligned to 32bit");
        const outLen = len / 4;
        const state = this.get();
        if (outLen > state.length)
          throw new Error("_sha2: outputLen bigger than state");
        for (let i = 0; i < outLen; i++)
          oview.setUint32(4 * i, state[i], isLE2);
      }
      digest() {
        const { buffer, outputLen } = this;
        this.digestInto(buffer);
        const res = buffer.slice(0, outputLen);
        this.destroy();
        return res;
      }
      _cloneInto(to) {
        to || (to = new this.constructor());
        to.set(...this.get());
        const { blockLen, buffer, length, finished, destroyed, pos } = this;
        to.destroyed = destroyed;
        to.finished = finished;
        to.length = length;
        to.pos = pos;
        if (length % blockLen)
          to.buffer.set(buffer);
        return to;
      }
      clone() {
        return this._cloneInto();
      }
    };
    SHA256_IV2 = /* @__PURE__ */ Uint32Array.from([
      1779033703,
      3144134277,
      1013904242,
      2773480762,
      1359893119,
      2600822924,
      528734635,
      1541459225
    ]);
    SHA384_IV2 = /* @__PURE__ */ Uint32Array.from([
      3418070365,
      3238371032,
      1654270250,
      914150663,
      2438529370,
      812702999,
      355462360,
      4144912697,
      1731405415,
      4290775857,
      2394180231,
      1750603025,
      3675008525,
      1694076839,
      1203062813,
      3204075428
    ]);
    SHA512_IV2 = /* @__PURE__ */ Uint32Array.from([
      1779033703,
      4089235720,
      3144134277,
      2227873595,
      1013904242,
      4271175723,
      2773480762,
      1595750129,
      1359893119,
      2917565137,
      2600822924,
      725511199,
      528734635,
      4215389547,
      1541459225,
      327033209
    ]);
  }
});

// node_modules/@freedomofpress/crypto-browser/node_modules/@noble/hashes/esm/_u64.js
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
function add(Ah, Al, Bh, Bl) {
  const l = (Al >>> 0) + (Bl >>> 0);
  return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
}
var U32_MASK64, _32n, shrSH, shrSL, rotrSH, rotrSL, rotrBH, rotrBL, add3L, add3H, add4L, add4H, add5L, add5H;
var init_u64 = __esm({
  "node_modules/@freedomofpress/crypto-browser/node_modules/@noble/hashes/esm/_u64.js"() {
    U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
    _32n = /* @__PURE__ */ BigInt(32);
    shrSH = (h, _l, s) => h >>> s;
    shrSL = (h, l, s) => h << 32 - s | l >>> s;
    rotrSH = (h, l, s) => h >>> s | l << 32 - s;
    rotrSL = (h, l, s) => h << 32 - s | l >>> s;
    rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
    rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
    add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
    add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
    add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
    add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
    add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
    add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;
  }
});

// node_modules/@freedomofpress/crypto-browser/node_modules/@noble/hashes/esm/sha2.js
var SHA256_K2, SHA256_W2, SHA256, K512, SHA512_Kh, SHA512_Kl, SHA512_W_H, SHA512_W_L, SHA512, SHA384, sha2562, sha5122, sha3842;
var init_sha2 = __esm({
  "node_modules/@freedomofpress/crypto-browser/node_modules/@noble/hashes/esm/sha2.js"() {
    init_md();
    init_u64();
    init_utils2();
    SHA256_K2 = /* @__PURE__ */ Uint32Array.from([
      1116352408,
      1899447441,
      3049323471,
      3921009573,
      961987163,
      1508970993,
      2453635748,
      2870763221,
      3624381080,
      310598401,
      607225278,
      1426881987,
      1925078388,
      2162078206,
      2614888103,
      3248222580,
      3835390401,
      4022224774,
      264347078,
      604807628,
      770255983,
      1249150122,
      1555081692,
      1996064986,
      2554220882,
      2821834349,
      2952996808,
      3210313671,
      3336571891,
      3584528711,
      113926993,
      338241895,
      666307205,
      773529912,
      1294757372,
      1396182291,
      1695183700,
      1986661051,
      2177026350,
      2456956037,
      2730485921,
      2820302411,
      3259730800,
      3345764771,
      3516065817,
      3600352804,
      4094571909,
      275423344,
      430227734,
      506948616,
      659060556,
      883997877,
      958139571,
      1322822218,
      1537002063,
      1747873779,
      1955562222,
      2024104815,
      2227730452,
      2361852424,
      2428436474,
      2756734187,
      3204031479,
      3329325298
    ]);
    SHA256_W2 = /* @__PURE__ */ new Uint32Array(64);
    SHA256 = class extends HashMD2 {
      constructor(outputLen = 32) {
        super(64, outputLen, 8, false);
        this.A = SHA256_IV2[0] | 0;
        this.B = SHA256_IV2[1] | 0;
        this.C = SHA256_IV2[2] | 0;
        this.D = SHA256_IV2[3] | 0;
        this.E = SHA256_IV2[4] | 0;
        this.F = SHA256_IV2[5] | 0;
        this.G = SHA256_IV2[6] | 0;
        this.H = SHA256_IV2[7] | 0;
      }
      get() {
        const { A, B, C, D, E, F, G, H } = this;
        return [A, B, C, D, E, F, G, H];
      }
      // prettier-ignore
      set(A, B, C, D, E, F, G, H) {
        this.A = A | 0;
        this.B = B | 0;
        this.C = C | 0;
        this.D = D | 0;
        this.E = E | 0;
        this.F = F | 0;
        this.G = G | 0;
        this.H = H | 0;
      }
      process(view, offset) {
        for (let i = 0; i < 16; i++, offset += 4)
          SHA256_W2[i] = view.getUint32(offset, false);
        for (let i = 16; i < 64; i++) {
          const W15 = SHA256_W2[i - 15];
          const W2 = SHA256_W2[i - 2];
          const s0 = rotr2(W15, 7) ^ rotr2(W15, 18) ^ W15 >>> 3;
          const s1 = rotr2(W2, 17) ^ rotr2(W2, 19) ^ W2 >>> 10;
          SHA256_W2[i] = s1 + SHA256_W2[i - 7] + s0 + SHA256_W2[i - 16] | 0;
        }
        let { A, B, C, D, E, F, G, H } = this;
        for (let i = 0; i < 64; i++) {
          const sigma1 = rotr2(E, 6) ^ rotr2(E, 11) ^ rotr2(E, 25);
          const T1 = H + sigma1 + Chi2(E, F, G) + SHA256_K2[i] + SHA256_W2[i] | 0;
          const sigma0 = rotr2(A, 2) ^ rotr2(A, 13) ^ rotr2(A, 22);
          const T2 = sigma0 + Maj2(A, B, C) | 0;
          H = G;
          G = F;
          F = E;
          E = D + T1 | 0;
          D = C;
          C = B;
          B = A;
          A = T1 + T2 | 0;
        }
        A = A + this.A | 0;
        B = B + this.B | 0;
        C = C + this.C | 0;
        D = D + this.D | 0;
        E = E + this.E | 0;
        F = F + this.F | 0;
        G = G + this.G | 0;
        H = H + this.H | 0;
        this.set(A, B, C, D, E, F, G, H);
      }
      roundClean() {
        clean3(SHA256_W2);
      }
      destroy() {
        this.set(0, 0, 0, 0, 0, 0, 0, 0);
        clean3(this.buffer);
      }
    };
    K512 = /* @__PURE__ */ (() => split([
      "0x428a2f98d728ae22",
      "0x7137449123ef65cd",
      "0xb5c0fbcfec4d3b2f",
      "0xe9b5dba58189dbbc",
      "0x3956c25bf348b538",
      "0x59f111f1b605d019",
      "0x923f82a4af194f9b",
      "0xab1c5ed5da6d8118",
      "0xd807aa98a3030242",
      "0x12835b0145706fbe",
      "0x243185be4ee4b28c",
      "0x550c7dc3d5ffb4e2",
      "0x72be5d74f27b896f",
      "0x80deb1fe3b1696b1",
      "0x9bdc06a725c71235",
      "0xc19bf174cf692694",
      "0xe49b69c19ef14ad2",
      "0xefbe4786384f25e3",
      "0x0fc19dc68b8cd5b5",
      "0x240ca1cc77ac9c65",
      "0x2de92c6f592b0275",
      "0x4a7484aa6ea6e483",
      "0x5cb0a9dcbd41fbd4",
      "0x76f988da831153b5",
      "0x983e5152ee66dfab",
      "0xa831c66d2db43210",
      "0xb00327c898fb213f",
      "0xbf597fc7beef0ee4",
      "0xc6e00bf33da88fc2",
      "0xd5a79147930aa725",
      "0x06ca6351e003826f",
      "0x142929670a0e6e70",
      "0x27b70a8546d22ffc",
      "0x2e1b21385c26c926",
      "0x4d2c6dfc5ac42aed",
      "0x53380d139d95b3df",
      "0x650a73548baf63de",
      "0x766a0abb3c77b2a8",
      "0x81c2c92e47edaee6",
      "0x92722c851482353b",
      "0xa2bfe8a14cf10364",
      "0xa81a664bbc423001",
      "0xc24b8b70d0f89791",
      "0xc76c51a30654be30",
      "0xd192e819d6ef5218",
      "0xd69906245565a910",
      "0xf40e35855771202a",
      "0x106aa07032bbd1b8",
      "0x19a4c116b8d2d0c8",
      "0x1e376c085141ab53",
      "0x2748774cdf8eeb99",
      "0x34b0bcb5e19b48a8",
      "0x391c0cb3c5c95a63",
      "0x4ed8aa4ae3418acb",
      "0x5b9cca4f7763e373",
      "0x682e6ff3d6b2b8a3",
      "0x748f82ee5defb2fc",
      "0x78a5636f43172f60",
      "0x84c87814a1f0ab72",
      "0x8cc702081a6439ec",
      "0x90befffa23631e28",
      "0xa4506cebde82bde9",
      "0xbef9a3f7b2c67915",
      "0xc67178f2e372532b",
      "0xca273eceea26619c",
      "0xd186b8c721c0c207",
      "0xeada7dd6cde0eb1e",
      "0xf57d4f7fee6ed178",
      "0x06f067aa72176fba",
      "0x0a637dc5a2c898a6",
      "0x113f9804bef90dae",
      "0x1b710b35131c471b",
      "0x28db77f523047d84",
      "0x32caab7b40c72493",
      "0x3c9ebe0a15c9bebc",
      "0x431d67c49c100d4c",
      "0x4cc5d4becb3e42b6",
      "0x597f299cfc657e2a",
      "0x5fcb6fab3ad6faec",
      "0x6c44198c4a475817"
    ].map((n) => BigInt(n))))();
    SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
    SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
    SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
    SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
    SHA512 = class extends HashMD2 {
      constructor(outputLen = 64) {
        super(128, outputLen, 16, false);
        this.Ah = SHA512_IV2[0] | 0;
        this.Al = SHA512_IV2[1] | 0;
        this.Bh = SHA512_IV2[2] | 0;
        this.Bl = SHA512_IV2[3] | 0;
        this.Ch = SHA512_IV2[4] | 0;
        this.Cl = SHA512_IV2[5] | 0;
        this.Dh = SHA512_IV2[6] | 0;
        this.Dl = SHA512_IV2[7] | 0;
        this.Eh = SHA512_IV2[8] | 0;
        this.El = SHA512_IV2[9] | 0;
        this.Fh = SHA512_IV2[10] | 0;
        this.Fl = SHA512_IV2[11] | 0;
        this.Gh = SHA512_IV2[12] | 0;
        this.Gl = SHA512_IV2[13] | 0;
        this.Hh = SHA512_IV2[14] | 0;
        this.Hl = SHA512_IV2[15] | 0;
      }
      // prettier-ignore
      get() {
        const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
        return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
      }
      // prettier-ignore
      set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
        this.Ah = Ah | 0;
        this.Al = Al | 0;
        this.Bh = Bh | 0;
        this.Bl = Bl | 0;
        this.Ch = Ch | 0;
        this.Cl = Cl | 0;
        this.Dh = Dh | 0;
        this.Dl = Dl | 0;
        this.Eh = Eh | 0;
        this.El = El | 0;
        this.Fh = Fh | 0;
        this.Fl = Fl | 0;
        this.Gh = Gh | 0;
        this.Gl = Gl | 0;
        this.Hh = Hh | 0;
        this.Hl = Hl | 0;
      }
      process(view, offset) {
        for (let i = 0; i < 16; i++, offset += 4) {
          SHA512_W_H[i] = view.getUint32(offset);
          SHA512_W_L[i] = view.getUint32(offset += 4);
        }
        for (let i = 16; i < 80; i++) {
          const W15h = SHA512_W_H[i - 15] | 0;
          const W15l = SHA512_W_L[i - 15] | 0;
          const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
          const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
          const W2h = SHA512_W_H[i - 2] | 0;
          const W2l = SHA512_W_L[i - 2] | 0;
          const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
          const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
          const SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
          const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
          SHA512_W_H[i] = SUMh | 0;
          SHA512_W_L[i] = SUMl | 0;
        }
        let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
        for (let i = 0; i < 80; i++) {
          const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
          const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
          const CHIh = Eh & Fh ^ ~Eh & Gh;
          const CHIl = El & Fl ^ ~El & Gl;
          const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
          const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
          const T1l = T1ll | 0;
          const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
          const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
          const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
          const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
          Hh = Gh | 0;
          Hl = Gl | 0;
          Gh = Fh | 0;
          Gl = Fl | 0;
          Fh = Eh | 0;
          Fl = El | 0;
          ({ h: Eh, l: El } = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
          Dh = Ch | 0;
          Dl = Cl | 0;
          Ch = Bh | 0;
          Cl = Bl | 0;
          Bh = Ah | 0;
          Bl = Al | 0;
          const All = add3L(T1l, sigma0l, MAJl);
          Ah = add3H(All, T1h, sigma0h, MAJh);
          Al = All | 0;
        }
        ({ h: Ah, l: Al } = add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
        ({ h: Bh, l: Bl } = add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
        ({ h: Ch, l: Cl } = add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
        ({ h: Dh, l: Dl } = add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
        ({ h: Eh, l: El } = add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
        ({ h: Fh, l: Fl } = add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
        ({ h: Gh, l: Gl } = add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
        ({ h: Hh, l: Hl } = add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
        this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
      }
      roundClean() {
        clean3(SHA512_W_H, SHA512_W_L);
      }
      destroy() {
        clean3(this.buffer);
        this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      }
    };
    SHA384 = class extends SHA512 {
      constructor() {
        super(48);
        this.Ah = SHA384_IV2[0] | 0;
        this.Al = SHA384_IV2[1] | 0;
        this.Bh = SHA384_IV2[2] | 0;
        this.Bl = SHA384_IV2[3] | 0;
        this.Ch = SHA384_IV2[4] | 0;
        this.Cl = SHA384_IV2[5] | 0;
        this.Dh = SHA384_IV2[6] | 0;
        this.Dl = SHA384_IV2[7] | 0;
        this.Eh = SHA384_IV2[8] | 0;
        this.El = SHA384_IV2[9] | 0;
        this.Fh = SHA384_IV2[10] | 0;
        this.Fl = SHA384_IV2[11] | 0;
        this.Gh = SHA384_IV2[12] | 0;
        this.Gl = SHA384_IV2[13] | 0;
        this.Hh = SHA384_IV2[14] | 0;
        this.Hl = SHA384_IV2[15] | 0;
      }
    };
    sha2562 = /* @__PURE__ */ createHasher2(() => new SHA256());
    sha5122 = /* @__PURE__ */ createHasher2(() => new SHA512());
    sha3842 = /* @__PURE__ */ createHasher2(() => new SHA384());
  }
});

// node_modules/@freedomofpress/crypto-browser/node_modules/@noble/hashes/esm/hmac.js
var HMAC, hmac2;
var init_hmac = __esm({
  "node_modules/@freedomofpress/crypto-browser/node_modules/@noble/hashes/esm/hmac.js"() {
    init_utils2();
    HMAC = class extends Hash {
      constructor(hash, _key) {
        super();
        this.finished = false;
        this.destroyed = false;
        ahash2(hash);
        const key = toBytes(_key);
        this.iHash = hash.create();
        if (typeof this.iHash.update !== "function")
          throw new Error("Expected instance of class which extends utils.Hash");
        this.blockLen = this.iHash.blockLen;
        this.outputLen = this.iHash.outputLen;
        const blockLen = this.blockLen;
        const pad = new Uint8Array(blockLen);
        pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
        for (let i = 0; i < pad.length; i++)
          pad[i] ^= 54;
        this.iHash.update(pad);
        this.oHash = hash.create();
        for (let i = 0; i < pad.length; i++)
          pad[i] ^= 54 ^ 92;
        this.oHash.update(pad);
        clean3(pad);
      }
      update(buf) {
        aexists3(this);
        this.iHash.update(buf);
        return this;
      }
      digestInto(out) {
        aexists3(this);
        abytes4(out, this.outputLen);
        this.finished = true;
        this.iHash.digestInto(out);
        this.oHash.update(out);
        this.oHash.digestInto(out);
        this.destroy();
      }
      digest() {
        const out = new Uint8Array(this.oHash.outputLen);
        this.digestInto(out);
        return out;
      }
      _cloneInto(to) {
        to || (to = Object.create(Object.getPrototypeOf(this), {}));
        const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
        to = to;
        to.finished = finished;
        to.destroyed = destroyed;
        to.blockLen = blockLen;
        to.outputLen = outputLen;
        to.oHash = oHash._cloneInto(to.oHash);
        to.iHash = iHash._cloneInto(to.iHash);
        return to;
      }
      clone() {
        return this._cloneInto();
      }
      destroy() {
        this.destroyed = true;
        this.oHash.destroy();
        this.iHash.destroy();
      }
    };
    hmac2 = (hash, key, message) => new HMAC(hash, key).update(message).digest();
    hmac2.create = (hash, key) => new HMAC(hash, key);
  }
});

// node_modules/@freedomofpress/crypto-browser/node_modules/@noble/curves/esm/utils.js
function _abool2(value, title = "") {
  if (typeof value !== "boolean") {
    const prefix = title && `"${title}"`;
    throw new Error(prefix + "expected boolean, got type=" + typeof value);
  }
  return value;
}
function _abytes2(value, length, title = "") {
  const bytes = isBytes4(value);
  const len = value?.length;
  const needsLen = length !== void 0;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
  }
  return value;
}
function numberToHexUnpadded(num) {
  const hex = num.toString(16);
  return hex.length & 1 ? "0" + hex : hex;
}
function hexToNumber2(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  return hex === "" ? _0n7 : BigInt("0x" + hex);
}
function bytesToNumberBE2(bytes) {
  return hexToNumber2(bytesToHex5(bytes));
}
function bytesToNumberLE2(bytes) {
  abytes4(bytes);
  return hexToNumber2(bytesToHex5(Uint8Array.from(bytes).reverse()));
}
function numberToBytesBE2(n, len) {
  return hexToBytes4(n.toString(16).padStart(len * 2, "0"));
}
function numberToBytesLE2(n, len) {
  return numberToBytesBE2(n, len).reverse();
}
function ensureBytes(title, hex, expectedLength) {
  let res;
  if (typeof hex === "string") {
    try {
      res = hexToBytes4(hex);
    } catch (e) {
      throw new Error(title + " must be hex string or Uint8Array, cause: " + e);
    }
  } else if (isBytes4(hex)) {
    res = Uint8Array.from(hex);
  } else {
    throw new Error(title + " must be hex string or Uint8Array");
  }
  const len = res.length;
  if (typeof expectedLength === "number" && len !== expectedLength)
    throw new Error(title + " of length " + expectedLength + " expected, got " + len);
  return res;
}
function equalBytes2(a, b) {
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function copyBytes3(bytes) {
  return Uint8Array.from(bytes);
}
function inRange2(n, min, max) {
  return isPosBig2(n) && isPosBig2(min) && isPosBig2(max) && min <= n && n < max;
}
function aInRange2(title, n, min, max) {
  if (!inRange2(n, min, max))
    throw new Error("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen2(n) {
  let len;
  for (len = 0; n > _0n7; n >>= _1n7, len += 1)
    ;
  return len;
}
function createHmacDrbg(hashLen, qByteLen, hmacFn) {
  if (typeof hashLen !== "number" || hashLen < 2)
    throw new Error("hashLen must be a number");
  if (typeof qByteLen !== "number" || qByteLen < 2)
    throw new Error("qByteLen must be a number");
  if (typeof hmacFn !== "function")
    throw new Error("hmacFn must be a function");
  const u8n = (len) => new Uint8Array(len);
  const u8of = (byte) => Uint8Array.of(byte);
  let v = u8n(hashLen);
  let k = u8n(hashLen);
  let i = 0;
  const reset = () => {
    v.fill(1);
    k.fill(0);
    i = 0;
  };
  const h = (...b) => hmacFn(k, v, ...b);
  const reseed = (seed = u8n(0)) => {
    k = h(u8of(0), seed);
    v = h();
    if (seed.length === 0)
      return;
    k = h(u8of(1), seed);
    v = h();
  };
  const gen = () => {
    if (i++ >= 1e3)
      throw new Error("drbg: tried 1000 values");
    let len = 0;
    const out = [];
    while (len < qByteLen) {
      v = h();
      const sl = v.slice();
      out.push(sl);
      len += v.length;
    }
    return concatBytes4(...out);
  };
  const genUntil = (seed, pred) => {
    reset();
    reseed(seed);
    let res = void 0;
    while (!(res = pred(gen())))
      reseed();
    reset();
    return res;
  };
  return genUntil;
}
function _validateObject(object, fields, optFields = {}) {
  if (!object || typeof object !== "object")
    throw new Error("expected valid options object");
  function checkField(fieldName, expectedType, isOpt) {
    const val = object[fieldName];
    if (isOpt && val === void 0)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new Error(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
  }
  Object.entries(fields).forEach(([k, v]) => checkField(k, v, false));
  Object.entries(optFields).forEach(([k, v]) => checkField(k, v, true));
}
function memoized(fn) {
  const map = /* @__PURE__ */ new WeakMap();
  return (arg, ...args) => {
    const val = map.get(arg);
    if (val !== void 0)
      return val;
    const computed = fn(arg, ...args);
    map.set(arg, computed);
    return computed;
  };
}
var _0n7, _1n7, isPosBig2, bitMask2, notImplemented2;
var init_utils3 = __esm({
  "node_modules/@freedomofpress/crypto-browser/node_modules/@noble/curves/esm/utils.js"() {
    init_utils2();
    init_utils2();
    _0n7 = /* @__PURE__ */ BigInt(0);
    _1n7 = /* @__PURE__ */ BigInt(1);
    isPosBig2 = (n) => typeof n === "bigint" && _0n7 <= n;
    bitMask2 = (n) => (_1n7 << BigInt(n)) - _1n7;
    notImplemented2 = () => {
      throw new Error("not implemented");
    };
  }
});

// node_modules/@freedomofpress/crypto-browser/node_modules/@noble/curves/esm/abstract/modular.js
function mod2(a, b) {
  const result = a % b;
  return result >= _0n8 ? result : b + result;
}
function pow22(x, power, modulo) {
  let res = x;
  while (power-- > _0n8) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert2(number, modulo) {
  if (number === _0n8)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _0n8)
    throw new Error("invert: expected positive modulus, got " + modulo);
  let a = mod2(number, modulo);
  let b = modulo;
  let x = _0n8, y = _1n8, u = _1n8, v = _0n8;
  while (a !== _0n8) {
    const q = b / a;
    const r = b % a;
    const m = x - u * q;
    const n = y - v * q;
    b = a, a = r, x = u, y = v, u = m, v = n;
  }
  const gcd = b;
  if (gcd !== _1n8)
    throw new Error("invert: does not exist");
  return mod2(x, modulo);
}
function assertIsSquare2(Fp2, root, n) {
  if (!Fp2.eql(Fp2.sqr(root), n))
    throw new Error("Cannot find square root");
}
function sqrt3mod42(Fp2, n) {
  const p1div4 = (Fp2.ORDER + _1n8) / _4n4;
  const root = Fp2.pow(n, p1div4);
  assertIsSquare2(Fp2, root, n);
  return root;
}
function sqrt5mod82(Fp2, n) {
  const p5div8 = (Fp2.ORDER - _5n3) / _8n4;
  const n2 = Fp2.mul(n, _2n5);
  const v = Fp2.pow(n2, p5div8);
  const nv = Fp2.mul(n, v);
  const i = Fp2.mul(Fp2.mul(nv, _2n5), v);
  const root = Fp2.mul(nv, Fp2.sub(i, Fp2.ONE));
  assertIsSquare2(Fp2, root, n);
  return root;
}
function sqrt9mod162(P) {
  const Fp_ = Field2(P);
  const tn = tonelliShanks2(P);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P + _7n2) / _16n2;
  return (Fp2, n) => {
    let tv1 = Fp2.pow(n, c4);
    let tv2 = Fp2.mul(tv1, c1);
    const tv3 = Fp2.mul(tv1, c2);
    const tv4 = Fp2.mul(tv1, c3);
    const e1 = Fp2.eql(Fp2.sqr(tv2), n);
    const e2 = Fp2.eql(Fp2.sqr(tv3), n);
    tv1 = Fp2.cmov(tv1, tv2, e1);
    tv2 = Fp2.cmov(tv4, tv3, e2);
    const e3 = Fp2.eql(Fp2.sqr(tv2), n);
    const root = Fp2.cmov(tv1, tv2, e3);
    assertIsSquare2(Fp2, root, n);
    return root;
  };
}
function tonelliShanks2(P) {
  if (P < _3n3)
    throw new Error("sqrt is not defined for small field");
  let Q = P - _1n8;
  let S = 0;
  while (Q % _2n5 === _0n8) {
    Q /= _2n5;
    S++;
  }
  let Z = _2n5;
  const _Fp = Field2(P);
  while (FpLegendre2(_Fp, Z) === 1) {
    if (Z++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod42;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n8) / _2n5;
  return function tonelliSlow(Fp2, n) {
    if (Fp2.is0(n))
      return n;
    if (FpLegendre2(Fp2, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = Fp2.mul(Fp2.ONE, cc);
    let t = Fp2.pow(n, Q);
    let R = Fp2.pow(n, Q1div2);
    while (!Fp2.eql(t, Fp2.ONE)) {
      if (Fp2.is0(t))
        return Fp2.ZERO;
      let i = 1;
      let t_tmp = Fp2.sqr(t);
      while (!Fp2.eql(t_tmp, Fp2.ONE)) {
        i++;
        t_tmp = Fp2.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n8 << BigInt(M - i - 1);
      const b = Fp2.pow(c, exponent);
      M = i;
      c = Fp2.sqr(b);
      t = Fp2.mul(t, c);
      R = Fp2.mul(R, b);
    }
    return R;
  };
}
function FpSqrt2(P) {
  if (P % _4n4 === _3n3)
    return sqrt3mod42;
  if (P % _8n4 === _5n3)
    return sqrt5mod82;
  if (P % _16n2 === _9n2)
    return sqrt9mod162(P);
  return tonelliShanks2(P);
}
function validateField2(field) {
  const initial = {
    ORDER: "bigint",
    MASK: "bigint",
    BYTES: "number",
    BITS: "number"
  };
  const opts = FIELD_FIELDS2.reduce((map, val) => {
    map[val] = "function";
    return map;
  }, initial);
  _validateObject(field, opts);
  return field;
}
function FpPow(Fp2, num, power) {
  if (power < _0n8)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n8)
    return Fp2.ONE;
  if (power === _1n8)
    return num;
  let p = Fp2.ONE;
  let d = num;
  while (power > _0n8) {
    if (power & _1n8)
      p = Fp2.mul(p, d);
    d = Fp2.sqr(d);
    power >>= _1n8;
  }
  return p;
}
function FpInvertBatch2(Fp2, nums, passZero = false) {
  const inverted = new Array(nums.length).fill(passZero ? Fp2.ZERO : void 0);
  const multipliedAcc = nums.reduce((acc, num, i) => {
    if (Fp2.is0(num))
      return acc;
    inverted[i] = acc;
    return Fp2.mul(acc, num);
  }, Fp2.ONE);
  const invertedAcc = Fp2.inv(multipliedAcc);
  nums.reduceRight((acc, num, i) => {
    if (Fp2.is0(num))
      return acc;
    inverted[i] = Fp2.mul(acc, inverted[i]);
    return Fp2.mul(acc, num);
  }, invertedAcc);
  return inverted;
}
function FpLegendre2(Fp2, n) {
  const p1mod2 = (Fp2.ORDER - _1n8) / _2n5;
  const powered = Fp2.pow(n, p1mod2);
  const yes = Fp2.eql(powered, Fp2.ONE);
  const zero = Fp2.eql(powered, Fp2.ZERO);
  const no = Fp2.eql(powered, Fp2.neg(Fp2.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength2(n, nBitLength) {
  if (nBitLength !== void 0)
    anumber4(nBitLength);
  const _nBitLength = nBitLength !== void 0 ? nBitLength : n.toString(2).length;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
function Field2(ORDER, bitLenOrOpts, isLE2 = false, opts = {}) {
  if (ORDER <= _0n8)
    throw new Error("invalid field: expected ORDER > 0, got " + ORDER);
  let _nbitLength = void 0;
  let _sqrt = void 0;
  let modFromBytes = false;
  let allowedLengths = void 0;
  if (typeof bitLenOrOpts === "object" && bitLenOrOpts != null) {
    if (opts.sqrt || isLE2)
      throw new Error("cannot specify opts in two arguments");
    const _opts = bitLenOrOpts;
    if (_opts.BITS)
      _nbitLength = _opts.BITS;
    if (_opts.sqrt)
      _sqrt = _opts.sqrt;
    if (typeof _opts.isLE === "boolean")
      isLE2 = _opts.isLE;
    if (typeof _opts.modFromBytes === "boolean")
      modFromBytes = _opts.modFromBytes;
    allowedLengths = _opts.allowedLengths;
  } else {
    if (typeof bitLenOrOpts === "number")
      _nbitLength = bitLenOrOpts;
    if (opts.sqrt)
      _sqrt = opts.sqrt;
  }
  const { nBitLength: BITS, nByteLength: BYTES } = nLength2(ORDER, _nbitLength);
  if (BYTES > 2048)
    throw new Error("invalid field: expected ORDER of <= 2048 bytes");
  let sqrtP;
  const f = Object.freeze({
    ORDER,
    isLE: isLE2,
    BITS,
    BYTES,
    MASK: bitMask2(BITS),
    ZERO: _0n8,
    ONE: _1n8,
    allowedLengths,
    create: (num) => mod2(num, ORDER),
    isValid: (num) => {
      if (typeof num !== "bigint")
        throw new Error("invalid field element: expected bigint, got " + typeof num);
      return _0n8 <= num && num < ORDER;
    },
    is0: (num) => num === _0n8,
    // is valid and invertible
    isValidNot0: (num) => !f.is0(num) && f.isValid(num),
    isOdd: (num) => (num & _1n8) === _1n8,
    neg: (num) => mod2(-num, ORDER),
    eql: (lhs, rhs) => lhs === rhs,
    sqr: (num) => mod2(num * num, ORDER),
    add: (lhs, rhs) => mod2(lhs + rhs, ORDER),
    sub: (lhs, rhs) => mod2(lhs - rhs, ORDER),
    mul: (lhs, rhs) => mod2(lhs * rhs, ORDER),
    pow: (num, power) => FpPow(f, num, power),
    div: (lhs, rhs) => mod2(lhs * invert2(rhs, ORDER), ORDER),
    // Same as above, but doesn't normalize
    sqrN: (num) => num * num,
    addN: (lhs, rhs) => lhs + rhs,
    subN: (lhs, rhs) => lhs - rhs,
    mulN: (lhs, rhs) => lhs * rhs,
    inv: (num) => invert2(num, ORDER),
    sqrt: _sqrt || ((n) => {
      if (!sqrtP)
        sqrtP = FpSqrt2(ORDER);
      return sqrtP(f, n);
    }),
    toBytes: (num) => isLE2 ? numberToBytesLE2(num, BYTES) : numberToBytesBE2(num, BYTES),
    fromBytes: (bytes, skipValidation = true) => {
      if (allowedLengths) {
        if (!allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
          throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
        }
        const padded = new Uint8Array(BYTES);
        padded.set(bytes, isLE2 ? 0 : padded.length - bytes.length);
        bytes = padded;
      }
      if (bytes.length !== BYTES)
        throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
      let scalar = isLE2 ? bytesToNumberLE2(bytes) : bytesToNumberBE2(bytes);
      if (modFromBytes)
        scalar = mod2(scalar, ORDER);
      if (!skipValidation) {
        if (!f.isValid(scalar))
          throw new Error("invalid field element: outside of range 0..ORDER");
      }
      return scalar;
    },
    // TODO: we don't need it here, move out to separate fn
    invertBatch: (lst) => FpInvertBatch2(f, lst),
    // We can't move this out because Fp6, Fp12 implement it
    // and it's unclear what to return in there.
    cmov: (a, b, c) => c ? b : a
  });
  return Object.freeze(f);
}
function getFieldBytesLength(fieldOrder) {
  if (typeof fieldOrder !== "bigint")
    throw new Error("field order must be bigint");
  const bitLength2 = fieldOrder.toString(2).length;
  return Math.ceil(bitLength2 / 8);
}
function getMinHashLength(fieldOrder) {
  const length = getFieldBytesLength(fieldOrder);
  return length + Math.ceil(length / 2);
}
function mapHashToField(key, fieldOrder, isLE2 = false) {
  const len = key.length;
  const fieldLen = getFieldBytesLength(fieldOrder);
  const minLen = getMinHashLength(fieldOrder);
  if (len < 16 || len < minLen || len > 1024)
    throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
  const num = isLE2 ? bytesToNumberLE2(key) : bytesToNumberBE2(key);
  const reduced = mod2(num, fieldOrder - _1n8) + _1n8;
  return isLE2 ? numberToBytesLE2(reduced, fieldLen) : numberToBytesBE2(reduced, fieldLen);
}
var _0n8, _1n8, _2n5, _3n3, _4n4, _5n3, _7n2, _8n4, _9n2, _16n2, isNegativeLE2, FIELD_FIELDS2;
var init_modular = __esm({
  "node_modules/@freedomofpress/crypto-browser/node_modules/@noble/curves/esm/abstract/modular.js"() {
    init_utils3();
    _0n8 = BigInt(0);
    _1n8 = BigInt(1);
    _2n5 = /* @__PURE__ */ BigInt(2);
    _3n3 = /* @__PURE__ */ BigInt(3);
    _4n4 = /* @__PURE__ */ BigInt(4);
    _5n3 = /* @__PURE__ */ BigInt(5);
    _7n2 = /* @__PURE__ */ BigInt(7);
    _8n4 = /* @__PURE__ */ BigInt(8);
    _9n2 = /* @__PURE__ */ BigInt(9);
    _16n2 = /* @__PURE__ */ BigInt(16);
    isNegativeLE2 = (num, modulo) => (mod2(num, modulo) & _1n8) === _1n8;
    FIELD_FIELDS2 = [
      "create",
      "isValid",
      "is0",
      "neg",
      "inv",
      "sqrt",
      "sqr",
      "eql",
      "add",
      "sub",
      "mul",
      "pow",
      "div",
      "addN",
      "subN",
      "mulN",
      "sqrN"
    ];
  }
});

// node_modules/@freedomofpress/crypto-browser/node_modules/@noble/curves/esm/abstract/curve.js
function negateCt(condition, item) {
  const neg = item.negate();
  return condition ? neg : item;
}
function normalizeZ2(c, points) {
  const invertedZs = FpInvertBatch2(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW2(W, bits) {
  if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
    throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
}
function calcWOpts(W, scalarBits) {
  validateW2(W, scalarBits);
  const windows = Math.ceil(scalarBits / W) + 1;
  const windowSize = 2 ** (W - 1);
  const maxNumber = 2 ** W;
  const mask = bitMask2(W);
  const shiftBy = BigInt(W);
  return { windows, windowSize, mask, maxNumber, shiftBy };
}
function calcOffsets(n, window2, wOpts) {
  const { windowSize, mask, maxNumber, shiftBy } = wOpts;
  let wbits = Number(n & mask);
  let nextN = n >> shiftBy;
  if (wbits > windowSize) {
    wbits -= maxNumber;
    nextN += _1n9;
  }
  const offsetStart = window2 * windowSize;
  const offset = offsetStart + Math.abs(wbits) - 1;
  const isZero = wbits === 0;
  const isNeg = wbits < 0;
  const isNegF = window2 % 2 !== 0;
  const offsetF = offsetStart;
  return { nextN, offset, isZero, isNeg, isNegF, offsetF };
}
function validateMSMPoints2(points, c) {
  if (!Array.isArray(points))
    throw new Error("array expected");
  points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars2(scalars, field) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s, i) => {
    if (!field.isValid(s))
      throw new Error("invalid scalar at index " + i);
  });
}
function getW(P) {
  return pointWindowSizes2.get(P) || 1;
}
function assert0(n) {
  if (n !== _0n9)
    throw new Error("invalid wNAF");
}
function mulEndoUnsafe(Point, point, k1, k2) {
  let acc = point;
  let p1 = Point.ZERO;
  let p2 = Point.ZERO;
  while (k1 > _0n9 || k2 > _0n9) {
    if (k1 & _1n9)
      p1 = p1.add(acc);
    if (k2 & _1n9)
      p2 = p2.add(acc);
    acc = acc.double();
    k1 >>= _1n9;
    k2 >>= _1n9;
  }
  return { p1, p2 };
}
function pippenger(c, fieldN, points, scalars) {
  validateMSMPoints2(points, c);
  validateMSMScalars2(scalars, fieldN);
  const plength = points.length;
  const slength = scalars.length;
  if (plength !== slength)
    throw new Error("arrays of points and scalars must have equal length");
  const zero = c.ZERO;
  const wbits = bitLen2(BigInt(plength));
  let windowSize = 1;
  if (wbits > 12)
    windowSize = wbits - 3;
  else if (wbits > 4)
    windowSize = wbits - 2;
  else if (wbits > 0)
    windowSize = 2;
  const MASK = bitMask2(windowSize);
  const buckets = new Array(Number(MASK) + 1).fill(zero);
  const lastBits = Math.floor((fieldN.BITS - 1) / windowSize) * windowSize;
  let sum = zero;
  for (let i = lastBits; i >= 0; i -= windowSize) {
    buckets.fill(zero);
    for (let j = 0; j < slength; j++) {
      const scalar = scalars[j];
      const wbits2 = Number(scalar >> BigInt(i) & MASK);
      buckets[wbits2] = buckets[wbits2].add(points[j]);
    }
    let resI = zero;
    for (let j = buckets.length - 1, sumI = zero; j > 0; j--) {
      sumI = sumI.add(buckets[j]);
      resI = resI.add(sumI);
    }
    sum = sum.add(resI);
    if (i !== 0)
      for (let j = 0; j < windowSize; j++)
        sum = sum.double();
  }
  return sum;
}
function createField2(order, field, isLE2) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField2(field);
    return field;
  } else {
    return Field2(order, { isLE: isLE2 });
  }
}
function _createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (FpFnLE === void 0)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(typeof val === "bigint" && val > _0n9))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  const Fp2 = createField2(CURVE.p, curveOpts.Fp, FpFnLE);
  const Fn2 = createField2(CURVE.n, curveOpts.Fn, FpFnLE);
  const _b = type === "weierstrass" ? "b" : "d";
  const params = ["Gx", "Gy", "a", _b];
  for (const p of params) {
    if (!Fp2.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  }
  CURVE = Object.freeze(Object.assign({}, CURVE));
  return { CURVE, Fp: Fp2, Fn: Fn2 };
}
var _0n9, _1n9, pointPrecomputes, pointWindowSizes2, wNAF;
var init_curve = __esm({
  "node_modules/@freedomofpress/crypto-browser/node_modules/@noble/curves/esm/abstract/curve.js"() {
    init_utils3();
    init_modular();
    _0n9 = BigInt(0);
    _1n9 = BigInt(1);
    pointPrecomputes = /* @__PURE__ */ new WeakMap();
    pointWindowSizes2 = /* @__PURE__ */ new WeakMap();
    wNAF = class {
      // Parametrized with a given Point class (not individual point)
      constructor(Point, bits) {
        this.BASE = Point.BASE;
        this.ZERO = Point.ZERO;
        this.Fn = Point.Fn;
        this.bits = bits;
      }
      // non-const time multiplication ladder
      _unsafeLadder(elm, n, p = this.ZERO) {
        let d = elm;
        while (n > _0n9) {
          if (n & _1n9)
            p = p.add(d);
          d = d.double();
          n >>= _1n9;
        }
        return p;
      }
      /**
       * Creates a wNAF precomputation window. Used for caching.
       * Default window size is set by `utils.precompute()` and is equal to 8.
       * Number of precomputed points depends on the curve size:
       * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
       * - 𝑊 is the window size
       * - 𝑛 is the bitlength of the curve order.
       * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
       * @param point Point instance
       * @param W window size
       * @returns precomputed point tables flattened to a single array
       */
      precomputeWindow(point, W) {
        const { windows, windowSize } = calcWOpts(W, this.bits);
        const points = [];
        let p = point;
        let base = p;
        for (let window2 = 0; window2 < windows; window2++) {
          base = p;
          points.push(base);
          for (let i = 1; i < windowSize; i++) {
            base = base.add(p);
            points.push(base);
          }
          p = base.double();
        }
        return points;
      }
      /**
       * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
       * More compact implementation:
       * https://github.com/paulmillr/noble-secp256k1/blob/47cb1669b6e506ad66b35fe7d76132ae97465da2/index.ts#L502-L541
       * @returns real and fake (for const-time) points
       */
      wNAF(W, precomputes, n) {
        if (!this.Fn.isValid(n))
          throw new Error("invalid scalar");
        let p = this.ZERO;
        let f = this.BASE;
        const wo = calcWOpts(W, this.bits);
        for (let window2 = 0; window2 < wo.windows; window2++) {
          const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window2, wo);
          n = nextN;
          if (isZero) {
            f = f.add(negateCt(isNegF, precomputes[offsetF]));
          } else {
            p = p.add(negateCt(isNeg, precomputes[offset]));
          }
        }
        assert0(n);
        return { p, f };
      }
      /**
       * Implements ec unsafe (non const-time) multiplication using precomputed tables and w-ary non-adjacent form.
       * @param acc accumulator point to add result of multiplication
       * @returns point
       */
      wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
        const wo = calcWOpts(W, this.bits);
        for (let window2 = 0; window2 < wo.windows; window2++) {
          if (n === _0n9)
            break;
          const { nextN, offset, isZero, isNeg } = calcOffsets(n, window2, wo);
          n = nextN;
          if (isZero) {
            continue;
          } else {
            const item = precomputes[offset];
            acc = acc.add(isNeg ? item.negate() : item);
          }
        }
        assert0(n);
        return acc;
      }
      getPrecomputes(W, point, transform) {
        let comp = pointPrecomputes.get(point);
        if (!comp) {
          comp = this.precomputeWindow(point, W);
          if (W !== 1) {
            if (typeof transform === "function")
              comp = transform(comp);
            pointPrecomputes.set(point, comp);
          }
        }
        return comp;
      }
      cached(point, scalar, transform) {
        const W = getW(point);
        return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
      }
      unsafe(point, scalar, transform, prev) {
        const W = getW(point);
        if (W === 1)
          return this._unsafeLadder(point, scalar, prev);
        return this.wNAFUnsafe(W, this.getPrecomputes(W, point, transform), scalar, prev);
      }
      // We calculate precomputes for elliptic curve point multiplication
      // using windowed method. This specifies window size and
      // stores precomputed values. Usually only base point would be precomputed.
      createCache(P, W) {
        validateW2(W, this.bits);
        pointWindowSizes2.set(P, W);
        pointPrecomputes.delete(P);
      }
      hasCache(elm) {
        return getW(elm) !== 1;
      }
    };
  }
});

// node_modules/@freedomofpress/crypto-browser/node_modules/@noble/curves/esm/abstract/weierstrass.js
function _splitEndoScalar(k, basis, n) {
  const [[a1, b1], [a2, b2]] = basis;
  const c1 = divNearest(b2 * k, n);
  const c2 = divNearest(-b1 * k, n);
  let k1 = k - c1 * a1 - c2 * a2;
  let k2 = -c1 * b1 - c2 * b2;
  const k1neg = k1 < _0n10;
  const k2neg = k2 < _0n10;
  if (k1neg)
    k1 = -k1;
  if (k2neg)
    k2 = -k2;
  const MAX_NUM = bitMask2(Math.ceil(bitLen2(n) / 2)) + _1n10;
  if (k1 < _0n10 || k1 >= MAX_NUM || k2 < _0n10 || k2 >= MAX_NUM) {
    throw new Error("splitScalar (endomorphism): failed, k=" + k);
  }
  return { k1neg, k1, k2neg, k2 };
}
function validateSigFormat(format) {
  if (!["compact", "recovered", "der"].includes(format))
    throw new Error('Signature format must be "compact", "recovered", or "der"');
  return format;
}
function validateSigOpts(opts, def) {
  const optsn = {};
  for (let optName of Object.keys(def)) {
    optsn[optName] = opts[optName] === void 0 ? def[optName] : opts[optName];
  }
  _abool2(optsn.lowS, "lowS");
  _abool2(optsn.prehash, "prehash");
  if (optsn.format !== void 0)
    validateSigFormat(optsn.format);
  return optsn;
}
function _normFnElement(Fn2, key) {
  const { BYTES: expected } = Fn2;
  let num;
  if (typeof key === "bigint") {
    num = key;
  } else {
    let bytes = ensureBytes("private key", key);
    try {
      num = Fn2.fromBytes(bytes);
    } catch (error) {
      throw new Error(`invalid private key: expected ui8a of size ${expected}, got ${typeof key}`);
    }
  }
  if (!Fn2.isValidNot0(num))
    throw new Error("invalid private key: out of range [1..N-1]");
  return num;
}
function weierstrassN(params, extraOpts = {}) {
  const validated = _createCurveFields("weierstrass", params, extraOpts);
  const { Fp: Fp2, Fn: Fn2 } = validated;
  let CURVE = validated.CURVE;
  const { h: cofactor, n: CURVE_ORDER } = CURVE;
  _validateObject(extraOpts, {}, {
    allowInfinityPoint: "boolean",
    clearCofactor: "function",
    isTorsionFree: "function",
    fromBytes: "function",
    toBytes: "function",
    endo: "object",
    wrapPrivateKey: "boolean"
  });
  const { endo } = extraOpts;
  if (endo) {
    if (!Fp2.is0(CURVE.a) || typeof endo.beta !== "bigint" || !Array.isArray(endo.basises)) {
      throw new Error('invalid endo: expected "beta": bigint and "basises": array');
    }
  }
  const lengths = getWLengths(Fp2, Fn2);
  function assertCompressionIsSupported() {
    if (!Fp2.isOdd)
      throw new Error("compression is not supported: Field does not have .isOdd()");
  }
  function pointToBytes(_c, point, isCompressed) {
    const { x, y } = point.toAffine();
    const bx = Fp2.toBytes(x);
    _abool2(isCompressed, "isCompressed");
    if (isCompressed) {
      assertCompressionIsSupported();
      const hasEvenY = !Fp2.isOdd(y);
      return concatBytes4(pprefix(hasEvenY), bx);
    } else {
      return concatBytes4(Uint8Array.of(4), bx, Fp2.toBytes(y));
    }
  }
  function pointFromBytes(bytes) {
    _abytes2(bytes, void 0, "Point");
    const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
    const length = bytes.length;
    const head = bytes[0];
    const tail = bytes.subarray(1);
    if (length === comp && (head === 2 || head === 3)) {
      const x = Fp2.fromBytes(tail);
      if (!Fp2.isValid(x))
        throw new Error("bad point: is not on curve, wrong x");
      const y2 = weierstrassEquation(x);
      let y;
      try {
        y = Fp2.sqrt(y2);
      } catch (sqrtError) {
        const err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
        throw new Error("bad point: is not on curve, sqrt error" + err);
      }
      assertCompressionIsSupported();
      const isYOdd = Fp2.isOdd(y);
      const isHeadOdd = (head & 1) === 1;
      if (isHeadOdd !== isYOdd)
        y = Fp2.neg(y);
      return { x, y };
    } else if (length === uncomp && head === 4) {
      const L = Fp2.BYTES;
      const x = Fp2.fromBytes(tail.subarray(0, L));
      const y = Fp2.fromBytes(tail.subarray(L, L * 2));
      if (!isValidXY(x, y))
        throw new Error("bad point: is not on curve");
      return { x, y };
    } else {
      throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
    }
  }
  const encodePoint = extraOpts.toBytes || pointToBytes;
  const decodePoint = extraOpts.fromBytes || pointFromBytes;
  function weierstrassEquation(x) {
    const x2 = Fp2.sqr(x);
    const x3 = Fp2.mul(x2, x);
    return Fp2.add(Fp2.add(x3, Fp2.mul(x, CURVE.a)), CURVE.b);
  }
  function isValidXY(x, y) {
    const left = Fp2.sqr(y);
    const right = weierstrassEquation(x);
    return Fp2.eql(left, right);
  }
  if (!isValidXY(CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const _4a3 = Fp2.mul(Fp2.pow(CURVE.a, _3n4), _4n5);
  const _27b2 = Fp2.mul(Fp2.sqr(CURVE.b), BigInt(27));
  if (Fp2.is0(Fp2.add(_4a3, _27b2)))
    throw new Error("bad curve params: a or b");
  function acoord(title, n, banZero = false) {
    if (!Fp2.isValid(n) || banZero && Fp2.is0(n))
      throw new Error(`bad point coordinate ${title}`);
    return n;
  }
  function aprjpoint(other) {
    if (!(other instanceof Point))
      throw new Error("ProjectivePoint expected");
  }
  function splitEndoScalarN(k) {
    if (!endo || !endo.basises)
      throw new Error("no endo");
    return _splitEndoScalar(k, endo.basises, Fn2.ORDER);
  }
  const toAffineMemo = memoized((p, iz) => {
    const { X, Y, Z } = p;
    if (Fp2.eql(Z, Fp2.ONE))
      return { x: X, y: Y };
    const is0 = p.is0();
    if (iz == null)
      iz = is0 ? Fp2.ONE : Fp2.inv(Z);
    const x = Fp2.mul(X, iz);
    const y = Fp2.mul(Y, iz);
    const zz = Fp2.mul(Z, iz);
    if (is0)
      return { x: Fp2.ZERO, y: Fp2.ZERO };
    if (!Fp2.eql(zz, Fp2.ONE))
      throw new Error("invZ was invalid");
    return { x, y };
  });
  const assertValidMemo = memoized((p) => {
    if (p.is0()) {
      if (extraOpts.allowInfinityPoint && !Fp2.is0(p.Y))
        return;
      throw new Error("bad point: ZERO");
    }
    const { x, y } = p.toAffine();
    if (!Fp2.isValid(x) || !Fp2.isValid(y))
      throw new Error("bad point: x or y not field elements");
    if (!isValidXY(x, y))
      throw new Error("bad point: equation left != right");
    if (!p.isTorsionFree())
      throw new Error("bad point: not in prime-order subgroup");
    return true;
  });
  function finishEndo(endoBeta, k1p, k2p, k1neg, k2neg) {
    k2p = new Point(Fp2.mul(k2p.X, endoBeta), k2p.Y, k2p.Z);
    k1p = negateCt(k1neg, k1p);
    k2p = negateCt(k2neg, k2p);
    return k1p.add(k2p);
  }
  class Point {
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    constructor(X, Y, Z) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y, true);
      this.Z = acoord("z", Z);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    static fromAffine(p) {
      const { x, y } = p || {};
      if (!p || !Fp2.isValid(x) || !Fp2.isValid(y))
        throw new Error("invalid affine point");
      if (p instanceof Point)
        throw new Error("projective point not allowed");
      if (Fp2.is0(x) && Fp2.is0(y))
        return Point.ZERO;
      return new Point(x, y, Fp2.ONE);
    }
    static fromBytes(bytes) {
      const P = Point.fromAffine(decodePoint(_abytes2(bytes, void 0, "point")));
      P.assertValidity();
      return P;
    }
    static fromHex(hex) {
      return Point.fromBytes(ensureBytes("pointHex", hex));
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    /**
     *
     * @param windowSize
     * @param isLazy true will defer table computation until the first multiplication
     * @returns
     */
    precompute(windowSize = 8, isLazy = true) {
      wnaf.createCache(this, windowSize);
      if (!isLazy)
        this.multiply(_3n4);
      return this;
    }
    // TODO: return `this`
    /** A point on curve is valid if it conforms to equation. */
    assertValidity() {
      assertValidMemo(this);
    }
    hasEvenY() {
      const { y } = this.toAffine();
      if (!Fp2.isOdd)
        throw new Error("Field doesn't support isOdd");
      return !Fp2.isOdd(y);
    }
    /** Compare one point to another. */
    equals(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const U1 = Fp2.eql(Fp2.mul(X1, Z2), Fp2.mul(X2, Z1));
      const U2 = Fp2.eql(Fp2.mul(Y1, Z2), Fp2.mul(Y2, Z1));
      return U1 && U2;
    }
    /** Flips point to one corresponding to (x, -y) in Affine coordinates. */
    negate() {
      return new Point(this.X, Fp2.neg(this.Y), this.Z);
    }
    // Renes-Costello-Batina exception-free doubling formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 3
    // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
    double() {
      const { a, b } = CURVE;
      const b3 = Fp2.mul(b, _3n4);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      let X3 = Fp2.ZERO, Y3 = Fp2.ZERO, Z3 = Fp2.ZERO;
      let t0 = Fp2.mul(X1, X1);
      let t1 = Fp2.mul(Y1, Y1);
      let t2 = Fp2.mul(Z1, Z1);
      let t3 = Fp2.mul(X1, Y1);
      t3 = Fp2.add(t3, t3);
      Z3 = Fp2.mul(X1, Z1);
      Z3 = Fp2.add(Z3, Z3);
      X3 = Fp2.mul(a, Z3);
      Y3 = Fp2.mul(b3, t2);
      Y3 = Fp2.add(X3, Y3);
      X3 = Fp2.sub(t1, Y3);
      Y3 = Fp2.add(t1, Y3);
      Y3 = Fp2.mul(X3, Y3);
      X3 = Fp2.mul(t3, X3);
      Z3 = Fp2.mul(b3, Z3);
      t2 = Fp2.mul(a, t2);
      t3 = Fp2.sub(t0, t2);
      t3 = Fp2.mul(a, t3);
      t3 = Fp2.add(t3, Z3);
      Z3 = Fp2.add(t0, t0);
      t0 = Fp2.add(Z3, t0);
      t0 = Fp2.add(t0, t2);
      t0 = Fp2.mul(t0, t3);
      Y3 = Fp2.add(Y3, t0);
      t2 = Fp2.mul(Y1, Z1);
      t2 = Fp2.add(t2, t2);
      t0 = Fp2.mul(t2, t3);
      X3 = Fp2.sub(X3, t0);
      Z3 = Fp2.mul(t2, t1);
      Z3 = Fp2.add(Z3, Z3);
      Z3 = Fp2.add(Z3, Z3);
      return new Point(X3, Y3, Z3);
    }
    // Renes-Costello-Batina exception-free addition formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 1
    // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
    add(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      let X3 = Fp2.ZERO, Y3 = Fp2.ZERO, Z3 = Fp2.ZERO;
      const a = CURVE.a;
      const b3 = Fp2.mul(CURVE.b, _3n4);
      let t0 = Fp2.mul(X1, X2);
      let t1 = Fp2.mul(Y1, Y2);
      let t2 = Fp2.mul(Z1, Z2);
      let t3 = Fp2.add(X1, Y1);
      let t4 = Fp2.add(X2, Y2);
      t3 = Fp2.mul(t3, t4);
      t4 = Fp2.add(t0, t1);
      t3 = Fp2.sub(t3, t4);
      t4 = Fp2.add(X1, Z1);
      let t5 = Fp2.add(X2, Z2);
      t4 = Fp2.mul(t4, t5);
      t5 = Fp2.add(t0, t2);
      t4 = Fp2.sub(t4, t5);
      t5 = Fp2.add(Y1, Z1);
      X3 = Fp2.add(Y2, Z2);
      t5 = Fp2.mul(t5, X3);
      X3 = Fp2.add(t1, t2);
      t5 = Fp2.sub(t5, X3);
      Z3 = Fp2.mul(a, t4);
      X3 = Fp2.mul(b3, t2);
      Z3 = Fp2.add(X3, Z3);
      X3 = Fp2.sub(t1, Z3);
      Z3 = Fp2.add(t1, Z3);
      Y3 = Fp2.mul(X3, Z3);
      t1 = Fp2.add(t0, t0);
      t1 = Fp2.add(t1, t0);
      t2 = Fp2.mul(a, t2);
      t4 = Fp2.mul(b3, t4);
      t1 = Fp2.add(t1, t2);
      t2 = Fp2.sub(t0, t2);
      t2 = Fp2.mul(a, t2);
      t4 = Fp2.add(t4, t2);
      t0 = Fp2.mul(t1, t4);
      Y3 = Fp2.add(Y3, t0);
      t0 = Fp2.mul(t5, t4);
      X3 = Fp2.mul(t3, X3);
      X3 = Fp2.sub(X3, t0);
      t0 = Fp2.mul(t3, t1);
      Z3 = Fp2.mul(t5, Z3);
      Z3 = Fp2.add(Z3, t0);
      return new Point(X3, Y3, Z3);
    }
    subtract(other) {
      return this.add(other.negate());
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    /**
     * Constant time multiplication.
     * Uses wNAF method. Windowed method may be 10% faster,
     * but takes 2x longer to generate and consumes 2x memory.
     * Uses precomputes when available.
     * Uses endomorphism for Koblitz curves.
     * @param scalar by which the point would be multiplied
     * @returns New point
     */
    multiply(scalar) {
      const { endo: endo2 } = extraOpts;
      if (!Fn2.isValidNot0(scalar))
        throw new Error("invalid scalar: out of range");
      let point, fake;
      const mul3 = (n) => wnaf.cached(this, n, (p) => normalizeZ2(Point, p));
      if (endo2) {
        const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(scalar);
        const { p: k1p, f: k1f } = mul3(k1);
        const { p: k2p, f: k2f } = mul3(k2);
        fake = k1f.add(k2f);
        point = finishEndo(endo2.beta, k1p, k2p, k1neg, k2neg);
      } else {
        const { p, f } = mul3(scalar);
        point = p;
        fake = f;
      }
      return normalizeZ2(Point, [point, fake])[0];
    }
    /**
     * Non-constant-time multiplication. Uses double-and-add algorithm.
     * It's faster, but should only be used when you don't care about
     * an exposed secret key e.g. sig verification, which works over *public* keys.
     */
    multiplyUnsafe(sc) {
      const { endo: endo2 } = extraOpts;
      const p = this;
      if (!Fn2.isValid(sc))
        throw new Error("invalid scalar: out of range");
      if (sc === _0n10 || p.is0())
        return Point.ZERO;
      if (sc === _1n10)
        return p;
      if (wnaf.hasCache(this))
        return this.multiply(sc);
      if (endo2) {
        const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(sc);
        const { p1, p2 } = mulEndoUnsafe(Point, p, k1, k2);
        return finishEndo(endo2.beta, p1, p2, k1neg, k2neg);
      } else {
        return wnaf.unsafe(p, sc);
      }
    }
    multiplyAndAddUnsafe(Q, a, b) {
      const sum = this.multiplyUnsafe(a).add(Q.multiplyUnsafe(b));
      return sum.is0() ? void 0 : sum;
    }
    /**
     * Converts Projective point to affine (x, y) coordinates.
     * @param invertedZ Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
     */
    toAffine(invertedZ) {
      return toAffineMemo(this, invertedZ);
    }
    /**
     * Checks whether Point is free of torsion elements (is in prime subgroup).
     * Always torsion-free for cofactor=1 curves.
     */
    isTorsionFree() {
      const { isTorsionFree } = extraOpts;
      if (cofactor === _1n10)
        return true;
      if (isTorsionFree)
        return isTorsionFree(Point, this);
      return wnaf.unsafe(this, CURVE_ORDER).is0();
    }
    clearCofactor() {
      const { clearCofactor } = extraOpts;
      if (cofactor === _1n10)
        return this;
      if (clearCofactor)
        return clearCofactor(Point, this);
      return this.multiplyUnsafe(cofactor);
    }
    isSmallOrder() {
      return this.multiplyUnsafe(cofactor).is0();
    }
    toBytes(isCompressed = true) {
      _abool2(isCompressed, "isCompressed");
      this.assertValidity();
      return encodePoint(Point, this, isCompressed);
    }
    toHex(isCompressed = true) {
      return bytesToHex5(this.toBytes(isCompressed));
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
    // TODO: remove
    get px() {
      return this.X;
    }
    get py() {
      return this.X;
    }
    get pz() {
      return this.Z;
    }
    toRawBytes(isCompressed = true) {
      return this.toBytes(isCompressed);
    }
    _setWindowSize(windowSize) {
      this.precompute(windowSize);
    }
    static normalizeZ(points) {
      return normalizeZ2(Point, points);
    }
    static msm(points, scalars) {
      return pippenger(Point, Fn2, points, scalars);
    }
    static fromPrivateKey(privateKey) {
      return Point.BASE.multiply(_normFnElement(Fn2, privateKey));
    }
  }
  Point.BASE = new Point(CURVE.Gx, CURVE.Gy, Fp2.ONE);
  Point.ZERO = new Point(Fp2.ZERO, Fp2.ONE, Fp2.ZERO);
  Point.Fp = Fp2;
  Point.Fn = Fn2;
  const bits = Fn2.BITS;
  const wnaf = new wNAF(Point, extraOpts.endo ? Math.ceil(bits / 2) : bits);
  Point.BASE.precompute(8);
  return Point;
}
function pprefix(hasEvenY) {
  return Uint8Array.of(hasEvenY ? 2 : 3);
}
function getWLengths(Fp2, Fn2) {
  return {
    secretKey: Fn2.BYTES,
    publicKey: 1 + Fp2.BYTES,
    publicKeyUncompressed: 1 + 2 * Fp2.BYTES,
    publicKeyHasPrefix: true,
    signature: 2 * Fn2.BYTES
  };
}
function ecdh(Point, ecdhOpts = {}) {
  const { Fn: Fn2 } = Point;
  const randomBytes_ = ecdhOpts.randomBytes || randomBytes3;
  const lengths = Object.assign(getWLengths(Point.Fp, Fn2), { seed: getMinHashLength(Fn2.ORDER) });
  function isValidSecretKey(secretKey) {
    try {
      return !!_normFnElement(Fn2, secretKey);
    } catch (error) {
      return false;
    }
  }
  function isValidPublicKey(publicKey, isCompressed) {
    const { publicKey: comp, publicKeyUncompressed } = lengths;
    try {
      const l = publicKey.length;
      if (isCompressed === true && l !== comp)
        return false;
      if (isCompressed === false && l !== publicKeyUncompressed)
        return false;
      return !!Point.fromBytes(publicKey);
    } catch (error) {
      return false;
    }
  }
  function randomSecretKey(seed = randomBytes_(lengths.seed)) {
    return mapHashToField(_abytes2(seed, lengths.seed, "seed"), Fn2.ORDER);
  }
  function getPublicKey(secretKey, isCompressed = true) {
    return Point.BASE.multiply(_normFnElement(Fn2, secretKey)).toBytes(isCompressed);
  }
  function keygen(seed) {
    const secretKey = randomSecretKey(seed);
    return { secretKey, publicKey: getPublicKey(secretKey) };
  }
  function isProbPub(item) {
    if (typeof item === "bigint")
      return false;
    if (item instanceof Point)
      return true;
    const { secretKey, publicKey, publicKeyUncompressed } = lengths;
    if (Fn2.allowedLengths || secretKey === publicKey)
      return void 0;
    const l = ensureBytes("key", item).length;
    return l === publicKey || l === publicKeyUncompressed;
  }
  function getSharedSecret(secretKeyA, publicKeyB, isCompressed = true) {
    if (isProbPub(secretKeyA) === true)
      throw new Error("first arg must be private key");
    if (isProbPub(publicKeyB) === false)
      throw new Error("second arg must be public key");
    const s = _normFnElement(Fn2, secretKeyA);
    const b = Point.fromHex(publicKeyB);
    return b.multiply(s).toBytes(isCompressed);
  }
  const utils = {
    isValidSecretKey,
    isValidPublicKey,
    randomSecretKey,
    // TODO: remove
    isValidPrivateKey: isValidSecretKey,
    randomPrivateKey: randomSecretKey,
    normPrivateKeyToScalar: (key) => _normFnElement(Fn2, key),
    precompute(windowSize = 8, point = Point.BASE) {
      return point.precompute(windowSize, false);
    }
  };
  return Object.freeze({ getPublicKey, getSharedSecret, keygen, Point, utils, lengths });
}
function ecdsa(Point, hash, ecdsaOpts = {}) {
  ahash2(hash);
  _validateObject(ecdsaOpts, {}, {
    hmac: "function",
    lowS: "boolean",
    randomBytes: "function",
    bits2int: "function",
    bits2int_modN: "function"
  });
  const randomBytes4 = ecdsaOpts.randomBytes || randomBytes3;
  const hmac3 = ecdsaOpts.hmac || ((key, ...msgs) => hmac2(hash, key, concatBytes4(...msgs)));
  const { Fp: Fp2, Fn: Fn2 } = Point;
  const { ORDER: CURVE_ORDER, BITS: fnBits } = Fn2;
  const { keygen, getPublicKey, getSharedSecret, utils, lengths } = ecdh(Point, ecdsaOpts);
  const defaultSigOpts = {
    prehash: false,
    lowS: typeof ecdsaOpts.lowS === "boolean" ? ecdsaOpts.lowS : false,
    format: void 0,
    //'compact' as ECDSASigFormat,
    extraEntropy: false
  };
  const defaultSigOpts_format = "compact";
  function isBiggerThanHalfOrder(number) {
    const HALF = CURVE_ORDER >> _1n10;
    return number > HALF;
  }
  function validateRS(title, num) {
    if (!Fn2.isValidNot0(num))
      throw new Error(`invalid signature ${title}: out of range 1..Point.Fn.ORDER`);
    return num;
  }
  function validateSigLength(bytes, format) {
    validateSigFormat(format);
    const size = lengths.signature;
    const sizer = format === "compact" ? size : format === "recovered" ? size + 1 : void 0;
    return _abytes2(bytes, sizer, `${format} signature`);
  }
  class Signature {
    constructor(r, s, recovery) {
      this.r = validateRS("r", r);
      this.s = validateRS("s", s);
      if (recovery != null)
        this.recovery = recovery;
      Object.freeze(this);
    }
    static fromBytes(bytes, format = defaultSigOpts_format) {
      validateSigLength(bytes, format);
      let recid;
      if (format === "der") {
        const { r: r2, s: s2 } = DER.toSig(_abytes2(bytes));
        return new Signature(r2, s2);
      }
      if (format === "recovered") {
        recid = bytes[0];
        format = "compact";
        bytes = bytes.subarray(1);
      }
      const L = Fn2.BYTES;
      const r = bytes.subarray(0, L);
      const s = bytes.subarray(L, L * 2);
      return new Signature(Fn2.fromBytes(r), Fn2.fromBytes(s), recid);
    }
    static fromHex(hex, format) {
      return this.fromBytes(hexToBytes4(hex), format);
    }
    addRecoveryBit(recovery) {
      return new Signature(this.r, this.s, recovery);
    }
    recoverPublicKey(messageHash) {
      const FIELD_ORDER = Fp2.ORDER;
      const { r, s, recovery: rec } = this;
      if (rec == null || ![0, 1, 2, 3].includes(rec))
        throw new Error("recovery id invalid");
      const hasCofactor = CURVE_ORDER * _2n6 < FIELD_ORDER;
      if (hasCofactor && rec > 1)
        throw new Error("recovery id is ambiguous for h>1 curve");
      const radj = rec === 2 || rec === 3 ? r + CURVE_ORDER : r;
      if (!Fp2.isValid(radj))
        throw new Error("recovery id 2 or 3 invalid");
      const x = Fp2.toBytes(radj);
      const R = Point.fromBytes(concatBytes4(pprefix((rec & 1) === 0), x));
      const ir = Fn2.inv(radj);
      const h = bits2int_modN(ensureBytes("msgHash", messageHash));
      const u1 = Fn2.create(-h * ir);
      const u2 = Fn2.create(s * ir);
      const Q = Point.BASE.multiplyUnsafe(u1).add(R.multiplyUnsafe(u2));
      if (Q.is0())
        throw new Error("point at infinify");
      Q.assertValidity();
      return Q;
    }
    // Signatures should be low-s, to prevent malleability.
    hasHighS() {
      return isBiggerThanHalfOrder(this.s);
    }
    toBytes(format = defaultSigOpts_format) {
      validateSigFormat(format);
      if (format === "der")
        return hexToBytes4(DER.hexFromSig(this));
      const r = Fn2.toBytes(this.r);
      const s = Fn2.toBytes(this.s);
      if (format === "recovered") {
        if (this.recovery == null)
          throw new Error("recovery bit must be present");
        return concatBytes4(Uint8Array.of(this.recovery), r, s);
      }
      return concatBytes4(r, s);
    }
    toHex(format) {
      return bytesToHex5(this.toBytes(format));
    }
    // TODO: remove
    assertValidity() {
    }
    static fromCompact(hex) {
      return Signature.fromBytes(ensureBytes("sig", hex), "compact");
    }
    static fromDER(hex) {
      return Signature.fromBytes(ensureBytes("sig", hex), "der");
    }
    normalizeS() {
      return this.hasHighS() ? new Signature(this.r, Fn2.neg(this.s), this.recovery) : this;
    }
    toDERRawBytes() {
      return this.toBytes("der");
    }
    toDERHex() {
      return bytesToHex5(this.toBytes("der"));
    }
    toCompactRawBytes() {
      return this.toBytes("compact");
    }
    toCompactHex() {
      return bytesToHex5(this.toBytes("compact"));
    }
  }
  const bits2int = ecdsaOpts.bits2int || function bits2int_def(bytes) {
    if (bytes.length > 8192)
      throw new Error("input is too large");
    const num = bytesToNumberBE2(bytes);
    const delta = bytes.length * 8 - fnBits;
    return delta > 0 ? num >> BigInt(delta) : num;
  };
  const bits2int_modN = ecdsaOpts.bits2int_modN || function bits2int_modN_def(bytes) {
    return Fn2.create(bits2int(bytes));
  };
  const ORDER_MASK = bitMask2(fnBits);
  function int2octets(num) {
    aInRange2("num < 2^" + fnBits, num, _0n10, ORDER_MASK);
    return Fn2.toBytes(num);
  }
  function validateMsgAndHash(message, prehash) {
    _abytes2(message, void 0, "message");
    return prehash ? _abytes2(hash(message), void 0, "prehashed message") : message;
  }
  function prepSig(message, privateKey, opts) {
    if (["recovered", "canonical"].some((k) => k in opts))
      throw new Error("sign() legacy options not supported");
    const { lowS, prehash, extraEntropy } = validateSigOpts(opts, defaultSigOpts);
    message = validateMsgAndHash(message, prehash);
    const h1int = bits2int_modN(message);
    const d = _normFnElement(Fn2, privateKey);
    const seedArgs = [int2octets(d), int2octets(h1int)];
    if (extraEntropy != null && extraEntropy !== false) {
      const e = extraEntropy === true ? randomBytes4(lengths.secretKey) : extraEntropy;
      seedArgs.push(ensureBytes("extraEntropy", e));
    }
    const seed = concatBytes4(...seedArgs);
    const m = h1int;
    function k2sig(kBytes) {
      const k = bits2int(kBytes);
      if (!Fn2.isValidNot0(k))
        return;
      const ik = Fn2.inv(k);
      const q = Point.BASE.multiply(k).toAffine();
      const r = Fn2.create(q.x);
      if (r === _0n10)
        return;
      const s = Fn2.create(ik * Fn2.create(m + r * d));
      if (s === _0n10)
        return;
      let recovery = (q.x === r ? 0 : 2) | Number(q.y & _1n10);
      let normS = s;
      if (lowS && isBiggerThanHalfOrder(s)) {
        normS = Fn2.neg(s);
        recovery ^= 1;
      }
      return new Signature(r, normS, recovery);
    }
    return { seed, k2sig };
  }
  function sign(message, secretKey, opts = {}) {
    message = ensureBytes("message", message);
    const { seed, k2sig } = prepSig(message, secretKey, opts);
    const drbg = createHmacDrbg(hash.outputLen, Fn2.BYTES, hmac3);
    const sig = drbg(seed, k2sig);
    return sig;
  }
  function tryParsingSig(sg) {
    let sig = void 0;
    const isHex = typeof sg === "string" || isBytes4(sg);
    const isObj = !isHex && sg !== null && typeof sg === "object" && typeof sg.r === "bigint" && typeof sg.s === "bigint";
    if (!isHex && !isObj)
      throw new Error("invalid signature, expected Uint8Array, hex string or Signature instance");
    if (isObj) {
      sig = new Signature(sg.r, sg.s);
    } else if (isHex) {
      try {
        sig = Signature.fromBytes(ensureBytes("sig", sg), "der");
      } catch (derError) {
        if (!(derError instanceof DER.Err))
          throw derError;
      }
      if (!sig) {
        try {
          sig = Signature.fromBytes(ensureBytes("sig", sg), "compact");
        } catch (error) {
          return false;
        }
      }
    }
    if (!sig)
      return false;
    return sig;
  }
  function verify(signature, message, publicKey, opts = {}) {
    const { lowS, prehash, format } = validateSigOpts(opts, defaultSigOpts);
    publicKey = ensureBytes("publicKey", publicKey);
    message = validateMsgAndHash(ensureBytes("message", message), prehash);
    if ("strict" in opts)
      throw new Error("options.strict was renamed to lowS");
    const sig = format === void 0 ? tryParsingSig(signature) : Signature.fromBytes(ensureBytes("sig", signature), format);
    if (sig === false)
      return false;
    try {
      const P = Point.fromBytes(publicKey);
      if (lowS && sig.hasHighS())
        return false;
      const { r, s } = sig;
      const h = bits2int_modN(message);
      const is = Fn2.inv(s);
      const u1 = Fn2.create(h * is);
      const u2 = Fn2.create(r * is);
      const R = Point.BASE.multiplyUnsafe(u1).add(P.multiplyUnsafe(u2));
      if (R.is0())
        return false;
      const v = Fn2.create(R.x);
      return v === r;
    } catch (e) {
      return false;
    }
  }
  function recoverPublicKey(signature, message, opts = {}) {
    const { prehash } = validateSigOpts(opts, defaultSigOpts);
    message = validateMsgAndHash(message, prehash);
    return Signature.fromBytes(signature, "recovered").recoverPublicKey(message).toBytes();
  }
  return Object.freeze({
    keygen,
    getPublicKey,
    getSharedSecret,
    utils,
    lengths,
    Point,
    sign,
    verify,
    recoverPublicKey,
    Signature,
    hash
  });
}
function _weierstrass_legacy_opts_to_new(c) {
  const CURVE = {
    a: c.a,
    b: c.b,
    p: c.Fp.ORDER,
    n: c.n,
    h: c.h,
    Gx: c.Gx,
    Gy: c.Gy
  };
  const Fp2 = c.Fp;
  let allowedLengths = c.allowedPrivateKeyLengths ? Array.from(new Set(c.allowedPrivateKeyLengths.map((l) => Math.ceil(l / 2)))) : void 0;
  const Fn2 = Field2(CURVE.n, {
    BITS: c.nBitLength,
    allowedLengths,
    modFromBytes: c.wrapPrivateKey
  });
  const curveOpts = {
    Fp: Fp2,
    Fn: Fn2,
    allowInfinityPoint: c.allowInfinityPoint,
    endo: c.endo,
    isTorsionFree: c.isTorsionFree,
    clearCofactor: c.clearCofactor,
    fromBytes: c.fromBytes,
    toBytes: c.toBytes
  };
  return { CURVE, curveOpts };
}
function _ecdsa_legacy_opts_to_new(c) {
  const { CURVE, curveOpts } = _weierstrass_legacy_opts_to_new(c);
  const ecdsaOpts = {
    hmac: c.hmac,
    randomBytes: c.randomBytes,
    lowS: c.lowS,
    bits2int: c.bits2int,
    bits2int_modN: c.bits2int_modN
  };
  return { CURVE, curveOpts, hash: c.hash, ecdsaOpts };
}
function _ecdsa_new_output_to_legacy(c, _ecdsa) {
  const Point = _ecdsa.Point;
  return Object.assign({}, _ecdsa, {
    ProjectivePoint: Point,
    CURVE: Object.assign({}, c, nLength2(Point.Fn.ORDER, Point.Fn.BITS))
  });
}
function weierstrass(c) {
  const { CURVE, curveOpts, hash, ecdsaOpts } = _ecdsa_legacy_opts_to_new(c);
  const Point = weierstrassN(CURVE, curveOpts);
  const signs = ecdsa(Point, hash, ecdsaOpts);
  return _ecdsa_new_output_to_legacy(c, signs);
}
var divNearest, DERErr, DER, _0n10, _1n10, _2n6, _3n4, _4n5;
var init_weierstrass = __esm({
  "node_modules/@freedomofpress/crypto-browser/node_modules/@noble/curves/esm/abstract/weierstrass.js"() {
    init_hmac();
    init_utils2();
    init_utils3();
    init_curve();
    init_modular();
    divNearest = (num, den) => (num + (num >= 0 ? den : -den) / _2n6) / den;
    DERErr = class extends Error {
      constructor(m = "") {
        super(m);
      }
    };
    DER = {
      // asn.1 DER encoding utils
      Err: DERErr,
      // Basic building block is TLV (Tag-Length-Value)
      _tlv: {
        encode: (tag, data) => {
          const { Err: E } = DER;
          if (tag < 0 || tag > 256)
            throw new E("tlv.encode: wrong tag");
          if (data.length & 1)
            throw new E("tlv.encode: unpadded data");
          const dataLen = data.length / 2;
          const len = numberToHexUnpadded(dataLen);
          if (len.length / 2 & 128)
            throw new E("tlv.encode: long form length too big");
          const lenLen = dataLen > 127 ? numberToHexUnpadded(len.length / 2 | 128) : "";
          const t = numberToHexUnpadded(tag);
          return t + lenLen + len + data;
        },
        // v - value, l - left bytes (unparsed)
        decode(tag, data) {
          const { Err: E } = DER;
          let pos = 0;
          if (tag < 0 || tag > 256)
            throw new E("tlv.encode: wrong tag");
          if (data.length < 2 || data[pos++] !== tag)
            throw new E("tlv.decode: wrong tlv");
          const first = data[pos++];
          const isLong = !!(first & 128);
          let length = 0;
          if (!isLong)
            length = first;
          else {
            const lenLen = first & 127;
            if (!lenLen)
              throw new E("tlv.decode(long): indefinite length not supported");
            if (lenLen > 4)
              throw new E("tlv.decode(long): byte length is too big");
            const lengthBytes2 = data.subarray(pos, pos + lenLen);
            if (lengthBytes2.length !== lenLen)
              throw new E("tlv.decode: length bytes not complete");
            if (lengthBytes2[0] === 0)
              throw new E("tlv.decode(long): zero leftmost byte");
            for (const b of lengthBytes2)
              length = length << 8 | b;
            pos += lenLen;
            if (length < 128)
              throw new E("tlv.decode(long): not minimal encoding");
          }
          const v = data.subarray(pos, pos + length);
          if (v.length !== length)
            throw new E("tlv.decode: wrong value length");
          return { v, l: data.subarray(pos + length) };
        }
      },
      // https://crypto.stackexchange.com/a/57734 Leftmost bit of first byte is 'negative' flag,
      // since we always use positive integers here. It must always be empty:
      // - add zero byte if exists
      // - if next byte doesn't have a flag, leading zero is not allowed (minimal encoding)
      _int: {
        encode(num) {
          const { Err: E } = DER;
          if (num < _0n10)
            throw new E("integer: negative integers are not allowed");
          let hex = numberToHexUnpadded(num);
          if (Number.parseInt(hex[0], 16) & 8)
            hex = "00" + hex;
          if (hex.length & 1)
            throw new E("unexpected DER parsing assertion: unpadded hex");
          return hex;
        },
        decode(data) {
          const { Err: E } = DER;
          if (data[0] & 128)
            throw new E("invalid signature integer: negative");
          if (data[0] === 0 && !(data[1] & 128))
            throw new E("invalid signature integer: unnecessary leading zero");
          return bytesToNumberBE2(data);
        }
      },
      toSig(hex) {
        const { Err: E, _int: int, _tlv: tlv } = DER;
        const data = ensureBytes("signature", hex);
        const { v: seqBytes, l: seqLeftBytes } = tlv.decode(48, data);
        if (seqLeftBytes.length)
          throw new E("invalid signature: left bytes after parsing");
        const { v: rBytes, l: rLeftBytes } = tlv.decode(2, seqBytes);
        const { v: sBytes, l: sLeftBytes } = tlv.decode(2, rLeftBytes);
        if (sLeftBytes.length)
          throw new E("invalid signature: left bytes after parsing");
        return { r: int.decode(rBytes), s: int.decode(sBytes) };
      },
      hexFromSig(sig) {
        const { _tlv: tlv, _int: int } = DER;
        const rs = tlv.encode(2, int.encode(sig.r));
        const ss = tlv.encode(2, int.encode(sig.s));
        const seq = rs + ss;
        return tlv.encode(48, seq);
      }
    };
    _0n10 = BigInt(0);
    _1n10 = BigInt(1);
    _2n6 = BigInt(2);
    _3n4 = BigInt(3);
    _4n5 = BigInt(4);
  }
});

// node_modules/@freedomofpress/crypto-browser/node_modules/@noble/curves/esm/_shortw_utils.js
function createCurve(curveDef, defHash) {
  const create = (hash) => weierstrass({ ...curveDef, hash });
  return { ...create(defHash), create };
}
var init_shortw_utils = __esm({
  "node_modules/@freedomofpress/crypto-browser/node_modules/@noble/curves/esm/_shortw_utils.js"() {
    init_weierstrass();
  }
});

// node_modules/@freedomofpress/crypto-browser/node_modules/@noble/curves/esm/nist.js
var p256_CURVE, p384_CURVE, p521_CURVE, Fp256, Fp384, Fp521, p256, p384, p521;
var init_nist = __esm({
  "node_modules/@freedomofpress/crypto-browser/node_modules/@noble/curves/esm/nist.js"() {
    init_sha2();
    init_shortw_utils();
    init_modular();
    p256_CURVE = {
      p: BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff"),
      n: BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"),
      h: BigInt(1),
      a: BigInt("0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc"),
      b: BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b"),
      Gx: BigInt("0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"),
      Gy: BigInt("0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5")
    };
    p384_CURVE = {
      p: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffff"),
      n: BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973"),
      h: BigInt(1),
      a: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000fffffffc"),
      b: BigInt("0xb3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aef"),
      Gx: BigInt("0xaa87ca22be8b05378eb1c71ef320ad746e1d3b628ba79b9859f741e082542a385502f25dbf55296c3a545e3872760ab7"),
      Gy: BigInt("0x3617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5f")
    };
    p521_CURVE = {
      p: BigInt("0x1ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"),
      n: BigInt("0x01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409"),
      h: BigInt(1),
      a: BigInt("0x1fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc"),
      b: BigInt("0x0051953eb9618e1c9a1f929a21a0b68540eea2da725b99b315f3b8b489918ef109e156193951ec7e937b1652c0bd3bb1bf073573df883d2c34f1ef451fd46b503f00"),
      Gx: BigInt("0x00c6858e06b70404e9cd9e3ecb662395b4429c648139053fb521f828af606b4d3dbaa14b5e77efe75928fe1dc127a2ffa8de3348b3c1856a429bf97e7e31c2e5bd66"),
      Gy: BigInt("0x011839296a789a3bc0045c8a5fb42c7d1bd998f54449579b446817afbd17273e662c97ee72995ef42640c550b9013fad0761353c7086a272c24088be94769fd16650")
    };
    Fp256 = Field2(p256_CURVE.p);
    Fp384 = Field2(p384_CURVE.p);
    Fp521 = Field2(p521_CURVE.p);
    p256 = createCurve({ ...p256_CURVE, Fp: Fp256, lowS: false }, sha2562);
    p384 = createCurve({ ...p384_CURVE, Fp: Fp384, lowS: false }, sha3842);
    p521 = createCurve({ ...p521_CURVE, Fp: Fp521, lowS: false, allowedPrivateKeyLengths: [130, 131, 132] }, sha5122);
  }
});

// node_modules/@freedomofpress/crypto-browser/node_modules/@noble/curves/esm/abstract/edwards.js
function isEdValidXY2(Fp2, CURVE, x, y) {
  const x2 = Fp2.sqr(x);
  const y2 = Fp2.sqr(y);
  const left = Fp2.add(Fp2.mul(CURVE.a, x2), y2);
  const right = Fp2.add(Fp2.ONE, Fp2.mul(CURVE.d, Fp2.mul(x2, y2)));
  return Fp2.eql(left, right);
}
function edwards2(params, extraOpts = {}) {
  const validated = _createCurveFields("edwards", params, extraOpts, extraOpts.FpFnLE);
  const { Fp: Fp2, Fn: Fn2 } = validated;
  let CURVE = validated.CURVE;
  const { h: cofactor } = CURVE;
  _validateObject(extraOpts, {}, { uvRatio: "function" });
  const MASK = _2n7 << BigInt(Fn2.BYTES * 8) - _1n11;
  const modP = (n) => Fp2.create(n);
  const uvRatio3 = extraOpts.uvRatio || ((u, v) => {
    try {
      return { isValid: true, value: Fp2.sqrt(Fp2.div(u, v)) };
    } catch (e) {
      return { isValid: false, value: _0n11 };
    }
  });
  if (!isEdValidXY2(Fp2, CURVE, CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  function acoord(title, n, banZero = false) {
    const min = banZero ? _1n11 : _0n11;
    aInRange2("coordinate " + title, n, min, MASK);
    return n;
  }
  function aextpoint(other) {
    if (!(other instanceof Point))
      throw new Error("ExtendedPoint expected");
  }
  const toAffineMemo = memoized((p, iz) => {
    const { X, Y, Z } = p;
    const is0 = p.is0();
    if (iz == null)
      iz = is0 ? _8n5 : Fp2.inv(Z);
    const x = modP(X * iz);
    const y = modP(Y * iz);
    const zz = Fp2.mul(Z, iz);
    if (is0)
      return { x: _0n11, y: _1n11 };
    if (zz !== _1n11)
      throw new Error("invZ was invalid");
    return { x, y };
  });
  const assertValidMemo = memoized((p) => {
    const { a, d } = CURVE;
    if (p.is0())
      throw new Error("bad point: ZERO");
    const { X, Y, Z, T } = p;
    const X2 = modP(X * X);
    const Y2 = modP(Y * Y);
    const Z2 = modP(Z * Z);
    const Z4 = modP(Z2 * Z2);
    const aX2 = modP(X2 * a);
    const left = modP(Z2 * modP(aX2 + Y2));
    const right = modP(Z4 + modP(d * modP(X2 * Y2)));
    if (left !== right)
      throw new Error("bad point: equation left != right (1)");
    const XY = modP(X * Y);
    const ZT = modP(Z * T);
    if (XY !== ZT)
      throw new Error("bad point: equation left != right (2)");
    return true;
  });
  class Point {
    constructor(X, Y, Z, T) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y);
      this.Z = acoord("z", Z, true);
      this.T = acoord("t", T);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    static fromAffine(p) {
      if (p instanceof Point)
        throw new Error("extended point not allowed");
      const { x, y } = p || {};
      acoord("x", x);
      acoord("y", y);
      return new Point(x, y, _1n11, modP(x * y));
    }
    // Uses algo from RFC8032 5.1.3.
    static fromBytes(bytes, zip215 = false) {
      const len = Fp2.BYTES;
      const { a, d } = CURVE;
      bytes = copyBytes3(_abytes2(bytes, len, "point"));
      _abool2(zip215, "zip215");
      const normed = copyBytes3(bytes);
      const lastByte = bytes[len - 1];
      normed[len - 1] = lastByte & ~128;
      const y = bytesToNumberLE2(normed);
      const max = zip215 ? MASK : Fp2.ORDER;
      aInRange2("point.y", y, _0n11, max);
      const y2 = modP(y * y);
      const u = modP(y2 - _1n11);
      const v = modP(d * y2 - a);
      let { isValid, value: x } = uvRatio3(u, v);
      if (!isValid)
        throw new Error("bad point: invalid y coordinate");
      const isXOdd = (x & _1n11) === _1n11;
      const isLastByteOdd = (lastByte & 128) !== 0;
      if (!zip215 && x === _0n11 && isLastByteOdd)
        throw new Error("bad point: x=0 and x_0=1");
      if (isLastByteOdd !== isXOdd)
        x = modP(-x);
      return Point.fromAffine({ x, y });
    }
    static fromHex(bytes, zip215 = false) {
      return Point.fromBytes(ensureBytes("point", bytes), zip215);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    precompute(windowSize = 8, isLazy = true) {
      wnaf.createCache(this, windowSize);
      if (!isLazy)
        this.multiply(_2n7);
      return this;
    }
    // Useful in fromAffine() - not for fromBytes(), which always created valid points.
    assertValidity() {
      assertValidMemo(this);
    }
    // Compare one point to another.
    equals(other) {
      aextpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const X1Z2 = modP(X1 * Z2);
      const X2Z1 = modP(X2 * Z1);
      const Y1Z2 = modP(Y1 * Z2);
      const Y2Z1 = modP(Y2 * Z1);
      return X1Z2 === X2Z1 && Y1Z2 === Y2Z1;
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    negate() {
      return new Point(modP(-this.X), this.Y, this.Z, modP(-this.T));
    }
    // Fast algo for doubling Extended Point.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#doubling-dbl-2008-hwcd
    // Cost: 4M + 4S + 1*a + 6add + 1*2.
    double() {
      const { a } = CURVE;
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const A = modP(X1 * X1);
      const B = modP(Y1 * Y1);
      const C = modP(_2n7 * modP(Z1 * Z1));
      const D = modP(a * A);
      const x1y1 = X1 + Y1;
      const E = modP(modP(x1y1 * x1y1) - A - B);
      const G = D + B;
      const F = G - C;
      const H = D - B;
      const X3 = modP(E * F);
      const Y3 = modP(G * H);
      const T3 = modP(E * H);
      const Z3 = modP(F * G);
      return new Point(X3, Y3, Z3, T3);
    }
    // Fast algo for adding 2 Extended Points.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#addition-add-2008-hwcd
    // Cost: 9M + 1*a + 1*d + 7add.
    add(other) {
      aextpoint(other);
      const { a, d } = CURVE;
      const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
      const { X: X2, Y: Y2, Z: Z2, T: T2 } = other;
      const A = modP(X1 * X2);
      const B = modP(Y1 * Y2);
      const C = modP(T1 * d * T2);
      const D = modP(Z1 * Z2);
      const E = modP((X1 + Y1) * (X2 + Y2) - A - B);
      const F = D - C;
      const G = D + C;
      const H = modP(B - a * A);
      const X3 = modP(E * F);
      const Y3 = modP(G * H);
      const T3 = modP(E * H);
      const Z3 = modP(F * G);
      return new Point(X3, Y3, Z3, T3);
    }
    subtract(other) {
      return this.add(other.negate());
    }
    // Constant-time multiplication.
    multiply(scalar) {
      if (!Fn2.isValidNot0(scalar))
        throw new Error("invalid scalar: expected 1 <= sc < curve.n");
      const { p, f } = wnaf.cached(this, scalar, (p2) => normalizeZ2(Point, p2));
      return normalizeZ2(Point, [p, f])[0];
    }
    // Non-constant-time multiplication. Uses double-and-add algorithm.
    // It's faster, but should only be used when you don't care about
    // an exposed private key e.g. sig verification.
    // Does NOT allow scalars higher than CURVE.n.
    // Accepts optional accumulator to merge with multiply (important for sparse scalars)
    multiplyUnsafe(scalar, acc = Point.ZERO) {
      if (!Fn2.isValid(scalar))
        throw new Error("invalid scalar: expected 0 <= sc < curve.n");
      if (scalar === _0n11)
        return Point.ZERO;
      if (this.is0() || scalar === _1n11)
        return this;
      return wnaf.unsafe(this, scalar, (p) => normalizeZ2(Point, p), acc);
    }
    // Checks if point is of small order.
    // If you add something to small order point, you will have "dirty"
    // point with torsion component.
    // Multiplies point by cofactor and checks if the result is 0.
    isSmallOrder() {
      return this.multiplyUnsafe(cofactor).is0();
    }
    // Multiplies point by curve order and checks if the result is 0.
    // Returns `false` is the point is dirty.
    isTorsionFree() {
      return wnaf.unsafe(this, CURVE.n).is0();
    }
    // Converts Extended point to default (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    toAffine(invertedZ) {
      return toAffineMemo(this, invertedZ);
    }
    clearCofactor() {
      if (cofactor === _1n11)
        return this;
      return this.multiplyUnsafe(cofactor);
    }
    toBytes() {
      const { x, y } = this.toAffine();
      const bytes = Fp2.toBytes(y);
      bytes[bytes.length - 1] |= x & _1n11 ? 128 : 0;
      return bytes;
    }
    toHex() {
      return bytesToHex5(this.toBytes());
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
    // TODO: remove
    get ex() {
      return this.X;
    }
    get ey() {
      return this.Y;
    }
    get ez() {
      return this.Z;
    }
    get et() {
      return this.T;
    }
    static normalizeZ(points) {
      return normalizeZ2(Point, points);
    }
    static msm(points, scalars) {
      return pippenger(Point, Fn2, points, scalars);
    }
    _setWindowSize(windowSize) {
      this.precompute(windowSize);
    }
    toRawBytes() {
      return this.toBytes();
    }
  }
  Point.BASE = new Point(CURVE.Gx, CURVE.Gy, _1n11, modP(CURVE.Gx * CURVE.Gy));
  Point.ZERO = new Point(_0n11, _1n11, _1n11, _0n11);
  Point.Fp = Fp2;
  Point.Fn = Fn2;
  const wnaf = new wNAF(Point, Fn2.BITS);
  Point.BASE.precompute(8);
  return Point;
}
function eddsa2(Point, cHash, eddsaOpts = {}) {
  if (typeof cHash !== "function")
    throw new Error('"hash" function param is required');
  _validateObject(eddsaOpts, {}, {
    adjustScalarBytes: "function",
    randomBytes: "function",
    domain: "function",
    prehash: "function",
    mapToCurve: "function"
  });
  const { prehash } = eddsaOpts;
  const { BASE, Fp: Fp2, Fn: Fn2 } = Point;
  const randomBytes4 = eddsaOpts.randomBytes || randomBytes3;
  const adjustScalarBytes3 = eddsaOpts.adjustScalarBytes || ((bytes) => bytes);
  const domain = eddsaOpts.domain || ((data, ctx, phflag) => {
    _abool2(phflag, "phflag");
    if (ctx.length || phflag)
      throw new Error("Contexts/pre-hash are not supported");
    return data;
  });
  function modN_LE(hash) {
    return Fn2.create(bytesToNumberLE2(hash));
  }
  function getPrivateScalar(key) {
    const len = lengths.secretKey;
    key = ensureBytes("private key", key, len);
    const hashed = ensureBytes("hashed private key", cHash(key), 2 * len);
    const head = adjustScalarBytes3(hashed.slice(0, len));
    const prefix = hashed.slice(len, 2 * len);
    const scalar = modN_LE(head);
    return { head, prefix, scalar };
  }
  function getExtendedPublicKey(secretKey) {
    const { head, prefix, scalar } = getPrivateScalar(secretKey);
    const point = BASE.multiply(scalar);
    const pointBytes = point.toBytes();
    return { head, prefix, scalar, point, pointBytes };
  }
  function getPublicKey(secretKey) {
    return getExtendedPublicKey(secretKey).pointBytes;
  }
  function hashDomainToScalar(context = Uint8Array.of(), ...msgs) {
    const msg = concatBytes4(...msgs);
    return modN_LE(cHash(domain(msg, ensureBytes("context", context), !!prehash)));
  }
  function sign(msg, secretKey, options = {}) {
    msg = ensureBytes("message", msg);
    if (prehash)
      msg = prehash(msg);
    const { prefix, scalar, pointBytes } = getExtendedPublicKey(secretKey);
    const r = hashDomainToScalar(options.context, prefix, msg);
    const R = BASE.multiply(r).toBytes();
    const k = hashDomainToScalar(options.context, R, pointBytes, msg);
    const s = Fn2.create(r + k * scalar);
    if (!Fn2.isValid(s))
      throw new Error("sign failed: invalid s");
    const rs = concatBytes4(R, Fn2.toBytes(s));
    return _abytes2(rs, lengths.signature, "result");
  }
  const verifyOpts = { zip215: true };
  function verify(sig, msg, publicKey, options = verifyOpts) {
    const { context, zip215 } = options;
    const len = lengths.signature;
    sig = ensureBytes("signature", sig, len);
    msg = ensureBytes("message", msg);
    publicKey = ensureBytes("publicKey", publicKey, lengths.publicKey);
    if (zip215 !== void 0)
      _abool2(zip215, "zip215");
    if (prehash)
      msg = prehash(msg);
    const mid = len / 2;
    const r = sig.subarray(0, mid);
    const s = bytesToNumberLE2(sig.subarray(mid, len));
    let A, R, SB;
    try {
      A = Point.fromBytes(publicKey, zip215);
      R = Point.fromBytes(r, zip215);
      SB = BASE.multiplyUnsafe(s);
    } catch (error) {
      return false;
    }
    if (!zip215 && A.isSmallOrder())
      return false;
    const k = hashDomainToScalar(context, R.toBytes(), A.toBytes(), msg);
    const RkA = R.add(A.multiplyUnsafe(k));
    return RkA.subtract(SB).clearCofactor().is0();
  }
  const _size = Fp2.BYTES;
  const lengths = {
    secretKey: _size,
    publicKey: _size,
    signature: 2 * _size,
    seed: _size
  };
  function randomSecretKey(seed = randomBytes4(lengths.seed)) {
    return _abytes2(seed, lengths.seed, "seed");
  }
  function keygen(seed) {
    const secretKey = utils.randomSecretKey(seed);
    return { secretKey, publicKey: getPublicKey(secretKey) };
  }
  function isValidSecretKey(key) {
    return isBytes4(key) && key.length === Fn2.BYTES;
  }
  function isValidPublicKey(key, zip215) {
    try {
      return !!Point.fromBytes(key, zip215);
    } catch (error) {
      return false;
    }
  }
  const utils = {
    getExtendedPublicKey,
    randomSecretKey,
    isValidSecretKey,
    isValidPublicKey,
    /**
     * Converts ed public key to x public key. Uses formula:
     * - ed25519:
     *   - `(u, v) = ((1+y)/(1-y), sqrt(-486664)*u/x)`
     *   - `(x, y) = (sqrt(-486664)*u/v, (u-1)/(u+1))`
     * - ed448:
     *   - `(u, v) = ((y-1)/(y+1), sqrt(156324)*u/x)`
     *   - `(x, y) = (sqrt(156324)*u/v, (1+u)/(1-u))`
     */
    toMontgomery(publicKey) {
      const { y } = Point.fromBytes(publicKey);
      const size = lengths.publicKey;
      const is25519 = size === 32;
      if (!is25519 && size !== 57)
        throw new Error("only defined for 25519 and 448");
      const u = is25519 ? Fp2.div(_1n11 + y, _1n11 - y) : Fp2.div(y - _1n11, y + _1n11);
      return Fp2.toBytes(u);
    },
    toMontgomerySecret(secretKey) {
      const size = lengths.secretKey;
      _abytes2(secretKey, size);
      const hashed = cHash(secretKey.subarray(0, size));
      return adjustScalarBytes3(hashed).subarray(0, size);
    },
    /** @deprecated */
    randomPrivateKey: randomSecretKey,
    /** @deprecated */
    precompute(windowSize = 8, point = Point.BASE) {
      return point.precompute(windowSize, false);
    }
  };
  return Object.freeze({
    keygen,
    getPublicKey,
    sign,
    verify,
    utils,
    Point,
    lengths
  });
}
function _eddsa_legacy_opts_to_new(c) {
  const CURVE = {
    a: c.a,
    d: c.d,
    p: c.Fp.ORDER,
    n: c.n,
    h: c.h,
    Gx: c.Gx,
    Gy: c.Gy
  };
  const Fp2 = c.Fp;
  const Fn2 = Field2(CURVE.n, c.nBitLength, true);
  const curveOpts = { Fp: Fp2, Fn: Fn2, uvRatio: c.uvRatio };
  const eddsaOpts = {
    randomBytes: c.randomBytes,
    adjustScalarBytes: c.adjustScalarBytes,
    domain: c.domain,
    prehash: c.prehash,
    mapToCurve: c.mapToCurve
  };
  return { CURVE, curveOpts, hash: c.hash, eddsaOpts };
}
function _eddsa_new_output_to_legacy(c, eddsa3) {
  const Point = eddsa3.Point;
  const legacy = Object.assign({}, eddsa3, {
    ExtendedPoint: Point,
    CURVE: c,
    nBitLength: Point.Fn.BITS,
    nByteLength: Point.Fn.BYTES
  });
  return legacy;
}
function twistedEdwards(c) {
  const { CURVE, curveOpts, hash, eddsaOpts } = _eddsa_legacy_opts_to_new(c);
  const Point = edwards2(CURVE, curveOpts);
  const EDDSA = eddsa2(Point, hash, eddsaOpts);
  return _eddsa_new_output_to_legacy(c, EDDSA);
}
var _0n11, _1n11, _2n7, _8n5, PrimeEdwardsPoint2;
var init_edwards = __esm({
  "node_modules/@freedomofpress/crypto-browser/node_modules/@noble/curves/esm/abstract/edwards.js"() {
    init_utils3();
    init_curve();
    init_modular();
    _0n11 = BigInt(0);
    _1n11 = BigInt(1);
    _2n7 = BigInt(2);
    _8n5 = BigInt(8);
    PrimeEdwardsPoint2 = class {
      constructor(ep) {
        this.ep = ep;
      }
      // Static methods that must be implemented by subclasses
      static fromBytes(_bytes) {
        notImplemented2();
      }
      static fromHex(_hex) {
        notImplemented2();
      }
      get x() {
        return this.toAffine().x;
      }
      get y() {
        return this.toAffine().y;
      }
      // Common implementations
      clearCofactor() {
        return this;
      }
      assertValidity() {
        this.ep.assertValidity();
      }
      toAffine(invertedZ) {
        return this.ep.toAffine(invertedZ);
      }
      toHex() {
        return bytesToHex5(this.toBytes());
      }
      toString() {
        return this.toHex();
      }
      isTorsionFree() {
        return true;
      }
      isSmallOrder() {
        return false;
      }
      add(other) {
        this.assertSame(other);
        return this.init(this.ep.add(other.ep));
      }
      subtract(other) {
        this.assertSame(other);
        return this.init(this.ep.subtract(other.ep));
      }
      multiply(scalar) {
        return this.init(this.ep.multiply(scalar));
      }
      multiplyUnsafe(scalar) {
        return this.init(this.ep.multiplyUnsafe(scalar));
      }
      double() {
        return this.init(this.ep.double());
      }
      negate() {
        return this.init(this.ep.negate());
      }
      precompute(windowSize, isLazy) {
        return this.init(this.ep.precompute(windowSize, isLazy));
      }
      /** @deprecated use `toBytes` */
      toRawBytes() {
        return this.toBytes();
      }
    };
  }
});

// node_modules/@freedomofpress/crypto-browser/node_modules/@noble/curves/esm/ed25519.js
function ed25519_pow_2_252_32(x) {
  const _10n = BigInt(10), _20n = BigInt(20), _40n = BigInt(40), _80n = BigInt(80);
  const P = ed25519_CURVE_p2;
  const x2 = x * x % P;
  const b2 = x2 * x % P;
  const b4 = pow22(b2, _2n8, P) * b2 % P;
  const b5 = pow22(b4, _1n12, P) * x % P;
  const b10 = pow22(b5, _5n4, P) * b5 % P;
  const b20 = pow22(b10, _10n, P) * b10 % P;
  const b40 = pow22(b20, _20n, P) * b20 % P;
  const b80 = pow22(b40, _40n, P) * b40 % P;
  const b160 = pow22(b80, _80n, P) * b80 % P;
  const b240 = pow22(b160, _80n, P) * b80 % P;
  const b250 = pow22(b240, _10n, P) * b10 % P;
  const pow_p_5_8 = pow22(b250, _2n8, P) * x % P;
  return { pow_p_5_8, b2 };
}
function adjustScalarBytes2(bytes) {
  bytes[0] &= 248;
  bytes[31] &= 127;
  bytes[31] |= 64;
  return bytes;
}
function uvRatio2(u, v) {
  const P = ed25519_CURVE_p2;
  const v3 = mod2(v * v * v, P);
  const v7 = mod2(v3 * v3 * v, P);
  const pow3 = ed25519_pow_2_252_32(u * v7).pow_p_5_8;
  let x = mod2(u * v3 * pow3, P);
  const vx2 = mod2(v * x * x, P);
  const root1 = x;
  const root2 = mod2(x * ED25519_SQRT_M12, P);
  const useRoot1 = vx2 === u;
  const useRoot2 = vx2 === mod2(-u, P);
  const noRoot = vx2 === mod2(-u * ED25519_SQRT_M12, P);
  if (useRoot1)
    x = root1;
  if (useRoot2 || noRoot)
    x = root2;
  if (isNegativeLE2(x, P))
    x = mod2(-x, P);
  return { isValid: useRoot1 || useRoot2, value: x };
}
function calcElligatorRistrettoMap(r0) {
  const { d } = ed25519_CURVE2;
  const P = ed25519_CURVE_p2;
  const mod3 = (n) => Fp.create(n);
  const r = mod3(SQRT_M1 * r0 * r0);
  const Ns = mod3((r + _1n12) * ONE_MINUS_D_SQ);
  let c = BigInt(-1);
  const D = mod3((c - d * r) * mod3(r + d));
  let { isValid: Ns_D_is_sq, value: s } = uvRatio2(Ns, D);
  let s_ = mod3(s * r0);
  if (!isNegativeLE2(s_, P))
    s_ = mod3(-s_);
  if (!Ns_D_is_sq)
    s = s_;
  if (!Ns_D_is_sq)
    c = r;
  const Nt = mod3(c * (r - _1n12) * D_MINUS_ONE_SQ - D);
  const s2 = s * s;
  const W0 = mod3((s + s) * D);
  const W1 = mod3(Nt * SQRT_AD_MINUS_ONE);
  const W2 = mod3(_1n12 - s2);
  const W3 = mod3(_1n12 + s2);
  return new ed25519.Point(mod3(W0 * W3), mod3(W2 * W1), mod3(W1 * W3), mod3(W0 * W2));
}
function ristretto255_map(bytes) {
  abytes4(bytes, 64);
  const r1 = bytes255ToNumberLE(bytes.subarray(0, 32));
  const R1 = calcElligatorRistrettoMap(r1);
  const r2 = bytes255ToNumberLE(bytes.subarray(32, 64));
  const R2 = calcElligatorRistrettoMap(r2);
  return new _RistrettoPoint(R1.add(R2));
}
var _0n12, _1n12, _2n8, _3n5, _5n4, _8n6, ed25519_CURVE_p2, ed25519_CURVE2, ED25519_SQRT_M12, Fp, Fn, ed25519Defaults, ed25519, SQRT_M1, SQRT_AD_MINUS_ONE, INVSQRT_A_MINUS_D, ONE_MINUS_D_SQ, D_MINUS_ONE_SQ, invertSqrt, MAX_255B, bytes255ToNumberLE, _RistrettoPoint;
var init_ed25519 = __esm({
  "node_modules/@freedomofpress/crypto-browser/node_modules/@noble/curves/esm/ed25519.js"() {
    init_sha2();
    init_utils2();
    init_curve();
    init_edwards();
    init_modular();
    init_utils3();
    _0n12 = /* @__PURE__ */ BigInt(0);
    _1n12 = BigInt(1);
    _2n8 = BigInt(2);
    _3n5 = BigInt(3);
    _5n4 = BigInt(5);
    _8n6 = BigInt(8);
    ed25519_CURVE_p2 = BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed");
    ed25519_CURVE2 = /* @__PURE__ */ (() => ({
      p: ed25519_CURVE_p2,
      n: BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed"),
      h: _8n6,
      a: BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffec"),
      d: BigInt("0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3"),
      Gx: BigInt("0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a"),
      Gy: BigInt("0x6666666666666666666666666666666666666666666666666666666666666658")
    }))();
    ED25519_SQRT_M12 = /* @__PURE__ */ BigInt("19681161376707505956807079304988542015446066515923890162744021073123829784752");
    Fp = /* @__PURE__ */ (() => Field2(ed25519_CURVE2.p, { isLE: true }))();
    Fn = /* @__PURE__ */ (() => Field2(ed25519_CURVE2.n, { isLE: true }))();
    ed25519Defaults = /* @__PURE__ */ (() => ({
      ...ed25519_CURVE2,
      Fp,
      hash: sha5122,
      adjustScalarBytes: adjustScalarBytes2,
      // dom2
      // Ratio of u to v. Allows us to combine inversion and square root. Uses algo from RFC8032 5.1.3.
      // Constant-time, u/√v
      uvRatio: uvRatio2
    }))();
    ed25519 = /* @__PURE__ */ (() => twistedEdwards(ed25519Defaults))();
    SQRT_M1 = ED25519_SQRT_M12;
    SQRT_AD_MINUS_ONE = /* @__PURE__ */ BigInt("25063068953384623474111414158702152701244531502492656460079210482610430750235");
    INVSQRT_A_MINUS_D = /* @__PURE__ */ BigInt("54469307008909316920995813868745141605393597292927456921205312896311721017578");
    ONE_MINUS_D_SQ = /* @__PURE__ */ BigInt("1159843021668779879193775521855586647937357759715417654439879720876111806838");
    D_MINUS_ONE_SQ = /* @__PURE__ */ BigInt("40440834346308536858101042469323190826248399146238708352240133220865137265952");
    invertSqrt = (number) => uvRatio2(_1n12, number);
    MAX_255B = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    bytes255ToNumberLE = (bytes) => ed25519.Point.Fp.create(bytesToNumberLE2(bytes) & MAX_255B);
    _RistrettoPoint = class __RistrettoPoint extends PrimeEdwardsPoint2 {
      constructor(ep) {
        super(ep);
      }
      static fromAffine(ap) {
        return new __RistrettoPoint(ed25519.Point.fromAffine(ap));
      }
      assertSame(other) {
        if (!(other instanceof __RistrettoPoint))
          throw new Error("RistrettoPoint expected");
      }
      init(ep) {
        return new __RistrettoPoint(ep);
      }
      /** @deprecated use `import { ristretto255_hasher } from '@noble/curves/ed25519.js';` */
      static hashToCurve(hex) {
        return ristretto255_map(ensureBytes("ristrettoHash", hex, 64));
      }
      static fromBytes(bytes) {
        abytes4(bytes, 32);
        const { a, d } = ed25519_CURVE2;
        const P = ed25519_CURVE_p2;
        const mod3 = (n) => Fp.create(n);
        const s = bytes255ToNumberLE(bytes);
        if (!equalBytes2(Fp.toBytes(s), bytes) || isNegativeLE2(s, P))
          throw new Error("invalid ristretto255 encoding 1");
        const s2 = mod3(s * s);
        const u1 = mod3(_1n12 + a * s2);
        const u2 = mod3(_1n12 - a * s2);
        const u1_2 = mod3(u1 * u1);
        const u2_2 = mod3(u2 * u2);
        const v = mod3(a * d * u1_2 - u2_2);
        const { isValid, value: I } = invertSqrt(mod3(v * u2_2));
        const Dx = mod3(I * u2);
        const Dy = mod3(I * Dx * v);
        let x = mod3((s + s) * Dx);
        if (isNegativeLE2(x, P))
          x = mod3(-x);
        const y = mod3(u1 * Dy);
        const t = mod3(x * y);
        if (!isValid || isNegativeLE2(t, P) || y === _0n12)
          throw new Error("invalid ristretto255 encoding 2");
        return new __RistrettoPoint(new ed25519.Point(x, y, _1n12, t));
      }
      /**
       * Converts ristretto-encoded string to ristretto point.
       * Described in [RFC9496](https://www.rfc-editor.org/rfc/rfc9496#name-decode).
       * @param hex Ristretto-encoded 32 bytes. Not every 32-byte string is valid ristretto encoding
       */
      static fromHex(hex) {
        return __RistrettoPoint.fromBytes(ensureBytes("ristrettoHex", hex, 32));
      }
      static msm(points, scalars) {
        return pippenger(__RistrettoPoint, ed25519.Point.Fn, points, scalars);
      }
      /**
       * Encodes ristretto point to Uint8Array.
       * Described in [RFC9496](https://www.rfc-editor.org/rfc/rfc9496#name-encode).
       */
      toBytes() {
        let { X, Y, Z, T } = this.ep;
        const P = ed25519_CURVE_p2;
        const mod3 = (n) => Fp.create(n);
        const u1 = mod3(mod3(Z + Y) * mod3(Z - Y));
        const u2 = mod3(X * Y);
        const u2sq = mod3(u2 * u2);
        const { value: invsqrt } = invertSqrt(mod3(u1 * u2sq));
        const D1 = mod3(invsqrt * u1);
        const D2 = mod3(invsqrt * u2);
        const zInv = mod3(D1 * D2 * T);
        let D;
        if (isNegativeLE2(T * zInv, P)) {
          let _x = mod3(Y * SQRT_M1);
          let _y = mod3(X * SQRT_M1);
          X = _x;
          Y = _y;
          D = mod3(D1 * INVSQRT_A_MINUS_D);
        } else {
          D = D2;
        }
        if (isNegativeLE2(X * zInv, P))
          Y = mod3(-Y);
        let s = mod3((Z - Y) * D);
        if (isNegativeLE2(s, P))
          s = mod3(-s);
        return Fp.toBytes(s);
      }
      /**
       * Compares two Ristretto points.
       * Described in [RFC9496](https://www.rfc-editor.org/rfc/rfc9496#name-equals).
       */
      equals(other) {
        this.assertSame(other);
        const { X: X1, Y: Y1 } = this.ep;
        const { X: X2, Y: Y2 } = other.ep;
        const mod3 = (n) => Fp.create(n);
        const one = mod3(X1 * Y2) === mod3(Y1 * X2);
        const two = mod3(Y1 * Y2) === mod3(X1 * X2);
        return one || two;
      }
      is0() {
        return this.equals(__RistrettoPoint.ZERO);
      }
    };
    _RistrettoPoint.BASE = /* @__PURE__ */ (() => new _RistrettoPoint(ed25519.Point.BASE))();
    _RistrettoPoint.ZERO = /* @__PURE__ */ (() => new _RistrettoPoint(ed25519.Point.ZERO))();
    _RistrettoPoint.Fp = /* @__PURE__ */ (() => Fp)();
    _RistrettoPoint.Fn = /* @__PURE__ */ (() => Fn)();
  }
});

// node_modules/@freedomofpress/crypto-browser/dist/crypto.js
function getSubtle() {
  if (!subtlePromise) {
    subtlePromise = subtleCryptoProxy();
  }
  return subtlePromise;
}
function isFallbackKey(key) {
  return typeof key === "object" && key !== null && key.__fallback__ === true;
}
function toUint8(data) {
  return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
async function isEd25519Available() {
  try {
    await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    return true;
  } catch {
    return false;
  }
}
async function subtleCryptoProxy() {
  return await isEd25519Available() ? crypto.subtle : withEd25519Fallback(crypto.subtle);
}
function ed25519KeyBytes(format, keyData, isPrivate) {
  let bytes;
  let prefix = [];
  if (format === "jwk") {
    const jwk = keyData;
    const field = isPrivate ? jwk.d : jwk.x;
    if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !field) {
      throw new DOMException("Invalid Ed25519 JWK", "DataError");
    }
    bytes = base64UrlToUint8Array(field);
  } else {
    bytes = toUint8(keyData);
    prefix = format === "spki" ? ED25519_SPKI_PREFIX : format === "pkcs8" ? ED25519_PKCS8_PREFIX : [];
  }
  if (bytes.length !== prefix.length + 32 || !prefix.every((b, i) => bytes[i] === b)) {
    throw new DOMException(`Invalid Ed25519 ${format} key`, "DataError");
  }
  return bytes.slice(prefix.length);
}
function withEd25519Fallback(subtle) {
  return new Proxy(subtle, {
    get(target, prop) {
      if (prop === "importKey") {
        return async function(format, keyData, algorithm, extractable, usages) {
          if (algorithm?.name === "Ed25519") {
            const type = usages.includes("sign") ? "private" : "public";
            return {
              __fallback__: true,
              algorithm: { name: "Ed25519" },
              type,
              bytes: ed25519KeyBytes(format, keyData, type === "private")
            };
          }
          return format === "jwk" ? target.importKey("jwk", keyData, algorithm, extractable, usages) : target.importKey(format, keyData, algorithm, extractable, usages);
        };
      }
      if (prop === "sign") {
        return async function(algorithm, key, data) {
          if (algorithm?.name === "Ed25519" && isFallbackKey(key)) {
            if (key.type !== "private") {
              throw new DOMException("Invalid key type for signing", "InvalidAccessError");
            }
            return ed25519.sign(toUint8(data), key.bytes).buffer;
          }
          return target.sign(algorithm, key, data);
        };
      }
      if (prop === "verify") {
        return async function(algorithm, key, signature, data) {
          if (algorithm?.name === "Ed25519" && isFallbackKey(key)) {
            if (key.type !== "public") {
              throw new DOMException("Invalid key type for verify", "InvalidAccessError");
            }
            try {
              return ed25519.verify(toUint8(signature), toUint8(data), key.bytes);
            } catch {
              return false;
            }
          }
          return target.verify(algorithm, key, signature, data);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
function pkcs1ToSpki(pkcs1Bytes) {
  const algorithmIdentifier = new Uint8Array([
    48,
    13,
    6,
    9,
    42,
    134,
    72,
    134,
    247,
    13,
    1,
    1,
    1,
    5,
    0
  ]);
  const bitStringLength = pkcs1Bytes.length + 1;
  const totalContentLength = algorithmIdentifier.length + 1 + lengthBytes(bitStringLength).length + bitStringLength;
  const result = new Uint8Array(1 + lengthBytes(totalContentLength).length + totalContentLength);
  let offset = 0;
  result[offset++] = 48;
  const totalLengthBytes = lengthBytes(totalContentLength);
  result.set(totalLengthBytes, offset);
  offset += totalLengthBytes.length;
  result.set(algorithmIdentifier, offset);
  offset += algorithmIdentifier.length;
  result[offset++] = 3;
  const bitStringLengthBytes = lengthBytes(bitStringLength);
  result.set(bitStringLengthBytes, offset);
  offset += bitStringLengthBytes.length;
  result[offset++] = 0;
  result.set(pkcs1Bytes, offset);
  return result;
}
function lengthBytes(length) {
  if (length < 128) {
    return new Uint8Array([length]);
  } else if (length < 256) {
    return new Uint8Array([129, length]);
  } else {
    return new Uint8Array([130, length >> 8 & 255, length & 255]);
  }
}
async function importKey(keytype, scheme, key) {
  class importParams {
    constructor() {
      this.format = "spki";
      this.keyData = new Uint8Array(0);
      this.algorithm = { name: KeyTypes.Ecdsa };
      this.extractable = true;
      this.usage = ["verify"];
    }
  }
  const params = new importParams();
  if (key.includes("BEGIN")) {
    params.format = "spki";
    params.keyData = toDER(key);
  } else if (/^[0-9A-Fa-f]+$/.test(key)) {
    params.format = "raw";
    params.keyData = hexToUint8Array(key);
  } else {
    params.format = "spki";
    const keyBytes = base64ToUint8Array(key);
    if (keytype.toLowerCase().includes("pkcs1") && keyBytes[0] === 48 && keyBytes[1] === 130 && keyBytes[4] === 2 && keyBytes[5] === 130) {
      params.keyData = pkcs1ToSpki(keyBytes);
    } else {
      params.keyData = keyBytes;
    }
  }
  if (keytype.toLowerCase().includes("ecdsa")) {
    if (scheme.includes("256")) {
      params.algorithm = { name: KeyTypes.Ecdsa, namedCurve: EcdsaTypes.P256 };
    } else if (scheme.includes("384")) {
      params.algorithm = { name: KeyTypes.Ecdsa, namedCurve: EcdsaTypes.P384 };
    } else if (scheme.includes("521")) {
      params.algorithm = { name: KeyTypes.Ecdsa, namedCurve: EcdsaTypes.P521 };
    } else {
      throw new Error("Cannot determine ECDSA key size.");
    }
  } else if (keytype.toLowerCase().includes("ed25519")) {
    params.algorithm = { name: KeyTypes.Ed25519 };
  } else if (keytype.toLowerCase().includes("rsa") || keytype.toLowerCase().includes("pkcs1")) {
    let hashName = HashAlgorithms.SHA256;
    const normalizedScheme = scheme.toUpperCase().replace(/[-_]/g, "");
    if (normalizedScheme.includes("SHA256") || normalizedScheme.includes("256")) {
      hashName = HashAlgorithms.SHA256;
    } else if (normalizedScheme.includes("SHA384") || normalizedScheme.includes("384")) {
      hashName = HashAlgorithms.SHA384;
    } else if (normalizedScheme.includes("SHA512") || normalizedScheme.includes("512")) {
      hashName = HashAlgorithms.SHA512;
    }
    if (normalizedScheme.includes(RsaSchemes.PKCS1) || normalizedScheme.includes(RsaSchemes.RSAPKCS1)) {
      params.algorithm = {
        name: RsaAlgorithms.PKCS1v15,
        hash: { name: hashName }
      };
    } else {
      params.algorithm = {
        name: RsaAlgorithms.PSS,
        hash: { name: hashName }
      };
    }
  } else {
    throw new Error(`Unsupported ${keytype}`);
  }
  const subtle = await getSubtle();
  return await subtle.importKey(params.format, params.keyData, params.algorithm, params.extractable, params.usage);
}
async function verifySignature(key, signed, sig, hash = "sha256") {
  const subtle = await getSubtle();
  const options = {
    name: key.algorithm.name
  };
  if (key.algorithm.name === KeyTypes.Ecdsa) {
    const namedCurve = key.algorithm.namedCurve;
    let sig_size = 32;
    if (namedCurve === EcdsaTypes.P256) {
      sig_size = 32;
    } else if (namedCurve === EcdsaTypes.P384) {
      sig_size = 48;
    } else if (namedCurve === EcdsaTypes.P521) {
      sig_size = 66;
    }
    options.hash = { name: "" };
    if (hash.includes("256")) {
      options.hash.name = HashAlgorithms.SHA256;
    } else if (hash.includes("384")) {
      options.hash.name = HashAlgorithms.SHA384;
    } else if (hash.includes("512")) {
      options.hash.name = HashAlgorithms.SHA512;
    } else {
      throw new Error("Cannot determine hashing algorithm;");
    }
    let raw_signature;
    try {
      const asn1_sig = ASN1Obj.parseBuffer(sig);
      if (asn1_sig.subs.length !== 2) {
        return false;
      }
      const r = asn1_sig.subs[0].toInteger();
      const s = asn1_sig.subs[1].toInteger();
      const limit = 1n << BigInt(sig_size * 8);
      if (r <= 0n || s <= 0n || r >= limit || s >= limit) {
        return false;
      }
      raw_signature = new Uint8Array(sig_size * 2);
      raw_signature.set(hexToUint8Array(r.toString(16).padStart(sig_size * 2, "0")), 0);
      raw_signature.set(hexToUint8Array(s.toString(16).padStart(sig_size * 2, "0")), sig_size);
    } catch {
      return false;
    }
    return await subtle.verify(options, key, raw_signature, signed);
  } else if (key.algorithm.name === KeyTypes.Ed25519) {
    return await subtle.verify({ name: key.algorithm.name }, key, sig, signed);
  } else if (key.algorithm.name === RsaAlgorithms.PSS) {
    const hashAlg = key.algorithm.hash.name;
    const saltLength = hashAlg === HashAlgorithms.SHA256 ? 32 : hashAlg === HashAlgorithms.SHA384 ? 48 : hashAlg === HashAlgorithms.SHA512 ? 64 : 32;
    return await subtle.verify({
      name: RsaAlgorithms.PSS,
      saltLength
    }, key, sig, signed);
  } else if (key.algorithm.name === RsaAlgorithms.PKCS1v15) {
    return await subtle.verify({ name: key.algorithm.name }, key, sig, signed);
  } else {
    throw new Error("Unsupported key type!");
  }
}
async function verifySignatureOverDigest(key, digest, sig) {
  const subtle = await getSubtle();
  if (key.algorithm.name !== KeyTypes.Ecdsa) {
    throw new Error("verifySignatureOverDigest only supports ECDSA keys");
  }
  const namedCurve = key.algorithm.namedCurve;
  let curve;
  if (namedCurve === EcdsaTypes.P256) {
    curve = p256;
  } else if (namedCurve === EcdsaTypes.P384) {
    curve = p384;
  } else if (namedCurve === EcdsaTypes.P521) {
    curve = p521;
  } else {
    throw new Error(`Unsupported curve: ${namedCurve}`);
  }
  const jwk = await subtle.exportKey("jwk", key);
  if (!jwk.x || !jwk.y) {
    throw new Error("Invalid ECDSA public key: missing x or y coordinates");
  }
  const x = base64UrlToUint8Array(jwk.x);
  const y = base64UrlToUint8Array(jwk.y);
  const publicKey = new Uint8Array(1 + x.length + y.length);
  publicKey[0] = 4;
  publicKey.set(x, 1);
  publicKey.set(y, 1 + x.length);
  return curve.verify(sig, digest, publicKey, { format: "der", prehash: false, lowS: false });
}
var subtlePromise, ED25519_SPKI_PREFIX, ED25519_PKCS8_PREFIX;
var init_crypto2 = __esm({
  "node_modules/@freedomofpress/crypto-browser/dist/crypto.js"() {
    init_asn1();
    init_encoding();
    init_interfaces();
    init_pem();
    init_nist();
    init_ed25519();
    subtlePromise = null;
    ED25519_SPKI_PREFIX = [48, 42, 48, 5, 6, 3, 43, 101, 112, 3, 33, 0];
    ED25519_PKCS8_PREFIX = [48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32];
  }
});

// node_modules/@freedomofpress/crypto-browser/dist/index.js
var init_dist = __esm({
  "node_modules/@freedomofpress/crypto-browser/dist/index.js"() {
    init_error();
    init_tag();
    init_length();
    init_parse();
    init_obj();
    init_stream();
    init_encoding();
    init_pem();
    init_canonicalize();
    init_crypto2();
    init_interfaces();
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/interfaces.js
function getHashAlgorithm(algorithm) {
  const hashAlg = SUPPORTED_HASH_ALGORITHMS[algorithm];
  if (!hashAlg) {
    throw new Error(`Unsupported hash algorithm: ${algorithm}`);
  }
  return hashAlg;
}
var SigstoreRoots, SUPPORTED_HASH_ALGORITHMS;
var init_interfaces2 = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/interfaces.js"() {
    init_dist();
    init_dist();
    (function(SigstoreRoots2) {
      SigstoreRoots2["certificateAuthorities"] = "certificateAuthorities";
      SigstoreRoots2["ctlogs"] = "ctlogs";
      SigstoreRoots2["timestampAuthorities"] = "timestampAuthorities";
      SigstoreRoots2["tlogs"] = "tlogs";
    })(SigstoreRoots || (SigstoreRoots = {}));
    SUPPORTED_HASH_ALGORITHMS = {
      "sha256": HashAlgorithms.SHA256,
      "sha384": HashAlgorithms.SHA384,
      "sha512": HashAlgorithms.SHA512,
      "SHA2_256": HashAlgorithms.SHA256,
      "SHA2_384": HashAlgorithms.SHA384,
      "SHA2_512": HashAlgorithms.SHA512
    };
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/oid.js
var ECDSA_SIGNATURE_ALGOS, RSA_SIGNATURE_ALGOS, OID_RSASSA_PSS, SHA2_HASH_ALGOS, DEFAULT_HASH_ALGORITHM, ECDSA_CURVE_NAMES;
var init_oid = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/oid.js"() {
    ECDSA_SIGNATURE_ALGOS = {
      "1.2.840.10045.4.3.1": "sha224",
      "1.2.840.10045.4.3.2": "sha256",
      "1.2.840.10045.4.3.3": "sha384",
      "1.2.840.10045.4.3.4": "sha512"
    };
    RSA_SIGNATURE_ALGOS = {
      "1.2.840.113549.1.1.11": "sha256",
      // sha256WithRSAEncryption
      "1.2.840.113549.1.1.12": "sha384",
      // sha384WithRSAEncryption
      "1.2.840.113549.1.1.13": "sha512",
      // sha512WithRSAEncryption
      "1.2.840.113549.1.1.5": "sha1"
      // sha1WithRSAEncryption
    };
    OID_RSASSA_PSS = "1.2.840.113549.1.1.10";
    SHA2_HASH_ALGOS = {
      "2.16.840.1.101.3.4.2.1": "sha256",
      "2.16.840.1.101.3.4.2.2": "sha384",
      "2.16.840.1.101.3.4.2.3": "sha512"
    };
    DEFAULT_HASH_ALGORITHM = "sha256";
    ECDSA_CURVE_NAMES = {
      "1.2.840.10045.3.1.7": "secp256r1",
      "1.3.132.0.34": "secp384r1",
      "1.3.132.0.35": "secp521r1"
    };
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/x509/sct.js
var SignedCertificateTimestamp;
var init_sct = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/x509/sct.js"() {
    init_dist();
    SignedCertificateTimestamp = class _SignedCertificateTimestamp {
      constructor(options) {
        this.version = options.version;
        this.logID = options.logID;
        this.timestamp = options.timestamp;
        this.extensions = options.extensions;
        this.hashAlgorithm = options.hashAlgorithm;
        this.signatureAlgorithm = options.signatureAlgorithm;
        this.signature = options.signature;
      }
      get datetime() {
        return new Date(Number(readBigInt64BE(this.timestamp)));
      }
      // Returns the hash algorithm used to generate the SCT's signature.
      // https://www.rfc-editor.org/rfc/rfc5246#section-7.4.1.4.1
      get algorithm() {
        switch (this.hashAlgorithm) {
          /* istanbul ignore next */
          case 0:
            return "none";
          /* istanbul ignore next */
          case 1:
            return "md5";
          /* istanbul ignore next */
          case 2:
            return "sha1";
          /* istanbul ignore next */
          case 3:
            return "sha224";
          case 4:
            return "sha256";
          /* istanbul ignore next */
          case 5:
            return "sha384";
          /* istanbul ignore next */
          case 6:
            return "sha512";
          /* istanbul ignore next */
          default:
            return "unknown";
        }
      }
      async verify(preCert, key) {
        const stream = new ByteStream();
        stream.appendChar(this.version);
        stream.appendChar(0);
        stream.appendView(this.timestamp);
        stream.appendUint16(1);
        stream.appendView(preCert);
        stream.appendUint16(this.extensions.byteLength);
        if (this.extensions.byteLength > 0) {
          stream.appendView(this.extensions);
        }
        return await verifySignature(key, stream.buffer, this.signature, this.algorithm);
      }
      // Parses a SignedCertificateTimestamp from a buffer. SCTs are encoded using
      // TLS encoding which means the fields and lengths of most fields are
      // specified as part of the SCT and TLS specs.
      // https://www.rfc-editor.org/rfc/rfc6962#section-3.2
      // https://www.rfc-editor.org/rfc/rfc5246#section-7.4.1.4.1
      static parse(buf) {
        const stream = new ByteStream(buf);
        const version = stream.getUint8();
        if (version !== 0) {
          throw new Error(`Unsupported SCT version: ${version} (expected 0 for v1)`);
        }
        const logID = stream.getBlock(32);
        const timestamp = stream.getBlock(8);
        const extenstionLength = stream.getUint16();
        const extensions = stream.getBlock(extenstionLength);
        const hashAlgorithm = stream.getUint8();
        const signatureAlgorithm = stream.getUint8();
        const sigLength = stream.getUint16();
        const signature = stream.getBlock(sigLength);
        if (stream.position !== buf.length) {
          throw new Error("SCT buffer length mismatch");
        }
        return new _SignedCertificateTimestamp({
          version,
          logID,
          timestamp,
          extensions,
          hashAlgorithm,
          signatureAlgorithm,
          signature
        });
      }
    };
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/x509/ext.js
var X509Extension, X509BasicConstraintsExtension, X509KeyUsageExtension, X509SubjectAlternativeNameExtension, X509AuthorityKeyIDExtension, X509SubjectKeyIDExtension, X509FulcioExtensionV1, X509FulcioExtensionV2, X509FulcioIssuerV1, X509GitHubWorkflowTriggerExtension, X509GitHubWorkflowSHAExtension, X509GitHubWorkflowNameExtension, X509GitHubWorkflowRepositoryExtension, X509GitHubWorkflowRefExtension, X509FulcioIssuerV2, X509BuildSignerURIExtension, X509BuildSignerDigestExtension, X509RunnerEnvironmentExtension, X509SourceRepositoryURIExtension, X509SourceRepositoryDigestExtension, X509SourceRepositoryRefExtension, X509SourceRepositoryIdentifierExtension, X509SourceRepositoryOwnerURIExtension, X509SourceRepositoryOwnerIdentifierExtension, X509BuildConfigURIExtension, X509BuildConfigDigestExtension, X509BuildTriggerExtension, X509RunInvocationURIExtension, X509SourceRepositoryVisibilityExtension, X509SCTExtension;
var init_ext = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/x509/ext.js"() {
    init_dist();
    init_sct();
    X509Extension = class {
      constructor(asn1) {
        this.root = asn1;
      }
      get oid() {
        return this.root.subs[0].toOID();
      }
      get critical() {
        return this.root.subs.length === 3 ? this.root.subs[1].toBoolean() : false;
      }
      get value() {
        return this.extnValueObj.value;
      }
      get valueObj() {
        return this.extnValueObj;
      }
      get extnValueObj() {
        return this.root.subs[this.root.subs.length - 1];
      }
    };
    X509BasicConstraintsExtension = class extends X509Extension {
      get isCA() {
        return this.sequence.subs[0]?.toBoolean() ?? false;
      }
      get pathLenConstraint() {
        return this.sequence.subs.length > 1 ? this.sequence.subs[1].toInteger() : void 0;
      }
      // The extnValue field contains a single sequence wrapping the isCA and
      // pathLenConstraint.
      get sequence() {
        return this.extnValueObj.subs[0];
      }
    };
    X509KeyUsageExtension = class extends X509Extension {
      get digitalSignature() {
        return this.bitString[0] === 1;
      }
      get keyCertSign() {
        return this.bitString[5] === 1;
      }
      get crlSign() {
        return this.bitString[6] === 1;
      }
      // The extnValue field contains a single bit string which is a bit mask
      // indicating which key usages are enabled.
      get bitString() {
        return this.extnValueObj.subs[0].toBitString();
      }
    };
    X509SubjectAlternativeNameExtension = class extends X509Extension {
      get rfc822Name() {
        const rfc822Name = this.findGeneralName(1)?.value;
        if (rfc822Name === void 0) {
          return void 0;
        } else {
          return Uint8ArrayToString(rfc822Name);
        }
      }
      get uri() {
        const uri = this.findGeneralName(6)?.value;
        if (uri === void 0) {
          return void 0;
        } else {
          return Uint8ArrayToString(uri);
        }
      }
      // Retrieve the value of an otherName with the given OID.
      otherName(oid) {
        const otherName = this.findGeneralName(0);
        if (otherName === void 0) {
          return void 0;
        }
        const otherNameOID = otherName.subs[0].toOID();
        if (otherNameOID !== oid) {
          return void 0;
        }
        const otherNameValue = otherName.subs[1];
        return Uint8ArrayToString(otherNameValue.subs[0].value);
      }
      findGeneralName(tag) {
        return this.generalNames.find((gn) => gn.tag.isContextSpecific(tag));
      }
      // The extnValue field contains a sequence of GeneralNames.
      get generalNames() {
        return this.extnValueObj.subs[0].subs;
      }
    };
    X509AuthorityKeyIDExtension = class extends X509Extension {
      get keyIdentifier() {
        return this.findSequenceMember(0)?.value;
      }
      findSequenceMember(tag) {
        return this.sequence.subs.find((el) => el.tag.isContextSpecific(tag));
      }
      // The extnValue field contains a single sequence wrapping the keyIdentifier
      get sequence() {
        return this.extnValueObj.subs[0];
      }
    };
    X509SubjectKeyIDExtension = class extends X509Extension {
      get keyIdentifier() {
        return this.extnValueObj.subs[0].value;
      }
    };
    X509FulcioExtensionV1 = class extends X509Extension {
      get stringValue() {
        return Uint8ArrayToString(this.extnValueObj.value);
      }
    };
    X509FulcioExtensionV2 = class extends X509Extension {
      get stringValue() {
        return Uint8ArrayToString(this.extnValueObj.subs[0].value);
      }
    };
    X509FulcioIssuerV1 = class extends X509FulcioExtensionV1 {
      get issuer() {
        return this.stringValue;
      }
    };
    X509GitHubWorkflowTriggerExtension = class extends X509FulcioExtensionV1 {
      get workflowTrigger() {
        return this.stringValue;
      }
    };
    X509GitHubWorkflowSHAExtension = class extends X509FulcioExtensionV1 {
      get workflowSHA() {
        return this.stringValue;
      }
    };
    X509GitHubWorkflowNameExtension = class extends X509FulcioExtensionV1 {
      get workflowName() {
        return this.stringValue;
      }
    };
    X509GitHubWorkflowRepositoryExtension = class extends X509FulcioExtensionV1 {
      get workflowRepository() {
        return this.stringValue;
      }
    };
    X509GitHubWorkflowRefExtension = class extends X509FulcioExtensionV1 {
      get workflowRef() {
        return this.stringValue;
      }
    };
    X509FulcioIssuerV2 = class extends X509FulcioExtensionV2 {
      get issuer() {
        return this.stringValue;
      }
    };
    X509BuildSignerURIExtension = class extends X509FulcioExtensionV2 {
      get buildSignerURI() {
        return this.stringValue;
      }
    };
    X509BuildSignerDigestExtension = class extends X509FulcioExtensionV2 {
      get buildSignerDigest() {
        return this.stringValue;
      }
    };
    X509RunnerEnvironmentExtension = class extends X509FulcioExtensionV2 {
      get runnerEnvironment() {
        return this.stringValue;
      }
    };
    X509SourceRepositoryURIExtension = class extends X509FulcioExtensionV2 {
      get sourceRepositoryURI() {
        return this.stringValue;
      }
    };
    X509SourceRepositoryDigestExtension = class extends X509FulcioExtensionV2 {
      get sourceRepositoryDigest() {
        return this.stringValue;
      }
    };
    X509SourceRepositoryRefExtension = class extends X509FulcioExtensionV2 {
      get sourceRepositoryRef() {
        return this.stringValue;
      }
    };
    X509SourceRepositoryIdentifierExtension = class extends X509FulcioExtensionV2 {
      get sourceRepositoryIdentifier() {
        return this.stringValue;
      }
    };
    X509SourceRepositoryOwnerURIExtension = class extends X509FulcioExtensionV2 {
      get sourceRepositoryOwnerURI() {
        return this.stringValue;
      }
    };
    X509SourceRepositoryOwnerIdentifierExtension = class extends X509FulcioExtensionV2 {
      get sourceRepositoryOwnerIdentifier() {
        return this.stringValue;
      }
    };
    X509BuildConfigURIExtension = class extends X509FulcioExtensionV2 {
      get buildConfigURI() {
        return this.stringValue;
      }
    };
    X509BuildConfigDigestExtension = class extends X509FulcioExtensionV2 {
      get buildConfigDigest() {
        return this.stringValue;
      }
    };
    X509BuildTriggerExtension = class extends X509FulcioExtensionV2 {
      get buildTrigger() {
        return this.stringValue;
      }
    };
    X509RunInvocationURIExtension = class extends X509FulcioExtensionV2 {
      get runInvocationURI() {
        return this.stringValue;
      }
    };
    X509SourceRepositoryVisibilityExtension = class extends X509FulcioExtensionV2 {
      get sourceRepositoryVisibility() {
        return this.stringValue;
      }
    };
    X509SCTExtension = class extends X509Extension {
      constructor(asn1) {
        super(asn1);
      }
      get signedCertificateTimestamps() {
        const buf = this.extnValueObj.subs[0].value;
        const stream = new ByteStream(buf);
        const end = stream.getUint16() + 2;
        const sctList = [];
        while (stream.position < end) {
          const sctLength = stream.getUint16();
          const sct = stream.getBlock(sctLength);
          sctList.push(SignedCertificateTimestamp.parse(sct));
        }
        if (stream.position !== end) {
          throw new Error("SCT list length does not match actual length");
        }
        return sctList;
      }
    };
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/x509/cert.js
var EXTENSION_OID_SUBJECT_KEY_ID, EXTENSION_OID_KEY_USAGE, EXTENSION_OID_SUBJECT_ALT_NAME, EXTENSION_OID_BASIC_CONSTRAINTS, EXTENSION_OID_AUTHORITY_KEY_ID, EXTENSION_OID_SCT, DN_OID_COMMON_NAME, DN_OID_COUNTRY, DN_OID_LOCALITY, DN_OID_STATE, DN_OID_ORGANIZATION, DN_OID_ORGANIZATIONAL_UNIT, DN_OID_TO_NAME, EXTENSION_OID_FULCIO_ISSUER_V1, EXTENSION_OID_GITHUB_WORKFLOW_TRIGGER, EXTENSION_OID_GITHUB_WORKFLOW_SHA, EXTENSION_OID_GITHUB_WORKFLOW_NAME, EXTENSION_OID_GITHUB_WORKFLOW_REPOSITORY, EXTENSION_OID_GITHUB_WORKFLOW_REF, EXTENSION_OID_OTHERNAME, EXTENSION_OID_FULCIO_ISSUER_V2, EXTENSION_OID_BUILD_SIGNER_URI, EXTENSION_OID_BUILD_SIGNER_DIGEST, EXTENSION_OID_RUNNER_ENVIRONMENT, EXTENSION_OID_SOURCE_REPOSITORY_URI, EXTENSION_OID_SOURCE_REPOSITORY_DIGEST, EXTENSION_OID_SOURCE_REPOSITORY_REF, EXTENSION_OID_SOURCE_REPOSITORY_IDENTIFIER, EXTENSION_OID_SOURCE_REPOSITORY_OWNER_URI, EXTENSION_OID_SOURCE_REPOSITORY_OWNER_IDENTIFIER, EXTENSION_OID_BUILD_CONFIG_URI, EXTENSION_OID_BUILD_CONFIG_DIGEST, EXTENSION_OID_BUILD_TRIGGER, EXTENSION_OID_RUN_INVOCATION_URI, EXTENSION_OID_SOURCE_REPOSITORY_VISIBILITY, X509Certificate;
var init_cert = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/x509/cert.js"() {
    init_dist();
    init_interfaces2();
    init_oid();
    init_ext();
    EXTENSION_OID_SUBJECT_KEY_ID = "2.5.29.14";
    EXTENSION_OID_KEY_USAGE = "2.5.29.15";
    EXTENSION_OID_SUBJECT_ALT_NAME = "2.5.29.17";
    EXTENSION_OID_BASIC_CONSTRAINTS = "2.5.29.19";
    EXTENSION_OID_AUTHORITY_KEY_ID = "2.5.29.35";
    EXTENSION_OID_SCT = "1.3.6.1.4.1.11129.2.4.2";
    DN_OID_COMMON_NAME = "2.5.4.3";
    DN_OID_COUNTRY = "2.5.4.6";
    DN_OID_LOCALITY = "2.5.4.7";
    DN_OID_STATE = "2.5.4.8";
    DN_OID_ORGANIZATION = "2.5.4.10";
    DN_OID_ORGANIZATIONAL_UNIT = "2.5.4.11";
    DN_OID_TO_NAME = {
      [DN_OID_COMMON_NAME]: "CN",
      [DN_OID_COUNTRY]: "C",
      [DN_OID_LOCALITY]: "L",
      [DN_OID_STATE]: "ST",
      [DN_OID_ORGANIZATION]: "O",
      [DN_OID_ORGANIZATIONAL_UNIT]: "OU"
    };
    EXTENSION_OID_FULCIO_ISSUER_V1 = "1.3.6.1.4.1.57264.1.1";
    EXTENSION_OID_GITHUB_WORKFLOW_TRIGGER = "1.3.6.1.4.1.57264.1.2";
    EXTENSION_OID_GITHUB_WORKFLOW_SHA = "1.3.6.1.4.1.57264.1.3";
    EXTENSION_OID_GITHUB_WORKFLOW_NAME = "1.3.6.1.4.1.57264.1.4";
    EXTENSION_OID_GITHUB_WORKFLOW_REPOSITORY = "1.3.6.1.4.1.57264.1.5";
    EXTENSION_OID_GITHUB_WORKFLOW_REF = "1.3.6.1.4.1.57264.1.6";
    EXTENSION_OID_OTHERNAME = "1.3.6.1.4.1.57264.1.7";
    EXTENSION_OID_FULCIO_ISSUER_V2 = "1.3.6.1.4.1.57264.1.8";
    EXTENSION_OID_BUILD_SIGNER_URI = "1.3.6.1.4.1.57264.1.9";
    EXTENSION_OID_BUILD_SIGNER_DIGEST = "1.3.6.1.4.1.57264.1.10";
    EXTENSION_OID_RUNNER_ENVIRONMENT = "1.3.6.1.4.1.57264.1.11";
    EXTENSION_OID_SOURCE_REPOSITORY_URI = "1.3.6.1.4.1.57264.1.12";
    EXTENSION_OID_SOURCE_REPOSITORY_DIGEST = "1.3.6.1.4.1.57264.1.13";
    EXTENSION_OID_SOURCE_REPOSITORY_REF = "1.3.6.1.4.1.57264.1.14";
    EXTENSION_OID_SOURCE_REPOSITORY_IDENTIFIER = "1.3.6.1.4.1.57264.1.15";
    EXTENSION_OID_SOURCE_REPOSITORY_OWNER_URI = "1.3.6.1.4.1.57264.1.16";
    EXTENSION_OID_SOURCE_REPOSITORY_OWNER_IDENTIFIER = "1.3.6.1.4.1.57264.1.17";
    EXTENSION_OID_BUILD_CONFIG_URI = "1.3.6.1.4.1.57264.1.18";
    EXTENSION_OID_BUILD_CONFIG_DIGEST = "1.3.6.1.4.1.57264.1.19";
    EXTENSION_OID_BUILD_TRIGGER = "1.3.6.1.4.1.57264.1.20";
    EXTENSION_OID_RUN_INVOCATION_URI = "1.3.6.1.4.1.57264.1.21";
    EXTENSION_OID_SOURCE_REPOSITORY_VISIBILITY = "1.3.6.1.4.1.57264.1.22";
    X509Certificate = class _X509Certificate {
      constructor(asn1) {
        this.root = asn1;
      }
      static parse(cert) {
        const der = typeof cert === "string" ? toDER(cert) : cert;
        const asn1 = ASN1Obj.parseBuffer(der);
        return new _X509Certificate(asn1);
      }
      get tbsCertificate() {
        return this.tbsCertificateObj;
      }
      get version() {
        const ver = this.versionObj.subs[0].toInteger();
        return `v${(ver + BigInt(1)).toString()}`;
      }
      get serialNumber() {
        return this.serialNumberObj.value;
      }
      get notBefore() {
        return this.validityObj.subs[0].toDate();
      }
      get notAfter() {
        return this.validityObj.subs[1].toDate();
      }
      get issuer() {
        return this.issuerObj.value;
      }
      get subject() {
        return this.subjectObj.value;
      }
      /**
       * Returns the issuer distinguished name as a Map of attribute names to values.
       * Common attributes: CN (Common Name), O (Organization), L (Locality),
       * ST (State), C (Country), OU (Organizational Unit)
       */
      get issuerDN() {
        return this.parseDistinguishedName(this.issuerObj);
      }
      /**
       * Returns the subject distinguished name as a Map of attribute names to values.
       * Common attributes: CN (Common Name), O (Organization), L (Locality),
       * ST (State), C (Country), OU (Organizational Unit)
       */
      get subjectDN() {
        return this.parseDistinguishedName(this.subjectObj);
      }
      get publicKey() {
        return this.subjectPublicKeyInfoObj.toDER();
      }
      /**
       * Import the public key with a specific hash algorithm and signature scheme for RSA keys.
       * For ECDSA keys, both parameters are ignored.
       * @param hashAlg - Hash algorithm (e.g., "sha384") for RSA keys
       * @param usePss - If true, import as RSA-PSS key; if false, import as PKCS#1 v1.5
       */
      async getPublicKeyObj(hashAlg, usePss) {
        const publicKey = this.subjectPublicKeyInfoObj.toDER();
        const spki = ASN1Obj.parseBuffer(publicKey);
        const algorithmOID = spki.subs[0].subs[0].toOID();
        const isRsaKey = algorithmOID === "1.2.840.113549.1.1.1";
        const isRsaPssKey = algorithmOID === OID_RSASSA_PSS;
        if (isRsaPssKey) {
          throw new Error("RSA-PSS public keys (id-RSASSA-PSS OID) are not supported by WebCrypto. Only certificates with standard RSA keys (rsaEncryption OID) signed using RSA-PSS are supported.");
        }
        if (isRsaKey) {
          const hash = hashAlg || DEFAULT_HASH_ALGORITHM;
          const scheme = usePss ? hash : `PKCS1_${hash}`;
          return importKey(KeyTypes.RSA, scheme, Uint8ArrayToBase64(publicKey));
        } else {
          const curveOID = spki.subs[0].subs[1]?.toOID();
          const curve = ECDSA_CURVE_NAMES[curveOID];
          if (!curve) {
            throw new Error(`Unknown ECDSA curve OID: ${curveOID}`);
          }
          return importKey(KeyTypes.Ecdsa, curve, Uint8ArrayToBase64(publicKey));
        }
      }
      get publicKeyObj() {
        return this.getPublicKeyObj();
      }
      get signatureAlgorithm() {
        const oid = this.signatureAlgorithmObj.subs[0].toOID();
        return ECDSA_SIGNATURE_ALGOS[oid] || RSA_SIGNATURE_ALGOS[oid] || this.parseRsaPssHashAlgorithm();
      }
      get signatureAlgorithmOid() {
        return this.signatureAlgorithmObj.subs[0].toOID();
      }
      /**
       * Parse hash algorithm from RSA-PSS signature algorithm parameters.
       * RSA-PSS parameters are: SEQUENCE { hashAlgorithm, maskGenAlgorithm, saltLength, trailerField }
       */
      parseRsaPssHashAlgorithm() {
        const sigAlgOid = this.signatureAlgorithmObj.subs[0].toOID();
        if (sigAlgOid !== OID_RSASSA_PSS) {
          return "";
        }
        const params = this.signatureAlgorithmObj.subs[1];
        if (!params || params.subs.length === 0) {
          return DEFAULT_HASH_ALGORITHM;
        }
        const hashAlgWrapper = params.subs[0];
        if (hashAlgWrapper && hashAlgWrapper.subs.length > 0) {
          const hashAlgSeq = hashAlgWrapper.subs[0];
          if (hashAlgSeq && hashAlgSeq.subs.length > 0) {
            const hashOid = hashAlgSeq.subs[0].toOID();
            return SHA2_HASH_ALGOS[hashOid] || DEFAULT_HASH_ALGORITHM;
          }
        }
        return DEFAULT_HASH_ALGORITHM;
      }
      get signatureValue() {
        return this.signatureValueObj.value.subarray(1);
      }
      get subjectAltName() {
        const ext = this.extSubjectAltName;
        return ext?.uri || ext?.rfc822Name;
      }
      get extensions() {
        const extSeq = this.extensionsObj?.subs[0];
        return extSeq?.subs || /* istanbul ignore next */
        [];
      }
      get extKeyUsage() {
        const ext = this.findExtension(EXTENSION_OID_KEY_USAGE);
        return ext ? new X509KeyUsageExtension(ext) : void 0;
      }
      get extBasicConstraints() {
        const ext = this.findExtension(EXTENSION_OID_BASIC_CONSTRAINTS);
        return ext ? new X509BasicConstraintsExtension(ext) : void 0;
      }
      get extSubjectAltName() {
        const ext = this.findExtension(EXTENSION_OID_SUBJECT_ALT_NAME);
        return ext ? new X509SubjectAlternativeNameExtension(ext) : void 0;
      }
      get extAuthorityKeyID() {
        const ext = this.findExtension(EXTENSION_OID_AUTHORITY_KEY_ID);
        return ext ? new X509AuthorityKeyIDExtension(ext) : void 0;
      }
      get extSubjectKeyID() {
        const ext = this.findExtension(EXTENSION_OID_SUBJECT_KEY_ID);
        return ext ? new X509SubjectKeyIDExtension(ext) : (
          /* istanbul ignore next */
          void 0
        );
      }
      get extSCT() {
        const ext = this.findExtension(EXTENSION_OID_SCT);
        return ext ? new X509SCTExtension(ext) : void 0;
      }
      get extFulcioIssuerV1() {
        const ext = this.findExtension(EXTENSION_OID_FULCIO_ISSUER_V1);
        return ext ? new X509FulcioIssuerV1(ext) : void 0;
      }
      get extFulcioIssuerV2() {
        const ext = this.findExtension(EXTENSION_OID_FULCIO_ISSUER_V2);
        return ext ? new X509FulcioIssuerV2(ext) : void 0;
      }
      get extGitHubWorkflowTrigger() {
        const ext = this.findExtension(EXTENSION_OID_GITHUB_WORKFLOW_TRIGGER);
        return ext ? new X509GitHubWorkflowTriggerExtension(ext) : void 0;
      }
      get extGitHubWorkflowSHA() {
        const ext = this.findExtension(EXTENSION_OID_GITHUB_WORKFLOW_SHA);
        return ext ? new X509GitHubWorkflowSHAExtension(ext) : void 0;
      }
      get extGitHubWorkflowName() {
        const ext = this.findExtension(EXTENSION_OID_GITHUB_WORKFLOW_NAME);
        return ext ? new X509GitHubWorkflowNameExtension(ext) : void 0;
      }
      get extGitHubWorkflowRepository() {
        const ext = this.findExtension(EXTENSION_OID_GITHUB_WORKFLOW_REPOSITORY);
        return ext ? new X509GitHubWorkflowRepositoryExtension(ext) : void 0;
      }
      get extGitHubWorkflowRef() {
        const ext = this.findExtension(EXTENSION_OID_GITHUB_WORKFLOW_REF);
        return ext ? new X509GitHubWorkflowRefExtension(ext) : void 0;
      }
      get extBuildSignerURI() {
        const ext = this.findExtension(EXTENSION_OID_BUILD_SIGNER_URI);
        return ext ? new X509BuildSignerURIExtension(ext) : void 0;
      }
      get extBuildSignerDigest() {
        const ext = this.findExtension(EXTENSION_OID_BUILD_SIGNER_DIGEST);
        return ext ? new X509BuildSignerDigestExtension(ext) : void 0;
      }
      get extRunnerEnvironment() {
        const ext = this.findExtension(EXTENSION_OID_RUNNER_ENVIRONMENT);
        return ext ? new X509RunnerEnvironmentExtension(ext) : void 0;
      }
      get extSourceRepositoryURI() {
        const ext = this.findExtension(EXTENSION_OID_SOURCE_REPOSITORY_URI);
        return ext ? new X509SourceRepositoryURIExtension(ext) : void 0;
      }
      get extSourceRepositoryDigest() {
        const ext = this.findExtension(EXTENSION_OID_SOURCE_REPOSITORY_DIGEST);
        return ext ? new X509SourceRepositoryDigestExtension(ext) : void 0;
      }
      get extSourceRepositoryRef() {
        const ext = this.findExtension(EXTENSION_OID_SOURCE_REPOSITORY_REF);
        return ext ? new X509SourceRepositoryRefExtension(ext) : void 0;
      }
      get extSourceRepositoryIdentifier() {
        const ext = this.findExtension(EXTENSION_OID_SOURCE_REPOSITORY_IDENTIFIER);
        return ext ? new X509SourceRepositoryIdentifierExtension(ext) : void 0;
      }
      get extSourceRepositoryOwnerURI() {
        const ext = this.findExtension(EXTENSION_OID_SOURCE_REPOSITORY_OWNER_URI);
        return ext ? new X509SourceRepositoryOwnerURIExtension(ext) : void 0;
      }
      get extSourceRepositoryOwnerIdentifier() {
        const ext = this.findExtension(EXTENSION_OID_SOURCE_REPOSITORY_OWNER_IDENTIFIER);
        return ext ? new X509SourceRepositoryOwnerIdentifierExtension(ext) : void 0;
      }
      get extBuildConfigURI() {
        const ext = this.findExtension(EXTENSION_OID_BUILD_CONFIG_URI);
        return ext ? new X509BuildConfigURIExtension(ext) : void 0;
      }
      get extBuildConfigDigest() {
        const ext = this.findExtension(EXTENSION_OID_BUILD_CONFIG_DIGEST);
        return ext ? new X509BuildConfigDigestExtension(ext) : void 0;
      }
      get extBuildTrigger() {
        const ext = this.findExtension(EXTENSION_OID_BUILD_TRIGGER);
        return ext ? new X509BuildTriggerExtension(ext) : void 0;
      }
      get extRunInvocationURI() {
        const ext = this.findExtension(EXTENSION_OID_RUN_INVOCATION_URI);
        return ext ? new X509RunInvocationURIExtension(ext) : void 0;
      }
      get extSourceRepositoryVisibility() {
        const ext = this.findExtension(EXTENSION_OID_SOURCE_REPOSITORY_VISIBILITY);
        return ext ? new X509SourceRepositoryVisibilityExtension(ext) : void 0;
      }
      get isCA() {
        const ca = this.extBasicConstraints?.isCA || false;
        if (this.extKeyUsage) {
          return ca && this.extKeyUsage.keyCertSign;
        }
        return ca;
      }
      extension(oid) {
        const ext = this.findExtension(oid);
        return ext ? new X509Extension(ext) : void 0;
      }
      async verify(issuerCertificate) {
        const sigAlgOID = this.signatureAlgorithmOid;
        const isRsaPss = sigAlgOID === OID_RSASSA_PSS;
        const hashAlg = isRsaPss ? this.parseRsaPssHashAlgorithm() : RSA_SIGNATURE_ALGOS[sigAlgOID] || ECDSA_SIGNATURE_ALGOS[sigAlgOID];
        const publicKeyObj = issuerCertificate ? await issuerCertificate.getPublicKeyObj(hashAlg, isRsaPss) : await this.getPublicKeyObj(hashAlg, isRsaPss);
        return await verifySignature(publicKeyObj, this.tbsCertificate.toDER(), this.signatureValue, this.signatureAlgorithm);
      }
      validForDate(date) {
        return this.notBefore <= date && date <= this.notAfter;
      }
      equals(other) {
        return uint8ArrayEqual(this.root.toDER(), other.root.toDER());
      }
      // Creates a copy of the certificate with a new buffer
      clone() {
        const der = this.root.toDER();
        const clone = new Uint8Array(der);
        return _X509Certificate.parse(clone);
      }
      findExtension(oid) {
        return this.extensions.find((ext) => ext.subs[0].toOID() === oid);
      }
      /////////////////////////////////////////////////////////////////////////////
      // The following properties use the documented x509 structure to locate the
      // desired ASN.1 object
      // https://www.rfc-editor.org/rfc/rfc5280#section-4.1
      // https://www.rfc-editor.org/rfc/rfc5280#section-4.1.1.1
      get tbsCertificateObj() {
        return this.root.subs[0];
      }
      // https://www.rfc-editor.org/rfc/rfc5280#section-4.1.1.2
      get signatureAlgorithmObj() {
        return this.root.subs[1];
      }
      // https://www.rfc-editor.org/rfc/rfc5280#section-4.1.1.3
      get signatureValueObj() {
        return this.root.subs[2];
      }
      // https://www.rfc-editor.org/rfc/rfc5280#section-4.1.2.1
      get versionObj() {
        return this.tbsCertificateObj.subs[0];
      }
      // https://www.rfc-editor.org/rfc/rfc5280#section-4.1.2.2
      get serialNumberObj() {
        return this.tbsCertificateObj.subs[1];
      }
      // https://www.rfc-editor.org/rfc/rfc5280#section-4.1.2.4
      get issuerObj() {
        return this.tbsCertificateObj.subs[3];
      }
      // https://www.rfc-editor.org/rfc/rfc5280#section-4.1.2.5
      get validityObj() {
        return this.tbsCertificateObj.subs[4];
      }
      // https://www.rfc-editor.org/rfc/rfc5280#section-4.1.2.6
      get subjectObj() {
        return this.tbsCertificateObj.subs[5];
      }
      // https://www.rfc-editor.org/rfc/rfc5280#section-4.1.2.7
      get subjectPublicKeyInfoObj() {
        return this.tbsCertificateObj.subs[6];
      }
      // Extensions can't be located by index because their position varies. Instead,
      // we need to find the extensions context specific tag
      // https://www.rfc-editor.org/rfc/rfc5280#section-4.1.2.9
      get extensionsObj() {
        return this.tbsCertificateObj.subs.find((sub) => sub.tag.isContextSpecific(3));
      }
      // Parse a Distinguished Name (issuer or subject) ASN1Obj into a Map
      // DN structure: SEQUENCE of SET of SEQUENCE (AttributeTypeAndValue)
      // Each AttributeTypeAndValue is [OID, value]
      parseDistinguishedName(dnObj) {
        const result = /* @__PURE__ */ new Map();
        for (const rdn of dnObj.subs) {
          for (const atv of rdn.subs) {
            if (atv.subs.length >= 2) {
              const oidObj = atv.subs[0];
              const valueObj = atv.subs[1];
              if (oidObj.tag.isOID()) {
                const oid = oidObj.toOID();
                const attrName = DN_OID_TO_NAME[oid];
                if (attrName) {
                  const value = new TextDecoder().decode(valueObj.value);
                  result.set(attrName, value);
                }
              }
            }
          }
        }
        return result;
      }
    };
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/x509/chain.js
function dedupeCertificates(certs) {
  for (let i = 0; i < certs.length; i++) {
    for (let j = i + 1; j < certs.length; j++) {
      if (certs[i].equals(certs[j])) {
        certs.splice(j, 1);
        j--;
      }
    }
  }
  return certs;
}
var CertificateChainVerifier;
var init_chain = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/x509/chain.js"() {
    init_dist();
    CertificateChainVerifier = class {
      constructor(opts) {
        this.untrustedCert = opts.untrustedCert;
        this.trustedCerts = opts.trustedCerts;
        this.localCerts = dedupeCertificates([
          ...opts.trustedCerts,
          opts.untrustedCert
        ]);
        this.timestamp = opts.timestamp;
      }
      async verify() {
        const certificatePath = await this.sort();
        this.checkPath(certificatePath);
        const validForDate = certificatePath.every((cert) => cert.validForDate(this.timestamp));
        if (!validForDate) {
          throw new Error("certificate is not valid or expired at the specified date");
        }
        return certificatePath;
      }
      async sort() {
        const leafCert = this.untrustedCert;
        let paths = await this.buildPaths(leafCert);
        paths = paths.filter((path2) => path2.some((cert) => this.trustedCerts.includes(cert)));
        if (paths.length === 0) {
          throw new Error("no trusted certificate path found");
        }
        const path = paths.reduce((prev, curr) => prev.length < curr.length ? prev : curr);
        return [leafCert, ...path].slice(0, -1);
      }
      async buildPaths(certificate) {
        const paths = [];
        const issuers = await this.findIssuer(certificate);
        if (issuers.length === 0) {
          throw new Error("no valid certificate path found");
        }
        for (let i = 0; i < issuers.length; i++) {
          const issuer = issuers[i];
          if (issuer.equals(certificate)) {
            paths.push([certificate]);
            continue;
          }
          const subPaths = await this.buildPaths(issuer);
          for (let j = 0; j < subPaths.length; j++) {
            paths.push([issuer, ...subPaths[j]]);
          }
        }
        return paths;
      }
      async findIssuer(certificate) {
        let issuers = [];
        let keyIdentifier;
        if (uint8ArrayEqual(certificate.subject, certificate.issuer)) {
          if (await certificate.verify()) {
            return [certificate];
          }
        }
        if (certificate.extAuthorityKeyID) {
          keyIdentifier = certificate.extAuthorityKeyID.keyIdentifier;
        }
        this.localCerts.forEach((possibleIssuer) => {
          if (keyIdentifier) {
            if (possibleIssuer.extSubjectKeyID) {
              if (uint8ArrayEqual(possibleIssuer.extSubjectKeyID.keyIdentifier, keyIdentifier)) {
                issuers.push(possibleIssuer);
              }
              return;
            }
          }
          if (uint8ArrayEqual(possibleIssuer.subject, certificate.issuer)) {
            issuers.push(possibleIssuer);
          }
        });
        const verifiedIssuers = [];
        for (const issuer of issuers) {
          try {
            if (await certificate.verify(issuer)) {
              verifiedIssuers.push(issuer);
            }
          } catch (ex) {
          }
        }
        return verifiedIssuers;
      }
      checkPath(path) {
        if (path.length < 1) {
          throw new Error("certificate chain must contain at least one certificate");
        }
        const validCAs = path.slice(1).every((cert) => cert.isCA);
        if (!validCAs) {
          throw new Error("intermediate certificate is not a CA");
        }
        for (let i = path.length - 2; i >= 0; i--) {
          if (!uint8ArrayEqual(path[i].issuer, path[i + 1].subject)) {
            throw new Error("incorrect certificate name chaining");
          }
        }
        for (let i = 0; i < path.length; i++) {
          const cert = path[i];
          if (cert.extBasicConstraints?.isCA) {
            const pathLength = cert.extBasicConstraints.pathLenConstraint;
            if (pathLength !== void 0 && pathLength < BigInt(i - 1)) {
              throw new Error("path length constraint exceeded");
            }
          }
        }
      }
    };
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/x509/index.js
var init_x509 = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/x509/index.js"() {
    init_cert();
    init_ext();
    init_chain();
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/dsse.js
function preAuthEncoding(payloadType, payload) {
  const prefix = [
    PAE_PREFIX,
    payloadType.length,
    payloadType,
    payload.length,
    ""
  ].join(" ");
  const encoder = new TextEncoder();
  const prefixBuffer = encoder.encode(prefix);
  for (let i = 0; i < prefixBuffer.length; i++) {
    if (prefixBuffer[i] > 127) {
      throw new Error(`Invalid non-ASCII character in PAE prefix at position ${i}`);
    }
  }
  const combinedArray = new Uint8Array(prefixBuffer.length + payload.length);
  combinedArray.set(prefixBuffer, 0);
  combinedArray.set(payload, prefixBuffer.length);
  return combinedArray;
}
var PAE_PREFIX;
var init_dsse = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/dsse.js"() {
    PAE_PREFIX = "DSSEv1";
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/tlog/merkle.js
async function verifyMerkleInclusion(entry) {
  if (!entry.inclusionProof) {
    throw new Error("Missing inclusion proof");
  }
  const inclusionProof = entry.inclusionProof;
  const logIndex = BigInt(inclusionProof.logIndex);
  const treeSize = BigInt(inclusionProof.treeSize);
  if (logIndex < 0n || logIndex >= treeSize) {
    throw new Error(`Invalid log index: ${logIndex}`);
  }
  const { inner, border } = decompInclProof(logIndex, treeSize);
  if (inclusionProof.hashes.length !== inner + border) {
    throw new Error("Invalid hash count in inclusion proof");
  }
  const innerHashes = inclusionProof.hashes.slice(0, inner).map((h) => base64ToUint8Array(h));
  const borderHashes = inclusionProof.hashes.slice(inner).map((h) => base64ToUint8Array(h));
  const leafHash = await hashLeaf(base64ToUint8Array(entry.canonicalizedBody));
  const calculatedHash = await chainBorderRight(await chainInner(leafHash, innerHashes, logIndex), borderHashes);
  const rootHash = base64ToUint8Array(inclusionProof.rootHash);
  if (!uint8ArrayEqual(calculatedHash, rootHash)) {
    throw new Error("Calculated root hash does not match inclusion proof");
  }
}
function decompInclProof(index, size) {
  const inner = innerProofSize(index, size);
  const border = onesCount(index >> BigInt(inner));
  return { inner, border };
}
async function chainInner(seed, hashes, index) {
  let acc = seed;
  for (let i = 0; i < hashes.length; i++) {
    const h = hashes[i];
    if (index >> BigInt(i) & BigInt(1)) {
      acc = await hashChildren(h, acc);
    } else {
      acc = await hashChildren(acc, h);
    }
  }
  return acc;
}
async function chainBorderRight(seed, hashes) {
  let acc = seed;
  for (const h of hashes) {
    acc = await hashChildren(h, acc);
  }
  return acc;
}
function innerProofSize(index, size) {
  return bitLength(index ^ size - BigInt(1));
}
function onesCount(num) {
  return num.toString(2).split("1").length - 1;
}
function bitLength(n) {
  if (n === 0n) {
    return 0;
  }
  return n.toString(2).length;
}
async function hashChildren(left, right) {
  const data = new Uint8Array(RFC6962_NODE_HASH_PREFIX.length + left.length + right.length);
  data.set(RFC6962_NODE_HASH_PREFIX, 0);
  data.set(left, RFC6962_NODE_HASH_PREFIX.length);
  data.set(right, RFC6962_NODE_HASH_PREFIX.length + left.length);
  const hash = await crypto.subtle.digest(HashAlgorithms.SHA256, data);
  return new Uint8Array(hash);
}
async function hashLeaf(leaf) {
  const data = new Uint8Array(RFC6962_LEAF_HASH_PREFIX.length + leaf.length);
  data.set(RFC6962_LEAF_HASH_PREFIX, 0);
  data.set(leaf, RFC6962_LEAF_HASH_PREFIX.length);
  const hash = await crypto.subtle.digest(HashAlgorithms.SHA256, data);
  return new Uint8Array(hash);
}
var RFC6962_LEAF_HASH_PREFIX, RFC6962_NODE_HASH_PREFIX;
var init_merkle = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/tlog/merkle.js"() {
    init_dist();
    init_interfaces2();
    RFC6962_LEAF_HASH_PREFIX = new Uint8Array([0]);
    RFC6962_NODE_HASH_PREFIX = new Uint8Array([1]);
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/tlog/checkpoint.js
async function verifyCheckpoint(entry, tlogs) {
  if (!entry.inclusionProof?.checkpoint) {
    throw new Error("Missing checkpoint in inclusion proof");
  }
  const entryLogId = base64ToUint8Array(entry.logId.keyId);
  const matchingTLogs = tlogs.filter((tlog) => {
    const tlogId = base64ToUint8Array(tlog.logId.keyId);
    return uint8ArrayEqual(tlogId, entryLogId);
  });
  const validTLogs = entry.integratedTime ? filterTLogsByDate(matchingTLogs, new Date(Number(entry.integratedTime) * 1e3)) : matchingTLogs;
  const inclusionProof = entry.inclusionProof;
  const signedNote = SignedNote.fromString(inclusionProof.checkpoint.envelope);
  const checkpoint = LogCheckpoint.fromString(signedNote.note);
  if (!await verifySignedNote(signedNote, validTLogs)) {
    throw new Error("Invalid checkpoint signature");
  }
  const rootHash = base64ToUint8Array(inclusionProof.rootHash);
  if (!uint8ArrayEqual(checkpoint.logHash, rootHash)) {
    throw new Error("Root hash mismatch between checkpoint and inclusion proof");
  }
}
async function verifySignedNote(signedNote, tlogs) {
  const data = stringToUint8Array(signedNote.note);
  let hasValidSignature = false;
  for (const signature of signedNote.signatures) {
    const tlog = tlogs.find((tlog2) => {
      const logId = base64ToUint8Array(tlog2.logId.keyId);
      return uint8ArrayEqual(logId.subarray(0, 4), signature.keyHint);
    });
    if (!tlog) {
      continue;
    }
    const publicKey = await importTLogKey(tlog);
    const verified = await verifySignature(publicKey, data, signature.signature, tlog.hashAlgorithm);
    if (verified) {
      hasValidSignature = true;
    }
  }
  return hasValidSignature;
}
function filterTLogsByDate(tlogs, targetDate) {
  return tlogs.filter((tlog) => {
    const start = new Date(tlog.publicKey.validFor.start);
    const end = tlog.publicKey.validFor.end ? new Date(tlog.publicKey.validFor.end) : null;
    return targetDate >= start && (!end || targetDate <= end);
  });
}
async function importTLogKey(tlog) {
  const keyDetails = tlog.publicKey.keyDetails;
  let keyType;
  let scheme;
  if (keyDetails === "ecdsa-sha2-nistp256") {
    keyType = KeyTypes.Ecdsa;
    scheme = "P256-SHA256";
  } else if (keyDetails.includes("ECDSA")) {
    keyType = KeyTypes.Ecdsa;
    scheme = keyDetails.replace("PKIX_ECDSA_", "").replace(/_/g, "-");
  } else if (keyDetails.includes("ED25519")) {
    keyType = KeyTypes.Ed25519;
    scheme = KeyTypes.Ed25519;
  } else if (keyDetails.includes("RSA")) {
    keyType = KeyTypes.RSA;
    scheme = keyDetails.replace("PKIX_RSA_", "").replace(/_/g, "-");
  } else {
    throw new Error(`Unsupported key type in keyDetails: ${keyDetails}`);
  }
  return importKey(keyType, scheme, tlog.publicKey.rawBytes);
}
var CHECKPOINT_SEPARATOR, SIGNATURE_REGEX, SignedNote, LogCheckpoint;
var init_checkpoint = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/tlog/checkpoint.js"() {
    init_dist();
    CHECKPOINT_SEPARATOR = "\n\n";
    SIGNATURE_REGEX = /\u2014 (\S+) (\S+)\n/g;
    SignedNote = class _SignedNote {
      constructor(note, signatures) {
        this.note = note;
        this.signatures = signatures;
      }
      static fromString(envelope) {
        if (!envelope.includes(CHECKPOINT_SEPARATOR)) {
          throw new Error("Missing checkpoint separator");
        }
        const split2 = envelope.indexOf(CHECKPOINT_SEPARATOR);
        const header = envelope.slice(0, split2 + 1);
        const data = envelope.slice(split2 + CHECKPOINT_SEPARATOR.length);
        const matches = data.matchAll(SIGNATURE_REGEX);
        const signatures = [];
        for (const match of matches) {
          const [, name, signature] = match;
          const sigBytes = base64ToUint8Array(signature);
          if (sigBytes.length < 5) {
            throw new Error("Malformed checkpoint signature");
          }
          signatures.push({
            name,
            keyHint: sigBytes.subarray(0, 4),
            signature: sigBytes.subarray(4)
          });
        }
        if (signatures.length === 0) {
          throw new Error("No signatures found in checkpoint");
        }
        return new _SignedNote(header, signatures);
      }
    };
    LogCheckpoint = class _LogCheckpoint {
      constructor(origin, logSize, logHash, rest) {
        this.origin = origin;
        this.logSize = logSize;
        this.logHash = logHash;
        this.rest = rest;
      }
      static fromString(note) {
        const lines = note.trimEnd().split("\n");
        if (lines.length < 3) {
          throw new Error("Too few lines in checkpoint header");
        }
        const origin = lines[0];
        const logSize = BigInt(lines[1]);
        const rootHash = base64ToUint8Array(lines[2]);
        const rest = lines.slice(3);
        return new _LogCheckpoint(origin, logSize, rootHash, rest);
      }
    };
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/tlog/hashedrekord.js
async function verifyHashedRekordBody(entry, bundle) {
  const hashedRekordEntry = entry;
  switch (hashedRekordEntry.apiVersion) {
    case "0.0.1":
      return verifyHashedRekordV001Body(hashedRekordEntry, bundle);
    case "0.0.2":
      return verifyHashedRekordV002Body(hashedRekordEntry, bundle);
    default:
      throw new Error(`Unsupported hashedrekord version: ${hashedRekordEntry.apiVersion}`);
  }
}
function verifyHashedRekordV001Body(entry, bundle) {
  const spec = entry.spec;
  if (!bundle.messageSignature) {
    throw new Error("Bundle missing messageSignature for hashedrekord entry");
  }
  const tlogSig = spec.signature.content || "";
  const tlogSigBytes = base64ToUint8Array(tlogSig);
  const bundleSigBytes = base64ToUint8Array(bundle.messageSignature.signature);
  if (!uint8ArrayEqual(tlogSigBytes, bundleSigBytes)) {
    throw new Error("Signature mismatch between TLog entry and bundle");
  }
  const tlogDigest = spec.data.hash?.value || "";
  const tlogDigestBytes = hexToUint8Array(tlogDigest);
  const bundleDigestBytes = base64ToUint8Array(bundle.messageSignature.messageDigest.digest);
  if (!uint8ArrayEqual(tlogDigestBytes, bundleDigestBytes)) {
    throw new Error("Digest mismatch between TLog entry and bundle");
  }
}
function verifyHashedRekordV002Body(entry, bundle) {
  const spec = entry.spec.hashedRekordV002;
  if (!bundle.messageSignature) {
    throw new Error("Bundle missing messageSignature for hashedrekord v0.0.2 entry");
  }
  const tlogSig = spec.signature.content || "";
  const tlogSigBytes = base64ToUint8Array(tlogSig);
  const bundleSigBytes = base64ToUint8Array(bundle.messageSignature.signature);
  if (!uint8ArrayEqual(tlogSigBytes, bundleSigBytes)) {
    throw new Error("Signature mismatch between TLog entry and bundle (v0.0.2)");
  }
  const tlogDigest = spec.data.digest || "";
  const tlogDigestBytes = base64ToUint8Array(tlogDigest);
  const bundleDigestBytes = base64ToUint8Array(bundle.messageSignature.messageDigest.digest);
  if (!uint8ArrayEqual(tlogDigestBytes, bundleDigestBytes)) {
    throw new Error("Digest mismatch between TLog entry and bundle (v0.0.2)");
  }
}
var init_hashedrekord = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/tlog/hashedrekord.js"() {
    init_dist();
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/tlog/dsse.js
async function verifyDSSEBody(entry, bundle) {
  const dsseEntry = entry;
  switch (dsseEntry.apiVersion) {
    case "0.0.1":
      return verifyDSSE001Body(dsseEntry, bundle);
    case "0.0.2":
      return verifyDSSE002Body(dsseEntry, bundle);
    default:
      throw new Error(`Unsupported dsse version: ${dsseEntry.apiVersion}`);
  }
}
async function verifyDSSE001Body(entry, bundle) {
  if (!bundle.dsseEnvelope) {
    throw new Error("Bundle missing dsseEnvelope for DSSE entry");
  }
  if (!entry.spec.signatures || entry.spec.signatures.length !== 1) {
    throw new Error("DSSE entry must have exactly one signature");
  }
  const tlogSig = entry.spec.signatures[0].signature;
  const tlogSigBytes = base64ToUint8Array(tlogSig);
  if (bundle.dsseEnvelope.signatures.length === 0) {
    throw new Error("Bundle DSSE envelope missing signatures");
  }
  const bundleSigBytes = base64ToUint8Array(bundle.dsseEnvelope.signatures[0].sig);
  if (!uint8ArrayEqual(tlogSigBytes, bundleSigBytes)) {
    throw new Error("DSSE signature mismatch between TLog entry and bundle");
  }
  if (!entry.spec.payloadHash?.value || !entry.spec.payloadHash?.algorithm) {
    throw new Error("DSSE entry missing payloadHash or algorithm");
  }
  const hashAlg = getHashAlgorithm(entry.spec.payloadHash.algorithm);
  const tlogHashBytes = hexToUint8Array(entry.spec.payloadHash.value);
  const payloadBytes = base64ToUint8Array(bundle.dsseEnvelope.payload);
  const bundleHashBytes = new Uint8Array(await crypto.subtle.digest(hashAlg, payloadBytes));
  if (!uint8ArrayEqual(tlogHashBytes, bundleHashBytes)) {
    throw new Error("DSSE payload hash mismatch between TLog entry and bundle");
  }
}
async function verifyDSSE002Body(entry, bundle) {
  if (!bundle.dsseEnvelope) {
    throw new Error("Bundle missing dsseEnvelope for DSSE v0.0.2 entry");
  }
  const spec = entry.spec.dsseV002;
  if (!spec) {
    throw new Error("DSSE v0.0.2 entry missing dsseV002 spec");
  }
  if (!spec.signatures || spec.signatures.length !== 1) {
    throw new Error("DSSE v0.0.2 entry must have exactly one signature");
  }
  const tlogSig = spec.signatures[0].content;
  const tlogSigBytes = base64ToUint8Array(tlogSig);
  if (bundle.dsseEnvelope.signatures.length === 0) {
    throw new Error("Bundle DSSE envelope missing signatures");
  }
  const bundleSigBytes = base64ToUint8Array(bundle.dsseEnvelope.signatures[0].sig);
  if (!uint8ArrayEqual(tlogSigBytes, bundleSigBytes)) {
    throw new Error("DSSE signature mismatch between TLog entry and bundle (v0.0.2)");
  }
  if (!spec.payloadHash?.digest || !spec.payloadHash?.algorithm) {
    throw new Error("DSSE v0.0.2 entry missing payloadHash or algorithm");
  }
  const hashAlg = getHashAlgorithm(spec.payloadHash.algorithm);
  const tlogHashBytes = base64ToUint8Array(spec.payloadHash.digest);
  const payloadBytes = base64ToUint8Array(bundle.dsseEnvelope.payload);
  const bundleHashBytes = new Uint8Array(await crypto.subtle.digest(hashAlg, payloadBytes));
  if (!uint8ArrayEqual(tlogHashBytes, bundleHashBytes)) {
    throw new Error("DSSE payload hash mismatch between TLog entry and bundle (v0.0.2)");
  }
}
var init_dsse2 = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/tlog/dsse.js"() {
    init_dist();
    init_interfaces2();
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/tlog/intoto.js
async function verifyIntotoBody(entry, bundle) {
  const intotoEntry = entry;
  if (intotoEntry.apiVersion !== "0.0.2") {
    throw new Error(`Unsupported intoto version: ${intotoEntry.apiVersion}`);
  }
  if (!bundle.dsseEnvelope) {
    throw new Error("Bundle missing dsseEnvelope for intoto entry");
  }
  const tlogEnvelope = intotoEntry.spec.content.envelope;
  if (!tlogEnvelope.signatures || tlogEnvelope.signatures.length !== 1) {
    throw new Error("Intoto entry must have exactly one signature");
  }
  const tlogSigBase64 = tlogEnvelope.signatures[0].sig;
  const tlogSigDecoded = base64Decode(tlogSigBase64);
  const tlogSigBytes = base64ToUint8Array(tlogSigDecoded);
  if (bundle.dsseEnvelope.signatures.length === 0) {
    throw new Error("Bundle DSSE envelope missing signatures");
  }
  const bundleSigBytes = base64ToUint8Array(bundle.dsseEnvelope.signatures[0].sig);
  if (!uint8ArrayEqual(tlogSigBytes, bundleSigBytes)) {
    throw new Error("Intoto signature mismatch between TLog entry and bundle");
  }
  if (intotoEntry.spec.content.payloadHash) {
    if (!intotoEntry.spec.content.payloadHash.algorithm) {
      throw new Error("Intoto entry missing payloadHash algorithm");
    }
    const hashAlg = getHashAlgorithm(intotoEntry.spec.content.payloadHash.algorithm);
    const tlogHashBytes = hexToUint8Array(intotoEntry.spec.content.payloadHash.value);
    const payloadBytes = base64ToUint8Array(bundle.dsseEnvelope.payload);
    const bundleHashBytes = new Uint8Array(await crypto.subtle.digest(hashAlg, payloadBytes));
    if (!uint8ArrayEqual(tlogHashBytes, bundleHashBytes)) {
      throw new Error("Intoto payload hash mismatch between TLog entry and bundle");
    }
  }
}
var init_intoto = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/tlog/intoto.js"() {
    init_dist();
    init_interfaces2();
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/tlog/body.js
async function verifyTLogBody(entry, bundle) {
  const rekorEntry = parseCanonicalBody(entry);
  const { kind, version } = entry.kindVersion;
  if (kind !== rekorEntry.kind || version !== rekorEntry.apiVersion) {
    throw new Error(`kind/version mismatch - expected: ${kind}/${version}, received: ${rekorEntry.kind}/${rekorEntry.apiVersion}`);
  }
  switch (rekorEntry.kind) {
    case "hashedrekord":
      return verifyHashedRekordBody(rekorEntry, bundle);
    case "dsse":
      return verifyDSSEBody(rekorEntry, bundle);
    case "intoto":
      return verifyIntotoBody(rekorEntry, bundle);
    default:
      throw new Error(`Unsupported TLog entry kind: ${rekorEntry.kind}`);
  }
}
function parseCanonicalBody(entry) {
  try {
    const decodedBody = base64Decode(entry.canonicalizedBody);
    const rekorEntry = JSON.parse(decodedBody);
    if (!rekorEntry.apiVersion || !rekorEntry.kind || !rekorEntry.spec) {
      throw new Error("Invalid Rekor entry structure");
    }
    return rekorEntry;
  } catch (error) {
    throw new Error(`Failed to parse canonicalized body: ${error instanceof Error ? error.message : String(error)}`);
  }
}
var init_body = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/tlog/body.js"() {
    init_dist();
    init_hashedrekord();
    init_dsse2();
    init_intoto();
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/rfc3161/error.js
var RFC3161TimestampVerificationError;
var init_error2 = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/rfc3161/error.js"() {
    RFC3161TimestampVerificationError = class extends Error {
    };
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/rfc3161/tstinfo.js
var TSTInfo;
var init_tstinfo = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/rfc3161/tstinfo.js"() {
    init_dist();
    init_interfaces2();
    init_oid();
    init_error2();
    TSTInfo = class {
      constructor(asn1) {
        this.root = asn1;
      }
      get version() {
        return this.root.subs[0].toInteger();
      }
      get genTime() {
        return this.root.subs[4].toDate();
      }
      get messageImprintHashAlgorithm() {
        const oid = this.messageImprintObj.subs[0].subs[0].toOID();
        const algo = SHA2_HASH_ALGOS[oid];
        if (!algo) {
          throw new Error(`Unknown message imprint hash algorithm OID: ${oid}`);
        }
        return algo;
      }
      get messageImprintHashedMessage() {
        return this.messageImprintObj.subs[1].value;
      }
      get raw() {
        return this.root.toDER();
      }
      async verify(data) {
        const hashAlg = this.messageImprintHashAlgorithm;
        const hashAlgName = hashAlg === "sha256" ? HashAlgorithms.SHA256 : hashAlg === "sha384" ? HashAlgorithms.SHA384 : hashAlg === "sha512" ? HashAlgorithms.SHA512 : hashAlg;
        const digest = await crypto.subtle.digest(hashAlgName, data);
        if (!uint8ArrayEqual(new Uint8Array(digest), this.messageImprintHashedMessage)) {
          throw new RFC3161TimestampVerificationError("message imprint does not match artifact");
        }
      }
      // https://www.rfc-editor.org/rfc/rfc3161#section-2.4.2
      get messageImprintObj() {
        return this.root.subs[2];
      }
    };
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/rfc3161/timestamp.js
var OID_PKCS9_CONTENT_TYPE_SIGNED_DATA, OID_PKCS9_CONTENT_TYPE_TSTINFO, OID_PKCS9_MESSAGE_DIGEST_KEY, RFC3161Timestamp;
var init_timestamp = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/rfc3161/timestamp.js"() {
    init_dist();
    init_interfaces2();
    init_oid();
    init_error2();
    init_tstinfo();
    OID_PKCS9_CONTENT_TYPE_SIGNED_DATA = "1.2.840.113549.1.7.2";
    OID_PKCS9_CONTENT_TYPE_TSTINFO = "1.2.840.113549.1.9.16.1.4";
    OID_PKCS9_MESSAGE_DIGEST_KEY = "1.2.840.113549.1.9.4";
    RFC3161Timestamp = class _RFC3161Timestamp {
      constructor(asn1) {
        this.root = asn1;
      }
      static parse(der) {
        const asn1 = ASN1Obj.parseBuffer(der);
        return new _RFC3161Timestamp(asn1);
      }
      get status() {
        return this.pkiStatusInfoObj.subs[0].toInteger();
      }
      get contentType() {
        return this.contentTypeObj.toOID();
      }
      get eContentType() {
        return this.eContentTypeObj.toOID();
      }
      get signingTime() {
        return this.tstInfo.genTime;
      }
      get signerIssuer() {
        return this.signerSidObj.subs[0].value;
      }
      get signerSerialNumber() {
        return this.signerSidObj.subs[1].value;
      }
      get signerDigestAlgorithm() {
        const oid = this.signerDigestAlgorithmObj.subs[0].toOID();
        const algo = SHA2_HASH_ALGOS[oid];
        if (!algo) {
          throw new Error(`Unknown digest algorithm OID: ${oid}`);
        }
        return algo;
      }
      get signatureAlgorithm() {
        const oid = this.signatureAlgorithmObj.subs[0].toOID();
        const algo = ECDSA_SIGNATURE_ALGOS[oid] || RSA_SIGNATURE_ALGOS[oid];
        return algo;
      }
      get signatureValue() {
        return this.signatureValueObj.value;
      }
      get tstInfo() {
        return new TSTInfo(this.eContentObj.subs[0].subs[0]);
      }
      async verify(data, publicKey) {
        if (!this.timeStampTokenObj) {
          throw new RFC3161TimestampVerificationError("timeStampToken is missing");
        }
        if (this.contentType !== OID_PKCS9_CONTENT_TYPE_SIGNED_DATA) {
          throw new RFC3161TimestampVerificationError(`incorrect content type: ${this.contentType}`);
        }
        if (this.eContentType !== OID_PKCS9_CONTENT_TYPE_TSTINFO) {
          throw new RFC3161TimestampVerificationError(`incorrect encapsulated content type: ${this.eContentType}`);
        }
        await this.tstInfo.verify(data);
        await this.verifyMessageDigest();
        await this.verifySignature(publicKey);
      }
      async verifyMessageDigest() {
        const hashAlg = this.signerDigestAlgorithm;
        const hashAlgName = hashAlg === "sha256" ? HashAlgorithms.SHA256 : hashAlg === "sha384" ? HashAlgorithms.SHA384 : hashAlg === "sha512" ? HashAlgorithms.SHA512 : hashAlg;
        const tstInfoDigest = await crypto.subtle.digest(hashAlgName, this.tstInfo.raw);
        const expectedDigest = this.messageDigestAttributeObj.subs[1].subs[0].value;
        if (!uint8ArrayEqual(new Uint8Array(tstInfoDigest), expectedDigest)) {
          throw new RFC3161TimestampVerificationError("signed data does not match tstInfo");
        }
      }
      async verifySignature(key) {
        const signedAttrs = this.signedAttrsObj.toDER();
        signedAttrs[0] = 49;
        const oid = this.signatureAlgorithmObj.subs[0].toOID();
        const algo = ECDSA_SIGNATURE_ALGOS[oid] || RSA_SIGNATURE_ALGOS[oid];
        if (!algo) {
          throw new RFC3161TimestampVerificationError(`Unsupported signature algorithm OID: ${oid}`);
        }
        const verified = await verifySignature(key, signedAttrs, this.signatureValue, algo);
        if (!verified) {
          throw new RFC3161TimestampVerificationError("signature verification failed");
        }
      }
      // https://www.rfc-editor.org/rfc/rfc3161#section-2.4.2
      get pkiStatusInfoObj() {
        return this.root.subs[0];
      }
      // https://www.rfc-editor.org/rfc/rfc3161#section-2.4.2
      get timeStampTokenObj() {
        return this.root.subs[1];
      }
      // https://datatracker.ietf.org/doc/html/rfc5652#section-3
      get contentTypeObj() {
        return this.timeStampTokenObj.subs[0];
      }
      // https://www.rfc-editor.org/rfc/rfc5652#section-3
      get signedDataObj() {
        const obj = this.timeStampTokenObj.subs.find((sub) => sub.tag.isContextSpecific(0));
        if (!obj) {
          throw new RFC3161TimestampVerificationError("Missing timeStampTokenObj sub.");
        }
        return obj.subs[0];
      }
      // https://datatracker.ietf.org/doc/html/rfc5652#section-5.1
      get encapContentInfoObj() {
        return this.signedDataObj.subs[2];
      }
      // https://datatracker.ietf.org/doc/html/rfc5652#section-5.1
      get signerInfosObj() {
        const sd = this.signedDataObj;
        return sd.subs[sd.subs.length - 1];
      }
      // https://www.rfc-editor.org/rfc/rfc5652#section-5.1
      get signerInfoObj() {
        return this.signerInfosObj.subs[0];
      }
      // https://datatracker.ietf.org/doc/html/rfc5652#section-5.2
      get eContentTypeObj() {
        return this.encapContentInfoObj.subs[0];
      }
      // https://datatracker.ietf.org/doc/html/rfc5652#section-5.2
      get eContentObj() {
        return this.encapContentInfoObj.subs[1];
      }
      // https://datatracker.ietf.org/doc/html/rfc5652#section-5.3
      get signedAttrsObj() {
        const signedAttrs = this.signerInfoObj.subs.find((sub) => sub.tag.isContextSpecific(0));
        if (!signedAttrs) {
          throw new RFC3161TimestampVerificationError("Missing signedAttrsObj.");
        }
        return signedAttrs;
      }
      // https://datatracker.ietf.org/doc/html/rfc5652#section-5.3
      get messageDigestAttributeObj() {
        const messageDigest = this.signedAttrsObj.subs.find((sub) => sub.subs[0].tag.isOID() && sub.subs[0].toOID() === OID_PKCS9_MESSAGE_DIGEST_KEY);
        if (!messageDigest) {
          throw new RFC3161TimestampVerificationError("Missing messageDigest.");
        }
        return messageDigest;
      }
      // https://datatracker.ietf.org/doc/html/rfc5652#section-5.3
      get signerSidObj() {
        return this.signerInfoObj.subs[1];
      }
      // https://datatracker.ietf.org/doc/html/rfc5652#section-5.3
      get signerDigestAlgorithmObj() {
        return this.signerInfoObj.subs[2];
      }
      // https://datatracker.ietf.org/doc/html/rfc5652#section-5.3
      get signatureAlgorithmObj() {
        return this.signerInfoObj.subs[4];
      }
      // https://datatracker.ietf.org/doc/html/rfc5652#section-5.3
      get signatureValueObj() {
        return this.signerInfoObj.subs[5];
      }
    };
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/rfc3161/index.js
var init_rfc3161 = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/rfc3161/index.js"() {
    init_timestamp();
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/timestamp/tsa.js
async function verifyRFC3161Timestamp(timestamp, data, timestampAuthorities) {
  const signingTime = timestamp.signingTime;
  let validAuthorities = filterCertAuthorities(timestampAuthorities, signingTime);
  validAuthorities = filterCAsBySerialAndIssuer(validAuthorities, {
    serialNumber: timestamp.signerSerialNumber,
    issuer: timestamp.signerIssuer
  });
  const verificationResults = await Promise.allSettled(validAuthorities.map((ca) => verifyTimestampForCA(timestamp, data, ca)));
  const verified = verificationResults.some((result) => result.status === "fulfilled");
  if (!verified) {
    const errors = verificationResults.filter((r) => r.status === "rejected").map((r) => r.reason?.message || "Unknown error");
    throw new Error(`Timestamp could not be verified against any trusted authority. Errors: ${errors.join(", ")}`);
  }
  return signingTime;
}
function filterCertAuthorities(authorities, validAt) {
  return authorities.filter((ca) => {
    if (ca.validFor) {
      const start = ca.validFor.start ? new Date(ca.validFor.start) : null;
      const end = ca.validFor.end ? new Date(ca.validFor.end) : null;
      if (start && validAt < start) {
        return false;
      }
      if (end && validAt > end) {
        return false;
      }
    }
    return true;
  });
}
function filterCAsBySerialAndIssuer(timestampAuthorities, criteria) {
  return timestampAuthorities.filter((ca) => {
    if (!ca.certChain || ca.certChain.certificates.length === 0) {
      return false;
    }
    const leafCert = X509Certificate.parse(base64ToUint8Array(ca.certChain.certificates[0].rawBytes));
    return uint8ArrayEqual(leafCert.serialNumber, criteria.serialNumber) && uint8ArrayEqual(leafCert.issuer, criteria.issuer);
  });
}
async function verifyTimestampForCA(timestamp, data, ca) {
  if (!ca.certChain || ca.certChain.certificates.length === 0) {
    throw new Error("Certificate authority missing certificate chain");
  }
  const leafCert = X509Certificate.parse(base64ToUint8Array(ca.certChain.certificates[0].rawBytes));
  const signingTime = timestamp.signingTime;
  const trustedCerts = ca.certChain.certificates.slice(1).map((cert) => X509Certificate.parse(base64ToUint8Array(cert.rawBytes)));
  try {
    const verifier = new CertificateChainVerifier({
      untrustedCert: leafCert,
      trustedCerts,
      timestamp: signingTime
    });
    await verifier.verify();
  } catch (e) {
    throw new Error(`TSA certificate chain verification failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const publicKey = await leafCert.publicKeyObj;
  await timestamp.verify(data, publicKey);
}
async function verifyBundleTimestamp(timestampData, signature, timestampAuthorities) {
  if (!timestampData?.rfc3161Timestamps?.length) {
    return [];
  }
  const verifiedResults = [];
  for (const tsData of timestampData.rfc3161Timestamps) {
    const timestampBytes = base64ToUint8Array(tsData.signedTimestamp);
    const timestamp = RFC3161Timestamp.parse(timestampBytes);
    const signingTime = await verifyRFC3161Timestamp(timestamp, signature, timestampAuthorities);
    verifiedResults.push({
      signingTime,
      signerSerialNumber: Array.from(timestamp.signerSerialNumber).join(",")
    });
  }
  for (let i = 0; i < verifiedResults.length; i++) {
    for (let j = i + 1; j < verifiedResults.length; j++) {
      if (verifiedResults[i].signingTime.getTime() === verifiedResults[j].signingTime.getTime() && verifiedResults[i].signerSerialNumber === verifiedResults[j].signerSerialNumber) {
        throw new Error("Duplicate TSA timestamp detected");
      }
    }
  }
  return verifiedResults.map((r) => r.signingTime);
}
var init_tsa = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/timestamp/tsa.js"() {
    init_dist();
    init_x509();
    init_rfc3161();
  }
});

// node_modules/@freedomofpress/tuf-browser/dist/crypto.js
function getRoleKeys(keys, keyids) {
  const roleKeys = new Map(keys);
  for (const key of keys.keys()) {
    if (!keyids.includes(key)) {
      roleKeys.delete(key);
    }
  }
  return roleKeys;
}
async function loadKeys(keys) {
  const importedKeys = /* @__PURE__ */ new Map();
  for (const keyId in keys) {
    const key = keys[keyId];
    const canonicalBytes = stringToUint8Array(canonicalize(key));
    const verified_keyId = Uint8ArrayToHex(new Uint8Array(await crypto.subtle.digest(HashAlgorithms.SHA256, canonicalBytes)));
    if (importedKeys.has(verified_keyId)) {
      throw new Error("Duplicate keyId found!");
    }
    if (verified_keyId !== keyId) {
      console.warn(`KeyId ${keyId} does not match the expected ${verified_keyId}, importing anyway the provided one for proper referencing.`);
    }
    importedKeys.set(keyId, await importKey(key.keytype, key.scheme, key.keyval.public));
  }
  return importedKeys;
}
async function checkSignatures(keys, roleKeys, signed, signatures, threshold) {
  if (threshold < 1) {
    throw new Error("Threshold must be at least 1");
  }
  if (threshold > keys.size) {
    throw new Error("Threshold is bigger than the number of keys provided, something is wrong.");
  }
  const keyIds = new Set(roleKeys);
  const signed_canon = canonicalize(signed);
  let valid_signatures = 0;
  for (const signature of signatures) {
    if (!keyIds.has(signature.keyid)) {
      continue;
    }
    keyIds.delete(signature.keyid);
    const key = keys.get(signature.keyid);
    const sig = hexToUint8Array(signature.sig);
    if (!key) {
      throw new Error("Keyid was empty.");
    }
    if (await verifySignature(key, stringToUint8Array(signed_canon), sig) === true) {
      valid_signatures++;
    }
  }
  if (valid_signatures >= threshold) {
    return true;
  } else {
    return false;
  }
}
var init_crypto3 = __esm({
  "node_modules/@freedomofpress/tuf-browser/dist/crypto.js"() {
    init_dist();
  }
});

// node_modules/@freedomofpress/tuf-browser/dist/storage/encoding.js
function isRawBytesWrapper(value) {
  return value != null && typeof value === "object" && "__raw_bytes__" in value && // eslint-disable-next-line
  typeof value.__raw_bytes__ === "string";
}
function decodeRawBytesWrapper(wrapper) {
  const bytes = base64ToUint8Array(wrapper.__raw_bytes__);
  return JSON.parse(new TextDecoder().decode(bytes));
}
function createRawBytesWrapper(value) {
  return { __raw_bytes__: Uint8ArrayToBase64(value) };
}
var init_encoding2 = __esm({
  "node_modules/@freedomofpress/tuf-browser/dist/storage/encoding.js"() {
    init_dist();
  }
});

// node_modules/@freedomofpress/tuf-browser/dist/storage/browser.js
var ExtensionStorageBackend;
var init_browser = __esm({
  "node_modules/@freedomofpress/tuf-browser/dist/storage/browser.js"() {
    init_encoding2();
    ExtensionStorageBackend = class {
      async read(key) {
        const result = await browser.storage.local.get(key);
        const value = result[key];
        if (isRawBytesWrapper(value)) {
          return decodeRawBytesWrapper(value);
        }
        return value;
      }
      async write(key, value) {
        await browser.storage.local.set({ [key]: value });
      }
      async writeRaw(key, value) {
        await browser.storage.local.set({ [key]: createRawBytesWrapper(value) });
      }
      async delete(key) {
        await browser.storage.local.remove(key);
      }
    };
  }
});

// node_modules/@freedomofpress/tuf-browser/dist/storage/localstorage.js
var LocalStorageBackend;
var init_localstorage = __esm({
  "node_modules/@freedomofpress/tuf-browser/dist/storage/localstorage.js"() {
    init_encoding2();
    LocalStorageBackend = class {
      async read(key) {
        const value = localStorage.getItem(key);
        if (value) {
          const parsed = JSON.parse(value);
          if (isRawBytesWrapper(parsed)) {
            return decodeRawBytesWrapper(parsed);
          }
          return parsed;
        }
      }
      async write(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
      }
      async writeRaw(key, value) {
        localStorage.setItem(key, JSON.stringify(createRawBytesWrapper(value)));
      }
      async delete(key) {
        localStorage.removeItem(key);
      }
    };
  }
});

// node_modules/@freedomofpress/tuf-browser/dist/storage/memory.js
var MemoryBackend;
var init_memory = __esm({
  "node_modules/@freedomofpress/tuf-browser/dist/storage/memory.js"() {
    init_encoding2();
    MemoryBackend = class {
      constructor() {
        this.cache = /* @__PURE__ */ new Map();
      }
      async read(key) {
        const value = this.cache.get(key);
        if (!value)
          return void 0;
        if (isRawBytesWrapper(value)) {
          return decodeRawBytesWrapper(value);
        }
        return value;
      }
      async write(key, value) {
        this.cache.set(key, value);
      }
      async writeRaw(key, value) {
        this.cache.set(key, createRawBytesWrapper(value));
      }
      async delete(key) {
        this.cache.delete(key);
      }
    };
  }
});

// node_modules/@freedomofpress/tuf-browser/dist/types.js
var Roles, TOP_LEVEL_ROLE_NAMES;
var init_types2 = __esm({
  "node_modules/@freedomofpress/tuf-browser/dist/types.js"() {
    init_dist();
    (function(Roles2) {
      Roles2["Root"] = "root";
      Roles2["Timestamp"] = "timestamp";
      Roles2["Snapshot"] = "snapshot";
      Roles2["Targets"] = "targets";
    })(Roles || (Roles = {}));
    TOP_LEVEL_ROLE_NAMES = [
      Roles.Root,
      Roles.Targets,
      Roles.Snapshot,
      Roles.Timestamp
    ];
  }
});

// node_modules/@freedomofpress/tuf-browser/dist/tuf.js
var tuf_exports = {};
__export(tuf_exports, {
  TUFClient: () => TUFClient
});
var TUFClient;
var init_tuf = __esm({
  "node_modules/@freedomofpress/tuf-browser/dist/tuf.js"() {
    init_dist();
    init_crypto3();
    init_browser();
    init_localstorage();
    init_memory();
    init_types2();
    TUFClient = class {
      constructor(repositoryUrl, startingRoot, namespace, targetBaseUrl, options) {
        this.repositoryUrl = repositoryUrl;
        this.targetBaseUrl = targetBaseUrl || repositoryUrl;
        this.startingRoot = startingRoot;
        this.namespace = namespace;
        if (options?.backend) {
          this.backend = options.backend;
        } else if (options?.disableCache) {
          this.backend = new MemoryBackend();
        } else if (typeof browser !== "undefined" && browser.storage?.local) {
          this.backend = new ExtensionStorageBackend();
        } else if (typeof localStorage !== "undefined") {
          this.backend = new LocalStorageBackend();
        } else {
          this.backend = new MemoryBackend();
        }
      }
      getCacheKey(key) {
        if (key.startsWith("/") || key.startsWith("./") || key.includes("..") || key.includes("\\")) {
          throw new Error(`key contains an invalid pattern (${key})`);
        }
        return `${this.namespace}/${key}.json`;
      }
      async getFromCache(key) {
        const namespacedKey = this.getCacheKey(key);
        return await this.backend.read(namespacedKey);
      }
      async setInCache(key, value) {
        const namespacedKey = this.getCacheKey(key);
        await this.backend.write(namespacedKey, value);
      }
      async fetchMetafileBase(role, version, target = false) {
        let url;
        role = encodeURIComponent(role);
        if (!target) {
          url = version !== -1 ? `${this.repositoryUrl}${version}.${role}.json` : `${this.repositoryUrl}${role}.json`;
        } else {
          url = `${this.repositoryUrl}${version}.${role}`;
        }
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
        }
        return response;
      }
      validateMetadata(metadata) {
        const seenKeyIds = /* @__PURE__ */ new Set();
        for (const sig of metadata.signatures) {
          if (seenKeyIds.has(sig.keyid)) {
            throw new Error(`Duplicate signature found for keyid: ${sig.keyid}`);
          }
          seenKeyIds.add(sig.keyid);
        }
        const specVersion = metadata.signed.spec_version;
        if (!specVersion) {
          throw new Error("spec_version is required");
        }
        const parts = specVersion.split(".");
        if (parts.length < 2 || parts.length > 3) {
          throw new Error(`Invalid spec_version format: ${specVersion}`);
        }
        if (!parts.every((p) => /^\d+$/.test(p))) {
          throw new Error(`spec_version parts must be numeric: ${specVersion}`);
        }
        if (parts[0] !== "1") {
          throw new Error(`Unsupported spec_version major version: ${parts[0]} (expected 1)`);
        }
      }
      async fetchMetafileJson(role, version = -1) {
        const response = await this.fetchMetafileBase(role, version);
        const metadata = await response.json();
        this.validateMetadata(metadata);
        return metadata;
      }
      async fetchMetafileBinary(role, version = -1, target = false) {
        const response = await this.fetchMetafileBase(role, version, target);
        return new Uint8Array(await response.arrayBuffer());
      }
      bootstrapRoot(file) {
        try {
          const metadata = JSON.parse(file);
          this.validateMetadata(metadata);
          return metadata;
        } catch (error) {
          throw new Error(`Failed to load the JSON file:  ${error}`);
        }
      }
      async verifyHashes(data, hashes, context) {
        if (!hashes)
          return;
        const hashAlgoMap = {
          sha256: HashAlgorithms.SHA256,
          sha384: HashAlgorithms.SHA384,
          sha512: HashAlgorithms.SHA512
        };
        for (const [algo, expectedHash] of Object.entries(hashes)) {
          const cryptoAlgo = hashAlgoMap[algo];
          if (!cryptoAlgo) {
            throw new Error(`${context}: unsupported hash algorithm '${algo}'`);
          }
          const computedHash = Uint8ArrayToHex(new Uint8Array(await crypto.subtle.digest(cryptoAlgo, data)));
          if (expectedHash !== computedHash) {
            throw new Error(`${context}: ${algo} hash mismatch`);
          }
        }
      }
      // This function supports ECDSA (256, 385, 521), Ed25519 in Hex or PEM format
      // it is possible to support certain cases of RSA, but it is not really useful for now
      // Returns a mapping keyid (hexstring) -> CryptoKey object
      async loadRoot(json, oldroot) {
        if (json.signed._type !== Roles.Root) {
          throw new Error("Loading the wrong metafile as root.");
        }
        let keys;
        let threshold;
        let roleKeys;
        if (oldroot == void 0) {
          keys = await loadKeys(json.signed.keys);
          roleKeys = json.signed.roles.root.keyids;
          threshold = json.signed.roles.root.threshold;
        } else {
          keys = oldroot.keys;
          roleKeys = oldroot.roles["root"].keyids;
          threshold = oldroot.threshold;
        }
        if (await checkSignatures(keys, roleKeys, json.signed, json.signatures, threshold) !== true) {
          throw new Error("Failed to verify metafile.");
        }
        keys = await loadKeys(json.signed.keys);
        if (!Number.isSafeInteger(json.signed.version) || json.signed.version < 1) {
          throw new Error("There is something wrong with the root version number.");
        }
        for (const role of TOP_LEVEL_ROLE_NAMES) {
          if (!json.signed.roles[role]) {
            throw new Error(`Missing required top-level role: ${role}`);
          }
        }
        for (const [roleName, role] of Object.entries(json.signed.roles)) {
          const keyidSet = new Set(role.keyids);
          if (keyidSet.size !== role.keyids.length) {
            throw new Error(`Duplicate key IDs found in role: ${roleName}`);
          }
        }
        return {
          keys,
          version: json.signed.version,
          expires: new Date(json.signed.expires),
          threshold: json.signed.roles.root.threshold,
          consistent_snapshot: json.signed.consistent_snapshot,
          roles: json.signed.roles
        };
      }
      async updateRoot(frozenTimestamp) {
        let rootJson = await this.getFromCache(Roles.Root);
        if (!rootJson) {
          rootJson = await this.bootstrapRoot(this.startingRoot);
        }
        let root = await this.loadRoot(rootJson);
        const oldRoot = root;
        let newroot;
        let newrootJson;
        for (let new_version = root.version + 1; new_version < Number.MAX_SAFE_INTEGER; new_version++) {
          try {
            newrootJson = await this.fetchMetafileJson(Roles.Root, new_version);
          } catch (e) {
            if (e instanceof Error && e.message.includes("Failed to fetch")) {
              break;
            }
            throw e;
          }
          if (newrootJson.signed.version !== new_version) {
            throw new Error(`Version mismatch: URL version ${new_version} but file contains version ${newrootJson.signed.version}`);
          }
          if (newrootJson.signed?._type !== Roles.Root) {
            throw new Error("Incorrect metadata type for root.");
          }
          newroot = await this.loadRoot(newrootJson, root);
          if (newroot.version !== root.version + 1) {
            throw new Error(`Root version must be exactly ${root.version + 1}, got ${newroot.version}. Probable rollback attack.`);
          }
          newroot = await this.loadRoot(newrootJson);
          root = newroot;
          await this.setInCache(Roles.Root, newrootJson);
        }
        if (root.expires <= frozenTimestamp) {
          throw new Error("Freeze attack on the root metafile.");
        }
        if (root.version > oldRoot.version) {
          const timestampKeysChanged = JSON.stringify(root.roles.timestamp.keyids.sort()) !== JSON.stringify(oldRoot.roles.timestamp.keyids.sort());
          const snapshotKeysChanged = JSON.stringify(root.roles.snapshot.keyids.sort()) !== JSON.stringify(oldRoot.roles.snapshot.keyids.sort());
          const targetsKeysChanged = JSON.stringify(root.roles.targets.keyids.sort()) !== JSON.stringify(oldRoot.roles.targets.keyids.sort());
          if (timestampKeysChanged) {
            await this.backend.delete(this.getCacheKey(Roles.Timestamp));
            await this.backend.delete(this.getCacheKey(Roles.Snapshot));
            await this.backend.delete(this.getCacheKey(Roles.Targets));
          }
          if (snapshotKeysChanged) {
            await this.backend.delete(this.getCacheKey(Roles.Snapshot));
            await this.backend.delete(this.getCacheKey(Roles.Targets));
          }
          if (targetsKeysChanged) {
            await this.backend.delete(this.getCacheKey(Roles.Targets));
          }
        }
        return root;
      }
      async updateTimestamp(root, frozenTimestamp) {
        const keys = getRoleKeys(root.keys, root.roles.timestamp.keyids);
        if (keys.size < 1) {
          throw new Error("No valid keys found for the timestamp role.");
        }
        const cachedTimestamp = await this.getFromCache(Roles.Timestamp);
        const newTimestampRaw = await this.fetchMetafileBinary(Roles.Timestamp, -1);
        const newTimestamp = JSON.parse(Uint8ArrayToString(newTimestampRaw));
        this.validateMetadata(newTimestamp);
        if (newTimestamp.signed._type !== Roles.Timestamp) {
          throw new Error(`Invalid metadata type: expected ${Roles.Timestamp}, got ${newTimestamp.signed._type}`);
        }
        if (!newTimestamp.signed.meta || !newTimestamp.signed.meta["snapshot.json"]) {
          throw new Error("Timestamp metadata missing required meta['snapshot.json']");
        }
        if (await checkSignatures(keys, root.roles["timestamp"].keyids, newTimestamp.signed, newTimestamp.signatures, root.roles.timestamp.threshold) !== true) {
          throw new Error("Failed verifying timestamp role signature(s).");
        }
        if (cachedTimestamp !== void 0) {
          if (newTimestamp.signed.version < cachedTimestamp.signed.version) {
            throw new Error("New timestamp file has a lower version that the currently cached one.");
          }
          if (newTimestamp.signed.version == cachedTimestamp.signed.version) {
            return null;
          }
          if (newTimestamp.signed.meta["snapshot.json"].version < cachedTimestamp.signed.meta["snapshot.json"].version) {
            throw new Error("Timestamp has been updated, but snapshot version has been rolled back.");
          }
        }
        if (new Date(newTimestamp.signed.expires) <= frozenTimestamp) {
          throw new Error("Freeze attack on the timestamp metafile.");
        }
        await this.backend.writeRaw(this.getCacheKey(Roles.Timestamp), newTimestampRaw);
        return newTimestamp;
      }
      async updateSnapshot(root, frozenTimestamp, timestampMeta) {
        const version = timestampMeta.signed.meta["snapshot.json"].version;
        const keys = getRoleKeys(root.keys, root.roles.snapshot.keyids);
        const cachedSnapshot = await this.getFromCache(Roles.Snapshot);
        let newSnapshotRaw;
        if (root.consistent_snapshot) {
          newSnapshotRaw = await this.fetchMetafileBinary(Roles.Snapshot, version);
        } else {
          newSnapshotRaw = await this.fetchMetafileBinary(Roles.Snapshot, -1);
        }
        const snapshotMeta = timestampMeta.signed.meta["snapshot.json"];
        if (snapshotMeta.length !== void 0) {
          if (newSnapshotRaw.length !== snapshotMeta.length) {
            throw new Error(`Snapshot length mismatch: expected ${snapshotMeta.length}, got ${newSnapshotRaw.length}`);
          }
        }
        await this.verifyHashes(newSnapshotRaw, snapshotMeta.hashes, "Snapshot");
        const newSnapshot = JSON.parse(Uint8ArrayToString(newSnapshotRaw));
        this.validateMetadata(newSnapshot);
        if (newSnapshot.signed._type !== Roles.Snapshot) {
          throw new Error(`Invalid metadata type: expected ${Roles.Snapshot}, got ${newSnapshot.signed._type}`);
        }
        if (!newSnapshot.signed.meta || !newSnapshot.signed.meta["targets.json"]) {
          throw new Error("Snapshot metadata missing required meta['targets.json']");
        }
        if (await checkSignatures(keys, root.roles["snapshot"].keyids, newSnapshot.signed, newSnapshot.signatures, root.roles.snapshot.threshold) !== true) {
          throw new Error("Failed verifying snapshot role signature(s).");
        }
        if (newSnapshot.signed.version !== version) {
          throw new Error(`Snapshot version mismatch: URL version ${version} but file contains version ${newSnapshot.signed.version}`);
        }
        if (cachedSnapshot !== void 0) {
          for (const [target] of Object.entries(cachedSnapshot.signed.meta)) {
            if (target in newSnapshot.signed.meta !== true) {
              throw new Error("Target that was listed in an older snapshot was dropped in a newer one.");
            }
            if (newSnapshot.signed.meta[target].version < cachedSnapshot.signed.meta[target].version) {
              throw new Error("Target version in newer snapshot is lower than the cached one. Probable rollback attack.");
            }
          }
        }
        if (new Date(newSnapshot.signed.expires) <= frozenTimestamp) {
          throw new Error("Freeze attack on the snapshot metafile.");
        }
        await this.backend.writeRaw(this.getCacheKey(Roles.Snapshot), newSnapshotRaw);
        return newSnapshot.signed.meta;
      }
      async updateTargets(root, frozenTimestamp, snapshot) {
        const keys = getRoleKeys(root.keys, root.roles.targets.keyids);
        const cachedTargets = await this.getFromCache(Roles.Targets);
        let newTargetsRaw;
        if (root.consistent_snapshot) {
          newTargetsRaw = await this.fetchMetafileBinary(Roles.Targets, snapshot[`${Roles.Targets}.json`].version);
        } else {
          newTargetsRaw = await this.fetchMetafileBinary(Roles.Targets, -1);
        }
        const targetsMeta = snapshot[`${Roles.Targets}.json`];
        if (targetsMeta.length !== void 0) {
          if (newTargetsRaw.length !== targetsMeta.length) {
            throw new Error(`Targets length mismatch: expected ${targetsMeta.length}, got ${newTargetsRaw.length}`);
          }
        }
        await this.verifyHashes(newTargetsRaw, targetsMeta.hashes, "Targets");
        const newTargets = JSON.parse(Uint8ArrayToString(newTargetsRaw));
        this.validateMetadata(newTargets);
        if (newTargets.signed._type !== Roles.Targets) {
          throw new Error(`Invalid metadata type: expected ${Roles.Targets}, got ${newTargets.signed._type}`);
        }
        if (await checkSignatures(keys, root.roles["targets"].keyids, newTargets.signed, newTargets.signatures, root.roles.targets.threshold) !== true) {
          throw new Error(`Failed verifying targets role.`);
        }
        const expectedVersion = snapshot[`${Roles.Targets}.json`].version;
        if (newTargets.signed.version !== expectedVersion) {
          throw new Error(`Targets version mismatch: URL version ${expectedVersion} but file contains version ${newTargets.signed.version}`);
        }
        if (cachedTargets !== void 0 && newTargets.signed.version < cachedTargets.signed.version) {
          throw new Error("Targets version is lower than the cached one. Probable rollback attack.");
        }
        if (new Date(newTargets.signed.expires) <= frozenTimestamp) {
          throw new Error("Freeze attack on the targets metafile.");
        }
        await this.backend.writeRaw(this.getCacheKey(Roles.Targets), newTargetsRaw);
      }
      async listSignedTargets() {
        const cachedTargets = await this.getFromCache(Roles.Targets);
        const filenames = [];
        if (cachedTargets) {
          for (const filename of Object.keys(cachedTargets.signed.targets)) {
            filenames.push(filename);
          }
        }
        return filenames;
      }
      async fetchTarget(name) {
        const cachedTargets = await this.getFromCache(Roles.Targets);
        if (cachedTargets === void 0) {
          throw new Error("Failed to find the targets metafile when it should have existed.");
        }
        if (!(name in cachedTargets.signed.targets)) {
          throw new Error(`${name} not present in the targets role.`);
        }
        const targetInfo = cachedTargets.signed.targets[name];
        const targetHashes = targetInfo.hashes;
        let hashForUrl;
        if (targetHashes.sha256) {
          hashForUrl = targetHashes.sha256;
        } else if (targetHashes.sha512) {
          hashForUrl = targetHashes.sha512;
        } else {
          throw new Error(`No supported hash algorithm found for ${name}. Available: ${Object.keys(targetHashes).join(", ")}`);
        }
        const lastSlash = name.lastIndexOf("/");
        const targetUrl = lastSlash === -1 ? `${this.targetBaseUrl}${hashForUrl}.${name}` : `${this.targetBaseUrl}${name.substring(0, lastSlash + 1)}${hashForUrl}.${name.substring(lastSlash + 1)}`;
        const response = await fetch(targetUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch target: ${response.status} ${response.statusText}`);
        }
        const raw_file = new Uint8Array(await response.arrayBuffer());
        if (raw_file.byteLength !== targetInfo.length) {
          throw new Error(`${name} length mismatch: expected ${targetInfo.length}, got ${raw_file.byteLength}`);
        }
        await this.verifyHashes(raw_file, targetHashes, `Target '${name}'`);
        return raw_file.buffer;
      }
      async updateTUF() {
        const frozenTimestamp = /* @__PURE__ */ new Date();
        const root = await this.updateRoot(frozenTimestamp);
        const timestampMeta = await this.updateTimestamp(root, frozenTimestamp);
        if (timestampMeta === null) {
          return;
        }
        const snapshot = await this.updateSnapshot(root, frozenTimestamp, timestampMeta);
        await this.updateTargets(root, frozenTimestamp, snapshot);
      }
      async getTarget(name) {
        return await this.fetchTarget(name);
      }
    };
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/trust/tuf-root.js
var tuf_root_exports = {};
__export(tuf_root_exports, {
  default: () => tuf_root_default
});
var tuf_root_default;
var init_tuf_root = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/trust/tuf-root.js"() {
    tuf_root_default = "ewogInNpZ25hdHVyZXMiOiBbCiAgewogICAia2V5aWQiOiAiNmYyNjAwODlkNTkyM2RhZjIwMTY2Y2E2NTdjNTQzYWY2MTgzNDZhYjk3MTg4NGE5OTk2MmIwMTk4OGJiZTBjMyIsCiAgICJzaWciOiAiIgogIH0sCiAgewogICAia2V5aWQiOiAiZTcxYTU0ZDU0MzgzNWJhODZhZGFkOTQ2MDM3OWM3NjQxZmI4NzI2ZDE2NGVhNzY2ODAxYTFjNTIyYWJhN2VhMiIsCiAgICJzaWciOiAiMzA0NTAyMjEwMGJiZGRkNDY0ZjgwNjZjZWI4OGJhNzg3Mzc1YzEyY2Q2MzMwNjgwZTA4YzI5MTA3MDNlNjUzOGM3MWNjNzlhZDIwMjIwNTE5MGIwNmU0NTM3ZmU5NjFiM2VmODFmZTY4ZWRjZDAwODljMTlmOTE5YWZlZDQyM2I5YWFmZDcwMDY0MTE1MyIKICB9LAogIHsKICAgImtleWlkIjogIjIyZjRjYWVjNmQ4ZTZmOTU1NWFmNjZiM2Q0YzNjYjA2YTNiYjIzZmRjN2UzOWM5MTZjNjFmNDYyZTZmNTJiMDYiLAogICAic2lnIjogIjMwNDQwMjIwNjkzMDZjZDUyNTdmNzMyYTc0MGMxYWZlNjBhOGU0MzNjNWRlNThlYWZlYWRiZTk5YzMzNmM5YzcxZDE5OGNmODAyMjAwZDc3Mzk1M2FlN2RiYzQ4ZDNlNWJhZDlhNmY2NGJhZmZmMTk2YjdlMmFkNGE1MmExOTUxOTM2N2Q0N2RjMDQyIgogIH0sCiAgewogICAia2V5aWQiOiAiNjE2NDM4MzgxMjViNDQwYjQwZGI2OTQyZjVjYjVhMzFjMGRjMDQzNjgzMTZlYjJhYWE1OGI5NTkwNGE1ODIyMiIsCiAgICJzaWciOiAiMzA0NDAyMjA0ZDIxYTJlYzgwZGY2NmU2MWY2ZmUyOTEyOTUxZGM0N2RmODM2MDM2ZjhjMGFiMTA4MTZkMzc1ZTcxZGJmNzllMDIyMDU0N2FkY2UxYWZkZjA0ZTY3OTRlZmEyMDNkZDUyNjRjNmY3ZTBlZjc4ZTU3ZmU5MzRiMGQyNmNiOTk0ZWVjNzYiCiAgfSwKICB7CiAgICJrZXlpZCI6ICJhNjg3ZTViZjRmYWI4MmIwZWU1OGQ0NmUwNWM5NTM1MTQ1YTJjOWFmYjQ1OGY0M2Q0MmI0NWNhMGZkY2UyYTcwIiwKICAgInNpZyI6ICIzMDQ1MDIyMDYwODI2NDk2NTU3MTQ0ZWIxNjQ5ODkzZWQ1ZjZmNGVhNTQ1MzZmZWIwY2E4MmY4Yjg5YWU2NDFiZTM5NzQzZTUwMjIxMDBhZDcxMThiNWU5ZDQ4MzczMjYyMDZlNDEyZmM2ZGEyOTk5OTI1ZDExMDMyOGE3YzE2NmIwNmM2MjQzMzZjOTNmIgogIH0sCiAgewogICAia2V5aWQiOiAiMTgzZTY0ZjM3NjcwZGMxM2NhMGQyODk5NWEzMDUzZjM3NDA5NTRkZGNlNDQzMjFhNDFlNDY1MzRjZjQ0ZTYzMiIsCiAgICJzaWciOiAiMzA0NjAyMjEwMGQ4MTc5NDM5YzJlNzNlYjBjMTczM2FiZWU3ZmFmODMyZGNhZWE3MjYzZWRjYjQ5MTk4OTFjM2EyNDdmMDU5MjMwMjIxMDBlMWE0MzdlMDc5N2U4MDNmOWI3MmRjOWQyZDkyMTU1YjBhMjI3MGMyNGVmZGQ1ZjRiM2E1ZDhmMGIwZjQzMWE3IgogIH0KIF0sCiAic2lnbmVkIjogewogICJfdHlwZSI6ICJyb290IiwKICAiY29uc2lzdGVudF9zbmFwc2hvdCI6IHRydWUsCiAgImV4cGlyZXMiOiAiMjAyNi0wMS0yMlQxMzowNTo1OVoiLAogICJrZXlzIjogewogICAiMGM4NzQzMmMzYmYwOWZkOTkxODlmZGMzMmZhNWVhZWRmNGU0YTVmYWM3YmFiNzNmYTA0YTJlMGZjNjRhZjZmNSI6IHsKICAgICJrZXlpZF9oYXNoX2FsZ29yaXRobXMiOiBbCiAgICAgInNoYTI1NiIsCiAgICAgInNoYTUxMiIKICAgIF0sCiAgICAia2V5dHlwZSI6ICJlY2RzYSIsCiAgICAia2V5dmFsIjogewogICAgICJwdWJsaWMiOiAiLS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS1cbk1Ga3dFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRVdSaUdyNStqKzNKNVNzSCtadHI1bkUySDJ3TzdcbkJWK25PM3M5M2dMY2ExOHFUT3pIWTFvV3lBR0R5a01Tc0dUVUJTdDlEK0FuMEtmS3NEMm1mU000MlE9PVxuLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tXG4iCiAgICB9LAogICAgInNjaGVtZSI6ICJlY2RzYS1zaGEyLW5pc3RwMjU2IiwKICAgICJ4LXR1Zi1vbi1jaS1vbmxpbmUtdXJpIjogImdjcGttczpwcm9qZWN0cy9zaWdzdG9yZS1yb290LXNpZ25pbmcvbG9jYXRpb25zL2dsb2JhbC9rZXlSaW5ncy9yb290L2NyeXB0b0tleXMvdGltZXN0YW1wL2NyeXB0b0tleVZlcnNpb25zLzEiCiAgIH0sCiAgICIxODNlNjRmMzc2NzBkYzEzY2EwZDI4OTk1YTMwNTNmMzc0MDk1NGRkY2U0NDMyMWE0MWU0NjUzNGNmNDRlNjMyIjogewogICAgImtleXR5cGUiOiAiZWNkc2EiLAogICAgImtleXZhbCI6IHsKICAgICAicHVibGljIjogIi0tLS0tQkVHSU4gUFVCTElDIEtFWS0tLS0tXG5NRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBEQVFjRFFnQUVNeHBQT0pDSVo1b3RHNDEwNmZHSnNlRVFpM1Y5XG5wa01ZUTR1eVY5VGoxTTdXSFhJeUxHK2prZnZ1RzBnbFExSlpiUlpaQlYzZ0FSNHNvamRHSElTZW93PT1cbi0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLVxuIgogICAgfSwKICAgICJzY2hlbWUiOiAiZWNkc2Etc2hhMi1uaXN0cDI1NiIsCiAgICAieC10dWYtb24tY2kta2V5b3duZXIiOiAiQGxhbmNlIgogICB9LAogICAiMjJmNGNhZWM2ZDhlNmY5NTU1YWY2NmIzZDRjM2NiMDZhM2JiMjNmZGM3ZTM5YzkxNmM2MWY0NjJlNmY1MmIwNiI6IHsKICAgICJrZXlpZF9oYXNoX2FsZ29yaXRobXMiOiBbCiAgICAgInNoYTI1NiIsCiAgICAgInNoYTUxMiIKICAgIF0sCiAgICAia2V5dHlwZSI6ICJlY2RzYSIsCiAgICAia2V5dmFsIjogewogICAgICJwdWJsaWMiOiAiLS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS1cbk1Ga3dFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRXpCelZPbUhDUG9qTVZMU0kzNjRXaWlWOE5QckRcbjZJZ1J4Vmxpc2t6L3YreTNKRVI1bWNWR2NPTmxpRGNXTUM1SjJsZkhtalBOUGhiNEg3eG04THpmU0E9PVxuLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tXG4iCiAgICB9LAogICAgInNjaGVtZSI6ICJlY2RzYS1zaGEyLW5pc3RwMjU2IiwKICAgICJ4LXR1Zi1vbi1jaS1rZXlvd25lciI6ICJAc2FudGlhZ290b3JyZXMiCiAgIH0sCiAgICI2MTY0MzgzODEyNWI0NDBiNDBkYjY5NDJmNWNiNWEzMWMwZGMwNDM2ODMxNmViMmFhYTU4Yjk1OTA0YTU4MjIyIjogewogICAgImtleWlkX2hhc2hfYWxnb3JpdGhtcyI6IFsKICAgICAic2hhMjU2IiwKICAgICAic2hhNTEyIgogICAgXSwKICAgICJrZXl0eXBlIjogImVjZHNhIiwKICAgICJrZXl2YWwiOiB7CiAgICAgInB1YmxpYyI6ICItLS0tLUJFR0lOIFBVQkxJQyBLRVktLS0tLVxuTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFaW5pa1NzQVFtWWtOZUg1ZVlxL0NuSXpMYWFjT1xueGxTYWF3UURPd3FLeS90Q3F4cTV4eFBTSmMyMUs0V0loczlHeU9rS2Z6dWVZM0dJTHpjTUpaNGNXdz09XG4tLS0tLUVORCBQVUJMSUMgS0VZLS0tLS1cbiIKICAgIH0sCiAgICAic2NoZW1lIjogImVjZHNhLXNoYTItbmlzdHAyNTYiLAogICAgIngtdHVmLW9uLWNpLWtleW93bmVyIjogIkBib2JjYWxsYXdheSIKICAgfSwKICAgImE2ODdlNWJmNGZhYjgyYjBlZTU4ZDQ2ZTA1Yzk1MzUxNDVhMmM5YWZiNDU4ZjQzZDQyYjQ1Y2EwZmRjZTJhNzAiOiB7CiAgICAia2V5aWRfaGFzaF9hbGdvcml0aG1zIjogWwogICAgICJzaGEyNTYiLAogICAgICJzaGE1MTIiCiAgICBdLAogICAgImtleXR5cGUiOiAiZWNkc2EiLAogICAgImtleXZhbCI6IHsKICAgICAicHVibGljIjogIi0tLS0tQkVHSU4gUFVCTElDIEtFWS0tLS0tXG5NRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBEQVFjRFFnQUUwZ2hyaDkyTHcxWXIzaWRHVjVXcUN0TURCOEN4XG4rRDhoZEM0dzJaTE5JcGxWUm9WR0xza1lhM2doZU15T2ppSjhrUGkxNWFRMi8vN1Arb2o3VXZKUEd3PT1cbi0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLVxuIgogICAgfSwKICAgICJzY2hlbWUiOiAiZWNkc2Etc2hhMi1uaXN0cDI1NiIsCiAgICAieC10dWYtb24tY2kta2V5b3duZXIiOiAiQGpvc2h1YWdsIgogICB9LAogICAiZTcxYTU0ZDU0MzgzNWJhODZhZGFkOTQ2MDM3OWM3NjQxZmI4NzI2ZDE2NGVhNzY2ODAxYTFjNTIyYWJhN2VhMiI6IHsKICAgICJrZXlpZF9oYXNoX2FsZ29yaXRobXMiOiBbCiAgICAgInNoYTI1NiIsCiAgICAgInNoYTUxMiIKICAgIF0sCiAgICAia2V5dHlwZSI6ICJlY2RzYSIsCiAgICAia2V5dmFsIjogewogICAgICJwdWJsaWMiOiAiLS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS1cbk1Ga3dFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRUVYc3ozU1pYRmI4ak1WNDJqNnBKbHlqYmpSOEtcbk4zQndvY2V4cTZMTUliNXFzV0tPUXZMTjE2TlVlZkxjNEhzd09vdW1Sc1ZWYWFqU3BRUzZmb2JrUnc9PVxuLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tXG4iCiAgICB9LAogICAgInNjaGVtZSI6ICJlY2RzYS1zaGEyLW5pc3RwMjU2IiwKICAgICJ4LXR1Zi1vbi1jaS1rZXlvd25lciI6ICJAbW5tNjc4IgogICB9CiAgfSwKICAicm9sZXMiOiB7CiAgICJyb290IjogewogICAgImtleWlkcyI6IFsKICAgICAiZTcxYTU0ZDU0MzgzNWJhODZhZGFkOTQ2MDM3OWM3NjQxZmI4NzI2ZDE2NGVhNzY2ODAxYTFjNTIyYWJhN2VhMiIsCiAgICAgIjIyZjRjYWVjNmQ4ZTZmOTU1NWFmNjZiM2Q0YzNjYjA2YTNiYjIzZmRjN2UzOWM5MTZjNjFmNDYyZTZmNTJiMDYiLAogICAgICI2MTY0MzgzODEyNWI0NDBiNDBkYjY5NDJmNWNiNWEzMWMwZGMwNDM2ODMxNmViMmFhYTU4Yjk1OTA0YTU4MjIyIiwKICAgICAiYTY4N2U1YmY0ZmFiODJiMGVlNThkNDZlMDVjOTUzNTE0NWEyYzlhZmI0NThmNDNkNDJiNDVjYTBmZGNlMmE3MCIsCiAgICAgIjE4M2U2NGYzNzY3MGRjMTNjYTBkMjg5OTVhMzA1M2YzNzQwOTU0ZGRjZTQ0MzIxYTQxZTQ2NTM0Y2Y0NGU2MzIiCiAgICBdLAogICAgInRocmVzaG9sZCI6IDMKICAgfSwKICAgInNuYXBzaG90IjogewogICAgImtleWlkcyI6IFsKICAgICAiMGM4NzQzMmMzYmYwOWZkOTkxODlmZGMzMmZhNWVhZWRmNGU0YTVmYWM3YmFiNzNmYTA0YTJlMGZjNjRhZjZmNSIKICAgIF0sCiAgICAidGhyZXNob2xkIjogMSwKICAgICJ4LXR1Zi1vbi1jaS1leHBpcnktcGVyaW9kIjogMzY1MCwKICAgICJ4LXR1Zi1vbi1jaS1zaWduaW5nLXBlcmlvZCI6IDM2NQogICB9LAogICAidGFyZ2V0cyI6IHsKICAgICJrZXlpZHMiOiBbCiAgICAgImU3MWE1NGQ1NDM4MzViYTg2YWRhZDk0NjAzNzljNzY0MWZiODcyNmQxNjRlYTc2NjgwMWExYzUyMmFiYTdlYTIiLAogICAgICIyMmY0Y2FlYzZkOGU2Zjk1NTVhZjY2YjNkNGMzY2IwNmEzYmIyM2ZkYzdlMzljOTE2YzYxZjQ2MmU2ZjUyYjA2IiwKICAgICAiNjE2NDM4MzgxMjViNDQwYjQwZGI2OTQyZjVjYjVhMzFjMGRjMDQzNjgzMTZlYjJhYWE1OGI5NTkwNGE1ODIyMiIsCiAgICAgImE2ODdlNWJmNGZhYjgyYjBlZTU4ZDQ2ZTA1Yzk1MzUxNDVhMmM5YWZiNDU4ZjQzZDQyYjQ1Y2EwZmRjZTJhNzAiLAogICAgICIxODNlNjRmMzc2NzBkYzEzY2EwZDI4OTk1YTMwNTNmMzc0MDk1NGRkY2U0NDMyMWE0MWU0NjUzNGNmNDRlNjMyIgogICAgXSwKICAgICJ0aHJlc2hvbGQiOiAzCiAgIH0sCiAgICJ0aW1lc3RhbXAiOiB7CiAgICAia2V5aWRzIjogWwogICAgICIwYzg3NDMyYzNiZjA5ZmQ5OTE4OWZkYzMyZmE1ZWFlZGY0ZTRhNWZhYzdiYWI3M2ZhMDRhMmUwZmM2NGFmNmY1IgogICAgXSwKICAgICJ0aHJlc2hvbGQiOiAxLAogICAgIngtdHVmLW9uLWNpLWV4cGlyeS1wZXJpb2QiOiA3LAogICAgIngtdHVmLW9uLWNpLXNpZ25pbmctcGVyaW9kIjogNgogICB9CiAgfSwKICAic3BlY192ZXJzaW9uIjogIjEuMCIsCiAgInZlcnNpb24iOiAxMywKICAieC10dWYtb24tY2ktZXhwaXJ5LXBlcmlvZCI6IDE5NywKICAieC10dWYtb24tY2ktc2lnbmluZy1wZXJpb2QiOiA0NgogfQp9";
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/trust/tuf.js
var DEFAULT_CONFIG, TrustedRootProvider;
var init_tuf2 = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/trust/tuf.js"() {
    init_dist();
    DEFAULT_CONFIG = {
      metadataUrl: "https://tuf-repo-cdn.sigstore.dev/",
      targetBaseUrl: "https://tuf-repo-cdn.sigstore.dev/targets/",
      namespace: "tuf-cache",
      trustedRootTarget: "trusted_root.json",
      cacheTTL: 36e5
      // 1 hour
    };
    TrustedRootProvider = class {
      constructor(options = {}) {
        const metadataUrl = options.metadataUrl || DEFAULT_CONFIG.metadataUrl;
        this.metadataUrl = metadataUrl.endsWith("/") ? metadataUrl : `${metadataUrl}/`;
        const targetBaseUrl = options.targetBaseUrl || DEFAULT_CONFIG.targetBaseUrl;
        this.targetBaseUrl = targetBaseUrl.endsWith("/") ? targetBaseUrl : `${targetBaseUrl}/`;
        this.initialRoot = options.initialRoot;
        this.namespace = options.namespace || DEFAULT_CONFIG.namespace;
        this.trustedRootTarget = options.trustedRootTarget || DEFAULT_CONFIG.trustedRootTarget;
        this.cacheTTL = options.cacheTTL ?? DEFAULT_CONFIG.cacheTTL;
        this.disableCache = options.disableCache ?? false;
      }
      /**
       * Initialize the TUF client
       * Lazy initialization to avoid loading TUF client until needed
       */
      async initTUFClient() {
        if (this.tufClient) {
          return;
        }
        try {
          const { TUFClient: TUFClient2 } = await Promise.resolve().then(() => (init_tuf(), tuf_exports));
          const rootMetadata = this.initialRoot || await this.getDefaultRoot();
          this.tufClient = new TUFClient2(this.metadataUrl, rootMetadata, this.namespace, this.targetBaseUrl, { disableCache: this.disableCache });
        } catch (error) {
          throw new Error(`Failed to initialize TUF client: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      /**
       * Get the default embedded root metadata
       * Returns the TUF root.json that bootstraps the TUF client
       */
      async getDefaultRoot() {
        const { default: tufRootBase64 } = await Promise.resolve().then(() => (init_tuf_root(), tuf_root_exports));
        const decoder = new TextDecoder();
        const rootBytes = Uint8Array.from(atob(tufRootBase64), (c) => c.charCodeAt(0));
        return decoder.decode(rootBytes);
      }
      /**
       * Check if cached trusted root is still valid
       */
      isCacheValid() {
        if (!this.cachedRoot || !this.cacheTimestamp) {
          return false;
        }
        const now = Date.now();
        return now - this.cacheTimestamp < this.cacheTTL;
      }
      /**
       * Get the Sigstore trusted root metadata
       * Uses TUF to securely fetch and verify the trusted root
       *
       * @returns Promise<TrustedRoot> The verified trusted root metadata
       * @throws Error if TUF verification fails or root cannot be fetched
       */
      async getTrustedRoot() {
        if (this.isCacheValid() && this.cachedRoot) {
          return this.cachedRoot;
        }
        await this.initTUFClient();
        if (!this.tufClient) {
          throw new Error("TUF client not initialized");
        }
        try {
          await this.tufClient.updateTUF();
          const trustedRootBuffer = await this.tufClient.getTarget(this.trustedRootTarget);
          const trustedRootJson = Uint8ArrayToString(new Uint8Array(trustedRootBuffer));
          const trustedRoot = JSON.parse(trustedRootJson);
          this.cachedRoot = trustedRoot;
          this.cacheTimestamp = Date.now();
          return trustedRoot;
        } catch (error) {
          throw new Error(`Failed to fetch trusted root via TUF: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      /**
       * Manually refresh the trusted root from TUF
       * Bypasses cache and forces a fresh fetch
       *
       * @returns Promise<TrustedRoot> The updated trusted root metadata
       */
      async refreshTrustedRoot() {
        this.cachedRoot = void 0;
        this.cacheTimestamp = void 0;
        return await this.getTrustedRoot();
      }
      /**
       * Clear the cached trusted root
       * Next call to getTrustedRoot() will fetch fresh data
       */
      clearCache() {
        this.cachedRoot = void 0;
        this.cacheTimestamp = void 0;
      }
    };
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/errors.js
var VerificationError, TimestampError, CertificateError, TLogError, SignatureError, PolicyError;
var init_errors2 = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/errors.js"() {
    VerificationError = class _VerificationError extends Error {
      constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "VerificationError";
        Object.setPrototypeOf(this, _VerificationError.prototype);
      }
    };
    TimestampError = class _TimestampError extends VerificationError {
      constructor(message) {
        super("TIMESTAMP_ERROR", message);
        this.name = "TimestampError";
        Object.setPrototypeOf(this, _TimestampError.prototype);
      }
    };
    CertificateError = class _CertificateError extends VerificationError {
      constructor(message) {
        super("CERTIFICATE_ERROR", message);
        this.name = "CertificateError";
        Object.setPrototypeOf(this, _CertificateError.prototype);
      }
    };
    TLogError = class _TLogError extends VerificationError {
      constructor(message) {
        super("TLOG_ERROR", message);
        this.name = "TLogError";
        Object.setPrototypeOf(this, _TLogError.prototype);
      }
    };
    SignatureError = class _SignatureError extends VerificationError {
      constructor(message) {
        super("SIGNATURE_ERROR", message);
        this.name = "SignatureError";
        Object.setPrototypeOf(this, _SignatureError.prototype);
      }
    };
    PolicyError = class _PolicyError extends VerificationError {
      constructor(message) {
        super("POLICY_ERROR", message);
        this.name = "PolicyError";
        Object.setPrototypeOf(this, _PolicyError.prototype);
      }
    };
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/policy.js
var GITHUB_OIDC_ISSUER, SingleX509ExtPolicyV1, SingleX509ExtPolicyV2, OIDCIssuer, GitHubWorkflowTrigger, GitHubWorkflowSHA, GitHubWorkflowName, GitHubWorkflowRepository, GitHubWorkflowRef, OIDCIssuerV2, OIDCBuildSignerURI, OIDCBuildSignerDigest, OIDCRunnerEnvironment, OIDCSourceRepositoryURI, OIDCSourceRepositoryDigest, OIDCSourceRepositoryRef, OIDCSourceRepositoryIdentifier, OIDCSourceRepositoryOwnerURI, OIDCSourceRepositoryOwnerIdentifier, OIDCBuildConfigURI, OIDCBuildConfigDigest, OIDCBuildTrigger, OIDCRunInvocationURI, OIDCSourceRepositoryVisibility, AnyOf, AllOf, Identity2;
var init_policy = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/policy.js"() {
    init_errors2();
    init_cert();
    GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
    SingleX509ExtPolicyV1 = class {
      constructor(value) {
        this.expectedValue = value;
      }
      verify(cert) {
        const extValue = this.getExtensionValue(cert);
        if (extValue === void 0) {
          throw new PolicyError(`Certificate does not contain ${this.name} (${this.oid}) extension`);
        }
        if (extValue !== this.expectedValue) {
          throw new PolicyError(`Certificate's ${this.name} does not match (got '${extValue}', expected '${this.expectedValue}')`);
        }
      }
    };
    SingleX509ExtPolicyV2 = class extends SingleX509ExtPolicyV1 {
    };
    OIDCIssuer = class extends SingleX509ExtPolicyV1 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_FULCIO_ISSUER_V1;
        this.name = "OIDCIssuer";
      }
      getExtensionValue(cert) {
        return cert.extFulcioIssuerV1?.issuer;
      }
    };
    GitHubWorkflowTrigger = class extends SingleX509ExtPolicyV1 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_GITHUB_WORKFLOW_TRIGGER;
        this.name = "GitHubWorkflowTrigger";
      }
      getExtensionValue(cert) {
        return cert.extGitHubWorkflowTrigger?.workflowTrigger;
      }
    };
    GitHubWorkflowSHA = class extends SingleX509ExtPolicyV1 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_GITHUB_WORKFLOW_SHA;
        this.name = "GitHubWorkflowSHA";
      }
      getExtensionValue(cert) {
        return cert.extGitHubWorkflowSHA?.workflowSHA;
      }
    };
    GitHubWorkflowName = class extends SingleX509ExtPolicyV1 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_GITHUB_WORKFLOW_NAME;
        this.name = "GitHubWorkflowName";
      }
      getExtensionValue(cert) {
        return cert.extGitHubWorkflowName?.workflowName;
      }
    };
    GitHubWorkflowRepository = class extends SingleX509ExtPolicyV1 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_GITHUB_WORKFLOW_REPOSITORY;
        this.name = "GitHubWorkflowRepository";
      }
      getExtensionValue(cert) {
        return cert.extGitHubWorkflowRepository?.workflowRepository;
      }
    };
    GitHubWorkflowRef = class extends SingleX509ExtPolicyV1 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_GITHUB_WORKFLOW_REF;
        this.name = "GitHubWorkflowRef";
      }
      getExtensionValue(cert) {
        return cert.extGitHubWorkflowRef?.workflowRef;
      }
    };
    OIDCIssuerV2 = class extends SingleX509ExtPolicyV2 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_FULCIO_ISSUER_V2;
        this.name = "OIDCIssuerV2";
      }
      getExtensionValue(cert) {
        return cert.extFulcioIssuerV2?.issuer;
      }
    };
    OIDCBuildSignerURI = class extends SingleX509ExtPolicyV2 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_BUILD_SIGNER_URI;
        this.name = "OIDCBuildSignerURI";
      }
      getExtensionValue(cert) {
        return cert.extBuildSignerURI?.buildSignerURI;
      }
    };
    OIDCBuildSignerDigest = class extends SingleX509ExtPolicyV2 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_BUILD_SIGNER_DIGEST;
        this.name = "OIDCBuildSignerDigest";
      }
      getExtensionValue(cert) {
        return cert.extBuildSignerDigest?.buildSignerDigest;
      }
    };
    OIDCRunnerEnvironment = class extends SingleX509ExtPolicyV2 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_RUNNER_ENVIRONMENT;
        this.name = "OIDCRunnerEnvironment";
      }
      getExtensionValue(cert) {
        return cert.extRunnerEnvironment?.runnerEnvironment;
      }
    };
    OIDCSourceRepositoryURI = class extends SingleX509ExtPolicyV2 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_SOURCE_REPOSITORY_URI;
        this.name = "OIDCSourceRepositoryURI";
      }
      getExtensionValue(cert) {
        return cert.extSourceRepositoryURI?.sourceRepositoryURI;
      }
    };
    OIDCSourceRepositoryDigest = class extends SingleX509ExtPolicyV2 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_SOURCE_REPOSITORY_DIGEST;
        this.name = "OIDCSourceRepositoryDigest";
      }
      getExtensionValue(cert) {
        return cert.extSourceRepositoryDigest?.sourceRepositoryDigest;
      }
    };
    OIDCSourceRepositoryRef = class extends SingleX509ExtPolicyV2 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_SOURCE_REPOSITORY_REF;
        this.name = "OIDCSourceRepositoryRef";
      }
      getExtensionValue(cert) {
        return cert.extSourceRepositoryRef?.sourceRepositoryRef;
      }
    };
    OIDCSourceRepositoryIdentifier = class extends SingleX509ExtPolicyV2 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_SOURCE_REPOSITORY_IDENTIFIER;
        this.name = "OIDCSourceRepositoryIdentifier";
      }
      getExtensionValue(cert) {
        return cert.extSourceRepositoryIdentifier?.sourceRepositoryIdentifier;
      }
    };
    OIDCSourceRepositoryOwnerURI = class extends SingleX509ExtPolicyV2 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_SOURCE_REPOSITORY_OWNER_URI;
        this.name = "OIDCSourceRepositoryOwnerURI";
      }
      getExtensionValue(cert) {
        return cert.extSourceRepositoryOwnerURI?.sourceRepositoryOwnerURI;
      }
    };
    OIDCSourceRepositoryOwnerIdentifier = class extends SingleX509ExtPolicyV2 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_SOURCE_REPOSITORY_OWNER_IDENTIFIER;
        this.name = "OIDCSourceRepositoryOwnerIdentifier";
      }
      getExtensionValue(cert) {
        return cert.extSourceRepositoryOwnerIdentifier?.sourceRepositoryOwnerIdentifier;
      }
    };
    OIDCBuildConfigURI = class extends SingleX509ExtPolicyV2 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_BUILD_CONFIG_URI;
        this.name = "OIDCBuildConfigURI";
      }
      getExtensionValue(cert) {
        return cert.extBuildConfigURI?.buildConfigURI;
      }
    };
    OIDCBuildConfigDigest = class extends SingleX509ExtPolicyV2 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_BUILD_CONFIG_DIGEST;
        this.name = "OIDCBuildConfigDigest";
      }
      getExtensionValue(cert) {
        return cert.extBuildConfigDigest?.buildConfigDigest;
      }
    };
    OIDCBuildTrigger = class extends SingleX509ExtPolicyV2 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_BUILD_TRIGGER;
        this.name = "OIDCBuildTrigger";
      }
      getExtensionValue(cert) {
        return cert.extBuildTrigger?.buildTrigger;
      }
    };
    OIDCRunInvocationURI = class extends SingleX509ExtPolicyV2 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_RUN_INVOCATION_URI;
        this.name = "OIDCRunInvocationURI";
      }
      getExtensionValue(cert) {
        return cert.extRunInvocationURI?.runInvocationURI;
      }
    };
    OIDCSourceRepositoryVisibility = class extends SingleX509ExtPolicyV2 {
      constructor() {
        super(...arguments);
        this.oid = EXTENSION_OID_SOURCE_REPOSITORY_VISIBILITY;
        this.name = "OIDCSourceRepositoryVisibility";
      }
      getExtensionValue(cert) {
        return cert.extSourceRepositoryVisibility?.sourceRepositoryVisibility;
      }
    };
    AnyOf = class {
      constructor(children) {
        this.children = children;
      }
      verify(cert) {
        for (const child of this.children) {
          try {
            child.verify(cert);
            return;
          } catch {
          }
        }
        throw new PolicyError(`0 of ${this.children.length} policies succeeded`);
      }
    };
    AllOf = class {
      constructor(children) {
        this.children = children;
      }
      verify(cert) {
        if (this.children.length < 1) {
          throw new PolicyError("no child policies to verify");
        }
        for (const child of this.children) {
          child.verify(cert);
        }
      }
    };
    Identity2 = class {
      constructor(options) {
        this.identity = options.identity;
        this.issuerPolicy = options.issuer ? new OIDCIssuer(options.issuer) : null;
      }
      verify(cert) {
        if (this.issuerPolicy) {
          this.issuerPolicy.verify(cert);
        }
        const sanExt = cert.extSubjectAltName;
        if (!sanExt) {
          throw new PolicyError("Certificate does not contain SubjectAlternativeName extension");
        }
        const allSans = /* @__PURE__ */ new Set();
        if (sanExt.rfc822Name) {
          allSans.add(sanExt.rfc822Name);
        }
        if (sanExt.uri) {
          allSans.add(sanExt.uri);
        }
        const otherName = sanExt.otherName(EXTENSION_OID_OTHERNAME);
        if (otherName) {
          allSans.add(otherName);
        }
        if (!allSans.has(this.identity)) {
          throw new PolicyError(`Certificate's SANs do not match ${this.identity}; actual SANs: ${Array.from(allSans).join(", ")}`);
        }
      }
    };
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/sigstore.js
function getBundleVersion(mediaType) {
  switch (mediaType) {
    case `${MEDIA_TYPE_BASE}+json;version=0.1`:
      return "0.1";
    case `${MEDIA_TYPE_BASE}+json;version=0.2`:
      return "0.2";
    case `${MEDIA_TYPE_BASE}+json;version=0.3`:
      return "0.3";
  }
  if (mediaType.startsWith(`${MEDIA_TYPE_BASE}.v`) && mediaType.endsWith("+json")) {
    const version = mediaType.replace(`${MEDIA_TYPE_BASE}.v`, "").replace("+json", "");
    if (/^\d+\.\d+(\.\d+)?$/.test(version)) {
      return version;
    }
  }
  return "0.1";
}
function assertRekorV2Timestamp(timestampData) {
  if (!timestampData?.rfc3161Timestamps?.length) {
    throw new Error("Rekor v2 bundles require a timestamp for verification.");
  }
}
var MEDIA_TYPE_BASE, SigstoreVerifier;
var init_sigstore = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/sigstore.js"() {
    init_dist();
    init_interfaces2();
    init_x509();
    init_dsse();
    init_interfaces2();
    init_merkle();
    init_checkpoint();
    init_body();
    init_tsa();
    init_tuf2();
    init_policy();
    MEDIA_TYPE_BASE = "application/vnd.dev.sigstore.bundle";
    SigstoreVerifier = class {
      constructor(options = {}) {
        this.root = void 0;
        this.rawRoot = void 0;
        this.options = {
          tlogThreshold: options.tlogThreshold ?? 1,
          ctlogThreshold: options.ctlogThreshold ?? 1,
          tsaThreshold: options.tsaThreshold ?? 0
        };
      }
      async loadLog(frozenTimestamp, logs) {
        for (const log of logs) {
          if (frozenTimestamp > new Date(log.publicKey.validFor.start) && (!log.publicKey.validFor.end || new Date(log.publicKey.validFor.end) > frozenTimestamp)) {
            return {
              publicKey: await importKey(log.publicKey.keyDetails, log.publicKey.keyDetails, log.publicKey.rawBytes),
              logId: base64ToUint8Array(log.logId.keyId)
            };
          }
        }
        return void 0;
      }
      async loadCTLogs(frozenTimestamp, ctlogs) {
        const result = [];
        for (const log of ctlogs) {
          const start = new Date(log.publicKey.validFor.start);
          const end = log.publicKey.validFor.end ? new Date(log.publicKey.validFor.end) : /* @__PURE__ */ new Date("9999-12-31");
          if (start <= frozenTimestamp) {
            const publicKey = await importKey(log.publicKey.keyDetails, log.publicKey.keyDetails, log.publicKey.rawBytes);
            result.push({
              logID: base64ToUint8Array(log.logId.keyId),
              publicKey,
              validFor: { start, end }
            });
          }
        }
        if (result.length === 0) {
          throw new Error("Could not find any valid CT logs in sigstore root.");
        }
        return result;
      }
      // Adapted from https://github.com/sigstore/sigstore-js/blob/main/packages/verify/src/key/certificate.ts#L22-L53
      // Verifies that the leaf certificate chains to a trusted CA and is valid at the given timestamp.
      // Differences from sigstore-js:
      // - This is async (uses await) because our CertificateChainVerifier.verify() is async
      // - sigstore-js filters CAs using filterCertAuthorities() before calling this function,
      //   we do the timestamp filtering inline within this function
      async verifyCertificateChain(timestamp, leaf, certificateAuthorities) {
        let lastError;
        for (const ca of certificateAuthorities) {
          if (timestamp < ca.validFor.start || timestamp > ca.validFor.end) {
            continue;
          }
          try {
            const verifier = new CertificateChainVerifier({
              trustedCerts: ca.certChain,
              untrustedCert: leaf,
              timestamp
            });
            return await verifier.verify();
          } catch (err) {
            lastError = err;
          }
        }
        throw new Error(`Failed to verify certificate chain: ${lastError?.message || "No valid CAs found"}`);
      }
      // Load timestamp authorities that are valid at the frozen timestamp.
      // Unlike sigstore-js which doesn't pre-load TSAs (it passes raw TSA data to timestamp verification),
      // we parse and filter them at initialization time for consistency with how we handle CAs and other roots.
      loadTSA(frozenTimestamp, tsas) {
        if (!tsas || tsas.length === 0) {
          return [];
        }
        const result = [];
        for (const tsa of tsas) {
          const start = new Date(tsa.validFor.start);
          const end = tsa.validFor.end ? new Date(tsa.validFor.end) : /* @__PURE__ */ new Date(864e13);
          if (frozenTimestamp > start && frozenTimestamp < end) {
            const certChain = tsa.certChain.certificates.map((cert) => X509Certificate.parse(base64ToUint8Array(cert.rawBytes)));
            if (certChain.length > 0) {
              result.push({
                certChain,
                validFor: { start, end }
              });
            }
          }
        }
        return result;
      }
      // Load certificate authorities (Fulcio CAs) that are valid at the frozen timestamp.
      // Similar to sigstore-js's filterCertAuthorities() in trust/filter.ts, but we also
      // parse the certificates at load time whereas sigstore-js keeps them in the trust material
      // and parses them during verification. This pre-loading approach is consistent with our
      // architecture of loading all trusted roots at initialization.
      loadCA(frozenTimestamp, cas) {
        const result = [];
        for (const ca of cas) {
          const start = new Date(ca.validFor.start);
          const end = ca.validFor.end ? new Date(ca.validFor.end) : /* @__PURE__ */ new Date(864e13);
          if (frozenTimestamp > start && frozenTimestamp < end) {
            const certChain = ca.certChain.certificates.map((cert) => X509Certificate.parse(base64ToUint8Array(cert.rawBytes)));
            if (certChain.length > 0) {
              result.push({
                certChain,
                validFor: { start, end }
              });
            }
          }
        }
        return result;
      }
      async loadSigstoreRoot(rawRoot) {
        const frozenTimestamp = /* @__PURE__ */ new Date();
        this.rawRoot = rawRoot;
        this.root = {
          rekor: await this.loadLog(frozenTimestamp, rawRoot[SigstoreRoots.tlogs]),
          ctlogs: await this.loadCTLogs(frozenTimestamp, rawRoot[SigstoreRoots.ctlogs]),
          certificateAuthorities: this.loadCA(frozenTimestamp, rawRoot[SigstoreRoots.certificateAuthorities]),
          timestampAuthorities: this.loadTSA(frozenTimestamp, rawRoot.timestampAuthorities)
        };
      }
      /**
       * Load Sigstore trusted root via TUF
       * Uses The Update Framework for secure, verified updates of trusted root metadata
       *
       * @param tufProvider Optional TrustedRootProvider instance. If not provided, uses default Sigstore TUF repository
       */
      async loadSigstoreRootWithTUF(tufProvider) {
        const provider = tufProvider || new TrustedRootProvider();
        const trustedRoot = await provider.getTrustedRoot();
        await this.loadSigstoreRoot(trustedRoot);
      }
      // Adapted from https://github.com/sigstore/sigstore-js/blob/main/packages/verify/src/key/sct.ts
      // Key differences:
      // - Adds duplicate SCT detection (not in reference)
      // - Inline CT log filtering by logID and validity period (reference uses filterTLogAuthorities)
      // - Returns array of verified SCT logIDs for threshold checking (matches reference behavior)
      async verifySCT(cert, issuer, ctlogs) {
        let extSCT;
        const clone = cert.clone();
        for (let i = 0; i < clone.extensions.length; i++) {
          const ext = clone.extensions[i];
          if (ext.subs[0].toOID() === EXTENSION_OID_SCT) {
            extSCT = new X509SCTExtension(ext);
            clone.extensions.splice(i, 1);
            break;
          }
        }
        if (!extSCT) {
          throw new Error("Certificate is missing required SCT extension");
        }
        if (extSCT.signedCertificateTimestamps.length === 0) {
          throw new Error("SCT extension is present but contains no SCTs");
        }
        const seenLogIds = /* @__PURE__ */ new Set();
        for (const sct of extSCT.signedCertificateTimestamps) {
          const logIdHex = Uint8ArrayToHex(sct.logID);
          if (seenLogIds.has(logIdHex)) {
            throw new Error(`Duplicate SCT found for log ID: ${logIdHex}`);
          }
          seenLogIds.add(logIdHex);
        }
        const preCert = new ByteStream();
        const issuerId = new Uint8Array(await crypto.subtle.digest(HashAlgorithms.SHA256, issuer.publicKey));
        preCert.appendView(issuerId);
        const tbs = clone.tbsCertificate.toDER();
        preCert.appendUint24(tbs.length);
        preCert.appendView(tbs);
        const verifiedSCTs = [];
        for (const sct of extSCT.signedCertificateTimestamps) {
          const validCTLogs = ctlogs.filter((log) => {
            if (!uint8ArrayEqual(log.logID, sct.logID))
              return false;
            return log.validFor.start <= sct.datetime && sct.datetime <= log.validFor.end;
          });
          const verified = await (async () => {
            for (const log of validCTLogs) {
              try {
                if (await sct.verify(preCert.buffer, log.publicKey)) {
                  return true;
                }
              } catch {
              }
            }
            return false;
          })();
          if (!verified) {
            throw new Error("SCT verification failed");
          }
          verifiedSCTs.push(sct.logID);
        }
        return verifiedSCTs;
      }
      async verifyInclusionPromise(cert, bundle, rekor) {
        const entries = bundle.verificationMaterial.tlogEntries;
        if (entries.length < this.options.tlogThreshold) {
          throw new Error(`Not enough tlog entries: ${entries.length} < ${this.options.tlogThreshold}`);
        }
        const MAX_TLOG_ENTRIES = 32;
        if (entries.length > MAX_TLOG_ENTRIES) {
          throw new Error(`Too many tlog entries: ${entries.length} > ${MAX_TLOG_ENTRIES}`);
        }
        for (let i = 0; i < entries.length; i++) {
          for (let j = i + 1; j < entries.length; j++) {
            const iLogId = Uint8ArrayToHex(base64ToUint8Array(entries[i].logId.keyId));
            const jLogId = Uint8ArrayToHex(base64ToUint8Array(entries[j].logId.keyId));
            if (iLogId === jLogId && entries[i].logIndex === entries[j].logIndex) {
              throw new Error(`Duplicate tlog entry found: logID=${iLogId}, logIndex=${entries[i].logIndex}`);
            }
          }
        }
        const entry = entries[0];
        const bundleVersion = getBundleVersion(bundle.mediaType);
        const isV02OrLater = parseFloat(bundleVersion) >= 0.2;
        if (isV02OrLater && !entry.inclusionProof) {
          throw new Error("Bundle v0.2+ requires an inclusion proof.");
        }
        if (!entry.inclusionPromise?.signedEntryTimestamp) {
          if (!entry.inclusionProof) {
            throw new Error("Bundle must have either an inclusion promise or an inclusion proof.");
          }
        } else {
          if (!rekor && entry.inclusionProof) {
          } else {
            if (!rekor) {
              throw new Error("Rekor public key not found in trusted root");
            }
            const entryLogId = base64ToUint8Array(entry.logId.keyId);
            if (!uint8ArrayEqual(rekor.logId, entryLogId)) {
              throw new Error(`Rekor log ID mismatch: bundle uses ${Uint8ArrayToHex(entryLogId)} but loaded key is for ${Uint8ArrayToHex(rekor.logId)}`);
            }
            const signature = base64ToUint8Array(entry.inclusionPromise.signedEntryTimestamp);
            const keyId = Uint8ArrayToHex(entryLogId);
            const integratedTime = Number(entry.integratedTime);
            const signed = stringToUint8Array(canonicalize({
              body: entry.canonicalizedBody,
              integratedTime,
              logIndex: Number(entry.logIndex),
              logID: keyId
            }));
            if (!await verifySignature(rekor.publicKey, signed, signature)) {
              throw new Error("Failed to verify the inclusion promise in the provided bundle.");
            }
          }
        }
        if (entry.integratedTime) {
          const integratedTime = Number(entry.integratedTime);
          const integratedDate = new Date(integratedTime * 1e3);
          if (!cert.validForDate(integratedDate)) {
            throw new Error("Artifact signing was logged outside of the certificate validity.");
          }
        } else {
          assertRekorV2Timestamp(bundle.verificationMaterial.timestampVerificationData);
        }
        const bodyJson = JSON.parse(Uint8ArrayToString(base64ToUint8Array(entry.canonicalizedBody)));
        if (bodyJson.kind === "hashedrekord") {
          let loggedCertContent;
          if (bodyJson.spec.hashedRekordV002) {
            const verifier = bodyJson.spec.hashedRekordV002.signature.verifier;
            if (verifier?.x509Certificate) {
              loggedCertContent = verifier.x509Certificate.rawBytes;
            }
          } else if (bodyJson.spec.signature?.publicKey) {
            loggedCertContent = bodyJson.spec.signature.publicKey.content;
          }
          if (loggedCertContent) {
            let loggedCert;
            if (bodyJson.spec.hashedRekordV002) {
              loggedCert = X509Certificate.parse(base64ToUint8Array(loggedCertContent));
            } else {
              const pemString = Uint8ArrayToString(base64ToUint8Array(loggedCertContent));
              loggedCert = X509Certificate.parse(pemString);
            }
            if (!cert.equals(loggedCert)) {
              throw new Error("Certificate in Rekor log does not match the signing certificate.");
            }
          }
        } else if (bodyJson.kind === "dsse") {
          const verifierContent = bodyJson.spec.signatures?.[0]?.verifier;
          if (verifierContent) {
            const pemString = Uint8ArrayToString(base64ToUint8Array(verifierContent));
            const loggedCert = X509Certificate.parse(pemString);
            if (!cert.equals(loggedCert)) {
              throw new Error("Certificate in DSSE tlog entry does not match the signing certificate.");
            }
          }
        } else if (bodyJson.kind === "intoto") {
          const publicKeyContent = bodyJson.spec.content?.envelope?.signatures?.[0]?.publicKey;
          if (publicKeyContent) {
            const pemString = Uint8ArrayToString(base64ToUint8Array(publicKeyContent));
            const loggedCert = X509Certificate.parse(pemString);
            if (!cert.equals(loggedCert)) {
              throw new Error("Certificate in intoto tlog entry does not match the signing certificate.");
            }
          }
        } else {
          throw new Error(`Unsupported tlog entry kind: ${bodyJson.kind}`);
        }
        return true;
      }
      async verifyInclusionProof(bundle) {
        if (!this.rawRoot) {
          throw new Error("Sigstore root is undefined");
        }
        if (bundle.verificationMaterial.tlogEntries.length < 1) {
          throw new Error("No transparency log entries found in bundle");
        }
        for (const entry of bundle.verificationMaterial.tlogEntries) {
          if (entry.inclusionProof) {
            await verifyMerkleInclusion(entry);
            if (entry.inclusionProof.checkpoint) {
              await verifyCheckpoint(entry, this.rawRoot.tlogs);
            }
          }
        }
      }
      async verifyArtifactPolicy(policy, bundle, data, isDigestOnly = false) {
        if (!this.root) {
          throw new Error("Sigstore root is undefined");
        }
        const cert = bundle.verificationMaterial.certificate || bundle.verificationMaterial.x509CertificateChain?.certificates[0];
        if (!cert) {
          throw new Error("No certificate found in bundle");
        }
        const signingCert = X509Certificate.parse(base64ToUint8Array(cert.rawBytes));
        let signature;
        if (bundle.messageSignature) {
          signature = base64ToUint8Array(bundle.messageSignature.signature);
        } else if (bundle.dsseEnvelope) {
          if (!bundle.dsseEnvelope.signatures || bundle.dsseEnvelope.signatures.length === 0) {
            throw new Error("DSSE envelope has no signatures");
          }
          signature = base64ToUint8Array(bundle.dsseEnvelope.signatures[0].sig);
        } else {
          throw new Error("Bundle does not contain a message signature or DSSE envelope");
        }
        policy.verify(signingCert);
        const certPath = await this.verifyCertificateChain(signingCert.notBefore, signingCert, this.root.certificateAuthorities);
        const issuerCert = certPath.length > 1 ? certPath[1] : certPath[0];
        const verifiedSCTs = await this.verifySCT(signingCert, issuerCert, this.root.ctlogs);
        if (verifiedSCTs.length < this.options.ctlogThreshold) {
          throw new Error(`Not enough valid SCTs: found ${verifiedSCTs.length}, required ${this.options.ctlogThreshold}`);
        }
        if (!await this.verifyInclusionPromise(signingCert, bundle, this.root.rekor)) {
          throw new Error("Inclusion promise validation failed.");
        }
        await this.verifyInclusionProof(bundle);
        for (const entry of bundle.verificationMaterial.tlogEntries) {
          await verifyTLogBody(entry, bundle);
        }
        const verifiedTimestamps = await verifyBundleTimestamp(bundle.verificationMaterial.timestampVerificationData, signature, this.rawRoot?.timestampAuthorities || []);
        if (verifiedTimestamps.length < this.options.tsaThreshold) {
          throw new Error(`Not enough verified TSA timestamps: ${verifiedTimestamps.length} < ${this.options.tsaThreshold}`);
        }
        for (const verifiedTimestamp of verifiedTimestamps) {
          if (!signingCert.validForDate(verifiedTimestamp)) {
            throw new Error("Certificate was not valid at the time of timestamping");
          }
        }
        if (bundle.dsseEnvelope) {
          const payloadBytes = base64ToUint8Array(bundle.dsseEnvelope.payload);
          const payload = JSON.parse(Uint8ArrayToString(payloadBytes));
          if (!payload.subject || payload.subject.length === 0) {
            throw new Error("DSSE payload has no subject");
          }
          let artifactDigest;
          if (isDigestOnly) {
            artifactDigest = Uint8ArrayToHex(data);
          } else {
            artifactDigest = Uint8ArrayToHex(new Uint8Array(await crypto.subtle.digest(HashAlgorithms.SHA256, data)));
          }
          let matchedSubject = null;
          for (const subject of payload.subject) {
            const subjectDigest = subject.digest?.["sha256"];
            if (subjectDigest && artifactDigest === subjectDigest.toLowerCase()) {
              matchedSubject = subject;
              break;
            }
          }
          if (!matchedSubject) {
            throw new Error(`Artifact digest ${artifactDigest} does not match any subject in DSSE payload`);
          }
          const pae = preAuthEncoding(bundle.dsseEnvelope.payloadType, payloadBytes);
          const publicKey = await signingCert.publicKeyObj;
          const verified = await verifySignature(publicKey, pae, signature);
          if (!verified) {
            throw new Error("DSSE signature verification failed");
          }
        } else {
          const publicKey = await signingCert.publicKeyObj;
          if (isDigestOnly) {
            const verified = await verifySignatureOverDigest(publicKey, data, signature);
            if (!verified) {
              throw new Error("Error verifying signature over digest");
            }
          } else {
            const verified = await verifySignature(publicKey, data, signature);
            if (!verified) {
              const keyAlg = publicKey.algorithm.name || "unknown";
              throw new Error(`Error verifying artifact signature. Key algorithm: ${keyAlg}, Data length: ${data.length}, Signature length: ${signature.length}`);
            }
          }
        }
        return true;
      }
      async verifyArtifact(identity, issuer, bundle, data, isDigestOnly = false) {
        const policy = new AllOf([
          new Identity2({ identity }),
          new AnyOf([
            new OIDCIssuerV2(issuer),
            new OIDCIssuer(issuer)
          ])
        ]);
        return this.verifyArtifactPolicy(policy, bundle, data, isDigestOnly);
      }
      /**
       * Verify a DSSE bundle using a verification policy.
       * This matches sigstore-python's verify_dsse API.
       *
       * Reference: https://github.com/sigstore/sigstore-python/blob/main/sigstore/verify/verifier.py#L388
       *
       * Unlike verify_artifact which verifies an artifact against a bundle,
       * this method verifies the DSSE envelope itself and returns the payload.
       * The caller is responsible for checking that the payload matches their
       * expected artifact (e.g., by checking subjects in an in-toto statement).
       *
       * @param bundle - The Sigstore bundle containing the DSSE envelope
       * @param policy - A verification policy to apply to the signing certificate
       * @returns The payload type and payload bytes from the verified envelope
       */
      async verifyDsse(bundle, policy) {
        if (!this.root) {
          throw new Error("Sigstore root is undefined");
        }
        if (!bundle.dsseEnvelope) {
          throw new Error("Bundle does not contain a DSSE envelope");
        }
        const cert = bundle.verificationMaterial.certificate || bundle.verificationMaterial.x509CertificateChain?.certificates[0];
        if (!cert) {
          throw new Error("No certificate found in bundle");
        }
        const signingCert = X509Certificate.parse(base64ToUint8Array(cert.rawBytes));
        const certPath = await this.verifyCertificateChain(signingCert.notBefore, signingCert, this.root.certificateAuthorities);
        const issuerCert = certPath.length > 1 ? certPath[1] : certPath[0];
        const verifiedSCTs = await this.verifySCT(signingCert, issuerCert, this.root.ctlogs);
        if (verifiedSCTs.length < this.options.ctlogThreshold) {
          throw new Error(`Not enough valid SCTs: found ${verifiedSCTs.length}, required ${this.options.ctlogThreshold}`);
        }
        policy.verify(signingCert);
        if (!await this.verifyInclusionPromise(signingCert, bundle, this.root.rekor)) {
          throw new Error("Inclusion promise validation failed");
        }
        await this.verifyInclusionProof(bundle);
        if (!bundle.dsseEnvelope.signatures || bundle.dsseEnvelope.signatures.length !== 1) {
          throw new Error(`DSSE envelope must have exactly 1 signature, got ${bundle.dsseEnvelope.signatures?.length ?? 0}`);
        }
        const signature = base64ToUint8Array(bundle.dsseEnvelope.signatures[0].sig);
        const verifiedTimestamps = await verifyBundleTimestamp(bundle.verificationMaterial.timestampVerificationData, signature, this.rawRoot?.timestampAuthorities || []);
        if (verifiedTimestamps.length < this.options.tsaThreshold) {
          throw new Error(`Not enough verified TSA timestamps: ${verifiedTimestamps.length} < ${this.options.tsaThreshold}`);
        }
        for (const verifiedTimestamp of verifiedTimestamps) {
          if (!signingCert.validForDate(verifiedTimestamp)) {
            throw new Error("Certificate was not valid at the time of timestamping");
          }
        }
        for (const entry of bundle.verificationMaterial.tlogEntries) {
          if (entry.integratedTime) {
            const integratedDate = new Date(Number(entry.integratedTime) * 1e3);
            if (!signingCert.validForDate(integratedDate)) {
              throw new Error("Artifact signing was logged outside of the certificate validity.");
            }
          } else {
            assertRekorV2Timestamp(bundle.verificationMaterial.timestampVerificationData);
          }
        }
        const payloadBytes = base64ToUint8Array(bundle.dsseEnvelope.payload);
        const pae = preAuthEncoding(bundle.dsseEnvelope.payloadType, payloadBytes);
        const publicKey = await signingCert.publicKeyObj;
        const verified = await verifySignature(publicKey, pae, signature);
        if (!verified) {
          throw new Error("DSSE signature verification failed");
        }
        for (const entry of bundle.verificationMaterial.tlogEntries) {
          if (entry.kindVersion.kind !== "dsse") {
            throw new Error(`Expected entry type dsse, got ${entry.kindVersion.kind}`);
          }
          await verifyTLogBody(entry, bundle);
        }
        return {
          payloadType: bundle.dsseEnvelope.payloadType,
          payload: payloadBytes
        };
      }
    };
  }
});

// node_modules/@freedomofpress/sigstore-browser/dist/index.js
var dist_exports = {};
__export(dist_exports, {
  AllOf: () => AllOf,
  AnyOf: () => AnyOf,
  CertificateChainVerifier: () => CertificateChainVerifier,
  CertificateError: () => CertificateError,
  EXTENSION_OID_BUILD_CONFIG_DIGEST: () => EXTENSION_OID_BUILD_CONFIG_DIGEST,
  EXTENSION_OID_BUILD_CONFIG_URI: () => EXTENSION_OID_BUILD_CONFIG_URI,
  EXTENSION_OID_BUILD_SIGNER_DIGEST: () => EXTENSION_OID_BUILD_SIGNER_DIGEST,
  EXTENSION_OID_BUILD_SIGNER_URI: () => EXTENSION_OID_BUILD_SIGNER_URI,
  EXTENSION_OID_BUILD_TRIGGER: () => EXTENSION_OID_BUILD_TRIGGER,
  EXTENSION_OID_FULCIO_ISSUER_V1: () => EXTENSION_OID_FULCIO_ISSUER_V1,
  EXTENSION_OID_FULCIO_ISSUER_V2: () => EXTENSION_OID_FULCIO_ISSUER_V2,
  EXTENSION_OID_GITHUB_WORKFLOW_NAME: () => EXTENSION_OID_GITHUB_WORKFLOW_NAME,
  EXTENSION_OID_GITHUB_WORKFLOW_REF: () => EXTENSION_OID_GITHUB_WORKFLOW_REF,
  EXTENSION_OID_GITHUB_WORKFLOW_REPOSITORY: () => EXTENSION_OID_GITHUB_WORKFLOW_REPOSITORY,
  EXTENSION_OID_GITHUB_WORKFLOW_SHA: () => EXTENSION_OID_GITHUB_WORKFLOW_SHA,
  EXTENSION_OID_GITHUB_WORKFLOW_TRIGGER: () => EXTENSION_OID_GITHUB_WORKFLOW_TRIGGER,
  EXTENSION_OID_OTHERNAME: () => EXTENSION_OID_OTHERNAME,
  EXTENSION_OID_RUNNER_ENVIRONMENT: () => EXTENSION_OID_RUNNER_ENVIRONMENT,
  EXTENSION_OID_RUN_INVOCATION_URI: () => EXTENSION_OID_RUN_INVOCATION_URI,
  EXTENSION_OID_SCT: () => EXTENSION_OID_SCT,
  EXTENSION_OID_SOURCE_REPOSITORY_DIGEST: () => EXTENSION_OID_SOURCE_REPOSITORY_DIGEST,
  EXTENSION_OID_SOURCE_REPOSITORY_IDENTIFIER: () => EXTENSION_OID_SOURCE_REPOSITORY_IDENTIFIER,
  EXTENSION_OID_SOURCE_REPOSITORY_OWNER_IDENTIFIER: () => EXTENSION_OID_SOURCE_REPOSITORY_OWNER_IDENTIFIER,
  EXTENSION_OID_SOURCE_REPOSITORY_OWNER_URI: () => EXTENSION_OID_SOURCE_REPOSITORY_OWNER_URI,
  EXTENSION_OID_SOURCE_REPOSITORY_REF: () => EXTENSION_OID_SOURCE_REPOSITORY_REF,
  EXTENSION_OID_SOURCE_REPOSITORY_URI: () => EXTENSION_OID_SOURCE_REPOSITORY_URI,
  EXTENSION_OID_SOURCE_REPOSITORY_VISIBILITY: () => EXTENSION_OID_SOURCE_REPOSITORY_VISIBILITY,
  GITHUB_OIDC_ISSUER: () => GITHUB_OIDC_ISSUER,
  GitHubWorkflowName: () => GitHubWorkflowName,
  GitHubWorkflowRef: () => GitHubWorkflowRef,
  GitHubWorkflowRepository: () => GitHubWorkflowRepository,
  GitHubWorkflowSHA: () => GitHubWorkflowSHA,
  GitHubWorkflowTrigger: () => GitHubWorkflowTrigger,
  Identity: () => Identity2,
  OIDCBuildConfigDigest: () => OIDCBuildConfigDigest,
  OIDCBuildConfigURI: () => OIDCBuildConfigURI,
  OIDCBuildSignerDigest: () => OIDCBuildSignerDigest,
  OIDCBuildSignerURI: () => OIDCBuildSignerURI,
  OIDCBuildTrigger: () => OIDCBuildTrigger,
  OIDCIssuer: () => OIDCIssuer,
  OIDCIssuerV2: () => OIDCIssuerV2,
  OIDCRunInvocationURI: () => OIDCRunInvocationURI,
  OIDCRunnerEnvironment: () => OIDCRunnerEnvironment,
  OIDCSourceRepositoryDigest: () => OIDCSourceRepositoryDigest,
  OIDCSourceRepositoryIdentifier: () => OIDCSourceRepositoryIdentifier,
  OIDCSourceRepositoryOwnerIdentifier: () => OIDCSourceRepositoryOwnerIdentifier,
  OIDCSourceRepositoryOwnerURI: () => OIDCSourceRepositoryOwnerURI,
  OIDCSourceRepositoryRef: () => OIDCSourceRepositoryRef,
  OIDCSourceRepositoryURI: () => OIDCSourceRepositoryURI,
  OIDCSourceRepositoryVisibility: () => OIDCSourceRepositoryVisibility,
  PolicyError: () => PolicyError,
  SignatureError: () => SignatureError,
  SigstoreVerifier: () => SigstoreVerifier,
  TLogError: () => TLogError,
  TimestampError: () => TimestampError,
  TrustedRootProvider: () => TrustedRootProvider,
  VerificationError: () => VerificationError,
  X509BuildConfigDigestExtension: () => X509BuildConfigDigestExtension,
  X509BuildConfigURIExtension: () => X509BuildConfigURIExtension,
  X509BuildSignerDigestExtension: () => X509BuildSignerDigestExtension,
  X509BuildSignerURIExtension: () => X509BuildSignerURIExtension,
  X509BuildTriggerExtension: () => X509BuildTriggerExtension,
  X509Certificate: () => X509Certificate,
  X509Extension: () => X509Extension,
  X509FulcioIssuerV1: () => X509FulcioIssuerV1,
  X509FulcioIssuerV2: () => X509FulcioIssuerV2,
  X509GitHubWorkflowNameExtension: () => X509GitHubWorkflowNameExtension,
  X509GitHubWorkflowRefExtension: () => X509GitHubWorkflowRefExtension,
  X509GitHubWorkflowRepositoryExtension: () => X509GitHubWorkflowRepositoryExtension,
  X509GitHubWorkflowSHAExtension: () => X509GitHubWorkflowSHAExtension,
  X509GitHubWorkflowTriggerExtension: () => X509GitHubWorkflowTriggerExtension,
  X509RunInvocationURIExtension: () => X509RunInvocationURIExtension,
  X509RunnerEnvironmentExtension: () => X509RunnerEnvironmentExtension,
  X509SourceRepositoryDigestExtension: () => X509SourceRepositoryDigestExtension,
  X509SourceRepositoryIdentifierExtension: () => X509SourceRepositoryIdentifierExtension,
  X509SourceRepositoryOwnerIdentifierExtension: () => X509SourceRepositoryOwnerIdentifierExtension,
  X509SourceRepositoryOwnerURIExtension: () => X509SourceRepositoryOwnerURIExtension,
  X509SourceRepositoryRefExtension: () => X509SourceRepositoryRefExtension,
  X509SourceRepositoryURIExtension: () => X509SourceRepositoryURIExtension,
  X509SourceRepositoryVisibilityExtension: () => X509SourceRepositoryVisibilityExtension,
  verifyBundleTimestamp: () => verifyBundleTimestamp,
  verifyRFC3161Timestamp: () => verifyRFC3161Timestamp
});
var init_dist2 = __esm({
  "node_modules/@freedomofpress/sigstore-browser/dist/index.js"() {
    init_sigstore();
    init_errors2();
    init_tsa();
    init_tuf2();
    init_cert();
    init_ext();
    init_chain();
    init_policy();
  }
});

// node_modules/@tinfoilsh/verifier/dist/sev/cert-chain.js
var SnpOid, OID_RSASSA_PSS2, OID_EC_PUBLIC_KEY, OID_SECP384R1, CertificateChain;
var init_cert_chain = __esm({
  "node_modules/@tinfoilsh/verifier/dist/sev/cert-chain.js"() {
    init_constants();
    init_certs();
    init_dist2();
    init_dist();
    init_errors();
    SnpOid = {
      STRUCT_VERSION: "1.3.6.1.4.1.3704.1.1",
      PRODUCT_NAME: "1.3.6.1.4.1.3704.1.2",
      BL_SPL: "1.3.6.1.4.1.3704.1.3.1",
      TEE_SPL: "1.3.6.1.4.1.3704.1.3.2",
      SNP_SPL: "1.3.6.1.4.1.3704.1.3.3",
      SPL4: "1.3.6.1.4.1.3704.1.3.4",
      SPL5: "1.3.6.1.4.1.3704.1.3.5",
      SPL6: "1.3.6.1.4.1.3704.1.3.6",
      SPL7: "1.3.6.1.4.1.3704.1.3.7",
      UCODE: "1.3.6.1.4.1.3704.1.3.8",
      HWID: "1.3.6.1.4.1.3704.1.4",
      CSP_ID: "1.3.6.1.4.1.3704.1.5",
      // Aliases for compatibility
      BOOTLOADER: "1.3.6.1.4.1.3704.1.3.1",
      TEE: "1.3.6.1.4.1.3704.1.3.2",
      SNP: "1.3.6.1.4.1.3704.1.3.3"
    };
    OID_RSASSA_PSS2 = "1.2.840.113549.1.1.10";
    OID_EC_PUBLIC_KEY = "1.2.840.10045.2.1";
    OID_SECP384R1 = "1.3.132.0.34";
    CertificateChain = class _CertificateChain {
      constructor(ark, ask, vcek) {
        this.ark = ark;
        this.ask = ask;
        this.vcek = vcek;
      }
      static async fromReport(report, vcekDer) {
        if (report.productName !== "Genoa") {
          throw new AttestationError(`Unsupported processor: ${report.productName}. This verifier only supports AMD EPYC Genoa processors`);
        }
        if (report.signerInfoParsed.signingKey !== ReportSigner.VcekReportSigner) {
          throw new AttestationError("Unsupported signing key: This verifier only supports VCEK-signed attestation reports");
        }
        const ark = X509Certificate.parse(ARK_CERT);
        const ask = X509Certificate.parse(ASK_CERT);
        const vcekCert = X509Certificate.parse(vcekDer);
        return new _CertificateChain(ark, ask, vcekCert);
      }
      async verifyChain() {
        try {
          this.validateArkFormat();
          this.validateAskFormat();
          this.validateVcekFormat();
          const now = /* @__PURE__ */ new Date();
          if (!this.ark.validForDate(now)) {
            throw new AttestationError("AMD Root Key (ARK) certificate has expired or is not yet valid");
          }
          if (!this.ask.validForDate(now)) {
            throw new AttestationError("AMD SEV Key (ASK) certificate has expired or is not yet valid");
          }
          if (!this.vcek.validForDate(now)) {
            throw new AttestationError("VCEK certificate has expired or is not yet valid");
          }
          const arkSelfSigned = await this.ark.verify();
          if (!arkSelfSigned) {
            throw new AttestationError("AMD Root Key (ARK) certificate signature verification failed: Not properly self-signed");
          }
          const askSignedByArk = await this.ask.verify(this.ark);
          if (!askSignedByArk) {
            throw new AttestationError("AMD SEV Key (ASK) certificate signature verification failed: Not signed by ARK");
          }
          const vcekSignedByAsk = await this.vcek.verify(this.ask);
          if (!vcekSignedByAsk) {
            throw new AttestationError("VCEK certificate signature verification failed: Not signed by ASK");
          }
          return true;
        } catch (e) {
          wrapOrThrow(e, AttestationError, "AMD certificate chain verification failed");
        }
      }
      validateVcekTcb(tcb) {
        const blSplExt = this.vcek.extension(SnpOid.BL_SPL);
        if (!blSplExt) {
          throw new AttestationError("Invalid VCEK certificate: Missing bootloader security patch level (BL_SPL) extension");
        }
        const blSpl = this.decodeExtensionInteger(blSplExt.value);
        if (blSpl !== tcb.blSpl) {
          throw new AttestationError(`VCEK TCB mismatch: Bootloader SPL in certificate (${blSpl}) does not match report (${tcb.blSpl})`);
        }
        const teeSplExt = this.vcek.extension(SnpOid.TEE_SPL);
        if (!teeSplExt) {
          throw new AttestationError("Invalid VCEK certificate: Missing TEE security patch level (TEE_SPL) extension");
        }
        const teeSpl = this.decodeExtensionInteger(teeSplExt.value);
        if (teeSpl !== tcb.teeSpl) {
          throw new AttestationError(`VCEK TCB mismatch: TEE SPL in certificate (${teeSpl}) does not match report (${tcb.teeSpl})`);
        }
        const snpSplExt = this.vcek.extension(SnpOid.SNP_SPL);
        if (!snpSplExt) {
          throw new AttestationError("Invalid VCEK certificate: Missing SNP security patch level (SNP_SPL) extension");
        }
        const snpSpl = this.decodeExtensionInteger(snpSplExt.value);
        if (snpSpl !== tcb.snpSpl) {
          throw new AttestationError(`VCEK TCB mismatch: SNP SPL in certificate (${snpSpl}) does not match report (${tcb.snpSpl})`);
        }
        const ucodeExt = this.vcek.extension(SnpOid.UCODE);
        if (!ucodeExt) {
          throw new AttestationError("Invalid VCEK certificate: Missing microcode security patch level (UCODE) extension");
        }
        const ucodeSpl = this.decodeExtensionInteger(ucodeExt.value);
        if (ucodeSpl !== tcb.ucodeSpl) {
          throw new AttestationError(`VCEK TCB mismatch: Microcode SPL in certificate (${ucodeSpl}) does not match report (${tcb.ucodeSpl})`);
        }
      }
      validateVcekHwid(chipId) {
        const hwidExt = this.vcek.extension(SnpOid.HWID);
        if (!hwidExt) {
          throw new AttestationError("Invalid VCEK certificate: Missing hardware ID (HWID) extension");
        }
        if (!uint8ArrayEqual(hwidExt.value, chipId)) {
          throw new AttestationError("VCEK hardware ID mismatch: Certificate HWID does not match the chip ID in the attestation report");
        }
      }
      validateArkFormat() {
        if (this.ark.version !== "v3") {
          throw new AttestationError(`Invalid ARK certificate: Expected X.509 version v3, got ${this.ark.version}`);
        }
        if (!this.validateAmdLocation(this.ark.issuerDN)) {
          throw new AttestationError("Invalid ARK certificate: Issuer is not a valid AMD organization");
        }
        if (!this.validateAmdLocation(this.ark.subjectDN)) {
          throw new AttestationError("Invalid ARK certificate: Subject is not a valid AMD organization");
        }
        const cn = this.ark.subjectDN.get("CN");
        if (cn !== "ARK-Genoa") {
          throw new AttestationError(`Invalid ARK certificate: Expected common name "ARK-Genoa", got "${cn}"`);
        }
      }
      validateAskFormat() {
        if (this.ask.version !== "v3") {
          throw new AttestationError(`Invalid ASK certificate: Expected X.509 version v3, got ${this.ask.version}`);
        }
        if (!this.validateAmdLocation(this.ask.issuerDN)) {
          throw new AttestationError("Invalid ASK certificate: Issuer is not a valid AMD organization");
        }
        if (!this.validateAmdLocation(this.ask.subjectDN)) {
          throw new AttestationError("Invalid ASK certificate: Subject is not a valid AMD organization");
        }
        const cn = this.ask.subjectDN.get("CN");
        if (cn !== "SEV-Genoa") {
          throw new AttestationError(`Invalid ASK certificate: Expected common name "SEV-Genoa", got "${cn}"`);
        }
      }
      validateVcekFormat() {
        if (this.vcek.version !== "v3") {
          throw new AttestationError(`Invalid VCEK certificate: Expected X.509 version v3, got ${this.vcek.version}`);
        }
        if (!this.validateAmdLocation(this.vcek.issuerDN)) {
          throw new AttestationError("Invalid VCEK certificate: Issuer is not a valid AMD organization");
        }
        if (!this.validateAmdLocation(this.vcek.subjectDN)) {
          throw new AttestationError("Invalid VCEK certificate: Subject is not a valid AMD organization");
        }
        const cn = this.vcek.subjectDN.get("CN");
        if (cn !== "SEV-VCEK") {
          throw new AttestationError(`Invalid VCEK certificate: Expected common name "SEV-VCEK", got "${cn}"`);
        }
        const sigAlgOid = this.getSignatureAlgorithmOid(this.vcek);
        if (sigAlgOid !== OID_RSASSA_PSS2) {
          throw new AttestationError("Invalid VCEK certificate: Signature algorithm must be RSASSA-PSS");
        }
        const { algorithm, curve } = this.getPublicKeyInfo(this.vcek);
        if (algorithm !== OID_EC_PUBLIC_KEY) {
          throw new AttestationError("Invalid VCEK certificate: Public key must be ECDSA");
        }
        if (curve !== OID_SECP384R1) {
          throw new AttestationError("Invalid VCEK certificate: Public key curve must be secp384r1 (P-384)");
        }
        const cspIdExt = this.vcek.extension(SnpOid.CSP_ID);
        if (cspIdExt) {
          throw new AttestationError("Invalid VCEK certificate: CSP_ID extension should not be present (this looks like a VLEK certificate)");
        }
        const hwidExt = this.vcek.extension(SnpOid.HWID);
        if (!hwidExt || hwidExt.value.length !== 64) {
          throw new AttestationError("Invalid VCEK certificate: Missing or malformed hardware ID (HWID) extension");
        }
        const productNameExt = this.vcek.extension(SnpOid.PRODUCT_NAME);
        if (!productNameExt) {
          throw new AttestationError("Invalid VCEK certificate: Missing product name extension");
        }
        const expectedProductName = new Uint8Array([22, 5, 71, 101, 110, 111, 97]);
        if (!uint8ArrayEqual(productNameExt.value, expectedProductName)) {
          throw new AttestationError('Invalid VCEK certificate: Product name must be "Genoa"');
        }
      }
      validateAmdLocation(name) {
        const country = name.get("C");
        const locality = name.get("L");
        const state = name.get("ST");
        const org = name.get("O");
        const orgUnit = name.get("OU");
        return country === "US" && locality === "Santa Clara" && state === "CA" && org === "Advanced Micro Devices" && orgUnit === "Engineering";
      }
      getSignatureAlgorithmOid(cert) {
        const sigAlgObj = cert.root.subs[1];
        return sigAlgObj.subs[0].toOID();
      }
      getPublicKeyInfo(cert) {
        const tbsCert = cert.root.subs[0];
        const spki = tbsCert.subs[6];
        const algorithmSeq = spki.subs[0];
        const algorithm = algorithmSeq.subs[0].toOID();
        const curve = algorithmSeq.subs[1]?.toOID() || "";
        return { algorithm, curve };
      }
      decodeExtensionInteger(value) {
        const asn1 = ASN1Obj.parseBuffer(value);
        return Number(asn1.toInteger());
      }
      get vcekPublicKey() {
        return this.vcek.publicKeyObj;
      }
    };
  }
});

// node_modules/@tinfoilsh/verifier/dist/sev/verify.js
async function verifyReportSignature(vcekPublicKey, report) {
  if (report.version < 2) {
    throw new AttestationError(`Unsupported attestation report version ${report.version}. Minimum required version is 2`);
  }
  if (!(report.policy & 1n << BigInt(POLICY_RESERVED_1_BIT))) {
    throw new AttestationError("Invalid attestation report: Policy field has invalid reserved bit");
  }
  if (report.policy >> 26n) {
    throw new AttestationError("Invalid attestation report: Policy field has non-zero reserved bits");
  }
  if (report.signatureAlgo !== 1) {
    throw new AttestationError(`Unsupported signature algorithm (${report.signatureAlgo}). Only ECDSA P-384 with SHA-384 (algorithm 1) is supported`);
  }
  const rBytesLE = report.signature.slice(0, 72);
  const sBytesLE = report.signature.slice(72, 144);
  const rBytesBE = reverseBytes(rBytesLE);
  const sBytesBE = reverseBytes(sBytesLE);
  const r = bytesToBigInt(stripLeadingZeros(rBytesBE));
  const s = bytesToBigInt(stripLeadingZeros(sBytesBE));
  const rRaw = bigIntToFixedBytes(r, 48);
  const sRaw = bigIntToFixedBytes(s, 48);
  const rawSignature = new Uint8Array(96);
  rawSignature.set(rRaw, 0);
  rawSignature.set(sRaw, 48);
  const signedData = report.signedData.slice();
  try {
    const isValid = await crypto.subtle.verify({ name: KeyTypes.Ecdsa, hash: HashAlgorithms.SHA384 }, vcekPublicKey, rawSignature, signedData);
    return isValid;
  } catch (e) {
    wrapOrThrow(e, AttestationError, "Failed to verify attestation report signature using VCEK public key");
  }
}
async function verifyAttestation(chain, report) {
  const isChainValid = await chain.verifyChain();
  if (!isChainValid) {
    throw new AttestationError("AMD certificate chain verification failed: The chain from ARK to ASK to VCEK could not be verified");
  }
  const vcekPublicKey = await chain.vcekPublicKey;
  const isSignatureValid = await verifyReportSignature(vcekPublicKey, report);
  if (!isSignatureValid) {
    throw new AttestationError("Attestation report signature is invalid: The report was not signed by the expected VCEK key");
  }
  return true;
}
function reverseBytes(bytes) {
  return new Uint8Array([...bytes].reverse());
}
function stripLeadingZeros(bytes) {
  let start = 0;
  while (start < bytes.length && bytes[start] === 0) {
    start++;
  }
  if (start === bytes.length) {
    return new Uint8Array([0]);
  }
  return bytes.slice(start);
}
function bytesToBigInt(bytes) {
  if (bytes.length === 0) {
    return 0n;
  }
  let result = 0n;
  for (const byte of bytes) {
    result = result << 8n | BigInt(byte);
  }
  return result;
}
function bigIntToFixedBytes(value, size) {
  let hex = value.toString(16);
  if (hex.length % 2) {
    hex = "0" + hex;
  }
  const bytes = new Uint8Array(size);
  const hexBytes = hex.length / 2;
  const startOffset = size - hexBytes;
  for (let i = 0; i < hexBytes; i++) {
    bytes[startOffset + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
var init_verify = __esm({
  "node_modules/@tinfoilsh/verifier/dist/sev/verify.js"() {
    init_constants();
    init_dist();
    init_errors();
  }
});

// node_modules/@tinfoilsh/verifier/dist/sev/validation.js
function validatePolicy(reportPolicy, required) {
  if (comparePolicyVersions(required, reportPolicy) > 0) {
    throw new AttestationError(`Required ABI version (${required.abiMajor}.${required.abiMinor}) is greater than report's ABI version (${reportPolicy.abiMajor}.${reportPolicy.abiMinor})`);
  }
  if (!required.migrateMa && reportPolicy.migrateMa) {
    throw new AttestationError("Security policy violation: Migration agent is enabled but not allowed");
  }
  if (!required.debug && reportPolicy.debug) {
    throw new AttestationError("Security policy violation: Debug mode is enabled but not allowed. The enclave must have debug disabled for production use");
  }
  if (!required.smt && reportPolicy.smt) {
    throw new AttestationError("Security policy violation: Simultaneous multithreading (SMT) is enabled but not allowed");
  }
  if (!required.cxlAllowed && reportPolicy.cxlAllowed) {
    throw new AttestationError("Security policy violation: CXL (Compute Express Link) is enabled but not allowed");
  }
  if (!required.memAes256Xts && reportPolicy.memAes256Xts) {
    throw new AttestationError("Security policy violation: AES-256-XTS memory encryption mode is enabled but not allowed");
  }
  if (required.singleSocket && !reportPolicy.singleSocket) {
    throw new AttestationError("Security policy violation: Single socket mode is required but not enabled");
  }
  if (required.memAes256Xts && !reportPolicy.memAes256Xts) {
    throw new AttestationError("Security policy violation: AES-256-XTS memory encryption mode is required but not enabled");
  }
  if (required.raplDis && !reportPolicy.raplDis) {
    throw new AttestationError("Security policy violation: RAPL (power monitoring) must be disabled but is enabled");
  }
  if (required.ciphertextHidingDram && !reportPolicy.ciphertextHidingDram) {
    throw new AttestationError("Security policy violation: DRAM ciphertext hiding is required but not enabled");
  }
  if (required.pageSwapDisabled && !reportPolicy.pageSwapDisabled) {
    throw new AttestationError("Security policy violation: Page swap must be disabled but is enabled");
  }
}
function comparePolicyVersions(required, report) {
  if (required.abiMajor !== report.abiMajor) {
    return required.abiMajor - report.abiMajor;
  }
  return required.abiMinor - report.abiMinor;
}
function tcbPartsToString(tcb) {
  return `TCBParts(bootloader=${tcb.blSpl}, tee=${tcb.teeSpl}, snp=${tcb.snpSpl}, microcode=${tcb.ucodeSpl})`;
}
function validateReport(report, chain, options) {
  if (options.guestPolicy) {
    validatePolicy(report.policyParsed, options.guestPolicy);
  }
  if (options.minimumGuestSvn !== void 0) {
    if (report.guestSvn < options.minimumGuestSvn) {
      throw new AttestationError(`Guest SVN ${report.guestSvn} is less than minimum required ${options.minimumGuestSvn}`);
    }
  }
  if (options.minimumBuild !== void 0) {
    if (report.currentBuild < options.minimumBuild) {
      throw new AttestationError(`Current SNP firmware build number ${report.currentBuild} is less than minimum required ${options.minimumBuild}`);
    }
    if (report.committedBuild < options.minimumBuild) {
      throw new AttestationError(`Committed SNP firmware build number ${report.committedBuild} is less than minimum required ${options.minimumBuild}`);
    }
  }
  if (options.minimumVersion !== void 0) {
    const currentVersion = report.currentMajor << 8 | report.currentMinor;
    const committedVersion = report.committedMajor << 8 | report.committedMinor;
    if (currentVersion < options.minimumVersion) {
      throw new AttestationError(`Current SNP firmware version ${report.currentMajor}.${report.currentMinor} is less than minimum required ${options.minimumVersion >> 8}.${options.minimumVersion & 255}`);
    }
    if (committedVersion < options.minimumVersion) {
      throw new AttestationError(`Committed SNP firmware version ${report.committedMajor}.${report.committedMinor} is less than minimum required ${options.minimumVersion >> 8}.${options.minimumVersion & 255}`);
    }
  }
  if (options.minimumTcb) {
    const currentTcbParts = tcbFromInt(report.currentTcb);
    const committedTcbParts = tcbFromInt(report.committedTcb);
    const reportedTcbParts = tcbFromInt(report.reportedTcb);
    if (!tcbMeetsMinimum(currentTcbParts, options.minimumTcb)) {
      throw new AttestationError(`Current TCB ${tcbPartsToString(currentTcbParts)} does not meet minimum requirements ${tcbPartsToString(options.minimumTcb)}`);
    }
    if (!tcbMeetsMinimum(committedTcbParts, options.minimumTcb)) {
      throw new AttestationError(`Committed TCB ${tcbPartsToString(committedTcbParts)} does not meet minimum requirements ${tcbPartsToString(options.minimumTcb)}`);
    }
    if (!tcbMeetsMinimum(reportedTcbParts, options.minimumTcb)) {
      throw new AttestationError(`Reported TCB ${tcbPartsToString(reportedTcbParts)} does not meet minimum requirements ${tcbPartsToString(options.minimumTcb)}`);
    }
  }
  chain.validateVcekTcb(tcbFromInt(report.reportedTcb));
  if (options.minimumLaunchTcb) {
    const launchTcbParts = tcbFromInt(report.launchTcb);
    if (!tcbMeetsMinimum(launchTcbParts, options.minimumLaunchTcb)) {
      throw new AttestationError(`Launch TCB ${tcbPartsToString(launchTcbParts)} does not meet minimum requirements ${tcbPartsToString(options.minimumLaunchTcb)}`);
    }
  }
  if (options.reportData) {
    if (report.reportData.length !== 64) {
      throw new AttestationError(`Report data length is ${report.reportData.length}, expected 64 bytes`);
    }
    if (!uint8ArrayEqual(report.reportData, options.reportData)) {
      throw new AttestationError(`Report data mismatch: got ${bytesToHex4(report.reportData)}, expected ${bytesToHex4(options.reportData)}`);
    }
  }
  if (options.hostData) {
    if (report.hostData.length !== 32) {
      throw new AttestationError(`Host data length is ${report.hostData.length}, expected 32 bytes`);
    }
    if (!uint8ArrayEqual(report.hostData, options.hostData)) {
      throw new AttestationError(`Host data mismatch: got ${bytesToHex4(report.hostData)}, expected ${bytesToHex4(options.hostData)}`);
    }
  }
  if (options.measurement) {
    if (report.measurement.length !== 48) {
      throw new AttestationError(`Measurement length is ${report.measurement.length}, expected 48 bytes`);
    }
    if (!uint8ArrayEqual(report.measurement, options.measurement)) {
      throw new AttestationError(`Measurement mismatch: got ${bytesToHex4(report.measurement)}, expected ${bytesToHex4(options.measurement)}`);
    }
  }
  if (options.chipId) {
    if (report.chipId.length !== 64) {
      throw new AttestationError(`Chip ID length is ${report.chipId.length}, expected 64 bytes`);
    }
    if (!uint8ArrayEqual(report.chipId, options.chipId)) {
      throw new AttestationError(`Chip ID mismatch: got ${bytesToHex4(report.chipId)}, expected ${bytesToHex4(options.chipId)}`);
    }
  }
  if (options.imageId) {
    if (report.imageId.length !== 16) {
      throw new AttestationError(`Image ID length is ${report.imageId.length}, expected 16 bytes`);
    }
    if (!uint8ArrayEqual(report.imageId, options.imageId)) {
      throw new AttestationError(`Image ID mismatch: got ${bytesToHex4(report.imageId)}, expected ${bytesToHex4(options.imageId)}`);
    }
  }
  if (options.familyId) {
    if (report.familyId.length !== 16) {
      throw new AttestationError(`Family ID length is ${report.familyId.length}, expected 16 bytes`);
    }
    if (!uint8ArrayEqual(report.familyId, options.familyId)) {
      throw new AttestationError(`Family ID mismatch: got ${bytesToHex4(report.familyId)}, expected ${bytesToHex4(options.familyId)}`);
    }
  }
  if (options.reportId) {
    if (report.reportId.length !== 32) {
      throw new AttestationError(`Report ID length is ${report.reportId.length}, expected 32 bytes`);
    }
    if (!uint8ArrayEqual(report.reportId, options.reportId)) {
      throw new AttestationError(`Report ID mismatch: got ${bytesToHex4(report.reportId)}, expected ${bytesToHex4(options.reportId)}`);
    }
  }
  if (options.reportIdMa) {
    if (report.reportIdMa.length !== 32) {
      throw new AttestationError(`Report ID MA length is ${report.reportIdMa.length}, expected 32 bytes`);
    }
    if (!uint8ArrayEqual(report.reportIdMa, options.reportIdMa)) {
      throw new AttestationError(`Report ID MA mismatch: got ${bytesToHex4(report.reportIdMa)}, expected ${bytesToHex4(options.reportIdMa)}`);
    }
  }
  if (report.signerInfoParsed.signingKey === ReportSigner.VcekReportSigner) {
    if (report.signerInfoParsed.maskChipKey && report.chipId.some((b) => b !== 0)) {
      throw new AttestationError("Invalid attestation report: chip ID masking is enabled but chip ID field is not zeroed");
    }
    if (!report.signerInfoParsed.maskChipKey) {
      chain.validateVcekHwid(report.chipId);
    }
  }
  if (options.platformInfo) {
    validatePlatformInfo(report.platformInfoParsed, options.platformInfo);
  }
  if (options.vmpl !== void 0) {
    if (!(0 <= report.vmpl && report.vmpl <= 3)) {
      throw new AttestationError(`VMPL ${report.vmpl} is not in valid range 0-3`);
    }
    if (report.vmpl !== options.vmpl) {
      throw new AttestationError(`VMPL mismatch: got ${report.vmpl}, expected ${options.vmpl}`);
    }
  }
  if (options.permitProvisionalFirmware) {
    throw new AttestationError("Unsupported option: Provisional firmware validation is not yet implemented");
  }
  if (report.committedBuild !== report.currentBuild) {
    throw new AttestationError(`Firmware version mismatch: Committed build (${report.committedBuild}) does not match current build (${report.currentBuild}). This may indicate provisional firmware`);
  }
  if (report.committedMinor !== report.currentMinor) {
    throw new AttestationError(`Firmware version mismatch: Committed minor version (${report.committedMinor}) does not match current (${report.currentMinor})`);
  }
  if (report.committedMajor !== report.currentMajor) {
    throw new AttestationError(`Firmware version mismatch: Committed major version (${report.committedMajor}) does not match current (${report.currentMajor})`);
  }
  if (report.committedTcb !== report.currentTcb) {
    throw new AttestationError(`Firmware version mismatch: Committed TCB does not match current TCB. This may indicate provisional firmware`);
  }
  if (options.requireAuthorKey || options.requireIdBlock) {
    throw new AttestationError("Unsupported option: ID-block and author key validation is not yet implemented");
  }
}
function validatePlatformInfo(reportInfo, required) {
  if (reportInfo.smtEnabled && !required.smtEnabled) {
    throw new AttestationError("Platform policy violation: SMT (simultaneous multithreading) is enabled but not allowed");
  }
  if (!reportInfo.eccEnabled && required.eccEnabled) {
    throw new AttestationError("Platform policy violation: ECC memory is required but not enabled");
  }
  if (!reportInfo.tsmeEnabled && required.tsmeEnabled) {
    throw new AttestationError("Platform policy violation: TSME (transparent SME) is required but not enabled");
  }
  if (!reportInfo.raplDisabled && required.raplDisabled) {
    throw new AttestationError("Platform policy violation: RAPL (power monitoring) must be disabled but is enabled");
  }
  if (!reportInfo.ciphertextHidingDramEnabled && required.ciphertextHidingDramEnabled) {
    throw new AttestationError("Platform policy violation: DRAM ciphertext hiding is required but not enabled");
  }
  if (!reportInfo.aliasCheckComplete && required.aliasCheckComplete) {
    throw new AttestationError("Platform policy violation: Memory alias check is required but has not completed");
  }
  if (!reportInfo.tioEnabled && required.tioEnabled) {
    throw new AttestationError("Platform policy violation: TIO (trusted I/O) is required but not enabled");
  }
}
var defaultValidationOptions;
var init_validation = __esm({
  "node_modules/@tinfoilsh/verifier/dist/sev/validation.js"() {
    init_utils();
    init_constants();
    init_dist();
    init_errors();
    defaultValidationOptions = {
      guestPolicy: {
        abiMinor: 0,
        abiMajor: 0,
        smt: true,
        migrateMa: false,
        debug: false,
        singleSocket: false,
        cxlAllowed: false,
        memAes256Xts: false,
        raplDis: false,
        ciphertextHidingDram: false,
        pageSwapDisabled: false
      },
      minimumGuestSvn: 0,
      minimumBuild: 21,
      minimumVersion: 1 << 8 | 55,
      // 1.55
      minimumTcb: {
        blSpl: 7,
        teeSpl: 0,
        snpSpl: 14,
        ucodeSpl: 72
      },
      minimumLaunchTcb: {
        blSpl: 7,
        teeSpl: 0,
        snpSpl: 14,
        ucodeSpl: 72
      },
      permitProvisionalFirmware: false,
      platformInfo: {
        smtEnabled: true,
        tsmeEnabled: true,
        eccEnabled: false,
        raplDisabled: false,
        ciphertextHidingDramEnabled: false,
        aliasCheckComplete: false,
        tioEnabled: false
      },
      requireAuthorKey: false,
      requireIdBlock: false
    };
  }
});

// stub:zlib
var zlib_exports = {};
__export(zlib_exports, {
  gunzipSync: () => gunzipSync
});
function gunzipSync() {
  throw new Error("zlib is not available in the browser (needs DecompressionStream)");
}
var init_zlib = __esm({
  "stub:zlib"() {
  }
});

// node_modules/@tinfoilsh/verifier/dist/attestation.js
async function verifyAttestation2(doc, vcekBase64) {
  if (doc.format === PredicateType.SevGuestV2) {
    return verifySevAttestationV2(doc.body, base64ToBytes(vcekBase64));
  } else {
    throw new AttestationError(`Unsupported attestation document format: "${doc.format}". Only SEV-SNP Guest V2 format is supported`);
  }
}
async function verifySevAttestationV2(attestationDoc, vcekDer) {
  const report = await verifySevReport(attestationDoc, true, vcekDer);
  const measurement = {
    type: PredicateType.SevGuestV2,
    registers: [bytesToHex4(report.measurement)]
  };
  const keys = report.reportData;
  const tlsKeyFp = bytesToHex4(keys.slice(0, 32));
  const hpkePublicKey = bytesToHex4(keys.slice(32, 64));
  return {
    measurement,
    tlsPublicKeyFingerprint: tlsKeyFp,
    hpkePublicKey
  };
}
async function verifySevReport(attestationDoc, isCompressed, vcekDer) {
  let attDocBytes;
  try {
    attDocBytes = base64ToBytes(attestationDoc);
  } catch (e) {
    throw new AttestationError("Failed to decode attestation document: Invalid base64 encoding", { cause: e });
  }
  if (isCompressed) {
    attDocBytes = await decompressGzip(attDocBytes);
  }
  let report;
  try {
    report = new Report(attDocBytes);
  } catch (e) {
    throw new AttestationError("Failed to parse SEV-SNP attestation report", { cause: e });
  }
  const chain = await CertificateChain.fromReport(report, vcekDer);
  let res;
  try {
    res = await verifyAttestation(chain, report);
  } catch (e) {
    wrapOrThrow(e, AttestationError, "Attestation cryptographic verification failed");
  }
  if (!res) {
    throw new AttestationError("Attestation verification failed: Report signature or certificate chain is invalid");
  }
  try {
    validateReport(report, chain, defaultValidationOptions);
  } catch (e) {
    wrapOrThrow(e, AttestationError, "Attestation policy validation failed");
  }
  return report;
}
function base64ToBytes(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
async function decompressGzip(data) {
  if (typeof DecompressionStream !== "undefined") {
    const stream = new Response(data.buffer).body;
    if (!stream) {
      throw new Error("Failed to create stream from data");
    }
    const decompressedStream = stream.pipeThrough(new DecompressionStream("gzip"));
    const decompressed = await new Response(decompressedStream).arrayBuffer();
    return new Uint8Array(decompressed);
  }
  const { gunzipSync: gunzipSync2 } = await Promise.resolve().then(() => (init_zlib(), zlib_exports));
  return new Uint8Array(gunzipSync2(data));
}
var init_attestation = __esm({
  "node_modules/@tinfoilsh/verifier/dist/attestation.js"() {
    init_types();
    init_report();
    init_cert_chain();
    init_verify();
    init_utils();
    init_validation();
    init_errors();
  }
});

// node_modules/@tinfoilsh/verifier/dist/bundle.js
async function assembleAttestationBundle(enclaveHost, configRepo) {
  const [attestation, release, enclaveCert] = await Promise.all([
    withRetry(async () => {
      const doc = await fetchJson(`https://${enclaveHost}/.well-known/tinfoil-attestation`);
      return { format: doc.format, body: doc.body };
    }),
    withRetry(async () => {
      const { tag_name } = await fetchJson(`${GITHUB_PROXY}/repos/${configRepo}/releases/latest`);
      const digest = (await fetchText(`${GITHUB_PROXY}/${configRepo}/releases/download/${tag_name}/tinfoil.hash`)).trim();
      return { tag: tag_name, digest };
    }),
    withRetry(async () => {
      const data = await fetchJson(`https://${enclaveHost}/.well-known/tinfoil-certificate`);
      return data.certificate;
    })
  ]);
  const sigstoreBundle = await withRetry(async () => {
    const data = await fetchJson(`${GITHUB_PROXY}/repos/${configRepo}/attestations/sha256:${release.digest}`);
    if (!data.attestations?.[0]?.bundle) {
      throw new FetchError(`No Sigstore bundle for ${configRepo} at digest ${release.digest}`);
    }
    return data.attestations[0].bundle;
  });
  let report;
  try {
    report = new Report(await decompressGzip(base64ToBytes(attestation.body)));
  } catch (e) {
    wrapOrThrow(e, AttestationError, "Failed to parse attestation report");
  }
  const vcek = await withRetry(async () => {
    const tcb = tcbFromInt(report.reportedTcb);
    const chip = bytesToHex4(report.chipId);
    const der = await fetchBinary(`${KDS}/vcek/v1/${report.productName}/${chip}?blSPL=${tcb.blSpl}&teeSPL=${tcb.teeSpl}&snpSPL=${tcb.snpSpl}&ucodeSPL=${tcb.ucodeSpl}`);
    let bin = "";
    for (let i = 0; i < der.length; i++)
      bin += String.fromCharCode(der[i]);
    return btoa(bin);
  });
  return {
    domain: enclaveHost,
    enclaveAttestationReport: attestation,
    digest: release.digest,
    releaseTag: release.tag,
    sigstoreBundle,
    vcek,
    enclaveCert
  };
}
async function withRetry(fn) {
  for (let i = 0; i <= MAX_RETRIES; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === MAX_RETRIES || !(e instanceof FetchError))
        throw e;
    }
    await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i)));
  }
  throw new Error("unreachable");
}
async function fetchOk(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (e) {
    throw new FetchError(`Network error: ${url}`, { cause: e });
  }
  if (!response.ok) {
    throw new FetchError(`HTTP ${response.status}: ${url}`);
  }
  return response;
}
async function fetchJson(url) {
  try {
    return await (await fetchOk(url)).json();
  } catch (e) {
    wrapOrThrow(e, FetchError, `Invalid response from ${url}`);
  }
}
async function fetchText(url) {
  try {
    return await (await fetchOk(url)).text();
  } catch (e) {
    wrapOrThrow(e, FetchError, `Invalid response from ${url}`);
  }
}
async function fetchBinary(url) {
  try {
    return new Uint8Array(await (await fetchOk(url)).arrayBuffer());
  } catch (e) {
    wrapOrThrow(e, FetchError, `Invalid response from ${url}`);
  }
}
var GITHUB_PROXY, KDS, MAX_RETRIES;
var init_bundle = __esm({
  "node_modules/@tinfoilsh/verifier/dist/bundle.js"() {
    init_attestation();
    init_report();
    init_utils();
    init_errors();
    GITHUB_PROXY = "https://github-proxy.tinfoil.sh";
    KDS = "https://kds-proxy.tinfoil.sh";
    MAX_RETRIES = 2;
  }
});

// node_modules/@tinfoilsh/verifier/dist/sigstore-trusted-root.js
var sigstore_trusted_root_default;
var init_sigstore_trusted_root = __esm({
  "node_modules/@tinfoilsh/verifier/dist/sigstore-trusted-root.js"() {
    sigstore_trusted_root_default = {
      "mediaType": "application/vnd.dev.sigstore.trustedroot+json;version=0.1",
      "tlogs": [
        {
          "baseUrl": "https://rekor.sigstore.dev",
          "hashAlgorithm": "SHA2_256",
          "publicKey": {
            "rawBytes": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE2G2Y+2tabdTV5BcGiBIx0a9fAFwrkBbmLSGtks4L3qX6yYY0zufBnhC8Ur/iy55GhWP/9A/bY2LhC30M9+RYtw==",
            "keyDetails": "PKIX_ECDSA_P256_SHA_256",
            "validFor": {
              "start": "2021-01-12T11:53:27Z"
            }
          },
          "logId": {
            "keyId": "wNI9atQGlz+VWfO6LRygH4QUfY/8W4RFwiT5i5WRgB0="
          }
        },
        {
          "baseUrl": "https://log2025-1.rekor.sigstore.dev",
          "hashAlgorithm": "SHA2_256",
          "publicKey": {
            "rawBytes": "MCowBQYDK2VwAyEAt8rlp1knGwjfbcXAYPYAkn0XiLz1x8O4t0YkEhie244=",
            "keyDetails": "PKIX_ED25519",
            "validFor": {
              "start": "2025-09-23T00:00:00Z"
            }
          },
          "logId": {
            "keyId": "zxGZFVvd0FEmjR8WrFwMdcAJ9vtaY/QXf44Y1wUeP6A="
          }
        }
      ],
      "certificateAuthorities": [
        {
          "subject": {
            "organization": "sigstore.dev",
            "commonName": "sigstore"
          },
          "uri": "https://fulcio.sigstore.dev",
          "certChain": {
            "certificates": [
              {
                "rawBytes": "MIIB+DCCAX6gAwIBAgITNVkDZoCiofPDsy7dfm6geLbuhzAKBggqhkjOPQQDAzAqMRUwEwYDVQQKEwxzaWdzdG9yZS5kZXYxETAPBgNVBAMTCHNpZ3N0b3JlMB4XDTIxMDMwNzAzMjAyOVoXDTMxMDIyMzAzMjAyOVowKjEVMBMGA1UEChMMc2lnc3RvcmUuZGV2MREwDwYDVQQDEwhzaWdzdG9yZTB2MBAGByqGSM49AgEGBSuBBAAiA2IABLSyA7Ii5k+pNO8ZEWY0ylemWDowOkNa3kL+GZE5Z5GWehL9/A9bRNA3RbrsZ5i0JcastaRL7Sp5fp/jD5dxqc/UdTVnlvS16an+2Yfswe/QuLolRUCrcOE2+2iA5+tzd6NmMGQwDgYDVR0PAQH/BAQDAgEGMBIGA1UdEwEB/wQIMAYBAf8CAQEwHQYDVR0OBBYEFMjFHQBBmiQpMlEk6w2uSu1KBtPsMB8GA1UdIwQYMBaAFMjFHQBBmiQpMlEk6w2uSu1KBtPsMAoGCCqGSM49BAMDA2gAMGUCMH8liWJfMui6vXXBhjDgY4MwslmN/TJxVe/83WrFomwmNf056y1X48F9c4m3a3ozXAIxAKjRay5/aj/jsKKGIkmQatjI8uupHr/+CxFvaJWmpYqNkLDGRU+9orzh5hI2RrcuaQ=="
              }
            ]
          },
          "validFor": {
            "start": "2021-03-07T03:20:29Z",
            "end": "2022-12-31T23:59:59.999Z"
          }
        },
        {
          "subject": {
            "organization": "sigstore.dev",
            "commonName": "sigstore"
          },
          "uri": "https://fulcio.sigstore.dev",
          "certChain": {
            "certificates": [
              {
                "rawBytes": "MIICGjCCAaGgAwIBAgIUALnViVfnU0brJasmRkHrn/UnfaQwCgYIKoZIzj0EAwMwKjEVMBMGA1UEChMMc2lnc3RvcmUuZGV2MREwDwYDVQQDEwhzaWdzdG9yZTAeFw0yMjA0MTMyMDA2MTVaFw0zMTEwMDUxMzU2NThaMDcxFTATBgNVBAoTDHNpZ3N0b3JlLmRldjEeMBwGA1UEAxMVc2lnc3RvcmUtaW50ZXJtZWRpYXRlMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAE8RVS/ysH+NOvuDZyPIZtilgUF9NlarYpAd9HP1vBBH1U5CV77LSS7s0ZiH4nE7Hv7ptS6LvvR/STk798LVgMzLlJ4HeIfF3tHSaexLcYpSASr1kS0N/RgBJz/9jWCiXno3sweTAOBgNVHQ8BAf8EBAMCAQYwEwYDVR0lBAwwCgYIKwYBBQUHAwMwEgYDVR0TAQH/BAgwBgEB/wIBADAdBgNVHQ4EFgQU39Ppz1YkEZb5qNjpKFWixi4YZD8wHwYDVR0jBBgwFoAUWMAeX5FFpWapesyQoZMi0CrFxfowCgYIKoZIzj0EAwMDZwAwZAIwPCsQK4DYiZYDPIaDi5HFKnfxXx6ASSVmERfsynYBiX2X6SJRnZU84/9DZdnFvvxmAjBOt6QpBlc4J/0DxvkTCqpclvziL6BCCPnjdlIB3Pu3BxsPmygUY7Ii2zbdCdliiow="
              },
              {
                "rawBytes": "MIIB9zCCAXygAwIBAgIUALZNAPFdxHPwjeDloDwyYChAO/4wCgYIKoZIzj0EAwMwKjEVMBMGA1UEChMMc2lnc3RvcmUuZGV2MREwDwYDVQQDEwhzaWdzdG9yZTAeFw0yMTEwMDcxMzU2NTlaFw0zMTEwMDUxMzU2NThaMCoxFTATBgNVBAoTDHNpZ3N0b3JlLmRldjERMA8GA1UEAxMIc2lnc3RvcmUwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAAT7XeFT4rb3PQGwS4IajtLk3/OlnpgangaBclYpsYBr5i+4ynB07ceb3LP0OIOZdxexX69c5iVuyJRQ+Hz05yi+UF3uBWAlHpiS5sh0+H2GHE7SXrk1EC5m1Tr19L9gg92jYzBhMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBRYwB5fkUWlZql6zJChkyLQKsXF+jAfBgNVHSMEGDAWgBRYwB5fkUWlZql6zJChkyLQKsXF+jAKBggqhkjOPQQDAwNpADBmAjEAj1nHeXZp+13NWBNa+EDsDP8G1WWg1tCMWP/WHPqpaVo0jhsweNFZgSs0eE7wYI4qAjEA2WB9ot98sIkoF3vZYdd3/VtWB5b9TNMea7Ix/stJ5TfcLLeABLE4BNJOsQ4vnBHJ"
              }
            ]
          },
          "validFor": {
            "start": "2022-04-13T20:06:15Z"
          }
        }
      ],
      "ctlogs": [
        {
          "baseUrl": "https://ctfe.sigstore.dev/test",
          "hashAlgorithm": "SHA2_256",
          "publicKey": {
            "rawBytes": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEbfwR+RJudXscgRBRpKX1XFDy3PyudDxz/SfnRi1fT8ekpfBd2O1uoz7jr3Z8nKzxA69EUQ+eFCFI3zeubPWU7w==",
            "keyDetails": "PKIX_ECDSA_P256_SHA_256",
            "validFor": {
              "start": "2021-03-14T00:00:00Z",
              "end": "2022-10-31T23:59:59.999Z"
            }
          },
          "logId": {
            "keyId": "CGCS8ChS/2hF0dFrJ4ScRWcYrBY9wzjSbea8IgY2b3I="
          }
        },
        {
          "baseUrl": "https://ctfe.sigstore.dev/2022",
          "hashAlgorithm": "SHA2_256",
          "publicKey": {
            "rawBytes": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEiPSlFi0CmFTfEjCUqF9HuCEcYXNKAaYalIJmBZ8yyezPjTqhxrKBpMnaocVtLJBI1eM3uXnQzQGAJdJ4gs9Fyw==",
            "keyDetails": "PKIX_ECDSA_P256_SHA_256",
            "validFor": {
              "start": "2022-10-20T00:00:00Z"
            }
          },
          "logId": {
            "keyId": "3T0wasbHETJjGR4cmWc3AqJKXrjePK3/h4pygC8p7o4="
          }
        }
      ],
      "timestampAuthorities": [
        {
          "subject": {
            "organization": "sigstore.dev",
            "commonName": "sigstore-tsa-selfsigned"
          },
          "uri": "https://timestamp.sigstore.dev/api/v1/timestamp",
          "certChain": {
            "certificates": [
              {
                "rawBytes": "MIICEDCCAZagAwIBAgIUOhNULwyQYe68wUMvy4qOiyojiwwwCgYIKoZIzj0EAwMwOTEVMBMGA1UEChMMc2lnc3RvcmUuZGV2MSAwHgYDVQQDExdzaWdzdG9yZS10c2Etc2VsZnNpZ25lZDAeFw0yNTA0MDgwNjU5NDNaFw0zNTA0MDYwNjU5NDNaMC4xFTATBgNVBAoTDHNpZ3N0b3JlLmRldjEVMBMGA1UEAxMMc2lnc3RvcmUtdHNhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAE4ra2Z8hKNig2T9kFjCAToGG30jky+WQv3BzL+mKvh1SKNR/UwuwsfNCg4sryoYAd8E6isovVA3M4aoNdm9QDi50Z8nTEyvqgfDPtTIwXItfiW/AFf1V7uwkbkAoj0xxco2owaDAOBgNVHQ8BAf8EBAMCB4AwHQYDVR0OBBYEFIn9eUOHz9BlRsMCRscsc1t9tOsDMB8GA1UdIwQYMBaAFJjsAe9/u1H/1JUeb4qImFMHic6/MBYGA1UdJQEB/wQMMAoGCCsGAQUFBwMIMAoGCCqGSM49BAMDA2gAMGUCMDtpsV/6KaO0qyF/UMsX2aSUXKQFdoGTptQGc0ftq1csulHPGG6dsmyMNd3JB+G3EQIxAOajvBcjpJmKb4Nv+2Taoj8Uc5+b6ih6FXCCKraSqupe07zqswMcXJTe1cExvHvvlw=="
              },
              {
                "rawBytes": "MIIB9zCCAXygAwIBAgIUV7f0GLDOoEzIh8LXSW80OJiUp14wCgYIKoZIzj0EAwMwOTEVMBMGA1UEChMMc2lnc3RvcmUuZGV2MSAwHgYDVQQDExdzaWdzdG9yZS10c2Etc2VsZnNpZ25lZDAeFw0yNTA0MDgwNjU5NDNaFw0zNTA0MDYwNjU5NDNaMDkxFTATBgNVBAoTDHNpZ3N0b3JlLmRldjEgMB4GA1UEAxMXc2lnc3RvcmUtdHNhLXNlbGZzaWduZWQwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAAQUQNtfRT/ou3YATa6wB/kKTe70cfJwyRIBovMnt8RcJph/COE82uyS6FmppLLL1VBPGcPfpQPYJNXzWwi8icwhKQ6W/Qe2h3oebBb2FHpwNJDqo+TMaC/tdfkv/ElJB72jRTBDMA4GA1UdDwEB/wQEAwIBBjASBgNVHRMBAf8ECDAGAQH/AgEAMB0GA1UdDgQWBBSY7AHvf7tR/9SVHm+KiJhTB4nOvzAKBggqhkjOPQQDAwNpADBmAjEAwGEGrfGZR1cen1R8/DTVMI943LssZmJRtDp/i7SfGHmGRP6gRbuj9vOK3b67Z0QQAjEAuT2H673LQEaHTcyQSZrkp4mX7WwkmF+sVbkYY5mXN+RMH13KUEHHOqASaemYWK/E"
              }
            ]
          },
          "validFor": {
            "start": "2025-07-04T00:00:00Z"
          }
        }
      ]
    };
  }
});

// node_modules/@tinfoilsh/verifier/dist/sigstore.js
async function verifySigstoreBundle(bundleJson, digest, repo, expectedReleaseTag) {
  try {
    const { SigstoreVerifier: SigstoreVerifier2, GITHUB_OIDC_ISSUER: GITHUB_OIDC_ISSUER2, AllOf: AllOf2, OIDCIssuer: OIDCIssuer2, GitHubWorkflowRepository: GitHubWorkflowRepository2 } = await Promise.resolve().then(() => (init_dist2(), dist_exports));
    const verifier = new SigstoreVerifier2();
    await verifier.loadSigstoreRoot(sigstore_trusted_root_default);
    const bundle = bundleJson;
    if (bundle?.verificationMaterial?.x509CertificateChain) {
      throw new AttestationError("Legacy x509CertificateChain bundle format is not supported; only the v0.3 single-certificate format is accepted");
    }
    const workflowRefPolicy = new GitHubWorkflowRefPattern(/^refs\/tags\//);
    const policy = new AllOf2([
      new OIDCIssuer2(GITHUB_OIDC_ISSUER2),
      new GitHubWorkflowRepository2(repo),
      workflowRefPolicy
    ]);
    const { payloadType, payload: payloadBytes } = await verifier.verifyDsse(bundle, policy);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (payloadType !== "application/vnd.in-toto+json") {
      throw new AttestationError(`Unsupported Sigstore payload type: "${payloadType}". Only in-toto statements (application/vnd.in-toto+json) are supported`);
    }
    {
      const allowed = /* @__PURE__ */ new Set(["_type", "subject", "predicateType", "predicate"]);
      const extra = Object.keys(payload).filter((k) => !allowed.has(k));
      if (extra.length > 0) {
        throw new AttestationError(`In-toto statement has unknown top-level field(s): ${extra.sort().join(", ")}`);
      }
    }
    const predicateType = payload.predicateType;
    const predicateFields = payload.predicate;
    if (digest !== payload.subject[0].digest.sha256) {
      throw new AttestationError(`Release digest mismatch: The release digest from GitHub (${digest}) does not match the digest in the sigstore bundle (${payload.subject[0].digest.sha256})`);
    }
    let registers;
    if (!predicateFields) {
      throw new AttestationError("Invalid Sigstore bundle: Payload is missing the predicate field containing measurements");
    }
    if (predicateType === PredicateType.SnpTdxMultiplatformV1) {
      if (!predicateFields.snp_measurement) {
        throw new AttestationError("Invalid Sigstore bundle: SNP/TDX multiplatform predicate is missing the snp_measurement field");
      }
      registers = [predicateFields.snp_measurement];
    } else {
      throw new AttestationError(`Unsupported in-toto predicate type: "${predicateType}". Only SNP/TDX multiplatform V1 is supported`);
    }
    const releaseTag = workflowRefPolicy.releaseTag();
    if (expectedReleaseTag !== void 0 && expectedReleaseTag !== releaseTag) {
      throw new AttestationError(`Release tag mismatch: selected release "${expectedReleaseTag}" was signed from "${releaseTag}"`);
    }
    return {
      measurement: {
        type: predicateType,
        registers
      },
      releaseTag
    };
  } catch (e) {
    wrapOrThrow(e, AttestationError, "Sigstore code bundle verification failed");
  }
}
var GitHubWorkflowRefPattern;
var init_sigstore2 = __esm({
  "node_modules/@tinfoilsh/verifier/dist/sigstore.js"() {
    init_types();
    init_sigstore_trusted_root();
    init_errors();
    GitHubWorkflowRefPattern = class {
      constructor(pattern) {
        this.pattern = typeof pattern === "string" ? new RegExp(pattern) : pattern;
      }
      verify(cert) {
        const ext = cert.extGitHubWorkflowRef;
        if (!ext) {
          throw new AttestationError("Sigstore certificate verification failed: Missing GitHub workflow reference extension");
        }
        if (!this.pattern.test(ext.workflowRef)) {
          throw new AttestationError(`Sigstore certificate verification failed: Workflow reference "${ext.workflowRef}" does not match expected pattern (must be a tagged release)`);
        }
        this.verifiedWorkflowRef = ext.workflowRef;
      }
      releaseTag() {
        if (!this.verifiedWorkflowRef) {
          throw new AttestationError("Sigstore certificate verification failed: GitHub workflow reference was not verified");
        }
        return this.verifiedWorkflowRef.slice("refs/tags/".length);
      }
    };
  }
});

// node_modules/@tinfoilsh/verifier/dist/dcode.js
function base32Decode(input) {
  const s = input.toUpperCase().replace(/=+$/, "");
  if (!s)
    return new Uint8Array(0);
  const out = new Uint8Array(Math.floor(s.length * 5 / 8));
  let bits = 0, val = 0, idx = 0;
  for (const c of s) {
    const i = B32.indexOf(c);
    if (i < 0)
      throw new AttestationError(`Invalid certificate data: Unexpected character "${c}" in base32-encoded field`);
    val = val << 5 | i;
    if ((bits += 5) >= 8)
      out[idx++] = val >> (bits -= 8) & 255;
  }
  return out;
}
function decodeDomains(domains, prefix) {
  const pattern = `.${prefix}.`;
  const chunks = domains.filter((d) => d.includes(pattern)).sort((a, b) => +a.slice(0, 2) - +b.slice(0, 2)).map((d) => d.split(".")[0].slice(2)).join("");
  if (!chunks)
    throw new AttestationError(`Invalid certificate: Missing expected DNS names with prefix "${prefix}"`);
  return base32Decode(chunks);
}
var B32, bytesToHex6;
var init_dcode = __esm({
  "node_modules/@tinfoilsh/verifier/dist/dcode.js"() {
    init_errors();
    B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    bytesToHex6 = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
});

// node_modules/@tinfoilsh/verifier/dist/cert-verify.js
function extractSANs(cert) {
  const sanExtension = cert.extension("2.5.29.17");
  if (!sanExtension) {
    return [];
  }
  const sans = [];
  const asn1 = ASN1Obj.parseBuffer(sanExtension.value);
  for (const generalName of asn1.subs) {
    if (generalName.tag.number === 2 && !generalName.tag.constructed) {
      sans.push(new TextDecoder().decode(generalName.value));
    }
  }
  return sans;
}
function getParentDomain(domain) {
  const parts = domain.split(".");
  if (parts.length <= 2) {
    return domain;
  }
  return parts.slice(1).join(".");
}
function domainMatchesSans(sans, expectedDomain) {
  const parentDomain = getParentDomain(expectedDomain);
  for (const san of sans) {
    if (san === expectedDomain) {
      return true;
    }
    if (san.startsWith("*.") && san.substring(2) === parentDomain && expectedDomain !== parentDomain) {
      return true;
    }
  }
  return false;
}
async function verifyCertificate(certPem, expectedDomain, attestationDoc, expectedHpkeKey) {
  let cert;
  try {
    cert = X509Certificate.parse(certPem);
  } catch (error) {
    throw new AttestationError(`Failed to parse enclave TLS certificate: ${error.message}`, { cause: error });
  }
  const sans = extractSANs(cert);
  if (sans.length === 0) {
    throw new AttestationError("Invalid enclave certificate: No Subject Alternative Names found");
  }
  if (!domainMatchesSans(sans, expectedDomain)) {
    throw new AttestationError(`Certificate domain mismatch: Certificate is not valid for "${expectedDomain}"`);
  }
  const hpkeSans = sans.filter((s) => s.includes(".hpke."));
  if (hpkeSans.length === 0) {
    throw new AttestationError("Invalid enclave certificate: No HPKE key embedded in Subject Alternative Names");
  }
  let hpkeKeyBytes;
  try {
    hpkeKeyBytes = decodeDomains(hpkeSans, "hpke");
  } catch (error) {
    throw new AttestationError(`Failed to extract HPKE key from certificate: ${error.message}`, { cause: error });
  }
  const hpkePublicKey = bytesToHex6(hpkeKeyBytes);
  if (hpkePublicKey !== expectedHpkeKey) {
    throw new AttestationError("HPKE key mismatch: The encryption key in the certificate does not match the attested key");
  }
  const hattSans = sans.filter((s) => s.includes(".hatt."));
  if (hattSans.length === 0) {
    throw new AttestationError("Invalid enclave certificate: No attestation hash embedded in Subject Alternative Names");
  }
  let hashBytes;
  try {
    hashBytes = decodeDomains(hattSans, "hatt");
  } catch (error) {
    throw new AttestationError(`Failed to extract attestation hash from certificate: ${error.message}`, { cause: error });
  }
  const certAttestationHash = new TextDecoder().decode(hashBytes);
  const computedHash = await hashAttestationDocument(attestationDoc);
  if (certAttestationHash !== computedHash) {
    throw new AttestationError("Attestation hash mismatch: The hash in the certificate does not match the attestation document");
  }
  return {
    hpkePublicKey,
    attestationHash: computedHash,
    dnsNames: sans
  };
}
var init_cert_verify = __esm({
  "node_modules/@tinfoilsh/verifier/dist/cert-verify.js"() {
    init_dist2();
    init_dist();
    init_dcode();
    init_types();
    init_errors();
  }
});

// node_modules/@tinfoilsh/verifier/dist/json.js
function cloneVerificationDocument(document) {
  return structuredClone(document);
}
var init_json = __esm({
  "node_modules/@tinfoilsh/verifier/dist/json.js"() {
  }
});

// node_modules/@tinfoilsh/verifier/dist/version.js
var VERIFIER_NAME, VERIFIER_VERSION, VERIFICATION_DOCUMENT_SCHEMA_VERSION;
var init_version = __esm({
  "node_modules/@tinfoilsh/verifier/dist/version.js"() {
    VERIFIER_NAME = "@tinfoilsh/verifier";
    VERIFIER_VERSION = "1.2.1";
    VERIFICATION_DOCUMENT_SCHEMA_VERSION = 1;
  }
});

// node_modules/@tinfoilsh/verifier/dist/client.js
function verifierIdentity() {
  return { name: VERIFIER_NAME, version: VERIFIER_VERSION };
}
var Verifier;
var init_client = __esm({
  "node_modules/@tinfoilsh/verifier/dist/client.js"() {
    init_attestation();
    init_sigstore2();
    init_bundle();
    init_cert_verify();
    init_types();
    init_errors();
    init_json();
    init_version();
    Verifier = class {
      constructor(options) {
        if (!options.configRepo) {
          throw new ConfigurationError("configRepo is required for Verifier");
        }
        this.serverURL = options.serverURL;
        this.configRepo = options.configRepo;
      }
      async verify() {
        if (!this.serverURL) {
          throw new ConfigurationError("serverURL is required for verify(). Use verifyBundle() with an attestation bundle instead.");
        }
        const domain = new URL(this.serverURL).hostname;
        const bundle = await assembleAttestationBundle(domain, this.configRepo);
        return this.verifyBundle(bundle);
      }
      async verifyBundle(bundle) {
        const { enclaveAttestationReport: attestationDoc, vcek, digest, releaseTag: selectedReleaseTag, sigstoreBundle, domain, enclaveCert } = bundle;
        const steps = {
          fetchDigest: { status: "success" },
          // Already fetched by caller
          verifyCode: { status: "pending" },
          verifyEnclave: { status: "pending" },
          compareMeasurements: { status: "pending" },
          verifyCertificate: { status: "pending" }
        };
        try {
          let amdVerification;
          try {
            amdVerification = await verifyAttestation2(attestationDoc, vcek);
            steps.verifyEnclave = { status: "success" };
          } catch (error) {
            steps.verifyEnclave = { status: "failed", error: error.message };
            this.saveFailedVerificationDocument(steps, domain);
            throw error;
          }
          let codeMeasurements;
          let releaseTag;
          try {
            const verifiedCode = await verifySigstoreBundle(sigstoreBundle, digest, this.configRepo, selectedReleaseTag);
            codeMeasurements = verifiedCode.measurement;
            releaseTag = verifiedCode.releaseTag;
            steps.verifyCode = { status: "success" };
          } catch (error) {
            steps.verifyCode = { status: "failed", error: error.message };
            this.saveFailedVerificationDocument(steps, domain);
            throw error;
          }
          try {
            compareMeasurements(codeMeasurements, amdVerification.measurement);
            steps.compareMeasurements = { status: "success" };
          } catch (error) {
            steps.compareMeasurements = { status: "failed", error: error.message };
            this.saveFailedVerificationDocument(steps, domain);
            throw error;
          }
          try {
            await verifyCertificate(enclaveCert, domain, attestationDoc, amdVerification.hpkePublicKey || "");
            steps.verifyCertificate = { status: "success" };
          } catch (error) {
            steps.verifyCertificate = { status: "failed", error: error.message };
            this.saveFailedVerificationDocument(steps, domain);
            throw error;
          }
          this.verificationDocument = {
            schemaVersion: VERIFICATION_DOCUMENT_SCHEMA_VERSION,
            configRepo: this.configRepo,
            enclaveHost: domain,
            releaseTag,
            releaseDigest: digest,
            codeMeasurement: codeMeasurements,
            enclaveMeasurement: amdVerification,
            tlsPublicKey: amdVerification.tlsPublicKeyFingerprint || "",
            hpkePublicKey: amdVerification.hpkePublicKey || "",
            codeFingerprint: await measurementFingerprint(codeMeasurements),
            enclaveFingerprint: await measurementFingerprint(amdVerification.measurement),
            selectedRouterEndpoint: domain,
            securityVerified: true,
            verifier: verifierIdentity(),
            verifiedAt: (/* @__PURE__ */ new Date()).toISOString(),
            steps
          };
          return amdVerification;
        } catch (error) {
          if (!this.verificationDocument) {
            this.saveFailedVerificationDocument(steps, domain);
          }
          throw error;
        }
      }
      saveFailedVerificationDocument(steps, domain) {
        this.verificationDocument = {
          schemaVersion: VERIFICATION_DOCUMENT_SCHEMA_VERSION,
          configRepo: this.configRepo,
          enclaveHost: domain,
          releaseDigest: "",
          codeMeasurement: { type: "", registers: [] },
          enclaveMeasurement: { measurement: { type: "", registers: [] } },
          tlsPublicKey: "",
          hpkePublicKey: "",
          codeFingerprint: "",
          enclaveFingerprint: "",
          selectedRouterEndpoint: domain,
          securityVerified: false,
          verifier: verifierIdentity(),
          steps
        };
      }
      getVerificationDocument() {
        return this.verificationDocument ? cloneVerificationDocument(this.verificationDocument) : void 0;
      }
    };
  }
});

// node_modules/@tinfoilsh/verifier/dist/index.js
var init_dist3 = __esm({
  "node_modules/@tinfoilsh/verifier/dist/index.js"() {
    init_errors();
    init_client();
    init_json();
    init_version();
  }
});

// node_modules/tinfoil/dist/verifier.js
var init_verifier = __esm({
  "node_modules/tinfoil/dist/verifier.js"() {
    init_dist3();
  }
});

// node_modules/tinfoil/dist/user-cache-secret-store.browser.js
var user_cache_secret_store_browser_exports = {};
__export(user_cache_secret_store_browser_exports, {
  loadOrPersistUserCacheSecret: () => loadOrPersistUserCacheSecret
});
function loadOrPersistUserCacheSecret(_generateSecret) {
  return null;
}
var init_user_cache_secret_store_browser = __esm({
  "node_modules/tinfoil/dist/user-cache-secret-store.browser.js"() {
  }
});

// node_modules/tinfoil/dist/pinned-tls-fetch.browser.js
var pinned_tls_fetch_browser_exports = {};
__export(pinned_tls_fetch_browser_exports, {
  createPinnedTlsFetch: () => createPinnedTlsFetch
});
async function createPinnedTlsFetch(baseURL, expectedFingerprintHex) {
  throw new ConfigurationError("TLS certificate pinning is not supported in browser environments. This should not have been called - please report this as a bug.");
}
var init_pinned_tls_fetch_browser = __esm({
  "node_modules/tinfoil/dist/pinned-tls-fetch.browser.js"() {
    init_verifier();
  }
});

// node_modules/tinfoil/dist/pinned-ws.browser.js
var pinned_ws_browser_exports = {};
__export(pinned_ws_browser_exports, {
  createPinnedWebSocket: () => createPinnedWebSocket,
  pinnedWsClientOptions: () => pinnedWsClientOptions
});
async function pinnedWsClientOptions(_expectedFingerprintHex) {
  throw new ConfigurationError(BROWSER_ERROR);
}
async function createPinnedWebSocket(_url, _expectedFingerprintHex, _options) {
  throw new ConfigurationError(BROWSER_ERROR);
}
var BROWSER_ERROR;
var init_pinned_ws_browser = __esm({
  "node_modules/tinfoil/dist/pinned-ws.browser.js"() {
    init_verifier();
    BROWSER_ERROR = "Verified WebSockets are not supported in browser environments: browsers do not expose TLS certificate details, so the connection cannot be pinned to the attested enclave key.";
  }
});

// node_modules/hpke/index.js
function ComputeNonce(base_nonce, seq, Nn) {
  const nonce = new Uint8Array(Nn);
  nonce.set(base_nonce);
  let s = seq;
  for (let i = Nn - 1; i >= 0 && s > 0; i--) {
    nonce[i] = nonce[i] ^ s & 255;
    s = Math.floor(s / 256);
  }
  return nonce;
}
function MaxSeq(Nn) {
  return Math.min(2 ** (8 * Nn) - 1, Number.MAX_SAFE_INTEGER);
}
function IncrementSeq(seq, maxSeq) {
  if (seq >= maxSeq) {
    throw new MessageLimitReachedError("Sequence number overflow");
  }
  return ++seq;
}
async function ContextExport(suite, exporterSecret, exporterContext, L) {
  checkUint8Array(exporterContext, "exporterContext");
  const stages = KDFStages(suite.KDF);
  if (!Number.isInteger(L) || L <= 0 || L > 65535) {
    throw new TypeError('"L" must be a positive integer not exceeding 65535');
  }
  if (stages === 2 && L > 255 * suite.KDF.Nh) {
    throw new TypeError('"L" must not exceed 255*Nh of the cipher suite KDF');
  }
  const Export = stages === 1 ? Export_OneStage : Export_TwoStage;
  return await Export(suite.KDF, suite.id, exporterSecret, exporterContext, L);
}
var _locked;
var Mutex = class {
  constructor() {
    __privateAdd(this, _locked, Promise.resolve());
  }
  async lock() {
    let releaseLock;
    const nextLock = new Promise((resolve) => {
      releaseLock = resolve;
    });
    const previousLock = __privateGet(this, _locked);
    __privateSet(this, _locked, nextLock);
    await previousLock;
    return releaseLock;
  }
};
_locked = new WeakMap();
function createContextState(suite, mode, key, base_nonce, exporter_secret) {
  return {
    suite,
    mode,
    key,
    base_nonce,
    exporter_secret,
    max_seq: MaxSeq(suite.AEAD.Nn),
    seq: 0,
    mutex: void 0
  };
}
var _state;
var SenderContext = class {
  constructor(suite, mode, key, base_nonce, exporter_secret) {
    __privateAdd(this, _state);
    __privateSet(this, _state, createContextState(suite, mode, key, base_nonce, exporter_secret));
  }
  get mode() {
    return __privateGet(this, _state).mode;
  }
  get seq() {
    return __privateGet(this, _state).seq;
  }
  async Seal(plaintext, aad) {
    checkUint8Array(plaintext, "plaintext");
    aad ?? (aad = new Uint8Array());
    checkUint8Array(aad, "aad");
    const state = __privateGet(this, _state);
    if (state.suite.AEAD.id === EXPORT_ONLY) {
      throw new TypeError("Export-only AEAD cannot be used with Seal");
    }
    state.mutex ?? (state.mutex = new Mutex());
    const release = await state.mutex.lock();
    let ct;
    try {
      ct = await state.suite.AEAD.Seal(
        state.key,
        ComputeNonce(state.base_nonce, state.seq, state.suite.AEAD.Nn),
        aad,
        plaintext
      );
      state.seq = IncrementSeq(state.seq, state.max_seq);
      return ct;
    } finally {
      release();
    }
  }
  async Export(exporterContext, length) {
    return await ContextExport(
      __privateGet(this, _state).suite,
      __privateGet(this, _state).exporter_secret,
      exporterContext,
      length
    );
  }
  get Nt() {
    return __privateGet(this, _state).suite.AEAD.Nt;
  }
};
_state = new WeakMap();
var _state2;
var RecipientContext = class {
  constructor(suite, mode, key, base_nonce, exporter_secret) {
    __privateAdd(this, _state2);
    __privateSet(this, _state2, createContextState(suite, mode, key, base_nonce, exporter_secret));
  }
  get mode() {
    return __privateGet(this, _state2).mode;
  }
  get seq() {
    return __privateGet(this, _state2).seq;
  }
  async Open(ciphertext, aad) {
    checkUint8Array(ciphertext, "ciphertext");
    aad ?? (aad = new Uint8Array());
    checkUint8Array(aad, "aad");
    const state = __privateGet(this, _state2);
    if (state.suite.AEAD.id === EXPORT_ONLY) {
      throw new TypeError("Export-only AEAD cannot be used with Open");
    }
    state.mutex ?? (state.mutex = new Mutex());
    const release = await state.mutex.lock();
    try {
      let pt;
      try {
        pt = await state.suite.AEAD.Open(
          state.key,
          ComputeNonce(state.base_nonce, state.seq, state.suite.AEAD.Nn),
          aad,
          ciphertext
        );
      } catch (cause) {
        if (cause instanceof MessageLimitReachedError || cause instanceof NotSupportedError) {
          throw cause;
        }
        throw new OpenError("AEAD decryption failed", { cause });
      }
      state.seq = IncrementSeq(state.seq, state.max_seq);
      return pt;
    } finally {
      release();
    }
  }
  async Export(exporterContext, length) {
    return await ContextExport(
      __privateGet(this, _state2).suite,
      __privateGet(this, _state2).exporter_secret,
      exporterContext,
      length
    );
  }
};
_state2 = new WeakMap();
var validate = (factory, type) => {
  try {
    const result = factory();
    if (result.type !== type) {
      throw new Error(`Invalid "${type}" return discriminator`);
    }
    return result;
  } catch (cause) {
    throw new TypeError(`Invalid "${type}"`, { cause });
  }
};
var _suite, _CipherSuite_instances, extractRecipientKeys_fn;
var CipherSuite = class {
  constructor(KEM, KDF, AEAD) {
    __privateAdd(this, _CipherSuite_instances);
    __privateAdd(this, _suite);
    const kem = validate(KEM, "KEM");
    const kdf2 = validate(KDF, "KDF");
    const aead2 = validate(AEAD, "AEAD");
    __privateSet(this, _suite, {
      KEM: kem,
      KDF: kdf2,
      AEAD: aead2,
      id: concat(L_HPKE, I2OSP(kem.id, 2), I2OSP(kdf2.id, 2), I2OSP(aead2.id, 2))
    });
  }
  get KEM() {
    return {
      id: __privateGet(this, _suite).KEM.id,
      name: __privateGet(this, _suite).KEM.name,
      Nsecret: __privateGet(this, _suite).KEM.Nsecret,
      Nenc: __privateGet(this, _suite).KEM.Nenc,
      Npk: __privateGet(this, _suite).KEM.Npk,
      Nsk: __privateGet(this, _suite).KEM.Nsk
    };
  }
  get KDF() {
    return {
      id: __privateGet(this, _suite).KDF.id,
      name: __privateGet(this, _suite).KDF.name,
      stages: __privateGet(this, _suite).KDF.stages,
      Nh: __privateGet(this, _suite).KDF.Nh
    };
  }
  get AEAD() {
    return {
      id: __privateGet(this, _suite).AEAD.id,
      name: __privateGet(this, _suite).AEAD.name,
      Nk: __privateGet(this, _suite).AEAD.Nk,
      Nn: __privateGet(this, _suite).AEAD.Nn,
      Nt: __privateGet(this, _suite).AEAD.Nt
    };
  }
  async GenerateKeyPair(extractable) {
    extractable ?? (extractable = false);
    checkExtractable(extractable);
    return await __privateGet(this, _suite).KEM.GenerateKeyPair(extractable);
  }
  async DeriveKeyPair(ikm, extractable) {
    extractable ?? (extractable = false);
    checkExtractable(extractable);
    checkUint8Array(ikm, "ikm");
    if (ikm.byteLength < __privateGet(this, _suite).KEM.Nsk) {
      throw new DeriveKeyPairError('Insufficient "ikm" length');
    }
    try {
      return await __privateGet(this, _suite).KEM.DeriveKeyPair(ikm, extractable);
    } catch (cause) {
      if (cause instanceof NotSupportedError) {
        throw cause;
      }
      throw new DeriveKeyPairError("Key derivation failed", { cause });
    }
  }
  async SerializePrivateKey(privateKey) {
    isKey(privateKey, "private", true);
    return await __privateGet(this, _suite).KEM.SerializePrivateKey(privateKey);
  }
  async SerializePublicKey(publicKey) {
    isKey(publicKey, "public", true);
    return await __privateGet(this, _suite).KEM.SerializePublicKey(publicKey);
  }
  async DeserializePrivateKey(privateKey, extractable) {
    extractable ?? (extractable = false);
    checkExtractable(extractable);
    checkUint8Array(privateKey, "privateKey");
    try {
      if (privateKey.byteLength !== __privateGet(this, _suite).KEM.Nsk) {
        throw new Error('Invalid "privateKey" length');
      }
      return await __privateGet(this, _suite).KEM.DeserializePrivateKey(privateKey, extractable);
    } catch (cause) {
      if (cause instanceof NotSupportedError) {
        throw cause;
      }
      throw new DeserializeError("Private key deserialization failed", { cause });
    }
  }
  async DeserializePublicKey(publicKey) {
    checkUint8Array(publicKey, "publicKey");
    try {
      if (publicKey.byteLength !== __privateGet(this, _suite).KEM.Npk) {
        throw new Error('Invalid "publicKey" length');
      }
      return await __privateGet(this, _suite).KEM.DeserializePublicKey(publicKey);
    } catch (cause) {
      if (cause instanceof NotSupportedError) {
        throw cause;
      }
      throw new DeserializeError("Public key deserialization failed", { cause });
    }
  }
  async Seal(publicKey, plaintext, options) {
    if (__privateGet(this, _suite).AEAD.id === EXPORT_ONLY) {
      throw new TypeError("Export-only AEAD cannot be used with Seal");
    }
    const { encapsulatedSecret, ctx } = await this.SetupSender(publicKey, options);
    const ciphertext = await ctx.Seal(plaintext, options?.aad);
    return { encapsulatedSecret, ciphertext };
  }
  async Open(privateKey, encapsulatedSecret, ciphertext, options) {
    if (__privateGet(this, _suite).AEAD.id === EXPORT_ONLY) {
      throw new TypeError("Export-only AEAD cannot be used with Open");
    }
    const ctx = await this.SetupRecipient(privateKey, encapsulatedSecret, options);
    return await ctx.Open(ciphertext, options?.aad);
  }
  async SendExport(publicKey, exporterContext, length, options) {
    const { encapsulatedSecret, ctx } = await this.SetupSender(publicKey, options);
    const exportedSecret = await ctx.Export(exporterContext, length);
    return { encapsulatedSecret, exportedSecret };
  }
  async ReceiveExport(privateKey, encapsulatedSecret, exporterContext, length, options) {
    const ctx = await this.SetupRecipient(privateKey, encapsulatedSecret, options);
    return await ctx.Export(exporterContext, length);
  }
  async SetupSender(publicKey, options) {
    isKey(publicKey, "public");
    let shared_secret;
    let enc;
    try {
      const result = await __privateGet(this, _suite).KEM.Encap(publicKey);
      shared_secret = result.shared_secret;
      enc = result.enc;
    } catch (cause) {
      if (cause instanceof ValidationError || cause instanceof NotSupportedError) {
        throw cause;
      }
      throw new EncapError("Encapsulation failed", { cause });
    }
    const mode = options?.psk?.byteLength ? MODE_PSK : MODE_BASE;
    const { key, base_nonce, exporter_secret } = await KeySchedule(
      __privateGet(this, _suite),
      mode,
      shared_secret,
      options?.info,
      options?.psk,
      options?.pskId
    );
    const ctx = new SenderContext(__privateGet(this, _suite), mode, key, base_nonce, exporter_secret);
    return { encapsulatedSecret: enc, ctx };
  }
  async SetupRecipient(privateKey, encapsulatedSecret, options) {
    const { skR, pkR } = __privateMethod(this, _CipherSuite_instances, extractRecipientKeys_fn).call(this, privateKey);
    checkUint8Array(encapsulatedSecret, "encapsulatedSecret");
    if (encapsulatedSecret.byteLength !== __privateGet(this, _suite).KEM.Nenc) {
      throw new DecapError("Invalid encapsulated secret length");
    }
    let shared_secret;
    try {
      shared_secret = await __privateGet(this, _suite).KEM.Decap(encapsulatedSecret, skR, pkR);
    } catch (cause) {
      if (cause instanceof ValidationError || cause instanceof NotSupportedError) {
        throw cause;
      }
      throw new DecapError("Decapsulation failed", { cause });
    }
    const mode = options?.psk?.byteLength ? MODE_PSK : MODE_BASE;
    const { key, base_nonce, exporter_secret } = await KeySchedule(
      __privateGet(this, _suite),
      mode,
      shared_secret,
      options?.info,
      options?.psk,
      options?.pskId
    );
    return new RecipientContext(__privateGet(this, _suite), mode, key, base_nonce, exporter_secret);
  }
};
_suite = new WeakMap();
_CipherSuite_instances = new WeakSet();
extractRecipientKeys_fn = function(skR) {
  if (isKeyPair(skR)) {
    return { skR: skR.privateKey, pkR: skR.publicKey };
  }
  isKey(skR, "private");
  return { skR, pkR: void 0 };
};
var ValidationError = class _ValidationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ValidationError";
    Error.captureStackTrace?.(this, _ValidationError);
  }
};
var DeserializeError = class _DeserializeError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "DeserializeError";
    Error.captureStackTrace?.(this, _DeserializeError);
  }
};
var EncapError = class _EncapError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "EncapError";
    Error.captureStackTrace?.(this, _EncapError);
  }
};
var DecapError = class _DecapError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "DecapError";
    Error.captureStackTrace?.(this, _DecapError);
  }
};
var OpenError = class _OpenError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "OpenError";
    Error.captureStackTrace?.(this, _OpenError);
  }
};
var MessageLimitReachedError = class _MessageLimitReachedError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "MessageLimitReachedError";
    Error.captureStackTrace?.(this, _MessageLimitReachedError);
  }
};
var DeriveKeyPairError = class _DeriveKeyPairError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "DeriveKeyPairError";
    Error.captureStackTrace?.(this, _DeriveKeyPairError);
  }
};
var NotSupportedError = class _NotSupportedError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "NotSupportedError";
    Error.captureStackTrace?.(this, _NotSupportedError);
  }
};
var MODE_BASE = 0;
var MODE_PSK = 1;
function concat(...buffers) {
  const size = buffers.reduce((acc, { length }) => acc + length, 0);
  const buf = new Uint8Array(size);
  let i = 0;
  for (const buffer of buffers) {
    buf.set(buffer, i);
    i += buffer.length;
  }
  return buf;
}
function slice(buffer, start, end) {
  return Uint8Array.prototype.slice.call(buffer, start, end);
}
function encode(string) {
  const bytes = new Uint8Array(string.length);
  for (let i = 0; i < string.length; i++) {
    const code = string.charCodeAt(i);
    if (code > 127) {
      throw new TypeError("Input string must contain only ASCII characters");
    }
    bytes[i] = code;
  }
  return bytes;
}
var L_HPKE_v1 = /* @__PURE__ */ encode("HPKE-v1");
var L_HPKE = /* @__PURE__ */ encode("HPKE");
var L_sec = /* @__PURE__ */ encode("sec");
var L_secret = /* @__PURE__ */ encode("secret");
var L_key = /* @__PURE__ */ encode("key");
var L_base_nonce = /* @__PURE__ */ encode("base_nonce");
var L_exp = /* @__PURE__ */ encode("exp");
var L_psk_id_hash = /* @__PURE__ */ encode("psk_id_hash");
var L_info_hash = /* @__PURE__ */ encode("info_hash");
function lengthPrefixed(x) {
  return concat(I2OSP(x.byteLength, 2), x);
}
async function LabeledDerive(KDF, suite_id, ikm, label, context, L) {
  const labeled_ikm = concat(ikm, L_HPKE_v1, suite_id, lengthPrefixed(label), I2OSP(L, 2), context);
  return await KDF.Derive(labeled_ikm, L);
}
async function Export_OneStage(KDF, suite_id, exporter_secret, exporter_context, L) {
  checkLength(exporter_context, "Exporter context", MAX_LENGTH_ONE_STAGE);
  return await LabeledDerive(KDF, suite_id, exporter_secret, L_sec, exporter_context, L);
}
async function CombineSecrets_OneStage(suite, mode, shared_secret, info, psk, psk_id) {
  checkLength(psk, "PSK", MAX_LENGTH_ONE_STAGE);
  checkLength(psk_id, "PSK ID", MAX_LENGTH_ONE_STAGE);
  checkLength(info, "Info", MAX_LENGTH_ONE_STAGE);
  const secrets = concat(lengthPrefixed(psk), lengthPrefixed(shared_secret));
  const context = concat(I2OSP(mode, 1), lengthPrefixed(psk_id), lengthPrefixed(info));
  const secret = await LabeledDerive(
    suite.KDF,
    suite.id,
    secrets,
    L_secret,
    context,
    suite.AEAD.Nk + suite.AEAD.Nn + suite.KDF.Nh
  );
  const key = slice(secret, 0, suite.AEAD.Nk);
  const base_nonce = slice(secret, suite.AEAD.Nk, suite.AEAD.Nk + suite.AEAD.Nn);
  const exporter_secret = slice(secret, suite.AEAD.Nk + suite.AEAD.Nn);
  return { key, base_nonce, exporter_secret };
}
var MAX_LENGTH_TWO_STAGE = 65535;
var MAX_LENGTH_ONE_STAGE = 65535;
function checkLength(data, name, maxLength) {
  if (data.byteLength > maxLength) {
    throw new TypeError(`${name} length must not exceed ${maxLength} bytes`);
  }
}
function checkUint8Array(input, name) {
  if (!(input instanceof Uint8Array)) {
    throw new TypeError(`"${name}" must be Uint8Array`);
  }
  if (typeof SharedArrayBuffer !== "undefined" && input.buffer instanceof SharedArrayBuffer) {
    throw new TypeError(`"${name}" must not be backed by a SharedArrayBuffer`);
  }
}
function checkExtractable(extractable) {
  if (typeof extractable !== "boolean") {
    throw new TypeError('"extractable" must be boolean');
  }
}
async function CombineSecrets_TwoStage(suite, mode, shared_secret, info, psk, psk_id) {
  checkLength(psk, "PSK", MAX_LENGTH_TWO_STAGE);
  checkLength(psk_id, "PSK ID", MAX_LENGTH_TWO_STAGE);
  checkLength(info, "Info", MAX_LENGTH_TWO_STAGE);
  const [psk_id_hash, info_hash] = await Promise.all([
    LabeledExtract(suite.KDF, suite.id, new Uint8Array(), L_psk_id_hash, psk_id),
    LabeledExtract(suite.KDF, suite.id, new Uint8Array(), L_info_hash, info)
  ]);
  const key_schedule_context = concat(I2OSP(mode, 1), psk_id_hash, info_hash);
  const secret = await LabeledExtract(suite.KDF, suite.id, shared_secret, L_secret, psk);
  if (suite.AEAD.id === EXPORT_ONLY) {
    const exporter_secret2 = await LabeledExpand(
      suite.KDF,
      suite.id,
      secret,
      L_exp,
      key_schedule_context,
      suite.KDF.Nh
    );
    return { key: new Uint8Array(), base_nonce: new Uint8Array(), exporter_secret: exporter_secret2 };
  }
  const [key, base_nonce, exporter_secret] = await Promise.all([
    LabeledExpand(suite.KDF, suite.id, secret, L_key, key_schedule_context, suite.AEAD.Nk),
    LabeledExpand(suite.KDF, suite.id, secret, L_base_nonce, key_schedule_context, suite.AEAD.Nn),
    LabeledExpand(suite.KDF, suite.id, secret, L_exp, key_schedule_context, suite.KDF.Nh)
  ]);
  return { key, base_nonce, exporter_secret };
}
async function Export_TwoStage(KDF, suite_id, exporter_secret, exporter_context, L) {
  checkLength(exporter_context, "Exporter context", MAX_LENGTH_TWO_STAGE);
  return await LabeledExpand(KDF, suite_id, exporter_secret, L_sec, exporter_context, L);
}
async function LabeledExtract(KDF, suite_id, salt, label, ikm) {
  const labeled_ikm = concat(L_HPKE_v1, suite_id, label, ikm);
  return await KDF.Extract(salt, labeled_ikm);
}
async function LabeledExpand(KDF, suite_id, prk, label, info, L) {
  const labeled_info = concat(I2OSP(L, 2), L_HPKE_v1, suite_id, label, info);
  return await KDF.Expand(prk, labeled_info, L);
}
function isKeyPair(skR) {
  if (!skR || typeof skR !== "object") return false;
  if ("publicKey" in skR && "privateKey" in skR) {
    const pkR = skR.publicKey;
    skR = skR.privateKey;
    try {
      isKey(pkR, "public");
      isKey(skR, "private");
      if (pkR.algorithm.name !== skR.algorithm.name) {
        throw new TypeError("key pair algorithms do not match");
      }
    } catch (cause) {
      throw new TypeError('Invalid "privateKey"', { cause });
    }
    return true;
  }
  return false;
}
function isKey(key, type, extractable) {
  const k = key;
  if (typeof k.algorithm !== "object" || typeof k.algorithm.name !== "string" || typeof k.extractable !== "boolean" || typeof k.type !== "string" || k.type !== type) {
    throw new TypeError(`Invalid "${type}Key"`);
  }
  if (extractable && k.extractable !== true) {
    throw new TypeError(`"${type}Key" must be extractable`);
  }
}
function I2OSP(n, w) {
  if (!Number.isSafeInteger(w) || w <= 0) {
    throw new Error("w must be a positive safe integer");
  }
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("n must be a non-negative safe integer");
  }
  const max = Math.pow(256, w);
  if (n >= max) {
    throw new Error("n too large to fit in w-length byte string");
  }
  const ret = new Uint8Array(w);
  let num = n;
  for (let i = 0; i < w && num; i++) {
    ret[w - (i + 1)] = num % 256;
    num = Math.floor(num / 256);
  }
  return ret;
}
function KDFStages(KDF) {
  if (KDF.stages === 1 || KDF.stages === 2) {
    return KDF.stages;
  }
  throw new Error("unreachable");
}
async function KeySchedule(suite, mode, shared_secret, info, psk, pskId) {
  info ?? (info = new Uint8Array());
  checkUint8Array(info, "info");
  psk ?? (psk = new Uint8Array());
  checkUint8Array(psk, "psk");
  pskId ?? (pskId = new Uint8Array());
  checkUint8Array(pskId, "pskId");
  const stages = KDFStages(suite.KDF);
  const CombineSecrets = stages === 1 ? CombineSecrets_OneStage : CombineSecrets_TwoStage;
  VerifyPSKInputs(psk, pskId);
  return await CombineSecrets(suite, mode, shared_secret, info, psk, pskId);
}
function VerifyPSKInputs(psk, psk_id) {
  if (psk.byteLength && psk_id.byteLength) {
    if (psk.byteLength < 32) {
      throw new TypeError("Insufficient PSK length");
    }
    return;
  }
  if (!psk.byteLength && !psk_id.byteLength) {
    return;
  }
  throw new TypeError("Inconsistent PSK inputs");
}
var EXPORT_ONLY = 65535;
var AES_GCM_P_MAX = 2 ** 36 - 31;
var CHACHA20_POLY1305_P_MAX = 2 ** 38 - 64;

// node_modules/@noble/ciphers/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle = (title) => title ? `"${title}" ` : "";
function abool(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function anumber(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes(value, length, title = "") {
  if (isBytes(value) && (length === void 0 || value.length === length))
    return value;
  if (length !== void 0)
    anumber(length, "length");
  const bytes = isBytes(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput(out, instance) {
  abytes(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function aoutput32(out, instance) {
  aoutput(out, instance);
  if (!isAligned32(out))
    throw new Error("invalid output, must be aligned");
}
function u8(arr) {
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function byteSwap(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
var swap8IfBE = isLE ? (n) => n : (n) => byteSwap(n) >>> 0;
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
  return arr;
}
var swap32IfBE = isLE ? (u) => u : byteSwap32;
function equalBytes(a, b) {
  a = abytes(a);
  b = abytes(b);
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function wrapMacConstructor(keyLen, macCons, fromMsg) {
  const mac = macCons;
  const getArgs = fromMsg || (() => []);
  const macC = (msg, key) => mac(key, ...getArgs(msg)).update(msg).digest();
  const tmp = mac(new Uint8Array(keyLen), ...getArgs(new Uint8Array(0)));
  macC.outputLen = tmp.outputLen;
  macC.blockLen = tmp.blockLen;
  macC.create = (key, ...args) => mac(key, ...args);
  return macC;
}
var wrapCipher = /* @__NO_SIDE_EFFECTS__ */ (params, constructor) => {
  function wrappedCipher(key, ...args) {
    abytes(key, void 0, "key");
    if (params.nonceLength !== void 0) {
      const nonce = args[0];
      abytes(nonce, params.varSizeNonce ? void 0 : params.nonceLength, "nonce");
    }
    const tagl = params.tagLength;
    const aadStart = params.nonceLength !== void 0 ? 1 : 0;
    if (!params.withAAD) {
      for (let i = aadStart; i < args.length; i++)
        if (isBytes(args[i]))
          throw new Error("AAD not supported");
    }
    if (params.withAAD && args[aadStart] !== void 0)
      abytes(args[aadStart], void 0, "AAD");
    const cipher = constructor(key, ...args);
    const checkOutput = (fnLength, output) => {
      if (output !== void 0) {
        if (fnLength !== 2)
          throw new Error("cipher output not supported");
        abytes(output, void 0, "output");
      }
    };
    let called = false;
    const wrCipher = {
      encrypt(data, output) {
        if (called)
          throw new Error("cannot encrypt() twice with same key + nonce");
        called = true;
        abytes(data, void 0, "data");
        checkOutput(cipher.encrypt.length, output);
        return cipher.encrypt(data, output);
      },
      decrypt(data, output) {
        abytes(data, void 0, "data");
        if (tagl && data.length < tagl)
          throw new Error('"ciphertext" expected length >= tagLength=' + tagl);
        checkOutput(cipher.decrypt.length, output);
        return cipher.decrypt(data, output);
      }
    };
    return wrCipher;
  }
  Object.assign(wrappedCipher, params);
  return wrappedCipher;
};
function getOutput(expectedLength, out, onlyAligned = true) {
  if (out === void 0)
    return new Uint8Array(expectedLength);
  abytes(out, expectedLength, "output");
  if (onlyAligned && !isAligned32(out))
    throw new Error("invalid output, must be aligned");
  return out;
}
function u64Lengths(dataLength, aadLength, isLE2) {
  anumber(dataLength);
  anumber(aadLength);
  abool(isLE2);
  const num = new Uint8Array(16);
  const view = createView(num);
  view.setBigUint64(0, BigInt(aadLength), isLE2);
  view.setBigUint64(8, BigInt(dataLength), isLE2);
  return num;
}
function isAligned32(bytes) {
  return bytes.byteOffset % 4 === 0;
}
function copyBytes(bytes) {
  return Uint8Array.from(abytes(bytes));
}

// node_modules/@noble/ciphers/_polyval.js
var BLOCK_SIZE = 16;
var ZEROS16 = /* @__PURE__ */ new Uint8Array(16);
var ZEROS32 = /* @__PURE__ */ u32(ZEROS16);
var POLY = 225;
var mul2 = (s0, s1, s2, s3) => {
  const hiBit = s3 & 1;
  return {
    s3: s2 << 31 | s3 >>> 1,
    s2: s1 << 31 | s2 >>> 1,
    s1: s0 << 31 | s1 >>> 1,
    // NIST SP 800-38D §6.3 applies `V >> 1` and XORs R on carry. In this
    // 4x32-bit split, R = 0xe1 || 0^120 lives in the top byte of s0.
    s0: s0 >>> 1 ^ POLY << 24 & -(hiBit & 1)
    // reduce % poly
  };
};
var swapLE = (n) => (n >>> 0 & 255) << 24 | (n >>> 8 & 255) << 16 | (n >>> 16 & 255) << 8 | n >>> 24 & 255 | 0;
var estimateWindow = (bytes) => {
  if (bytes > 64 * 1024)
    return 8;
  if (bytes > 1024)
    return 4;
  return 2;
};
var GHASH = class {
  // We select bits per window adaptively based on expectedLength
  constructor(key, expectedLength) {
    __publicField(this, "blockLen", BLOCK_SIZE);
    __publicField(this, "outputLen", BLOCK_SIZE);
    __publicField(this, "s0", 0);
    __publicField(this, "s1", 0);
    __publicField(this, "s2", 0);
    __publicField(this, "s3", 0);
    __publicField(this, "finished", false);
    __publicField(this, "destroyed", false);
    __publicField(this, "t");
    __publicField(this, "W");
    __publicField(this, "windowSize");
    abytes(key, 16, "key");
    key = copyBytes(key);
    const kView = createView(key);
    let k0 = kView.getUint32(0, false);
    let k1 = kView.getUint32(4, false);
    let k2 = kView.getUint32(8, false);
    let k3 = kView.getUint32(12, false);
    const doubles = [];
    for (let i = 0; i < 128; i++) {
      doubles.push({ s0: swapLE(k0), s1: swapLE(k1), s2: swapLE(k2), s3: swapLE(k3) });
      ({ s0: k0, s1: k1, s2: k2, s3: k3 } = mul2(k0, k1, k2, k3));
    }
    const W = estimateWindow(expectedLength || 1024);
    if (![1, 2, 4, 8].includes(W))
      throw new Error("ghash: invalid window size, expected 2, 4 or 8");
    this.W = W;
    const bits = 128;
    const windows = bits / W;
    const windowSize = this.windowSize = 2 ** W;
    const items = [];
    for (let w = 0; w < windows; w++) {
      for (let byte = 0; byte < windowSize; byte++) {
        let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
        for (let j = 0; j < W; j++) {
          const bit = byte >>> W - j - 1 & 1;
          if (!bit)
            continue;
          const { s0: d0, s1: d1, s2: d2, s3: d3 } = doubles[W * w + j];
          s0 ^= d0, s1 ^= d1, s2 ^= d2, s3 ^= d3;
        }
        items.push({ s0, s1, s2, s3 });
      }
    }
    this.t = items;
  }
  _updateBlock(s0, s1, s2, s3) {
    s0 ^= this.s0, s1 ^= this.s1, s2 ^= this.s2, s3 ^= this.s3;
    const { W, t, windowSize } = this;
    let o0 = 0, o1 = 0, o2 = 0, o3 = 0;
    const mask = (1 << W) - 1;
    let w = 0;
    for (const num of [s0, s1, s2, s3]) {
      for (let bytePos = 0; bytePos < 4; bytePos++) {
        const byte = num >>> 8 * bytePos & 255;
        for (let bitPos = 8 / W - 1; bitPos >= 0; bitPos--) {
          const bit = byte >>> W * bitPos & mask;
          const { s0: e0, s1: e1, s2: e2, s3: e3 } = t[w * windowSize + bit];
          o0 ^= e0, o1 ^= e1, o2 ^= e2, o3 ^= e3;
          w += 1;
        }
      }
    }
    this.s0 = o0;
    this.s1 = o1;
    this.s2 = o2;
    this.s3 = o3;
  }
  update(data) {
    aexists(this);
    abytes(data);
    data = copyBytes(data);
    const b32 = u32(data);
    const blocks = Math.floor(data.length / BLOCK_SIZE);
    const left = data.length % BLOCK_SIZE;
    for (let i = 0; i < blocks; i++) {
      this._updateBlock(swap8IfBE(b32[i * 4 + 0]), swap8IfBE(b32[i * 4 + 1]), swap8IfBE(b32[i * 4 + 2]), swap8IfBE(b32[i * 4 + 3]));
    }
    if (left) {
      ZEROS16.set(data.subarray(blocks * BLOCK_SIZE));
      this._updateBlock(swap8IfBE(ZEROS32[0]), swap8IfBE(ZEROS32[1]), swap8IfBE(ZEROS32[2]), swap8IfBE(ZEROS32[3]));
      clean(ZEROS32);
    }
    return this;
  }
  destroy() {
    this.destroyed = true;
    const { t } = this;
    for (const elm of t) {
      elm.s0 = 0, elm.s1 = 0, elm.s2 = 0, elm.s3 = 0;
    }
  }
  digestInto(out) {
    aexists(this);
    aoutput32(out, this);
    this.finished = true;
    const { s0, s1, s2, s3 } = this;
    const o32 = u32(out);
    o32[0] = s0;
    o32[1] = s1;
    o32[2] = s2;
    o32[3] = s3;
    if (!isLE)
      swap32IfBE(o32.subarray(0, BLOCK_SIZE / 4));
  }
  digest() {
    const res = new Uint8Array(BLOCK_SIZE);
    this.digestInto(res);
    this.destroy();
    return res;
  }
};
var ghash = /* @__PURE__ */ wrapMacConstructor(16, (key, expectedLength) => new GHASH(key, expectedLength), (msg) => [msg.length]);

// node_modules/@noble/ciphers/aes.js
var BLOCK_SIZE2 = 16;
var BLOCK_SIZE32 = 4;
var EMPTY_BLOCK = /* @__PURE__ */ new Uint8Array(BLOCK_SIZE2);
var POLY2 = 283;
function validateKeyLength(key) {
  if (![16, 24, 32].includes(key.length))
    throw new Error('"aes key" expected Uint8Array of length 16/24/32, got length=' + key.length);
}
function mul22(n) {
  return n << 1 ^ POLY2 & -(n >> 7);
}
function mul(a, b) {
  let res = 0;
  for (; b > 0; b >>= 1) {
    res ^= a & -(b & 1);
    a = mul22(a);
  }
  return res;
}
var sbox = /* @__PURE__ */ (() => {
  const t = new Uint8Array(256);
  for (let i = 0, x = 1; i < 256; i++, x ^= mul22(x))
    t[i] = x;
  const box = new Uint8Array(256);
  box[0] = 99;
  for (let i = 0; i < 255; i++) {
    let x = t[255 - i];
    x |= x << 8;
    box[t[i]] = (x ^ x >> 4 ^ x >> 5 ^ x >> 6 ^ x >> 7 ^ 99) & 255;
  }
  clean(t);
  return box;
})();
var rotr32_8 = (n) => n << 24 | n >>> 8;
var rotl32_8 = (n) => n << 8 | n >>> 24;
function genTtable(sbox2, fn) {
  if (sbox2.length !== 256)
    throw new Error("wrong sbox length");
  const T0 = new Uint32Array(256).map((_, j) => fn(sbox2[j]));
  const T1 = T0.map(rotl32_8);
  const T2 = T1.map(rotl32_8);
  const T3 = T2.map(rotl32_8);
  const T01 = new Uint32Array(256 * 256);
  const T23 = new Uint32Array(256 * 256);
  const sbox22 = new Uint16Array(256 * 256);
  for (let i = 0; i < 256; i++) {
    for (let j = 0; j < 256; j++) {
      const idx = i * 256 + j;
      T01[idx] = T0[i] ^ T1[j];
      T23[idx] = T2[i] ^ T3[j];
      sbox22[idx] = sbox2[i] << 8 | sbox2[j];
    }
  }
  return { sbox: sbox2, sbox2: sbox22, T0, T1, T2, T3, T01, T23 };
}
var tableEncoding = /* @__PURE__ */ genTtable(sbox, (s) => mul(s, 3) << 24 | s << 16 | s << 8 | mul(s, 2));
var xPowers = /* @__PURE__ */ (() => {
  const p = new Uint8Array(16);
  for (let i = 0, x = 1; i < 16; i++, x = mul22(x))
    p[i] = x;
  return p;
})();
function expandKeyLE(key) {
  abytes(key);
  const len = key.length;
  validateKeyLength(key);
  const { sbox2 } = tableEncoding;
  const toClean = [];
  if (!isLE || !isAligned32(key))
    toClean.push(key = copyBytes(key));
  const k32 = swap32IfBE(u32(key));
  const Nk = k32.length;
  const subByte = (n) => applySbox(sbox2, n, n, n, n);
  const xk = new Uint32Array(len + 28);
  xk.set(k32);
  for (let i = Nk; i < xk.length; i++) {
    let t = xk[i - 1];
    if (i % Nk === 0)
      t = subByte(rotr32_8(t)) ^ xPowers[i / Nk - 1];
    else if (Nk > 6 && i % Nk === 4)
      t = subByte(t);
    xk[i] = xk[i - Nk] ^ t;
  }
  clean(...toClean);
  return xk;
}
function apply0123(T01, T23, s0, s1, s2, s3) {
  return T01[s0 << 8 & 65280 | s1 >>> 8 & 255] ^ T23[s2 >>> 8 & 65280 | s3 >>> 24 & 255];
}
function applySbox(sbox2, s0, s1, s2, s3) {
  return sbox2[s0 & 255 | s1 & 65280] | sbox2[s2 >>> 16 & 255 | s3 >>> 16 & 65280] << 16;
}
function encrypt(xk, s0, s1, s2, s3) {
  const { sbox2, T01, T23 } = tableEncoding;
  let k = 0;
  s0 ^= xk[k++], s1 ^= xk[k++], s2 ^= xk[k++], s3 ^= xk[k++];
  const rounds = xk.length / 4 - 2;
  for (let i = 0; i < rounds; i++) {
    const t02 = xk[k++] ^ apply0123(T01, T23, s0, s1, s2, s3);
    const t12 = xk[k++] ^ apply0123(T01, T23, s1, s2, s3, s0);
    const t22 = xk[k++] ^ apply0123(T01, T23, s2, s3, s0, s1);
    const t32 = xk[k++] ^ apply0123(T01, T23, s3, s0, s1, s2);
    s0 = t02, s1 = t12, s2 = t22, s3 = t32;
  }
  const t0 = xk[k++] ^ applySbox(sbox2, s0, s1, s2, s3);
  const t1 = xk[k++] ^ applySbox(sbox2, s1, s2, s3, s0);
  const t2 = xk[k++] ^ applySbox(sbox2, s2, s3, s0, s1);
  const t3 = xk[k++] ^ applySbox(sbox2, s3, s0, s1, s2);
  return { s0: t0, s1: t1, s2: t2, s3: t3 };
}
function ctr32(xk, isLE2, nonce, src, dst) {
  abytes(nonce, BLOCK_SIZE2, "nonce");
  abytes(src);
  dst = getOutput(src.length, dst);
  const ctr = nonce;
  const c32 = u32(ctr);
  const view = createView(ctr);
  const src32 = u32(src);
  const dst32 = u32(dst);
  const ctrPos = isLE2 ? 0 : 12;
  const srcLen = src.length;
  let ctrNum = view.getUint32(ctrPos, isLE2);
  for (let i = 0; i + 4 <= src32.length; i += 4) {
    const { s0, s1, s2, s3 } = encrypt(xk, swap8IfBE(c32[0]), swap8IfBE(c32[1]), swap8IfBE(c32[2]), swap8IfBE(c32[3]));
    dst32[i + 0] = src32[i + 0] ^ swap8IfBE(s0);
    dst32[i + 1] = src32[i + 1] ^ swap8IfBE(s1);
    dst32[i + 2] = src32[i + 2] ^ swap8IfBE(s2);
    dst32[i + 3] = src32[i + 3] ^ swap8IfBE(s3);
    ctrNum = ctrNum + 1 >>> 0;
    view.setUint32(ctrPos, ctrNum, isLE2);
  }
  const start = BLOCK_SIZE2 * Math.floor(src32.length / BLOCK_SIZE32);
  if (start < srcLen) {
    const { s0, s1, s2, s3 } = encrypt(xk, swap8IfBE(c32[0]), swap8IfBE(c32[1]), swap8IfBE(c32[2]), swap8IfBE(c32[3]));
    const b32 = new Uint32Array([s0, s1, s2, s3]);
    swap32IfBE(b32);
    const buf = u8(b32);
    for (let i = start, pos = 0; i < srcLen; i++, pos++)
      dst[i] = src[i] ^ buf[pos];
    clean(b32);
  }
  return dst;
}
function computeTag(fn, isLE2, key, data, AAD) {
  const aadLength = AAD ? AAD.length : 0;
  const h = fn.create(key, data.length + aadLength);
  if (AAD)
    h.update(AAD);
  const num = u64Lengths(8 * data.length, 8 * aadLength, isLE2);
  h.update(data);
  h.update(num);
  const res = h.digest();
  clean(num);
  return res;
}
var gcm = /* @__PURE__ */ wrapCipher({ blockSize: 16, nonceLength: 12, tagLength: 16, withAAD: true, varSizeNonce: true }, function aesgcm(key, nonce, AAD) {
  if (nonce.length < 8)
    throw new Error("aes/gcm: invalid nonce length");
  const tagLength = 16;
  function _computeTag(authKey, tagMask, data) {
    const tag = computeTag(ghash, false, authKey, data, AAD);
    for (let i = 0; i < tagMask.length; i++)
      tag[i] ^= tagMask[i];
    return tag;
  }
  function deriveKeys() {
    const xk = expandKeyLE(key);
    const authKey = EMPTY_BLOCK.slice();
    const counter = EMPTY_BLOCK.slice();
    ctr32(xk, false, counter, counter, authKey);
    if (nonce.length === 12) {
      counter.set(nonce);
    } else {
      const nonceLen = EMPTY_BLOCK.slice();
      const view = createView(nonceLen);
      view.setBigUint64(8, BigInt(nonce.length * 8), false);
      const g = ghash.create(authKey).update(nonce).update(nonceLen);
      g.digestInto(counter);
      g.destroy();
    }
    const tagMask = ctr32(xk, false, counter, EMPTY_BLOCK);
    return { xk, authKey, counter, tagMask };
  }
  return {
    encrypt(plaintext) {
      const { xk, authKey, counter, tagMask } = deriveKeys();
      const out = new Uint8Array(plaintext.length + tagLength);
      const toClean = [xk, authKey, counter, tagMask];
      if (!isAligned32(plaintext))
        toClean.push(plaintext = copyBytes(plaintext));
      ctr32(xk, false, counter, plaintext, out.subarray(0, plaintext.length));
      const tag = _computeTag(authKey, tagMask, out.subarray(0, out.length - tagLength));
      toClean.push(tag);
      out.set(tag, plaintext.length);
      clean(...toClean);
      return out;
    },
    decrypt(ciphertext) {
      const { xk, authKey, counter, tagMask } = deriveKeys();
      const toClean = [xk, authKey, tagMask, counter];
      if (!isAligned32(ciphertext))
        toClean.push(ciphertext = copyBytes(ciphertext));
      const data = ciphertext.subarray(0, -tagLength);
      const passedTag = ciphertext.subarray(-tagLength);
      const tag = _computeTag(authKey, tagMask, data);
      toClean.push(tag);
      if (!equalBytes(tag, passedTag)) {
        clean(...toClean);
        throw new Error("aes-gcm: invalid tag");
      }
      const out = ctr32(xk, false, counter, data);
      clean(...toClean);
      return out;
    }
  };
});

// node_modules/@noble/hashes/_u64.js
var fromNumH = (n) => n / 2 ** 32 | 0;
var fromNumL = (n) => n >>> 0;
function setU64FromNum(view, byteOffset, n, isLE2) {
  const h = fromNumH(n);
  const l = fromNumL(n);
  view.setUint32(byteOffset, isLE2 ? l : h, isLE2);
  view.setUint32(byteOffset + 4, isLE2 ? h : l, isLE2);
}

// node_modules/@noble/hashes/utils.js
function isBytes2(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle2 = (title) => title ? `"${title}" ` : "";
function anumber2(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle2(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle2(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes2(value, length, title = "") {
  if (isBytes2(value) && (length === void 0 || value.length === length))
    return value;
  if (length !== void 0)
    anumber2(length, "length");
  const bytes = isBytes2(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle2(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
function ahash(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new TypeError("expected hash wrapped by utils.createHasher");
  anumber2(h.outputLen);
  anumber2(h.blockLen);
  if (h.outputLen < 1 || h.blockLen < 1)
    throw new Error("hash blockLen / outputLen must be >= 1");
}
var aobject = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
};
var aopts = (value, label) => {
  aobject(value, label);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    throw new TypeError(`"${label}" expected plain object`);
  if (Object.hasOwn(value, "__proto__"))
    throw new TypeError(`"${label}.__proto__" is not allowed`);
};
function aexists2(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput2(out, instance) {
  abytes2(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function clean2(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView2(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var hasHexBuiltin = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes2(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
function asciiToBase16(ch) {
  return ch >= 48 && ch <= 57 ? ch - 48 : ch >= 65 && ch <= 70 ? ch - (65 - 10) : ch >= 97 && ch <= 102 ? ch - (97 - 10) : void 0;
}
function hexToBytes(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  if (hasHexBuiltin) {
    try {
      return Uint8Array.fromHex(hex);
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new RangeError(error.message);
      throw error;
    }
  }
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new RangeError("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex.charCodeAt(hi));
    const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new RangeError('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function checkOpts(defaults, opts, title = "opts") {
  aopts(defaults, "defaults");
  if (opts !== void 0)
    aopts(opts, title);
  const merged = Object.assign(/* @__PURE__ */ Object.create(null), defaults, opts);
  return merged;
}
function createHasher(hashCons, info = {}) {
  if (typeof hashCons !== "function")
    throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
  info = checkOpts({}, info, "info");
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
function randomBytes(bytesLength = 32) {
  anumber2(bytesLength, "bytesLength");
  const cr = typeof globalThis === "object" ? globalThis.crypto : null;
  if (typeof cr?.getRandomValues !== "function")
    throw new Error("crypto.getRandomValues must be defined");
  if (bytesLength > 65536)
    throw new RangeError(`"bytesLength" expected <= 65536, got ${bytesLength}`);
  return cr.getRandomValues(new Uint8Array(bytesLength));
}
var oidNist = (suffix) => ({
  // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
  // Larger suffix values would need base-128 OID encoding and a different length byte.
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// node_modules/@noble/hashes/hmac.js
var _HMAC = class {
  constructor(hash, key) {
    __publicField(this, "oHash");
    __publicField(this, "iHash");
    __publicField(this, "blockLen");
    __publicField(this, "outputLen");
    __publicField(this, "canXOF", false);
    __publicField(this, "finished", false);
    __publicField(this, "destroyed", false);
    ahash(hash);
    abytes2(key, void 0, "key");
    this.iHash = hash.create();
    if (typeof this.iHash.update !== "function")
      throw new Error("expected Hash instance");
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad = new Uint8Array(blockLen);
    pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54;
    this.iHash.update(pad);
    this.oHash = hash.create();
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54 ^ 92;
    this.oHash.update(pad);
    clean2(pad);
  }
  update(buf) {
    aexists2(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    aexists2(this);
    aoutput2(out, this);
    this.finished = true;
    const buf = out.subarray(0, this.outputLen);
    this.iHash.digestInto(buf);
    this.oHash.update(buf);
    this.oHash.digestInto(buf);
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.oHash.outputLen);
    this.digestInto(out);
    return out;
  }
  _cloneInto(to) {
    to || (to = Object.create(Object.getPrototypeOf(this), {}));
    const { oHash, iHash, finished, destroyed, blockLen, outputLen, canXOF } = this;
    to = to;
    to.finished = finished;
    to.destroyed = destroyed;
    to.blockLen = blockLen;
    to.outputLen = outputLen;
    to.canXOF = canXOF;
    to.oHash = oHash._cloneInto(to.oHash);
    to.iHash = iHash._cloneInto(to.iHash);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
  destroy() {
    this.destroyed = true;
    this.oHash.destroy();
    this.iHash.destroy();
  }
};
var hmac = /* @__PURE__ */ (() => {
  const hmac_ = ((hash, key, message) => new _HMAC(hash, key).update(message).digest());
  hmac_.create = (hash, key) => new _HMAC(hash, key);
  return hmac_;
})();

// node_modules/@noble/hashes/hkdf.js
function extract(hash, ikm, salt) {
  ahash(hash);
  if (salt === void 0)
    salt = new Uint8Array(hash.outputLen);
  return hmac(hash, salt, ikm);
}
var HKDF_COUNTER = /* @__PURE__ */ Uint8Array.of(0);
var EMPTY_BUFFER = /* @__PURE__ */ Uint8Array.of();
function expand(hash, prk, info, length = 32, _recycled) {
  ahash(hash);
  anumber2(length, "length");
  abytes2(prk, void 0, "prk");
  const olen = hash.outputLen;
  if (prk.length < olen)
    throw new Error('"prk" must be at least HashLen octets');
  if (length > 255 * olen)
    throw new Error("Length must be <= 255*HashLen");
  const blocks = Math.ceil(length / olen);
  if (info === void 0)
    info = EMPTY_BUFFER;
  else
    abytes2(info, void 0, "info");
  if (!blocks) {
    if (_recycled)
      clean2(prk);
    return new Uint8Array();
  }
  const okm = _recycled && blocks === 1 ? prk : new Uint8Array(blocks * olen);
  const { iHash, oHash } = hmac.create(hash, prk);
  const T = _recycled ? prk : new Uint8Array(olen);
  const worker = blocks > 1 ? _recycled?.iHash || hash.create() : void 0;
  for (let counter = 0; counter < blocks - 1; counter++) {
    HKDF_COUNTER[0] = counter + 1;
    const iWork = iHash._cloneInto(worker);
    if (counter)
      iWork.update(T);
    iWork.update(info).update(HKDF_COUNTER).digestInto(T);
    oHash._cloneInto(worker).update(T).digestInto(T);
    okm.set(T, olen * counter);
  }
  HKDF_COUNTER[0] = blocks;
  if (blocks > 1)
    iHash.update(T);
  iHash.update(info).update(HKDF_COUNTER).digestInto(T);
  oHash.update(T).digestInto(T);
  okm.set(T, olen * (blocks - 1));
  iHash.destroy();
  oHash.destroy();
  worker?.destroy();
  if (T !== okm)
    clean2(T);
  clean2(HKDF_COUNTER);
  if (length === okm.length)
    return okm;
  const res = okm.slice(0, length);
  clean2(okm);
  return res;
}

// node_modules/@noble/hashes/_md.js
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD = class {
  constructor(blockLen, outputLen, padOffset, isLE2) {
    __publicField(this, "blockLen");
    __publicField(this, "outputLen");
    __publicField(this, "canXOF", false);
    __publicField(this, "padOffset");
    __publicField(this, "isLE");
    // For partial updates less than block size
    __publicField(this, "buffer");
    __publicField(this, "view");
    __publicField(this, "finished", false);
    __publicField(this, "length", 0);
    __publicField(this, "pos", 0);
    __publicField(this, "destroyed", false);
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE2;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView2(this.buffer);
  }
  update(data) {
    aexists2(this);
    abytes2(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    let processed = false;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView2(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        processed = true;
        continue;
      }
      buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
        processed = true;
      }
    }
    this.length += data.length;
    if (processed)
      this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists2(this);
    aoutput2(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE: isLE2 } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    buffer.fill(0, pos);
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      buffer.fill(0);
    }
    setU64FromNum(view, blockLen - 8, this.length * 8, isLE2);
    this.process(view, 0);
    this.roundClean();
    const oview = out === buffer ? view : createView2(out);
    const len = this.outputLen;
    const outLen = len / 4;
    const state = this.get();
    if (len % 4 || outLen > state.length)
      throw new Error("invalid outputLen");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE2);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneIntoMeta(to) {
    const { buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (pos)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);

// node_modules/@noble/hashes/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA2_32B = class extends HashMD {
  constructor(outputLen, IV) {
    super(64, outputLen, 8, false);
    // We cannot use array here since array allows indexing by variable
    // which means optimizer/compiler cannot use registers.
    // Numeric initializers matter: starting the fields as `undefined` changes
    // V8's field representation and makes sha256 3x slower (measured).
    __publicField(this, "A", 0);
    __publicField(this, "B", 0);
    __publicField(this, "C", 0);
    __publicField(this, "D", 0);
    __publicField(this, "E", 0);
    __publicField(this, "F", 0);
    __publicField(this, "G", 0);
    __publicField(this, "H", 0);
    this.A = IV[0] | 0;
    this.B = IV[1] | 0;
    this.C = IV[2] | 0;
    this.D = IV[3] | 0;
    this.E = IV[4] | 0;
    this.F = IV[5] | 0;
    this.G = IV[6] | 0;
    this.H = IV[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  _cloneInto(to) {
    (to || (to = new this.constructor())).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean2(SHA256_W);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean2(this.buffer);
  }
};
var _SHA256 = class extends SHA2_32B {
  constructor() {
    super(32, SHA256_IV);
  }
};
var sha256 = /* @__PURE__ */ createHasher(
  () => new _SHA256(),
  /* @__PURE__ */ oidNist(1)
);

// node_modules/@noble/curves/utils.js
function aarray(item, title, inner = () => {
}) {
  if (!Array.isArray(item))
    throw new TypeError(`"${title}" expected array, got type=${typeof item}`);
  for (let i = 0; i < item.length; i++)
    inner(item[i], `${title}[${i}]`);
  return item;
}
var abytes3 = (value, length, title) => abytes2(value, length, title);
var anumber3 = anumber2;
function aobject2(value, title = "object") {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(title === "object" ? "expected valid options object" : `"${title}" expected object, got type=${typeof value}`);
  return value;
}
function afunction(value, title) {
  if (typeof value !== "function")
    throw new TypeError(`"${title}" is invalid: expected function, got ${typeof value}`);
  return value;
}
var bytesToHex2 = bytesToHex;
var hexToBytes2 = (hex) => hexToBytes(hex);
var isBytes3 = isBytes2;
var randomBytes2 = (bytesLength) => randomBytes(bytesLength);
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
var atitle3 = (title) => title ? `"${title}" ` : "";
function abool2(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle3(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function abignumber(n) {
  if (typeof n === "bigint") {
    if (!isPosBig(n))
      throw new RangeError("positive bigint expected, got " + n);
  } else
    anumber3(n);
  return n;
}
function asafenumber(value, title = "") {
  if (typeof value !== "number") {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected number, got type=" + typeof value);
  }
  if (!Number.isSafeInteger(value)) {
    const prefix = title && `"${title}" `;
    throw new RangeError(prefix + "expected safe integer, got " + value);
  }
}
function hexToNumber(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  return hex === "" ? _0n : BigInt("0x" + hex);
}
function bytesToNumberBE(bytes) {
  return hexToNumber(bytesToHex(bytes));
}
function bytesToNumberLE(bytes) {
  return hexToNumber(bytesToHex(copyBytes2(abytes2(bytes)).reverse()));
}
function numberToBytesBE(n, len) {
  anumber2(len);
  if (len === 0)
    throw new Error("zero output length is invalid");
  n = abignumber(n);
  const expectedLen = len * 2;
  const hex = n.toString(16);
  if (hex.length > expectedLen)
    throw new RangeError("number is too large");
  return hexToBytes(hex.padStart(expectedLen, "0"));
}
function numberToBytesLE(n, len) {
  return numberToBytesBE(n, len).reverse();
}
function copyBytes2(bytes) {
  return Uint8Array.from(abytes3(bytes));
}
function isPosBig(n) {
  return typeof n === "bigint" && _0n <= n;
}
function inRange(n, min, max) {
  return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
function aInRange(title, n, min, max) {
  if (!inRange(n, min, max))
    throw new RangeError("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen(n) {
  if (n < _0n)
    throw new Error("expected non-negative bigint, got " + n);
  return n === _0n ? 0 : n.toString(2).length;
}
var bitMask = (n) => {
  asafenumber(n, "n");
  return (_1n << BigInt(n)) - _1n;
};
function validateObject(object, fields = {}, optFields = {}, title = "object") {
  aobject2(object, title);
  aobject2(fields, "fields");
  aobject2(optFields, "optFields");
  function checkField(fieldName, expectedType, isOpt) {
    const label = title === "object" ? `param "${String(fieldName)}"` : `"${title}.${String(fieldName)}"`;
    const val = object[fieldName];
    if (!Object.hasOwn(object, fieldName) && (isOpt ? val !== void 0 : expectedType !== "function")) {
      throw new TypeError(`${label} is invalid: expected own property`);
    }
    if (isOpt && val === void 0)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new TypeError(`${label} is invalid: expected ${expectedType}, got ${current}`);
  }
  const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
  iter(fields, false);
  iter(optFields, true);
}

// node_modules/@noble/curves/abstract/modular.js
var _0n2 = /* @__PURE__ */ BigInt(0);
var _1n2 = /* @__PURE__ */ BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _3n = /* @__PURE__ */ BigInt(3);
var _4n = /* @__PURE__ */ BigInt(4);
var _5n = /* @__PURE__ */ BigInt(5);
var _7n = /* @__PURE__ */ BigInt(7);
var _8n = /* @__PURE__ */ BigInt(8);
var _9n = /* @__PURE__ */ BigInt(9);
var _15n = /* @__PURE__ */ BigInt(15);
var _16n = /* @__PURE__ */ BigInt(16);
var POW_WINDOWED_MIN = /* @__PURE__ */ BigInt("0x10000000000000000");
function mod(a, b) {
  if (b <= _0n2)
    throw new Error("mod: expected positive modulus, got " + b);
  const result = a % b;
  return result >= _0n2 ? result : b + result;
}
function pow(num, power, modulo) {
  if (modulo <= _1n2)
    throw new Error("pow: expected modulus > 1, got " + modulo);
  if (typeof power !== "bigint")
    throw new TypeError("invalid exponent: expected bigint, got " + typeof power);
  if (power < _0n2)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n2)
    return _1n2;
  if (power === _1n2)
    return num;
  let d = num % modulo;
  if (d < _0n2)
    d += modulo;
  if (power < POW_WINDOWED_MIN) {
    let p2 = _1n2;
    while (power > _0n2) {
      if (power & _1n2)
        p2 = p2 * d % modulo;
      d = d * d % modulo;
      power >>= _1n2;
    }
    return p2;
  }
  const digits = [];
  while (power > _0n2) {
    digits.push(Number(power & _15n));
    power >>= _4n;
  }
  const table = new Array(16);
  table[0] = _1n2;
  table[1] = d;
  for (let i = 2; i < 16; i++)
    table[i] = table[i - 1] * d % modulo;
  let p = table[digits[digits.length - 1]];
  for (let w = digits.length - 2; w >= 0; w--) {
    p = p * p % modulo;
    p = p * p % modulo;
    p = p * p % modulo;
    p = p * p % modulo;
    const digit = digits[w];
    if (digit !== 0)
      p = p * table[digit] % modulo;
  }
  return p;
}
function pow2(x, power, modulo) {
  if (modulo <= _1n2)
    throw new Error("pow2: expected modulus > 1, got " + modulo);
  if (power < _0n2)
    throw new Error("pow2: expected non-negative exponent, got " + power);
  let res = x;
  while (power-- > _0n2) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert(number, modulo) {
  if (number === _0n2)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _1n2)
    throw new Error("invert: expected modulus > 1, got " + modulo);
  let a = mod(number, modulo);
  let b = modulo;
  let x = _0n2, u = _1n2;
  while (a !== _0n2) {
    const q = b / a;
    const r = b - a * q;
    const m = x - u * q;
    b = a, a = r, x = u, u = m;
  }
  const gcd = b;
  if (gcd !== _1n2)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
}
function assertIsSquare(Fp2, root, n) {
  const F = Fp2;
  if (!F.eql(F.sqr(root), n))
    throw new Error("Cannot find square root");
}
function aoddModulus(order, fnName) {
  if ((order & _1n2) === _0n2)
    throw new Error(fnName + ": expected odd modulus, got " + order);
}
function sqrt3mod4(Fp2, n) {
  const F = Fp2;
  const p1div4 = (F.ORDER + _1n2) / _4n;
  const root = F.pow(n, p1div4);
  assertIsSquare(F, root, n);
  return root;
}
function sqrt5mod8(Fp2, n) {
  const F = Fp2;
  const p5div8 = (F.ORDER - _5n) / _8n;
  const n2 = F.mul(n, _2n);
  const v = F.pow(n2, p5div8);
  const nv = F.mul(n, v);
  const i = F.mul(F.mul(nv, _2n), v);
  const root = F.mul(nv, F.sub(i, F.ONE));
  assertIsSquare(F, root, n);
  return root;
}
function sqrt9mod16(P) {
  const Fp_ = Field(P);
  const tn = tonelliShanks(P);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P + _7n) / _16n;
  return ((Fp2, n) => {
    const F = Fp2;
    let tv1 = F.pow(n, c4);
    let tv2 = F.mul(tv1, c1);
    const tv3 = F.mul(tv1, c2);
    const tv4 = F.mul(tv1, c3);
    const e1 = F.eql(F.sqr(tv2), n);
    const e2 = F.eql(F.sqr(tv3), n);
    tv1 = F.cmov(tv1, tv2, e1);
    tv2 = F.cmov(tv4, tv3, e2);
    const e3 = F.eql(F.sqr(tv2), n);
    const root = F.cmov(tv1, tv2, e3);
    assertIsSquare(F, root, n);
    return root;
  });
}
function tonelliShanks(P) {
  if (P < _3n)
    throw new Error("sqrt is not defined for small field");
  aoddModulus(P, "tonelliShanks");
  let Q = P - _1n2;
  let S = 0;
  while (Q % _2n === _0n2) {
    Q /= _2n;
    S++;
  }
  let Z = _2n;
  const _Fp = Field(P);
  while (FpLegendre(_Fp, Z) === 1) {
    if (Z++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod4;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n2) / _2n;
  return function tonelliSlow(Fp2, n) {
    const F = Fp2;
    if (F.is0(n))
      return n;
    if (FpLegendre(F, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = F.mul(F.ONE, cc);
    let t = F.pow(n, Q);
    let R = F.pow(n, Q1div2);
    while (!F.eql(t, F.ONE)) {
      if (F.is0(t))
        throw new Error("Cannot find square root: probably non-prime P");
      let i = 1;
      let t_tmp = F.sqr(t);
      while (!F.eql(t_tmp, F.ONE)) {
        i++;
        t_tmp = F.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n2 << BigInt(M - i - 1);
      const b = F.pow(c, exponent);
      M = i;
      c = F.sqr(b);
      t = F.mul(t, c);
      R = F.mul(R, b);
    }
    return R;
  };
}
function FpSqrt(P) {
  aoddModulus(P, "Fp.sqrt");
  if (P % _4n === _3n)
    return sqrt3mod4;
  if (P % _8n === _5n)
    return sqrt5mod8;
  if (P % _16n === _9n)
    return sqrt9mod16(P);
  return tonelliShanks(P);
}
var isNegativeLE = (num, modulo) => (mod(num, modulo) & _1n2) === _1n2;
var FIELD_FIELDS = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField(field) {
  aobject2(field, "field");
  if (typeof field.ORDER !== "bigint")
    throw new TypeError('param "ORDER" is invalid: expected bigint, got ' + typeof field.ORDER);
  asafenumber(field.BYTES, "BYTES");
  asafenumber(field.BITS, "BITS");
  for (const name of FIELD_FIELDS)
    afunction(field[name], "field." + name);
  if (field.BYTES < 1 || field.BITS < 1)
    throw new Error("invalid field: expected BYTES/BITS > 0");
  if (field.ORDER <= _1n2)
    throw new Error("invalid field: expected ORDER > 1, got " + field.ORDER);
  return field;
}
function FpInvertBatch(Fp2, nums, passZero = false) {
  validateField(Fp2);
  aarray(nums, "nums");
  abool2(passZero, "passZero");
  const F = Fp2;
  const inverted = new Array(nums.length).fill(passZero ? F.ZERO : void 0);
  const multipliedAcc = nums.reduce((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = acc;
    return F.mul(acc, num);
  }, F.ONE);
  const invertedAcc = F.inv(multipliedAcc);
  nums.reduceRight((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = F.mul(acc, inverted[i]);
    return F.mul(acc, num);
  }, invertedAcc);
  return inverted;
}
function FpLegendre(Fp2, n) {
  validateField(Fp2);
  const F = Fp2;
  aoddModulus(F.ORDER, "FpLegendre");
  const p1mod2 = (F.ORDER - _1n2) / _2n;
  const powered = F.pow(n, p1mod2);
  const yes = F.eql(powered, F.ONE);
  const zero = F.eql(powered, F.ZERO);
  const no = F.eql(powered, F.neg(F.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength(n, nBitLength) {
  if (nBitLength !== void 0)
    anumber3(nBitLength);
  if (n <= _0n2)
    throw new Error("invalid n length: expected positive n, got " + n);
  if (nBitLength !== void 0 && nBitLength < 1)
    throw new Error("invalid n length: expected positive bit length, got " + nBitLength);
  const bits = bitLen(n);
  if (nBitLength !== void 0 && nBitLength < bits)
    throw new Error(`invalid n length: expected nBitLength (${nBitLength}) >= bitLen(n) (${bits})`);
  const _nBitLength = nBitLength !== void 0 ? nBitLength : bits;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
var FIELD_SQRT = /* @__PURE__ */ new WeakMap();
var _Field = class {
  constructor(ORDER, opts = {}) {
    __publicField(this, "ORDER");
    __publicField(this, "BITS");
    __publicField(this, "BYTES");
    __publicField(this, "isLE");
    __publicField(this, "ZERO", _0n2);
    __publicField(this, "ONE", _1n2);
    __publicField(this, "_lengths");
    __publicField(this, "_mod");
    if (ORDER <= _1n2)
      throw new Error("invalid field: expected ORDER > 1, got " + ORDER);
    let _nbitLength = void 0;
    this.isLE = false;
    if (opts != null && typeof opts === "object") {
      if (typeof opts.BITS === "number")
        _nbitLength = opts.BITS;
      if (typeof opts.sqrt === "function")
        Object.defineProperty(this, "sqrt", { value: opts.sqrt, enumerable: true });
      if (typeof opts.isLE === "boolean")
        this.isLE = opts.isLE;
      if (opts.allowedLengths)
        this._lengths = Object.freeze(opts.allowedLengths.slice());
      if (typeof opts.modFromBytes === "boolean")
        this._mod = opts.modFromBytes;
    }
    const { nBitLength, nByteLength } = nLength(ORDER, _nbitLength);
    if (nByteLength > 2048)
      throw new Error("invalid field: expected ORDER of <= 2048 bytes");
    this.ORDER = ORDER;
    this.BITS = nBitLength;
    this.BYTES = nByteLength;
    Object.freeze(this);
  }
  create(num) {
    return mod(num, this.ORDER);
  }
  isValid(num) {
    if (typeof num !== "bigint")
      throw new TypeError("invalid field element: expected bigint, got " + typeof num);
    return _0n2 <= num && num < this.ORDER;
  }
  is0(num) {
    return num === _0n2;
  }
  // is valid and invertible
  isValidNot0(num) {
    return !this.is0(num) && this.isValid(num);
  }
  isOdd(num) {
    return (num & _1n2) === _1n2;
  }
  neg(num) {
    return mod(-num, this.ORDER);
  }
  eql(lhs, rhs) {
    return lhs === rhs;
  }
  sqr(num) {
    return mod(num * num, this.ORDER);
  }
  add(lhs, rhs) {
    return mod(lhs + rhs, this.ORDER);
  }
  sub(lhs, rhs) {
    return mod(lhs - rhs, this.ORDER);
  }
  mul(lhs, rhs) {
    return mod(lhs * rhs, this.ORDER);
  }
  pow(num, power) {
    return pow(num, power, this.ORDER);
  }
  div(lhs, rhs) {
    return mod(lhs * invert(rhs, this.ORDER), this.ORDER);
  }
  // Same as above, but doesn't normalize
  sqrN(num) {
    return num * num;
  }
  addN(lhs, rhs) {
    return lhs + rhs;
  }
  subN(lhs, rhs) {
    return lhs - rhs;
  }
  mulN(lhs, rhs) {
    return lhs * rhs;
  }
  inv(num) {
    return invert(num, this.ORDER);
  }
  sqrt(num) {
    let sqrt = FIELD_SQRT.get(this);
    if (!sqrt)
      FIELD_SQRT.set(this, sqrt = FpSqrt(this.ORDER));
    return sqrt(this, num);
  }
  toBytes(num) {
    return this.isLE ? numberToBytesLE(num, this.BYTES) : numberToBytesBE(num, this.BYTES);
  }
  fromBytes(bytes, skipValidation = false) {
    abytes3(bytes);
    const { _lengths: allowedLengths, BYTES, isLE: isLE2, ORDER, _mod: modFromBytes } = this;
    if (allowedLengths) {
      if (bytes.length < 1 || !allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
        throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
      }
      const padded = new Uint8Array(BYTES);
      padded.set(bytes, isLE2 ? 0 : padded.length - bytes.length);
      bytes = padded;
    }
    if (bytes.length !== BYTES)
      throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
    let scalar = isLE2 ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
    if (modFromBytes)
      scalar = mod(scalar, ORDER);
    if (!skipValidation) {
      if (!this.isValid(scalar))
        throw new Error("invalid field element: outside of range 0..ORDER");
    }
    return scalar;
  }
  // TODO: we don't need it here, move out to separate fn
  invertBatch(lst) {
    return FpInvertBatch(this, lst, true);
  }
  // We can't move this out because Fp6, Fp12 implement it
  // and it's unclear what to return in there.
  cmov(a, b, condition) {
    abool2(condition, "condition");
    return condition ? b : a;
  }
};
function Field(ORDER, opts = {}) {
  Object.freeze(_Field.prototype);
  return new _Field(ORDER, opts);
}

// node_modules/@noble/curves/abstract/curve.js
var _0n3 = /* @__PURE__ */ BigInt(0);
var _1n3 = /* @__PURE__ */ BigInt(1);
var _4n2 = /* @__PURE__ */ BigInt(4);
var BLIND_BYTES = 16;
var BLIND_BITS = 128;
var FW_WINDOW = 5;
var TABLE_BYTES_MAX = /* @__PURE__ */ (() => 2 ** 31)();
function validatePointCons(Point) {
  const pc = Point;
  if (typeof pc !== "function")
    throw new TypeError('"Point" expected constructor, got type=' + typeof Point);
  afunction(pc.fromAffine, "Point.fromAffine");
  afunction(pc.fromBytes, "Point.fromBytes");
  afunction(pc.fromHex, "Point.fromHex");
  aobject2(pc.BASE, "Point.BASE");
  aobject2(pc.ZERO, "Point.ZERO");
  validateField(pc.Fp);
  validateField(pc.Fn);
}
function normalizeZ(c, points) {
  validatePointCons(c);
  validateMSMPoints(points, c);
  const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits, min = 1) {
  if (!Number.isSafeInteger(W) || W < min || W > bits)
    throw new Error("invalid window size, expected [" + min + ".." + bits + "], got W=" + W);
}
function validateTableBytes(numPoints, fpBytes) {
  const bytes = numPoints * (4 * fpBytes + 128);
  if (bytes > TABLE_BYTES_MAX)
    throw new Error("invalid window size: table would need ~" + Math.ceil(bytes / 2 ** 20) + " MiB, max " + TABLE_BYTES_MAX / 2 ** 20 + " MiB");
}
function probeRandomBytes(randomBytes4, length) {
  if (randomBytes4 === void 0)
    return void 0;
  afunction(randomBytes4, "randomBytes");
  try {
    const probe = randomBytes4(length);
    if (!isBytes3(probe) || probe.length !== length)
      return void 0;
  } catch {
    return void 0;
  }
  return randomBytes4;
}
function validateMSMPoints(points, c) {
  aarray(points, "points");
  points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars(scalars, field, maxScalar) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s, i) => {
    const ok = maxScalar === void 0 ? field.isValid(s) : isPosBig(s) && s < maxScalar;
    if (!ok)
      throw new Error("invalid scalar at index " + i);
  });
}
var pointWindowSizes = /* @__PURE__ */ new WeakMap();
function getWindowSize(P) {
  return pointWindowSizes.get(P) || 1;
}
function oddMultiples(p, size) {
  const dbl = p.double();
  const t = [p];
  for (let j = 1; j < size; j++)
    t.push(t[j - 1].add(dbl));
  return t;
}
function wnafDigits(n, W) {
  const size = 2 ** W;
  const half = size / 2;
  const mask = BigInt(size - 1);
  const d = [];
  while (n > _0n3) {
    let w = 0;
    if (n & _1n3) {
      w = Number(n & mask);
      if (w >= half)
        w -= size;
      n -= BigInt(w);
    }
    d.push(w);
    n >>= _1n3;
  }
  return d;
}
function signedWindowDigits(n, W, windows) {
  const size = 2 ** W;
  const half = size / 2;
  const mask = BigInt(size - 1);
  const shiftBy = BigInt(W);
  const d = [];
  for (let w = 0; w < windows; w++) {
    let v = Number(n & mask);
    n >>= shiftBy;
    if (v > half) {
      v -= size;
      n += _1n3;
    }
    d.push(v);
  }
  if (n !== _0n3)
    throw new Error("invalid wnaf");
  return d;
}
function wnafWalk(zero, tables, digits) {
  let max = 0;
  for (const d of digits)
    max = Math.max(max, d.length);
  let acc = zero;
  for (let bit = max - 1; bit >= 0; bit--) {
    if (bit !== max - 1)
      acc = acc.double();
    for (let i = 0; i < digits.length; i++) {
      const w = digits[i][bit];
      if (w) {
        const item = tables[i][Math.abs(w) - 1 >> 1];
        acc = acc.add(w < 0 ? item.negate() : item);
      }
    }
  }
  return acc;
}
var ScalarMultiplier = class {
  // Parametrized with a given Point class (not individual point)
  constructor(Point, randomBytes4) {
    __publicField(this, "Point");
    __publicField(this, "BASE");
    __publicField(this, "ZERO");
    __publicField(this, "randomBytes");
    __publicField(this, "wnafPrecomputes", /* @__PURE__ */ new WeakMap());
    __publicField(this, "baseCanBeBlinded");
    __publicField(this, "bits");
    validatePointCons(Point);
    this.randomBytes = probeRandomBytes(randomBytes4, BLIND_BYTES);
    this.Point = Point;
    this.BASE = Point.BASE;
    this.ZERO = Point.ZERO;
    this.bits = Point.Fn.BITS;
  }
  /**
   * Creates a signed fixed-window wNAF precomputation table: for every window w, the
   * multiples `[1..2^(W−1)]⋅2^(w⋅W)⋅P`, flattened. All doublings are baked into the table,
   * so cached multiplication is additions-only. `windows = ceil(bits/W) + 1`: the extra
   * window absorbs the final carry of signed-digit recoding.
   * For a 256-bit curve and W=6, the table is 44⋅32 = 1408 points.
   * @param point - Point instance
   * @param W - window size
   * @param bits - scalar bitlength the table must cover
   */
  buildWnafTable(point, W, bits) {
    const windows = Math.ceil(bits / W) + 1;
    const half = 2 ** (W - 1);
    const comp = [];
    let base = point;
    for (let w = 0; w < windows; w++) {
      let acc = base;
      for (let i = 0; i < half; i++) {
        comp.push(acc);
        acc = acc.add(base);
      }
      base = comp[comp.length - 1].double();
    }
    return { W, bits, windows, comp };
  }
  /**
   * Implements ec multiplication using precomputed signed fixed-window wNAF tables.
   * Constant-time: fixed window count with one table addition per window — zero digits feed
   * the fake accumulator — and no doublings; the lookup scans the whole window slice.
   * Scalar bounds are validated by the public entry points ({@link ScalarMultiplier.mulCT},
   * {@link ScalarMultiplier.mulCTBlinded}, {@link ScalarMultiplier.mulUnsafe});
   * signedWindowDigits throws if `n` exceeds the table.
   * @returns real and fake (for const-time) points
   */
  wnafCachedCT(precomputes, n) {
    const { W, windows, comp } = precomputes;
    const half = 2 ** (W - 1);
    const digits = signedWindowDigits(n, W, windows);
    let p = this.ZERO;
    let f = this.BASE;
    for (let w = 0; w < windows; w++) {
      const digit = digits[w];
      const start = w * half;
      const idx = Math.abs(digit) - 1;
      let sel = comp[start];
      for (let i = 1; i < half; i++)
        sel = i === idx ? comp[start + i] : sel;
      const neg = sel.negate();
      if (digit === 0)
        f = f.add(comp[start]);
      else
        p = p.add(digit < 0 ? neg : sel);
    }
    return { p, f };
  }
  // Cache key is point identity plus (W, bits); at most two entries exist per point (public-width
  // `Fn.BITS` and blinded `Fn.BITS + BLIND_BITS`). Callers must not reuse the same point with
  // incompatible `transform(...)` layouts and expect a separate cache entry.
  getWnafPrecomputes(W, point, bits, transform) {
    let entries = this.wnafPrecomputes.get(point);
    let comp = entries?.find((entry) => entry.W === W && entry.bits === bits);
    if (!comp) {
      comp = this.buildWnafTable(point, W, bits);
      if (typeof transform === "function")
        comp = { ...comp, comp: transform(comp.comp) };
      if (!entries) {
        entries = [];
        this.wnafPrecomputes.set(point, entries);
      }
      entries.push(comp);
    }
    return comp;
  }
  assertPoint(point) {
    if (!(point instanceof this.Point))
      throw new TypeError('"point" expected Point instance, got type=' + typeof point);
  }
  // Shared prologue of the constant-time entry points. Rejects scalar 0: in key/signature-style
  // callers a zero scalar means broken upstream plumbing, and concrete Points already reject it.
  // Uses inRange instead of Fn.isValidNot0: validateField() only certifies the arithmetic subset.
  validateMulInput(point, scalar) {
    this.assertPoint(point);
    if (!inRange(scalar, _1n3, this.Point.Fn.ORDER))
      throw new Error("invalid scalar");
  }
  // Constant-time dispatch shared by mulCT / mulCTBlinded. Un-precomputed points (W===1, e.g.
  // ECDH peer keys) skip building a throwaway cached table in favor of a small fixed-window
  // multiply. `n` must be < 2^bits.
  runCT(point, n, bits, transform) {
    const W = getWindowSize(point);
    if (W === 1)
      return this.fixedWindowCT(point, n, bits);
    return this.wnafCachedCT(this.getWnafPrecomputes(W, point, bits, transform), n);
  }
  mulCT(point, scalar, transform) {
    this.validateMulInput(point, scalar);
    return this.runCT(point, scalar, this.bits, transform);
  }
  mulCTBlinded(point, scalar, transform) {
    this.validateMulInput(point, scalar);
    if (this.randomBytes === void 0)
      throw new Error("randomBytes is required for scalar blinding");
    const bits = this.Point.Fn.BITS + BLIND_BITS;
    const blind = this.randomBytes(BLIND_BYTES);
    if (!isBytes3(blind) || blind.length !== BLIND_BYTES)
      throw new Error("randomBytes returned invalid byte array");
    blind[0] = blind[0] & 63 | 128;
    const n = scalar + bytesToNumberBE(blind) * this.Point.Fn.ORDER;
    return this.runCT(point, n, bits, transform);
  }
  /**
   * Constant-time multiplication `n*point` for an un-precomputed point, via a small fixed window.
   * A cached wNAF table only pays off when reused; a flat 2^FW_WINDOW table (`size-1` adds) is
   * far cheaper to build for a single use. The point-operation sequence is independent of `n`:
   * build the table, then per window exactly FW_WINDOW doublings, a data-oblivious scan over
   * every table entry, and one addition (adds the identity when the window digit is 0 — never
   * skipped).
   *
   * `n` must be `< 2^bits`. Assumes complete addition (adding the identity costs the same as any
   * add), which holds for the Weierstrass/Edwards point types used here. The table is left in
   * projective form (no normalizeZ): normalizing this small a table costs more than the
   * mixed-add savings it would buy for a single multiply.
   * @returns real point `p`; `f` duplicates it only to match {@link wnafCachedCT}'s return shape
   * (this path needs no fake accumulator — its op-count is already scalar-independent).
   */
  fixedWindowCT(point, n, bits) {
    const W = FW_WINDOW;
    const size = 1 << W;
    const mask = bitMask(W);
    const table = new Array(size);
    table[0] = this.ZERO;
    for (let i = 1; i < size; i++)
      table[i] = table[i - 1].add(point);
    const windows = Math.ceil(bits / W);
    let acc = this.ZERO;
    for (let window2 = windows - 1; window2 >= 0; window2--) {
      if (window2 !== windows - 1)
        for (let d = 0; d < W; d++)
          acc = acc.double();
      const digit = Number(n >> BigInt(window2 * W) & mask);
      let sel = table[0];
      for (let i = 1; i < size; i++)
        sel = i === digit ? table[i] : sel;
      acc = acc.add(sel);
    }
    return { p: acc, f: acc };
  }
  shouldBlind(point, cofactor) {
    if (this.randomBytes === void 0)
      return false;
    if (cofactor === _1n3)
      return true;
    if (point !== this.BASE)
      return false;
    if (this.baseCanBeBlinded === void 0)
      this.baseCanBeBlinded = this.mulUnsafe(this.BASE, this.Point.Fn.ORDER).is0();
    return this.baseCanBeBlinded;
  }
  mulSecret(point, scalar, cofactor, transform) {
    return this.shouldBlind(point, cofactor) ? this.mulCTBlinded(point, scalar, transform) : this.mulCT(point, scalar, transform);
  }
  mulUnsafe(point, scalar, transform) {
    this.assertPoint(point);
    if (!isPosBig(scalar))
      throw new Error("invalid scalar");
    const W = getWindowSize(point);
    if (W === 1 || scalar >= this.Point.Fn.ORDER)
      return mulAddUnsafe(this.Point, [point], [scalar], true);
    const precomputes = this.getWnafPrecomputes(W, point, this.bits, transform);
    return this.wnafCachedCT(precomputes, scalar).p;
  }
  // Remembers the window size used for precomputed wNAF multiplication of the given point
  // and drops any previously built tables. Usually only the base point is precomputed.
  // W=1 resets the point to the un-precomputed (table-less) paths.
  // W is additionally capped so tables stay under ~2 GiB ({@link TABLE_BYTES_MAX}).
  setWindowSize(point, W) {
    this.assertPoint(point);
    validateW(W, this.bits);
    const windows = Math.ceil((this.bits + BLIND_BITS) / W) + 1;
    validateTableBytes(windows * 2 ** (W - 1), this.Point.Fp.BYTES);
    pointWindowSizes.set(point, W);
    this.wnafPrecomputes.delete(point);
  }
  // True when a window size is set: tables themselves are built lazily on first multiply.
  hasWindowSize(point) {
    return getWindowSize(point) !== 1;
  }
};
function mulAddUnsafe(c, points, scalars, allowOversized = false) {
  validatePointCons(c);
  validateMSMPoints(points, c);
  abool2(allowOversized, "allowOversized");
  validateMSMScalars(scalars, c.Fn, allowOversized ? c.Fn.ORDER ** _4n2 : void 0);
  if (points.length !== scalars.length)
    throw new Error("arrays of points and scalars must have equal length");
  const tables = points.map((p) => oddMultiples(p, 4));
  const digits = scalars.map((n) => wnafDigits(n, 4));
  return wnafWalk(c.ZERO, tables, digits);
}
function createField(order, field, isLE2) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField(field);
    return field;
  } else {
    return Field(order, { isLE: isLE2 });
  }
}
function createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (type !== "weierstrass" && type !== "edwards")
    throw new Error('expected curve type "weierstrass" or "edwards"');
  if (FpFnLE === void 0)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  validateObject(curveOpts);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(isPosBig(val) && val !== _0n3))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  const Fp2 = createField(CURVE.p, curveOpts.Fp, FpFnLE);
  const Fn2 = createField(CURVE.n, curveOpts.Fn, FpFnLE);
  const _b = type === "weierstrass" ? "b" : "d";
  const params = ["Gx", "Gy", "a", _b];
  for (const p of params) {
    if (!Fp2.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  }
  CURVE = Object.freeze(Object.assign({}, CURVE));
  return { CURVE, Fp: Fp2, Fn: Fn2 };
}
function createKeygen(randomSecretKey, getPublicKey) {
  return function keygen(seed) {
    const secretKey = randomSecretKey(seed);
    return { secretKey, publicKey: getPublicKey(secretKey) };
  };
}

// node_modules/@noble/curves/abstract/edwards.js
var _0n4 = /* @__PURE__ */ BigInt(0);
var _1n4 = /* @__PURE__ */ BigInt(1);
var _2n2 = /* @__PURE__ */ BigInt(2);
var _4n3 = /* @__PURE__ */ BigInt(4);
var _8n2 = /* @__PURE__ */ BigInt(8);
function isEdValidXY(Fp2, CURVE, x, y) {
  const x2 = Fp2.sqr(x);
  const y2 = Fp2.sqr(y);
  const left = Fp2.add(Fp2.mul(CURVE.a, x2), y2);
  const right = Fp2.add(Fp2.ONE, Fp2.mul(CURVE.d, Fp2.mul(x2, y2)));
  return Fp2.eql(left, right);
}
function edwards(params, extraOpts = {}) {
  validateObject(extraOpts, {}, {}, "extraOpts");
  const opts = extraOpts;
  const validated = createCurveFields("edwards", params, opts, opts.FpFnLE);
  const { Fp: Fp2, Fn: Fn2 } = validated;
  let CURVE = validated.CURVE;
  const { h: cofactor } = CURVE;
  if (FpLegendre(Fp2, CURVE.a) !== 1)
    throw new Error("edwards: CURVE.a must be a square in Fp for complete addition formulas");
  if (FpLegendre(Fp2, CURVE.d) !== -1)
    throw new Error("edwards: CURVE.d must be a non-square in Fp for complete addition formulas");
  validateObject(opts, {}, { uvRatio: "function", randomBytes: "function" });
  const randomBytes4 = opts.randomBytes === void 0 ? randomBytes2 : opts.randomBytes;
  const MASK = _2n2 << BigInt(Fp2.BYTES * 8) - _1n4;
  function isOdd(n) {
    if (!Fp2.isOdd)
      throw new Error("Field does not have .isOdd()");
    return Fp2.isOdd(n);
  }
  const uvRatio3 = opts.uvRatio === void 0 ? (u, v) => {
    try {
      return { isValid: true, value: Fp2.sqrt(Fp2.div(u, v)) };
    } catch (e) {
      return { isValid: false, value: _0n4 };
    }
  } : opts.uvRatio;
  if (!isEdValidXY(Fp2, CURVE, CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const mulA = Fp2.eql(CURVE.a, Fp2.neg(Fp2.ONE)) ? (x) => Fp2.neg(x) : Fp2.eql(CURVE.a, Fp2.ONE) ? (x) => x : (x) => Fp2.mul(CURVE.a, x);
  function acoord(title, n, banZero = false) {
    const min = banZero ? _1n4 : _0n4;
    aInRange("coordinate " + title, n, min, MASK);
    return n;
  }
  function aedpoint(other) {
    if (!(other instanceof Point))
      throw new Error("EdwardsPoint expected");
  }
  const _Point = class _Point {
    constructor(X, Y, Z, T) {
      __publicField(this, "X");
      __publicField(this, "Y");
      __publicField(this, "Z");
      __publicField(this, "T");
      this.X = acoord("x", X);
      this.Y = acoord("y", Y);
      this.Z = acoord("z", Z, true);
      this.T = acoord("t", T);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    /**
     * Create one extended Edwards point from affine coordinates.
     * Does NOT validate that the point is on-curve or torsion-free.
     * Use `.assertValidity()` on adversarial inputs.
     */
    static fromAffine(p) {
      if (p instanceof _Point)
        throw new Error("extended point not allowed");
      const { x, y } = p || {};
      acoord("x", x);
      acoord("y", y);
      return new _Point(x, y, Fp2.ONE, Fp2.mul(x, y));
    }
    // Uses algo from RFC8032 5.1.3.
    static fromBytes(bytes, zip215 = false) {
      const len = Fp2.BYTES;
      const { a, d } = CURVE;
      bytes = copyBytes2(abytes3(bytes, len, "point"));
      abool2(zip215, "zip215");
      const normed = copyBytes2(bytes);
      const lastByte = bytes[len - 1];
      normed[len - 1] = lastByte & ~128;
      const y = bytesToNumberLE(normed);
      const max = zip215 ? MASK : Fp2.ORDER;
      aInRange("point.y", y, _0n4, max);
      const y2 = Fp2.sqr(y);
      const u = Fp2.sub(y2, Fp2.ONE);
      const v = Fp2.sub(Fp2.mulN(d, y2), a);
      let { isValid, value: x } = uvRatio3(u, v);
      if (!isValid)
        throw new Error("bad point: invalid y coordinate");
      const isXOdd = isOdd(x);
      const isLastByteOdd = (lastByte & 128) !== 0;
      if (!zip215 && Fp2.is0(x) && isLastByteOdd)
        throw new Error("bad point: x=0 and x_0=1");
      if (isLastByteOdd !== isXOdd)
        x = Fp2.neg(x);
      return _Point.fromAffine({ x, y });
    }
    static fromHex(hex, zip215 = false) {
      return _Point.fromBytes(hexToBytes2(hex), zip215);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    precompute(windowSize = 6, isLazy = true) {
      wnaf.setWindowSize(this, windowSize);
      if (!isLazy)
        this.multiply(_2n2);
      return this;
    }
    // Useful in fromAffine() - not for fromBytes(), which always created valid points.
    assertValidity() {
      const p = this;
      const { a, d } = CURVE;
      if (p.is0())
        throw new Error("bad point: ZERO");
      const { X, Y, Z, T } = p;
      const X2 = Fp2.sqr(X);
      const Y2 = Fp2.sqr(Y);
      const Z2 = Fp2.sqr(Z);
      const Z4 = Fp2.sqr(Z2);
      const aX2 = Fp2.mul(X2, a);
      const left = Fp2.mul(Fp2.add(aX2, Y2), Z2);
      const right = Fp2.add(Z4, Fp2.mul(d, Fp2.mul(X2, Y2)));
      if (!Fp2.eql(left, right))
        throw new Error("bad point: equation left != right (1)");
      const XY = Fp2.mul(X, Y);
      const ZT = Fp2.mul(Z, T);
      if (!Fp2.eql(XY, ZT))
        throw new Error("bad point: equation left != right (2)");
    }
    // Compare one point to another.
    equals(other) {
      aedpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const X1Z2 = Fp2.mul(X1, Z2);
      const X2Z1 = Fp2.mul(X2, Z1);
      const Y1Z2 = Fp2.mul(Y1, Z2);
      const Y2Z1 = Fp2.mul(Y2, Z1);
      return Fp2.eql(X1Z2, X2Z1) && Fp2.eql(Y1Z2, Y2Z1);
    }
    is0() {
      return this.equals(_Point.ZERO);
    }
    negate() {
      return new _Point(Fp2.neg(this.X), this.Y, this.Z, Fp2.neg(this.T));
    }
    // Fast algo for doubling Extended Point.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#doubling-dbl-2008-hwcd
    // Cost: 4M + 4S + 1*a + 6add + 1*2.
    double() {
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const A = Fp2.sqr(X1);
      const B = Fp2.sqr(Y1);
      const C = Fp2.mul(Fp2.sqr(Z1), _2n2);
      const D = mulA(A);
      const x1y1 = Fp2.addN(X1, Y1);
      const E = Fp2.sub(Fp2.subN(Fp2.sqr(x1y1), A), B);
      const G = Fp2.addN(D, B);
      const F = Fp2.subN(G, C);
      const H = Fp2.subN(D, B);
      const X3 = Fp2.mul(E, F);
      const Y3 = Fp2.mul(G, H);
      const T3 = Fp2.mul(E, H);
      const Z3 = Fp2.mul(F, G);
      return new _Point(X3, Y3, Z3, T3);
    }
    // Fast algo for adding 2 Extended Points.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#addition-add-2008-hwcd
    // Cost: 9M + 1*a + 1*d + 7add.
    add(other) {
      aedpoint(other);
      const { d } = CURVE;
      const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
      const { X: X2, Y: Y2, Z: Z2, T: T2 } = other;
      const A = Fp2.mul(X1, X2);
      const B = Fp2.mul(Y1, Y2);
      const C = Fp2.mul(Fp2.mulN(T1, d), T2);
      const D = Fp2.mul(Z1, Z2);
      const E = Fp2.sub(Fp2.subN(Fp2.mulN(Fp2.addN(X1, Y1), Fp2.addN(X2, Y2)), A), B);
      const F = Fp2.subN(D, C);
      const G = Fp2.addN(D, C);
      const H = Fp2.sub(B, mulA(A));
      const X3 = Fp2.mul(E, F);
      const Y3 = Fp2.mul(G, H);
      const T3 = Fp2.mul(E, H);
      const Z3 = Fp2.mul(F, G);
      return new _Point(X3, Y3, Z3, T3);
    }
    subtract(other) {
      aedpoint(other);
      return this.add(other.negate());
    }
    // Constant-time multiplication.
    multiply(scalar) {
      if (!Fn2.isValidNot0(scalar))
        throw new RangeError("invalid scalar: expected 1 <= sc < curve.n");
      const { p, f } = wnaf.mulSecret(this, scalar, cofactor, normalize);
      return normalize([p, f])[0];
    }
    // Non-constant-time multiplication. Uses double-and-add algorithm.
    // It's faster, but should only be used when you don't care about
    // an exposed private key e.g. sig verification.
    // Keeps the same subgroup-scalar contract: 0 is allowed for public-scalar callers, but
    // n and larger values are rejected instead of being reduced mod n to the identity point.
    multiplyUnsafe(scalar) {
      if (!Fn2.isValid(scalar))
        throw new RangeError("invalid scalar: expected 0 <= sc < curve.n");
      if (scalar === _0n4)
        return _Point.ZERO;
      if (this.is0() || scalar === _1n4)
        return this;
      return wnaf.mulUnsafe(this, scalar, normalize);
    }
    // Checks if point is of small order.
    // If you add something to small order point, you will have "dirty"
    // point with torsion component.
    // Clears cofactor and checks if the result is 0.
    isSmallOrder() {
      return this.clearCofactor().is0();
    }
    // Multiplies point by curve order and checks if the result is 0.
    // Returns `false` is the point is dirty.
    isTorsionFree() {
      return wnaf.mulUnsafe(this, CURVE.n).is0();
    }
    // Converts Extended point to default (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    toAffine(invertedZ) {
      const p = this;
      let iz = invertedZ;
      if (iz != null && typeof iz !== "bigint")
        throw new TypeError('"invertedZ" expected bigint, got type=' + typeof iz);
      const { X, Y, Z } = p;
      const is0 = p.is0();
      if (iz == null)
        iz = is0 ? Fp2.create(_8n2) : Fp2.inv(Z);
      const x = Fp2.mul(X, iz);
      const y = Fp2.mul(Y, iz);
      const zz = Fp2.mul(Z, iz);
      if (is0)
        return { x: Fp2.ZERO, y: Fp2.ONE };
      if (!Fp2.eql(zz, Fp2.ONE))
        throw new Error("invZ was invalid");
      return { x, y };
    }
    clearCofactor() {
      if (cofactor === _1n4)
        return this;
      if (cofactor === _2n2)
        return this.double();
      if (cofactor === _4n3)
        return this.double().double();
      if (cofactor === _8n2)
        return this.double().double().double();
      return this.multiplyUnsafe(cofactor);
    }
    toBytes() {
      const { x, y } = this.toAffine();
      const bytes = Fp2.toBytes(y);
      bytes[bytes.length - 1] |= isOdd(x) ? 128 : 0;
      return bytes;
    }
    toHex() {
      return bytesToHex2(this.toBytes());
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
  };
  __publicField(_Point, "BASE", new _Point(CURVE.Gx, CURVE.Gy, Fp2.ONE, Fp2.mul(CURVE.Gx, CURVE.Gy)));
  __publicField(_Point, "ZERO", new _Point(Fp2.ZERO, Fp2.ONE, Fp2.ONE, Fp2.ZERO));
  __publicField(_Point, "Fp", Fp2);
  __publicField(_Point, "Fn", Fn2);
  let Point = _Point;
  const normalize = (points) => normalizeZ(Point, points);
  const wnaf = new ScalarMultiplier(Point, randomBytes4);
  if (wnaf.bits >= 6)
    Point.BASE.precompute(6);
  Object.freeze(Point.prototype);
  Object.freeze(Point);
  return Point;
}

// node_modules/@noble/curves/abstract/montgomery.js
var _0n5 = /* @__PURE__ */ BigInt(0);
var _1n5 = /* @__PURE__ */ BigInt(1);
var _2n3 = /* @__PURE__ */ BigInt(2);
function cmask(P, swap) {
  return P + swap - (swap >> _1n5 << _1n5);
}
function cswap(P) {
  const offset = BigInt(6) * P;
  return (mask, x_2, x_3) => {
    const sum = x_2 + x_3;
    const d = offset + x_3 - x_2;
    const a = (d * mask + x_2) % P;
    return { x_2: a, x_3: sum - a };
  };
}
function validateOpts(curve) {
  validateObject(curve, {
    P: "bigint",
    type: "string",
    adjustScalarBytes: "function",
    powPminus2: "function"
  }, {
    randomBytes: "function",
    scalarMultBase: "function"
  });
  return Object.freeze({ ...curve });
}
function montgomery(curveDef) {
  const CURVE = validateOpts(curveDef);
  const { P, type, adjustScalarBytes: adjustScalarBytes3, powPminus2, randomBytes: rand } = CURVE;
  const mulBaseHook = CURVE.scalarMultBase;
  const is25519 = type === "x25519";
  if (!is25519 && type !== "x448")
    throw new Error("invalid type");
  const randomBytes_ = rand === void 0 ? randomBytes2 : rand;
  const montgomeryBits = is25519 ? 255 : 448;
  const swap = cswap(P);
  const fieldLen = is25519 ? 32 : 56;
  const Gu = is25519 ? BigInt(9) : BigInt(5);
  const a24 = is25519 ? BigInt(121665) : BigInt(39081);
  const minScalar = is25519 ? _2n3 ** BigInt(254) : _2n3 ** BigInt(447);
  const maxAdded = is25519 ? BigInt(8) * (_2n3 ** BigInt(251) - _1n5) : BigInt(4) * (_2n3 ** BigInt(445) - _1n5);
  const maxScalar = minScalar + maxAdded + _1n5;
  const modP = (n) => mod(n, P);
  const GuBytes = encodeU(Gu);
  function encodeU(u) {
    return numberToBytesLE(modP(u), fieldLen);
  }
  function decodeU(u) {
    const _u = copyBytes2(abytes3(u, fieldLen, "uCoordinate"));
    if (is25519)
      _u[31] &= 127;
    return modP(bytesToNumberLE(_u));
  }
  function decodeScalar(scalar) {
    return bytesToNumberLE(adjustScalarBytes3(copyBytes2(abytes3(scalar, fieldLen, "scalar"))));
  }
  const lowOrderU = new Set(is25519 ? [
    _0n5,
    _1n5,
    P - _1n5,
    BigInt("325606250916557431795983626356110631294008115727848805560023387167927233504"),
    BigInt("39382357235489614581723060781553021112529911719440698176882885853963445705823")
  ] : [_0n5, _1n5, P - _1n5]);
  function scalarMult(scalar, u) {
    const pointU = decodeU(u);
    if (lowOrderU.has(pointU))
      throw new Error("invalid private or public key received");
    const pu = montgomeryLadder(pointU, decodeScalar(scalar));
    if (pu === _0n5)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  function scalarMultBase(scalar) {
    if (mulBaseHook === void 0)
      return scalarMult(scalar, GuBytes);
    const k = decodeScalar(scalar);
    aInRange("scalar", k, minScalar, maxScalar);
    const pu = modP(mulBaseHook(k));
    if (pu === _0n5)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  const getPublicKey = scalarMultBase;
  const getSharedSecret = scalarMult;
  function montgomeryLadder(u, scalar) {
    aInRange("u", u, _0n5, P);
    aInRange("scalar", scalar, minScalar, maxScalar);
    const k = scalar;
    const x_1 = u;
    let x_2 = _1n5;
    let z_2 = _0n5;
    let x_3 = u;
    let z_3 = _1n5;
    const kx = k ^ k >> _1n5;
    for (let t = BigInt(montgomeryBits - 1); t >= _0n5; t--) {
      const mask2 = cmask(P, kx >> t);
      ({ x_2, x_3 } = swap(mask2, x_2, x_3));
      ({ x_2: z_2, x_3: z_3 } = swap(mask2, z_2, z_3));
      const A = x_2 + z_2;
      const AA = modP(A * A);
      const B = x_2 - z_2;
      const BB = modP(B * B);
      const E = AA - BB;
      const C = x_3 + z_3;
      const D = x_3 - z_3;
      const DA = modP(D * A);
      const CB = modP(C * B);
      const dacb = DA + CB;
      const da_cb = DA - CB;
      x_3 = modP(dacb * dacb);
      z_3 = modP(x_1 * modP(da_cb * da_cb));
      x_2 = modP(AA * BB);
      z_2 = modP(E * (AA + modP(a24 * E)));
    }
    const mask = cmask(P, k);
    ({ x_2, x_3 } = swap(mask, x_2, x_3));
    ({ x_2: z_2, x_3: z_3 } = swap(mask, z_2, z_3));
    const z2 = powPminus2(z_2);
    return modP(x_2 * z2);
  }
  const lengths = {
    secretKey: fieldLen,
    publicKey: fieldLen,
    seed: fieldLen
  };
  const randomSecretKey = (seed) => {
    seed = seed === void 0 ? randomBytes_(fieldLen) : seed;
    abytes3(seed, lengths.seed, "seed");
    return seed;
  };
  const utils = { randomSecretKey };
  Object.freeze(lengths);
  Object.freeze(utils);
  return Object.freeze({
    keygen: createKeygen(randomSecretKey, getPublicKey),
    getSharedSecret,
    getPublicKey,
    scalarMult,
    scalarMultBase,
    utils,
    GuBytes: GuBytes.slice(),
    lengths
  });
}

// node_modules/@noble/curves/ed25519.js
var _0n6 = /* @__PURE__ */ BigInt(0);
var _1n6 = /* @__PURE__ */ BigInt(1);
var _2n4 = /* @__PURE__ */ BigInt(2);
var _3n2 = /* @__PURE__ */ BigInt(3);
var _5n2 = /* @__PURE__ */ BigInt(5);
var _8n3 = /* @__PURE__ */ BigInt(8);
var ed25519_CURVE_p = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed");
var ed25519_CURVE = /* @__PURE__ */ (() => ({
  p: ed25519_CURVE_p,
  n: BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed"),
  h: _8n3,
  a: BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffec"),
  d: BigInt("0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3"),
  Gx: BigInt("0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a"),
  Gy: BigInt("0x6666666666666666666666666666666666666666666666666666666666666658")
}))();
function ed25519_pow_2_252_3(x) {
  const _10n = BigInt(10), _20n = BigInt(20), _40n = BigInt(40), _80n = BigInt(80);
  const P = ed25519_CURVE_p;
  const x2 = x * x % P;
  const b2 = x2 * x % P;
  const b4 = pow2(b2, _2n4, P) * b2 % P;
  const b5 = pow2(b4, _1n6, P) * x % P;
  const b10 = pow2(b5, _5n2, P) * b5 % P;
  const b20 = pow2(b10, _10n, P) * b10 % P;
  const b40 = pow2(b20, _20n, P) * b20 % P;
  const b80 = pow2(b40, _40n, P) * b40 % P;
  const b160 = pow2(b80, _80n, P) * b80 % P;
  const b240 = pow2(b160, _80n, P) * b80 % P;
  const b250 = pow2(b240, _10n, P) * b10 % P;
  const pow_p_5_8 = pow2(b250, _2n4, P) * x % P;
  return { pow_p_5_8, b2 };
}
function adjustScalarBytes(bytes) {
  bytes[0] &= 248;
  bytes[31] &= 127;
  bytes[31] |= 64;
  return bytes;
}
var ED25519_SQRT_M1 = /* @__PURE__ */ BigInt("19681161376707505956807079304988542015446066515923890162744021073123829784752");
function uvRatio(u, v) {
  const P = ed25519_CURVE_p;
  const v3 = mod(v * v * v, P);
  const v7 = mod(v3 * v3 * v, P);
  const pow3 = ed25519_pow_2_252_3(u * v7).pow_p_5_8;
  let x = mod(u * v3 * pow3, P);
  const vx2 = mod(v * x * x, P);
  const root1 = x;
  const root2 = mod(x * ED25519_SQRT_M1, P);
  const useRoot1 = vx2 === u;
  const useRoot2 = vx2 === mod(-u, P);
  const noRoot = vx2 === mod(-u * ED25519_SQRT_M1, P);
  if (useRoot1)
    x = root1;
  if (useRoot2 || noRoot)
    x = root2;
  if (isNegativeLE(x, P))
    x = mod(-x, P);
  return { isValid: useRoot1 || useRoot2, value: x };
}
var ed25519_Point = /* @__PURE__ */ edwards(ed25519_CURVE, { uvRatio });
var x25519 = /* @__PURE__ */ (() => {
  const P = ed25519_CURVE_p;
  const powPminus2 = (x) => {
    const { pow_p_5_8, b2 } = ed25519_pow_2_252_3(x);
    return mod(pow2(pow_p_5_8, _3n2, P) * b2, P);
  };
  return montgomery({
    P,
    type: "x25519",
    powPminus2,
    adjustScalarBytes,
    // ~3x faster fixed-base: [k]B on the birationally-equivalent Edwards curve using cached
    // base tables, mapped back via u = (1+y)/(1-y) = (Z+Y)/(Z-Y) with one Fermat inversion.
    // Same construction as libsodium's crypto_scalarmult_curve25519_base.
    scalarMultBase: (k) => {
      const kn = mod(k, ed25519_Point.Fn.ORDER);
      if (kn === _0n6)
        return _0n6;
      const p = ed25519_Point.BASE.multiply(kn);
      return mod((p.Z + p.Y) * powPminus2(mod(p.Z - p.Y, P)), P);
    }
  });
})();

// node_modules/@panva/hpke-noble/index.js
var AES_GCM_P_MAX2 = 2 ** 36 - 31;
var CHACHA20_POLY1305_P_MAX2 = 2 ** 38 - 64;
var AEAD_AES_256_GCM = () => createAead(2, "AES-256-GCM", 32, AES_GCM_P_MAX2, gcm);
function createAead(id, name, Nk, P_MAX, cipher) {
  return {
    id,
    type: "AEAD",
    name,
    Nk,
    Nn: 12,
    Nt: 16,
    async Seal(key, nonce, aad, pt) {
      if (pt.byteLength > P_MAX) {
        throw new RangeError('"pt" exceeds P_MAX');
      }
      return cipher(key, nonce, aad).encrypt(pt);
    },
    async Open(key, nonce, aad, ct) {
      return cipher(key, nonce, aad).decrypt(ct);
    }
  };
}
var KDF_HKDF_SHA256 = () => createTwoStageKdf(1, "HKDF-SHA256", 32, sha256);
function createTwoStageKdf(id, name, Nh, hash) {
  return {
    id,
    type: "KDF",
    name,
    Nh,
    stages: 2,
    async Extract(salt, ikm) {
      return extract(hash, ikm, salt);
    },
    async Expand(prk, info, L) {
      return expand(hash, prk, info, L);
    },
    Derive: Unreachable
  };
}
var Unreachable = () => {
  throw new Error("unreachable");
};
var KEM_DHKEM_X25519_HKDF_SHA256 = () => createDhKemX({
  id: 32,
  name: "DHKEM(X25519, HKDF-SHA256)",
  Nsecret: 32,
  Nenc: 32,
  Npk: 32,
  Nsk: 32,
  curve: x25519,
  kdf: KDF_HKDF_SHA256
});
async function deriveSharedSecret(kdf2, suite_id, Nsecret, dh, enc, pkRm) {
  const kem_context = concat(enc, pkRm);
  const eae_prk = await LabeledExtract(kdf2, suite_id, new Uint8Array(), encode("eae_prk"), dh);
  return LabeledExpand(kdf2, suite_id, eae_prk, encode("shared_secret"), kem_context, Nsecret);
}
function createDhKemX(config) {
  const { id, name, Nsecret, Nenc, Npk, Nsk, curve, kdf: kdfFactory } = config;
  const kdf2 = kdfFactory();
  const suite_id = concat(encode("KEM"), I2OSP(id, 2));
  const algorithm = { name };
  Object.freeze(NobleKey.prototype);
  return {
    id,
    type: "KEM",
    name,
    Nsecret,
    Nenc,
    Npk,
    Nsk,
    async DeriveKeyPair(ikm, extractable) {
      const dkp_prk = await LabeledExtract(kdf2, suite_id, new Uint8Array(), encode("dkp_prk"), ikm);
      const sk = await LabeledExpand(kdf2, suite_id, dkp_prk, encode("sk"), new Uint8Array(), Nsk);
      const pk = curve.getPublicKey(sk);
      return {
        privateKey: new NobleKey(priv, "private", sk, extractable, algorithm),
        publicKey: new NobleKey(priv, "public", pk, true, algorithm)
      };
    },
    async GenerateKeyPair(extractable) {
      const ikm = crypto.getRandomValues(new Uint8Array(Nsk));
      return await this.DeriveKeyPair(ikm, extractable);
    },
    async SerializePublicKey(key) {
      NobleKey.validate(key, algorithm, true);
      return key.value(priv);
    },
    async DeserializePublicKey(key) {
      return new NobleKey(priv, "public", slice2(key), true, algorithm);
    },
    async SerializePrivateKey(key) {
      NobleKey.validate(key, algorithm, true);
      return key.value(priv);
    },
    async DeserializePrivateKey(key, extractable) {
      return new NobleKey(priv, "private", slice2(key), extractable, algorithm);
    },
    async Encap(pkR) {
      NobleKey.validate(pkR, algorithm);
      const ekp = await this.GenerateKeyPair(false);
      const enc = ekp.publicKey.value(priv);
      const dh = curve.getSharedSecret(
        ekp.privateKey.value(priv),
        pkR.value(priv)
      );
      return {
        shared_secret: await deriveSharedSecret(
          kdf2,
          suite_id,
          Nsecret,
          dh,
          enc,
          pkR.value(priv)
        ),
        enc
      };
    },
    async Decap(enc, skR, pkR) {
      NobleKey.validate(skR, algorithm);
      const skRValue = skR.value(priv);
      pkR ?? (pkR = await this.DeserializePublicKey(curve.getPublicKey(skRValue)));
      NobleKey.validate(pkR, algorithm);
      const pkE = await this.DeserializePublicKey(enc);
      const dh = curve.getSharedSecret(skRValue, pkE.value(priv));
      return await deriveSharedSecret(
        kdf2,
        suite_id,
        Nsecret,
        dh,
        enc,
        pkR.value(priv)
      );
    }
  };
}
var InvalidInvocation = (_) => {
  if (_ !== priv) {
    throw new Error("invalid invocation");
  }
};
var priv = /* @__PURE__ */ Symbol();
var _type, _extractable, _algorithm, _value, _seed, _NobleKey_static, isValid_fn;
var _NobleKey = class _NobleKey {
  constructor(_, type, value, extractable, algorithm, seed) {
    __privateAdd(this, _type);
    __privateAdd(this, _extractable);
    __privateAdd(this, _algorithm);
    __privateAdd(this, _value);
    __privateAdd(this, _seed);
    InvalidInvocation(_);
    __privateSet(this, _type, type);
    __privateSet(this, _value, value);
    __privateSet(this, _extractable, extractable);
    __privateSet(this, _algorithm, algorithm);
    __privateSet(this, _seed, seed);
  }
  static validate(key, algorithm, extractable) {
    var _a;
    if (key.algorithm?.name !== algorithm.name) {
      throw new TypeError(`key algorithm must be ${algorithm.name}`);
    }
    try {
      if (!__privateMethod(_a = _NobleKey, _NobleKey_static, isValid_fn).call(_a, key)) {
        throw new TypeError("unexpected key constructor");
      }
    } catch {
      throw new TypeError("unexpected key constructor");
    }
    if (extractable && !key.extractable) {
      throw new TypeError("key must be extractable");
    }
  }
  get algorithm() {
    return { name: __privateGet(this, _algorithm).name };
  }
  get extractable() {
    return __privateGet(this, _extractable);
  }
  get type() {
    return __privateGet(this, _type);
  }
  value(_) {
    InvalidInvocation(_);
    return slice2(__privateGet(this, _value));
  }
  seed(_) {
    InvalidInvocation(_);
    return slice2(__privateGet(this, _seed));
  }
};
_type = new WeakMap();
_extractable = new WeakMap();
_algorithm = new WeakMap();
_value = new WeakMap();
_seed = new WeakMap();
_NobleKey_static = new WeakSet();
isValid_fn = function(key) {
  return __privateGet(key, _algorithm) !== void 0;
};
__privateAdd(_NobleKey, _NobleKey_static);
var NobleKey = _NobleKey;
function slice2(buffer, start, end) {
  return Uint8Array.prototype.slice.call(buffer, start, end);
}

// node_modules/ehbp/dist/esm/protocol.js
var PROTOCOL = {
  ENCAPSULATED_KEY_HEADER: "Ehbp-Encapsulated-Key",
  RESPONSE_NONCE_HEADER: "Ehbp-Response-Nonce",
  KEYS_MEDIA_TYPE: "application/ohttp-keys",
  KEYS_PATH: "/.well-known/hpke-keys",
  PROBLEM_JSON_MEDIA_TYPE: "application/problem+json",
  KEY_CONFIG_PROBLEM_TYPE: "urn:ietf:params:ehbp:error:key-config"
};
var HPKE_CONFIG = {
  KEM: 32,
  // X25519 HKDF SHA256
  KDF: 1,
  // HKDF SHA256
  AEAD: 2
  // AES-256-GCM
};

// node_modules/ehbp/dist/esm/derive.js
var kdf = KDF_HKDF_SHA256();
var aead = AEAD_AES_256_GCM();
var HPKE_REQUEST_INFO = "ehbp request";
var EXPORT_LABEL = "ehbp response";
var EXPORT_LENGTH = 32;
var RESPONSE_NONCE_LENGTH = 32;
var AES256_KEY_LENGTH = 32;
var AES_GCM_NONCE_LENGTH = 12;
var REQUEST_ENC_LENGTH = 32;
var RESPONSE_KEY_LABEL = new TextEncoder().encode("key");
var RESPONSE_NONCE_LABEL = new TextEncoder().encode("nonce");
async function deriveResponseKeys(exportedSecret, requestEnc, responseNonce) {
  if (exportedSecret.length !== EXPORT_LENGTH) {
    throw new Error(`exported secret must be ${EXPORT_LENGTH} bytes, got ${exportedSecret.length}`);
  }
  if (requestEnc.length !== REQUEST_ENC_LENGTH) {
    throw new Error(`request enc must be ${REQUEST_ENC_LENGTH} bytes, got ${requestEnc.length}`);
  }
  if (responseNonce.length !== RESPONSE_NONCE_LENGTH) {
    throw new Error(`response nonce must be ${RESPONSE_NONCE_LENGTH} bytes, got ${responseNonce.length}`);
  }
  const salt = new Uint8Array(requestEnc.length + responseNonce.length);
  salt.set(requestEnc, 0);
  salt.set(responseNonce, requestEnc.length);
  const prk = await kdf.Extract(salt, exportedSecret);
  const keyBytes = await kdf.Expand(prk, RESPONSE_KEY_LABEL, AES256_KEY_LENGTH);
  const nonceBase = await kdf.Expand(prk, RESPONSE_NONCE_LABEL, AES_GCM_NONCE_LENGTH);
  return { keyBytes, nonceBase };
}
function computeNonce(nonceBase, seq) {
  if (nonceBase.length !== AES_GCM_NONCE_LENGTH) {
    throw new Error(`nonce base must be ${AES_GCM_NONCE_LENGTH} bytes`);
  }
  if (!Number.isInteger(seq) || seq < 0 || seq >= 4294967296) {
    throw new Error(`sequence number must be an integer in range [0, 2^32): got ${seq}`);
  }
  const nonce = new Uint8Array(AES_GCM_NONCE_LENGTH);
  nonce.set(nonceBase);
  for (let i = 0; i < 8; i++) {
    const shift = i * 8;
    if (shift < 32) {
      nonce[AES_GCM_NONCE_LENGTH - 1 - i] ^= seq >>> shift & 255;
    }
  }
  return nonce;
}
async function decryptChunk(km, seq, ciphertext) {
  const nonce = computeNonce(km.nonceBase, seq);
  const plaintext = await aead.Open(km.keyBytes, nonce, new Uint8Array(0), ciphertext);
  return plaintext;
}
function hexToBytes3(hex) {
  if (hex.length % 2 !== 0) {
    throw new Error("Hex string must have even length");
  }
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error("Invalid hex character");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
function bytesToHex3(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// node_modules/ehbp/dist/esm/errors.js
var EhbpError = class extends Error {
  constructor(message, options) {
    super(message);
    this.name = "EhbpError";
    if (options?.cause)
      this.cause = options.cause;
  }
};
var KeyConfigMismatchError = class extends EhbpError {
  constructor(title) {
    super(title || "Server key configuration mismatch");
    __publicField(this, "title");
    this.name = "KeyConfigMismatchError";
    this.title = title || "";
  }
};
var ProtocolError = class extends EhbpError {
  constructor(message, options) {
    super(message, options);
    this.name = "ProtocolError";
  }
};
var DecryptionError = class extends EhbpError {
  constructor(message, options) {
    super(message, options);
    this.name = "DecryptionError";
  }
};

// node_modules/ehbp/dist/esm/request-options.js
var FORWARDED_INIT_KEYS = [
  "cache",
  "credentials",
  "integrity",
  "keepalive",
  "mode",
  "redirect",
  "referrer",
  "referrerPolicy",
  "signal"
];
function forwardedRequestInit(source) {
  const forwarded = {};
  if (!source) {
    return forwarded;
  }
  const record = source;
  const target = forwarded;
  for (const key of FORWARDED_INIT_KEYS) {
    const value = record[key];
    if (value !== void 0) {
      target[key] = value;
    }
  }
  if (forwarded.mode === "navigate") {
    delete forwarded.mode;
  }
  return forwarded;
}

// node_modules/ehbp/dist/esm/identity.js
function createSuite() {
  return new CipherSuite(KEM_DHKEM_X25519_HKDF_SHA256, KDF_HKDF_SHA256, AEAD_AES_256_GCM);
}
var Identity = class _Identity {
  constructor(suite, publicKey, privateKey) {
    __publicField(this, "suite");
    __publicField(this, "publicKey");
    __publicField(this, "privateKey");
    this.suite = suite;
    this.publicKey = publicKey;
    this.privateKey = privateKey;
  }
  /**
   * Generate a new identity with X25519 key pair
   */
  static async generate() {
    const suite = createSuite();
    const { publicKey, privateKey } = await suite.GenerateKeyPair(true);
    return new _Identity(suite, publicKey, privateKey);
  }
  /**
   * Create identity from JSON string
   */
  static async fromJSON(json) {
    const data = JSON.parse(json);
    const suite = createSuite();
    const publicKey = await suite.DeserializePublicKey(new Uint8Array(data.publicKey));
    const privateKey = await suite.DeserializePrivateKey(new Uint8Array(data.privateKey), true);
    return new _Identity(suite, publicKey, privateKey);
  }
  /**
   * Convert identity to JSON string
   */
  async toJSON() {
    const publicKeyBytes = await this.suite.SerializePublicKey(this.publicKey);
    const privateKeyBytes = await this.suite.SerializePrivateKey(this.privateKey);
    return JSON.stringify({
      publicKey: Array.from(publicKeyBytes),
      privateKey: Array.from(privateKeyBytes)
    });
  }
  /**
   * Get public key
   */
  getPublicKey() {
    return this.publicKey;
  }
  /**
   * Get public key as hex string
   */
  async getPublicKeyHex() {
    const exported = await this.suite.SerializePublicKey(this.publicKey);
    return bytesToHex3(exported);
  }
  /**
   * Get private key
   */
  getPrivateKey() {
    return this.privateKey;
  }
  /**
   * Marshal public key configuration for server key distribution
   * Implements RFC 9458 format
   */
  async marshalConfig() {
    const kemId = HPKE_CONFIG.KEM;
    const kdfId = HPKE_CONFIG.KDF;
    const aeadId = HPKE_CONFIG.AEAD;
    const publicKeyBytes = await this.suite.SerializePublicKey(this.publicKey);
    const keyId = 0;
    const publicKeySize = publicKeyBytes.length;
    const cipherSuitesSize = 2 + 2;
    const buffer = new Uint8Array(1 + 2 + publicKeySize + 2 + cipherSuitesSize);
    let offset = 0;
    buffer[offset++] = keyId;
    buffer[offset++] = kemId >> 8 & 255;
    buffer[offset++] = kemId & 255;
    buffer.set(publicKeyBytes, offset);
    offset += publicKeySize;
    buffer[offset++] = cipherSuitesSize >> 8 & 255;
    buffer[offset++] = cipherSuitesSize & 255;
    buffer[offset++] = kdfId >> 8 & 255;
    buffer[offset++] = kdfId & 255;
    buffer[offset++] = aeadId >> 8 & 255;
    buffer[offset++] = aeadId & 255;
    return buffer;
  }
  /**
   * Unmarshal public configuration from server
   */
  static async unmarshalPublicConfig(data) {
    let offset = 0;
    const keyId = data[offset++];
    const kemId = data[offset++] << 8 | data[offset++];
    const publicKeySize = 32;
    const publicKeyBytes = data.slice(offset, offset + publicKeySize);
    offset += publicKeySize;
    const cipherSuitesLength = data[offset++] << 8 | data[offset++];
    const suites = [];
    const cipherSuitesEnd = offset + cipherSuitesLength;
    while (offset < cipherSuitesEnd) {
      const kdfId = data[offset++] << 8 | data[offset++];
      const aeadId = data[offset++] << 8 | data[offset++];
      suites.push({ kdfId, aeadId });
    }
    if (suites.length === 0) {
      throw new ProtocolError("No cipher suites found in config");
    }
    const firstSuite = suites[0];
    if (firstSuite.kdfId !== HPKE_CONFIG.KDF || firstSuite.aeadId !== HPKE_CONFIG.AEAD) {
      throw new ProtocolError(`Unsupported cipher suite: KDF=0x${firstSuite.kdfId.toString(16)}, AEAD=0x${firstSuite.aeadId.toString(16)}`);
    }
    return _Identity.fromPublicKeyBytes(publicKeyBytes);
  }
  /**
   * Create an Identity from a raw public key hex string.
   * Uses the default cipher suite (X25519/HKDF-SHA256/AES-256-GCM).
   *
   * This is used by clients who already have the server's public key
   * and don't need to fetch it.
   */
  static async fromPublicKeyHex(publicKeyHex) {
    const publicKeyBytes = hexToBytes3(publicKeyHex);
    if (publicKeyBytes.length !== 32) {
      throw new ProtocolError(`Invalid public key length: expected 32, got ${publicKeyBytes.length}`);
    }
    return _Identity.fromPublicKeyBytes(publicKeyBytes);
  }
  /**
   * Create an Identity from raw public key bytes.
   * Uses the default cipher suite (X25519/HKDF-SHA256/AES-256-GCM).
   *
   * For public-key-only identities (client-side use), we create a placeholder
   * private key that won't be used. TODO: refactor Identity to not require
   * a private key for client-side use.
   */
  static async fromPublicKeyBytes(publicKeyBytes) {
    const suite = createSuite();
    const publicKey = await suite.DeserializePublicKey(publicKeyBytes);
    const placeholderPrivateKey = await suite.DeserializePrivateKey(new Uint8Array(32), false);
    return new _Identity(suite, publicKey, placeholderPrivateKey);
  }
  /**
   * Encrypt request body and return context for response decryption.
   *
   * This method is called on the SERVER's identity (public key only).
   * It:
   * 1. Creates an HPKE sender context to this identity's public key
   * 2. Encrypts the request body
   * 3. Returns a RequestContext that must be used to decrypt the response
   */
  async encryptRequestWithContext(request) {
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) {
      return {
        request: new Request(request.url, {
          ...forwardedRequestInit(request),
          method: request.method,
          headers: request.headers,
          body: null
        }),
        context: null
      };
    }
    const infoBytes = new TextEncoder().encode(HPKE_REQUEST_INFO);
    const { encapsulatedSecret, ctx } = await this.suite.SetupSender(this.publicKey, {
      info: infoBytes
    });
    const context = {
      senderContext: ctx,
      requestEnc: encapsulatedSecret
    };
    const headers = new Headers(request.headers);
    headers.set(PROTOCOL.ENCAPSULATED_KEY_HEADER, bytesToHex3(context.requestEnc));
    const encrypted = await ctx.Seal(new Uint8Array(body));
    const chunkLength = new Uint8Array(4);
    new DataView(chunkLength.buffer).setUint32(0, encrypted.byteLength, false);
    const chunkedData = new Uint8Array(4 + encrypted.byteLength);
    chunkedData.set(chunkLength, 0);
    chunkedData.set(encrypted, 4);
    return {
      request: new Request(request.url, {
        ...forwardedRequestInit(request),
        method: request.method,
        headers,
        body: chunkedData,
        duplex: "half"
      }),
      context
    };
  }
  /**
   * Decrypt response using keys derived from request context.
   *
   * This method:
   * 1. Reads the response nonce from Ehbp-Response-Nonce header
   * 2. Exports a secret from the HPKE sender context
   * 3. Derives response keys using HKDF
   * 4. Decrypts the response body
   */
  async decryptResponseWithContext(response, context) {
    const token = await extractSessionRecoveryToken(context);
    return decryptResponseWithToken(response, token);
  }
};
async function extractSessionRecoveryToken(context) {
  const exportLabelBytes = new TextEncoder().encode(EXPORT_LABEL);
  const exportedSecret = new Uint8Array(await context.senderContext.Export(exportLabelBytes, EXPORT_LENGTH));
  return {
    exportedSecret,
    requestEnc: new Uint8Array(context.requestEnc)
  };
}
async function decryptResponseWithToken(response, token, onStreamError, onStreamComplete) {
  const responseNonceHex = response.headers.get(PROTOCOL.RESPONSE_NONCE_HEADER);
  if (!response.body && !responseNonceHex) {
    return response;
  }
  if (!responseNonceHex) {
    throw new ProtocolError(`Missing ${PROTOCOL.RESPONSE_NONCE_HEADER} header`);
  }
  const responseNonce = hexToBytes3(responseNonceHex);
  if (responseNonce.length !== RESPONSE_NONCE_LENGTH) {
    throw new ProtocolError(`Invalid response nonce length`);
  }
  if (!response.body) {
    onStreamComplete?.();
    return response;
  }
  const km = await deriveResponseKeys(token.exportedSecret, token.requestEnc, responseNonce);
  const decryptedStream = createDecryptStream(response.body, km, onStreamError, onStreamComplete);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  return new Response(decryptedStream, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
var MAX_RESPONSE_CHUNK_BYTES = 64 * 1024 * 1024;
function createDecryptStream(body, km, onStreamError, onStreamComplete) {
  let buffer = new Uint8Array(0);
  let seq = 0;
  const reader = body.getReader();
  let consumerCancelled = false;
  return new ReadableStream({
    async pull(controller) {
      const fail = (error) => {
        try {
          onStreamError?.();
        } catch {
        }
        try {
          controller.error(error);
        } finally {
          reader.cancel(error).catch(() => {
          });
        }
      };
      while (true) {
        if (buffer.length >= 4) {
          const chunkLength = (buffer[0] << 24 | buffer[1] << 16 | buffer[2] << 8 | buffer[3]) >>> 0;
          if (chunkLength === 0) {
            buffer = buffer.slice(4);
            continue;
          }
          if (chunkLength > MAX_RESPONSE_CHUNK_BYTES) {
            fail(new ProtocolError("response chunk exceeds maximum allowed size"));
            return;
          }
          if (buffer.length >= 4 + chunkLength) {
            const ciphertext = buffer.slice(4, 4 + chunkLength);
            buffer = buffer.slice(4 + chunkLength);
            try {
              const plaintext = await decryptChunk(km, seq++, ciphertext);
              controller.enqueue(plaintext);
              return;
            } catch (error) {
              fail(new DecryptionError(`Decryption failed at chunk ${seq - 1}`, { cause: error }));
              return;
            }
          }
        }
        let result;
        try {
          result = await reader.read();
        } catch (error) {
          if (consumerCancelled) {
            return;
          }
          fail(error instanceof Error ? error : new Error("Encrypted response read failed", {
            cause: error
          }));
          return;
        }
        const { done, value } = result;
        if (done) {
          if (consumerCancelled) {
            return;
          }
          if (buffer.length !== 0) {
            fail(new ProtocolError("truncated encrypted response chunk"));
          } else {
            onStreamComplete?.();
            controller.close();
          }
          return;
        }
        const newBuffer = new Uint8Array(buffer.length + value.length);
        newBuffer.set(buffer);
        newBuffer.set(value, buffer.length);
        buffer = newBuffer;
      }
    },
    cancel(reason) {
      consumerCancelled = true;
      return reader.cancel(reason);
    }
  });
}

// node_modules/ehbp/dist/esm/client.js
var MAX_PROBLEM_DETAILS_BYTES = 64 * 1024;
var Transport = class _Transport {
  constructor(serverIdentity, serverHost) {
    __publicField(this, "serverIdentity");
    __publicField(this, "serverHost");
    __publicField(this, "_lastSessionRecoveryToken");
    __publicField(this, "requestGeneration", 0);
    this.serverIdentity = serverIdentity;
    this.serverHost = serverHost;
  }
  getSessionRecoveryToken() {
    if (!this._lastSessionRecoveryToken) {
      throw new Error("No session recovery token available — no request has been made yet");
    }
    return this._lastSessionRecoveryToken;
  }
  /**
   * Create a new transport by fetching server public key.
   * The optional init is applied to the key fetch (e.g. credentials).
   */
  static async create(serverURL, init) {
    const url = new URL(serverURL);
    const serverHost = url.host;
    const keysURL = new URL(PROTOCOL.KEYS_PATH, serverURL);
    const response = await fetch(keysURL.toString(), init);
    if (!response.ok) {
      throw new Error(`Failed to get server public key: ${response.status}`);
    }
    const contentType = response.headers.get("content-type");
    if (contentType !== PROTOCOL.KEYS_MEDIA_TYPE) {
      throw new Error(`Invalid content type: ${contentType}`);
    }
    const keysData = new Uint8Array(await response.arrayBuffer());
    const serverIdentity = await Identity.unmarshalPublicConfig(keysData);
    return new _Transport(serverIdentity, serverHost);
  }
  static isProblemJSONContentType(contentType) {
    if (!contentType) {
      return false;
    }
    const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    return mediaType === PROTOCOL.PROBLEM_JSON_MEDIA_TYPE;
  }
  static async checkKeyConfigMismatch(response) {
    if (response.status !== 422)
      return;
    if (!_Transport.isProblemJSONContentType(response.headers.get("content-type")))
      return;
    let problem;
    try {
      const clone = response.clone();
      if (!clone.body)
        return;
      const reader = clone.body.getReader();
      const chunks = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done)
          break;
        length += value.byteLength;
        if (length > MAX_PROBLEM_DETAILS_BYTES) {
          reader.cancel().catch(() => {
          });
          return;
        }
        chunks.push(value);
      }
      const body = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      problem = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return;
    }
    if (problem?.type === PROTOCOL.KEY_CONFIG_PROBLEM_TYPE) {
      throw new KeyConfigMismatchError(typeof problem.title === "string" ? problem.title : void 0);
    }
  }
  static async shouldDecryptResponse(response) {
    if (response.headers.has(PROTOCOL.RESPONSE_NONCE_HEADER)) {
      return true;
    }
    await _Transport.checkKeyConfigMismatch(response);
    if (!response.ok) {
      return false;
    }
    throw new ProtocolError(`Missing ${PROTOCOL.RESPONSE_NONCE_HEADER} header`);
  }
  /**
   * Get the server identity
   */
  getServerIdentity() {
    return this.serverIdentity;
  }
  /**
   * Get the server public key
   */
  getServerPublicKey() {
    return this.serverIdentity.getPublicKey();
  }
  /**
   * Get the server public key as hex string
   */
  async getServerPublicKeyHex() {
    return this.serverIdentity.getPublicKeyHex();
  }
  /**
   * Make an encrypted HTTP request.
   */
  async request(input, init) {
    const generation = ++this.requestGeneration;
    this._lastSessionRecoveryToken = void 0;
    const inputUrl = input instanceof Request ? input.url : String(input);
    if (inputUrl.startsWith("data:") || inputUrl.startsWith("blob:")) {
      return fetch(input, init);
    }
    const normalizedRequest = new Request(input, init);
    const requestBodyBytes = await normalizedRequest.arrayBuffer();
    const requestBody = requestBodyBytes.byteLength > 0 ? requestBodyBytes : null;
    const url = new URL(normalizedRequest.url);
    url.host = this.serverHost;
    const request = new Request(url.toString(), {
      ...forwardedRequestInit(normalizedRequest),
      method: normalizedRequest.method,
      headers: normalizedRequest.headers,
      body: requestBody,
      duplex: "half"
    });
    const { request: encryptedRequest, context } = await this.serverIdentity.encryptRequestWithContext(request);
    const token = context ? await extractSessionRecoveryToken(context) : void 0;
    const response = await fetch(encryptedRequest);
    if (!token) {
      return response;
    }
    const shouldDecrypt = await _Transport.shouldDecryptResponse(response);
    if (!shouldDecrypt) {
      return response;
    }
    let streamTerminated = false;
    const clearToken = () => {
      streamTerminated = true;
      if (this.requestGeneration === generation) {
        this._lastSessionRecoveryToken = void 0;
      }
    };
    const decryptedResponse = await decryptResponseWithToken(response, token, clearToken, clearToken);
    if (this.requestGeneration === generation) {
      this._lastSessionRecoveryToken = streamTerminated ? void 0 : token;
    }
    return decryptedResponse;
  }
  /**
   * Convenience method for GET requests
   */
  async get(url, init) {
    return this.request(url, { ...init, method: "GET" });
  }
  /**
   * Convenience method for POST requests
   */
  async post(url, body, init) {
    return this.request(url, { ...init, method: "POST", body });
  }
  /**
   * Convenience method for PUT requests
   */
  async put(url, body, init) {
    return this.request(url, { ...init, method: "PUT", body });
  }
  /**
   * Convenience method for DELETE requests
   */
  async delete(url, init) {
    return this.request(url, { ...init, method: "DELETE" });
  }
};

// node_modules/tinfoil/dist/secure-client.js
init_dist3();
init_verifier();

// node_modules/tinfoil/dist/config.js
var TINFOIL_CONFIG = {
  /**
   * Base URL for the attestation endpoint
   */
  ATC_BASE_URL: "https://atc.tinfoil.sh",
  /**
   * The GitHub repository for the router code attestation
   */
  DEFAULT_ROUTER_REPO: "tinfoilsh/confidential-model-router"
};

// node_modules/tinfoil/dist/env.js
function isBun() {
  return typeof process !== "undefined" && !!process.versions && !!process.versions.bun;
}
function isRealBrowser() {
  if (typeof process !== "undefined" && process.versions && process.versions.node) {
    return false;
  }
  if (isBun()) {
    return false;
  }
  if (typeof globalThis.Deno !== "undefined") {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers") {
    return false;
  }
  if (typeof caches !== "undefined" && caches.default !== void 0) {
    return false;
  }
  if (typeof window !== "undefined" && typeof window.document !== "undefined") {
    if (typeof navigator !== "undefined" && navigator.userAgent) {
      return true;
    }
  }
  return false;
}

// node_modules/tinfoil/dist/secure-fetch.js
init_verifier();

// node_modules/tinfoil/dist/encrypted-body-fetch.js
init_verifier();

// node_modules/tinfoil/dist/user-cache-secret.js
var USER_CACHE_SECRET_FIELD = "user_cache_secret";
var USER_CACHE_SECRET_ENV = "TINFOIL_USER_CACHE_SECRET";
var USER_CACHE_SECRET_PATHS = [
  "/chat/completions",
  "/completions",
  "/responses"
];
async function resolveUserCacheSecret(explicit) {
  if (explicit !== void 0 && explicit !== "") {
    return explicit;
  }
  const env = typeof process !== "undefined" ? process.env?.[USER_CACHE_SECRET_ENV] : void 0;
  if (env !== void 0 && env !== "") {
    return env;
  }
  return loadOrGenerateUserCacheSecret();
}
function newUserCacheSecret() {
  try {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    console.warn("[tinfoil] could not generate a user cache secret; automatic prompt-cache scoping is unavailable");
    return "";
  }
}
var ephemeralUserCacheSecret;
function getEphemeralUserCacheSecret() {
  if (ephemeralUserCacheSecret === void 0) {
    ephemeralUserCacheSecret = newUserCacheSecret();
    if (ephemeralUserCacheSecret !== "" && !isRealBrowser()) {
      console.warn(`[tinfoil] could not persist the user cache secret; using an in-memory secret, so prompt-cache continuity resets when this process exits (set ${USER_CACHE_SECRET_ENV} or the userCacheSecret option to pin one)`);
    }
  }
  return ephemeralUserCacheSecret;
}
async function loadOrGenerateUserCacheSecret() {
  if (!isRealBrowser()) {
    try {
      const { loadOrPersistUserCacheSecret: loadOrPersistUserCacheSecret2 } = await Promise.resolve().then(() => (init_user_cache_secret_store_browser(), user_cache_secret_store_browser_exports));
      const secret = loadOrPersistUserCacheSecret2(newUserCacheSecret);
      if (secret !== null) {
        return secret;
      }
    } catch {
    }
  }
  return getEphemeralUserCacheSecret();
}
function injectUserCacheSecret(raw, secret) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(parsed, USER_CACHE_SECRET_FIELD)) {
    const existing = parsed[USER_CACHE_SECRET_FIELD];
    if (existing !== "") {
      return null;
    }
    const range = topLevelValueRange(raw, USER_CACHE_SECRET_FIELD);
    if (range === null) {
      return null;
    }
    return raw.slice(0, range[0]) + JSON.stringify(secret) + raw.slice(range[1]);
  }
  const end = raw.lastIndexOf("}");
  const field = `${JSON.stringify(USER_CACHE_SECRET_FIELD)}:${JSON.stringify(secret)}`;
  const separator = Object.keys(parsed).length > 0 ? "," : "";
  return raw.slice(0, end) + separator + field + raw.slice(end);
}
function topLevelValueRange(raw, field) {
  let index = skipWhitespace(raw, 0);
  let matchingRange = null;
  if (raw[index] !== "{") {
    return null;
  }
  index += 1;
  while (index < raw.length) {
    index = skipWhitespace(raw, index);
    if (raw[index] === "}") {
      return null;
    }
    const keyEnd = stringEnd(raw, index);
    if (keyEnd === null) {
      return null;
    }
    let key;
    try {
      key = JSON.parse(raw.slice(index, keyEnd));
    } catch {
      return null;
    }
    index = skipWhitespace(raw, keyEnd);
    if (raw[index] !== ":") {
      return null;
    }
    const valueStart = skipWhitespace(raw, index + 1);
    const valueEnd = jsonValueEnd(raw, valueStart);
    if (valueEnd === null) {
      return null;
    }
    if (key === field) {
      matchingRange = [valueStart, valueEnd];
    }
    index = skipWhitespace(raw, valueEnd);
    if (raw[index] === ",") {
      index += 1;
    } else if (raw[index] === "}") {
      return matchingRange;
    } else {
      return null;
    }
  }
  return null;
}
function skipWhitespace(raw, start) {
  let index = start;
  while (index < raw.length && /\s/.test(raw[index])) {
    index += 1;
  }
  return index;
}
function stringEnd(raw, start) {
  if (raw[start] !== '"') {
    return null;
  }
  let escaped = false;
  for (let index = start + 1; index < raw.length; index += 1) {
    if (escaped) {
      escaped = false;
    } else if (raw[index] === "\\") {
      escaped = true;
    } else if (raw[index] === '"') {
      return index + 1;
    }
  }
  return null;
}
function jsonValueEnd(raw, start) {
  if (raw[start] === '"') {
    return stringEnd(raw, start);
  }
  if (raw[start] === "{" || raw[start] === "[") {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < raw.length; index += 1) {
      const character = raw[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
      } else if (character === '"') {
        inString = true;
      } else if (character === "{" || character === "[") {
        depth += 1;
      } else if (character === "}" || character === "]") {
        depth -= 1;
        if (depth === 0) {
          return index + 1;
        }
      }
    }
    return null;
  }
  let end = start;
  while (end < raw.length && raw[end] !== "," && raw[end] !== "}") {
    end += 1;
  }
  while (end > start && /\s/.test(raw[end - 1])) {
    end -= 1;
  }
  return end > start ? end : null;
}
function bodyText(body) {
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      return null;
    }
  }
  return null;
}
function headersWithUpdatedBodyMetadata(headers, body) {
  if (headers === void 0) {
    return headers;
  }
  const updated = new Headers(headers);
  if (updated.has("content-length")) {
    updated.set("content-length", String(new TextEncoder().encode(body).byteLength));
    return updated;
  }
  return headers;
}
async function injectUserCacheSecretIntoRequestInit(init, pathname, secret) {
  if (secret === "" || init === void 0) {
    return init;
  }
  if ((init.method ?? "GET").toUpperCase() !== "POST") {
    return init;
  }
  if (!USER_CACHE_SECRET_PATHS.some((path) => pathname.endsWith(path))) {
    return init;
  }
  const raw = bodyText(init.body);
  if (raw === null || raw === "") {
    return init;
  }
  const injected = injectUserCacheSecret(raw, secret);
  if (injected === null) {
    return init;
  }
  return {
    ...init,
    body: injected,
    headers: headersWithUpdatedBodyMetadata(init.headers, injected)
  };
}
function withUserCacheSecret(inner, baseURL, secret) {
  if (secret === "") {
    return inner;
  }
  return (async (input, init) => {
    let pathname;
    try {
      pathname = requestPathname(input, baseURL);
    } catch {
      return inner(input, init);
    }
    const normalized = input instanceof Request && init?.body !== void 0 ? {
      ...init,
      method: init.method ?? input.method,
      headers: init.headers ?? input.headers
    } : init;
    let requestInit = normalized;
    if (input instanceof Request && init?.body === void 0 && input.body !== null && (init?.method ?? input.method).toUpperCase() === "POST" && USER_CACHE_SECRET_PATHS.some((path) => pathname.endsWith(path))) {
      try {
        requestInit = {
          ...init,
          method: init?.method ?? input.method,
          headers: init?.headers ?? input.headers,
          body: await input.clone().arrayBuffer()
        };
      } catch {
        return inner(input, init);
      }
    }
    const injected = await injectUserCacheSecretIntoRequestInit(requestInit, pathname, secret);
    return inner(input, injected);
  });
}
function requestPathname(input, baseURL) {
  if (typeof input === "string") {
    return new URL(input, baseURL).pathname;
  }
  if (input instanceof URL) {
    return input.pathname;
  }
  return new URL(input.url, baseURL).pathname;
}

// node_modules/tinfoil/dist/encrypted-body-fetch.js
async function createIdentityFromPublicKeyHex(publicKeyHex) {
  return Identity.fromPublicKeyHex(publicKeyHex);
}
function normalizeEncryptedBodyRequestArgs(input, init) {
  if (typeof input === "string") {
    return { url: input, init };
  }
  if (input instanceof URL) {
    return { url: input.toString(), init };
  }
  const request = new Request(input, init);
  return {
    url: request.url,
    init: requestInitFromRequest(request)
  };
}
function requestInitFromRequest(request, body = request.body) {
  const requestWithExtensions = request;
  const derivedInit = {
    method: request.method,
    headers: new Headers(request.headers),
    body: body ?? void 0,
    cache: request.cache,
    credentials: request.credentials,
    integrity: request.integrity,
    keepalive: request.keepalive,
    mode: request.mode,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    signal: request.signal
  };
  if (requestWithExtensions.duplex !== void 0) {
    derivedInit.duplex = requestWithExtensions.duplex;
  }
  if (requestWithExtensions.priority !== void 0) {
    derivedInit.priority = requestWithExtensions.priority;
  }
  return derivedInit;
}
var ENCLAVE_URL_HEADER = "X-Tinfoil-Enclave-Url";
function createEncryptedBodyFetch(baseURL, hpkePublicKey, enclaveURL, userCacheSecret = "") {
  const base = new URL(baseURL);
  const baseOrigin = base.origin;
  const needsEnclaveHeader = !!enclaveURL && new URL(enclaveURL).origin !== baseOrigin;
  const allowedOrigins = /* @__PURE__ */ new Set([baseOrigin]);
  if (enclaveURL) {
    allowedOrigins.add(new URL(enclaveURL).origin);
  }
  let transportPromise = null;
  const getOrCreateTransport = () => {
    if (!transportPromise) {
      transportPromise = getTransportForOrigin(baseOrigin, hpkePublicKey);
    }
    return transportPromise;
  };
  return {
    fetch: async (input, init) => {
      const normalized = normalizeEncryptedBodyRequestArgs(input, init);
      const targetUrl = new URL(normalized.url, baseURL);
      if (!allowedOrigins.has(targetUrl.origin)) {
        throw new ConfigurationError(`refusing to send request to ${targetUrl.origin}: this client is bound to the verified enclave/proxy`);
      }
      const headers = new Headers(normalized.init?.headers);
      if (needsEnclaveHeader) {
        headers.set(ENCLAVE_URL_HEADER, enclaveURL);
      }
      const initWithHeader = await injectUserCacheSecretIntoRequestInit({ ...normalized.init, headers }, targetUrl.pathname, userCacheSecret);
      const transportInstance = await getOrCreateTransport();
      return transportInstance.request(targetUrl.toString(), initWithHeader);
    },
    async getSessionRecoveryToken() {
      if (!transportPromise) {
        throw new Error("No session recovery token available — no request has been made yet");
      }
      const transport = await transportPromise;
      return transport.getSessionRecoveryToken();
    }
  };
}
async function getTransportForOrigin(origin, hpkePublicKeyHex) {
  const serverIdentity = await createIdentityFromPublicKeyHex(hpkePublicKeyHex);
  const requestHost = new URL(origin).host;
  return new Transport(serverIdentity, requestHost);
}

// node_modules/tinfoil/dist/secure-fetch.js
async function createSecureFetch(baseURL, hpkePublicKey, tlsPublicKeyFingerprint, enclaveURL, userCacheSecret = "") {
  if (hpkePublicKey) {
    return createEncryptedBodyFetch(baseURL, hpkePublicKey, enclaveURL, userCacheSecret);
  }
  if (isRealBrowser()) {
    throw new ConfigurationError("HPKE public key not available and TLS-only verification is not supported in browsers. Only HPKE-enabled enclaves can be used in browser environments.");
  }
  if (!tlsPublicKeyFingerprint) {
    throw new ConfigurationError("Neither HPKE public key nor TLS public key fingerprint available for verification");
  }
  const { createPinnedTlsFetch: createPinnedTlsFetch2 } = await Promise.resolve().then(() => (init_pinned_tls_fetch_browser(), pinned_tls_fetch_browser_exports));
  const pinnedFetch = await createPinnedTlsFetch2(baseURL, tlsPublicKeyFingerprint);
  return {
    // The cache-secret layer wraps the pinned fetch, so the field it injects
    // only ever travels over the connection pinned to the attested key.
    fetch: withUserCacheSecret(pinnedFetch, baseURL, userCacheSecret),
    async getSessionRecoveryToken() {
      throw new Error("Session recovery tokens are only available in EHBP transport mode");
    }
  };
}

// node_modules/tinfoil/dist/atc.js
init_verifier();
async function fetchAttestationBundle(options = {}) {
  const baseUrl = options.atcBaseUrl ?? TINFOIL_CONFIG.ATC_BASE_URL;
  if (!baseUrl.startsWith("https://")) {
    throw new ConfigurationError(`attestation bundle URL must use HTTPS. Got: ${baseUrl}`);
  }
  const url = `${baseUrl}/attestation`;
  const usePost = !!(options.enclaveURL || options.configRepo);
  const response = usePost ? await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enclaveUrl: options.enclaveURL,
      repo: options.configRepo
    })
  }) : await fetch(url);
  if (!response.ok) {
    throw new FetchError(`Failed to fetch attestation bundle from ${baseUrl}: HTTP ${response.status} ${response.statusText}`);
  }
  const bundle = await response.json();
  return {
    domain: bundle.domain,
    enclaveAttestationReport: {
      format: bundle.enclaveAttestationReport.format,
      body: bundle.enclaveAttestationReport.body
    },
    digest: bundle.digest,
    releaseTag: bundle.releaseTag,
    sigstoreBundle: bundle.sigstoreBundle,
    vcek: bundle.vcek,
    enclaveCert: bundle.enclaveCert
  };
}

// node_modules/tinfoil/dist/secure-client.js
var INIT_RETRY_DELAY_MS = 1e3;
function createPendingVerificationDocument(configRepo) {
  return {
    schemaVersion: VERIFICATION_DOCUMENT_SCHEMA_VERSION,
    configRepo,
    enclaveHost: "",
    releaseDigest: "",
    codeMeasurement: { type: "", registers: [] },
    enclaveMeasurement: { measurement: { type: "", registers: [] } },
    tlsPublicKey: "",
    hpkePublicKey: "",
    codeFingerprint: "",
    enclaveFingerprint: "",
    selectedRouterEndpoint: "",
    securityVerified: false,
    verifier: {
      name: VERIFIER_NAME,
      version: VERIFIER_VERSION
    },
    steps: {
      fetchDigest: { status: "pending" },
      verifyCode: { status: "pending" },
      verifyEnclave: { status: "pending" },
      compareMeasurements: { status: "pending" }
    }
  };
}
var SecureClient = class {
  constructor(options = {}) {
    this.initPromise = null;
    this._transport = null;
    if (options.baseURL !== void 0) {
      let baseURL;
      try {
        baseURL = new URL(options.baseURL);
      } catch (cause) {
        throw new ConfigurationError(`baseURL must be a valid HTTP(S) URL. Got: ${options.baseURL}`, {
          cause
        });
      }
      if (baseURL.protocol !== "http:" && baseURL.protocol !== "https:") {
        throw new ConfigurationError(`baseURL must be a valid HTTP(S) URL. Got: ${options.baseURL}`);
      }
    }
    if (options.enclaveURL !== void 0 && !options.enclaveURL.startsWith("https://")) {
      throw new ConfigurationError(`enclaveURL must use HTTPS. Got: ${options.enclaveURL}`);
    }
    if (options.attestationBundleURL !== void 0 && !options.attestationBundleURL.startsWith("https://")) {
      throw new ConfigurationError(`attestationBundleURL must use HTTPS. Got: ${options.attestationBundleURL}`);
    }
    if (options.configRepo && !options.enclaveURL) {
      throw new ConfigurationError("configRepo requires enclaveURL — without it, ATC always uses the default router repo.");
    } else if (options.enclaveURL && !options.configRepo) {
      console.warn(`[tinfoil] No configRepo specified, verifying against "${TINFOIL_CONFIG.DEFAULT_ROUTER_REPO}".`);
    }
    this.config = {
      baseURL: options.baseURL,
      enclaveURL: options.enclaveURL,
      configRepo: options.configRepo ?? TINFOIL_CONFIG.DEFAULT_ROUTER_REPO,
      transport: options.transport || "ehbp",
      attestationBundleURL: options.attestationBundleURL,
      userCacheSecret: options.userCacheSecret
    };
    this.verificationDocument = createPendingVerificationDocument(this.config.configRepo);
  }
  /**
   * Wait for the client to complete verification and be ready for requests.
   *
   * This performs enclave attestation, code verification, and establishes
   * the secure transport. Must be called before using `fetch`.
   *
   * @throws Error if verification fails
   */
  async ready() {
    if (!this.initPromise) {
      this.initPromise = this.initSecureClient().catch(async (err) => {
        if (err instanceof FetchError || err instanceof AttestationError) {
          this.clearDerivedState();
          await new Promise((r) => setTimeout(r, INIT_RETRY_DELAY_MS));
          return this.initSecureClient().catch((retryErr) => {
            this.reset();
            throw retryErr;
          });
        }
        this.reset();
        throw err;
      });
    }
    return this.initPromise;
  }
  /**
   * Clear derived state without touching initPromise (preserves deduplication).
   */
  clearDerivedState() {
    this._transport = null;
    this.verificationDocument = createPendingVerificationDocument(this.config.configRepo);
    this.resolvedEnclaveURL = void 0;
    this.resolvedBaseURL = void 0;
    this.attestedTlsPublicKeyFingerprint = void 0;
  }
  /**
   * Reset the client, clearing all verification state and transport.
   *
   * After calling reset(), the next call to `ready()` or `fetch()` will
   * perform a fresh attestation and establish a new secure transport.
   *
   * Use this for retry logic when the enclave may have restarted with new keys,
   * or when you want to force re-verification.
   *
   * @example
   * ```typescript
   * // Force re-attestation
   * client.reset();
   * await client.ready();
   *
   * // Or let it re-attest lazily on next request
   * client.reset();
   * await client.fetch("/v1/chat/completions", { ... });
   * ```
   */
  reset() {
    this.initPromise = null;
    this.clearDerivedState();
  }
  async initSecureClient() {
    const bundle = await fetchAttestationBundle({
      atcBaseUrl: this.config.attestationBundleURL,
      enclaveURL: this.config.enclaveURL,
      configRepo: this.config.configRepo !== TINFOIL_CONFIG.DEFAULT_ROUTER_REPO ? this.config.configRepo : void 0
    });
    this.resolvedEnclaveURL = this.config.enclaveURL ?? `https://${bundle.domain}`;
    this.resolvedBaseURL = this.config.baseURL ?? this.getEnclaveBaseURL();
    if (this.config.transport === "tls" && this.config.baseURL && new URL(this.resolvedBaseURL).origin !== new URL(this.resolvedEnclaveURL).origin) {
      throw new ConfigurationError("TLS transport requires baseURL to use the verified enclave origin");
    }
    const verifier = new Verifier({
      configRepo: this.config.configRepo
    });
    try {
      const attestation = await verifier.verifyBundle(bundle);
      this.attestedTlsPublicKeyFingerprint = attestation.tlsPublicKeyFingerprint;
      this._transport = await this.createTransport(attestation.hpkePublicKey, attestation.tlsPublicKeyFingerprint);
    } finally {
      this.verificationDocument = verifier.getVerificationDocument() ?? this.verificationDocument;
    }
  }
  /**
   * Get the verification document containing attestation details.
   *
   * @returns The verification document with attestation results
   * @see https://docs.tinfoil.sh/verification/attestation-architecture
   */
  getVerificationDocument() {
    return cloneVerificationDocument(this.verificationDocument);
  }
  /**
   * Get the base URL for API requests.
   *
   * Returns the base URL requests will be sent to.
   */
  getBaseURL() {
    return this.resolvedBaseURL;
  }
  /**
   * Get the URL of the enclave endpoint, or undefined before ready().
   */
  getEnclaveURL() {
    return this.resolvedEnclaveURL;
  }
  /**
   * Get the direct API base URL of the enclave, or undefined before ready().
   */
  getEnclaveBaseURL() {
    return this.resolvedEnclaveURL ? `${this.resolvedEnclaveURL}/v1/` : void 0;
  }
  async createTransport(hpkePublicKey, tlsPublicKeyFingerprint) {
    const userCacheSecret = await resolveUserCacheSecret(this.config.userCacheSecret);
    if (this.config.transport === "tls") {
      return await createSecureFetch(this.resolvedBaseURL, void 0, tlsPublicKeyFingerprint, this.resolvedEnclaveURL, userCacheSecret);
    }
    return await createSecureFetch(this.resolvedBaseURL, hpkePublicKey, void 0, this.resolvedEnclaveURL, userCacheSecret);
  }
  /**
   * Secure fetch function that encrypts request bodies end-to-end.
   *
   * Use this as a drop-in replacement for global `fetch`. Request bodies are
   * encrypted using HPKE (or TLS pinning if configured) so only the verified
   * enclave can decrypt them.
   *
   * On `KeyConfigMismatchError` (server key rotation), automatically re-attests
   * and retries the request once. All other errors propagate to the caller.
   *
   * @example
   * ```typescript
   * const response = await client.fetch("/v1/chat/completions", {
   *   method: "POST",
   *   headers: { "Content-Type": "application/json" },
   *   body: JSON.stringify({ model: "llama3-3-70b", messages: [...] }),
   * });
   * ```
   */
  get fetch() {
    return async (input, init) => {
      await this.ready();
      try {
        return await this._transport.fetch(input, init);
      } catch (error) {
        if (error instanceof KeyConfigMismatchError) {
          this.reset();
          await this.ready();
          return await this._transport.fetch(input, init);
        }
        throw error;
      }
    };
  }
  /**
   * Returns the session recovery token for the most recent request.
   *
   * The token is overwritten on every request, so it must be captured
   * immediately after the relevant `fetch()` resolves and before issuing
   * another request on this client.
   */
  async getSessionRecoveryToken() {
    if (!this._transport) {
      throw new Error("No session recovery token available — call fetch() first");
    }
    return this._transport.getSessionRecoveryToken();
  }
  /**
   * Verifies the WebSocket preconditions and returns the attested TLS
   * public key fingerprint to pin against.
   *
   * WebSockets can't be covered by EHBP (it only seals HTTP bodies), so they
   * are secured by connecting directly to the enclave with the TLS connection
   * pinned to the attested key. That rules out browsers, which do not expose
   * TLS certificate details.
   */
  async requireWebSocketCapability() {
    if (isRealBrowser()) {
      throw new ConfigurationError("Verified WebSockets are not supported in browser environments: browsers do not expose TLS certificate details, so the connection cannot be pinned to the attested enclave key.");
    }
    await this.ready();
    if (!this.attestedTlsPublicKeyFingerprint) {
      throw new AttestationError("Attestation did not include a TLS public key fingerprint");
    }
    return this.attestedTlsPublicKeyFingerprint;
  }
  /**
   * Returns `ws` client options that pin the TLS connection to the attested
   * enclave key, for wiring verified WebSockets into other libraries.
   *
   * Node.js only. Standard certificate chain and hostname validation still
   * apply on top of the pin.
   */
  async getPinnedWebSocketOptions() {
    const fingerprint = await this.requireWebSocketCapability();
    const { pinnedWsClientOptions: pinnedWsClientOptions2 } = await Promise.resolve().then(() => (init_pinned_ws_browser(), pinned_ws_browser_exports));
    return pinnedWsClientOptions2(fingerprint);
  }
  /**
   * Opens a WebSocket to the verified enclave with the TLS connection pinned
   * to the attested enclave key.
   *
   * Node.js only. Connections are made directly to the verified enclave.
   *
   * The returned socket is a standard `ws` WebSocket in the CONNECTING state;
   * pinning failures surface as an `error` event. A pin failure drops the cached
   * attestation, so the next createWebSocket() re-attests and recovers.
   *
   * @param path - Path (and query) relative to the enclave URL, e.g.
   *   `/v1/realtime?model=voxtral-mini-4b-realtime`
   *
   * @example
   * ```typescript
   * const socket = await client.createWebSocket(
   *   "/v1/realtime?model=voxtral-mini-4b-realtime",
   *   { wsOptions: { headers: { Authorization: `Bearer ${apiKey}` } } },
   * );
   * socket.on("open", () => { ... });
   * ```
   */
  async createWebSocket(path, options) {
    const fingerprint = await this.requireWebSocketCapability();
    const enclaveHost = new URL(this.resolvedEnclaveURL).host;
    const target = new URL(path, this.resolvedEnclaveURL);
    if (target.protocol === "https:") {
      target.protocol = "wss:";
    }
    if (target.protocol !== "wss:") {
      throw new ConfigurationError(`Insecure connection rejected: only wss:// is allowed. Got ${target.toString()}`);
    }
    if (target.host !== enclaveHost) {
      throw new ConfigurationError(`refusing WebSocket connection to ${target.host}: this client is bound to the verified enclave ${enclaveHost}`);
    }
    const { createPinnedWebSocket: createPinnedWebSocket2 } = await Promise.resolve().then(() => (init_pinned_ws_browser(), pinned_ws_browser_exports));
    const socket = await createPinnedWebSocket2(target.toString(), fingerprint, options);
    socket.once("error", (err) => {
      if (err instanceof AttestationError) {
        this.reset();
      }
    });
    return socket;
  }
};

// entries/buddy-tinfoil.mjs
init_verifier();
export {
  AttestationError,
  ConfigurationError,
  DecryptionError,
  EhbpError,
  FetchError,
  KeyConfigMismatchError,
  ProtocolError,
  SecureClient,
  TinfoilError,
  Verifier
};
/*! Bundled license information:

@noble/hashes/esm/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/utils.js:
@noble/curves/esm/abstract/modular.js:
@noble/curves/esm/abstract/curve.js:
@noble/curves/esm/abstract/weierstrass.js:
@noble/curves/esm/_shortw_utils.js:
@noble/curves/esm/nist.js:
@noble/curves/esm/abstract/edwards.js:
@noble/curves/esm/ed25519.js:
@noble/curves/utils.js:
@noble/curves/abstract/modular.js:
@noble/curves/abstract/curve.js:
@noble/curves/abstract/edwards.js:
@noble/curves/abstract/montgomery.js:
@noble/curves/ed25519.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/ciphers/utils.js:
  (*! noble-ciphers - MIT License (c) 2023 Paul Miller (paulmillr.com) *)
*/
