import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_VERSION } from "./config.js";

const { createClient } = window.supabase;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allCards = [];
let reviewQueue = [];
let currentIndex = 0;

let sortColumn = null;
let sortDirection = 1;

let reportChart = null;

/* ------------------------- Utility ------------------------- */
function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function addDays(iso, n) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

/* ------------------------- Settings ------------------------- */
const MAX_NEW_KEY = "maxNewCardsPerDay";

function getMaxNewCardsPerDay() {
  return parseInt(localStorage.getItem(MAX_NEW_KEY) || "10");
}

function setMaxNewCardsPerDay(val) {
  localStorage.setItem(MAX_NEW_KEY, String(val));
}

/* ------------------------- Navigation ------------------------- */
window.openScreen = function (screen) {
  document.querySelectorAll(".screen").forEach((s) => {
    s.classList.remove("visible");
    s.classList.add("hidden");
  });
  document.getElementById(`${screen}-screen`).classList.add("visible");
  document.getElementById(`${screen}-screen`).classList.remove("hidden");

  if (screen === "menu") updateSummary();
};

/* ------------------------- Load Cards ------------------------- */
async function loadCards() {
  const { data, error } = await supabase.from("cards").select("*").order("id");
  if (error) {
    console.error(error);
    showToast("Error loading cards");
    return [];
  }
  allCards = data;
  return data;
}

/* ------------------------- Build Review Queue ------------------------- */
function buildReviewQueue() {
  const today = todayStr();
  const maxNew = getMaxNewCardsPerDay();

  const due = [];
  const newCards = [];

  for (const c of allCards) {
    if (c.suspended) continue;

    if (c.card_type !== "new" && c.due_date && c.due_date <= today) {
      due.push(c);
    } else if (c.card_type === "new" && !c.first_seen) {
      newCards.push(c);
    }
  }

  const introducedToday = allCards.filter((c) => c.first_seen === today).length;
  let remainingNew = maxNew - introducedToday;
  if (remainingNew < 0) remainingNew = 0;

  shuffle(due);
  shuffle(newCards);

  reviewQueue = [...due, ...newCards.slice(0, remainingNew)];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/* ------------------------- Review Screen ------------------------- */
function updateCounter() {
  const counter = document.getElementById("review-counter");
  counter.textContent = `${currentIndex} / ${reviewQueue.length}`;
}

function updateProgressBar() {
  const bar = document.getElementById("review-progress-bar");
  if (!reviewQueue.length) bar.style.width = "0%";
  else bar.style.width = `${(currentIndex / reviewQueue.length) * 100}%`;
}

function updateStatus(card) {
  const s = document.getElementById("card-status");
  if (!card) {
    s.textContent = "";
    return;
  }
  s.textContent = card.card_type === "new"
    ? "NEW"
    : card.card_type === "learning"
      ? "LEARNING"
      : "REVIEW";
}

function renderCurrentCard() {
  const card = reviewQueue[currentIndex];

  const front = document.getElementById("card-front-text");
  const back = document.getElementById("card-back-text");
  const flipper = document.getElementById("card-flipper");
  const ratingRow = document.getElementById("rating-buttons");

  if (!card) {
    front.textContent = "No cards.";
    back.textContent = "";
    ratingRow.classList.add("hidden");
    updateCounter();
    updateProgressBar();
    updateStatus(null);
    return;
  }

  flipper.classList.remove("flip");
  void flipper.offsetWidth;

  front.textContent = card.dutch;
  back.textContent = "";

  ratingRow.classList.add("hidden");

  updateStatus(card);
  updateCounter();
  updateProgressBar();
}

window.startReviewSession = async function () {
  await loadCards();
  buildReviewQueue();

  if (!reviewQueue.length) {
    showToast("No cards to review.");
    return;
  }

  currentIndex = 0;
  renderCurrentCard();
  openScreen("review");
};

/* ------------------------- Flip Card ------------------------- */
document.getElementById("card-box").addEventListener("click", () => {
  const card = reviewQueue[currentIndex];
  if (!card) return;

  const flipper = document.getElementById("card-flipper");
  const back = document.getElementById("card-back-text");
  const ratingRow = document.getElementById("rating-buttons");

  if (!flipper.classList.contains("flip")) {
    back.textContent = card.english;
  }

  flipper.classList.toggle("flip");

  if (flipper.classList.contains("flip")) {
    setTimeout(() => ratingRow.classList.remove("hidden"), 300);
  } else {
    ratingRow.classList.add("hidden");
  }
});

/* ------------------------- TTS ------------------------- */
document.getElementById("tts-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const card = reviewQueue[currentIndex];
  if (!card) return;

  const utter = new SpeechSynthesisUtterance(card.dutch);
  utter.lang = "nl-NL";

  speechSynthesis.speak(utter);
});

