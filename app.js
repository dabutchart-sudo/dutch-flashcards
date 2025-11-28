// ============================================================
// Imports & Supabase Setup
// ============================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// Local Storage Keys
// ============================================================

const STORAGE_MAX_NEW_KEY = 'dfc_max_new_per_day';
const STORAGE_REVIEW_AHEAD_KEY = 'dfc_review_ahead';
const UI_SCALE_KEY = 'dfc_ui_scale';

// ============================================================
// ANKI Parameters
// ============================================================

const ANKI = {
  learningSteps: [1, 3],
  relearningSteps: [1],
  graduatingInterval: 3,
  easyGraduatingInterval: 4,
  easyBonus: 1.3,
  intervalModifier: 1.0,
  easeMin: 1.3,
  easeDefault: 2.5,
  easeHardDelta: -0.15,
  easeAgainDelta: -0.20,
  easeEasyDelta: +0.15
};

// ============================================================
// Global State
// ============================================================

let allCards = [];
let todayQueue = [];
let currentIndex = 0;
let currentShowingBack = false;

let sessionNewCount = 0;
let sessionReviewCount = 0;


let wordSort = { column: 'dutch', direction: 'asc' };

// ============================================================
// Utility Functions
// ============================================================

const todayString = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
    .toISOString()
    .slice(0, 10);
};

const addDays = (str, days) => {
  const [y, m, d] = str.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const parseDateOrNull = (str) => {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  if (isNaN(y)) return null;
  return new Date(y, m - 1, d);
};

const isSameDayStr = (a, b) => a && b && a === b;

const getMaxNew = () =>
  parseInt(localStorage.getItem(STORAGE_MAX_NEW_KEY) || "10", 10);

const setMaxNew = (v) =>
  localStorage.setItem(STORAGE_MAX_NEW_KEY, String(v));

const getReviewAheadEnabled = () =>
  localStorage.getItem(STORAGE_REVIEW_AHEAD_KEY) === "1";

const setReviewAheadEnabled = (flag) =>
  localStorage.setItem(STORAGE_REVIEW_AHEAD_KEY, flag ? "1" : "0");

function applyUiScale(percent) {
  const p = Math.min(250, Math.max(50, percent || 100));
  const scale = p / 100;
  document.documentElement.style.setProperty("--ui-scale", scale);

  const label = document.getElementById("ui-scale-value");
  if (label) label.textContent = p + "%";

  const slider = document.getElementById("ui-scale-slider");
  if (slider && String(slider.value) !== String(p)) slider.value = p;

  localStorage.setItem(UI_SCALE_KEY, String(p));
}

// ============================================================
// Screen Navigation
// ============================================================

function openScreen(name) {
  const screens = ["menu", "review", "wordReview", "settings"];

  // If user tries entering review screen, check queue first
  if (name === "review") {
    prepareTodayQueue();

    if (todayQueue.length === 0) {
      showToast("No cards due right now!");
      return; // ⛔ STOP — do NOT switch screens
    }

    // If there ARE cards, load and show the screen
    renderCurrentCard();
  }

  // Switch screens only AFTER the early-exit check
  screens.forEach((s) => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.classList.toggle("active", s === name);
  });

  if (name === "wordReview") {
    renderWordReview();
  } else if (name === "settings") {
    initSettingsUI();
  } else if (name === "menu") {
    updateProgressDisplay();
  }
}


// ============================================================
// Load Cards
// ============================================================

async function loadCards() {
  const { data, error } = await supabase.from("cards").select("*").order("id");

  if (error) {
    console.error(error);
    showToast("Error loading cards: " + error.message);
    allCards = [];
    return;
  }

  allCards = data || [];
  updateProgressDisplay();

  document.getElementById("menu-stats").textContent =
    `Loaded ${allCards.length} cards from Supabase.`;
}

// ============================================================
// Queue Preparation
// ============================================================

