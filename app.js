import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_VERSION } from "./config.js";

const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allCards = [];
let reviewQueue = [];
let currentIndex = 0;

// ---------- UTIL ----------
function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

// ---------- SETTINGS ----------
const MAX_NEW_KEY = "maxNewCardsPerDay";
function getMaxNewCardsPerDay() {
  return parseInt(localStorage.getItem(MAX_NEW_KEY) || "10", 10);
}
function setMaxNewCardsPerDay(v) {
  localStorage.setItem(MAX_NEW_KEY, String(v));
}

// ---------- SCREENS ----------
window.openScreen = function(name) {
  document.querySelectorAll(".screen").forEach(s => {
    s.classList.remove("visible"); s.classList.add("hidden");
  });
  const tgt = document.getElementById(`${name}-screen`);
  if (tgt) { tgt.classList.add("visible"); tgt.classList.remove("hidden"); }
};

// ---------- LOAD CARDS ----------
async function loadCards() {
  const { data, error } = await supabaseClient.from("cards").select("*").order("id");
  if (error) { console.error(error); showToast("Error loading cards"); }
  allCards = data || [];
}

// ---------- QUEUE ----------
function buildReviewQueue() {
  const today = todayStr();
  const maxNew = getMaxNewCardsPerDay();

  const due = [];
  const newCards = [];

  for (const c of allCards) {
    if (c.suspended) continue;
    if (c.card_type !== "new" && c.due_date && c.due_date <= today) due.push(c);
    else if (c.card_type === "new") newCards.push(c);
  }

  const introducedToday = allCards.filter(c => c.first_seen === today).length;
  const remaining = Math.max(0, maxNew - introducedToday);

  const shuffle = arr => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };

  shuffle(due);
  shuffle(newCards);

  reviewQueue = [...due, ...newCards.slice(0, remaining)];
}

// ---------- RENDER ----------
function updateCounter() {
  const c = document.getElementById("review-counter");
  if (reviewQueue.length === 0) c.textContent = "No cards";
  else c.textContent = `Card ${currentIndex + 1} of ${reviewQueue.length}`;
}

function renderCurrentCard() {
  const card = reviewQueue[currentIndex];
  const box = document.getElementById("card-box");

  const frontText = document.getElementById("card-front-text");
  const backText  = document.getElementById("card-back-text");
  const ratingButtons = document.getElementById("rating-buttons");

  if (!card) {
    frontText.textContent = "No cards to review.";
    backText.textContent = "";
    ratingButtons.classList.add("hidden");
    updateCounter();
    return;
  }

  // IMPORTANT: reset flip BEFORE updating content
  box.classList.remove("flip");
  void box.offsetWidth;

  frontText.textContent = card.dutch;
  backText.textContent  = card.english;

  ratingButtons.classList.add("hidden");
  updateCounter();
}

window.startReviewSession = function() {
  buildReviewQueue();
  if (reviewQueue.length === 0) { showToast("No cards available to review."); return; }
  currentIndex = 0;
  renderCurrentCard();
  openScreen("review");
};

// ---------- FLIP ----------
document.getElementById("card-box").addEventListener("click", () => {
  if (!reviewQueue[currentIndex]) return;
  const box = document.getElementById("card-box");
  const ratingButtons = document.getElementById("rating-buttons");

  box.classList.toggle("flip");

  if (box.classList.contains("flip")) {
    setTimeout(() => ratingButtons.classList.remove("hidden"), 300);
  } else {
    ratingButtons.classList.add("hidden");
  }
});

// ---------- HANDLE RATING ----------
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
      interval_days = 1; card_type = "learning";
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

  const updatePayload = {
    card_type,
    interval_days,
    ease,
    reps,
    lapses,
    last_reviewed: today,
    due_date,
    first_seen: card.first_seen || today,
    suspended: false
  };

  const { error } = await supabaseClient
    .from("cards")
    .update(updatePayload)
    .eq("id", card.id);

  if (error) { console.error(error); showToast("Failed to save review"); return; }

  currentIndex++;
  if (currentIndex >= reviewQueue.length) {
    showToast("Session complete");
    openScreen("menu");
    return;
  }

  renderCurrentCard();
};

// ---------- WORD REVIEW ----------
window.openWordReview = function() {
  buildWordTable(allCards);
  openScreen("wordreview");
};

function buildWordTable(rows) {
  const tbody = document.getElementById("word-tbody");
  tbody.innerHTML = "";
  rows.forEach(r => {
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

// ---------- RESET ----------
window.resetLearningData = async function() {
  const { data: rows } = await supabaseClient.from("cards").select("id");
  const ids = rows.map(r => r.id);

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
      suspended: false
    })
    .in("id", ids);

  if (error) { showToast("Reset failed"); return; }

  showToast("All learning data reset");
  await loadCards();
};

// ---------- INIT ----------
window.addEventListener("load", async () => {
  document.getElementById("app-version").textContent = "Version: " + APP_VERSION;

  const sel = document.getElementById("max-new-cards-select");
  sel.value = getMaxNewCardsPerDay();
  sel.addEventListener("change", () => {
    setMaxNewCardsPerDay(parseInt(sel.value, 10));
    showToast("Max new cards set");
  });

  await loadCards();
  openScreen("menu");
});
