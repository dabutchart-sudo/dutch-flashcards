// app.js v101

// ---- Supabase init (config.js must define SUPABASE_URL, SUPABASE_ANON_KEY, APP_VERSION) ----
const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Global state ----
let allCards = [];
let reviewQueue = [];
let currentReviewIndex = 0;

let browseData = [];
let browseIndex = 0;
let browseSortColumn = "dutch";
let browseSortAsc = true;

let reportChart = null;
let reportMode = "day"; // 'day' | 'month' | 'year'

// ---- Utility helpers ----
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

// ---- Settings: max new cards per day ----
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

  if (name === "menu") {
    updateSummaryPanel();
  }
}

window.openScreen = function (name) {
  openScreenInternal(name);
};

// ---- Load cards from Supabase ----
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

// ---- Build review queue (due + new) ----
function buildReviewQueue() {
  const today = todayStr();
  const maxNew = getMaxNewCardsPerDay();

  const due = [];
  const newCandidates = [];

  for (const c of allCards) {
    if (c.suspended) continue;

    const isDue =
      c.card_type !== "new" &&
      c.due_date &&
      c.due_date <= today;

    const isTrulyNew =
      c.card_type === "new" &&
      (c.first_seen === null || c.first_seen === undefined);

    if (isDue) {
      due.push(c);
    } else if (isTrulyNew) {
      newCandidates.push(c);
    }
  }

  const introducedTodayCount = allCards.filter(
    (c) => c.first_seen === today
  ).length;

  let remainingNew = maxNew - introducedTodayCount;
  if (remainingNew < 0) remainingNew = 0;

  shuffle(due);
  shuffle(newCandidates);

  const selectedNew = newCandidates.slice(0, remainingNew);

  reviewQueue = [...due, ...selectedNew];
}

// ---- Review screen rendering ----
function updateReviewCounter() {
  const el = document.getElementById("review-counter");
  if (!el) return;
  if (!reviewQueue.length) {
    el.textContent = "No cards";
    return;
  }
  el.textContent = `Card ${currentReviewIndex + 1} of ${reviewQueue.length}`;
}

function updateReviewProgressBar() {
  const bar = document.getElementById("review-progress-bar");
  if (!bar || !reviewQueue.length) {
    if (bar) bar.style.width = "0%";
    return;
  }
  const pct = ((currentReviewIndex) / reviewQueue.length) * 100;
  bar.style.width = `${pct}%`;
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
  const hintBtn = document.querySelector("#review-screen .hint-btn");

  if (!card) {
    if (frontText) frontText.textContent = "No cards to review.";
    if (backText) backText.textContent = "";
    if (ratingRow) ratingRow.classList.add("hidden");
    if (hintBtn) hintBtn.classList.add("hidden");
    updateCardStatus(null);
    updateReviewCounter();
    updateReviewProgressBar();
    return;
  }

  if (flipper) {
    flipper.classList.remove("flip");
    void flipper.offsetWidth; // force reflow to reset animation
  }

  if (frontText) frontText.textContent = card.dutch;
  if (backText) backText.textContent = "";

  if (ratingRow) ratingRow.classList.add("hidden");

  if (hintBtn) {
    if (card.image_url) hintBtn.classList.remove("hidden");
    else hintBtn.classList.add("hidden");
  }

  updateCardStatus(card);
  updateReviewCounter();
  updateReviewProgressBar();
}

