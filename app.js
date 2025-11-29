import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_VERSION } from "./config.js";

const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allCards = [];
let reviewQueue = [];
let currentIndex = 0;

// ============================================================
// Utility
// ============================================================

function todayStr() {
  const d = new Date();
  return d.toISOString().split("T")[0];
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
    toast.classList.add("hidden");
  }, 2500);
}

// ============================================================
// Navigation
// ============================================================

function openScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => {
    s.classList.remove("visible");
    s.classList.add("hidden");
  });

  const screen = document.getElementById(`${name}-screen`);
  if (screen) {
    screen.classList.add("visible");
    screen.classList.remove("hidden");
  }
}

window.openScreen = openScreen;

// ============================================================
// Load Cards
// ============================================================

async function loadCards() {
  const { data, error } = await supabaseClient
    .from("cards")
    .select("*")
    .order("id");

  if (error) {
    console.error(error);
    showToast("Error loading cards");
    return;
  }

  allCards = data || [];
}

// ============================================================
// Review Session
// ============================================================

function buildReviewQueue() {
  const today = todayStr();
  const due = [];
  const fresh = [];

  for (const c of allCards) {
    if (c.suspended) continue;
    if (c.card_type !== "new" && c.due_date && c.due_date <= today) {
      due.push(c);
    } else if (c.card_type === "new") {
      fresh.push(c);
    }
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  shuffle(due);
  shuffle(fresh);

  reviewQueue = [...due, ...fresh];
}

function renderCurrentCard() {
  const card = reviewQueue[currentIndex];

  const cardText = document.getElementById("card-text");
  const answerBox = document.getElementById("answer-box");
  const showBtn = document.getElementById("show-answer-btn");
  const ratingButtons = document.getElementById("rating-buttons");

  if (!card) {
    cardText.textContent = "No cards to review.";
    answerBox.classList.add("hidden");
    ratingButtons.classList.add("hidden");
    showBtn.style.display = "none";
    return;
  }

  cardText.textContent = card.dutch;
  answerBox.textContent = card.english;

  answerBox.classList.add("hidden");
  ratingButtons.classList.add("hidden");
  showBtn.style.display = "inline-block";
}

function startReviewSession() {
  buildReviewQueue();

  if (reviewQueue.length === 0) {
    showToast("No cards available to review.");
    return;
  }

  currentIndex = 0;
  renderCurrentCard();
  openScreen("review");
}

window.startReviewSession = startReviewSession;

window.showAnswer = function () {
  document.getElementById("answer-box").classList.remove("hidden");
  document.getElementById("show-answer-btn").style.display = "none";
  document.getElementById("rating-buttons").classList.remove("hidden");
};

window.handleRating = async function (rating) {
  const card = reviewQueue[currentIndex];
  if (!card) return;

  const today = todayStr();
  let type = card.card_type || "new";
  let interval = card.interval_days ?? 0;
  let ease = Number(card.ease ?? 2.5);
  let reps = card.reps ?? 0;
  let lapses = card.lapses ?? 0;

  reps++;

  if (type === "new") {
    if (rating === "again") { interval = 1; type = "learning"; }
    else if (rating === "hard") { interval = 1; type = "learning"; }
    else if (rating === "good") { interval = 3; type = "review"; }
    else if (rating === "easy") { interval = 4; ease += 0.15; type = "review"; }
  } else if (type === "learning") {
    interval = rating === "again" ? 1 : 3;
    if (rating !== "again") type = "review";
  } else {
    if (rating === "again") {
      lapses++; ease = Math.max(1.3, ease - 0.2);
      interval = 1; type = "learning";
    } else if (rating === "hard") {
      ease = Math.max(1.3, ease - 0.15);
      interval = Math.max(1, Math.round(interval * 1.2));
    } else if (rating === "good") {
      interval = Math.max(1, Math.round(interval * ease));
    } else if (rating === "easy") {
      ease += 0.15;
      interval = Math.max(1, Math.round(interval * ease * 1.3));
    }
  }

  const dueDate = addDays(today, interval);

  const { error } = await supabaseClient
    .from("cards")
    .update({
      card_type: type,
      interval_days: interval,
      ease,
      reps,
      lapses,
      last_reviewed: today,
      due_date: dueDate,
      first_seen: card.first_seen || today,
    })
    .eq("id", card.id);

  if (error) {
    console.error(error);
    showToast("Error saving review.");
    return;
  }

  currentIndex++;

  if (currentIndex >= reviewQueue.length) {
    showToast("Session complete.");
    openScreen("menu");
    return;
  }

  renderCurrentCard();
};

// ============================================================
// WORD REVIEW TABLE
// ============================================================

let currentSortCol = null;
let sortAsc = true;

function openWordReview() {
  buildWordTable(allCards);
  openScreen("wordreview");
}

window.openWordReview = openWordReview;

function buildWordTable(rows) {
  const tbody = document.getElementById("word-tbody");
  tbody.innerHTML = "";

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.dutch}</td>
      <td>${row.english}</td>
      <td>${row.last_reviewed || "-"}</td>
      <td>${row.due_date || "-"}</td>
    `;
    tbody.appendChild(tr);
  }
}

// Sort handler
document.addEventListener("click", (e) => {
  if (e.target.tagName !== "TH") return;

  const col = e.target.dataset.col;
  if (!col) return;

  // Toggle direction if clicking same column
  if (currentSortCol === col) sortAsc = !sortAsc;
  else { currentSortCol = col; sortAsc = true; }

  const sorted = [...allCards].sort((a, b) => {
    const valA = a[col] || "";
    const valB = b[col] || "";
    return sortAsc
      ? String(valA).localeCompare(String(valB))
      : String(valB).localeCompare(String(valA));
  });

  buildWordTable(sorted);
});

// ============================================================
// RESET LEARNING
// ============================================================

window.resetLearningData = async function () {
  const { data: cards, error: fetchErr } = await supabaseClient
    .from("cards")
    .select("id");

  if (fetchErr || !cards) {
    showToast("Error fetching cards.");
    return;
  }

  const ids = cards.map((c) => c.id);

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
    })
    .in("id", ids);

  if (error) {
    showToast("Reset failed.");
    return;
  }

  showToast("All learning data reset.");
  await loadCards();
};

// ============================================================
// Init
// ============================================================

async function init() {
  const versionBox = document.getElementById("app-version");
  if (versionBox) versionBox.textContent = "Version: " + APP_VERSION;

  document.getElementById("show-answer-btn")
    .addEventListener("click", showAnswer);

  await loadCards();
  openScreen("menu");
}

window.addEventListener("load", init);
