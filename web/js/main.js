// 程式進入點
import { App } from './ui/app.js';

window.addEventListener('error', (e) => console.error(e.error || e.message));
window.app = new App();   // 掛在 window 上方便除錯
