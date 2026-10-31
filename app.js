(() => {
  const STORAGE_KEY = "yougo-test-v1";
  // 結果を記録する Apps Script ウェブアプリのURL（gas/Code.gs を参照）
  const RESULT_URL = "";
  const LETTERS = ["A", "B", "C"];

  // レベル1：3択100問・1問1点・80点以上で合格
  const LEVEL = 1;
  const QUESTION_COUNT = 100;
  const PASS_SCORE = 80;
  const RETAKE_DAYS = 2;

  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, children = []) => {
    const e = Object.assign(document.createElement(tag), props);
    children.forEach((c) => e.append(c));
    return e;
  };

  // ---------- 保存データ（名前と再受験可能日） ----------
  function loadStore() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && typeof s === "object") return s;
    } catch (_) {}
    return {};
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

  // 再受験できる日：受験日の RETAKE_DAYS 日後の 0:00
  function retakeDate(from) {
    const d = new Date(from);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + RETAKE_DAYS);
    return d;
  }

  // ---------- スタート画面 ----------
  // 前回の受験から2日経っていなければ開始ボタンを止める（このブラウザでの受験に限る）
  function updateRetakeLock() {
    const locked = !!store.nextOfficial && Date.now() < store.nextOfficial;
    $("btn-start").disabled = locked;
    $("retake-lock").classList.toggle("hidden", !locked);
    if (locked) $("retake-lock").textContent = `次に受けられるのは ${formatDay(new Date(store.nextOfficial))} 以降です。`;
    return locked;
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
  // official: 本番テスト（正誤を出さず、最後に採点して記録する）
  // official でないとき：間違えた問題の復習（1問ごとに正誤と解説を出す。記録しない）
  let session = null;
  let timerId = null;

  const elapsedSec = () => Math.floor((Date.now() - session.startedAt) / 1000);
  const updateTimer = () => { $("timer").textContent = `経過 ${formatDuration(elapsedSec())}`; };

  function startSession(name, questions, official) {
    session = { name, official, questions, index: 0, results: [], selected: null, answered: false, startedAt: Date.now() };
    $("quiz-name").textContent = `${name} さん　`;
    $("timer").classList.toggle("hidden", !official);
    clearInterval(timerId);
    if (official) {
      timerId = setInterval(updateTimer, 1000);
      updateTimer();
    }
    showScreen("quiz");
    renderQuestion();
  }

  function startOfficial() {
    if (updateRetakeLock()) return;
    const name = requireName();
    if (!name) return;
    startSession(name, shuffle(QUESTIONS.mc).slice(0, QUESTION_COUNT), true);
  }

  function renderQuestion() {
    const q = session.questions[session.index];
    const total = session.questions.length;
    session.selected = null;
    session.answered = false;

    $("progress-text").textContent = `${session.index + 1} / ${total}問`;
    $("progress-fill").style.width = `${(session.index / total) * 100}%`;

    $("q-tags").innerHTML = "";
    [q.kind, q.cat].forEach((t) => $("q-tags").append(el("span", { className: "tag", textContent: t })));
    $("q-text").textContent = q.q;

    $("feedback").classList.add("hidden");
    $("btn-next").classList.add("hidden");
    $("btn-next").textContent = session.index + 1 === total ? (session.official ? "解答を終了して採点する" : "終了") : "次へ";

    const box = $("choices");
    box.innerHTML = "";
    q.choices.forEach((c, i) => {
      const btn = el("button", { className: "choice" }, [el("span", { className: "letter", textContent: LETTERS[i] }), c]);
      btn.addEventListener("click", () => choose(LETTERS[i]));
      box.append(btn);
    });
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
    if (session.official) {
      if (!session.selected) return;
      const q = session.questions[session.index];
      session.results.push({ q, ok: session.selected === q.ans, yourAnswer: session.selected });
    }
    session.index++;
    if (session.index < session.questions.length) renderQuestion();
    else if (session.official) finishOfficial();
    else showHome();
  }

  function quitSession() {
    const msg = session.official
      ? "テストを中断しますか？ 途中までの結果は記録されません。"
      : "復習を終了してトップに戻りますか？";
    if (confirm(msg)) showHome();
  }

  // ---------- 結果 ----------
  function finishOfficial() {
    clearInterval(timerId);
    const results = session.results;
    const score = results.filter((r) => r.ok).length;
    const sec = elapsedSec();
    const passed = score >= PASS_SCORE;
    store.nextOfficial = retakeDate(new Date()).getTime();
    saveStore();

    $("result-name").textContent = `${session.name} さん`;
    $("result-score").textContent = `${score}点 / 100点満点`;
    $("result-pass").textContent = passed ? "合格" : "不合格";
    $("result-pass").className = `pass-badge ${passed ? "pass" : "fail"}`;
    $("result-rate").textContent = `合格ライン ${PASS_SCORE}点`;
    $("result-time").textContent = `所要時間 ${formatDuration(sec)}`;
    $("result-retake").textContent = `次にこのテストを受けられるのは、${RETAKE_DAYS}日後の ${formatDay(new Date(store.nextOfficial))} 以降です。`;
    $("result-retake").classList.remove("hidden");
    sendResult({ level: LEVEL, name: session.name, score, total: QUESTION_COUNT, seconds: sec });

    // 分野別の正答率（低い順）
    const byCat = {};
    results.forEach((r) => {
      const c = (byCat[r.q.cat] ||= { ok: 0, total: 0 });
      if (r.ok) c.ok++;
      c.total++;
    });
    const table = $("result-by-cat");
    table.innerHTML = "";
    Object.entries(byCat)
      .sort((x, y) => x[1].ok / x[1].total - y[1].ok / y[1].total)
      .forEach(([cat, c]) => {
        table.append(el("tr", {}, [
          el("td", { textContent: cat }),
          el("td", { className: "num", textContent: `${c.ok} / ${c.total}` }),
          el("td", { className: "num", textContent: `${Math.round((c.ok / c.total) * 100)}%` }),
        ]));
      });

    // 間違えた問題だけを正解・解説つきで表示
    const wrong = results.filter((r) => !r.ok);
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
    $("btn-retry-wrong").classList.toggle("hidden", wrong.length === 0);
    reviewQuestions = wrong.map((r) => r.q);

    $("progress-fill").style.width = "100%";
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
      .catch(() => { status.textContent = "※ 結果を記録できませんでした。通信環境を確認して、管理者に点数を伝えてください"; });
  }

  // ---------- 画面切り替え ----------
  function showScreen(name) {
    ["home", "quiz", "result"].forEach((s) => $(`screen-${s}`).classList.toggle("hidden", s !== name));
    window.scrollTo(0, 0);
  }

  function showHome() {
    clearInterval(timerId);
    session = null;
    updateRetakeLock();
    showScreen("home");
  }

  // ---------- イベント ----------
  $("btn-start").addEventListener("click", startOfficial);
  $("btn-next").addEventListener("click", nextQuestion);
  $("btn-quit").addEventListener("click", quitSession);
  $("btn-home").addEventListener("click", showHome);
  $("btn-retry-wrong").addEventListener("click", () => startSession(session.name, shuffle(reviewQuestions), false));

  $("user-name").value = store.name || "";
  $("user-name").addEventListener("input", () => {
    $("user-name").classList.remove("invalid");
    $("name-error").classList.add("hidden");
  });

  // キーボード操作：1/2/3 または A/B/C で選択
  document.addEventListener("keydown", (e) => {
    if (!session || $("screen-quiz").classList.contains("hidden")) return;
    if (e.target.tagName === "INPUT") return;
    const k = e.key.toUpperCase();
    const idx = ["1", "2", "3"].includes(k) ? Number(k) - 1 : LETTERS.indexOf(k);
    if (idx >= 0) choose(LETTERS[idx]);
  });

  updateRetakeLock();
})();
