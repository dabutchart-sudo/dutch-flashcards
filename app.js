import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_VERSION } from "./config.js";

const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allCards = [];
let reviewQueue = [];
let currentIndex = 0;

// ----------------- Utility -----------------
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
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

// ----------------- Settings -----------------
const MAX_NEW_KEY = "maxNewCardsPerDay";

function getMaxNewCardsPerDay() {
  return parseInt(localStorage.getItem(MAX_NEW_KEY) || "10", 10);
}

function setMaxNewCardsPerDay(val) {
  localStorage.setItem(MAX_NEW_KEY, String(val));
}

// ----------------- Navigation -----------------
window.openScreen = function (name) {
  document.querySelectorAll(".screen").forEach((s) => {
    s.classList.remove("visible");
    s.classList.add("hidden");
  });

  const screen = document.getElementById(`${name}-screen`);
  if (screen) {
    screen.classList.add("visible");
    screen.classList.remove("hidden");
  }
};

// ----------------- Summary (Today & Tomorrow) -----------------
function updateSummary() {
  const panel = document.getElementById("summary-panel");
  if (!panel) return;

  const today = todayStr();
  const tomorrow = addDays(today, 1);
  const maxNew = getMaxNewCardsPerDay();

  let dueReviewToday = 0;
  let dueReviewTomorrow = 0;
  let trulyNew = 0;
  let introducedToday = 0;

  for (const c of allCards) {
    if (c.suspended) continue;

    const isReview = c.card_type !== "new";

    if (isReview && c.due_date) {
      if (c.due_date <= today) dueReviewToday++;
      if (c.due_date === tomorrow) dueReviewTomorrow++;
    }

    const isNew = c.card_type === "new" &&
      (c.first_seen === null || c.first_seen === undefined);

    if (isNew) trulyNew++;

    if (c.first_seen === today) introducedToday++;
  }

  let newToday = Math.max(0, Math.min(maxNew - introducedToday, trulyNew));

  // Tomorrow = Option B → min(maxNew, all new cards)
  let newTomorrow = Math.min(maxNew, trulyNew);

  panel.innerHTML = `
    <h2>Study Summary</h2>
    <div class="summary-row"><strong>Today:</strong> ${dueReviewToday} review, ${newToday} new</div>
    <div class="summary-row"><strong>Tomorrow:</strong> ${dueReviewTomorrow} review, ${newTomorrow} new</div>
  `;
}

// ----------------- Data Loading -----------------
async function loadCards() {
  const { data, error } = await supabaseClient
    .from("cards")
    .select("*")
    .order("id");

  if (error) {
    showToast("Error loading cards");
    console.error(error);
    allCards = [];
  } else {
    allCards = data || [];
  }

  updateSummary();
}

// ----------------- Build Review Queue -----------------
function buildReviewQueue() {
  const today = todayStr();
  const maxNew = getMaxNewCardsPerDay();

  const due = [];
  const newCards = [];

  for (const c of allCards) {
    if (c.suspended) continue;

    if (c.card_type !== "new" && c.due_date && c.due_date <= today) {
      due.push(c);
      continue;
    }

    if (c.card_type === "new" && (c.first_seen === null || c.first_seen === undefined)) {
      newCards.push(c);
    }
  }

  const introducedToday = allCards.filter((c) => c.first_seen === today).length;

  let remainingNew = maxNew - introducedToday;
  if (remainingNew < 0) remainingNew = 0;

  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  };

  shuffle(due);
  shuffle(newCards);

  reviewQueue = [...due, ...newCards.slice(0, remainingNew)];
}

// ----------------- Rendering -----------------
function updateCounter() {
  const el = document.getElementById("review-counter");
  if (!el) return;

  el.textContent = reviewQueue.length
    ? `Card ${currentIndex + 1} of ${reviewQueue.length}`
    : "No cards";
}

