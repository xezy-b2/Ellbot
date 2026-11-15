// src/utils/youtube.js
// Lecture des chaînes YouTube via leur flux RSS public (aucune clé API nécessaire).

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const CHANNEL_ID = /^UC[\w-]{22}$/;

const decode = (s = '') => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

const tag = (xml, name) => decode((xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1] || '').trim();

/** Récupère le flux d'une chaîne : { channelId, channelName, videos: [{ id, title, url, published, thumbnail }] } */
export async function fetchChannelFeed(channelId) {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`flux YouTube ${res.status}`);
  const xml = await res.text();
  const head = xml.split('<entry>')[0];
  const channelName = tag(head, 'title') || tag(tag(head, 'author'), 'name') || channelId;
  const videos = xml.split('<entry>').slice(1).map(entry => {
    const id = tag(entry, 'yt:videoId');
    const link = (entry.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/) || [])[1];
    return {
      id,
      title: tag(entry, 'title') || id,
      url: link || `https://www.youtube.com/watch?v=${id}`,
      published: tag(entry, 'published'),
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  }).filter(v => v.id);
  return { channelId, channelName, videos };
}

/**
 * Accepte : ID « UC… », lien /channel/UC…, @pseudo ou lien youtube.com/@pseudo.
 * Retourne { id, name } ou null.
 */
export async function resolveYouTubeChannel(input) {
  let s = String(input || '').trim();
  if (!s) return null;

  let id = null;
  const direct = s.match(/(?:channel\/)?(UC[\w-]{22})/);
  if (direct) id = direct[1];

  if (!id) {
    // @pseudo, /c/nom ou /user/nom → on lit la page de la chaîne pour trouver son ID
    let path = null;
    const handle = s.match(/(?:youtube\.com\/)?(@[\w.\-]+)/i);
    const legacy = s.match(/youtube\.com\/((?:c|user)\/[\w.\-]+)/i);
    if (handle) path = handle[1];
    else if (legacy) path = legacy[1];
    else if (/^[\w.\-]+$/.test(s)) path = `@${s}`;
    if (!path) return null;

    const res = await fetch(`https://www.youtube.com/${path}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    id = (html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)
      || html.match(/"externalId":"(UC[\w-]{22})"/)
      || html.match(/<meta itemprop="identifier" content="(UC[\w-]{22})"/)
      || html.match(/"channelId":"(UC[\w-]{22})"/)
      || [])[1] || null;
  }

  if (!id || !CHANNEL_ID.test(id)) return null;
  try {
    const feed = await fetchChannelFeed(id);
    return { id, name: feed.channelName };
  } catch {
    return null; // ID introuvable ou chaîne sans flux
  }
}
