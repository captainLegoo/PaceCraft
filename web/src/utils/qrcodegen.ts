/**
 * Lightweight standard QR Code generator library in TypeScript.
 * Adapted from Project Nayuki's open-source QR Code generator (MIT License).
 * https://www.nayuki.io/page/qr-code-generator-program
 */

export namespace qrcodegen {
  export class QrCode {
    public static encodeText(text: string, ecl: Ecc): QrCode {
      const segs: QrSegment[] = [QrSegment.makeBytes(new TextEncoder().encode(text))];
      return QrCode.encodeSegments(segs, ecl);
    }

    public static encodeSegments(
      segs: readonly QrSegment[],
      ecl: Ecc,
      minVersion: number = 1,
      maxVersion: number = 40,
      mask: number = -1,
      boostEcl: boolean = true
    ): QrCode {
      if (!(1 <= minVersion && minVersion <= maxVersion && maxVersion <= 40) || mask < -1 || mask > 7)
        throw new RangeError("Invalid value");

      let version: number;
      let dataUsedBits: number;
      for (version = minVersion; ; version++) {
        const dataCapacityBits: number = QrCode.getNumDataCodewords(version, ecl) * 8;
        const usedBits: number = QrSegment.getTotalBits(segs, version);
        if (usedBits <= dataCapacityBits) {
          dataUsedBits = usedBits;
          break;
        }
        if (version >= maxVersion) throw new RangeError("Data too long");
      }

      if (boostEcl) {
        for (const newEcl of [Ecc.MEDIUM, Ecc.QUARTILE, Ecc.HIGH]) {
          if (dataUsedBits <= QrCode.getNumDataCodewords(version, newEcl) * 8) ecl = newEcl;
        }
      }

      const bb: number[] = [];
      for (const seg of segs) {
        appendBits(seg.mode.modeBits, 4, bb);
        appendBits(seg.numChars, seg.mode.numCharCountBits(version), bb);
        for (const b of seg.getData()) bb.push(b);
      }

      const dataCapacityBits: number = QrCode.getNumDataCodewords(version, ecl) * 8;
      appendBits(0, Math.min(4, dataCapacityBits - bb.length), bb);
      appendBits(0, (8 - (bb.length % 8)) % 8, bb);

      for (let padByte = 0xec; bb.length < dataCapacityBits; padByte ^= 0xec ^ 0x11)
        appendBits(padByte, 8, bb);

      const dataCodewords: number[] = [];
      while (dataCodewords.length * 8 < bb.length) dataCodewords.push(0);
      bb.forEach((b: number, i: number) => (dataCodewords[i >>> 3] |= b << (7 - (i & 7))));

      return new QrCode(version, ecl, dataCodewords, mask);
    }

    public readonly size: number;
    public readonly mask: number;
    private readonly modules: boolean[][] = [];
    private readonly isFunction: boolean[][] = [];

    public constructor(
      public readonly version: number,
      public readonly errorCorrectionLevel: Ecc,
      dataCodewords: readonly number[],
      msk: number
    ) {
      if (version < 1 || version > 40) throw new RangeError("Version out of range");
      if (msk < -1 || msk > 7) throw new RangeError("Mask out of range");
      this.size = version * 4 + 17;

      const row: boolean[] = [];
      for (let i = 0; i < this.size; i++) row.push(false);
      for (let i = 0; i < this.size; i++) {
        this.modules.push(row.slice());
        this.isFunction.push(row.slice());
      }

      this.drawFunctionPatterns();
      const allCodewords: number[] = this.addEccAndInterleave(dataCodewords);
      this.drawCodewords(allCodewords);

      if (msk === -1) {
        let minPenalty = 1000000000;
        for (let i = 0; i < 8; i++) {
          this.applyMask(i);
          this.drawFormatBits(i);
          const penalty: number = this.getPenaltyScore();
          if (penalty < minPenalty) {
            minPenalty = penalty;
            msk = i;
          }
          this.applyMask(i);
        }
      }
      this.mask = msk;
      this.applyMask(msk);
      this.drawFormatBits(msk);
      this.isFunction = [];
    }

    public getModule(x: number, y: number): boolean {
      return 0 <= x && x < this.size && 0 <= y && y < this.size && this.modules[y][x];
    }