function prepareTodayQueue() {
  if (!allCards.length) {
    todayQueue = [];
    currentIndex = 0;
    return;
  }

  const today = todayString();
  const tomorrow = addDays(today, 1);
  const maxNew = getMaxNew();
  const reviewAhead = getReviewAheadEnabled();

  const dueReviews = [];
  const aheadReviews = [];

  allCards.forEach((c) => {
    if (c.suspended) return;
    if (c.card_type === "new") return;
    if (!c.due_date) return;

    if (c.due_date <= today) {
      dueReviews.push({ ...c, queueStatus: "due" });
    } else if (reviewAhead && c.due_date <= tomorrow) {
      aheadReviews.push({ ...c, queueStatus: "ahead" });
    }
  });

  const introducedToday = allCards.filter(
    (c) => !c.suspended && isSameDayStr(c.first_seen, today)
  ).length;

  const remainingQuota = Math.max(0, maxNew - introducedToday);

  const newPool = allCards.filter(
    (c) => !c.suspended && c.card_type === "new" && !c.first_seen
  );

  shuffle(newPool);

  const todaysNew = newPool
    .slice(0, remainingQuota)
    .map((c) => ({ ...c, queueStatus: "new" }));

  shuffle(dueReviews);
  shuffle(aheadReviews);

  todayQueue = [...dueReviews, ...aheadReviews, ...todaysNew];
  currentIndex = 0;
  currentShowingBack = false;

  sessionNewCount = 0;
sessionReviewCount = 0;
}

// Fisher-Yates
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ============================================================
// Progress Display
// ============================================================

function updateProgressDisplay() {
  const newEl = document.getElementById("progress-new");
  const revEl = document.getElementById("progress-review");
  const tomEl = document.getElementById("progress-tomorrow");

  if (!allCards.length) {
    newEl.textContent = "New today: 0 / –";
    revEl.textContent = "Reviews due: 0";
    tomEl.textContent = "Tomorrow: 0";
    return;
  }

  const today = todayString();
  const tomorrow = addDays(today, 1);
  const maxNew = getMaxNew();

  const introducedToday = allCards.filter(
    (c) => !c.suspended && isSameDayStr(c.first_seen, today)
  ).length;

  const newRemaining = Math.max(0, maxNew - introducedToday);
  const globalNewPool = allCards.filter(
    (c) => !c.suspended && c.card_type === "new"
  ).length;

  const dueReviewsCount = allCards.filter(
    (c) =>
      !c.suspended &&
      c.card_type !== "new" &&
      c.due_date &&
      c.due_date <= today
  ).length;

  const reviewsTomorrow = allCards.filter(
    (c) =>
      !c.suspended &&
      c.card_type !== "new" &&
      isSameDayStr(c.due_date, tomorrow)
  ).length;

  newEl.textContent = `New today: ${introducedToday} / ${maxNew} (up to ${Math.min(
    newRemaining,
    globalNewPool
  )} available)`;

  revEl.textContent = `Reviews due: ${dueReviewsCount}`;

  tomEl.textContent = `Tomorrow: ${reviewsTomorrow} + up to ${maxNew} new`;
}

// ============================================================
// Review Screen
// ============================================================

function currentCard() {
  return todayQueue[currentIndex] || null;
}

function renderCurrentCard() {
  const card = currentCard();
  const flashcard = document.getElementById("flashcard");
  const reviewButtons = document.getElementById("review-buttons");
  const emptyState = document.getElementById("review-empty");
  const hint = document.getElementById("hint-text");
  const info = document.getElementById("review-info");
  const whyEl = document.getElementById("review-why");

  if (!card) {
    flashcard.classList.add("hidden");
    reviewButtons.classList.add("hidden");
    hint.classList.add("hidden");
    emptyState.classList.remove("hidden");
    info.textContent = "";
    whyEl.textContent = "";
    clearCardInfoPanel();
    return;
  }

  flashcard.classList.remove("hidden");
  emptyState.classList.add("hidden");
  hint.classList.remove("hidden");

  document.getElementById("card-dutch-text").textContent = card.dutch;
  document.getElementById("card-english-text").textContent = card.english;

  const isNewLike =
    card.card_type === "new" || card.queueStatus === "new" || !card.due_date;

  const label = isNewLike
    ? "New"
    : card.queueStatus === "ahead"
    ? "Review ahead"
    : "Review";

  document.getElementById("card-status-front").textContent = label;
  document.getElementById("card-status-back").textContent = label;

  info.textContent = `Card ${currentIndex + 1} / ${
    todayQueue.length
  } — ${label}`;

  whyEl.textContent = buildWhyText(card);

  flashcard.classList.remove("flipped");
  currentShowingBack = false;
  reviewButtons.classList.add("hidden");

  updateCardInfoPanel(card);
}

