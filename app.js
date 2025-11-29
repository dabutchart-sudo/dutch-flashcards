import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_VERSION } from "./config.js";

const { createClient } = window.supabase;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allCards = [];
let reviewQueue = [];
let currentIndex = 0;

// Browse mode
let browseList = [];
let browseIndex = 0;

// Word review sorting
let sortColumn = null;
let sortDirection = 1;

// Report
let reportChart = null;

// Session summary
let sessionResults = [];

// Edit card
let editCardId = null;
let editSelectedImageUrl = null;

/* ------------------------- Utility ------------------------- */
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

/* ------------------------- Settings ------------------------- */
const MAX_NEW_KEY = "maxNewCardsPerDay";

function getMaxNewCardsPerDay() {
  return parseInt(localStorage.getItem(MAX_NEW_KEY) || "10", 10);
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

  const el = document.getElementById(`${screen}-screen`);
  if (el) {
    el.classList.add("visible");
    el.classList.remove("hidden");
  }

  if (screen === "menu") {
    updateSummary();
  }
};

/* ------------------------- Load Cards ------------------------- */
async function loadCards() {
  const { data, error } = await supabase.from("cards").select("*").order("id");
  if (error) {
    console.error(error);
    showToast("Error loading cards");
    allCards = [];
    return;
  }
  allCards = data || [];
}

/* ------------------------- Review Queue ------------------------- */
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

  const introducedToday = allCards.filter((c) => c.first_seen === today).length;
  let remainingNew = maxNew - introducedToday;
  if (remainingNew < 0) remainingNew = 0;

  shuffle(due);
  shuffle(newList);

  reviewQueue = [...due, ...newList.slice(0, remainingNew)];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/* ------------------------- Review Rendering ------------------------- */
function updateCounter() {
  const el = document.getElementById("review-counter");
  el.textContent = `${currentIndex} / ${reviewQueue.length}`;
}

function updateProgressBar() {
  const bar = document.getElementById("review-progress-bar");
  if (!reviewQueue.length) {
    bar.style.width = "0%";
    return;
  }
  bar.style.width = `${(currentIndex / reviewQueue.length) * 100}%`;
}

function updateStatus(card) {
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
  const flipper = document.getElementById("card-flipper");
  const ratingRow = document.getElementById("rating-buttons");
  const hintBtn = document.getElementById("hint-btn");

  if (!card) {
    front.textContent = "No cards to review.";
    back.textContent = "";
    ratingRow.classList.add("hidden");
    if (hintBtn) hintBtn.classList.add("hidden");
    updateStatus(null);
    updateCounter();
    updateProgressBar();
    return;
  }

  flipper.classList.remove("flip");
  void flipper.offsetWidth;

  front.textContent = card.dutch;
  back.textContent = "";

  ratingRow.classList.add("hidden");

  if (card.image_url) hintBtn.classList.remove("hidden");
  else hintBtn.classList.add("hidden");

  updateStatus(card);
  updateCounter();
  updateProgressBar();
}

/* ------------------------- Start Review Session ------------------------- */
window.startReviewSession = async function () {
  await loadCards();
  updateSummary();
  buildReviewQueue();

  if (!reviewQueue.length) {
    showToast("No cards to review.");
    return;
  }

  sessionResults = [];
  currentIndex = 0;
  renderCurrentCard();
  openScreen("review");
};

/* ------------------------- Card Flip (Review) ------------------------- */
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

/* ------------------------- TTS (Review) ------------------------- */
document.getElementById("tts-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const card = reviewQueue[currentIndex];
  if (!card) return;

  const utter = new SpeechSynthesisUtterance(card.dutch);
  utter.lang = "nl-NL";
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
});

/* ------------------------- Hint (Review) ------------------------- */
document.getElementById("hint-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const card = reviewQueue[currentIndex];
  if (!card || !card.image_url) return;

  const img = document.getElementById("hint-image");
  img.src = card.image_url;

  const modal = document.getElementById("hint-modal");
  modal.classList.remove("hidden");
});

document.getElementById("hint-close-btn").addEventListener("click", () => {
  document.getElementById("hint-modal").classList.add("hidden");
});

