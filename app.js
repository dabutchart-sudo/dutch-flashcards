// app.js v103 — Includes Browse Viewer Mode, Image Column, and Hint Fixes

// ---- Supabase init ----
const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Global state ----
let allCards = [];
let reviewQueue = [];
let currentReviewIndex = 0;

let browseData = [];
let browseIndex = 0;

let reportChart = null;
let reportMode = "day";

// ---- Utility helpers ----
function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function addDays(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ---- Settings ----
const MAX_NEW_KEY = "maxNewCardsPerDay";

function getMaxNewCardsPerDay() {
  return parseInt(localStorage.getItem(MAX_NEW_KEY) || "10", 10);
}

function setMaxNewCardsPerDay(val) {
  localStorage.setItem(MAX_NEW_KEY, String(val));
}

// ---- Screen navigation ----
function openScreenInternal(name) {
  document.querySelectorAll(".screen").forEach((s) => {
    s.classList.remove("visible");
    s.classList.add("hidden");
  });

  const screen = document.getElementById(`${name}-screen`);
  if (screen) {
    screen.classList.add("visible");
    screen.classList.remove("hidden");
  }

  if (name === "menu") updateSummaryPanel();
}

window.openScreen = (name) => openScreenInternal(name);

// ---- Load cards ----
async function loadCards() {
  const { data, error } = await supabaseClient.from("cards").select("*").order("id");
  if (error) {
    console.error("loadCards error:", error);
    showToast("Error loading cards");
    allCards = [];
    return;
  }
  allCards = data || [];
}

// ---- Build review queue ----
function buildReviewQueue() {
  const today = todayStr();
  const maxNew = getMaxNewCardsPerDay();

  const due = [];
  const newCandidates = [];

  for (const c of allCards) {
    if (c.suspended) continue;

    const isDue = c.card_type !== "new" && c.due_date && c.due_date <= today;

    const isTrulyNew =
      c.card_type === "new" && (c.first_seen === null || c.first_seen === undefined);

    if (isDue) due.push(c);
    else if (isTrulyNew) newCandidates.push(c);
  }

  const introducedToday = allCards.filter((c) => c.first_seen === today).length;
  let remainingNew = maxNew - introducedToday;
  if (remainingNew < 0) remainingNew = 0;

  shuffle(due);
  shuffle(newCandidates);

  const selectedNew = newCandidates.slice(0, remainingNew);

  reviewQueue = [...due, ...selectedNew];
}

// ---- Review UI ----
function updateReviewCounter() {
  const el = document.getElementById("review-counter");
  if (!el) return;

  if (!reviewQueue.length) {
    el.textContent = "";
    return;
  }

  el.textContent = `Card ${currentReviewIndex + 1} of ${reviewQueue.length}`;
}

function updateReviewProgressBar() {
  const bar = document.getElementById("review-progress-bar");
  if (!bar) return;

  if (!reviewQueue.length) {
    bar.style.width = "0%";
    return;
  }

  bar.style.width = `${(currentReviewIndex / reviewQueue.length) * 100}%`;
}

function updateCardStatus(card) {
  const statusEl = document.getElementById("card-status");
  if (!statusEl) return;

  if (!card) {
    statusEl.textContent = "";
    return;
  }

  if (card.card_type === "new") {
    statusEl.textContent = "NEW";
    statusEl.style.color = "#ff8800";
  } else if (card.card_type === "learning") {
    statusEl.textContent = "LEARNING";
    statusEl.style.color = "#5bc0de";
  } else {
    statusEl.textContent = "REVIEW";
    statusEl.style.color = "#5cb85c";
  }
}

function renderCurrentReviewCard() {
  const card = reviewQueue[currentReviewIndex];

  const flipper = document.getElementById("card-flipper");
  const frontText = document.getElementById("card-front-text");
  const backText = document.getElementById("card-back-text");
  const ratingRow = document.getElementById("rating-buttons");
  const hintBtn = document.getElementById("review-hint-btn");

  if (!card) {
    frontText.textContent = "";
    backText.textContent = "";
    ratingRow.classList.add("hidden");
    hintBtn.classList.add("hidden");
    updateCardStatus(null);
    updateReviewCounter();
    updateReviewProgressBar();
    return;
  }

  flipper.classList.remove("flip");
  void flipper.offsetWidth;

  frontText.textContent = card.dutch;
  backText.textContent = "";
  ratingRow.classList.add("hidden");

  if (card.image_url) hintBtn.classList.remove("hidden");
  else hintBtn.classList.add("hidden");

  updateCardStatus(card);
  updateReviewCounter();
  updateReviewProgressBar();
}

// ---- Start Review Session ----
window.startReviewSession = async () => {
  await loadCards();
  updateSummaryPanel();
  buildReviewQueue();

  if (!reviewQueue.length) {
    showToast("No cards to review.");
    return;
  }

  currentReviewIndex = 0;
  renderCurrentReviewCard();
  openScreenInternal("review");
};

// ---- Flip (review) ----
(() => {
  const container = document.querySelector("#review-screen .flip-container");
  if (!container) return;

  container.addEventListener("click", () => {
    const card = reviewQueue[currentReviewIndex];
    if (!card) return;

    const flipper = document.getElementById("card-flipper");
    const backText = document.getElementById("card-back-text");
    const ratingRow = document.getElementById("rating-buttons");

    if (!flipper.classList.contains("flip")) {
      backText.textContent = card.english;
    }

    flipper.classList.toggle("flip");

    if (flipper.classList.contains("flip")) {
      setTimeout(() => ratingRow.classList.remove("hidden"), 300);
    } else {
      ratingRow.classList.add("hidden");
    }
  });
})();

// ---- TTS (review) ----
window.tts = function () {
  const card = reviewQueue[currentReviewIndex];
  if (!card) return;
  const u = new SpeechSynthesisUtterance(card.dutch);
  u.lang = "nl-NL";
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
};

// ---- Hint modal ----
window.openHintModal = function () {
  const reviewVisible = document.getElementById("review-screen").classList.contains("visible");
  const browseVisible = document.getElementById("browse-screen").classList.contains("visible");

  let card = null;
  if (reviewVisible) card = reviewQueue[currentReviewIndex];
  else if (browseVisible) card = browseData[browseIndex];

  if (!card || !card.image_url) {
    showToast("No hint image available");
    return;
  }

  const img = document.getElementById("hint-image");
  img.src = card.image_url;

  document.getElementById("hint-modal").classList.remove("hidden");
};

window.closeHintModal = () => {
  document.getElementById("hint-modal").classList.add("hidden");
};

// ---- Rating Handler (review mode) ----
window.handleRating = async function (rating) {
  const card = reviewQueue[currentReviewIndex];
  if (!card) return;

  const today = todayStr();

  let type = card.card_type || "new";
  let interval = card.interval_days || 0;
  let ease = Number(card.ease || 2.5);
  let reps = card.reps || 0;
  let lapses = card.lapses || 0;

  reps++;

  if (type === "new") {
    if (rating === "again") interval = 1;
    else if (rating === "hard") interval = 1;
    else if (rating === "good") interval = 3;
    else if (rating === "easy") {
      interval = 4;
      ease += 0.15;
    }
    type = interval > 1 ? "review" : "learning";
  } else if (type === "learning") {
    if (rating === "again") interval = 1;
    else interval = 3, type = "review";
  } else {
    if (rating === "again") {
      lapses++;
      ease = Math.max(1.3, ease - 0.2);
      interval = 1;
      type = "learning";
    } else if (rating === "hard") {
      ease = Math.max(1.3, ease - 0.15);
      interval = Math.round(interval * 1.2);
    } else if (rating === "good") {
      interval = Math.round(interval * ease);
    } else if (rating === "easy") {
      ease += 0.15;
      interval = Math.round(interval * ease * 1.3);
    }
  }

  interval = Math.max(1, interval);
  const due_date = addDays(today, interval);
  const first_seen = card.first_seen || today;

  const { error } = await supabaseClient.from("cards").update({
    card_type: type,
    interval_days: interval,
    ease,
    reps,
    lapses,
    first_seen,
    last_reviewed: today,
    due_date,
    suspended: false,
  }).eq("id", card.id);

  if (error) {
    console.error("Card update error:", error);
    showToast("Failed to save review");
    return;
  }

  const review_type = (first_seen === today ? "new" : "review");
  const { error: logErr } = await supabaseClient.from("reviews").insert({
    card_id: card.id,
    rating,
    event_date: today,
    review_type,
  });

  if (logErr) console.error("Review log insert error:", logErr);

  currentReviewIndex++;

  if (currentReviewIndex >= reviewQueue.length) {
    document.getElementById("review-progress-bar").style.width = "100%";
    await loadCards();
    updateSummaryPanel();
    showToast("Session complete");
    openScreenInternal("menu");
    return;
  }

  renderCurrentReviewCard();
};

// ---- Browse (NEW VERSION) ----
window.openBrowse = async function () {
  await loadCards();
  updateSummaryPanel();
  buildBrowseData();
  renderBrowseTable();

  document.getElementById("browse-table-view").classList.remove("hidden");
  document.getElementById("browse-flashcard-view").classList.add("hidden");

  openScreenInternal("browse");
};

function buildBrowseData() {
  browseData = allCards.filter((c) => !c.suspended);
}

function renderBrowseTable() {
  const tbody = document.getElementById("word-tbody");
  tbody.innerHTML = "";

  browseData.forEach((card, index) => {
    const tr = document.createElement("tr");

    const hasImage = card.image_url ? "✓" : "";

    tr.innerHTML = `
      <td>${card.dutch}</td>
      <td>${card.english}</td>
      <td style="text-align:center;">${hasImage}</td>
      <td><button class="primary-btn" data-index="${index}">View</button></td>
    `;

    tr.querySelector("button").addEventListener("click", () => {
      browseIndex = index;
      startBrowseViewerMode();
    });

    tbody.appendChild(tr);
  });
}

// ---- Viewer mode ----
function startBrowseViewerMode() {
  renderBrowseFlashcard();
  document.getElementById("browse-table-view").classList.add("hidden");
  document.getElementById("browse-flashcard-view").classList.remove("hidden");
}

function renderBrowseFlashcard() {
  const card = browseData[browseIndex];

  const flipper = document.getElementById("browse-flipper");
  const frontText = document.getElementById("browse-front-text");
  const backText = document.getElementById("browse-back-text");
  const hintBtn = document.getElementById("browse-hint-btn");

  if (!card) {
    frontText.textContent = "";
    backText.textContent = "";
    hintBtn.classList.add("hidden");
    return;
  }

  flipper.classList.remove("flip");
  void flipper.offsetWidth;

  frontText.textContent = card.dutch;
  backText.textContent = "";

  if (card.image_url) hintBtn.classList.remove("hidden");
  else hintBtn.classList.add("hidden");
}

window.toggleBrowseFlip = function () {
  const card = browseData[browseIndex];
  if (!card) return;

  const flipper = document.getElementById("browse-flipper");
  const backText = document.getElementById("browse-back-text");

  if (!flipper.classList.contains("flip")) {
    backText.textContent = card.english;
  }

  flipper.classList.toggle("flip");
};

window.browsePrev = function () {
  browseIndex = (browseIndex - 1 + browseData.length) % browseData.length;
  renderBrowseFlashcard();
};

window.browseNext = function () {
  browseIndex = (browseIndex + 1) % browseData.length;
  renderBrowseFlashcard();
};

window.browseTTS = function () {
  const card = browseData[browseIndex];
  if (!card) return;
  const u = new SpeechSynthesisUtterance(card.dutch);
  u.lang = "nl-NL";
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
};

// ---- Summary panel ----
function updateSummaryPanel() {
  const todayEl = document.getElementById("summary-today");
  const tomorrowEl = document.getElementById("summary-tomorrow");
  if (!todayEl || !tomorrowEl) return;

  const today = todayStr();
  const tomorrow = addDays(today, 1);
  const maxNew = getMaxNewCardsPerDay();

  const availableNew = allCards.filter(
    (c) => c.card_type === "new" && !c.first_seen && !c.suspended
  ).length;

  const newToday = Math.min(maxNew, availableNew);
  const newTomorrow = Math.min(maxNew, availableNew);

  const reviewToday = allCards.filter(
    (c) => !c.suspended && c.due_date && c.due_date <= today
  ).length;

  const reviewTomorrow = allCards.filter(
    (c) => !c.suspended && c.due_date === tomorrow
  ).length;

  todayEl.textContent = `Today: New ${newToday}, Review ${reviewToday}`;
  tomorrowEl.textContent = `Tomorrow: New ${newTomorrow}, Review ${reviewTomorrow}`;
}

// ---- Reports ----
window.openReport = async function () {
  await loadCards();
  updateSummaryPanel();
  openScreenInternal("report");
  reportMode = "day";
  updateReportButtons();
  buildReportChart();
};

window.setReportMode = function (mode) {
  reportMode = mode;
  updateReportButtons();
  buildReportChart();
};

function updateReportButtons() {
  const modes = ["day", "month", "year"];
  document.querySelectorAll(".report-group-btn").forEach((btn, idx) => {
    if (modes[idx] === reportMode) btn.classList.add("active");
    else btn.classList.remove("active");
  });
}

async function buildReportChart() {
  const { data, error } = await supabaseClient
    .from("reviews")
    .select("event_date, review_type");

  if (error) {
    console.error("Report load error:", error);
    return;
  }

  const counts = {};
  (data || []).forEach((row) => {
    const date = row.event_date;
    if (!date) return;

    let key =
      reportMode === "day"
        ? date
        : reportMode === "month"
        ? date.slice(0, 7)
        : date.slice(0, 4);

    if (!counts[key]) counts[key] = { new: 0, review: 0 };
    counts[key][row.review_type === "new" ? "new" : "review"]++;
  });

  const labels = Object.keys(counts).sort();
  const newData = labels.map((k) => counts[k].new);
  const reviewData = labels.map((k) => counts[k].review);

  const ctx = document.getElementById("report-chart");
  if (reportChart) reportChart.destroy();

  reportChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "New", data: newData, backgroundColor: "#ff8800", stack: "stack1" },
        { label: "Review", data: reviewData, backgroundColor: "#4287f5", stack: "stack1" },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true },
      },
    },
  });
}

// ---- Init ----
window.addEventListener("load", async () => {
  const verEl = document.getElementById("app-version");
  if (verEl) verEl.textContent = `Version: ${APP_VERSION}`;

  const maxNewSelect = document.getElementById("max-new-cards-select");
  if (maxNewSelect) {
    maxNewSelect.value = String(getMaxNewCardsPerDay());
    maxNewSelect.addEventListener("change", () => {
      const v = parseInt(maxNewSelect.value, 10);
      setMaxNewCardsPerDay(v);
      updateSummaryPanel();
      showToast("Max new cards updated");
    });
  }

  await loadCards();
  updateSummaryPanel();
  openScreenInternal("menu");
});
