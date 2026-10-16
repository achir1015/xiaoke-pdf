// =====================================================================
// 頁面幾何（PageGeometry）
//
// 比喻：一位「翻譯員」，負責在兩種座標語言之間轉換：
//   - 顯示座標：使用者在螢幕上看到的樣子（左上角原點、y 往下、已套用頁面旋轉）
//   - PDF 座標：PDF 檔案內部用的（左下角原點、y 往上、未旋轉、可能有裁切框偏移）
//
// 由 pdf.js 在縮放 1 倍時的 viewport.transform 建立；匯出時不需要 pdf.js。
// =====================================================================

export class PageGeometry {
  /**
   * @param {object} o
   * @param {number} o.width  顯示寬度（pt）
   * @param {number} o.height 顯示高度（pt）
   * @param {number} o.rotation 頁面旋轉 0/90/180/270
   * @param {number[]} o.transform pdf.js viewport.transform（PDF→顯示）
   */
  constructor({ index, width, height, rotation, transform }) {
    this.index = index;
    this.width = width;
    this.height = height;
    this.rotation = ((rotation % 360) + 360) % 360;
    this.t = transform;
    const [a, b, c, d, e, f] = transform;
    const det = a * d - b * c;
    // 反矩陣：顯示→PDF
    this.inv = [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
  }

  static fromViewport(index, vp) {
    return new PageGeometry({ index, width: vp.width, height: vp.height, rotation: vp.rotation, transform: vp.transform.slice() });
  }

  /** 顯示座標 → PDF 座標 */
  toPdf(x, y) {
    const [a, b, c, d, e, f] = this.inv;
    return [a * x + c * y + e, b * x + d * y + f];
  }

  /** PDF 座標 → 顯示座標 */
  toDisplay(x, y) {
    const [a, b, c, d, e, f] = this.t;
    return [a * x + c * y + e, b * x + d * y + f];
  }

  /** 顯示座標的矩形 → PDF 座標的 [x1, y1, x2, y2]（因為旋轉都是 90 度倍數，結果仍是正矩形） */
  rectToPdf({ x, y, w, h }) {
    const p1 = this.toPdf(x, y), p2 = this.toPdf(x + w, y + h);
    return [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])];
  }

  /**
   * 要在顯示座標 (x, y) 畫一個「看起來正正的」東西時，PDF 繪圖要用的錨點與角度。
   * pdf-lib 的 drawText / drawImage 會以錨點為中心逆時針旋轉 rotate 度。
   * 頁面順時針轉了 R 度顯示，所以內容要逆時針轉 R 度，看起來才是正的。
   * @param {number} extraDeg 額外旋轉（顯示上逆時針為正，例如斜放的浮水印）
   */
  anchor(x, y, extraDeg = 0) {
    const [px, py] = this.toPdf(x, y);
    return { x: px, y: py, rotate: this.rotation + extraDeg };
  }
}
