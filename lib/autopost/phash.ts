/**
 * pHash 64-bit (DCT 32×32 → khối 8×8, so với trung vị).
 * Kết quả lưu vào Postgres bigint (có dấu) bằng BigInt.asIntN(64, …).
 */

export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b
  if (x < BigInt(0)) x += BigInt(1) << BigInt(64)
  let n = 0
  while (x) {
    x &= x - BigInt(1)
    n++
  }
  return n
}

export function signed64(bits: bigint): bigint {
  return BigInt.asIntN(64, bits)
}

/** `pixels` dài 32*32, giá trị 0–255 (xám). */
export function phashFromGray32(pixels: ArrayLike<number>): bigint {
  if (pixels.length !== 32 * 32) {
    throw new Error(`phashFromGray32 cần 1024 điểm, nhận ${pixels.length}`)
  }
  const N = 32
  const matrix: number[][] = []
  for (let y = 0; y < N; y++) {
    const row: number[] = []
    for (let x = 0; x < N; x++) row.push(Number(pixels[y * N + x]) || 0)
    matrix.push(row)
  }

  const dct = discreteCosine2d(matrix)
  const vals: number[] = []
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (x === 0 && y === 0) continue
      vals.push(dct[y][x])
    }
  }
  const mid = [...vals].sort((a, b) => a - b)[Math.floor(vals.length / 2)]

  let bits = BigInt(0)
  let i = 0
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (x === 0 && y === 0) continue
      if (dct[y][x] > mid) bits |= BigInt(1) << BigInt(i)
      i++
    }
  }
  // 63 bit (bỏ DC) — đủ phân biệt; bit cao nhất để 0 để tránh nhầm dấu.
  return signed64(bits)
}

function discreteCosine2d(input: number[][]): number[][] {
  const N = input.length
  const out: number[][] = Array.from({ length: N }, () => Array(N).fill(0))
  for (let u = 0; u < N; u++) {
    for (let v = 0; v < N; v++) {
      let sum = 0
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          sum +=
            input[y][x] *
            Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N)) *
            Math.cos(((2 * y + 1) * v * Math.PI) / (2 * N))
        }
      }
      const cu = u === 0 ? Math.SQRT1_2 : 1
      const cv = v === 0 ? Math.SQRT1_2 : 1
      out[u][v] = 0.25 * cu * cv * sum
    }
  }
  return out
}
