import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_VERSION } from "./config.js";

const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allCards = [];
let reviewQueue = [];
let currentIndex = 0;

// NEW: Track new cards introduced today in the session
let introducedTodaySession = 0;

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function addDays(d, n) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().split("T")[0];
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

const MAX_NEW_KEY = "maxNewCardsPerDay";
function getMaxNewCardsPerDay() {
  return parseInt(localStorage.getItem(MAX_NEW_KEY) || "10", 10);
}
function setMaxNewCardsPerDay(v) {
  localStorage.setItem(MAX_NEW_KEY, String(v));
}

window.openScreen = function(name) {
  document.querySelectorAll(".screen").forEach(s=>{
    s.classList.add("hidden");
    s.classList.remove("visible");
  });
  const scr = document.getElementById(`${name}-screen`);
  scr.classList.add("visible");
  scr.classList.remove("hidden");
};

async function loadCards() {
  const { data } = await supabaseClient.from("cards").select("*").order("id");
  allCards = data || [];
}

function buildReviewQueue() {
  const today = todayStr();
  const maxNew = getMaxNewCardsPerDay();

  const due = [];
  const newCards = [];

  for (const c of allCards) {
    if (c.suspended) continue;

    if (c.card_type !== "new" && c.due_date && c.due_date <= today)
      due.push(c);

    if (c.card_type === "new")
      newCards.push(c);
  }

  const previouslyIntroducedToday =
    allCards.filter(c => c.first_seen === today).length;

  const remaining =
    maxNew - (previouslyIntroducedToday + introducedTodaySession);

  const allowedNew = remaining > 0 ? remaining : 0;

  // Shuffle
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i+1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  };

  shuffle(due);
  shuffle(newCards);

  reviewQueue = [...due, ...newCards.slice(0, allowedNew)];
}

function updateCounter() {
  const c = document.getElementById("review-counter");
  if (reviewQueue.length === 0) c.textContent = "No cards";
  else c.textContent = `Card ${currentIndex+1} of ${reviewQueue.length}`;
}

function renderCurrentCard() {
  const card = reviewQueue[currentIndex];
  const frontText = document.getElementById("card-front-text");
  const backText  = document.getElementById("card-back-text");
  const box       = document.getElementById("card-box");
  const rating    = document.getElementById("rating-buttons");

  if (!card) {
    frontText.textContent = "No cards to review.";
    backText.textContent = "";
    rating.classList.add("hidden");
    updateCounter();
    return;
  }

  // Anti-flash: unflip FIRST, clear back text
  box.classList.remove("flip");
  void box.offsetWidth;

  frontText.textContent = card.dutch;
  backText.textContent  = ""; // ← do not show English yet

  rating.classList.add("hidden");
  updateCounter();
}

window.startReviewSession = function() {
  introducedTodaySession = 0; // reset session counter
  buildReviewQueue();

  if (reviewQueue.length === 0) {
    showToast("No cards available to review.");
    return;
  }

  currentIndex = 0;
  renderCurrentCard();
  openScreen("review");
};

// Flip card
document.getElementById("card-box").addEventListener("click", () => {
  if (!reviewQueue[currentIndex]) return;

  const box = document.getElementById("card-box");
  const rating = document.getElementById("rating-buttons");
  const backText = document.getElementById("card-back-text");

  // Insert English ONLY at flip time
  backText.textContent = reviewQueue[currentIndex].english;

  box.classList.toggle("flip");

  if (box.classList.contains("flip")) {
    setTimeout(() => rating.classList.remove("hidden"), 300);
  } else {
    rating.classList.add("hidden");
  }
});

window.handleRating = async function(rating) {
  const card = reviewQueue[currentIndex];
  if (!card) return;

  const today = todayStr();

  let { card_type, interval_days, ease, reps, lapses } = card;
  interval_days = interval_days || 0;
  ease = Number(ease || 2.5);
  reps = reps || 0;
  lapses = lapses || 0;

  reps++;

  const isTrulyNew = !card.first_seen;

  if (card_type === "new") {
    if (rating === "again") interval_days = 1;
    else if (rating === "hard") interval_days = 1;
    else if (rating === "good") interval_days = 3;
    else if (rating === "easy") { interval_days = 4; ease += 0.15; }

    card_type = interval_days > 1 ? "review" : "learning";
  }
  else if (card_type === "learning") {
    if (rating === "again") interval_days = 1;
    else { interval_days = 3; card_type = "review"; }
  }
  else {
    if (rating === "again") {
      lapses++; ease = Math.max(1.3, ease - 0.2);
      interval_days = 1;
      card_type = "learning";
    }
    else if (rating === "hard") {
      ease = Math.max(1.3, ease - 0.15);
      interval_days = Math.round(interval_days * 1.2);
    }
    else if (rating === "good") {
      interval_days = Math.round(interval_days * ease);
    }
    else if (rating === "easy") {
      ease += 0.15;
      interval_days = Math.round(interval_days * ease * 1.3);
    }
  }

  const due_date = addDays(today, Math.max(1, interval_days));
  const first_seen = card.first_seen || today;

  // NEW: if this card is being introduced today → count it
  if (isTrulyNew) {
    introducedTodaySession++;
  }

  await supabaseClient.from("cards").update({
    card_type,
    interval_days,
    ease,
    reps,
    lapses,
    first_seen,
    last_reviewed: today,
    due_date,
    suspended: false
  }).eq("id", card.id);

  currentIndex++;
  if (currentIndex >= reviewQueue.length) {
    showToast("Session complete");
    openScreen("menu");
    return;
  }

  renderCurrentCard();
};

window.openWordReview = function() {
  const tbody = document.getElementById("word-tbody");
  tbody.innerHTML = "";
  allCards.forEach(r=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.dutch}</td>
      <td>${r.english}</td>
      <td>${r.last_reviewed ?? "-"}</td>
      <td>${r.due_date ?? "-"}</td>
    `;
    tbody.appendChild(tr);
  });
  openScreen("wordreview");
};

window.resetLearningData = async function() {
  const { data } = await supabaseClient.from("cards").select("id");
  const ids = data.map(r => r.id);

  await supabaseClient.from("cards").update({
    card_type: "new",
    interval_days: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
    first_seen: null,
    last_reviewed: null,
    due_date: null,
    suspended: false
  }).in("id", ids);

  showToast("All learning data reset");
  await loadCards();
};

window.addEventListener("load", async () => {
  document.getElementById("app-version").textContent =
    "Version: " + APP_VERSION;

  const sel = document.getElementById("max-new-cards-select");
  sel.value = getMaxNewCardsPerDay();
  sel.addEventListener("change", ()=>{
    setMaxNewCardsPerDay(parseInt(sel.value,10));
    showToast("Max new cards updated");
  });

  await loadCards();
  openScreen("menu");
});