    private drawFunctionPatterns(): void {
      for (let i = 0; i < this.size; i++) {
        this.setFunctionModule(6, i, i % 2 === 0);
        this.setFunctionModule(i, 6, i % 2 === 0);
      }

      this.drawFinderPattern(3, 3);
      this.drawFinderPattern(this.size - 4, 3);
      this.drawFinderPattern(3, this.size - 4);

      const alignPatPos: number[] = this.getAlignmentPatternPositions();
      const numAlign: number = alignPatPos.length;
      for (let i = 0; i < numAlign; i++) {
        for (let j = 0; j < numAlign; j++) {
          if (
            !(
              (i === 0 && j === 0) ||
              (i === 0 && j === numAlign - 1) ||
              (i === numAlign - 1 && j === 0)
            )
          )
            this.drawAlignmentPattern(alignPatPos[i], alignPatPos[j]);
        }
      }

      this.drawFormatBits(0);
      this.drawVersion();
    }

    private drawFormatBits(mask: number): void {
      const data: number = (this.errorCorrectionLevel.formatBits << 3) | mask;
      let rem: number = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;

      for (let i = 0; i <= 5; i++) this.setFunctionModule(8, i, getBit(bits, i));
      this.setFunctionModule(8, 7, getBit(bits, 6));
      this.setFunctionModule(8, 8, getBit(bits, 7));
      this.setFunctionModule(7, 8, getBit(bits, 8));
      for (let i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, getBit(bits, i));

      for (let i = 0; i < 8; i++) this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
      for (let i = 8; i < 15; i++) this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
      this.setFunctionModule(8, this.size - 8, true);
    }

    private drawVersion(): void {
      if (this.version < 7) return;
      let rem: number = this.version;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits: number = (this.version << 12) | rem;

      for (let i = 0; i < 18; i++) {
        const color: boolean = getBit(bits, i);
        const a: number = this.size - 11 + (i % 3);
        const b: number = Math.floor(i / 3);
        this.setFunctionModule(a, b, color);
        this.setFunctionModule(b, a, color);
      }
    }

    private drawFinderPattern(x: number, y: number): void {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const dist: number = Math.max(Math.abs(dx), Math.abs(dy));
          const xx: number = x + dx;
          const yy: number = y + dy;
          if (0 <= xx && xx < this.size && 0 <= yy && yy < this.size)
            this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }

    private drawAlignmentPattern(x: number, y: number): void {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++)
          this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }

    private setFunctionModule(x: number, y: number, isDark: boolean): void {
      this.modules[y][x] = isDark;
      this.isFunction[y][x] = true;
    }

    private addEccAndInterleave(data: readonly number[]): number[] {
      const ver: number = this.version;
      const ecl: Ecc = this.errorCorrectionLevel;
      if (data.length !== QrCode.getNumDataCodewords(ver, ecl))
        throw new RangeError("Invalid argument");

      const numBlocks: number = QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
      const blockEccLen: number = QrCode.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver];
      const rawCodewords: number = Math.floor(QrCode.getNumRawDataModules(ver) / 8);
      const numShortBlocks: number = numBlocks - (rawCodewords % numBlocks);
      const shortBlockLen: number = Math.floor(rawCodewords / numBlocks);
      const shortDataLen: number = shortBlockLen - blockEccLen;

      const blocks: { dat: number[]; ecc: number[] }[] = [];
      const rsDiv: number[] = QrCode.reedSolomonComputeDivisor(blockEccLen);
      for (let i = 0, k = 0; i < numBlocks; i++) {
        const dat: number[] = data.slice(
          k,
          k + shortDataLen + (i >= numShortBlocks ? 1 : 0)
        );
        k += dat.length;
        const ecc: number[] = QrCode.reedSolomonComputeRemainder(dat, rsDiv);
        blocks.push({ dat, ecc });
      }

