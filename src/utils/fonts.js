// src/utils/fonts.js
// Les serveurs Linux (Railway, Docker…) n'ont souvent aucune police installée :
// le texte des images apparaîtrait en carrés vides. On embarque DejaVu Sans.
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { registerFont } from 'canvas';

const fontsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../assets/fonts');

export const FONT = '"DejaVu Sans", sans-serif';

let done = false;
export function registerFonts() {
  if (done) return;
  done = true;
  try {
    const regular = path.join(fontsDir, 'DejaVuSans.ttf');
    const bold = path.join(fontsDir, 'DejaVuSans-Bold.ttf');
    if (fs.existsSync(regular)) registerFont(regular, { family: 'DejaVu Sans' });
    if (fs.existsSync(bold)) registerFont(bold, { family: 'DejaVu Sans', weight: 'bold' });
  } catch (e) {
    console.warn('[FONTS] Impossible de charger les polices embarquées :', e.message);
  }
}

registerFonts();
