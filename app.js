import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_VERSION } from "./config.js";

const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allCards = [];
let reviewQueue = [];
let currentIndex = 0;

// Word review sorting
let wordSortColumn = null;
let wordSortAsc = true;

// Report chart
let reportChart = null;
let reportGroupMode = "day";

// ----------------- Utility -----------------
function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function addDays(isoDate, days) {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

// ----------------- TTS (Dutch) -----------------
function speakDutch(text) {
  if (!window.speechSynthesis) {
    showToast("TTS not supported");
    return;
  }

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "nl-NL";

  const voices = speechSynthesis.getVoices();
  const dutchVoice = voices.find((v) => v.lang === "nl-NL");
  if (dutchVoice) utter.voice = dutchVoice;

  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}

document.addEventListener("voiceschanged", () => {
  // Helps Safari/iOS load voices
});

document.getElementById("tts-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const card = reviewQueue[currentIndex];
  if (card) speakDutch(card.dutch);
});

// ----------------- Settings -----------------
const MAX_NEW_KEY = "maxNewCardsPerDay";

function getMaxNewCardsPerDay() {
  return parseInt(localStorage.getItem(MAX_NEW_KEY) || "10", 10);
}

function setMaxNewCardsPerDay(val) {
  localStorage.setItem(MAX_NEW_KEY, String(val));
}

// ----------------- Navigation -----------------
window.openScreen = function (name) {
  document.querySelectorAll(".screen").forEach((s) => {
    s.classList.remove("visible");
    s.classList.add("hidden");
  });

  const screen = document.getElementById(`${name}-screen`);
  if (screen) {
    screen.classList.add("visible");
    screen.classList.remove("hidden");
  }

  if (name === "menu") {
    updateSummary();
  }
};

// ----------------- Summary (Today & Tomorrow) -----------------
function updateSummary() {
  const panel = document.getElementById("summary-panel");
  if (!panel) return;

  const today = todayStr();
  const tomorrow = addDays(today, 1);
  const maxNew = getMaxNewCardsPerDay();

  let dueToday = 0;
  let dueTomorrow = 0;
  let newCards = 0;
  let introducedToday = 0;

  for (const c of allCards) {
    if (c.suspended) continue;

    if (c.card_type !== "new" && c.due_date) {
      if (c.due_date <= today) dueToday++;
      if (c.due_date === tomorrow) dueTomorrow++;
    }

    const isNew =
      c.card_type === "new" &&
      (c.first_seen === null || c.first_seen === undefined);

    if (isNew) newCards++;

    if (c.first_seen === today) introducedToday++;
  }

  const newToday = Math.max(0, Math.min(maxNew - introducedToday, newCards));
  const newTomorrow = Math.min(maxNew, newCards);

  panel.innerHTML = `
    <h2>Study Summary</h2>
    <div class="summary-row"><strong>Today:</strong> ${dueToday} review, ${newToday} new</div>
    <div class="summary-row"><strong>Tomorrow:</strong> ${dueTomorrow} review, ${newTomorrow} new</div>
  `;
}

// ----------------- Data Loading -----------------
async function loadCards() {
  const { data, error } = await supabaseClient.from("cards").select("*").order("id");
  if (error) {
    console.error(error);
    allCards = [];
  } else {
    allCards = data || [];
  }
  updateSummary();
}

// ----------------- Review Queue -----------------
function buildReviewQueue() {
  const today = todayStr();
  const maxNew = getMaxNewCardsPerDay();

  const due = [];
  const newList = [];

  for (const c of allCards) {
    if (c.suspended) continue;

    if (c.card_type !== "new" && c.due_date && c.due_date <= today) {
      due.push(c);
    } else if (
      c.card_type === "new" &&
      (c.first_seen === null || c.first_seen === undefined)
    ) {
      newList.push(c);
    }
  }

  const introducedToday = allCards.filter((c) => c.first_seen === today).length;
  let remainingNew = Math.max(0, maxNew - introducedToday);

  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  };

  shuffle(due);
  shuffle(newList);

  reviewQueue = [...due, ...newList.slice(0, remainingNew)];
}

// ----------------- Review Progress / Status -----------------
function updateProgress() {
  const bar = document.getElementById("review-progress-bar");
  const counter = document.getElementById("review-counter");

  const total = reviewQueue.length;
  const done = Math.min(currentIndex, total);

  counter.textContent = `${done} / ${total}`;
  bar.style.width = total ? `${(done / total) * 100}%` : "0%";
}

function renderCardStatus(card) {
  const el = document.getElementById("card-status");
  if (!el) return;

  if (!card) {
    el.textContent = "";
    return;
  }

  if (card.card_type === "new") {
    el.textContent = "NEW";
    el.style.color = "#ff8800";
  } else if (card.card_type === "learning") {
    el.textContent = "LEARNING";
    el.style.color = "#5bc0de";
  } else {
    el.textContent = "REVIEW";
    el.style.color = "#5cb85c";
  }
}

