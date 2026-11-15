import './fonts.js';
import { DATA_DIR } from '../paths.js';
// src/utils/imageComposer.js
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { createCanvas, loadImage } from 'canvas';

const log = (...a) => console.log('[imageComposer]', ...a);

export function resolveImageSrc(p) {
  if (!p) return null;
  try {
    // http(s)
    if (/^https?:\/\//i.test(p)) return p;

    // file:// -> chemin local
    if (/^file:\/\//i.test(p)) {
      const local = fileURLToPath(p);
      return fs.existsSync(local) ? local : null;
    }

    // chemin relatif -> absolu (uploads/…), relatif au dossier de données (DATA_DIR)
    let abs = p;
    if (!path.isAbsolute(abs)) abs = path.resolve(DATA_DIR, p.replace(/^(\.\/|\/)/, ''));
    if (!abs.startsWith(DATA_DIR + path.sep)) return null; // jamais en dehors du dossier de données
    if (!fs.existsSync(abs)) {
      log('not found:', abs);
      return null;
    }
    return abs; // chemin fichier pour loadImage
  } catch (e) {
    log('resolveImageSrc error:', e.message);
    return null;
  }
}

async function loadImageSafe(src) {
  if (!src) return null;
  try { return await loadImage(src); }
  catch (e) { log('load failed for:', src, '→', e.message); return null; }
}

function drawText(ctx, text, x, y, {
  font = '700 36px "DejaVu Sans", "Segoe UI", Arial, sans-serif',
  color = '#FFF',
  shadow = true,
  align = 'center',
  baseline = 'middle',
  maxWidth
} = {}) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 10; } else { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; }

  const str = String(text ?? '');
  if (!maxWidth) return ctx.fillText(str, x, y);

  // wrap simple par mots
  const words = str.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = (line ? line + ' ' : '') + w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  const px = Number((font.match(/(\d+)px/) || [])[1]) || 32;
  const lh = Math.round(px * 1.25);
  // on centre la "bloc" autour de y
  const startY = y - ((lines.length - 1) * lh) / 2;
  lines.forEach((ln, i) => ctx.fillText(ln, x, startY + i * lh));
}

function wrapLinesLimit(ctx, text, maxWidth, maxLines = 4) {
  const words = String(text).split(/\s+/);
  const out = [];
  let line = '';
  for (const w of words) {
    const test = (line ? line + ' ' : '') + w;
    if (ctx.measureText(test).width > maxWidth && line) {
      out.push(line);
      line = w;
      if (out.length === maxLines - 1) break;
    } else {
      line = test;
    }
  }
  if (line && out.length < maxLines) out.push(line);

  // ellipsis si reste du texte
  if (out.length === maxLines) {
    let last = out.pop();
    while (ctx.measureText(last + ' …').width > maxWidth && last.length > 0) {
      last = last.slice(0, -1);
    }
    out.push(last + ' …');
  }
  return out;
}

export async function composeWelcomeImageEx({
  width = 1200,
  height = 500,
  backgroundSrc = null,
  overlayWelcomeText = true,
  overlayTextColor = '#FFFFFF',
  overlayTextShadow = true,
  serverName = '',
  avatarUrl = null,
  showAvatar = true,
  message = '',
  username = '',
  memberCount = 0
} = {}) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // ---------- FOND (dégradé + image cover + assombrissement) ----------
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#0b1220');
  grad.addColorStop(1, '#101827');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  if (backgroundSrc) {
    const bg = await loadImageSafe(backgroundSrc);
    if (bg) {
      const scale = Math.max(width / bg.width, height / bg.height);
      const sw = bg.width * scale;
      const sh = bg.height * scale;
      const sx = (width - sw) / 2;
      const sy = (height - sh) / 2;
      ctx.drawImage(bg, sx, sy, sw, sh);
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.fillRect(0, 0, width, height);

  // ---------- AVATAR (gros + fallback initiales) ----------
  const AV = 290;
  const cx = 190;
  const cy = height / 2;

  if (showAvatar) {
    let ok = false;
    if (avatarUrl) {
      const av = await loadImageSafe(avatarUrl);
      if (av) {
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, AV / 2, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(av, cx - AV / 2, cy - AV / 2, AV, AV);
        ctx.restore();
        ok = true;
      }
    }
    if (!ok) {
      ctx.beginPath(); ctx.arc(cx, cy, AV / 2, 0, Math.PI * 2); ctx.closePath();
      ctx.fillStyle = '#1f2937'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 4; ctx.stroke();
      const initials = (username || 'U').slice(0, 2).toUpperCase();
      drawText(ctx, initials, cx, cy, {
        font: '800 64px "DejaVu Sans", "Segoe UI", Arial, sans-serif',
        color: '#e5e7eb',
        shadow: true,
        align: 'center',
        baseline: 'middle'
      });
    }

  }

  // ---------- TEXTE À DROITE ----------
  const centerX = width * 0.62;

  if (overlayWelcomeText) {
    drawText(ctx, 'BIENVENUE SUR LE SERVEUR DISCORD', centerX, height * 0.38, {
      font: '800 34px "DejaVu Sans", "Segoe UI", Arial, sans-serif',
      color: overlayTextColor,
      shadow: overlayTextShadow,
      align: 'center'
    });
    drawText(ctx, String(serverName).toUpperCase(), centerX, height * 0.52, {
      font: '900 58px "DejaVu Sans", "Segoe UI", Arial, sans-serif',
      color: overlayTextColor,
      shadow: overlayTextShadow,
      align: 'center'
    });
  }

  return canvas.toBuffer('image/png');
}