/* ------------------------- Handle Rating ------------------------- */
window.handleRating = async function (rating) {
  const card = reviewQueue[currentIndex];
  if (!card) return;

  const today = todayStr();

  let type = card.card_type ?? "new";
  let interval = card.interval_days ?? 0;
  let ease = Number(card.ease ?? 2.5);
  let reps = card.reps ?? 0;
  let lapses = card.lapses ?? 0;

  reps++;

  const wasNew = !card.first_seen;

  if (type === "new") {
    if (rating === "again") interval = 1;
    else if (rating === "hard") interval = 1;
    else if (rating === "good") interval = 3;
    else if (rating === "easy") {
      interval = 4;
      ease += 0.15;
    }
    type = interval > 1 ? "review" : "learning";
  } else if (type === "learning") {
    if (rating === "again") interval = 1;
    else {
      interval = 3;
      type = "review";
    }
  } else {
    if (rating === "again") {
      lapses++;
      ease = Math.max(1.3, ease - 0.2);
      interval = 1;
      type = "learning";
    } else if (rating === "hard") {
      ease = Math.max(1.3, ease - 0.15);
      interval = Math.round(interval * 1.2);
    } else if (rating === "good") {
      interval = Math.round(interval * ease);
    } else if (rating === "easy") {
      ease += 0.15;
      interval = Math.round(interval * ease * 1.3);
    }
  }

  interval = Math.max(1, interval);
  const due = addDays(today, interval);
  const firstSeen = card.first_seen || today;

  const update = {
    card_type: type,
    interval_days: interval,
    ease,
    reps,
    lapses,
    first_seen: firstSeen,
    last_reviewed: today,
    due_date: due,
    suspended: false,
  };

  const { error } = await supabase.from("cards").update(update).eq("id", card.id);

  if (error) {
    console.error(error);
    showToast("Save failed");
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

/* ------------------------- Word Review ------------------------- */
window.openWordReview = function () {
  const tbody = document.getElementById("word-tbody");
  tbody.innerHTML = "";

  let rows = [...allCards];

  if (sortColumn) {
    rows.sort((a, b) => {
      const A = a[sortColumn] ?? "";
      const B = b[sortColumn] ?? "";
      return A < B ? -1 * sortDirection : A > B ? 1 * sortDirection : 0;
    });
  }

  rows.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.dutch}</td>
      <td>${c.english}</td>
      <td>${c.last_reviewed ?? "-"}</td>
      <td>${c.due_date ?? "-"}</td>
    `;
    tbody.appendChild(tr);
  });

  openScreen("wordreview");
};

/* Column sorting */
document.querySelectorAll("#word-table th").forEach((th) => {
  th.addEventListener("click", () => {
    const col = th.dataset.col;

    if (sortColumn === col) sortDirection *= -1;
    else {
      sortColumn = col;
      sortDirection = 1;
    }

    openWordReview();
  });
});

/* ------------------------- Reset Learning ------------------------- */
window.resetLearningData = async function () {
  const { error } = await supabase.from("cards").update({
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

  if (error) {
    console.error(error);
    showToast("Reset failed");
    return;
  }

  showToast("Learning data reset");
  await loadCards();
  updateSummary();
};

/* ------------------------- Summary ------------------------- */
function updateSummary() {
  if (!allCards.length) return;

  const maxNew = getMaxNewCardsPerDay();
  const today = todayStr();
  const tomorrow = addDays(today, 1);

  const dueToday = allCards.filter(c => !c.suspended && c.due_date && c.due_date <= today).length;
  const newToday = Math.min(
    maxNew,
    allCards.filter(c => c.card_type === "new" && !c.first_seen).length
  );

  const dueTomorrow = allCards.filter(c => c.due_date === tomorrow).length;
  const newTomorrow = Math.min(
    maxNew,
    allCards.filter(c => c.card_type === "new" && !c.first_seen).length
  );

  const rows = document.querySelectorAll(".summary-row");

  rows[0].innerHTML = `<strong>Today:</strong> New ${newToday}, Review ${dueToday}`;
  rows[1].innerHTML = `<strong>Tomorrow:</strong> New ${newTomorrow}, Review ${dueTomorrow}`;
}

/* ------------------------- Report Screen ------------------------- */
window.openReport = function () {
  openScreen("report");
  buildReportChart("day");
};

document.querySelectorAll(".report-group-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".report-group-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    buildReportChart(btn.dataset.mode);
  });
});

function buildReportChart(mode) {
  if (reportChart) {
    reportChart.destroy();
    reportChart = null;
  }

  const ctx = document.getElementById("report-chart");

  const daily = {};
  const monthly = {};
  const yearly = {};

  for (const c of allCards) {
    if (c.first_seen) {
      const d = c.first_seen;
      const m = d.slice(0, 7);
      const y = d.slice(0, 4);

      daily[d] = (daily[d] || 0) + 1;
      monthly[m] = (monthly[m] || 0) + 1;
      yearly[y] = (yearly[y] || 0) + 1;
    }
  }

  let labels, data;

  if (mode === "day") {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();

    const days = new Date(year, month + 1, 0).getDate();

    labels = [];
    data = [];

    for (let d = 1; d <= days; d++) {
      const iso = new Date(year, month, d).toISOString().slice(0, 10);
      labels.push(iso);
      data.push(daily[iso] || 0);
    }
  } else if (mode === "month") {
    labels = Object.keys(monthly).sort();
    data = labels.map((k) => monthly[k]);
  } else {
    labels = Object.keys(yearly).sort();
    data = labels.map((k) => yearly[k]);
  }

  reportChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "New Learned",
          data,
          backgroundColor: "#ff8800",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: {
            maxRotation: 45,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6,
          },
        },
        y: {
          beginAtZero: true,
        },
      },
    },
  });
}

/* ------------------------- Init ------------------------- */
window.addEventListener("load", async () => {
  const v = document.getElementById("app-version");
  v.textContent = "Version: " + APP_VERSION;

  const sel = document.getElementById("max-new-cards-select");
  sel.value = String(getMaxNewCardsPerDay());
  sel.addEventListener("change", () => {
    setMaxNewCardsPerDay(parseInt(sel.value));
    updateSummary();
    showToast("Max updated");
  });

  await loadCards();
  updateSummary();
  openScreen("menu");
});
