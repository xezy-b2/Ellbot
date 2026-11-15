// Page de configuration d'un serveur
(() => {
  const data = JSON.parse(document.getElementById('page-data').textContent);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------- Notifications ----------------
  function toast(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type === 'error' ? 'error' : ''}`;
    el.textContent = message;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 300); }, 4200);
  }

  const MESSAGES = {
    saved: { '1': 'Modifications enregistrées.' },
    success: { 'true': 'Modifications enregistrées.' },
    uploaded: { '1': 'Image envoyée.' },
    rrSaved: { '1': 'Panneau enregistré. Pense à le publier.' },
    rrPosted: { '1': 'Panneau publié sur Discord.' },
    rrDeleted: { '1': 'Panneau supprimé.' },
    cmdSaved: { '1': 'Commande enregistrée.' },
    cmdDeleted: { '1': 'Commande supprimée.' },
    recSaved: { '1': 'Message planifié.' },
    recDeleted: { '1': 'Message planifié supprimé.' },
    welcomeTest: { ok: "Message d'accueil de test envoyé." },
    socialTest: { ok: 'Notification de test envoyée.' },
    lbTest: { ok: 'Classement de test envoyé.' },
    xpBg: { ok: 'Fond des cartes de rang mis à jour.' },
  };
  const ERRORS = {
    error: () => "Une erreur est survenue lors de l'enregistrement.",
    uploadError: (v) => (v === 'FORMAT_INVALIDE' ? 'Format refusé : PNG, JPG, GIF ou WebP uniquement.' : v === 'NOFILE' ? 'Aucun fichier sélectionné.' : `Échec de l'envoi : ${v}`),
    rrError: (v) => ({ DUPLICATE_ROLES: 'Un même rôle apparaît deux fois dans le panneau.', NOT_FOUND: "Ce panneau n'existe plus.", CHANNEL: "Choisis un salon textuel avant de publier.", NO_ENTRIES: 'Ajoute au moins un rôle avant de publier.' }[v] || `Erreur : ${v}`),
    cmdError: () => 'Nom (sans espace) et réponse obligatoires.',
    recError: (v) => (v === 'cron' ? 'Horaire cron invalide. Exemple : 0 9 * * * = tous les jours à 9h.' : 'Salon, horaire et message sont obligatoires.'),
    welcomeTest: (v, q) => (v === 'error' ? `Échec du test : ${q.get('w') || 'vérifie le salon et les permissions du bot.'}` : null),
    socialTest: (v) => ({ nosocial: "Twitch n'est pas encore configuré.", nosent: 'Active Twitch et choisis un salon, puis enregistre.', error: "Le bot n'a pas pu envoyer le message (permissions ?)." }[v] || null),
    lbTest: (v) => ({ disabled: 'Active le classement et choisis un salon, puis enregistre.', channel: 'Le salon du classement est introuvable.', error: "Le bot n'a pas pu envoyer le message." }[v] || null),
    xpBg: (v) => ({ 'no-file': 'Aucun fichier sélectionné.', error: "Échec de l'envoi de l'image." }[v] || null),
  };

  const query = new URLSearchParams(location.search);
  for (const [key, value] of query) {
    const okMsg = MESSAGES[key]?.[value];
    if (okMsg) { toast(okMsg); continue; }
    const err = ERRORS[key]?.(value, query);
    if (err) toast(err, 'error');
  }
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);

  // ---------------- Navigation ----------------
  const ALIASES = { 'panel-leaderboard': 'leaderboard' };
  function show(tab) {
    tab = ALIASES[tab] || tab;
    if (!$(`#panel-${tab}`)) tab = 'overview';
    $$('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    history.replaceState(null, '', `#${tab}`);
    window.scrollTo({ top: 0 });
  }
  $$('.nav-item').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => show(b.dataset.goto)));
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  show(location.hash.slice(1) || 'overview');

  // ---------------- Confirmations ----------------
  $$('form[data-confirm]').forEach(f => f.addEventListener('submit', (e) => { if (!confirm(f.dataset.confirm)) e.preventDefault(); }));
  $$('button[data-confirm]').forEach(b => b.addEventListener('click', (e) => { if (!confirm(b.dataset.confirm)) e.preventDefault(); }));

  // ---------------- Accueil : aperçu en direct ----------------
  const fill = (tpl) => String(tpl || '')
    .replace(/\{(user|member)(\.mention)?\}/g, '@' + data.sample.mention)
    .replace(/\{(user|member)\.username\}/g, data.sample.username)
    .replace(/\{(user|member)\.displayName\}/g, data.sample.displayName)
    .replace(/\{(user|member)\.tag\}/g, data.sample.username)
    .replace(/\{server\.name\}/g, data.server.name)
    .replace(/\{membercount\}/g, String(data.server.memberCount));

  const wTitle = $('#welcome_title');
  const wMsg = $('#welcome_message');
  const wColor = $('#welcome_color');
  const wSource = $('#welcome_imageSourceType');
  const wPingUser = $('input[name="welcome_pingUser"]');
  const wPingAll = $('input[name="welcome_pingEveryone"]');
  function renderWelcome() {
    if (!wTitle) return;
    $('#pv-title').textContent = fill(wTitle.value).trim() || 'Ho ! Un nouveau membre !';
    $('#pv-desc').textContent = fill(wMsg.value) || `Bienvenue @${data.sample.mention} sur ${data.server.name} !`;
    $('#pv-embed').style.borderLeftColor = wColor.value;
    const pings = [];
    if (wPingAll?.checked) pings.push('<span class="mention">@everyone</span>');
    if (wPingUser?.checked) pings.push(`<span class="mention">@${escapeHtml(data.sample.mention)}</span>`);
    $('#pv-ping').innerHTML = pings.join(' ');
    $('#welcome_url_wrap').hidden = wSource.value !== 'url';
  }
  [wTitle, wMsg, wColor, wSource, wPingUser, wPingAll].forEach(el => el?.addEventListener('input', renderWelcome));
  [wSource, wPingUser, wPingAll].forEach(el => el?.addEventListener('change', renderWelcome));
  renderWelcome();
  $('#pv-image')?.addEventListener('error', (e) => { e.target.hidden = true; });

  // ---------------- XP : retirer le fond ----------------
  $('#xp-bg-clear')?.addEventListener('click', async () => {
    if (!confirm("Retirer l'image de fond des cartes de rang ?")) return;
    const r = await fetch(`/dashboard/${data.guildId}/xp/card-background/clear`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' });
    if (r.ok) location.href = `/dashboard/${data.guildId}?xpBg=ok#xp`;
    else toast("Impossible de retirer l'image.", 'error');
  });

  // ---------------- Tickets : publier le panneau ----------------
  $('#ticket-post')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!$('#ticket-channelId').value) return toast("Choisis d'abord le salon du panneau, puis enregistre.", 'error');
    if (!confirm("Publier le panneau ? L'ancien panneau du salon sera remplacé.")) return;
    btn.disabled = true;
    try {
      const r = await fetch(`/dashboard/${data.guildId}/tickets/post`, { method: 'POST', headers: { Accept: 'application/json' } });
      const json = await r.json().catch(() => ({}));
      r.ok ? toast(json.message || 'Panneau publié.') : toast(json.error || 'Échec de la publication.', 'error');
    } catch {
      toast('Erreur réseau.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ---------------- Messages récurrents : raccourcis cron ----------------
  $$('[data-cron]').forEach(b => b.addEventListener('click', () => { $('#cron-input').value = b.dataset.cron; }));

  // ---------------- Rôles réaction : éditeur ----------------
  const rrForm = $('#rrForm');
  if (rrForm) {
    const list = $('#rr_entries');
    const roleOpts = (selected) => '<option value="">— Choisir un rôle —</option>' +
      data.roles.map(r => `<option value="${escapeHtml(r.id)}"${r.id === selected ? ' selected' : ''}>@ ${escapeHtml(r.name)}</option>`).join('');
    const STYLES = [['Secondary', 'Gris'], ['Primary', 'Bleu'], ['Success', 'Vert'], ['Danger', 'Rouge']];
    let idx = 0;

    function addEntry(e = {}) {
      const i = idx++;
      const row = document.createElement('div');
      row.className = 'list-row';
      row.innerHTML = `
        <div class="form-grid" style="flex:1;grid-template-columns:70px minmax(0,1fr) minmax(0,1.2fr) 110px">
          <div class="field"><label>Emoji</label><input type="text" name="entries[${i}][emoji]" value="${escapeHtml(e.emoji)}" placeholder="🎮" maxlength="64" /></div>
          <div class="field"><label>Texte</label><input type="text" name="entries[${i}][label]" value="${escapeHtml(e.label)}" placeholder="Gamer" maxlength="80" required /></div>
          <div class="field"><label>Rôle</label><select name="entries[${i}][roleId]" required>${roleOpts(e.roleId)}</select></div>
          <div class="field"><label>Bouton</label><select name="entries[${i}][style]">${STYLES.map(([v, l]) => `<option value="${v}"${(e.style || 'Secondary') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        </div>
        <button type="button" class="btn btn-danger btn-sm" style="margin-top:24px" aria-label="Retirer">✕</button>`;
      row.querySelector('button').addEventListener('click', () => row.remove());
      // Remplit le texte avec le nom du rôle s'il est vide
      const sel = row.querySelector('select');
      const label = row.querySelector(`input[name="entries[${i}][label]"]`);
      sel.addEventListener('change', () => { if (!label.value) label.value = data.roles.find(r => r.id === sel.value)?.name || ''; });
      list.appendChild(row);
    }

    function fillPanel(id) {
      const p = data.rrPanels.find(x => x._id === id);
      $('#rr_id').value = id || '';
      $('#rr_post_id').value = id || '';
      $('#rr_delete_id').value = id || '';
      $('#rr_post_btn').disabled = !id;
      $('#rr_delete_btn').disabled = !id;
      rrForm.querySelector('[name="title"]').value = p?.title || '';
      rrForm.querySelector('[name="description"]').value = p?.description || '';
      rrForm.querySelector('[name="mode"]').value = p?.mode || 'multi';
      rrForm.querySelector('[name="channelId"]').value = p?.channelId || '';
      rrForm.querySelector('[name="type"]').value = p?.type || 'dropdown';
      list.innerHTML = '';
      idx = 0;
      (p?.entries?.length ? p.entries : [{}]).forEach(addEntry);
    }

    $('#rr_add').addEventListener('click', () => addEntry());
    const selectPanel = $('#rr_selectPanel');
    selectPanel.addEventListener('change', () => fillPanel(selectPanel.value));
    // Après un enregistrement, le serveur renvoie ?rr=<id> : on resélectionne ce panneau
    const last = query.get('rr');
    if (last && data.rrPanels.some(p => p._id === last)) selectPanel.value = last;
    fillPanel(selectPanel.value);
  }
})();
