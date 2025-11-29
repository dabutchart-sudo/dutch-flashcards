// ============================================================
// Supabase setup
// ============================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// Supabase client from global window.supabase (CDN script must be loaded)
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// SRS config (simplified Anki-style)
// ============================================================

const SRS = {
  learningSteps: [1, 3],         // minutes converted to days approx
  relearningSteps: [1],
  graduatingInterval: 3,         // days
  easyGraduatingInterval: 4,     // days
  easeDefault: 2.5,
  easeMin: 1.3,
  easeAgainDelta: -0.2,
  easeHardDelta: -0.15,
  easeEasyDelta: +0.15,
  intervalModifier: 1.0,
  easyBonus: 1.3
};

// ============================================================
// Global state
// ============================================================

let allCards = [];         // all cards from DB
let reviewQueue = [];      // cards for current session
let currentIndex = 0;
let showingAnswer = false;

// ============================================================
// Small utilities
// ============================================================

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function showToast(msg, duration = 3000) {
  const el = document.getElementById("toast");
  if (!el) {
    console.log("TOAST:", msg);
    return;
  }
  el.textContent = msg;
  el.classList.remove("hidden");
  el.classList.add("show");

  setTimeout(() => {
    el.classList.add("hidden");
    el.classList.remove("show");
  }, duration);
}

// Fisher–Yates shuffle
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ============================================================
// Screen navigation
// ============================================================

function openScreen(name) {
  const screens = ["menu", "review", "add", "settings"];

  screens.forEach((s) => {
    const el = document.getElementById(`${s}-screen`);
    if (!el) return;
    el.style.display = s === name ? "block" : "none";
  });

  if (name === "review") {
    startReviewSession();
  }
}

// ============================================================
// Loading cards
// ============================================================

async function loadCards() {
  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .order("id");

  if (error) {
    console.error("loadCards error:", error);
    showToast("Error loading cards: " + error.message);
    allCards = [];
    return;
  }

  allCards = data || [];
  console.log("Loaded cards:", allCards.length);

  // You could update some menu stats here if desired
}

// ============================================================
// Review session
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

  shuffle(due);
  shuffle(fresh);

  // Priority: due reviews, then new
  reviewQueue = [...due, ...fresh];

  console.log("Review queue size:", reviewQueue.length);
}

function currentCard() {
  return reviewQueue[currentIndex] || null;
}

function renderReviewScreen() {
  const card = currentCard();

  const cardTextEl = document.getElementById("card-text");
  const answerBoxEl = document.getElementById("answer-box");
  const showBtn = document.getElementById("show-answer-btn");
  const ratingButtons = document.getElementById("rating-buttons");

  if (!card) {
    if (cardTextEl) cardTextEl.textContent = "No cards to review.";
    if (answerBoxEl) {
      answerBoxEl.textContent = "";
      answerBoxEl.classList.add("hidden");
    }
    if (showBtn) showBtn.style.display = "none";
    if (ratingButtons) ratingButtons.classList.add("hidden");
    return;
  }

  showingAnswer = false;

  if (cardTextEl) cardTextEl.textContent = card.dutch;
  if (answerBoxEl) {
    answerBoxEl.textContent = card.english;
    answerBoxEl.classList.add("hidden");
  }
  if (showBtn) showBtn.style.display = "inline-block";
  if (ratingButtons) ratingButtons.classList.add("hidden");
}

function startReviewSession() {
  buildReviewQueue();

  if (reviewQueue.length === 0) {
    showToast("No cards available to review.");
    openScreen("menu");
    return;
  }

  currentIndex = 0;
  renderReviewScreen();
}

function showAnswer() {
  const card = currentCard();
  if (!card) return;

  const answerBoxEl = document.getElementById("answer-box");
  const showBtn = document.getElementById("show-answer-btn");
  const ratingButtons = document.getElementById("rating-buttons");

  showingAnswer = true;

  if (answerBoxEl) answerBoxEl.classList.remove("hidden");
  if (showBtn) showBtn.style.display = "none";
  if (ratingButtons) ratingButtons.classList.remove("hidden");
}

// ============================================================
// Handle rating + SRS
// ============================================================

async function handleRating(rating) {
  const card = currentCard();
  if (!card) return;

  console.log("Rating", rating, "for card id", card.id);

  try {
    const updated = await applySrsAndPersist(card, rating);

    // Update local allCards
    const idx = allCards.findIndex((c) => c.id === card.id);
    if (idx !== -1) {
      allCards[idx] = { ...allCards[idx], ...updated };
    }

    // Move to next card
    currentIndex += 1;
    if (currentIndex >= reviewQueue.length) {
      showToast("Session complete.");
      openScreen("menu");
      return;
    }

    renderReviewScreen();
  } catch (err) {
    console.error("handleRating error:", err);
    showToast("Error updating card: " + err.message);
  }
}