/* ------------------------- Session Summary ------------------------- */
function showSessionSummaryModal() {
  const modal = document.getElementById("session-summary-modal");
  const textDiv = document.getElementById("session-summary-text");
  const listEl = document.getElementById("session-summary-list");

  const total = sessionResults.length;
  let again = 0,
    hard = 0,
    good = 0,
    easy = 0;

  const difficult = [];

  sessionResults.forEach((r) => {
    if (r.rating === "again") {
      again++;
      difficult.push(r);
    } else if (r.rating === "hard") {
      hard++;
      difficult.push(r);
    } else if (r.rating === "good") {
      good++;
    } else if (r.rating === "easy") {
      easy++;
    }
  });

  textDiv.innerHTML = `
    <p>Total cards reviewed: <strong>${total}</strong></p>
    <p>Again: <strong>${again}</strong>, Hard: <strong>${hard}</strong></p>
    <p>Good: <strong>${good}</strong>, Easy: <strong>${easy}</strong></p>
  `;

  listEl.innerHTML = "";
  if (difficult.length) {
    difficult.forEach((r) => {
      const li = document.createElement("li");
      li.textContent = `${r.dutch} – ${r.english} (${r.rating})`;
      listEl.appendChild(li);
    });
  } else {
    const li = document.createElement("li");
    li.textContent = "No difficult cards this session – nice!";
    listEl.appendChild(li);
  }

  modal.classList.remove("hidden");
}

document
  .getElementById("session-summary-close-btn")
  .addEventListener("click", () => {
    document
      .getElementById("session-summary-modal")
      .classList.add("hidden");
    openScreen("menu");
  });

/* ------------------------- Handle Rating ------------------------- */
window.handleRating = async function (rating) {
  const card = reviewQueue[currentIndex];
  if (!card) return;

  const today = todayStr();

  let type = card.card_type || "new";
  let interval = card.interval_days || 0;
  let ease = Number(card.ease || 2.5);
  let reps = card.reps || 0;
  let lapses = card.lapses || 0;

  reps++;

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
    if (rating === "again") {
      interval = 1;
    } else {
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

  const { error } = await supabase
    .from("cards")
    .update(update)
    .eq("id", card.id);

  if (error) {
    console.error(error);
    showToast("Save failed");
    return;
  }

  sessionResults.push({
    id: card.id,
    dutch: card.dutch,
    english: card.english,
    rating,
  });

  currentIndex++;

  if (currentIndex >= reviewQueue.length) {
    await loadCards();
    updateSummary();
    showSessionSummaryModal();
    return;
  }

  renderCurrentCard();
};

/* ------------------------- Browse Mode ------------------------- */
window.openBrowse = async function () {
  await loadCards();
  updateSummary();

  // Build browse list sorted by due_date (oldest first, nulls last)
  browseList = allCards
    .filter((c) => !c.suspended)
    .slice()
    .sort((a, b) => {
      const da = a.due_date ? a.due_date : "9999-12-31";
      const db = b.due_date ? b.due_date : "9999-12-31";
      if (da < db) return -1;
      if (da > db) return 1;
      return 0;
    });

  if (!browseList.length) {
    showToast("No cards to browse.");
    return;
  }

  browseIndex = 0;
  renderBrowseCard();
  openScreen("browse");
};

function renderBrowseCard() {
  const card = browseList[browseIndex];

  const front = document.getElementById("browse-front-text");
  const back = document.getElementById("browse-back-text");
  const flipper = document.getElementById("browse-card-flipper");
  const status = document.getElementById("browse-status");
  const bar = document.getElementById("browse-progress-bar");
  const counter = document.getElementById("browse-counter");
  const hintBtn = document.getElementById("browse-hint-btn");

  if (!card) {
    front.textContent = "No cards.";
    back.textContent = "";
    status.textContent = "";
    if (hintBtn) hintBtn.classList.add("hidden");
    bar.style.width = "0%";
    counter.textContent = "0 / 0";
    return;
  }

  flipper.classList.remove("flip");
  void flipper.offsetWidth;

  front.textContent = card.dutch;
  back.textContent = "";

  if (card.card_type === "new") {
    status.textContent = "NEW";
    status.style.color = "#ff8800";
  } else if (card.card_type === "learning") {
    status.textContent = "LEARNING";
    status.style.color = "#5bc0de";
  } else {
    status.textContent = "REVIEW";
    status.style.color = "#5cb85c";
  }

  if (card.image_url) hintBtn.classList.remove("hidden");
  else hintBtn.classList.add("hidden");

  const progress = ((browseIndex + 1) / browseList.length) * 100;
  bar.style.width = `${progress}%`;
  counter.textContent = `${browseIndex + 1} / ${browseList.length}`;
}

// Flip for browse
document.getElementById("browse-card-box").addEventListener("click", () => {
  const card = browseList[browseIndex];
  if (!card) return;

  const flipper = document.getElementById("browse-card-flipper");
  const back = document.getElementById("browse-back-text");

  if (!flipper.classList.contains("flip")) {
    back.textContent = card.english;
  }

  flipper.classList.toggle("flip");
});

// TTS for browse
document.getElementById("browse-tts-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const card = browseList[browseIndex];
  if (!card) return;

  const utter = new SpeechSynthesisUtterance(card.dutch);
  utter.lang = "nl-NL";
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
});

