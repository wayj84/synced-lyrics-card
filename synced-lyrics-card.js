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
      :host{display:block} ha-card{height:${this._css(c.card_height)};box-sizing:border-box;overflow:hidden;background:${c.background_mode==='transparent'?'transparent':(useArt ? 'transparent' : `color-mix(in srgb, ${this._css(c.background || 'var(--ha-card-background, var(--card-background-color, #1c1c1e))')} ${Math.max(0, Math.min(1, Number(c.background_opacity ?? 1))) * 100}%, transparent)`)};box-shadow:${c.background_mode==='transparent'?'none':'var(--ha-card-box-shadow, none)'};border:${c.background_mode==='transparent'?'none':'var(--ha-card-border-width, 0) solid var(--divider-color)'};color:${textColor};position:relative;isolation:isolate}ha-card::before{content:'';position:absolute;inset:-${useArt ? Math.max(0, Number(c.artwork_blur ?? 12)) * 2 : 0}px;z-index:-2;background-image:${useArt ? `url('${this._css(this._artUrl).replace(/'/g, '%27')}')` : 'none'};background-size:cover;background-position:center;filter:${useArt ? `blur(${Math.max(0, Number(c.artwork_blur ?? 12))}px)` : 'none'};opacity:${useArt ? Math.max(0, Math.min(1, Number(c.artwork_opacity ?? 1))) : 0}}ha-card::after{content:'';position:absolute;inset:0;z-index:-1;pointer-events:none;background:${useArt ? `rgba(0,0,0,${Math.max(0, Math.min(.9, Number(c.artwork_overlay_opacity ?? .35)))})` : 'transparent'}} .wrap{height:100%;overflow:hidden;display:flex;flex-direction:column}.meta{padding:14px 18px 0;text-align:${this._css(c.header_alignment === 'inherit' ? c.alignment : c.header_alignment)};font:500 ${Math.max(8, Math.min(48, Number(c.header_font_size ?? c.track_info_font_size ?? 13)))}px ${this._css(c.font_family)};color:color-mix(in srgb, currentColor 72%, transparent);background:transparent!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none!important;border:0;text-shadow:${c.text_shadow !== false ? `0 1px 2px rgba(0,0,0,${Math.max(0, Math.min(1, Number(c.text_shadow_strength ?? .75)))}), 0 0 10px rgba(0,0,0,${Math.max(0, Math.min(1, Number(c.text_shadow_strength ?? .75))) * .6})` : 'none'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meta.intro-hidden{display:none}.meta.split{display:flex;justify-content:space-between;gap:12px}.meta.split .track-title,.meta.split .track-artist{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta.split .track-artist{text-align:right}.meta.split.reverse .track-title{order:2;text-align:right}.meta.split.reverse .track-artist{order:1;text-align:left}.meta span{margin-left:6px}.viewport{position:relative;flex:1;overflow:hidden;display:flex;align-items:center;justify-content:center}.lyrics{position:absolute;top:0;left:0;width:100%;padding:0 8%;box-sizing:border-box;transition:transform .38s cubic-bezier(.2,.8,.2,1);will-change:transform}.line{font-family:${this._css(c.font_family)};font-size:${Number(c.font_size)||42}px;font-weight:${Number(c.font_weight)||700};line-height:1.25;text-align:${this._css(c.alignment)};opacity:${Number(c.inactive_opacity) ?? .32};transform:scale(1);transition:opacity .25s,transform .25s,filter .25s;transform-origin:${c.alignment === 'left' ? 'left' : c.alignment === 'right' ? 'right' : 'center'};padding:7px 0;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere;word-break:normal}.line.blank{height:1.25em}.line.active{opacity:1;transform:scale(1);filter:drop-shadow(0 1px 12px color-mix(in srgb, var(--primary-text-color) 25%, transparent))}.compact .line,.two_line .line{display:none}.compact .line.active{display:block}.two_line .line.active,.two_line .line.next{display:block}.minimal .line:not(.active){display:none}.minimal{padding:0 8%}.karaoke .line{padding:10px 0}.plain{width:100%;height:100%;overflow:auto;box-sizing:border-box;margin:0;padding:22px;white-space:pre-wrap;font-family:${this._css(c.font_family)};font-size:${Number(c.font_size)*.6||24}px;line-height:1.55;text-align:${this._css(c.alignment)}}.empty{text-align:${this._css(c.alignment)};line-height:1.55;color:var(--secondary-text-color);font:400 17px system-ui}.empty b{color:var(--primary-text-color);font-weight:600}.empty small{display:block;font-size:13px}.intro{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;text-align:center;pointer-events:none;animation:intro-in .35s ease;opacity:1;transform:scale(1);transition:opacity .4s ease,transform .4s ease}.intro.hidden{opacity:0;transform:scale(.97);visibility:hidden}.intro-title{font-family:${this._css(c.font_family)};font-size:${Math.max(20,Math.min(120,Number(c.intro_font_size ?? 48)))}px;font-weight:${Number(c.font_weight)||700};line-height:1.12;text-shadow:${c.text_shadow !== false ? `0 1px 2px rgba(0,0,0,${Math.max(0, Math.min(1, Number(c.text_shadow_strength ?? .75)))}),0 0 10px rgba(0,0,0,${Math.max(0, Math.min(1, Number(c.text_shadow_strength ?? .75)))*.6})` : 'none'}}.intro-artist{margin-top:10px;font-family:${this._css(c.font_family)};font-size:${Math.max(14,Math.round(Math.max(20,Math.min(120,Number(c.intro_font_size ?? 48)))*.48))}px;font-weight:500;opacity:.78;text-shadow:inherit}@keyframes intro-in{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}.sync-control{position:absolute;z-index:3;left:12px;right:12px;bottom:7px;padding:6px 8px;border-radius:9px;background:rgba(0,0,0,.48);backdrop-filter:blur(8px);font:12px system-ui;color:#fff;opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .2s ease,transform .2s ease}.sync-control.visible{opacity:1;transform:translateY(0);pointer-events:auto}.media-controls,.sync-row{height:${Math.max(24,Math.min(64,Number(c.media_controls_size ?? 30)))}px;display:flex;align-items:center;gap:8px}.progress{height:${Math.max(2,Math.min(16,Number(c.progress_bar_height ?? 5)))}px;margin:1px 1px 5px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.22)}.progress>div{height:100%;border-radius:inherit;background:${this._css(c.progress_bar_color || 'var(--primary-color)')};transition:width .2s linear}.sync-row{margin-top:3px}.sync-control input{flex:1;accent-color:var(--primary-color,#03a9f4);cursor:pointer}.sync-control button{border:0;border-radius:5px;padding:4px 7px;background:rgba(255,255,255,.18);color:#fff;cursor:pointer;font:11px system-ui}.media-controls button{width:${Math.max(24,Math.min(64,Number(c.media_controls_size ?? 30)))}px;height:${Math.max(24,Math.min(64,Number(c.media_controls_size ?? 30)))}px;padding:4px 0}.media-controls .play{font-size:14px}.media-controls .volume{margin-left:6px}.sync-control output{min-width:42px;text-align:right;font-variant-numeric:tabular-nums} .status{position:absolute;right:10px;bottom:8px;font:11px system-ui;color:var(--disabled-text-color)}
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
        {name:'background_mode', selector:{select:{mode:'dropdown',options:[{label:'Home Assistant theme',value:'theme'},{label:'Album artwork',value:'artwork'},{label:'No background (transparent)',value:'transparent'}]}}},
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
 static getStubConfig(){return {entity:'',show_artist_bio:true,show_artist_image:true,show_artist_facts:true,show_track_info:true,show_release_info:true,show_credits:true,show_tags:true,show_identifiers:false,show_external_links:true,show_genius:true,font_family:'system-ui',title_font_size:24,body_font_size:14,font_weight:700,alignment:'left',background_mode:'theme',background_opacity:1,artwork_blur:12,artwork_opacity:1,artwork_overlay_opacity:.45,text_color_mode:'theme',text_color:'#ffffff'}}
 static getConfigElement(){return document.createElement('song-info-card-editor')}
 setConfig(c){if(!c?.entity)throw new Error('Set a media_player entity');this._config={...SongInfoCard.getStubConfig(),...c};this._key='';this._data=null;this._render()} set hass(h){this._hass=h;this._update()}getCardSize(){return 4}_state(){return this._hass?.states?.[this._config?.entity]}_esc(x){const d=document.createElement('div');d.textContent=x??'';return d.innerHTML}_css(v){return String(v??'').replace(/[<>{};]/g,'')}
 async _wait(){const n=window.__songInfoMBLast||0,d=Math.max(0,1100-(Date.now()-n));if(d)await new Promise(r=>setTimeout(r,d));window.__songInfoMBLast=Date.now()}async _mb(url){await this._wait();const r=await fetch(url,{headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`MusicBrainz ${r.status}`);return r.json()}
 _update(){const a=this._state()?.attributes||{},title=a.media_title||'',artist=a.media_artist||'',key=`${artist}|${title}|${a.media_album_name||''}`;if(!title||!artist||key===this._key)return;this._key=key;this._data=null;this._render();this._load(title,artist,key)}
 async _wiki(name,wikiUrl=''){try{let title='';if(wikiUrl){const m=wikiUrl.match(/\/wiki\/([^#?]+)/);title=m?decodeURIComponent(m[1]).replace(/_/g,' '):''}if(!title){const q=await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`intitle:${name} (band) OR intitle:${name} musician OR intitle:${name} singer`)}&srnamespace=0&srlimit=5&srprop=snippet|titles&format=json&origin=*`).then(r=>r.json());const norm=String(name).toLowerCase();const hit=(q.query?.search||[]).find(x=>x.title.toLowerCase()===norm||x.title.toLowerCase()===`${norm} (band)`||x.title.toLowerCase()===`${norm} (musician)`||x.title.toLowerCase()===`${norm} (singer)`);title=hit?.title||''}let p={};if(title){const q=await fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=extracts|pageimages|info&exintro=1&explaintext=1&pithumbsize=400&inprop=url&format=json&origin=*`).then(r=>r.json());p=Object.values(q.query?.pages||{})[0]||{}}if(!p.extract){const q=await fetch(`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(name)}&gsrnamespace=0&gsrlimit=5&prop=extracts|pageimages|info&exintro=1&explaintext=1&pithumbsize=400&inprop=url&format=json&origin=*`).then(r=>r.json());const pages=Object.values(q.query?.pages||{});p=pages.find(x=>/\b(artist|band|musical|music)\b/i.test(x.extract||''))||{}}return p.missing?{}:p}catch{return {}}}
 async _wikidataWiki(url){try{const m=String(url||'').match(/(?:wikidata\.org\/wiki\/|Special:EntityData\/)(Q\d+)/);if(!m)return '';const q=await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${m[1]}&props=sitelinks&sitefilter=enwiki&format=json&origin=*`).then(r=>r.json());return q.entities?.[m[1]]?.sitelinks?.enwiki?.title||''}catch{return ''}}
 async _load(title,artist,key){try{const query=`recording:"${title.replace(/"/g,'')}" AND artist:"${artist.replace(/"/g,'')}"`;const search=await this._mb(`https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=5`);let r=(search.recordings||[]).sort((a,b)=>(b.score||0)-(a.score||0))[0];if(!r)throw new Error('No matching MusicBrainz recording found');r=await this._mb(`https://musicbrainz.org/ws/2/recording/${r.id}?inc=artist-credits+releases+tags+genres+isrcs+work-rels+artist-rels+url-rels&fmt=json`);const credit=(r['artist-credit']||[]).map(x=>x.name||x.artist?.name).filter(Boolean).join(', ')||artist,aid=r['artist-credit']?.[0]?.artist?.id;let ai={};if(aid)ai=await this._mb(`https://musicbrainz.org/ws/2/artist/${aid}?inc=tags+genres+url-rels&fmt=json`);const wikiRel=(ai.relations||[]).find(x=>x.type==='wikipedia'&&x.url?.resource)?.url?.resource||'';const wikidataRel=(ai.relations||[]).find(x=>x.type==='wikidata'&&x.url?.resource)?.url?.resource||'';const wikidataTitle=!wikiRel?await this._wikidataWiki(wikidataRel):'';const wiki=await this._wiki(wikidataTitle||ai.name||credit,wikiRel);if(key!==this._key)return;const rel=r.releases?.[0]||{},workrels=(r.relations||[]).filter(x=>x['target-type']==='work'),credits=[...(r.relations||[]).filter(x=>x['target-type']==='artist').map(x=>`${x.type}: ${x.artist?.name||''}`),...workrels.flatMap(x=>(x.work?.relations||[]).filter(y=>y['target-type']==='artist').map(y=>`${y.type}: ${y.artist?.name||''}`))].filter(Boolean),urls=[...(ai.relations||[]),...(r.relations||[])].filter(x=>x['target-type']==='url'&&x.url?.resource).map(x=>({type:x.type,url:x.url.resource}));this._data={title:r.title,artist:credit,mbid:r.id,artistMbid:aid,album:rel.title,date:rel.date||r['first-release-date'],country:rel.country,status:rel.status,type:rel['release-group']?.['primary-type'],duration:r.length?`${Math.floor(r.length/60000)}:${String(Math.floor(r.length/1000)%60).padStart(2,'0')}`:'',genres:[...(r.genres||[]),...(r.tags||[]),...(ai.genres||[]),...(ai.tags||[])].map(x=>x.name).filter((x,i,a)=>a.indexOf(x)===i).slice(0,10),isrcs:r.isrcs||[],works:workrels.map(x=>x.work?.title).filter(Boolean),credits:[...new Set(credits)].slice(0,12),wiki,urls};this._render()}catch(e){if(key===this._key){this._data={error:e.message};this._render()}}}
 _render(){if(!this._config)return;if(!this.shadowRoot)this.attachShadow({mode:'open'});const c=this._config,d=this._data,a=this._state()?.attributes||{},art=a.entity_picture||a.media_image_url||'',bg=c.background_mode==='artwork'&&art,safe=/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|var\(--[a-zA-Z0-9_-]+\))$/.test(String(c.text_color||''))?c.text_color:'#fff',col=c.text_color_mode==='custom'?safe:c.text_color_mode==='light'?'#fff':c.text_color_mode==='dark'?'#111':'var(--primary-text-color)',sec=(n,b,on=true)=>on&&b?`<section><h3>${n}</h3>${b}</section>`:'',row=(n,v)=>v?`<dt>${n}</dt><dd>${this._esc(v)}</dd>`:'',dl=x=>`<dl>${x}</dl>`,genius=d?.title&&d?.artist?`https://genius.com/search?q=${encodeURIComponent(`${d.artist} ${d.title}`)}`:'',link=(n,u)=>u?`<a href="${this._esc(u)}" target="_blank" rel="noreferrer">${this._esc(n)} ↗</a>`:'',body=!d?'<p>Looking up MusicBrainz and Wikipedia…</p>':d.error?`<p class="error">${this._esc(d.error)}</p>`:`${c.show_artist_image!==false&&d.wiki?.thumbnail?.source?`<img src="${this._esc(d.wiki.thumbnail.source)}" alt="">`:''}<h2>${this._esc(d.title)}</h2><p class="artist">${this._esc(d.artist)}</p>${sec('Artist bio',`<p class="bio">${this._esc(d.wiki?.extract||'No verified Wikipedia artist page was found.')}</p>${link('Read on Wikipedia',d.wiki?.fullurl)}`,c.show_artist_bio!==false)}${sec('Artist facts',dl(row('Wikipedia',d.wiki?.title)+row('MusicBrainz ID',d.artistMbid)),c.show_artist_facts!==false)}${sec('Track information',dl(row('Duration',d.duration)+row('Work',d.works?.join(', '))),c.show_track_info!==false)}${sec('Release information',dl(row('Album',d.album)+row('First release',d.date)+row('Country',d.country)+row('Status',d.status)+row('Type',d.type)),c.show_release_info!==false)}${sec('Credits',`<p>${this._esc(d.credits?.join(' · '))}</p>`,c.show_credits!==false&&d.credits?.length)}${sec('Genres & tags',`<p>${this._esc(d.genres?.join(', '))}</p>`,c.show_tags!==false&&d.genres?.length)}${sec('Identifiers',dl(row('ISRC',d.isrcs?.join(', '))+row('Recording MBID',d.mbid)),c.show_identifiers===true)}${sec('Links',`${link('MusicBrainz',`https://musicbrainz.org/recording/${d.mbid}`)} ${link('Genius search',genius)} ${d.urls?.slice(0,5).map(x=>link(x.type,x.url)).join(' ')||''}`,c.show_external_links!==false)}${sec('Genius',`<p>Open the matched song search on Genius for its official song page and annotations.</p>${link('Open in Genius',genius)}`,c.show_genius!==false)}`;this.shadowRoot.innerHTML=`<style>ha-card{position:relative;overflow:hidden;isolation:isolate;padding:18px;box-sizing:border-box;background:${c.background_mode==='transparent'?'transparent':bg?'transparent':`color-mix(in srgb,var(--ha-card-background,var(--card-background-color)) ${Math.max(0,Math.min(1,Number(c.background_opacity??1))*100)}%,transparent)`};box-shadow:${c.background_mode==='transparent'?'none':'var(--ha-card-box-shadow,none)'};border:${c.background_mode==='transparent'?'none':'var(--ha-card-border-width,0) solid var(--divider-color)'};text-align:${this._css(c.alignment)};color:${col}}ha-card:before{content:'';position:absolute;inset:-${bg?Number(c.artwork_blur)*2:0}px;z-index:-2;background:${bg?`url('${String(art).replace(/[\\"'()\n\r]/g,encodeURIComponent)}') center/cover`:'none'};filter:blur(${bg?c.artwork_blur:0}px);opacity:${bg?c.artwork_opacity:0}}ha-card:after{content:'';position:absolute;inset:0;z-index:-1;background:${bg?`rgba(0,0,0,${c.artwork_overlay_opacity})`:'transparent'}}h2,h3,p,dd,dt,a,.artist{color:inherit!important}img{float:right;width:92px;height:92px;object-fit:cover;border-radius:8px;margin-left:12px}h2{font:${c.font_weight} ${c.title_font_size}px/1.2 ${this._css(c.font_family)};margin:0 0 4px}.artist,p,dd{font:${c.body_font_size}px/1.5 ${this._css(c.font_family)};margin:0}.artist,dt{opacity:.75}h3{font:600 ${Math.max(10,Number(c.body_font_size)-1)}px ${this._css(c.font_family)};text-transform:uppercase;opacity:.75;margin:18px 0 5px}dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:0;text-align:left}dd{margin:0}.bio{white-space:pre-wrap}a{display:inline-block;margin:6px 12px 0 0}.error{color:var(--error-color)!important}</style><ha-card>${body}</ha-card>`}
}
class SongInfoCardEditor extends HTMLElement {constructor(){super();this._config=null;this._hass=null;this._forms=[];this._sections=[['Player and sources',[{name:'entity',selector:{entity:{domain:'media_player'}}}]],['Information to display',[{name:'show_artist_bio',selector:{boolean:{}}},{name:'show_artist_image',selector:{boolean:{}}},{name:'show_artist_facts',selector:{boolean:{}}},{name:'show_track_info',selector:{boolean:{}}},{name:'show_release_info',selector:{boolean:{}}},{name:'show_credits',selector:{boolean:{}}},{name:'show_tags',selector:{boolean:{}}},{name:'show_identifiers',selector:{boolean:{}}},{name:'show_external_links',selector:{boolean:{}}},{name:'show_genius',selector:{boolean:{}}}]],['Text appearance',[{name:'alignment',selector:{select:{mode:'dropdown',options:[{label:'Left',value:'left'},{label:'Centre',value:'center'},{label:'Right',value:'right'}]}}},{name:'font_family',selector:{select:{mode:'dropdown',custom_value:true,options:[{label:'System UI',value:'system-ui'},{label:'Roboto',value:'Roboto, sans-serif'},{label:'Inter',value:'Inter, sans-serif'},{label:'Montserrat',value:'Montserrat, sans-serif'},{label:'Poppins',value:'Poppins, sans-serif'},{label:'Serif',value:'serif'}]}}},{name:'title_font_size',selector:{number:{min:14,max:72,step:1,mode:'box',unit_of_measurement:'px'}}},{name:'body_font_size',selector:{number:{min:10,max:36,step:1,mode:'box',unit_of_measurement:'px'}}},{name:'font_weight',selector:{number:{min:100,max:900,step:100,mode:'box'}}},{name:'text_color_mode',selector:{select:{mode:'dropdown',options:[{label:'Home Assistant theme',value:'theme'},{label:'Always light',value:'light'},{label:'Always dark',value:'dark'},{label:'Custom colour',value:'custom'}]}}},{name:'text_color',selector:{text:{}}}]],['Background',[{name:'background_mode',selector:{select:{mode:'dropdown',options:[{label:'Home Assistant theme',value:'theme'},{label:'Album artwork',value:'artwork'},{label:'No background (transparent)',value:'transparent'}]}}},{name:'background_opacity',selector:{number:{min:0,max:1,step:.01,mode:'box'}}},{name:'artwork_blur',selector:{number:{min:0,max:40,step:1,mode:'box',unit_of_measurement:'px'}}},{name:'artwork_opacity',selector:{number:{min:0,max:1,step:.01,mode:'box'}}},{name:'artwork_overlay_opacity',selector:{number:{min:0,max:.9,step:.01,mode:'box'}}}]]]}setConfig(c){this._config={...SongInfoCard.getStubConfig(),...c};this._build();this._sync()}set hass(h){this._hass=h;this._build();this._sync()}_label(n){return ({entity:'Media player',show_artist_bio:'Show Wikipedia artist biography',show_artist_image:'Show Wikipedia artist image',show_artist_facts:'Show artist facts',show_track_info:'Show track information',show_release_info:'Show release information',show_credits:'Show credits',show_tags:'Show genres and tags',show_identifiers:'Show identifiers',show_external_links:'Show external links',show_genius:'Show Genius link panel',alignment:'Text alignment',font_family:'Font family',title_font_size:'Title font size',body_font_size:'Body font size',font_weight:'Title font weight',text_color_mode:'Text colour',text_color:'Custom text colour (CSS or hex)',background_mode:'Background source',background_opacity:'Theme background opacity',artwork_blur:'Album artwork blur',artwork_opacity:'Artwork opacity',artwork_overlay_opacity:'Artwork dark overlay'})[n]||n}_build(){if(this._forms.length)return;const st=document.createElement('style');st.textContent='.editor-section{border-top:1px solid var(--divider-color);padding:14px 0 6px}.editor-section:first-child{border:0;padding-top:4px}.editor-section h3{margin:0 8px 7px;font-size:15px;font-weight:500}ha-form{display:block;padding:0 4px}';this.append(st);this._sections.forEach(([t,s])=>{const x=document.createElement('section');x.className='editor-section';x.innerHTML=`<h3>${t}</h3>`;const f=document.createElement('ha-form');f.schema=s;f.computeLabel=i=>this._label(i.name);f.addEventListener('value-changed',e=>{e.stopPropagation();this._config={...this._config,...(e.detail?.value||{})};this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:this._config},bubbles:true,composed:true}))});x.append(f);this.append(x);this._forms.push({f,s})})}_sync(){this._forms.forEach(({f,s})=>{if(f.hass!==this._hass)f.hass=this._hass;f.schema=s;if(!f.contains(document.activeElement))f.data=this._config||{}})}}
customElements.define('song-info-card',SongInfoCard);customElements.define('song-info-card-editor',SongInfoCardEditor);window.customCards.push({type:'song-info-card',name:'Song Info Card',description:'MusicBrainz metadata and Wikipedia artist biography.',preview:true,documentationURL:'https://musicbrainz.org/doc/MusicBrainz_API'});
