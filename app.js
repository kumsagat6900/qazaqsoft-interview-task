// ========== Константы и ключи хранилища ==========
const STORAGE_KEYS = {
  STATE: "quiz.state.v1"
};
const DATA_URL = "./data/questions.json";

// ========== Служебные функции ==========
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ========== Модели ==========
class Question {
  constructor(dto) {
    // Перемешиваем варианты ответа, сохраняем правильный индекс
    const optionObjs = dto.options.map((opt, i) => ({
      text: opt,
      originalIndex: i
    }));
    const shuffled = shuffleArray(optionObjs);

    this.id = dto.id;
    this.text = dto.text;
    this.options = shuffled.map(o => o.text);
    this.correctIndex = shuffled.findIndex(o => o.originalIndex === dto.correctIndex);
    this.topic = dto.topic ?? null;
  }
}

// ========== Сервисы ==========
class StorageService {
  static saveState(state) {
    localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(state));
  }
  static loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.STATE);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  static clear() {
    localStorage.removeItem(STORAGE_KEYS.STATE);
  }
}

// ========== Движок теста ==========
class QuizEngine {
  constructor(quiz) {
    this.title = quiz.title;
    this.timeLimitSec = quiz.timeLimitSec;
    this.passThreshold = quiz.passThreshold;
    // Перемешиваем вопросы
    this.questions = shuffleArray(quiz.questions.map((q) => new Question(q)));

    this.currentIndex = 0;
    this.answers = {}; // questionId -> selectedIndex
    this.remainingSec = quiz.timeLimitSec;
    this.isFinished = false;

    // Аналитика: время на каждом вопросе
    this.questionTimes = {};
    this._lastTime = undefined;
  }

  get length() {
    return this.questions.length;
  }
  get currentQuestion() {
    return this.questions[this.currentIndex];
  }

  goTo(index) {
    this._fixTime();
    if (index < 0 || index >= this.length) throw new Error("Out of bounds");
    this.currentIndex = index;
    this._lastTime = Date.now();
  }
  next() {
    this.goTo(this.currentIndex + 1);
  }
  prev() {
    this.goTo(this.currentIndex - 1);
  }
  select(optionIndex) {
    this.answers[this.currentQuestion.id] = optionIndex;
  }
  getSelectedIndex() {
    return this.answers[this.currentQuestion.id];
  }
  tick() {
    if (this.isFinished) return;
    this.remainingSec--;
    if (this.remainingSec <= 0) {
      this.remainingSec = 0;
      this.finish();
    }
  }

  _fixTime() {
    if (this._lastTime !== undefined) {
      const dt = Math.floor((Date.now() - this._lastTime) / 1000);
      const qid = this.currentQuestion.id;
      this.questionTimes[qid] = (this.questionTimes[qid] || 0) + dt;
    }
  }

  finish() {
    if (this.isFinished) return this._summary;
    this.isFinished = true;
    this._fixTime();

    let correct = 0;
    for (let q of this.questions) {
      if (this.answers[q.id] === q.correctIndex) correct++;
    }
    const total = this.length;
    const percent = total === 0 ? 0 : correct / total;
    const passed = percent >= this.passThreshold;

    // Аналитика по темам
    const topicStats = {};
    for (let q of this.questions) {
      if (!q.topic) continue;
      if (!topicStats[q.topic]) topicStats[q.topic] = { correct: 0, total: 0 };
      topicStats[q.topic].total++;
      if (this.answers[q.id] === q.correctIndex) topicStats[q.topic].correct++;
    }

    this._summary = {
      correct,
      total,
      percent,
      passed,
      questionTimes: this.questionTimes,
      topicStats
    };
    return this._summary;
  }

  toState() {
    return {
      currentIndex: this.currentIndex,
      answers: this.answers,
      remainingSec: this.remainingSec,
      isFinished: this.isFinished,
      _summary: this._summary,
      questionTimes: this.questionTimes
    };
  }