// Hint for browse
document.getElementById("browse-hint-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const card = browseList[browseIndex];
  if (!card || !card.image_url) return;

  const img = document.getElementById("hint-image");
  img.src = card.image_url;

  const modal = document.getElementById("hint-modal");
  modal.classList.remove("hidden");
});

// Browse nav
document.getElementById("browse-prev-btn").addEventListener("click", () => {
  if (!browseList.length) return;
  browseIndex = (browseIndex - 1 + browseList.length) % browseList.length;
  renderBrowseCard();
});

document.getElementById("browse-next-btn").addEventListener("click", () => {
  if (!browseList.length) return;
  browseIndex = (browseIndex + 1) % browseList.length;
  renderBrowseCard();
});

/* ------------------------- Word Review ------------------------- */
window.openWordReview = function () {
  const tbody = document.getElementById("word-tbody");
  tbody.innerHTML = "";

  let rows = [...allCards];

  if (sortColumn) {
    rows.sort((a, b) => {
      const A = a[sortColumn] ?? "";
      const B = b[sortColumn] ?? "";
      if (A < B) return -1 * sortDirection;
      if (A > B) return 1 * sortDirection;
      return 0;
    });
  }

  rows.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.dutch}</td>
      <td>${c.english}</td>
      <td>${c.last_reviewed ?? "-"}</td>
      <td>${c.due_date ?? "-"}</td>
      <td><button class="word-edit-btn" onclick="openEditFromList(${c.id})">Edit</button></td>
    `;
    tbody.appendChild(tr);
  });

  openScreen("wordreview");
};

document.querySelectorAll("#word-table th").forEach((th) => {
  th.addEventListener("click", () => {
    const col = th.dataset.col;
    if (!col) return;

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

/* ------------------------- Summary Panel ------------------------- */
function updateSummary() {
  const rows = document.querySelectorAll(".summary-row");
  if (!rows.length) return;

  const maxNew = getMaxNewCardsPerDay();
  const today = todayStr();
  const tomorrow = addDays(today, 1);

  const availableNew = allCards.filter(
    (c) => c.card_type === "new" && !c.first_seen && !c.suspended
  ).length;

  const dueToday = allCards.filter(
    (c) => !c.suspended && c.due_date && c.due_date <= today
  ).length;

  const dueTomorrow = allCards.filter(
    (c) => !c.suspended && c.due_date === tomorrow
  ).length;

  const newToday = Math.min(maxNew, availableNew);
  const newTomorrow = Math.min(maxNew, availableNew);

  rows[0].innerHTML = `<strong>Today:</strong> New ${newToday}, Review ${dueToday}`;
  rows[1].innerHTML = `<strong>Tomorrow:</strong> New ${newTomorrow}, Review ${dueTomorrow}`;
}

/* ------------------------- Report Screen ------------------------- */
window.openReport = async function () {
  await loadCards();
  updateSummary();
  openScreen("report");
  buildReportChart("day");
};

document.querySelectorAll(".report-group-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".report-group-btn")
      .forEach((b) => b.classList.remove("active"));
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
    if (!c.first_seen) continue;

    const d = c.first_seen;
    const m = d.slice(0, 7);
    const y = d.slice(0, 4);

    daily[d] = (daily[d] || 0) + 1;
    monthly[m] = (monthly[m] || 0) + 1;
    yearly[y] = (yearly[y] || 0) + 1;
  }

  let labels = [];
  let data = [];

  if (mode === "day") {
    const now = new Date();
    const yr = now.getFullYear();
    const mo = now.getMonth();
    const daysInMonth = new Date(yr, mo + 1, 0).getDate();

    for (let d = 1; d <= daysInMonth; d++) {
      const iso = new Date(yr, mo, d).toISOString().slice(0, 10);
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
          label: "New learned",
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
            autoSkip: true,
            maxTicksLimit: 6,
            maxRotation: 45,
          },
        },
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
        },
      },
    },
  });
}

/* ------------------------- Edit Card Feature ------------------------- */
function openEditModal(card) {
  editCardId = card.id;
  editSelectedImageUrl = card.image_url || null;

  const dutchInput = document.getElementById("edit-dutch");
  const englishInput = document.getElementById("edit-english");
  const searchInput = document.getElementById("edit-image-search");
  const currentImg = document.getElementById("edit-current-image");
  const noImageText = document.getElementById("edit-no-image-text");
  const results = document.getElementById("edit-image-results");

  dutchInput.value = card.dutch || "";
  englishInput.value = card.english || "";
  searchInput.value = card.english || card.dutch || "";

  if (card.image_url) {
    currentImg.src = card.image_url;
    currentImg.classList.remove("hidden");
    noImageText.classList.add("hidden");
  } else {
    currentImg.src = "";
    currentImg.classList.add("hidden");
    noImageText.classList.remove("hidden");
  }

  results.innerHTML = "";
  document.getElementById("edit-modal").classList.remove("hidden");
}

window.openEditFromList = function (id) {
  const card = allCards.find((c) => c.id === id);
  if (!card) return;
  openEditModal(card);
};

document.getElementById("review-edit-btn").addEventListener("click", () => {
  const card = reviewQueue[currentIndex];
  if (!card) return;
  openEditModal(card);
});

document.getElementById("browse-edit-btn").addEventListener("click", () => {
  const card = browseList[browseIndex];
  if (!card) return;
  openEditModal(card);
});

document.getElementById("edit-cancel-btn").addEventListener("click", () => {
  document.getElementById("edit-modal").classList.add("hidden");
});

/* Search images via Wikimedia Commons */
document.getElementById("edit-search-btn").addEventListener("click", async () => {
  const query = document.getElementById("edit-image-search").value.trim();
  if (!query) {
    showToast("Enter a search term");
    return;
  }

  const url =
    "https://commons.wikimedia.org/w/api.php" +
    "?action=query&format=json&origin=*" +
    "&prop=imageinfo&iiprop=url|mime|thumburl&generator=search" +
    "&gsrnamespace=6" +
    "&gsrlimit=12" +
    "&gsrsearch=" +
    encodeURIComponent(query);

  const resultsContainer = document.getElementById("edit-image-results");
  resultsContainer.innerHTML = "Searching...";

  try {
    const res = await fetch(url);
    const data = await res.json();
    const pages = data.query && data.query.pages ? data.query.pages : {};

    const items = Object.values(pages).filter(
      (p) => p.imageinfo && p.imageinfo.length > 0
    );

    if (!items.length) {
      resultsContainer.innerHTML = "No images found.";
      return;
    }

    resultsContainer.innerHTML = "";
    items.forEach((p) => {
      const info = p.imageinfo[0];
      const thumb = info.thumburl || info.url;
      const full = info.url;

      const div = document.createElement("div");
      div.className = "image-option";
      const img = document.createElement("img");
      img.src = thumb;
      div.appendChild(img);

      div.addEventListener("click", () => {
        document
          .querySelectorAll(".image-option.selected")
          .forEach((el) => el.classList.remove("selected"));
        div.classList.add("selected");
        editSelectedImageUrl = full;

        const currentImg = document.getElementById("edit-current-image");
        const noImageText = document.getElementById("edit-no-image-text");
        currentImg.src = full;
        currentImg.classList.remove("hidden");
        noImageText.classList.add("hidden");
      });

      resultsContainer.appendChild(div);
    });
  } catch (err) {
    console.error(err);
    resultsContainer.innerHTML = "Error searching images.";
  }
});

/* Save edited card */
document.getElementById("edit-save-btn").addEventListener("click", async () => {
  if (!editCardId) return;

  const dutch = document.getElementById("edit-dutch").value.trim();
  const english = document.getElementById("edit-english").value.trim();
  const imageUrl = editSelectedImageUrl || null;

  if (!dutch || !english) {
    showToast("Dutch and English are required");
    return;
  }

  const { error } = await supabase
    .from("cards")
    .update({
      dutch,
      english,
      image_url: imageUrl,
    })
    .eq("id", editCardId);

  if (error) {
    console.error(error);
    showToast("Failed to save card");
    return;
  }

  // Update in memory
  const card = allCards.find((c) => c.id === editCardId);
  if (card) {
    card.dutch = dutch;
    card.english = english;
    card.image_url = imageUrl;
  }

  reviewQueue.forEach((c) => {
    if (c.id === editCardId) {
      c.dutch = dutch;
      c.english = english;
      c.image_url = imageUrl;
    }
  });

  browseList.forEach((c) => {
    if (c.id === editCardId) {
      c.dutch = dutch;
      c.english = english;
      c.image_url = imageUrl;
    }
  });

  // Refresh UI if needed
  if (document.getElementById("review-screen").classList.contains("visible")) {
    renderCurrentCard();
  }
  if (document.getElementById("browse-screen").classList.contains("visible")) {
    renderBrowseCard();
  }
  if (document.getElementById("wordreview-screen").classList.contains("visible")) {
    openWordReview();
  }

  document.getElementById("edit-modal").classList.add("hidden");
  showToast("Card updated");
});

/* ------------------------- Init ------------------------- */
window.addEventListener("load", async () => {
  const ver = document.getElementById("app-version");
  if (ver) ver.textContent = "Version: " + APP_VERSION;

  const sel = document.getElementById("max-new-cards-select");
  sel.value = String(getMaxNewCardsPerDay());
  sel.addEventListener("change", () => {
    setMaxNewCardsPerDay(parseInt(sel.value, 10));
    updateSummary();
    showToast("Max new cards updated");
  });

  await loadCards();
  updateSummary();
  openScreen("menu");
});
