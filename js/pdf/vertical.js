// =====================================================================
// 直書排版（Vertical）
//
// 比喻：直書就像把稿紙轉個方向寫——中文字「站著」往下排，英數字「躺著」往下排，
// 一行寫滿再往左邊開新的一行。
//
// 做法：讓瀏覽器先用 writing-mode: vertical-rl 排好（編輯畫面看到的就是這個），
// 再逐字量出每個字的位置，照著畫進 PDF，所以 PDF 和畫面一模一樣。
// 下面的位置規則是在 Chrome 實測粉圓字型量出來的：
//   直立的字：水平置中，基線 = 字框上緣 + 字級 × ASC
//   躺著的字：順時針轉 90 度，基線 = 字框中線往左 字級 × (ASC − DESC) / 2
// =====================================================================
import { FONT_CSS, fonts } from './fonts.js';

export const ASC = 871 / 1024;    // 粉圓字型的 ascent（hhea）
export const DESC = 153 / 1024;   // 粉圓字型的 descent

/** 直書時要「站著」的字（中日韓文字、全形符號…）；其他（英數字）躺著 */
const UPRIGHT = /[ᄀ-ᇿ⺀-꓏가-힯豈-﫿︐-︟︰-﹏！-｠￠-￦§©®±¼-¾×÷‖†‡‰‱※‼⁂⁇-⁉⁑℀-⅏Ⅰ-↉①-⓿■-➿⭐-⭙]|[\uD840-\uD87F][\uDC00-\uDFFF]/;

/** 直書時要換成「直書專用字形」的括號（瀏覽器用字型的 vert 功能做同樣的事） */
const VERTICAL_FORMS = {
  '（': '︵', '）': '︶', '｛': '︷', '｝': '︸', '〔': '︹', '〕': '︺', '【': '︻', '】': '︼',
  '《': '︽', '》': '︾', '〈': '︿', '〉': '﹀', '「': '﹁', '」': '﹂', '『': '﹃', '』': '﹄', '［': '﹇', '］': '﹈',
};

/** 長音、波浪號這類：瀏覽器會轉成直的，字型沒有直書字形時就轉 90 度畫 */
const ROTATE_ANYWAY = /[ー〜～－＝｜]/;

/**
 * 決定一個字在直書時怎麼畫
 * @returns {{ ch: string, upright: boolean }}
 */
export function verticalGlyph(ch) {
  const form = VERTICAL_FORMS[ch];
  if (form && fonts.hasGlyph(form)) return { ch: form, upright: true };
  if (form || ROTATE_ANYWAY.test(ch)) return { ch, upright: false };
  return { ch, upright: UPRIGHT.test(ch) };
}

/** 直書用到的所有字（包含換成的直書字形），給字型子集化用 */
export function verticalCharset(text) {
  let out = '';
  for (const ch of text) out += verticalGlyph(ch).ch;
  return out;
}

/**
 * 讓瀏覽器排一次直書，量出每個字的位置（單位 pt，相對於文字貼紙左上角）
 * @returns {{ chars: {ch, left, top, width, height}[], w, h }}
 */
export function measureVertical(el, text) {
  const div = document.createElement('div');
  div.style.cssText = `position:absolute;left:-20000px;top:0;margin:0;padding:0;writing-mode:vertical-rl;white-space:pre;`
    + `font-family:${FONT_CSS.huninn};font-size:${el.size}px;line-height:${el.lineHeight};text-align:${el.align || 'left'}`;
  div.textContent = text;
  document.body.appendChild(div);
  const box = div.getBoundingClientRect();
  const node = div.firstChild;
  const chars = [];
  for (let i = 0; node && i < text.length;) {
    const len = text.codePointAt(i) > 0xffff ? 2 : 1;
    const ch = text.slice(i, i + len);
    if (ch !== '\n') {
      const r = document.createRange();
      r.setStart(node, i); r.setEnd(node, i + len);
      const q = r.getClientRects()[0] || r.getBoundingClientRect();
      chars.push({ ch, left: q.left - box.left, top: q.top - box.top, width: q.width, height: q.height });
    }
    i += len;
  }
  div.remove();
  return { chars, w: box.width, h: box.height };
}
