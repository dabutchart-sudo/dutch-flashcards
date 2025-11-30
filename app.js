// =========================================================
// app.js v106 — Wikimedia Image Picker (allimages) + Editable Search
// =========================================================

// ------------ SUPABASE INIT ------------
const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ------------ GLOBAL STATE ------------
let allCards = [];
let reviewQueue = [];
let currentReviewIndex = 0;

let browseData = [];
let browseIndex = 0;

let selectedImageURL = null;
let reportChart = null;
let reportMode = "day";

// ---------------------------------------------------------
// UTILS
// ---------------------------------------------------------
function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function addDays(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ---------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------
const MAX_NEW_KEY = "maxNewCardsPerDay";

function getMaxNewCardsPerDay() {
  return parseInt(localStorage.getItem(MAX_NEW_KEY) || "10", 10);
}

function setMaxNewCardsPerDay(v) {
  localStorage.setItem(MAX_NEW_KEY, String(v));
}

// ---------------------------------------------------------
// SCREEN HANDLING
// ---------------------------------------------------------
function openScreenInternal(name) {
  document.querySelectorAll(".screen").forEach((s) => {
    s.classList.remove("visible");
    s.classList.add("hidden");
  });

  const scr = document.getElementById(`${name}-screen`);
  if (scr) {
    scr.classList.add("visible");
    scr.classList.remove("hidden");
  }

  if (name === "menu") updateSummaryPanel();
}

window.openScreen = (n) => openScreenInternal(n);

// ---------------------------------------------------------
// LOAD CARDS (Still WITHOUT .range() — as you requested)
// ---------------------------------------------------------
async function loadCards() {
  const { data, error } = await supabaseClient
    .from("cards")
    .select("*")
    .order("id");

  if (error) {
    console.error("loadCards error:", error);
    showToast("Error loading cards");
    allCards = [];
    return;
  }

  allCards = data || [];
}

// ---------------------------------------------------------
// BUILD REVIEW QUEUE
// ---------------------------------------------------------
function buildReviewQueue() {
  const today = todayStr();
  const maxNew = getMaxNewCardsPerDay();

  const due = [];
  const newList = [];

  for (const c of allCards) {
    if (c.suspended) continue;

    const dueNow = c.card_type !== "new" && c.due_date && c.due_date <= today;
    const isNew = c.card_type === "new" && (!c.first_seen || c.first_seen === null);

    if (dueNow) due.push(c);
    else if (isNew) newList.push(c);
  }

  shuffle(due);
  shuffle(newList);

  const introducedToday = allCards.filter((c) => c.first_seen === today).length;

  let remaining = maxNew - introducedToday;
  if (remaining < 0) remaining = 0;

  const selectedNew = newList.slice(0, remaining);

  reviewQueue = [...due, ...selectedNew];
}

// ---------------------------------------------------------
// REVIEW UI
// ---------------------------------------------------------
function updateReviewCounter() {
  const el = document.getElementById("review-counter");
  if (!el) return;

  if (!reviewQueue.length) {
    el.textContent = "";
    return;
  }

  el.textContent = `Card ${currentReviewIndex + 1} of ${reviewQueue.length}`;
}

function updateReviewProgressBar() {
  const bar = document.getElementById("review-progress-bar");
  if (!bar) return;

  if (!reviewQueue.length) {
    bar.style.width = "0%";
    return;
  }

  bar.style.width =
    (currentReviewIndex / reviewQueue.length) * 100 + "%";
}

function updateCardStatus(card) {
  const statusEl = document.getElementById("card-status");
  if (!statusEl) return;

  if (!card) {
    statusEl.textContent = "";
    return;
  }

  if (card.card_type === "new") {
    statusEl.textContent = "NEW";
    statusEl.style.color = "#ff8800";
  } else if (card.card_type === "learning") {
    statusEl.textContent = "LEARNING";
    statusEl.style.color = "#5bc0de";
  } else {
    statusEl.textContent = "REVIEW";
    statusEl.style.color = "#5cb85c";
  }
}

function renderCurrentReviewCard() {
  const card = reviewQueue[currentReviewIndex];

  const flipper = document.getElementById("card-flipper");
  const front = document.getElementById("card-front-text");
  const back = document.getElementById("card-back-text");
  const ratingRow = document.getElementById("rating-buttons");
  const hintBtn = document.getElementById("review-hint-btn");

  if (!card) {
    front.textContent = "";
    back.textContent = "";
    ratingRow.classList.add("hidden");
    hintBtn.classList.add("hidden");
    updateCardStatus(null);
    updateReviewCounter();
    updateReviewProgressBar();
    return;
  }

  flipper.classList.remove("flip");
  void flipper.offsetWidth;

  front.textContent = card.dutch;
  back.textContent = "";
  ratingRow.classList.add("hidden");

  if (card.image_url) hintBtn.classList.remove("hidden");
  else hintBtn.classList.add("hidden");

  updateCardStatus(card);
  updateReviewCounter();
  updateReviewProgressBar();
}

// ---------------------------------------------------------
// START REVIEW
// ---------------------------------------------------------
window.startReviewSession = async function () {
  await loadCards();
  updateSummaryPanel();
  buildReviewQueue();

  if (!reviewQueue.length) {
    showToast("No cards to review.");
    return;
  }

  currentReviewIndex = 0;
  renderCurrentReviewCard();
  openScreenInternal("review");
};

// ---------------------------------------------------------
// REVIEW — FLIP
// ---------------------------------------------------------
(() => {
  const container = document.querySelector("#review-screen .flip-container");
  if (!container) return;

  container.addEventListener("click", () => {
    const card = reviewQueue[currentReviewIndex];
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
})();

// ---------------------------------------------------------
// REVIEW — TTS
// ---------------------------------------------------------
window.tts = function () {
  const card = reviewQueue[currentReviewIndex];
  if (!card) return;
  const u = new SpeechSynthesisUtterance(card.dutch);
  u.lang = "nl-NL";
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
};

// ---------------------------------------------------------
// HINT MODAL
// ---------------------------------------------------------
window.openHintModal = function () {
  const isReview = document.getElementById("review-screen").classList.contains("visible");
  const isBrowse = document.getElementById("browse-screen").classList.contains("visible");

  let card = null;
  if (isReview) card = reviewQueue[currentReviewIndex];
  else if (isBrowse) card = browseData[browseIndex];

  if (!card || !card.image_url) {
    showToast("No hint image available");
    return;
  }

  document.getElementById("hint-image").src = card.image_url;
  document.getElementById("hint-modal").classList.remove("hidden");
};

window.closeHintModal = () => {
  document.getElementById("hint-modal").classList.add("hidden");
};

// ---------------------------------------------------------
// REVIEW — RATING
// (same as previous version)
// ---------------------------------------------------------
window.handleRating = async function (rating) {
  const card = reviewQueue[currentReviewIndex];
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
    if (rating === "again") interval = 1;
    else interval = 3, type = "review";
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
  const due_date = addDays(today, interval);
  const first_seen = card.first_seen || today;

  await supabaseClient.from("cards")
    .update({
      card_type: type,
      interval_days: interval,
      ease,
      reps,
      lapses,
      first_seen,
      last_reviewed: today,
      due_date,
      suspended: false
    })
    .eq("id", card.id);

  await supabaseClient.from("reviews")
    .insert({
      card_id: card.id,
      rating,
      event_date: today,
      review_type: (first_seen === today ? "new" : "review")
    });

  currentReviewIndex++;

  if (currentReviewIndex >= reviewQueue.length) {
    document.getElementById("review-progress-bar").style.width = "100%";
    await loadCards();
    updateSummaryPanel();
    showToast("Session complete");
    openScreenInternal("menu");
    return;
  }

  renderCurrentReviewCard();
};

// ---------------------------------------------------------
// BROWSE MODE
// ---------------------------------------------------------
window.openBrowse = async function () {
  await loadCards();
  updateSummaryPanel();
  buildBrowseData();
  renderBrowseTable();

  document.getElementById("browse-table-view").classList.remove("hidden");
  document.getElementById("browse-flashcard-view").classList.add("hidden");

  openScreenInternal("browse");
};

function buildBrowseData() {
  browseData = allCards.filter((c) => !c.suspended);
}

function renderBrowseTable() {
  const tbody = document.getElementById("word-tbody");
  tbody.innerHTML = "";

  browseData.forEach((card, index) => {
    const tr = document.createElement("tr");

    const hasImage = card.image_url ? "✓" : "";

    tr.innerHTML = `
      <td>${card.dutch}</td>
      <td>${card.english}</td>
      <td style="text-align:center;">${hasImage}</td>
      <td><button class="primary-btn" data-index="${index}">View</button></td>
    `;

    tr.querySelector("button").addEventListener("click", () => {
      browseIndex = index;
      startBrowseViewerMode();
    });

    tbody.appendChild(tr);
  });
}

// ---------------------------------------------------------
// BROWSE VIEWER MODE
// ---------------------------------------------------------
function startBrowseViewerMode() {
  renderBrowseFlashcard();
  document.getElementById("browse-table-view").classList.add("hidden");
  document.getElementById("browse-flashcard-view").classList.remove("hidden");
}

function renderBrowseFlashcard() {
  const card = browseData[browseIndex];

  const flipper = document.getElementById("browse-flipper");
  const front = document.getElementById("browse-front-text");
  const back = document.getElementById("browse-back-text");
  const hintBtn = document.getElementById("browse-hint-btn");

  if (!card) {
    front.textContent = "";
    back.textContent = "";
    hintBtn.classList.add("hidden");
    return;
  }

  flipper.classList.remove("flip");
  void flipper.offsetWidth;

  front.textContent = card.dutch;
  back.textContent = "";

  if (card.image_url) hintBtn.classList.remove("hidden");
  else hintBtn.classList.add("hidden");
}

window.toggleBrowseFlip = function () {
  const card = browseData[browseIndex];
  if (!card) return;

  const flipper = document.getElementById("browse-flipper");
  const back = document.getElementById("browse-back-text");

  if (!flipper.classList.contains("flip")) {
    back.textContent = card.english;
  }

  flipper.classList.toggle("flip");
};

window.browsePrev = function () {
  browseIndex = (browseIndex - 1 + browseData.length) % browseData.length;
  renderBrowseFlashcard();
};

window.browseNext = function () {
  browseIndex = (browseIndex + 1) % browseData.length;
  renderBrowseFlashcard();
};

window.browseTTS = function () {
  const card = browseData[browseIndex];
  if (!card) return;

  const u = new SpeechSynthesisUtterance(card.dutch);
  u.lang = "nl-NL";
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
};

// ---------------------------------------------------------
// IMAGE PICKER — OPEN
// ---------------------------------------------------------
window.openImagePicker = function () {
  const modal = document.getElementById("image-picker-modal");
  const grid = document.getElementById("image-picker-grid");
  const preview = document.getElementById("image-picker-preview");
  const searchInput = document.getElementById("image-search-input");

  grid.innerHTML = "";
  preview.classList.add("hidden");
  selectedImageURL = null;

  const card = browseData[browseIndex];

  // Default search term = English word
  searchInput.value = card.english || card.dutch;

  modal.classList.remove("hidden");

  runImageSearch();
};

// ---------------------------------------------------------
// IMAGE PICKER — SEARCH (allimages endpoint)
// ---------------------------------------------------------
window.runImageSearch = async function () {
  const grid = document.getElementById("image-picker-grid");
  const preview = document.getElementById("image-picker-preview");
  const searchInput = document.getElementById("image-search-input");

  const query = searchInput.value.trim();
  if (!query) {
    showToast("Please enter a search term");
    return;
  }

  grid.innerHTML = "<p>Searching…</p>";
  preview.classList.add("hidden");
  selectedImageURL = null;

  const url =
    `https://commons.wikimedia.org/w/api.php?` +
    `action=query&` +
    `list=allimages&` +
    `aiprefix=${encodeURIComponent(query)}&` +
    `ailimit=50&` +
    `format=json&origin=*`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    const images = data?.query?.allimages || [];
    grid.innerHTML = "";

    if (images.length === 0) {
      grid.innerHTML = "<p>No images found.</p>";
      return;
    }

    images.forEach((imgObj) => {
      const url = imgObj.url;
      if (!url) return;

      const thumb = document.createElement("img");
      thumb.src = url;
      thumb.onclick = () => selectImageForPreview(url);

      grid.appendChild(thumb);
    });

  } catch (err) {
    console.error(err);
    showToast("Image search failed");
  }
};

// ENTER triggers search
document.addEventListener("keypress", (e) => {
  const modalVisible =
    !document.getElementById("image-picker-modal").classList.contains("hidden");
  if (modalVisible && e.key === "Enter") {
    runImageSearch();
  }
});

// ---------------------------------------------------------
// IMAGE PICKER — PREVIEW
// ---------------------------------------------------------
function selectImageForPreview(url) {
  selectedImageURL = url;

  const previewDiv = document.getElementById("image-picker-preview");
  const img = document.getElementById("selected-image-preview");

  img.src = url;
  previewDiv.classList.remove("hidden");
}

window.cancelImagePreview = function () {
  selectedImageURL = null;
  document.getElementById("image-picker-preview").classList.add("hidden");
};

// ---------------------------------------------------------
// IMAGE PICKER — SAVE TO SUPABASE
// ---------------------------------------------------------
window.confirmImageSelection = async function () {
  if (!selectedImageURL) {
    showToast("No image selected");
    return;
  }

  const card = browseData[browseIndex];

  const { error } = await supabaseClient
    .from("cards")
    .update({ image_url: selectedImageURL })
    .eq("id", card.id);

  if (error) {
    console.error(error);
    showToast("Failed to save image");
    return;
  }

  card.image_url = selectedImageURL;

  renderBrowseFlashcard();
  closeImagePicker();

  showToast("Image added!");
};

window.closeImagePicker = () => {
  document.getElementById("image-picker-modal").classList.add("hidden");
};

// ---------------------------------------------------------
// SUMMARY PANEL
// ---------------------------------------------------------
function updateSummaryPanel() {
  const todayEl = document.getElementById("summary-today");
  const tomorrowEl = document.getElementById("summary-tomorrow");
  if (!todayEl || !tomorrowEl) return;

  const today = todayStr();
  const tomorrow = addDays(today, 1);
  const maxNew = getMaxNewCardsPerDay();

  const availableNew = allCards.filter(
    (c) => c.card_type === "new" && !c.first_seen && !c.suspended
  ).length;

  const newToday = Math.min(maxNew, availableNew);
  const newTomorrow = Math.min(maxNew, availableNew);

  const reviewToday = allCards.filter(
    (c) => !c.suspended && c.due_date && c.due_date <= today
  ).length;

  const reviewTomorrow = allCards.filter(
    (c) => !c.suspended && c.due_date === tomorrow
  ).length;

  todayEl.textContent = `Today: New ${newToday}, Review ${reviewToday}`;
  tomorrowEl.textContent = `Tomorrow: New ${newTomorrow}, Review ${reviewTomorrow}`;
}

// ---------------------------------------------------------
// REPORTS (unchanged)
// ---------------------------------------------------------
window.openReport = async function () {
  await loadCards();
  updateSummaryPanel();
  openScreenInternal("report");
  reportMode = "day";
  updateReportButtons();
  buildReportChart();
};

window.setReportMode = function (mode) {
  reportMode = mode;
  updateReportButtons();
  buildReportChart();
};

function updateReportButtons() {
  const modes = ["day", "month", "year"];
  document.querySelectorAll(".report-group-btn").forEach((btn, i) => {
    if (modes[i] === reportMode) btn.classList.add("active");
    else btn.classList.remove("active");
  });
}

async function buildReportChart() {
  const { data, error } = await supabaseClient
    .from("reviews")
    .select("event_date, review_type");

  if (error) {
    console.error(error);
    return;
  }

  const counts = {};
  (data || []).forEach((r) => {
    const date = r.event_date;
    if (!date) return;

    let key =
      reportMode === "day"
        ? date
        : reportMode === "month"
        ? date.slice(0, 7)
        : date.slice(0, 4);

    if (!counts[key]) counts[key] = { new: 0, review: 0 };
    counts[key][r.review_type]++;
  });

  const labels = Object.keys(counts).sort();
  const newData = labels.map((k) => counts[k].new);
  const reviewData = labels.map((k) => counts[k].review);

  const ctx = document.getElementById("report-chart");

  if (reportChart) reportChart.destroy();

  reportChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "New", data: newData, backgroundColor: "#ff8800", stack: "stack" },
        { label: "Review", data: reviewData, backgroundColor: "#4287f5", stack: "stack" }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true }
      }
    }
  });
}

// ---------------------------------------------------------
// INIT
// ---------------------------------------------------------
window.addEventListener("load", async () => {
  const ver = document.getElementById("app-version");
  if (ver) ver.textContent = `Version: ${APP_VERSION}`;

  const maxNewSel = document.getElementById("max-new-cards-select");
  if (maxNewSel) {
    maxNewSel.value = String(getMaxNewCardsPerDay());
    maxNewSel.addEventListener("change", () => {
      setMaxNewCardsPerDay(parseInt(maxNewSel.value, 10));
      updateSummaryPanel();
      showToast("Max cards updated");
    });
  }

  await loadCards();
  updateSummaryPanel();
  openScreenInternal("menu");
});
