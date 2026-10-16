// =====================================================================
// 貼紙的畫面呈現（每種元素對應一個 DOM 節點）
//
// 原則：畫面只是「模型的投影」。座標與尺寸都由模型決定，乘上縮放倍率 z 後擺到頁面上。
// 文字貼紙的寬高由瀏覽器排版量出來後回寫模型（這是衍生資料，不記入歷史）。
// =====================================================================
import { FONT_CSS } from '../pdf/fonts.js';
import { drawMediaCard } from '../pdf/media.js';
import { youtubeIdOf } from '../domain/elements.js';
import { ICONS } from './icons.js';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function createNode(el) {
  const node = document.createElement('div');
  node.className = `el el-${el.kind}`;
  node.dataset.id = el.id;
  if (el.kind === 'text' || el.kind === 'link') {
    const c = document.createElement('div');
    c.className = 'el-content';
    c.spellcheck = false;
    node.appendChild(c);
  } else if (el.kind === 'media') {
    node.innerHTML = `<canvas class="media-canvas"></canvas><button type="button" class="media-play" title="在這裡預覽播放">${ICONS.play}<span>預覽</span></button>`;
  } else if (el.kind === 'image') {
    const img = document.createElement('img');
    img.draggable = false; img.alt = '';
    node.appendChild(img);
  }
  return node;
}

/**
 * 依模型更新節點
 * @param {object} o { z: 縮放, selected, editing: 正在編輯文字, dpr }
 */
export function updateNode(node, el, o) {
  const z = o.z;
  node.classList.toggle('selected', !!o.selected);
  node.style.left = el.x * z + 'px';
  node.style.top = el.y * z + 'px';

  switch (el.kind) {
    case 'text': styleText(node, el, z, o.editing); break;
    case 'link':
      node.classList.toggle('area', el.isArea);
      if (el.isArea) { sizeBox(node, el, z); node.querySelector('.el-content').textContent = ''; node.title = el.url || '尚未設定網址'; }
      else styleText(node, { ...el, font: 'huninn', lineHeight: 1.3, bold: false, strike: false, bgColor: null, align: 'left' }, z, o.editing, el);
      node.dataset.url = el.url ? shortUrl(el.url) : '未設定網址';
      break;
    case 'cover':
      sizeBox(node, el, z);
      node.style.background = el.color;
      break;
    case 'image': {
      sizeBox(node, el, z);
      const img = node.firstChild;
      if (el.image && img.src !== el.image.url) img.src = el.image.url;
      img.style.opacity = el.opacity;
      break;
    }
    case 'media': updateMedia(node, el, z, o.dpr || 1); break;
  }

  // 改變大小的控制點
  const want = o.selected && el.resizable && !o.editing;
  const has = node.querySelector(':scope > .handle');
  if (want && !has) for (const h of HANDLES) {
    const d = document.createElement('div');
    d.className = `handle h-${h}`; d.dataset.h = h;
    node.appendChild(d);
  } else if (!want && has) node.querySelectorAll(':scope > .handle').forEach(d => d.remove());
}

function sizeBox(node, el, z) {
  node.style.width = el.w * z + 'px';
  node.style.height = el.h * z + 'px';
}

function styleText(node, el, z, editing, linkEl) {
  const c = node.querySelector('.el-content');
  const st = c.style;
  st.fontFamily = FONT_CSS[el.font] || FONT_CSS.huninn;
  st.fontSize = el.size * z + 'px';
  st.lineHeight = String(el.lineHeight);
  st.color = el.color;
  st.background = el.bgColor || 'transparent';
  st.textAlign = el.align || 'left';
  st.webkitTextStroke = el.bold ? `${el.size * 0.03 * z}px ${el.color}` : '';
  const deco = [el.underline && 'underline', el.strike && 'line-through'].filter(Boolean).join(' ');
  st.textDecorationLine = deco || 'none';
  st.textDecorationThickness = Math.max(1, el.size * 0.06 * z) + 'px';
  st.textUnderlineOffset = el.size * 0.12 * z + 'px';
  node.style.width = ''; node.style.height = '';
  if (!editing && c.textContent !== el.text) c.textContent = el.text;
  c.contentEditable = editing ? 'plaintext-only' : 'false';
  node.classList.toggle('editing', !!editing);
  // 量出寬高回寫模型（衍生資料）
  const target = linkEl || el;
  target.w = Math.max(4, c.offsetWidth / z);
  target.h = Math.max(el.size * el.lineHeight, c.offsetHeight / z);
}

function updateMedia(node, el, z, dpr) {
  sizeBox(node, el, z);
  const canvas = node.querySelector('.media-canvas');
  const key = [el.w, el.h, z, dpr, el.title, el.url, el.poster ? el.poster.length : 0, el.showQr, el.source, el.file ? el.file.name : '', el.mediaType, document.fonts.status].join('|');
  if (canvas._key !== key) {
    canvas._key = key;
    drawMediaCard(canvas, el, z * dpr);
  }
  if (node._player && node._playerKey !== playerKey(el)) stopMedia(node);
}

const playerKey = (el) => el.source + '|' + el.url + '|' + (el.file ? el.file.name : '');

/** 在卡片上直接預覽播放（YouTube 嵌入、網址影音、本機檔案） */
export function toggleMedia(node, el) {
  if (node._player) { stopMedia(node); return; }
  let player;
  const yt = youtubeIdOf(el.url);
  if (el.source === 'url' && yt) {
    player = document.createElement('iframe');
    player.src = `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1`;
    player.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    player.allowFullscreen = true;
  } else if (el.source === 'file' && el.file) {
    player = document.createElement(el.mediaType === 'audio' ? 'audio' : 'video');
    node._objectUrl = URL.createObjectURL(new Blob([el.file.bytes], { type: el.file.mime }));
    player.src = node._objectUrl; player.controls = true; player.autoplay = true;
  } else if (el.source === 'url' && /\.(mp4|webm|ogg|ogv|mov|m4v|mp3|m4a|wav|aac|flac|oga)(\?|#|$)/i.test(el.url)) {
    player = document.createElement(/\.(mp3|m4a|wav|aac|flac|oga)(\?|#|$)/i.test(el.url) ? 'audio' : 'video');
    player.src = el.url; player.controls = true; player.autoplay = true;
  } else if (el.url) {
    window.open(el.url, '_blank', 'noopener');
    return;
  } else return;
  player.className = 'media-player';
  node.appendChild(player);
  node._player = player;
  node._playerKey = playerKey(el);
  node.classList.add('playing');
}

export function stopMedia(node) {
  node._player?.remove();
  node._player = null;
  if (node._objectUrl) { URL.revokeObjectURL(node._objectUrl); node._objectUrl = null; }
  node.classList.remove('playing');
}

function shortUrl(u) {
  try { const x = new URL(u); return x.host + (x.pathname.length > 1 ? x.pathname.slice(0, 18) + (x.pathname.length > 18 ? '…' : '') : ''); }
  catch (e) { return u; }
}

/** 「編輯原文字」時，被取代的原始區域用遮蓋色塊顯示 */
export function patchNode(el, z) {
  const d = document.createElement('div');
  d.className = 'patch';
  d.dataset.for = el.id;
  const p = el.patch;
  d.style.cssText = `left:${p.x * z}px;top:${p.y * z}px;width:${p.w * z}px;height:${p.h * z}px;background:${p.color || '#fff'}`;
  return d;
}

/** 讀出編輯中文字（contenteditable 會在最後多一個換行） */
export function readEditableText(node) {
  const c = node.querySelector('.el-content');
  return c.innerText.replace(/\r/g, '').replace(/\n$/, '');
}
