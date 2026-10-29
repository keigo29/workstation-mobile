// データの形と計算（画面に依存しない。node のテストからも使える）
// ・base：Mac から受け取ったデータ（そのまま取っておく）
// ・ops ：スマホでした変更の一覧（まだ Mac に入ったと分かっていないもの）
// ・画面に出すのは base に ops を当てはめた結果（derive）
(function (root) {
  const FORMAT = 'workstation-mobile';
  const VERSION = 1;

  const p2 = n => String(n).padStart(2, '0');
  const keyOf = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
  const diffDays = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 864e5);
  const isDay = k => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);
  const rid = () => {
    const a = new Uint8Array(9);
    (root.crypto || require('crypto').webcrypto).getRandomValues(a);
    return Array.from(a, b => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
  };

  // 期間をそろえる（Mac と同じ決まり）：期限がなければ開始日もなし／開始日がなければ期限の日／逆転は入れ替え／節目は1日
  function normalizeDates(start, due, milestone) {
    start = start || null; due = due || null;
    if (!due) due = start;
    if (!due) return { start: null, due: null };
    if (!start || milestone) start = due;
    if (start > due) [start, due] = [due, start];
    return { start, due };
  }

  // ---------- Mac から受け取る ----------
  function checkSnapshot(o) {
    if (!o || o.format !== FORMAT) throw new Error('Workstation のファイルではありません');
    if (o.kind === 'changes') throw new Error('これはスマホから送ったファイルです。Mac の「スマホ用に書き出す」で作ったファイルを選んでください');
    if (o.kind !== 'snapshot') throw new Error('読み込めない形のファイルです');
    if (Number(o.version) > VERSION) throw new Error('Mac のアプリの方が新しい形式です。このページを読み込み直してください');
    for (const k of ['projects', 'tasks', 'subtasks', 'habits', 'daysOff']) if (!Array.isArray(o[k])) throw new Error('データが足りません（' + k + '）');
    return o;
  }

  // 受け取ったら、Mac に入った変更は消し、仮のID（m:…）は Mac で付いたIDに直す
  function receive(state, snap) {
    checkSnapshot(snap);
    const applied = new Set(snap.applied || []);
    const map = snap.idMap || {};
    const fix = v => (typeof v === 'string' && map[v] != null ? map[v] : v);
    const ops = state.ops.filter(op => !applied.has(op.id)).map(op => {
      const o = { ...op };
      if ('task' in o) o.task = fix(o.task);
      if ('sub' in o) o.sub = fix(o.sub);
      return o;
    });
    return { ...state, base: snap, ops, receivedAt: Date.now() };
  }

  // ---------- 変更を足す ----------
  // 同じもの（同じ習慣の同じ日など）への「付ける／外す」は、最後のものだけ残す
  const sameTarget = (a, b) => a.type === b.type && (
    (a.type === 'habit.set' && a.habit === b.habit && a.day === b.day) ||
    (a.type === 'dayoff.set' && a.day === b.day) ||
    (a.type === 'sub.done' && a.sub === b.sub) ||
    (a.type === 'task.done' && a.task === b.task));
  function addOp(state, op) {
    const o = { id: rid(), at: Date.now(), ...op };
    return { ...state, ops: [...state.ops.filter(x => !sameTarget(x, o)), o] };
  }
  const newKey = () => 'm:' + rid();

  // ---------- スマホ → Mac ----------
  function buildChanges(state, device) {
    return { format: FORMAT, kind: 'changes', version: VERSION, exportedAt: Date.now(), device: device || '', basedOn: state.base ? state.base.exportedAt : null, ops: state.ops };
  }

  // ---------- 画面に出すデータ ----------
  function derive(state) {
    const b = state.base || { projects: [], tasks: [], subtasks: [], habits: [], daysOff: [], plans: [] };
    const projects = b.projects.map(p => ({ ...p })).sort((x, y) => x.sort - y.sort || x.id - y.id);
    const tasks = new Map(b.tasks.map(t => [t.id, { ...t, subs: [] }]));
    const subs = new Map();
    for (const s of b.subtasks) {
      const t = tasks.get(s.task_id);
      if (!t) continue;
      const o = { ...s };
      t.subs.push(o); subs.set(s.id, o);
    }
    const habits = b.habits.map(h => ({ ...h, done: new Set(h.done || []) }));
    const hmap = new Map(habits.map(h => [h.id, h]));
    const daysOff = new Map(b.daysOff.map(d => [d.day, d.label || '休み']));
    const proj = v => (projects.some(p => p.id === v) ? v : null);
    let sort = Math.max(0, ...b.tasks.map(t => t.sort || 0));

    for (const op of state.ops) {
      switch (op.type) {
        case 'habit.set': { const h = hmap.get(op.habit); if (h) op.on ? h.done.add(op.day) : h.done.delete(op.day); break; }
        case 'dayoff.set': op.label == null ? daysOff.delete(op.day) : daysOff.set(op.day, op.label || '休み'); break;
        case 'task.add': {
          if (tasks.has(op.key)) break;
          tasks.set(op.key, { id: op.key, project_id: proj(op.project_id), title: op.title || '無題のタスク', ...normalizeDates(op.start, op.due, op.milestone),
            milestone: op.milestone ? 1 : 0, completed: 0, completed_at: null, sort: ++sort, repeat: '', note: op.note || '', subs: [], local: true });
          break;
        }
        case 'task.edit': {
          const t = tasks.get(op.task); if (!t) break;
          const f = op.fields || {};
          if ('title' in f) t.title = f.title || '無題のタスク';
          if ('project_id' in f) t.project_id = proj(f.project_id);
          if ('milestone' in f) t.milestone = f.milestone ? 1 : 0;
          Object.assign(t, normalizeDates('start' in f ? f.start : t.start, 'due' in f ? f.due : t.due, t.milestone));
          t.edited = true;
          break;
        }
        case 'task.done': { const t = tasks.get(op.task); if (t) { t.completed = op.done ? 1 : 0; t.completed_at = op.done ? op.at : null; } break; }
        case 'task.delete': {
          const t = tasks.get(op.task);
          if (t) { t.subs.forEach(s => subs.delete(s.id)); tasks.delete(op.task); }
          break;
        }
        case 'sub.add': {
          const t = tasks.get(op.task); if (!t || subs.has(op.key)) break;
          const s = { id: op.key, task_id: t.id, title: op.title, done: 0, sort: t.subs.length + 1000 };
          t.subs.push(s); subs.set(op.key, s);
          break;
        }
        case 'sub.done': { const s = subs.get(op.sub); if (s) s.done = op.done ? 1 : 0; break; }
        default: break;
      }
    }
    for (const t of tasks.values()) t.subs.sort((x, y) => x.sort - y.sort);
    const list = [...tasks.values()].sort((x, y) => x.completed - y.completed || x.sort - y.sort);
    return { projects, tasks: list, taskMap: tasks, habits, daysOff, plans: (b.plans || []).slice() };
  }

  // ---------- 習慣の計算 ----------
  // その日にやる習慣か（始めた日より後・その曜日・休みの日は「休みの日も続ける」だけ）
  const isDue = (h, day, daysOff) => h.created <= day && h.days.includes(parseKey(day).getDay()) && (h.keepOnOff || !daysOff.has(day));
  // 連続日数：やる日だけを数える（今日まだなら昨日から）
  function streak(h, today, daysOff) {
    let n = 0, k = today;
    if (!h.done.has(k)) k = addDays(k, -1);
    for (let i = 0; i < 800 && k >= h.created; i++, k = addDays(k, -1)) {
      if (!isDue(h, k, daysOff)) { if (h.done.has(k)) n++; continue; }
      if (h.done.has(k)) n++; else break;
    }
    return n;
  }
  // その日の達成：{ due: やる習慣の数, done: できた数 }
  function dayScore(habits, day, daysOff) {
    let due = 0, done = 0;
    for (const h of habits) {
      if (isDue(h, day, daysOff)) { due++; if (h.done.has(day)) done++; }
    }
    return { due, done };
  }
  // タスクの進み具合（サブタスクを終えた割合。サブタスクがなければ 完了=100%）
  const progress = t => (t.completed ? 1 : t.subs.length ? t.subs.filter(s => s.done).length / t.subs.length : 0);
  // 目標の進み具合：開始日〜期限のうち、昨日までに過ぎた日の割合（休みの日は数えない。Mac と同じ計算）
  // 最初の日は 0、期限を過ぎたら 1。節目・完了・日付なしは null
  function target(t, today, daysOff) {
    if (t.completed || t.milestone || !t.due) return null;
    const s = t.start || t.due;
    if (today <= s) return 0;
    if (today > t.due) return 1;
    let total = 0, passed = 0, all = 0, allPassed = 0;
    for (let k = s, i = 0; k <= t.due && i < 800; k = addDays(k, 1), i++) {
      all++; if (k < today) allPassed++;
      if (daysOff && daysOff.has(k)) continue;
      total++; if (k < today) passed++;
    }
    return total ? passed / total : allPassed / all;
  }
  // 目標より遅れているか（期限切れは含めない）
  const behind = (t, today, daysOff) => { const g = target(t, today, daysOff); return g != null && today <= t.due && Math.round(progress(t) * 100) < Math.round(g * 100); };
  const onDay = (t, day) => t.start && t.due && t.start <= day && day <= t.due;

  // 繰り返しの説明（Mac の設定を表示するだけ）
  function repeatLabel(r) {
    if (!r) return '';
    let o; try { o = typeof r === 'string' ? JSON.parse(r) : r; } catch { return ''; }
    const WD = ['日', '月', '火', '水', '木', '金', '土'];
    if (o.type === 'daily') return '毎日';
    if (o.type === 'weekdays') return '平日';
    if (o.type === 'monthly') return `毎月${o.dom ? o.dom + '日' : ''}`;
    if (o.type === 'weekly') return `${o.every === 2 ? '隔週' : '毎週'}${(o.days || []).map(d => WD[d]).join('・')}`;
    return '';
  }

  const M = { FORMAT, VERSION, keyOf, parseKey, addDays, diffDays, isDay, normalizeDates, checkSnapshot, receive, addOp, newKey,
    buildChanges, derive, isDue, streak, dayScore, progress, target, behind, onDay, repeatLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = M; else root.Model = M;
})(typeof self !== 'undefined' ? self : globalThis);