function renderCurrentCard() {
  const card = reviewQueue[currentIndex];

  const front = document.getElementById("card-front-text");
  const back = document.getElementById("card-back-text");
  const box = document.getElementById("card-box");
  const rating = document.getElementById("rating-buttons");

  if (!card) {
    front.textContent = "No cards to review.";
    back.textContent = "";
    rating.classList.add("hidden");
    renderCardStatus(null);
    updateProgress();
    return;
  }

  box.classList.remove("flip");
  void box.offsetWidth;

  front.textContent = card.dutch;
  back.textContent = "";

  rating.classList.add("hidden");
  renderCardStatus(card);
  updateProgress();
}

// ----------------- Start Review Session -----------------
window.startReviewSession = async function () {
  await loadCards();
  buildReviewQueue();

  if (!reviewQueue.length) {
    showToast("No cards available");
    return;
  }

  currentIndex = 0;
  renderCurrentCard();
  openScreen("review");
};

// ----------------- Flip Card -----------------
document.getElementById("card-box").addEventListener("click", () => {
  const card = reviewQueue[currentIndex];
  if (!card) return;

  const back = document.getElementById("card-back-text");
  const box = document.getElementById("card-box");
  const rating = document.getElementById("rating-buttons");

  back.textContent = card.english;

  box.classList.toggle("flip");

  if (box.classList.contains("flip")) {
    setTimeout(() => rating.classList.remove("hidden"), 300);
  } else {
    rating.classList.add("hidden");
  }
});

// ----------------- Handle Rating -----------------
window.handleRating = async function (rating) {
  const card = reviewQueue[currentIndex];
  if (!card) return;

  const today = todayStr();

  let { card_type, interval_days, ease, reps, lapses } = card;
  card_type = card_type || "new";
  interval_days = interval_days || 0;
  ease = Number(ease || 2.5);
  reps = reps || 0;
  lapses = lapses || 0;

  reps++;

  if (card_type === "new") {
    if (rating === "again") interval_days = 1;
    else if (rating === "hard") interval_days = 1;
    else if (rating === "good") interval_days = 3;
    else if (rating === "easy") {
      interval_days = 4;
      ease += 0.15;
    }
    card_type = interval_days > 1 ? "review" : "learning";
  } else if (card_type === "learning") {
    if (rating === "again") {
      interval_days = 1;
    } else {
      interval_days = 3;
      card_type = "review";
    }
  } else {
    if (rating === "again") {
      lapses++;
      ease = Math.max(1.3, ease - 0.2);
      interval_days = 1;
      card_type = "learning";
    } else if (rating === "hard") {
      ease = Math.max(1.3, ease - 0.15);
      interval_days = Math.round(interval_days * 1.2);
    } else if (rating === "good") {
      interval_days = Math.round(interval_days * ease);
    } else if (rating === "easy") {
      ease += 0.15;
      interval_days = Math.round(interval_days * ease * 1.3);
    }
  }

  interval_days = Math.max(1, interval_days);
  const due_date = addDays(today, interval_days);

  const update = {
    card_type,
    interval_days,
    ease,
    reps,
    lapses,
    first_seen: card.first_seen || today,
    last_reviewed: today,
    due_date,
    suspended: false,
  };

  const { error } = await supabaseClient
    .from("cards")
    .update(update)
    .eq("id", card.id);

  if (error) {
    console.error(error);
    showToast("Save failed");
    return;
  }

  currentIndex++;

  if (currentIndex >= reviewQueue.length) {
    showToast("Session complete");
    await loadCards();
    openScreen("menu");
    return;
  }

  renderCurrentCard();
}