      const result: number[] = [];
      // 1. Interleave data codewords
      for (let col = 0; col < shortDataLen; col++) {
        for (let b = 0; b < numBlocks; b++) {
          result.push(blocks[b].dat[col]);
        }
      }
      for (let b = numShortBlocks; b < numBlocks; b++) {
        result.push(blocks[b].dat[shortDataLen]);
      }
      // 2. Interleave EC codewords
      for (let col = 0; col < blockEccLen; col++) {
        for (let b = 0; b < numBlocks; b++) {
          result.push(blocks[b].ecc[col]);
        }
      }
      return result;
    }

    private drawCodewords(data: readonly number[]): void {
      if (data.length !== Math.floor(QrCode.getNumRawDataModules(this.version) / 8))
        throw new RangeError("Invalid argument");
      let i: number = 0;

      for (let right = this.size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < this.size; vert++) {
          for (let j = 0; j < 2; j++) {
            const x: number = right - j;
            const upward: boolean = ((right + 1) & 2) === 0;
            const y: number = upward ? this.size - 1 - vert : vert;
            if (!this.isFunction[y][x] && i < data.length * 8) {
              this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
              i++;
            }
          }
        }
      }
    }

    private applyMask(mask: number): void {
      if (mask < 0 || mask > 7) throw new RangeError("Mask out of range");
      for (let y = 0; y < this.size; y++) {
        for (let x = 0; x < this.size; x++) {
          let invert: boolean;
          switch (mask) {
            case 0:
              invert = (x + y) % 2 === 0;
              break;
            case 1:
              invert = y % 2 === 0;
              break;
            case 2:
              invert = x % 3 === 0;
              break;
            case 3:
              invert = (x + y) % 3 === 0;
              break;
            case 4:
              invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
              break;
            case 5:
              invert = ((x * y) % 2) + ((x * y) % 3) === 0;
              break;
            case 6:
              invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
              break;
            case 7:
              invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
              break;
            default:
              throw new Error("Unreachable");
          }
          if (!this.isFunction[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
        }
      }
    }

    private getPenaltyScore(): number {
      let result: number = 0;
      for (let y = 0; y < this.size; y++) {
        let runColor = false;
        let runVal = 0;
        const runHistory = [0, 0, 0, 0, 0, 0, 0];
        for (let x = 0; x < this.size; x++) {
          if (this.modules[y][x] === runColor) {
            runVal++;
            if (runVal === 5) result += 3;
            else if (runVal > 5) result++;
          } else {
            this.finderPenaltyAddHistory(runVal, runHistory);
            if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * 40;
            runColor = this.modules[y][x];
            runVal = 1;
          }
        }
        result += this.finderPenaltyTerminateAndCount(runColor, runVal, runHistory) * 40;
      }
      for (let x = 0; x < this.size; x++) {
        let runColor = false;
        let runVal = 0;
        const runHistory = [0, 0, 0, 0, 0, 0, 0];
        for (let y = 0; y < this.size; y++) {
          if (this.modules[y][x] === runColor) {
            runVal++;
            if (runVal === 5) result += 3;
            else if (runVal > 5) result++;
          } else {
            this.finderPenaltyAddHistory(runVal, runHistory);
            if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * 40;
            runColor = this.modules[y][x];
            runVal = 1;
          }
        }
        result += this.finderPenaltyTerminateAndCount(runColor, runVal, runHistory) * 40;
      }

      for (let y = 0; y < this.size - 1; y++) {
        for (let x = 0; x < this.size - 1; x++) {
          const color: boolean = this.modules[y][x];
          if (
            color === this.modules[y][x + 1] &&
            color === this.modules[y + 1][x] &&
            color === this.modules[y + 1][x + 1]
          )
            result += 3;
        }
      }

      let total: number = 0;
      for (const row of this.modules)
        row.forEach((color: boolean) => {
          if (color) total++;
        });
      const k: number = Math.ceil(Math.abs((total * 20) / (this.size * this.size) - 10)) - 1;
      result += k * 10;
      return result;
    }

    private getAlignmentPatternPositions(): number[] {
      if (this.version === 1) return [];
      const numAlign: number = Math.floor(this.version / 7) + 2;
      const step: number =
        this.version === 32
          ? 26
          : Math.ceil((this.version * 4 + 4) / (numAlign * 2 - 2)) * 2;
      const result: number[] = [6];
      for (let pos = this.size - 7; result.length < numAlign; pos -= step)
        result.splice(1, 0, pos);
      return result;
    }

    private finderPenaltyCountPatterns(runHistory: readonly number[]): number {
      const n: number = runHistory[1];
      const core: boolean =
        n > 0 &&
        runHistory[2] === n &&
        runHistory[3] === n * 3 &&
        runHistory[4] === n &&
        runHistory[5] === n;
      return (
        (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) +
        (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0)
      );
    }

    private finderPenaltyTerminateAndCount(
      currentRunColor: boolean,
      currentRunLength: number,
      runHistory: number[]
    ): number {
      if (currentRunColor) {
        this.finderPenaltyAddHistory(currentRunLength, runHistory);
        currentRunLength = 0;
      }
      currentRunLength += this.size;
      this.finderPenaltyAddHistory(currentRunLength, runHistory);
      return this.finderPenaltyCountPatterns(runHistory);
    }

    private finderPenaltyAddHistory(currentRunLength: number, runHistory: number[]): void {
      if (runHistory[0] === 0) currentRunLength += this.size;
      runHistory.pop();
      runHistory.unshift(currentRunLength);
    }

    private static getNumRawDataModules(ver: number): number {
      if (ver < 1 || ver > 40) throw new RangeError("Version out of range");
      let result: number = (16 * ver + 128) * ver + 64;
      if (ver >= 2) {
        const numAlign: number = Math.floor(ver / 7) + 2;
        result -= (25 * numAlign - 10) * numAlign - 55;
        if (ver >= 7) result -= 36;
      }
      return result;
    }

    private static getNumDataCodewords(ver: number, ecl: Ecc): number {
      return (
        Math.floor(QrCode.getNumRawDataModules(ver) / 8) -
        QrCode.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver] *
          QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver]
      );
    }

    private static reedSolomonComputeDivisor(degree: number): number[] {
      if (degree < 1 || degree > 255) throw new RangeError("Segment too long");
      const result: number[] = [];
      for (let i = 0; i < degree - 1; i++) result.push(0);
      result.push(1);

      let root = 1;
      for (let i = 0; i < degree; i++) {
        for (let j = 0; j < result.length; j++) {
          result[j] = QrCode.reedSolomonMultiply(result[j], root);
          if (j + 1 < result.length) result[j] ^= result[j + 1];
        }
        root = QrCode.reedSolomonMultiply(root, 0x02);
      }
      return result;
    }

    private static reedSolomonComputeRemainder(data: readonly number[], divisor: readonly number[]): number[] {
      const result: number[] = divisor.map(() => 0);
      for (const b of data) {
        const factor: number = b ^ result.shift()!;
        result.push(0);
        divisor.forEach((coef: number, i: number) => (result[i] ^= QrCode.reedSolomonMultiply(coef, factor)));
      }
      return result;
    }

    private static reedSolomonMultiply(x: number, y: number): number {
      if (x >>> 8 !== 0 || y >>> 8 !== 0) throw new RangeError("Byte out of range");
      let z: number = 0;
      for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d);
        z ^= ((y >>> i) & 1) * x;
      }
      return z;
    }

    private static readonly ECC_CODEWORDS_PER_BLOCK: number[][] = [
      [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
      [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
      [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
      [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    ];

    private static readonly NUM_ERROR_CORRECTION_BLOCKS: number[][] = [
      [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
      [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
      [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
      [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 72, 74, 79],
    ];
  }

  export class QrSegment {
    public static makeBytes(data: readonly number[] | Uint8Array): QrSegment {
      const bb: number[] = [];
      for (const b of data) appendBits(b, 8, bb);
      return new QrSegment(Mode.BYTE, data.length, bb);
    }

    public static getTotalBits(segs: readonly QrSegment[], version: number): number {
      let result = 0;
      for (const seg of segs) {
        const ccbits: number = seg.mode.numCharCountBits(version);
        if (seg.numChars >= 1 << ccbits) return Infinity;
        result += 4 + ccbits + seg.bitLength;
      }
      return result;
    }

    public readonly bitLength: number;
    public constructor(
      public readonly mode: Mode,
      public readonly numChars: number,
      private readonly bitData: number[]
    ) {
      if (numChars < 0) throw new RangeError("Invalid argument");
      this.bitLength = bitData.length;
    }

    public getData(): number[] {
      return this.bitData.slice();
    }
  }

  export class Ecc {
    public static readonly LOW = new Ecc(0, 1);
    public static readonly MEDIUM = new Ecc(1, 0);
    public static readonly QUARTILE = new Ecc(2, 3);
    public static readonly HIGH = new Ecc(3, 2);
    private constructor(public readonly ordinal: number, public readonly formatBits: number) {}
  }

  export class Mode {
    public static readonly NUMERIC = new Mode(0x1, [10, 12, 14]);
    public static readonly ALPHANUMERIC = new Mode(0x2, [9, 11, 13]);
    public static readonly BYTE = new Mode(0x4, [8, 16, 16]);
    public static readonly KANJI = new Mode(0x8, [8, 10, 12]);
    public static readonly ECI = new Mode(0x7, [0, 0, 0]);

    private constructor(public readonly modeBits: number, private readonly numBitsCharCount: [number, number, number]) {}

    public numCharCountBits(version: number): number {
      return this.numBitsCharCount[Math.floor((version + 7) / 17)];
    }
  }

  function appendBits(val: number, len: number, bb: number[]): void {
    if (len < 0 || len > 31 || val >>> len !== 0) throw new RangeError("Value out of range");
    for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1);
  }

  function getBit(x: number, i: number): boolean {
    return ((x >>> i) & 1) !== 0;
  }
}
