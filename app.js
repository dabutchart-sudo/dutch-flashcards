import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_VERSION } from "./config.js";

const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allCards = [];
let reviewQueue = [];
let currentIndex = 0;

// Sorting
let wordSortColumn = null;
let wordSortAsc = true;

// -------------- Utility --------------
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

// -------------- TTS for Dutch side --------------
function speakDutch(text) {
  if (!window.speechSynthesis) {
    showToast("TTS not supported");
    return;
  }

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "nl-NL";

  const voices = speechSynthesis.getVoices();
  const dutchVoice = voices.find(v => v.lang === "nl-NL");

  if (dutchVoice) utter.voice = dutchVoice;

  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}

document.addEventListener("voiceschanged", () => {
  // Preload voices on Safari/iOS
});

// When TTS button pressed:
document.getElementById("tts-btn").addEventListener("click", (e) => {
  e.stopPropagation(); // prevent flipping card
  const card = reviewQueue[currentIndex];
  if (card) speakDutch(card.dutch);
});

// -------------- Settings --------------
const MAX_NEW_KEY = "maxNewCardsPerDay";

function getMaxNewCardsPerDay() {
  return parseInt(localStorage.getItem(MAX_NEW_KEY) || "10", 10);
}

function setMaxNewCardsPerDay(v) {
  localStorage.setItem(MAX_NEW_KEY, String(v));
}

// -------------- Navigation --------------
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

  if (name === "menu") updateSummary();
};

// -------------- Summary Panel --------------
function updateSummary() {
  const panel = document.getElementById("summary-panel");
  const today = todayStr();
  const tomorrow = addDays(today, 1);
  const maxNew = getMaxNewCardsPerDay();

  let dueToday = 0;
  let dueTomorrow = 0;
  let newCards = 0;
  let introducedToday = 0;

  for (const c of allCards) {
    if (c.suspended) continue;

    if (c.card_type !== "new" && c.due_date) {
      if (c.due_date <= today) dueToday++;
      if (c.due_date === tomorrow) dueTomorrow++;
    }

    if (c.card_type === "new" && !c.first_seen) newCards++;
    if (c.first_seen === today) introducedToday++;
  }

  const newToday = Math.max(0, Math.min(maxNew - introducedToday, newCards));
  const newTomorrow = Math.min(maxNew, newCards);

  panel.innerHTML = `
    <h2>Study Summary</h2>
    <div class="summary-row"><strong>Today:</strong> ${dueToday} review, ${newToday} new</div>
    <div class="summary-row"><strong>Tomorrow:</strong> ${dueTomorrow} review, ${newTomorrow} new</div>
  `;
}

// -------------- Load Cards --------------
async function loadCards() {
  const { data } = await supabaseClient.from("cards").select("*").order("id");
  allCards = data || [];
  updateSummary();
}

// -------------- Build Review Queue --------------
function buildReviewQueue() {
  const today = todayStr();
  const maxNew = getMaxNewCardsPerDay();

  const due = [];
  const newList = [];

  for (const c of allCards) {
    if (c.suspended) continue;

    if (c.card_type !== "new" && c.due_date && c.due_date <= today) {
      due.push(c);
    } else if (c.card_type === "new" && !c.first_seen) {
      newList.push(c);
    }
  }

  const introducedToday = allCards.filter(c => c.first_seen === today).length;
  let remainingNew = Math.max(0, maxNew - introducedToday);

  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  };

  shuffle(due);
  shuffle(newList);

  reviewQueue = [...due, ...newList.slice(0, remainingNew)];
}

// -------------- Review Progress + Counter --------------
function updateProgress() {
  const bar = document.getElementById("review-progress-bar");
  const counter = document.getElementById("review-counter");

  const total = reviewQueue.length;
  const done = Math.min(currentIndex, total);

  counter.textContent = `${done} / ${total}`;
  bar.style.width = total ? `${(done / total) * 100}%` : "0%";
}

// -------------- Render Card --------------
function renderCardStatus(card) {
  const el = document.getElementById("card-status");

  if (!card) {
    el.textContent = "";
    return;
  }

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

  const front = document.getElementById("card-front-text");
  const back = document.getElementById("card-back-text");
  const box = document.getElementById("card-box");
  const rating = document.getElementById("rating-buttons");

  if (!card) {
    front.textContent = "No cards.";
    back.textContent = "";
    rating.classList.add("hidden");
    updateProgress();
    return;
  }

  box.classList.remove("flip");
  void box.offsetWidth;

  front.textContent = card.dutch;
  back.textContent = "";

  rating.classList.add("hidden");
  renderCardStatus(card);
  updateProgress();
}

// -------------- Start Review Session --------------
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

// -------------- Flip Card --------------
document.getElementById("card-box").addEventListener("click", () => {
  const card = reviewQueue[currentIndex];
  if (!card) return;

  const back = document.getElementById("card-back-text");
  const box = document.getElementById("card-box");
  const rating = document.getElementById("rating-buttons");

  back.textContent = card.english;

  box.classList.toggle("flip");

  if (box.classList.contains("flip")) {
    setTimeout(() => rating.classList.remove("hidden"), 300);
  } else {
    rating.classList.add("hidden");
  }
});

// -------------- Handle Rating --------------
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

  const update = {
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

  await supabaseClient.from("cards").update(update).eq("id", card.id);

  currentIndex++;

  if (currentIndex >= reviewQueue.length) {
    showToast("Session complete");
    await loadCards();
    openScreen("menu");
    return;
  }

  renderCurrentCard();
}

// -------------- Word Review Sorting --------------
function buildWordTable(rows) {
  const tbody = document.getElementById("word-tbody");
  tbody.innerHTML = "";
  rows.forEach((r) => {
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

function sortWordData() {
  if (!wordSortColumn) {
    buildWordTable(allCards);
    return;
  }

  const sorted = [...allCards];

  sorted.sort((a, b) => {
    const col = wordSortColumn;
    const av = a[col];
    const bv = b[col];

    if (av == null && bv != null) return wordSortAsc ? 1 : -1;
    if (bv == null && av != null) return wordSortAsc ? -1 : 1;
    if (av == bv) return 0;

    const cmp = String(av).localeCompare(String(bv), "nl");
    return wordSortAsc ? cmp : -cmp;
  });

  buildWordTable(sorted);
}

window.openWordReview = function () {
  sortWordData();
  openScreen("wordreview");
};

// -------------- Reset Learning --------------
window.resetLearningData = async function () {
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
      suspended: false,
    });

  showToast("All learning reset");
  await loadCards();
};

// -------------- Init --------------
window.addEventListener("load", async () => {
  document.getElementById("app-version").textContent = "Version: " + APP_VERSION;

  const sel = document.getElementById("max-new-cards-select");
  sel.value = String(getMaxNewCardsPerDay());
  sel.addEventListener("change", () => {
    setMaxNewCardsPerDay(parseInt(sel.value, 10));
    updateSummary();
  });

  document.querySelectorAll("#word-table th").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.getAttribute("data-col");
      if (col === wordSortColumn) wordSortAsc = !wordSortAsc;
      else {
        wordSortColumn = col;
        wordSortAsc = true;
      }
      sortWordData();
    });
  });

  await loadCards();
  openScreen("menu");
});