  static fromState(quiz, state) {
    const engine = new QuizEngine(quiz);
    engine.currentIndex = state.currentIndex ?? 0;
    engine.answers = state.answers ?? {};
    engine.remainingSec = state.remainingSec ?? quiz.timeLimitSec;
    engine.isFinished = state.isFinished ?? false;
    engine._summary = state._summary ?? undefined;
    engine.questionTimes = state.questionTimes || {};
    return engine;
  }
}

// ========== DOM-утилиты ==========
const $ = (sel) => document.querySelector(sel);
const els = {
  title: $("#quiz-title"),
  progress: $("#progress"),
  timer: $("#timer"),
  qSection: $("#question-section"),
  qText: $("#question-text"),
  form: $("#options-form"),
  btnPrev: $("#btn-prev"),
  btnNext: $("#btn-next"),
  btnFinish: $("#btn-finish"),
  result: $("#result-section"),
  resultSummary: $("#result-summary"),
  btnReview: $("#btn-review"),
  btnRestart: $("#btn-restart")
};

let engine = null;
let timerId = undefined;
let reviewMode = false;

// ========== Инициализация ==========
document.addEventListener("DOMContentLoaded", async () => {
  const quiz = await loadQuiz();
  els.title.textContent = quiz.title;

  const saved = StorageService.loadState?.();
  if (saved) {
    engine = QuizEngine.fromState(quiz, saved);
  } else {
    engine = new QuizEngine(quiz);
  }

  bindEvents();
  renderAll();

  if (!engine.isFinished) startTimer();
  else renderResult(engine.finish());
});

async function loadQuiz() {
  const res = await fetch(DATA_URL);
  const data = await res.json();
  if (!data?.questions?.length) {
    throw new Error("Некорректные данные теста");
  }
  return data;
}

// ========== Таймер ==========
function startTimer() {
  stopTimer();
  timerId = window.setInterval(() => {
    try {
      engine.tick();
      persist();
      renderTimer();
      if (engine.isFinished) {
        stopTimer();
        renderResult(engine.finish());
      }
    } catch (e) {
      stopTimer();
    }
  }, 1000);
}
function stopTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = undefined;
  }
}

// ========== События ==========
function bindEvents() {
  els.btnPrev.addEventListener("click", () => {
    safeCall(() => engine.prev());
    persist();
    renderAll();
  });

  els.btnNext.addEventListener("click", () => {
    safeCall(() => engine.next());
    persist();
    renderAll();
  });

  els.btnFinish.addEventListener("click", () => {
    const summary = safeCall(() => engine.finish());
    if (summary) {
      stopTimer();
      renderResult(summary);
      persist();
    }
  });

  els.btnReview.addEventListener("click", () => {
    reviewMode = true;
    renderAll();
  });

  els.btnRestart.addEventListener("click", () => {
    StorageService.clear?.();
    window.location.reload();
  });

  els.form.addEventListener("change", (e) => {
    const target = e.target;
    if (target?.name === "option") {
      const idx = Number(target.value);
      safeCall(() => engine.select(idx));
      persist();
      renderNav();
    }
  });
}

function safeCall(fn) {
  try {
    return fn?.();
  } catch {
    /* noop */
  }
}

// ========== Рендер ==========
function renderAll() {
  renderProgress();
  renderTimer();
  renderQuestion();
  renderNav();
}

function renderProgress() {
  els.progress.textContent = `Вопрос ${engine.currentIndex + 1} из ${engine.length}`;
}

function renderTimer() {
  const sec = engine.remainingSec ?? 0;
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  els.timer.textContent = `${m}:${s}`;
}

