// 云寺 Cloud Temple — client
(() => {
  'use strict';

  const W = 1000, H = 700;          // world size
  const FLOOR_Y = 330;              // walkable area starts here
  const SPEED = 150;                // world units / second

  const $ = (s) => document.querySelector(s);
  const canvas = $('#scene');
  const ctx = canvas.getContext('2d');

  // ---------------- storage (per-viewer, best effort) ----------------
  const today = new Date().toISOString().slice(0, 10);
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem('ct:' + k)); return v ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('ct:' + k, JSON.stringify(v)); } catch {} },
  };
  const daily = store.get('daily', {});
  let myBows = daily.date === today ? daily.bows : 0;
  let myBeads = store.get('beads', 0);   // lifetime bead count

  // wanche mugwort incense range
  const INCENSE = [
    { name: '艾焰', tone: '朱红', color: '#c0392b', note: '一点火色，暖' },
    { name: '艾虚', tone: '烟灰', color: '#8d8a83', note: '像山里的晨雾，静' },
    { name: '艾青', tone: '艾绿', color: '#6b8a4f', note: '新采艾叶的颜色' },
    { name: '艾檀', tone: '檀褐', color: '#7a4a2a', note: '沉一点，稳一点' },
    { name: '艾月', tone: '月白', color: '#e6dcc4', note: '月下的素色' },
  ];
  const MALAS = [
    { n: 18, label: '手串' }, { n: 21, label: '二十一' }, { n: 27, label: '二十七' },
    { n: 54, label: '半串' }, { n: 108, label: '全串' },
  ];
  let incenseChoice = clampIdx(store.get('incense', 0), INCENSE.length);
  let malaSize = MALAS.some((m) => m.n === store.get('mala', 0)) ? store.get('mala', 0) : 0; // 0 = not chosen yet
  let beadPos = store.get('beadPos', 0);
  let rounds = store.get('rounds', 0);
  // beads drawn in the hand (a big mala is drawn with fewer, so it stays readable)
  function beadsVisible(n) { return n <= 27 ? n : n <= 54 ? 27 : 36; }
  function beadStep(n) { return Math.PI * 2 / beadsVisible(n || 108); }
  function clampIdx(i, n) { i = Number(i) | 0; return i >= 0 && i < n ? i : 0; }

  // ---------------- state ----------------
  const me = { id: null, token: null, name: '', robe: '#8a8f98', x: 500, y: 560, tx: 500, ty: 560, act: null, actT: 0, face: 1 };
  me.mala = malaSize; me.incense = incenseChoice; me.beadRot = 0; me.beadTarget = 0;
  const others = new Map();
  const floaters = [];
  const smoke = [];
  const SCALE = 1.5;                // character size multiplier
  const WHEEL_Y = 350;              // prayer wheels stand along the back of the floor
  const WHEEL_IDLE = 0.6;           // rad/s
  const wheels = [225, 265, 305, 345, 655, 695, 735, 775].map((x) => ({ x, a: Math.random() * 6, vel: WHEEL_IDLE }));
  const sticks = [];                // incense in the burner: { off, born, c }
  const STICK_LIFE = 90;            // seconds an incense stick burns
  let stats = { bows: 0, here: 1, online: 1 };
  let online = false;

  // ---------------- audio ----------------
  let ac = null, master = null, ambient = null, soundOn = true;

  function initAudio() {
    if (ac) return;
    // iOS: route web audio as media playback so the silent switch doesn't mute it
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain();
    master.gain.value = 1;
    master.connect(ac.destination);
    unlockMedia();
  }

  // playing a (silent) media element inside the tap also switches older iOS to the playback audio session
  function unlockMedia() {
    try {
      const rate = 8000, len = 800, buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
      const w = (o, str) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true);
      v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
      v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * 2, true);
      const el = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
      el.setAttribute('playsinline', '');
      el.play().catch(() => {});
    } catch {}
  }

  // browsers may suspend audio (tab switch, iframe focus); wake it on any tap
  function wakeAudio() { if (ac && ac.state !== 'running') ac.resume().catch(() => {}); }
  addEventListener('pointerdown', wakeAudio, true);
  addEventListener('keydown', wakeAudio, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wakeAudio(); });

  function env(g, t, peak, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  }

  function moktak() {
    if (!ac || !soundOn) return;
    const t = ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
    o.type = 'sine';
    o.frequency.setValueAtTime(620, t);
    o.frequency.exponentialRampToValueAtTime(420, t + 0.08);
    f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 3;
    env(g, t, 0.9, 0.18);
    o.connect(f).connect(g).connect(master);
    o.start(t); o.stop(t + 0.2);
    // woody click
    const n = noise(0.03), ng = ac.createGain(), nf = ac.createBiquadFilter();
    nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 2;
    env(ng, t, 0.4, 0.03);
    n.connect(nf).connect(ng).connect(master);
    n.start(t);
  }

  function bell(base = 196, vol = 0.25) {
    if (!ac || !soundOn) return;
    const t = ac.currentTime;
    [[1, 1, 6], [2.76, 0.5, 4], [5.4, 0.25, 2.5], [8.93, 0.12, 1.5]].forEach(([r, a, d]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = base * r;
      env(g, t, vol * a, d);
      o.connect(g).connect(master);
      o.start(t); o.stop(t + d + 0.1);
    });
  }

  function tick() {
    if (!ac || !soundOn) return;
    const t = ac.currentTime;
    const n = noise(0.02), g = ac.createGain(), f = ac.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 2500;
    env(g, t, 0.25, 0.02);
    n.connect(f).connect(g).connect(master);
    n.start(t);
  }

  function noise(dur) {
    const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = ac.createBufferSource();
    s.buffer = buf;
    return s;
  }

  function startAmbient() {
    if (!ac || ambient) return;
    const g = ac.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(1, ac.currentTime + 3);
    g.connect(master);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 700;
    lp.connect(g);
    const nodes = [];
    // low drone, slightly detuned for a slow beating
    [[98, 0.05], [98.4, 0.05], [147, 0.03], [196, 0.025], [294, 0.012]].forEach(([f, a]) => {
      const o = ac.createOscillator(), og = ac.createGain();
      o.frequency.value = f; og.gain.value = a;
      o.connect(og).connect(lp); o.start(); nodes.push(o);
    });
    // soft wind
    const wn = noise(4); wn.loop = true;
    const wf = ac.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 500;
    const wg = ac.createGain(); wg.gain.value = 0.03;
    wn.connect(wf).connect(wg).connect(g); wn.start(); nodes.push(wn);
    // distant bell every 25–45s
    let timer;
    const ring = () => { bell(130, 0.12); timer = setTimeout(ring, 25000 + Math.random() * 20000); };
    timer = setTimeout(ring, 4000);
    ambient = { g, nodes, stop() { clearTimeout(timer); g.gain.linearRampToValueAtTime(0, ac.currentTime + 1); setTimeout(() => nodes.forEach((n) => n.stop()), 1200); } };
  }

  function stopAmbient() { if (ambient) { ambient.stop(); ambient = null; } }

  // ---------------- network ----------------
  function connect() {
    if (window.CT_SOLO) return solo();
    let welcomed = false;
    let es;
    try { es = new EventSource('events'); } catch { return solo(); }
    const fallback = setTimeout(() => { if (!welcomed) { es.close(); solo(); } }, 4000);

    es.addEventListener('welcome', (e) => {
      const d = JSON.parse(e.data);
      welcomed = true; online = true;
      clearTimeout(fallback);
      Object.assign(me, d.me, { tx: d.me.x, ty: d.me.y });
      others.clear();
      d.players.forEach(addOther);
      stats = { ...stats, ...d.stats, here: d.players.length + 1 };
      renderMe();
      renderStats();
    });
    es.addEventListener('join', (e) => { addOther(JSON.parse(e.data)); stats.here = others.size + 1; renderStats(); });
    es.addEventListener('leave', (e) => { others.delete(JSON.parse(e.data).id); stats.here = others.size + 1; renderStats(); });
    es.addEventListener('move', (e) => {
      const d = JSON.parse(e.data), o = others.get(d.id);
      if (o) { o.face = d.x >= o.tx ? 1 : -1; o.tx = d.x; o.ty = d.y; }
    });
    es.addEventListener('act', (e) => {
      const d = JSON.parse(e.data), o = others.get(d.id);
      if (!o) return;
      startAct(o, d.act);
      if (d.act === 'incense') { o.incense = clampIdx(d.n, INCENSE.length); addStick(o.incense); }
      if (d.act === 'beads') { o.mala = d.n; o.beadTarget = (o.beadTarget || 0) + beadStep(d.n); }
      if (d.act === 'wheel' && wheels[d.n]) spinWheel(d.n);
    });
    es.addEventListener('stats', (e) => { Object.assign(stats, JSON.parse(e.data)); renderStats(); });
    es.onerror = () => { if (!welcomed) { clearTimeout(fallback); es.close(); solo(); } };
  }

  function solo() {
    if (me.name) return;
    const A = ['悠闲的', '淡淡的', '安静的', '慢慢的', '清晨的', '远山的'];
    const N = ['云', '月光', '松风', '溪水', '竹影', '晨钟'];
    me.name = A[Math.random() * A.length | 0] + N[Math.random() * N.length | 0];
    stats.bows = store.get('soloTotal', 0);
    renderMe(); renderStats();
    toast(window.CT_SOLO ? '预览模式 · 堂中只有你一人' : '离线模式 · 只有你一人在堂中');
  }

  function addOther(p) {
    others.set(p.id, { ...p, tx: p.x, ty: p.y, act: null, actT: 0, face: 1 });
  }

  let lastSent = 0, sentX = 0, sentY = 0;
  function post(body) {
    if (!online) return;
    fetch('action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: me.id, token: me.token, ...body }), keepalive: true,
    }).catch(() => {});
  }
  function syncMove(now) {
    if (now - lastSent < 120) return;
    if (Math.abs(me.x - sentX) < 1 && Math.abs(me.y - sentY) < 1) return;
    lastSent = now; sentX = me.x; sentY = me.y;
    post({ type: 'move', x: Math.round(me.x), y: Math.round(me.y) });
  }

  // ---------------- actions ----------------
  const ACT_LEN = { bow: 1.8, palm: 1.4, beads: 0.8, prostrate: 4.2, incense: 2.2, wheel: 1.2 };
  const WORDS = ['愿你今日轻松', '放下一点点', '慢慢来', '呼吸', '一切都会过去', '此刻安好', '心如止水', '辛苦了'];

  function startAct(p, act) { p.act = act; p.actT = 0; }

  function addStick(c) {
    sticks.push({ off: (Math.random() - 0.5) * 30, born: performance.now() / 1000, c });
    if (sticks.length > 15) sticks.shift();
  }

  function spinWheel(i) {
    wheels[i].vel = Math.min(wheels[i].vel + 10, 24);
  }

  function nearestWheel() {
    let best = 0;
    wheels.forEach((w, i) => { if (Math.abs(w.x - me.x) < Math.abs(wheels[best].x - me.x)) best = i; });
    return best;
  }

  // walk to a wheel; the spin fires on arrival (see stepEntity)
  function goToWheel(i) {
    me.tx = wheels[i].x; me.ty = WHEEL_Y + 24; me.pending = i;
  }

  function doWheel(i) {
    me.pending = null;
    me.face = 1;
    startAct(me, 'wheel');
    spinWheel(i);
    post({ type: 'act', act: 'wheel', n: i });
    [0, 0.12, 0.24].forEach((d) => setTimeout(tick, d * 1000));
    floater(me.x, me.y - 135, '转经 +1', '#e8c98a');
  }

  function doAct(act, n) {
    initAudio();
    if (act === 'moktak') {
      moktak();
      me.mokHit = 0; me.mokShow = 5;
      floater(me.x, me.y - 135, '咚', '#e8c98a');
      return;
    }
    if (act === 'wheel') {
      const i = nearestWheel();
      if (Math.abs(me.x - wheels[i].x) < 8 && Math.abs(me.y - (WHEEL_Y + 24)) < 8) doWheel(i);
      else goToWheel(i);
      return;
    }
    if (act === 'incense' && n === undefined) return openSheet('incense');
    if (act === 'beads' && n === undefined) return openSheet('mala');
    if (act !== 'beads' && me.act && me.actT < ACT_LEN[me.act] * 0.6) return; // let animation breathe
    startAct(me, act);
    if (act === 'incense') me.incense = n;
    if (act === 'beads') { me.mala = malaSize; me.beadTarget += beadStep(malaSize); vizTarget -= Math.PI * 2 / malaSize; }
    post({ type: 'act', act, n: act === 'incense' ? n : act === 'beads' ? malaSize : 0 });
    if (act === 'bow' || act === 'prostrate') {
      myBows++; stats.bows++;
      store.set('daily', { date: today, bows: myBows });
      if (!online) store.set('soloTotal', stats.bows);
      if (act === 'bow') {
        setTimeout(() => bell(262, 0.18), 700);
        floater(me.x, me.y - 135, '功德 +1', '#d9a74a');
      } else {
        setTimeout(() => bell(196, 0.22), 1600);
        floater(me.x, me.y - 135, '五体投地 · 功德 +1', '#d9a74a');
      }
      if (myBows % 10 === 0) toast(WORDS[Math.random() * WORDS.length | 0]);
    } else if (act === 'palm') {
      bell(392, 0.08);
      floater(me.x, me.y - 135, '🙏', '#fff');
    } else if (act === 'incense') {
      const inc = INCENSE[n];
      addStick(n);
      bell(330, 0.06);
      floater(me.x, me.y - 135, `一炷${inc.name}香`, '#f0c9a0');
      toast(`wanche · ${inc.name}香 已点燃`);
    } else if (act === 'beads') {
      myBeads++; beadPos++;
      tick();
      if (beadPos >= malaSize) {
        beadPos = 0; rounds++;
        bell(196, 0.3);
        toast(`${malaSize} 颗一圈，圆满`);
      }
      store.set('beads', myBeads); store.set('beadPos', beadPos); store.set('rounds', rounds);
    }
    renderStats();
  }

  // ---------------- UI ----------------
  function renderMe() {
    $('#myName').textContent = me.name;
    $('#myRobe').style.background = me.robe;
  }
  function renderStats() {
    $('#myBows').textContent = myBows;
    $('#myBeads').textContent = malaSize ? `${beadPos}/${malaSize}` + (rounds ? ` ·${rounds}圈` : '') : '未选';
    $('#allBows').textContent = (stats.bows || 0).toLocaleString();
    $('#here').textContent = stats.here || 1;
    $('#online').textContent = stats.online || 1;
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function floater(x, y, text, color) { floaters.push({ x, y, text, color, t: 0 }); }

  // ---------------- picker sheet ----------------
  let sheetMode = null, sheetPick = 0;
  function openSheet(mode) {
    sheetMode = mode;
    sheetPick = mode === 'incense' ? incenseChoice : Math.max(0, MALAS.findIndex((m) => m.n === malaSize));
    if (mode === 'mala' && !malaSize) { sheetPick = MALAS.length - 1; setMala(MALAS[sheetPick].n); }
    $('#sheetBrand').hidden = mode !== 'incense';
    $('#sheet').classList.toggle('clear', mode === 'mala');  // keep the monk visible while counting
    $('#malaViz').hidden = mode !== 'mala';
    $('#sheetTitle').textContent = mode === 'incense' ? '选一炷艾香' : '选一串念珠';
    const opts = $('#sheetOpts');
    opts.innerHTML = '';
    const list = mode === 'incense' ? INCENSE : MALAS;
    list.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = 'opt';
      b.innerHTML = mode === 'incense'
        ? `<span class="stick" style="--c:${o.color}"></span><b>${o.name}</b><small>${o.tone}</small>`
        : `<span class="num">${o.n}</span><small>${o.label}</small>`;
      b.addEventListener('click', () => {
        sheetPick = i;
        if (mode === 'mala') setMala(o.n);
        renderSheet();
      });
      opts.appendChild(b);
    });
    renderSheet();
    $('#sheet').hidden = false;
    $('#sheetGo').focus();
    if (mode === 'mala') { vizRot = vizTarget = -beadPos * Math.PI * 2 / malaSize; requestAnimationFrame(drawViz); }
  }

  let vizRot = 0, vizTarget = 0;
  function drawViz() {
    if (sheetMode !== 'mala') return;
    requestAnimationFrame(drawViz);
    const cv = $('#malaViz'), g = cv.getContext('2d');
    const dpr = Math.min(devicePixelRatio || 1, 2), size = cv.clientWidth || 180;
    if (cv.width !== size * dpr) { cv.width = cv.height = size * dpr; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    vizRot += (vizTarget - vizRot) * 0.18;
    const n = malaSize, c = size / 2, R = size * 0.38;
    const br = Math.min(size * 0.06, (Math.PI * 2 * R / n) * 0.42);
    // string
    g.strokeStyle = 'rgba(217,167,74,.35)'; g.lineWidth = 1;
    g.beginPath(); g.arc(c, c, R, 0, 7); g.stroke();
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + i * Math.PI * 2 / n + vizRot;
      const x = c + Math.cos(ang) * R, y = c + Math.sin(ang) * R;
      const guru = i === 0, r = guru ? br * 1.5 : br;
      const grad = g.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
      grad.addColorStop(0, guru ? '#f3d58f' : '#a86b43'); grad.addColorStop(1, guru ? '#a8782a' : '#4a2c1a');
      g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      if (guru) {                                   // tassel on the guru bead
        g.strokeStyle = '#b44'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r);
        g.lineTo(x + Math.cos(ang) * (r + 12), y + Math.sin(ang) * (r + 12)); g.stroke();
      }
    }
    // thumb marker at the top: the bead under it is the one just counted
    g.fillStyle = '#d9a74a';
    g.beginPath(); g.moveTo(c, c - R - br - 4); g.lineTo(c - 6, c - R - br - 13); g.lineTo(c + 6, c - R - br - 13); g.closePath(); g.fill();
  }
  function renderSheet() {
    [...$('#sheetOpts').children].forEach((b, i) => b.setAttribute('aria-pressed', i === sheetPick));
    if (sheetMode === 'incense') {
      const o = INCENSE[sheetPick];
      $('#sheetNote').textContent = `${o.name} · ${o.note}`;
      $('#sheetGo').textContent = `点一炷${o.name}香`;
    } else {
      $('#sheetNote').innerHTML = `<b class="count">${beadPos}<span> / ${malaSize}</span></b>` +
        (rounds ? `已拨满 ${rounds} 圈 · ` : '') + '拨满一圈响一声钟';
      $('#sheetGo').textContent = '拨一颗';
    }
  }
  function setMala(n) {
    if (n !== malaSize) { malaSize = n; beadPos = 0; rounds = 0; vizRot = vizTarget = 0; }
    me.mala = malaSize;
    store.set('mala', malaSize); store.set('beadPos', beadPos); store.set('rounds', rounds);
    renderStats();
  }
  function closeSheet() { $('#sheet').hidden = true; sheetMode = null; }
  $('#sheetGo').addEventListener('click', () => {
    if (sheetMode === 'incense') {
      incenseChoice = sheetPick; store.set('incense', incenseChoice);
      closeSheet();
      doAct('incense', incenseChoice);
    } else {
      doAct('beads', malaSize);   // sheet stays open: keep tapping to count
      renderSheet();
    }
  });
  $('#sheetX').addEventListener('click', closeSheet);
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
  $('#malaBtn').addEventListener('click', () => openSheet('mala'));

  document.querySelectorAll('.actions [data-act]').forEach((b) =>
    b.addEventListener('click', () => doAct(b.dataset.act)));

  $('#soundBtn').addEventListener('click', () => {
    initAudio();
    soundOn = !soundOn;
    $('#soundBtn').classList.toggle('on', soundOn);
    soundOn ? startAmbient() : stopAmbient();
  });

  $('#enter').addEventListener('click', () => {
    initAudio();
    ac.resume();
    $('#gate').hidden = true;
    $('#temple').hidden = false;
    $('#soundBtn').classList.add('on');
    startAmbient();
    bell(196, 0.25);
    resize();
    connect();
    renderStats();
    requestAnimationFrame(loop);
  });

  // ---------------- input ----------------
  const keys = new Set();
  addEventListener('keydown', (e) => {
    if ($('#temple').hidden) return;
    const k = e.key.toLowerCase();
    if (!$('#sheet').hidden) {
      if (k === 'escape') closeSheet();
      if (sheetMode === 'mala' && (k === ' ' || k === '4')) { e.preventDefault(); $('#sheetGo').click(); }
      return;
    }
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) { keys.add(k); e.preventDefault(); }
    if (k === '1') doAct('palm');
    if (k === '2' || k === ' ') { doAct('bow'); e.preventDefault(); }
    if (k === '3') doAct('prostrate');
    if (k === '4') doAct('beads');
    if (k === '5') doAct('incense');
    if (k === '6') doAct('wheel');
    if (k === '7') doAct('moktak');
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    const wx = (e.clientX - r.left - view.ox) / view.s + view.cx;
    const wy = (e.clientY - r.top - view.oy) / view.s;
    const hit = wheels.findIndex((w) => Math.abs(wx - w.x) < 20 && wy > WHEEL_Y - 75 && wy < WHEEL_Y + 10);
    if (hit >= 0) { initAudio(); goToWheel(hit); return; }
    me.pending = null;
    me.tx = clamp(wx, 40, W - 40);
    me.ty = clamp(wy, FLOOR_Y, H - 30);
  });

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------------- view ----------------
  const view = { s: 1, ox: 0, oy: 0, cx: 0, vw: W, dpr: 1 };
  function resize() {
    view.dpr = Math.min(devicePixelRatio || 1, 2);
    const cw = innerWidth, ch = innerHeight;
    canvas.width = cw * view.dpr; canvas.height = ch * view.dpr;
    // the scene lives between the merit panel and the action bar so no UI covers it
    const top = $('.merit').getBoundingClientRect().bottom + 6;
    const bottom = $('.actions').getBoundingClientRect().top - 6;
    const availH = Math.max(240, bottom - top);
    let s = Math.min(cw / W, availH / H);
    if (cw < ch) s = Math.min(availH / H, cw / 600); // portrait: zoom in, follow player
    view.s = s;
    view.vw = Math.min(W, cw / s);
    view.ox = Math.max(0, (cw - W * s) / 2);
    view.oy = top + (availH - H * s) / 2;
  }
  addEventListener('resize', resize);

  // ---------------- drawing ----------------
  function skyColors() {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    if (h < 5 || h >= 20) return ['#0e1430', '#1f2550', true];
    if (h < 7) return ['#40507a', '#e3a07a', false];
    if (h < 17) return ['#7fb3d8', '#cfe3ee', false];
    return ['#4a3d6b', '#e08a5c', false];
  }

  function drawHall(t) {
    // back wall
    const wall = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
    wall.addColorStop(0, '#3a2c22'); wall.addColorStop(1, '#4d3a2b');
    ctx.fillStyle = wall; ctx.fillRect(0, 0, W, FLOOR_Y);

    // side windows with sky
    const [skyTop, skyBot, night] = skyColors();
    [[60, 90], [800, 90]].forEach(([x, y]) => {
      const g = ctx.createLinearGradient(0, y, 0, y + 150);
      g.addColorStop(0, skyTop); g.addColorStop(1, skyBot);
      ctx.fillStyle = g; ctx.fillRect(x, y, 140, 150);
      // distant mountains
      ctx.fillStyle = night ? '#141a33' : 'rgba(60,80,90,.55)';
      ctx.beginPath(); ctx.moveTo(x, y + 150);
      ctx.lineTo(x + 30, y + 110); ctx.lineTo(x + 60, y + 128); ctx.lineTo(x + 100, y + 95); ctx.lineTo(x + 140, y + 125); ctx.lineTo(x + 140, y + 150);
      ctx.fill();
      if (night) { ctx.fillStyle = '#f5ecc8'; ctx.beginPath(); ctx.arc(x + 105, y + 35, 10, 0, 7); ctx.fill(); }
      // lattice
      ctx.strokeStyle = '#2a1f17'; ctx.lineWidth = 4;
      ctx.strokeRect(x, y, 140, 150);
      ctx.lineWidth = 2;
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + i * 35, y); ctx.lineTo(x + i * 35, y + 150); ctx.stroke(); }
      for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(x, y + i * 30); ctx.lineTo(x + 140, y + i * 30); ctx.stroke(); }
    });

    // altar backdrop
    ctx.fillStyle = '#5a2b22'; ctx.fillRect(330, 30, 340, 260);
    ctx.strokeStyle = '#c8963f'; ctx.lineWidth = 3; ctx.strokeRect(340, 40, 320, 240);

    // halo
    const glow = 0.85 + Math.sin(t * 0.8) * 0.05;
    const hg = ctx.createRadialGradient(500, 140, 10, 500, 140, 120);
    hg.addColorStop(0, `rgba(255,214,130,${0.55 * glow})`); hg.addColorStop(1, 'rgba(255,214,130,0)');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(500, 140, 120, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(232,190,100,.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(500, 110, 52, 0, 7); ctx.stroke();

    // seated figure (simple, abstract)
    ctx.fillStyle = '#c99a45';
    ctx.beginPath(); ctx.ellipse(500, 238, 88, 32, 0, 0, 7); ctx.fill();       // lap
    ctx.beginPath(); ctx.moveTo(445, 235); ctx.quadraticCurveTo(500, 120, 555, 235); ctx.fill(); // body
    ctx.beginPath(); ctx.arc(500, 108, 30, 0, 7); ctx.fill();                   // head
    ctx.beginPath(); ctx.arc(500, 76, 11, 0, 7); ctx.fill();                    // ushnisha
    ctx.strokeStyle = '#8e6a2c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(488, 108, 6, 0.2, Math.PI - 0.2); ctx.stroke();    // closed eyes
    ctx.beginPath(); ctx.arc(512, 108, 6, 0.2, Math.PI - 0.2); ctx.stroke();
    ctx.beginPath(); ctx.arc(500, 122, 5, 0.3, Math.PI - 0.3); ctx.stroke();    // smile

    // lotus base
    ctx.fillStyle = '#b0563f';
    for (let i = -4; i <= 4; i++) {
      ctx.beginPath(); ctx.ellipse(500 + i * 22, 272, 14, 18, 0, Math.PI, 0); ctx.fill();
    }

    // altar table
    ctx.fillStyle = '#6b3a24'; ctx.fillRect(380, 285, 240, 28);
    ctx.fillStyle = '#4a2817'; ctx.fillRect(390, 313, 220, 14);
    ctx.font = 'italic 500 13px "Cormorant Garamond", Georgia, serif';
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(217,167,74,.75)';
    ctx.fillText('w a n c h e', 500, 304);

    // candles
    [410, 590].forEach((x) => {
      ctx.fillStyle = '#efe3c8'; ctx.fillRect(x - 5, 262, 10, 24);
      const f = 1 + Math.sin(t * 9 + x) * 0.15;
      const cg = ctx.createRadialGradient(x, 254, 1, x, 254, 26);
      cg.addColorStop(0, 'rgba(255,200,110,.6)'); cg.addColorStop(1, 'rgba(255,200,110,0)');
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(x, 254, 26, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffcf6b'; ctx.beginPath(); ctx.ellipse(x, 255, 3.5, 7 * f, 0, 0, 7); ctx.fill();
    });

    // incense burner + smoke
    ctx.fillStyle = '#8a7350'; ctx.beginPath(); ctx.ellipse(500, 283, 22, 8, 0, 0, 7); ctx.fill();
    ctx.fillRect(478, 275, 44, 8);
    const now = t;
    for (let i = sticks.length - 1; i >= 0; i--) if (now - sticks[i].born > STICK_LIFE) sticks.splice(i, 1);
    const all = [{ off: -6, burn: 0 }, { off: 0, burn: 0 }, { off: 6, burn: 0 }]
      .concat(sticks.map((s) => ({ off: s.off, burn: (now - s.born) / STICK_LIFE, color: INCENSE[s.c]?.color })));
    all.forEach((s) => {
      const tipX = 500 + s.off * 1.3, tipY = 252 + s.burn * 18;
      ctx.strokeStyle = s.color || '#a8433a'; ctx.lineWidth = s.color ? 2 : 1.5;
      ctx.beginPath(); ctx.moveTo(500 + s.off, 276); ctx.lineTo(tipX, tipY); ctx.stroke();
      ctx.fillStyle = '#ff8a3d'; ctx.beginPath(); ctx.arc(tipX, tipY, 1.6, 0, 7); ctx.fill();
      if (Math.random() < 0.1) smoke.push({ x: tipX, y: tipY - 2, t: 0 });
    });

    // pillars
    [[150, 0], [850, 0]].forEach(([x]) => {
      ctx.fillStyle = '#7a2e22'; ctx.fillRect(x - 18, 0, 36, FLOOR_Y + 20);
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(x + 6, 0, 12, FLOOR_Y + 20);
    });

    // hanging lanterns
    [260, 740].forEach((x, i) => {
      const sway = Math.sin(t * 0.7 + i) * 3;
      ctx.strokeStyle = '#2a1f17'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + sway, 60); ctx.stroke();
      const lg = ctx.createRadialGradient(x + sway, 82, 4, x + sway, 82, 50);
      lg.addColorStop(0, 'rgba(255,180,100,.35)'); lg.addColorStop(1, 'rgba(255,180,100,0)');
      ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(x + sway, 82, 50, 0, 7); ctx.fill();
      ctx.fillStyle = '#d8573f'; ctx.beginPath(); ctx.ellipse(x + sway, 82, 18, 22, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#e9c46a'; ctx.fillRect(x + sway - 10, 58, 20, 4); ctx.fillRect(x + sway - 10, 102, 20, 4);
    });

    // floor
    const fl = ctx.createLinearGradient(0, FLOOR_Y, 0, H);
    fl.addColorStop(0, '#6e5138'); fl.addColorStop(1, '#8b6a4a');
    ctx.fillStyle = fl; ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
    ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1;
    for (let y = FLOOR_Y + 20; y < H; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    // warm light pool from altar
    const pool = ctx.createRadialGradient(500, FLOOR_Y + 20, 20, 500, FLOOR_Y + 20, 380);
    pool.addColorStop(0, 'rgba(255,200,120,.22)'); pool.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = pool; ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);

    // cushions
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
      const x = 260 + c * 120, y = 410 + r * 90;
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(x, y + 6, 38, 12, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#7c3b2d'; ctx.beginPath(); ctx.ellipse(x, y, 36, 12, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#c8963f'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y, 26, 8, 0, 0, 7); ctx.stroke();
    }
  }

  function drawSmoke(dt) {
    for (let i = smoke.length - 1; i >= 0; i--) {
      const p = smoke[i];
      p.t += dt; p.y -= 18 * dt; p.x += Math.sin(p.t * 2 + p.y * 0.05) * 6 * dt;
      if (p.t > 4) { smoke.splice(i, 1); continue; }
      ctx.fillStyle = `rgba(230,225,215,${0.12 * (1 - p.t / 4)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3 + p.t * 4, 0, 7); ctx.fill();
    }
  }

  function drawWheel(w) {
    const x = w.x, b = WHEEL_Y;
    const r = 16, h = 56, top = b - 74;
    const PANELS = 8, step = Math.PI * 2 / PANELS;
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.ellipse(x, b, 18, 5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#3b2a1e'; ctx.fillRect(x - 3, b - 18, 6, 18);            // post
    ctx.fillRect(x - 1.5, top - 10, 3, h + 12);                               // axle

    // drum: panels on a cylinder, projected to screen; alternating colours make the turn obvious
    for (let i = 0; i < PANELS; i++) {
      const a0 = w.a + i * step, a1 = a0 + step, mid = a0 + step / 2;
      if (Math.cos(mid) <= -0.05) continue;                                  // back side
      const x0 = x + Math.sin(a0) * r, x1 = x + Math.sin(a1) * r;
      const light = 0.55 + 0.45 * Math.max(0, Math.cos(mid - 0.5));           // light from front-left
      const base = i % 2 ? [192, 57, 43] : [217, 167, 74];
      ctx.fillStyle = `rgb(${base.map((c) => Math.round(c * light)).join(',')})`;
      ctx.fillRect(Math.min(x0, x1), top + 7, Math.abs(x1 - x0) + 0.6, h - 14);
      // a syllable mark on each panel
      const cx = x + Math.sin(mid) * r, wMark = Math.abs(x1 - x0) * 0.5;
      if (wMark > 1) {
        ctx.fillStyle = i % 2 ? 'rgba(255,220,150,.85)' : 'rgba(110,40,20,.85)';
        ctx.fillRect(cx - wMark / 2, top + 18, wMark, 4);
        ctx.fillRect(cx - wMark / 4, top + 25, wMark / 2, 14);
        ctx.fillRect(cx - wMark / 2, top + 42, wMark, 4);
      }
    }
    // rims and cap
    ctx.fillStyle = '#7a2e22'; ctx.fillRect(x - r - 1, top, r * 2 + 2, 7); ctx.fillRect(x - r - 1, top + h - 7, r * 2 + 2, 7);
    ctx.fillStyle = '#d9a74a';
    ctx.beginPath(); ctx.ellipse(x, top, r + 1, 4.5, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(x, top - 8, 4, 0, 7); ctx.fill();               // finial
    // hanging weight swings out with speed
    const swing = Math.min(1, (w.vel - WHEEL_IDLE) / 12);
    const wx = x + Math.sin(w.a) * (r + 4 + swing * 8), wy = top + h * 0.45 - swing * 10;
    ctx.strokeStyle = '#3b2a1e'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x + Math.sin(w.a) * r, top + 10); ctx.lineTo(wx, wy); ctx.stroke();
    if (Math.cos(w.a) > -0.3) { ctx.fillStyle = '#5b3a26'; ctx.beginPath(); ctx.arc(wx, wy, 3, 0, 7); ctx.fill(); }
    // motion streaks while spinning fast
    if (w.vel > 3) {
      ctx.strokeStyle = `rgba(255,215,140,${Math.min(0.6, w.vel / 30)})`; ctx.lineWidth = 2;
      [-1, 1].forEach((sd) => {
        ctx.beginPath(); ctx.arc(x, top + h / 2, r + 7, sd > 0 ? -0.5 : Math.PI - 0.5, sd > 0 ? 0.5 : Math.PI + 0.5); ctx.stroke();
      });
    }
  }

  // personal wooden fish, drawn just in front of the player while it's being struck
  function drawMoktak() {
    const d = (0.8 + (me.y - FLOOR_Y) / (H - FLOOR_Y) * 0.45) * SCALE;
    const hit = me.mokHit;
    ctx.save();
    ctx.globalAlpha = Math.min(1, me.mokShow / 0.6);
    ctx.translate(me.x, me.y + 16 * d);
    ctx.scale(d, d);
    // cushion
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, 6, 30, 8, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#9e3b2c'; ctx.beginPath(); ctx.ellipse(0, 2, 28, 8, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#d9a74a'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(0, 2, 20, 5, 0, 0, 7); ctx.stroke();
    // body squashes a little on each strike
    const squash = 1 - 0.1 * Math.exp(-hit * 18);
    ctx.save(); ctx.translate(0, -2); ctx.scale(1 + (1 - squash) * 0.5, squash);
    ctx.fillStyle = '#7a3f1d'; ctx.beginPath(); ctx.ellipse(0, -14, 24, 16, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,220,170,.22)'; ctx.beginPath(); ctx.ellipse(-8, -21, 10, 5, -0.3, 0, 7); ctx.fill();
    ctx.strokeStyle = '#3a1a0b'; ctx.lineWidth = 3; ctx.lineCap = 'round';           // mouth slit
    ctx.beginPath(); ctx.moveTo(-15, -9); ctx.quadraticCurveTo(0, -3, 15, -9); ctx.stroke();
    ctx.fillStyle = '#3a1a0b';                                                         // fish-scale dots
    [[-8, -18], [0, -20], [8, -18]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 1.4, 0, 7); ctx.fill(); });
    ctx.restore();
    // ripple
    if (hit < 0.5) {
      ctx.strokeStyle = `rgba(255,215,140,${0.6 * (1 - hit / 0.5)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, -14, 26 + hit * 40, 18 + hit * 28, 0, 0, 7); ctx.stroke();
    }
    // mallet: touches the top on a hit, then lifts back up
    ctx.translate(30, -46);
    ctx.rotate(-0.55 * (1 - Math.exp(-hit * 12)));
    ctx.strokeStyle = '#c9a26b'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-22, 14); ctx.stroke();
    ctx.fillStyle = '#5b3a26'; ctx.beginPath(); ctx.arc(-24, 15, 5.5, 0, 7); ctx.fill();
    ctx.restore();
  }

  // a loop of beads hanging from the joined hands; turns one bead per count
  function drawHandMala(p, bob, pulse) {
    const vis = beadsVisible(p.mala), rot = p.beadRot || 0;
    const rx = 8 + vis * 0.3, ry = rx * 0.75, cy = -26 + bob + ry * 0.9;
    const size = vis <= 21 ? 2.8 : 2.2;
    const beads = [];
    for (let i = 0; i < vis; i++) {
      const ang = Math.PI / 2 + i / vis * Math.PI * 2 + rot;
      beads.push({ i, x: Math.sin(ang) * rx, y: cy - Math.cos(ang) * ry, front: Math.cos(ang) < 0 });
    }
    beads.sort((a, b) => a.front - b.front).forEach((b) => {
      ctx.fillStyle = b.i === 0 ? '#d9a74a' : b.front ? '#6b4128' : '#4a2c1a';
      ctx.beginPath(); ctx.arc(b.x, b.y, size, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,230,190,.35)';
      ctx.beginPath(); ctx.arc(b.x - size * 0.35, b.y - size * 0.35, size * 0.35, 0, 7); ctx.fill();
    });
    // the bead under the thumb glows on each count
    if (pulse > 0) {
      ctx.strokeStyle = `rgba(255,215,140,${pulse * 0.8})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, cy - ry, size + 3, 0, 7); ctx.stroke();
    }
    // hands drawn again over the top of the loop
    ctx.fillStyle = '#f1d3b3';
    ctx.beginPath(); ctx.ellipse(0, -26 + bob, 4, 7, 0, 0, 7); ctx.fill();
  }

  function drawMonk(p, t, isMe) {
    const depth = (0.8 + (p.y - FLOOR_Y) / (H - FLOOR_Y) * 0.45) * SCALE;
    const moving = Math.hypot(p.tx - p.x, p.ty - p.y) > 2;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(depth, depth);

    let bodyH = 1, headDY = 0, bob = 0, rot = 0, handsY = null, stretch = 0;
    const a = p.act, k = a ? Math.min(1, p.actT / ACT_LEN[a]) : 0;
    const ease = (x) => x * x * (3 - 2 * x);
    if (a === 'bow') {
      const s = Math.sin(k * Math.PI);
      bodyH = 1 - s * 0.38; headDY = s * 26;
    } else if (a === 'prostrate') {
      // kneel -> lie flat with arms forward -> hold -> back up -> stand
      const kneel = k < 0.15 ? ease(k / 0.15) : k > 0.88 ? ease((1 - k) / 0.12) : 1;
      const lie = k < 0.15 ? 0 : k < 0.32 ? ease((k - 0.15) / 0.17) : k < 0.7 ? 1 : k < 0.88 ? ease((0.88 - k) / 0.18) : 0;
      bodyH = 1 - kneel * 0.4 * (1 - lie);
      headDY = kneel * 14 * (1 - lie);
      rot = lie * p.face * 1.45;
      stretch = lie;
    } else if (moving) {
      bob = Math.abs(Math.sin(t * 10)) * -3;
    } else {
      bob = Math.sin(t * 1.5 + p.x) * 0.8; // breathing
    }

    // shadow (stretches when lying down)
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.ellipse(p.face * stretch * 34, 0, 24 + stretch * 38, 7, 0, 0, 7); ctx.fill();

    ctx.rotate(rot);

    // robe
    ctx.save();
    ctx.translate(0, bob);
    ctx.scale(1, bodyH);
    ctx.fillStyle = p.robe;
    ctx.beginPath();
    ctx.moveTo(-22, 0); ctx.quadraticCurveTo(-20, -38, -10, -44);
    ctx.lineTo(10, -44); ctx.quadraticCurveTo(20, -38, 22, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.beginPath(); ctx.moveTo(-10, -44); ctx.lineTo(-2, -44); ctx.lineTo(16, -6); ctx.lineTo(8, -4); ctx.closePath(); ctx.fill();
    ctx.restore();

    const headY = -44 * bodyH - 18 + bob + headDY;

    // hands
    ctx.fillStyle = '#f1d3b3';
    if (a === 'prostrate' && stretch > 0.5) {
      // arms stretched past the head, palms up
      ctx.beginPath(); ctx.ellipse(-6, headY - 26, 4, 7, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(6, headY - 26, 4, 7, 0, 0, 7); ctx.fill();
    } else if (a === 'incense') {
      handsY = -28 * bodyH + bob - Math.sin(k * Math.PI) * 16;
      ctx.beginPath(); ctx.ellipse(0, handsY, 4, 7, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = INCENSE[p.incense || 0].color; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(0, handsY - 4); ctx.lineTo(0, handsY - 30); ctx.stroke();
      ctx.fillStyle = '#ff8a3d'; ctx.beginPath(); ctx.arc(0, handsY - 31, 2.2, 0, 7); ctx.fill();
      if (Math.random() < 0.25) smoke.push({ x: p.x, y: p.y + (handsY - 33) * depth, t: 0 });
    } else if (a === 'wheel') {
      // right arm reaching to the drum
      const reach = Math.sin(k * Math.PI);
      ctx.strokeStyle = p.robe; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(12, -32 + bob); ctx.lineTo(16 + reach * 8, -46 - reach * 8 + bob); ctx.stroke();
      ctx.beginPath(); ctx.arc(17 + reach * 8, -48 - reach * 8 + bob, 4, 0, 7); ctx.fill();
    } else if (a === 'palm' || a === 'beads' || a === 'bow' || a === 'prostrate' || (!a && p.mala)) {
      ctx.beginPath(); ctx.ellipse(0, -26 * bodyH + bob, 4, 7, 0, 0, 7); ctx.fill();
    }
    if (p.mala && (!a || a === 'beads' || a === 'palm')) drawHandMala(p, bob, a === 'beads' ? Math.sin(k * Math.PI) : 0);

    // head
    ctx.fillStyle = '#f1d3b3';
    ctx.beginPath(); ctx.arc(0, headY, 18, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(120,100,90,.15)';
    ctx.beginPath(); ctx.arc(0, headY - 3, 16, Math.PI, 0); ctx.fill();
    // face
    const eyesClosed = a === 'palm' || a === 'bow' || a === 'prostrate' || a === 'incense';
    ctx.strokeStyle = ctx.fillStyle = '#3a2a22'; ctx.lineWidth = 1.6;
    const fx = p.face * 2;
    if (eyesClosed) {
      ctx.beginPath(); ctx.arc(fx - 6, headY + 1, 3, 0.2, Math.PI - 0.2); ctx.stroke();
      ctx.beginPath(); ctx.arc(fx + 6, headY + 1, 3, 0.2, Math.PI - 0.2); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(fx - 6, headY + 1, 1.8, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(fx + 6, headY + 1, 1.8, 0, 7); ctx.fill();
    }
    ctx.fillStyle = 'rgba(230,120,110,.35)';
    ctx.beginPath(); ctx.arc(fx - 10, headY + 6, 3, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(fx + 10, headY + 6, 3, 0, 7); ctx.fill();

    if (a === 'palm') {
      ctx.strokeStyle = `rgba(255,215,140,${0.6 * Math.sin(k * Math.PI)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -30, 30 + k * 12, 0, 7); ctx.stroke();
    }

    // name stays upright and above the figure
    ctx.rotate(-rot);
    ctx.font = '12px "Noto Serif SC", serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = isMe ? '#f3d58f' : 'rgba(243,234,216,.8)';
    ctx.fillText(p.name, 0, rot ? -40 : headY - 26);
    ctx.restore();
  }

  function drawFloaters(dt) {
    ctx.textAlign = 'center';
    ctx.font = '15px "Noto Serif SC", serif';
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.t += dt;
      if (f.t > 1.6) { floaters.splice(i, 1); continue; }
      ctx.globalAlpha = 1 - f.t / 1.6;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - f.t * 30);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------- loop ----------------
  function stepEntity(p, dt, speed) {
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
    if (d > 1) {
      const m = Math.min(d, speed * dt);
      p.x += dx / d * m; p.y += dy / d * m;
      if (Math.abs(dx) > 1) p.face = dx > 0 ? 1 : -1;
      if (p.act === 'bow' || p.act === 'prostrate') p.act = null; // walking cancels a bow
    }
    else if (p === me && me.pending != null) doWheel(me.pending);
    if (p.act) { p.actT += dt; if (p.actT > ACT_LEN[p.act]) p.act = null; }
    if (p.beadTarget != null) p.beadRot = (p.beadRot || 0) + (p.beadTarget - (p.beadRot || 0)) * Math.min(1, dt * 12);
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;

    // keyboard movement
    let kx = 0, ky = 0;
    if (keys.has('arrowleft') || keys.has('a')) kx--;
    if (keys.has('arrowright') || keys.has('d')) kx++;
    if (keys.has('arrowup') || keys.has('w')) ky--;
    if (keys.has('arrowdown') || keys.has('s')) ky++;
    if (kx || ky) {
      me.pending = null;
      const n = Math.hypot(kx, ky);
      me.tx = clamp(me.x + kx / n * 30, 40, W - 40);
      me.ty = clamp(me.y + ky / n * 30, FLOOR_Y, H - 30);
    }

    stepEntity(me, dt, SPEED);
    if (me.mokShow > 0) { me.mokShow -= dt; me.mokHit += dt; }
    others.forEach((o) => stepEntity(o, dt, SPEED * 1.4));
    syncMove(now);

    // camera follows player horizontally when the view is narrower than the world
    const half = view.vw / 2;
    view.cx = view.vw >= W ? 0 : clamp(me.x - half, 0, W - view.vw);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1d1a17';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.s * view.dpr, 0, 0, view.s * view.dpr, (view.ox - view.cx * view.s) * view.dpr, view.oy * view.dpr);

    drawHall(t);
    drawSmoke(dt);
    // a spun wheel coasts down to a slow idle turn, so wheels are always moving
    wheels.forEach((w) => { w.a += w.vel * dt; w.vel = WHEEL_IDLE + (w.vel - WHEEL_IDLE) * Math.exp(-0.3 * dt); });
    const items = wheels.map((w) => ({ y: WHEEL_Y, draw: () => drawWheel(w) }));
    [me, ...others.values()].forEach((p) => items.push({ y: p.y, draw: () => drawMonk(p, t, p === me) }));
    if (me.mokShow > 0) items.push({ y: me.y + 0.5, draw: drawMoktak });
    items.sort((a, b) => a.y - b.y).forEach((it) => it.draw());
    drawFloaters(dt);

    requestAnimationFrame(loop);
  }
})();