// ---- Start Review Session ----
window.startReviewSession = async function () {
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

// ---- Card flip (review) ----
(function setupReviewFlip() {
  const container = document.querySelector("#review-screen .flip-container");
  if (!container) return;

  container.addEventListener("click", () => {
    const card = reviewQueue[currentReviewIndex];
    if (!card) return;

    const flipper = document.getElementById("card-flipper");
    const backText = document.getElementById("card-back-text");
    const ratingRow = document.getElementById("rating-buttons");
    if (!flipper || !backText || !ratingRow) return;

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
  const utter = new SpeechSynthesisUtterance(card.dutch);
  utter.lang = "nl-NL";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
};

// ---- Hint modal (review + browse) ----
window.openHintModal = function () {
  const reviewVisible = document.getElementById("review-screen")?.classList.contains("visible");
  const browseVisible = document.getElementById("browse-screen")?.classList.contains("visible");
  let card = null;

  if (reviewVisible) {
    card = reviewQueue[currentReviewIndex];
  } else if (browseVisible) {
    card = browseData[browseIndex];
  }

  if (!card || !card.image_url) {
    showToast("No hint image available");
    return;
  }

  const img = document.getElementById("hint-image");
  const modal = document.getElementById("hint-modal");
  if (!img || !modal) return;

  img.src = card.image_url;
  modal.classList.remove("hidden");
};

window.closeHintModal = function () {
  const modal = document.getElementById("hint-modal");
  if (!modal) return;
  modal.classList.add("hidden");
};

// ---- Handle rating (review) with logging to reviews ----
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
    if (rating === "again") {
      interval = 1;
    } else {
      interval = 3;
      type = "review";
    }
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

  // Update card in DB
  const updatePayload = {
    card_type: type,
    interval_days: interval,
    ease,
    reps,
    lapses,
    first_seen,
    last_reviewed: today,
    due_date,
    suspended: false,
  };

  const { error } = await supabaseClient
    .from("cards")
    .update(updatePayload)
    .eq("id", card.id);

  if (error) {
    console.error("Card update error:", error);
    showToast("Failed to save review");
    return;
  }

  // Log review event into 'reviews' table with review_type
  const review_type = (first_seen === today ? "new" : "review");
  const { error: reviewError } = await supabaseClient
    .from("reviews")
    .insert({
      card_id: card.id,
      rating,
      event_date: today,
      review_type,
    });

  if (reviewError) {
    console.error("Review log insert error:", reviewError);
    showToast("Warning: review not logged");
  }

  // Advance to next card
  currentReviewIndex++;

  if (currentReviewIndex >= reviewQueue.length) {
    const bar = document.getElementById("review-progress-bar");
    if (bar) bar.style.width = "100%";

    await loadCards();
    updateSummaryPanel();
    showToast("Session complete");
    openScreenInternal("menu");
    return;
  }

  renderCurrentReviewCard();
}

// ---- Browse: table & flashcard ----
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
  browseData = allCards
    .filter((c) => !c.suspended)
    .slice();

  sortBrowseData();
}

function sortBrowseData() {
  browseData.sort((a, b) => {
    let A = a[browseSortColumn];
    let B = b[browseSortColumn];

    if (browseSortColumn === "last_reviewed" || browseSortColumn === "due_date") {
      A = A || "";
      B = B || "";
    } else {
      A = (A || "").toString().toLowerCase();
      B = (B || "").toString().toLowerCase();
    }

    if (A < B) return browseSortAsc ? -1 : 1;
    if (A > B) return browseSortAsc ? 1 : -1;
    return 0;
  });
}

function renderBrowseTable() {
  const tbody = document.getElementById("word-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  browseData.forEach((c, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.index = String(idx);
    tr.innerHTML = `
      <td>${c.dutch}</td>
      <td>${c.english}</td>
      <td>${c.last_reviewed || "-"}</td>
      <td>${c.due_date || "-"}</td>
    `;
    tr.addEventListener("click", () => {
      browseIndex = idx;
      startBrowseFlashcard();
    });
    tbody.appendChild(tr);
  });
}

window.sortWordTable = function (col) {
  if (browseSortColumn === col) {
    browseSortAsc = !browseSortAsc;
  } else {
    browseSortColumn = col;
    browseSortAsc = true;
  }
  sortBrowseData();
  renderBrowseTable();
};

window.showBrowseTable = function () {
  document.getElementById("browse-table-view").classList.remove("hidden");
  document.getElementById("browse-flashcard-view").classList.add("hidden");
};

window.startBrowseFlashcard = function () {
  if (!browseData.length) {
    showToast("No cards");
    return;
  }
  renderBrowseFlashcard();
  document.getElementById("browse-table-view").classList.add("hidden");
  document.getElementById("browse-flashcard-view").classList.remove("hidden");
};

function renderBrowseFlashcard() {
  const card = browseData[browseIndex];
  const flipper = document.getElementById("browse-flipper");
  const frontText = document.getElementById("browse-front-text");
  const backText = document.getElementById("browse-back-text");

  if (!card) {
    if (frontText) frontText.textContent = "No cards.";
    if (backText) backText.textContent = "";
    return;
  }

  if (flipper) {
    flipper.classList.remove("flip");
    void flipper.offsetWidth;
  }

  if (frontText) frontText.textContent = card.dutch;
  if (backText) backText.textContent = "";
}

window.toggleBrowseFlip = function () {
  const card = browseData[browseIndex];
  if (!card) return;
  const flipper = document.getElementById("browse-flipper");
  const backText = document.getElementById("browse-back-text");
  if (!flipper || !backText) return;

  if (!flipper.classList.contains("flip")) {
    backText.textContent = card.english;
  }
  flipper.classList.toggle("flip");
};

window.browsePrev = function () {
  if (!browseData.length) return;
  browseIndex = (browseIndex - 1 + browseData.length) % browseData.length;
  renderBrowseFlashcard();
};

window.browseNext = function () {
  if (!browseData.length) return;
  browseIndex = (browseIndex + 1) % browseData.length;
  renderBrowseFlashcard();
};

window.browseTTS = function () {
  const card = browseData[browseIndex];
  if (!card) return;
  const utter = new SpeechSynthesisUtterance(card.dutch);
  utter.lang = "nl-NL";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
};

// ---- Summary panel (Today / Tomorrow) ----
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
  const newTomorrow = Math.min(maxNew, availableNew); // simple approximation

  const reviewToday = allCards.filter(
    (c) => !c.suspended && c.due_date && c.due_date <= today
  ).length;

  const reviewTomorrow = allCards.filter(
    (c) => !c.suspended && c.due_date === tomorrow
  ).length;

  todayEl.textContent = `Today: New ${newToday}, Review ${reviewToday}`;
  tomorrowEl.textContent = `Tomorrow: New ${newTomorrow}, Review ${reviewTomorrow}`;
}

