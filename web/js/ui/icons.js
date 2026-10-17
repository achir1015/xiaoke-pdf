// 線條圖示（24×24，顏色跟隨文字顏色）
const s = (body) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  select: s('<path d="M5 3l14 8-6.2 1.6L10 19z"/>'),
  edittext: s('<path d="M4 7V5h12v2"/><path d="M10 5v12"/><path d="M8 17h4"/><path d="M14.5 19.5l5.8-5.8a1.4 1.4 0 0 0-2-2l-5.8 5.8-.6 2.6z"/>'),
  text: s('<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>'),
  cover: s('<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 11h6" opacity=".45"/><path d="M15 3l-4 4M19 3l-8 8" opacity=".45"/>'),
  link: s('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>'),
  media: s('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor"/>'),
  table: s('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.5h18M3 15h18M9 4v16M15 4v16"/>'),
  image: s('<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="M21 16l-5-5-9 9"/>'),
  watermark: s('<path d="M12 3s6 6.4 6 10.5A6 6 0 0 1 6 13.5C6 9.4 12 3 12 3z"/><path d="M9.5 14.5a2.8 2.8 0 0 0 2.5 2"/>'),
  unwatermark: s('<path d="M12 3s6 6.4 6 10.5a6 6 0 0 1-.6 2.6M8.4 17.9A6 6 0 0 1 6 13.5c0-1.6.9-3.5 2-5.3"/><path d="M3 3l18 18"/>'),
  undo: s('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  redo: s('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  open: s('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  paste: s('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><rect x="9" y="2.5" width="6" height="3" rx="1"/><path d="M9 11h6M9 15h4"/>'),
  download: s('<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>'),
  trash: s('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>'),
  copy: s('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  front: s('<rect x="8" y="8" width="12" height="12" rx="2" fill="currentColor" fill-opacity=".2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>'),
  back: s('<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M20 8v11a1 1 0 0 1-1 1H8"/>'),
  play: s('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>'),
  close: s('<path d="M6 6l12 12M18 6L6 18"/>'),
  zoomIn: s('<circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M20 20l-3.5-3.5"/>'),
  zoomOut: s('<circle cx="11" cy="11" r="7"/><path d="M8 11h6M20 20l-3.5-3.5"/>'),
  fit: s('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  shield: s('<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  external: s('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
};

/** 小柯機器人 + PDF 文件標誌（與 Android App 圖示相同） */
export const LOGO = `<svg viewBox="0 0 108 108" width="34" height="34" aria-hidden="true">
<path fill="#1E63E9" d="M24,4h60a20,20 0 0 1 20,20v60a20,20 0 0 1 -20,20h-60a20,20 0 0 1 -20,-20v-60a20,20 0 0 1 20,-20z"/>
<path fill="#3B7BF2" d="M4,60C30,48 70,78 104,58v26a20,20 0 0 1 -20,20h-60a20,20 0 0 1 -20,-20z"/>
<path fill="#FFF" d="M50,14h30l14,14v50a4,4 0 0 1 -4,4h-40a4,4 0 0 1 -4,-4v-60a4,4 0 0 1 4,-4z"/>
<path fill="#C9D8FA" d="M80,14l14,14h-10a4,4 0 0 1 -4,-4z"/>
<path fill="#E53935" d="M54,22h20a3,3 0 0 1 3,3v8a3,3 0 0 1 -3,3h-20a3,3 0 0 1 -3,-3v-8a3,3 0 0 1 3,-3z"/>
<path fill="#B7C3D6" d="M56,42h32v3h-32zM56,50h32v3h-32zM70,58h18v3h-18zM70,66h18v3h-18z"/>
<path fill="#FFF" d="M32.5,38h3v9h-3z"/><circle fill="#FFC83D" cx="34" cy="32" r="5"/>
<path fill="#FFC83D" d="M10,58h5v14h-5a2,2 0 0 1 -2,-2v-10a2,2 0 0 1 2,-2zM53,58h5a2,2 0 0 1 2,2v10a2,2 0 0 1 -2,2h-5z"/>
<path fill="#FFF" d="M24,46h20a11,11 0 0 1 11,11v16a11,11 0 0 1 -11,11h-20a11,11 0 0 1 -11,-11v-16a11,11 0 0 1 11,-11z"/>
<path fill="#16213A" d="M24,52h20a6,6 0 0 1 6,6v12a6,6 0 0 1 -6,6h-20a6,6 0 0 1 -6,-6v-12a6,6 0 0 1 6,-6z"/>
<circle fill="#5CE1E6" cx="27" cy="62" r="4"/><circle fill="#5CE1E6" cx="41" cy="62" r="4"/>
<path stroke="#5CE1E6" stroke-width="2.4" stroke-linecap="round" fill="none" d="M29,69.5q5,4 10,0"/>
<path fill="#FFF" d="M24,86h20a6,6 0 0 1 6,6v8h-32v-8a6,6 0 0 1 6,-6z"/><path fill="#FFC83D" d="M30,92h8v4h-8z"/>
</svg>`;