function buildWhyText(card) {
  const today = todayString();

  if (card.queueStatus === "new") {
    return `This is a new card introduced today.`;
  }

  if (!card.due_date || card.card_type === "new") {
    return `This card has not yet entered the review schedule.`;
  }

  if (card.queueStatus === "ahead") {
    return `This card is scheduled for ${card.due_date} but shown early because Review Ahead is enabled.`;
  }

  if (card.due_date < today) {
    return `This card is overdue: scheduled for ${card.due_date}.`;
  }

  if (card.due_date === today) {
    return `Scheduled for review today (interval ${card.interval_days} days, ease ${card.ease.toFixed(
      2
    )}).`;
  }

  return `This card is scheduled for ${card.due_date}.`;
}

function handleCardFlip() {
  const card = currentCard();
  if (!card) return;

  const flashcard = document.getElementById("flashcard");
  const reviewButtons = document.getElementById("review-buttons");

  currentShowingBack = !currentShowingBack;

  flashcard.classList.toggle("flipped", currentShowingBack);

  if (currentShowingBack) reviewButtons.classList.remove("hidden");
  else reviewButtons.classList.add("hidden");
}

// ============================================================
// Rating / SRS Logic
// ============================================================

async function handleRating(rating) {
  const card = currentCard();
  if (!card) return;

  // --------------------------------------------
  // Feature 3A — Count new vs review cards
  // --------------------------------------------
  if (card.queueStatus === "new") {
    sessionNewCount++;
  } else {
    sessionReviewCount++;
  }

  try {
    // Apply SRS logic + save to Supabase
    const updated = await applySrsAndPersist(card, rating);

    // Update card in allCards[]
    const idxAll = allCards.findIndex((c) => c.id === card.id);
    if (idxAll !== -1)
      allCards[idxAll] = { ...allCards[idxAll], ...updated };

    // Update card in today's queue
    todayQueue[currentIndex] = { ...card, ...updated };

    // Update progress info in menu
    updateProgressDisplay();

    // Move to next card (Feature 3B will hook in here)
    renderNextCard();
  } catch (e) {
    console.error(e);
    showToast("Error updating card: " + e.message);
  }
}


function renderNextCard() {
  currentIndex += 1;

  if (currentIndex >= todayQueue.length) {
    const msg = `Session complete! ${sessionNewCount} new cards, ${sessionReviewCount} reviewed.`;
    showToast(msg, 5000);

    setTimeout(() => openScreen("menu"), 1000);

    return;
  }

  renderCurrentCard();
}


// ============================================================
// Text To Speech
// ============================================================

