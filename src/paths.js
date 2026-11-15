// src/paths.js
// Où le bot stocke ses fichiers (images envoyées, cache Twitch).
// En local : le dossier du projet. Sur Railway : mets DATA_DIR=/data et attache
// un Volume monté sur /data, sinon tout est effacé à chaque redéploiement.
import path from 'path';
import fs from 'fs';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || process.cwd());
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
