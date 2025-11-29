import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// Global state
// ============================================================

let allCards = [];
let reviewQueue = [];
let currentIndex = 0;
let showingAnswer = false;

// ============================================================
// Utility functions
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

function showToast(msg, duration = 2500) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  el.classList.add("show");

  setTimeout(() => {
    el.classList.remove("show");
    el.classList.add("hidden");
  }, duration);
}

// ============================================================
// Screen navigation
// ============================================================

function openScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => {
    s.classList.add("hidden");
    s.classList.remove("visible");
  });

  const screen = document.getElementById(`${name}-screen`);
  if (screen) screen.classList.remove("hidden");
}

// ============================================================
// Load cards
// ============================================================

async function loadCards() {
  const { data, error } = await supabase.from("cards").select("*").order("id");

  if (error) {
    console.error("loadCards:", error);
    showToast("Error loading cards: " + error.message);
    allCards = [];
    return;
  }

  allCards = data || [];
  console.log("Loaded cards:", allCards.length);
}

// ============================================================
// Review Session
// ============================================================

function buildReviewQueue() {
  const today = todayStr();

  const due = allCards.filter(
    (c) => c.card_type !== "new" && c.due_date && c.due_date <= today
  );
  const fresh = allCards.filter((c) => c.card_type === "new");

  // Shuffle
  for (let a of [due, fresh]) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }

  reviewQueue = [...due, ...fresh];
}

function renderCard() {
  const card = reviewQueue[currentIndex];
  const text = document.getElementById("card-text");
  const ans = document.getElementById("answer-box");
  const showBtn = document.getElementById("show-answer-btn");
  const rateBtns = document.getElementById("rating-buttons");

  if (!card) {
    text.textContent = "No cards to review.";
    ans.classList.add("hidden");
    rateBtns.classList.add("hidden");
    showBtn.style.display = "none";
    return;
  }

  showingAnswer = false;
  text.textContent = card.dutch;
  ans.textContent = card.english;
  ans.classList.add("hidden");
  rateBtns.classList.add("hidden");
  showBtn.style.display = "inline-block";
}

function showAnswer() {
  showingAnswer = true;
  document.getElementById("answer-box").classList.remove("hidden");
  document.getElementById("show-answer-btn").style.display = "none";
  document.getElementById("rating-buttons").classList.remove("hidden");
}

async function handleRating(rating) {
  const card = reviewQueue[currentIndex];
  if (!card) return;

  const today = todayStr();
  let interval = card.interval_days ?? 0;
  let ease = Number(card.ease ?? 2.5);
  let type = card.card_type;
  let reps = card.reps ?? 0;
  let lapses = card.lapses ?? 0;

  reps++;

  if (type === "new") {
    if (rating === "again") {
      interval = 1;
      type = "learning";
    } else if (rating === "hard") {
      interval = 1;
      type = "learning";
    } else if (rating === "good") {
      interval = 3;
      type = "review";
    } else if (rating === "easy") {
      interval = 4;
      ease += 0.15;
      type = "review";
    }
  }

  else if (type === "learning") {
    if (rating === "again") {
      interval = 1;
    } else {
      interval = 3;
      type = "review";
    }
  }

  else { // review
    if (rating === "again") {
      lapses++;
      ease = Math.max(1.3, ease - 0.2);
      interval = 1;
      type = "learning";
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

  const { error } = await supabase.from("cards")
    .update({
      card_type: type,
      interval_days: interval,
      ease,
      reps,
      lapses,
      last_reviewed: today,
      due_date: dueDate,
      first_seen: card.first_seen ?? today
    })
    .eq("id", card.id);

  if (error) {
    console.error("Rating update error:", error);
    showToast("Error saving review.");
    return;
  }

  currentIndex++;
  if (currentIndex >= reviewQueue.length) {
    showToast("Session complete.");
    openScreen("menu");
    return;
  }

  renderCard();
}

// ============================================================
// Add new card
// ============================================================

async function addNewCard() {
  const dutch = document.getElementById("new-dutch").value.trim();
  const english = document.getElementById("new-english").value.trim();

  if (!dutch || !english) {
    showToast("Please fill both fields.");
    return;
  }

  const { error } = await supabase.from("cards").insert({
    dutch,
    english,
    card_type: "new",
    interval_days: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
    suspended: false,
    first_seen: null,
    last_reviewed: null,
    due_date: null
  });

  if (error) {
    console.error("Insert error:", error);
    showToast("Error adding card.");
    return;
  }

  showToast("Card added.");
  document.getElementById("new-dutch").value = "";
  document.getElementById("new-english").value = "";
  await loadCards();
}

// ============================================================
// Reset all learning data
// ============================================================

async function resetLearningData() {
  console.log("RESET CALLED");

  const { data: cards, error: fetchErr } = await supabase
    .from("cards")
    .select("id");

  if (fetchErr) {
    showToast("Error fetching cards.");
    return;
  }

  if (!cards || cards.length === 0) {
    showToast("No cards to reset.");
    return;
  }

  const ids = cards.map(c => c.id);

  const { error: updateErr } = await supabase
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

  if (updateErr) {
    console.error(updateErr);
    showToast("Reset failed.");
    return;
  }

  showToast("All learning data reset.");
  await loadCards();
}

// ============================================================
// Init
// ============================================================

async function init() {
  document.getElementById("show-answer-btn")
    .addEventListener("click", showAnswer);

  await loadCards();
  openScreen("menu");
}

window.addEventListener("load", init);

// Expose for HTML
window.openScreen = openScreen;
window.handleRating = handleRating;
window.addNewCard = addNewCard;
window.resetLearningData = resetLearningData;
