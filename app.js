// Workstation モバイル（スマホ用 PWA）
// 毎日確認・ガントチャート・カレンダー・Mac との同期。データはこのスマホの中（IndexedDB）だけに保存し、外へは送らない
(() => {
  const M = window.Model;
  const $ = s => document.querySelector(s);
  const icon = n => window.svgIcon(n);
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const todayKey = () => M.keyOf(new Date());
  const md = k => { const d = M.parseKey(k); return `${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`; };
  const hm = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  const fmtTime = ms => { if (!ms) return 'まだ'; const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${hm(d.getHours() * 60 + d.getMinutes())}`; };
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function btn(cls, content, onClick, label) {
    const b = el('button', cls);
    b.type = 'button';
    for (const c of [].concat(content ?? [])) { if (window.ICONS[c]) b.insertAdjacentHTML('beforeend', icon(c)); else b.append(c); }
    if (label) b.setAttribute('aria-label', label);
    if (onClick) b.addEventListener('click', e => { e.stopPropagation(); onClick(e); });
    return b;
  }
  const iconSpan = n => { const s = el('span'); s.innerHTML = icon(n); return s.firstChild; };

  // ---------- 保存（IndexedDB。1つの箱に1つの値） ----------
  const DB = {
    db: null,
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open('workstation-mobile', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { this.db = r.result; res(); };
        r.onerror = () => rej(r.error);
      });
    },
    get(k) {
      return new Promise((res, rej) => {
        const q = this.db.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
      });
    },
    set(k, v) {
      return new Promise((res, rej) => {
        const t = this.db.transaction('kv', 'readwrite');
        t.objectStore('kv').put(v, k);
        t.oncomplete = () => res(); t.onerror = () => rej(t.error);
      });
    },
  };

  // ---------- 状態 ----------
  let state = { base: null, ops: [], receivedAt: null, sentAt: null };
  let prefs = { theme: 'auto', showDone: false, closed: [] };
  let view = null;        // derive の結果（変わったときだけ作り直す）
  let tab = 'today';
  let selDay = todayKey();   // 毎日確認で見ている日
  let calMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
  let calSel = todayKey();
  let ganttScroll = null;    // ガントの横スクロール位置（タブを戻ったときにそのまま）

  const recompute = () => { view = M.derive(state); };
  async function saveState() { try { await DB.set('state', state); } catch { toast('保存できませんでした', 'warn'); } }
  async function savePrefs() { try { await DB.set('prefs', prefs); } catch {} }
  // スマホでの変更：記録して、画面を描き直す
  function commit(op) {
    state = M.addOp(state, op);
    recompute();
    saveState();
    render();
  }

  // ---------- お知らせ ----------
  let toastTimer = null;
  function toast(msg, kind = '') {
    const t = $('#toast');
    t.className = kind;
    t.innerHTML = icon(kind === 'warn' ? 'triangle-alert' : 'circle-check');
    t.append(msg);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
  }

  // ---------- 見た目（ライト／ダーク） ----------
  function applyTheme() {
    if (prefs.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = prefs.theme;
  }

  // ---------- 共通の部品（Mac 版と同じ形・同じクラス名） ----------
  const projOf = id => view.projects.find(p => p.id === id);
  const colorOf = t => projOf(t.project_id)?.color || '#717680';
  // 習慣のアイコン：うすく色を付けた丸に、色付きのアイコン
  function habitIcon(h, cls = 'hb-icon') {
    const i = el('span', cls);
    i.style.setProperty('--c', h.color);
    if (h.icon && h.icon.startsWith('lucide:')) i.innerHTML = icon(h.icon.slice(7));
    else i.textContent = h.icon || (h.name || '？').slice(0, 1);
    return i;
  }
  // 見出し（アイコン＋文字、右に小さな部品）
  function panelHead(ic, text, right) {
    const h = el('h3');
    h.innerHTML = icon(ic);
    h.append(text);
    if (right) { const r = el('span', 'right'); [].concat(right).forEach(x => r.append(x)); h.append(r); }
    return h;
  }
  const panel = (cls = '') => el('section', 'panel ' + cls);
  // 習慣のアイコンと色（Mac 版と同じもの）
  const HABIT_COLORS = ['#005cff', '#00c230', '#ff5a00', '#8600ff', '#1fb8cc', '#f2280d', '#ffae00', '#717680'];
  const HABIT_ICONS = ['droplet', 'glass-water', 'coffee', 'apple', 'salad', 'utensils', 'pill', 'book-open', 'notebook-pen', 'pen-line', 'languages', 'graduation-cap',
    'code', 'laptop', 'brain', 'dumbbell', 'footprints', 'bike', 'activity', 'heart-pulse', 'mountain', 'waves', 'wind', 'leaf', 'sprout', 'flower-2', 'sun', 'sunrise',
    'moon', 'bed', 'alarm-clock', 'timer', 'shower-head', 'bath', 'sparkles', 'smile', 'heart', 'users', 'phone-off', 'smartphone', 'cigarette-off', 'wine-off',
    'piggy-bank', 'wallet', 'music', 'guitar', 'palette', 'camera', 'gamepad-2', 'dog', 'cat', 'house', 'briefcase', 'clipboard-list', 'target', 'star', 'zap'].filter(n => window.ICONS[n]);
  let habitEdit = false;   // 毎日確認の「編集」中（押すとチェックではなく編集を開く）
  // 選んだ値（文字）から、プロジェクトのID（Mac の数字か、スマホで作った 'm:…'）に戻す
  const projIdOf = v => (v ? view.projects.find(p => String(p.id) === v)?.id ?? null : null);

  // タスク1行（Mac のホームの「今日のタスク」と同じ形）：丸を押すと完了・名前を押すと編集
  function taskRow(t, opt = {}) {
    const today = todayKey();
    const r = el('div', 'trow' + (t.completed ? ' done' : ''));
    r.style.setProperty('--c', colorOf(t));
    const ck = btn('tchk' + (t.completed ? ' on' : ''), 'check', () => setDone(t, !t.completed), t.completed ? 'まだにする' : '完了にする');
    const ttl = btn('ttl', [], () => openTask(t));
    const nm = el('b');
    if (t.milestone) nm.insertAdjacentHTML('beforeend', icon('flag'));
    nm.append(t.title);
    ttl.append(nm);
    const meta = el('small');
    meta.append(el('i', 'dot'), projOf(t.project_id)?.name || 'プロジェクトなし');
    const sd = k => { const d = M.parseKey(k); return `${d.getMonth() + 1}/${d.getDate()}`; };
    if (!opt.noDate && t.due) meta.append(` ・ ${t.start && t.start !== t.due ? `${sd(t.start)}〜${sd(t.due)}` : sd(t.due)}`);
    if (t.subs.length) meta.append(` ・ ${t.subs.filter(x => x.done).length}/${t.subs.length}`);
    if (t.repeat) { meta.insertAdjacentHTML('beforeend', icon('repeat')); }
    if (!t.completed && t.due && t.due < today) meta.append(el('em', 'bad', '期限切れ'));
    else if (M.behind(t, today, view.daysOff)) meta.append(el('em', 'slow', '遅れ'));
    ttl.append(meta);
    r.append(ck, ttl);
    return r;
  }
  function setDone(t, done) {
    commit({ type: 'task.done', task: t.id, done });
    if (done && t.repeat) toast('繰り返しの次の回は、Mac で取り込んだときに作られます');
  }
  // 確認項目の1行（Mac の毎日確認と同じ形）：左の丸でチェック
  function habitRow(h, day, opt = {}) {
    const today = todayKey(), off = view.daysOff;
    const on = h.done.has(day);
    const due = M.isDue(h, day, off);
    const r = el('div', 'hb-row' + (habitEdit && !opt.noEdit ? ' editing' : '') + (!due && !on ? ' rest' : ''));
    r.style.setProperty('--c', h.color);
    const toggle = () => {
      if (habitEdit && !opt.noEdit) { openHabit(h); return; }
      if (day > today) { toast('先の日はチェックできません', 'warn'); return; }
      commit({ type: 'habit.set', habit: h.id, day, on: !on });
      if (!on && navigator.vibrate) navigator.vibrate(12);
    };
    const ck = btn('hb-chk' + (on ? ' done' : '') + (!due ? ' off' : ''), 'check', toggle, on ? 'チェックを外す' : 'チェックする');
    const nb = btn('hb-name', [], toggle, h.name);
    const tx = el('span', 'txt');
    tx.append(el('span', 'nm', h.name));
    const st = M.streak(h, today, off);
    let sm;
    if (!due) sm = el('small', '', off.has(day) && !h.keepOnOff ? '休みの日はお休み' : 'この曜日はお休み');
    else if (st) { sm = el('small', 'hot'); sm.innerHTML = icon('flame'); sm.append(`${st}日連続`); }
    else sm = el('small', '', h.days.length === 7 ? '毎日' : h.days.length === 5 && !h.days.includes(0) && !h.days.includes(6) ? '平日' : h.days.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(x => WD[x]).join('・'));
    tx.append(sm);
    nb.append(habitIcon(h), tx);
    r.append(ck, nb);
    if (habitEdit && !opt.noEdit) r.append(btn('hb-edit', 'chevron-right', () => openHabit(h), '編集'));
    return r;
  }

  // ================= 毎日確認 =================
  function renderToday(main) {
    const today = todayKey();
    if (selDay > today) selDay = today;
    const off = view.daysOff;

    // 週（月曜始まり）。前後の週へ
    const d0 = M.parseKey(selDay);
    const mon = M.addDays(selDay, -((d0.getDay() + 6) % 7));
    const week = el('div', 'week');
    week.append(btn('iconBtn plain', 'chevron-left', () => { selDay = M.addDays(selDay, -7); render(); }, '前の週'));
    for (let i = 0; i < 7; i++) {
      const k = M.addDays(mon, i), d = M.parseKey(k);
      const sc = M.dayScore(view.habits, k, off);
      const b = btn('wday' + (k === today ? ' today' : '') + (k === selDay ? ' sel' : '') + (k > today ? ' future' : '') + (off.has(k) ? ' offd' : '') + (sc.due && sc.done >= sc.due ? ' all' : ''), [],
        () => { if (k <= today) { selDay = k; render(); } }, md(k));
      b.append(el('small', '', WD[d.getDay()]), el('b', '', String(d.getDate())));
      const bar = el('i'); const f = el('span'); f.style.width = (sc.due ? Math.round(sc.done / sc.due * 100) : 0) + '%'; bar.append(f);
      b.append(bar);
      week.append(b);
    }
    const nx = btn('iconBtn plain', 'chevron-right', () => { selDay = M.addDays(selDay, 7) > today ? today : M.addDays(selDay, 7); render(); }, '次の週');
    nx.disabled = M.addDays(mon, 7) > today;
    week.append(nx);
    main.append(week);

    // ---- 今日（リング・確認項目） ----
    const sc = M.dayScore(view.habits, selDay, off);
    const isOff = off.has(selDay);
    const p1 = panel('hb-today');
    const top = el('div', 'hb-todayTop' + (sc.due && sc.done >= sc.due ? ' all' : ''));
    const ring = el('div', 'hb-ring');
    const C = 2 * Math.PI * 28, pct = sc.due ? sc.done / sc.due : 0;
    ring.innerHTML = `<svg viewBox="0 0 64 64"><circle class="bgc" cx="32" cy="32" r="28"/><circle class="fgc" cx="32" cy="32" r="28" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>`;
    ring.append(el('b', '', sc.due ? `${sc.done}/${sc.due}` : '—'));
    const tx = el('div', 'hb-todayText');
    tx.append(el('div', 'date', md(selDay) + (selDay === today ? '' : '')));
    const msg = el('div', 'msg');
    if (isOff) { msg.innerHTML = icon('tree-palm'); msg.append(`${off.get(selDay)}の日（予定から外して計算）`); }
    else if (!sc.due) msg.append(view.habits.length ? 'この日にやる項目はありません' : 'まだ確認項目がありません');
    else if (sc.done >= sc.due) { msg.innerHTML = icon('party-popper'); msg.append('全部できました'); }
    else msg.append(`あと ${sc.due - sc.done} つ`);
    tx.append(msg);
    top.append(ring, tx);
    p1.append(top);
    p1.append(btn('btn white hb-offBtn', ['tree-palm', isOff ? '休みをやめる' : (selDay === today ? '今日を休みにする' : 'この日を休みにする')],
      () => commit({ type: 'dayoff.set', day: selDay, label: isOff ? null : '休み' })));

    const list = el('div', 'hb-list');
    const due = view.habits.filter(h => M.isDue(h, selDay, off));
    const rest = view.habits.filter(h => !M.isDue(h, selDay, off) && h.created <= selDay);
    (habitEdit ? view.habits : due).forEach(h => list.append(habitRow(h, selDay)));
    if (!habitEdit && rest.length) {
      list.append(el('div', 'hb-sep', 'お休みの項目'));
      rest.forEach(h => list.append(habitRow(h, selDay)));
    }
    if (!view.habits.length) {
      const e = el('div', 'empty');
      e.innerHTML = icon('sprout');
      e.append(el('p', '', '毎日続けたいことを追加しましょう（水を飲む・読書 15分 など）'));
      list.append(e);
    }
    const lh = el('div', 'hb-listHead');
    lh.append(el('span', '', '確認項目'));
    if (view.habits.length) lh.append(btn('linkBtn', habitEdit ? '完了' : '編集', () => { habitEdit = !habitEdit; render(); }));
    p1.append(lh, list, btn('hb-add', ['plus', '確認項目を追加'], () => openHabit(null)));
    main.append(p1);

    // ---- この月のまとめ（Mac の毎日確認の上の4つ） ----
    if (view.habits.length) {
      const m0 = selDay.slice(0, 8) + '01';
      const mEnd = M.keyOf(new Date(d0.getFullYear(), d0.getMonth() + 1, 0));
      const until = mEnd < today ? mEnd : today;
      let due2 = 0, done2 = 0, all = 0, offN = 0;
      for (let k = m0; k <= mEnd; k = M.addDays(k, 1)) {
        if (off.has(k)) offN++;
        if (k > until) continue;
        const s = M.dayScore(view.habits, k, off);
        due2 += s.due; done2 += s.done;
        if (s.due && s.done >= s.due) all++;
      }
      const kp = el('div', 'kpis');
      const kpi = (ic, label, value, unit, note) => {
        const k = el('div', 'kpi');
        const l = el('div', 'label'); l.innerHTML = icon(ic); l.append(label);
        const v = el('div', 'value', value); if (unit) v.append(el('small', '', unit));
        k.append(l, v, el('div', 'note', note));
        return k;
      };
      kp.append(kpi('target', `${d0.getMonth() + 1}月の達成率`, due2 ? String(Math.round(done2 / due2 * 100)) : '—', due2 ? '%' : '', `${done2} / ${due2} 回`),
        kpi('repeat', '達成回数', String(done2), '回', `予定 ${due2} 回`),
        kpi('trophy', '全部できた日', String(all), '日', '予定がすべてできた日'),
        kpi('tree-palm', '休みの日', String(offN), '日', '予定から外して計算'));
      main.append(kp);

      // 項目ごとの達成率（この月）
      const p2 = panel();
      p2.append(panelHead('chart-bar', '項目ごとの達成率', el('span', '', `${d0.getMonth() + 1}月`)));
      const ch = el('div', 'hb-hchart');
      for (const h of view.habits) {
        let tg = 0, dn = 0;
        for (let k = m0 > h.created ? m0 : h.created; k <= until; k = M.addDays(k, 1)) if (M.isDue(h, k, off)) { tg++; if (h.done.has(k)) dn++; }
        const rate = tg ? Math.round(dn / tg * 100) : null;
        const lb = el('div', 'hl'); lb.append(habitIcon(h), el('span', '', h.name));
        const tr = el('div', 'track'); const f = el('span'); f.style.width = (rate || 0) + '%'; f.style.setProperty('--c', h.color); tr.append(f);
        const v = el('div', 'hv', rate == null ? '—' : rate + '%'); v.append(el('small', '', `${dn}/${tg}`));
        ch.append(lb, tr, v);
      }
      p2.append(ch);
      main.append(p2);
    }

    // ---- その日のタスク ----
    const ts = view.tasks.filter(t => M.onDay(t, selDay) && (!t.completed || prefs.showDone || t.completed_at >= M.parseKey(selDay).getTime()));
    const p3 = panel();
    p3.append(panelHead('sun', selDay === today ? '今日のタスク' : 'この日のタスク', el('span', '', `${ts.filter(t => t.completed).length} / ${ts.length}`)));
    if (!ts.length) p3.append(el('div', 'noData', '期間に入っているタスクはありません'));
    ts.forEach(t => p3.append(taskRow(t, { noDate: true })));
    p3.append(btn('addTask', ['plus', 'タスクを追加'], () => openTask(null)));
    main.append(p3);
  }

  // ================= ガントチャート（Mac と同じバー：うすい色の地に、終えた分を濃く。名前はバーの右） =================
  const G_BEFORE = 14, G_AFTER = 75, DW = 34;
  function projectCards(main) {
    const box = el('div', 'pcards');
    const today = todayKey();
    for (const p of view.projects) {
      const all = view.tasks.filter(t => t.project_id === p.id);
      const done = all.filter(t => t.completed).length;
      const next = all.filter(t => !t.completed && t.due).sort((a, b) => (a.due < b.due ? -1 : 1))[0];
      const c = btn('pcard', [], () => openProject(p), p.name);
      c.style.setProperty('--c', p.color);
      const f = el('div', 'pcFront');
      f.append(el('div', 'pcName', p.name));
      const meta = el('div', 'pcMeta');
      meta.append(el('span', '', `残り ${all.length - done}件`), el('span', '', `完了 ${done}/${all.length}`));
      if (next) { const s = el('span'); s.innerHTML = icon('clock'); s.append(next.due === today ? '今日' : next.due < today ? '期限切れ' : md(next.due).replace(/\(.\)/, '')); meta.append(s); }
      f.append(meta);
      const pr = el('div', 'pcBar'); const pf = el('i');
      pf.style.width = (all.length ? Math.round(all.reduce((a, t) => a + M.progress(t), 0) / all.length * 100) : 0) + '%';
      pr.append(pf); f.append(pr);
      c.append(f);
      box.append(c);
    }
    box.append(btn('pcAdd', ['folder-plus', 'プロジェクトを追加'], () => openProject(null)));
    main.append(box);
  }
  function renderGantt(main) {
    const today = todayKey();
    const tasks = view.tasks.filter(t => t.due && (prefs.showDone || !t.completed));
    // 右端：いちばん遅い期限の1週間後まで（少なくとも今日から G_AFTER 日。長くても1年半）
    const lastDue = tasks.reduce((m, t) => (t.due > m ? t.due : m), today);
    const from = M.addDays(today, -G_BEFORE);
    const days = Math.min(550, Math.max(G_BEFORE + G_AFTER + 1, M.diffDays(from, lastDue) + 8));
    const W = days * DW;
    const xOf = k => M.diffDays(from, k) * DW;

    const tool = el('div', 'gtool');
    const seg = el('div', 'seg');
    seg.append(btn(prefs.showDone ? '' : 'on', '進行中', () => { prefs.showDone = false; savePrefs(); render(); }),
      btn(prefs.showDone ? 'on' : '', 'すべて', () => { prefs.showDone = true; savePrefs(); render(); }));
    const goToday = btn('btn white small', ['locate-fixed', '今日'], () => { sc.scrollTo({ left: (G_BEFORE - 2) * DW, behavior: 'smooth' }); });
    tool.append(seg, goToday);
    main.append(tool);
    projectCards(main);

    const wrap = el('div', 'gwrap');
    const sc = el('div', 'gscroll');
    const inner = el('div', 'ginner');
    inner.style.width = W + 'px';
    inner.style.setProperty('--dw', DW + 'px');
    sc.append(inner);
    wrap.append(sc);

    // 見出し：月と日
    const head = el('div', 'ghead');
    for (let i = 0; i < days;) {
      const d = M.parseKey(M.addDays(from, i));
      const left = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1;
      const n = Math.min(left, days - i);
      const mc = el('div', 'mcell'); mc.style.left = i * DW + 'px'; mc.style.width = n * DW + 'px';
      mc.append(el('span', '', `${d.getFullYear() !== M.parseKey(today).getFullYear() ? d.getFullYear() + '年' : ''}${d.getMonth() + 1}月`));
      head.append(mc);
      i += n;
    }
    for (let i = 0; i < days; i++) {
      const k = M.addDays(from, i), d = M.parseKey(k);
      const c = el('div', 'dcell' + ([0, 6].includes(d.getDay()) ? ' we' : '') + (k === today ? ' today' : '') + (view.daysOff.has(k) ? ' off' : ''));
      c.style.left = i * DW + 'px';
      c.append(el('span', '', String(d.getDate())));
      head.append(c);
    }
    inner.append(head);

    // 本体：週末・休みの日・今日の線を背景に
    const body = el('div', 'gbody');
    const bg = el('div', 'gbg');
    for (let i = 0; i < days; i++) {
      const k = M.addDays(from, i), wd = M.parseKey(k).getDay();
      if (view.daysOff.has(k)) { const o = el('i', 'g-off'); o.style.left = i * DW + 'px'; bg.append(o); }
      else if (wd === 0 || wd === 6) { const o = el('i', 'g-we'); o.style.left = i * DW + 'px'; bg.append(o); }
    }
    const tl = el('i', 'g-now'); tl.style.left = (G_BEFORE * DW + DW / 2 - 1) + 'px';
    bg.append(tl);
    body.append(bg);

    const groups = [...view.projects.map(p => ({ p, list: tasks.filter(t => t.project_id === p.id) })),
      { p: { id: 0, name: 'プロジェクトなし', color: '#717680' }, list: tasks.filter(t => !projOf(t.project_id)) }].filter(g => g.list.length);
    if (!groups.length) {
      const e = el('div', 'empty');
      e.innerHTML = icon('chart-gantt');
      e.append(el('p', '', prefs.showDone ? '日付のあるタスクはありません' : '進行中のタスクはありません'));
      e.append(btn('btn primary small', ['plus', 'タスクを追加'], () => openTask(null)));
      body.append(e);
    }
    const label = (t, x, cls = '') => {
      const today2 = today, lb = btn('blabel ' + cls + (t.completed ? ' done' : ''), [], () => openTask(t), t.title);
      if (t.completed) lb.insertAdjacentHTML('beforeend', icon('check'));
      else if (t.due < today2) { lb.insertAdjacentHTML('beforeend', icon('triangle-alert')); lb.lastChild.classList.add('bad'); }
      else if (M.behind(t, today2, view.daysOff)) { lb.insertAdjacentHTML('beforeend', icon('clock')); lb.lastChild.classList.add('slow'); }
      if (t.repeat) lb.insertAdjacentHTML('beforeend', icon('repeat'));
      lb.append(el('span', '', t.title));
      lb.style.left = x + 'px';
      return lb;
    };
    groups.forEach((g, gi) => {
      const closed = prefs.closed.includes(g.p.id);
      const all = g.list;
      const dn = all.filter(t => t.completed).length;
      const row = el('div', 'grow grp' + (gi ? '' : ' first') + (closed ? ' closed' : ''));
      row.style.setProperty('--c', g.p.color);
      // 名前（左に止まる）
      const nb = btn('grpName', ['chevron-down'], () => {
        prefs.closed = closed ? prefs.closed.filter(x => x !== g.p.id) : [...prefs.closed, g.p.id];
        savePrefs(); render();
      });
      nb.append(el('i', 'dot'), el('span', 'nm', g.p.name), el('small', '', `${dn}/${all.length}`));
      row.append(nb);
      // プロジェクト全体の期間と進み具合
      const s = all.reduce((a, t) => (t.start < a ? t.start : a), all[0].start), e = all.reduce((a, t) => (t.due > a ? t.due : a), all[0].due);
      const pb = el('div', 'pbar');
      pb.style.left = xOf(s) + 'px'; pb.style.width = (M.diffDays(s, e) + 1) * DW + 'px';
      const pf = el('i'); pf.style.width = Math.round(all.reduce((a, t) => a + M.progress(t), 0) / all.length * 100) + '%';
      pb.append(pf);
      row.append(pb);
      body.append(row);
      if (closed) return;
      for (const t of all) {
        const r = el('div', 'grow');
        r.style.setProperty('--c', colorOf(t));
        const x = xOf(t.start);
        if (t.milestone) {
          const m = btn('ms' + (t.completed ? ' isdone' : '') + (!t.completed && t.due < today ? ' late' : ''), [], () => openTask(t), t.title);
          m.style.left = (xOf(t.due) + DW / 2 - 10) + 'px';
          r.append(m, label(t, xOf(t.due) + DW / 2 + 16));
        } else {
          const w = (M.diffDays(t.start, t.due) + 1) * DW, prog = Math.round(M.progress(t) * 100);
          const late = !t.completed && t.due < today, slow = !late && M.behind(t, today, view.daysOff);
          const b = btn('bar' + (t.completed ? ' isdone' : '') + (late ? ' late' : slow ? ' behind' : ''), [], () => openTask(t), t.title);
          b.style.left = x + 'px'; b.style.width = w + 'px';
          const pr = el('div', 'prog'); pr.style.width = prog + '%'; b.append(pr);
          const g2 = M.target(t, today, view.daysOff);
          if (g2 > 0 && g2 < 1) { const m = el('i', 'tgt'); m.style.left = Math.round(g2 * 100) + '%'; b.append(m); }
          if (w >= 50) {
            const pc = el('div', 'pct' + (prog < 30 ? ' lo' : ''), prog + '%');
            if (prog < 30) pc.style.paddingLeft = `calc(${prog}% + 8px)`;
            b.append(pc);
          }
          r.append(b, label(t, x + w + 8));
        }
        body.append(r);
      }
    });
    inner.append(body);
    main.append(wrap);
    sc.scrollLeft = ganttScroll ?? (G_BEFORE - 2) * DW;
    let raf = 0;
    sc.addEventListener('scroll', () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; ganttScroll = sc.scrollLeft; }); }, { passive: true });

    // 日付のないタスク
    const nod = view.tasks.filter(t => !t.due && (prefs.showDone || !t.completed));
    if (nod.length) {
      const p = panel();
      p.append(panelHead('inbox', '日付なし', el('span', '', `${nod.length}件`)));
      nod.forEach(t => p.append(taskRow(t)));
      main.append(p);
    }
  }

  // ================= カレンダー（Mac の月のカレンダーと同じ：タスクは日をまたぐバー） =================
  const LANES = 3;
  function renderCal(main) {
    const today = todayKey();
    const nav = el('div', 'mnav');
    nav.append(btn('iconBtn', 'chevron-left', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); render(); }, '前の月'),
      el('b', '', `${calMonth.getFullYear()}年${calMonth.getMonth() + 1}月`),
      btn('iconBtn', 'chevron-right', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); render(); }, '次の月'),
      btn('btn white small', ['locate-fixed', '今月'], () => { const d = new Date(); calMonth = new Date(d.getFullYear(), d.getMonth(), 1); calSel = today; render(); }));
    main.append(nav);

    const cal = el('div', 'cal-month');
    const wd = el('div', 'cal-wd');
    [1, 2, 3, 4, 5, 6, 0].forEach(i => wd.append(el('span', i === 0 || i === 6 ? 'we' : '', WD[i])));
    cal.append(wd);
    const first = M.keyOf(calMonth);
    const start = M.addDays(first, -((calMonth.getDay() + 6) % 7));
    const weeks = Math.ceil((M.diffDays(start, first) + new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate()) / 7);
    const list = view.tasks.filter(t => t.due && (!t.completed || prefs.showDone))
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : M.diffDays(b.start, b.due) - M.diffDays(a.start, a.due)));
    for (let w = 0; w < weeks; w++) {
      const ws = M.addDays(start, w * 7), we = M.addDays(ws, 6);
      const row = el('div', 'cal-week');
      for (let i = 0; i < 7; i++) {
        const k = M.addDays(ws, i), d = M.parseKey(k);
        const off = view.daysOff.get(k);
        const c = btn('cal-day' + (d.getMonth() !== calMonth.getMonth() ? ' out' : '') + ([0, 6].includes(d.getDay()) ? ' we' : '') + (k === today ? ' today' : '') + (k === calSel ? ' sel' : '') + (off ? ' off' : ''),
          [], () => { calSel = k; if (d.getMonth() !== calMonth.getMonth()) calMonth = new Date(d.getFullYear(), d.getMonth(), 1); render(); }, md(k));
        c.style.gridColumn = String(i + 1);
        const tp = el('div', 'cal-dtop');
        tp.append(el('span', 'cal-dnum', String(d.getDate())));
        if (k <= today) {
          const s = M.dayScore(view.habits, k, view.daysOff);
          if (s.due && s.done) tp.append(el('i', 'cal-hb' + (s.done >= s.due ? ' full' : '')));
        }
        c.append(tp);
        if (off) c.append(el('span', 'cal-off', off));
        row.append(c);
      }
      // この週にかかるタスクを、空いている段に並べる
      const lanes = [], hidden = Array(7).fill(0);
      for (const t of list) {
        if (t.due < ws || t.start > we) continue;
        const a = Math.max(0, M.diffDays(ws, t.start)), b = Math.min(6, M.diffDays(ws, t.due));
        let lane = lanes.findIndex(end => end < a);
        if (lane < 0 && lanes.length < LANES) { lanes.push(-1); lane = lanes.length - 1; }
        if (lane < 0) { for (let i = a; i <= b; i++) hidden[i]++; continue; }
        lanes[lane] = b;
        const late = !t.completed && t.due < today;
        const bar = btn('cal-bar' + (t.milestone ? ' ms' : '') + (t.completed ? ' done' : '') + (late ? ' late' : '') + (t.start < ws ? ' cont-l' : '') + (t.due > we ? ' cont-r' : ''), [], () => openTask(t), t.title);
        bar.style.setProperty('--c', colorOf(t));
        bar.style.gridColumn = `${a + 1} / ${b + 2}`;
        bar.style.gridRow = String(lane + 2);
        if (t.milestone) bar.insertAdjacentHTML('beforeend', icon('flag'));
        bar.append(el('span', '', t.title));
        row.append(bar);
      }
      hidden.forEach((n, i) => {
        if (!n) return;
        const m = btn('cal-more', `+${n}`, () => { calSel = M.addDays(ws, i); render(); }, `ほか${n}件`);
        m.style.gridColumn = String(i + 1); m.style.gridRow = String(LANES + 2);
        row.append(m);
      });
      cal.append(row);
    }
    const lg = el('div', 'legend');
    lg.innerHTML = '<span><i class="cal-hb full"></i>確認項目を全部できた</span><span><i class="cal-hb"></i>一部できた</span><span><i class="sq off"></i>休みの日</span>';
    cal.append(lg);
    main.append(cal);

    // ---- 選んだ日 ----
    const k = calSel;
    const p = panel('dayPanel');
    const isOff = view.daysOff.has(k);
    const hd = el('div', 'dayHead');
    hd.append(el('b', '', md(k)));
    if (k === today) hd.append(el('span', 'chip ok', '今日'));
    if (isOff) hd.append(el('span', 'chip off', view.daysOff.get(k)));
    hd.append(btn('btn small white', ['tree-palm', isOff ? '休みをやめる' : '休みにする'], () => commit({ type: 'dayoff.set', day: k, label: isOff ? null : '休み' })));
    p.append(hd);

    const ts = view.tasks.filter(t => M.onDay(t, k) && (!t.completed || prefs.showDone));
    p.append(panelHead('list-todo', 'タスク', el('span', '', `${ts.length}件`)));
    if (!ts.length) p.append(el('div', 'noData', 'この日のタスクはありません'));
    ts.forEach(t => p.append(taskRow(t)));
    p.append(btn('addTask', ['plus', 'タスクを追加'], () => openTask(null, k)));

    const plans = view.plans.filter(x => x.day === k).sort((a, b) => a.start_min - b.start_min);
    if (plans.length) {
      p.append(panelHead('calendar-clock', '作業計画', el('span', '', 'Mac で作った時間割')));
      for (const x of plans) {
        const r = el('div', 'plan');
        r.style.setProperty('--c', projOf(x.project_id)?.color || 'var(--g400)');
        r.append(el('time', '', `${hm(x.start_min)}–${hm(x.end_min)}`), el('i', 'pl'), el('b', '', x.title));
        p.append(r);
      }
    }
    if (view.habits.length) {
      const s = M.dayScore(view.habits, k, view.daysOff);
      p.append(panelHead('calendar-check', '確認項目', el('span', '', `${s.done} / ${s.due}`)));
      const l = el('div', 'hb-list');
      view.habits.filter(h => h.created <= k && (M.isDue(h, k, view.daysOff) || h.done.has(k))).forEach(h => l.append(habitRow(h, k, { noEdit: true })));
      if (!l.childElementCount) l.append(el('div', 'noData', 'この日にやる項目はありません'));
      p.append(l);
    }
    main.append(p);
  }

  // ================= 同期 =================
  function renderSync(main) {
    const kp = el('div', 'kpis');
    const k1 = el('div', 'kpi'); const l1 = el('div', 'label'); l1.innerHTML = icon('upload'); l1.append('送っていない変更');
    const v1 = el('div', 'value', String(state.ops.length)); v1.append(el('small', '', '件'));
    k1.append(l1, v1, el('div', 'note', state.sentAt ? `最後に送った日 ${fmtTime(state.sentAt)}` : 'まだ送っていません'));
    const k2 = el('div', 'kpi'); const l2 = el('div', 'label'); l2.innerHTML = icon('download'); l2.append('受け取った日');
    k2.append(l2, el('div', 'value s', state.base ? fmtTime(state.base.exportedAt) : 'まだ'), el('div', 'note', state.base ? 'Mac で書き出した時刻' : 'スマホだけで使っています'));
    kp.append(k1, k2);
    main.append(kp);

    const c = panel();
    const bs = el('div', 'syncBtns');
    bs.append(btn('btn primary wide', ['download', 'ファイルを取り込む'], pickFile),
      btn('btn white wide', ['upload', state.ops.length ? `Macへ送る（${state.ops.length}件）` : 'Macへ送る'], sendToMac));
    c.append(bs);
    main.append(c);

    const how = panel();
    how.append(panelHead('info', '同期のしかた'));
    const ol = el('ol', 'steps');
    for (const t of [
      'Mac の Workstation で「設定 → スマホ用に書き出す」。できたファイルを AirDrop などでスマホへ送り、ここの「ファイルを取り込む」で選びます。',
      'スマホで確認項目のチェックやタスクを変えたら「Macへ送る」。ファイルを Mac へ送り、Mac の「設定 → スマホの変更を取り込む」で選びます。',
      'Mac で取り込んだら、もう一度「スマホ用に書き出す」→「ファイルを取り込む」をすると、送った変更がここから消えます（何度送っても二重にはなりません）。',
    ]) ol.append(el('li', '', t));
    how.append(ol);
    how.append(el('div', 'noData', 'スマホだけでも使えます。スマホで作った確認項目やプロジェクトも「Macへ送る」で Mac に入ります（同じ名前のものは1つにまとまります）。学習計画などをまとめて入れる「追加用のファイル」も「ファイルを取り込む」で入ります。'));
    main.append(how);

    const set = panel();
    set.append(panelHead('settings', '設定'));
    const r1 = el('div', 'setRow');
    r1.append(el('span', '', '見た目'));
    const seg = el('div', 'seg');
    for (const [v, l] of [['auto', '自動'], ['light', 'ライト'], ['dark', 'ダーク']]) {
      seg.append(btn(prefs.theme === v ? 'on' : '', l, () => { prefs.theme = v; applyTheme(); savePrefs(); render(); }));
    }
    r1.append(seg);
    const r2 = el('div', 'setRow');
    r2.append(el('span', '', 'このスマホのデータを消す'));
    r2.append(btn('btn small danger', ['trash-2', '消す'], async () => {
      if (!confirm('このスマホに入っているデータを消しますか？\n' + (state.ops.length ? `Mac へ送っていない変更（${state.ops.length}件）も消えます。\n` : '') + 'Mac のデータはそのままです。')) return;
      state = { base: null, ops: [], receivedAt: null, sentAt: null };
      recompute(); await saveState(); render(); toast('消しました');
    }));
    set.append(r1, r2);
    main.append(set);
    const v = el('div', 'foot'); v.innerHTML = icon('circle-check'); v.append('データはこのスマホの中だけに保存され、外へは送りません');
    main.append(v);
  }

  // Mac のファイルを選ぶ
  function pickFile() { $('#filePick').value = ''; $('#filePick').click(); }
  $('#filePick').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      if (f.size > 30 * 1024 * 1024) throw new Error('ファイルが大きすぎます');
      const data = JSON.parse(await f.text());
      // 追加用のファイル（学習計画など）：スマホでした変更として足す
      if (data && data.kind === 'changes') {
        const r = M.importOps(state, data);
        if (!r.added) { toast('このファイルの中身は、もう入っています'); return; }
        state = r.state;
        recompute();
        await saveState();
        render();
        toast(`${r.added}件を取り込みました`);
        return;
      }
      const snap = M.checkSnapshot(data);
      if (state.base && snap.exportedAt < state.base.exportedAt && !confirm('今あるデータより前に書き出したファイルです。読み込みますか？')) return;
      const before = state.ops.length;
      state = M.receive(state, snap);
      recompute();
      await saveState();
      render();
      const sent = before - state.ops.length;
      toast(sent > 0 ? `受け取りました（送った変更 ${sent}件は Mac に入っていました）` : '受け取りました');
    } catch (err) {
      toast(err instanceof SyntaxError ? 'ファイルを読めませんでした（JSONではありません）' : err.message, 'warn');
    }
  });

  // Mac へ送る：共有シート（AirDrop など）。使えないときはファイルを保存
  async function sendToMac() {
    if (!state.ops.length && !confirm('送っていない変更はありません。それでもファイルを作りますか？')) return;
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const name = `workstation-from-phone-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
    const text = JSON.stringify(M.buildChanges(state, 'phone'));
    const file = new File([text], name, { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Workstation の変更' });
      } else {
        const a = el('a');
        a.href = URL.createObjectURL(file); a.download = name;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      state = { ...state, sentAt: Date.now() };
      await saveState();
      render();
      toast('Mac の「スマホの変更を取り込む」で選んでください');
    } catch (err) {
      if (err && err.name === 'AbortError') return;   // 共有をやめた
      toast('送れませんでした', 'warn');
    }
  }

  // ================= タスクのシート =================
  const sheet = $('#sheet');
  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });   // 外側を押したら閉じる
  function openTask(t, defDay) {
    const isNew = !t;
    const inn = $('#sheetIn');
    inn.innerHTML = '';
    inn.append(el('div', 'grab'));
    const hd = el('div', 'shHead');
    hd.append(el('h3', '', isNew ? 'タスクを追加' : 'タスク'));
    if (!isNew) hd.append(btn('btn small' + (t.completed ? ' white' : ' primary'), [t.completed ? 'x' : 'check', t.completed ? 'まだにする' : '完了'], () => { sheet.close(); setDone(t, !t.completed); }));
    hd.append(btn('iconBtn plain', 'x', () => sheet.close(), '閉じる'));
    inn.append(hd);

    const title = el('input', 'inp'); title.value = t?.title || ''; title.placeholder = 'タスクの名前'; title.maxLength = 200;
    inn.append(field('名前', title));
    const proj = el('select', 'inp');
    const o0 = el('option', '', 'プロジェクトなし'); o0.value = ''; proj.append(o0);
    view.projects.forEach(p => { const o = el('option', '', p.name); o.value = String(p.id); proj.append(o); });
    const oNew = el('option', '', '＋ 新しいプロジェクトを作る…'); oNew.value = '__new'; proj.append(oNew);
    proj.value = t ? (projOf(t.project_id) ? String(t.project_id) : '') : (prefs.lastProject && projOf(prefs.lastProject) ? String(prefs.lastProject) : '');
    let lastPick = proj.value;
    // 「新しいプロジェクトを作る」を選んだら、その下に名前の欄を出す
    const np = el('div', 'newProj'); np.hidden = true;
    const npIn = el('input', 'inp'); npIn.placeholder = '新しいプロジェクトの名前'; npIn.maxLength = 80;
    const makeProj = () => {
      const name = npIn.value.trim();
      if (!name) { npIn.focus(); return; }
      const key = M.newKey();
      state = M.addOp(state, { type: 'project.add', key, name, color: HABIT_COLORS[view.projects.length % HABIT_COLORS.length] });
      recompute(); saveState();
      const o = el('option', '', name); o.value = key; proj.insertBefore(o, oNew);
      proj.value = lastPick = key;
      np.hidden = true; npIn.value = '';
    };
    npIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); makeProj(); } });
    np.append(npIn, btn('btn small primary', '作る', makeProj));
    proj.addEventListener('change', () => {
      if (proj.value !== '__new') { lastPick = proj.value; np.hidden = true; return; }
      proj.value = lastPick;
      np.hidden = false; npIn.focus();
    });
    const pf = field('プロジェクト', proj);
    pf.append(np);
    inn.append(pf);
    const two = el('div', 'two');
    const st = el('input', 'inp'); st.type = 'date'; st.value = t?.start || (isNew ? defDay || todayKey() : '');
    const du = el('input', 'inp'); du.type = 'date'; du.value = t?.due || (isNew ? defDay || todayKey() : '');
    two.append(field('開始日', st), field('期限', du));
    inn.append(two);
    const msL = el('label', 'tog'); const ms = el('input'); ms.type = 'checkbox'; ms.checked = !!t?.milestone;
    msL.append(ms, '節目（締切・発表日など1日だけ）');
    inn.append(msL);
    ms.addEventListener('change', () => { st.disabled = ms.checked; });
    st.disabled = ms.checked;
    // 進み具合と目標
    if (t && !t.milestone && t.due && !t.completed) {
      const today = todayKey(), pr = Math.round(M.progress(t) * 100), g = M.target(t, today, view.daysOff);
      const box = el('div', 'goal');
      const late = t.due < today;
      const diff = pr - Math.round(g * 100);
      box.append(el('b', '', `実際 ${pr}%`), el('span', '', `目標 ${Math.round(g * 100)}%`),
        el('em', late ? 'bad' : diff < 0 ? 'slow' : 'good', late ? '期限切れ' : diff < 0 ? `${-diff}% 遅れ` : diff > 0 ? `${diff}% 先行` : '予定どおり'));
      const track = el('div', 'gtr');
      const f = el('i'); f.style.width = pr + '%'; f.style.background = colorOf(t);
      const m = el('b'); m.style.left = Math.round(g * 100) + '%';
      track.append(f, m);
      box.append(track, el('small', '', '目標は、期間のうち昨日までに過ぎた日の割合です（休みの日は数えません）'));
      inn.append(box);
    }
    if (t?.repeat) { const r = el('div', 'chip'); r.innerHTML = icon('repeat'); r.append(`繰り返し：${M.repeatLabel(t.repeat)}（変えるのは Mac で）`); r.style.marginBottom = '12px'; inn.append(r); }

    // サブタスク：チェックは保存のときにまとめて
    const subs = el('div', 'subs');
    subs.append(el('div', 'sub', 'サブタスク'));
    const draft = (t?.subs || []).map(s => ({ id: s.id, title: s.title, done: !!s.done, was: !!s.done }));
    const list = el('div');
    const drawSubs = () => {
      list.innerHTML = '';
      draft.forEach(s => {
        const r = el('label', 'row' + (s.done ? ' done' : ''));
        const c = el('input'); c.type = 'checkbox'; c.checked = s.done;
        c.addEventListener('change', () => { s.done = c.checked; r.classList.toggle('done', s.done); });
        r.append(c, el('span', '', s.title));
        list.append(r);
      });
    };
    drawSubs();
    const add = el('div', 'add');
    const ai = el('input', 'inp'); ai.placeholder = 'サブタスクを足す'; ai.maxLength = 300;
    const addSub = () => { const v = ai.value.trim(); if (!v) return; draft.push({ id: null, title: v, done: false, was: false }); ai.value = ''; drawSubs(); };
    ai.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } });
    add.append(ai, btn('iconBtn dark', 'plus', addSub, '足す'));
    subs.append(list, add);
    inn.append(subs);
    if (t?.note) { inn.append(el('div', 'sub', 'メモ')); inn.append(el('div', 'tnote', t.note)); }

    const bt = el('div', 'shBtns');
    if (!isNew) bt.append(btn('btn danger', ['trash-2', '消す'], () => {
      if (!confirm(`「${t.title}」を消しますか？`)) return;
      sheet.close(); commit({ type: 'task.delete', task: t.id }); toast('消しました');
    }));
    bt.append(btn('btn primary', isNew ? '追加' : '保存', () => {
      const name = title.value.trim();
      if (!name) { title.focus(); toast('名前を入れてください', 'warn'); return; }
      const pid = projIdOf(proj.value);
      const dates = M.normalizeDates(st.value || null, du.value || null, ms.checked);
      let ref = t?.id;
      if (isNew) {
        ref = M.newKey();
        state = M.addOp(state, { type: 'task.add', key: ref, project_id: pid, title: name, ...dates, milestone: ms.checked ? 1 : 0 });
        prefs.lastProject = pid; savePrefs();
      } else {
        const f = {};
        if (name !== t.title) f.title = name;
        if (pid !== (projOf(t.project_id) ? t.project_id : null)) f.project_id = pid;
        if (!!ms.checked !== !!t.milestone) f.milestone = ms.checked ? 1 : 0;
        if (dates.start !== t.start) f.start = dates.start;
        if (dates.due !== t.due) f.due = dates.due;
        if (Object.keys(f).length) state = M.addOp(state, { type: 'task.edit', task: ref, fields: f });
      }
      for (const s of draft) {
        if (!s.id) state = M.addOp(state, { type: 'sub.add', key: s.id = M.newKey(), task: ref, title: s.title });
        if (s.done !== s.was) state = M.addOp(state, { type: 'sub.done', sub: s.id, done: s.done });
      }
      recompute(); saveState();
      sheet.close(); render();
      toast(isNew ? '追加しました' : '保存しました');
    }));
    inn.append(bt);
    sheet.showModal();
    if (isNew) setTimeout(() => title.focus(), 250);
  }

  // ================= 習慣のシート =================
  // 色を選ぶ部品（丸いボタンを並べる）
  function colorPicker(cur, onPick) {
    const box = el('div', 'swatches');
    HABIT_COLORS.forEach(c => {
      const b = btn('sw' + (c === cur ? ' on' : ''), [], () => { box.querySelectorAll('.sw').forEach(x => x.classList.remove('on')); b.classList.add('on'); onPick(c); }, c);
      b.style.background = c;
      box.append(b);
    });
    return box;
  }
  function sheetHead(inn, title) {
    inn.innerHTML = '';
    inn.append(el('div', 'grab'));
    const hd = el('div', 'shHead');
    hd.append(el('h3', '', title), btn('iconBtn plain', 'x', () => sheet.close(), '閉じる'));
    inn.append(hd);
    return hd;
  }
  const field = (label, input) => { const l = el('label', 'fld'); l.append(el('span', '', label), input); return l; };

  function openHabit(h) {
    const isNew = !h;
    const inn = $('#sheetIn');
    sheetHead(inn, isNew ? '確認項目を追加' : '確認項目を編集');
    const d = {
      name: h?.name || '', color: h?.color || HABIT_COLORS[view.habits.length % HABIT_COLORS.length],
      icon: h?.icon || 'lucide:' + HABIT_ICONS[view.habits.length % HABIT_ICONS.length],
      days: (h?.days || [0, 1, 2, 3, 4, 5, 6]).slice(), keepOnOff: !!h?.keepOnOff,
    };
    // 見本（名前・色・アイコンを変えるとすぐ変わる）
    const prev = el('div', 'hPrev');
    const drawPrev = () => { prev.innerHTML = ''; prev.append(habitIcon({ ...d, name: d.name || '？' }), el('b', '', d.name || '名前を入れてください')); };
    inn.append(prev);

    const name = el('input', 'inp'); name.value = d.name; name.placeholder = '例：水を飲む'; name.maxLength = 80;
    name.addEventListener('input', () => { d.name = name.value.trim(); drawPrev(); });
    inn.append(field('名前', name));

    const cl = el('div', 'fld'); cl.append(el('span', '', '色'), colorPicker(d.color, c => { d.color = c; drawPrev(); }));
    inn.append(cl);

    const il = el('div', 'fld');
    il.append(el('span', '', 'アイコン'));
    const grid = el('div', 'iconGrid');
    const drawIcons = () => {
      grid.innerHTML = '';
      HABIT_ICONS.forEach(n => {
        const b = btn('ig' + (d.icon === 'lucide:' + n ? ' on' : ''), n, () => { d.icon = 'lucide:' + n; emo.value = ''; drawIcons(); drawPrev(); }, n);
        grid.append(b);
      });
    };
    const emo = el('input', 'inp emo'); emo.placeholder = '絵文字にする（例 💧）'; emo.maxLength = 8;
    emo.value = d.icon.startsWith('lucide:') ? '' : d.icon;
    emo.addEventListener('input', () => { const v = emo.value.trim(); d.icon = v || 'lucide:' + HABIT_ICONS[0]; drawIcons(); drawPrev(); });
    drawIcons();
    il.append(grid, emo);
    inn.append(il);

    const dl = el('div', 'fld');
    dl.append(el('span', '', 'やる曜日'));
    const days = el('div', 'dayPick');
    [1, 2, 3, 4, 5, 6, 0].forEach(i => {
      const b = btn('dp' + (d.days.includes(i) ? ' on' : ''), WD[i], () => {
        if (d.days.includes(i)) { if (d.days.length === 1) { toast('1つは選んでください', 'warn'); return; } d.days = d.days.filter(x => x !== i); }
        else d.days.push(i);
        b.classList.toggle('on', d.days.includes(i));
      });
      days.append(b);
    });
    const presets = el('div', 'presets');
    for (const [l, v] of [['毎日', [0, 1, 2, 3, 4, 5, 6]], ['平日', [1, 2, 3, 4, 5]], ['土日', [0, 6]]]) {
      presets.append(btn('btn small', l, () => { d.days = v.slice(); days.querySelectorAll('.dp').forEach((b, n) => b.classList.toggle('on', d.days.includes([1, 2, 3, 4, 5, 6, 0][n]))); }));
    }
    dl.append(days, presets);
    inn.append(dl);

    const kl = el('label', 'tog'); const k = el('input'); k.type = 'checkbox'; k.checked = d.keepOnOff;
    k.addEventListener('change', () => { d.keepOnOff = k.checked; });
    kl.append(k, '休みの日も続ける（水を飲むなど、仕事と関係ない習慣）');
    inn.append(kl);
    if (h && !h.local) inn.append(el('div', 'sub hint', 'タイマー連動やノートとのつながりは、Mac で設定したものがそのまま残ります。'));

    const bt = el('div', 'shBtns');
    if (!isNew) bt.append(btn('btn danger', ['trash-2', '消す'], () => {
      if (!confirm(`「${h.name}」を消しますか？\nこれまでのチェックの記録も消えます（Mac で取り込んだときに Mac からも消えます）。`)) return;
      sheet.close(); commit({ type: 'habit.delete', habit: h.id }); toast('消しました');
    }));
    bt.append(btn('btn primary', isNew ? '追加' : '保存', () => {
      if (!d.name) { name.focus(); toast('名前を入れてください', 'warn'); return; }
      d.days.sort();
      if (isNew) {
        commit({ type: 'habit.add', key: M.newKey(), name: d.name, icon: d.icon, color: d.color, days: d.days, keepOnOff: d.keepOnOff, created: todayKey() });
      } else {
        const f = {};
        if (d.name !== h.name) f.name = d.name;
        if (d.icon !== h.icon) f.icon = d.icon;
        if (d.color !== h.color) f.color = d.color;
        if (d.days.join() !== h.days.slice().sort().join()) f.days = d.days;
        if (d.keepOnOff !== !!h.keepOnOff) f.keepOnOff = d.keepOnOff;
        if (Object.keys(f).length) commit({ type: 'habit.edit', habit: h.id, fields: f });
      }
      sheet.close();
      toast(isNew ? '確認項目を追加しました' : '保存しました');
    }));
    inn.append(bt);
    drawPrev();
    sheet.showModal();
    if (isNew) setTimeout(() => name.focus(), 250);
  }

  // ================= プロジェクトのシート =================
  function openProjects() {
    const inn = $('#sheetIn');
    sheetHead(inn, 'プロジェクト');
    const list = el('div', 'plist');
    if (!view.projects.length) list.append(el('div', 'sub', 'まだプロジェクトはありません'));
    view.projects.forEach(p => {
      const r = btn('prow', [], () => openProject(p));
      const dt = el('i', 'dot'); dt.style.background = p.color;
      const n = view.tasks.filter(t => t.project_id === p.id && !t.completed).length;
      r.append(dt, el('b', '', p.name), el('small', '', `進行中 ${n}件`), iconSpan('chevron-right'));
      list.append(r);
    });
    inn.append(list);
    inn.append(btn('btn primary wide', ['plus', 'プロジェクトを追加'], () => openProject(null)));
    const note = el('div', 'sub hint', 'プロジェクトを消すとき・メモやリンクを書くときは Mac で行います。');
    inn.append(note);
    if (!sheet.open) sheet.showModal();
  }
  function openProject(p) {
    const isNew = !p;
    const inn = $('#sheetIn');
    const hd = sheetHead(inn, isNew ? 'プロジェクトを追加' : 'プロジェクトを編集');
    hd.prepend(btn('iconBtn plain', 'chevron-left', openProjects, 'もどる'));
    let color = p?.color || HABIT_COLORS[view.projects.length % HABIT_COLORS.length];
    const name = el('input', 'inp'); name.value = p?.name || ''; name.placeholder = '例：資格の勉強'; name.maxLength = 80;
    inn.append(field('名前', name));
    const cl = el('div', 'fld'); cl.append(el('span', '', '色'), colorPicker(color, c => { color = c; }));
    inn.append(cl);
    const bt = el('div', 'shBtns');
    bt.append(btn('btn primary', isNew ? '追加' : '保存', () => {
      const v = name.value.trim();
      if (!v) { name.focus(); toast('名前を入れてください', 'warn'); return; }
      if (isNew) state = M.addOp(state, { type: 'project.add', key: M.newKey(), name: v, color });
      else {
        const f = {};
        if (v !== p.name) f.name = v;
        if (color !== p.color) f.color = color;
        if (Object.keys(f).length) state = M.addOp(state, { type: 'project.edit', project: p.id, fields: f });
      }
      recompute(); saveState(); render();
      openProjects();
      toast(isNew ? 'プロジェクトを追加しました' : '保存しました');
    }));
    inn.append(bt);
    if (!sheet.open) sheet.showModal();   // フォルダのカードから直接開いたとき
    if (isNew) setTimeout(() => name.focus(), 200);
  }

  // ================= 画面の切り替え =================
  const TITLES = { today: '毎日確認', gantt: 'ガントチャート', cal: 'カレンダー', sync: '同期' };
  function switchTab(t) {
    tab = t;
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    $('#title').textContent = TITLES[tab];
    const acts = $('#topActs');
    acts.innerHTML = '';
    if (tab === 'gantt' || tab === 'cal' || tab === 'today') {
      acts.append(tab === 'today' ? btn('btn primary small', ['plus', '確認項目'], () => openHabit(null)) : btn('btn primary small', ['plus', 'タスク'], () => openTask(null, tab === 'cal' ? calSel : undefined)));
    }
    const badge = $('#syncBadge');
    badge.hidden = !state.ops.length;
    badge.textContent = state.ops.length > 99 ? '99+' : String(state.ops.length);
    const main = $('#view');
    main.innerHTML = '';
    ({ today: renderToday, gantt: renderGantt, cal: renderCal, sync: renderSync })[tab](main);
  }
  document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  document.querySelectorAll('[data-icon]').forEach(e => e.insertAdjacentHTML('afterbegin', icon(e.dataset.icon)));

  // 日付が変わったら（アプリに戻ってきたとき）今日に合わせる
  let lastDay = todayKey();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const t = todayKey();
    if (t !== lastDay) { if (selDay === lastDay) selDay = t; lastDay = t; render(); }
  });

  // ---------- はじめ ----------
  (async () => {
    try {
      await DB.open();
      state = { ...state, ...((await DB.get('state')) || {}) };
      prefs = { ...prefs, ...((await DB.get('prefs')) || {}) };
    } catch {
      toast('このブラウザではデータを保存できません（プライベートブラウズでは使えません）', 'warn');
    }
    applyTheme();
    recompute();
    render();
    // ホーム画面に追加したアプリでは、データが勝手に消されないようお願いする
    try { navigator.storage?.persist?.(); } catch {}
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  })();
})();
