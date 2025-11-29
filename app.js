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
  return new Date().toISOString().split("T")[0];
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
// Settings: Max New Cards Per Day
// ============================================================

const MAX_NEW_KEY = "maxNewCardsPerDay";

function getMaxNewCardsPerDay() {
  const stored = localStorage.getItem(MAX_NEW_KEY);
  const num = stored ? parseInt(stored, 10) : NaN;
  if (Number.isNaN(num)) return 10; // default 10
  return num;
}

function setMaxNewCardsPerDay(val) {
  localStorage.setItem(MAX_NEW_KEY, String(val));
}

// ============================================================
// Navigation
// ============================================================

function openScreen(name) {
  document.querySelectorAll(".screen").forEach(s => {
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
// Review Session (with daily new-card limit)
// ============================================================

function buildReviewQueue() {
  const today = todayStr();
  const maxNew = getMaxNewCardsPerDay();

  const due = [];
  const newCandidates = [];

  for (const c of allCards) {
    if (c.suspended) continue;

    if (c.card_type !== "new" && c.due_date && c.due_date <= today) {
      due.push(c);
    } else if (c.card_type === "new") {
      newCandidates.push(c);
    }
  }

  // How many new cards introduced today?
  const introducedToday = allCards.filter(
    c => c.first_seen === today
  ).length;

  const remainingNewToday = Math.max(0, maxNew - introducedToday);

  const shuffle = arr => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };

  shuffle(due);
  shuffle(newCandidates);

  const selectedNew = newCandidates.slice(0, remainingNewToday);

  reviewQueue = [...due, ...selectedNew];
}

function renderCurrentCard() {
  const card = reviewQueue[currentIndex];

  const front = document.getElementById("card-front");
  const back = document.getElementById("card-back");
  const ratingButtons = document.getElementById("rating-buttons");
  const container = document.getElementById("card-box");

  if (!card) {
    front.textContent = "No cards to review.";
    back.textContent = "";
    ratingButtons.classList.add("hidden");
    return;
  }

  container.classList.remove("flip");

  front.textContent = card.dutch;
  back.textContent = card.english;

  ratingButtons.classList.add("hidden");
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

// Flip card on click
document.getElementById("card-box").addEventListener("click", () => {
  const box = document.getElementById("card-box");
  const ratingButtons = document.getElementById("rating-buttons");

  if (!reviewQueue[currentIndex]) return;

  box.classList.toggle("flip");

  if (box.classList.contains("flip")) {
    setTimeout(() => {
      ratingButtons.classList.remove("hidden");
    }, 300);
  } else {
    ratingButtons.classList.add("hidden");
  }
});

// ============================================================
// Handle Rating & SRS Updating
// ============================================================

window.handleRating = async function (rating) {
  const card = reviewQueue[currentIndex];
  if (!card) return;

  const today = todayStr();
  let { card_type, interval_days, ease, reps, lapses } = card;

  ease = Number(ease ?? 2.5);
  reps = reps ?? 0;
  lapses = lapses ?? 0;
  interval_days = interval_days ?? 0;

  reps++;

  if (card_type === "new") {
    if (rating === "again") interval_days = 1;
    else if (rating === "hard") interval_days = 1;
    else if (rating === "good") interval_days = 3;
    else if (rating === "easy") {
      interval_days = 4;
      ease += 0.15;
    }
    card_type = interval_days > 1 ? "review" : "learning";
  } else if (card_type === "learning") {
    if (rating === "again") {
      interval_days = 1;
    } else {
      interval_days = 3;
      card_type = "review";
    }
  } else {
    if (rating === "again") {
      lapses++;
      ease = Math.max(1.3, ease - 0.2);
      interval_days = 1;
      card_type = "learning";
    } else if (rating === "hard") {
      ease = Math.max(1.3, ease - 0.15);
      interval_days = Math.max(1, Math.round(interval_days * 1.2));
    } else if (rating === "good") {
      interval_days = Math.max(1, Math.round(interval_days * ease));
    } else if (rating === "easy") {
      ease += 0.15;
      interval_days = Math.max(1, Math.round(interval_days * ease * 1.3));
    }
  }

  const dueDate = addDays(today, interval_days);

  const { error } = await supabaseClient
    .from("cards")
    .update({
      card_type,
      interval_days,
      ease,
      reps,
      lapses,
      last_reviewed: today,
      due_date: dueDate,
      first_seen: card.first_seen || today, // first-seen marking for daily limit
    })
    .eq("id", card.id);

  if (error) {
    console.error(error);
    showToast("Error saving review");
    return;
  }

  currentIndex++;

  if (currentIndex >= reviewQueue.length) {
    showToast("Session complete");
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

document.addEventListener("click", e => {
  if (e.target.tagName !== "TH") return;

  const col = e.target.dataset.col;
  if (!col) return;

  if (currentSortCol === col) sortAsc = !sortAsc;
  else { currentSortCol = col; sortAsc = true; }

  const sorted = [...allCards].sort((a, b) => {
    const A = a[col] || "";
    const B = b[col] || "";
    return sortAsc ? A.localeCompare(B) : B.localeCompare(A);
  });

  buildWordTable(sorted);
});

// ============================================================
// RESET LEARNING
// ============================================================

window.resetLearningData = async function () {
  const { data: cards, error: fetchErr } =
    await supabaseClient.from("cards").select("id");

  if (fetchErr || !cards) {
    showToast("Error fetching cards");
    return;
  }

  const ids = cards.map(c => c.id);

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
    return;
  }

  showToast("All learning data reset");
  await loadCards();
};

// ============================================================
// Init
// ============================================================

async function init() {
  const version = document.getElementById("app-version");
  if (version) version.textContent = "Version: " + APP_VERSION;

  // Set up settings dropdown
  const maxNewSelect = document.getElementById("max-new-cards-select");
  if (maxNewSelect) {
    const current = getMaxNewCardsPerDay();
    maxNewSelect.value = String(current);

    maxNewSelect.addEventListener("change", () => {
      const val = parseInt(maxNewSelect.value, 10);
      if (!Number.isNaN(val)) {
        setMaxNewCardsPerDay(val);
        showToast("Max new cards per day set to " + val);
      }
    });
  }

  await loadCards();
  openScreen("menu");
}

window.addEventListener("load", init);
