(() => {
  const STORAGE_KEY = "yougo-test-v1";
  // 結果を記録する Apps Script ウェブアプリのURL（gas/Code.gs を参照）
  const RESULT_URL = "";
  const LETTERS = ["A", "B", "C"];
  const RETAKE_DAYS = 1; // 翌日の 0:00 から受験できる

  // レベル1：3択100問・1問1点・80点以上で合格（自動採点）
  // レベル2：記述20問（回答をスプレッドシートに送り、先輩が採点）
  const LEVELS = {
    1: { type: "mc", count: 100, pass: 80, bank: QUESTIONS.mc },
    2: { type: "wr", count: 20, bank: QUESTIONS.wr },
  };
  // 分野別の判定：この正答率以上を「得意」、未満を「苦手」とする
  const STRONG_RATE = 0.9;
  const WEAK_RATE = 0.8;

  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, children = []) => {
    const e = Object.assign(document.createElement(tag), props);
    children.forEach((c) => e.append(c));
    return e;
  };

  // ---------- 保存データ（前回の名前と、名前・レベルごとの再受験可能日） ----------
  // locks: { 名前: { レベル: 再受験できる日時(ms) } }
  function loadStore() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && typeof s === "object") return { name: s.name, locks: s.locks || {} };
    } catch (_) {}
    return { locks: {} };
  }
  const store = loadStore();
  const saveStore = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(store));

  // ---------- ユーティリティ ----------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const formatDuration = (sec) => `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, "0")}秒`;
  const formatDay = (d) => `${d.getMonth() + 1}月${d.getDate()}日（${"日月火水木金土"[d.getDay()]}）`;
  const percent = (ok, total) => `${Math.round((ok / total) * 100)}%`;

  // 再受験できる日：受験日の RETAKE_DAYS 日後の 0:00
  function retakeDate(from) {
    const d = new Date(from);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + RETAKE_DAYS);
    return d;
  }

  // ---------- スタート画面 ----------
  // 同じ名前で受験済みなら翌日まで開始ボタンを止める（このブラウザでの受験に限る。別の名前なら受けられる）
  // 名前はスペース（全角・半角）を除いて比べる
  const nameKey = (name) => name.replace(/\s+/g, "");

  function lockUntil(name, level) {
    const until = (store.locks[nameKey(name)] || {})[level];
    return until && Date.now() < until ? until : null;
  }

  function setLock(name, level, until) {
    const key = nameKey(name);
    store.locks[key] = { ...store.locks[key], [level]: until };
    saveStore();
  }

  function updateRetakeLocks() {
    const name = $("user-name").value.trim();
    Object.keys(LEVELS).forEach((level) => {
      const until = name && lockUntil(name, level);
      $(`btn-start-${level}`).disabled = !!until;
      $(`lock-${level}`).classList.toggle("hidden", !until);
      if (until) $(`lock-${level}`).textContent = `${name} さんは受験済みです。次に受けられるのは ${formatDay(new Date(until))} 以降です。`;
    });
  }

  // 名前が未入力ならスタートさせない
  function requireName() {
    const name = $("user-name").value.trim();
    $("user-name").classList.toggle("invalid", !name);
    $("name-error").classList.toggle("hidden", !!name);
    if (!name) {
      $("user-name").focus();
      return null;
    }
    store.name = name;
    saveStore();
    return name;
  }

  // ---------- 出題 ----------
  // official: 本番テスト（その場では正誤を出さず、最後にまとめて記録する）
  // official でないとき：3択の間違えた問題の復習（1問ごとに正誤と解説を出す。記録しない）
  let session = null;
  let timerId = null;

  const elapsedSec = () => Math.floor((Date.now() - session.startedAt) / 1000);
  const updateTimer = () => { $("timer").textContent = `経過 ${formatDuration(elapsedSec())}`; };

  function startSession({ name, level, type, questions, official }) {
    session = { name, level, type, official, questions, index: 0, results: [], selected: null, answered: false, startedAt: Date.now() };
    $("quiz-name").textContent = `${name} さん　`;
    $("timer").classList.toggle("hidden", !official);
    clearInterval(timerId);
    if (official) {
      timerId = setInterval(updateTimer, 1000);
      updateTimer();
    }
    $("mc-area").classList.toggle("hidden", type !== "mc");
    $("wr-area").classList.toggle("hidden", type !== "wr");
    showScreen("quiz");
    renderQuestion();
  }

  function startOfficial(level) {
    const name = requireName();
    if (!name) return;
    if (lockUntil(name, level)) return updateRetakeLocks();
    const cfg = LEVELS[level];
    startSession({ name, level, type: cfg.type, questions: shuffle(cfg.bank).slice(0, cfg.count), official: true });
  }

  function renderQuestion() {
    const q = session.questions[session.index];
    const total = session.questions.length;
    const isLast = session.index + 1 === total;
    session.selected = null;
    session.answered = false;

    $("progress-text").textContent = `${session.index + 1} / ${total}問`;
    $("progress-fill").style.width = `${(session.index / total) * 100}%`;

    $("q-tags").innerHTML = "";
    const tags = session.type === "mc" ? [q.kind, q.cat] : [q.field, q.cat];
    tags.forEach((t) => $("q-tags").append(el("span", { className: "tag", textContent: t })));
    $("q-text").textContent = q.q;
    $("feedback").classList.add("hidden");

    if (session.type === "mc") {
      $("btn-next").classList.add("hidden");
      $("btn-next").textContent = isLast ? (session.official ? "解答を終了して採点する" : "終了") : "次へ";
      const box = $("choices");
      box.innerHTML = "";
      q.choices.forEach((c, i) => {
        const btn = el("button", { className: "choice" }, [el("span", { className: "letter", textContent: LETTERS[i] }), c]);
        btn.addEventListener("click", () => choose(LETTERS[i]));
        box.append(btn);
      });
    } else {
      $("btn-next").classList.remove("hidden");
      $("btn-next").textContent = isLast ? "回答を提出する" : "次へ";
      $("wr-input").value = "";
      $("wr-input").focus();
    }
    window.scrollTo(0, 0);
  }

  function choose(letter) {
    const q = session.questions[session.index];
    const buttons = [...$("choices").children];

    if (session.official) {
      // 本番：その場では正誤を出さず、選んだ選択肢だけを示す（「次へ」で確定、それまでは選び直せる）
      session.selected = letter;
      buttons.forEach((btn, i) => btn.classList.toggle("selected", LETTERS[i] === letter));
      $("btn-next").classList.remove("hidden");
      return;
    }

    // 復習：その場で正誤と解説を出す
    if (session.answered) return;
    session.answered = true;
    const ok = letter === q.ans;
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      if (LETTERS[i] === q.ans) btn.classList.add("correct");
      else if (LETTERS[i] === letter) btn.classList.add("wrong");
    });
    const fb = $("feedback");
    fb.innerHTML = "";
    fb.append(
      el("div", { className: `verdict ${ok ? "ok" : "ng"}`, textContent: ok ? "○ 正解！" : `× 不正解（正解は ${q.ans}）` }),
      el("div", { textContent: q.exp })
    );
    fb.classList.remove("hidden");
    session.results.push({ q, ok, yourAnswer: letter });
    $("btn-next").classList.remove("hidden");
    $("btn-next").focus();
  }

  function nextQuestion() {
    const q = session.questions[session.index];
    const isLast = session.index + 1 === session.questions.length;

    if (session.type === "wr") {
      const answer = $("wr-input").value.trim();
      if (!answer && !confirm("回答が空欄です。このまま次へ進みますか？")) return;
      if (isLast && !confirm("回答を提出します。提出後は修正できません。よろしいですか？")) return;
      session.results.push({ q, answer });
    } else if (session.official) {
      if (!session.selected) return;
      session.results.push({ q, ok: session.selected === q.ans, yourAnswer: session.selected });
    }

    session.index++;
    if (!isLast) renderQuestion();
    else if (!session.official) showHome();
    else if (session.type === "mc") finishMc();
    else finishWr();
  }

  function quitSession() {
    const msg = session.official
      ? "テストを中断しますか？ 途中までの回答は記録されません。"
      : "復習を終了してトップに戻りますか？";
    if (confirm(msg)) showHome();
  }

  // ---------- 結果 ----------
  // 本番テストを終えたときの共通処理（再受験日の設定と、結果画面の共通部分）
  function finishCommon() {
    clearInterval(timerId);
    const sec = elapsedSec();
    const until = retakeDate(new Date()).getTime();
    setLock(session.name, session.level, until);

    $("result-name").textContent = `${session.name} さん`;
    $("result-time").textContent = `所要時間 ${formatDuration(sec)}`;
    $("result-retake").textContent = `次にこのテストを受けられるのは、翌日の ${formatDay(new Date(until))} 以降です。`;
    $("progress-fill").style.width = "100%";
    return sec;
  }

  // 分野別の集計（3択の分野一覧の順。今回出題がなかった分野は total 0）
  function categoryStats(results) {
    const order = [...new Set(QUESTIONS.mc.map((q) => q.cat))];
    return order.map((name) => {
      const rs = results.filter((r) => r.q.cat === name);
      return { name, correct: rs.filter((r) => r.ok).length, total: rs.length };
    });
  }

  function finishMc() {
    const sec = finishCommon();
    const cfg = LEVELS[session.level];
    const results = session.results;
    const score = results.filter((r) => r.ok).length;
    const passed = score >= cfg.pass;

    const cats = categoryStats(results);
    const asked = cats.filter((c) => c.total > 0);
    const strong = asked.filter((c) => c.correct / c.total >= STRONG_RATE).map((c) => c.name);
    const weak = asked.filter((c) => c.correct / c.total < WEAK_RATE).map((c) => c.name);
    const wrong = results.filter((r) => !r.ok);

    $("result-score").textContent = `${score}点 / ${cfg.count}点満点`;
    $("result-pass").textContent = passed ? "合格" : "不合格";
    $("result-pass").className = `pass-badge ${passed ? "pass" : "fail"}`;
    $("result-rate").textContent = `合格ライン ${cfg.pass}点`;
    $("result-strong").textContent = strong.join("、") || "なし";
    $("result-weak").textContent = weak.join("、") || "なし";

    sendResult({
      type: "mc",
      name: session.name,
      score,
      total: cfg.count,
      passed,
      seconds: sec,
      strong: strong.join("、"),
      weak: weak.join("、"),
      categories: cats,
      wrong: wrong.map((r) => `No.${r.q.no}【${r.q.cat}】正解「${r.q.ansText}」／回答「${r.q.choices[LETTERS.indexOf(r.yourAnswer)]}」`),
      correct: results.filter((r) => r.ok).map((r) => r.q.no).sort((a, b) => a - b),
    });

    // 分野別の正答率（低い順）
    const table = $("result-by-cat");
    table.innerHTML = "";
    asked
      .slice()
      .sort((x, y) => x.correct / x.total - y.correct / y.total)
      .forEach((c) => {
        const rate = c.correct / c.total;
        const mark = rate >= STRONG_RATE ? "得意" : rate < WEAK_RATE ? "苦手" : "";
        table.append(el("tr", {}, [
          el("td", { textContent: c.name }),
          el("td", { className: "num", textContent: `${c.correct} / ${c.total}` }),
          el("td", { className: "num", textContent: percent(c.correct, c.total) }),
          el("td", { className: `mark ${{ 得意: "strong", 苦手: "weak" }[mark] || ""}`, textContent: mark }),
        ]));
      });

    // 間違えた問題だけを正解・解説つきで表示
    const box = $("result-wrong");
    box.innerHTML = "";
    if (wrong.length === 0) box.append(el("p", { textContent: "全問正解です！" }));
    wrong.forEach((r) => {
      const q = r.q;
      box.append(el("div", { className: "wrong-item" }, [
        el("div", { textContent: q.q }),
        el("div", { className: "yours", textContent: `あなたの回答：${r.yourAnswer}：${q.choices[LETTERS.indexOf(r.yourAnswer)]}` }),
        el("div", { className: "ans", textContent: `正解：${q.ans}：${q.ansText}` }),
        el("div", { className: "muted", textContent: q.exp }),
      ]));
    });
    reviewQuestions = wrong.map((r) => r.q);
    $("btn-retry-wrong").classList.toggle("hidden", wrong.length === 0);

    showResult("mc");
  }

  function finishWr() {
    const sec = finishCommon();
    const results = session.results;

    $("result-score").textContent = "回答を提出しました";
    $("result-rate").textContent = "採点は先輩が行います。結果はあとで連絡があります。";

    sendResult({
      type: "wr",
      name: session.name,
      seconds: sec,
      answers: results.map((r) => ({ no: r.q.no, field: r.q.field, cat: r.q.cat, q: r.q.q, answer: r.answer, model: r.q.model, points: r.q.points })),
    });

    // 提出した回答と模範解答を並べて見直せるようにする
    const box = $("result-answers");
    box.innerHTML = "";
    results.forEach((r, i) => {
      box.append(el("div", { className: "wrong-item" }, [
        el("div", { textContent: `${i + 1}．${r.q.q}` }),
        el("div", { className: "yours", textContent: `あなたの回答：${r.answer || "（未回答）"}` }),
        el("div", { className: "ans", textContent: `模範解答：${r.q.model}` }),
        el("div", { className: "muted", textContent: `採点ポイント：${r.q.points}` }),
      ]));
    });

    showResult("wr");
  }

  function showResult(type) {
    $("result-pass").classList.toggle("hidden", type !== "mc");
    $("result-strength").classList.toggle("hidden", type !== "mc");
    ["result-cat-card", "result-wrong-card"].forEach((id) => $(id).classList.toggle("hidden", type !== "mc"));
    $("result-answers-card").classList.toggle("hidden", type !== "wr");
    if (type !== "mc") $("btn-retry-wrong").classList.add("hidden");
    showScreen("result");
  }

  let reviewQuestions = [];

  // Apps Script は別ドメインのため no-cors で送る（応答の中身は読めない）
  function sendResult(payload) {
    const status = $("result-send");
    if (!RESULT_URL) {
      status.textContent = "※ 結果の記録先が未設定のため、記録されていません";
      return;
    }
    status.textContent = "結果を記録しています…";
    fetch(RESULT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    })
      .then(() => { status.textContent = "結果を記録しました"; })
      .catch(() => { status.textContent = "※ 結果を記録できませんでした。通信環境を確認して、管理者に連絡してください"; });
  }

  // ---------- 画面切り替え ----------
  function showScreen(name) {
    ["home", "quiz", "result"].forEach((s) => $(`screen-${s}`).classList.toggle("hidden", s !== name));
    window.scrollTo(0, 0);
  }

  function showHome() {
    clearInterval(timerId);
    session = null;
    updateRetakeLocks();
    showScreen("home");
  }

  // URL の ?level=1 / ?level=2 で、そのレベルだけを表示する（指定なしは両方）
  const onlyLevel = new URLSearchParams(location.search).get("level");
  if (LEVELS[onlyLevel]) {
    Object.keys(LEVELS).forEach((level) => $(`level-card-${level}`).classList.toggle("hidden", level !== onlyLevel));
  }

  // ---------- イベント ----------
  Object.keys(LEVELS).forEach((level) => $(`btn-start-${level}`).addEventListener("click", () => startOfficial(level)));
  $("btn-next").addEventListener("click", nextQuestion);
  $("btn-quit").addEventListener("click", quitSession);
  $("btn-home").addEventListener("click", showHome);
  $("btn-retry-wrong").addEventListener("click", () =>
    startSession({ name: session.name, level: session.level, type: "mc", questions: shuffle(reviewQuestions), official: false })
  );

  $("user-name").value = store.name || "";
  $("user-name").addEventListener("input", () => {
    $("user-name").classList.remove("invalid");
    $("name-error").classList.add("hidden");
    updateRetakeLocks();
  });

  // キーボード操作（3択のみ）：1/2/3 または A/B/C で選択
  document.addEventListener("keydown", (e) => {
    if (!session || session.type !== "mc" || $("screen-quiz").classList.contains("hidden")) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    const k = e.key.toUpperCase();
    const idx = ["1", "2", "3"].includes(k) ? Number(k) - 1 : LETTERS.indexOf(k);
    if (idx >= 0) choose(LETTERS[idx]);
  });

  updateRetakeLocks();
})();