// Фикс: рендерим все вопросы при reviewMode
function renderQuestion() {
  if (reviewMode) {
    els.qSection.innerHTML = ""; // очищаем секцию
    engine.questions.forEach((q, qIdx) => {
      const block = document.createElement("div");
      block.className = "card";
      block.style.marginBottom = "12px";
      const qTitle = document.createElement("div");
      qTitle.className = "question-text";
      qTitle.textContent = `Вопрос ${qIdx + 1}: ${q.text}`;
      block.appendChild(qTitle);

      q.options.forEach((opt, i) => {
        const wrapper = document.createElement("label");
        wrapper.className = "option";
        const chosen = engine.answers[q.id];
        if (i === q.correctIndex) wrapper.classList.add("correct");
        if (chosen === i && i !== q.correctIndex) wrapper.classList.add("incorrect");

        const input = document.createElement("input");
        input.type = "radio";
        input.name = `option-${q.id}`;
        input.value = String(i);
        input.checked = chosen === i;
        input.disabled = true;

        const span = document.createElement("span");
        span.textContent = opt;

        wrapper.appendChild(input);
        wrapper.appendChild(span);
        block.appendChild(wrapper);
      });

      els.qSection.appendChild(block);
    });
  } else {
    // Как было — только текущий вопрос
    const q = engine.currentQuestion;
    els.qText.textContent = q.text;
    els.form.innerHTML = "";
    q.options.forEach((opt, i) => {
      const id = `opt-${q.id}-${i}`;
      const wrapper = document.createElement("label");
      wrapper.className = "option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "option";
      input.value = String(i);
      input.id = id;
      input.checked = engine.getSelectedIndex?.() === i;
      input.disabled = engine.isFinished || reviewMode;
      const span = document.createElement("span");
      span.textContent = opt;
      wrapper.appendChild(input);
      wrapper.appendChild(span);
      els.form.appendChild(wrapper);
    });
  }
}

function renderNav() {
  // Фикс: если reviewMode, оставить только кнопку "Пройти заново"
  if (reviewMode) {
    els.btnPrev.style.display = "none";
    els.btnNext.style.display = "none";
    els.btnFinish.style.display = "none";
    els.btnReview.style.display = "none";
    els.btnRestart.style.display = ""; // показываем
    return;
  } else {
    els.btnPrev.style.display = "";
    els.btnNext.style.display = "";
    els.btnFinish.style.display = "";
    els.btnReview.style.display = "";
    els.btnRestart.style.display = "";
  }

  const hasSelection = Number.isInteger(engine.getSelectedIndex?.());
  els.btnPrev.disabled = engine.currentIndex === 0 || engine.isFinished;
  els.btnNext.disabled = !(engine.currentIndex < engine.length - 1 && hasSelection) || engine.isFinished;
  els.btnFinish.disabled = !(engine.currentIndex === engine.length - 1 && hasSelection) || engine.isFinished;
}

function renderResult(summary) {
  els.result.classList.remove("hidden");
  const pct = Math.round(summary.percent * 100);
  const status = summary.passed ? "<span style='color:var(--accent);font-weight:bold'>Пройден</span>" : "<span style='color:#ef4444;font-weight:bold'>Не пройден</span>";
  let html = `<b>${summary.correct} / ${summary.total}</b> (${pct}%) — ${status}<br>`;

  // Среднее время на вопрос
  if (summary.questionTimes) {
    const times = Object.values(summary.questionTimes);
    const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
    html += `<div style="margin-top:8px;">
      <b>Среднее время на вопрос:</b> ${avg} сек
      <ul style="margin:4px 0 0 18px;">`;
    for (const [qid, t] of Object.entries(summary.questionTimes)) {
      const q = engine.questions.find(q => q.id === qid);
      html += `<li><span style="color:var(--primary)">${q.text}</span> — <b>${t} сек</b></li>`;
    }
    html += `</ul></div>`;
  }

  // Статистика по темам
  if (summary.topicStats && Object.keys(summary.topicStats).length) {
    html += `<div style="margin-top:8px;"><b>Статистика по темам:</b><ul style="margin:4px 0 0 18px;">`;
    for (const [topic, s] of Object.entries(summary.topicStats)) {
      html += `<li><span style="color:var(--primary)">${topic}</span>: <b>${s.correct} / ${s.total}</b></li>`;
    }
    html += `</ul></div>`;
  }

  els.resultSummary.innerHTML = html;
}

// ========== Persist ==========
function persist() {
  try {
    const snapshot = engine.toState?.();
    if (snapshot) StorageService.saveState(snapshot);
  } catch {
    /* noop */
  }
}
