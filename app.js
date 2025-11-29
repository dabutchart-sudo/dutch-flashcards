// app.js
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// Supabase v2 CDN global
const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =============== Global State ==================

let allCards = [];
let reviewQueue = [];
let currentIndex = 0;

// =============== Utilities =====================

function todayStr() {
  const d = new Date();
  return d.toISOString().split("T")[0];
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function showToast(message, duration = 2500) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
    toast.classList.add("hidden");
  }, duration);
}

// =============== Screen Navigation =============

function openScreen(name) {
  const screens = document.querySelectorAll(".screen");
  screens.forEach((s) => {
    s.classList.remove("visible");
    s.classList.add("hidden");
  });

  const screen = document.getElementById(`${name}-screen`);
  if (screen) {
    screen.classList.remove("hidden");
    screen.classList.add("visible");
  }
}

window.openScreen = openScreen;

// =============== Load Cards =====================

async function loadCards() {
  const { data, error } = await supabaseClient
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
}

// =============== Review Session =================

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

  // Shuffle
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
  const showAnswerBtn = document.getElementById("show-answer-btn");
  const ratingButtons = document.getElementById("rating-buttons");

  if (!card) {
    cardText.textContent = "No cards to review.";
    answerBox.classList.add("hidden");
    ratingButtons.classList.add("hidden");
    showAnswerBtn.style.display = "none";
    return;
  }

  cardText.textContent = card.dutch;
  answerBox.textContent = card.english;
  answerBox.classList.add("hidden");
  ratingButtons.classList.add("hidden");
  showAnswerBtn.style.display = "inline-block";
}

function startReviewSession() {
  buildReviewQueue();

  if (reviewQueue.length === 0) {
    showToast("No cards available to review.");
    openScreen("menu");
    return;
  }

  currentIndex = 0;
  renderCurrentCard();
  openScreen("review");
}

// =============== Show Answer ====================

function showAnswer() {
  const answerBox = document.getElementById("answer-box");
  const showAnswerBtn = document.getElementById("show-answer-btn");
  const ratingButtons = document.getElementById("rating-buttons");

  answerBox.classList.remove("hidden");
  showAnswerBtn.style.display = "none";
  ratingButtons.classList.remove("hidden");
}

window.showAnswer = showAnswer;

// =============== Handle Rating ==================

async function handleRating(rating) {
  const card = reviewQueue[currentIndex];
  if (!card) return;

  const today = todayStr();
  let type = card.card_type || "new";
  let interval = card.interval_days || 0;
  let ease = Number(card.ease || 2.5);
  let reps = card.reps || 0;
  let lapses = card.lapses || 0;

  reps += 1;

  // Very simple SRS logic
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
  } else if (type === "learning") {
    if (rating === "again") {
      interval = 1;
    } else {
      interval = 3;
      type = "review";
    }
  } else { // review
    if (rating === "again") {
      lapses += 1;
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
      first_seen: card.first_seen || today
    })
    .eq("id", card.id);

  if (error) {
    console.error("handleRating update error:", error);
    showToast("Error saving review.");
    return;
  }

  currentIndex += 1;
  if (currentIndex >= reviewQueue.length) {
    showToast("Session complete.");
    openScreen("menu");
    return;
  }

  renderCurrentCard();
}

window.handleRating = handleRating;

// =============== Add New Card ===================

async function addNewCard() {
  const dutchInput = document.getElementById("new-dutch");
  const englishInput = document.getElementById("new-english");

  const dutch = dutchInput.value.trim();
  const english = englishInput.value.trim();

  if (!dutch || !english) {
    showToast("Please fill in both fields.");
    return;
  }

  const { error } = await supabaseClient.from("cards").insert({
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
    console.error("addNewCard error:", error);
    showToast("Error adding card.");
    return;
  }

  dutchInput.value = "";
  englishInput.value = "";
  showToast("Card added.");
  await loadCards();
}

window.addNewCard = addNewCard;

// =============== Reset Learning Data ============

async function resetLearningData() {
  console.log("RESET CALLED");

  const { data: cards, error: fetchErr } = await supabaseClient
    .from("cards")
    .select("id");

  if (fetchErr) {
    console.error("reset fetch error:", fetchErr);
    showToast("Error fetching cards.");
    return;
  }

  if (!cards || cards.length === 0) {
    showToast("No cards to reset.");
    return;
  }

  const ids = cards.map((c) => c.id);

  const { error: updateErr } = await supabaseClient
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
    console.error("reset update error:", updateErr);
    showToast("Reset failed.");
    return;
  }

  showToast("All learning data reset.");
  await loadCards();
}

window.resetLearningData = resetLearningData;

// =============== Init ===========================

async function init() {
  console.log("App init");
  const showBtn = document.getElementById("show-answer-btn");
  if (showBtn) {
    showBtn.addEventListener("click", showAnswer);
  }

  await loadCards();
  openScreen("menu");
}

window.addEventListener("load", init);
