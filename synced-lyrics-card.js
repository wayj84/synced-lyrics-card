/* Synced Lyrics Card v1.0.0 - Home Assistant Lovelace custom card */
class SyncedLyricsCard extends HTMLElement {
  static getConfigElement() { return document.createElement('synced-lyrics-card-editor'); }
  static getStubConfig() { return { entity: '', layout: 'focus', alignment: 'center', font_family: 'system-ui', font_size: 42, font_weight: 700, card_height: '560px', show_previous: true, show_upcoming: true, inactive_opacity: 0.32, active_scale: 1.16, sync_offset: 0, show_track_info: true, background_opacity: 1, background_mode: 'theme', artwork_blur: 12, artwork_opacity: 1, artwork_overlay_opacity: 0.35, text_color_mode: 'auto', show_sync_slider: true, contrast_mode: 'adaptive', backdrop_blur: 8, backdrop_opacity: 0.18, text_shadow: true, text_shadow_strength: 0.75, track_info_font_size: 13, header_font_size: null, header_alignment: 'inherit', header_layout: 'combined', plain_lyrics_auto_scroll: true, show_media_controls: true, media_controls_size: 30, media_icon_style: 'standard', show_progress_bar: true, progress_bar_height: 5, progress_bar_color: 'var(--primary-color)', show_intro: true, intro_duration: 4, intro_font_size: 48 }; }
  static get properties() { return {}; }