function speakCurrentDutch() {
  const card = currentCard();
  if (!card?.dutch) return;
  if (!("speechSynthesis" in window)) {
    showToast("Text-to-speech not supported.");
    return;
  }

  const utter = new SpeechSynthesisUtterance(card.dutch);
  utter.lang = "nl-NL";

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

// ============================================================
// Supabase Persistence (SRS Update)
// ============================================================

async function applySrsAndPersist(card, rating) {
  const today = todayString();

  let type = card.card_type || "new";
  let interval = card.interval_days || 0;
  let ease = card.ease || ANKI.easeDefault;
  let lapses = card.lapses || 0;
  let reps = card.reps || 0;
  let firstSeen = card.first_seen;
  let lastReviewed = today;

  const wasNewIntro = type === "new" && !firstSeen;

  function fuzzInterval(days) {
    if (days < 2) return days;
    const fuzz = Math.floor(days * 0.05);
    const low = days - fuzz;
    const high = days + fuzz;
    return Math.floor(Math.random() * (high - low + 1)) + low;
  }

  reps += 1;

  // -------------------------
  // NEW
  // -------------------------
  if (type === "new") {
    if (!firstSeen) firstSeen = today;

    const steps = ANKI.learningSteps;

    if (rating === "again") {
      interval = steps[0];
      type = "learning";
    } else if (rating === "hard") {
      interval = steps[0];
      type = "learning";
    } else if (rating === "good") {
      if (steps.length === 1) {
        interval = ANKI.graduatingInterval;
        type = "review";
      } else {
        interval = steps[1];
        type = "learning";
      }
    } else if (rating === "easy") {
      interval = ANKI.easyGraduatingInterval;
      ease += ANKI.easeEasyDelta;
      type = "review";
    }
  }

  // -------------------------
  // LEARNING
  // -------------------------
  else if (type === "learning") {
    const steps = ANKI.learningSteps;

    if (rating === "again" || rating === "hard") {
      interval = steps[0];
    } else if (rating === "good") {
      if (steps.length > 1 && interval === steps[0]) {
        interval = steps[1];
      } else {
        interval = ANKI.graduatingInterval;
        type = "review";
      }
    } else if (rating === "easy") {
      interval = ANKI.easyGraduatingInterval;
      ease += ANKI.easeEasyDelta;
      type = "review";
    }
  }

  // -------------------------
  // REVIEW
  // -------------------------
  else if (type === "review") {
    if (rating === "again") {
      lapses += 1;
      ease = Math.max(ANKI.easeMin, ease + ANKI.easeAgainDelta);
      interval = ANKI.relearningSteps[0];
      type = "relearning";
    } else if (rating === "hard") {
      ease = Math.max(ANKI.easeMin, ease + ANKI.easeHardDelta);
      interval = Math.max(1, Math.round(interval * 1.2));
    } else if (rating === "good") {
      interval = Math.max(
        1,
        Math.round(interval * ease * ANKI.intervalModifier)
      );
    } else if (rating === "easy") {
      ease += ANKI.easeEasyDelta;
      interval = Math.max(
        1,
        Math.round(interval * ease * ANKI.easyBonus * ANKI.intervalModifier)
      );
    }
  }

  // -------------------------
  // RELEARNING
  // -------------------------
  else if (type === "relearning") {
    const steps = ANKI.relearningSteps;

    if (rating === "again") {
      interval = steps[0];
    } else {
      interval = ANKI.graduatingInterval;
      type = "review";
    }
  }

  const due = new Date(new Date().getTime() + fuzzInterval(interval) * 86400000);
  const dueStr = due.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("cards")
    .update({
      card_type: type,
      interval_days: interval,
      ease,
      reps,
      lapses,
      due_date: dueStr,
      first_seen: firstSeen,
      last_reviewed: today
    })
    .eq("id", card.id)
    .select()
    .single();

  if (error) throw error;

  return {
    card_type: type,
    interval_days: interval,
    ease,
    reps,
    lapses,
    due_date: dueStr,
    first_seen: firstSeen,
    last_reviewed: today
  };
}

// ============================================================
// Card Info Panel
// ============================================================

function toggleCardInfoPanel() {
  const panel = document.getElementById("card-info-panel");
  panel.classList.toggle("hidden");
}

function clearCardInfoPanel() {
  const ids = [
    "info-status",
    "info-interval",
    "info-ease",
    "info-reps",
    "info-firstSeen",
    "info-lastReviewed",
    "info-dueDate"
  ];

  ids.forEach((id) => (document.getElementById(id).textContent = "–"));
}

function updateCardInfoPanel(card) {
  // This panel no longer exists in the UI — avoid crashes
  const panel = document.getElementById("card-info-panel");
  if (!panel) return;  // <<< THIS PREVENTS THE CRASH

  if (!card) {
    panel.textContent = "";
    return;
  }

  panel.textContent = `Ease: ${card.ease}, Interval: ${card.interval_days}, Reps: ${card.reps}, Lapses: ${card.lapses}`;
}


// ============================================================
// Word Review Table
// ============================================================

function sortWordTable(col) {
  if (wordSort.column === col) {
    wordSort.direction = wordSort.direction === "asc" ? "desc" : "asc";
  } else {
    wordSort.column = col;
    wordSort.direction = "asc";
  }
  renderWordReview();
}

function renderWordReview() {
  const tbody = document.getElementById("word-table-body");
  tbody.innerHTML = "";

  if (!allCards.length) return;

  const sortCol = wordSort.column;
  const sortDir = wordSort.direction;

  const cardsCopy = [...allCards];

  cardsCopy.sort((a, b) => {
    let va = a[sortCol] || "";
    let vb = b[sortCol] || "";

    if (sortCol === "last_reviewed" || sortCol === "due_date") {
      const da = parseDateOrNull(va);
      const db = parseDateOrNull(vb);
      const na = da ? da.getTime() : Infinity;
      const nb = db ? db.getTime() : Infinity;
      return sortDir === "asc" ? na - nb : nb - na;
    }

    const sa = String(va).toLowerCase();
    const sb = String(vb).toLowerCase();

    if (sa < sb) return sortDir === "asc" ? -1 : 1;
    if (sa > sb) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const today = todayString();
  const tomorrow = addDays(today, 1);
  let tomorrowCount = 0;

  cardsCopy.forEach((c) => {
    if (isSameDayStr(c.due_date, tomorrow)) tomorrowCount++;
  });

  cardsCopy.forEach((c) => {
    const tr = document.createElement("tr");

    // Dutch
    const tdDutch = document.createElement("td");
    tdDutch.textContent = c.dutch;

    // English
    const tdEnglish = document.createElement("td");
    tdEnglish.textContent = c.english;

    // Last Reviewed
    const tdLast = document.createElement("td");
    tdLast.textContent = c.last_reviewed || "—";
    if (isSameDayStr(c.last_reviewed, today)) {
      tdLast.appendChild(document.createElement("br"));
      const chip = createChip("today", "chip-review");
      tdLast.appendChild(chip);
    }

    // Due Date
    const tdDue = document.createElement("td");
    tdDue.textContent = c.due_date || "—";
    if (isSameDayStr(c.due_date, today)) {
      tdDue.appendChild(document.createElement("br"));
      tdDue.appendChild(createChip("today", "chip-review"));
    } else if (isSameDayStr(c.due_date, tomorrow)) {
      tdDue.appendChild(document.createElement("br"));
      tdDue.appendChild(createChip("tomorrow", "chip-tomorrow"));
    }

    // Suspended
    const tdSusp = document.createElement("td");
    if (c.suspended) {
      tdSusp.appendChild(createChip("suspended", "chip-suspended"));
      tdSusp.appendChild(document.createElement("br"));
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "link-btn";
    btn.textContent = c.suspended ? "Unsuspend" : "Suspend";
    btn.onclick = () => toggleSuspend(c.id, !c.suspended);
    tdSusp.appendChild(btn);

    tr.appendChild(tdDutch);
    tr.appendChild(tdEnglish);
    tr.appendChild(tdLast);
    tr.appendChild(tdDue);
    tr.appendChild(tdSusp);

    tbody.appendChild(tr);
  });

  document.getElementById(
    "wordReview-summary"
  ).textContent = `Showing ${cardsCopy.length} cards. Tomorrow you will see ${tomorrowCount} scheduled reviews + up to ${getMaxNew()} new cards.`;

  updateSortIndicators();
}

function createChip(text, className) {
  const chip = document.createElement("span");
  chip.className = `chip ${className}`;
  chip.textContent = text;
  return chip;
}

function updateSortIndicators() {
  const headers = document.querySelectorAll("th[data-col]");

  headers.forEach((th) => {
    const col = th.dataset.col;
    const arrow =
      wordSort.column === col ? (wordSort.direction === "asc" ? " ▲" : " ▼") : "";
    th.textContent = th.textContent.replace(/ ▲| ▼/g, "") + arrow;
    th.onclick = () => sortWordTable(col);
  });
}

// ============================================================
// Toggle Suspend
// ============================================================

async function toggleSuspend(cardId, newValue) {
  const { data, error } = await supabase
    .from("cards")
    .update({ suspended: newValue })
    .eq("id", cardId)
    .select()
    .single();

  if (error) {
    console.error(error);
    showToast("Error updating card: " + error.message);
    return;
  }

  const idx = allCards.findIndex((c) => c.id === cardId);
  if (idx !== -1) allCards[idx].suspended = data.suspended;

  renderWordReview();
  updateProgressDisplay();
}

// ============================================================
// Settings Screen
// ============================================================

function initSettingsUI() {
  const maxNew = getMaxNew();
  const select = document.getElementById("max-new-select");

  select.innerHTML = "";
  [5, 10, 15, 20, 30].forEach((v) => {
    const opt = document.createElement("option");
    opt.value = String(v);
    opt.textContent = `${v} per day`;
    if (v === maxNew) opt.selected = true;
    select.appendChild(opt);
  });

  document.getElementById("settings-note").textContent =
    `Currently limited to ${maxNew} new cards per day.`;

  const reviewAheadToggle = document.getElementById("review-ahead-toggle");
  reviewAheadToggle.checked = getReviewAheadEnabled();

  const slider = document.getElementById("ui-scale-slider");
  const stored = localStorage.getItem(UI_SCALE_KEY);
  const initial = stored ? parseInt(stored, 10) : 100;
  applyUiScale(initial);
  slider.value = initial;

  slider.addEventListener("input", () => {
    applyUiScale(parseInt(slider.value, 10));
  });
}

// ============================================================
// Reset Learning Data
// ============================================================

document.addEventListener("change", () => {
  const box = document.getElementById("reset-confirm");
  const btn = document.getElementById("reset-btn");
  if (box && btn) {
    btn.disabled = !box.checked;
    btn.style.opacity = box.checked ? "1" : "0.5";
  }
});

async function resetLearningData() {
  const box = document.getElementById("reset-confirm");

  if (!box.checked) {
    showToast("Please tick the confirmation box.");
    return;
  }

  // Step 1: get all card IDs
  const { data: cards, error: fetchError } = await supabase
    .from("cards")
    .select("id");

  if (fetchError) {
    console.error(fetchError);
    showToast("Failed to fetch cards.");
    return;
  }

  const ids = cards.map(c => c.id);

  // Step 2: update exactly those rows
  const { error } = await supabase
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
      suspended: false
    })
    .in("id", ids);

  if (error) {
    console.error(error);
    showToast("Reset error: " + error.message);
    return;
  }

  showToast("All progress reset!");
  await loadCards();
  updateProgressDisplay();

  box.checked = false;
  const btn = document.getElementById("reset-btn");
  btn.disabled = true;
  btn.style.opacity = "0.5";
}

// ============================================================
// Toast
// ============================================================

function showToast(msg, duration = 3000) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), duration);
}

