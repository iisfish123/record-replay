/**
 * 轻量 toast：纯 DOM 实现，无需 UI 库
 */
let timer: ReturnType<typeof setTimeout> | null = null;

export function toast(message: string, duration = 2000): void {
  const exist = document.getElementById('rr-toast');
  if (exist) exist.remove();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  const el = document.createElement('div');
  el.id = 'rr-toast';
  el.textContent = message;
  el.style.cssText = [
    'position:fixed',
    'left:50%',
    'bottom:120px',
    'transform:translateX(-50%)',
    'padding:10px 20px',
    'background:rgba(0,0,0,0.75)',
    'color:#fff',
    'font-size:14px',
    'border-radius:8px',
    'z-index:9999',
    'max-width:80vw',
    'text-align:center',
    'pointer-events:none',
  ].join(';');
  document.body.appendChild(el);

  timer = setTimeout(() => {
    el.remove();
    timer = null;
  }, duration);
}