// ----------------- Word Review + Sorting -----------------
function buildWordTable(rows) {
  const tbody = document.getElementById("word-tbody");
  tbody.innerHTML = "";

  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.dutch}</td>
      <td>${r.english}</td>
      <td>${r.last_reviewed ?? "-"}</td>
      <td>${r.due_date ?? "-"}</td>
    `;
    tbody.appendChild(tr);
  });
}

function sortWordData() {
  if (!wordSortColumn) {
    buildWordTable(allCards);
    return;
  }

  const sorted = [...allCards];

  sorted.sort((a, b) => {
    const col = wordSortColumn;
    const av = a[col];
    const bv = b[col];

    if (av == null && bv != null) return wordSortAsc ? 1 : -1;
    if (bv == null && av != null) return wordSortAsc ? -1 : 1;
    if (av == bv) return 0;

    const cmp = String(av).localeCompare(String(bv), "nl");
    return wordSortAsc ? cmp : -cmp;
  });

  buildWordTable(sorted);
}

window.openWordReview = function () {
  sortWordData();
  openScreen("wordreview");
};

// ----------------- Report: Aggregation helpers -----------------
function dateKey(d) {
  return d;
}

function monthKey(d) {
  return d.slice(0, 7); // YYYY-MM
}

function yearKey(d) {
  return d.slice(0, 4); // YYYY
}

function getReportData(mode) {
  const today = todayStr();

  const newCounts = {};
  const reviewCounts = {};

  // Helper to add count
  const inc = (map, key) => {
    if (!map[key]) map[key] = 0;
    map[key]++;
  };

  for (const c of allCards) {
    // New: first_seen
    if (c.first_seen && c.first_seen <= today) {
      let key;
      if (mode === "day") key = dateKey(c.first_seen);
      else if (mode === "month") key = monthKey(c.first_seen);
      else key = yearKey(c.first_seen);

      inc(newCounts, key);
    }

    // Review: last_reviewed
    if (c.last_reviewed && c.last_reviewed <= today) {
      let key;
      if (mode === "day") key = dateKey(c.last_reviewed);
      else if (mode === "month") key = monthKey(c.last_reviewed);
      else key = yearKey(c.last_reviewed);

      inc(reviewCounts, key);
    }
  }

  let labels = [];

  if (mode === "day") {
    // Last 30 days rolling window
    const daysBack = 29;
    const labelsArr = [];
    const base = new Date(today);

    for (let i = daysBack; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      labelsArr.push(d.toISOString().split("T")[0]);
    }
    labels = labelsArr;
  } else {
    // Take all keys from both maps, sort
    const set = new Set([
      ...Object.keys(newCounts),
      ...Object.keys(reviewCounts),
    ]);
    labels = Array.from(set).sort();
  }

  const newData = labels.map((k) => newCounts[k] || 0);
  const reviewData = labels.map((k) => reviewCounts[k] || 0);

  return { labels, newData, reviewData };
}

function drawReportChart() {
  const ctx = document.getElementById("report-chart").getContext("2d");
  const { labels, newData, reviewData } = getReportData(reportGroupMode);

  if (reportChart) {
    reportChart.destroy();
  }

  reportChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "New learned",
          data: newData,
          backgroundColor: "rgba(255, 136, 0, 0.8)",
          stack: "stack1",
        },
        {
          label: "Reviews done",
          data: reviewData,
          backgroundColor: "rgba(91, 192, 222, 0.8)",
          stack: "stack1",
        },
      ],
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { precision: 0 },
        },
      },
      plugins: {
        legend: {
          position: "top",
        },
      },
    },
  });
}

// ----------------- Report screen entry -----------------
window.openReport = async function () {
  await loadCards();
  reportGroupMode = "day";

  // reset active button
  document
    .querySelectorAll(".report-group-btn")
    .forEach((btn) => btn.classList.remove("active"));
  const dayBtn = document.querySelector('.report-group-btn[data-mode="day"]');
  if (dayBtn) dayBtn.classList.add("active");

  drawReportChart();
  openScreen("report");
};

// Group toggle
function setupReportButtons() {
  document
    .querySelectorAll(".report-group-btn")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.getAttribute("data-mode");
        reportGroupMode = mode;

        document
          .querySelectorAll(".report-group-btn")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        drawReportChart();
      });
    });
}

// ----------------- Reset Learning -----------------
window.resetLearningData = async function () {
  const { error } = await supabaseClient
    .from("cards")
    .update({
      card_type: "new",
      interval_days: 0,
      ease: 2.5,
      reps: 0,
      lapses: 0,
      first_seen: null,
      last_reviewed: null,
      due_date: null,
      suspended: false,
    });

  if (error) {
    console.error(error);
    showToast("Reset failed");
    return;
  }

  showToast("All learning reset");
  await loadCards();
};

// ----------------- Init -----------------
window.addEventListener("load", async () => {
  const ver = document.getElementById("app-version");
  if (ver) ver.textContent = "Version: " + APP_VERSION;

  const sel = document.getElementById("max-new-cards-select");
  sel.value = String(getMaxNewCardsPerDay());
  sel.addEventListener("change", () => {
    const v = parseInt(sel.value, 10);
    setMaxNewCardsPerDay(v);
    showToast("Max new cards updated");
    updateSummary();
  });

  // Word table sorting
  document.querySelectorAll("#word-table th").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.getAttribute("data-col");
      if (!col) return;

      if (wordSortColumn === col) wordSortAsc = !wordSortAsc;
      else {
        wordSortColumn = col;
        wordSortAsc = true;
      }

      sortWordData();
    });
  });

  setupReportButtons();

  await loadCards();
  openScreen("menu");
});