function renderCardStatus(card) {
  const el = document.getElementById("card-status");
  if (!el || !card) return;

  if (card.card_type === "new") {
    el.textContent = "NEW";
    el.style.color = "#ff8800";
  } else if (card.card_type === "learning") {
    el.textContent = "LEARNING";
    el.style.color = "#5bc0de";
  } else {
    el.textContent = "REVIEW";
    el.style.color = "#5cb85c";
  }
}

function renderCurrentCard() {
  const card = reviewQueue[currentIndex];

  const frontText = document.getElementById("card-front-text");
  const backText = document.getElementById("card-back-text");
  const box = document.getElementById("card-box");
  const ratingButtons = document.getElementById("rating-buttons");

  if (!card) {
    frontText.textContent = "No cards to review.";
    backText.textContent = "";
    ratingButtons.classList.add("hidden");
    updateCounter();
    return;
  }

  box.classList.remove("flip");
  void box.offsetWidth;

  frontText.textContent = card.dutch;
  backText.textContent = "";

  ratingButtons.classList.add("hidden");
  renderCardStatus(card);
  updateCounter();
}

// ----------------- Start Review Session -----------------
window.startReviewSession = async function () {
  await loadCards();
  buildReviewQueue();

  if (!reviewQueue.length) {
    showToast("No cards available");
    return;
  }

  currentIndex = 0;
  renderCurrentCard();
  openScreen("review");
};

// ----------------- Flip Card -----------------
document.getElementById("card-box").addEventListener("click", () => {
  const card = reviewQueue[currentIndex];
  if (!card) return;

  const backText = document.getElementById("card-back-text");
  const box = document.getElementById("card-box");
  const ratingButtons = document.getElementById("rating-buttons");

  backText.textContent = card.english;
  box.classList.toggle("flip");

  if (box.classList.contains("flip")) {
    setTimeout(() => ratingButtons.classList.remove("hidden"), 300);
  } else {
    ratingButtons.classList.add("hidden");
  }
});

// ----------------- Handle Rating -----------------
window.handleRating = async function (rating) {
  const card = reviewQueue[currentIndex];
  if (!card) return;

  const today = todayStr();

  let { card_type, interval_days, ease, reps, lapses } = card;
  card_type = card_type || "new";
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

  } else if (card_type === "learning") {
    if (rating === "again") interval_days = 1;
    else { interval_days = 3; card_type = "review"; }

  } else {
    if (rating === "again") {
      lapses++;
      ease = Math.max(1.3, ease - 0.2);
      interval_days = 1;
      card_type = "learning";
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
    first_seen: card.first_seen || today,
    last_reviewed: today,
    due_date,
    suspended: false,
  };

  const { error } = await supabaseClient
    .from("cards")
    .update(updatePayload)
    .eq("id", card.id);

  if (error) {
    showToast("Save failed");
    console.error(error);
    return;
  }

  currentIndex++;

  if (currentIndex >= reviewQueue.length) {
    showToast("Session complete");
    await loadCards();
    openScreen("menu");
    return;
  }

  renderCurrentCard();
};

// ----------------- Word Review -----------------
window.openWordReview = function () {
  const tbody = document.getElementById("word-tbody");
  tbody.innerHTML = "";

  allCards.forEach((r) => {
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

// ----------------- Reset Learning -----------------
window.resetLearningData = async function () {
  const { data } = await supabaseClient.from("cards").select("id");
  const ids = (data || []).map((r) => r.id);

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
    showToast("Reset failed");
    console.error(error);
    return;
  }

  showToast("All learning reset");
  await loadCards();
};

// ----------------- Init -----------------
window.addEventListener("load", async () => {
  const ver = document.getElementById("app-version");
  if (ver) ver.textContent = "Version: " + APP_VERSION;

  const sel = document.getElementById("max-new-cards-select");
  sel.value = String(getMaxNewCardsPerDay());
  sel.addEventListener("change", () => {
    const v = parseInt(sel.value, 10);
    setMaxNewCardsPerDay(v);
    showToast("Updated");
    updateSummary();
  });

  await loadCards();
  openScreen("menu");
});
