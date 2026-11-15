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
    recUpdated: { '1': 'Message récurrent modifié.' },
    recSent: { '1': 'Message envoyé maintenant. Le planning continue normalement.' },
    recPaused: { '1': 'Message mis en pause.' },
    recResumed: { '1': 'Message réactivé.' },
    recDeleted: { '1': 'Message planifié supprimé.' },
    welcomeTest: { ok: "Message d'accueil de test envoyé." },
    socialTest: { ok: 'Notification de test envoyée.' },
    lbTest: { ok: 'Classement de test envoyé.' },
    xpBg: { ok: 'Fond des cartes de rang mis à jour.' },
    ytTest: { ok: 'Dernière vidéo envoyée (sans ping).' },
    bdTest: { ok: "Message d'anniversaire de test envoyé." },
    storeTest: { ok: 'Jeux gratuits actuels envoyés (sans ping).' },
  };
  const ERRORS = {
    error: () => "Une erreur est survenue lors de l'enregistrement.",
    uploadError: (v) => (v === 'FORMAT_INVALIDE' ? 'Format refusé : PNG, JPG, GIF ou WebP uniquement.' : v === 'NOFILE' ? 'Aucun fichier sélectionné.' : `Échec de l'envoi : ${v}`),
    rrError: (v) => ({ DUPLICATE_ROLES: 'Un même rôle apparaît deux fois dans le panneau.', NOT_FOUND: "Ce panneau n'existe plus.", CHANNEL: "Choisis un salon textuel avant de publier.", NO_ENTRIES: 'Ajoute au moins un rôle avant de publier.' }[v] || `Erreur : ${v}`),
    cmdError: () => 'Nom (sans espace) et réponse obligatoires.',
    recError: (v) => ({ toolong: 'Message trop long : 2000 caractères max en texte simple (4096 dans un encadré).', cron: 'Expression cron invalide. Exemple : 0 9 * * * = tous les jours à 9h.', days: 'Choisis au moins un jour de la semaine.', notfound: "Ce message n'existe plus.", missing: 'Le salon et le message sont obligatoires.' }[v] || 'Erreur lors de l\'enregistrement.'),
    recSendError: (v) => ({ channel: "Envoi impossible : le salon n'existe plus.", perms: "Envoi impossible : le bot n'a pas la permission d'écrire dans ce salon." }[v] || "L'envoi a échoué."),
    welcomeTest: (v, q) => (v === 'error' ? `Échec du test : ${q.get('w') || 'vérifie le salon et les permissions du bot.'}` : null),
    socialTest: (v) => ({ nosocial: "Twitch n'est pas encore configuré.", nosent: 'Active Twitch et choisis un salon, puis enregistre.', error: "Le bot n'a pas pu envoyer le message (permissions ?)." }[v] || null),
    lbTest: (v) => ({ disabled: 'Active le classement et choisis un salon, puis enregistre.', channel: 'Le salon du classement est introuvable.', error: "Le bot n'a pas pu envoyer le message." }[v] || null),
    xpBg: (v) => ({ 'no-file': 'Aucun fichier sélectionné.', error: "Échec de l'envoi de l'image." }[v] || null),
    bdTest: (v) => (v === 'channel' ? 'Choisis un salon pour les anniversaires, puis enregistre.' : null),
    ytNotFound: (v) => `Chaîne(s) YouTube introuvable(s) : ${v}. Vérifie le lien ou utilise l'identifiant UC…`,
    ytTest: (v) => (v === 'ok' ? null : ({ config: 'Ajoute au moins une chaîne et un salon, puis enregistre.', channel: 'Le salon choisi est introuvable.', novideo: "Cette chaîne n'a encore aucune vidéo." }[v] || `Test impossible : ${v}`)),
    storeTest: (v) => (v === 'ok' ? null : ({ config: 'Choisis au moins une boutique et un salon, puis enregistre.', channel: 'Le salon choisi est introuvable.', nogames: "Aucun jeu gratuit en ce moment (ou boutique injoignable)." }[v] || `Test impossible : ${v}`)),
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
    // Rôles mentionnés dans le titre/message : ils sont pingés dans le texte au-dessus de l'encadré
    const roleIds = new Set([...`${wTitle.value} ${wMsg.value}`.matchAll(/<@&(\d{17,20})>/g)].map(m => m[1]));
    roleIds.forEach(id => pings.push(`<span class="mention">@${escapeHtml(data.roles.find(r => r.id === id)?.name || 'rôle')}</span>`));
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

  // ---------------- XP : rôles par niveau ----------------
  const rewardsBox = $('#xp-rewards');
  if (rewardsBox) {
    let rIdx = 0;
    const roleOptions = (selected) => '<option value="">— Choisir un rôle —</option>' +
      data.roles.map(r => `<option value="${escapeHtml(r.id)}"${r.id === selected ? ' selected' : ''}>@ ${escapeHtml(r.name)}</option>`).join('');
    function addReward(r = {}) {
      if ($$('.reward-row', rewardsBox).length >= 25) return toast('25 paliers maximum.', 'error');
      const i = rIdx++;
      const row = document.createElement('div');
      row.className = 'reward-row';
      row.innerHTML = `
        <div class="field"><label>Niveau</label><input type="number" min="1" max="1000" name="rewards[${i}][level]" value="${escapeHtml(r.level ?? '')}" placeholder="10" required /></div>
        <div class="field"><label>Rôle donné</label><select name="rewards[${i}][roleId]" required>${roleOptions(r.roleId)}</select></div>
        <button type="button" class="btn btn-danger btn-sm" aria-label="Retirer le palier">✕</button>`;
      row.querySelector('button').addEventListener('click', () => { row.remove(); emptyState(); });
      rewardsBox.appendChild(row);
      emptyState();
    }
    function emptyState() {
      const empty = rewardsBox.querySelector('.empty');
      const has = $$('.reward-row', rewardsBox).length > 0;
      if (!has && !empty) rewardsBox.insertAdjacentHTML('beforeend', '<div class="empty" style="padding:16px">Aucun palier pour l\'instant.</div>');
      if (has && empty) empty.remove();
    }
    (data.xpRewards || []).forEach(addReward);
    emptyState();
    $('#xp-add-reward').addEventListener('click', () => addReward());
  }

  // ---------------- Tickets : motifs ----------------
  const reasonsBox = $('#ticket-reasons');
  if (reasonsBox) {
    let tIdx = 0;
    const addReason = (r = {}) => {
      if ($$('.reason-row', reasonsBox).length >= 10) return toast('10 motifs maximum.', 'error');
      const i = tIdx++;
      const row = document.createElement('div');
      row.className = 'reason-row';
      row.innerHTML = `
        <div class="field"><label>Emoji</label><input type="text" name="reasons[${i}][emoji]" value="${escapeHtml(r.emoji)}" placeholder="🛠️" maxlength="64" /></div>
        <div class="field"><label>Motif</label><input type="text" name="reasons[${i}][label]" value="${escapeHtml(r.label)}" placeholder="Support" maxlength="80" required /></div>
        <div class="field"><label>Description (facultatif)</label><input type="text" name="reasons[${i}][description]" value="${escapeHtml(r.description)}" placeholder="Un problème avec le serveur" maxlength="100" /></div>
        <button type="button" class="btn btn-danger btn-sm" aria-label="Retirer le motif">✕</button>`;
      row.querySelector('button').addEventListener('click', () => row.remove());
      reasonsBox.appendChild(row);
    };
    (data.ticketReasons || []).forEach(addReason);
    $('#ticket-add-reason').addEventListener('click', () => addReason());
  }

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

  // ---------------- Messages récurrents ----------------
  const recForm = $('#rec-form');
  if (recForm) {
    const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    const createAction = recForm.getAttribute('action');
    const modeInputs = $$('input[name="mode"]', recForm);
    const dayInputs = $$('input[name="days"]', recForm);
    const content = $('#rec-content');
    const mode = () => modeInputs.find(i => i.checked)?.value || 'daily';
    const embedToggle = $('#rec-embed');
    const buttonsBox = $('#rec-buttons');
    let btnIdx = 0;

    function addButton(b = {}) {
      if ($$('.button-row', buttonsBox).length >= 5) return toast('5 boutons maximum.', 'error');
      const i = btnIdx++;
      const row = document.createElement('div');
      row.className = 'button-row';
      row.innerHTML = `
        <div class="field"><label>Emoji</label><input type="text" name="buttons[${i}][emoji]" value="${escapeHtml(b.emoji)}" placeholder="🔗" maxlength="64" /></div>
        <div class="field"><label>Texte</label><input type="text" name="buttons[${i}][label]" value="${escapeHtml(b.label)}" placeholder="Voter" maxlength="80" /></div>
        <div class="field url-field"><label>Lien</label><input type="url" name="buttons[${i}][url]" value="${escapeHtml(b.url)}" placeholder="https://…" required /></div>
        <button type="button" class="btn btn-danger btn-sm" aria-label="Retirer le bouton">✕</button>`;
      row.querySelector('button').addEventListener('click', () => { row.remove(); refresh(); });
      buttonsBox.appendChild(row);
      refresh();
    }

    function renderPreview() {
      const isEmbed = embedToggle.checked;
      const text = content.value;
      $('#rec-embed-fields').hidden = !isEmbed;
      $('#rec-max').textContent = isEmbed ? '4096' : '2000';
      $('#rec-mention-hint').innerHTML = isEmbed
        ? 'dans un encadré, <code>@everyone</code> et les mentions de rôles <b>ne notifient pas</b>'
        : 'les mentions comme <code>@everyone</code> ou <code>&lt;@&amp;ID_du_rôle&gt;</code> fonctionnent';
      $('#rec-pv-text').textContent = isEmbed ? '' : (text || 'Ton message apparaîtra ici.');
      $('#rec-pv-embed').hidden = !isEmbed;
      if (isEmbed) {
        $('#rec-pv-embed').style.borderLeftColor = $('#rec-embed-color').value;
        $('#rec-pv-title').textContent = $('#rec-embed-title').value;
        $('#rec-pv-title').hidden = !$('#rec-embed-title').value;
        $('#rec-pv-desc').textContent = text || 'Ton message apparaîtra ici.';
        const img = $('#rec-embed-image').value.trim();
        $('#rec-pv-image').hidden = !/^https?:\/\//.test(img);
        if (/^https?:\/\//.test(img)) $('#rec-pv-image').src = img;
      }
      $('#rec-pv-buttons').innerHTML = $$('.button-row', buttonsBox).map(r => {
        const [emoji, label] = $$('input', r).map(i => i.value.trim());
        return (emoji || label) ? `<span>${escapeHtml([emoji, label].filter(Boolean).join(' '))}</span>` : '';
      }).join('');
    }
    $('#rec-add-button').addEventListener('click', () => addButton());
    $('#rec-pv-image').addEventListener('error', (e) => { e.target.hidden = true; });

    function describe() {
      const time = $('#rec-time').value || '09:00';
      switch (mode()) {
        case 'hourly': {
          const h = Number($('#rec-everyHours').value);
          const min = time.split(':')[1] || '00';
          return h > 1 ? `Toutes les ${h} heures, à la minute ${min}` : `Toutes les heures, à la minute ${min}`;
        }
        case 'daily': return `Chaque jour à ${time}`;
        case 'weekly': {
          const names = dayInputs.filter(i => i.checked).map(i => Number(i.value)).sort().map(d => DAY_NAMES[d]);
          if (!names.length) return '⚠️ Choisis au moins un jour';
          if (names.length === 7) return `Chaque jour à ${time}`;
          return `Chaque ${names.length > 1 ? names.slice(0, -1).join(', ') + ' et ' + names.at(-1) : names[0]} à ${time}`;
        }
        case 'monthly': { const d = $('#rec-monthDay').value; return `Le ${d === '1' ? '1er' : d} de chaque mois à ${time}`; }
        default: return `Cron : ${$('#rec-cron').value || '(à remplir)'}`;
      }
    }

    function refresh() {
      const m = mode();
      $$('[data-modes]', recForm).forEach(el => { el.hidden = !el.dataset.modes.split(' ').includes(m); });
      $('#rec-time-label').textContent = m === 'hourly' ? 'Minute de départ' : 'Heure';
      $('#rec-cron').required = m === 'custom';
      $('#rec-summary').textContent = `${describe()} (heure de Paris)`;
      $('#rec-count').textContent = content.value.length;
      renderPreview();
    }
    recForm.addEventListener('input', refresh);
    recForm.addEventListener('change', refresh);

    function setMode(value) { modeInputs.forEach(i => { i.checked = i.value === value; }); }

    function resetForm() {
      recForm.reset();
      buttonsBox.innerHTML = '';
      recForm.setAttribute('action', createAction);
      $('#rec-id').value = '';
      $('#rec-form-title').textContent = 'Nouveau message';
      $('#rec-form-sub').textContent = "Choisis le salon, écris le message, puis quand l'envoyer.";
      $('#rec-submit').textContent = 'Ajouter';
      $('#rec-cancel').hidden = true;
      $$('.rec-item.editing').forEach(el => el.classList.remove('editing'));
      refresh();
    }

    function editMessage(id) {
      const r = (data.recurring || []).find(x => x.id === id);
      if (!r) return;
      resetForm();
      recForm.setAttribute('action', createAction + '/update');
      $('#rec-id').value = r.id;
      $('#rec-channel').value = r.channelId;
      content.value = r.content;
      setMode(r.schedule.mode);
      $('#rec-time').value = r.schedule.time;
      $('#rec-everyHours').value = String(r.schedule.everyHours);
      $('#rec-monthDay').value = String(r.schedule.monthDay);
      dayInputs.forEach(i => { i.checked = r.schedule.days.includes(Number(i.value)); });
      $('#rec-cron').value = r.schedule.mode === 'custom' ? r.cron : '';
      embedToggle.checked = !!r.embed?.enabled;
      $('#rec-embed-title').value = r.embed?.title || '';
      $('#rec-embed-color').value = r.embed?.color || '#5865F2';
      $('#rec-embed-image').value = r.embed?.imageUrl || '';
      (r.buttons || []).forEach(b => addButton(b));
      $('#rec-form-title').textContent = 'Modifier le message';
      $('#rec-form-sub').textContent = 'Les changements sont pris en compte dès l\'enregistrement.';
      $('#rec-submit').textContent = 'Enregistrer';
      $('#rec-cancel').hidden = false;
      document.querySelector(`[data-rec-edit="${CSS.escape(id)}"]`)?.closest('.rec-item')?.classList.add('editing');
      refresh();
      recForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
      content.focus({ preventScroll: true });
    }

    $$('[data-rec-edit]').forEach(b => b.addEventListener('click', () => editMessage(b.dataset.recEdit)));
    $('#rec-cancel').addEventListener('click', resetForm);
    recForm.addEventListener('submit', (e) => {
      if (mode() === 'weekly' && !dayInputs.some(i => i.checked)) { e.preventDefault(); return toast('Choisis au moins un jour de la semaine.', 'error'); }
      if (!embedToggle.checked && content.value.length > 2000) { e.preventDefault(); return toast('2000 caractères maximum en texte simple. Active l\'encadré pour aller jusqu\'à 4096.', 'error'); }
      const emptyLabel = $$('.button-row', buttonsBox).find(r => { const [emoji, label] = $$('input', r).map(i => i.value.trim()); return !emoji && !label; });
      if (emptyLabel) { e.preventDefault(); return toast('Chaque bouton a besoin d\'un texte ou d\'un emoji.', 'error'); }
    });

    refresh();
    if (query.get('edit')) editMessage(query.get('edit'));
  }

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