// ---- Report screen with stacked New/Review bars ----
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
  const buttons = document.querySelectorAll(".report-group-btn");
  buttons.forEach((btn, idx) => {
    const m = modes[idx];
    if (m === reportMode) btn.classList.add("active");
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

  const counts = {}; // key -> { new: number, review: number }

  (data || []).forEach((row) => {
    const dateStr = row.event_date;
    if (!dateStr) return;

    let key;
    if (reportMode === "day") {
      key = dateStr;
    } else if (reportMode === "month") {
      key = dateStr.slice(0, 7); // YYYY-MM
    } else {
      key = dateStr.slice(0, 4); // YYYY
    }

    if (!counts[key]) counts[key] = { new: 0, review: 0 };

    const rt = row.review_type === "new" ? "new" : "review";
    counts[key][rt]++;
  });

  const labels = Object.keys(counts).sort();
  const newData = labels.map((k) => counts[k].new);
  const reviewData = labels.map((k) => counts[k].review);

  const ctx = document.getElementById("report-chart");
  if (!ctx) return;

  if (reportChart) {
    reportChart.destroy();
    reportChart = null;
  }

  reportChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "New",
          data: newData,
          backgroundColor: "#ff8800",
          stack: "stack1",
        },
        {
          label: "Review",
          data: reviewData,
          backgroundColor: "#4287f5",
          stack: "stack1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          ticks: {
            autoSkip: true,
            maxTicksLimit: 6,
            maxRotation: 45,
            minRotation: 0,
          },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: {
            precision: 0,
          },
        },
      },
      plugins: {
        legend: {
          display: true,
        },
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
