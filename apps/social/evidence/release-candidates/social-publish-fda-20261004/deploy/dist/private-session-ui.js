var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod3) => function __require() {
  try {
    return mod3 || (0, cb[__getOwnPropNames(cb)[0]])((mod3 = { exports: {} }).exports, mod3), mod3.exports;
  } catch (e) {
    throw mod3 = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod3, isNodeMode, target) => (target = mod3 != null ? __create(__getProtoOf(mod3)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod3 || !mod3.__esModule ? __defProp(target, "default", { value: mod3, enumerable: true }) : target,
  mod3
));

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/can-promise.js
var require_can_promise = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/can-promise.js"(exports, module) {
    module.exports = function() {
      return typeof Promise === "function" && Promise.prototype && Promise.prototype.then;
    };
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/utils.js
var require_utils = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/utils.js"(exports) {
    var toSJISFunction;
    var CODEWORDS_COUNT = [
      0,
      // Not used
      26,
      44,
      70,
      100,
      134,
      172,
      196,
      242,
      292,
      346,
      404,
      466,
      532,
      581,
      655,
      733,
      815,
      901,
      991,
      1085,
      1156,
      1258,
      1364,
      1474,
      1588,
      1706,
      1828,
      1921,
      2051,
      2185,
      2323,
      2465,
      2611,
      2761,
      2876,
      3034,
      3196,
      3362,
      3532,
      3706
    ];
    exports.getSymbolSize = function getSymbolSize(version) {
      if (!version) throw new Error('"version" cannot be null or undefined');
      if (version < 1 || version > 40) throw new Error('"version" should be in range from 1 to 40');
      return version * 4 + 17;
    };
    exports.getSymbolTotalCodewords = function getSymbolTotalCodewords(version) {
      return CODEWORDS_COUNT[version];
    };
    exports.getBCHDigit = function(data) {
      let digit = 0;
      while (data !== 0) {
        digit++;
        data >>>= 1;
      }
      return digit;
    };
    exports.setToSJISFunction = function setToSJISFunction(f) {
      if (typeof f !== "function") {
        throw new Error('"toSJISFunc" is not a valid function.');
      }
      toSJISFunction = f;
    };
    exports.isKanjiModeEnabled = function() {
      return typeof toSJISFunction !== "undefined";
    };
    exports.toSJIS = function toSJIS(kanji) {
      return toSJISFunction(kanji);
    };
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/error-correction-level.js
var require_error_correction_level = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/error-correction-level.js"(exports) {
    exports.L = { bit: 1 };
    exports.M = { bit: 0 };
    exports.Q = { bit: 3 };
    exports.H = { bit: 2 };
    function fromString(string) {
      if (typeof string !== "string") {
        throw new Error("Param is not a string");
      }
      const lcStr = string.toLowerCase();
      switch (lcStr) {
        case "l":
        case "low":
          return exports.L;
        case "m":
        case "medium":
          return exports.M;
        case "q":
        case "quartile":
          return exports.Q;
        case "h":
        case "high":
          return exports.H;
        default:
          throw new Error("Unknown EC Level: " + string);
      }
    }
    exports.isValid = function isValid(level) {
      return level && typeof level.bit !== "undefined" && level.bit >= 0 && level.bit < 4;
    };
    exports.from = function from(value, defaultValue) {
      if (exports.isValid(value)) {
        return value;
      }
      try {
        return fromString(value);
      } catch (e) {
        return defaultValue;
      }
    };
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/bit-buffer.js
var require_bit_buffer = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/bit-buffer.js"(exports, module) {
    function BitBuffer() {
      this.buffer = [];
      this.length = 0;
    }
    BitBuffer.prototype = {
      get: function(index) {
        const bufIndex = Math.floor(index / 8);
        return (this.buffer[bufIndex] >>> 7 - index % 8 & 1) === 1;
      },
      put: function(num, length) {
        for (let i = 0; i < length; i++) {
          this.putBit((num >>> length - i - 1 & 1) === 1);
        }
      },
      getLengthInBits: function() {
        return this.length;
      },
      putBit: function(bit) {
        const bufIndex = Math.floor(this.length / 8);
        if (this.buffer.length <= bufIndex) {
          this.buffer.push(0);
        }
        if (bit) {
          this.buffer[bufIndex] |= 128 >>> this.length % 8;
        }
        this.length++;
      }
    };
    module.exports = BitBuffer;
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/bit-matrix.js
var require_bit_matrix = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/bit-matrix.js"(exports, module) {
    function BitMatrix(size) {
      if (!size || size < 1) {
        throw new Error("BitMatrix size must be defined and greater than 0");
      }
      this.size = size;
      this.data = new Uint8Array(size * size);
      this.reservedBit = new Uint8Array(size * size);
    }
    BitMatrix.prototype.set = function(row, col, value, reserved) {
      const index = row * this.size + col;
      this.data[index] = value;
      if (reserved) this.reservedBit[index] = true;
    };
    BitMatrix.prototype.get = function(row, col) {
      return this.data[row * this.size + col];
    };
    BitMatrix.prototype.xor = function(row, col, value) {
      this.data[row * this.size + col] ^= value;
    };
    BitMatrix.prototype.isReserved = function(row, col) {
      return this.reservedBit[row * this.size + col];
    };
    module.exports = BitMatrix;
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/alignment-pattern.js
var require_alignment_pattern = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/alignment-pattern.js"(exports) {
    var getSymbolSize = require_utils().getSymbolSize;
    exports.getRowColCoords = function getRowColCoords(version) {
      if (version === 1) return [];
      const posCount = Math.floor(version / 7) + 2;
      const size = getSymbolSize(version);
      const intervals = size === 145 ? 26 : Math.ceil((size - 13) / (2 * posCount - 2)) * 2;
      const positions = [size - 7];
      for (let i = 1; i < posCount - 1; i++) {
        positions[i] = positions[i - 1] - intervals;
      }
      positions.push(6);
      return positions.reverse();
    };
    exports.getPositions = function getPositions(version) {
      const coords = [];
      const pos = exports.getRowColCoords(version);
      const posLength = pos.length;
      for (let i = 0; i < posLength; i++) {
        for (let j = 0; j < posLength; j++) {
          if (i === 0 && j === 0 || // top-left
          i === 0 && j === posLength - 1 || // bottom-left
          i === posLength - 1 && j === 0) {
            continue;
          }
          coords.push([pos[i], pos[j]]);
        }
      }
      return coords;
    };
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/finder-pattern.js
var require_finder_pattern = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/finder-pattern.js"(exports) {
    var getSymbolSize = require_utils().getSymbolSize;
    var FINDER_PATTERN_SIZE = 7;
    exports.getPositions = function getPositions(version) {
      const size = getSymbolSize(version);
      return [
        // top-left
        [0, 0],
        // top-right
        [size - FINDER_PATTERN_SIZE, 0],
        // bottom-left
        [0, size - FINDER_PATTERN_SIZE]
      ];
    };
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/mask-pattern.js
var require_mask_pattern = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/mask-pattern.js"(exports) {
    exports.Patterns = {
      PATTERN000: 0,
      PATTERN001: 1,
      PATTERN010: 2,
      PATTERN011: 3,
      PATTERN100: 4,
      PATTERN101: 5,
      PATTERN110: 6,
      PATTERN111: 7
    };
    var PenaltyScores = {
      N1: 3,
      N2: 3,
      N3: 40,
      N4: 10
    };
    exports.isValid = function isValid(mask) {
      return mask != null && mask !== "" && !isNaN(mask) && mask >= 0 && mask <= 7;
    };
    exports.from = function from(value) {
      return exports.isValid(value) ? parseInt(value, 10) : void 0;
    };
    exports.getPenaltyN1 = function getPenaltyN1(data) {
      const size = data.size;
      let points = 0;
      let sameCountCol = 0;
      let sameCountRow = 0;
      let lastCol = null;
      let lastRow = null;
      for (let row = 0; row < size; row++) {
        sameCountCol = sameCountRow = 0;
        lastCol = lastRow = null;
        for (let col = 0; col < size; col++) {
          let module2 = data.get(row, col);
          if (module2 === lastCol) {
            sameCountCol++;
          } else {
            if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
            lastCol = module2;
            sameCountCol = 1;
          }
          module2 = data.get(col, row);
          if (module2 === lastRow) {
            sameCountRow++;
          } else {
            if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
            lastRow = module2;
            sameCountRow = 1;
          }
        }
        if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
        if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
      }
      return points;
    };
    exports.getPenaltyN2 = function getPenaltyN2(data) {
      const size = data.size;
      let points = 0;
      for (let row = 0; row < size - 1; row++) {
        for (let col = 0; col < size - 1; col++) {
          const last = data.get(row, col) + data.get(row, col + 1) + data.get(row + 1, col) + data.get(row + 1, col + 1);
          if (last === 4 || last === 0) points++;
        }
      }
      return points * PenaltyScores.N2;
    };
    exports.getPenaltyN3 = function getPenaltyN3(data) {
      const size = data.size;
      let points = 0;
      let bitsCol = 0;
      let bitsRow = 0;
      for (let row = 0; row < size; row++) {
        bitsCol = bitsRow = 0;
        for (let col = 0; col < size; col++) {
          bitsCol = bitsCol << 1 & 2047 | data.get(row, col);
          if (col >= 10 && (bitsCol === 1488 || bitsCol === 93)) points++;
          bitsRow = bitsRow << 1 & 2047 | data.get(col, row);
          if (col >= 10 && (bitsRow === 1488 || bitsRow === 93)) points++;
        }
      }
      return points * PenaltyScores.N3;
    };
    exports.getPenaltyN4 = function getPenaltyN4(data) {
      let darkCount = 0;
      const modulesCount = data.data.length;
      for (let i = 0; i < modulesCount; i++) darkCount += data.data[i];
      const k = Math.abs(Math.ceil(darkCount * 100 / modulesCount / 5) - 10);
      return k * PenaltyScores.N4;
    };
    function getMaskAt(maskPattern, i, j) {
      switch (maskPattern) {
        case exports.Patterns.PATTERN000:
          return (i + j) % 2 === 0;
        case exports.Patterns.PATTERN001:
          return i % 2 === 0;
        case exports.Patterns.PATTERN010:
          return j % 3 === 0;
        case exports.Patterns.PATTERN011:
          return (i + j) % 3 === 0;
        case exports.Patterns.PATTERN100:
          return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
        case exports.Patterns.PATTERN101:
          return i * j % 2 + i * j % 3 === 0;
        case exports.Patterns.PATTERN110:
          return (i * j % 2 + i * j % 3) % 2 === 0;
        case exports.Patterns.PATTERN111:
          return (i * j % 3 + (i + j) % 2) % 2 === 0;
        default:
          throw new Error("bad maskPattern:" + maskPattern);
      }
    }
    exports.applyMask = function applyMask(pattern4, data) {
      const size = data.size;
      for (let col = 0; col < size; col++) {
        for (let row = 0; row < size; row++) {
          if (data.isReserved(row, col)) continue;
          data.xor(row, col, getMaskAt(pattern4, row, col));
        }
      }
    };
    exports.getBestMask = function getBestMask(data, setupFormatFunc) {
      const numPatterns = Object.keys(exports.Patterns).length;
      let bestPattern = 0;
      let lowerPenalty = Infinity;
      for (let p = 0; p < numPatterns; p++) {
        setupFormatFunc(p);
        exports.applyMask(p, data);
        const penalty = exports.getPenaltyN1(data) + exports.getPenaltyN2(data) + exports.getPenaltyN3(data) + exports.getPenaltyN4(data);
        exports.applyMask(p, data);
        if (penalty < lowerPenalty) {
          lowerPenalty = penalty;
          bestPattern = p;
        }
      }
      return bestPattern;
    };
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/error-correction-code.js
var require_error_correction_code = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/error-correction-code.js"(exports) {
    var ECLevel = require_error_correction_level();
    var EC_BLOCKS_TABLE = [
      // L  M  Q  H
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      2,
      2,
      1,
      2,
      2,
      4,
      1,
      2,
      4,
      4,
      2,
      4,
      4,
      4,
      2,
      4,
      6,
      5,
      2,
      4,
      6,
      6,
      2,
      5,
      8,
      8,
      4,
      5,
      8,
      8,
      4,
      5,
      8,
      11,
      4,
      8,
      10,
      11,
      4,
      9,
      12,
      16,
      4,
      9,
      16,
      16,
      6,
      10,
      12,
      18,
      6,
      10,
      17,
      16,
      6,
      11,
      16,
      19,
      6,
      13,
      18,
      21,
      7,
      14,
      21,
      25,
      8,
      16,
      20,
      25,
      8,
      17,
      23,
      25,
      9,
      17,
      23,
      34,
      9,
      18,
      25,
      30,
      10,
      20,
      27,
      32,
      12,
      21,
      29,
      35,
      12,
      23,
      34,
      37,
      12,
      25,
      34,
      40,
      13,
      26,
      35,
      42,
      14,
      28,
      38,
      45,
      15,
      29,
      40,
      48,
      16,
      31,
      43,
      51,
      17,
      33,
      45,
      54,
      18,
      35,
      48,
      57,
      19,
      37,
      51,
      60,
      19,
      38,
      53,
      63,
      20,
      40,
      56,
      66,
      21,
      43,
      59,
      70,
      22,
      45,
      62,
      74,
      24,
      47,
      65,
      77,
      25,
      49,
      68,
      81
    ];
    var EC_CODEWORDS_TABLE = [
      // L  M  Q  H
      7,
      10,
      13,
      17,
      10,
      16,
      22,
      28,
      15,
      26,
      36,
      44,
      20,
      36,
      52,
      64,
      26,
      48,
      72,
      88,
      36,
      64,
      96,
      112,
      40,
      72,
      108,
      130,
      48,
      88,
      132,
      156,
      60,
      110,
      160,
      192,
      72,
      130,
      192,
      224,
      80,
      150,
      224,
      264,
      96,
      176,
      260,
      308,
      104,
      198,
      288,
      352,
      120,
      216,
      320,
      384,
      132,
      240,
      360,
      432,
      144,
      280,
      408,
      480,
      168,
      308,
      448,
      532,
      180,
      338,
      504,
      588,
      196,
      364,
      546,
      650,
      224,
      416,
      600,
      700,
      224,
      442,
      644,
      750,
      252,
      476,
      690,
      816,
      270,
      504,
      750,
      900,
      300,
      560,
      810,
      960,
      312,
      588,
      870,
      1050,
      336,
      644,
      952,
      1110,
      360,
      700,
      1020,
      1200,
      390,
      728,
      1050,
      1260,
      420,
      784,
      1140,
      1350,
      450,
      812,
      1200,
      1440,
      480,
      868,
      1290,
      1530,
      510,
      924,
      1350,
      1620,
      540,
      980,
      1440,
      1710,
      570,
      1036,
      1530,
      1800,
      570,
      1064,
      1590,
      1890,
      600,
      1120,
      1680,
      1980,
      630,
      1204,
      1770,
      2100,
      660,
      1260,
      1860,
      2220,
      720,
      1316,
      1950,
      2310,
      750,
      1372,
      2040,
      2430
    ];
    exports.getBlocksCount = function getBlocksCount(version, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case ECLevel.L:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 0];
        case ECLevel.M:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 1];
        case ECLevel.Q:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 2];
        case ECLevel.H:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 3];
        default:
          return void 0;
      }
    };
    exports.getTotalCodewordsCount = function getTotalCodewordsCount(version, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case ECLevel.L:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 0];
        case ECLevel.M:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 1];
        case ECLevel.Q:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 2];
        case ECLevel.H:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 3];
        default:
          return void 0;
      }
    };
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/galois-field.js
var require_galois_field = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/galois-field.js"(exports) {
    var EXP_TABLE = new Uint8Array(512);
    var LOG_TABLE = new Uint8Array(256);
    (function initTables() {
      let x = 1;
      for (let i = 0; i < 255; i++) {
        EXP_TABLE[i] = x;
        LOG_TABLE[x] = i;
        x <<= 1;
        if (x & 256) {
          x ^= 285;
        }
      }
      for (let i = 255; i < 512; i++) {
        EXP_TABLE[i] = EXP_TABLE[i - 255];
      }
    })();
    exports.log = function log(n) {
      if (n < 1) throw new Error("log(" + n + ")");
      return LOG_TABLE[n];
    };
    exports.exp = function exp(n) {
      return EXP_TABLE[n];
    };
    exports.mul = function mul(x, y) {
      if (x === 0 || y === 0) return 0;
      return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
    };
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/polynomial.js
var require_polynomial = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/polynomial.js"(exports) {
    var GF = require_galois_field();
    exports.mul = function mul(p1, p2) {
      const coeff = new Uint8Array(p1.length + p2.length - 1);
      for (let i = 0; i < p1.length; i++) {
        for (let j = 0; j < p2.length; j++) {
          coeff[i + j] ^= GF.mul(p1[i], p2[j]);
        }
      }
      return coeff;
    };
    exports.mod = function mod3(divident, divisor) {
      let result = new Uint8Array(divident);
      while (result.length - divisor.length >= 0) {
        const coeff = result[0];
        for (let i = 0; i < divisor.length; i++) {
          result[i] ^= GF.mul(divisor[i], coeff);
        }
        let offset = 0;
        while (offset < result.length && result[offset] === 0) offset++;
        result = result.slice(offset);
      }
      return result;
    };
    exports.generateECPolynomial = function generateECPolynomial(degree) {
      let poly = new Uint8Array([1]);
      for (let i = 0; i < degree; i++) {
        poly = exports.mul(poly, new Uint8Array([1, GF.exp(i)]));
      }
      return poly;
    };
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/reed-solomon-encoder.js
var require_reed_solomon_encoder = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/reed-solomon-encoder.js"(exports, module) {
    var Polynomial = require_polynomial();
    function ReedSolomonEncoder(degree) {
      this.genPoly = void 0;
      this.degree = degree;
      if (this.degree) this.initialize(this.degree);
    }
    ReedSolomonEncoder.prototype.initialize = function initialize(degree) {
      this.degree = degree;
      this.genPoly = Polynomial.generateECPolynomial(this.degree);
    };
    ReedSolomonEncoder.prototype.encode = function encode2(data) {
      if (!this.genPoly) {
        throw new Error("Encoder not initialized");
      }
      const paddedData = new Uint8Array(data.length + this.degree);
      paddedData.set(data);
      const remainder = Polynomial.mod(paddedData, this.genPoly);
      const start = this.degree - remainder.length;
      if (start > 0) {
        const buff = new Uint8Array(this.degree);
        buff.set(remainder, start);
        return buff;
      }
      return remainder;
    };
    module.exports = ReedSolomonEncoder;
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/version-check.js
var require_version_check = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/version-check.js"(exports) {
    exports.isValid = function isValid(version) {
      return !isNaN(version) && version >= 1 && version <= 40;
    };
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/regex.js
var require_regex = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/regex.js"(exports) {
    var numeric = "[0-9]+";
    var alphanumeric = "[A-Z $%*+\\-./:]+";
    var kanji = "(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+";
    kanji = kanji.replace(/u/g, "\\u");
    var byte = "(?:(?![A-Z0-9 $%*+\\-./:]|" + kanji + ")(?:.|[\r\n]))+";
    exports.KANJI = new RegExp(kanji, "g");
    exports.BYTE_KANJI = new RegExp("[^A-Z0-9 $%*+\\-./:]+", "g");
    exports.BYTE = new RegExp(byte, "g");
    exports.NUMERIC = new RegExp(numeric, "g");
    exports.ALPHANUMERIC = new RegExp(alphanumeric, "g");
    var TEST_KANJI = new RegExp("^" + kanji + "$");
    var TEST_NUMERIC = new RegExp("^" + numeric + "$");
    var TEST_ALPHANUMERIC = new RegExp("^[A-Z0-9 $%*+\\-./:]+$");
    exports.testKanji = function testKanji(str) {
      return TEST_KANJI.test(str);
    };
    exports.testNumeric = function testNumeric(str) {
      return TEST_NUMERIC.test(str);
    };
    exports.testAlphanumeric = function testAlphanumeric(str) {
      return TEST_ALPHANUMERIC.test(str);
    };
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/mode.js
var require_mode = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/mode.js"(exports) {
    var VersionCheck = require_version_check();
    var Regex = require_regex();
    exports.NUMERIC = {
      id: "Numeric",
      bit: 1 << 0,
      ccBits: [10, 12, 14]
    };
    exports.ALPHANUMERIC = {
      id: "Alphanumeric",
      bit: 1 << 1,
      ccBits: [9, 11, 13]
    };
    exports.BYTE = {
      id: "Byte",
      bit: 1 << 2,
      ccBits: [8, 16, 16]
    };
    exports.KANJI = {
      id: "Kanji",
      bit: 1 << 3,
      ccBits: [8, 10, 12]
    };
    exports.MIXED = {
      bit: -1
    };
    exports.getCharCountIndicator = function getCharCountIndicator(mode, version) {
      if (!mode.ccBits) throw new Error("Invalid mode: " + mode);
      if (!VersionCheck.isValid(version)) {
        throw new Error("Invalid version: " + version);
      }
      if (version >= 1 && version < 10) return mode.ccBits[0];
      else if (version < 27) return mode.ccBits[1];
      return mode.ccBits[2];
    };
    exports.getBestModeForData = function getBestModeForData(dataStr) {
      if (Regex.testNumeric(dataStr)) return exports.NUMERIC;
      else if (Regex.testAlphanumeric(dataStr)) return exports.ALPHANUMERIC;
      else if (Regex.testKanji(dataStr)) return exports.KANJI;
      else return exports.BYTE;
    };
    exports.toString = function toString(mode) {
      if (mode && mode.id) return mode.id;
      throw new Error("Invalid mode");
    };
    exports.isValid = function isValid(mode) {
      return mode && mode.bit && mode.ccBits;
    };
    function fromString(string) {
      if (typeof string !== "string") {
        throw new Error("Param is not a string");
      }
      const lcStr = string.toLowerCase();
      switch (lcStr) {
        case "numeric":
          return exports.NUMERIC;
        case "alphanumeric":
          return exports.ALPHANUMERIC;
        case "kanji":
          return exports.KANJI;
        case "byte":
          return exports.BYTE;
        default:
          throw new Error("Unknown mode: " + string);
      }
    }
    exports.from = function from(value, defaultValue) {
      if (exports.isValid(value)) {
        return value;
      }
      try {
        return fromString(value);
      } catch (e) {
        return defaultValue;
      }
    };
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/version.js
var require_version = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/version.js"(exports) {
    var Utils = require_utils();
    var ECCode = require_error_correction_code();
    var ECLevel = require_error_correction_level();
    var Mode = require_mode();
    var VersionCheck = require_version_check();
    var G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
    var G18_BCH = Utils.getBCHDigit(G18);
    function getBestVersionForDataLength(mode, length, errorCorrectionLevel) {
      for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
        if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, mode)) {
          return currentVersion;
        }
      }
      return void 0;
    }
    function getReservedBitsCount(mode, version) {
      return Mode.getCharCountIndicator(mode, version) + 4;
    }
    function getTotalBitsFromDataArray(segments, version) {
      let totalBits = 0;
      segments.forEach(function(data) {
        const reservedBits = getReservedBitsCount(data.mode, version);
        totalBits += reservedBits + data.getBitsLength();
      });
      return totalBits;
    }
    function getBestVersionForMixedData(segments, errorCorrectionLevel) {
      for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
        const length = getTotalBitsFromDataArray(segments, currentVersion);
        if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, Mode.MIXED)) {
          return currentVersion;
        }
      }
      return void 0;
    }
    exports.from = function from(value, defaultValue) {
      if (VersionCheck.isValid(value)) {
        return parseInt(value, 10);
      }
      return defaultValue;
    };
    exports.getCapacity = function getCapacity(version, errorCorrectionLevel, mode) {
      if (!VersionCheck.isValid(version)) {
        throw new Error("Invalid QR Code version");
      }
      if (typeof mode === "undefined") mode = Mode.BYTE;
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
      if (mode === Mode.MIXED) return dataTotalCodewordsBits;
      const usableBits = dataTotalCodewordsBits - getReservedBitsCount(mode, version);
      switch (mode) {
        case Mode.NUMERIC:
          return Math.floor(usableBits / 10 * 3);
        case Mode.ALPHANUMERIC:
          return Math.floor(usableBits / 11 * 2);
        case Mode.KANJI:
          return Math.floor(usableBits / 13);
        case Mode.BYTE:
        default:
          return Math.floor(usableBits / 8);
      }
    };
    exports.getBestVersionForData = function getBestVersionForData(data, errorCorrectionLevel) {
      let seg;
      const ecl = ECLevel.from(errorCorrectionLevel, ECLevel.M);
      if (Array.isArray(data)) {
        if (data.length > 1) {
          return getBestVersionForMixedData(data, ecl);
        }
        if (data.length === 0) {
          return 1;
        }
        seg = data[0];
      } else {
        seg = data;
      }
      return getBestVersionForDataLength(seg.mode, seg.getLength(), ecl);
    };
    exports.getEncodedBits = function getEncodedBits(version) {
      if (!VersionCheck.isValid(version) || version < 7) {
        throw new Error("Invalid QR Code version");
      }
      let d = version << 12;
      while (Utils.getBCHDigit(d) - G18_BCH >= 0) {
        d ^= G18 << Utils.getBCHDigit(d) - G18_BCH;
      }
      return version << 12 | d;
    };
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/format-info.js
var require_format_info = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/format-info.js"(exports) {
    var Utils = require_utils();
    var G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
    var G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
    var G15_BCH = Utils.getBCHDigit(G15);
    exports.getEncodedBits = function getEncodedBits(errorCorrectionLevel, mask) {
      const data = errorCorrectionLevel.bit << 3 | mask;
      let d = data << 10;
      while (Utils.getBCHDigit(d) - G15_BCH >= 0) {
        d ^= G15 << Utils.getBCHDigit(d) - G15_BCH;
      }
      return (data << 10 | d) ^ G15_MASK;
    };
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/numeric-data.js
var require_numeric_data = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/numeric-data.js"(exports, module) {
    var Mode = require_mode();
    function NumericData(data) {
      this.mode = Mode.NUMERIC;
      this.data = data.toString();
    }
    NumericData.getBitsLength = function getBitsLength(length) {
      return 10 * Math.floor(length / 3) + (length % 3 ? length % 3 * 3 + 1 : 0);
    };
    NumericData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    NumericData.prototype.getBitsLength = function getBitsLength() {
      return NumericData.getBitsLength(this.data.length);
    };
    NumericData.prototype.write = function write(bitBuffer) {
      let i, group, value;
      for (i = 0; i + 3 <= this.data.length; i += 3) {
        group = this.data.substr(i, 3);
        value = parseInt(group, 10);
        bitBuffer.put(value, 10);
      }
      const remainingNum = this.data.length - i;
      if (remainingNum > 0) {
        group = this.data.substr(i);
        value = parseInt(group, 10);
        bitBuffer.put(value, remainingNum * 3 + 1);
      }
    };
    module.exports = NumericData;
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/alphanumeric-data.js
var require_alphanumeric_data = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/alphanumeric-data.js"(exports, module) {
    var Mode = require_mode();
    var ALPHA_NUM_CHARS = [
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
      "L",
      "M",
      "N",
      "O",
      "P",
      "Q",
      "R",
      "S",
      "T",
      "U",
      "V",
      "W",
      "X",
      "Y",
      "Z",
      " ",
      "$",
      "%",
      "*",
      "+",
      "-",
      ".",
      "/",
      ":"
    ];
    function AlphanumericData(data) {
      this.mode = Mode.ALPHANUMERIC;
      this.data = data;
    }
    AlphanumericData.getBitsLength = function getBitsLength(length) {
      return 11 * Math.floor(length / 2) + 6 * (length % 2);
    };
    AlphanumericData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    AlphanumericData.prototype.getBitsLength = function getBitsLength() {
      return AlphanumericData.getBitsLength(this.data.length);
    };
    AlphanumericData.prototype.write = function write(bitBuffer) {
      let i;
      for (i = 0; i + 2 <= this.data.length; i += 2) {
        let value = ALPHA_NUM_CHARS.indexOf(this.data[i]) * 45;
        value += ALPHA_NUM_CHARS.indexOf(this.data[i + 1]);
        bitBuffer.put(value, 11);
      }
      if (this.data.length % 2) {
        bitBuffer.put(ALPHA_NUM_CHARS.indexOf(this.data[i]), 6);
      }
    };
    module.exports = AlphanumericData;
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/byte-data.js
var require_byte_data = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/byte-data.js"(exports, module) {
    var Mode = require_mode();
    function ByteData(data) {
      this.mode = Mode.BYTE;
      if (typeof data === "string") {
        this.data = new TextEncoder().encode(data);
      } else {
        this.data = new Uint8Array(data);
      }
    }
    ByteData.getBitsLength = function getBitsLength(length) {
      return length * 8;
    };
    ByteData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    ByteData.prototype.getBitsLength = function getBitsLength() {
      return ByteData.getBitsLength(this.data.length);
    };
    ByteData.prototype.write = function(bitBuffer) {
      for (let i = 0, l = this.data.length; i < l; i++) {
        bitBuffer.put(this.data[i], 8);
      }
    };
    module.exports = ByteData;
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/kanji-data.js
var require_kanji_data = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/kanji-data.js"(exports, module) {
    var Mode = require_mode();
    var Utils = require_utils();
    function KanjiData(data) {
      this.mode = Mode.KANJI;
      this.data = data;
    }
    KanjiData.getBitsLength = function getBitsLength(length) {
      return length * 13;
    };
    KanjiData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    KanjiData.prototype.getBitsLength = function getBitsLength() {
      return KanjiData.getBitsLength(this.data.length);
    };
    KanjiData.prototype.write = function(bitBuffer) {
      let i;
      for (i = 0; i < this.data.length; i++) {
        let value = Utils.toSJIS(this.data[i]);
        if (value >= 33088 && value <= 40956) {
          value -= 33088;
        } else if (value >= 57408 && value <= 60351) {
          value -= 49472;
        } else {
          throw new Error(
            "Invalid SJIS character: " + this.data[i] + "\nMake sure your charset is UTF-8"
          );
        }
        value = (value >>> 8 & 255) * 192 + (value & 255);
        bitBuffer.put(value, 13);
      }
    };
    module.exports = KanjiData;
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/dijkstrajs/dijkstra.js
var require_dijkstra = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/dijkstrajs/dijkstra.js"(exports, module) {
    "use strict";
    var dijkstra = {
      single_source_shortest_paths: function(graph, s, d) {
        var predecessors = {};
        var costs = {};
        costs[s] = 0;
        var open = dijkstra.PriorityQueue.make();
        open.push(s, 0);
        var closest, u, v, cost_of_s_to_u, adjacent_nodes, cost_of_e, cost_of_s_to_u_plus_cost_of_e, cost_of_s_to_v, first_visit;
        while (!open.empty()) {
          closest = open.pop();
          u = closest.value;
          cost_of_s_to_u = closest.cost;
          adjacent_nodes = graph[u] || {};
          for (v in adjacent_nodes) {
            if (adjacent_nodes.hasOwnProperty(v)) {
              cost_of_e = adjacent_nodes[v];
              cost_of_s_to_u_plus_cost_of_e = cost_of_s_to_u + cost_of_e;
              cost_of_s_to_v = costs[v];
              first_visit = typeof costs[v] === "undefined";
              if (first_visit || cost_of_s_to_v > cost_of_s_to_u_plus_cost_of_e) {
                costs[v] = cost_of_s_to_u_plus_cost_of_e;
                open.push(v, cost_of_s_to_u_plus_cost_of_e);
                predecessors[v] = u;
              }
            }
          }
        }
        if (typeof d !== "undefined" && typeof costs[d] === "undefined") {
          var msg = ["Could not find a path from ", s, " to ", d, "."].join("");
          throw new Error(msg);
        }
        return predecessors;
      },
      extract_shortest_path_from_predecessor_list: function(predecessors, d) {
        var nodes = [];
        var u = d;
        var predecessor;
        while (u) {
          nodes.push(u);
          predecessor = predecessors[u];
          u = predecessors[u];
        }
        nodes.reverse();
        return nodes;
      },
      find_path: function(graph, s, d) {
        var predecessors = dijkstra.single_source_shortest_paths(graph, s, d);
        return dijkstra.extract_shortest_path_from_predecessor_list(
          predecessors,
          d
        );
      },
      /**
       * A very naive priority queue implementation.
       */
      PriorityQueue: {
        make: function(opts) {
          var T = dijkstra.PriorityQueue, t = {}, key;
          opts = opts || {};
          for (key in T) {
            if (T.hasOwnProperty(key)) {
              t[key] = T[key];
            }
          }
          t.queue = [];
          t.sorter = opts.sorter || T.default_sorter;
          return t;
        },
        default_sorter: function(a, b) {
          return a.cost - b.cost;
        },
        /**
         * Add a new item to the queue and ensure the highest priority element
         * is at the front of the queue.
         */
        push: function(value, cost) {
          var item = { value, cost };
          this.queue.push(item);
          this.queue.sort(this.sorter);
        },
        /**
         * Return the highest priority element in the queue.
         */
        pop: function() {
          return this.queue.shift();
        },
        empty: function() {
          return this.queue.length === 0;
        }
      }
    };
    if (typeof module !== "undefined") {
      module.exports = dijkstra;
    }
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/segments.js
var require_segments = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/segments.js"(exports) {
    var Mode = require_mode();
    var NumericData = require_numeric_data();
    var AlphanumericData = require_alphanumeric_data();
    var ByteData = require_byte_data();
    var KanjiData = require_kanji_data();
    var Regex = require_regex();
    var Utils = require_utils();
    var dijkstra = require_dijkstra();
    function getStringByteLength(str) {
      return unescape(encodeURIComponent(str)).length;
    }
    function getSegments(regex, mode, str) {
      const segments = [];
      let result;
      while ((result = regex.exec(str)) !== null) {
        segments.push({
          data: result[0],
          index: result.index,
          mode,
          length: result[0].length
        });
      }
      return segments;
    }
    function getSegmentsFromString(dataStr) {
      const numSegs = getSegments(Regex.NUMERIC, Mode.NUMERIC, dataStr);
      const alphaNumSegs = getSegments(Regex.ALPHANUMERIC, Mode.ALPHANUMERIC, dataStr);
      let byteSegs;
      let kanjiSegs;
      if (Utils.isKanjiModeEnabled()) {
        byteSegs = getSegments(Regex.BYTE, Mode.BYTE, dataStr);
        kanjiSegs = getSegments(Regex.KANJI, Mode.KANJI, dataStr);
      } else {
        byteSegs = getSegments(Regex.BYTE_KANJI, Mode.BYTE, dataStr);
        kanjiSegs = [];
      }
      const segs = numSegs.concat(alphaNumSegs, byteSegs, kanjiSegs);
      return segs.sort(function(s1, s2) {
        return s1.index - s2.index;
      }).map(function(obj) {
        return {
          data: obj.data,
          mode: obj.mode,
          length: obj.length
        };
      });
    }
    function getSegmentBitsLength(length, mode) {
      switch (mode) {
        case Mode.NUMERIC:
          return NumericData.getBitsLength(length);
        case Mode.ALPHANUMERIC:
          return AlphanumericData.getBitsLength(length);
        case Mode.KANJI:
          return KanjiData.getBitsLength(length);
        case Mode.BYTE:
          return ByteData.getBitsLength(length);
      }
    }
    function mergeSegments(segs) {
      return segs.reduce(function(acc, curr) {
        const prevSeg = acc.length - 1 >= 0 ? acc[acc.length - 1] : null;
        if (prevSeg && prevSeg.mode === curr.mode) {
          acc[acc.length - 1].data += curr.data;
          return acc;
        }
        acc.push(curr);
        return acc;
      }, []);
    }
    function buildNodes(segs) {
      const nodes = [];
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        switch (seg.mode) {
          case Mode.NUMERIC:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.ALPHANUMERIC, length: seg.length },
              { data: seg.data, mode: Mode.BYTE, length: seg.length }
            ]);
            break;
          case Mode.ALPHANUMERIC:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.BYTE, length: seg.length }
            ]);
            break;
          case Mode.KANJI:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
            ]);
            break;
          case Mode.BYTE:
            nodes.push([
              { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
            ]);
        }
      }
      return nodes;
    }
    function buildGraph(nodes, version) {
      const table = {};
      const graph = { start: {} };
      let prevNodeIds = ["start"];
      for (let i = 0; i < nodes.length; i++) {
        const nodeGroup = nodes[i];
        const currentNodeIds = [];
        for (let j = 0; j < nodeGroup.length; j++) {
          const node = nodeGroup[j];
          const key = "" + i + j;
          currentNodeIds.push(key);
          table[key] = { node, lastCount: 0 };
          graph[key] = {};
          for (let n = 0; n < prevNodeIds.length; n++) {
            const prevNodeId = prevNodeIds[n];
            if (table[prevNodeId] && table[prevNodeId].node.mode === node.mode) {
              graph[prevNodeId][key] = getSegmentBitsLength(table[prevNodeId].lastCount + node.length, node.mode) - getSegmentBitsLength(table[prevNodeId].lastCount, node.mode);
              table[prevNodeId].lastCount += node.length;
            } else {
              if (table[prevNodeId]) table[prevNodeId].lastCount = node.length;
              graph[prevNodeId][key] = getSegmentBitsLength(node.length, node.mode) + 4 + Mode.getCharCountIndicator(node.mode, version);
            }
          }
        }
        prevNodeIds = currentNodeIds;
      }
      for (let n = 0; n < prevNodeIds.length; n++) {
        graph[prevNodeIds[n]].end = 0;
      }
      return { map: graph, table };
    }
    function buildSingleSegment(data, modesHint) {
      let mode;
      const bestMode = Mode.getBestModeForData(data);
      mode = Mode.from(modesHint, bestMode);
      if (mode !== Mode.BYTE && mode.bit < bestMode.bit) {
        throw new Error('"' + data + '" cannot be encoded with mode ' + Mode.toString(mode) + ".\n Suggested mode is: " + Mode.toString(bestMode));
      }
      if (mode === Mode.KANJI && !Utils.isKanjiModeEnabled()) {
        mode = Mode.BYTE;
      }
      switch (mode) {
        case Mode.NUMERIC:
          return new NumericData(data);
        case Mode.ALPHANUMERIC:
          return new AlphanumericData(data);
        case Mode.KANJI:
          return new KanjiData(data);
        case Mode.BYTE:
          return new ByteData(data);
      }
    }
    exports.fromArray = function fromArray(array) {
      return array.reduce(function(acc, seg) {
        if (typeof seg === "string") {
          acc.push(buildSingleSegment(seg, null));
        } else if (seg.data) {
          acc.push(buildSingleSegment(seg.data, seg.mode));
        }
        return acc;
      }, []);
    };
    exports.fromString = function fromString(data, version) {
      const segs = getSegmentsFromString(data, Utils.isKanjiModeEnabled());
      const nodes = buildNodes(segs);
      const graph = buildGraph(nodes, version);
      const path2 = dijkstra.find_path(graph.map, "start", "end");
      const optimizedSegs = [];
      for (let i = 1; i < path2.length - 1; i++) {
        optimizedSegs.push(graph.table[path2[i]].node);
      }
      return exports.fromArray(mergeSegments(optimizedSegs));
    };
    exports.rawSplit = function rawSplit(data) {
      return exports.fromArray(
        getSegmentsFromString(data, Utils.isKanjiModeEnabled())
      );
    };
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/qrcode.js
var require_qrcode = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/core/qrcode.js"(exports) {
    var Utils = require_utils();
    var ECLevel = require_error_correction_level();
    var BitBuffer = require_bit_buffer();
    var BitMatrix = require_bit_matrix();
    var AlignmentPattern = require_alignment_pattern();
    var FinderPattern = require_finder_pattern();
    var MaskPattern = require_mask_pattern();
    var ECCode = require_error_correction_code();
    var ReedSolomonEncoder = require_reed_solomon_encoder();
    var Version = require_version();
    var FormatInfo = require_format_info();
    var Mode = require_mode();
    var Segments = require_segments();
    function setupFinderPattern(matrix, version) {
      const size = matrix.size;
      const pos = FinderPattern.getPositions(version);
      for (let i = 0; i < pos.length; i++) {
        const row = pos[i][0];
        const col = pos[i][1];
        for (let r = -1; r <= 7; r++) {
          if (row + r <= -1 || size <= row + r) continue;
          for (let c = -1; c <= 7; c++) {
            if (col + c <= -1 || size <= col + c) continue;
            if (r >= 0 && r <= 6 && (c === 0 || c === 6) || c >= 0 && c <= 6 && (r === 0 || r === 6) || r >= 2 && r <= 4 && c >= 2 && c <= 4) {
              matrix.set(row + r, col + c, true, true);
            } else {
              matrix.set(row + r, col + c, false, true);
            }
          }
        }
      }
    }
    function setupTimingPattern(matrix) {
      const size = matrix.size;
      for (let r = 8; r < size - 8; r++) {
        const value = r % 2 === 0;
        matrix.set(r, 6, value, true);
        matrix.set(6, r, value, true);
      }
    }
    function setupAlignmentPattern(matrix, version) {
      const pos = AlignmentPattern.getPositions(version);
      for (let i = 0; i < pos.length; i++) {
        const row = pos[i][0];
        const col = pos[i][1];
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            if (r === -2 || r === 2 || c === -2 || c === 2 || r === 0 && c === 0) {
              matrix.set(row + r, col + c, true, true);
            } else {
              matrix.set(row + r, col + c, false, true);
            }
          }
        }
      }
    }
    function setupVersionInfo(matrix, version) {
      const size = matrix.size;
      const bits = Version.getEncodedBits(version);
      let row, col, mod3;
      for (let i = 0; i < 18; i++) {
        row = Math.floor(i / 3);
        col = i % 3 + size - 8 - 3;
        mod3 = (bits >> i & 1) === 1;
        matrix.set(row, col, mod3, true);
        matrix.set(col, row, mod3, true);
      }
    }
    function setupFormatInfo(matrix, errorCorrectionLevel, maskPattern) {
      const size = matrix.size;
      const bits = FormatInfo.getEncodedBits(errorCorrectionLevel, maskPattern);
      let i, mod3;
      for (i = 0; i < 15; i++) {
        mod3 = (bits >> i & 1) === 1;
        if (i < 6) {
          matrix.set(i, 8, mod3, true);
        } else if (i < 8) {
          matrix.set(i + 1, 8, mod3, true);
        } else {
          matrix.set(size - 15 + i, 8, mod3, true);
        }
        if (i < 8) {
          matrix.set(8, size - i - 1, mod3, true);
        } else if (i < 9) {
          matrix.set(8, 15 - i - 1 + 1, mod3, true);
        } else {
          matrix.set(8, 15 - i - 1, mod3, true);
        }
      }
      matrix.set(size - 8, 8, 1, true);
    }
    function setupData(matrix, data) {
      const size = matrix.size;
      let inc = -1;
      let row = size - 1;
      let bitIndex = 7;
      let byteIndex = 0;
      for (let col = size - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        while (true) {
          for (let c = 0; c < 2; c++) {
            if (!matrix.isReserved(row, col - c)) {
              let dark = false;
              if (byteIndex < data.length) {
                dark = (data[byteIndex] >>> bitIndex & 1) === 1;
              }
              matrix.set(row, col - c, dark);
              bitIndex--;
              if (bitIndex === -1) {
                byteIndex++;
                bitIndex = 7;
              }
            }
          }
          row += inc;
          if (row < 0 || size <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    }
    function createData(version, errorCorrectionLevel, segments) {
      const buffer = new BitBuffer();
      segments.forEach(function(data) {
        buffer.put(data.mode.bit, 4);
        buffer.put(data.getLength(), Mode.getCharCountIndicator(data.mode, version));
        data.write(buffer);
      });
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
      if (buffer.getLengthInBits() + 4 <= dataTotalCodewordsBits) {
        buffer.put(0, 4);
      }
      while (buffer.getLengthInBits() % 8 !== 0) {
        buffer.putBit(0);
      }
      const remainingByte = (dataTotalCodewordsBits - buffer.getLengthInBits()) / 8;
      for (let i = 0; i < remainingByte; i++) {
        buffer.put(i % 2 ? 17 : 236, 8);
      }
      return createCodewords(buffer, version, errorCorrectionLevel);
    }
    function createCodewords(bitBuffer, version, errorCorrectionLevel) {
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewords = totalCodewords - ecTotalCodewords;
      const ecTotalBlocks = ECCode.getBlocksCount(version, errorCorrectionLevel);
      const blocksInGroup2 = totalCodewords % ecTotalBlocks;
      const blocksInGroup1 = ecTotalBlocks - blocksInGroup2;
      const totalCodewordsInGroup1 = Math.floor(totalCodewords / ecTotalBlocks);
      const dataCodewordsInGroup1 = Math.floor(dataTotalCodewords / ecTotalBlocks);
      const dataCodewordsInGroup2 = dataCodewordsInGroup1 + 1;
      const ecCount = totalCodewordsInGroup1 - dataCodewordsInGroup1;
      const rs = new ReedSolomonEncoder(ecCount);
      let offset = 0;
      const dcData = new Array(ecTotalBlocks);
      const ecData = new Array(ecTotalBlocks);
      let maxDataSize = 0;
      const buffer = new Uint8Array(bitBuffer.buffer);
      for (let b = 0; b < ecTotalBlocks; b++) {
        const dataSize = b < blocksInGroup1 ? dataCodewordsInGroup1 : dataCodewordsInGroup2;
        dcData[b] = buffer.slice(offset, offset + dataSize);
        ecData[b] = rs.encode(dcData[b]);
        offset += dataSize;
        maxDataSize = Math.max(maxDataSize, dataSize);
      }
      const data = new Uint8Array(totalCodewords);
      let index = 0;
      let i, r;
      for (i = 0; i < maxDataSize; i++) {
        for (r = 0; r < ecTotalBlocks; r++) {
          if (i < dcData[r].length) {
            data[index++] = dcData[r][i];
          }
        }
      }
      for (i = 0; i < ecCount; i++) {
        for (r = 0; r < ecTotalBlocks; r++) {
          data[index++] = ecData[r][i];
        }
      }
      return data;
    }
    function createSymbol(data, version, errorCorrectionLevel, maskPattern) {
      let segments;
      if (Array.isArray(data)) {
        segments = Segments.fromArray(data);
      } else if (typeof data === "string") {
        let estimatedVersion = version;
        if (!estimatedVersion) {
          const rawSegments = Segments.rawSplit(data);
          estimatedVersion = Version.getBestVersionForData(rawSegments, errorCorrectionLevel);
        }
        segments = Segments.fromString(data, estimatedVersion || 40);
      } else {
        throw new Error("Invalid data");
      }
      const bestVersion = Version.getBestVersionForData(segments, errorCorrectionLevel);
      if (!bestVersion) {
        throw new Error("The amount of data is too big to be stored in a QR Code");
      }
      if (!version) {
        version = bestVersion;
      } else if (version < bestVersion) {
        throw new Error(
          "\nThe chosen QR Code version cannot contain this amount of data.\nMinimum version required to store current data is: " + bestVersion + ".\n"
        );
      }
      const dataBits = createData(version, errorCorrectionLevel, segments);
      const moduleCount = Utils.getSymbolSize(version);
      const modules = new BitMatrix(moduleCount);
      setupFinderPattern(modules, version);
      setupTimingPattern(modules);
      setupAlignmentPattern(modules, version);
      setupFormatInfo(modules, errorCorrectionLevel, 0);
      if (version >= 7) {
        setupVersionInfo(modules, version);
      }
      setupData(modules, dataBits);
      if (isNaN(maskPattern)) {
        maskPattern = MaskPattern.getBestMask(
          modules,
          setupFormatInfo.bind(null, modules, errorCorrectionLevel)
        );
      }
      MaskPattern.applyMask(maskPattern, modules);
      setupFormatInfo(modules, errorCorrectionLevel, maskPattern);
      return {
        modules,
        version,
        errorCorrectionLevel,
        maskPattern,
        segments
      };
    }
    exports.create = function create(data, options) {
      if (typeof data === "undefined" || data === "") {
        throw new Error("No input text");
      }
      let errorCorrectionLevel = ECLevel.M;
      let version;
      let mask;
      if (typeof options !== "undefined") {
        errorCorrectionLevel = ECLevel.from(options.errorCorrectionLevel, ECLevel.M);
        version = Version.from(options.version);
        mask = MaskPattern.from(options.maskPattern);
        if (options.toSJISFunc) {
          Utils.setToSJISFunction(options.toSJISFunc);
        }
      }
      return createSymbol(data, version, errorCorrectionLevel, mask);
    };
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/renderer/utils.js
var require_utils2 = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/renderer/utils.js"(exports) {
    function hex2rgba(hex) {
      if (typeof hex === "number") {
        hex = hex.toString();
      }
      if (typeof hex !== "string") {
        throw new Error("Color should be defined as hex string");
      }
      let hexCode = hex.slice().replace("#", "").split("");
      if (hexCode.length < 3 || hexCode.length === 5 || hexCode.length > 8) {
        throw new Error("Invalid hex color: " + hex);
      }
      if (hexCode.length === 3 || hexCode.length === 4) {
        hexCode = Array.prototype.concat.apply([], hexCode.map(function(c) {
          return [c, c];
        }));
      }
      if (hexCode.length === 6) hexCode.push("F", "F");
      const hexValue = parseInt(hexCode.join(""), 16);
      return {
        r: hexValue >> 24 & 255,
        g: hexValue >> 16 & 255,
        b: hexValue >> 8 & 255,
        a: hexValue & 255,
        hex: "#" + hexCode.slice(0, 6).join("")
      };
    }
    exports.getOptions = function getOptions(options) {
      if (!options) options = {};
      if (!options.color) options.color = {};
      const margin = typeof options.margin === "undefined" || options.margin === null || options.margin < 0 ? 4 : options.margin;
      const width = options.width && options.width >= 21 ? options.width : void 0;
      const scale = options.scale || 4;
      return {
        width,
        scale: width ? 4 : scale,
        margin,
        color: {
          dark: hex2rgba(options.color.dark || "#000000ff"),
          light: hex2rgba(options.color.light || "#ffffffff")
        },
        type: options.type,
        rendererOpts: options.rendererOpts || {}
      };
    };
    exports.getScale = function getScale(qrSize, opts) {
      return opts.width && opts.width >= qrSize + opts.margin * 2 ? opts.width / (qrSize + opts.margin * 2) : opts.scale;
    };
    exports.getImageWidth = function getImageWidth(qrSize, opts) {
      const scale = exports.getScale(qrSize, opts);
      return Math.floor((qrSize + opts.margin * 2) * scale);
    };
    exports.qrToImageData = function qrToImageData(imgData, qr, opts) {
      const size = qr.modules.size;
      const data = qr.modules.data;
      const scale = exports.getScale(size, opts);
      const symbolSize = Math.floor((size + opts.margin * 2) * scale);
      const scaledMargin = opts.margin * scale;
      const palette = [opts.color.light, opts.color.dark];
      for (let i = 0; i < symbolSize; i++) {
        for (let j = 0; j < symbolSize; j++) {
          let posDst = (i * symbolSize + j) * 4;
          let pxColor = opts.color.light;
          if (i >= scaledMargin && j >= scaledMargin && i < symbolSize - scaledMargin && j < symbolSize - scaledMargin) {
            const iSrc = Math.floor((i - scaledMargin) / scale);
            const jSrc = Math.floor((j - scaledMargin) / scale);
            pxColor = palette[data[iSrc * size + jSrc] ? 1 : 0];
          }
          imgData[posDst++] = pxColor.r;
          imgData[posDst++] = pxColor.g;
          imgData[posDst++] = pxColor.b;
          imgData[posDst] = pxColor.a;
        }
      }
    };
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/renderer/canvas.js
var require_canvas = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/renderer/canvas.js"(exports) {
    var Utils = require_utils2();
    function clearCanvas(ctx, canvas, size) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!canvas.style) canvas.style = {};
      canvas.height = size;
      canvas.width = size;
      canvas.style.height = size + "px";
      canvas.style.width = size + "px";
    }
    function getCanvasElement() {
      try {
        return document.createElement("canvas");
      } catch (e) {
        throw new Error("You need to specify a canvas element");
      }
    }
    exports.render = function render2(qrData, canvas, options) {
      let opts = options;
      let canvasEl = canvas;
      if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
        opts = canvas;
        canvas = void 0;
      }
      if (!canvas) {
        canvasEl = getCanvasElement();
      }
      opts = Utils.getOptions(opts);
      const size = Utils.getImageWidth(qrData.modules.size, opts);
      const ctx = canvasEl.getContext("2d");
      const image = ctx.createImageData(size, size);
      Utils.qrToImageData(image.data, qrData, opts);
      clearCanvas(ctx, canvasEl, size);
      ctx.putImageData(image, 0, 0);
      return canvasEl;
    };
    exports.renderToDataURL = function renderToDataURL(qrData, canvas, options) {
      let opts = options;
      if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
        opts = canvas;
        canvas = void 0;
      }
      if (!opts) opts = {};
      const canvasEl = exports.render(qrData, canvas, opts);
      const type = opts.type || "image/png";
      const rendererOpts = opts.rendererOpts || {};
      return canvasEl.toDataURL(type, rendererOpts.quality);
    };
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/renderer/svg-tag.js
var require_svg_tag = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/renderer/svg-tag.js"(exports) {
    var Utils = require_utils2();
    function getColorAttrib(color, attrib) {
      const alpha = color.a / 255;
      const str = attrib + '="' + color.hex + '"';
      return alpha < 1 ? str + " " + attrib + '-opacity="' + alpha.toFixed(2).slice(1) + '"' : str;
    }
    function svgCmd(cmd, x, y) {
      let str = cmd + x;
      if (typeof y !== "undefined") str += " " + y;
      return str;
    }
    function qrToPath(data, size, margin) {
      let path2 = "";
      let moveBy = 0;
      let newRow = false;
      let lineLength = 0;
      for (let i = 0; i < data.length; i++) {
        const col = Math.floor(i % size);
        const row = Math.floor(i / size);
        if (!col && !newRow) newRow = true;
        if (data[i]) {
          lineLength++;
          if (!(i > 0 && col > 0 && data[i - 1])) {
            path2 += newRow ? svgCmd("M", col + margin, 0.5 + row + margin) : svgCmd("m", moveBy, 0);
            moveBy = 0;
            newRow = false;
          }
          if (!(col + 1 < size && data[i + 1])) {
            path2 += svgCmd("h", lineLength);
            lineLength = 0;
          }
        } else {
          moveBy++;
        }
      }
      return path2;
    }
    exports.render = function render2(qrData, options, cb) {
      const opts = Utils.getOptions(options);
      const size = qrData.modules.size;
      const data = qrData.modules.data;
      const qrcodesize = size + opts.margin * 2;
      const bg = !opts.color.light.a ? "" : "<path " + getColorAttrib(opts.color.light, "fill") + ' d="M0 0h' + qrcodesize + "v" + qrcodesize + 'H0z"/>';
      const path2 = "<path " + getColorAttrib(opts.color.dark, "stroke") + ' d="' + qrToPath(data, size, opts.margin) + '"/>';
      const viewBox = 'viewBox="0 0 ' + qrcodesize + " " + qrcodesize + '"';
      const width = !opts.width ? "" : 'width="' + opts.width + '" height="' + opts.width + '" ';
      const svgTag = '<svg xmlns="http://www.w3.org/2000/svg" ' + width + viewBox + ' shape-rendering="crispEdges">' + bg + path2 + "</svg>\n";
      if (typeof cb === "function") {
        cb(null, svgTag);
      }
      return svgTag;
    };
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/browser.js
var require_browser = __commonJS({
  "../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/qrcode/lib/browser.js"(exports) {
    var canPromise = require_can_promise();
    var QRCode2 = require_qrcode();
    var CanvasRenderer = require_canvas();
    var SvgRenderer = require_svg_tag();
    function renderCanvas(renderFunc, canvas, text3, opts, cb) {
      const args = [].slice.call(arguments, 1);
      const argsNum = args.length;
      const isLastArgCb = typeof args[argsNum - 1] === "function";
      if (!isLastArgCb && !canPromise()) {
        throw new Error("Callback required as last argument");
      }
      if (isLastArgCb) {
        if (argsNum < 2) {
          throw new Error("Too few arguments provided");
        }
        if (argsNum === 2) {
          cb = text3;
          text3 = canvas;
          canvas = opts = void 0;
        } else if (argsNum === 3) {
          if (canvas.getContext && typeof cb === "undefined") {
            cb = opts;
            opts = void 0;
          } else {
            cb = opts;
            opts = text3;
            text3 = canvas;
            canvas = void 0;
          }
        }
      } else {
        if (argsNum < 1) {
          throw new Error("Too few arguments provided");
        }
        if (argsNum === 1) {
          text3 = canvas;
          canvas = opts = void 0;
        } else if (argsNum === 2 && !canvas.getContext) {
          opts = text3;
          text3 = canvas;
          canvas = void 0;
        }
        return new Promise(function(resolve, reject) {
          try {
            const data = QRCode2.create(text3, opts);
            resolve(renderFunc(data, canvas, opts));
          } catch (e) {
            reject(e);
          }
        });
      }
      try {
        const data = QRCode2.create(text3, opts);
        cb(null, renderFunc(data, canvas, opts));
      } catch (e) {
        cb(e);
      }
    }
    exports.create = QRCode2.create;
    exports.toCanvas = renderCanvas.bind(null, CanvasRenderer.render);
    exports.toDataURL = renderCanvas.bind(null, CanvasRenderer.renderToDataURL);
    exports.toString = renderCanvas.bind(null, function(data, _, opts) {
      return SvgRenderer.render(data, opts);
    });
  }
});

// vendor/product-session-browser.mjs
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
function anumber(n, title = "") {
  if (typeof n !== "number") {
    const prefix = title && `"${title}" `;
    throw new TypeError(`${prefix}expected number, got ${typeof n}`);
  }
  if (!Number.isSafeInteger(n) || n < 0) {
    const prefix = title && `"${title}" `;
    throw new RangeError(`${prefix}expected integer >= 0, got ${n}`);
  }
}
function abytes(value, length, title = "") {
  const bytes = isBytes(value);
  const len = value?.length;
  const needsLen = length !== void 0;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    const message = prefix + "expected Uint8Array" + ofLen + ", got " + got;
    if (!bytes)
      throw new TypeError(message);
    throw new RangeError(message);
  }
  return value;
}
function ahash(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new TypeError("Hash must wrapped by utils.createHasher");
  anumber(h.outputLen);
  anumber(h.blockLen);
  if (h.outputLen < 1)
    throw new Error('"outputLen" must be >= 1');
  if (h.blockLen < 1)
    throw new Error('"blockLen" must be >= 1');
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out, void 0, "digestInto() output");
  const min = instance.outputLen;
  if (out.length < min) {
    throw new RangeError('"digestInto() output" expected to be of length >=' + min);
  }
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
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function byteSwap(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
  return arr;
}
var swap32IfBE = isLE ? (u) => u : byteSwap32;
var hasHexBuiltin = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
var asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function asciiToBase16(ch) {
  if (ch >= asciis._0 && ch <= asciis._9)
    return ch - asciis._0;
  if (ch >= asciis.A && ch <= asciis.F)
    return ch - (asciis.A - 10);
  if (ch >= asciis.a && ch <= asciis.f)
    return ch - (asciis.a - 10);
  return;
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
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new TypeError("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
function concatBytes(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes(a);
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
function createHasher(hashCons, info = {}) {
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
  anumber(bytesLength, "bytesLength");
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
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD = class {
  blockLen;
  outputLen;
  canXOF = false;
  padOffset;
  isLE;
  // For partial updates less than block size
  buffer;
  view;
  finished = false;
  length = 0;
  pos = 0;
  destroyed = false;
  constructor(blockLen, outputLen, padOffset, isLE22) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE22;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
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
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE: isLE22 } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos; i < blockLen; i++)
      buffer[i] = 0;
    view.setBigUint64(blockLen - 8, BigInt(this.length * 8), isLE22);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen must be aligned to 32bit");
    const outLen = len / 4;
    const state2 = this.get();
    if (outLen > state2.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state2[i], isLE22);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to ||= new this.constructor();
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
var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n = /* @__PURE__ */ BigInt(32);
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
var rotlSH = (h, l, s) => h << s | l >>> 32 - s;
var rotlSL = (h, l, s) => l << s | h >>> 32 - s;
var rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s;
var rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;
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
  constructor(outputLen) {
    super(64, outputLen, 8, false);
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
    clean(SHA256_W);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var _SHA256 = class extends SHA2_32B {
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  A = SHA256_IV[0] | 0;
  B = SHA256_IV[1] | 0;
  C = SHA256_IV[2] | 0;
  D = SHA256_IV[3] | 0;
  E = SHA256_IV[4] | 0;
  F = SHA256_IV[5] | 0;
  G = SHA256_IV[6] | 0;
  H = SHA256_IV[7] | 0;
  constructor() {
    super(32);
  }
};
var sha256 = /* @__PURE__ */ createHasher(
  () => new _SHA256(),
  /* @__PURE__ */ oidNist(1)
);
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function exactFields(value, expected, label) {
  if (!isPlainObject(value)) throw new WalletAuthError("INVALID_SHAPE", `${label} must be a JSON object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join("\n") !== wanted.join("\n")) throw new WalletAuthError("UNKNOWN_OR_MISSING_FIELD", `${label} fields do not match the protocol schema`);
}
function canonicalJSON(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new WalletAuthError("INVALID_NUMBER", "Protocol numbers must be safe integers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (!isPlainObject(value)) throw new WalletAuthError("INVALID_SHAPE", "Protocol value is not canonical JSON");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
}
function digestHex(domain, value) {
  return bytesToHex(sha256(utf8ToBytes(`${domain}
${canonicalJSON(value)}`)));
}
var WalletAuthError = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WalletAuthError";
    this.code = code;
  }
};
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function encodeBase64url(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new WalletAuthError("INVALID_ENCODING", "Base64url input must be bytes");
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0, b = bytes[index + 1] ?? 0, c = bytes[index + 2] ?? 0;
    const value = a << 16 | b << 8 | c;
    output += ALPHABET[value >>> 18 & 63] + ALPHABET[value >>> 12 & 63] + (index + 1 < bytes.length ? ALPHABET[value >>> 6 & 63] : "=") + (index + 2 < bytes.length ? ALPHABET[value & 63] : "=");
  }
  return output.replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function decodeBase64url(value, label = "base64url value") {
  if (typeof value !== "string" || !/[A-Za-z0-9_-]/.test(value) || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new WalletAuthError("INVALID_ENCODING", `${label} is invalid`);
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const output = [];
  for (let index = 0; index < padded.length; index += 4) {
    const chars = [padded[index], padded[index + 1], padded[index + 2], padded[index + 3]];
    const values = chars.map((character) => character === "=" ? 0 : ALPHABET.indexOf(character));
    if (values.some((item) => item < 0)) throw new WalletAuthError("INVALID_ENCODING", `${label} is invalid`);
    const combined = values[0] << 18 | values[1] << 12 | values[2] << 6 | values[3];
    output.push(combined >>> 16 & 255);
    if (chars[2] !== "=") output.push(combined >>> 8 & 255);
    if (chars[3] !== "=") output.push(combined & 255);
  }
  return Uint8Array.from(output);
}
var PRODUCT_SESSION_REGISTRY_VERSION = 2;
var PRODUCT_SESSION_PLATFORMS = Object.freeze(["android", "ios", "linux", "macos", "web", "windows"]);
var DOCUMENT_FIELDS = ["schemaVersion", "chainId", "wallet", "products"];
var WALLET_FIELDS = ["authorizeCallback", "downloadUrl", "metaMaskDownloadUrl"];
var PRODUCT_FIELDS = [
  "productId",
  "clientId",
  "displayName",
  "applicationId",
  "webOrigin",
  "nativeCallback",
  "legacyCallbacks",
  "scopes",
  "evmCompatible",
  "sessionDurationSeconds"
];
var FORBIDDEN_CALLBACK_SCHEMES = /* @__PURE__ */ new Set(["data:", "file:", "http:", "javascript:"]);
function parseProductSessionRegistry(input) {
  exactFields(input, DOCUMENT_FIELDS, "Product Session router registry");
  if (input.schemaVersion !== PRODUCT_SESSION_REGISTRY_VERSION || input.chainId !== "ynx_6423-1") {
    fail("INVALID_ROUTER_REGISTRY", "Product Session router registry version or chain is unsupported");
  }
  exactFields(input.wallet, WALLET_FIELDS, "Product Session Wallet registration");
  const authorizeCallback = callback(input.wallet.authorizeCallback, "wallet authorize callback", { allowHttps: false });
  const authorize = new URL(authorizeCallback);
  if (authorize.protocol !== "ynxwallet:" || authorize.hostname !== "authorize" || authorize.pathname !== "") {
    fail("INVALID_ROUTER_REGISTRY", "Wallet authorize callback must be ynxwallet://authorize");
  }
  const downloadUrl = httpsURL(input.wallet.downloadUrl, "Wallet download URL", false);
  const metaMaskDownloadUrl = httpsURL(input.wallet.metaMaskDownloadUrl, "MetaMask download URL", false);
  if (downloadUrl !== "https://www.ynxweb4.com/dapp/download" || metaMaskDownloadUrl !== "https://metamask.io/download") {
    fail("INVALID_ROUTER_REGISTRY", "Wallet download routes must match the approved official allowlist");
  }
  if (!Array.isArray(input.products) || input.products.length < 1 || input.products.length > 64) {
    fail("INVALID_ROUTER_REGISTRY", "Product Session registry product count is invalid");
  }
  const products = input.products.map(parseProduct);
  uniqueSorted(products.map((item) => item.productId), "productId");
  unique(products.map((item) => item.clientId), "clientId");
  unique(products.map((item) => item.applicationId), "applicationId");
  unique(products.filter((item) => !item.platforms || item.platforms.includes("web")).map((item) => item.webOrigin), "webOrigin");
  unique(products.filter((item) => item.nativeCallback !== null).map((item) => new URL(item.nativeCallback).protocol), "native callback scheme");
  const legacy = products.flatMap((item) => item.legacyCallbacks.map((value) => `${value}
${item.productId}`));
  const legacyNames = legacy.map((value) => value.split("\n", 1)[0]);
  unique(legacyNames, "legacy callback");
  return Object.freeze({
    schemaVersion: PRODUCT_SESSION_REGISTRY_VERSION,
    chainId: input.chainId,
    wallet: Object.freeze({ authorizeCallback, downloadUrl, metaMaskDownloadUrl }),
    products: Object.freeze(products)
  });
}
function productPlatformBinding(registryInput, productId, platform) {
  const registry = parseProductSessionRegistry(registryInput);
  if (!PRODUCT_SESSION_PLATFORMS.includes(platform)) fail("INVALID_PLATFORM", "Product Session platform is unsupported");
  const product = registry.products.find((item) => item.productId === productId);
  if (!product) fail("UNKNOWN_PRODUCT", "Product is not registered for Product Sessions");
  if (product.platforms && !product.platforms.includes(platform)) fail("INVALID_PLATFORM", "Product Session platform is not registered for this product");
  const web = platform === "web";
  return Object.freeze({
    chainId: registry.chainId,
    productId: product.productId,
    clientId: product.clientId,
    displayName: product.displayName,
    platform,
    applicationId: web ? `${product.applicationId}.web` : product.applicationId,
    bundleId: ["ios", "macos"].includes(platform) ? product.applicationId : null,
    packageId: ["android", "linux", "windows"].includes(platform) ? product.applicationId : null,
    origin: web ? product.webOrigin : `app://${platform}/${product.applicationId}`,
    callback: web ? product.webCallback ?? `${product.webOrigin}/wallet-auth/callback` : product.nativeCallback,
    scopes: product.scopes,
    evmCompatible: product.evmCompatible,
    sessionDurationSeconds: product.sessionDurationSeconds,
    walletAuthorizeCallback: registry.wallet.authorizeCallback,
    walletDownloadUrl: registry.wallet.downloadUrl,
    metaMaskDownloadUrl: registry.wallet.metaMaskDownloadUrl
  });
}
function parseProduct(input) {
  const hasPlatforms = input !== null && typeof input === "object" && Object.hasOwn(input, "platforms");
  const hasWebCallback = input !== null && typeof input === "object" && Object.hasOwn(input, "webCallback");
  exactFields(input, [...PRODUCT_FIELDS, ...hasPlatforms ? ["platforms"] : [], ...hasWebCallback ? ["webCallback"] : []], "Product Session product registration");
  const platforms = hasPlatforms ? stringList(input.platforms, "platforms", 1, PRODUCT_SESSION_PLATFORMS.length, (value) => {
    if (!PRODUCT_SESSION_PLATFORMS.includes(value)) fail("INVALID_ROUTER_REGISTRY", "Product platform is unsupported");
    return value;
  }) : PRODUCT_SESSION_PLATFORMS;
  const productId = pattern(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/);
  const clientId = pattern(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/);
  const displayName = text(input.displayName, "displayName", 2, 64);
  const applicationId = pattern(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,127}$/);
  const webOrigin = httpsURL(input.webOrigin, "webOrigin", true);
  let webCallback;
  if (hasWebCallback) {
    webCallback = callback(input.webCallback, "webCallback", { allowHttps: true });
    const target = new URL(webCallback);
    if (!platforms.includes("web") || target.protocol !== "https:" || target.origin !== webOrigin || target.search || target.hash || target.pathname === "/" || target.pathname.split("/").some((part) => part === "." || part === "..") || target.pathname.includes("%")) {
      fail("INVALID_ROUTER_REGISTRY", "Web callback requires an exact same-origin registered Web client route");
    }
  }
  let nativeCallback, legacyCallbacks;
  if (!platforms.some((platform) => platform !== "web")) {
    if (input.nativeCallback !== null || !Array.isArray(input.legacyCallbacks) || input.legacyCallbacks.length !== 0) {
      fail("INVALID_ROUTER_REGISTRY", "Web-only products cannot register native or legacy callbacks");
    }
    nativeCallback = null;
    legacyCallbacks = [];
  } else {
    nativeCallback = callback(input.nativeCallback, "nativeCallback", { allowHttps: false });
    const native = new URL(nativeCallback);
    if (native.search || native.hash || native.username || native.password || !native.hostname) {
      fail("INVALID_ROUTER_REGISTRY", "Native callback must contain an exact host/path without query or fragment");
    }
    legacyCallbacks = stringList(input.legacyCallbacks, "legacyCallbacks", 1, 8, (value) => text(value, "legacy callback", 3, 512));
    if (!legacyCallbacks.includes(nativeCallback)) fail("INVALID_ROUTER_REGISTRY", "Legacy callback list must include the canonical native callback");
  }
  const scopes2 = stringList(input.scopes, "scopes", 1, 8, (value) => pattern(value, "scope", /^[a-z][a-z0-9._:-]{1,63}$/));
  if (scopes2.some((scope2) => scope2.includes("*"))) fail("INVALID_ROUTER_REGISTRY", "Wildcard Product Session scope is forbidden");
  if (typeof input.evmCompatible !== "boolean") fail("INVALID_ROUTER_REGISTRY", "evmCompatible must be boolean");
  if (!Number.isInteger(input.sessionDurationSeconds) || input.sessionDurationSeconds < 60 || input.sessionDurationSeconds > 300) {
    fail("INVALID_ROUTER_REGISTRY", "Product Session duration must be between 60 and 300 seconds");
  }
  return Object.freeze({
    productId,
    clientId,
    displayName,
    applicationId,
    webOrigin,
    nativeCallback,
    ...hasPlatforms ? { platforms: Object.freeze(platforms) } : {},
    ...hasWebCallback ? { webCallback } : {},
    legacyCallbacks: Object.freeze(legacyCallbacks),
    scopes: Object.freeze(scopes2),
    evmCompatible: input.evmCompatible,
    sessionDurationSeconds: input.sessionDurationSeconds
  });
}
function callback(value, label, options) {
  const normalized = text(value, label, 3, 512);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail("INVALID_ROUTER_REGISTRY", `${label} is not a URL with ://`);
  }
  if (parsed.toString() !== normalized || parsed.username || parsed.password || parsed.hash || FORBIDDEN_CALLBACK_SCHEMES.has(parsed.protocol)) {
    fail("INVALID_ROUTER_REGISTRY", `${label} is not canonical or uses a forbidden scheme`);
  }
  if (parsed.protocol === "https:" && !options.allowHttps) fail("INVALID_ROUTER_REGISTRY", `${label} must use its registered application scheme`);
  if (parsed.protocol !== "https:" && !/^[a-z][a-z0-9+.-]*:$/.test(parsed.protocol)) fail("INVALID_ROUTER_REGISTRY", `${label} scheme is invalid`);
  return normalized;
}
function httpsURL(value, label, originOnly) {
  const normalized = text(value, label, 8, 512);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail("INVALID_ROUTER_REGISTRY", `${label} is invalid`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.port || !parsed.hostname || originOnly && (parsed.pathname !== "/" || parsed.search)) {
    fail("INVALID_ROUTER_REGISTRY", `${label} must be a canonical HTTPS ${originOnly ? "origin" : "URL"}`);
  }
  return originOnly ? parsed.origin : parsed.toString().replace(/\/$/, "");
}
function stringList(value, label, minimum, maximum, normalize) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail("INVALID_ROUTER_REGISTRY", `${label} item count is invalid`);
  const result = value.map(normalize);
  uniqueSorted(result, label);
  return result;
}
function uniqueSorted(values, label) {
  unique(values, label);
  if ([...values].sort().join("\n") !== values.join("\n")) fail("INVALID_ROUTER_REGISTRY", `${label} must be sorted`);
}
function unique(values, label) {
  if (new Set(values).size !== values.length) fail("INVALID_ROUTER_REGISTRY", `${label} must be globally unique`);
}
function pattern(value, label, regex) {
  const result = text(value, label, 1, 512);
  if (!regex.test(result)) fail("INVALID_ROUTER_REGISTRY", `${label} is invalid`);
  return result;
}
function text(value, label, minimum, maximum) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum || value.trim() !== value) fail("INVALID_ROUTER_REGISTRY", `${label} is invalid`);
  return value;
}
function fail(code, message) {
  throw new WalletAuthError(code, message);
}
var abytes2 = (value, length, title) => abytes(value, length, title);
var anumber2 = anumber;
var bytesToHex2 = bytesToHex;
var concatBytes2 = (...arrays) => concatBytes(...arrays);
var hexToBytes2 = (hex) => hexToBytes(hex);
var isBytes2 = isBytes;
var randomBytes2 = (bytesLength) => randomBytes(bytesLength);
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
function abool(value, title = "") {
  if (typeof value !== "boolean") {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected boolean, got type=" + typeof value);
  }
  return value;
}
function abignumber(n) {
  if (typeof n === "bigint") {
    if (!isPosBig(n))
      throw new RangeError("positive bigint expected, got " + n);
  } else
    anumber2(n);
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
function numberToHexUnpadded(num) {
  const hex = abignumber(num).toString(16);
  return hex.length & 1 ? "0" + hex : hex;
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
  return hexToNumber(bytesToHex(copyBytes(abytes(bytes)).reverse()));
}
function numberToBytesBE(n, len) {
  anumber(len);
  if (len === 0)
    throw new RangeError("zero length");
  n = abignumber(n);
  const hex = n.toString(16);
  if (hex.length > len * 2)
    throw new RangeError("number too large");
  return hexToBytes(hex.padStart(len * 2, "0"));
}
function numberToBytesLE(n, len) {
  return numberToBytesBE(n, len).reverse();
}
function copyBytes(bytes) {
  return Uint8Array.from(abytes2(bytes));
}
var isPosBig = (n) => typeof n === "bigint" && _0n <= n;
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
  let len;
  for (len = 0; n > _0n; n >>= _1n, len += 1)
    ;
  return len;
}
var bitMask = (n) => (_1n << BigInt(n)) - _1n;
function createHmacDrbg(hashLen, qByteLen, hmacFn) {
  anumber(hashLen, "hashLen");
  anumber(qByteLen, "qByteLen");
  if (typeof hmacFn !== "function")
    throw new TypeError("hmacFn must be a function");
  const u8n = (len) => new Uint8Array(len);
  const NULL = Uint8Array.of();
  const byte0 = Uint8Array.of(0);
  const byte1 = Uint8Array.of(1);
  const _maxDrbgIters = 1e3;
  let v = u8n(hashLen);
  let k = u8n(hashLen);
  let i = 0;
  const reset = () => {
    v.fill(1);
    k.fill(0);
    i = 0;
  };
  const h = (...msgs) => hmacFn(k, concatBytes2(v, ...msgs));
  const reseed = (seed = NULL) => {
    k = h(byte0, seed);
    v = h();
    if (seed.length === 0)
      return;
    k = h(byte1, seed);
    v = h();
  };
  const gen = () => {
    if (i++ >= _maxDrbgIters)
      throw new Error("drbg: tried max amount of iterations");
    let len = 0;
    const out = [];
    while (len < qByteLen) {
      v = h();
      const sl = v.slice();
      out.push(sl);
      len += v.length;
    }
    return concatBytes2(...out);
  };
  const genUntil = (seed, pred) => {
    reset();
    reseed(seed);
    let res = void 0;
    while ((res = pred(gen())) === void 0)
      reseed();
    reset();
    return res;
  };
  return genUntil;
}
function validateObject(object, fields = {}, optFields = {}) {
  if (Object.prototype.toString.call(object) !== "[object Object]")
    throw new TypeError("expected valid options object");
  function checkField(fieldName, expectedType, isOpt) {
    if (!isOpt && expectedType !== "function" && !Object.hasOwn(object, fieldName))
      throw new TypeError(`param "${fieldName}" is invalid: expected own property`);
    const val = object[fieldName];
    if (isOpt && val === void 0)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new TypeError(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
  }
  const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
  iter(fields, false);
  iter(optFields, true);
}
var _0n2 = /* @__PURE__ */ BigInt(0);
var _1n2 = /* @__PURE__ */ BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _3n = /* @__PURE__ */ BigInt(3);
var _4n = /* @__PURE__ */ BigInt(4);
var _5n = /* @__PURE__ */ BigInt(5);
var _7n = /* @__PURE__ */ BigInt(7);
var _8n = /* @__PURE__ */ BigInt(8);
var _9n = /* @__PURE__ */ BigInt(9);
var _16n = /* @__PURE__ */ BigInt(16);
function mod(a, b) {
  if (b <= _0n2)
    throw new Error("mod: expected positive modulus, got " + b);
  const result = a % b;
  return result >= _0n2 ? result : b + result;
}
function pow2(x, power, modulo) {
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
  if (modulo <= _0n2)
    throw new Error("invert: expected positive modulus, got " + modulo);
  let a = mod(number, modulo);
  let b = modulo;
  let x = _0n2, y = _1n2, u = _1n2, v = _0n2;
  while (a !== _0n2) {
    const q = b / a;
    const r = b - a * q;
    const m = x - u * q;
    const n = y - v * q;
    b = a, a = r, x = u, y = v, u = m, v = n;
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
        return F.ZERO;
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
  if (P % _4n === _3n)
    return sqrt3mod4;
  if (P % _8n === _5n)
    return sqrt5mod8;
  if (P % _16n === _9n)
    return sqrt9mod16(P);
  return tonelliShanks(P);
}
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
  const initial = {
    ORDER: "bigint",
    BYTES: "number",
    BITS: "number"
  };
  const opts = FIELD_FIELDS.reduce((map, val) => {
    map[val] = "function";
    return map;
  }, initial);
  validateObject(field, opts);
  asafenumber(field.BYTES, "BYTES");
  asafenumber(field.BITS, "BITS");
  if (field.BYTES < 1 || field.BITS < 1)
    throw new Error("invalid field: expected BYTES/BITS > 0");
  if (field.ORDER <= _1n2)
    throw new Error("invalid field: expected ORDER > 1, got " + field.ORDER);
  return field;
}
function FpPow(Fp2, num, power) {
  const F = Fp2;
  if (power < _0n2)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n2)
    return F.ONE;
  if (power === _1n2)
    return num;
  let p = F.ONE;
  let d = num;
  while (power > _0n2) {
    if (power & _1n2)
      p = F.mul(p, d);
    d = F.sqr(d);
    power >>= _1n2;
  }
  return p;
}
function FpInvertBatch(Fp2, nums, passZero = false) {
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
  const F = Fp2;
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
    anumber2(nBitLength);
  if (n <= _0n2)
    throw new Error("invalid n length: expected positive n, got " + n);
  if (nBitLength !== void 0 && nBitLength < 1)
    throw new Error("invalid n length: expected positive bit length, got " + nBitLength);
  const bits = bitLen(n);
  if (nBitLength !== void 0 && nBitLength < bits)
    throw new Error(`invalid n length: expected bit length (${bits}) >= n.length (${nBitLength})`);
  const _nBitLength = nBitLength !== void 0 ? nBitLength : bits;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
var FIELD_SQRT = /* @__PURE__ */ new WeakMap();
var _Field = class {
  ORDER;
  BITS;
  BYTES;
  isLE;
  ZERO = _0n2;
  ONE = _1n2;
  _lengths;
  _mod;
  constructor(ORDER, opts = {}) {
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
    return FpPow(this, num, power);
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
    abytes2(bytes);
    const { _lengths: allowedLengths, BYTES, isLE: isLE22, ORDER, _mod: modFromBytes } = this;
    if (allowedLengths) {
      if (bytes.length < 1 || !allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
        throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
      }
      const padded = new Uint8Array(BYTES);
      padded.set(bytes, isLE22 ? 0 : padded.length - bytes.length);
      bytes = padded;
    }
    if (bytes.length !== BYTES)
      throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
    let scalar = isLE22 ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
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
    return FpInvertBatch(this, lst);
  }
  // We can't move this out because Fp6, Fp12 implement it
  // and it's unclear what to return in there.
  cmov(a, b, condition) {
    abool(condition, "condition");
    return condition ? b : a;
  }
};
Object.freeze(_Field.prototype);
function Field(ORDER, opts = {}) {
  return new _Field(ORDER, opts);
}
function getFieldBytesLength(fieldOrder) {
  if (typeof fieldOrder !== "bigint")
    throw new Error("field order must be bigint");
  if (fieldOrder <= _1n2)
    throw new Error("field order must be greater than 1");
  const bitLength = bitLen(fieldOrder - _1n2);
  return Math.ceil(bitLength / 8);
}
function getMinHashLength(fieldOrder) {
  const length = getFieldBytesLength(fieldOrder);
  return length + Math.ceil(length / 2);
}
function mapHashToField(key, fieldOrder, isLE22 = false) {
  abytes2(key);
  const len = key.length;
  const fieldLen = getFieldBytesLength(fieldOrder);
  const minLen = Math.max(getMinHashLength(fieldOrder), 16);
  if (len < minLen || len > 1024)
    throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
  const num = isLE22 ? bytesToNumberLE(key) : bytesToNumberBE(key);
  const reduced = mod(num, fieldOrder - _1n2) + _1n2;
  return isLE22 ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
}
var _0n3 = /* @__PURE__ */ BigInt(0);
var _1n3 = /* @__PURE__ */ BigInt(1);
function negateCt(condition, item) {
  const neg = item.negate();
  return condition ? neg : item;
}
function normalizeZ(c, points) {
  const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits) {
  if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
    throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
}
function calcWOpts(W, scalarBits) {
  validateW(W, scalarBits);
  const windows = Math.ceil(scalarBits / W) + 1;
  const windowSize = 2 ** (W - 1);
  const maxNumber = 2 ** W;
  const mask = bitMask(W);
  const shiftBy = BigInt(W);
  return { windows, windowSize, mask, maxNumber, shiftBy };
}
function calcOffsets(n, window, wOpts) {
  const { windowSize, mask, maxNumber, shiftBy } = wOpts;
  let wbits = Number(n & mask);
  let nextN = n >> shiftBy;
  if (wbits > windowSize) {
    wbits -= maxNumber;
    nextN += _1n3;
  }
  const offsetStart = window * windowSize;
  const offset = offsetStart + Math.abs(wbits) - 1;
  const isZero = wbits === 0;
  const isNeg = wbits < 0;
  const isNegF = window % 2 !== 0;
  const offsetF = offsetStart;
  return { nextN, offset, isZero, isNeg, isNegF, offsetF };
}
var pointPrecomputes = /* @__PURE__ */ new WeakMap();
var pointWindowSizes = /* @__PURE__ */ new WeakMap();
function getW(P) {
  return pointWindowSizes.get(P) || 1;
}
function assert0(n) {
  if (n !== _0n3)
    throw new Error("invalid wNAF");
}
var wNAF = class {
  BASE;
  ZERO;
  Fn;
  bits;
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
    while (n > _0n3) {
      if (n & _1n3)
        p = p.add(d);
      d = d.double();
      n >>= _1n3;
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
   * @param point - Point instance
   * @param W - window size
   * @returns precomputed point tables flattened to a single array
   */
  precomputeWindow(point, W) {
    const { windows, windowSize } = calcWOpts(W, this.bits);
    const points = [];
    let p = point;
    let base = p;
    for (let window = 0; window < windows; window++) {
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
    for (let window = 0; window < wo.windows; window++) {
      const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window, wo);
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
   * Implements unsafe EC multiplication using precomputed tables
   * and w-ary non-adjacent form.
   * @param acc - accumulator point to add result of multiplication
   * @returns point
   */
  wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
    const wo = calcWOpts(W, this.bits);
    for (let window = 0; window < wo.windows; window++) {
      if (n === _0n3)
        break;
      const { nextN, offset, isZero, isNeg } = calcOffsets(n, window, wo);
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
    validateW(W, this.bits);
    pointWindowSizes.set(P, W);
    pointPrecomputes.delete(P);
  }
  hasCache(elm) {
    return getW(elm) !== 1;
  }
};
function mulEndoUnsafe(Point, point, k1, k2) {
  let acc = point;
  let p1 = Point.ZERO;
  let p2 = Point.ZERO;
  while (k1 > _0n3 || k2 > _0n3) {
    if (k1 & _1n3)
      p1 = p1.add(acc);
    if (k2 & _1n3)
      p2 = p2.add(acc);
    acc = acc.double();
    k1 >>= _1n3;
    k2 >>= _1n3;
  }
  return { p1, p2 };
}
function createField(order, field, isLE22) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField(field);
    return field;
  } else {
    return Field(order, { isLE: isLE22 });
  }
}
function createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (FpFnLE === void 0)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(typeof val === "bigint" && val > _0n3))
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
var _HMAC = class {
  oHash;
  iHash;
  blockLen;
  outputLen;
  canXOF = false;
  finished = false;
  destroyed = false;
  constructor(hash, key) {
    ahash(hash);
    abytes(key, void 0, "key");
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
    clean(pad);
  }
  update(buf) {
    aexists(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
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
    to ||= Object.create(Object.getPrototypeOf(this), {});
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
var hmac = /* @__PURE__ */ (() => {
  const hmac_ = ((hash, key, message) => new _HMAC(hash, key).update(message).digest());
  hmac_.create = (hash, key) => new _HMAC(hash, key);
  return hmac_;
})();
var divNearest = (num, den) => (num + (num >= 0 ? den : -den) / _2n2) / den;
function _splitEndoScalar(k, basis, n) {
  aInRange("scalar", k, _0n4, n);
  const [[a1, b1], [a2, b2]] = basis;
  const c1 = divNearest(b2 * k, n);
  const c2 = divNearest(-b1 * k, n);
  let k1 = k - c1 * a1 - c2 * a2;
  let k2 = -c1 * b1 - c2 * b2;
  const k1neg = k1 < _0n4;
  const k2neg = k2 < _0n4;
  if (k1neg)
    k1 = -k1;
  if (k2neg)
    k2 = -k2;
  const MAX_NUM = bitMask(Math.ceil(bitLen(n) / 2)) + _1n4;
  if (k1 < _0n4 || k1 >= MAX_NUM || k2 < _0n4 || k2 >= MAX_NUM) {
    throw new Error("splitScalar (endomorphism): failed for k");
  }
  return { k1neg, k1, k2neg, k2 };
}
function validateSigFormat(format) {
  if (!["compact", "recovered", "der"].includes(format))
    throw new Error('Signature format must be "compact", "recovered", or "der"');
  return format;
}
function validateSigOpts(opts, def) {
  validateObject(opts);
  const optsn = {};
  for (let optName of Object.keys(def)) {
    optsn[optName] = opts[optName] === void 0 ? def[optName] : opts[optName];
  }
  abool(optsn.lowS, "lowS");
  abool(optsn.prehash, "prehash");
  if (optsn.format !== void 0)
    validateSigFormat(optsn.format);
  return optsn;
}
var DERErr = class extends Error {
  constructor(m = "") {
    super(m);
  }
};
var DER = {
  // asn.1 DER encoding utils
  Err: DERErr,
  // Basic building block is TLV (Tag-Length-Value)
  _tlv: {
    encode: (tag, data) => {
      const { Err: E } = DER;
      asafenumber(tag, "tag");
      if (tag < 0 || tag > 255)
        throw new E("tlv.encode: wrong tag");
      if (typeof data !== "string")
        throw new TypeError('"data" expected string, got type=' + typeof data);
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
      data = abytes2(data, void 0, "DER data");
      let pos = 0;
      if (tag < 0 || tag > 255)
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
        const lengthBytes = data.subarray(pos, pos + lenLen);
        if (lengthBytes.length !== lenLen)
          throw new E("tlv.decode: length bytes not complete");
        if (lengthBytes[0] === 0)
          throw new E("tlv.decode(long): zero leftmost byte");
        for (const b of lengthBytes)
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
      abignumber(num);
      if (num < _0n4)
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
      if (data.length < 1)
        throw new E("invalid signature integer: empty");
      if (data[0] & 128)
        throw new E("invalid signature integer: negative");
      if (data.length > 1 && data[0] === 0 && !(data[1] & 128))
        throw new E("invalid signature integer: unnecessary leading zero");
      return bytesToNumberBE(data);
    }
  },
  toSig(bytes) {
    const { Err: E, _int: int, _tlv: tlv } = DER;
    const data = abytes2(bytes, void 0, "signature");
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
Object.freeze(DER._tlv);
Object.freeze(DER._int);
Object.freeze(DER);
var _0n4 = /* @__PURE__ */ BigInt(0);
var _1n4 = /* @__PURE__ */ BigInt(1);
var _2n2 = /* @__PURE__ */ BigInt(2);
var _3n2 = /* @__PURE__ */ BigInt(3);
var _4n2 = /* @__PURE__ */ BigInt(4);
function weierstrass(params, extraOpts = {}) {
  const validated = createCurveFields("weierstrass", params, extraOpts);
  const Fp2 = validated.Fp;
  const Fn2 = validated.Fn;
  let CURVE = validated.CURVE;
  const { h: cofactor, n: CURVE_ORDER } = CURVE;
  validateObject(extraOpts, {}, {
    allowInfinityPoint: "boolean",
    clearCofactor: "function",
    isTorsionFree: "function",
    fromBytes: "function",
    toBytes: "function",
    endo: "object"
  });
  const { endo, allowInfinityPoint } = extraOpts;
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
    if (allowInfinityPoint && point.is0())
      return Uint8Array.of(0);
    const { x, y } = point.toAffine();
    const bx = Fp2.toBytes(x);
    abool(isCompressed, "isCompressed");
    if (isCompressed) {
      assertCompressionIsSupported();
      const hasEvenY = !Fp2.isOdd(y);
      return concatBytes2(pprefix(hasEvenY), bx);
    } else {
      return concatBytes2(Uint8Array.of(4), bx, Fp2.toBytes(y));
    }
  }
  function pointFromBytes(bytes) {
    abytes2(bytes, void 0, "Point");
    const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
    const length = bytes.length;
    const head = bytes[0];
    const tail = bytes.subarray(1);
    if (allowInfinityPoint && length === 1 && head === 0)
      return { x: Fp2.ZERO, y: Fp2.ZERO };
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
      const evenY = Fp2.isOdd(y);
      const evenH = (head & 1) === 1;
      if (evenH !== evenY)
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
  const encodePoint = extraOpts.toBytes === void 0 ? pointToBytes : extraOpts.toBytes;
  const decodePoint = extraOpts.fromBytes === void 0 ? pointFromBytes : extraOpts.fromBytes;
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
  const _4a3 = Fp2.mul(Fp2.pow(CURVE.a, _3n2), _4n2);
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
      throw new Error("Weierstrass Point expected");
  }
  function splitEndoScalarN(k) {
    if (!endo || !endo.basises)
      throw new Error("no endo");
    return _splitEndoScalar(k, endo.basises, Fn2.ORDER);
  }
  function finishEndo(endoBeta, k1p, k2p, k1neg, k2neg) {
    k2p = new Point(Fp2.mul(k2p.X, endoBeta), k2p.Y, k2p.Z);
    k1p = negateCt(k1neg, k1p);
    k2p = negateCt(k2neg, k2p);
    return k1p.add(k2p);
  }
  class Point {
    // base / generator point
    static BASE = new Point(CURVE.Gx, CURVE.Gy, Fp2.ONE);
    // zero / infinity / identity point
    static ZERO = new Point(Fp2.ZERO, Fp2.ONE, Fp2.ZERO);
    // 0, 1, 0
    // math field
    static Fp = Fp2;
    // scalar field
    static Fn = Fn2;
    X;
    Y;
    Z;
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
      const P = Point.fromAffine(decodePoint(abytes2(bytes, void 0, "point")));
      P.assertValidity();
      return P;
    }
    static fromHex(hex) {
      return Point.fromBytes(hexToBytes2(hex));
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
     * @param isLazy - true will defer table computation until the first multiplication
     * @returns
     */
    precompute(windowSize = 8, isLazy = true) {
      wnaf.createCache(this, windowSize);
      if (!isLazy)
        this.multiply(_3n2);
      return this;
    }
    // TODO: return `this`
    /** A point on curve is valid if it conforms to equation. */
    assertValidity() {
      const p = this;
      if (p.is0()) {
        if (extraOpts.allowInfinityPoint && Fp2.is0(p.X) && Fp2.eql(p.Y, Fp2.ONE) && Fp2.is0(p.Z))
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
      const b3 = Fp2.mul(b, _3n2);
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
      const b3 = Fp2.mul(CURVE.b, _3n2);
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
      aprjpoint(other);
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
     * @param scalar - by which the point would be multiplied
     * @returns New point
     */
    multiply(scalar) {
      const { endo: endo2 } = extraOpts;
      if (!Fn2.isValidNot0(scalar))
        throw new RangeError("invalid scalar: out of range");
      let point, fake;
      const mul = (n) => wnaf.cached(this, n, (p) => normalizeZ(Point, p));
      if (endo2) {
        const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(scalar);
        const { p: k1p, f: k1f } = mul(k1);
        const { p: k2p, f: k2f } = mul(k2);
        fake = k1f.add(k2f);
        point = finishEndo(endo2.beta, k1p, k2p, k1neg, k2neg);
      } else {
        const { p, f } = mul(scalar);
        point = p;
        fake = f;
      }
      return normalizeZ(Point, [point, fake])[0];
    }
    /**
     * Non-constant-time multiplication. Uses double-and-add algorithm.
     * It's faster, but should only be used when you don't care about
     * an exposed secret key e.g. sig verification, which works over *public* keys.
     */
    multiplyUnsafe(scalar) {
      const { endo: endo2 } = extraOpts;
      const p = this;
      const sc = scalar;
      if (!Fn2.isValid(sc))
        throw new RangeError("invalid scalar: out of range");
      if (sc === _0n4 || p.is0())
        return Point.ZERO;
      if (sc === _1n4)
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
    /**
     * Converts Projective point to affine (x, y) coordinates.
     * (X, Y, Z) ∋ (x=X/Z, y=Y/Z).
     * @param invertedZ - Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
     */
    toAffine(invertedZ) {
      const p = this;
      let iz = invertedZ;
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
    }
    /**
     * Checks whether Point is free of torsion elements (is in prime subgroup).
     * Always torsion-free for cofactor=1 curves.
     */
    isTorsionFree() {
      const { isTorsionFree } = extraOpts;
      if (cofactor === _1n4)
        return true;
      if (isTorsionFree)
        return isTorsionFree(Point, this);
      return wnaf.unsafe(this, CURVE_ORDER).is0();
    }
    clearCofactor() {
      const { clearCofactor } = extraOpts;
      if (cofactor === _1n4)
        return this;
      if (clearCofactor)
        return clearCofactor(Point, this);
      return this.multiplyUnsafe(cofactor);
    }
    isSmallOrder() {
      if (cofactor === _1n4)
        return this.is0();
      return this.clearCofactor().is0();
    }
    toBytes(isCompressed = true) {
      abool(isCompressed, "isCompressed");
      this.assertValidity();
      return encodePoint(Point, this, isCompressed);
    }
    toHex(isCompressed = true) {
      return bytesToHex2(this.toBytes(isCompressed));
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
  }
  const bits = Fn2.BITS;
  const wnaf = new wNAF(Point, extraOpts.endo ? Math.ceil(bits / 2) : bits);
  if (bits >= 8)
    Point.BASE.precompute(8);
  Object.freeze(Point.prototype);
  Object.freeze(Point);
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
    // Raw compact `(r || s)` signature width; DER and recovered signatures use
    // different lengths outside this helper.
    signature: 2 * Fn2.BYTES
  };
}
function ecdh(Point, ecdhOpts = {}) {
  const { Fn: Fn2 } = Point;
  const randomBytes_ = ecdhOpts.randomBytes === void 0 ? randomBytes2 : ecdhOpts.randomBytes;
  const lengths = Object.assign(getWLengths(Point.Fp, Fn2), {
    seed: Math.max(getMinHashLength(Fn2.ORDER), 16)
  });
  function isValidSecretKey(secretKey) {
    try {
      const num = Fn2.fromBytes(secretKey);
      return Fn2.isValidNot0(num);
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
  function randomSecretKey(seed) {
    seed = seed === void 0 ? randomBytes_(lengths.seed) : seed;
    return mapHashToField(abytes2(seed, lengths.seed, "seed"), Fn2.ORDER);
  }
  function getPublicKey(secretKey, isCompressed = true) {
    return Point.BASE.multiply(Fn2.fromBytes(secretKey)).toBytes(isCompressed);
  }
  function isProbPub(item) {
    const { secretKey, publicKey, publicKeyUncompressed } = lengths;
    const allowedLengths = Fn2._lengths;
    if (!isBytes2(item))
      return void 0;
    const l = abytes2(item, void 0, "key").length;
    const isPub = l === publicKey || l === publicKeyUncompressed;
    const isSec = l === secretKey || !!allowedLengths?.includes(l);
    if (isPub && isSec)
      return void 0;
    return isPub;
  }
  function getSharedSecret(secretKeyA, publicKeyB, isCompressed = true) {
    if (isProbPub(secretKeyA) === true)
      throw new Error("first arg must be private key");
    if (isProbPub(publicKeyB) === false)
      throw new Error("second arg must be public key");
    const s = Fn2.fromBytes(secretKeyA);
    const b = Point.fromBytes(publicKeyB);
    return b.multiply(s).toBytes(isCompressed);
  }
  const utils = {
    isValidSecretKey,
    isValidPublicKey,
    randomSecretKey
  };
  const keygen = createKeygen(randomSecretKey, getPublicKey);
  Object.freeze(utils);
  Object.freeze(lengths);
  return Object.freeze({ getPublicKey, getSharedSecret, keygen, Point, utils, lengths });
}
function ecdsa(Point, hash, ecdsaOpts = {}) {
  const hash_ = hash;
  ahash(hash_);
  validateObject(ecdsaOpts, {}, {
    hmac: "function",
    lowS: "boolean",
    randomBytes: "function",
    bits2int: "function",
    bits2int_modN: "function"
  });
  ecdsaOpts = Object.assign({}, ecdsaOpts);
  const randomBytes32 = ecdsaOpts.randomBytes === void 0 ? randomBytes2 : ecdsaOpts.randomBytes;
  const hmac22 = ecdsaOpts.hmac === void 0 ? (key, msg) => hmac(hash_, key, msg) : ecdsaOpts.hmac;
  const { Fp: Fp2, Fn: Fn2 } = Point;
  const { ORDER: CURVE_ORDER, BITS: fnBits } = Fn2;
  const { keygen, getPublicKey, getSharedSecret, utils, lengths } = ecdh(Point, ecdsaOpts);
  const defaultSigOpts = {
    prehash: true,
    lowS: typeof ecdsaOpts.lowS === "boolean" ? ecdsaOpts.lowS : true,
    format: "compact",
    extraEntropy: false
  };
  const hasLargeRecoveryLifts = CURVE_ORDER * _2n2 + _1n4 < Fp2.ORDER;
  function isBiggerThanHalfOrder(number) {
    const HALF = CURVE_ORDER >> _1n4;
    return number > HALF;
  }
  function validateRS(title, num) {
    if (!Fn2.isValidNot0(num))
      throw new Error(`invalid signature ${title}: out of range 1..Point.Fn.ORDER`);
    return num;
  }
  function assertRecoverableCurve() {
    if (hasLargeRecoveryLifts)
      throw new Error('"recovered" sig type is not supported for cofactor >2 curves');
  }
  function validateSigLength(bytes, format) {
    validateSigFormat(format);
    const size = lengths.signature;
    const sizer = format === "compact" ? size : format === "recovered" ? size + 1 : void 0;
    return abytes2(bytes, sizer);
  }
  class Signature {
    r;
    s;
    recovery;
    constructor(r, s, recovery2) {
      this.r = validateRS("r", r);
      this.s = validateRS("s", s);
      if (recovery2 != null) {
        assertRecoverableCurve();
        if (![0, 1, 2, 3].includes(recovery2))
          throw new Error("invalid recovery id");
        this.recovery = recovery2;
      }
      Object.freeze(this);
    }
    static fromBytes(bytes, format = defaultSigOpts.format) {
      validateSigLength(bytes, format);
      let recid;
      if (format === "der") {
        const { r: r2, s: s2 } = DER.toSig(abytes2(bytes));
        return new Signature(r2, s2);
      }
      if (format === "recovered") {
        recid = bytes[0];
        format = "compact";
        bytes = bytes.subarray(1);
      }
      const L = lengths.signature / 2;
      const r = bytes.subarray(0, L);
      const s = bytes.subarray(L, L * 2);
      return new Signature(Fn2.fromBytes(r), Fn2.fromBytes(s), recid);
    }
    static fromHex(hex, format) {
      return this.fromBytes(hexToBytes2(hex), format);
    }
    assertRecovery() {
      const { recovery: recovery2 } = this;
      if (recovery2 == null)
        throw new Error("invalid recovery id: must be present");
      return recovery2;
    }
    addRecoveryBit(recovery2) {
      return new Signature(this.r, this.s, recovery2);
    }
    // Unlike the top-level helper below, this method expects a digest that has
    // already been hashed to the curve's message representative.
    recoverPublicKey(messageHash) {
      const { r, s } = this;
      const recovery2 = this.assertRecovery();
      const radj = recovery2 === 2 || recovery2 === 3 ? r + CURVE_ORDER : r;
      if (!Fp2.isValid(radj))
        throw new Error("invalid recovery id: sig.r+curve.n != R.x");
      const x = Fp2.toBytes(radj);
      const R = Point.fromBytes(concatBytes2(pprefix((recovery2 & 1) === 0), x));
      const ir = Fn2.inv(radj);
      const h = bits2int_modN(abytes2(messageHash, void 0, "msgHash"));
      const u1 = Fn2.create(-h * ir);
      const u2 = Fn2.create(s * ir);
      const Q = Point.BASE.multiplyUnsafe(u1).add(R.multiplyUnsafe(u2));
      if (Q.is0())
        throw new Error("invalid recovery: point at infinify");
      Q.assertValidity();
      return Q;
    }
    // Signatures should be low-s, to prevent malleability.
    hasHighS() {
      return isBiggerThanHalfOrder(this.s);
    }
    toBytes(format = defaultSigOpts.format) {
      validateSigFormat(format);
      if (format === "der")
        return hexToBytes2(DER.hexFromSig(this));
      const { r, s } = this;
      const rb = Fn2.toBytes(r);
      const sb = Fn2.toBytes(s);
      if (format === "recovered") {
        assertRecoverableCurve();
        return concatBytes2(Uint8Array.of(this.assertRecovery()), rb, sb);
      }
      return concatBytes2(rb, sb);
    }
    toHex(format) {
      return bytesToHex2(this.toBytes(format));
    }
  }
  Object.freeze(Signature.prototype);
  Object.freeze(Signature);
  const bits2int = ecdsaOpts.bits2int === void 0 ? function bits2int_def(bytes) {
    if (bytes.length > 8192)
      throw new Error("input is too large");
    const num = bytesToNumberBE(bytes);
    const delta = bytes.length * 8 - fnBits;
    return delta > 0 ? num >> BigInt(delta) : num;
  } : ecdsaOpts.bits2int;
  const bits2int_modN = ecdsaOpts.bits2int_modN === void 0 ? function bits2int_modN_def(bytes) {
    return Fn2.create(bits2int(bytes));
  } : ecdsaOpts.bits2int_modN;
  const ORDER_MASK = bitMask(fnBits);
  function int2octets(num) {
    aInRange("num < 2^" + fnBits, num, _0n4, ORDER_MASK);
    return Fn2.toBytes(num);
  }
  function validateMsgAndHash(message, prehash) {
    abytes2(message, void 0, "message");
    return prehash ? abytes2(hash_(message), void 0, "prehashed message") : message;
  }
  function prepSig(message, secretKey, opts) {
    const { lowS, prehash, extraEntropy } = validateSigOpts(opts, defaultSigOpts);
    message = validateMsgAndHash(message, prehash);
    const h1int = bits2int_modN(message);
    const d = Fn2.fromBytes(secretKey);
    if (!Fn2.isValidNot0(d))
      throw new Error("invalid private key");
    const seedArgs = [int2octets(d), int2octets(h1int)];
    if (extraEntropy != null && extraEntropy !== false) {
      const e = extraEntropy === true ? randomBytes32(lengths.secretKey) : extraEntropy;
      seedArgs.push(abytes2(e, void 0, "extraEntropy"));
    }
    const seed = concatBytes2(...seedArgs);
    const m = h1int;
    function k2sig(kBytes) {
      const k = bits2int(kBytes);
      if (!Fn2.isValidNot0(k))
        return;
      const ik = Fn2.inv(k);
      const q = Point.BASE.multiply(k).toAffine();
      const r = Fn2.create(q.x);
      if (r === _0n4)
        return;
      const s = Fn2.create(ik * Fn2.create(m + r * d));
      if (s === _0n4)
        return;
      let recovery2 = (q.x === r ? 0 : 2) | Number(q.y & _1n4);
      let normS = s;
      if (lowS && isBiggerThanHalfOrder(s)) {
        normS = Fn2.neg(s);
        recovery2 ^= 1;
      }
      return new Signature(r, normS, hasLargeRecoveryLifts ? void 0 : recovery2);
    }
    return { seed, k2sig };
  }
  function sign(message, secretKey, opts = {}) {
    const { seed, k2sig } = prepSig(message, secretKey, opts);
    const drbg = createHmacDrbg(hash_.outputLen, Fn2.BYTES, hmac22);
    const sig = drbg(seed, k2sig);
    return sig.toBytes(opts.format);
  }
  function verify(signature, message, publicKey, opts = {}) {
    const { lowS, prehash, format } = validateSigOpts(opts, defaultSigOpts);
    publicKey = abytes2(publicKey, void 0, "publicKey");
    message = validateMsgAndHash(message, prehash);
    if (!isBytes2(signature)) {
      const end = signature instanceof Signature ? ", use sig.toBytes()" : "";
      throw new Error("verify expects Uint8Array signature" + end);
    }
    validateSigLength(signature, format);
    try {
      const sig = Signature.fromBytes(signature, format);
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
    hash: hash_
  });
}
var p256_CURVE = /* @__PURE__ */ (() => ({
  p: BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff"),
  n: BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"),
  h: BigInt(1),
  a: BigInt("0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc"),
  b: BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b"),
  Gx: BigInt("0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"),
  Gy: BigInt("0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5")
}))();
var p256_Point = /* @__PURE__ */ weierstrass(p256_CURVE);
var p256 = /* @__PURE__ */ ecdsa(p256_Point, sha256);
var secp256k1_CURVE = {
  p: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"),
  n: BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"),
  h: BigInt(1),
  a: BigInt(0),
  b: BigInt(7),
  Gx: BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
  Gy: BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8")
};
var secp256k1_ENDO = {
  beta: BigInt("0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee"),
  basises: [
    [BigInt("0x3086d221a7d46bcde86c90e49284eb15"), -BigInt("0xe4437ed6010e88286f547fa90abfe4c3")],
    [BigInt("0x114ca50f7a8e2f3f657c1108d9d44cfd8"), BigInt("0x3086d221a7d46bcde86c90e49284eb15")]
  ]
};
var _2n3 = /* @__PURE__ */ BigInt(2);
function sqrtMod(y) {
  const P = secp256k1_CURVE.p;
  const _3n32 = BigInt(3), _6n = BigInt(6), _11n = BigInt(11), _22n = BigInt(22);
  const _23n = BigInt(23), _44n = BigInt(44), _88n = BigInt(88);
  const b2 = y * y * y % P;
  const b3 = b2 * b2 * y % P;
  const b6 = pow2(b3, _3n32, P) * b3 % P;
  const b9 = pow2(b6, _3n32, P) * b3 % P;
  const b11 = pow2(b9, _2n3, P) * b2 % P;
  const b22 = pow2(b11, _11n, P) * b11 % P;
  const b44 = pow2(b22, _22n, P) * b22 % P;
  const b88 = pow2(b44, _44n, P) * b44 % P;
  const b176 = pow2(b88, _88n, P) * b88 % P;
  const b220 = pow2(b176, _44n, P) * b44 % P;
  const b223 = pow2(b220, _3n32, P) * b3 % P;
  const t1 = pow2(b223, _23n, P) * b22 % P;
  const t2 = pow2(t1, _6n, P) * b2 % P;
  const root = pow2(t2, _2n3, P);
  if (!Fpk1.eql(Fpk1.sqr(root), y))
    throw new Error("Cannot find square root");
  return root;
}
var Fpk1 = Field(secp256k1_CURVE.p, { sqrt: sqrtMod });
var Pointk1 = /* @__PURE__ */ weierstrass(secp256k1_CURVE, {
  Fp: Fpk1,
  endo: secp256k1_ENDO
});
var secp256k1 = /* @__PURE__ */ ecdsa(Pointk1, sha256);
var _0n5 = BigInt(0);
var _1n5 = BigInt(1);
var _2n4 = BigInt(2);
var _7n2 = BigInt(7);
var _256n = BigInt(256);
var _0x71n = BigInt(113);
var SHA3_PI = [];
var SHA3_ROTL = [];
var _SHA3_IOTA = [];
for (let round = 0, R = _1n5, x = 1, y = 0; round < 24; round++) {
  [x, y] = [y, (2 * x + 3 * y) % 5];
  SHA3_PI.push(2 * (5 * y + x));
  SHA3_ROTL.push((round + 1) * (round + 2) / 2 % 64);
  let t = _0n5;
  for (let j = 0; j < 7; j++) {
    R = (R << _1n5 ^ (R >> _7n2) * _0x71n) % _256n;
    if (R & _2n4)
      t ^= _1n5 << (_1n5 << BigInt(j)) - _1n5;
  }
  _SHA3_IOTA.push(t);
}
var IOTAS = split(_SHA3_IOTA, true);
var SHA3_IOTA_H = IOTAS[0];
var SHA3_IOTA_L = IOTAS[1];
var rotlH = (h, l, s) => s > 32 ? rotlBH(h, l, s) : rotlSH(h, l, s);
var rotlL = (h, l, s) => s > 32 ? rotlBL(h, l, s) : rotlSL(h, l, s);
function keccakP(s, rounds = 24) {
  anumber(rounds, "rounds");
  if (rounds < 1 || rounds > 24)
    throw new Error('"rounds" expected integer 1..24');
  const B = new Uint32Array(5 * 2);
  for (let round = 24 - rounds; round < 24; round++) {
    for (let x = 0; x < 10; x++)
      B[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
    for (let x = 0; x < 10; x += 2) {
      const idx1 = (x + 8) % 10;
      const idx0 = (x + 2) % 10;
      const B0 = B[idx0];
      const B1 = B[idx0 + 1];
      const Th = rotlH(B0, B1, 1) ^ B[idx1];
      const Tl = rotlL(B0, B1, 1) ^ B[idx1 + 1];
      for (let y = 0; y < 50; y += 10) {
        s[x + y] ^= Th;
        s[x + y + 1] ^= Tl;
      }
    }
    let curH = s[2];
    let curL = s[3];
    for (let t = 0; t < 24; t++) {
      const shift = SHA3_ROTL[t];
      const Th = rotlH(curH, curL, shift);
      const Tl = rotlL(curH, curL, shift);
      const PI = SHA3_PI[t];
      curH = s[PI];
      curL = s[PI + 1];
      s[PI] = Th;
      s[PI + 1] = Tl;
    }
    for (let y = 0; y < 50; y += 10) {
      const b0 = s[y], b1 = s[y + 1], b2 = s[y + 2], b3 = s[y + 3];
      s[y] ^= ~s[y + 2] & s[y + 4];
      s[y + 1] ^= ~s[y + 3] & s[y + 5];
      s[y + 2] ^= ~s[y + 4] & s[y + 6];
      s[y + 3] ^= ~s[y + 5] & s[y + 7];
      s[y + 4] ^= ~s[y + 6] & s[y + 8];
      s[y + 5] ^= ~s[y + 7] & s[y + 9];
      s[y + 6] ^= ~s[y + 8] & b0;
      s[y + 7] ^= ~s[y + 9] & b1;
      s[y + 8] ^= ~b0 & b2;
      s[y + 9] ^= ~b1 & b3;
    }
    s[0] ^= SHA3_IOTA_H[round];
    s[1] ^= SHA3_IOTA_L[round];
  }
  clean(B);
}
var Keccak = class _Keccak {
  state;
  pos = 0;
  posOut = 0;
  finished = false;
  state32;
  destroyed = false;
  blockLen;
  suffix;
  outputLen;
  canXOF;
  enableXOF = false;
  rounds;
  // NOTE: we accept arguments in bytes instead of bits here.
  constructor(blockLen, suffix, outputLen, enableXOF = false, rounds = 24) {
    this.blockLen = blockLen;
    this.suffix = suffix;
    this.outputLen = outputLen;
    this.enableXOF = enableXOF;
    this.canXOF = enableXOF;
    this.rounds = rounds;
    anumber(outputLen, "outputLen");
    if (!(0 < blockLen && blockLen < 200))
      throw new Error("only keccak-f1600 function is supported");
    this.state = new Uint8Array(200);
    this.state32 = u32(this.state);
  }
  clone() {
    return this._cloneInto();
  }
  keccak() {
    swap32IfBE(this.state32);
    keccakP(this.state32, this.rounds);
    swap32IfBE(this.state32);
    this.posOut = 0;
    this.pos = 0;
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { blockLen, state: state2 } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      for (let i = 0; i < take; i++)
        state2[this.pos++] ^= data[pos++];
      if (this.pos === blockLen)
        this.keccak();
    }
    return this;
  }
  finish() {
    if (this.finished)
      return;
    this.finished = true;
    const { state: state2, suffix, pos, blockLen } = this;
    state2[pos] ^= suffix;
    if ((suffix & 128) !== 0 && pos === blockLen - 1)
      this.keccak();
    state2[blockLen - 1] ^= 128;
    this.keccak();
  }
  writeInto(out) {
    aexists(this, false);
    abytes(out);
    this.finish();
    const bufferOut = this.state;
    const { blockLen } = this;
    for (let pos = 0, len = out.length; pos < len; ) {
      if (this.posOut >= blockLen)
        this.keccak();
      const take = Math.min(blockLen - this.posOut, len - pos);
      out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
      this.posOut += take;
      pos += take;
    }
    return out;
  }
  xofInto(out) {
    if (!this.enableXOF)
      throw new Error("XOF is not possible for this instance");
    return this.writeInto(out);
  }
  xof(bytes) {
    anumber(bytes);
    return this.xofInto(new Uint8Array(bytes));
  }
  digestInto(out) {
    aoutput(out, this);
    if (this.finished)
      throw new Error("digest() was already called");
    this.writeInto(out.subarray(0, this.outputLen));
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.outputLen);
    this.digestInto(out);
    return out;
  }
  destroy() {
    this.destroyed = true;
    clean(this.state);
  }
  _cloneInto(to) {
    const { blockLen, suffix, outputLen, rounds, enableXOF } = this;
    to ||= new _Keccak(blockLen, suffix, outputLen, enableXOF, rounds);
    to.blockLen = blockLen;
    to.state32.set(this.state32);
    to.pos = this.pos;
    to.posOut = this.posOut;
    to.finished = this.finished;
    to.rounds = rounds;
    to.suffix = suffix;
    to.outputLen = outputLen;
    to.enableXOF = enableXOF;
    to.canXOF = this.canXOF;
    to.destroyed = this.destroyed;
    return to;
  }
};
var genKeccak = (suffix, blockLen, outputLen, info = {}) => createHasher(() => new Keccak(blockLen, suffix, outputLen), info);
var keccak_256 = /* @__PURE__ */ genKeccak(1, 136, 32);
var MAX_REQUEST_LIFETIME_MS = 5 * 60 * 1e3;
var CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function walletIdentityFromPublicKey(publicKeyHex) {
  const point = secp256k1.Point.fromBytes(hexToBytes(publicKeyHex));
  const digest3 = keccak_256(point.toBytes(false).slice(1));
  return encodeYNX(digest3.slice(-20));
}
function encodeYNX(payload) {
  const data = convertBits(payload, 8, 5, true);
  const values = [...hrpExpand("ynx"), ...data, 0, 0, 0, 0, 0, 0];
  const checksum2 = polymod(values) ^ 1;
  const tail = Array.from({ length: 6 }, (_, index) => checksum2 >>> 5 * (5 - index) & 31);
  return `ynx1${[...data, ...tail].map((item) => CHARSET[item]).join("")}`;
}
function convertBits(data, fromBits, toBits, pad) {
  let accumulator = 0, bits = 0;
  const result = [], maxValue = (1 << toBits) - 1, maxAccumulator = (1 << fromBits + toBits - 1) - 1;
  for (const value of data) {
    accumulator = (accumulator << fromBits | value) & maxAccumulator;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push(accumulator >> bits & maxValue);
    }
  }
  if (pad && bits > 0) result.push(accumulator << toBits - bits & maxValue);
  return result;
}
function hrpExpand(hrp) {
  return [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
}
function polymod(values) {
  const generators = [996825010, 642813549, 513874426, 1027748829, 705979059];
  let checksum2 = 1;
  for (const value of values) {
    const top = checksum2 >>> 25;
    checksum2 = ((checksum2 & 33554431) << 5 ^ value) >>> 0;
    generators.forEach((generator, index) => {
      if (top >>> index & 1) checksum2 = (checksum2 ^ generator) >>> 0;
    });
  }
  return checksum2 >>> 0;
}
var FINANCE_FINITE_CONSENT_PROFILE = "finance-private-finite-v1";
var FINANCE_FINITE_CONSENT_DEFAULT_SECONDS = 7200;
var FINANCE_FINITE_CONSENT_MAX_SECONDS = 7200;
var FIELDS = ["profile", "issuedAt", "expiresAt", "durationSeconds"];
var SCOPES = /* @__PURE__ */ new Set(["finance.ai.draft", "finance.pay.read", "finance.portfolio.read", "finance.profile.write"]);
var PLATFORMS = /* @__PURE__ */ new Set(["android", "ios", "linux", "macos", "web", "windows"]);
function createFinanceFiniteServiceConsent(context, durationSeconds = FINANCE_FINITE_CONSENT_DEFAULT_SECONDS) {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 300 || durationSeconds > FINANCE_FINITE_CONSENT_MAX_SECONDS) fail2("INVALID_SERVICE_CONSENT_TIME");
  const issued = iso(context.issuedAt);
  return parseFinanceFiniteServiceConsent(context, {
    profile: FINANCE_FINITE_CONSENT_PROFILE,
    issuedAt: issued,
    expiresAt: new Date(Date.parse(issued) + durationSeconds * 1e3).toISOString(),
    durationSeconds
  }, { requestIssuedAt: issued });
}
function parseFinanceFiniteServiceConsent(context, input, { requestIssuedAt } = {}) {
  exactFields(input, FIELDS, "Finite Product Session service consent");
  if (input.profile !== FINANCE_FINITE_CONSENT_PROFILE) fail2("UNKNOWN_SERVICE_CONSENT_PROFILE");
  const web = context.platform === "web";
  if (context.chainId !== "ynx_6423-1" || context.productId !== "finance" || context.clientId !== "ynx-finance-v1" || !PLATFORMS.has(context.platform) || context.applicationId !== (web ? "com.ynxweb4.finance.web" : "com.ynxweb4.finance") || context.origin !== (web ? "https://finance.ynxweb4.com" : `app://${context.platform}/com.ynxweb4.finance`) || context.callback !== (web ? "https://finance.ynxweb4.com/wallet-auth/callback" : "ynxfinance://wallet-auth/callback") || !Array.isArray(context.scopes) || !context.scopes.length || context.scopes.some((scope2) => !SCOPES.has(scope2))) fail2("SERVICE_CONSENT_BINDING_MISMATCH");
  const issuedAt = iso(input.issuedAt), expiresAt = iso(input.expiresAt);
  if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 300 || input.durationSeconds > FINANCE_FINITE_CONSENT_MAX_SECONDS || Date.parse(expiresAt) - Date.parse(issuedAt) !== input.durationSeconds * 1e3 || requestIssuedAt !== void 0 && issuedAt !== requestIssuedAt) fail2("INVALID_SERVICE_CONSENT_TIME");
  return Object.freeze({ profile: input.profile, issuedAt, expiresAt, durationSeconds: input.durationSeconds });
}
function iso(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail2("INVALID_SERVICE_CONSENT_TIME");
  return value;
}
function fail2(code) {
  throw new WalletAuthError(code, "Finite private service consent is outside the reviewed Finance policy");
}
var PRODUCT_SESSION_PROTOCOL_VERSION = "2";
var PRODUCT_SESSION_AUTHORITY_SCHEMA_VERSION = 2;
var REQUEST_MAX_LIFETIME_MS = 5 * 6e4;
var CHALLENGE_MAX_LIFETIME_MS = 6e4;
var REQUEST_FIELDS = [
  "version",
  "chainId",
  "productId",
  "clientId",
  "platform",
  "applicationId",
  "bundleId",
  "packageId",
  "origin",
  "callback",
  "deviceId",
  "deviceAlgorithm",
  "deviceKey",
  "nonce",
  "state",
  "scopes",
  "purpose",
  "issuedAt",
  "expiresAt"
];
var APPROVAL_FIELDS = [
  "version",
  "result",
  "requestDigest",
  "chainId",
  "productId",
  "clientId",
  "platform",
  "applicationId",
  "bundleId",
  "packageId",
  "origin",
  "callback",
  "deviceId",
  "deviceAlgorithm",
  "deviceKey",
  "nonce",
  "state",
  "account",
  "accountPublicKey",
  "scopes",
  "issuedAt",
  "expiresAt",
  "walletSignature"
];
var CHALLENGE_FIELDS = [
  "version",
  "challenge",
  "requestDigest",
  "approvalDigest",
  "chainId",
  "productId",
  "clientId",
  "platform",
  "applicationId",
  "bundleId",
  "packageId",
  "origin",
  "callback",
  "deviceId",
  "deviceAlgorithm",
  "deviceKey",
  "nonce",
  "state",
  "account",
  "scopes",
  "issuedAt",
  "expiresAt",
  "sessionExpiresAt"
];
var COMPLETION_FIELDS = ["challenge", "deviceSignature"];
var SESSION_FIELDS = [
  "version",
  "sessionBinding",
  "chainId",
  "productId",
  "clientId",
  "platform",
  "applicationId",
  "bundleId",
  "packageId",
  "origin",
  "callback",
  "account",
  "deviceId",
  "deviceAlgorithm",
  "deviceKey",
  "deviceBinding",
  "nonce",
  "state",
  "scopes",
  "requestDigest",
  "approvalDigest",
  "issuedAt",
  "expiresAt"
];
var SNAPSHOT_FIELDS = ["schemaVersion", "sessions", "issuedChallenges", "consumedNonces", "consumedStates", "consumedRequests", "consumedChallenges", "revokedSessions", "revokedDevices", "revokedAccounts"];
function createProductSessionRequest(registryInput, input, at = /* @__PURE__ */ new Date()) {
  exactFields(input, ["productId", "platform", "deviceId", "deviceKey", "scopes", "purpose", "nonce", "state", ...Object.hasOwn(input, "finiteServiceSeconds") ? ["finiteServiceSeconds"] : []], "Product Session request input");
  const binding = productPlatformBinding(registryInput, input.productId, input.platform);
  const now = validDate(at);
  const request = {
    version: PRODUCT_SESSION_PROTOCOL_VERSION,
    chainId: binding.chainId,
    productId: binding.productId,
    clientId: binding.clientId,
    platform: binding.platform,
    applicationId: binding.applicationId,
    bundleId: binding.bundleId,
    packageId: binding.packageId,
    origin: binding.origin,
    callback: binding.callback,
    deviceId: opaque(input.deviceId, "deviceId"),
    deviceAlgorithm: "p256-sha256",
    deviceKey: deviceKey(input.deviceKey),
    nonce: token(input.nonce, "nonce"),
    state: token(input.state, "state"),
    scopes: scopes(input.scopes, binding.scopes),
    purpose: text2(input.purpose, "purpose", 1, 180),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + REQUEST_MAX_LIFETIME_MS).toISOString()
  };
  if (Object.hasOwn(input, "finiteServiceSeconds")) request.serviceConsent = createFinanceFiniteServiceConsent(request, input.finiteServiceSeconds);
  return parseProductSessionRequest(registryInput, request, now);
}
function parseProductSessionRequest(registryInput, input, at = /* @__PURE__ */ new Date()) {
  exactFields(input, consentFields(input, REQUEST_FIELDS), "Product Session request");
  const now = validDate(at);
  if (input.version !== PRODUCT_SESSION_PROTOCOL_VERSION || input.chainId !== "ynx_6423-1" || !PRODUCT_SESSION_PLATFORMS.includes(input.platform)) fail3("INVALID_SESSION_REQUEST", "Product Session protocol, chain or platform is unsupported");
  const binding = productPlatformBinding(registryInput, input.productId, input.platform);
  const request = Object.freeze({
    version: input.version,
    chainId: input.chainId,
    productId: pattern2(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/),
    clientId: pattern2(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/),
    platform: input.platform,
    applicationId: pattern2(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/),
    bundleId: platformIdentity(input.bundleId, "bundleId"),
    packageId: platformIdentity(input.packageId, "packageId"),
    origin: canonicalOrigin(input.origin),
    callback: canonicalCallback(input.callback),
    deviceId: opaque(input.deviceId, "deviceId"),
    deviceAlgorithm: pattern2(input.deviceAlgorithm, "deviceAlgorithm", /^p256-sha256$/),
    deviceKey: deviceKey(input.deviceKey),
    nonce: token(input.nonce, "nonce"),
    state: token(input.state, "state"),
    scopes: Object.freeze(scopes(input.scopes, binding.scopes)),
    purpose: text2(input.purpose, "purpose", 1, 180),
    ...parseConsent(input, input.issuedAt),
    issuedAt: time(input.issuedAt, "issuedAt"),
    expiresAt: time(input.expiresAt, "expiresAt")
  });
  validatePlatformIdentifiers(request);
  for (const field of ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback"]) {
    if (request[field] !== binding[field]) fail3("SESSION_BINDING_MISMATCH", `Product Session request ${field} does not match the registry`);
  }
  const issued = Date.parse(request.issuedAt), expires = Date.parse(request.expiresAt);
  if (expires <= issued || expires - issued > REQUEST_MAX_LIFETIME_MS) fail3("INVALID_EXPIRY", "Product Session request lifetime is invalid");
  if (issued > now.getTime() + 3e4) fail3("ISSUED_IN_FUTURE", "Product Session request was issued in the future");
  if (expires <= now.getTime()) fail3("SESSION_EXPIRED", "Product Session request expired");
  return request;
}
function productSessionRequestDigest(registryInput, request, at = /* @__PURE__ */ new Date()) {
  return digestHex("YNX_PRODUCT_SESSION_REQUEST_V2", parseProductSessionRequest(registryInput, request, at));
}
function parseProductSessionApproval(registryInput, requestInput, input, at = /* @__PURE__ */ new Date()) {
  const request = parseProductSessionRequest(registryInput, requestInput, at);
  exactFields(input, [...APPROVAL_FIELDS, ...request.serviceConsent ? ["serviceConsent"] : []], "Product Session approval");
  const approval = Object.freeze({
    ...input,
    version: pattern2(input.version, "version", /^2$/),
    result: pattern2(input.result, "result", /^approved$/),
    requestDigest: digest(input.requestDigest, "requestDigest"),
    productId: pattern2(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/),
    clientId: pattern2(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/),
    applicationId: pattern2(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/),
    bundleId: platformIdentity(input.bundleId, "bundleId"),
    packageId: platformIdentity(input.packageId, "packageId"),
    origin: canonicalOrigin(input.origin),
    callback: canonicalCallback(input.callback),
    deviceId: opaque(input.deviceId, "deviceId"),
    deviceAlgorithm: pattern2(input.deviceAlgorithm, "deviceAlgorithm", /^p256-sha256$/),
    deviceKey: deviceKey(input.deviceKey),
    nonce: token(input.nonce, "nonce"),
    state: token(input.state, "state"),
    account: pattern2(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/),
    accountPublicKey: pattern2(input.accountPublicKey, "accountPublicKey", /^(02|03)[0-9a-f]{64}$/),
    scopes: Object.freeze(scopes(input.scopes, request.scopes)),
    ...parseConsent(input, request.issuedAt),
    issuedAt: time(input.issuedAt, "issuedAt"),
    expiresAt: time(input.expiresAt, "expiresAt"),
    walletSignature: pattern2(input.walletSignature, "walletSignature", /^[0-9a-f]{128}$/)
  });
  validatePlatformIdentifiers(approval);
  if (canonicalJSON(approval.serviceConsent ?? null) !== canonicalJSON(request.serviceConsent ?? null)) fail3("SERVICE_CONSENT_BINDING_MISMATCH", "Wallet service consent differs from the signed request");
  const boundFields = ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback", "deviceId", "deviceAlgorithm", "deviceKey", "nonce", "state"];
  if (approval.requestDigest !== productSessionRequestDigest(registryInput, request, at) || boundFields.some((field) => approval[field] !== request[field]) || approval.scopes.join("\n") !== request.scopes.join("\n")) fail3("SESSION_BINDING_MISMATCH", "Wallet approval does not match the exact Product Session request");
  if (approval.issuedAt < request.issuedAt || approval.issuedAt > validDate(at).toISOString() || approval.expiresAt > request.expiresAt || approval.expiresAt <= validDate(at).toISOString()) fail3("INVALID_APPROVAL_TIME", "Wallet approval is outside the request lifetime");
  let valid = false;
  try {
    valid = secp256k1.verify(hexToBytes(approval.walletSignature), sha256(utf8ToBytes(approvalSignBytes2(unsignedApproval2(approval)))), hexToBytes(approval.accountPublicKey), { prehash: false, format: "compact", lowS: true });
  } catch {
    valid = false;
  }
  if (!valid || walletIdentityFromPublicKey(approval.accountPublicKey) !== approval.account) fail3("INVALID_SIGNATURE", "Wallet approval signature is invalid");
  return approval;
}
function createProductSessionChallenge(registryInput, requestInput, approvalInput, input, at = /* @__PURE__ */ new Date()) {
  exactFields(input, ["challenge"], "Product Session challenge input");
  const request = parseProductSessionRequest(registryInput, requestInput, at);
  const approval = parseProductSessionApproval(registryInput, request, approvalInput, at);
  const binding = productPlatformBinding(registryInput, request.productId, request.platform);
  const now = validDate(at);
  const expiresAt = new Date(Math.min(now.getTime() + CHALLENGE_MAX_LIFETIME_MS, Date.parse(approval.expiresAt))).toISOString();
  const sessionExpiresAt = request.serviceConsent ? request.serviceConsent.expiresAt : new Date(Math.min(Date.parse(approval.expiresAt), now.getTime() + binding.sessionDurationSeconds * 1e3)).toISOString();
  return parseChallenge({
    version: PRODUCT_SESSION_PROTOCOL_VERSION,
    ...parseConsent(request, request.issuedAt),
    challenge: token(input.challenge, "challenge"),
    requestDigest: approval.requestDigest,
    approvalDigest: productSessionApprovalDigest(approval),
    chainId: request.chainId,
    productId: request.productId,
    clientId: request.clientId,
    platform: request.platform,
    applicationId: request.applicationId,
    bundleId: request.bundleId,
    packageId: request.packageId,
    origin: request.origin,
    callback: request.callback,
    deviceId: request.deviceId,
    deviceAlgorithm: request.deviceAlgorithm,
    deviceKey: request.deviceKey,
    nonce: request.nonce,
    state: request.state,
    account: approval.account,
    scopes: approval.scopes,
    issuedAt: now.toISOString(),
    expiresAt,
    sessionExpiresAt
  });
}
function signProductSessionChallenge(challengeInput, deviceSecretInput) {
  const challenge = parseChallenge(challengeInput);
  const secret = deviceSecret(deviceSecretInput);
  if (encodeBase64url(p256.getPublicKey(secret, true)) !== challenge.deviceKey) fail3("DEVICE_CHANGED", "Product device key changed before session completion");
  const signature = p256.sign(utf8ToBytes(challengeSignBytes(challenge)), secret, { format: "der" });
  return Object.freeze({ challenge, deviceSignature: encodeBase64url(signature) });
}
async function signProductSessionChallengeWith(challengeInput, signer) {
  const challenge = parseChallenge(challengeInput);
  if (typeof signer !== "function") fail3("INVALID_DEVICE", "Product Session requires a platform device signer");
  const payload = encodeBase64url(utf8ToBytes(challengeSignBytes(challenge)));
  let deviceSignature;
  try {
    deviceSignature = await signer(Object.freeze({ purpose: "challenge", algorithm: "p256-sha256", deviceKey: challenge.deviceKey, payload }));
  } catch {
    fail3("DEVICE_SIGNING_FAILED", "Platform device signing failed closed");
  }
  if (typeof deviceSignature !== "string") fail3("INVALID_DEVICE_PROOF", "Platform device signature is invalid");
  let valid = false;
  try {
    valid = p256.verify(decodeBase64url(deviceSignature, "deviceSignature"), decodeBase64url(payload, "device signing payload"), decodeBase64url(challenge.deviceKey, "deviceKey"), { format: "der", lowS: false });
  } catch {
    valid = false;
  }
  if (!valid) fail3("INVALID_DEVICE_PROOF", "Platform device signature does not match the registered device key");
  return Object.freeze({ challenge, deviceSignature });
}
function parseProductSessionChallenge(input) {
  return parseChallenge(input);
}
var ProductSessionAuthority = class {
  #registry;
  #state;
  constructor(registryInput, snapshot = emptySnapshot()) {
    this.#registry = parseProductSessionRegistry(registryInput);
    this.#state = parseSnapshot(snapshot);
  }
  issueChallenge(input, at = /* @__PURE__ */ new Date()) {
    exactFields(input, ["request", "approval", "challenge"], "Product Session challenge issuance");
    const request = parseProductSessionRequest(this.#registry, input.request, at);
    const approval = parseProductSessionApproval(this.#registry, request, input.approval, at);
    this.#assertApprovalNotRevoked(request, approval);
    if (this.#state.consumedRequests.includes(approval.requestDigest)) fail3("REPLAY", "Product Session request already completed; recover its original completion or obtain a new Wallet approval");
    const challenge = createProductSessionChallenge(this.#registry, request, approval, { challenge: input.challenge }, at);
    if (this.#state.issuedChallenges.some((item) => item.challenge === challenge.challenge) || this.#state.consumedChallenges.includes(challenge.challenge)) fail3("REPLAY", "Product Session challenge already exists");
    const next = clone(this.#state);
    next.issuedChallenges.push(challenge);
    sortSnapshot(next);
    this.#state = parseSnapshot(next);
    return challenge;
  }
  complete(input, at = /* @__PURE__ */ new Date()) {
    exactFields(input, ["request", "approval", "completion"], "Product Session completion");
    const request = parseProductSessionRequest(this.#registry, input.request, at);
    const approval = parseProductSessionApproval(this.#registry, request, input.approval, at);
    this.#assertApprovalNotRevoked(request, approval);
    exactFields(input.completion, COMPLETION_FIELDS, "Product Session device completion");
    const challenge = parseChallenge(input.completion.challenge);
    const expected = createProductSessionChallenge(this.#registry, request, approval, { challenge: challenge.challenge }, new Date(challenge.issuedAt));
    if (canonicalJSON(challenge) !== canonicalJSON(expected)) fail3("SESSION_BINDING_MISMATCH", "Gateway challenge fields were substituted");
    const issued = this.#state.issuedChallenges.find((item) => item.challenge === challenge.challenge);
    if (!issued || canonicalJSON(issued) !== canonicalJSON(challenge)) fail3("CHALLENGE_NOT_ISSUED", "Product Session challenge was not issued by this Gateway");
    if (challenge.expiresAt <= validDate(at).toISOString()) fail3("SESSION_EXPIRED", "Product Session challenge expired");
    let valid = false;
    try {
      valid = p256.verify(decodeBase64url(input.completion.deviceSignature, "deviceSignature"), utf8ToBytes(challengeSignBytes(challenge)), decodeBase64url(challenge.deviceKey, "deviceKey"), { format: "der", lowS: false });
    } catch {
      valid = false;
    }
    if (!valid) fail3("INVALID_DEVICE_PROOF", "Product Session device proof is invalid");
    if (this.#state.consumedNonces.includes(request.nonce) || this.#state.consumedStates.includes(request.state) || this.#state.consumedRequests.includes(approval.requestDigest) || this.#state.consumedChallenges.includes(challenge.challenge)) fail3("REPLAY", "Product Session request, state or challenge was already consumed");
    const session = parseSession({
      version: PRODUCT_SESSION_PROTOCOL_VERSION,
      sessionBinding: digestHex("YNX_PRODUCT_SESSION_BINDING_V2", challenge),
      chainId: request.chainId,
      productId: request.productId,
      clientId: request.clientId,
      platform: request.platform,
      applicationId: request.applicationId,
      bundleId: request.bundleId,
      packageId: request.packageId,
      origin: request.origin,
      callback: request.callback,
      account: approval.account,
      deviceId: request.deviceId,
      deviceAlgorithm: request.deviceAlgorithm,
      deviceKey: request.deviceKey,
      deviceBinding: deviceBinding(request, approval.account),
      nonce: request.nonce,
      state: request.state,
      scopes: approval.scopes,
      requestDigest: approval.requestDigest,
      approvalDigest: challenge.approvalDigest,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.sessionExpiresAt,
      ...parseConsent(request, request.issuedAt)
    });
    const next = clone(this.#state);
    next.issuedChallenges = next.issuedChallenges.filter((item) => item.challenge !== challenge.challenge);
    next.sessions.push(session);
    next.consumedNonces.push(request.nonce);
    next.consumedStates.push(request.state);
    next.consumedRequests.push(approval.requestDigest);
    next.consumedChallenges.push(challenge.challenge);
    sortSnapshot(next);
    this.#state = parseSnapshot(next);
    return session;
  }
  introspect(sessionBindingInput, context, at = /* @__PURE__ */ new Date()) {
    exactFields(context, ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback", "account", "deviceId", "deviceKey", "requiredScopes"], "Product Session introspection context");
    const session = this.#state.sessions.find((item) => item.sessionBinding === digest(sessionBindingInput, "sessionBinding"));
    if (!session) fail3("SESSION_NOT_FOUND", "Product Session was not found");
    const now = validDate(at).toISOString();
    if (session.issuedAt > now) fail3("ISSUED_IN_FUTURE", "Product Session was issued in the future");
    if (session.expiresAt <= now) fail3("SESSION_EXPIRED", "Product Session expired");
    if (this.#state.revokedSessions.includes(session.sessionBinding) || this.#state.revokedDevices.includes(session.deviceBinding) || this.#state.revokedAccounts.some((item) => item.account === session.account && session.issuedAt <= item.before)) fail3("SESSION_REVOKED", "Product Session was revoked");
    validatePlatformIdentifiers(context, "CROSS_PRODUCT_SESSION");
    const exact = ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback", "account", "deviceId", "deviceKey"];
    if (exact.some((field) => context[field] !== session[field])) fail3("CROSS_PRODUCT_SESSION", "Product Session cannot cross product, account, origin, callback or device boundaries");
    const required = requiredScopes(context.requiredScopes, session.scopes);
    if (required.some((scope2) => !session.scopes.includes(scope2))) fail3("SCOPE_WIDENING", "Product Session scope cannot be widened");
    return Object.freeze({ active: true, session });
  }
  revokeSession(sessionBindingInput) {
    const value = digest(sessionBindingInput, "sessionBinding");
    if (!this.#state.sessions.some((item) => item.sessionBinding === value)) fail3("SESSION_NOT_FOUND", "Product Session was not found");
    this.#revoke("revokedSessions", value);
    return value;
  }
  revokeDevice(deviceBindingInput) {
    const value = digest(deviceBindingInput, "deviceBinding");
    this.#revoke("revokedDevices", value);
    return value;
  }
  revokeAccount(account2, at = /* @__PURE__ */ new Date()) {
    const record = { account: pattern2(account2, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), before: validDate(at).toISOString() };
    const previous = this.#state.revokedAccounts.find((item) => item.account === record.account);
    if (previous && previous.before >= record.before) return Object.freeze({ ...previous });
    const next = clone(this.#state);
    next.revokedAccounts = next.revokedAccounts.filter((item) => item.account !== record.account);
    next.revokedAccounts.push(record);
    sortSnapshot(next);
    this.#state = parseSnapshot(next);
    return Object.freeze(record);
  }
  snapshot() {
    return freezeSnapshot(clone(this.#state));
  }
  #assertApprovalNotRevoked(request, approval) {
    if (this.#state.revokedDevices.includes(deviceBinding(request, approval.account)) || this.#state.revokedAccounts.some((item) => item.account === approval.account && approval.issuedAt <= item.before)) fail3("SESSION_REVOKED", "Wallet approval or its product device binding was revoked");
  }
  #revoke(field, value) {
    if (this.#state[field].includes(value)) fail3("ALREADY_REVOKED", "Product Session revocation already exists");
    const next = clone(this.#state);
    next[field].push(value);
    sortSnapshot(next);
    this.#state = parseSnapshot(next);
  }
};
function parseProductSession(input) {
  return parseSession(input);
}
function productSessionApprovalDigest(approval) {
  return digestHex("YNX_PRODUCT_SESSION_APPROVAL_V2", approval);
}
function deviceBinding(requestOrSession, account2) {
  return digestHex("YNX_PRODUCT_SESSION_DEVICE_V2", { chainId: requestOrSession.chainId, productId: requestOrSession.productId, clientId: requestOrSession.clientId, platform: requestOrSession.platform, applicationId: requestOrSession.applicationId, bundleId: requestOrSession.bundleId, packageId: requestOrSession.packageId, origin: requestOrSession.origin, callback: requestOrSession.callback, account: account2, deviceId: requestOrSession.deviceId, deviceAlgorithm: requestOrSession.deviceAlgorithm, deviceKey: requestOrSession.deviceKey });
}
function parseChallenge(input) {
  exactFields(input, consentFields(input, CHALLENGE_FIELDS), "Product Session challenge");
  const value = Object.freeze({ ...input, ...parseConsent(input), version: pattern2(input.version, "version", /^2$/), challenge: token(input.challenge, "challenge"), requestDigest: digest(input.requestDigest, "requestDigest"), approvalDigest: digest(input.approvalDigest, "approvalDigest"), chainId: pattern2(input.chainId, "chainId", /^ynx_6423-1$/), productId: pattern2(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/), clientId: pattern2(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/), platform: pattern2(input.platform, "platform", /^(android|ios|linux|macos|web|windows)$/), applicationId: pattern2(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/), bundleId: platformIdentity(input.bundleId, "bundleId"), packageId: platformIdentity(input.packageId, "packageId"), origin: canonicalOrigin(input.origin), callback: canonicalCallback(input.callback), deviceId: opaque(input.deviceId, "deviceId"), deviceAlgorithm: pattern2(input.deviceAlgorithm, "deviceAlgorithm", /^p256-sha256$/), deviceKey: deviceKey(input.deviceKey), nonce: token(input.nonce, "nonce"), state: token(input.state, "state"), account: pattern2(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), scopes: Object.freeze(scopes(input.scopes, input.scopes)), issuedAt: time(input.issuedAt, "issuedAt"), expiresAt: time(input.expiresAt, "expiresAt"), sessionExpiresAt: time(input.sessionExpiresAt, "sessionExpiresAt") });
  validatePlatformIdentifiers(value);
  const serviceValid = value.serviceConsent ? value.sessionExpiresAt === value.serviceConsent.expiresAt && value.issuedAt >= value.serviceConsent.issuedAt && Date.parse(value.expiresAt) <= Date.parse(value.serviceConsent.issuedAt) + REQUEST_MAX_LIFETIME_MS : Date.parse(value.sessionExpiresAt) - Date.parse(value.issuedAt) <= REQUEST_MAX_LIFETIME_MS;
  if (value.expiresAt <= value.issuedAt || Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > CHALLENGE_MAX_LIFETIME_MS || value.sessionExpiresAt < value.expiresAt || !serviceValid) fail3("INVALID_EXPIRY", "Product Session challenge or session lifetime is invalid");
  return value;
}
function parseSession(input) {
  exactFields(input, consentFields(input, SESSION_FIELDS), "Product Session");
  const value = Object.freeze({ ...input, ...parseConsent(input), version: pattern2(input.version, "version", /^2$/), sessionBinding: digest(input.sessionBinding, "sessionBinding"), chainId: pattern2(input.chainId, "chainId", /^ynx_6423-1$/), productId: pattern2(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/), clientId: pattern2(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/), platform: pattern2(input.platform, "platform", /^(android|ios|linux|macos|web|windows)$/), applicationId: pattern2(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/), bundleId: platformIdentity(input.bundleId, "bundleId"), packageId: platformIdentity(input.packageId, "packageId"), origin: canonicalOrigin(input.origin), callback: canonicalCallback(input.callback), account: pattern2(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), deviceId: opaque(input.deviceId, "deviceId"), deviceAlgorithm: pattern2(input.deviceAlgorithm, "deviceAlgorithm", /^p256-sha256$/), deviceKey: deviceKey(input.deviceKey), deviceBinding: digest(input.deviceBinding, "deviceBinding"), nonce: token(input.nonce, "nonce"), state: token(input.state, "state"), scopes: Object.freeze(scopes(input.scopes, input.scopes)), requestDigest: digest(input.requestDigest, "requestDigest"), approvalDigest: digest(input.approvalDigest, "approvalDigest"), issuedAt: time(input.issuedAt, "issuedAt"), expiresAt: time(input.expiresAt, "expiresAt") });
  validatePlatformIdentifiers(value);
  if (value.serviceConsent && (value.expiresAt !== value.serviceConsent.expiresAt || value.issuedAt < value.serviceConsent.issuedAt || Date.parse(value.issuedAt) >= Date.parse(value.serviceConsent.issuedAt) + REQUEST_MAX_LIFETIME_MS)) fail3("INVALID_SERVICE_CONSENT_TIME", "Stored finite service session is outside its approved window");
  if (value.expiresAt <= value.issuedAt || value.deviceBinding !== deviceBinding(value, value.account)) fail3("INVALID_SESSION", "Product Session security binding or lifetime is invalid");
  return value;
}
function parseSnapshot(input) {
  exactFields(input, SNAPSHOT_FIELDS, "Product Session authority snapshot");
  if (input.schemaVersion !== PRODUCT_SESSION_AUTHORITY_SCHEMA_VERSION) fail3("INVALID_SESSION_STORE", "Product Session authority snapshot version is unsupported");
  const value = { schemaVersion: input.schemaVersion, sessions: sortedUnique(input.sessions.map(parseSession), (item) => item.sessionBinding, "sessions"), issuedChallenges: sortedUnique(input.issuedChallenges.map(parseChallenge), (item) => item.challenge, "issuedChallenges"), consumedNonces: stringSet(input.consumedNonces, /^[A-Za-z0-9_-]{32,64}$/, "consumedNonces"), consumedStates: stringSet(input.consumedStates, /^[A-Za-z0-9_-]{32,64}$/, "consumedStates"), consumedRequests: stringSet(input.consumedRequests, /^[0-9a-f]{64}$/, "consumedRequests"), consumedChallenges: stringSet(input.consumedChallenges, /^[A-Za-z0-9_-]{32,64}$/, "consumedChallenges"), revokedSessions: stringSet(input.revokedSessions, /^[0-9a-f]{64}$/, "revokedSessions"), revokedDevices: stringSet(input.revokedDevices, /^[0-9a-f]{64}$/, "revokedDevices"), revokedAccounts: sortedUnique(input.revokedAccounts.map((item) => {
    exactFields(item, ["account", "before"], "revoked account");
    return Object.freeze({ account: pattern2(item.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), before: time(item.before, "before") });
  }), (item) => item.account, "revokedAccounts") };
  if (value.sessions.length !== value.consumedNonces.length || value.sessions.length !== value.consumedStates.length || value.sessions.length !== value.consumedRequests.length || value.sessions.length !== value.consumedChallenges.length || value.issuedChallenges.some((item) => value.consumedChallenges.includes(item.challenge))) fail3("INVALID_SESSION_STORE", "Issued and consumed records must exactly cover Product Sessions without overlap");
  return freezeSnapshot(value);
}
function emptySnapshot() {
  return { schemaVersion: PRODUCT_SESSION_AUTHORITY_SCHEMA_VERSION, sessions: [], issuedChallenges: [], consumedNonces: [], consumedStates: [], consumedRequests: [], consumedChallenges: [], revokedSessions: [], revokedDevices: [], revokedAccounts: [] };
}
function sortSnapshot(value) {
  value.sessions.sort((a, b) => compareSnapshotKey(a.sessionBinding, b.sessionBinding));
  value.issuedChallenges.sort((a, b) => compareSnapshotKey(a.challenge, b.challenge));
  for (const field of ["consumedNonces", "consumedStates", "consumedRequests", "consumedChallenges", "revokedSessions", "revokedDevices"]) value[field].sort();
  value.revokedAccounts.sort((a, b) => compareSnapshotKey(a.account, b.account));
}
function compareSnapshotKey(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function freezeSnapshot(value) {
  return Object.freeze({ ...value, sessions: Object.freeze(value.sessions), issuedChallenges: Object.freeze(value.issuedChallenges), consumedNonces: Object.freeze(value.consumedNonces), consumedStates: Object.freeze(value.consumedStates), consumedRequests: Object.freeze(value.consumedRequests), consumedChallenges: Object.freeze(value.consumedChallenges), revokedSessions: Object.freeze(value.revokedSessions), revokedDevices: Object.freeze(value.revokedDevices), revokedAccounts: Object.freeze(value.revokedAccounts) });
}
function stringSet(value, regex, label) {
  if (!Array.isArray(value) || value.length > 1e4 || value.some((item) => typeof item !== "string" || !regex.test(item))) fail3("INVALID_SESSION_STORE", `${label} is invalid`);
  return sortedUnique(value, (item) => item, label);
}
function sortedUnique(value, key, label) {
  const keys = value.map(key);
  if (new Set(keys).size !== keys.length || [...keys].sort().join("\n") !== keys.join("\n")) fail3("INVALID_SESSION_STORE", `${label} must be unique and sorted`);
  return Object.freeze(value);
}
function consentFields(value, fields) {
  return [...fields, ...Object.hasOwn(value, "serviceConsent") ? ["serviceConsent"] : []];
}
function parseConsent(value, requestIssuedAt) {
  return Object.hasOwn(value, "serviceConsent") ? { serviceConsent: parseFinanceFiniteServiceConsent(value, value.serviceConsent, { requestIssuedAt }) } : {};
}
function unsignedApproval2(value) {
  const { walletSignature: _signature, ...unsigned } = value;
  return unsigned;
}
function approvalSignBytes2(value) {
  return `YNX_PRODUCT_SESSION_APPROVAL_V2
${canonicalJSON(value)}`;
}
function challengeSignBytes(value) {
  return `YNX_PRODUCT_SESSION_CHALLENGE_V2
${canonicalJSON(value)}`;
}
function scopes(value, allowlist) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) fail3("INVALID_SCOPES", "Product Session scopes are invalid");
  const result = value.map((item) => pattern2(item, "scope", /^[a-z][a-z0-9._:-]{1,63}$/));
  if (new Set(result).size !== result.length || [...result].sort().join("\n") !== result.join("\n") || result.some((item) => !allowlist.includes(item))) fail3("SCOPE_WIDENING", "Product Session scope is duplicated, unsorted or outside the registry");
  return result;
}
function requiredScopes(value, allowlist) {
  if (!Array.isArray(value) || value.length > 8) fail3("INVALID_SCOPES", "Required Product Session scopes are invalid");
  if (value.length === 0) return [];
  return scopes(value, allowlist);
}
function platformIdentity(value, label) {
  return value === null ? null : pattern2(value, label, /^[A-Za-z][A-Za-z0-9.-]{2,131}$/);
}
function validatePlatformIdentifiers(value, errorCode = "SESSION_BINDING_MISMATCH") {
  const expectsBundle = value.platform === "ios" || value.platform === "macos";
  const expectsPackage = value.platform === "android" || value.platform === "linux" || value.platform === "windows";
  if (value.bundleId !== null !== expectsBundle || value.packageId !== null !== expectsPackage || value.bundleId !== null && value.bundleId !== value.applicationId || value.packageId !== null && value.packageId !== value.applicationId) fail3(errorCode, "Product Session bundleId/packageId does not match its registered platform identity");
}
function canonicalOrigin(value) {
  const normalized = text2(value, "origin", 8, 512);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail3("INVALID_ORIGIN", "Product Session origin is invalid");
  }
  if (parsed.protocol === "https:" && parsed.origin === normalized && !parsed.port) return normalized;
  if (parsed.protocol === "app:" && /^app:\/\/(android|ios|linux|macos|windows)\/[A-Za-z][A-Za-z0-9.-]{2,127}$/.test(normalized)) return normalized;
  fail3("INVALID_ORIGIN", "Product Session origin must be an exact HTTPS or registered native origin");
}
function canonicalCallback(value) {
  const normalized = text2(value, "callback", 8, 512);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail3("CALLBACK_MISMATCH", "Product Session callback is invalid");
  }
  if (["data:", "file:", "http:", "javascript:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash || parsed.search || parsed.toString() !== normalized) fail3("CALLBACK_MISMATCH", "Product Session callback is unsafe or non-canonical");
  return normalized;
}
function deviceKey(value) {
  const normalized = pattern2(value, "deviceKey", /^[A-Za-z0-9_-]{44}$/);
  const bytes = decodeBase64url(normalized, "deviceKey");
  if (bytes.length !== 33 || encodeBase64url(bytes) !== normalized) fail3("INVALID_DEVICE_KEY", "Product Session device key is invalid");
  try {
    p256.Point.fromBytes(bytes);
  } catch {
    fail3("INVALID_DEVICE_KEY", "Product Session device key is not P-256");
  }
  return normalized;
}
function deviceSecret(value) {
  const bytes = decodeBase64url(value, "deviceSecret");
  if (bytes.length !== 32 || !p256.utils.isValidSecretKey(bytes)) fail3("INVALID_SECRET", "Product device secret is invalid");
  return bytes;
}
function token(value, label) {
  return pattern2(value, label, /^[A-Za-z0-9_-]{32,64}$/);
}
function opaque(value, label) {
  return pattern2(value, label, /^[A-Za-z0-9._:-]{8,128}$/);
}
function digest(value, label) {
  return pattern2(value, label, /^[0-9a-f]{64}$/);
}
function pattern2(value, label, regex) {
  const normalized = text2(value, label, 1, 512);
  if (!regex.test(normalized)) fail3("INVALID_FIELD", `${label} is invalid`);
  return normalized;
}
function text2(value, label, minimum, maximum) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum || value.trim() !== value) fail3("INVALID_FIELD", `${label} is invalid`);
  return value;
}
function time(value, label) {
  const normalized = pattern2(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) fail3("INVALID_TIME", `${label} is invalid`);
  return normalized;
}
function validDate(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail3("INVALID_TIME", "Product Session time is invalid");
  return value;
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function fail3(code, message) {
  throw new WalletAuthError(code, message);
}
var REGISTRY_V2_FIELDS = ["schemaVersion", "productClientId", "requestingProduct", "bundleId", "callbacks", "scopes", "maxScopes", "productDeviceAlgorithms"];
var REGISTRY_V3_FIELDS = [...REGISTRY_V2_FIELDS, "origins"];
var SESSION_V1_BASE_FIELDS = [
  "verifierVersion",
  "sessionBinding",
  "chainId",
  "requestingProduct",
  "productClientId",
  "bundleId",
  "callback",
  "productDeviceAlgorithm",
  "productDeviceKey",
  "deviceBinding",
  "account",
  "scopes",
  "nonce",
  "purpose",
  "requestDigest",
  "approvalDigest",
  "issuedAt",
  "expiresAt"
];
var SESSION_V1_FIELDS = [...SESSION_V1_BASE_FIELDS, "accountPublicKey"];
function httpBodyDigest(body) {
  if (typeof body !== "string" && !(body instanceof Uint8Array)) fail4("INVALID_BODY", "HTTP proof body must be a string or bytes");
  return bytesToHex(sha256(typeof body === "string" ? utf8ToBytes(body) : body));
}
function fail4(code, message) {
  throw new WalletAuthError(code, message);
}
var PROOF_FIELDS = ["version", "sessionBinding", "productId", "clientId", "applicationId", "bundleId", "packageId", "origin", "callback", "account", "deviceId", "deviceKey", "method", "path", "bodyDigest", "nonce", "issuedAt", "expiresAt", "signature"];
var INPUT_FIELDS = ["method", "path", "bodyDigest", "nonce", "issuedAt", "expiresAt"];
function createProductSessionProofV2(sessionInput, input, deviceSecretInput) {
  const session = parseProductSession(sessionInput);
  exactFields(input, INPUT_FIELDS, "Product Session v2 proof input");
  const secret = decodeBase64url(deviceSecretInput, "deviceSecret");
  if (secret.length !== 32 || encodeBase64url(p256.getPublicKey(secret, true)) !== session.deviceKey) fail5("DEVICE_CHANGED", "Product Session proof device changed");
  const unsigned = parseUnsigned({ version: "2", sessionBinding: session.sessionBinding, productId: session.productId, clientId: session.clientId, applicationId: session.applicationId, bundleId: session.bundleId, packageId: session.packageId, origin: session.origin, callback: session.callback, account: session.account, deviceId: session.deviceId, deviceKey: session.deviceKey, ...input });
  const signature = encodeBase64url(p256.sign(utf8ToBytes(productSessionProofV2SignBytes(unsigned)), secret, { format: "der" }));
  return parseProductSessionProofV2({ ...unsigned, signature });
}
async function createProductSessionProofV2With(sessionInput, input, signer) {
  const session = parseProductSession(sessionInput);
  exactFields(input, INPUT_FIELDS, "Product Session v2 proof input");
  if (typeof signer !== "function") fail5("INVALID_DEVICE", "Product Session proof requires a platform device signer");
  const unsigned = parseUnsigned({ version: "2", sessionBinding: session.sessionBinding, productId: session.productId, clientId: session.clientId, applicationId: session.applicationId, bundleId: session.bundleId, packageId: session.packageId, origin: session.origin, callback: session.callback, account: session.account, deviceId: session.deviceId, deviceKey: session.deviceKey, ...input });
  const payload = encodeBase64url(utf8ToBytes(productSessionProofV2SignBytes(unsigned)));
  let signature;
  try {
    signature = await signer(Object.freeze({ purpose: "http-proof", algorithm: "p256-sha256", deviceKey: session.deviceKey, payload }));
  } catch {
    fail5("DEVICE_SIGNING_FAILED", "Platform device proof signing failed closed");
  }
  const proof = parseProductSessionProofV2({ ...unsigned, signature });
  let valid = false;
  try {
    valid = p256.verify(decodeBase64url(proof.signature, "signature"), decodeBase64url(payload, "device signing payload"), decodeBase64url(session.deviceKey, "deviceKey"), { format: "der", lowS: false });
  } catch {
    valid = false;
  }
  if (!valid) fail5("INVALID_DEVICE_PROOF", "Platform device proof signature does not match the registered device key");
  return proof;
}
function parseProductSessionProofV2(input) {
  exactFields(input, PROOF_FIELDS, "Product Session v2 proof");
  const { signature, ...unsigned } = input;
  const bytes = decodeBase64url(pattern3(signature, "signature", /^[A-Za-z0-9_-]{90,96}$/), "signature");
  if (bytes.length < 68 || bytes.length > 72 || encodeBase64url(bytes) !== signature) fail5("INVALID_DEVICE_PROOF", "Product Session proof signature is invalid");
  return Object.freeze({ ...parseUnsigned(unsigned), signature });
}
function productSessionProofV2SignBytes(input) {
  return `YNX_PRODUCT_SESSION_HTTP_PROOF_V2
${canonicalJSON(parseUnsigned(input))}`;
}
function parseUnsigned(input) {
  exactFields(input, PROOF_FIELDS.filter((field) => field !== "signature"), "Unsigned Product Session v2 proof");
  const value = Object.freeze({ version: pattern3(input.version, "version", /^2$/), sessionBinding: digest2(input.sessionBinding, "sessionBinding"), productId: pattern3(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/), clientId: pattern3(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/), applicationId: pattern3(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/), bundleId: nullableIdentity(input.bundleId, "bundleId"), packageId: nullableIdentity(input.packageId, "packageId"), origin: url(input.origin, "origin"), callback: url(input.callback, "callback"), account: pattern3(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), deviceId: pattern3(input.deviceId, "deviceId", /^[A-Za-z0-9._:-]{8,128}$/), deviceKey: pattern3(input.deviceKey, "deviceKey", /^[A-Za-z0-9_-]{44}$/), method: method(input.method), path: path(input.path), bodyDigest: digest2(input.bodyDigest, "bodyDigest"), nonce: pattern3(input.nonce, "nonce", /^[A-Za-z0-9_-]{32,64}$/), issuedAt: time2(input.issuedAt, "issuedAt"), expiresAt: time2(input.expiresAt, "expiresAt") });
  if (value.bundleId !== null && value.bundleId !== value.applicationId || value.packageId !== null && value.packageId !== value.applicationId || value.bundleId !== null && value.packageId !== null) fail5("INVALID_FIELD", "Product Session proof application identity is inconsistent");
  if (value.expiresAt <= value.issuedAt || Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > 6e4) fail5("INVALID_EXPIRY", "Product Session proof lifetime must be at most sixty seconds");
  return value;
}
function url(value, label) {
  const normalized = pattern3(value, label, /^(https|app|[a-z][a-z0-9+.-]*):\/\/[^\s#?]+$/);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail5("INVALID_FIELD", `${label} is invalid`);
  }
  const canonical = label === "origin" && parsed.protocol === "https:" ? parsed.origin === normalized : parsed.toString() === normalized;
  if (!canonical || ["http:", "file:", "javascript:", "data:"].includes(parsed.protocol)) fail5("INVALID_FIELD", `${label} is unsafe`);
  return normalized;
}
function method(value) {
  return pattern3(value, "method", /^(DELETE|GET|PATCH|POST|PUT)$/);
}
function path(value) {
  const normalized = pattern3(value, "path", /^\/[A-Za-z0-9._~!$&'()*+,;=:@\/-]{1,255}$/);
  if (normalized.includes("//") || normalized.endsWith("/") || normalized.includes("?") || normalized.includes("#")) fail5("INVALID_PATH", "Product Session proof path is non-canonical");
  return normalized;
}
function digest2(value, label) {
  return pattern3(value, label, /^[0-9a-f]{64}$/);
}
function nullableIdentity(value, label) {
  return value === null ? null : pattern3(value, label, /^[A-Za-z][A-Za-z0-9.-]{2,131}$/);
}
function pattern3(value, label, regex) {
  if (typeof value !== "string" || value.trim() !== value || !regex.test(value)) fail5("INVALID_FIELD", `${label} is invalid`);
  return value;
}
function time2(value, label) {
  const normalized = pattern3(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) fail5("INVALID_TIME", `${label} is invalid`);
  return normalized;
}
function fail5(code, message) {
  throw new WalletAuthError(code, message);
}
var WALLET_ROUTE_STATUS = Object.freeze({
  READY: "ready",
  WALLET_NOT_INSTALLED: "wallet-not-installed",
  SCHEME_NOT_REGISTERED: "scheme-not-registered",
  SESSION_EXPIRED: "session-expired",
  CALLBACK_MISMATCH: "callback-mismatch",
  USER_REJECTED: "user-rejected",
  NETWORK_UNAVAILABLE: "network-unavailable"
});
function walletConnectionChoices(registryInput, productId, availability) {
  const registry = parseProductSessionRegistry(registryInput);
  exactFields(availability, ["ynxWalletInstalled", "metaMaskAvailable"], "Wallet availability");
  if (typeof availability.ynxWalletInstalled !== "boolean" || typeof availability.metaMaskAvailable !== "boolean") fail6("INVALID_WALLET_AVAILABILITY", "Wallet availability flags must be boolean");
  const product = registry.products.find((item) => item.productId === productId);
  if (!product) fail6("UNKNOWN_PRODUCT", "Product is not registered for Wallet connection");
  const choices = [];
  if (availability.ynxWalletInstalled) {
    choices.push(Object.freeze({ id: "ynx-wallet", action: "open", label: "Open YNX Wallet", authoritative: true }));
  } else {
    choices.push(Object.freeze({ id: "download-ynx-wallet", action: "download", label: "Download YNX Wallet", url: registry.wallet.downloadUrl, authoritative: true }));
  }
  if (product.evmCompatible) choices.push(Object.freeze(availability.metaMaskAvailable ? { id: "metamask", action: "open-evm", label: "Use MetaMask", chainId: 6423, installed: true, authoritative: true, connectionMode: "evm-only", authority: "eip-1193-provider-only", ynxProductSession: false } : { id: "metamask", action: "download-evm-wallet", label: "Use MetaMask (install if needed)", url: registry.wallet.metaMaskDownloadUrl, chainId: 6423, installed: false, authoritative: true, connectionMode: "evm-only", authority: "none", ynxProductSession: false }));
  choices.push(Object.freeze({
    id: "guest",
    action: "guest",
    label: "Continue in Guest / Try mode",
    authoritative: false,
    limitations: Object.freeze(["not-signed-in", "no-wallet-balance", "no-transactions", "no-chain-authority"])
  }));
  return Object.freeze(choices);
}
function encodeProductSessionWalletURL(registryInput, requestInput, at = /* @__PURE__ */ new Date()) {
  const registry = parseProductSessionRegistry(registryInput);
  const request = parseProductSessionRequest(registry, requestInput, at);
  const target = new URL(registry.wallet.authorizeCallback);
  target.searchParams.set("request", encodeBase64url(new TextEncoder().encode(canonicalJSON(request))));
  return target.toString();
}
function prepareWalletOpen(registryInput, requestInput, environment, at = /* @__PURE__ */ new Date()) {
  exactFields(environment, ["networkAvailable", "walletInstalled", "schemeRegistered"], "Wallet open environment");
  if (!environment.networkAvailable) return routeState(WALLET_ROUTE_STATUS.NETWORK_UNAVAILABLE, "Retry when network connectivity returns", ["retry", "return-to-product"]);
  let request;
  try {
    request = parseProductSessionRequest(registryInput, requestInput, at);
  } catch (error) {
    if (error instanceof WalletAuthError && (error.code === "SESSION_EXPIRED" || error.code === "EXPIRED")) return routeState(WALLET_ROUTE_STATUS.SESSION_EXPIRED, "Start a new Wallet connection request", ["retry", "return-to-product"]);
    throw error;
  }
  if (!environment.walletInstalled) return routeState(WALLET_ROUTE_STATUS.WALLET_NOT_INSTALLED, "Install YNX Wallet or return to Guest / Try mode", ["download", "guest", "return-to-product"]);
  if (!environment.schemeRegistered) return routeState(WALLET_ROUTE_STATUS.SCHEME_NOT_REGISTERED, "Repair or reinstall YNX Wallet, then retry", ["download", "retry", "return-to-product"]);
  return Object.freeze({ status: WALLET_ROUTE_STATUS.READY, url: encodeProductSessionWalletURL(registryInput, request, at), request, actions: Object.freeze([]) });
}
function prepareWalletAttempt(registryInput, requestInput, at = /* @__PURE__ */ new Date()) {
  const request = parseProductSessionRequest(registryInput, requestInput, at);
  return Object.freeze({
    status: WALLET_ROUTE_STATUS.READY,
    url: encodeProductSessionWalletURL(registryInput, request, at),
    request,
    installation: "unverified",
    automatic: false,
    actions: Object.freeze([])
  });
}
function parseProductSessionReturnURL(registryInput, pendingRequest, url2, at = /* @__PURE__ */ new Date()) {
  let request;
  try {
    request = parseProductSessionRequest(registryInput, pendingRequest, at);
  } catch (error) {
    if (error instanceof WalletAuthError && error.code === "SESSION_EXPIRED") return routeState(WALLET_ROUTE_STATUS.SESSION_EXPIRED, "The Wallet approval request expired", ["retry", "return-to-product"]);
    throw error;
  }
  const parsed = safeURL(url2, "CALLBACK_MISMATCH", "Wallet callback is invalid");
  const expected = new URL(request.callback);
  const result = parsed.searchParams.get("result");
  const allowed = result === "approved" ? ["approval", "nonce", "result", "state"] : ["nonce", "reason", "result", "state"];
  const keys = [...parsed.searchParams.keys()].sort();
  parsed.search = "";
  if (parsed.toString() !== expected.toString() || parsed.hash || parsed.username || parsed.password || keys.join("\n") !== allowed.join("\n") || parsed.protocol === "http:" || parsed.protocol === "file:" || parsed.protocol === "javascript:") return routeState(WALLET_ROUTE_STATUS.CALLBACK_MISMATCH, "Return to the product and start a new Wallet request", ["retry", "return-to-product"]);
  if (new URL(url2).searchParams.get("nonce") !== request.nonce || new URL(url2).searchParams.get("state") !== request.state) return routeState(WALLET_ROUTE_STATUS.CALLBACK_MISMATCH, "Wallet callback nonce or state did not match", ["retry", "return-to-product"]);
  if (result === "rejected" && new URL(url2).searchParams.get("reason") === "user_rejected") return routeState(WALLET_ROUTE_STATUS.USER_REJECTED, "No Product Session was created", ["guest", "retry", "return-to-product"]);
  if (result !== "approved") return routeState(WALLET_ROUTE_STATUS.CALLBACK_MISMATCH, "Wallet callback result was not recognized", ["retry", "return-to-product"]);
  try {
    const approval = parseProductSessionApproval(registryInput, request, decodeJSON(new URL(url2).searchParams.get("approval"), "Wallet approval"), at);
    return Object.freeze({ status: WALLET_ROUTE_STATUS.READY, request, approval, actions: Object.freeze([]) });
  } catch (error) {
    if (error instanceof WalletAuthError) return routeState(WALLET_ROUTE_STATUS.CALLBACK_MISMATCH, "Wallet approval did not match the pending product request", ["retry", "return-to-product"]);
    throw error;
  }
}
function routeState(status2, message, actions2) {
  return Object.freeze({ status: status2, message, actions: Object.freeze(actions2) });
}
function decodeJSON(value, label) {
  try {
    const bytes = decodeBase64url(value ?? "", label);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail6("INVALID_ROUTE_PAYLOAD", `${label} encoding is invalid`);
  }
}
function safeURL(value, code, message) {
  if (typeof value !== "string" || value.length > 4096) fail6(code, message);
  try {
    return new URL(value);
  } catch {
    fail6(code, message);
  }
}
function fail6(code, message) {
  throw new WalletAuthError(code, message);
}
var BINDING_FIELDS = ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback"];
function createRevocationIntent(binding, device2, intentId, session) {
  return parseRevocationIntent(canonicalJSON({ version: 1, intentId, scope: scope(binding, device2), session }), binding, device2);
}
function parseRevocationIntent(raw, binding, device2) {
  if (typeof raw !== "string" || raw.length > 16384) fail7("INVALID_SESSION_STORE", "Pending revocation intent is invalid");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail7("INVALID_SESSION_STORE", "Pending revocation intent is not valid JSON");
  }
  exactFields(value, ["version", "intentId", "scope", "session"], "Pending Product Session revocation intent");
  if (value.version !== 1 || !/^[A-Za-z0-9_-]{32,64}$/.test(value.intentId) || value.scope !== scope(binding, device2)) fail7("CROSS_PRODUCT_SESSION", "Pending revocation intent does not match this product device");
  const session = value.session === null ? null : parseProductSession(value.session);
  if (session && (BINDING_FIELDS.some((field) => session[field] !== binding[field]) || session.deviceId !== device2.id || session.deviceKey !== device2.key || canonicalJSON(session.scopes) !== canonicalJSON(device2.scopes))) fail7("CROSS_PRODUCT_SESSION", "Pending revocation target does not match this product device");
  return Object.freeze({ version: 1, intentId: value.intentId, scope: value.scope, session });
}
function revocationSessionMatches(raw, session) {
  if (raw === null || session === null) return false;
  try {
    return canonicalJSON(parseProductSession(JSON.parse(raw))) === canonicalJSON(session);
  } catch {
    return false;
  }
}
function scope(binding, device2) {
  return digestHex("YNX_PRODUCT_SESSION_LOCAL_REVOCATION_SCOPE_V1", { ...Object.fromEntries(BINDING_FIELDS.map((field) => [field, binding[field]])), deviceId: device2.id, deviceKey: device2.key, scopes: device2.scopes });
}
function fail7(code, message) {
  throw new WalletAuthError(code, message);
}
function parseCompletionRecord(registry, raw, at) {
  if (typeof raw !== "string" || raw.length > 16384) fail8("INVALID_SESSION_STORE", "Protected completion record is invalid");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail8("INVALID_SESSION_STORE", "Protected completion record is not valid JSON");
  }
  exactFields(value, ["request", "approval", "completion"], "Protected Product Session completion");
  const request = parseProductSessionRequest(registry, value.request, at);
  const approval = parseProductSessionApproval(registry, request, value.approval, at);
  exactFields(value.completion, ["challenge", "deviceSignature"], "Protected Product Session device completion");
  const challenge = parseProductSessionChallenge(value.completion.challenge);
  const expected = createProductSessionChallenge(registry, request, approval, { challenge: challenge.challenge }, new Date(challenge.issuedAt));
  if (canonicalJSON(challenge) !== canonicalJSON(expected)) fail8("SESSION_BINDING_MISMATCH", "Protected completion challenge changed");
  let valid = false;
  try {
    valid = p256.verify(decodeBase64url(value.completion.deviceSignature, "deviceSignature"), new TextEncoder().encode(`YNX_PRODUCT_SESSION_CHALLENGE_V2
${canonicalJSON(challenge)}`), decodeBase64url(challenge.deviceKey, "deviceKey"), { format: "der", lowS: false });
  } catch {
    valid = false;
  }
  if (!valid) fail8("INVALID_DEVICE_PROOF", "Protected completion signature is invalid");
  return Object.freeze({ request, approval, completion: Object.freeze({ challenge, deviceSignature: value.completion.deviceSignature }) });
}
function deriveCompletionTarget(registry, raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail8("INVALID_SESSION_STORE", "Protected completion record is not valid JSON");
  }
  const at = new Date(value?.completion?.challenge?.issuedAt);
  const record = parseCompletionRecord(registry, raw, at);
  const verifier = new ProductSessionAuthority(registry);
  verifier.issueChallenge({ request: record.request, approval: record.approval, challenge: record.completion.challenge.challenge }, at);
  return verifier.complete(record, at);
}
function fail8(code, message) {
  throw new WalletAuthError(code, message);
}
var PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION = 2;
var WALLET_SESSION_CONTROL_PATHS = Object.freeze(["/v2/product-sessions/wallet/sessions", "/v2/product-sessions/wallet/sessions/revoke"]);
var WALLET_SESSION_CONTROL_INTENT_PATHS = Object.freeze(["/v2/product-sessions/wallet/sessions/revoke-all", "/v2/product-sessions/wallet/devices/revoke"]);
var CLOCK_ANCHOR_PREFIX = "e4ab6187c05d932f";
var CLOCK_ANCHOR_PATTERN = new RegExp(`^${CLOCK_ANCHOR_PREFIX}[0-9a-f]{12}0{36}$`);
var DEFAULT_PRODUCT_SESSION_CONTROL_CAPACITY_POLICY = Object.freeze({ maxOwners: 256, intentsPerOwner: 32 });
var PATHS = Object.freeze({
  "account-logout": "/v2/product-sessions/wallet/sessions/revoke-all",
  "device-logout": "/v2/product-sessions/wallet/devices/revoke"
});
var PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2 = "x-ynx-product-session-proof-v2";
var MAX_RESPONSE_BYTES = 1048576;
var gatewayAuthorities = /* @__PURE__ */ new WeakMap();
function productSessionGatewayAuthority(adapter) {
  if (!gatewayAuthorities.has(adapter)) fail9("INVALID_GATEWAY", "Browser storage requires an authority-bound Product Session Gateway fetch adapter");
  return gatewayAuthorities.get(adapter);
}
var ProductSessionGatewayFetchAdapter = class {
  #endpoint;
  #fetch;
  #walletInstalled;
  #schemeRegistered;
  #timeoutMs;
  constructor(config) {
    exactFields(config, ["endpoint", "fetch", "walletInstalled", "schemeRegistered", "timeoutMs"], "Product Session Gateway fetch adapter configuration");
    this.#endpoint = endpoint(config.endpoint);
    if (typeof config.fetch !== "function" || typeof config.walletInstalled !== "function" || typeof config.schemeRegistered !== "function") fail9("INVALID_GATEWAY", "Product Session Gateway fetch adapter dependencies are invalid");
    if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1e3 || config.timeoutMs > 3e4) fail9("INVALID_GATEWAY", "Product Session Gateway timeout must be between one and thirty seconds");
    this.#fetch = config.fetch;
    this.#walletInstalled = config.walletInstalled;
    this.#schemeRegistered = config.schemeRegistered;
    this.#timeoutMs = config.timeoutMs;
    gatewayAuthorities.set(this, this.#endpoint);
  }
  async walletInstalled() {
    return capability(await this.#walletInstalled(), "Wallet installation detection");
  }
  async schemeRegistered() {
    return capability(await this.#schemeRegistered(), "Wallet scheme detection");
  }
  // Use a fresh HTTPS authority sample, without extrapolating the device clock or
  // adding half the network RTT. This instant has already passed at the authority.
  async currentTime(input) {
    exactFields(input, ["requestId"], "Product Session Gateway time request");
    try {
      const result = await this.#request(input.requestId, "/v2/product-sessions/time", null, null, "GET");
      exactFields(result, ["serverTime"], "Product Session Gateway time response");
      const now = new Date(result.serverTime);
      if (typeof result.serverTime !== "string" || !Number.isFinite(now.getTime()) || now.toISOString() !== result.serverTime) fail9("INVALID_GATEWAY_RESPONSE", "Product Session Gateway time is invalid");
      return now;
    } catch (error) {
      if (error instanceof WalletAuthError && error.code === "NETWORK_UNAVAILABLE") throw error;
      fail9("CLOCK_UNAVAILABLE", "Product Session authority time could not be verified; Retry when Auth is available");
    }
  }
  async challenge(input) {
    exactFields(input, ["requestId", "request", "approval"], "Product Session Gateway challenge request");
    return this.#request(input.requestId, "/v2/product-sessions/challenge", { request: input.request, approval: input.approval }, null);
  }
  async complete(input) {
    exactFields(input, ["requestId", "request", "approval", "completion"], "Product Session Gateway completion request");
    return this.#request(input.requestId, "/v2/product-sessions/complete", { request: input.request, approval: input.approval, completion: input.completion }, null);
  }
  async introspect(input) {
    exactFields(input, ["requestId", "sessionBinding", "requiredScopes", "proof"], "Product Session Gateway introspection request");
    const proof = parseProductSessionProofV2(input.proof);
    if (proof.sessionBinding !== input.sessionBinding) fail9("CROSS_PRODUCT_SESSION", "Product Session proof does not match the requested session binding");
    return this.#request(input.requestId, "/v2/product-sessions/introspect", { requiredScopes: input.requiredScopes }, proof);
  }
  async revoke(input) {
    exactFields(input, ["requestId", "sessionBinding", "proof"], "Product Session Gateway revoke request");
    const proof = parseProductSessionProofV2(input.proof);
    if (proof.sessionBinding !== input.sessionBinding) fail9("CROSS_PRODUCT_SESSION", "Product Session proof does not match the requested session binding");
    return this.#request(input.requestId, "/v2/product-sessions/revoke", {}, proof);
  }
  async #request(requestId, path2, body, proof, method2 = "POST") {
    if (typeof requestId !== "string" || !/^req_[A-Za-z0-9_-]{12,80}$/.test(requestId)) fail9("INVALID_REQUEST_ID", "Product Session Gateway request ID is invalid");
    const encodedBody = method2 === "GET" ? void 0 : canonicalJSON(body);
    const headers = { "accept": "application/json", "x-request-id": requestId };
    if (method2 === "POST") headers["content-type"] = "application/json";
    if (proof !== null) headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2] = encodeProductSessionGatewayProofHeaderV2(proof);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response;
    try {
      const fetch2 = this.#fetch;
      response = await fetch2(`${this.#endpoint}${path2}`, { method: method2, headers, body: encodedBody, cache: "no-store", credentials: "omit", redirect: "error", signal: controller.signal });
    } catch {
      clearTimeout(timeout);
      fail9("NETWORK_UNAVAILABLE", "Product Session Gateway is unavailable; no local response was substituted");
    }
    try {
      if (!response || typeof response.status !== "number" || !response.headers || typeof response.headers.get !== "function" || typeof response.text !== "function") fail9("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response is invalid");
      const contentType = response.headers.get("content-type") ?? "";
      const responseRequestId = response.headers.get("x-request-id");
      const cacheControl = response.headers.get("cache-control") ?? "";
      const contentLength = response.headers.get("content-length");
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType) || responseRequestId !== requestId || !/(^|,)\s*no-store\s*(,|$)/i.test(cacheControl)) fail9("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response headers are invalid");
      if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) fail9("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response exceeds policy");
      let text3;
      try {
        text3 = await response.text();
      } catch {
        fail9("NETWORK_UNAVAILABLE", "Product Session Gateway response stream was interrupted; no local response was substituted");
      }
      if (new TextEncoder().encode(text3).length > MAX_RESPONSE_BYTES) fail9("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response exceeds policy");
      let payload;
      try {
        payload = JSON.parse(text3);
      } catch {
        fail9("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response is not JSON");
      }
      if (canonicalJSON(payload) !== text3) fail9("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response is not canonical JSON");
      if (response.status >= 200 && response.status < 300) {
        exactFields(payload, ["ok", "requestId", "result", "schemaVersion"], "Product Session Gateway success response");
        if (payload.ok !== true || payload.requestId !== requestId || payload.schemaVersion !== PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION) fail9("INVALID_GATEWAY_RESPONSE", "Product Session Gateway success response binding is invalid");
        return payload.result;
      }
      exactFields(payload, ["error", "ok", "requestId", "schemaVersion"], "Product Session Gateway error response");
      exactFields(payload.error, ["code", "message"], "Product Session Gateway public error");
      if (payload.ok !== false || payload.requestId !== requestId || payload.schemaVersion !== PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION || typeof payload.error.code !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(payload.error.code) || typeof payload.error.message !== "string" || payload.error.message.length > 300) fail9("INVALID_GATEWAY_RESPONSE", "Product Session Gateway error response binding is invalid");
      throw new WalletAuthError(payload.error.code, payload.error.message);
    } finally {
      clearTimeout(timeout);
    }
  }
};
function encodeProductSessionGatewayProofHeaderV2(value) {
  const proof = parseProductSessionProofV2(value);
  const encoded = encodeBase64url(new TextEncoder().encode(canonicalJSON(proof)));
  if (encoded.length > 16384) fail9("INVALID_PROOF_HEADER", "Product Session proof header exceeds policy");
  return encoded;
}
function endpoint(value) {
  if (typeof value !== "string" || value.length > 512) fail9("INVALID_GATEWAY", "Product Session Gateway endpoint is invalid");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail9("INVALID_GATEWAY", "Product Session Gateway endpoint is invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash || parsed.pathname !== "/" || value !== parsed.origin) fail9("INVALID_GATEWAY", "Product Session Gateway endpoint must be a canonical HTTPS origin");
  return parsed.origin;
}
function capability(value, label) {
  if (typeof value !== "boolean") fail9("INVALID_GATEWAY", `${label} must return a boolean`);
  return value;
}
function fail9(code, message) {
  throw new WalletAuthError(code, message);
}
var PRODUCT_SESSION_CLIENT_STATE = Object.freeze({
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  GUEST: "guest",
  EXPIRED: "expired",
  NETWORK_UNAVAILABLE: "network-unavailable",
  RETRY_REQUIRED: "retry-required"
});
var REVOCATION_PENDING = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Product Session revocation is pending; API authorization is suspended", { actions: ["retry"], revocationPending: true });
var RecoverableProductSessionClient = class {
  #finiteServiceSeconds;
  #registry;
  #binding;
  #storage;
  #gateway;
  #device;
  #tokens;
  #clock;
  #state;
  #autoReconnectAttempted;
  #networkAvailable;
  #networkEpoch;
  #disconnectPromise;
  #returnOperation;
  #recoveryPromise;
  #revocationRequested = false;
  #revocationIntent = null;
  #beginEpoch = 0;
  #beginMutation = Promise.resolve();
  constructor(config) {
    exactFields(config, ["registry", "productId", "platform", "storage", "gateway", "device", "tokenFactory", "clock", ...Object.hasOwn(config ?? {}, "finiteServiceSeconds") ? ["finiteServiceSeconds"] : []], "Recoverable Product Session client configuration");
    this.#registry = parseProductSessionRegistry(config.registry);
    this.#binding = productPlatformBinding(this.#registry, config.productId, config.platform);
    this.#storage = secureStorage(config.storage, config.platform, config.device);
    this.#revocationRequested = this.#storage.revocationRequested?.() === true;
    this.#gateway = gateway(config.gateway);
    this.#device = device(config.device);
    this.#tokens = tokenFactory(config.tokenFactory);
    this.#clock = clock(config.clock);
    if (Object.hasOwn(config, "finiteServiceSeconds")) {
      if (!Number.isInteger(config.finiteServiceSeconds) || config.finiteServiceSeconds < 300 || config.finiteServiceSeconds > 7200) fail10("INVALID_SERVICE_CONSENT_TIME", "Explicit finite service duration is outside the approved bounds");
      this.#finiteServiceSeconds = config.finiteServiceSeconds;
    }
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED, "No authoritative Product Session is active");
    this.#autoReconnectAttempted = false;
    this.#networkAvailable = true;
    this.#networkEpoch = 0;
    this.#disconnectPromise = null;
    this.#returnOperation = null;
    this.#recoveryPromise = null;
  }
  // Suspend outward authority as soon as disconnect starts, including while its
  // clock lookup or a prior recovery is pending. Keep protected state for Retry.
  get current() {
    if (this.#storage.revocationRequested?.() === true) this.#revocationRequested = true;
    return this.#disconnectPromise !== null || this.#revocationRequested && [PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED, PRODUCT_SESSION_CLIENT_STATE.CONNECTED, PRODUCT_SESSION_CLIENT_STATE.CONNECTING, PRODUCT_SESSION_CLIENT_STATE.GUEST].includes(this.#state.status) ? REVOCATION_PENDING : this.#state;
  }
  get storageKey() {
    return `ynx.product-session.v2:${this.#binding.productId}:${this.#binding.platform}:${this.#binding.applicationId}`;
  }
  get connectionBinding() {
    return Object.freeze({ productId: this.#binding.productId, platform: this.#binding.platform, applicationId: this.#binding.applicationId });
  }
  async detectWalletEnvironment() {
    let walletInstalled, schemeRegistered;
    try {
      [walletInstalled, schemeRegistered] = await Promise.all([this.#gateway.walletInstalled(), this.#gateway.schemeRegistered()]);
    } catch (error) {
      if (error instanceof WalletAuthError) throw error;
      fail10("WALLET_UNAVAILABLE", "Wallet availability detection failed closed");
    }
    if (typeof walletInstalled !== "boolean" || typeof schemeRegistered !== "boolean") fail10("INVALID_GATEWAY_RESPONSE", "Wallet availability detection returned invalid values");
    return Object.freeze({ walletInstalled, schemeRegistered });
  }
  async beginDetected(automatic = false) {
    const epoch = ++this.#beginEpoch;
    let environment;
    try {
      environment = await this.detectWalletEnvironment();
    } catch (error) {
      if (epoch !== this.#beginEpoch) return this.current;
      throw error;
    }
    if (epoch !== this.#beginEpoch) return this.current;
    return this.#begin(environment, automatic, false, epoch);
  }
  async beginExplicit() {
    return this.#begin(null, false, true, ++this.#beginEpoch);
  }
  async retryDetected() {
    const epoch = ++this.#beginEpoch;
    const revoking = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (revoking) {
      this.#networkAvailable = true;
      return this.disconnect();
    }
    let environment;
    try {
      environment = await this.detectWalletEnvironment();
    } catch (error) {
      if (epoch !== this.#beginEpoch) return this.current;
      throw error;
    }
    if (epoch !== this.#beginEpoch) return this.current;
    return this.retry(environment);
  }
  async restore(networkAvailable = true) {
    const epoch = this.#beginEpoch;
    await this.#recover(() => this.#restore(networkAvailable, epoch));
    return this.current;
  }
  async #restore(networkAvailable, epoch) {
    this.#networkAvailable = Boolean(networkAvailable);
    const revoking = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (revoking) return this.#pendingRevocation();
    if (!this.#networkAvailable) return this.#offline();
    const restored = await this.#restoreStoredSession(epoch);
    if (epoch !== this.#beginEpoch) return this.current;
    if (restored !== null) return restored;
    const pendingReturn = await this.#storage.get(`${this.storageKey}:return`);
    if (epoch !== this.#beginEpoch) return this.current;
    if (pendingReturn !== null) return this.handleReturn(pendingReturn);
    const pending = await this.#restorePendingRequest(epoch);
    if (epoch !== this.#beginEpoch) return this.current;
    if (pending !== null) return pending;
    if (!this.#autoReconnectAttempted) {
      this.#autoReconnectAttempted = true;
      return this.beginDetected(true);
    }
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Stored Product Session is invalid; explicit Retry is required", { actions: ["retry", "guest"] });
    return this.#state;
  }
  async begin(environment, automatic = false) {
    exactFields(environment, ["walletInstalled", "schemeRegistered"], "Product Session connection environment");
    return this.#begin(environment, automatic, false, ++this.#beginEpoch);
  }
  async #restorePendingRequest(epoch) {
    await this.#beginMutation;
    if (epoch !== this.#beginEpoch) return this.current;
    const key = `${this.storageKey}:pending`, raw = await this.#storage.get(key);
    if (epoch !== this.#beginEpoch) return this.current;
    if (raw === null) return null;
    if (this.#revocationRequested) return this.#pendingRevocation();
    if (!this.#networkAvailable) return this.#offline();
    const networkEpoch = this.#networkEpoch;
    const retained = (message) => {
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, message, { actions: ["retry", "guest"] });
      return this.#state;
    };
    let request;
    try {
      if (typeof raw !== "string" || raw.length > 16384) fail10("INVALID_SESSION_STORE", "Pending Wallet request exceeds policy");
      const input = JSON.parse(raw);
      request = parseProductSessionRequest(this.#registry, input, new Date(input?.issuedAt));
      for (const field of ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback"]) {
        if (request[field] !== this.#binding[field]) fail10("SESSION_BINDING_MISMATCH", "Pending Wallet request belongs to another product binding");
      }
      if (request.deviceId !== this.#device.id || request.deviceKey !== this.#device.key || canonicalJSON(request.scopes) !== canonicalJSON(this.#device.scopes)) fail10("SESSION_BINDING_MISMATCH", "Pending Wallet request belongs to another device or scope selection");
    } catch {
      return retained("The saved Wallet request is invalid or belongs to another binding; it was retained. Start a new explicit request to replace it.");
    }
    let now;
    try {
      if (typeof this.#gateway.currentTime !== "function") fail10("CLOCK_UNAVAILABLE", "Pending request recovery requires authority time");
      now = await this.#now();
    } catch {
      if (epoch !== this.#beginEpoch) return this.current;
      return this.#offline("Authority time is unavailable; the original Wallet request was retained for Retry");
    }
    if (epoch !== this.#beginEpoch) return this.current;
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while checking the original Wallet request; it was retained for Retry");
    try {
      request = parseProductSessionRequest(this.#registry, request, now);
    } catch {
      return retained("The saved Wallet request expired or is invalid; it was retained. Start a new explicit request to replace it.");
    }
    const revoking = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (revoking) return this.#pendingRevocation();
    const readback = await this.#storage.get(key);
    if (epoch !== this.#beginEpoch) return this.current;
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while reading the original Wallet request; explicit Retry is required");
    if (readback !== raw) return retained("The saved Wallet request changed during recovery; no replacement request was created");
    const route = prepareWalletAttempt(this.#registry, request, now);
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.CONNECTING, "The original Wallet approval is still pending; explicitly open the same request", { request, route, automatic: false, installation: "unverified" });
    return this.#state;
  }
  async #begin(environment, automatic, explicit, epoch) {
    try {
      return await this.#beginRequest(environment, automatic, explicit, epoch);
    } catch (error) {
      if (epoch !== this.#beginEpoch) return this.current;
      throw error;
    }
  }
  async #beginRequest(environment, automatic, explicit, epoch) {
    if (this.#finiteServiceSeconds !== void 0 && automatic) {
      if (this.#state.status !== PRODUCT_SESSION_CLIENT_STATE.EXPIRED) this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Finite service access requires explicit Wallet approval", { actions: ["retry", "guest"] });
      return this.current;
    }
    const revoking = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (revoking) return this.#pendingRevocation();
    if (!this.#networkAvailable) return this.#offline();
    const networkEpoch = this.#networkEpoch;
    let now;
    try {
      if (explicit && typeof this.#gateway.currentTime !== "function") fail10("CLOCK_UNAVAILABLE", "Explicit Wallet opening requires the authority-time adapter");
      now = await this.#now();
    } catch (error) {
      if (epoch !== this.#beginEpoch) return this.current;
      if (isNetworkUnavailable(error) || explicit && !(error instanceof WalletAuthError)) return this.#offline("Authority time is unavailable; Retry before opening Wallet");
      throw error;
    }
    if (epoch !== this.#beginEpoch) return this.current;
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while reading authority time; explicit Retry is required");
    const pendingRevocation = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (pendingRevocation) return this.#pendingRevocation();
    const request = createProductSessionRequest(this.#registry, {
      productId: this.#binding.productId,
      platform: this.#binding.platform,
      deviceId: this.#device.id,
      deviceKey: this.#device.key,
      scopes: this.#device.scopes,
      purpose: this.#device.purpose,
      nonce: this.#tokens(),
      state: this.#tokens(),
      ...this.#finiteServiceSeconds === void 0 ? {} : { finiteServiceSeconds: this.#finiteServiceSeconds }
    }, now);
    const mutation = this.#beginMutation.then(async () => {
      if (epoch !== this.#beginEpoch) return this.current;
      if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while preparing the Wallet request; explicit Retry is required");
      const key = `${this.storageKey}:pending`, raw = canonicalJSON(request);
      let wrote = false;
      const cancelled = async () => {
        if (wrote && await this.#storage.get(key) === raw) await this.#storage.remove(key);
        return this.current;
      };
      try {
        for (const suffix of ["pending", "return", "completion"]) {
          if (epoch !== this.#beginEpoch) return cancelled();
          await this.#storage.remove(`${this.storageKey}:${suffix}`);
        }
        if (epoch !== this.#beginEpoch) return cancelled();
        if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while preparing the Wallet request; explicit Retry is required");
        wrote = true;
        await this.#storage.set(key, raw);
        if (epoch !== this.#beginEpoch) return cancelled();
        const stored = await this.#storage.get(key);
        if (epoch !== this.#beginEpoch) return cancelled();
        if (stored !== raw) fail10("INSECURE_STORAGE", "Pending Wallet request did not read back exactly");
        if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while protecting the Wallet request; explicit Retry is required");
        const route = explicit ? prepareWalletAttempt(this.#registry, request, now) : prepareWalletOpen(this.#registry, request, { networkAvailable: true, walletInstalled: environment.walletInstalled, schemeRegistered: environment.schemeRegistered }, now);
        this.#state = route.status === WALLET_ROUTE_STATUS.READY ? state(PRODUCT_SESSION_CLIENT_STATE.CONNECTING, automatic ? "Controlled reconnect requires Wallet approval" : "Wallet approval is pending", { request, route, automatic, ...explicit ? { installation: "unverified" } : {} }) : state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, route.message, { request, route, automatic, actions: route.actions });
        return this.#state;
      } catch (error) {
        if (epoch !== this.#beginEpoch) return cancelled();
        throw error;
      }
    });
    this.#beginMutation = mutation.catch(() => {
    });
    return mutation;
  }
  async handleReturn(url2) {
    if (this.#returnOperation !== null) {
      if (this.#returnOperation.url !== url2) fail10("CONCURRENT_CALLBACK", "A different Wallet callback is already being verified");
      await this.#returnOperation.promise;
      return this.current;
    }
    const operation = this.#handleReturn(url2);
    this.#returnOperation = { url: url2, promise: operation };
    try {
      await operation;
      return this.current;
    } finally {
      if (this.#returnOperation?.promise === operation) this.#returnOperation = null;
    }
  }
  async #handleReturn(url2) {
    if (await this.#loadRevocationIntent()) return this.#pendingRevocation();
    if (!this.#networkAvailable) {
      if (typeof url2 === "string" && url2.length <= 16384 && await this.#storage.get(`${this.storageKey}:pending`) !== null) await this.#storage.set(`${this.storageKey}:return`, url2);
      return this.#offline();
    }
    const networkEpoch = this.#networkEpoch;
    const raw = await this.#storage.get(`${this.storageKey}:pending`);
    if (raw === null) {
      await this.#storage.remove(`${this.storageKey}:return`);
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "No pending Wallet request matches this callback", { actions: ["retry", "guest"] });
      return this.#state;
    }
    let now;
    try {
      now = await this.#now();
    } catch (error) {
      if (isNetworkUnavailable(error)) {
        if (typeof url2 === "string" && url2.length <= 16384) await this.#storage.set(`${this.storageKey}:return`, url2);
        return this.#offline("Authority time is unavailable; the pending Wallet callback was retained for Retry");
      }
      throw error;
    }
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) {
      if (typeof url2 === "string" && url2.length <= 16384) await this.#storage.set(`${this.storageKey}:return`, url2);
      return this.#networkTransition("Network changed while reading authority time; Wallet callback was retained for Retry");
    }
    let request;
    try {
      request = parseProductSessionRequest(this.#registry, JSON.parse(raw), now);
    } catch {
      await this.#clearPending();
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Pending Wallet request expired or is invalid", { actions: ["retry", "guest"] });
      return this.#state;
    }
    const returned = parseProductSessionReturnURL(this.#registry, request, url2, now);
    if (returned.status === WALLET_ROUTE_STATUS.USER_REJECTED) {
      await this.#clearPending();
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED, "Wallet approval was rejected; no session was created", { actions: returned.actions });
      return this.#state;
    }
    if (returned.status !== WALLET_ROUTE_STATUS.READY) {
      await this.#storage.remove(`${this.storageKey}:return`);
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, returned.message, { actions: returned.actions });
      return this.#state;
    }
    await this.#storage.set(`${this.storageKey}:return`, url2);
    try {
      const storedCompletion = await this.#storage.get(`${this.storageKey}:completion`);
      let completion;
      if (storedCompletion !== null) {
        const record = parseCompletionRecord(this.#registry, storedCompletion, now);
        if (canonicalJSON(record.request) !== canonicalJSON(request) || canonicalJSON(record.approval) !== canonicalJSON(returned.approval) || record.completion.challenge.deviceId !== this.#device.id || record.completion.challenge.deviceKey !== this.#device.key) fail10("SESSION_BINDING_MISMATCH", "Protected completion belongs to another exact Wallet approval");
        if (record.completion.challenge.sessionExpiresAt <= now.toISOString()) fail10("SESSION_EXPIRED", "Previously completed Product Session has expired");
        completion = record.completion;
      } else {
        const challenge = parseProductSessionChallenge(await this.#gateway.challenge({ requestId: gatewayRequestId("c", request.nonce), request, approval: returned.approval }));
        if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while receiving the Gateway challenge; protected callback was retained for Retry");
        const expectedChallenge = createProductSessionChallenge(this.#registry, request, returned.approval, { challenge: challenge.challenge }, new Date(challenge.issuedAt));
        if (canonicalJSON(challenge) !== canonicalJSON(expectedChallenge)) fail10("SESSION_BINDING_MISMATCH", "Gateway challenge did not match the exact product request and Wallet approval");
        if (challenge.expiresAt <= (await this.#now()).toISOString()) fail10("SESSION_EXPIRED", "Gateway challenge expired before product device signing");
        if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while reading challenge time; protected callback was retained for Retry");
        if (await this.#loadRevocationIntent()) return this.#pendingRevocation();
        completion = this.#device.sign ? await signProductSessionChallengeWith(challenge, this.#device.sign) : signProductSessionChallenge(challenge, this.#device.secret);
        await this.#storage.set(`${this.storageKey}:completion`, canonicalJSON({ request, approval: returned.approval, completion }));
      }
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed during platform challenge signing; protected callback was retained for Retry");
      if (await this.#loadRevocationIntent()) return this.#pendingRevocation();
      const session = parseProductSession(await this.#gateway.complete({ requestId: gatewayRequestId("f", request.state), request, approval: returned.approval, completion }));
      await this.#storage.set(this.storageKey, JSON.stringify(session));
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while protecting the issued Product Session; authoritative Retry is required");
      try {
        await this.#introspect(session);
      } catch (error) {
        if (isNetworkUnavailable(error)) return this.#offline("Network unavailable while confirming the issued Product Session; protected state was retained for Retry");
        throw error;
      }
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while confirming the Product Session; authoritative Retry is required");
      await this.#clearPending();
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.CONNECTED, "Authoritative Product Session connected", { session });
      return this.#state;
    } catch (error) {
      if (this.#revocationRequested || error?.code === "REVOCATION_PENDING") return this.#pendingRevocation();
      if (isNetworkUnavailable(error)) return this.#offline("Network unavailable while completing Wallet approval; the protected callback was retained for Retry");
      await this.#storage.remove(this.storageKey);
      await this.#clearPending();
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Gateway did not issue or confirm a valid Product Session", { actions: ["retry", "guest"] });
      return this.#state;
    }
  }
  async retry(environment) {
    const epoch = ++this.#beginEpoch;
    const revoking = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (revoking) {
      this.#networkAvailable = true;
      return this.disconnect();
    }
    await this.#recover(() => this.#retry(environment, epoch));
    return this.current;
  }
  async #retry(environment, epoch) {
    this.#networkAvailable = true;
    const restored = await this.#restoreStoredSession(epoch);
    if (epoch !== this.#beginEpoch) return this.current;
    if (restored !== null) return restored;
    const pendingReturn = await this.#storage.get(`${this.storageKey}:return`);
    if (epoch !== this.#beginEpoch) return this.current;
    if (pendingReturn !== null) return this.handleReturn(pendingReturn);
    const pending = await this.#restorePendingRequest(epoch);
    if (epoch !== this.#beginEpoch) return this.current;
    if (pending !== null) return pending;
    this.#autoReconnectAttempted = false;
    return this.begin(environment, false);
  }
  connectionChoices(availability) {
    return walletConnectionChoices(this.#registry, this.#binding.productId, availability);
  }
  setNetworkAvailable(available) {
    this.#networkEpoch += 1;
    this.#networkAvailable = Boolean(available);
    if (!this.#networkAvailable) return this.#offline();
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Network restored; authoritative re-introspection is required", { actions: ["retry"] });
    return this.#state;
  }
  enterGuest() {
    this.#beginEpoch += 1;
    if (this.#revocationRequested) return this.#pendingRevocation();
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.GUEST, "Guest / Try mode: not signed in; balances, transactions and Chain authority are unavailable", { limitations: ["not-signed-in", "no-wallet-balance", "no-transactions", "no-chain-authority"] });
    return this.#state;
  }
  async disconnect() {
    if (this.#disconnectPromise !== null) return this.#disconnectPromise;
    this.#beginEpoch += 1;
    this.#revocationRequested = true;
    try {
      this.#storage.requestRevocation?.();
    } catch {
      return this.#pendingRevocation("Sign-out could not be saved synchronously; authorization remains suspended.");
    }
    const operation = this.#disconnect();
    this.#disconnectPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.#disconnectPromise === operation) this.#disconnectPromise = null;
    }
  }
  async #disconnect() {
    try {
      await this.#prepareRevocationIntent();
    } catch {
      return this.#pendingRevocation("Sign-out could not be saved securely; authorization remains suspended. Retry to save the same target.");
    }
    await this.#beginMutation;
    const pendingRecovery = this.#recoveryPromise;
    if (pendingRecovery !== null) {
      try {
        await pendingRecovery;
      } catch {
      }
    }
    const pendingReturn = this.#returnOperation?.promise ?? null;
    if (pendingReturn !== null) {
      try {
        await pendingReturn;
      } catch {
      }
    }
    await this.#loadRevocationIntent();
    let session = this.#revocationIntent.session;
    if (session === null) {
      const raw = await this.#storage.get(this.storageKey);
      if (raw !== null) {
        try {
          session = parseProductSession(JSON.parse(raw));
        } catch {
          return this.#pendingRevocation("The pending sign-out target is unavailable; secure storage requires repair.");
        }
        await this.#saveRevocationIntent(createRevocationIntent(this.#binding, this.#device, this.#revocationIntent.intentId, session));
      }
    }
    let sessionExpired = false;
    if (session !== null) {
      try {
        const networkEpoch = this.#networkEpoch;
        if (!this.#networkAvailable) fail10("NETWORK_UNAVAILABLE", "Network unavailable before Product Session revocation");
        const now = await this.#now();
        if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) fail10("NETWORK_UNAVAILABLE", "Network changed while reading revocation authority time");
        sessionExpired = typeof this.#gateway.currentTime === "function" && session.expiresAt <= now.toISOString();
        if (!sessionExpired) {
          const body = {};
          const proof = await this.#proof(session, "/v2/product-sessions/revoke", body, now);
          if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) fail10("NETWORK_UNAVAILABLE", "Network changed during Product Session revocation signing");
          const result = await this.#gateway.revoke({ requestId: gatewayRequestId("r", proof.nonce), sessionBinding: session.sessionBinding, proof });
          if (result?.revoked !== session.sessionBinding) fail10("INVALID_GATEWAY_RESPONSE", "Gateway did not confirm the exact Product Session revocation");
        }
      } catch (error) {
        if (isNetworkUnavailable(error)) return this.#offline("Network unavailable while revoking the Product Session; protected state was retained for Retry");
        if (!(error instanceof WalletAuthError) || error.code !== "SESSION_REVOKED") {
          this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Gateway did not confirm Product Session revocation; protected state was retained", { actions: ["retry"] });
          return this.#state;
        }
      }
    }
    if (session === null && await this.#storage.get(`${this.storageKey}:return`) !== null) return this.#pendingRevocation("A prior completion has not yielded its exact target; sign-out confirmation is still pending.");
    try {
      await this.#finishRevocationIntent();
    } catch {
      return this.#pendingRevocation("The authority result was received but secure cleanup is pending; Retry the same sign-out target.");
    }
    this.#revocationRequested = false;
    this.#revocationIntent = null;
    this.#state = state(sessionExpired ? PRODUCT_SESSION_CLIENT_STATE.EXPIRED : PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED, session === null ? "No authoritative Product Session was present; local connection request was removed" : sessionExpired ? "Auth confirmed that the exact Product Session expired; no revocation receipt was claimed" : "Auth confirmed revocation of the exact Product Session", { revocationConfirmed: session !== null && !sessionExpired, ...session ? { sessionBinding: session.sessionBinding } : {} });
    return this.#state;
  }
  async createIntrospectionProof(requiredScopes2) {
    return this.#createAPIProof(requiredScopes2);
  }
  // Two separate proofs: fresh identity introspection and the exact business body.
  // The server must atomically consume the action nonce with its own transaction.
  async createSocialAudienceProof(input) {
    exactFields(input, ["path", "body"], "Social audience action");
    const path2 = input.path, raw = input.body;
    if (this.#binding.productId !== "social" || !["/social/v3/matrix/audience/resolve", "/social/v3/matrix/audience/authorize"].includes(path2)) fail10("HTTP_BINDING_MISMATCH", "Social audience proof requires an exact registered action path");
    if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 16384) fail10("INVALID_FIELD", "Social action body must be bounded canonical JSON");
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      fail10("INVALID_FIELD", "Social action body is invalid JSON");
    }
    if (body === null || typeof body !== "object" || Array.isArray(body) || canonicalJSON(body) !== raw) fail10("INVALID_FIELD", "Social action body must be a canonical JSON object");
    assertActionUnicode(body);
    return this.#createAPIProof(["social.contacts", "social.feed", "social.messaging", "social.profile"], Object.freeze({ path: path2, body }));
  }
  // Generic business request proof: independent from one-shot introspection.
  // The server supplies route-required scopes and consumes the returned nonce
  // with its original actor/object transaction; proof alone is not permission.
  async createBusinessProof(input) {
    exactFields(input, ["method", "path", "body", "requiredScopes"], "Product business request");
    const method2 = input.method, path2 = input.path, raw = input.body instanceof Uint8Array ? Uint8Array.from(input.body) : input.body;
    if (typeof method2 !== "string" || !/^(GET|POST|PUT|PATCH|DELETE)$/.test(method2) || typeof path2 !== "string" || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@\/-]{1,255}$/.test(path2) || path2.includes("//") || path2.endsWith("/") || path2.split("/").some((part) => part === "." || part === "..") || path2.startsWith("/v2/product-sessions/") || path2.startsWith("/v2/browser-sessions/")) fail10("HTTP_BINDING_MISMATCH", "Business proof requires an exact product route");
    if (typeof raw !== "string" && !(raw instanceof Uint8Array) || (typeof raw === "string" ? new TextEncoder().encode(raw).length : raw.length) > 16777216) fail10("INVALID_FIELD", "Business request body is not bounded");
    if (method2 === "GET") {
      if (raw.length !== 0) fail10("HTTP_BINDING_MISMATCH", "GET business proof binds an empty HTTP body");
    }
    return this.#createAPIProof(input.requiredScopes, Object.freeze({ method: method2, path: path2, body: null, rawBody: raw }));
  }
  // Hash FINAL wire serialization, including multipart boundaries. The server
  // hashes its bounded actual incoming stream before accepting the proof.
  // A caller-supplied hash is never evidence that actual bytes were delivered.
  async createBusinessProofCommitment(input) {
    exactFields(input, ["method", "path", "bodyDigest", "bodyBytes", "requiredScopes"], "Product business commitment");
    const { method: method2, path: path2, bodyDigest, bodyBytes } = input;
    if (typeof method2 !== "string" || !/^(GET|POST|PUT|PATCH|DELETE)$/.test(method2) || typeof path2 !== "string" || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@\/-]{1,255}$/.test(path2) || path2.includes("//") || path2.endsWith("/") || path2.split("/").some((part) => part === "." || part === "..") || path2.startsWith("/v2/product-sessions/") || path2.startsWith("/v2/browser-sessions/")) fail10("HTTP_BINDING_MISMATCH", "Business proof requires an exact product route");
    if (typeof bodyDigest !== "string" || !/^[0-9a-f]{64}$/.test(bodyDigest) || !Number.isSafeInteger(bodyBytes) || bodyBytes < 0 || bodyBytes > 536870912) fail10("INVALID_FIELD", "Commitment requires SHA-256 and bounded final wire byte count");
    if (method2 === "GET" && (bodyBytes !== 0 || bodyDigest !== httpBodyDigest(""))) fail10("HTTP_BINDING_MISMATCH", "GET commitment must bind an empty body");
    return this.#createAPIProof(input.requiredScopes, Object.freeze({ method: method2, path: path2, body: null, bodyDigest, bodyBytes }));
  }
  async #createAPIProof(requiredScopes2, action = null) {
    const expected = this.current, epoch = this.#beginEpoch, networkEpoch = this.#networkEpoch;
    const active = () => {
      if (this.#revocationRequested || this.#disconnectPromise !== null) fail10("REVOCATION_PENDING", "Pending sign-out blocks Product Session API proofs");
      if (!this.#networkAvailable || networkEpoch !== this.#networkEpoch) fail10("NETWORK_UNAVAILABLE", "Network changed during Product Session API authorization");
      if (this.current !== expected || epoch !== this.#beginEpoch || expected.status !== PRODUCT_SESSION_CLIENT_STATE.CONNECTED || !expected.session) fail10("SESSION_INACTIVE", "Connect and verify the same Product Session before signing an API proof");
    };
    active();
    const session = parseProductSession(expected.session);
    for (const field of ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback"]) {
      if (session[field] !== this.#binding[field]) fail10("SESSION_BINDING_MISMATCH", "API proof session belongs to another product binding");
    }
    if (session.deviceId !== this.#device.id || session.deviceKey !== this.#device.key) fail10("SESSION_BINDING_MISMATCH", "API proof session belongs to another product device");
    const scopeCount = Array.isArray(requiredScopes2) ? requiredScopes2.length : 0;
    if (!Number.isInteger(scopeCount) || scopeCount < 1 || scopeCount > 8) fail10("SCOPE_WIDENING", "API proof scopes must be a nonempty sorted unique subset of the granted session");
    const scopes2 = Object.freeze(Array.from({ length: scopeCount }, (_, index) => requiredScopes2[index]));
    if (scopes2.some((scope2) => typeof scope2 !== "string" || !session.scopes.includes(scope2) || !this.#device.scopes.includes(scope2) || !this.#binding.scopes.includes(scope2)) || new Set(scopes2).size !== scopes2.length || [...scopes2].sort().join("\n") !== scopes2.join("\n")) fail10("SCOPE_WIDENING", "API proof scopes must be a nonempty sorted unique subset of the granted session");
    const body = Object.freeze({ requiredScopes: scopes2 });
    let originalRaw;
    const readback = async () => {
      active();
      if (await this.#loadRevocationIntent()) fail10("REVOCATION_PENDING", "Pending sign-out blocks Product Session API proofs");
      active();
      const raw = await this.#storage.get(this.storageKey);
      active();
      let stored;
      try {
        if (typeof raw !== "string" || raw.length > 16384) fail10("SESSION_INACTIVE", "Stored Product Session is unavailable");
        stored = parseProductSession(JSON.parse(raw));
      } catch {
        fail10("SESSION_INACTIVE", "Stored Product Session is invalid; no API proof was released");
      }
      if (canonicalJSON(stored) !== canonicalJSON(session) || originalRaw !== void 0 && raw !== originalRaw) fail10("SESSION_INACTIVE", "Stored Product Session changed during API authorization");
      originalRaw = raw;
      if (await this.#loadRevocationIntent()) fail10("REVOCATION_PENDING", "Sign-out started during Product Session API authorization");
      active();
    };
    await readback();
    active();
    if (typeof this.#gateway.currentTime !== "function") fail10("CLOCK_UNAVAILABLE", "Product Session API proofs require authority time");
    let now;
    try {
      now = new Date((await this.#now()).getTime());
    } catch (error) {
      active();
      if (isNetworkUnavailable(error)) throw error;
      fail10("CLOCK_UNAVAILABLE", "Product Session authority time is unavailable");
    }
    active();
    if (now.toISOString() < session.issuedAt || now.toISOString() >= session.expiresAt) fail10("SESSION_EXPIRED", "Product Session is outside its authority-time validity window");
    const proof = await this.#proof(session, "/v2/product-sessions/introspect", body, now, { active, readback });
    const result = Object.freeze({ proof, proofHeader: encodeProductSessionGatewayProofHeaderV2(proof), requestId: gatewayRequestId("i", this.#tokens()), body: canonicalJSON(body) });
    const actionProof = action === null ? null : await this.#proof(session, action.path, action.body, now, { active, readback }, action.method ?? "POST", action.rawBody ?? null, action.bodyDigest ?? null);
    await readback();
    active();
    if (actionProof !== null) return Object.freeze({ introspection: result, proof: actionProof, proofHeader: encodeProductSessionGatewayProofHeaderV2(actionProof), body: action.bodyDigest ? null : action.rawBody ?? canonicalJSON(action.body), ...action.bodyDigest ? { commitment: Object.freeze({ bodyDigest: action.bodyDigest, bodyBytes: action.bodyBytes }) } : {} });
    return result;
  }
  async #introspect(session) {
    if (await this.#loadRevocationIntent()) fail10("REVOCATION_PENDING", "Pending sign-out blocks Product Session authorization");
    const networkEpoch = this.#networkEpoch;
    if (!this.#networkAvailable) fail10("NETWORK_UNAVAILABLE", "Network unavailable before Product Session introspection");
    const body = { requiredScopes: session.scopes };
    const proof = await this.#proof(session, "/v2/product-sessions/introspect", body);
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) fail10("NETWORK_UNAVAILABLE", "Network changed during Product Session introspection signing");
    const result = await this.#gateway.introspect({ requestId: gatewayRequestId("i", proof.nonce), sessionBinding: session.sessionBinding, requiredScopes: session.scopes, proof });
    if (await this.#loadRevocationIntent()) fail10("REVOCATION_PENDING", "Sign-out started during Product Session authorization");
    if (result?.active !== true || canonicalJSON(parseProductSession(result.session)) !== canonicalJSON(session)) fail10("SESSION_INACTIVE", "Gateway did not confirm the exact Product Session");
    return result;
  }
  async #proof(session, path2, body, authorityTime, guard = null, method2 = "POST", rawBody = null, committedDigest = null) {
    if (path2 !== "/v2/product-sessions/revoke" && await this.#loadRevocationIntent()) fail10("REVOCATION_PENDING", "Pending sign-out blocks Product Session authorization");
    const networkEpoch = this.#networkEpoch;
    const now = authorityTime ?? await this.#now();
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) fail10("NETWORK_UNAVAILABLE", "Network changed while reading proof authority time");
    const expiresAt = new Date(Math.min(now.getTime() + 3e4, Date.parse(session.expiresAt))).toISOString();
    if (expiresAt <= now.toISOString()) fail10("SESSION_EXPIRED", "Product Session expired before sender-constrained authorization");
    const input = {
      method: method2,
      path: path2,
      bodyDigest: committedDigest ?? httpBodyDigest(rawBody ?? canonicalJSON(body)),
      nonce: this.#tokens(),
      issuedAt: now.toISOString(),
      expiresAt
    };
    if (guard !== null) {
      await guard.readback();
      guard.active();
    }
    const proof = this.#device.sign ? await createProductSessionProofV2With(session, input, this.#device.sign) : createProductSessionProofV2(session, input, this.#device.secret);
    if (guard !== null) {
      await guard.readback();
      guard.active();
    }
    return proof;
  }
  async #now() {
    const value = typeof this.#gateway.currentTime === "function" ? await this.#gateway.currentTime({ requestId: gatewayRequestId("t", this.#tokens()) }) : this.#clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail10("CLOCK_UNAVAILABLE", "Product Session authority time is invalid");
    return value;
  }
  async #restoreStoredSession(epoch) {
    const revoking = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (revoking) return this.#pendingRevocation();
    const raw = await this.#storage.get(this.storageKey);
    if (epoch !== this.#beginEpoch) return this.current;
    if (raw === null) return null;
    const networkEpoch = this.#networkEpoch;
    try {
      const session = parseProductSession(JSON.parse(raw));
      await this.#introspect(session);
      if (epoch !== this.#beginEpoch) return this.current;
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed during Product Session re-introspection; protected state was retained for Retry");
      await this.#clearPending(epoch);
      if (epoch !== this.#beginEpoch) return this.current;
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while restoring the Product Session; protected state was retained for Retry");
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.CONNECTED, "Authoritative Product Session restored", { session });
      return this.#state;
    } catch (error) {
      if (epoch !== this.#beginEpoch) return this.current;
      if (this.#revocationRequested || error?.code === "REVOCATION_PENDING") return this.#pendingRevocation();
      if (isNetworkUnavailable(error)) return this.#offline("Network unavailable during Product Session re-introspection; protected state was retained but is not authoritative");
      await this.#storage.remove(this.storageKey);
      return null;
    }
  }
  async #clearPending(epoch) {
    const mutation = this.#beginMutation.then(async () => {
      for (const suffix of ["pending", "return", "completion"]) {
        if (epoch !== void 0 && epoch !== this.#beginEpoch) return;
        await this.#storage.remove(`${this.storageKey}:${suffix}`);
      }
    });
    this.#beginMutation = mutation.catch(() => {
    });
    return mutation;
  }
  async #loadRevocationIntent() {
    if (this.#storage.revocationRequested?.() === true) this.#revocationRequested = true;
    const raw = await this.#storage.get(`${this.storageKey}:revoke`);
    if (raw !== null) {
      this.#revocationRequested = true;
      this.#revocationIntent = parseRevocationIntent(raw, this.#binding, this.#device);
    }
    return this.#revocationRequested;
  }
  async #prepareRevocationIntent() {
    await this.#loadRevocationIntent();
    if (this.#revocationIntent !== null) {
      let intent2 = this.#revocationIntent;
      if (intent2.session === null) {
        const completion = await this.#storage.get(`${this.storageKey}:completion`);
        if (completion !== null) intent2 = createRevocationIntent(this.#binding, this.#device, intent2.intentId, deriveCompletionTarget(this.#registry, completion));
      }
      await this.#saveRevocationIntent(intent2);
      return;
    }
    let session = this.#state.session ?? null;
    if (session === null) {
      const raw = await this.#storage.get(this.storageKey);
      if (raw !== null) session = parseProductSession(JSON.parse(raw));
    }
    if (session === null) {
      const raw = await this.#storage.get(`${this.storageKey}:completion`);
      if (raw !== null) session = deriveCompletionTarget(this.#registry, raw);
    }
    const intent = createRevocationIntent(this.#binding, this.#device, this.#tokens(), session);
    this.#revocationIntent = intent;
    await this.#saveRevocationIntent(intent);
  }
  async #saveRevocationIntent(intent) {
    const raw = canonicalJSON(intent), key = `${this.storageKey}:revoke`;
    if (typeof this.#storage.saveRevocationIntent === "function") {
      this.#revocationIntent = parseRevocationIntent(await this.#storage.saveRevocationIntent(key, raw), this.#binding, this.#device);
    } else {
      await this.#storage.set(key, raw);
      if (await this.#storage.get(key) !== raw) fail10("INSECURE_STORAGE", "Pending sign-out intent did not read back exactly");
      this.#revocationIntent = intent;
    }
  }
  async #finishRevocationIntent() {
    const intent = this.#revocationIntent, key = `${this.storageKey}:revoke`, raw = canonicalJSON(intent);
    if (typeof this.#storage.finishRevocationIntent === "function") return this.#storage.finishRevocationIntent(key, raw);
    if (await this.#storage.get(key) !== raw) fail10("REVOCATION_CHANGED", "Pending sign-out target changed during confirmation");
    if (revocationSessionMatches(await this.#storage.get(this.storageKey), intent.session)) await this.#storage.remove(this.storageKey);
    await this.#clearPending();
    await this.#storage.remove(key);
  }
  #pendingRevocation(message = "Sign-out confirmation is pending; only explicit Retry may contact Auth. Product authorization is suspended.") {
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, message, { actions: ["retry"], revocationPending: true });
    return this.#state;
  }
  async #recover(operation) {
    if (this.#recoveryPromise !== null) return this.#recoveryPromise;
    const pending = operation();
    this.#recoveryPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.#recoveryPromise === pending) this.#recoveryPromise = null;
    }
  }
  #offline(message = "Network unavailable; cached Product Session is not treated as authoritative") {
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE, message, { actions: this.#revocationRequested ? ["retry"] : ["retry", "guest"], ...this.#revocationRequested ? { revocationPending: true } : {} });
    return this.#state;
  }
  #networkTransition(message) {
    if (!this.#networkAvailable) return this.#offline(message);
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, message, { actions: ["retry", "guest"] });
    return this.#state;
  }
};
function state(status2, message, extra = {}) {
  return Object.freeze({ status: status2, message, ...extra, ...extra.actions ? { actions: Object.freeze(extra.actions) } : {}, ...extra.limitations ? { limitations: Object.freeze(extra.limitations) } : {} });
}
function secureStorage(value, platform, device2) {
  const nativeProtected = value && ["hardware-backed", "os-protected"].includes(value.securityLevel);
  const browserProtected = value?.securityLevel === "webcrypto-nonextractable" && platform === "web" && typeof device2?.sign === "function" && !("secret" in device2);
  if (!nativeProtected && !browserProtected || ["get", "set", "remove"].some((name) => typeof value[name] !== "function")) fail10("INSECURE_STORAGE", "Product Sessions require OS/hardware protection or a Web-only non-extractable device signer");
  return value;
}
function gateway(value) {
  if (!value || ["challenge", "complete", "introspect", "revoke", "walletInstalled", "schemeRegistered"].some((name) => typeof value[name] !== "function")) fail10("INVALID_GATEWAY", "Product Session client requires a real Gateway adapter");
  return value;
}
function device(value) {
  const fields = Object.keys(value ?? {}).sort().join("\n");
  const secretFields = ["id", "key", "secret", "scopes", "purpose"].sort().join("\n");
  const signerFields = ["id", "key", "sign", "scopes", "purpose"].sort().join("\n");
  if (fields !== secretFields && fields !== signerFields) fail10("UNKNOWN_OR_MISSING_FIELD", "Product Session device configuration fields do not match the protocol schema");
  if (typeof value.id !== "string" || typeof value.key !== "string" || !Array.isArray(value.scopes) || typeof value.purpose !== "string" || (fields === secretFields ? typeof value.secret !== "string" : typeof value.sign !== "function")) fail10("INVALID_DEVICE", "Product Session device configuration is invalid");
  return Object.freeze({ ...value, scopes: Object.freeze([...value.scopes]) });
}
function tokenFactory(value) {
  if (typeof value !== "function") fail10("INVALID_RANDOM_SOURCE", "Product Session client requires a cryptographic token factory");
  return () => {
    const token2 = value();
    if (typeof token2 !== "string" || !/^[A-Za-z0-9_-]{32,64}$/.test(token2)) fail10("INVALID_RANDOM_SOURCE", "Product Session token factory returned an invalid token");
    return token2;
  };
}
function clock(value) {
  if (typeof value !== "function") fail10("INVALID_TIME", "Product Session client requires a clock");
  return () => {
    const result = value();
    if (!(result instanceof Date) || !Number.isFinite(result.getTime())) fail10("INVALID_TIME", "Product Session clock returned invalid time");
    return result;
  };
}
function isNetworkUnavailable(error) {
  return error instanceof WalletAuthError && ["NETWORK_UNAVAILABLE", "CLOCK_UNAVAILABLE"].includes(error.code);
}
function gatewayRequestId(kind, token2) {
  return `req_ps_${kind}_${token2}`;
}
function fail10(code, message) {
  throw new WalletAuthError(code, message);
}
function assertActionUnicode(value) {
  if (typeof value === "string") {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code >= 55296 && code <= 56319) {
        const next = value.charCodeAt(++i);
        if (!(next >= 56320 && next <= 57343)) fail10("INVALID_FIELD", "Social action body contains an unpaired Unicode surrogate");
      } else if (code >= 56320 && code <= 57343) fail10("INVALID_FIELD", "Social action body contains an unpaired Unicode surrogate");
    }
  } else if (Array.isArray(value)) {
    for (const child of value) assertActionUnicode(child);
  } else if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      assertActionUnicode(key);
      assertActionUnicode(value[key]);
    }
  }
}
var BROWSER_PRODUCT_SESSION_SECURITY_LEVEL = "webcrypto-nonextractable";
var DATABASE = "ynx-product-session-web-v2";
var DEVICE_STORE = "devices";
var STATE_STORE = "state";
async function createBrowserProductSessionClient(config) {
  const { registry, productId, scopes: scopes2, purpose, gateway: gateway2, finiteServiceSeconds, environment = globalThis, clock: clock2 = () => /* @__PURE__ */ new Date() } = config ?? {};
  if (!config || Object.keys(config).some((key) => !["registry", "productId", "scopes", "purpose", "gateway", "environment", "clock", "finiteServiceSeconds"].includes(key))) fail11("INVALID_DEVICE", "Browser Product Session configuration is invalid");
  const binding = productPlatformBinding(registry, productId, "web");
  const authority = productSessionGatewayAuthority(gateway2);
  if (environment?.isSecureContext !== true || environment.location?.origin !== binding.origin) fail11("ORIGIN_NOT_ALLOWED", "Browser Product Sessions require the registered product HTTPS origin");
  const crypto2 = environment.crypto;
  if (!crypto2?.subtle || typeof crypto2.getRandomValues !== "function" || typeof environment.indexedDB?.open !== "function") fail11("INSECURE_STORAGE", "This browser cannot persist a non-extractable WebCrypto device key");
  validateScopes(scopes2, binding.scopes);
  if (typeof purpose !== "string" || purpose.length < 1 || purpose.length > 180 || purpose.trim() !== purpose || typeof clock2 !== "function") fail11("INVALID_DEVICE", "Browser Product Session purpose or clock is invalid");
  const approvedScopes = Object.freeze([...scopes2]);
  const namespace = canonicalJSON({ authority, chainId: binding.chainId, productId, clientId: binding.clientId, applicationId: binding.applicationId, origin: binding.origin, callback: binding.callback, scopes: approvedScopes });
  const storageKey = `ynx.product-session.v2:${productId}:web:${binding.applicationId}`;
  const revocationKey = `${storageKey}:revoke`;
  const allowedKeys = /* @__PURE__ */ new Set([storageKey, `${storageKey}:pending`, `${storageKey}:return`, `${storageKey}:completion`, revocationKey]);
  const randomToken = () => encodeBase64url(crypto2.getRandomValues(new Uint8Array(32)));
  const db = await openDatabase(environment.indexedDB);
  let closed = false, revocationAttempted = false;
  const close = () => {
    closed = true;
    db.close();
  };
  db.onversionchange = close;
  try {
    let assertStorageKey = function(key) {
      if (!allowedKeys.has(key)) fail11("CROSS_PRODUCT_SESSION", "Browser storage key is outside this product binding");
    }, assertStoredValue = function(key, value) {
      if (typeof value !== "string" || value.length > 16384) fail11("INSECURE_STORAGE", "Browser Product Session storage value is invalid");
      if (key === `${storageKey}:return`) return;
      if (key === revocationKey) {
        parseRevocationIntent(value, binding, device2);
        return;
      }
      let input;
      try {
        input = JSON.parse(value);
      } catch {
        fail11("INVALID_SESSION_STORE", "Browser Product Session storage is invalid JSON");
      }
      if (key === `${storageKey}:completion`) input = parseCompletionRecord(registry, value, new Date(input.completion?.challenge?.issuedAt)).request;
      if (key === storageKey) input = parseProductSession(input);
      for (const field of ["chainId", "productId", "clientId", "applicationId", "origin", "callback"]) if (input?.[field] !== binding[field]) fail11("CROSS_PRODUCT_SESSION", "Stored browser session crosses its registered product binding");
      if (input.platform !== "web" || input.bundleId !== null || input.packageId !== null || input.deviceId !== record.deviceId || input.deviceKey !== record.deviceKey) fail11("DEVICE_CHANGED", "Stored browser session does not match this device key");
      if (canonicalJSON(input.scopes) !== canonicalJSON(approvedScopes)) fail11("SCOPE_WIDENING", "Stored browser session does not match this scope binding");
    }, readIntent = function(state2) {
      const raw = state2.values[revocationKey] ?? null;
      return raw === null ? null : parseRevocationIntent(raw, binding, device2);
    }, stateOperation = function(mode, callback2) {
      if (closed || environment.location?.origin !== binding.origin) fail11("INSECURE_STORAGE", "Browser Product Session storage is no longer available at this origin");
      return transact(db, mode, namespace, (context) => {
        assertRecord(context.device, context.state, namespace, allowedKeys, authority);
        if (context.device.deviceId !== record.deviceId || context.device.deviceKey !== record.deviceKey) fail11("DEVICE_CHANGED", "Persisted browser device changed; start a new explicit connection");
        return callback2(context);
      });
    }, currentRecord = function() {
      return stateOperation("readonly", ({ device: device3 }) => device3);
    }, signingRecord = function(subject, purpose2) {
      return stateOperation("readonly", ({ device: current, state: state2 }) => {
        const pending = readIntent(state2);
        if (pending || revocationAttempted || signals.pending()) {
          const target = pending?.session;
          if (purpose2 !== "http-proof" || subject.path !== "/v2/product-sessions/revoke" || subject.method !== "POST" || subject.bodyDigest !== httpBodyDigest("{}") || !target || subject.sessionBinding !== target.sessionBinding || subject.account !== target.account) fail11("REVOCATION_PENDING", "Pending sign-out permits only the exact target revocation proof");
        } else if (purpose2 === "http-proof") {
          const raw = state2.values[storageKey], session = raw ? parseProductSession(JSON.parse(raw)) : null;
          if (!session || subject.sessionBinding !== session.sessionBinding || subject.account !== session.account) fail11("SESSION_INACTIVE", "Stored Product Session changed before signing");
        }
        return current;
      });
    };
    let record = await transact(db, "readonly", namespace, ({ device: device3, state: state2 }) => {
      if (device3 === void 0 && state2 === void 0) return null;
      assertRecord(device3, state2, namespace, allowedKeys, authority);
      return device3;
    });
    if (record === null) {
      let pair;
      try {
        pair = await crypto2.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
      } catch {
        fail11("INSECURE_STORAGE", "Browser WebCrypto device key generation failed");
      }
      const candidate = { version: 2, authority, namespace, deviceId: `web_${randomToken()}`, deviceKey: await publicDeviceKey(crypto2, pair.publicKey), privateKey: pair.privateKey, publicKey: pair.publicKey };
      record = await transact(db, "readwrite", namespace, ({ device: device3, state: state2, devices, states }) => {
        if (device3 !== void 0 || state2 !== void 0) {
          assertRecord(device3, state2, namespace, allowedKeys, authority);
          return device3;
        }
        const initial = { version: 2, authority, deviceId: candidate.deviceId, deviceKey: candidate.deviceKey, values: {} };
        assertRecord(candidate, initial, namespace, allowedKeys, authority);
        devices.add(candidate, namespace);
        states.add(initial, namespace);
        return candidate;
      });
    }
    const signals = browserRevocationSignals(environment.localStorage ?? globalThis.localStorage, namespace, record.deviceId, randomToken);
    const persisted = await currentRecord();
    await verifyKeyPair(crypto2, persisted);
    const device2 = Object.freeze({ id: record.deviceId, key: record.deviceKey, scopes: approvedScopes, purpose, sign });
    const storage = Object.freeze({
      securityLevel: BROWSER_PRODUCT_SESSION_SECURITY_LEVEL,
      requestRevocation: () => signals.request(),
      revocationRequested: () => signals.pending(),
      async get(key) {
        assertStorageKey(key);
        return stateOperation("readonly", ({ state: state2 }) => {
          const value = state2.values[key] ?? null;
          if (value !== null) assertStoredValue(key, value);
          return value;
        });
      },
      async set(key, value) {
        assertStorageKey(key);
        assertStoredValue(key, value);
        return stateOperation("readwrite", ({ state: state2, states }) => {
          const pending = readIntent(state2);
          if (pending && key !== revocationKey) {
            if (key !== storageKey) fail11("REVOCATION_PENDING", "Sign-out blocks new connection requests");
            const session = parseProductSession(JSON.parse(value));
            if (pending.session !== null && !revocationSessionMatches(value, pending.session)) fail11("REVOCATION_PENDING", "Sign-out target cannot be replaced by another session");
            if (pending.session === null) state2.values[revocationKey] = canonicalJSON(createRevocationIntent(binding, device2, pending.intentId, session));
          }
          state2.values[key] = value;
          states.put(state2, namespace);
        });
      },
      async remove(key) {
        assertStorageKey(key);
        return stateOperation("readwrite", ({ state: state2, states }) => {
          delete state2.values[key];
          states.put(state2, namespace);
        });
      },
      async saveRevocationIntent(key, raw) {
        if (key !== revocationKey) fail11("CROSS_PRODUCT_SESSION", "Sign-out intent key is invalid");
        revocationAttempted = true;
        const candidate = parseRevocationIntent(raw, binding, device2);
        return stateOperation("readwrite", ({ state: state2, states }) => {
          let intent = readIntent(state2);
          if (intent === null) intent = candidate;
          else if (intent.intentId === candidate.intentId && intent.session === null && candidate.session !== null) intent = candidate;
          if (intent.session === null && state2.values[storageKey]) intent = createRevocationIntent(binding, device2, intent.intentId, parseProductSession(JSON.parse(state2.values[storageKey])));
          const value = canonicalJSON(intent);
          state2.values[revocationKey] = value;
          states.put(state2, namespace);
          return value;
        });
      },
      async finishRevocationIntent(key, raw) {
        if (key !== revocationKey) fail11("CROSS_PRODUCT_SESSION", "Sign-out intent key is invalid");
        const intent = parseRevocationIntent(raw, binding, device2);
        await stateOperation("readwrite", ({ state: state2, states }) => {
          if (state2.values[revocationKey] !== raw) fail11("REVOCATION_CHANGED", "Sign-out target changed before secure cleanup");
          const current = state2.values[storageKey] ?? null;
          if (revocationSessionMatches(current, intent.session)) delete state2.values[storageKey];
          if (current === null || revocationSessionMatches(current, intent.session)) {
            delete state2.values[`${storageKey}:pending`];
            delete state2.values[`${storageKey}:return`];
            delete state2.values[`${storageKey}:completion`];
          }
          delete state2.values[revocationKey];
          states.put(state2, namespace);
        });
        signals.finish();
        revocationAttempted = false;
      }
    });
    const client = new RecoverableProductSessionClient({ registry, productId, platform: "web", storage, gateway: gateway2, device: device2, tokenFactory: randomToken, clock: clock2, ...Object.hasOwn(config, "finiteServiceSeconds") ? { finiteServiceSeconds } : {} });
    const capabilities = Object.freeze({ securityLevel: BROWSER_PRODUCT_SESSION_SECURITY_LEVEL, privateKeyExtractable: false, persistedCryptoKey: true, osProtected: false, hardwareBacked: false, origin: binding.origin, productId, scopes: approvedScopes });
    return Object.freeze({
      client,
      device: device2,
      storage,
      capabilities,
      createIntrospectionProof,
      createSocialAudienceProof: (input) => client.createSocialAudienceProof(input),
      createBusinessProof: (input) => client.createBusinessProof(input),
      createBusinessProofCommitment: (input) => client.createBusinessProofCommitment(input),
      close
    });
    async function sign(input) {
      exactFields(input, ["purpose", "algorithm", "deviceKey", "payload"], "Browser device signing request");
      if (!["challenge", "http-proof"].includes(input.purpose) || input.algorithm !== "p256-sha256" || input.deviceKey !== record.deviceKey || typeof input.payload !== "string" || input.payload.length > 16384) fail11("INVALID_DEVICE_PROOF", "Browser device signing request does not match this key");
      const payload = decodeBase64url(input.payload, "browser signing payload");
      const prefix = input.purpose === "challenge" ? "YNX_PRODUCT_SESSION_CHALLENGE_V2\n" : "YNX_PRODUCT_SESSION_HTTP_PROOF_V2\n";
      const text3 = new TextDecoder("utf-8", { fatal: true }).decode(payload);
      if (!text3.startsWith(prefix)) fail11("INVALID_DEVICE_PROOF", "Browser device signing purpose does not match its payload");
      let subject;
      try {
        subject = JSON.parse(text3.slice(prefix.length));
      } catch {
        fail11("INVALID_DEVICE_PROOF", "Browser device signing payload is invalid");
      }
      for (const field of ["productId", "clientId", "applicationId", "origin", "callback"]) if (subject[field] !== binding[field]) fail11("CROSS_PRODUCT_SESSION", "Browser signer cannot sign for another product binding");
      if (subject.deviceId !== record.deviceId || subject.deviceKey !== record.deviceKey || subject.bundleId !== null || subject.packageId !== null) fail11("DEVICE_CHANGED", "Browser signing payload does not match this device");
      if (input.purpose === "challenge" && (subject.platform !== "web" || canonicalJSON(subject.scopes) !== canonicalJSON(approvedScopes))) fail11("SCOPE_WIDENING", "Browser challenge crosses the configured scope binding");
      const active = await signingRecord(subject, input.purpose);
      let signature;
      try {
        signature = new Uint8Array(await crypto2.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, active.privateKey, payload));
        if (!await crypto2.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, active.publicKey, signature, payload)) fail11("DEVICE_CHANGED", "Browser device key pair no longer matches");
      } catch (error) {
        if (error instanceof WalletAuthError) throw error;
        fail11("DEVICE_SIGNING_FAILED", "Browser device signing failed");
      }
      await signingRecord(subject, input.purpose);
      return encodeBase64url(p1363ToDER(signature));
    }
    async function assertAPIActive(expected) {
      if (client.current !== expected) fail11("SESSION_INACTIVE", "Product Session changed during API authorization");
      await stateOperation("readonly", ({ state: state2 }) => {
        if (readIntent(state2) !== null || revocationAttempted || signals.pending() || !revocationSessionMatches(state2.values[storageKey] ?? null, expected.session)) fail11("SESSION_INACTIVE", "Pending sign-out or a changed stored session blocks API authorization");
      });
    }
    async function createIntrospectionProof(requiredScopes2) {
      const count = Array.isArray(requiredScopes2) ? requiredScopes2.length : 0;
      if (!Number.isInteger(count) || count < 1 || count > 8) fail11("SCOPE_WIDENING", "Browser Product Session scopes must be an exact sorted registered subset");
      const selectedScopes = Object.freeze(Array.from({ length: count }, (_, index) => requiredScopes2[index]));
      validateScopes(selectedScopes, approvedScopes);
      const state2 = client.current;
      if (state2.status !== "connected" || !state2.session) fail11("SESSION_INACTIVE", "Connect and verify a Product Session before signing an API proof");
      await assertAPIActive(state2);
      const session = state2.session;
      const now = typeof gateway2.currentTime === "function" ? await gateway2.currentTime({ requestId: `req_web_t_${randomToken()}` }) : clock2();
      if (client.current !== state2) fail11("SESSION_INACTIVE", "Product Session changed while reading authority time");
      await assertAPIActive(state2);
      if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || Date.parse(session.expiresAt) <= now.getTime()) fail11("SESSION_EXPIRED", "Product Session expired before API authorization");
      const body = canonicalJSON({ requiredScopes: selectedScopes });
      const proof = await createProductSessionProofV2With(session, { method: "POST", path: "/v2/product-sessions/introspect", bodyDigest: httpBodyDigest(body), nonce: randomToken(), issuedAt: now.toISOString(), expiresAt: new Date(Math.min(now.getTime() + 3e4, Date.parse(session.expiresAt))).toISOString() }, sign);
      if (client.current !== state2) fail11("SESSION_INACTIVE", "Product Session changed during API proof signing");
      await assertAPIActive(state2);
      return Object.freeze({ proof, proofHeader: encodeProductSessionGatewayProofHeaderV2(proof), requestId: `req_web_${randomToken()}`, body });
    }
  } catch (error) {
    close();
    throw error;
  }
}
function assertRecord(device2, state2, namespace, allowedKeys, authority) {
  if (!device2 || !state2) fail11("DEVICE_CHANGED", "Browser device or session storage is missing; automatic key replacement is forbidden");
  exactFields(device2, ["version", "authority", "namespace", "deviceId", "deviceKey", "privateKey", "publicKey"], "Persisted browser device");
  exactFields(state2, ["version", "authority", "deviceId", "deviceKey", "values"], "Persisted browser session state");
  if (device2.version !== 2 || device2.authority !== authority || state2.authority !== authority || device2.namespace !== namespace || !/^web_[A-Za-z0-9_-]{43}$/.test(device2.deviceId) || !/^[A-Za-z0-9_-]{44}$/.test(device2.deviceKey) || state2.version !== 2 || state2.deviceId !== device2.deviceId || state2.deviceKey !== device2.deviceKey) fail11("DEVICE_CHANGED", "Persisted browser device binding is invalid");
  for (const [key, type, usage] of [[device2.privateKey, "private", "sign"], [device2.publicKey, "public", "verify"]]) {
    if (!key || key.type !== type || key.algorithm?.name !== "ECDSA" || key.algorithm.namedCurve !== "P-256" || key.usages?.length !== 1 || key.usages[0] !== usage || type === "private" && key.extractable !== false) fail11("INSECURE_STORAGE", "Persisted browser key must be a non-extractable P-256 signing key");
  }
  if (!state2.values || typeof state2.values !== "object" || Array.isArray(state2.values) || Object.keys(state2.values).some((key) => !allowedKeys.has(key) || typeof state2.values[key] !== "string" || state2.values[key].length > 16384)) fail11("INVALID_SESSION_STORE", "Persisted browser session state crosses its storage binding");
}
async function publicDeviceKey(crypto2, key) {
  let raw;
  try {
    raw = new Uint8Array(await crypto2.subtle.exportKey("raw", key));
  } catch {
    fail11("INSECURE_STORAGE", "Browser device public key cannot be verified");
  }
  if (raw.length !== 65 || raw[0] !== 4) fail11("INVALID_DEVICE_KEY", "Browser P-256 public key encoding is invalid");
  return encodeBase64url(Uint8Array.of(2 | raw[64] & 1, ...raw.slice(1, 33)));
}
async function verifyKeyPair(crypto2, record) {
  if (await publicDeviceKey(crypto2, record.publicKey) !== record.deviceKey) fail11("DEVICE_CHANGED", "Persisted browser public key does not match its device binding");
  const payload = crypto2.getRandomValues(new Uint8Array(32));
  try {
    const signature = await crypto2.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, record.privateKey, payload);
    if (!await crypto2.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, record.publicKey, signature, payload)) fail11("DEVICE_CHANGED", "Persisted browser private and public keys do not match");
  } catch (error) {
    if (error instanceof WalletAuthError) throw error;
    fail11("INSECURE_STORAGE", "Persisted browser CryptoKey cannot sign after restoration");
  }
}
function p1363ToDER(signature) {
  if (signature.length !== 64) fail11("INVALID_DEVICE_PROOF", "Browser ECDSA signature must use P-256 IEEE P1363 encoding");
  const integer = (bytes) => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    const value = bytes.slice(start);
    return value[0] & 128 ? Uint8Array.of(0, ...value) : value;
  };
  const r = integer(signature.slice(0, 32)), s = integer(signature.slice(32));
  return Uint8Array.of(48, r.length + s.length + 4, 2, r.length, ...r, 2, s.length, ...s);
}
function validateScopes(scopes2, allowed) {
  if (!Array.isArray(scopes2) || scopes2.length < 1 || scopes2.length > 8 || scopes2.some((scope2) => typeof scope2 !== "string" || !allowed.includes(scope2)) || new Set(scopes2).size !== scopes2.length || [...scopes2].sort().join("\n") !== scopes2.join("\n")) fail11("SCOPE_WIDENING", "Browser Product Session scopes must be an exact sorted registered subset");
}
function browserRevocationSignals(storage, namespace, deviceId, token2) {
  const prefix = "ynx.product-session.signout.v1:" + encodeBase64url(new TextEncoder().encode(canonicalJSON({ namespace, deviceId }))) + ":";
  let owned = [];
  function keys() {
    try {
      if (!storage || !Number.isInteger(storage.length)) throw Error("unavailable");
      const found = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (typeof key === "string" && key.startsWith(prefix)) {
          if (storage.getItem(key) !== "pending-v1") throw Error("invalid");
          found.push(key);
        }
      }
      return found;
    } catch {
      fail11("INSECURE_STORAGE", "Synchronous sign-out protection is unavailable");
    }
  }
  return Object.freeze({
    pending() {
      return keys().length !== 0;
    },
    request() {
      const prior = keys(), key = prefix + token2();
      try {
        storage.setItem(key, "pending-v1");
        if (storage.getItem(key) !== "pending-v1") throw Error("not saved");
      } catch {
        fail11("INSECURE_STORAGE", "Sign-out signal could not be saved");
      }
      owned = [...prior, key];
    },
    finish() {
      try {
        for (const key of owned) storage.removeItem(key);
      } catch {
        fail11("INSECURE_STORAGE", "Committed sign-out still has a pending signal");
      }
      owned = [];
    }
  });
}
function openDatabase(indexedDB) {
  return new Promise((resolve, reject) => {
    let settled = false, request;
    const timer = setTimeout(() => rejected(), 1e4);
    const rejected = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new WalletAuthError("INSECURE_STORAGE", "Browser IndexedDB device storage is unavailable"));
    };
    try {
      request = indexedDB.open(DATABASE, 1);
    } catch {
      rejected();
      return;
    }
    request.onupgradeneeded = () => {
      if (settled) {
        try {
          request.transaction?.abort();
        } catch {
        }
        return;
      }
      const db = request.result;
      for (const name of [DEVICE_STORE, STATE_STORE]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    request.onerror = rejected;
    request.onblocked = rejected;
    request.onsuccess = () => {
      if (settled) request.result.close();
      else {
        settled = true;
        clearTimeout(timer);
        resolve(request.result);
      }
    };
  });
}
function transact(db, mode, namespace, operation) {
  return new Promise((resolve, reject) => {
    let transaction, result, caught, settled = false, timer;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    try {
      transaction = db.transaction([DEVICE_STORE, STATE_STORE], mode);
      if (mode === "readonly") timer = setTimeout(() => {
        caught = new WalletAuthError("INSECURE_STORAGE", "Browser IndexedDB device read timed out");
        try {
          transaction.abort();
        } catch {
        }
        finish(caught);
      }, 1e4);
      const devices = transaction.objectStore(DEVICE_STORE), states = transaction.objectStore(STATE_STORE);
      const deviceRequest = devices.get(namespace), stateRequest = states.get(namespace);
      let received = 0;
      const ready = () => {
        if (settled || ++received !== 2) return;
        try {
          result = operation({ device: deviceRequest.result, state: stateRequest.result, devices, states });
        } catch (error) {
          caught = error;
          transaction.abort();
        }
      };
      deviceRequest.onsuccess = ready;
      stateRequest.onsuccess = ready;
      transaction.oncomplete = () => finish();
      transaction.onabort = transaction.onerror = () => finish(caught ?? new WalletAuthError("INSECURE_STORAGE", "Browser IndexedDB device transaction failed"));
    } catch {
      finish(new WalletAuthError("INSECURE_STORAGE", "Browser IndexedDB device transaction is unavailable"));
    }
  });
}
function fail11(code, message) {
  throw new WalletAuthError(code, message);
}

// private-session.js
var SOCIAL_AUTHORITY = "https://wallet-auth.ynxweb4.com";
var SOCIAL_PRIVATE_SCOPES = Object.freeze(["account:read", "profile:link"]);
var SOCIAL_CHAT_SCOPES = Object.freeze(["account:read", "profile:link", "social.contacts", "social.messaging", "social.profile"]);
var SOCIAL_AUDIENCE_SCOPES = Object.freeze(["account:read", "profile:link", "social.contacts", "social.feed", "social.messaging", "social.profile"]);
async function unverifiedLaunch() {
  throw Object.assign(new Error("This browser cannot verify the installed YNX Wallet launcher. Standard wallet connection remains available."), { code: "WALLET_LAUNCH_UNVERIFIED" });
}
function createSocialPrivateSession({ environment = globalThis, detectWalletEnvironment = unverifiedLaunch, factory = createBrowserProductSessionClient, scopes: scopes2 = SOCIAL_PRIVATE_SCOPES, registryTimeoutMs = 1e4 } = {}) {
  if (![SOCIAL_PRIVATE_SCOPES, SOCIAL_CHAT_SCOPES, SOCIAL_AUDIENCE_SCOPES].some((selection) => JSON.stringify(selection) === JSON.stringify(scopes2))) throw new Error("Unsupported Social permission selection");
  if (!Number.isSafeInteger(registryTimeoutMs) || registryTimeoutMs < 1 || registryTimeoutMs > 1e4) throw new Error("Invalid registry read deadline");
  let adapterPromise;
  let operation = Promise.resolve();
  let suspended = false;
  let current = { status: "guest" };
  const registryError = (code, message) => Object.assign(new Error(message), { code, retryable: true });
  async function readRegistry() {
    const controller = new AbortController();
    let timer, reading = true, expired = false;
    const timeoutError = registryError("SOCIAL_REGISTRY_TIMEOUT", "Connection is taking too long. Please try again. Your account data is retained.");
    const check = () => {
      if (expired || !reading) throw timeoutError;
    };
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        expired = true;
        controller.abort();
        reject(timeoutError);
      }, registryTimeoutMs);
    });
    const read = (async () => {
      try {
        const response = await environment.fetch(new URL("./vendor/product-session-registry.json", import.meta.url), { credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal });
        check();
        if (!response.ok) throw registryError("SOCIAL_REGISTRY_UNAVAILABLE", "Connection is temporarily unavailable. Please try again. Your account data is retained.");
        const registry = await response.json();
        check();
        return registry;
      } catch (error) {
        if (expired || !reading) throw timeoutError;
        if (error?.code === "SOCIAL_REGISTRY_UNAVAILABLE") throw error;
        throw registryError(error instanceof SyntaxError ? "SOCIAL_REGISTRY_INVALID" : "SOCIAL_REGISTRY_NETWORK_UNAVAILABLE", "Connection is temporarily unavailable. Please try again. Your account data is retained.");
      }
    })();
    try {
      return await Promise.race([read, deadline]);
    } finally {
      reading = false;
      clearTimeout(timer);
      controller.abort();
    }
  }
  async function adapter() {
    if (!adapterPromise) {
      const attempt = (async () => {
        const registry = await readRegistry();
        const gateway2 = new ProductSessionGatewayFetchAdapter({
          endpoint: SOCIAL_AUTHORITY,
          fetch: environment.fetch.bind(environment),
          timeoutMs: 1e4,
          walletInstalled: async () => (await detectWalletEnvironment()).walletInstalled,
          schemeRegistered: async () => (await detectWalletEnvironment()).schemeRegistered
        });
        return factory({ registry, productId: "social", scopes: [...scopes2], purpose: scopes2.includes("social.feed") ? "Authorize Social profile, contacts, encrypted chat and publishing on this browser device. Feed, media, reports and follows access is included. No payments or recovery keys. This requires a new visible approval; old grants are not upgraded." : scopes2.includes("social.messaging") ? "Authorize your Social profile, contact requests and encrypted chat on this browser device. No payments or recovery keys." : "Link your account to YNX Social. This does not authorize messages or payments.", gateway: gateway2, environment });
      })().catch((error) => {
        if (adapterPromise === attempt) adapterPromise = void 0;
        throw error;
      });
      adapterPromise = attempt;
    }
    return adapterPromise;
  }
  function run(action) {
    const next = operation.then(async () => {
      const result = await action(await adapter());
      if (result?.status) current = result;
      return result;
    });
    operation = next.catch(() => {
    });
    return next;
  }
  return Object.freeze({
    get current() {
      return current;
    },
    begin: () => {
      suspended = false;
      const wallet = environment.YNXSocialWallet;
      const intentRevision = wallet?.getIntentRevision?.() ?? wallet?.getRevision?.();
      const assertIntent = () => {
        if (suspended || intentRevision !== (wallet?.getIntentRevision?.() ?? wallet?.getRevision?.())) throw new Error("SOCIAL_CONTEXT_CHANGED");
      };
      const reservation = wallet?.hasSelection?.() ? wallet.reserve() : Promise.resolve();
      reservation.catch(() => {
      });
      return run(async ({ client }) => {
        await reservation;
        assertIntent();
        const revision = wallet?.getRevision?.();
        const assertSelected = () => {
          if (suspended || revision !== wallet?.getRevision?.()) throw new Error("SOCIAL_CONTEXT_CHANGED");
        };
        assertSelected();
        let result = await client.beginExplicit();
        assertSelected();
        if (result.status === "retry-required" && wallet?.available?.() && typeof client.retryDetected === "function") {
          result = await client.retryDetected();
          assertSelected();
        }
        if (result.status !== "connecting" || result.route?.status !== "ready" || !wallet?.available?.()) return result;
        const response = await wallet.requestProductSessionV2(result.route.url);
        assertSelected();
        const url2 = new URL(response.returnUrl);
        if (url2.origin !== "https://social.ynxweb4.com" || url2.pathname !== "/wallet-auth/callback") throw new Error("Unexpected Social Wallet callback origin or path.");
        const settled = await client.handleReturn(url2.href);
        assertSelected();
        if (settled.status === "connected" && !wallet.accountMatches(settled.session.account)) {
          await client.disconnect();
          throw new Error("SOCIAL_ACCOUNT_MISMATCH");
        }
        return settled;
      });
    },
    restore: () => run(async ({ client, storage }) => {
      const pending = await storage.get(`${client.storageKey}:pending`);
      if (pending !== null) return { status: "connecting", automatic: false, message: "A Wallet approval request is pending. Return from Wallet to finish it, or explicitly start a new identity link. Retry has not replaced the request." };
      return client.restore(environment.navigator?.onLine !== false);
    }),
    handleReturn: (url2) => run(({ client }) => {
      const parsed = new URL(url2);
      if (parsed.origin !== "https://social.ynxweb4.com" || parsed.pathname !== "/wallet-auth/callback") throw new Error("Unexpected Social Wallet callback origin or path.");
      return client.handleReturn(url2);
    }),
    disconnect: () => {
      suspended = true;
      current = { status: "retry-required" };
      return run(({ client }) => client.disconnect());
    },
    proof: (required) => run(async ({ createIntrospectionProof }) => {
      if (suspended) throw new Error("Social authorization is suspended");
      const proof = await createIntrospectionProof(required);
      if (suspended) throw new Error("Social authorization is suspended");
      return proof;
    }),
    createSocialAudienceProof: (input) => run(async (adapter2) => {
      if (suspended || !scopes2.includes("social.feed")) throw new Error("Explicit Social publishing permission is required");
      const owner = typeof adapter2.createSocialAudienceProof === "function" ? adapter2 : adapter2.client;
      if (typeof owner?.createSocialAudienceProof !== "function") throw Object.assign(new Error("The installed Social SDK does not provide business action proofs. Nothing was sent."), { code: "SOCIAL_ACTION_PROOF_UNAVAILABLE" });
      const result = await owner.createSocialAudienceProof(input);
      if (suspended) throw new Error("Social authorization is suspended");
      return result;
    })
  });
}

// ../src/invitationIntent.ts
function checkedInvitationIntent(value, account2) {
  const record = value;
  if (!/^ynx1[0-9a-z]{38}$/.test(account2) || !record || Object.keys(record).sort().join(",") !== "account,key,schemaVersion,ttlSeconds" || record.schemaVersion !== 1 || record.account !== account2 || record.ttlSeconds !== 86400 || typeof record.key !== "string" || !/^invitation-[a-f0-9]{24}$/.test(record.key)) throw new Error("Original invitation intent requires storage recovery; no replacement was created");
  return Object.freeze({ ...record });
}
function checkedInvitationSnapshot(value) {
  const result = value;
  if (!result || !Array.isArray(result.invitations) || result.invitations.length > 1e4) throw new Error("Invitation readback could not be verified");
  const seen = /* @__PURE__ */ new Set();
  const invitations = result.invitations.map((record) => {
    if (!record || !/^invite_[a-f0-9]{24}$/.test(record.id) || seen.has(record.id) || typeof record.link !== "string" || !/^https:\/\/social\.ynxweb4\.com\/invite\/[A-Za-z0-9_-]{32}$/.test(record.link) || !["active", "expired", "revoked"].includes(record.status) || !Number.isFinite(Date.parse(record.expiresAt)) || !Number.isFinite(Date.parse(record.createdAt))) throw new Error("Invitation identity, route or status could not be verified");
    if (record.revokedAt !== void 0 && !Number.isFinite(Date.parse(record.revokedAt)) || record.status === "revoked" && !record.revokedAt || record.revokedAt && record.status !== "revoked") throw new Error("Invitation revocation readback could not be verified");
    seen.add(record.id);
    return Object.freeze({ ...record });
  });
  if (result.operation && (typeof result.operation.confirmed !== "boolean" || result.operation.confirmed && !invitations.some((record) => record.id === result.operation.id) || !result.operation.confirmed && result.operation.id !== void 0)) throw new Error("Original invitation operation was not confirmed");
  return Object.freeze({ invitations, operation: result.operation ? Object.freeze({ ...result.operation }) : void 0 });
}
function indexedDBInvitationIntents(factory = globalThis.indexedDB) {
  const open = () => new Promise((resolve, reject) => {
    if (!factory) {
      reject(new Error("Durable invitation storage is unavailable"));
      return;
    }
    const request = factory.open("ynx-social-invitation-intents-v1", 1);
    let settled = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("pending")) request.result.createObjectStore("pending");
    };
    request.onerror = () => {
      settled = true;
      reject(new Error("Original invitation storage could not be opened"));
    };
    request.onblocked = () => {
      settled = true;
      reject(new Error("Original invitation storage is busy; no reset or replacement was made"));
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
  });
  async function access(account2, mode, operation, guard = () => {
  }, signal) {
    if (!/^ynx1[0-9a-z]{38}$/.test(account2)) throw new Error("Original invitation account is required");
    guard();
    if (signal?.aborted) throw new Error("Invitation operation cancelled");
    const database = await open();
    return new Promise((resolve, reject) => {
      let result, failure, transaction;
      try {
        guard();
        if (signal?.aborted) throw new Error("Invitation operation cancelled");
        transaction = database.transaction("pending", mode);
      } catch (error) {
        database.close();
        reject(error);
        return;
      }
      const abort = () => {
        failure = new Error("Invitation operation cancelled; original intent retained");
        try {
          transaction.abort();
        } catch {
        }
      };
      signal?.addEventListener("abort", abort, { once: true });
      const close = () => {
        signal?.removeEventListener("abort", abort);
        database.close();
      };
      transaction.onabort = transaction.onerror = () => {
        close();
        reject(failure ?? new Error("Original invitation transaction failed; no replacement was made"));
      };
      transaction.oncomplete = () => {
        close();
        try {
          guard();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };
      const store = transaction.objectStore("pending"), request = store.get(account2);
      request.onsuccess = () => {
        try {
          guard();
          if (signal?.aborted) throw new Error("Invitation operation cancelled");
          result = operation(request.result, store);
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      request.onerror = () => {
        failure = new Error("Original invitation could not be read");
      };
    });
  }
  return {
    load: (account2) => access(account2, "readonly", (value) => value === void 0 ? null : checkedInvitationIntent(value, account2)),
    reserve: (candidate, guard, signal) => {
      candidate = checkedInvitationIntent(candidate, candidate.account);
      return access(candidate.account, "readwrite", (value, store) => {
        if (value !== void 0) return checkedInvitationIntent(value, candidate.account);
        store.put(candidate, candidate.account);
        return candidate;
      }, guard, signal);
    },
    clear: (account2, key, guard, signal) => access(account2, "readwrite", (value, store) => {
      if (value === void 0) return false;
      const original = checkedInvitationIntent(value, account2);
      if (original.key !== key) throw new Error("A different original invitation intent was retained");
      store.delete(account2);
      return true;
    }, guard, signal)
  };
}

// ../src/privacySettings.ts
function checkedPrivacySettings(value, account2) {
  if (!value || typeof value !== "object") throw new Error("Privacy settings could not be verified");
  const record = value;
  if (record.account !== account2 || ![record.discoverableByHandle, record.contactsMatching, record.allowRecommendations].every((item) => typeof item === "boolean") || !["everyone", "contacts", "nobody"].includes(String(record.allowRequestsFrom)) || record.avatarUrl !== void 0 && typeof record.avatarUrl !== "string" || record.profileQrPayload !== void 0 && typeof record.profileQrPayload !== "string") throw new Error("Privacy settings do not match the original Social account");
  return Object.freeze({ account: account2, discoverableByHandle: record.discoverableByHandle, contactsMatching: record.contactsMatching, allowRecommendations: record.allowRecommendations, allowRequestsFrom: record.allowRequestsFrom, avatarUrl: record.avatarUrl, profileQrPayload: record.profileQrPayload, updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : void 0 });
}

// ../src/contactOperation.ts
var ContactOperation = class {
  active = null;
  cancel() {
    this.active?.cancel();
    this.active = null;
  }
  async run(start, timeoutMs = 3e4) {
    if (this.active) throw new Error("A contact request is already being sent");
    const controller = new AbortController();
    let rejectWait;
    const stopped = new Promise((_, reject) => {
      rejectWait = reject;
    });
    const operation = {
      cancel: () => {
        rejectWait(new Error("Contact request wait cancelled; delivery is not confirmed"));
        controller.abort();
      }
    };
    this.active = operation;
    const timer = setTimeout(() => {
      rejectWait(new Error("Contact request timed out; delivery is not confirmed"));
      controller.abort();
    }, timeoutMs);
    try {
      return await Promise.race([start(controller.signal), stopped]);
    } finally {
      clearTimeout(timer);
      if (this.active === operation) this.active = null;
    }
  }
};

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/@noble/hashes/utils.js
function isBytes3(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
function anumber3(n, title = "") {
  if (typeof n !== "number") {
    const prefix = title && `"${title}" `;
    throw new TypeError(`${prefix}expected number, got ${typeof n}`);
  }
  if (!Number.isSafeInteger(n) || n < 0) {
    const prefix = title && `"${title}" `;
    throw new RangeError(`${prefix}expected integer >= 0, got ${n}`);
  }
}
function abytes3(value, length, title = "") {
  const bytes = isBytes3(value);
  const len = value?.length;
  const needsLen = length !== void 0;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    const message = prefix + "expected Uint8Array" + ofLen + ", got " + got;
    if (!bytes)
      throw new TypeError(message);
    throw new RangeError(message);
  }
  return value;
}
function ahash2(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new TypeError("Hash must wrapped by utils.createHasher");
  anumber3(h.outputLen);
  anumber3(h.blockLen);
  if (h.outputLen < 1)
    throw new Error('"outputLen" must be >= 1');
  if (h.blockLen < 1)
    throw new Error('"blockLen" must be >= 1');
}
function aexists2(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput2(out, instance) {
  abytes3(out, void 0, "digestInto() output");
  const min = instance.outputLen;
  if (out.length < min) {
    throw new RangeError('"digestInto() output" expected to be of length >=' + min);
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
function rotr2(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var hasHexBuiltin2 = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
var hexes2 = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex3(bytes) {
  abytes3(bytes);
  if (hasHexBuiltin2)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes2[bytes[i]];
  }
  return hex;
}
var asciis2 = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function asciiToBase162(ch) {
  if (ch >= asciis2._0 && ch <= asciis2._9)
    return ch - asciis2._0;
  if (ch >= asciis2.A && ch <= asciis2.F)
    return ch - (asciis2.A - 10);
  if (ch >= asciis2.a && ch <= asciis2.f)
    return ch - (asciis2.a - 10);
  return;
}
function hexToBytes3(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  if (hasHexBuiltin2) {
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
    const n1 = asciiToBase162(hex.charCodeAt(hi));
    const n2 = asciiToBase162(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new RangeError('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function utf8ToBytes2(str) {
  if (typeof str !== "string")
    throw new TypeError("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
function concatBytes3(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes3(a);
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
function createHasher2(hashCons, info = {}) {
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
function randomBytes3(bytesLength = 32) {
  anumber3(bytesLength, "bytesLength");
  const cr = typeof globalThis === "object" ? globalThis.crypto : null;
  if (typeof cr?.getRandomValues !== "function")
    throw new Error("crypto.getRandomValues must be defined");
  if (bytesLength > 65536)
    throw new RangeError(`"bytesLength" expected <= 65536, got ${bytesLength}`);
  return cr.getRandomValues(new Uint8Array(bytesLength));
}
var oidNist2 = (suffix) => ({
  // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
  // Larger suffix values would need base-128 OID encoding and a different length byte.
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/@noble/hashes/_md.js
function Chi2(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj2(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD2 = class {
  blockLen;
  outputLen;
  canXOF = false;
  padOffset;
  isLE;
  // For partial updates less than block size
  buffer;
  view;
  finished = false;
  length = 0;
  pos = 0;
  destroyed = false;
  constructor(blockLen, outputLen, padOffset, isLE3) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE3;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView2(this.buffer);
  }
  update(data) {
    aexists2(this);
    abytes3(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView2(data);
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
    aexists2(this);
    aoutput2(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE: isLE3 } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean2(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos; i < blockLen; i++)
      buffer[i] = 0;
    view.setBigUint64(blockLen - 8, BigInt(this.length * 8), isLE3);
    this.process(view, 0);
    const oview = createView2(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen must be aligned to 32bit");
    const outLen = len / 4;
    const state2 = this.get();
    if (outLen > state2.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state2[i], isLE3);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to ||= new this.constructor();
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
var SHA256_IV2 = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
var SHA512_IV = /* @__PURE__ */ Uint32Array.from([
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

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/@noble/hashes/_u64.js
var U32_MASK642 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n2 = /* @__PURE__ */ BigInt(32);
function fromBig2(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK642), l: Number(n >> _32n2 & U32_MASK642) };
  return { h: Number(n >> _32n2 & U32_MASK642) | 0, l: Number(n & U32_MASK642) | 0 };
}
function split2(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    const { h, l } = fromBig2(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var shrSH = (h, _l, s) => h >>> s;
var shrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
function add(Ah, Al, Bh, Bl) {
  const l = (Al >>> 0) + (Bl >>> 0);
  return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
}
var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/@noble/hashes/sha2.js
var SHA256_K2 = /* @__PURE__ */ Uint32Array.from([
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
var SHA256_W2 = /* @__PURE__ */ new Uint32Array(64);
var SHA2_32B2 = class extends HashMD2 {
  constructor(outputLen) {
    super(64, outputLen, 8, false);
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
    clean2(SHA256_W2);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean2(this.buffer);
  }
};
var _SHA2562 = class extends SHA2_32B2 {
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  A = SHA256_IV2[0] | 0;
  B = SHA256_IV2[1] | 0;
  C = SHA256_IV2[2] | 0;
  D = SHA256_IV2[3] | 0;
  E = SHA256_IV2[4] | 0;
  F = SHA256_IV2[5] | 0;
  G = SHA256_IV2[6] | 0;
  H = SHA256_IV2[7] | 0;
  constructor() {
    super(32);
  }
};
var K512 = /* @__PURE__ */ (() => split2([
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
var SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
var SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
var SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
var SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
var SHA2_64B = class extends HashMD2 {
  constructor(outputLen) {
    super(128, outputLen, 16, false);
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
    clean2(SHA512_W_H, SHA512_W_L);
  }
  destroy() {
    this.destroyed = true;
    clean2(this.buffer);
    this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
};
var _SHA512 = class extends SHA2_64B {
  Ah = SHA512_IV[0] | 0;
  Al = SHA512_IV[1] | 0;
  Bh = SHA512_IV[2] | 0;
  Bl = SHA512_IV[3] | 0;
  Ch = SHA512_IV[4] | 0;
  Cl = SHA512_IV[5] | 0;
  Dh = SHA512_IV[6] | 0;
  Dl = SHA512_IV[7] | 0;
  Eh = SHA512_IV[8] | 0;
  El = SHA512_IV[9] | 0;
  Fh = SHA512_IV[10] | 0;
  Fl = SHA512_IV[11] | 0;
  Gh = SHA512_IV[12] | 0;
  Gl = SHA512_IV[13] | 0;
  Hh = SHA512_IV[14] | 0;
  Hl = SHA512_IV[15] | 0;
  constructor() {
    super(64);
  }
};
var sha2562 = /* @__PURE__ */ createHasher2(
  () => new _SHA2562(),
  /* @__PURE__ */ oidNist2(1)
);
var sha512 = /* @__PURE__ */ createHasher2(
  () => new _SHA512(),
  /* @__PURE__ */ oidNist2(3)
);

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/@noble/curves/utils.js
var abytes4 = (value, length, title) => abytes3(value, length, title);
var anumber4 = anumber3;
var bytesToHex4 = bytesToHex3;
var concatBytes4 = (...arrays) => concatBytes3(...arrays);
var hexToBytes4 = (hex) => hexToBytes3(hex);
var isBytes4 = isBytes3;
var randomBytes4 = (bytesLength) => randomBytes3(bytesLength);
var _0n6 = /* @__PURE__ */ BigInt(0);
var _1n6 = /* @__PURE__ */ BigInt(1);
function abool2(value, title = "") {
  if (typeof value !== "boolean") {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected boolean, got type=" + typeof value);
  }
  return value;
}
function abignumber2(n) {
  if (typeof n === "bigint") {
    if (!isPosBig2(n))
      throw new RangeError("positive bigint expected, got " + n);
  } else
    anumber4(n);
  return n;
}
function asafenumber2(value, title = "") {
  if (typeof value !== "number") {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected number, got type=" + typeof value);
  }
  if (!Number.isSafeInteger(value)) {
    const prefix = title && `"${title}" `;
    throw new RangeError(prefix + "expected safe integer, got " + value);
  }
}
function hexToNumber2(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  return hex === "" ? _0n6 : BigInt("0x" + hex);
}
function bytesToNumberBE2(bytes) {
  return hexToNumber2(bytesToHex3(bytes));
}
function bytesToNumberLE2(bytes) {
  return hexToNumber2(bytesToHex3(copyBytes2(abytes3(bytes)).reverse()));
}
function numberToBytesBE2(n, len) {
  anumber3(len);
  if (len === 0)
    throw new RangeError("zero length");
  n = abignumber2(n);
  const hex = n.toString(16);
  if (hex.length > len * 2)
    throw new RangeError("number too large");
  return hexToBytes3(hex.padStart(len * 2, "0"));
}
function numberToBytesLE2(n, len) {
  return numberToBytesBE2(n, len).reverse();
}
function equalBytes(a, b) {
  a = abytes4(a);
  b = abytes4(b);
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function copyBytes2(bytes) {
  return Uint8Array.from(abytes4(bytes));
}
function asciiToBytes(ascii) {
  if (typeof ascii !== "string")
    throw new TypeError("ascii string expected, got " + typeof ascii);
  return Uint8Array.from(ascii, (c, i) => {
    const charCode = c.charCodeAt(0);
    if (c.length !== 1 || charCode > 127) {
      throw new RangeError(`string contains non-ASCII character "${ascii[i]}" with code ${charCode} at position ${i}`);
    }
    return charCode;
  });
}
var isPosBig2 = (n) => typeof n === "bigint" && _0n6 <= n;
function inRange2(n, min, max) {
  return isPosBig2(n) && isPosBig2(min) && isPosBig2(max) && min <= n && n < max;
}
function aInRange2(title, n, min, max) {
  if (!inRange2(n, min, max))
    throw new RangeError("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen2(n) {
  if (n < _0n6)
    throw new Error("expected non-negative bigint, got " + n);
  let len;
  for (len = 0; n > _0n6; n >>= _1n6, len += 1)
    ;
  return len;
}
var bitMask2 = (n) => (_1n6 << BigInt(n)) - _1n6;
function validateObject2(object, fields = {}, optFields = {}) {
  if (Object.prototype.toString.call(object) !== "[object Object]")
    throw new TypeError("expected valid options object");
  function checkField(fieldName, expectedType, isOpt) {
    if (!isOpt && expectedType !== "function" && !Object.hasOwn(object, fieldName))
      throw new TypeError(`param "${fieldName}" is invalid: expected own property`);
    const val = object[fieldName];
    if (isOpt && val === void 0)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new TypeError(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
  }
  const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
  iter(fields, false);
  iter(optFields, true);
}
var notImplemented = () => {
  throw new Error("not implemented");
};

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/@noble/curves/abstract/modular.js
var _0n7 = /* @__PURE__ */ BigInt(0);
var _1n7 = /* @__PURE__ */ BigInt(1);
var _2n5 = /* @__PURE__ */ BigInt(2);
var _3n3 = /* @__PURE__ */ BigInt(3);
var _4n3 = /* @__PURE__ */ BigInt(4);
var _5n2 = /* @__PURE__ */ BigInt(5);
var _7n3 = /* @__PURE__ */ BigInt(7);
var _8n2 = /* @__PURE__ */ BigInt(8);
var _9n2 = /* @__PURE__ */ BigInt(9);
var _16n2 = /* @__PURE__ */ BigInt(16);
function mod2(a, b) {
  if (b <= _0n7)
    throw new Error("mod: expected positive modulus, got " + b);
  const result = a % b;
  return result >= _0n7 ? result : b + result;
}
function pow22(x, power, modulo) {
  if (power < _0n7)
    throw new Error("pow2: expected non-negative exponent, got " + power);
  let res = x;
  while (power-- > _0n7) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert2(number, modulo) {
  if (number === _0n7)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _0n7)
    throw new Error("invert: expected positive modulus, got " + modulo);
  let a = mod2(number, modulo);
  let b = modulo;
  let x = _0n7, y = _1n7, u = _1n7, v = _0n7;
  while (a !== _0n7) {
    const q = b / a;
    const r = b - a * q;
    const m = x - u * q;
    const n = y - v * q;
    b = a, a = r, x = u, y = v, u = m, v = n;
  }
  const gcd = b;
  if (gcd !== _1n7)
    throw new Error("invert: does not exist");
  return mod2(x, modulo);
}
function assertIsSquare2(Fp2, root, n) {
  const F = Fp2;
  if (!F.eql(F.sqr(root), n))
    throw new Error("Cannot find square root");
}
function sqrt3mod42(Fp2, n) {
  const F = Fp2;
  const p1div4 = (F.ORDER + _1n7) / _4n3;
  const root = F.pow(n, p1div4);
  assertIsSquare2(F, root, n);
  return root;
}
function sqrt5mod82(Fp2, n) {
  const F = Fp2;
  const p5div8 = (F.ORDER - _5n2) / _8n2;
  const n2 = F.mul(n, _2n5);
  const v = F.pow(n2, p5div8);
  const nv = F.mul(n, v);
  const i = F.mul(F.mul(nv, _2n5), v);
  const root = F.mul(nv, F.sub(i, F.ONE));
  assertIsSquare2(F, root, n);
  return root;
}
function sqrt9mod162(P) {
  const Fp_ = Field2(P);
  const tn = tonelliShanks2(P);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P + _7n3) / _16n2;
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
    assertIsSquare2(F, root, n);
    return root;
  });
}
function tonelliShanks2(P) {
  if (P < _3n3)
    throw new Error("sqrt is not defined for small field");
  let Q = P - _1n7;
  let S = 0;
  while (Q % _2n5 === _0n7) {
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
  const Q1div2 = (Q + _1n7) / _2n5;
  return function tonelliSlow(Fp2, n) {
    const F = Fp2;
    if (F.is0(n))
      return n;
    if (FpLegendre2(F, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = F.mul(F.ONE, cc);
    let t = F.pow(n, Q);
    let R = F.pow(n, Q1div2);
    while (!F.eql(t, F.ONE)) {
      if (F.is0(t))
        return F.ZERO;
      let i = 1;
      let t_tmp = F.sqr(t);
      while (!F.eql(t_tmp, F.ONE)) {
        i++;
        t_tmp = F.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n7 << BigInt(M - i - 1);
      const b = F.pow(c, exponent);
      M = i;
      c = F.sqr(b);
      t = F.mul(t, c);
      R = F.mul(R, b);
    }
    return R;
  };
}
function FpSqrt2(P) {
  if (P % _4n3 === _3n3)
    return sqrt3mod42;
  if (P % _8n2 === _5n2)
    return sqrt5mod82;
  if (P % _16n2 === _9n2)
    return sqrt9mod162(P);
  return tonelliShanks2(P);
}
var isNegativeLE = (num, modulo) => (mod2(num, modulo) & _1n7) === _1n7;
var FIELD_FIELDS2 = [
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
function validateField2(field) {
  const initial = {
    ORDER: "bigint",
    BYTES: "number",
    BITS: "number"
  };
  const opts = FIELD_FIELDS2.reduce((map, val) => {
    map[val] = "function";
    return map;
  }, initial);
  validateObject2(field, opts);
  asafenumber2(field.BYTES, "BYTES");
  asafenumber2(field.BITS, "BITS");
  if (field.BYTES < 1 || field.BITS < 1)
    throw new Error("invalid field: expected BYTES/BITS > 0");
  if (field.ORDER <= _1n7)
    throw new Error("invalid field: expected ORDER > 1, got " + field.ORDER);
  return field;
}
function FpPow2(Fp2, num, power) {
  const F = Fp2;
  if (power < _0n7)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n7)
    return F.ONE;
  if (power === _1n7)
    return num;
  let p = F.ONE;
  let d = num;
  while (power > _0n7) {
    if (power & _1n7)
      p = F.mul(p, d);
    d = F.sqr(d);
    power >>= _1n7;
  }
  return p;
}
function FpInvertBatch2(Fp2, nums, passZero = false) {
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
function FpLegendre2(Fp2, n) {
  const F = Fp2;
  const p1mod2 = (F.ORDER - _1n7) / _2n5;
  const powered = F.pow(n, p1mod2);
  const yes = F.eql(powered, F.ONE);
  const zero = F.eql(powered, F.ZERO);
  const no = F.eql(powered, F.neg(F.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength2(n, nBitLength) {
  if (nBitLength !== void 0)
    anumber4(nBitLength);
  if (n <= _0n7)
    throw new Error("invalid n length: expected positive n, got " + n);
  if (nBitLength !== void 0 && nBitLength < 1)
    throw new Error("invalid n length: expected positive bit length, got " + nBitLength);
  const bits = bitLen2(n);
  if (nBitLength !== void 0 && nBitLength < bits)
    throw new Error(`invalid n length: expected bit length (${bits}) >= n.length (${nBitLength})`);
  const _nBitLength = nBitLength !== void 0 ? nBitLength : bits;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
var FIELD_SQRT2 = /* @__PURE__ */ new WeakMap();
var _Field2 = class {
  ORDER;
  BITS;
  BYTES;
  isLE;
  ZERO = _0n7;
  ONE = _1n7;
  _lengths;
  _mod;
  constructor(ORDER, opts = {}) {
    if (ORDER <= _1n7)
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
    const { nBitLength, nByteLength } = nLength2(ORDER, _nbitLength);
    if (nByteLength > 2048)
      throw new Error("invalid field: expected ORDER of <= 2048 bytes");
    this.ORDER = ORDER;
    this.BITS = nBitLength;
    this.BYTES = nByteLength;
    Object.freeze(this);
  }
  create(num) {
    return mod2(num, this.ORDER);
  }
  isValid(num) {
    if (typeof num !== "bigint")
      throw new TypeError("invalid field element: expected bigint, got " + typeof num);
    return _0n7 <= num && num < this.ORDER;
  }
  is0(num) {
    return num === _0n7;
  }
  // is valid and invertible
  isValidNot0(num) {
    return !this.is0(num) && this.isValid(num);
  }
  isOdd(num) {
    return (num & _1n7) === _1n7;
  }
  neg(num) {
    return mod2(-num, this.ORDER);
  }
  eql(lhs, rhs) {
    return lhs === rhs;
  }
  sqr(num) {
    return mod2(num * num, this.ORDER);
  }
  add(lhs, rhs) {
    return mod2(lhs + rhs, this.ORDER);
  }
  sub(lhs, rhs) {
    return mod2(lhs - rhs, this.ORDER);
  }
  mul(lhs, rhs) {
    return mod2(lhs * rhs, this.ORDER);
  }
  pow(num, power) {
    return FpPow2(this, num, power);
  }
  div(lhs, rhs) {
    return mod2(lhs * invert2(rhs, this.ORDER), this.ORDER);
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
    return invert2(num, this.ORDER);
  }
  sqrt(num) {
    let sqrt = FIELD_SQRT2.get(this);
    if (!sqrt)
      FIELD_SQRT2.set(this, sqrt = FpSqrt2(this.ORDER));
    return sqrt(this, num);
  }
  toBytes(num) {
    return this.isLE ? numberToBytesLE2(num, this.BYTES) : numberToBytesBE2(num, this.BYTES);
  }
  fromBytes(bytes, skipValidation = false) {
    abytes4(bytes);
    const { _lengths: allowedLengths, BYTES, isLE: isLE3, ORDER, _mod: modFromBytes } = this;
    if (allowedLengths) {
      if (bytes.length < 1 || !allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
        throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
      }
      const padded = new Uint8Array(BYTES);
      padded.set(bytes, isLE3 ? 0 : padded.length - bytes.length);
      bytes = padded;
    }
    if (bytes.length !== BYTES)
      throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
    let scalar = isLE3 ? bytesToNumberLE2(bytes) : bytesToNumberBE2(bytes);
    if (modFromBytes)
      scalar = mod2(scalar, ORDER);
    if (!skipValidation) {
      if (!this.isValid(scalar))
        throw new Error("invalid field element: outside of range 0..ORDER");
    }
    return scalar;
  }
  // TODO: we don't need it here, move out to separate fn
  invertBatch(lst) {
    return FpInvertBatch2(this, lst);
  }
  // We can't move this out because Fp6, Fp12 implement it
  // and it's unclear what to return in there.
  cmov(a, b, condition) {
    abool2(condition, "condition");
    return condition ? b : a;
  }
};
Object.freeze(_Field2.prototype);
function Field2(ORDER, opts = {}) {
  return new _Field2(ORDER, opts);
}

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/@noble/curves/abstract/curve.js
var _0n8 = /* @__PURE__ */ BigInt(0);
var _1n8 = /* @__PURE__ */ BigInt(1);
function negateCt2(condition, item) {
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
function calcWOpts2(W, scalarBits) {
  validateW2(W, scalarBits);
  const windows = Math.ceil(scalarBits / W) + 1;
  const windowSize = 2 ** (W - 1);
  const maxNumber = 2 ** W;
  const mask = bitMask2(W);
  const shiftBy = BigInt(W);
  return { windows, windowSize, mask, maxNumber, shiftBy };
}
function calcOffsets2(n, window, wOpts) {
  const { windowSize, mask, maxNumber, shiftBy } = wOpts;
  let wbits = Number(n & mask);
  let nextN = n >> shiftBy;
  if (wbits > windowSize) {
    wbits -= maxNumber;
    nextN += _1n8;
  }
  const offsetStart = window * windowSize;
  const offset = offsetStart + Math.abs(wbits) - 1;
  const isZero = wbits === 0;
  const isNeg = wbits < 0;
  const isNegF = window % 2 !== 0;
  const offsetF = offsetStart;
  return { nextN, offset, isZero, isNeg, isNegF, offsetF };
}
var pointPrecomputes2 = /* @__PURE__ */ new WeakMap();
var pointWindowSizes2 = /* @__PURE__ */ new WeakMap();
function getW2(P) {
  return pointWindowSizes2.get(P) || 1;
}
function assert02(n) {
  if (n !== _0n8)
    throw new Error("invalid wNAF");
}
var wNAF2 = class {
  BASE;
  ZERO;
  Fn;
  bits;
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
    while (n > _0n8) {
      if (n & _1n8)
        p = p.add(d);
      d = d.double();
      n >>= _1n8;
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
   * @param point - Point instance
   * @param W - window size
   * @returns precomputed point tables flattened to a single array
   */
  precomputeWindow(point, W) {
    const { windows, windowSize } = calcWOpts2(W, this.bits);
    const points = [];
    let p = point;
    let base = p;
    for (let window = 0; window < windows; window++) {
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
    const wo = calcWOpts2(W, this.bits);
    for (let window = 0; window < wo.windows; window++) {
      const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets2(n, window, wo);
      n = nextN;
      if (isZero) {
        f = f.add(negateCt2(isNegF, precomputes[offsetF]));
      } else {
        p = p.add(negateCt2(isNeg, precomputes[offset]));
      }
    }
    assert02(n);
    return { p, f };
  }
  /**
   * Implements unsafe EC multiplication using precomputed tables
   * and w-ary non-adjacent form.
   * @param acc - accumulator point to add result of multiplication
   * @returns point
   */
  wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
    const wo = calcWOpts2(W, this.bits);
    for (let window = 0; window < wo.windows; window++) {
      if (n === _0n8)
        break;
      const { nextN, offset, isZero, isNeg } = calcOffsets2(n, window, wo);
      n = nextN;
      if (isZero) {
        continue;
      } else {
        const item = precomputes[offset];
        acc = acc.add(isNeg ? item.negate() : item);
      }
    }
    assert02(n);
    return acc;
  }
  getPrecomputes(W, point, transform) {
    let comp = pointPrecomputes2.get(point);
    if (!comp) {
      comp = this.precomputeWindow(point, W);
      if (W !== 1) {
        if (typeof transform === "function")
          comp = transform(comp);
        pointPrecomputes2.set(point, comp);
      }
    }
    return comp;
  }
  cached(point, scalar, transform) {
    const W = getW2(point);
    return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
  }
  unsafe(point, scalar, transform, prev) {
    const W = getW2(point);
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
    pointPrecomputes2.delete(P);
  }
  hasCache(elm) {
    return getW2(elm) !== 1;
  }
};
function createField2(order, field, isLE3) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField2(field);
    return field;
  } else {
    return Field2(order, { isLE: isLE3 });
  }
}
function createCurveFields2(type, CURVE, curveOpts = {}, FpFnLE) {
  if (FpFnLE === void 0)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(typeof val === "bigint" && val > _0n8))
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
function createKeygen2(randomSecretKey, getPublicKey) {
  return function keygen(seed) {
    const secretKey = randomSecretKey(seed);
    return { secretKey, publicKey: getPublicKey(secretKey) };
  };
}

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/@noble/curves/abstract/edwards.js
var _0n9 = /* @__PURE__ */ BigInt(0);
var _1n9 = /* @__PURE__ */ BigInt(1);
var _2n6 = /* @__PURE__ */ BigInt(2);
var _8n3 = /* @__PURE__ */ BigInt(8);
function isEdValidXY(Fp2, CURVE, x, y) {
  const x2 = Fp2.sqr(x);
  const y2 = Fp2.sqr(y);
  const left = Fp2.add(Fp2.mul(CURVE.a, x2), y2);
  const right = Fp2.add(Fp2.ONE, Fp2.mul(CURVE.d, Fp2.mul(x2, y2)));
  return Fp2.eql(left, right);
}
function edwards(params, extraOpts = {}) {
  const opts = extraOpts;
  const validated = createCurveFields2("edwards", params, opts, opts.FpFnLE);
  const { Fp: Fp2, Fn: Fn2 } = validated;
  let CURVE = validated.CURVE;
  const { h: cofactor } = CURVE;
  validateObject2(opts, {}, { uvRatio: "function" });
  const MASK = _2n6 << BigInt(Fn2.BYTES * 8) - _1n9;
  const modP = (n) => Fp2.create(n);
  const uvRatio2 = opts.uvRatio === void 0 ? (u, v) => {
    try {
      return { isValid: true, value: Fp2.sqrt(Fp2.div(u, v)) };
    } catch (e) {
      return { isValid: false, value: _0n9 };
    }
  } : opts.uvRatio;
  if (!isEdValidXY(Fp2, CURVE, CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  function acoord(title, n, banZero = false) {
    const min = banZero ? _1n9 : _0n9;
    aInRange2("coordinate " + title, n, min, MASK);
    return n;
  }
  function aedpoint(other) {
    if (!(other instanceof Point))
      throw new Error("EdwardsPoint expected");
  }
  class Point {
    // base / generator point
    static BASE = new Point(CURVE.Gx, CURVE.Gy, _1n9, modP(CURVE.Gx * CURVE.Gy));
    // zero / infinity / identity point
    static ZERO = new Point(_0n9, _1n9, _1n9, _0n9);
    // 0, 1, 1, 0
    // math field
    static Fp = Fp2;
    // scalar field
    static Fn = Fn2;
    X;
    Y;
    Z;
    T;
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
    /**
     * Create one extended Edwards point from affine coordinates.
     * Does NOT validate that the point is on-curve or torsion-free.
     * Use `.assertValidity()` on adversarial inputs.
     */
    static fromAffine(p) {
      if (p instanceof Point)
        throw new Error("extended point not allowed");
      const { x, y } = p || {};
      acoord("x", x);
      acoord("y", y);
      return new Point(x, y, _1n9, modP(x * y));
    }
    // Uses algo from RFC8032 5.1.3.
    static fromBytes(bytes, zip215 = false) {
      const len = Fp2.BYTES;
      const { a, d } = CURVE;
      bytes = copyBytes2(abytes4(bytes, len, "point"));
      abool2(zip215, "zip215");
      const normed = copyBytes2(bytes);
      const lastByte = bytes[len - 1];
      normed[len - 1] = lastByte & ~128;
      const y = bytesToNumberLE2(normed);
      const max = zip215 ? MASK : Fp2.ORDER;
      aInRange2("point.y", y, _0n9, max);
      const y2 = modP(y * y);
      const u = modP(y2 - _1n9);
      const v = modP(d * y2 - a);
      let { isValid, value: x } = uvRatio2(u, v);
      if (!isValid)
        throw new Error("bad point: invalid y coordinate");
      const isXOdd = (x & _1n9) === _1n9;
      const isLastByteOdd = (lastByte & 128) !== 0;
      if (!zip215 && x === _0n9 && isLastByteOdd)
        throw new Error("bad point: x=0 and x_0=1");
      if (isLastByteOdd !== isXOdd)
        x = modP(-x);
      return Point.fromAffine({ x, y });
    }
    static fromHex(hex, zip215 = false) {
      return Point.fromBytes(hexToBytes4(hex), zip215);
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
        this.multiply(_2n6);
      return this;
    }
    // Useful in fromAffine() - not for fromBytes(), which always created valid points.
    assertValidity() {
      const p = this;
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
    }
    // Compare one point to another.
    equals(other) {
      aedpoint(other);
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
      const C = modP(_2n6 * modP(Z1 * Z1));
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
      aedpoint(other);
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
      aedpoint(other);
      return this.add(other.negate());
    }
    // Constant-time multiplication.
    multiply(scalar) {
      if (!Fn2.isValidNot0(scalar))
        throw new RangeError("invalid scalar: expected 1 <= sc < curve.n");
      const { p, f } = wnaf.cached(this, scalar, (p2) => normalizeZ2(Point, p2));
      return normalizeZ2(Point, [p, f])[0];
    }
    // Non-constant-time multiplication. Uses double-and-add algorithm.
    // It's faster, but should only be used when you don't care about
    // an exposed private key e.g. sig verification.
    // Keeps the same subgroup-scalar contract: 0 is allowed for public-scalar callers, but
    // n and larger values are rejected instead of being reduced mod n to the identity point.
    multiplyUnsafe(scalar) {
      if (!Fn2.isValid(scalar))
        throw new RangeError("invalid scalar: expected 0 <= sc < curve.n");
      if (scalar === _0n9)
        return Point.ZERO;
      if (this.is0() || scalar === _1n9)
        return this;
      return wnaf.unsafe(this, scalar, (p) => normalizeZ2(Point, p));
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
      return wnaf.unsafe(this, CURVE.n).is0();
    }
    // Converts Extended point to default (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    toAffine(invertedZ) {
      const p = this;
      let iz = invertedZ;
      const { X, Y, Z } = p;
      const is0 = p.is0();
      if (iz == null)
        iz = is0 ? _8n3 : Fp2.inv(Z);
      const x = modP(X * iz);
      const y = modP(Y * iz);
      const zz = Fp2.mul(Z, iz);
      if (is0)
        return { x: _0n9, y: _1n9 };
      if (zz !== _1n9)
        throw new Error("invZ was invalid");
      return { x, y };
    }
    clearCofactor() {
      if (cofactor === _1n9)
        return this;
      return this.multiplyUnsafe(cofactor);
    }
    toBytes() {
      const { x, y } = this.toAffine();
      const bytes = Fp2.toBytes(y);
      bytes[bytes.length - 1] |= x & _1n9 ? 128 : 0;
      return bytes;
    }
    toHex() {
      return bytesToHex4(this.toBytes());
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
  }
  const wnaf = new wNAF2(Point, Fn2.BITS);
  if (Fn2.BITS >= 8)
    Point.BASE.precompute(8);
  Object.freeze(Point.prototype);
  Object.freeze(Point);
  return Point;
}
var PrimeEdwardsPoint = class {
  static BASE;
  static ZERO;
  static Fp;
  static Fn;
  ep;
  /**
   * Wrap one internal Edwards representative directly.
   * This is not a canonical encoding boundary: alternate Edwards
   * representatives may still describe the same abstract wrapper element.
   */
  constructor(ep) {
    this.ep = ep;
  }
  // Static methods that must be implemented by subclasses
  static fromBytes(_bytes) {
    notImplemented();
  }
  static fromHex(_hex) {
    notImplemented();
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
  /**
   * Return affine coordinates of the current internal Edwards representative.
   * This is a convenience helper, not a canonical Ristretto/Decaf encoding.
   * Equal abstract elements may expose different `x` / `y`; use
   * `toBytes()` / `fromBytes()` for canonical roundtrips.
   */
  toAffine(invertedZ) {
    return this.ep.toAffine(invertedZ);
  }
  toHex() {
    return bytesToHex4(this.toBytes());
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
    this.ep.precompute(windowSize, isLazy);
    return this;
  }
};
function eddsa(Point, cHash, eddsaOpts = {}) {
  if (typeof cHash !== "function")
    throw new Error('"hash" function param is required');
  const hash = cHash;
  const opts = eddsaOpts;
  validateObject2(opts, {}, {
    adjustScalarBytes: "function",
    randomBytes: "function",
    domain: "function",
    prehash: "function",
    zip215: "boolean",
    mapToCurve: "function"
  });
  const { prehash } = opts;
  const { BASE, Fp: Fp2, Fn: Fn2 } = Point;
  const outputLen = hash.outputLen;
  const expectedLen = 2 * Fp2.BYTES;
  if (outputLen !== void 0) {
    asafenumber2(outputLen, "hash.outputLen");
    if (outputLen !== expectedLen)
      throw new Error(`hash.outputLen must be ${expectedLen}, got ${outputLen}`);
  }
  const randomBytes6 = opts.randomBytes === void 0 ? randomBytes4 : opts.randomBytes;
  const adjustScalarBytes2 = opts.adjustScalarBytes === void 0 ? (bytes) => bytes : opts.adjustScalarBytes;
  const domain = opts.domain === void 0 ? (data, ctx, phflag) => {
    abool2(phflag, "phflag");
    if (ctx.length || phflag)
      throw new Error("Contexts/pre-hash are not supported");
    return data;
  } : opts.domain;
  function modN_LE(hash2) {
    return Fn2.create(bytesToNumberLE2(hash2));
  }
  function getPrivateScalar(key) {
    const len = lengths.secretKey;
    abytes4(key, lengths.secretKey, "secretKey");
    const hashed = abytes4(hash(key), 2 * len, "hashedSecretKey");
    const head = adjustScalarBytes2(hashed.slice(0, len));
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
    return modN_LE(hash(domain(msg, abytes4(context, void 0, "context"), !!prehash)));
  }
  function sign(msg, secretKey, options = {}) {
    msg = abytes4(msg, void 0, "message");
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
    return abytes4(rs, lengths.signature, "result");
  }
  const verifyOpts = {
    zip215: opts.zip215
  };
  function verify(sig, msg, publicKey, options = verifyOpts) {
    const { context } = options;
    const zip215 = options.zip215 === void 0 ? !!verifyOpts.zip215 : options.zip215;
    const len = lengths.signature;
    sig = abytes4(sig, len, "signature");
    msg = abytes4(msg, void 0, "message");
    publicKey = abytes4(publicKey, lengths.publicKey, "publicKey");
    if (zip215 !== void 0)
      abool2(zip215, "zip215");
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
    const k = hashDomainToScalar(context, r, publicKey, msg);
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
  function randomSecretKey(seed) {
    seed = seed === void 0 ? randomBytes6(lengths.seed) : seed;
    return abytes4(seed, lengths.seed, "seed");
  }
  function isValidSecretKey(key) {
    return isBytes4(key) && key.length === lengths.secretKey;
  }
  function isValidPublicKey(key, zip215) {
    try {
      return !!Point.fromBytes(key, zip215 === void 0 ? verifyOpts.zip215 : zip215);
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
      const u = is25519 ? Fp2.div(_1n9 + y, _1n9 - y) : Fp2.div(y - _1n9, y + _1n9);
      return Fp2.toBytes(u);
    },
    toMontgomerySecret(secretKey) {
      const size = lengths.secretKey;
      abytes4(secretKey, size);
      const hashed = hash(secretKey.subarray(0, size));
      return adjustScalarBytes2(hashed).subarray(0, size);
    }
  };
  Object.freeze(lengths);
  Object.freeze(utils);
  return Object.freeze({
    keygen: createKeygen2(randomSecretKey, getPublicKey),
    getPublicKey,
    sign,
    verify,
    utils,
    Point,
    lengths
  });
}

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/@noble/curves/abstract/hash-to-curve.js
function i2osp(value, length) {
  asafenumber2(value);
  asafenumber2(length);
  if (length < 0 || length > 4)
    throw new Error("invalid I2OSP length: " + length);
  if (value < 0 || value > 2 ** (8 * length) - 1)
    throw new Error("invalid I2OSP input: " + value);
  const res = Array.from({ length }).fill(0);
  for (let i = length - 1; i >= 0; i--) {
    res[i] = value & 255;
    value >>>= 8;
  }
  return new Uint8Array(res);
}
function strxor(a, b) {
  const arr = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    arr[i] = a[i] ^ b[i];
  }
  return arr;
}
function normDST(DST) {
  if (!isBytes4(DST) && typeof DST !== "string")
    throw new Error("DST must be Uint8Array or ascii string");
  const dst = typeof DST === "string" ? asciiToBytes(DST) : DST;
  if (dst.length === 0)
    throw new Error("DST must be non-empty");
  return dst;
}
function expand_message_xmd(msg, DST, lenInBytes, H) {
  abytes4(msg);
  asafenumber2(lenInBytes);
  DST = normDST(DST);
  if (DST.length > 255)
    DST = H(concatBytes4(asciiToBytes("H2C-OVERSIZE-DST-"), DST));
  const { outputLen: b_in_bytes, blockLen: r_in_bytes } = H;
  const ell = Math.ceil(lenInBytes / b_in_bytes);
  if (lenInBytes > 65535 || ell > 255)
    throw new Error("expand_message_xmd: invalid lenInBytes");
  const DST_prime = concatBytes4(DST, i2osp(DST.length, 1));
  const Z_pad = new Uint8Array(r_in_bytes);
  const l_i_b_str = i2osp(lenInBytes, 2);
  const b = new Array(ell);
  const b_0 = H(concatBytes4(Z_pad, msg, l_i_b_str, i2osp(0, 1), DST_prime));
  b[0] = H(concatBytes4(b_0, i2osp(1, 1), DST_prime));
  for (let i = 1; i < ell; i++) {
    const args = [strxor(b_0, b[i - 1]), i2osp(i + 1, 1), DST_prime];
    b[i] = H(concatBytes4(...args));
  }
  const pseudo_random_bytes = concatBytes4(...b);
  return pseudo_random_bytes.slice(0, lenInBytes);
}
var _DST_scalar = "HashToScalar-";

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/@noble/curves/abstract/montgomery.js
var _0n10 = BigInt(0);
var _1n10 = BigInt(1);
var _2n7 = BigInt(2);
function validateOpts(curve) {
  validateObject2(curve, {
    P: "bigint",
    type: "string",
    adjustScalarBytes: "function",
    powPminus2: "function"
  }, {
    randomBytes: "function"
  });
  return Object.freeze({ ...curve });
}
function montgomery(curveDef) {
  const CURVE = validateOpts(curveDef);
  const { P, type, adjustScalarBytes: adjustScalarBytes2, powPminus2, randomBytes: rand } = CURVE;
  const is25519 = type === "x25519";
  if (!is25519 && type !== "x448")
    throw new Error("invalid type");
  const randomBytes_ = rand === void 0 ? randomBytes4 : rand;
  const montgomeryBits = is25519 ? 255 : 448;
  const fieldLen = is25519 ? 32 : 56;
  const Gu = is25519 ? BigInt(9) : BigInt(5);
  const a24 = is25519 ? BigInt(121665) : BigInt(39081);
  const minScalar = is25519 ? _2n7 ** BigInt(254) : _2n7 ** BigInt(447);
  const maxAdded = is25519 ? BigInt(8) * _2n7 ** BigInt(251) - _1n10 : BigInt(4) * _2n7 ** BigInt(445) - _1n10;
  const maxScalar = minScalar + maxAdded + _1n10;
  const modP = (n) => mod2(n, P);
  const GuBytes = encodeU(Gu);
  function encodeU(u) {
    return numberToBytesLE2(modP(u), fieldLen);
  }
  function decodeU(u) {
    const _u = copyBytes2(abytes4(u, fieldLen, "uCoordinate"));
    if (is25519)
      _u[31] &= 127;
    return modP(bytesToNumberLE2(_u));
  }
  function decodeScalar(scalar) {
    return bytesToNumberLE2(adjustScalarBytes2(copyBytes2(abytes4(scalar, fieldLen, "scalar"))));
  }
  function scalarMult(scalar, u) {
    const pu = montgomeryLadder(decodeU(u), decodeScalar(scalar));
    if (pu === _0n10)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  function scalarMultBase(scalar) {
    return scalarMult(scalar, GuBytes);
  }
  const getPublicKey = scalarMultBase;
  const getSharedSecret = scalarMult;
  function cswap(swap, x_2, x_3) {
    const dummy = modP(swap * (x_2 - x_3));
    x_2 = modP(x_2 - dummy);
    x_3 = modP(x_3 + dummy);
    return { x_2, x_3 };
  }
  function montgomeryLadder(u, scalar) {
    aInRange2("u", u, _0n10, P);
    aInRange2("scalar", scalar, minScalar, maxScalar);
    const k = scalar;
    const x_1 = u;
    let x_2 = _1n10;
    let z_2 = _0n10;
    let x_3 = u;
    let z_3 = _1n10;
    let swap = _0n10;
    for (let t = BigInt(montgomeryBits - 1); t >= _0n10; t--) {
      const k_t = k >> t & _1n10;
      swap ^= k_t;
      ({ x_2, x_3 } = cswap(swap, x_2, x_3));
      ({ x_2: z_2, x_3: z_3 } = cswap(swap, z_2, z_3));
      swap = k_t;
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
    ({ x_2, x_3 } = cswap(swap, x_2, x_3));
    ({ x_2: z_2, x_3: z_3 } = cswap(swap, z_2, z_3));
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
    abytes4(seed, lengths.seed, "seed");
    return seed;
  };
  const utils = { randomSecretKey };
  Object.freeze(lengths);
  Object.freeze(utils);
  return Object.freeze({
    keygen: createKeygen2(randomSecretKey, getPublicKey),
    getSharedSecret,
    getPublicKey,
    scalarMult,
    scalarMultBase,
    utils,
    GuBytes: GuBytes.slice(),
    lengths
  });
}

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/@noble/curves/ed25519.js
var _0n11 = /* @__PURE__ */ BigInt(0);
var _1n11 = /* @__PURE__ */ BigInt(1);
var _2n8 = /* @__PURE__ */ BigInt(2);
var _3n4 = /* @__PURE__ */ BigInt(3);
var _5n3 = /* @__PURE__ */ BigInt(5);
var _8n4 = /* @__PURE__ */ BigInt(8);
var ed25519_CURVE_p = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed");
var ed25519_CURVE = /* @__PURE__ */ (() => ({
  p: ed25519_CURVE_p,
  n: BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed"),
  h: _8n4,
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
  const b4 = pow22(b2, _2n8, P) * b2 % P;
  const b5 = pow22(b4, _1n11, P) * x % P;
  const b10 = pow22(b5, _5n3, P) * b5 % P;
  const b20 = pow22(b10, _10n, P) * b10 % P;
  const b40 = pow22(b20, _20n, P) * b20 % P;
  const b80 = pow22(b40, _40n, P) * b40 % P;
  const b160 = pow22(b80, _80n, P) * b80 % P;
  const b240 = pow22(b160, _80n, P) * b80 % P;
  const b250 = pow22(b240, _10n, P) * b10 % P;
  const pow_p_5_8 = pow22(b250, _2n8, P) * x % P;
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
  const v3 = mod2(v * v * v, P);
  const v7 = mod2(v3 * v3 * v, P);
  const pow = ed25519_pow_2_252_3(u * v7).pow_p_5_8;
  let x = mod2(u * v3 * pow, P);
  const vx2 = mod2(v * x * x, P);
  const root1 = x;
  const root2 = mod2(x * ED25519_SQRT_M1, P);
  const useRoot1 = vx2 === u;
  const useRoot2 = vx2 === mod2(-u, P);
  const noRoot = vx2 === mod2(-u * ED25519_SQRT_M1, P);
  if (useRoot1)
    x = root1;
  if (useRoot2 || noRoot)
    x = root2;
  if (isNegativeLE(x, P))
    x = mod2(-x, P);
  return { isValid: useRoot1 || useRoot2, value: x };
}
var ed25519_Point = /* @__PURE__ */ edwards(ed25519_CURVE, { uvRatio });
var Fp = /* @__PURE__ */ (() => ed25519_Point.Fp)();
var Fn = /* @__PURE__ */ (() => ed25519_Point.Fn)();
function ed(opts) {
  return eddsa(ed25519_Point, sha512, Object.assign({ adjustScalarBytes, zip215: true }, opts));
}
var ed25519 = /* @__PURE__ */ ed({});
var x25519 = /* @__PURE__ */ (() => {
  const P = ed25519_CURVE_p;
  return montgomery({
    P,
    type: "x25519",
    powPminus2: (x) => {
      const { pow_p_5_8, b2 } = ed25519_pow_2_252_3(x);
      return mod2(pow22(pow_p_5_8, _3n4, P) * b2, P);
    },
    adjustScalarBytes
  });
})();
var SQRT_M1 = ED25519_SQRT_M1;
var SQRT_AD_MINUS_ONE = /* @__PURE__ */ BigInt("25063068953384623474111414158702152701244531502492656460079210482610430750235");
var INVSQRT_A_MINUS_D = /* @__PURE__ */ BigInt("54469307008909316920995813868745141605393597292927456921205312896311721017578");
var ONE_MINUS_D_SQ = /* @__PURE__ */ BigInt("1159843021668779879193775521855586647937357759715417654439879720876111806838");
var D_MINUS_ONE_SQ = /* @__PURE__ */ BigInt("40440834346308536858101042469323190826248399146238708352240133220865137265952");
var invertSqrt = (number) => uvRatio(_1n11, number);
var MAX_255B = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
var bytes255ToNumberLE = (bytes) => Fp.create(bytesToNumberLE2(bytes) & MAX_255B);
function calcElligatorRistrettoMap(r0) {
  const { d } = ed25519_CURVE;
  const P = ed25519_CURVE_p;
  const mod3 = (n) => Fp.create(n);
  const r = mod3(SQRT_M1 * r0 * r0);
  const Ns = mod3((r + _1n11) * ONE_MINUS_D_SQ);
  let c = BigInt(-1);
  const D = mod3((c - d * r) * mod3(r + d));
  let { isValid: Ns_D_is_sq, value: s } = uvRatio(Ns, D);
  let s_ = mod3(s * r0);
  if (!isNegativeLE(s_, P))
    s_ = mod3(-s_);
  if (!Ns_D_is_sq)
    s = s_;
  if (!Ns_D_is_sq)
    c = r;
  const Nt = mod3(c * (r - _1n11) * D_MINUS_ONE_SQ - D);
  const s2 = s * s;
  const W0 = mod3((s + s) * D);
  const W1 = mod3(Nt * SQRT_AD_MINUS_ONE);
  const W2 = mod3(_1n11 - s2);
  const W3 = mod3(_1n11 + s2);
  return new ed25519_Point(mod3(W0 * W3), mod3(W2 * W1), mod3(W1 * W3), mod3(W0 * W2));
}
var _RistrettoPoint = class __RistrettoPoint extends PrimeEdwardsPoint {
  // Do NOT change syntax: the following gymnastics is done,
  // because typescript strips comments, which makes bundlers disable tree-shaking.
  // prettier-ignore
  static BASE = /* @__PURE__ */ (() => new __RistrettoPoint(ed25519_Point.BASE))();
  // prettier-ignore
  static ZERO = /* @__PURE__ */ (() => new __RistrettoPoint(ed25519_Point.ZERO))();
  // prettier-ignore
  static Fp = /* @__PURE__ */ (() => Fp)();
  // prettier-ignore
  static Fn = /* @__PURE__ */ (() => Fn)();
  constructor(ep) {
    super(ep);
  }
  /**
   * Create one Ristretto255 point from affine Edwards coordinates.
   * This wraps the internal Edwards representative directly and is not a
   * canonical ristretto255 decoding path.
   * Use `toBytes()` / `fromBytes()` if canonical ristretto255 bytes matter.
   */
  static fromAffine(ap) {
    return new __RistrettoPoint(ed25519_Point.fromAffine(ap));
  }
  assertSame(other) {
    if (!(other instanceof __RistrettoPoint))
      throw new Error("RistrettoPoint expected");
  }
  init(ep) {
    return new __RistrettoPoint(ep);
  }
  static fromBytes(bytes) {
    abytes3(bytes, 32);
    const { a, d } = ed25519_CURVE;
    const P = ed25519_CURVE_p;
    const mod3 = (n) => Fp.create(n);
    const s = bytes255ToNumberLE(bytes);
    if (!equalBytes(Fp.toBytes(s), bytes) || isNegativeLE(s, P))
      throw new Error("invalid ristretto255 encoding 1");
    const s2 = mod3(s * s);
    const u1 = mod3(_1n11 + a * s2);
    const u2 = mod3(_1n11 - a * s2);
    const u1_2 = mod3(u1 * u1);
    const u2_2 = mod3(u2 * u2);
    const v = mod3(a * d * u1_2 - u2_2);
    const { isValid, value: I } = invertSqrt(mod3(v * u2_2));
    const Dx = mod3(I * u2);
    const Dy = mod3(I * Dx * v);
    let x = mod3((s + s) * Dx);
    if (isNegativeLE(x, P))
      x = mod3(-x);
    const y = mod3(u1 * Dy);
    const t = mod3(x * y);
    if (!isValid || isNegativeLE(t, P) || y === _0n11)
      throw new Error("invalid ristretto255 encoding 2");
    return new __RistrettoPoint(new ed25519_Point(x, y, _1n11, t));
  }
  /**
   * Converts ristretto-encoded string to ristretto point.
   * Described in [RFC9496](https://www.rfc-editor.org/rfc/rfc9496#name-decode).
   * @param hex - Ristretto-encoded 32 bytes. Not every 32-byte string is valid ristretto encoding
   */
  static fromHex(hex) {
    return __RistrettoPoint.fromBytes(hexToBytes3(hex));
  }
  /**
   * Encodes ristretto point to Uint8Array.
   * Described in [RFC9496](https://www.rfc-editor.org/rfc/rfc9496#name-encode).
   */
  toBytes() {
    let { X, Y, Z, T } = this.ep;
    const P = ed25519_CURVE_p;
    const mod3 = (n) => Fp.create(n);
    const u1 = mod3(mod3(Z + Y) * mod3(Z - Y));
    const u2 = mod3(X * Y);
    const u2sq = mod3(u2 * u2);
    const { value: invsqrt } = invertSqrt(mod3(u1 * u2sq));
    const D1 = mod3(invsqrt * u1);
    const D2 = mod3(invsqrt * u2);
    const zInv = mod3(D1 * D2 * T);
    let D;
    if (isNegativeLE(T * zInv, P)) {
      let _x = mod3(Y * SQRT_M1);
      let _y = mod3(X * SQRT_M1);
      X = _x;
      Y = _y;
      D = mod3(D1 * INVSQRT_A_MINUS_D);
    } else {
      D = D2;
    }
    if (isNegativeLE(X * zInv, P))
      Y = mod3(-Y);
    let s = mod3((Z - Y) * D);
    if (isNegativeLE(s, P))
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
Object.freeze(_RistrettoPoint.BASE);
Object.freeze(_RistrettoPoint.ZERO);
Object.freeze(_RistrettoPoint.prototype);
Object.freeze(_RistrettoPoint);
var ristretto255_hasher = Object.freeze({
  Point: _RistrettoPoint,
  /**
  * Spec: https://www.rfc-editor.org/rfc/rfc9380.html#name-hashing-to-ristretto255. Caveats:
  * * There are no test vectors
  * * encodeToCurve / mapToCurve is undefined
  * * mapToCurve would be `calcElligatorRistrettoMap(scalars[0])`, not ristretto255_map!
  * * hashToScalar is undefined too, so we just use OPRF implementation
  * * We cannot re-use 'createHasher', because ristretto255_map is different algorithm/RFC
    (os2ip -> bytes255ToNumberLE)
  * * mapToCurve == calcElligatorRistrettoMap, hashToCurve == ristretto255_map
  * * hashToScalar is undefined in RFC9380 for ristretto, so we use the OPRF
    version here. Using `bytes255ToNumblerLE` will create a different result
    if we use `bytes255ToNumberLE` as os2ip
  * * current version is closest to spec.
  */
  hashToCurve(msg, options) {
    const DST = options?.DST === void 0 ? "ristretto255_XMD:SHA-512_R255MAP_RO_" : options.DST;
    const xmd = expand_message_xmd(msg, DST, 64, sha512);
    return ristretto255_hasher.deriveToCurve(xmd);
  },
  hashToScalar(msg, options = { DST: _DST_scalar }) {
    const xmd = expand_message_xmd(msg, options.DST, 64, sha512);
    return Fn.create(bytesToNumberLE2(xmd));
  },
  /**
   * HashToCurve-like construction based on RFC 9496 (Element Derivation).
   * Converts 64 uniform random bytes into a curve point.
   *
   * WARNING: This represents an older hash-to-curve construction from before
   * RFC 9380 was finalized.
   * It was later reused as a component in the newer
   * `hash_to_ristretto255` function defined in RFC 9380.
   */
  deriveToCurve(bytes) {
    abytes3(bytes, 64);
    const r1 = bytes255ToNumberLE(bytes.subarray(0, 32));
    const R1 = calcElligatorRistrettoMap(r1);
    const r2 = bytes255ToNumberLE(bytes.subarray(32, 64));
    const R2 = calcElligatorRistrettoMap(r2);
    return new _RistrettoPoint(R1.add(R2));
  }
});

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/@noble/ciphers/utils.js
function isBytes5(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
function abool3(b) {
  if (typeof b !== "boolean")
    throw new TypeError(`boolean expected, not ${b}`);
}
function anumber5(n) {
  if (typeof n !== "number")
    throw new TypeError("number expected, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError("positive integer expected, got " + n);
}
function abytes5(value, length, title = "") {
  const bytes = isBytes5(value);
  const len = value?.length;
  const needsLen = length !== void 0;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    const message = prefix + "expected Uint8Array" + ofLen + ", got " + got;
    if (!bytes)
      throw new TypeError(message);
    throw new RangeError(message);
  }
  return value;
}
function aexists3(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput3(out, instance, onlyAligned = false) {
  abytes5(out, void 0, "output");
  const min = instance.outputLen;
  if (out.length < min) {
    throw new RangeError("digestInto() expects output buffer of length at least " + min);
  }
  if (onlyAligned && !isAligned32(out))
    throw new Error("invalid output, must be aligned");
}
function u322(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean3(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView3(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
var isLE2 = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
var byteSwap2 = (word) => word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
var swap8IfBE = isLE2 ? (n) => n : (n) => byteSwap2(n) >>> 0;
var byteSwap322 = (arr) => {
  for (let i = 0; i < arr.length; i++)
    arr[i] = byteSwap2(arr[i]);
  return arr;
};
var swap32IfBE2 = isLE2 ? (u) => u : byteSwap322;
function checkOpts(defaults, opts) {
  if (opts == null || typeof opts !== "object")
    throw new Error("options must be defined");
  const merged = Object.assign(defaults, opts);
  return merged;
}
function equalBytes2(a, b) {
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
    abytes5(key, void 0, "key");
    if (params.nonceLength !== void 0) {
      const nonce = args[0];
      abytes5(nonce, params.varSizeNonce ? void 0 : params.nonceLength, "nonce");
    }
    const tagl = params.tagLength;
    if (tagl && args[1] !== void 0)
      abytes5(args[1], void 0, "AAD");
    const cipher = constructor(key, ...args);
    const checkOutput = (fnLength, output) => {
      if (output !== void 0) {
        if (fnLength !== 2)
          throw new Error("cipher output not supported");
        abytes5(output, void 0, "output");
      }
    };
    let called = false;
    const wrCipher = {
      encrypt(data, output) {
        if (called)
          throw new Error("cannot encrypt() twice with same key + nonce");
        called = true;
        abytes5(data);
        checkOutput(cipher.encrypt.length, output);
        return cipher.encrypt(data, output);
      },
      decrypt(data, output) {
        abytes5(data);
        if (tagl && data.length < tagl)
          throw new Error('"ciphertext" expected length bigger than tagLength=' + tagl);
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
  abytes5(out, void 0, "output");
  if (out.length !== expectedLength)
    throw new Error('"output" expected Uint8Array of length ' + expectedLength + ", got: " + out.length);
  if (onlyAligned && !isAligned32(out))
    throw new Error("invalid output, must be aligned");
  return out;
}
function u64Lengths(dataLength, aadLength, isLE3) {
  anumber5(dataLength);
  anumber5(aadLength);
  abool3(isLE3);
  const num = new Uint8Array(16);
  const view = createView3(num);
  view.setBigUint64(0, BigInt(aadLength), isLE3);
  view.setBigUint64(8, BigInt(dataLength), isLE3);
  return num;
}
function isAligned32(bytes) {
  return bytes.byteOffset % 4 === 0;
}
function copyBytes3(bytes) {
  return Uint8Array.from(abytes5(bytes));
}

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/@noble/ciphers/_arx.js
var encodeStr = (str) => Uint8Array.from(str.split(""), (c) => c.charCodeAt(0));
var sigma16_32 = /* @__PURE__ */ (() => swap32IfBE2(u322(encodeStr("expand 16-byte k"))))();
var sigma32_32 = /* @__PURE__ */ (() => swap32IfBE2(u322(encodeStr("expand 32-byte k"))))();
function rotl(a, b) {
  return a << b | a >>> 32 - b;
}
var BLOCK_LEN = 64;
var BLOCK_LEN32 = 16;
var MAX_COUNTER = /* @__PURE__ */ (() => 2 ** 32 - 1)();
var U32_EMPTY = /* @__PURE__ */ Uint32Array.of();
function runCipher(core, sigma, key, nonce, data, output, counter, rounds) {
  const len = data.length;
  const block = new Uint8Array(BLOCK_LEN);
  const b32 = u322(block);
  const isAligned = isLE2 && isAligned32(data) && isAligned32(output);
  const d32 = isAligned ? u322(data) : U32_EMPTY;
  const o32 = isAligned ? u322(output) : U32_EMPTY;
  if (!isLE2) {
    for (let pos = 0; pos < len; counter++) {
      core(sigma, key, nonce, b32, counter, rounds);
      swap32IfBE2(b32);
      if (counter >= MAX_COUNTER)
        throw new Error("arx: counter overflow");
      const take = Math.min(BLOCK_LEN, len - pos);
      for (let j = 0, posj; j < take; j++) {
        posj = pos + j;
        output[posj] = data[posj] ^ block[j];
      }
      pos += take;
    }
    return;
  }
  for (let pos = 0; pos < len; counter++) {
    core(sigma, key, nonce, b32, counter, rounds);
    if (counter >= MAX_COUNTER)
      throw new Error("arx: counter overflow");
    const take = Math.min(BLOCK_LEN, len - pos);
    if (isAligned && take === BLOCK_LEN) {
      const pos32 = pos / 4;
      if (pos % 4 !== 0)
        throw new Error("arx: invalid block position");
      for (let j = 0, posj; j < BLOCK_LEN32; j++) {
        posj = pos32 + j;
        o32[posj] = d32[posj] ^ b32[j];
      }
      pos += BLOCK_LEN;
      continue;
    }
    for (let j = 0, posj; j < take; j++) {
      posj = pos + j;
      output[posj] = data[posj] ^ block[j];
    }
    pos += take;
  }
}
function createCipher(core, opts) {
  const { allowShortKeys, extendNonceFn, counterLength, counterRight, rounds } = checkOpts({ allowShortKeys: false, counterLength: 8, counterRight: false, rounds: 20 }, opts);
  if (typeof core !== "function")
    throw new Error("core must be a function");
  anumber5(counterLength);
  anumber5(rounds);
  abool3(counterRight);
  abool3(allowShortKeys);
  return (key, nonce, data, output, counter = 0) => {
    abytes5(key, void 0, "key");
    abytes5(nonce, void 0, "nonce");
    abytes5(data, void 0, "data");
    const len = data.length;
    output = getOutput(len, output, false);
    anumber5(counter);
    if (counter < 0 || counter >= MAX_COUNTER)
      throw new Error("arx: counter overflow");
    const toClean = [];
    let l = key.length;
    let k;
    let sigma;
    if (l === 32) {
      toClean.push(k = copyBytes3(key));
      sigma = sigma32_32;
    } else if (l === 16 && allowShortKeys) {
      k = new Uint8Array(32);
      k.set(key);
      k.set(key, 16);
      sigma = sigma16_32;
      toClean.push(k);
    } else {
      abytes5(key, 32, "arx key");
      throw new Error("invalid key size");
    }
    if (!isLE2 || !isAligned32(nonce))
      toClean.push(nonce = copyBytes3(nonce));
    let k32 = u322(k);
    if (extendNonceFn) {
      if (nonce.length !== 24)
        throw new Error(`arx: extended nonce must be 24 bytes`);
      const n16 = nonce.subarray(0, 16);
      if (isLE2)
        extendNonceFn(sigma, k32, u322(n16), k32);
      else {
        const sigmaRaw = swap32IfBE2(Uint32Array.from(sigma));
        extendNonceFn(sigmaRaw, k32, u322(n16), k32);
        clean3(sigmaRaw);
        swap32IfBE2(k32);
      }
      nonce = nonce.subarray(16);
    } else if (!isLE2)
      swap32IfBE2(k32);
    const nonceNcLen = 16 - counterLength;
    if (nonceNcLen !== nonce.length)
      throw new Error(`arx: nonce must be ${nonceNcLen} or 16 bytes`);
    if (nonceNcLen !== 12) {
      const nc = new Uint8Array(12);
      nc.set(nonce, counterRight ? 0 : 12 - nonce.length);
      nonce = nc;
      toClean.push(nonce);
    }
    const n32 = swap32IfBE2(u322(nonce));
    try {
      runCipher(core, sigma, k32, n32, data, output, counter, rounds);
      return output;
    } finally {
      clean3(...toClean);
    }
  };
}

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/@noble/ciphers/_poly1305.js
function u8to16(a, i) {
  return a[i++] & 255 | (a[i++] & 255) << 8;
}
var Poly1305 = class {
  blockLen = 16;
  outputLen = 16;
  buffer = new Uint8Array(16);
  r = new Uint16Array(10);
  // Allocating 1 array with .subarray() here is slower than 3
  h = new Uint16Array(10);
  pad = new Uint16Array(8);
  pos = 0;
  finished = false;
  destroyed = false;
  // Can be speed-up using BigUint64Array, at the cost of complexity
  constructor(key) {
    key = copyBytes3(abytes5(key, 32, "key"));
    const t0 = u8to16(key, 0);
    const t1 = u8to16(key, 2);
    const t2 = u8to16(key, 4);
    const t3 = u8to16(key, 6);
    const t4 = u8to16(key, 8);
    const t5 = u8to16(key, 10);
    const t6 = u8to16(key, 12);
    const t7 = u8to16(key, 14);
    this.r[0] = t0 & 8191;
    this.r[1] = (t0 >>> 13 | t1 << 3) & 8191;
    this.r[2] = (t1 >>> 10 | t2 << 6) & 7939;
    this.r[3] = (t2 >>> 7 | t3 << 9) & 8191;
    this.r[4] = (t3 >>> 4 | t4 << 12) & 255;
    this.r[5] = t4 >>> 1 & 8190;
    this.r[6] = (t4 >>> 14 | t5 << 2) & 8191;
    this.r[7] = (t5 >>> 11 | t6 << 5) & 8065;
    this.r[8] = (t6 >>> 8 | t7 << 8) & 8191;
    this.r[9] = t7 >>> 5 & 127;
    for (let i = 0; i < 8; i++)
      this.pad[i] = u8to16(key, 16 + 2 * i);
  }
  process(data, offset, isLast = false) {
    const hibit = isLast ? 0 : 1 << 11;
    const { h, r } = this;
    const r0 = r[0];
    const r1 = r[1];
    const r2 = r[2];
    const r3 = r[3];
    const r4 = r[4];
    const r5 = r[5];
    const r6 = r[6];
    const r7 = r[7];
    const r8 = r[8];
    const r9 = r[9];
    const t0 = u8to16(data, offset + 0);
    const t1 = u8to16(data, offset + 2);
    const t2 = u8to16(data, offset + 4);
    const t3 = u8to16(data, offset + 6);
    const t4 = u8to16(data, offset + 8);
    const t5 = u8to16(data, offset + 10);
    const t6 = u8to16(data, offset + 12);
    const t7 = u8to16(data, offset + 14);
    let h0 = h[0] + (t0 & 8191);
    let h1 = h[1] + ((t0 >>> 13 | t1 << 3) & 8191);
    let h2 = h[2] + ((t1 >>> 10 | t2 << 6) & 8191);
    let h3 = h[3] + ((t2 >>> 7 | t3 << 9) & 8191);
    let h4 = h[4] + ((t3 >>> 4 | t4 << 12) & 8191);
    let h5 = h[5] + (t4 >>> 1 & 8191);
    let h6 = h[6] + ((t4 >>> 14 | t5 << 2) & 8191);
    let h7 = h[7] + ((t5 >>> 11 | t6 << 5) & 8191);
    let h8 = h[8] + ((t6 >>> 8 | t7 << 8) & 8191);
    let h9 = h[9] + (t7 >>> 5 | hibit);
    let c = 0;
    let d0 = c + h0 * r0 + h1 * (5 * r9) + h2 * (5 * r8) + h3 * (5 * r7) + h4 * (5 * r6);
    c = d0 >>> 13;
    d0 &= 8191;
    d0 += h5 * (5 * r5) + h6 * (5 * r4) + h7 * (5 * r3) + h8 * (5 * r2) + h9 * (5 * r1);
    c += d0 >>> 13;
    d0 &= 8191;
    let d1 = c + h0 * r1 + h1 * r0 + h2 * (5 * r9) + h3 * (5 * r8) + h4 * (5 * r7);
    c = d1 >>> 13;
    d1 &= 8191;
    d1 += h5 * (5 * r6) + h6 * (5 * r5) + h7 * (5 * r4) + h8 * (5 * r3) + h9 * (5 * r2);
    c += d1 >>> 13;
    d1 &= 8191;
    let d2 = c + h0 * r2 + h1 * r1 + h2 * r0 + h3 * (5 * r9) + h4 * (5 * r8);
    c = d2 >>> 13;
    d2 &= 8191;
    d2 += h5 * (5 * r7) + h6 * (5 * r6) + h7 * (5 * r5) + h8 * (5 * r4) + h9 * (5 * r3);
    c += d2 >>> 13;
    d2 &= 8191;
    let d3 = c + h0 * r3 + h1 * r2 + h2 * r1 + h3 * r0 + h4 * (5 * r9);
    c = d3 >>> 13;
    d3 &= 8191;
    d3 += h5 * (5 * r8) + h6 * (5 * r7) + h7 * (5 * r6) + h8 * (5 * r5) + h9 * (5 * r4);
    c += d3 >>> 13;
    d3 &= 8191;
    let d4 = c + h0 * r4 + h1 * r3 + h2 * r2 + h3 * r1 + h4 * r0;
    c = d4 >>> 13;
    d4 &= 8191;
    d4 += h5 * (5 * r9) + h6 * (5 * r8) + h7 * (5 * r7) + h8 * (5 * r6) + h9 * (5 * r5);
    c += d4 >>> 13;
    d4 &= 8191;
    let d5 = c + h0 * r5 + h1 * r4 + h2 * r3 + h3 * r2 + h4 * r1;
    c = d5 >>> 13;
    d5 &= 8191;
    d5 += h5 * r0 + h6 * (5 * r9) + h7 * (5 * r8) + h8 * (5 * r7) + h9 * (5 * r6);
    c += d5 >>> 13;
    d5 &= 8191;
    let d6 = c + h0 * r6 + h1 * r5 + h2 * r4 + h3 * r3 + h4 * r2;
    c = d6 >>> 13;
    d6 &= 8191;
    d6 += h5 * r1 + h6 * r0 + h7 * (5 * r9) + h8 * (5 * r8) + h9 * (5 * r7);
    c += d6 >>> 13;
    d6 &= 8191;
    let d7 = c + h0 * r7 + h1 * r6 + h2 * r5 + h3 * r4 + h4 * r3;
    c = d7 >>> 13;
    d7 &= 8191;
    d7 += h5 * r2 + h6 * r1 + h7 * r0 + h8 * (5 * r9) + h9 * (5 * r8);
    c += d7 >>> 13;
    d7 &= 8191;
    let d8 = c + h0 * r8 + h1 * r7 + h2 * r6 + h3 * r5 + h4 * r4;
    c = d8 >>> 13;
    d8 &= 8191;
    d8 += h5 * r3 + h6 * r2 + h7 * r1 + h8 * r0 + h9 * (5 * r9);
    c += d8 >>> 13;
    d8 &= 8191;
    let d9 = c + h0 * r9 + h1 * r8 + h2 * r7 + h3 * r6 + h4 * r5;
    c = d9 >>> 13;
    d9 &= 8191;
    d9 += h5 * r4 + h6 * r3 + h7 * r2 + h8 * r1 + h9 * r0;
    c += d9 >>> 13;
    d9 &= 8191;
    c = (c << 2) + c | 0;
    c = c + d0 | 0;
    d0 = c & 8191;
    c = c >>> 13;
    d1 += c;
    h[0] = d0;
    h[1] = d1;
    h[2] = d2;
    h[3] = d3;
    h[4] = d4;
    h[5] = d5;
    h[6] = d6;
    h[7] = d7;
    h[8] = d8;
    h[9] = d9;
  }
  finalize() {
    const { h, pad } = this;
    const g = new Uint16Array(10);
    let c = h[1] >>> 13;
    h[1] &= 8191;
    for (let i = 2; i < 10; i++) {
      h[i] += c;
      c = h[i] >>> 13;
      h[i] &= 8191;
    }
    h[0] += c * 5;
    c = h[0] >>> 13;
    h[0] &= 8191;
    h[1] += c;
    c = h[1] >>> 13;
    h[1] &= 8191;
    h[2] += c;
    g[0] = h[0] + 5;
    c = g[0] >>> 13;
    g[0] &= 8191;
    for (let i = 1; i < 10; i++) {
      g[i] = h[i] + c;
      c = g[i] >>> 13;
      g[i] &= 8191;
    }
    g[9] -= 1 << 13;
    let mask = (c ^ 1) - 1;
    for (let i = 0; i < 10; i++)
      g[i] &= mask;
    mask = ~mask;
    for (let i = 0; i < 10; i++)
      h[i] = h[i] & mask | g[i];
    h[0] = (h[0] | h[1] << 13) & 65535;
    h[1] = (h[1] >>> 3 | h[2] << 10) & 65535;
    h[2] = (h[2] >>> 6 | h[3] << 7) & 65535;
    h[3] = (h[3] >>> 9 | h[4] << 4) & 65535;
    h[4] = (h[4] >>> 12 | h[5] << 1 | h[6] << 14) & 65535;
    h[5] = (h[6] >>> 2 | h[7] << 11) & 65535;
    h[6] = (h[7] >>> 5 | h[8] << 8) & 65535;
    h[7] = (h[8] >>> 8 | h[9] << 5) & 65535;
    let f = h[0] + pad[0];
    h[0] = f & 65535;
    for (let i = 1; i < 8; i++) {
      f = (h[i] + pad[i] | 0) + (f >>> 16) | 0;
      h[i] = f & 65535;
    }
    clean3(g);
  }
  update(data) {
    aexists3(this);
    abytes5(data);
    data = copyBytes3(data);
    const { buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(data, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(buffer, 0, false);
        this.pos = 0;
      }
    }
    return this;
  }
  destroy() {
    this.destroyed = true;
    clean3(this.h, this.r, this.buffer, this.pad);
  }
  digestInto(out) {
    aexists3(this);
    aoutput3(out, this);
    this.finished = true;
    const { buffer, h } = this;
    let { pos } = this;
    if (pos) {
      buffer[pos++] = 1;
      for (; pos < 16; pos++)
        buffer[pos] = 0;
      this.process(buffer, 0, true);
    }
    this.finalize();
    let opos = 0;
    for (let i = 0; i < 8; i++) {
      out[opos++] = h[i] >>> 0;
      out[opos++] = h[i] >>> 8;
    }
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
};
var poly1305 = /* @__PURE__ */ wrapMacConstructor(32, (key) => new Poly1305(key));

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/@noble/ciphers/chacha.js
function chachaCore(s, k, n, out, cnt, rounds = 20) {
  let y00 = s[0], y01 = s[1], y02 = s[2], y03 = s[3], y04 = k[0], y05 = k[1], y06 = k[2], y07 = k[3], y08 = k[4], y09 = k[5], y10 = k[6], y11 = k[7], y12 = cnt, y13 = n[0], y14 = n[1], y15 = n[2];
  let x00 = y00, x01 = y01, x02 = y02, x03 = y03, x04 = y04, x05 = y05, x06 = y06, x07 = y07, x08 = y08, x09 = y09, x10 = y10, x11 = y11, x12 = y12, x13 = y13, x14 = y14, x15 = y15;
  for (let r = 0; r < rounds; r += 2) {
    x00 = x00 + x04 | 0;
    x12 = rotl(x12 ^ x00, 16);
    x08 = x08 + x12 | 0;
    x04 = rotl(x04 ^ x08, 12);
    x00 = x00 + x04 | 0;
    x12 = rotl(x12 ^ x00, 8);
    x08 = x08 + x12 | 0;
    x04 = rotl(x04 ^ x08, 7);
    x01 = x01 + x05 | 0;
    x13 = rotl(x13 ^ x01, 16);
    x09 = x09 + x13 | 0;
    x05 = rotl(x05 ^ x09, 12);
    x01 = x01 + x05 | 0;
    x13 = rotl(x13 ^ x01, 8);
    x09 = x09 + x13 | 0;
    x05 = rotl(x05 ^ x09, 7);
    x02 = x02 + x06 | 0;
    x14 = rotl(x14 ^ x02, 16);
    x10 = x10 + x14 | 0;
    x06 = rotl(x06 ^ x10, 12);
    x02 = x02 + x06 | 0;
    x14 = rotl(x14 ^ x02, 8);
    x10 = x10 + x14 | 0;
    x06 = rotl(x06 ^ x10, 7);
    x03 = x03 + x07 | 0;
    x15 = rotl(x15 ^ x03, 16);
    x11 = x11 + x15 | 0;
    x07 = rotl(x07 ^ x11, 12);
    x03 = x03 + x07 | 0;
    x15 = rotl(x15 ^ x03, 8);
    x11 = x11 + x15 | 0;
    x07 = rotl(x07 ^ x11, 7);
    x00 = x00 + x05 | 0;
    x15 = rotl(x15 ^ x00, 16);
    x10 = x10 + x15 | 0;
    x05 = rotl(x05 ^ x10, 12);
    x00 = x00 + x05 | 0;
    x15 = rotl(x15 ^ x00, 8);
    x10 = x10 + x15 | 0;
    x05 = rotl(x05 ^ x10, 7);
    x01 = x01 + x06 | 0;
    x12 = rotl(x12 ^ x01, 16);
    x11 = x11 + x12 | 0;
    x06 = rotl(x06 ^ x11, 12);
    x01 = x01 + x06 | 0;
    x12 = rotl(x12 ^ x01, 8);
    x11 = x11 + x12 | 0;
    x06 = rotl(x06 ^ x11, 7);
    x02 = x02 + x07 | 0;
    x13 = rotl(x13 ^ x02, 16);
    x08 = x08 + x13 | 0;
    x07 = rotl(x07 ^ x08, 12);
    x02 = x02 + x07 | 0;
    x13 = rotl(x13 ^ x02, 8);
    x08 = x08 + x13 | 0;
    x07 = rotl(x07 ^ x08, 7);
    x03 = x03 + x04 | 0;
    x14 = rotl(x14 ^ x03, 16);
    x09 = x09 + x14 | 0;
    x04 = rotl(x04 ^ x09, 12);
    x03 = x03 + x04 | 0;
    x14 = rotl(x14 ^ x03, 8);
    x09 = x09 + x14 | 0;
    x04 = rotl(x04 ^ x09, 7);
  }
  let oi = 0;
  out[oi++] = y00 + x00 | 0;
  out[oi++] = y01 + x01 | 0;
  out[oi++] = y02 + x02 | 0;
  out[oi++] = y03 + x03 | 0;
  out[oi++] = y04 + x04 | 0;
  out[oi++] = y05 + x05 | 0;
  out[oi++] = y06 + x06 | 0;
  out[oi++] = y07 + x07 | 0;
  out[oi++] = y08 + x08 | 0;
  out[oi++] = y09 + x09 | 0;
  out[oi++] = y10 + x10 | 0;
  out[oi++] = y11 + x11 | 0;
  out[oi++] = y12 + x12 | 0;
  out[oi++] = y13 + x13 | 0;
  out[oi++] = y14 + x14 | 0;
  out[oi++] = y15 + x15 | 0;
}
function hchacha(s, k, i, out) {
  let x00 = swap8IfBE(s[0]), x01 = swap8IfBE(s[1]), x02 = swap8IfBE(s[2]), x03 = swap8IfBE(s[3]), x04 = swap8IfBE(k[0]), x05 = swap8IfBE(k[1]), x06 = swap8IfBE(k[2]), x07 = swap8IfBE(k[3]), x08 = swap8IfBE(k[4]), x09 = swap8IfBE(k[5]), x10 = swap8IfBE(k[6]), x11 = swap8IfBE(k[7]), x12 = swap8IfBE(i[0]), x13 = swap8IfBE(i[1]), x14 = swap8IfBE(i[2]), x15 = swap8IfBE(i[3]);
  for (let r = 0; r < 20; r += 2) {
    x00 = x00 + x04 | 0;
    x12 = rotl(x12 ^ x00, 16);
    x08 = x08 + x12 | 0;
    x04 = rotl(x04 ^ x08, 12);
    x00 = x00 + x04 | 0;
    x12 = rotl(x12 ^ x00, 8);
    x08 = x08 + x12 | 0;
    x04 = rotl(x04 ^ x08, 7);
    x01 = x01 + x05 | 0;
    x13 = rotl(x13 ^ x01, 16);
    x09 = x09 + x13 | 0;
    x05 = rotl(x05 ^ x09, 12);
    x01 = x01 + x05 | 0;
    x13 = rotl(x13 ^ x01, 8);
    x09 = x09 + x13 | 0;
    x05 = rotl(x05 ^ x09, 7);
    x02 = x02 + x06 | 0;
    x14 = rotl(x14 ^ x02, 16);
    x10 = x10 + x14 | 0;
    x06 = rotl(x06 ^ x10, 12);
    x02 = x02 + x06 | 0;
    x14 = rotl(x14 ^ x02, 8);
    x10 = x10 + x14 | 0;
    x06 = rotl(x06 ^ x10, 7);
    x03 = x03 + x07 | 0;
    x15 = rotl(x15 ^ x03, 16);
    x11 = x11 + x15 | 0;
    x07 = rotl(x07 ^ x11, 12);
    x03 = x03 + x07 | 0;
    x15 = rotl(x15 ^ x03, 8);
    x11 = x11 + x15 | 0;
    x07 = rotl(x07 ^ x11, 7);
    x00 = x00 + x05 | 0;
    x15 = rotl(x15 ^ x00, 16);
    x10 = x10 + x15 | 0;
    x05 = rotl(x05 ^ x10, 12);
    x00 = x00 + x05 | 0;
    x15 = rotl(x15 ^ x00, 8);
    x10 = x10 + x15 | 0;
    x05 = rotl(x05 ^ x10, 7);
    x01 = x01 + x06 | 0;
    x12 = rotl(x12 ^ x01, 16);
    x11 = x11 + x12 | 0;
    x06 = rotl(x06 ^ x11, 12);
    x01 = x01 + x06 | 0;
    x12 = rotl(x12 ^ x01, 8);
    x11 = x11 + x12 | 0;
    x06 = rotl(x06 ^ x11, 7);
    x02 = x02 + x07 | 0;
    x13 = rotl(x13 ^ x02, 16);
    x08 = x08 + x13 | 0;
    x07 = rotl(x07 ^ x08, 12);
    x02 = x02 + x07 | 0;
    x13 = rotl(x13 ^ x02, 8);
    x08 = x08 + x13 | 0;
    x07 = rotl(x07 ^ x08, 7);
    x03 = x03 + x04 | 0;
    x14 = rotl(x14 ^ x03, 16);
    x09 = x09 + x14 | 0;
    x04 = rotl(x04 ^ x09, 12);
    x03 = x03 + x04 | 0;
    x14 = rotl(x14 ^ x03, 8);
    x09 = x09 + x14 | 0;
    x04 = rotl(x04 ^ x09, 7);
  }
  let oi = 0;
  out[oi++] = x00;
  out[oi++] = x01;
  out[oi++] = x02;
  out[oi++] = x03;
  out[oi++] = x12;
  out[oi++] = x13;
  out[oi++] = x14;
  out[oi++] = x15;
  swap32IfBE2(out);
}
var xchacha20 = /* @__PURE__ */ createCipher(chachaCore, {
  counterRight: false,
  counterLength: 8,
  extendNonceFn: hchacha,
  allowShortKeys: false
});
var ZEROS16 = /* @__PURE__ */ new Uint8Array(16);
var updatePadded = (h, msg) => {
  h.update(msg);
  const leftover = msg.length % 16;
  if (leftover)
    h.update(ZEROS16.subarray(leftover));
};
var ZEROS32 = /* @__PURE__ */ new Uint8Array(32);
function computeTag(fn, key, nonce, ciphertext, AAD) {
  if (AAD !== void 0)
    abytes5(AAD, void 0, "AAD");
  const authKey = fn(key, nonce, ZEROS32);
  const lengths = u64Lengths(ciphertext.length, AAD ? AAD.length : 0, true);
  const h = poly1305.create(authKey);
  if (AAD)
    updatePadded(h, AAD);
  updatePadded(h, ciphertext);
  h.update(lengths);
  const res = h.digest();
  clean3(authKey, lengths);
  return res;
}
var _poly1305_aead = (xorStream) => (key, nonce, AAD) => {
  const tagLength = 16;
  return {
    encrypt(plaintext, output) {
      const plength = plaintext.length;
      output = getOutput(plength + tagLength, output, false);
      output.set(plaintext);
      const oPlain = output.subarray(0, -tagLength);
      xorStream(key, nonce, oPlain, oPlain, 1);
      const tag = computeTag(xorStream, key, nonce, oPlain, AAD);
      output.set(tag, plength);
      clean3(tag);
      return output;
    },
    decrypt(ciphertext, output) {
      output = getOutput(ciphertext.length - tagLength, output, false);
      const data = ciphertext.subarray(0, -tagLength);
      const passedTag = ciphertext.subarray(-tagLength);
      const tag = computeTag(xorStream, key, nonce, data, AAD);
      if (!equalBytes2(passedTag, tag)) {
        clean3(tag);
        throw new Error("invalid tag");
      }
      output.set(ciphertext.subarray(0, -tagLength));
      xorStream(key, nonce, output, output, 1);
      clean3(tag);
      return output;
    }
  };
};
var xchacha20poly1305 = /* @__PURE__ */ wrapCipher(
  { blockSize: 64, nonceLength: 24, tagLength: 16 },
  /* @__PURE__ */ _poly1305_aead(xchacha20)
);

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/@noble/hashes/hmac.js
var _HMAC2 = class {
  oHash;
  iHash;
  blockLen;
  outputLen;
  canXOF = false;
  finished = false;
  destroyed = false;
  constructor(hash, key) {
    ahash2(hash);
    abytes3(key, void 0, "key");
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
    to ||= Object.create(Object.getPrototypeOf(this), {});
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
var hmac2 = /* @__PURE__ */ (() => {
  const hmac_ = ((hash, key, message) => new _HMAC2(hash, key).update(message).digest());
  hmac_.create = (hash, key) => new _HMAC2(hash, key);
  return hmac_;
})();

// ../../../../../../Users/huangjiahao/.codex/worktrees/social-wallet-chooser-20261001/apps/social/node_modules/@noble/hashes/hkdf.js
function extract(hash, ikm, salt) {
  ahash2(hash);
  if (salt === void 0)
    salt = new Uint8Array(hash.outputLen);
  return hmac2(hash, salt, ikm);
}
var HKDF_COUNTER = /* @__PURE__ */ Uint8Array.of(0);
var EMPTY_BUFFER = /* @__PURE__ */ Uint8Array.of();
function expand(hash, prk, info, length = 32) {
  ahash2(hash);
  anumber3(length, "length");
  abytes3(prk, void 0, "prk");
  const olen = hash.outputLen;
  if (prk.length < olen)
    throw new Error('"prk" must be at least HashLen octets');
  if (length > 255 * olen)
    throw new Error("Length must be <= 255*HashLen");
  const blocks = Math.ceil(length / olen);
  if (info === void 0)
    info = EMPTY_BUFFER;
  else
    abytes3(info, void 0, "info");
  const okm = new Uint8Array(blocks * olen);
  const HMAC = hmac2.create(hash, prk);
  const HMACTmp = HMAC._cloneInto();
  const T = new Uint8Array(HMAC.outputLen);
  for (let counter = 0; counter < blocks; counter++) {
    HKDF_COUNTER[0] = counter + 1;
    HMACTmp.update(counter === 0 ? EMPTY_BUFFER : T).update(info).update(HKDF_COUNTER).digestInto(T);
    okm.set(T, olen * counter);
    HMAC._cloneInto(HMACTmp);
  }
  HMAC.destroy();
  HMACTmp.destroy();
  clean2(T, HKDF_COUNTER);
  return okm.slice(0, length);
}
var hkdf = (hash, ikm, salt, info, length) => expand(hash, extract(hash, ikm, salt), info, length);

// ../src/chatCrypto.ts
var CHAT_ALGORITHM = "x25519-hkdf-sha256-xchacha20poly1305";
var INFO = utf8ToBytes2("YNX-NATIVE-WALLET-E2EE-V1");
function createEnvelopeSet(input) {
  validSeed(input.signingSeed, "signing seed");
  validSeed(input.entropy, "message entropy");
  const sender = ynx(input.senderAccount), senderDeviceId = id(input.senderDeviceId), conversationId = id(input.conversationId), messageId = id(input.messageId), plaintext = input.plaintext.trim();
  if (!plaintext || plaintext.length > 16e3) throw new Error("Message must contain 1 to 16000 characters");
  const devices = input.devices.filter((device2) => device2.status === "active");
  if (devices.length < 1 || devices.length > 32) throw new Error("Conversation requires 1 to 32 active device recipients");
  if (new Set(devices.map((device2) => device2.id)).size !== devices.length) throw new Error("Duplicate Chat device recipient");
  const ephemeral = input.entropy.slice(), ephemeralPublicKey = encode(x25519.getPublicKey(ephemeral));
  const envelopes = devices.map((device2) => {
    const recipientAccount = ynx(device2.account), recipientDeviceId = id(device2.id);
    const nonce = sha2562(concatBytes3(utf8ToBytes2("YNX_CHAT_ENVELOPE_NONCE_V2\n"), input.entropy, utf8ToBytes2(`
${recipientAccount}
${recipientDeviceId}`))).slice(0, 24);
    const aad = envelopeAAD(conversationId, messageId, senderDeviceId, recipientAccount, recipientDeviceId, ephemeralPublicKey);
    const key = derive(ephemeral.slice(), decode32(device2.encryptionPublicKey, "recipient encryption key"));
    const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(utf8ToBytes2(plaintext));
    key.fill(0);
    return Object.freeze({ recipientAccount, recipientDeviceId, algorithm: CHAT_ALGORITHM, ephemeralPublicKey, nonce: encode(nonce), ciphertext: encode(ciphertext), ciphertextHash: bytesToHex3(sha2562(ciphertext)) });
  }).sort(compareEnvelope);
  ephemeral.fill(0);
  const unsigned = { messageId, envelopes };
  const senderSignature = encode(ed25519.sign(signaturePayload(conversationId, messageId, sender, senderDeviceId, envelopes), input.signingSeed));
  return Object.freeze({ ...unsigned, envelopes: Object.freeze(envelopes), senderSignature });
}
function decryptDeviceMessage(input) {
  validSeed(input.encryptionSeed, "encryption seed");
  if (input.message.protocolVersion !== 2) throw new Error("Unsupported Chat message protocol");
  const envelope = input.message.envelopes.find((item) => item.recipientDeviceId === input.deviceId);
  if (!envelope) throw new Error("Message has no envelope for this device");
  if (envelope.algorithm !== CHAT_ALGORITHM) throw new Error("Unsupported Chat encryption algorithm");
  const nonce = decode(envelope.nonce, "message nonce"), ciphertext = decode(envelope.ciphertext, "message ciphertext");
  if (nonce.length !== 24 || ciphertext.length < 16 || bytesToHex3(sha2562(ciphertext)) !== envelope.ciphertextHash) throw new Error("Encrypted message integrity check failed");
  const key = derive(input.encryptionSeed.slice(), decode32(envelope.ephemeralPublicKey, "ephemeral public key"));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(xchacha20poly1305(key, nonce, envelopeAAD(input.message.conversationId, input.message.id, input.message.senderDeviceId, envelope.recipientAccount, envelope.recipientDeviceId, envelope.ephemeralPublicKey)).decrypt(ciphertext));
  } catch {
    throw new Error("Encrypted message authentication failed");
  } finally {
    key.fill(0);
  }
}
function verifyMessageSignature(message, senderDevice) {
  const signature = decode(message.senderSignature, "sender signature");
  return signature.length === 64 && ed25519.verify(signature, signaturePayload(message.conversationId, message.id, message.sender, message.senderDeviceId, message.envelopes), decode32(senderDevice.signingPublicKey, "sender signing key"));
}
function encodeRawBase64(value) {
  return encode(value);
}
function signaturePayload(conversationId, messageId, sender, senderDeviceId, envelopes) {
  const canonical = envelopes.map((value) => ({ recipientAccount: ynx(value.recipientAccount), recipientDeviceId: id(value.recipientDeviceId), algorithm: value.algorithm, ephemeralPublicKey: value.ephemeralPublicKey, nonce: value.nonce, ciphertext: value.ciphertext })).sort(compareEnvelope);
  return concatBytes3(utf8ToBytes2("ynx-chat-message-v2\n"), utf8ToBytes2(JSON.stringify({ protocolVersion: 2, conversationId: id(conversationId), messageId: id(messageId), sender: ynx(sender), senderDeviceId: id(senderDeviceId), envelopes: canonical })));
}
function envelopeAAD(conversationId, messageId, senderDeviceId, recipientAccount, recipientDeviceId, ephemeralPublicKey) {
  return utf8ToBytes2(["ynx-chat-envelope-v2", id(conversationId), id(messageId), id(senderDeviceId), ynx(recipientAccount), id(recipientDeviceId), CHAT_ALGORITHM, ephemeralPublicKey].join("\n"));
}
function derive(privateKey, publicKey) {
  const shared = x25519.getSharedSecret(privateKey, publicKey);
  privateKey.fill(0);
  const key = hkdf(sha2562, shared, void 0, INFO, 32);
  shared.fill(0);
  return key;
}
function compareEnvelope(left, right) {
  return left.recipientAccount === right.recipientAccount ? left.recipientDeviceId.localeCompare(right.recipientDeviceId) : left.recipientAccount.localeCompare(right.recipientAccount);
}
function validSeed(value, label) {
  if (!(value instanceof Uint8Array) || value.length !== 32) throw new Error(`Chat ${label} must contain 32 bytes`);
}
function id(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(value)) throw new Error("Chat identifier is invalid");
  return value;
}
function ynx(value) {
  if (!/^ynx1[0-9a-z]{38}$/.test(value)) throw new Error("Chat account is invalid");
  return value;
}
function decode32(value, label) {
  const bytes = decode(value, label);
  if (bytes.length !== 32) throw new Error(`${label} must contain 32 bytes`);
  return bytes;
}
function encode(value) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < value.length; i += 3) {
    const a = value[i] ?? 0, b = value[i + 1], c = value[i + 2], n = a << 16 | (b ?? 0) << 8 | (c ?? 0);
    out += chars[n >>> 18 & 63] + chars[n >>> 12 & 63] + (b === void 0 ? "" : chars[n >>> 6 & 63]) + (c === void 0 ? "" : chars[n & 63]);
  }
  return out;
}
function decode(value, label) {
  if (!/^[A-Za-z0-9+/_-]+$/.test(value)) throw new Error(`${label} is not raw base64`);
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", out = [];
  for (let i = 0; i < normalized.length; i += 4) {
    const chunk = normalized.slice(i, i + 4), indexes = [...chunk].map((char) => chars.indexOf(char));
    if (chunk.length === 1 || indexes.some((value2) => value2 < 0)) throw new Error(`${label} is not raw base64`);
    const n = (indexes[0] ?? 0) << 18 | (indexes[1] ?? 0) << 12 | (indexes[2] ?? 0) << 6 | (indexes[3] ?? 0);
    out.push(n >>> 16 & 255);
    if (chunk.length > 2) out.push(n >>> 8 & 255);
    if (chunk.length > 3) out.push(n & 255);
  }
  return Uint8Array.from(out);
}

// ../src/scopedSessionBridge.ts
var SOCIAL_CHAT_SCOPES2 = Object.freeze(["account:read", "profile:link", "social.contacts", "social.messaging", "social.profile"]);
function parseStoredChatDevice(raw) {
  const value = JSON.parse(raw);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(value.deviceId) || !/^[a-f0-9]{64}$/.test(value.signingSeed) || !/^[a-f0-9]{64}$/.test(value.encryptionSeed)) throw new Error("Existing Social keys require recovery; nothing was replaced");
  return value;
}
function deviceRegistration(proof, device2) {
  const session = proof.proof;
  for (const key of ["account", "sessionBinding", "deviceId", "deviceKey"]) if (typeof session[key] !== "string") throw new Error("Shared Product Session proof is incomplete");
  const account2 = session.account, binding = session.sessionBinding;
  if (device2.account && device2.account !== account2) throw new Error("This Social device belongs to another account; its keys were preserved");
  const signing = hexToBytes3(device2.signingSeed), encryption = hexToBytes3(device2.encryptionSeed);
  try {
    const signingPublicKey = encodeRawBase64(ed25519.getPublicKey(signing)), encryptionPublicKey = encodeRawBase64(x25519.getPublicKey(encryption));
    const sign = (text3) => encodeRawBase64(ed25519.sign(utf8ToBytes2(text3), signing));
    const idempotency = (kind) => `${kind}-${bytesToHex3(sha2562(utf8ToBytes2(binding))).slice(0, 24)}`;
    return {
      deviceId: device2.deviceId,
      signingPublicKey,
      encryptionPublicKey,
      deviceProofSignature: sign(["ynx-social-session-device-v2", account2, binding, session.deviceId, session.deviceKey, device2.deviceId, signingPublicKey, encryptionPublicKey].join("\n")),
      chatRegistrationSignature: sign(["ynx-chat-device-register-v1", account2, device2.deviceId, signingPublicKey, encryptionPublicKey, idempotency("social-chat")].join("\n")),
      squareRegistrationSignature: sign(["ynx-square-device-register-v1", account2, device2.deviceId, signingPublicKey, idempotency("social-square")].join("\n"))
    };
  } finally {
    signing.fill(0);
    encryption.fill(0);
  }
}
async function bindScopedSocialSession(api, client, device2, csrf) {
  const proof = await client.proof(["social.messaging", "social.profile"]);
  const account2 = proof.proof.account;
  if (typeof account2 !== "string") throw new Error("No verified shared account");
  api.useProductSession((scopes2) => client.proof(scopes2), account2, csrf);
  const result = await api.bindDevice(deviceRegistration(proof, device2), proof);
  if (result.session.account !== account2 || result.session.deviceId !== device2.deviceId) throw new Error("Social device binding changed");
  return { ...result, token: "", authMode: "product-session-v2" };
}

// ../src/messageOutbox.ts
function readOutbox(raw) {
  if (!raw) return [];
  if (raw.length > 4 * 1024 * 1024) throw new Error("Pending message storage exceeds its limit");
  const parsed = JSON.parse(raw);
  const entries = Array.isArray(parsed) ? parsed : [{ ...parsed, deviceId: parsed.deviceId ?? "" }];
  if (entries.length > 100) throw new Error("Too many pending messages");
  for (const entry of entries) {
    if (!entry || typeof entry.account !== "string" || typeof entry.deviceId !== "string" || typeof entry.conversationId !== "string" || typeof entry.request?.messageId !== "string" || !Array.isArray(entry.request.envelopes) || typeof entry.request.senderSignature !== "string") {
      throw new Error("Pending message storage is invalid; existing data was preserved");
    }
  }
  return entries;
}
function same(left, right) {
  return left.account === right.account && left.deviceId === right.deviceId && left.conversationId === right.conversationId && left.request.messageId === right.request.messageId;
}
function queueMessage(entries, message) {
  const previous = entries.find((entry) => same(entry, message));
  if (previous) {
    if (JSON.stringify(previous.request) !== JSON.stringify(message.request)) throw new Error("Pending message ID cannot be reused with different ciphertext");
    return [...entries];
  }
  const next = [...entries, message];
  readOutbox(JSON.stringify(next));
  return next;
}
function acknowledgeQueued(entries, message) {
  return entries.filter((entry) => !same(entry, message));
}
function pendingFor(entries, account2, deviceId, conversationId) {
  return entries.find((entry) => entry.account === account2 && entry.deviceId === deviceId && entry.conversationId === conversationId)?.request ?? null;
}
function assertPendingRecipients(message, devices) {
  const active = devices.filter((device2) => device2.status === "active");
  const sender = active.find((device2) => device2.id === message.deviceId && device2.account === message.account);
  if (!sender) throw new Error("This sending device is no longer active. Pending ciphertext was retained.");
  const recipientKey = (account2, deviceId) => JSON.stringify([account2, deviceId]);
  const expected = new Set(active.map((device2) => recipientKey(device2.account, device2.id)));
  const actual = new Set(message.request.envelopes.map((envelope) => recipientKey(envelope.recipientAccount, envelope.recipientDeviceId)));
  if (active.length < 1 || active.length > 32 || expected.size !== active.length || actual.size !== message.request.envelopes.length || actual.size !== expected.size || [...expected].some((key) => !actual.has(key))) {
    throw new Error("Conversation devices or membership changed. Pending ciphertext was retained; create a new message for the current recipients.");
  }
  const record = {
    ...message.request,
    id: message.request.messageId,
    sender: message.account,
    senderDeviceId: message.deviceId,
    conversationId: message.conversationId,
    protocolVersion: 2,
    envelopeSetHash: "",
    createdAt: ""
  };
  try {
    if (!verifyMessageSignature(record, sender)) throw new Error("invalid signature");
  } catch {
    throw new Error("Pending message sender verification failed. Nothing was transmitted.");
  }
}

// protected-chat-devices.ts
var ORIGIN = "https://social.ynxweb4.com";
var ChatStorageError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
var recovery = () => new ChatStorageError("CHAT_DEVICE_RECOVERY_REQUIRED", "Protected chat device could not be verified. Existing carriers were retained; no replacement keys were created.");
var additionalData = (origin, account2, deviceId) => new TextEncoder().encode(JSON.stringify(["ynx-social-chat-device-at-rest-v1", origin, account2, deviceId]));
async function sealChatDevice(crypto2, account2, raw) {
  const device2 = parseStoredChatDevice(raw);
  if (device2.account !== account2) throw recovery();
  const key = await crypto2.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const iv = crypto2.getRandomValues(new Uint8Array(12)), plaintext = new TextEncoder().encode(raw);
  try {
    const ciphertext = await crypto2.subtle.encrypt({ name: "AES-GCM", iv: iv.buffer, additionalData: additionalData(ORIGIN, account2, device2.deviceId).buffer }, key, plaintext.buffer);
    return { version: 1, origin: ORIGIN, account: account2, deviceId: device2.deviceId, key, iv: iv.buffer, ciphertext };
  } finally {
    plaintext.fill(0);
  }
}
async function openChatDevice(crypto2, account2, carrier) {
  const algorithm = carrier?.key?.algorithm;
  if (carrier?.version !== 1 || carrier.origin !== ORIGIN || carrier.account !== account2 || !carrier.key || carrier.key.type !== "secret" || carrier.key.extractable !== false || algorithm?.name !== "AES-GCM" || algorithm.length !== 256 || !carrier.key.usages.includes("decrypt") || carrier.iv?.byteLength !== 12 || carrier.ciphertext?.byteLength < 16 || carrier.ciphertext?.byteLength > 8192) throw recovery();
  let bytes;
  try {
    bytes = new Uint8Array(await crypto2.subtle.decrypt({ name: "AES-GCM", iv: carrier.iv, additionalData: additionalData(carrier.origin, account2, carrier.deviceId).buffer }, carrier.key, carrier.ciphertext));
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes), device2 = parseStoredChatDevice(raw);
    if (device2.account !== account2 || device2.deviceId !== carrier.deviceId) throw recovery();
    return raw;
  } catch {
    throw recovery();
  } finally {
    bytes?.fill(0);
  }
}
function protectedChatDevices(storage, environment = globalThis) {
  function secure() {
    if (environment.isSecureContext !== true || environment.location.origin !== ORIGIN || !environment.crypto?.subtle) throw new ChatStorageError("CHAT_SECURE_STORAGE_UNAVAILABLE", "Chat requires the registered HTTPS origin and persistent non-extractable WebCrypto storage");
  }
  async function retained(account2) {
    const carrier = await storage.load(account2);
    return carrier ? await openChatDevice(environment.crypto, account2, carrier) : null;
  }
  return {
    async get(account2, create) {
      secure();
      if (!/^ynx1[0-9a-z]{38}$/.test(account2)) throw recovery();
      if (await storage.legacy(account2) !== null) throw new ChatStorageError("CHAT_DEVICE_PROTECTION_REQUIRED", "An existing browser chat device needs explicit protection. Its keys were retained and no new device was substituted.");
      let raw = await retained(account2);
      if (raw === null) {
        if (!create) throw new ChatStorageError("CHAT_DEVICE_MISSING", "No retained browser chat device; explicitly approve before creating one");
        const signing = environment.crypto.getRandomValues(new Uint8Array(32)), encryption = environment.crypto.getRandomValues(new Uint8Array(32));
        try {
          const device2 = { account: account2, deviceId: `social-${bytesToHex3(environment.crypto.getRandomValues(new Uint8Array(12)))}`, signingSeed: bytesToHex3(signing), encryptionSeed: bytesToHex3(encryption) };
          await storage.insert(account2, await sealChatDevice(environment.crypto, account2, JSON.stringify(device2)));
        } finally {
          signing.fill(0);
          encryption.fill(0);
        }
        raw = await retained(account2);
        if (raw === null) throw recovery();
      }
      return parseStoredChatDevice(raw);
    },
    async protectLegacy(account2, confirmed) {
      secure();
      if (!confirmed) throw new ChatStorageError("CHAT_PROTECTION_CONFIRMATION_REQUIRED", "Confirm protection of this browser's existing device; no wallet/private key import is required");
      const raw = await storage.legacy(account2);
      if (raw === null) throw recovery();
      const device2 = parseStoredChatDevice(raw);
      if (device2.account !== account2) throw recovery();
      if (await storage.load(account2) === null) await storage.insert(account2, await sealChatDevice(environment.crypto, account2, raw));
      if (await retained(account2) !== raw) throw recovery();
      await storage.removeLegacy(account2, raw);
      if (await storage.legacy(account2) !== null) throw recovery();
      return device2;
    }
  };
}
function indexedDBChatCarriers(indexedDB) {
  const factory = () => {
    if (!indexedDB || typeof indexedDB.open !== "function") throw new ChatStorageError("CHAT_SECURE_STORAGE_UNAVAILABLE", "Chat requires persistent IndexedDB storage. Existing device data was retained.");
    return indexedDB;
  };
  const open = () => new Promise((resolve, reject) => {
    const request = factory().open("ynx-social-chat-secrets-v2", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("devices");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(recovery());
  });
  const openLegacy = async () => {
    const idb = factory();
    if (typeof idb.databases === "function" && !(await idb.databases()).some((item) => item.name === "ynx-social-chat-devices-v1")) return null;
    return new Promise((resolve, reject) => {
      const request = idb.open("ynx-social-chat-devices-v1");
      let missing = false;
      request.onupgradeneeded = () => {
        missing = true;
        request.transaction?.abort();
      };
      request.onsuccess = () => {
        if (!request.result.objectStoreNames.contains("devices")) {
          request.result.close();
          reject(recovery());
        } else resolve(request.result);
      };
      request.onerror = () => missing ? resolve(null) : reject(recovery());
    });
  };
  async function operate(db, mode, action) {
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction("devices", mode);
        let result;
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(recovery());
        transaction.onabort = () => reject(recovery());
        const guard = (callback2) => {
          try {
            callback2();
          } catch {
            reject(recovery());
            try {
              transaction.abort();
            } catch {
            }
          }
        };
        guard(() => action(transaction.objectStore("devices"), (value) => {
          result = value;
        }, guard));
      });
    } finally {
      db.close();
    }
  }
  return {
    async load(account2) {
      return operate(await open(), "readonly", (store, set) => {
        const request = store.get(account2);
        request.onsuccess = () => set(request.result ?? null);
      });
    },
    async insert(account2, carrier) {
      return operate(await open(), "readwrite", (store, set, guard) => {
        const request = store.get(account2);
        request.onsuccess = () => guard(() => {
          if (request.result === void 0) store.add(carrier, account2);
          set(void 0);
        });
      });
    },
    async legacy(account2) {
      const db = await openLegacy();
      if (!db) return null;
      return operate(db, "readonly", (store, set) => {
        const request = store.get(account2);
        request.onsuccess = () => {
          if (request.result !== void 0 && typeof request.result !== "string") {
            request.transaction?.abort();
            return;
          }
          set(request.result ?? null);
        };
      });
    },
    async removeLegacy(account2, expected) {
      const db = await openLegacy();
      if (!db) throw recovery();
      return operate(db, "readwrite", (store, set) => {
        const request = store.get(account2);
        request.onsuccess = () => {
          if (request.result !== expected) {
            request.transaction?.abort();
            return;
          }
          store.delete(account2);
          set(void 0);
        };
      });
    }
  };
}

// chat-workspace.ts
function browserChatDevices(environment = globalThis) {
  return protectedChatDevices(indexedDBChatCarriers(environment.indexedDB), environment);
}
var SocialWorkspace = class {
  constructor(client, api, devices, outbox2, identity2, publish, random = (bytes) => {
    bytes.set(crypto.getRandomValues(new Uint8Array(bytes.length)));
    return bytes;
  }, invitationIntents) {
    this.client = client;
    this.api = api;
    this.devices = devices;
    this.outbox = outbox2;
    this.identity = identity2;
    this.publish = publish;
    this.random = random;
    this.invitationIntents = invitationIntents;
  }
  client;
  api;
  devices;
  outbox;
  identity;
  publish;
  random;
  invitationIntents;
  session = null;
  device = null;
  generation = 0;
  contactPreview = null;
  previewSequence = 0;
  submittingPreview = null;
  contactMessage = null;
  privacyOperation = new ContactOperation();
  invitationOperation = new ContactOperation();
  privacyIntent = null;
  view = { status: "Private workspace is locked" };
  get current() {
    return this.view;
  }
  lock(status2 = "Private workspace is locked") {
    this.invitationOperation.cancel();
    this.privacyOperation.cancel();
    this.privacyIntent = null;
    this.generation++;
    this.previewSequence++;
    this.contactPreview = null;
    this.contactMessage = null;
    this.submittingPreview = null;
    this.session = null;
    this.device = null;
    this.api.setToken(null);
    this.view = { status: status2 };
    this.publish(this.view);
  }
  render(next, generation = this.generation) {
    if (generation !== this.generation) throw new Error("Social account changed; old data discarded");
    this.view = { ...this.view, ...next };
    this.publish(this.view);
  }
  active() {
    if (!this.session || !this.device) throw new Error("Explicit Social chat approval is required");
    return { session: this.session, device: this.device, generation: this.generation };
  }
  async authorize() {
    this.lock("Waiting for your explicit Social chat permission");
    return this.client.begin();
  }
  async connect(result, create = false) {
    this.lock("Verifying identity, Social permission and chat device");
    const generation = this.generation;
    if (result.status !== "connected" || !["social.contacts", "social.messaging", "social.profile"].every((scope2) => result.session?.scopes?.includes(scope2))) throw new Error("Profile, contacts and encrypted chat require your explicit approval");
    const identity2 = await this.identity();
    if (identity2.account !== result.session.account) throw new Error("Shared identity and Social permission differ; reconnect explicitly");
    const device2 = await this.devices.get(identity2.account, create);
    if (generation !== this.generation) throw new Error("Social account changed");
    const session = await bindScopedSocialSession(this.api, this.client, device2, identity2.csrfToken);
    if (generation !== this.generation) {
      this.api.setToken(null);
      throw new Error("Social account changed");
    }
    this.session = session;
    this.device = device2;
    this.render({ account: session.session.account, conversations: [], messages: [], status: "Profile and encrypted chat verified on this device" }, generation);
    await this.refresh();
    return session;
  }
  async restore() {
    try {
      return await this.connect(await this.client.restore());
    } catch (error) {
      this.lock("Saved workspace is unavailable. Keys and pending ciphertext were retained.");
      throw error;
    }
  }
  async accept(url2) {
    try {
      return await this.connect(await this.client.handleReturn(url2), true);
    } catch (error) {
      this.lock("Social approval could not be verified; no private workspace unlocked");
      throw error;
    }
  }
  async protectExistingDevice(confirmed) {
    this.lock("Existing browser device protection requires confirmation");
    const result = await this.client.restore();
    if (result.status !== "connected" || !result.session?.scopes?.includes("social.messaging")) throw new Error("Restore your approved Social session before protecting its device");
    const identity2 = await this.identity();
    if (identity2.account !== result.session.account || !this.devices.protectLegacy) throw new Error("No matching device protection operation");
    await this.devices.protectLegacy(identity2.account, confirmed);
    return this.connect(result);
  }
  async logout() {
    this.lock("Signed out locally; server revocation is pending");
    const result = await this.client.disconnect();
    if (result.status !== "disconnected") throw new Error("Social revocation is pending; private access remains locked");
    this.lock("Social permission revoked. Keys and pending ciphertext retained.");
  }
  async refresh() {
    const { generation } = this.active();
    const [profile, conversations, people] = await Promise.all([this.api.profileOrSetup(), this.api.conversations(), this.api.contacts()]);
    this.render({ profile: profile ?? void 0, needsProfileSetup: !profile, contacts: people.contacts, requests: people.requests, conversations: conversations.conversations, status: profile ? "Workspace refreshed" : "Create your profile and handle to start connecting with people" }, generation);
    const selected = this.view.conversationId;
    if (selected) {
      if (conversations.conversations.some((item) => item.id === selected)) await this.select(selected);
      else this.render({ conversationId: void 0, messages: [] }, generation);
    }
  }
  async updateProfile(body) {
    const { generation } = this.active();
    const result = await this.api.updateProfile({ ...body, idempotencyKey: `profile-${bytesToHex3(this.random(new Uint8Array(12)))}` });
    this.render({ profile: result.record, needsProfileSetup: false, status: "Profile saved" }, generation);
    await this.refresh();
  }
  async loadPrivacy() {
    const { session, generation } = this.active();
    const result = await this.privacyOperation.run((signal) => this.api.settings(signal));
    if (generation !== this.generation) throw new Error("Social account changed; old privacy settings discarded");
    const settings = checkedPrivacySettings(result.record, session.session.account);
    this.privacyIntent = null;
    this.render({ settings, status: "Current discovery privacy loaded. No address book was uploaded." }, generation);
  }
  async savePrivacy(input) {
    const { session, generation } = this.active();
    if (!this.view.settings) throw new Error("Read your current privacy settings first");
    const body = { ...input, avatarUrl: this.view.settings.avatarUrl };
    const previous = this.privacyIntent;
    if (previous && JSON.stringify({ ...previous.body, idempotencyKey: void 0 }) !== JSON.stringify(body)) throw new Error("Retry the original unchanged privacy settings or read the current server settings first");
    const intent = previous ?? { generation, body: { ...body, idempotencyKey: `privacy-${bytesToHex3(this.random(new Uint8Array(12)))}` } };
    this.privacyIntent = intent;
    const result = await this.privacyOperation.run((signal) => this.api.updateSettings(intent.body, signal));
    if (generation !== this.generation || this.privacyIntent !== intent) throw new Error("Social account changed; old privacy result discarded");
    const settings = checkedPrivacySettings(result.record, session.session.account);
    this.privacyIntent = null;
    this.render({ settings, profile: this.view.profile ? { ...this.view.profile, privacy: settings } : void 0, status: "Discovery privacy saved. No contact upload, following or wallet request was made." }, generation);
  }
  async loadInvitations() {
    const { session, generation } = this.active(), account2 = session.session.account;
    const guard = () => {
      if (generation !== this.generation) throw new Error("Social account changed; old invitation readback discarded");
    };
    await this.invitationOperation.run(async (signal) => {
      const intent = await this.invitationIntents?.load(account2);
      guard();
      const result = checkedInvitationSnapshot(await this.api.invitations(intent?.key, signal));
      guard();
      if (intent && result.operation?.confirmed) {
        await this.invitationIntents.clear(account2, intent.key, guard, signal);
        guard();
      }
      this.render({ invitations: result.invitations, invitationPending: !!intent && !result.operation?.confirmed, status: intent && !result.operation?.confirmed ? "Original invitation outcome is not confirmed. Retry keeps the same request identity." : "Invitations read from your current private account. Sharing never adds contacts or followers." }, generation);
    });
  }
  async createInvitation() {
    const { session, generation } = this.active(), account2 = session.session.account;
    if (!this.view.profile || !this.invitationIntents) throw new Error("An existing profile and durable invitation storage are required");
    const guard = () => {
      if (generation !== this.generation) throw new Error("Social account changed; original invitation intent retained");
    };
    await this.invitationOperation.run(async (signal) => {
      let intent = await this.invitationIntents.load(account2);
      guard();
      if (!intent) {
        const candidate = { schemaVersion: 1, account: account2, key: `invitation-${bytesToHex3(this.random(new Uint8Array(12)))}`, ttlSeconds: 86400 };
        intent = await this.invitationIntents.reserve(candidate, guard, signal);
        guard();
      }
      this.render({ invitationPending: true, status: "Creating or retrying your original invitation. The outcome must be read back." }, generation);
      const created = await this.api.createInvite(intent.ttlSeconds, intent.key, signal);
      guard();
      const result = checkedInvitationSnapshot(await this.api.invitations(intent.key, signal));
      guard();
      if (!result.operation?.confirmed || result.operation.id !== created.record.id) throw new Error("Original invitation was not confirmed; its exact request identity is retained");
      await this.invitationIntents.clear(account2, intent.key, guard, signal);
      guard();
      this.render({ invitations: result.invitations, invitationPending: false, status: "Original invitation confirmed. The recipient must preview your profile and you must accept their request." }, generation);
    });
  }
  async revokeInvitation(id2) {
    const { generation } = this.active();
    if (!this.view.invitations?.some((record) => record.id === id2 && record.status === "active")) throw new Error("Choose a current active invitation first");
    await this.invitationOperation.run((signal) => this.api.revokeInvite(id2, signal));
    if (generation !== this.generation) throw new Error("Social account changed; old revocation result discarded");
    await this.loadInvitations();
  }
  async previewContact(source, input) {
    const { generation } = this.active();
    if (!this.view.profile) throw new Error("Create your profile before sending a contact request");
    const sequence = ++this.previewSequence;
    this.contactPreview = null;
    this.contactMessage = null;
    let value = input.trim();
    if (source === "handle") value = value.replace(/^@/, "");
    if (source === "invite" && value.startsWith("https:")) {
      const url2 = new URL(value);
      if (url2.origin !== "https://social.ynxweb4.com" || url2.username || url2.password || url2.search || url2.hash || !/^\/invite\/[A-Za-z0-9_-]+$/.test(url2.pathname)) throw new Error("Use an exact YNX Social invitation link");
      value = url2.pathname.slice("/invite/".length);
    }
    if (!value) throw new Error("Enter the person's username, QR content or invitation");
    const result = await this.api.previewContact(source, value);
    if (generation !== this.generation || sequence !== this.previewSequence) throw new Error("Contact preview changed; review again");
    if (!result.person?.id || typeof result.person.handle !== "string" || typeof result.person.displayName !== "string") throw new Error("Contact profile could not be verified");
    const preview = Object.freeze({ source, value, person: Object.freeze({ ...result.person }), idempotencyKey: `contact-${bytesToHex3(this.random(new Uint8Array(12)))}` });
    this.contactPreview = preview;
    return preview;
  }
  isContactPreviewCurrent(preview) {
    return !!this.session && !!this.device && this.contactPreview === preview;
  }
  contactContextGuard() {
    const { generation } = this.active();
    return () => generation === this.generation && !!this.session && !!this.device;
  }
  cancelContactPreview(preview) {
    if (this.contactPreview === preview) {
      this.contactPreview = null;
      this.contactMessage = null;
      this.previewSequence++;
    }
  }
  async confirmContact(preview, message = "") {
    const { generation } = this.active();
    if (!this.isContactPreviewCurrent(preview)) throw new Error("Contact preview changed; review again");
    if (this.submittingPreview) throw new Error("A contact request is already being submitted");
    message = message.trim();
    if (Array.from(message).length > 200) throw new Error("Keep the request message within 200 characters");
    if (this.contactMessage?.preview === preview && this.contactMessage.message !== message) throw new Error("Retry the original request message or review again");
    this.contactMessage = { preview, message };
    this.submittingPreview = preview;
    try {
      await this.api.requestContact(preview.source, preview.value, preview.idempotencyKey, preview.person.id, message);
      if (generation !== this.generation) throw new Error("Social account changed; old request result discarded");
      this.cancelContactPreview(preview);
      await this.refresh();
    } finally {
      if (this.submittingPreview === preview) this.submittingPreview = null;
    }
  }
  async requestContact(handle, preview) {
    if (!preview || preview.source !== "handle" || preview.value !== handle.trim().replace(/^@/, "")) throw new Error("Preview the person and explicitly confirm before sending a request");
    return this.confirmContact(preview);
  }
  async transitionContact(id2, action) {
    this.active();
    await this.api.transitionRequest(id2, action);
    await this.refresh();
  }
  async changeContact(id2, action) {
    const { generation } = this.active();
    if (!/^sp_[A-Za-z0-9_-]{32}$/.test(id2) || !this.view.contacts?.some((person) => person.id === id2)) throw new Error("Choose a current accepted contact first");
    if (action === "remove") await this.api.deleteContact(id2);
    else if (action === "block") await this.api.block(id2);
    else await this.api.mute(id2, action === "mute");
    if (generation !== this.generation) throw new Error("Social account changed; old contact result discarded");
    await this.refresh();
  }
  async createConversation(handle) {
    this.active();
    const normalized = handle.trim().replace(/^@/, "");
    if (!this.view.contacts?.some((person) => person.handle === normalized)) throw new Error("Ask the person to accept your contact request before starting a conversation");
    const result = await this.api.createConversation("handle", normalized, `conversation-${bytesToHex3(this.random(new Uint8Array(12)))}`);
    await this.refresh();
    await this.select(result.record.id);
  }
  async select(id2) {
    const { device: device2, generation } = this.active();
    const [devices, page] = await Promise.all([this.api.conversationDevices(id2), this.api.messages(id2)]);
    const seed = hexToBytes3(device2.encryptionSeed);
    try {
      const messages = page.messages.map((record) => {
        const sender = devices.devices.find((item) => item.id === record.senderDeviceId);
        if (!sender || sender.account !== record.sender || !verifyMessageSignature(record, sender)) throw new Error("Message sender verification failed");
        return { record, plaintext: record.envelopes.some((item) => item.recipientDeviceId === device2.deviceId) ? decryptDeviceMessage({ encryptionSeed: seed, deviceId: device2.deviceId, message: record }) : "This earlier message was encrypted for another device. Its original ciphertext is preserved." };
      });
      this.render({ conversationId: id2, messages, status: "Verified encrypted message history" }, generation);
    } finally {
      seed.fill(0);
    }
  }
  async send(text3) {
    const { session, device: device2, generation } = this.active(), id2 = this.view.conversationId;
    if (!id2) throw new Error("Choose a conversation first");
    if (pendingFor(this.outbox.read(), session.session.account, device2.deviceId, id2)) throw new Error("Retry the retained encrypted message before creating another");
    const devices = await this.api.conversationDevices(id2);
    if (generation !== this.generation) throw new Error("Social account changed");
    const signing = hexToBytes3(device2.signingSeed), entropy = this.random(new Uint8Array(32));
    try {
      const request = createEnvelopeSet({ signingSeed: signing, senderAccount: session.session.account, senderDeviceId: device2.deviceId, conversationId: id2, messageId: `message-${bytesToHex3(this.random(new Uint8Array(12)))}`, plaintext: text3, devices: devices.devices, entropy });
      this.outbox.update((entries) => queueMessage(entries, { account: session.session.account, deviceId: device2.deviceId, conversationId: id2, request }));
    } finally {
      signing.fill(0);
      entropy.fill(0);
    }
    await this.retry();
  }
  async retry() {
    const { session, device: device2, generation } = this.active(), id2 = this.view.conversationId;
    if (!id2) throw new Error("Choose a conversation first");
    const request = pendingFor(this.outbox.read(), session.session.account, device2.deviceId, id2);
    if (!request) throw new Error("No retained encrypted message for this account and device");
    const pending = { account: session.session.account, deviceId: device2.deviceId, conversationId: id2, request };
    const devices = await this.api.conversationDevices(id2);
    assertPendingRecipients(pending, devices.devices);
    if (generation !== this.generation) throw new Error("Social account changed");
    await this.api.sendMessage(id2, request);
    if (generation !== this.generation) throw new Error("Social account changed; pending ciphertext retained");
    this.outbox.update((entries) => acknowledgeQueued(entries, pending));
    await this.select(id2);
  }
};

// ../src/api.ts
var SocialAPIError = class extends Error {
  constructor(message, status2) {
    super(message);
    this.status = status2;
  }
  status;
};
var SocialAPI = class {
  base;
  token;
  productProof = null;
  productAccount = null;
  csrf;
  epoch = 0;
  onPrivateInvalidated;
  constructor(base = process.env.EXPO_PUBLIC_YNX_SOCIAL_API_BASE ?? "https://api.ynxweb4.com", token2 = null) {
    if (!/^https:\/\//.test(base) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error("Set a secure YNX Social API endpoint");
    this.base = base.replace(/\/$/, "");
    this.token = token2;
  }
  get authorizationGeneration() {
    return this.epoch;
  }
  get currentProductAccount() {
    return this.productAccount;
  }
  authorizationGuard() {
    const epoch = this.epoch;
    return () => epoch === this.epoch;
  }
  setToken(value) {
    const hadPrivateProof = this.productProof !== null;
    this.epoch++;
    this.productProof = null;
    this.productAccount = null;
    this.token = value;
    if (hadPrivateProof) this.onPrivateInvalidated?.();
  }
  useSession(value) {
    if (value.authMode !== "product-session-v2") this.setToken(value.token);
  }
  useProductSession(proof, account2, csrf) {
    this.epoch++;
    this.token = null;
    this.productProof = proof;
    this.productAccount = account2;
    this.csrf = csrf;
  }
  bindDevice(body, proof) {
    return this.request("/social/v2/session/bind", { method: "POST", body, proof });
  }
  walletChallenge(request, approval) {
    return this.request("/social/v1/wallet/challenge", { method: "POST", body: { request, approval }, auth: false });
  }
  login(input) {
    return this.request("/social/v1/wallet/login", { method: "POST", body: input, auth: false });
  }
  profile() {
    return this.request("/social/v1/profile");
  }
  async profileOrSetup() {
    try {
      const record = (await this.profile()).record;
      if (!record) throw new Error("Invalid Social profile response");
      return !record.handle && !record.displayName ? null : record;
    } catch (error) {
      if (error instanceof SocialAPIError && error.status === 404) return null;
      throw error;
    }
  }
  updateProfile(body) {
    return this.request("/social/v1/profile", { method: "PUT", body });
  }
  settings(signal) {
    return this.request("/social/v1/settings", { signal });
  }
  updateSettings(body, signal) {
    return this.request("/social/v1/settings", { method: "PUT", body, signal });
  }
  invitations(intent, signal) {
    return this.request("/social/v1/invites" + (intent ? "?intent=" + encodeURIComponent(intent) : ""), { signal });
  }
  createInvite(ttlSeconds = 86400, idempotencyKey, signal) {
    return this.request("/social/v1/invites", { method: "POST", body: { ttlSeconds, idempotencyKey }, signal });
  }
  revokeInvite(id2, signal) {
    return this.request(`/social/v1/invites/${encodeURIComponent(id2)}/revoke`, { method: "POST", body: {}, signal });
  }
  contacts() {
    return this.request("/social/v1/contacts");
  }
  contactMatches(hashes) {
    return this.request("/social/v1/contact-matches", { method: "POST", body: { hashes } });
  }
  previewContact(source, value, signal) {
    return this.request("/social/v1/contacts/preview", { method: "POST", body: { source, value }, signal });
  }
  requestContact(source, value, idempotencyKey, expectedAccount, message = "", signal) {
    return this.request("/social/v1/contact-requests", { method: "POST", body: { source, value, idempotencyKey, expectedAccount, message: message || void 0 }, signal });
  }
  transitionRequest(id2, action) {
    return this.request(`/social/v1/contact-requests/${encodeURIComponent(id2)}`, { method: "POST", body: { action } });
  }
  deleteContact(target) {
    return this.request("/social/v1/contacts/delete", { method: "POST", body: { target } });
  }
  block(target) {
    return this.request("/social/v1/privacy/block", { method: "POST", body: { target } });
  }
  mute(target, active) {
    return this.request("/social/v1/privacy/mute", { method: "POST", body: { target, active } });
  }
  conversations(query = "") {
    return this.request(`/social/v1/conversations?q=${encodeURIComponent(query)}`);
  }
  createConversation(source, value, idempotencyKey) {
    return this.request("/social/v1/conversations", { method: "POST", body: { source, value, idempotencyKey } });
  }
  createGroup(title, handles, idempotencyKey) {
    return this.request("/social/v1/conversations/groups", { method: "POST", body: { title, idempotencyKey, members: handles.map((value, index) => ({ source: "handle", value, idempotencyKey: `member-${index}` })) } });
  }
  updateGroupMembers(id2, body) {
    return this.request(`/social/v1/conversations/${encodeURIComponent(id2)}/members`, { method: "POST", body });
  }
  conversation(id2) {
    return this.request(`/social/v1/conversations/${encodeURIComponent(id2)}`);
  }
  conversationDevices(id2) {
    return this.request(`/social/v1/conversations/${encodeURIComponent(id2)}/devices`);
  }
  messagePage(id2, after = "", limit = 100) {
    return this.request(`/social/v1/conversations/${encodeURIComponent(id2)}/messages?limit=${limit}&after=${encodeURIComponent(after)}`);
  }
  async messages(id2) {
    const messages = [];
    let cursor = "";
    const seen = /* @__PURE__ */ new Set();
    for (let page = 0; page < 100; page++) {
      const result = await this.messagePage(id2, cursor);
      for (const item of result.messages) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          messages.push(item);
        }
      }
      if (!result.hasMore) return { messages };
      if (!result.nextCursor || result.nextCursor === cursor) throw new Error("Message synchronization cursor did not advance");
      cursor = result.nextCursor;
    }
    throw new Error("Message history exceeds this synchronization window");
  }
  sendMessage(id2, body) {
    return this.request(`/social/v1/conversations/${encodeURIComponent(id2)}/messages`, { method: "POST", body });
  }
  acknowledge(id2, messageId, state2) {
    return this.request(`/social/v1/conversations/${encodeURIComponent(id2)}/messages/${encodeURIComponent(messageId)}/${state2}`, { method: "POST", body: {} });
  }
  rotateDevice(replacedDeviceId, body) {
    return this.request(`/social/v1/devices/${encodeURIComponent(replacedDeviceId)}/rotate`, { method: "POST", body });
  }
  feed() {
    return this.request("/social/v1/feed");
  }
  publishMoment(body) {
    return this.request("/social/v1/feed", { method: "POST", body });
  }
  comments(id2) {
    return this.request(`/social/v1/feed/${encodeURIComponent(id2)}/comments`);
  }
  comment(id2, text3, idempotencyKey) {
    return this.request(`/social/v1/feed/${encodeURIComponent(id2)}/comments`, { method: "POST", body: { text: text3, idempotencyKey } });
  }
  react(id2, kind, active, idempotencyKey) {
    return this.request(`/social/v1/feed/${encodeURIComponent(id2)}/reaction`, { method: "POST", body: { kind, active, idempotencyKey } });
  }
  deleteMoment(id2) {
    return this.request(`/social/v1/feed/${encodeURIComponent(id2)}`, { method: "DELETE", headers: { "X-YNX-Confirm-Delete": "DELETE MOMENT" } });
  }
  follow(handle, active, idempotencyKey) {
    return this.request("/social/v1/follows", { method: "POST", body: { source: "handle", value: handle, idempotencyKey, active } });
  }
  uploadMedia(body) {
    return this.request("/social/v1/media", { method: "POST", body });
  }
  mediaSource(id2) {
    if (!this.token) throw new Error("Social session is locked");
    return { uri: `${this.base}/social/v1/media/${encodeURIComponent(id2)}`, headers: { Authorization: `Bearer ${this.token}` } };
  }
  async downloadMedia(id2) {
    if (!this.token) throw new Error("Social session is locked");
    const response = await fetch(`${this.base}/social/v1/media/${encodeURIComponent(id2)}`, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!response.ok) throw new Error(`Attachment download failed (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }
  report(body) {
    return this.request("/social/v1/reports", { method: "POST", body });
  }
  reportDetail(id2) {
    return this.request(`/social/v1/reports/${encodeURIComponent(id2)}`);
  }
  appealReport(id2, correction) {
    return this.request(`/social/v1/reports/${encodeURIComponent(id2)}/appeal`, { method: "POST", body: { correction } });
  }
  alerts() {
    return this.request("/social/v1/notifications");
  }
  markRead(id2) {
    return this.request(`/social/v1/notifications/${encodeURIComponent(id2)}/read`, { method: "POST", body: {} });
  }
  exportData() {
    return this.request("/social/v1/privacy/export");
  }
  async deleteAccount(onConfirmed) {
    const current = this.authorizationGuard();
    const result = await this.request("/social/v1/privacy/delete", { method: "DELETE", headers: { "X-YNX-Confirm-Delete": "DELETE MY SOCIAL DATA" } });
    if (!current()) throw new Error("Social authorization changed; deletion response discarded");
    if (!result || typeof result !== "object" || Array.isArray(result) || Object.keys(result).length !== 1 || !("deleted" in result) || result.deleted !== true) throw new Error("Deletion response was not confirmed; original authorization and local data retained");
    try {
      if (onConfirmed) await onConfirmed(current);
    } catch (error) {
      if (current()) this.setToken(null);
      throw error;
    }
    if (!current()) throw new Error("Social authorization changed; deletion confirmation retained only for original account");
    this.setToken(null);
    return result;
  }
  async deleteAccountReceipt(account2, onConfirmed) {
    if (!/^ynx1[0-9a-z]{38}$/.test(account2) || this.productProof === null || this.productAccount !== account2) throw new Error("Verified current Social account binding is required; legacy local erasure is not confirmed");
    const generation = this.epoch;
    const result = await this.deleteAccount(onConfirmed);
    if (this.epoch !== generation + 1) throw new Error("Social authorization changed; deletion cleanup discarded");
    return Object.freeze({ account: account2, result, current: this.authorizationGuard() });
  }
  aiBegin(body) {
    return this.request("/social/v1/ai/jobs", { method: "POST", body });
  }
  aiTransition(id2, action, output = "") {
    return this.request(`/social/v1/ai/jobs/${encodeURIComponent(id2)}`, { method: "POST", body: { action, output } });
  }
  async streamAI(id2, contextText, onToken, signal) {
    if (!this.token) throw new Error("Social session is locked");
    const response = await fetch(`${this.base}/social/v1/ai/jobs/${encodeURIComponent(id2)}/stream`, { method: "POST", headers: { Accept: "text/event-stream", "Content-Type": "application/json", Authorization: `Bearer ${this.token}` }, body: JSON.stringify({ contextText }), signal });
    if (!response.ok) throw new Error(`Social AI stream failed (${response.status})`);
    if (!response.body) throw new Error("Streaming is unavailable on this device");
    const reader = response.body.getReader(), decoder = new TextDecoder(), lines = [];
    let buffer = "", event = "", doneJob;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const raw of parts) {
        const line = raw.trimEnd();
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          lines.push({ event, data });
          if (event === "token") {
            const value = JSON.parse(data);
            if (value.text) onToken(value.text);
          } else if (event === "error") {
            const value = JSON.parse(data);
            throw new Error(value.error ?? "AI provider unavailable");
          } else if (event === "done") {
            const value = JSON.parse(data);
            doneJob = value.record;
          }
        }
      }
    }
    if (!doneJob) throw new Error("AI stream ended before review state");
    return doneJob;
  }
  async request(path2, options = {}) {
    if (options.signal?.aborted) throw new Error("Original Social operation cancelled; intent retained");
    const epoch = this.epoch, headers = { Accept: "application/json", ...options.headers };
    if (options.body !== void 0) headers["Content-Type"] = "application/json";
    if (options.auth !== false) {
      if (this.productProof) {
        const proofOwner = this.productProof;
        const relative = path2.split("?")[0].replace("/social/v1/", "");
        const scope2 = relative.startsWith("conversations") || relative.startsWith("devices/") ? "social.messaging" : /^(contacts?|privacy\/|invites?|notifications?)/.test(relative) ? "social.contacts" : "social.profile";
        if (/^(feed|media|reports?|follows?|ai\/)/.test(relative)) throw new Error("This action requires a separately supported permission");
        const proof = options.proof ?? await proofOwner([scope2]).catch(() => {
          if (options.signal?.aborted) throw new Error("Original Social operation cancelled; intent retained");
          if (epoch === this.epoch && proofOwner === this.productProof) this.setToken(null);
          throw new SocialAPIError("Wallet permission could not be verified; restore explicitly", 401);
        });
        if (options.signal?.aborted) throw new Error("Original Social operation cancelled; intent retained");
        if (epoch !== this.epoch || proofOwner !== this.productProof) throw new SocialAPIError("Social authorization changed; old permission discarded", 401);
        if (proof.proof.account !== this.productAccount) {
          this.setToken(null);
          throw new SocialAPIError("Social account changed; reconnect explicitly", 401);
        }
        headers["X-YNX-Product-Session-Proof-V2"] = proof.proofHeader;
        if (this.csrf) headers["X-YNX-SSO-CSRF"] = this.csrf;
      } else {
        if (!this.token) throw new Error("Social session is locked");
        headers.Authorization = `Bearer ${this.token}`;
      }
    }
    const response = await fetch(`${this.base}${path2}`, { method: options.method ?? "GET", headers, credentials: this.csrf ? "same-origin" : "omit", redirect: "error", cache: "no-store", signal: options.signal, body: options.body === void 0 ? void 0 : JSON.stringify(options.body) });
    const data = await response.json().catch(() => ({ error: "Invalid server response" }));
    if (options.signal?.aborted) throw new Error("Original Social operation cancelled; intent retained");
    if (epoch !== this.epoch) throw new Error("Social authorization changed; response discarded");
    if (!response.ok) {
      if (this.productProof && (response.status === 401 || response.status === 403)) this.setToken(null);
      throw new SocialAPIError(typeof data?.error === "string" ? data.error : `Social request failed (${response.status})`, response.status);
    }
    return data;
  }
};

// ../src/durableOutbox.ts
var slots = ["a", "b"];
function checksum(generation, payload) {
  return bytesToHex3(sha2562(utf8ToBytes2(`ynx-social-outbox-v2
${generation}
${payload}`)));
}
function parse(raw) {
  if (raw === null || raw.length > 8 * 1024 * 1024) return null;
  try {
    const value = JSON.parse(raw);
    if (value.version !== 1 || !Number.isSafeInteger(value.generation) || value.generation < 1 || typeof value.payload !== "string" || value.checksum !== checksum(value.generation, value.payload)) return null;
    readOutbox(value.payload);
    return value;
  } catch {
    return null;
  }
}
var DurableOutbox = class {
  constructor(storage) {
    this.storage = storage;
  }
  storage;
  current() {
    const raw = slots.map((slot) => this.storage.read(slot));
    const valid = raw.map((value, index) => ({ value: parse(value), slot: slots[index] })).filter((item) => item.value !== null).sort((left, right) => right.value.generation - left.value.generation);
    if (valid.length === 0 && raw.some((value) => value !== null)) {
      throw new Error("Pending message snapshots are damaged. Existing files were preserved.");
    }
    return valid[0] ?? null;
  }
  read() {
    const current = this.current();
    return readOutbox(current ? current.value.payload : this.storage.read("legacy"));
  }
  update(change) {
    const current = this.current();
    const entries = readOutbox(current ? current.value.payload : this.storage.read("legacy"));
    const next = change(entries), payload = JSON.stringify(next);
    readOutbox(payload);
    for (const account2 of new Set(next.map((entry) => entry.account))) {
      if (!/^ynx1[0-9a-z]{38}$/.test(account2)) continue;
      const key = `index.${account2}`, raw = this.storage.read(key);
      if (raw !== null) {
        const index = JSON.parse(raw);
        if (index.version !== 1 || index.account !== account2 || typeof index.deleted !== "boolean") throw new Error("Pending account index requires recovery");
        if (index.deleted) throw new Error("Deleted account pending messages require explicit recovery");
      }
      this.storage.write(key, JSON.stringify({ version: 1, account: account2, deleted: false }));
    }
    const generation = (current?.value.generation ?? 0) + 1;
    if (!Number.isSafeInteger(generation)) throw new Error("Pending message generation limit reached");
    const slot = current?.slot === "a" ? "b" : "a";
    this.storage.write(slot, JSON.stringify({ version: 1, generation, payload, checksum: checksum(generation, payload) }));
    return next;
  }
  clear() {
    this.update(() => []);
    this.update(() => []);
    this.storage.remove("legacy");
  }
  clearAccount(account2, current) {
    if (!/^ynx1[0-9a-z]{38}$/.test(account2)) throw new Error("Original outbox account is required");
    const check = () => {
      if (!current()) throw new Error("Outbox cleanup stopped after authorization changed");
    };
    check();
    this.update((entries) => entries.filter((entry) => entry.account !== account2));
    check();
    this.update((entries) => entries.filter((entry) => entry.account !== account2));
    check();
    this.storage.write(`index.${account2}`, JSON.stringify({ version: 1, account: account2, deleted: true }));
  }
};

// contact-review.mjs
function reviewContact(document2, preview, isCurrent, onMessage = () => {
}) {
  return new Promise((resolve) => {
    const dialog = document2.createElement("dialog");
    dialog.className = "contact-review";
    const heading = document2.createElement("h3");
    heading.textContent = "Send a contact request?";
    const name = document2.createElement("p");
    name.textContent = `${preview.person.displayName} @${preview.person.handle}`;
    const note = document2.createElement("p");
    note.textContent = "This person must accept before you become contacts. This preview does not verify their encryption keys.";
    const label = document2.createElement("label");
    label.textContent = "Optional request message (200 characters)";
    const message = document2.createElement("textarea");
    message.maxLength = 400;
    message.rows = 3;
    message.name = "contact-message";
    message.addEventListener("input", () => {
      message.value = Array.from(message.value).slice(0, 200).join("");
    });
    label.append(message);
    const cancel = document2.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.autofocus = true;
    const send = document2.createElement("button");
    send.type = "button";
    send.textContent = "Send request";
    let settled = false;
    function finish(approved) {
      if (settled) return;
      settled = true;
      const accepted = approved && isCurrent();
      if (accepted) onMessage(message.value.trim());
      dialog.close();
      dialog.remove();
      resolve(accepted);
    }
    cancel.addEventListener("click", () => finish(false));
    send.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener("close", () => finish(false));
    dialog.append(heading, name, note, label, cancel, send);
    document2.body.append(dialog);
    if (!isCurrent()) {
      finish(false);
      return;
    }
    dialog.showModal();
    cancel.focus();
  });
}

// discovery-entry.mjs
function discoveryEntry(value) {
  if (typeof value !== "string" || value.length > 256) throw new Error("Use an original Social personal QR or invitation link.");
  const match = /^https:\/\/social\.ynxweb4\.com\/(people\/(sp_[A-Za-z0-9_-]{32})|invite\/([A-Za-z0-9_-]{32}))$/.exec(value);
  if (!match) throw new Error("Use an original Social personal QR or invitation link. Wallet, Pair and payment codes are not contact requests.");
  return Object.freeze({ source: match[2] ? "qr" : "invite", value, personId: match[2] ?? null });
}

// contact-camera.mjs
function release(stream) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}
var CameraQRSession = class {
  constructor(options) {
    this.options = options;
    this.epoch = 0;
    this.stream = null;
    this.frameId = null;
  }
  stop() {
    this.epoch++;
    if (this.frameId !== null) this.options.cancel(this.frameId);
    this.frameId = null;
    release(this.stream);
    this.stream = null;
    this.options.detach();
  }
  async start() {
    this.stop();
    const epoch = this.epoch;
    try {
      if (!this.options.isCurrent()) return;
      const detector = await this.options.detector();
      if (epoch !== this.epoch || !this.options.isCurrent()) return;
      this.options.status("Allow camera access to scan a personal Social QR.");
      const stream = await this.options.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } });
      if (epoch !== this.epoch || !this.options.isCurrent()) {
        release(stream);
        return;
      }
      this.stream = stream;
      await this.options.attach(stream);
      if (epoch !== this.epoch) return;
      if (!this.options.isCurrent()) {
        this.stop();
        return;
      }
      this.options.status("Point the camera at the personal Social QR.");
      this.queue(epoch, detector);
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.stop();
      this.options.status(error?.name === "NotAllowedError" ? "Camera access was denied. Allow it in browser settings, then retry." : error?.name === "NotFoundError" ? "No camera was found. Connect a camera or use QR content." : error?.name === "NotSupportedError" ? "QR scanning is unavailable in this browser. Use QR content or an invitation link." : "Camera scanning could not start. Retry or cancel.");
    }
  }
  queue(epoch, detector) {
    this.frameId = this.options.schedule(() => this.frame(epoch, detector));
  }
  async frame(epoch, detector) {
    if (epoch !== this.epoch) return;
    this.frameId = null;
    if (!this.options.isCurrent()) {
      this.stop();
      return;
    }
    try {
      const codes = await detector.detect(this.options.video);
      if (epoch !== this.epoch) return;
      if (!this.options.isCurrent()) {
        this.stop();
        return;
      }
      const value = codes.find((code) => typeof code.rawValue === "string" && code.rawValue.length > 0 && code.rawValue.length <= 2048)?.rawValue;
      if (value) {
        try {
          discoveryEntry(value);
        } catch (error) {
          this.options.status(error.message);
          this.queue(epoch, detector);
          return;
        }
        this.stop();
        this.options.result(value);
        return;
      }
      this.queue(epoch, detector);
    } catch {
      if (epoch !== this.epoch) return;
      this.stop();
      this.options.status("The QR could not be read. Retry or use QR content.");
    }
  }
};
function scanContactQR(document2, environment, isCurrent) {
  return new Promise((resolve) => {
    const dialog = document2.createElement("dialog"), heading = document2.createElement("h3"), video = document2.createElement("video"), status2 = document2.createElement("p"), retry = document2.createElement("button"), cancel = document2.createElement("button");
    dialog.className = "contact-camera";
    heading.textContent = "Scan a personal Social QR";
    video.muted = true;
    video.playsInline = true;
    video.style.width = "100%";
    video.style.maxWidth = "32rem";
    video.style.maxHeight = "50vh";
    video.setAttribute("aria-label", "Local camera preview");
    status2.setAttribute("role", "status");
    retry.type = "button";
    retry.textContent = "Retry camera";
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.autofocus = true;
    let settled = false;
    const scanner = new CameraQRSession({
      mediaDevices: environment.navigator.mediaDevices,
      video,
      isCurrent: () => !settled && isCurrent(),
      detector: async () => {
        if (!environment.isSecureContext || !environment.navigator.mediaDevices?.getUserMedia || !environment.BarcodeDetector) throw new DOMException("QR scanning unavailable", "NotSupportedError");
        return new environment.BarcodeDetector({ formats: ["qr_code"] });
      },
      attach: async (stream) => {
        video.srcObject = stream;
        await video.play();
      },
      detach: () => {
        video.pause();
        video.srcObject = null;
      },
      schedule: (callback2) => environment.requestAnimationFrame(callback2),
      cancel: (id2) => environment.cancelAnimationFrame(id2),
      status: (text3) => {
        status2.textContent = text3;
      },
      result: (value) => finish(value)
    });
    function finish(value) {
      if (settled) return;
      const current = isCurrent();
      settled = true;
      scanner.stop();
      document2.removeEventListener("visibilitychange", hidden);
      environment.removeEventListener("pagehide", leave);
      dialog.close();
      dialog.remove();
      resolve(current ? value : null);
    }
    function hidden() {
      if (document2.visibilityState === "hidden") finish(null);
    }
    function leave() {
      finish(null);
    }
    retry.addEventListener("click", () => void scanner.start());
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.addEventListener("close", () => finish(null));
    document2.addEventListener("visibilitychange", hidden);
    environment.addEventListener("pagehide", leave);
    dialog.append(heading, video, status2, retry, cancel);
    document2.body.append(dialog);
    if (!isCurrent()) {
      finish(null);
      return;
    }
    dialog.showModal();
    cancel.focus();
    void scanner.start();
  });
}

// contact-retry.mjs
var ContactRetry = class {
  constructor(workspace2, publish = () => {
  }) {
    this.workspace = workspace2;
    this.publish = publish;
    this.pending = null;
    this.archived = [];
    this.running = null;
  }
  get current() {
    this.archived = this.archived.filter((intent) => intent.guard());
    if (this.pending && !this.pending.guard()) {
      this.pending = null;
      this.archived = [];
      this.publish();
      return null;
    }
    if (this.pending && this.running !== this.pending && !this.workspace.isContactPreviewCurrent(this.pending.preview)) {
      this.archived.push(this.pending);
      this.pending = null;
      this.publish();
      return null;
    }
    return this.pending;
  }
  retain(preview, message) {
    if (!this.workspace.isContactPreviewCurrent(preview)) throw new Error("Review this person again before sending");
    const prior = this.current;
    if (prior) this.archived.push(prior);
    this.pending = Object.freeze({ preview, message: message.trim(), guard: this.workspace.contactContextGuard() });
    this.publish();
  }
  reviewAgain() {
    const current = this.current;
    if (current) {
      this.archived.push(current);
      this.workspace.cancelContactPreview(current.preview);
    }
    this.pending = null;
    this.publish();
  }
  async attempt() {
    const intent = this.current;
    if (!intent) throw new Error("No current reviewed request is available to retry");
    if (this.running === intent) throw new Error("This exact request is already being sent");
    this.running = intent;
    this.publish();
    try {
      await this.workspace.confirmContact(intent.preview, intent.message);
      if (this.pending === intent) this.pending = null;
    } finally {
      if (this.running === intent) this.running = null;
      this.publish();
    }
  }
};

// contact-action.mjs
var actions = {
  remove: { title: "Remove this contact?", approve: "Remove contact", body: "Your independent following relationship and original encrypted history are retained. New contact-only access is no longer granted. Downloaded copies cannot be recalled." },
  block: { title: "Block this person?", approve: "Block person", body: "This removes the contact relationship and closes pending requests. New requests and contact-only access are blocked. Original encrypted history and downloaded copies are not erased." },
  mute: { title: "Mute this person?", approve: "Mute notifications", body: "Only notification preferences change. Your contact and following relationships are retained." },
  unmute: { title: "Unmute this person?", approve: "Unmute notifications", body: "Restore notifications without changing your contact or following relationship." }
};
function reviewContactAction(document2, person, action, isCurrent) {
  const copy = actions[action];
  if (!copy || !isCurrent()) return Promise.resolve(false);
  return new Promise((resolve) => {
    const dialog = document2.createElement("dialog");
    dialog.className = "contact-review";
    const title = document2.createElement("h2"), profile = document2.createElement("p"), description = document2.createElement("p"), cancel = document2.createElement("button"), approve = document2.createElement("button");
    title.textContent = copy.title;
    profile.textContent = person.displayName + " @" + person.handle;
    description.textContent = copy.body;
    cancel.type = approve.type = "button";
    cancel.textContent = "Cancel";
    approve.textContent = copy.approve;
    let done = false;
    const finish = (accepted) => {
      if (done) return;
      done = true;
      document2.removeEventListener("ynx-social-private-locked", locked);
      dialog.close();
      dialog.remove();
      resolve(accepted && isCurrent());
    };
    const locked = () => finish(false);
    document2.addEventListener("ynx-social-private-locked", locked);
    cancel.onclick = () => finish(false);
    approve.onclick = () => finish(true);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener("close", () => finish(false));
    dialog.append(title, profile, description, cancel, approve);
    document2.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

// profile-share.mjs
var import_browser = __toESM(require_browser(), 1);
function profileLocator(profile) {
  if (!/^sp_[A-Za-z0-9_-]{32}$/.test(profile?.id)) throw new Error("Your existing Social profile identifier is required. No wallet address or replacement identity is shared.");
  const locator = "https://social.ynxweb4.com/people/" + profile.id;
  if (profile.privacy?.profileQrPayload && profile.privacy.profileQrPayload !== locator) throw new Error("Your saved personal code does not match the original Social profile.");
  return locator;
}
function createProfileShare(container, { encode: encode2 = (value) => import_browser.default.toDataURL(value, { errorCorrectionLevel: "M", width: 240, margin: 4, color: { dark: "#002FA7", light: "#FFFFFF" } }) } = {}) {
  const document2 = container.ownerDocument, image = document2.createElement("img"), link = document2.createElement("input"), copy = document2.createElement("button"), status2 = document2.createElement("p"), note = document2.createElement("p");
  image.width = image.height = 240;
  image.alt = "Your YNX Social personal discovery QR code";
  image.hidden = true;
  link.readOnly = true;
  link.setAttribute("aria-label", "Your personal Social link");
  copy.type = "button";
  copy.textContent = "Copy my personal link";
  copy.disabled = true;
  status2.setAttribute("role", "status");
  note.textContent = "This code shares your public profile only. The other person must review a request and you must accept. It does not add a friend, follow anyone or verify encryption keys.";
  container.append(image, link, copy, status2, note);
  let revision = 0, current = null;
  const active = (value) => current === value && value.revision === revision && value.guard();
  copy.onclick = async () => {
    const value = current;
    if (!value || !active(value)) return;
    try {
      await globalThis.navigator.clipboard.writeText(value.locator);
      if (active(value)) status2.textContent = "Personal link copied.";
    } catch {
      if (active(value)) status2.textContent = "Clipboard access is unavailable. Your verified personal link is shown above.";
    }
  };
  return Object.freeze({
    async show(profile, guard = () => true) {
      const version = ++revision;
      current = null;
      image.hidden = true;
      image.removeAttribute("src");
      link.value = "";
      copy.disabled = true;
      status2.textContent = "";
      if (!profile || !guard()) return;
      let locator;
      try {
        locator = profileLocator(profile);
      } catch (error) {
        if (version === revision && guard()) status2.textContent = error.message;
        return;
      }
      const value = { revision: version, locator, guard };
      current = value;
      link.value = locator;
      status2.textContent = "Preparing your personal discovery code.";
      try {
        const encoded = await encode2(locator);
        if (!active(value)) return;
        if (typeof encoded !== "string" || !encoded.startsWith("data:image/png;base64,")) throw new Error("Personal QR rendering was not confirmed.");
        image.src = encoded;
        image.hidden = false;
        copy.disabled = false;
        status2.textContent = "Share only with people you choose.";
      } catch (error) {
        if (active(value)) status2.textContent = error.message || "Personal QR is unavailable; the original profile is unchanged.";
      }
    }
  });
}

// private-session-ui.js
var privateSession = createSocialPrivateSession();
var chatSession = createSocialPrivateSession({ scopes: SOCIAL_CHAT_SCOPES });
var byId = (id2) => document.getElementById(id2);
var status = byId("private-auth-status");
var account = byId("private-auth-account");
var openWallet = byId("private-auth-open");
var buttons = ["private-auth-begin", "private-auth-restore", "private-auth-disconnect"].map(byId);
var chatOpen = byId("chat-open-wallet");
var workspaceStatus = byId("workspace-status");
var intentKey = "ynx.social.request.intent.v2";
var contactRetry;
var workspaceWorkCount = 0;
var outbox = new DurableOutbox({ read: (slot) => localStorage.getItem(`ynx.social.web.outbox.v2.${slot}`), write: (slot, value) => localStorage.setItem(`ynx.social.web.outbox.v2.${slot}`, value), remove: (slot) => localStorage.removeItem(`ynx.social.web.outbox.v2.${slot}`) });
var identity = async () => {
  const response = await fetch("/sso/account", { credentials: "same-origin", cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error("Sign in with YNX identity first");
  const result = await response.json();
  if (!result.signedIn || typeof result.account !== "string" || typeof result.csrfToken !== "string") throw new Error("No verified shared identity");
  return result;
};
var profileShare = createProfileShare(byId("profile-share-panel"));
var workspace = new SocialWorkspace(chatSession, new SocialAPI(location.origin), browserChatDevices(), outbox, identity, (view) => {
  workspaceStatus.textContent = view.status;
  if (!view.account) document.dispatchEvent(new CustomEvent("ynx-social-private-locked"));
  synchronizeContactRetry();
  if (view.account) localStorage.setItem("ynx.social.web.workspace.approved.v2", "yes");
  byId("workspace-content").hidden = !view.account;
  byId("workspace-account").textContent = view.account ? `Private account: ${view.account}` : "";
  const profile = byId("profile-form");
  for (const key of ["handle", "displayName", "bio"]) profile.elements.namedItem(key).value = view.profile?.[key] ?? "";
  void profileShare.show(view.profile, () => workspace.current.account === view.account && workspace.current.profile?.id === view.profile?.id);
  const privacy = byId("privacy-form");
  privacy.querySelector("fieldset").disabled = !view.settings;
  for (const key of ["discoverableByHandle", "contactsMatching", "allowRecommendations"]) privacy.elements.namedItem(key).checked = view.settings?.[key] ?? false;
  privacy.elements.namedItem("allowRequestsFrom").value = view.settings?.allowRequestsFrom ?? "everyone";
  byId("create-invite").textContent = view.invitationPending ? "Retry my original invitation" : "Create or retry my invitation";
  const invitations = byId("invitation-list");
  invitations.replaceChildren();
  for (const record of view.invitations ?? []) {
    const item = document.createElement("li"), text3 = document.createElement("p"), link = document.createElement("input");
    text3.textContent = `${record.status} \xB7 Expires ${record.expiresAt}`;
    link.readOnly = true;
    link.value = record.link;
    link.setAttribute("aria-label", "Your original invitation link");
    item.append(text3, link);
    if (record.status === "active") {
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.textContent = "Revoke invitation";
      revoke.onclick = () => void work(async () => {
        const guard = workspace.contactContextGuard();
        if (!await reviewInvitation(record, guard)) return;
        await workspace.revokeInvitation(record.id);
      });
      item.append(revoke);
    }
    invitations.append(item);
  }
  byId("contact-request-form").querySelector("button").disabled = !view.profile;
  const contacts = byId("contact-list");
  contacts.replaceChildren();
  for (const person of view.contacts ?? []) {
    const li = document.createElement("li"), button = document.createElement("button");
    li.append(document.createTextNode(`${person.displayName} @${person.handle} `));
    button.type = "button";
    button.textContent = "Message";
    button.addEventListener("click", () => {
      const chat = byId("matrix-social-workspace");
      chat.scrollIntoView({ behavior: "smooth", block: "start" });
      document.dispatchEvent(new CustomEvent("ynx-social-open-contact", { detail: { account: view.account, personId: person.id } }));
      chat.querySelector("[data-connect]").focus();
    });
    li.append(button);
    const options = document.createElement("details"), summary = document.createElement("summary");
    summary.textContent = "Contact controls";
    options.append(summary);
    for (const [action, label] of [["remove", "Remove contact"], ["block", "Block person"], ["mute", "Mute notifications"], ["unmute", "Unmute notifications"]]) {
      const control = document.createElement("button");
      control.type = "button";
      control.textContent = label;
      control.addEventListener("click", () => void work(async () => {
        const current = workspace.contactContextGuard();
        if (!await reviewContactAction(document, person, action, () => current() && workspace.current.contacts?.some((item) => item.id === person.id))) return;
        await workspace.changeContact(person.id, action);
        if (action === "remove" || action === "block") document.dispatchEvent(new CustomEvent("ynx-social-contact-removed", { detail: { account: view.account, personId: person.id } }));
      }));
      options.append(control);
    }
    li.append(options);
    contacts.append(li);
  }
  const requests = byId("contact-request-list");
  requests.replaceChildren();
  for (const request of view.requests ?? []) {
    const li = document.createElement("li");
    li.append(document.createTextNode(`${request.direction === "incoming" ? "From" : "To"} @${request.person.handle}: ${request.status} `));
    if (request.message) {
      const note = document.createElement("p");
      note.textContent = request.message;
      li.append(note);
    }
    if (request.status === "pending") {
      for (const action of request.direction === "incoming" ? ["accept", "reject"] : ["withdraw"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = action[0].toUpperCase() + action.slice(1);
        button.addEventListener("click", () => void work(() => workspace.transitionContact(request.id, action)));
        li.append(button);
      }
    }
    requests.append(li);
  }
  const conversations = byId("conversation-list");
  conversations.replaceChildren();
  for (const item of view.conversations ?? []) {
    const li = document.createElement("li"), button = document.createElement("button");
    button.type = "button";
    button.textContent = item.title || item.handle || "Conversation";
    button.addEventListener("click", () => void work(() => workspace.select(item.id)));
    li.append(button);
    conversations.append(li);
  }
  const messages = byId("message-list");
  messages.replaceChildren();
  for (const item of view.messages ?? []) {
    const li = document.createElement("li");
    li.textContent = `${item.record.sender === view.account ? "You" : "Participant"}: ${item.plaintext}`;
    messages.append(li);
  }
  byId("conversation-title").textContent = view.conversationId ? "Encrypted conversation" : "Choose a conversation";
}, void 0, indexedDBInvitationIntents());
var retryBox = document.createElement("section");
var retryNote = document.createElement("p");
var retryButton = document.createElement("button");
var reviewAgain = document.createElement("button");
retryBox.hidden = true;
retryBox.setAttribute("aria-live", "polite");
retryButton.type = "button";
retryButton.textContent = "Retry exact request";
reviewAgain.type = "button";
reviewAgain.textContent = "Review another request";
retryBox.append(retryNote, retryButton, reviewAgain);
byId("contact-request-form").append(retryBox);
contactRetry = new ContactRetry(workspace, synchronizeContactRetry);
function synchronizeContactRetry() {
  if (!contactRetry) return;
  const intent = contactRetry.current;
  retryBox.hidden = !intent;
  byId("contact-request-form").querySelector('button[type="submit"]').textContent = intent ? "Retry reviewed request" : "Preview person";
  if (!intent) return;
  retryNote.textContent = `Request outcome not confirmed: ${intent.preview.person.displayName} @${intent.preview.person.handle}. Original message: ${intent.message || "(no message)"}. Retry keeps the same target and request identity; editing does not undo an already sent request.`;
  retryButton.disabled = workspaceWorkCount > 0 || contactRetry.running === intent;
  reviewAgain.disabled = workspaceWorkCount > 0;
}
async function sendReviewedContact(preview, message) {
  contactRetry.retain(preview, message);
  await contactRetry.attempt();
}
retryButton.addEventListener("click", () => void work(() => contactRetry.attempt()));
reviewAgain.addEventListener("click", () => {
  contactRetry.reviewAgain();
  workspaceStatus.textContent = "Review a new request. The original request may already have reached the person.";
});
byId("contact-request-form").addEventListener("input", (event) => {
  if (event.target.name === "handle" || event.target.name === "source") contactRetry.reviewAgain();
});
byId("contact-request-form").addEventListener("change", (event) => {
  if (event.target.name === "source") contactRetry.reviewAgain();
});
function showRoute(anchor, result) {
  anchor.hidden = true;
  anchor.removeAttribute("href");
  if (result.route?.status === "ready") {
    const url2 = new URL(result.route.url);
    if (url2.protocol !== "ynxwallet:" || url2.hostname !== "authorize") throw new Error("Unexpected Wallet launch route");
    anchor.href = url2.href;
    anchor.hidden = false;
  }
}
function render(result) {
  showRoute(openWallet, result);
  account.textContent = result.status === "connected" ? `Signed in: ${result.session.account}` : "Sign in to keep your private workspace together.";
  status.textContent = result.status === "connected" ? "You are signed in. Allow Social contacts and chat separately when you are ready." : result.message || `Private session: ${result.status}`;
}
async function perform(action) {
  for (const button of buttons) button.disabled = true;
  try {
    render(await action());
  } catch (error) {
    account.textContent = "Private identity could not be confirmed.";
    showRoute(openWallet, {});
    status.textContent = error.message || "Private identity needs Retry. Standard wallet connection is unchanged.";
  } finally {
    for (const button of buttons) button.disabled = false;
  }
}
async function work(action) {
  const originalContext = workspace.current.account ? workspace.contactContextGuard() : null;
  workspaceWorkCount++;
  const controls = [...byId("social-workspace").querySelectorAll("button")];
  for (const button of controls) button.disabled = true;
  try {
    return await action();
  } catch (error) {
    if (originalContext && !originalContext()) return;
    if (error.status === 401 || error.status === 403) workspace.lock("Private permission is no longer verified; existing keys and ciphertext retained.");
    if (error.code === "CHAT_DEVICE_PROTECTION_REQUIRED") byId("protect-chat-device").hidden = false;
    workspaceStatus.textContent = error.message || "Private operation unavailable; existing ciphertext retained.";
  } finally {
    workspaceWorkCount--;
    for (const button of controls) button.disabled = workspaceWorkCount > 0;
    byId("contact-request-form").querySelector("button").disabled = workspaceWorkCount > 0 || !workspace.current.profile;
    synchronizeContactRetry();
  }
}
buttons[0].addEventListener("click", () => void perform(async () => {
  const result = await privateSession.begin();
  localStorage.setItem(intentKey, "identity");
  return result;
}));
buttons[1].addEventListener("click", () => void perform(() => privateSession.restore()));
buttons[2].addEventListener("click", () => void perform(() => privateSession.disconnect()));
byId("chat-authorize").addEventListener("click", () => void work(async () => {
  await identity();
  const result = await workspace.authorize();
  if (result.status === "connected") {
    await workspace.restore();
    return;
  }
  localStorage.setItem(intentKey, "chat");
  showRoute(chatOpen, result);
  workspaceStatus.textContent = result.message || "Approve the exact profile, contacts and chat scopes in Wallet when ready. Nothing opens automatically.";
}));
byId("chat-restore").addEventListener("click", () => void work(() => workspace.restore()));
byId("chat-logout").addEventListener("click", () => void work(async () => {
  workspace.lock("Signed out locally. Revocation is pending.");
  showRoute(chatOpen, {});
  const shared = await identity().catch(() => null);
  const revoked = await Promise.allSettled([workspace.logout(), privateSession.disconnect()]);
  if (revoked[1].status === "fulfilled") render(revoked[1].value);
  if (shared) {
    const response = await fetch("/sso/logout", { method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store", headers: { "X-YNX-SSO-CSRF": shared.csrfToken } });
    if (!response.ok) throw new Error("Shared identity revocation is pending. Private access remains locked.");
  }
  if (revoked.some((result) => result.status === "rejected") || revoked[1].value?.status !== "disconnected") throw new Error("Wallet revocation is pending. Keys and ciphertext were retained.");
  workspace.lock(shared ? "Private workspace and shared identity signed out. Keys and pending ciphertext retained." : "Social permission revoked; shared identity sign-out could not be confirmed. Private access remains locked.");
}));
byId("workspace-refresh").addEventListener("click", () => void work(() => workspace.refresh()));
byId("protect-chat-device").addEventListener("click", () => {
  const confirmed = confirm("Protect this browser's existing Social chat device? The exact old keys are encrypted and read back before its old cleartext carrier is removed. Messages and pending ciphertext are preserved. No key import or administrator credential is required.");
  if (confirmed) void work(async () => {
    await workspace.protectExistingDevice(true);
    byId("protect-chat-device").hidden = true;
  });
});
byId("contact-request-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget, data = new FormData(form), source = String(data.get("source") || "handle"), value = String(data.get("handle"));
  void work(async () => {
    if (contactRetry.current) {
      await contactRetry.attempt();
      form.reset();
      return;
    }
    const preview = await workspace.previewContact(source, value);
    let message = "";
    const approved = await reviewContact(document, preview, () => workspace.isContactPreviewCurrent(preview), (value2) => {
      message = value2;
    });
    if (!approved) {
      workspace.cancelContactPreview(preview);
      return;
    }
    await sendReviewedContact(preview, message);
    form.reset();
  });
});
byId("contact-scan-qr").addEventListener("click", () => void work(async () => {
  contactRetry.reviewAgain();
  const isCurrent = workspace.contactContextGuard(), value = await scanContactQR(document, globalThis, isCurrent);
  if (!value || !isCurrent()) return;
  const entry = discoveryEntry(value), preview = await workspace.previewContact(entry.source, entry.value);
  let message = "";
  const approved = await reviewContact(document, preview, () => workspace.isContactPreviewCurrent(preview), (value2) => {
    message = value2;
  });
  if (approved) await sendReviewedContact(preview, message);
  else workspace.cancelContactPreview(preview);
}));
byId("profile-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  void work(() => workspace.updateProfile({ handle: String(data.get("handle")), displayName: String(data.get("displayName")), bio: String(data.get("bio")) }));
});
byId("load-privacy").addEventListener("click", () => void work(() => workspace.loadPrivacy()));
byId("privacy-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  void work(() => workspace.savePrivacy({ discoverableByHandle: form.elements.namedItem("discoverableByHandle").checked, contactsMatching: form.elements.namedItem("contactsMatching").checked, allowRecommendations: form.elements.namedItem("allowRecommendations").checked, allowRequestsFrom: form.elements.namedItem("allowRequestsFrom").value }));
});
byId("load-invites").addEventListener("click", () => void work(() => workspace.loadInvitations()));
byId("create-invite").addEventListener("click", () => void work(() => workspace.createInvitation()));
function reviewInvitation(record, guard) {
  if (!guard()) return Promise.resolve(false);
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "contact-review";
    const heading = document.createElement("h2"), note = document.createElement("p"), cancel = document.createElement("button"), approve = document.createElement("button");
    heading.textContent = "Revoke this invitation?";
    note.textContent = "New profile discovery through this link will stop after the server confirms revocation. Existing contacts, following relationships and encrypted history are retained.";
    cancel.type = approve.type = "button";
    cancel.textContent = "Cancel";
    approve.textContent = "Revoke this invitation";
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      document.removeEventListener("ynx-social-private-locked", locked);
      dialog.close();
      dialog.remove();
      resolve(result && guard() && workspace.current.invitations?.some((item) => item.id === record.id && item.status === "active"));
    };
    const locked = () => finish(false);
    document.addEventListener("ynx-social-private-locked", locked);
    cancel.onclick = () => finish(false);
    approve.onclick = () => finish(true);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener("close", () => finish(false));
    dialog.append(heading, note, cancel, approve);
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}
byId("conversation-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  void work(() => workspace.createConversation(String(data.get("handle"))));
});
byId("message-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget, text3 = String(new FormData(form).get("message"));
  void work(async () => {
    await workspace.send(text3);
    form.reset();
  });
});
byId("message-retry").addEventListener("click", () => void work(() => workspace.retry()));
if (location.pathname === "/wallet-auth/callback") {
  if (localStorage.getItem(intentKey) === "chat") void work(async () => {
    await workspace.accept(location.href);
    history.replaceState(null, "", "/#conversations");
    localStorage.removeItem(intentKey);
  });
  else void perform(async () => {
    const result = await privateSession.handleReturn(location.href);
    history.replaceState(null, "", "/wallet-auth/callback");
    localStorage.removeItem(intentKey);
    return result;
  });
} else if (localStorage.getItem("ynx.social.web.workspace.approved.v2") === "yes") void work(() => workspace.restore());
byId("workspace-content").addEventListener("focusin", () => {
  if (workspace.current.account) localStorage.setItem("ynx.social.web.workspace.approved.v2", "yes");
});
addEventListener("storage", (event) => {
  if (event.key === "ynx.social.web.workspace.signedout.v2") workspace.lock("Another tab signed out; reconnect explicitly");
});
byId("chat-logout").addEventListener("click", () => {
  localStorage.removeItem("ynx.social.web.workspace.approved.v2");
  localStorage.setItem("ynx.social.web.workspace.signedout.v2", String(Date.now()));
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") workspace.lock("Private workspace hidden; restore retained permission when you return");
  else if (localStorage.getItem("ynx.social.web.workspace.approved.v2") === "yes") void work(() => workspace.restore());
});
/*! Bundled license information:

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