function showCardInfoToast() {
  const card = currentCard();
  if (!card) return;

  const text =
    `Status: ${card.card_type}\n` +
    `Interval: ${card.interval_days} days\n` +
    `Ease: ${card.ease?.toFixed(2)}\n` +
    `Reps: ${card.reps}, Lapses: ${card.lapses}\n` +
    `First seen: ${card.first_seen || "—"}\n` +
    `Last reviewed: ${card.last_reviewed || "—"}\n` +
    `Due: ${card.due_date || "—"}`;

  showToast(text.replace(/null/g, "—"), 5000);
}

// ============================================================
// Initialization
// ============================================================

async function init() {
  // Flashcard flip
  document
    .getElementById("flashcard")
    .addEventListener("click", handleCardFlip);

  // Text-to-speech
  document
    .getElementById("tts-button")
    .addEventListener("click", (e) => {
      e.stopPropagation();
      speakCurrentDutch();
    });

  // Card info → toast
document
  .getElementById("info-button")
  .addEventListener("click", (e) => {
    e.stopPropagation(); // prevent card flip
    showCardInfoToast();
  });


  // New card limit
  document
    .getElementById("max-new-select")
    .addEventListener("change", (e) => {
      const val = parseInt(e.target.value, 10);
      setMaxNew(val);
      document.getElementById(
        "settings-note"
      ).textContent = `Currently limited to ${val} new cards per day.`;
      updateProgressDisplay();
    });

  // Review ahead
  document
    .getElementById("review-ahead-toggle")
    .addEventListener("change", (e) => {
      setReviewAheadEnabled(e.target.checked);
      updateProgressDisplay();
    });

  // Apply scale outside settings
  const stored = localStorage.getItem(UI_SCALE_KEY);
  applyUiScale(stored ? parseInt(stored, 10) : 100);

  await loadCards();
}

// Start
window.addEventListener("load", init);

// Expose functions used inline in HTML
window.openScreen = openScreen;
window.handleRating = handleRating;
window.toggleCardInfoPanel = toggleCardInfoPanel;
window.resetLearningData = resetLearningData;