async function applySrsAndPersist(card, rating) {
  const today = todayStr();

  let type = card.card_type || "new";
  let interval = card.interval_days || 0;
  let ease = Number(card.ease || SRS.easeDefault);
  let reps = card.reps || 0;
  let lapses = card.lapses || 0;
  let firstSeen = card.first_seen || null;

  reps += 1;

  // Helper to fuzz interval slightly
  function fuzzInterval(days) {
    if (days <= 1) return days;
    const fuzz = Math.floor(days * 0.05);
    const low = days - fuzz;
    const high = days + fuzz;
    return Math.max(1, Math.floor(Math.random() * (high - low + 1)) + low);
  }

  // ----------------------
  // NEW cards
  // ----------------------
  if (type === "new") {
    if (!firstSeen) firstSeen = today;
    const steps = SRS.learningSteps;

    if (rating === "again") {
      interval = 0.04; // ~1 hour
      type = "learning";
    } else if (rating === "hard") {
      interval = 0.08; // ~2 hours
      type = "learning";
    } else if (rating === "good") {
      if (steps.length === 1) {
        interval = SRS.graduatingInterval;
        type = "review";
      } else {
        interval = 1; // 1 day
        type = "learning";
      }
    } else if (rating === "easy") {
      interval = SRS.easyGraduatingInterval;
      ease += SRS.easeEasyDelta;
      type = "review";
    }
  }

  // ----------------------
  // LEARNING cards
  // ----------------------
  else if (type === "learning") {
    if (rating === "again") {
      interval = 0.04;
    } else if (rating === "hard") {
      interval = 0.08;
    } else if (rating === "good") {
      interval = SRS.graduatingInterval;
      type = "review";
    } else if (rating === "easy") {
      interval = SRS.easyGraduatingInterval;
      ease += SRS.easeEasyDelta;
      type = "review";
    }
  }

  // ----------------------
  // REVIEW cards
  // ----------------------
  else if (type === "review") {
    if (rating === "again") {
      lapses += 1;
      ease = Math.max(SRS.easeMin, ease + SRS.easeAgainDelta);
      interval = 1;
      type = "learning";
    } else if (rating === "hard") {
      ease = Math.max(SRS.easeMin, ease + SRS.easeHardDelta);
      interval = Math.max(1, Math.round(interval * 1.2));
    } else if (rating === "good") {
      interval = Math.max(
        1,
        Math.round(interval * ease * SRS.intervalModifier)
      );
    } else if (rating === "easy") {
      ease += SRS.easeEasyDelta;
      interval = Math.max(
        1,
        Math.round(interval * ease * SRS.easyBonus * SRS.intervalModifier)
      );
    }
  }

  const daysInterval = Math.max(1, Math.round(interval));
  const dueDate = addDays(today, fuzzInterval(daysInterval));

  const updatePayload = {
    card_type: type,
    interval_days: daysInterval,
    ease,
    reps,
    lapses,
    first_seen: firstSeen,
    last_reviewed: today,
    due_date: dueDate
  };

  const { data, error } = await supabase
    .from("cards")
    .update(updatePayload)
    .eq("id", card.id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

// ============================================================
// Add new card
// ============================================================

async function addNewCard() {
  const dutchInput = document.getElementById("new-dutch");
  const englishInput = document.getElementById("new-english");

  const dutch = dutchInput ? dutchInput.value.trim() : "";
  const english = englishInput ? englishInput.value.trim() : "";

  if (!dutch || !english) {
    showToast("Please fill in both Dutch and English.");
    return;
  }

  const payload = {
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
  };

  const { error } = await supabase.from("cards").insert(payload);

  if (error) {
    console.error("addNewCard error:", error);
    showToast("Error adding card: " + error.message);
    return;
  }

  if (dutchInput) dutchInput.value = "";
  if (englishInput) englishInput.value = "";

  showToast("New card added.");
  await loadCards();
}

// ============================================================
// Reset learning data (JS ONLY, no SQL function)
// ============================================================

async function resetLearningData() {
  console.log("RESET FUNCTION FIRED");

  try {
    // 1) Fetch all card IDs
    const { data: cards, error: fetchErr } = await supabase
      .from("cards")
      .select("id");

    console.log("FETCH RESULT:", cards, fetchErr);

    if (fetchErr) {
      showToast("Fetch error: " + fetchErr.message);
      return;
    }

    if (!cards || cards.length === 0) {
      showToast("No cards found to reset.");
      return;
    }

    const ids = cards.map((c) => c.id);
    console.log("UPDATING IDS:", ids);

    // 2) Update all those IDs
    const { data: updateData, error: updateErr } = await supabase
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
      .in("id", ids)
      .select();

    console.log("UPDATE RESULT:", updateData, updateErr);

    if (updateErr) {
      showToast("Update error: " + updateErr.message);
      return;
    }

    showToast("All learning data has been reset.");

    await loadCards();

    // If we are on review screen, rebuild queue
    const reviewScreen = document.getElementById("review-screen");
    if (reviewScreen && reviewScreen.style.display === "block") {
      startReviewSession();
    }

  } catch (err) {
    console.error("RESET EXCEPTION:", err);
    showToast("Unexpected error: " + err.message);
  }
}

// ============================================================
// Initialization
// ============================================================

async function init() {
  console.log("App init");

  // Ensure menu is visible by default
  openScreen("menu");

  // Attach review-screen UI listeners
  const showBtn = document.getElementById("show-answer-btn");
  if (showBtn) {
    showBtn.addEventListener("click", showAnswer);
  }

  // Rating buttons are wired via inline onclick in HTML: handleRating('good') etc.

  await loadCards();
}

window.addEventListener("load", init);

// Expose functions to HTML (onclick)
window.openScreen = openScreen;
window.showAnswer = showAnswer;
window.handleRating = handleRating;
window.addNewCard = addNewCard;
window.resetLearningData = resetLearningData;
