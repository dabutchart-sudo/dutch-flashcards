import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_VERSION } from "./config.js";

const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allCards = [];
let reviewQueue = [];
let currentIndex = 0;

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

const MAX_NEW_KEY = "maxNewCardsPerDay";

function getMaxNewCardsPerDay() {
  return parseInt(localStorage.getItem(MAX_NEW_KEY) || "10", 10);
}
function setMaxNewCardsPerDay(v) {
  localStorage.setItem(MAX_NEW_KEY, String(v));
}

window.openScreen = function (name) {
  document.querySelectorAll(".screen").forEach(s => {
    s.classList.add("hidden");
    s.classList.remove("visible");
  });

  const screen = document.getElementById(`${name}-screen`);
  screen.classList.add("visible");
  screen.classList.remove("hidden");
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

    else if (c.card_type === "new")
      newCards.push(c);
  }

  const introducedToday = allCards.filter(c => c.first_seen === today).length;
  const remaining = Math.max(0, maxNew - introducedToday);

  const shuffle = a => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  };

  shuffle(due);
  shuffle(newCards);

  reviewQueue = [...due, ...newCards.slice(0, remaining)];
}

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

  // ------------------------------
  // FLASH-PROOF LOGIC
  // ------------------------------
  box.classList.remove("flip");
  void box.offsetWidth;

  // Set Dutch only
  frontText.textContent = card.dutch;

  // Leave English EMPTY until flip
  backText.textContent = "";

  ratingButtons.classList.add("hidden");
  updateCounter();
}

window.startReviewSession = function () {
  buildReviewQueue();

  if (reviewQueue.length === 0) {
    showToast("No cards available to review.");
    return;
  }

  currentIndex = 0;
  renderCurrentCard();
  openScreen("review");
};

document.getElementById("card-box").addEventListener("click", () => {
  if (!reviewQueue[currentIndex]) return;

  const box = document.getElementById("card-box");
  const backText = document.getElementById("card-back-text");
  const ratingButtons = document.getElementById("rating-buttons");

  // Fill English ONLY AFTER flip is requested
  backText.textContent = reviewQueue[currentIndex].english;

  box.classList.toggle("flip");

  if (box.classList.contains("flip")) {
    setTimeout(() => ratingButtons.classList.remove("hidden"), 300);
  } else {
    ratingButtons.classList.add("hidden");
  }
});

window.handleRating = async function (rating) {
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

  await supabaseClient.from("cards").update(updatePayload).eq("id", card.id);

  currentIndex++;

  if (currentIndex >= reviewQueue.length) {
    showToast("Session complete");
    openScreen("menu");
    return;
  }

  renderCurrentCard();
};

window.openWordReview = function () {
  const tbody = document.getElementById("word-tbody");
  tbody.innerHTML = "";
  allCards.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.dutch}</td>
      <td>${r.english}</td>
      <td>${r.last_reviewed ?? "-"}</td>
      <td>${r.due_date ?? "-"}</td>`;
    tbody.appendChild(tr);
  });
  openScreen("wordreview");
};

window.resetLearningData = async function () {
  const { data: rows } = await supabaseClient.from("cards").select("id");
  const ids = rows.map(r => r.id);

  await supabaseClient
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

  showToast("All learning data reset");
  await loadCards();
};

window.addEventListener("load", async () => {
  document.getElementById("app-version").textContent = "Version: " + APP_VERSION;

  const sel = document.getElementById("max-new-cards-select");
  sel.value = getMaxNewCardsPerDay();
  sel.addEventListener("change", () => {
    setMaxNewCardsPerDay(parseInt(sel.value, 10));
    showToast("Max new cards updated");
  });

  await loadCards();
  openScreen("menu");
});
