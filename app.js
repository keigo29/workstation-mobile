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

  // ---------- 共通の部品 ----------
  const projOf = id => view.projects.find(p => p.id === id);
  const colorOf = t => projOf(t.project_id)?.color || '#717680';
  function habitIcon(h) {
    const i = el('span', 'hic');
    i.style.background = h.color;
    if (h.icon && h.icon.startsWith('lucide:')) i.innerHTML = icon(h.icon.slice(7));
    else i.textContent = h.icon || h.name.slice(0, 1);
    return i;
  }
  // 習慣のアイコンと色（Mac 版と同じもの）
  const HABIT_COLORS = ['#005cff', '#00c230', '#ff5a00', '#8600ff', '#1fb8cc', '#f2280d', '#ffae00', '#717680'];
  const HABIT_ICONS = ['droplet', 'glass-water', 'coffee', 'apple', 'salad', 'utensils', 'pill', 'book-open', 'notebook-pen', 'pen-line', 'languages', 'graduation-cap',
    'code', 'laptop', 'brain', 'dumbbell', 'footprints', 'bike', 'activity', 'heart-pulse', 'mountain', 'waves', 'wind', 'leaf', 'sprout', 'flower-2', 'sun', 'sunrise',
    'moon', 'bed', 'alarm-clock', 'timer', 'shower-head', 'bath', 'sparkles', 'smile', 'heart', 'users', 'phone-off', 'smartphone', 'cigarette-off', 'wine-off',
    'piggy-bank', 'wallet', 'music', 'guitar', 'palette', 'camera', 'gamepad-2', 'dog', 'cat', 'house', 'briefcase', 'clipboard-list', 'target', 'star', 'zap'].filter(n => window.ICONS[n]);
  let habitEdit = false;   // 毎日確認の「編集」中（押すとチェックではなく編集を開く）
  // 選んだ値（文字）から、プロジェクトのID（Mac の数字か、スマホで作った 'm:…'）に戻す
  const projIdOf = v => (v ? view.projects.find(p => String(p.id) === v)?.id ?? null : null);
  // タスク1行（チェックで完了・押すと編集）
  function taskRow(t, opt = {}) {
    const r = el('div', 'trow' + (t.completed ? ' done' : ''));
    const ck = btn('check', [], () => setDone(t, !t.completed), t.completed ? 'まだにする' : '完了にする');
    const s = el('span'); s.innerHTML = icon('check'); ck.append(s);
    const ttl = btn('ttl', [], () => openTask(t));
    ttl.append(el('b', '', t.title));
    const meta = el('small');
    const dt = el('i', 'dot'); dt.style.background = colorOf(t);
    meta.append(dt, projOf(t.project_id)?.name || 'プロジェクトなし');
    if (!opt.noDate && t.due) meta.append(' ・ ' + (t.start && t.start !== t.due ? `${md(t.start)}〜${md(t.due)}` : md(t.due)));
    if (t.subs.length) meta.append(` ・ ${t.subs.filter(x => x.done).length}/${t.subs.length}`);
    if (t.repeat) meta.append(' ・ ' + M.repeatLabel(t.repeat));
    const today = todayKey();
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

  // ================= 毎日確認 =================
  function renderToday(main) {
    const today = todayKey();
    if (selDay > today) selDay = today;
    const off = view.daysOff;

    // 週（月曜始まり）。前後の週へ
    const d0 = M.parseKey(selDay);
    const mon = M.addDays(selDay, -((d0.getDay() + 6) % 7));
    const week = el('div', 'week');
    week.append(btn('iconBtn', 'chevron-left', () => { selDay = M.addDays(selDay, -7); render(); }, '前の週'));
    for (let i = 0; i < 7; i++) {
      const k = M.addDays(mon, i);
      const sc = M.dayScore(view.habits, k, off);
      const b = btn('wday' + (k === today ? ' today' : '') + (k === selDay ? ' sel' : '') + (k > today ? ' future' : '') + (off.has(k) ? ' offd' : ''), [],
        () => { if (k <= today) { selDay = k; render(); } }, md(k));
      b.append(el('small', '', WD[M.parseKey(k).getDay()]), el('b', '', String(M.parseKey(k).getDate())));
      const bar = el('i'); const f = el('span'); f.style.width = (sc.due ? Math.round(sc.done / sc.due * 100) : 0) + '%'; bar.append(f);
      b.append(bar);
      week.append(b);
    }
    const nx = btn('iconBtn', 'chevron-right', () => { selDay = M.addDays(selDay, 7) > today ? today : M.addDays(selDay, 7); render(); }, '次の週');
    nx.disabled = M.addDays(mon, 7) > today;
    week.append(nx);
    main.append(week);

    // 進み具合のリング
    const sc = M.dayScore(view.habits, selDay, off);
    const card = el('div', 'card ringCard');
    const ring = el('div', 'ring');
    const pct = sc.due ? sc.done / sc.due : 0;
    const C = 2 * Math.PI * 40;
    ring.innerHTML = `<svg viewBox="0 0 92 92"><circle class="bgc" cx="46" cy="46" r="40" fill="none" stroke-width="9"/>
      <circle class="fgc" cx="46" cy="46" r="40" fill="none" stroke-width="9" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>`;
    ring.append(el('div', 'num', sc.due ? Math.round(pct * 100) + '%' : '—'));
    const tx = el('div', 'ringTxt');
    tx.append(el('b', '', selDay === today ? '今日' : md(selDay)));
    const isOff = off.has(selDay);
    tx.append(el('div', 'sub', isOff ? `${off.get(selDay)}の日（習慣の予定から外れます）` : sc.due ? `${sc.due}個のうち ${sc.done}個できました` : 'この日にやる習慣はありません'));
    tx.append(btn('btn small' + (isOff ? ' white' : ''), [isOff ? 'x' : 'sunrise', isOff ? '休みをやめる' : (selDay === today ? '今日を休みにする' : 'この日を休みにする')],
      () => commit({ type: 'dayoff.set', day: selDay, label: isOff ? null : '休み' })));
    card.append(ring, tx);
    main.append(card);

    // 習慣
    const due = view.habits.filter(h => M.isDue(h, selDay, off));
    const rest = view.habits.filter(h => !M.isDue(h, selDay, off) && h.created <= selDay);
    const hc = el('div', 'card');
    const h2 = el('h2', '', '習慣');
    if (!habitEdit) h2.append(el('span', 'cnt', `${sc.done} / ${sc.due}`));
    if (view.habits.length) {
      const eb = btn('btn small' + (habitEdit ? ' primary' : ''), habitEdit ? '完了' : '編集', () => { habitEdit = !habitEdit; render(); });
      if (habitEdit) eb.style.marginLeft = 'auto';
      h2.append(eb);
    }
    hc.append(h2);
    if (!view.habits.length) {
      const e = el('div', 'empty');
      e.innerHTML = icon('sprout');
      e.append(el('p', '', '毎日続けたいことを追加しましょう（水を飲む・読書 15分 など）'));
      hc.append(e);
    }
    const habitBtn = (h, dim) => {
      const on = h.done.has(selDay);
      const b = btn('habit' + (on && !habitEdit ? ' done' : '') + (dim && !habitEdit ? ' rest' : '') + (habitEdit ? ' editing' : ''), [], () => {
        if (habitEdit) { openHabit(h); return; }
        commit({ type: 'habit.set', habit: h.id, day: selDay, on: !on });
        if (!on && navigator.vibrate) navigator.vibrate(12);
      }, h.name);
      const nm = el('span', 'hname');
      nm.append(el('b', '', h.name));
      const st = M.streak(h, today, off);
      const sm = el('small');
      if (dim) sm.append(view.daysOff.has(selDay) && !h.keepOnOff ? '休みの日はお休み' : 'この曜日はお休み');
      else if (st) { sm.append(iconSpan('flame'), `${st}日連続`); }
      else sm.append(h.days.length === 7 ? '毎日' : h.days.map(x => WD[x]).join('・'));
      nm.append(sm);
      const ck = el('span', habitEdit ? 'chev' : 'check'); ck.innerHTML = icon(habitEdit ? 'chevron-right' : 'check');
      b.append(habitIcon(h), nm, ck);
      return b;
    };
    if (habitEdit) {
      // 編集中は全部の習慣を並べる（まだ始まっていない習慣も）
      view.habits.forEach(h => hc.append(habitBtn(h, false)));
    } else due.forEach(h => hc.append(habitBtn(h, false)));
    if (rest.length && !habitEdit) {
      const sub = el('div', 'sub', 'お休みの習慣'); sub.style.margin = '12px 0 2px';
      hc.append(sub);
      rest.forEach(h => hc.append(habitBtn(h, true)));
    }
    const addH = btn('btn wide addHabit', ['plus', '習慣を追加'], () => openHabit(null));
    hc.append(addH);
    main.append(hc);

    // その日のタスク
    const ts = view.tasks.filter(t => M.onDay(t, selDay) && (!t.completed || prefs.showDone || t.completed_at >= M.parseKey(selDay).getTime()));
    const tc = el('div', 'card');
    const t2 = el('h2', '', selDay === today ? '今日のタスク' : 'この日のタスク');
    t2.append(el('span', 'cnt', `${ts.filter(t => t.completed).length} / ${ts.length}`));
    tc.append(t2);
    if (!ts.length) tc.append(el('div', 'sub', '期間に入っているタスクはありません'));
    ts.forEach(t => tc.append(taskRow(t, { noDate: true })));
    main.append(tc);
  }

  // ================= ガントチャート =================
  const G_BEFORE = 14, G_AFTER = 75;
  function renderGantt(main) {
    const today = todayKey();
    const from = M.addDays(today, -G_BEFORE), days = G_BEFORE + G_AFTER + 1;
    const DW = 30;

    const bar = el('div', 'gbar');
    const seg = el('div', 'seg');
    seg.append(btn(prefs.showDone ? '' : 'on', '進行中', () => { prefs.showDone = false; savePrefs(); render(); }),
      btn(prefs.showDone ? 'on' : '', 'すべて', () => { prefs.showDone = true; savePrefs(); render(); }));
    const pb = btn('btn small white', ['folder-kanban', 'プロジェクト'], openProjects);
    pb.style.marginLeft = 'auto';
    bar.append(seg, pb);
    main.append(bar);

    const wrap = el('div', 'gwrap');
    const sc = el('div', 'gscroll');
    const inner = el('div', 'ginner');
    sc.append(inner);
    wrap.append(sc);
    const trackW = days * DW;

    // 見出し（日付）
    const head = el('div', 'grow ghead');
    head.append(el('div', 'gname', 'タスク'));
    const ht = el('div', 'gtrack'); ht.style.width = trackW + 'px';
    const dl = el('div', 'gdays');
    for (let i = 0; i < days; i++) {
      const k = M.addDays(from, i), d = M.parseKey(k);
      const c = el('div', ([0, 6].includes(d.getDay()) ? 'we' : '') + (k === today ? ' td' : ''));
      c.append(el('em', '', d.getDate() === 1 || i === 0 ? `${d.getMonth() + 1}月` : ''), el('b', '', String(d.getDate())), WD[d.getDay()]);
      dl.append(c);
    }
    ht.append(dl);
    head.append(ht);
    inner.append(head);

    // 列の背景（週末・休みの日）と今日の線：本体の行全体に重ねる
    const body = el('div');
    body.style.position = 'relative';
    const cols = el('div', 'gcols');
    cols.style.left = 'var(--nw)';
    for (let i = 0; i < days; i++) {
      const k = M.addDays(from, i), wd = M.parseKey(k).getDay();
      cols.append(el('div', view.daysOff.has(k) ? 'off' : [0, 6].includes(wd) ? 'we' : ''));
    }
    body.append(cols);
    const tl = el('div', 'gtoday');
    tl.style.left = `calc(var(--nw) + ${G_BEFORE * DW + DW / 2 - 1}px)`;
    body.append(tl);

    const tasks = view.tasks.filter(t => t.due && (prefs.showDone || !t.completed));
    const groups = [...view.projects.map(p => ({ p, list: tasks.filter(t => t.project_id === p.id) })),
      { p: { id: 0, name: 'プロジェクトなし', color: '#717680' }, list: tasks.filter(t => !projOf(t.project_id)) }].filter(g => g.list.length);
    if (!groups.length) {
      const e = el('div', 'empty', prefs.showDone ? '日付のあるタスクはありません' : '進行中のタスクはありません');
      e.style.position = 'sticky'; e.style.left = '0'; e.style.width = 'calc(100vw - 24px)';
      body.append(e);
    }
    for (const g of groups) {
      const closed = prefs.closed.includes(g.p.id);
      const pr = el('div', 'grow gproj' + (closed ? ' closed' : ''));
      const nb = btn('gname', ['chevron-down'], () => {
        prefs.closed = closed ? prefs.closed.filter(x => x !== g.p.id) : [...prefs.closed, g.p.id];
        savePrefs(); render();
      });
      const dt = el('i', 'dot'); dt.style.background = g.p.color;
      const nm = el('span', '', g.p.name);
      nb.append(dt, nm);
      pr.append(nb);
      const pt = el('div', 'gtrack'); pt.style.width = trackW + 'px';
      // 折りたたみ中は、まとめた期間を薄く出す
      if (closed) {
        const s = g.list.reduce((a, t) => (t.start < a ? t.start : a), g.list[0].start), e = g.list.reduce((a, t) => (t.due > a ? t.due : a), g.list[0].due);
        const x = Math.max(0, M.diffDays(from, s)), x2 = Math.min(days - 1, M.diffDays(from, e));
        if (x2 >= 0 && x < days) {
          const b = el('div', 'bar'); b.style.cssText = `left:${x * DW + 2}px;width:${(x2 - x + 1) * DW - 4}px;background:${g.p.color};opacity:.35;top:9px;height:20px`;
          pt.append(b);
        }
      }
      pr.append(pt);
      body.append(pr);
      if (closed) continue;
      for (const t of g.list) {
        const r = el('div', 'grow gt');
        const n = btn('gname' + (t.completed ? ' done' : ''), [], () => openTask(t));
        n.append(el('span', '', t.title));
        r.append(n);
        const tr = el('div', 'gtrack'); tr.style.width = trackW + 'px';
        const x = M.diffDays(from, t.start), x2 = M.diffDays(from, t.due);
        if (x2 >= 0 && x < days) {
          if (t.milestone) {
            const m = btn('ms', [], () => openTask(t), t.title);
            m.style.left = `${x2 * DW + DW / 2 - 10}px`;
            const i = el('i'); i.style.background = colorOf(t); m.append(i);
            tr.append(m);
          } else {
            const a = Math.max(0, x), b2 = Math.min(days - 1, x2);
            const late = !t.completed && t.due < today, slow = M.behind(t, today, view.daysOff);
            const b = btn('bar' + (t.completed ? ' done' : '') + (late ? ' late' : slow ? ' behind' : ''), [], () => openTask(t), t.title);
            const left = a * DW + 2, width = (b2 - a + 1) * DW - 4;
            b.style.left = `${left}px`;
            b.style.width = `${width}px`;
            b.style.background = colorOf(t);
            // 実際の進み具合（明るい部分）は、バー全体（画面の外にはみ出した分も含む）に対する割合
            const full0 = x * DW + 2, fullW = (x2 - x + 1) * DW - 4;
            const pf = el('i', 'pf'); pf.style.width = Math.max(0, Math.min(width, full0 + fullW * M.progress(t) - left)) + 'px';
            b.append(pf);
            // 目標の位置に縦の線
            const g = M.target(t, today, view.daysOff);
            if (g > 0 && g < 1) {
              const gx = full0 + fullW * g - left;
              if (gx > 0 && gx < width) { const m = el('i', 'tgt'); m.style.left = gx + 'px'; b.append(m); }
            }
            b.append(el('span', '', b2 - a >= 1 ? t.title : ''));
            tr.append(b);
          }
        }
        r.append(tr);
        body.append(r);
      }
    }
    inner.append(body);
    inner.style.width = `calc(var(--nw) + ${trackW}px)`;
    main.append(wrap);
    sc.scrollLeft = ganttScroll ?? (G_BEFORE - 2) * DW;
    let raf = 0;
    sc.addEventListener('scroll', () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; ganttScroll = sc.scrollLeft; }); }, { passive: true });

    // 日付のないタスク
    const nod = view.tasks.filter(t => !t.due && (prefs.showDone || !t.completed));
    if (nod.length) {
      const c = el('div', 'card undated');
      const h = el('h2', '', '日付なし'); h.append(el('span', 'cnt', String(nod.length)));
      c.append(h);
      nod.forEach(t => c.append(taskRow(t)));
      main.append(c);
    }
  }

  // ================= カレンダー =================
  function renderCal(main) {
    const today = todayKey();
    const nav = el('div', 'mnav');
    nav.append(el('b', '', `${calMonth.getFullYear()}年${calMonth.getMonth() + 1}月`),
      btn('iconBtn', 'chevron-left', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); render(); }, '前の月'),
      btn('btn small white', '今日', () => { const d = new Date(); calMonth = new Date(d.getFullYear(), d.getMonth(), 1); calSel = today; render(); }),
      btn('iconBtn', 'chevron-right', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); render(); }, '次の月'));
    main.append(nav);

    const cal = el('div', 'cal');
    const wd = el('div', 'wd');
    [1, 2, 3, 4, 5, 6, 0].forEach(i => wd.append(el('span', '', WD[i])));
    cal.append(wd);
    const grid = el('div', 'cgrid');
    const first = M.keyOf(calMonth);
    const start = M.addDays(first, -((calMonth.getDay() + 6) % 7));
    const weeks = Math.ceil((M.diffDays(start, first) + new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate()) / 7);
    const active = view.tasks.filter(t => t.due && !t.completed);
    for (let i = 0; i < weeks * 7; i++) {
      const k = M.addDays(start, i), d = M.parseKey(k);
      const off = view.daysOff.get(k);
      const c = btn('cd' + (d.getMonth() !== calMonth.getMonth() ? ' other' : '') + (k === today ? ' today' : '') + (k === calSel ? ' sel' : '') + (off ? ' off' : ''),
        [], () => { calSel = k; if (d.getMonth() !== calMonth.getMonth()) calMonth = new Date(d.getFullYear(), d.getMonth(), 1); render(); }, md(k));
      c.append(el('span', 'n', String(d.getDate())));
      if (off) c.append(el('span', 'ol', off));
      const ts = active.filter(t => M.onDay(t, k));
      ts.slice(0, 3).forEach(t => { const l = el('i', 'ln'); l.style.background = colorOf(t); c.append(l); });
      if (ts.length > 3) c.append(el('span', 'more', `+${ts.length - 3}`));
      if (k <= today) {
        const s = M.dayScore(view.habits, k, view.daysOff);
        if (s.due && s.done) c.append(el('i', 'hb ' + (s.done >= s.due ? 'full' : 'part')));
      }
      grid.append(c);
    }
    cal.append(grid);
    const lg = el('div', 'legend');
    lg.innerHTML = `<span><i style="background:var(--ok)"></i>習慣を全部できた</span><span><i style="box-shadow:inset 0 0 0 2px var(--ok)"></i>一部できた</span><span><i style="background:var(--warn)"></i>休みの日</span>`;
    cal.append(lg);
    main.append(cal);

    // 選んだ日
    const k = calSel;
    const dc = el('div', 'card');
    const hd = el('div', 'dayHead');
    hd.append(el('b', '', md(k)));
    const isOff = view.daysOff.has(k);
    if (isOff) hd.append(el('span', 'chip off', view.daysOff.get(k)));
    hd.append(btn('btn small', isOff ? '休みをやめる' : '休みにする', () => commit({ type: 'dayoff.set', day: k, label: isOff ? null : '休み' })));
    dc.append(hd);

    const ts = view.tasks.filter(t => M.onDay(t, k) && (!t.completed || prefs.showDone));
    const h1 = el('div', 'sub', `タスク ${ts.length}件`); h1.style.margin = '8px 0 0';
    dc.append(h1);
    ts.forEach(t => dc.append(taskRow(t)));

    const plans = view.plans.filter(p => p.day === k).sort((a, b) => a.start_min - b.start_min);
    if (plans.length) {
      const h2 = el('div', 'sub', '作業計画（Mac で作った時間割）'); h2.style.margin = '12px 0 0';
      dc.append(h2);
      for (const p of plans) {
        const r = el('div', 'plan');
        const ln = el('i', 'pl'); ln.style.background = projOf(p.project_id)?.color || 'var(--g400)';
        const tx = el('div'); tx.append(el('b', '', p.title));
        r.append(el('time', '', `${hm(p.start_min)}–${hm(p.end_min)}`), ln, tx);
        dc.append(r);
      }
    }

    if (k <= today && view.habits.length) {
      const s = M.dayScore(view.habits, k, view.daysOff);
      const h3 = el('div', 'sub', `習慣 ${s.done} / ${s.due}`); h3.style.margin = '12px 0 0';
      dc.append(h3);
      const go = btn('btn small white', ['list-checks', 'この日の習慣をつける'], () => { selDay = k; switchTab('today'); });
      go.style.marginTop = '8px';
      dc.append(go);
    }
    main.append(dc);
  }

  // ================= 同期 =================
  function renderSync(main) {
    const st = el('div', 'stat');
    const a = el('div'); a.append(el('small', '', '送っていない変更'), el('b', '', `${state.ops.length}件`));
    const b = el('div'); b.append(el('small', '', 'Mac から受け取った日'), el('b', 's', state.base ? fmtTime(state.base.exportedAt) : 'まだ'));
    st.append(a, b);
    main.append(st);

    const c = el('div', 'card');
    const bs = el('div', 'syncBtns');
    bs.append(btn('btn primary wide', ['download', 'Macから受け取る'], pickFile),
      btn('btn wide', ['upload', state.ops.length ? `Macへ送る（${state.ops.length}件）` : 'Macへ送る'], sendToMac));
    c.append(bs);
    if (state.sentAt) { const s = el('div', 'sub', `最後に送った日：${fmtTime(state.sentAt)}`); s.style.marginTop = '10px'; c.append(s); }
    main.append(c);

    const how = el('div', 'card');
    how.append(el('h2', '', '同期のしかた'));
    const ol = el('ol', 'steps');
    for (const t of [
      'Mac の Workstation で「設定 → スマホ用に書き出す」。できたファイルを AirDrop などでスマホへ送り、ここの「Macから受け取る」で選びます。',
      'スマホで習慣のチェックやタスクを変えたら「Macへ送る」。ファイルを Mac へ送り、Mac の「設定 → スマホの変更を取り込む」で選びます。',
      'Mac で取り込んだら、もう一度「スマホ用に書き出す」→「Macから受け取る」をすると、送った変更がここから消えます（何度送っても二重にはなりません）。',
    ]) ol.append(el('li', '', t));
    how.append(ol);
    const nt = el('div', 'sub', 'スマホだけでも使えます。スマホで作った習慣やプロジェクトも「Macへ送る」で Mac に入ります（同じ名前のものは1つにまとまります）。');
    nt.style.marginTop = '10px';
    how.append(nt);
    main.append(how);

    const set = el('div', 'card');
    set.append(el('h2', '', '設定'));
    const r1 = el('div', 'setRow');
    r1.append(el('span', '', '見た目'));
    const sel = el('select');
    for (const [v, l] of [['auto', 'スマホに合わせる'], ['light', 'ライト'], ['dark', 'ダーク']]) { const o = el('option', '', l); o.value = v; sel.append(o); }
    sel.value = prefs.theme;
    sel.addEventListener('change', () => { prefs.theme = sel.value; applyTheme(); savePrefs(); });
    r1.append(sel);
    const r2 = el('div', 'setRow');
    r2.append(el('span', '', 'このスマホのデータを消す'));
    r2.append(btn('btn small danger', '消す', async () => {
      if (!confirm('このスマホに入っているデータを消しますか？\n' + (state.ops.length ? `Mac へ送っていない変更（${state.ops.length}件）も消えます。\n` : '') + 'Mac のデータはそのままです。')) return;
      state = { base: null, ops: [], receivedAt: null, sentAt: null };
      recompute(); await saveState(); render(); toast('消しました');
    }));
    set.append(r1, r2);
    main.append(set);
    const v = el('div', 'sub', 'データはこのスマホの中だけに保存され、外へは送りません。'); v.style.textAlign = 'center'; v.style.padding = '4px 12px';
    main.append(v);
  }

  // Mac のファイルを選ぶ
  function pickFile() { $('#filePick').value = ''; $('#filePick').click(); }
  $('#filePick').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      if (f.size > 30 * 1024 * 1024) throw new Error('ファイルが大きすぎます');
      const snap = M.checkSnapshot(JSON.parse(await f.text()));
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
  function openTask(t) {
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
    const st = el('input', 'inp'); st.type = 'date'; st.value = t?.start || (isNew ? todayKey() : '');
    const du = el('input', 'inp'); du.type = 'date'; du.value = t?.due || (isNew ? todayKey() : '');
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
    if (t?.note) { inn.append(el('div', 'sub', 'メモ（Mac で書いたもの）')); inn.append(el('div', 'note', t.note)); }

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
    sheetHead(inn, isNew ? '習慣を追加' : '習慣を編集');
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
      toast(isNew ? '習慣を追加しました' : '保存しました');
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
      acts.append(btn('iconBtn dark', 'plus', () => openTask(null), 'タスクを追加'));
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