  constructor() {
    super();
    this.attachShadow({mode: 'open'});
    this._config = null; this._hass = null; this._lyrics = []; this._plainLyrics = '';
    this._trackKey = ''; this._syncVisible = false; this._volumeTimer = null; this._syncHideTimer = null; this._syncKey = ''; this._liveOffset = null; this._artKey = ''; this._artUrl = ''; this._artText = ''; this._fetchKey = ''; this._raf = null; this._lastActive = -1; this._translateY = 0;
  }
  setConfig(config) {
    if (!config?.entity) throw new Error('Please define an entity.');
    this._config = {...SyncedLyricsCard.getStubConfig(), ...config};
    this._render();
  }
  set hass(hass) { this._hass = hass; this._update(); }
  getCardSize() { return 6; }
  connectedCallback() { this._tick(); }
  disconnectedCallback() { cancelAnimationFrame(this._raf); clearTimeout(this._syncHideTimer); clearTimeout(this._volumeTimer); }
  _state() { return this._hass?.states?.[this._config?.entity]; }
  _trackFromState(s) {
    if (!s) return null;
    const a = s.attributes || {};
    const title = a.media_title || ''; const artist = a.media_artist || '';
    if (!title || !artist) return null;
    return {title, artist, album: a.media_album_name || '', duration: Math.round(Number(a.media_duration) || 0), id: a.media_content_id || `${artist}|${title}|${a.media_album_name || ''}`};
  }
  _update() {
    const s = this._state(), track = this._trackFromState(s);
    const key = track ? track.id : '';
    if (key !== this._trackKey) { this._trackKey = key; this._lyrics = []; this._plainLyrics = ''; this._lastActive = -1; this._translateY = 0; this._render(); if (track) this._loadLyrics(track); }
    const syncKey = `synced-lyrics-card:offset:${this._config.entity}`;
    if (syncKey !== this._syncKey) { this._syncKey = syncKey; try { const stored = localStorage.getItem(syncKey); this._liveOffset = stored === null ? Number(this._config.sync_offset || 0) : Number(stored); } catch (_) { this._liveOffset = Number(this._config.sync_offset || 0); } this._render(); }
    const artUrl = s?.attributes?.entity_picture || '';
    if (artUrl !== this._artKey) { this._artKey = artUrl; this._artUrl = artUrl; this._analyseArtwork(artUrl); }
    this._paint();
  }
  async _analyseArtwork(url) {
    this._artText = '';
    if (!url || this._config?.background_mode !== 'artwork' || this._config?.text_color_mode === 'theme') { this._render(); return; }
    try {
      const image = new Image(); image.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', {willReadFrequently:true}); ctx.drawImage(image, 0, 0, 1, 1);
      const [r,g,b] = ctx.getImageData(0,0,1,1).data;
      const lum = (0.2126*r + 0.7152*g + 0.0722*b) / 255;
      this._artText = lum > 0.55 ? '#111111' : '#ffffff';
    } catch (_) { this._artText = ''; }
    this._render(); this._paint();
  }
  _cacheKey(track) { return `synced-lyrics-card:v1:${track.id}`; }
  _readCache(track) {
    try { const saved = JSON.parse(localStorage.getItem(this._cacheKey(track)) || 'null'); return saved && Date.now() - saved.saved < 2592000000 ? saved.data : null; } catch (_) { return null; }
  }
  _writeCache(track, data) {
    try { localStorage.setItem(this._cacheKey(track), JSON.stringify({saved: Date.now(), data})); } catch (_) {}
  }
  _applyLyrics(data) { this._lyrics = this._parseLrc(data?.syncedLyrics || ''); this._plainLyrics = data?.plainLyrics || ''; }
  async _loadLyrics(track) {
    const requestKey = this._trackKey;
    this._fetchKey = requestKey;
    const cached = this._readCache(track);
    if (cached) { this._applyLyrics(cached); this._render(); this._paint(); return; }
    const params = new URLSearchParams({track_name: track.title, artist_name: track.artist});
    if (track.album) params.set('album_name', track.album);
    if (track.duration) params.set('duration', String(track.duration));
    let data = null;
    try {
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 7000);
      let res = await fetch(`https://lrclib.net/api/get?${params}`, {headers: {'Accept': 'application/json'}, signal: controller.signal});
      if (res.ok) data = await res.json();
      if (!data?.syncedLyrics && !data?.plainLyrics) {
        const q = new URLSearchParams({track_name: track.title, artist_name: track.artist});
        res = await fetch(`https://lrclib.net/api/search?${q}`, {headers: {'Accept': 'application/json'}, signal: controller.signal});
        if (res.ok) { const results = await res.json(); data = results.find(x => x.syncedLyrics) || results[0] || null; }
      }
      clearTimeout(timeout);
    } catch (err) { console.warn('synced-lyrics-card: LRCLIB request failed', err); }
    if (this._trackKey !== requestKey) return;
    this._applyLyrics(data); if (data?.syncedLyrics || data?.plainLyrics) this._writeCache(track, data);
    this._render(); this._paint();
  }
  _parseLrc(text) {
    const entries = [];
    for (const raw of String(text).replace(/\r/g, '').split('\n')) {
      const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
      const line = raw.replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, '').trim();
      for (const tag of tags) { const frac = tag[3] ? Number(`0.${tag[3].padEnd(3,'0').slice(0,3)}`) : 0; entries.push({time: Number(tag[1]) * 60 + Number(tag[2]) + frac, text: line}); }
    }
    return entries.sort((a,b) => a.time - b.time);
  }
  _showSyncControl() {
    if (this._config?.show_sync_slider === false) return;
    const control = this.shadowRoot?.querySelector('.sync-control');
    if (!control) return;
    this._syncVisible = true; control.classList.add('visible');
    clearTimeout(this._syncHideTimer);
    this._syncHideTimer = setTimeout(() => { this._syncVisible = false; control.classList.remove('visible'); }, 10000);
  }
  _offset() { return Number.isFinite(this._liveOffset) ? this._liveOffset : Number(this._config?.sync_offset || 0); }
  _setOffset(value) {
    this._liveOffset = Math.round(Math.max(-10, Math.min(10, Number(value) || 0)) * 100) / 100;
    try { localStorage.setItem(this._syncKey || `synced-lyrics-card:offset:${this._config.entity}`, String(this._liveOffset)); } catch (_) {}
    const label = this.shadowRoot?.querySelector('#sync-value'), slider = this.shadowRoot?.querySelector('#sync-slider');
    if (label) label.textContent = `${this._liveOffset >= 0 ? '+' : ''}${this._liveOffset.toFixed(2)}s`;
    if (slider) slider.value = this._liveOffset;
    this._lastActive = -1; this._paint();
  }
  _position() {
    const s = this._state(); if (!s) return this._offset();
    const a = s.attributes || {}; let pos = Number(a.media_position) || 0;
    if (s.state === 'playing' && a.media_position_updated_at) { const at = Date.parse(a.media_position_updated_at); if (!Number.isNaN(at)) pos += Math.max(0, (Date.now() - at) / 1000); }
    return pos + this._offset();
  }
  _activeIndex(pos) { let found = -1; for (let i=0;i<this._lyrics.length;i++) { if (this._lyrics[i].time <= pos) found=i; else break; } return found; }
  _tick() { this._paint(); this._paintPlainLyrics(); this._paintIntro(); this._paintProgress(); this._raf = requestAnimationFrame(() => this._tick()); }
  _render() {
    if (!this._config) return;
    const c = this._config, s = this._state(), track = this._trackFromState(s);
    const useArt = c.background_mode === 'artwork' && this._artUrl;
    const textColor = c.text_color_mode === 'light' ? '#ffffff' : c.text_color_mode === 'dark' ? '#111111' : c.text_color_mode === 'auto' && useArt ? (this._artText || 'var(--primary-text-color)') : 'var(--primary-text-color)';
    const layout = c.layout || 'focus';
    const content = !track ? `<div class="empty">Select a track to display lyrics</div>` : this._lyrics.length ? `<div class="lyrics ${layout}" id="lyrics">${this._lyrics.map((l,i)=>`<div class="line${l.text ? '' : ' blank'}" data-index="${i}">${this._escape(l.text || ' ')}</div>`).join('')}</div>` : this._plainLyrics ? `<pre class="plain">${this._escape(this._plainLyrics)}</pre>` : `<div class="empty" id="loading">Loading lyrics for<br><b>${this._escape(track.title)}</b><small>${this._escape(track.artist)}</small></div>`;
    const firstTime = this._lyrics.length ? this._lyrics.find(l => l.text)?.time ?? 0 : 0;
    const introUntil = Math.max(firstTime, Math.max(0, Number(c.intro_duration ?? 4)));
    const showIntro = c.show_intro !== false && track && this._lyrics.length && this._position() < introUntil;
    const intro = showIntro ? `<div class="intro"><div class="intro-title">${this._escape(track.title)}</div><div class="intro-artist">${this._escape(track.artist)}</div></div>` : '';
    const volume = Math.round(Math.max(0, Math.min(1, Number(s?.attributes?.volume_level ?? 0))) * 100);
    const duration = Number(s?.attributes?.media_duration) || 0;
    const progress = duration ? Math.max(0, Math.min(100, this._position() / duration * 100)) : 0;
    const icons = c.media_icon_style === 'minimal' ? {prev:'‹‹', play:'▶', pause:'Ⅱ', next:'››'} : c.media_icon_style === 'filled' ? {prev:'⏮', play:'▶', pause:'⏸', next:'⏭'} : {prev:'◀◀', play:'▶', pause:'❚❚', next:'▶▶'};
    const controls = c.show_media_controls !== false ? `${c.show_progress_bar !== false ? `<div class="progress" title="Playback progress"><div id="progress-fill" style="width:${progress}%"></div></div>` : ''}<div class="media-controls"><button data-media="media_previous_track" title="Previous">${icons.prev}</button><button data-media="media_play_pause" class="play" title="Play/Pause">${s?.state === 'playing' ? icons.pause : icons.play}</button><button data-media="media_next_track" title="Next">${icons.next}</button><span class="volume">Vol</span><input id="volume-slider" type="range" min="0" max="100" step="1" value="${volume}"><output id="volume-value">${volume}%</output></div>` : '';
    const syncControl = c.show_sync_slider !== false ? `<div class="sync-control${this._syncVisible ? ' visible' : ''}">${controls}<div class="sync-row"><span>Sync</span><input id="sync-slider" type="range" min="-10" max="10" step="0.01" value="${this._offset()}"><button id="sync-reset" title="Reset sync offset">Reset</button><output id="sync-value">${this._offset() >= 0 ? '+' : ''}${this._offset().toFixed(2)}s</output></div></div>` : '';
    this.shadowRoot.innerHTML = `<style>
      :host{display:block} ha-card{height:${this._css(c.card_height)};box-sizing:border-box;overflow:hidden;background:${useArt ? 'transparent' : `color-mix(in srgb, ${this._css(c.background || 'var(--ha-card-background, var(--card-background-color, #1c1c1e))')} ${Math.max(0, Math.min(1, Number(c.background_opacity ?? 1))) * 100}%, transparent)`};color:${textColor};position:relative;isolation:isolate}ha-card::before{content:'';position:absolute;inset:-${useArt ? Math.max(0, Number(c.artwork_blur ?? 12)) * 2 : 0}px;z-index:-2;background-image:${useArt ? `url('${this._css(this._artUrl).replace(/'/g, '%27')}')` : 'none'};background-size:cover;background-position:center;filter:${useArt ? `blur(${Math.max(0, Number(c.artwork_blur ?? 12))}px)` : 'none'};opacity:${useArt ? Math.max(0, Math.min(1, Number(c.artwork_opacity ?? 1))) : 0}}ha-card::after{content:'';position:absolute;inset:0;z-index:-1;pointer-events:none;background:${useArt ? `rgba(0,0,0,${Math.max(0, Math.min(.9, Number(c.artwork_overlay_opacity ?? .35)))})` : 'transparent'}} .wrap{height:100%;overflow:hidden;display:flex;flex-direction:column}.meta{padding:14px 18px 0;text-align:${this._css(c.header_alignment === 'inherit' ? c.alignment : c.header_alignment)};font:500 ${Math.max(8, Math.min(48, Number(c.header_font_size ?? c.track_info_font_size ?? 13)))}px ${this._css(c.font_family)};color:color-mix(in srgb, currentColor 72%, transparent);background:transparent!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none!important;border:0;text-shadow:${c.text_shadow !== false ? `0 1px 2px rgba(0,0,0,${Math.max(0, Math.min(1, Number(c.text_shadow_strength ?? .75)))}), 0 0 10px rgba(0,0,0,${Math.max(0, Math.min(1, Number(c.text_shadow_strength ?? .75))) * .6})` : 'none'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meta.intro-hidden{display:none}.meta.split{display:flex;justify-content:space-between;gap:12px}.meta.split .track-title,.meta.split .track-artist{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta.split .track-artist{text-align:right}.meta.split.reverse .track-title{order:2;text-align:right}.meta.split.reverse .track-artist{order:1;text-align:left}.meta span{margin-left:6px}.viewport{position:relative;flex:1;overflow:hidden;display:flex;align-items:center;justify-content:center}.lyrics{position:absolute;top:0;left:0;width:100%;padding:0 8%;box-sizing:border-box;transition:transform .38s cubic-bezier(.2,.8,.2,1);will-change:transform}.line{font-family:${this._css(c.font_family)};font-size:${Number(c.font_size)||42}px;font-weight:${Number(c.font_weight)||700};line-height:1.25;text-align:${this._css(c.alignment)};opacity:${Number(c.inactive_opacity) ?? .32};transform:scale(1);transition:opacity .25s,transform .25s,filter .25s;transform-origin:${c.alignment === 'left' ? 'left' : c.alignment === 'right' ? 'right' : 'center'};padding:7px 0;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere;word-break:normal}.line.blank{height:1.25em}.line.active{opacity:1;transform:scale(1);filter:drop-shadow(0 1px 12px color-mix(in srgb, var(--primary-text-color) 25%, transparent))}.compact .line,.two_line .line{display:none}.compact .line.active{display:block}.two_line .line.active,.two_line .line.next{display:block}.minimal .line:not(.active){display:none}.minimal{padding:0 8%}.karaoke .line{padding:10px 0}.plain{width:100%;height:100%;overflow:auto;box-sizing:border-box;margin:0;padding:22px;white-space:pre-wrap;font-family:${this._css(c.font_family)};font-size:${Number(c.font_size)*.6||24}px;line-height:1.55;text-align:${this._css(c.alignment)}}.empty{text-align:${this._css(c.alignment)};line-height:1.55;color:var(--secondary-text-color);font:400 17px system-ui}.empty b{color:var(--primary-text-color);font-weight:600}.empty small{display:block;font-size:13px}.intro{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;text-align:center;pointer-events:none;animation:intro-in .35s ease;opacity:1;transform:scale(1);transition:opacity .4s ease,transform .4s ease}.intro.hidden{opacity:0;transform:scale(.97);visibility:hidden}.intro-title{font-family:${this._css(c.font_family)};font-size:${Math.max(20,Math.min(120,Number(c.intro_font_size ?? 48)))}px;font-weight:${Number(c.font_weight)||700};line-height:1.12;text-shadow:${c.text_shadow !== false ? `0 1px 2px rgba(0,0,0,${Math.max(0, Math.min(1, Number(c.text_shadow_strength ?? .75)))}),0 0 10px rgba(0,0,0,${Math.max(0, Math.min(1, Number(c.text_shadow_strength ?? .75)))*.6})` : 'none'}}.intro-artist{margin-top:10px;font-family:${this._css(c.font_family)};font-size:${Math.max(14,Math.round(Math.max(20,Math.min(120,Number(c.intro_font_size ?? 48)))*.48))}px;font-weight:500;opacity:.78;text-shadow:inherit}@keyframes intro-in{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}.sync-control{position:absolute;z-index:3;left:12px;right:12px;bottom:7px;padding:6px 8px;border-radius:9px;background:rgba(0,0,0,.48);backdrop-filter:blur(8px);font:12px system-ui;color:#fff;opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .2s ease,transform .2s ease}.sync-control.visible{opacity:1;transform:translateY(0);pointer-events:auto}.media-controls,.sync-row{height:${Math.max(24,Math.min(64,Number(c.media_controls_size ?? 30)))}px;display:flex;align-items:center;gap:8px}.progress{height:${Math.max(2,Math.min(16,Number(c.progress_bar_height ?? 5)))}px;margin:1px 1px 5px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.22)}.progress>div{height:100%;border-radius:inherit;background:${this._css(c.progress_bar_color || 'var(--primary-color)')};transition:width .2s linear}.sync-row{margin-top:3px}.sync-control input{flex:1;accent-color:var(--primary-color,#03a9f4);cursor:pointer}.sync-control button{border:0;border-radius:5px;padding:4px 7px;background:rgba(255,255,255,.18);color:#fff;cursor:pointer;font:11px system-ui}.media-controls button{width:${Math.max(24,Math.min(64,Number(c.media_controls_size ?? 30)))}px;height:${Math.max(24,Math.min(64,Number(c.media_controls_size ?? 30)))}px;padding:4px 0}.media-controls .play{font-size:14px}.media-controls .volume{margin-left:6px}.sync-control output{min-width:42px;text-align:right;font-variant-numeric:tabular-nums} .status{position:absolute;right:10px;bottom:8px;font:11px system-ui;color:var(--disabled-text-color)}
      /* One contrast treatment covers the entire card; the header never becomes a separate panel. */
      ha-card::after{backdrop-filter:${c.contrast_mode === 'adaptive' ? `blur(${Math.max(0, Number(c.backdrop_blur ?? 8))}px) brightness(75%)` : 'none'};-webkit-backdrop-filter:${c.contrast_mode === 'adaptive' ? `blur(${Math.max(0, Number(c.backdrop_blur ?? 8))}px) brightness(75%)` : 'none'};background:${c.contrast_mode === 'adaptive' ? `linear-gradient(rgba(0,0,0,${Math.max(0, Math.min(.8, Number(c.backdrop_opacity ?? .18))) }),rgba(0,0,0,${Math.max(0, Math.min(.8, Number(c.backdrop_opacity ?? .18))) }))` : (useArt ? `rgba(0,0,0,${Math.max(0, Math.min(.9, Number(c.artwork_overlay_opacity ?? .35)))})` : 'transparent')}!important}
      .lyrics,.plain,.empty{position:relative;z-index:1}.line{text-shadow:${c.text_shadow !== false ? `0 1px 2px rgba(0,0,0,${Math.max(0, Math.min(1, Number(c.text_shadow_strength ?? .75)))}), 0 0 10px rgba(0,0,0,${Math.max(0, Math.min(1, Number(c.text_shadow_strength ?? .75))) * .6})` : 'none'}}
    </style><ha-card><div class="wrap">${c.show_track_info !== false ? `<div class="meta ${showIntro ? 'intro-hidden' : ''} ${c.header_layout === 'split' || c.header_layout === 'split_reverse' ? `split ${c.header_layout === 'split_reverse' ? 'reverse' : ''}` : ''}">${track ? ((c.header_layout === 'split' || c.header_layout === 'split_reverse') ? `<span class="track-title">${this._escape(track.title)}</span><span class="track-artist">${this._escape(track.artist)}</span>` : `${this._escape(track.title)}<span>— ${this._escape(track.artist)}</span>`) : 'Synced Lyrics'}</div>` : ''}<div class="viewport">${content}</div>${syncControl}<div class="status">${this._lyrics.length ? 'LRCLIB synced' : this._plainLyrics ? 'LRCLIB lyrics' : ''}</div></div></ha-card>`;
    const slider = this.shadowRoot.querySelector('#sync-slider');
    slider?.addEventListener('input', (event) => { this._setOffset(event.target.value); this._showSyncControl(); });
    this.shadowRoot.querySelector('#sync-reset')?.addEventListener('click', () => { this._setOffset(0); this._showSyncControl(); });
    this.shadowRoot.querySelectorAll('[data-media]').forEach((button) => button.addEventListener('click', () => { this._hass?.callService('media_player', button.dataset.media, {entity_id: this._config.entity}); this._showSyncControl(); }));
    this.shadowRoot.querySelector('#volume-slider')?.addEventListener('input', (event) => { const value = Number(event.target.value); const output = this.shadowRoot.querySelector('#volume-value'); if (output) output.textContent = `${value}%`; clearTimeout(this._volumeTimer); this._volumeTimer = setTimeout(() => this._hass?.callService('media_player', 'volume_set', {entity_id: this._config.entity, volume_level: value / 100}), 120); this._showSyncControl(); });
    this.shadowRoot.querySelector('ha-card')?.addEventListener('click', (event) => { if (!event.target.closest('.sync-control')) this._showSyncControl(); });
  }
  _paintIntro() {
    const intro = this.shadowRoot?.querySelector('.intro'); if (!intro) return;
    const first = this._lyrics.find(l => l.text)?.time ?? 0;
    const until = Math.max(first, Math.max(0, Number(this._config?.intro_duration ?? 4)));
    const visible = this._config?.show_intro !== false && this._position() < until;
    intro.classList.toggle('hidden', !visible);
    this.shadowRoot.querySelector('.meta')?.classList.toggle('intro-hidden', visible);
  }
  _paintProgress() {
    const fill = this.shadowRoot?.querySelector('#progress-fill'); if (!fill) return;
    const duration = Number(this._state()?.attributes?.media_duration) || 0;
    const percent = duration ? Math.max(0, Math.min(100, this._position() / duration * 100)) : 0;
    fill.style.width = `${percent}%`;
  }
  _paintPlainLyrics() {
    if (!this._plainLyrics || !this._config?.plain_lyrics_auto_scroll || !this.shadowRoot) return;
    const plain = this.shadowRoot.querySelector('.plain');
    const state = this._state(); const duration = Number(state?.attributes?.media_duration) || 0;
    if (!plain || !duration || state?.state !== 'playing') return;
    const maxScroll = Math.max(0, plain.scrollHeight - plain.clientHeight);
    // Map the player's real elapsed position across the whole scrollable lyric sheet.
    plain.scrollTop = Math.max(0, Math.min(maxScroll, (this._position() / duration) * maxScroll));
  }
  _fitActiveLine(active) {
    if (!active) return;
    const base = Number(this._config?.font_size) || 42;
    const target = base * (Number(this._config?.active_scale) || 1.16);
    // Increase the actual font size (rather than CSS transform scaling) so text
    // reflows naturally. Reduce it only when its wrapped layout still exceeds
    // the lyric sheet's usable width.
    active.style.fontSize = `${target}px`;
    const maxWidth = active.parentElement?.clientWidth || active.clientWidth;
    let size = target;
    while (size > 12 && active.scrollWidth > maxWidth + 1) {
      size -= 1; active.style.fontSize = `${size}px`;
    }
  }
  _paint() {
    if (!this._lyrics.length || !this.shadowRoot) return;
    const index = this._activeIndex(this._position()); if (index === this._lastActive) return; this._lastActive = index;
    const root = this.shadowRoot.querySelector('#lyrics'); if (!root) return;
    const lines = [...root.querySelectorAll('.line')]; lines.forEach((el,i) => { el.classList.toggle('active', i===index); el.classList.toggle('next', i===index+1); el.style.fontSize = ''; });
    const active = lines[index]; this._fitActiveLine(active); const layout = this._config.layout;
    if (active && !['compact','two_line','minimal'].includes(layout)) {
      const viewport = this.shadowRoot.querySelector('.viewport');
      const card = this.shadowRoot.querySelector('ha-card');
      // getBoundingClientRect() keeps all coordinates in the same space. This
      // avoids karaoke-mode layout/offset-parent differences putting the active
      // line outside the visible card.
      const activeBox = active.getBoundingClientRect();
      const rootBox = root.getBoundingClientRect();
      const cardBox = card.getBoundingClientRect();
      const cardCentre = cardBox.top + cardBox.height / 2;
      const activeCentre = activeBox.top + activeBox.height / 2;
      this._translateY = Math.round(this._translateY + (cardCentre - activeCentre));
      root.style.transform = `translateY(${this._translateY}px)`;
    }
  }
  _escape(value) { const d=document.createElement('div'); d.textContent=String(value); return d.innerHTML; }
  _css(value) { return String(value ?? '').replace(/[<>{};]/g, ''); }
}

class SyncedLyricsCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = null; this._hass = null; this._forms = [];
    this._sections = [
      ['Player and layout', [
        {name:'entity', selector:{entity:{domain:'media_player'}}},
        {name:'layout', selector:{select:{mode:'dropdown',options:[{label:'Focus — scrolling lyrics',value:'focus'},{label:'Karaoke — scrolling lyrics',value:'karaoke'},{label:'Compact — active line only',value:'compact'},{label:'Two line — active and next',value:'two_line'},{label:'Minimal — active line only',value:'minimal'}]}}},
        {name:'card_height', selector:{text:{}}},
        {name:'show_track_info', selector:{boolean:{}}},
        {name:'show_intro', selector:{boolean:{}}},
        {name:'intro_duration', selector:{number:{min:0,max:30,step:0.5,mode:'box',unit_of_measurement:'s'}}},
        {name:'intro_font_size', selector:{number:{min:20,max:120,step:1,mode:'box',unit_of_measurement:'px'}}},
      ]],
      ['Media controls', [
        {name:'show_media_controls', selector:{boolean:{}}},
        {name:'media_controls_size', selector:{number:{min:24,max:64,step:1,mode:'box',unit_of_measurement:'px'}}},
        {name:'media_icon_style', selector:{select:{mode:'dropdown',options:[{label:'Standard',value:'standard'},{label:'Filled media icons',value:'filled'},{label:'Minimal chevrons',value:'minimal'}]}}},
        {name:'show_progress_bar', selector:{boolean:{}}},
        {name:'progress_bar_height', selector:{number:{min:2,max:16,step:1,mode:'box',unit_of_measurement:'px'}}},
        {name:'progress_bar_color', selector:{text:{}}},
      ]],
      ['Lyrics appearance', [
        {name:'alignment', selector:{select:{mode:'dropdown',options:[{label:'Left',value:'left'},{label:'Centre',value:'center'},{label:'Right',value:'right'}]}}},
        {name:'font_family', selector:{select:{mode:'dropdown',custom_value:true,options:[{label:'System UI',value:'system-ui'},{label:'Roboto',value:'Roboto, sans-serif'},{label:'Inter',value:'Inter, sans-serif'},{label:'Montserrat',value:'Montserrat, sans-serif'},{label:'Poppins',value:'Poppins, sans-serif'},{label:'Serif',value:'serif'},{label:'Monospace',value:'monospace'}]}}},
        {name:'font_size', selector:{number:{min:12,max:120,step:1,mode:'box',unit_of_measurement:'px'}}},
        {name:'font_weight', selector:{number:{min:100,max:900,step:100,mode:'box'}}},
        {name:'inactive_opacity', selector:{number:{min:0,max:1,step:0.05,mode:'box'}}},
        {name:'active_scale', selector:{number:{min:1,max:2,step:0.01,mode:'box'}}},
        {name:'plain_lyrics_auto_scroll', selector:{boolean:{}}},
      ]],
      ['Track header', [
        {name:'header_font_size', selector:{number:{min:8,max:48,step:1,mode:'box',unit_of_measurement:'px'}}},
        {name:'header_alignment', selector:{select:{mode:'dropdown',options:[{label:'Same as lyrics',value:'inherit'},{label:'Left',value:'left'},{label:'Centre',value:'center'},{label:'Right',value:'right'}]}}},
        {name:'header_layout', selector:{select:{mode:'dropdown',options:[{label:'Title and artist together',value:'combined'},{label:'Title left, artist right',value:'split'},{label:'Artist left, title right',value:'split_reverse'}]}}},
      ]],
      ['Background and contrast', [
        {name:'background_mode', selector:{select:{mode:'dropdown',options:[{label:'Home Assistant theme',value:'theme'},{label:'Album artwork',value:'artwork'}]}}},
        {name:'background_opacity', selector:{number:{min:0,max:1,step:0.01,mode:'box'}}},
        {name:'artwork_blur', selector:{number:{min:0,max:40,step:1,mode:'box',unit_of_measurement:'px'}}},
        {name:'artwork_opacity', selector:{number:{min:0,max:1,step:0.01,mode:'box'}}},
        {name:'artwork_overlay_opacity', selector:{number:{min:0,max:0.9,step:0.01,mode:'box'}}},
        {name:'text_color_mode', selector:{select:{mode:'dropdown',options:[{label:'Auto contrast from artwork',value:'auto'},{label:'Home Assistant theme',value:'theme'},{label:'Always light',value:'light'},{label:'Always dark',value:'dark'}]}}},
        {name:'contrast_mode', selector:{select:{mode:'dropdown',options:[{label:'Adaptive contrast',value:'adaptive'},{label:'Off',value:'off'}]}}},
        {name:'backdrop_blur', selector:{number:{min:0,max:30,step:1,mode:'box',unit_of_measurement:'px'}}},
        {name:'backdrop_opacity', selector:{number:{min:0,max:0.8,step:0.01,mode:'box'}}},
        {name:'text_shadow', selector:{boolean:{}}},
        {name:'text_shadow_strength', selector:{number:{min:0,max:1,step:0.05,mode:'box'}}},
      ]],
      ['Sync control', [
        {name:'show_sync_slider', selector:{boolean:{}}},
        {name:'sync_offset', selector:{number:{min:-10,max:10,step:0.01,mode:'box',unit_of_measurement:'s'}}},
      ]],
    ];
  }
  setConfig(config) { this._config = {...SyncedLyricsCard.getStubConfig(), ...config}; this._build(); this._sync(); }
  set hass(hass) { this._hass = hass; this._build(); this._sync(); }
  _label(name) {
    return ({entity:'Media player',layout:'Layout',card_height:'Card height (for example 560px)',show_track_info:'Show track title and artist',show_intro:'Show track intro before first lyric',intro_duration:'Minimum intro duration',intro_font_size:'Intro title size',show_media_controls:'Show media controls on tap',media_controls_size:'Control button size',media_icon_style:'Icon style',show_progress_bar:'Show progress bar',progress_bar_height:'Progress bar height',progress_bar_color:'Progress bar colour (CSS)',alignment:'Lyrics alignment',font_family:'Lyrics font',font_size:'Lyrics font size',font_weight:'Lyrics font weight',inactive_opacity:'Inactive lyric opacity',active_scale:'Active lyric scale',plain_lyrics_auto_scroll:'Auto-scroll plain lyrics to song duration',header_font_size:'Header font size',header_alignment:'Header alignment',header_layout:'Header layout',background_mode:'Background source',background_opacity:'Theme background opacity',artwork_blur:'Album artwork blur',artwork_opacity:'Album artwork opacity',artwork_overlay_opacity:'Album artwork dark overlay',text_color_mode:'Lyric colour',contrast_mode:'Adaptive contrast',backdrop_blur:'Contrast blur',backdrop_opacity:'Contrast overlay opacity',text_shadow:'Text drop shadows',text_shadow_strength:'Text shadow strength',show_sync_slider:'Show on-card sync slider',sync_offset:'Starting sync offset'})[name] || name;
  }
  _build() {
    if (this._forms.length) return;
    const style=document.createElement('style');
    style.textContent='.editor-section{border-top:1px solid var(--divider-color);padding:14px 0 6px}.editor-section:first-child{border-top:0;padding-top:4px}.editor-section h3{margin:0 8px 7px;font-size:15px;font-weight:500;color:var(--primary-text-color)}ha-form{display:block;padding:0 4px}';
    this.appendChild(style);
    this._sections.forEach(([title,schema]) => {
      const section=document.createElement('section'); section.className='editor-section';
      const heading=document.createElement('h3'); heading.textContent=title; section.appendChild(heading);
      const form=document.createElement('ha-form'); form.schema=schema;
      form.computeLabel=(item)=>this._label(item.name);
      form.addEventListener('value-changed',(ev)=>{
        ev.stopPropagation();
        const config={...this._config,...(ev.detail?.value||{})}; this._config=config;
        this.dispatchEvent(new CustomEvent('config-changed',{detail:{config},bubbles:true,composed:true}));
      });
      section.appendChild(form); this.appendChild(section); this._forms.push({form,schema});
    });
  }
  _sync() { this._forms.forEach(({form,schema})=>{form.hass=this._hass;form.schema=schema;form.data=this._config||{};}); }
}
customElements.define('synced-lyrics-card', SyncedLyricsCard);
customElements.define('synced-lyrics-card-editor', SyncedLyricsCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({type:'synced-lyrics-card', name:'Synced Lyrics Card', description:'Synchronized LRCLIB lyrics for a media player.', preview:true, documentationURL:'https://lrclib.net/docs'});

class SongInfoCard extends HTMLElement {
  static getStubConfig() { return {entity:'', card_height:'auto', show_artist_info:true, show_track_info:true, show_release_info:true, show_tags:true, show_credits:true, show_identifiers:false, show_bio:true, show_wikipedia:true, wikipedia_length:900, show_annotation:true, font_family:'system-ui', title_font_size:24, body_font_size:14, font_weight:700, alignment:'left', background_mode:'theme', background_opacity:1, artwork_blur:12, artwork_opacity:1, artwork_overlay_opacity:.45, text_color_mode:'auto', text_shadow:true, text_shadow_strength:.7}; }
  static getConfigElement(){return document.createElement('song-info-card-editor')}
  setConfig(config) { if (!config?.entity) throw new Error('Set a media_player entity'); this._config={...SongInfoCard.getStubConfig(),...config}; this._key=''; this._data=null; this._render(); }
  set hass(hass) { this._hass=hass; this._update(); }
  getCardSize() { return 4; }
  _state() { return this._hass?.states?.[this._config?.entity]; }
  _css(v){return String(v??'').replace(/[<>{};]/g,'')}
  async _wait() {const last=window.__songInfoMbLast||0,delay=Math.max(0,1100-(Date.now()-last));if(delay)await new Promise(r=>setTimeout(r,delay));window.__songInfoMbLast=Date.now()}
  async _get(url) {await this._wait();const r=await fetch(url,{headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`MusicBrainz returned ${r.status}`);return r.json()}
  _update(){const a=this._state()?.attributes||{},title=a.media_title||'',artist=a.media_artist||'',key=`${artist}|${title}|${a.media_duration||''}`;if(!title||!artist||key===this._key)return;this._key=key;this._data=null;this._render();this._load(title,artist,key)}
  async _load(title,artist,key){try{const q=`recording:"${title.replace(/"/g,'')}" AND artist:"${artist.replace(/"/g,'')}"`;const search=await this._get(`https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(q)}&fmt=json&limit=5`);let r=(search.recordings||[]).sort((x,y)=>(y.score||0)-(x.score||0))[0];if(!r||key!==this._key)throw new Error('No matching MusicBrainz recording found');r=await this._get(`https://musicbrainz.org/ws/2/recording/${r.id}?inc=artist-credits+releases+tags+genres+isrcs+work-rels+artist-rels&fmt=json`);const credited=(r['artist-credit']||[]).map(x=>x.name||x.artist?.name).filter(Boolean).join(', '),artistId=r['artist-credit']?.[0]?.artist?.id;let ai={};if(artistId)ai=await this._get(`https://musicbrainz.org/ws/2/artist/${artistId}?inc=tags+annotation+url-rels&fmt=json`);let wiki={};const wikiUrl=(ai.relations||[]).find(x=>x.type==='wikipedia'&&x.url?.resource)?.url?.resource;if(wikiUrl){const page=decodeURIComponent(wikiUrl.split('/wiki/')[1]||'');wiki=await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(page)}&format=json&origin=*`).then(x=>x.ok?x.json():{}).catch(()=>({}));}if(!wiki?.query?.pages){wiki=await fetch(`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(credited||artist)}&gsrlimit=1&gsrnamespace=0&prop=extracts&exintro=1&explaintext=1&format=json&origin=*`).then(x=>x.ok?x.json():{}).catch(()=>({}));}if(key!==this._key)return;const release=r.releases?.[0];this._data={title:r.title,artist:credited||artist,mbid:r.id,date:release?.date||r['first-release-date'],album:release?.title,country:release?.country,releaseStatus:release?.status||'',releaseType:release?.['release-group']?.['primary-type']||'',duration:r.length?`${Math.floor(r.length/60000)}:${String(Math.floor(r.length/1000)%60).padStart(2,'0')}`:'',genres:[...(r.genres||[]),...(r.tags||[]),...(ai.tags||[])].map(x=>x.name).filter((v,i,a)=>a.indexOf(v)===i).slice(0,10),isrcs:r.isrcs||[],works:(r.relations||[]).filter(x=>x['target-type']==='work').map(x=>x.work).filter(Boolean),credits:(r.relations||[]).filter(x=>x['target-type']==='artist').map(x=>`${x.type}: ${x.artist?.name||''}`).filter(Boolean),annotation:ai.annotation?.text||r.annotation?.text||'',artistType:ai.type||'',area:ai.area?.name||'',life:ai['life-span']||{},wiki:Object.values(wiki?.query?.pages||{})[0]||{}};this._render()}catch(e){if(key===this._key){this._data={error:e.message};this._render()}}}
  _esc(x){const d=document.createElement('div');d.textContent=x??'';return d.innerHTML}
  _render(){if(!this._config)return;if(!this.shadowRoot)this.attachShadow({mode:'open'});const d=this._data,c=this._config,a=this._state()?.attributes||{},art=a.entity_picture||a.media_image_url||'',useArt=c.background_mode==='artwork'&&art,loading=!d,life=d?.life?.begin?`${d.life.begin}${d.life.end?' – '+d.life.end:''}`:'',align=this._css(c.alignment),titleSize=Math.max(14,Math.min(72,Number(c.title_font_size)||24)),bodySize=Math.max(10,Math.min(36,Number(c.body_font_size)||14)),shadow=c.text_shadow!==false?`0 1px 3px rgba(0,0,0,${Math.max(0,Math.min(1,Number(c.text_shadow_strength??.7)))}),0 0 12px rgba(0,0,0,${Math.max(0,Math.min(1,Number(c.text_shadow_strength??.7)))*.45})`:'none',colour=c.text_color_mode==='light'?'#fff':c.text_color_mode==='dark'?'#111':'var(--primary-text-color)',artistInfo=d&&!d.error&&c.show_artist_info!==false?`<section><h3>Artist info</h3><dl>${d.artistType?`<dt>Type</dt><dd>${this._esc(d.artistType)}</dd>`:''}${d.area?`<dt>Area</dt><dd>${this._esc(d.area)}</dd>`:''}${life?`<dt>Active</dt><dd>${this._esc(life)}</dd>`:''}</dl></section>`:'',trackInfo=d&&!d.error&&c.show_track_info!==false?`<section><h3>Track info</h3><dl>${d.duration?`<dt>Duration</dt><dd>${this._esc(d.duration)}</dd>`:''}${d.works?.map(w=>`<dt>Work</dt><dd>${this._esc(w.title)}</dd>`).join('')||''}</dl></section>`:'',releaseInfo=d&&!d.error&&c.show_release_info!==false?`<section><h3>Release info</h3><dl>${d.album?`<dt>Album</dt><dd>${this._esc(d.album)}</dd>`:''}${d.date?`<dt>First release</dt><dd>${this._esc(d.date)}</dd>`:''}${d.country?`<dt>Country</dt><dd>${this._esc(d.country)}</dd>`:''}${d.releaseStatus?`<dt>Status</dt><dd>${this._esc(d.releaseStatus)}</dd>`:''}${d.releaseType?`<dt>Type</dt><dd>${this._esc(d.releaseType)}</dd>`:''}</dl></section>`:'',tags=d&&!d.error&&c.show_tags!==false&&d.genres?.length?`<section><h3>Genres & tags</h3><p>${this._esc(d.genres.join(', '))}</p></section>`:'',credits=d&&!d.error&&c.show_credits!==false&&d.credits?.length?`<section><h3>Credits</h3><p>${this._esc(d.credits.join(' · '))}</p></section>`:'',identifiers=d&&!d.error&&c.show_identifiers===true&&d.isrcs?.length?`<section><h3>Identifiers</h3><p>${this._esc(d.isrcs.join(', '))}</p></section>`:'',wiki=d&&!d.error&&c.show_wikipedia!==false&&d.wiki?.extract?`<section><h3>Wikipedia</h3><p class="wiki">${this._esc(d.wiki.extract.slice(0,Math.max(200,Math.min(3000,Number(c.wikipedia_length)||900))))}${d.wiki.extract.length>(Number(c.wikipedia_length)||900)?'…':''}</p><a href="https://en.wikipedia.org/?curid=${this._esc(d.wiki.pageid)}" target="_blank" rel="noreferrer">Read on Wikipedia ↗</a></section>`:'',bio=d&&!d.error&&c.show_bio!==false?`<section><h3>Artist bio</h3><p>${this._esc([d.artistType,d.area,life].filter(Boolean).join(' · ')||'No structured artist biography is available from MusicBrainz for this artist.')}</p></section>`:'',note=d&&!d.error&&c.show_annotation!==false&&d.annotation?`<section><h3>MusicBrainz notes</h3><p class="annotation">${this._esc(d.annotation)}</p></section>`:'',link=d&&!d.error?`<a href="https://musicbrainz.org/recording/${encodeURIComponent(d.mbid)}" target="_blank" rel="noreferrer">Open in MusicBrainz ↗</a>`:'';this.shadowRoot.innerHTML=`<style>:host{display:block}ha-card{min-height:${this._css(c.card_height)==='auto'?'0':this._css(c.card_height)};padding:18px;box-sizing:border-box;position:relative;isolation:isolate;overflow:hidden;color:${colour};text-align:${align};background:${useArt?'transparent':`color-mix(in srgb, ${this._css(c.background||'var(--ha-card-background, var(--card-background-color))')} ${Math.max(0,Math.min(1,Number(c.background_opacity??1))*100)}%,transparent)`}}ha-card:before{content:'';position:absolute;inset:-${useArt?Math.max(0,Number(c.artwork_blur??12))*2:0}px;z-index:-2;background:${useArt?`url('${this._css(art).replace(/'/g,'%27')}') center/cover`:'none'};filter:blur(${useArt?Math.max(0,Number(c.artwork_blur??12)):0}px);opacity:${useArt?Math.max(0,Math.min(1,Number(c.artwork_opacity??1))):0}}ha-card:after{content:'';position:absolute;inset:0;z-index:-1;background:${useArt?`rgba(0,0,0,${Math.max(0,Math.min(.9,Number(c.artwork_overlay_opacity??.45)))})`:'transparent'}}h2{font:${Number(c.font_weight)||700} ${titleSize}px/1.2 ${this._css(c.font_family)};margin:0 0 4px;text-shadow:${shadow}}h3{font:600 ${Math.max(10,bodySize-1)}px ${this._css(c.font_family)};margin:18px 0 5px;color:inherit;opacity:.75;text-transform:uppercase;letter-spacing:.04em;text-shadow:${shadow}}p,.artist,dd{font:400 ${bodySize}px/1.5 ${this._css(c.font_family)};margin:0;text-shadow:${shadow}}.artist,dt{opacity:.74}dl{display:grid;grid-template-columns:max-content 1fr;gap:5px 14px;margin:16px 0 0;font:${bodySize}px/1.35 ${this._css(c.font_family)};text-align:left}dd{margin:0}.annotation{white-space:pre-wrap}section a{margin-top:6px}a{display:inline-block;margin-top:18px;color:inherit;font:500 ${bodySize}px ${this._css(c.font_family)};text-shadow:${shadow}.loading,.error{font:${bodySize}px/1.5 ${this._css(c.font_family)};opacity:.75}.error{color:var(--error-color)}</style><ha-card>${loading?'<p class="loading">Looking up current track in MusicBrainz…</p>':d.error?`<p class="error">${this._esc(d.error)}</p>`:`<h2>${this._esc(d.title)}</h2><p class="artist">${this._esc(d.artist)}</p>${artistInfo}${trackInfo}${releaseInfo}${tags}${credits}${identifiers}${wiki}${bio}${note}${link}`}</ha-card>`}
}
class SongInfoCardEditor extends HTMLElement {
  constructor(){super();this._config={};this._hass=null;this._built=false}
  setConfig(c){this._config={...SongInfoCard.getStubConfig(),...c};this._render()}
  set hass(h){this._hass=h;this._render()}
  _label(n){return ({entity:'Media player',show_artist_info:'Show artist information',show_track_info:'Show track information',show_release_info:'Show release information',show_tags:'Show genres and tags',show_credits:'Show recording credits',show_identifiers:'Show identifiers (ISRC)',show_bio:'Show artist bio summary',show_wikipedia:'Show Wikipedia biography',wikipedia_length:'Wikipedia maximum characters',show_annotation:'Show MusicBrainz notes',card_height:'Card height (or auto)',alignment:'Text alignment',font_family:'Font family',title_font_size:'Title font size',body_font_size:'Body font size',font_weight:'Title font weight',text_color_mode:'Text colour',text_shadow:'Text drop shadow',text_shadow_strength:'Text shadow strength',background_mode:'Background source',background_opacity:'Theme background opacity',artwork_blur:'Artwork blur',artwork_opacity:'Artwork opacity',artwork_overlay_opacity:'Artwork dark overlay'})[n]||n}
  _emit(name,value){this._config={...this._config,[name]:value};this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:this._config},bubbles:true,composed:true}))}
  _render(){if(this._built)return;this._built=true;const groups=[['Track information',['entity','show_artist_info','show_track_info','show_release_info','show_tags','show_credits','show_identifiers','show_bio','show_wikipedia','wikipedia_length','show_annotation','card_height']],['Text appearance',['alignment','font_family','title_font_size','body_font_size','font_weight','text_color_mode','text_shadow','text_shadow_strength']],['Background',['background_mode','background_opacity','artwork_blur','artwork_opacity','artwork_overlay_opacity']]];const selects={alignment:[['left','Left'],['center','Centre'],['right','Right']],font_family:[['system-ui','System UI'],['Roboto, sans-serif','Roboto'],['Inter, sans-serif','Inter'],['Montserrat, sans-serif','Montserrat'],['Poppins, sans-serif','Poppins'],['serif','Serif']],text_color_mode:[['auto','Home Assistant theme'],['light','Light'],['dark','Dark']],background_mode:[['theme','Home Assistant theme'],['artwork','Current album artwork']]};const bools=new Set(['show_artist_info','show_track_info','show_release_info','show_tags','show_credits','show_identifiers','show_bio','show_wikipedia','show_annotation','text_shadow']);const nums=new Set(['title_font_size','body_font_size','font_weight','text_shadow_strength','background_opacity','artwork_blur','artwork_opacity','artwork_overlay_opacity','wikipedia_length']);this.innerHTML='<style>.section{border-top:1px solid var(--divider-color);padding:14px 8px 6px}.section:first-child{border:0;padding-top:4px}h3{margin:0 0 10px;font-size:15px;font-weight:500}.row{display:flex;align-items:center;gap:12px;min-height:44px;font-size:14px}.row label{flex:1}.row input:not([type=checkbox]),.row select{width:160px;box-sizing:border-box;padding:7px;border:1px solid var(--divider-color);border-radius:4px;background:var(--card-background-color);color:var(--primary-text-color)}.row input[type=checkbox]{width:18px;height:18px}</style>';groups.forEach(([title,fields])=>{const sec=document.createElement('section');sec.className='section';const h=document.createElement('h3');h.textContent=title;sec.append(h);fields.forEach(name=>{const row=document.createElement('div');row.className='row';const label=document.createElement('label');label.textContent=this._label(name);row.append(label);let el;if(name==='entity'){el=document.createElement('input');el.type='text';el.placeholder='media_player.example';el.value=this._config[name]||''}else if(bools.has(name)){el=document.createElement('input');el.type='checkbox';el.checked=!!this._config[name]}else if(selects[name]){el=document.createElement('select');selects[name].forEach(([value,text])=>{const o=document.createElement('option');o.value=value;o.textContent=text;if(String(this._config[name])===value)o.selected=true;el.append(o)})}else{el=document.createElement('input');el.type=nums.has(name)?'number':'text';el.value=this._config[name]??'';if(name==='title_font_size'){el.min=14;el.max=72}else if(name==='body_font_size'){el.min=10;el.max=36}else if(name==='font_weight'){el.min=100;el.max=900;el.step=100}else if(nums.has(name)){el.min=0;el.max=name==='artwork_blur'?40:1;el.step=.01}}el.addEventListener('change',()=>this._emit(name,bools.has(name)?el.checked:(nums.has(name)?Number(el.value):el.value)));row.append(el);sec.append(row)});this.append(sec)})}
}
customElements.define('song-info-card',SongInfoCard);customElements.define('song-info-card-editor',SongInfoCardEditor);window.customCards.push({type:'song-info-card',name:'Song Info Card',description:'Current-track metadata and artist details from MusicBrainz.',preview:true,documentationURL:'https://musicbrainz.org/doc/MusicBrainz_API'});
