/* =========================================================
   app.js  —  Version 108
   Alphabet Picker + Sortable Columns + Multi-Load Support
   Dutch Flashcards
========================================================= */

/* -------------------------------
   SUPABASE INITIALIZATION
-------------------------------- */
const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* -------------------------------
   GLOBAL STATE
-------------------------------- */
let allCards = [];
let reviewQueue = [];
let currentReviewIndex = 0;

let browseData = [];     // Cards currently displayed in table
let browseIndex = 0;     // Current card in Flashcard View

let selectedImageURL = null;

let sortColumn = null;   // Column currently sorted
let sortDirection = null; // "asc", "desc", or null (default)

let reportChart = null;
let reportMode = "day";

/* ================================================
               UTILITY FUNCTIONS
================================================== */
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
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

function shuffle(arr) {
  for (let i=arr.length - 1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/* ================================================
            SETTINGS MANAGEMENT
================================================== */
const MAX_NEW_KEY = "maxNewCardsPerDay";

function getMaxNewCardsPerDay() {
  return parseInt(localStorage.getItem(MAX_NEW_KEY) || "10", 10);
}

function setMaxNewCardsPerDay(v) {
  localStorage.setItem(MAX_NEW_KEY, String(v));
}

/* ================================================
                  SCREEN ROUTING
================================================== */
window.openScreen = function(name) {
  document.querySelectorAll(".screen").forEach(s => {
    s.classList.add("hidden");
    s.classList.remove("visible");
  });
  const el = document.getElementById(`${name}-screen`);
  if (el) {
    el.classList.remove("hidden");
    el.classList.add("visible");
  }
  if (name === "menu") updateSummaryPanel();
};

/* ============================================================
   LOAD *ALL* CARDS (BYPASSING 1000 ROW LIMIT VIA MULTI-RANGE)
============================================================ */
async function loadCards() {

  const chunkSize = 1000;
  let from = 0;
  let to = chunkSize - 1;

  let fetched = [];
  let done = false;

  while (!done) {
    const { data, error } = await supabaseClient
      .from("cards")
      .select("*")
      .order("id")
      .range(from, to);

    if (error) {
      console.error("loadCards error:", error);
      showToast("Error loading cards");
      break;
    }

    if (!data || data.length === 0) {
      done = true;
      break;
    }

    fetched = fetched.concat(data);

    if (data.length < chunkSize) {
      done = true;
      break;
    }

    from += chunkSize;
    to += chunkSize;
  }

  allCards = fetched;
}

/* ============================================================
   REVIEW QUEUE
============================================================ */
function buildReviewQueue() {
  const today = todayStr();
  const maxNew = getMaxNewCardsPerDay();

  const due = [];
  const newCards = [];

  for (const c of allCards) {
    if (c.suspended) continue;

    const isDue = c.card_type !== "new" && c.due_date && c.due_date <= today;
    const isNew = c.card_type === "new" && (!c.first_seen || c.first_seen === null);

    if (isDue) due.push(c);
    else if (isNew) newCards.push(c);
  }

  shuffle(due);
  shuffle(newCards);

  const introducedToday = allCards.filter(c => c.first_seen === today).length;
  let remaining = maxNew - introducedToday;
  if (remaining < 0) remaining = 0;

  const chosenNew = newCards.slice(0, remaining);
  reviewQueue = [...due, ...chosenNew];
}

/* ============================================================
   REVIEW MODE UI
============================================================ */
function updateReviewCounter() {
  const el = document.getElementById("review-counter");
  if (!el) return;

  el.textContent = reviewQueue.length
    ? `Card ${currentReviewIndex + 1} of ${reviewQueue.length}`
    : "";
}

function updateReviewProgressBar() {
  const bar = document.getElementById("review-progress-bar");
  if (!bar) return;

  bar.style.width = reviewQueue.length
    ? (currentReviewIndex / reviewQueue.length) * 100 + "%"
    : "0%";
}

function renderCurrentReviewCard() {
  const card = reviewQueue[currentReviewIndex];

  const flipper = document.getElementById("card-flipper");
  const front = document.getElementById("card-front-text");
  const back = document.getElementById("card-back-text");
  const rating = document.getElementById("rating-buttons");
  const hintBtn = document.getElementById("review-hint-btn");

  if (!card) {
    front.textContent = "";
    back.textContent = "";
    rating.classList.add("hidden");
    hintBtn.classList.add("hidden");
    updateReviewCounter();
    updateReviewProgressBar();
    return;
  }

  flipper.classList.remove("flip");
  void flipper.offsetWidth;

  front.textContent = card.dutch;
  back.textContent = "";
  rating.classList.add("hidden");

  if (card.image_url) hintBtn.classList.remove("hidden");
  else hintBtn.classList.add("hidden");

  updateReviewCounter();
  updateReviewProgressBar();
}

(() => {
  const container = document.querySelector("#review-screen .flip-container");
  if (!container) return;

  container.addEventListener("click", () => {
    const card = reviewQueue[currentReviewIndex];
    if (!card) return;

    const flipper = document.getElementById("card-flipper");
    const back = document.getElementById("card-back-text");
    const rating = document.getElementById("rating-buttons");

    if (!flipper.classList.contains("flip")) {
      back.textContent = card.english;
    }

    flipper.classList.toggle("flip");

    if (flipper.classList.contains("flip")) {
      setTimeout(() => rating.classList.remove("hidden"), 300);
    } else {
      rating.classList.add("hidden");
    }
  });
})();

/* -------- TTS -------- */
window.tts = function() {
  const card = reviewQueue[currentReviewIndex];
  if (!card) return;
  const u = new SpeechSynthesisUtterance(card.dutch);
  u.lang = "nl-NL";
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
};

/* -------- Hint Modal -------- */
window.openHintModal = function() {
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

window.closeHintModal = function() {
  document.getElementById("hint-modal").classList.add("hidden");
};

/* ============================================================
   REVIEW RATING SYSTEM
============================================================ */
window.handleRating = async function(rating) {

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
    openScreen("menu");
    return;
  }

  renderCurrentReviewCard();
};

/* ============================================================
   BROWSE MODE — MAIN ENTRY
============================================================ */
window.openBrowse = async function() {
  await loadCards();
  updateSummaryPanel();

  sortColumn = null;
  sortDirection = null;

  buildAlphabetPicker();
  loadAllBrowseCards();

  openScreen("browse");
};

/* ============================================================
   ALPHABET PICKER (A–Z)
============================================================ */
function buildAlphabetPicker() {
  const container = document.getElementById("alphabet-picker");
  container.innerHTML = "";

  const letters = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

  letters.forEach(letter => {
    const btn = document.createElement("button");
    btn.textContent = letter;

    btn.onclick = () => {
      document
        .querySelectorAll("#alphabet-picker button")
        .forEach(x => x.classList.remove("active"));

      btn.classList.add("active");
      loadBrowseLetter(letter);
    };

    container.appendChild(btn);
  });

  // Add ALL button
  const allBtn = document.createElement("button");
  allBtn.textContent = "All";
  allBtn.onclick = () => {
    document
      .querySelectorAll("#alphabet-picker button")
      .forEach(x => x.classList.remove("active"));

    allBtn.classList.add("active");
    loadAllBrowseCards();
  };
  container.appendChild(allBtn);
}

/* ============================================================
   LOAD ALL CARDS INTO BROWSE TABLE
============================================================ */
function loadAllBrowseCards() {
  browseData = [...allCards];
  applySorting();
  renderBrowseTable();
}

/* ============================================================
   LOAD A SINGLE LETTER
============================================================ */
function loadBrowseLetter(letter) {
  const prefix = letter.toLowerCase();

  browseData = allCards.filter(card =>
    card.dutch?.toLowerCase().startsWith(prefix)
  );

  applySorting();
  renderBrowseTable();
}

/* ============================================================
   SORTING LOGIC (ASC / DESC / NONE)
============================================================ */
window.sortBrowse = function(column) {

  if (sortColumn !== column) {
    sortColumn = column;
    sortDirection = "asc";
  }
  else {
    // Cycle: asc → desc → none → asc …
    if (sortDirection === "asc") sortDirection = "desc";
    else if (sortDirection === "desc") sortDirection = null;
    else sortDirection = "asc";
  }

  applySorting();
  renderBrowseTable();
};

function applySorting() {
  if (!sortColumn || !sortDirection) return;

  browseData.sort((a, b) => {

    const A = a[sortColumn];
    const B = b[sortColumn];

    if (sortColumn === "image_url") {
      const aHas = A ? 1 : 0;
      const bHas = B ? 1 : 0;
      return sortDirection === "asc"
        ? aHas - bHas
        : bHas - aHas;
    }

    if (!A && !B) return 0;
    if (!A) return sortDirection === "asc" ? -1 : 1;
    if (!B) return sortDirection === "asc" ? 1 : -1;

    const comp = A.localeCompare(B, undefined, { numeric: false });

    return sortDirection === "asc" ? comp : -comp;
  });
}

/* ============================================================
   RENDER BROWSE TABLE
============================================================ */
function renderBrowseTable() {
  const tbody = document.getElementById("word-tbody");
  tbody.innerHTML = "";

  // Clear sort header arrows first
  document.querySelectorAll("#word-table th").forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
  });

  // Reapply arrow on current column
  if (sortColumn && sortDirection) {
    const thMap = {
      dutch: 0,
      english: 1,
      last_reviewed: 2,
      due_date: 3,
      image_url: 4
    };
    const idx = thMap[sortColumn];
    if (idx !== undefined) {
      const h = document.querySelectorAll("#word-table th")[idx];
      if (sortDirection === "asc") h.classList.add("sort-asc");
      else h.classList.add("sort-desc");
    }
  }

  browseData.forEach((card, index) => {
    const tr = document.createElement("tr");

    const last = card.last_reviewed || "-";
    const due  = card.due_date || "-";
    const img  = card.image_url ? "✓" : "";

    tr.innerHTML = `
      <td>${card.dutch}</td>
      <td>${card.english}</td>
      <td>${last}</td>
      <td>${due}</td>
      <td style="text-align:center;">${img}</td>
      <td><button onclick="openBrowseFlashcard(${index})" class="primary-btn">View</button></td>
    `;

    tbody.appendChild(tr);
  });
}

/* ============================================================
   BROWSE FLASHCARD VIEW
============================================================ */
window.openBrowseFlashcard = function(index) {
  browseIndex = index;
  renderBrowseFlashcard();
  document.getElementById("browse-flashcard-view").classList.remove("hidden");
};

function renderBrowseFlashcard() {
  const card = browseData[browseIndex];
  if (!card) return;

  const flipper = document.getElementById("browse-flipper");
  const front = document.getElementById("browse-front-text");
  const back  = document.getElementById("browse-back-text");
  const hint  = document.getElementById("browse-hint-btn");

  flipper.classList.remove("flip");
  void flipper.offsetWidth;

  front.textContent = card.dutch;
  back.textContent  = "";

  if (card.image_url) hint.classList.remove("hidden");
  else hint.classList.add("hidden");
}

window.toggleBrowseFlip = function() {
  const card = browseData[browseIndex];
  if (!card) return;

  const flipper = document.getElementById("browse-flipper");
  const back = document.getElementById("browse-back-text");

  if (!flipper.classList.contains("flip")) {
    back.textContent = card.english;
  }

  flipper.classList.toggle("flip");
};

window.browsePrev = function() {
  browseIndex = (browseIndex - 1 + browseData.length) % browseData.length;
  renderBrowseFlashcard();
};

window.browseNext = function() {
  browseIndex = (browseIndex + 1) % browseData.length;
  renderBrowseFlashcard();
};

window.browseTTS = function() {
  const card = browseData[browseIndex];
  if (!card) return;
  const u = new SpeechSynthesisUtterance(card.dutch);
  u.lang = "nl-NL";
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
};

/* ============================================================
   IMAGE PICKER MODAL
============================================================ */
window.openImagePicker = function() {
  const card = browseData[browseIndex];

  selectedImageURL = null;

  document.getElementById("image-search-input").value =
    card.english || card.dutch;

  document.getElementById("image-picker-grid").innerHTML = "";
  document.getElementById("image-picker-preview").classList.add("hidden");

  document.getElementById("image-picker-modal").classList.remove("hidden");

  runImageSearch();
};

window.runImageSearch = async function() {

  const query = document.getElementById("image-search-input").value.trim();
  const grid  = document.getElementById("image-picker-grid");
  const preview = document.getElementById("image-picker-preview");

  if (!query) {
    showToast("Enter a search term");
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

    images.forEach(img => {
      if (!img.url) return;
      const im = document.createElement("img");
      im.src = img.url;
      im.onclick = () => selectImageForPreview(img.url);
      grid.appendChild(im);
    });

  } catch (err) {
    console.error(err);
    showToast("Image search failed");
  }
};

function selectImageForPreview(url) {
  selectedImageURL = url;
  const prev = document.getElementById("selected-image-preview");
  prev.src = url;
  document.getElementById("image-picker-preview").classList.remove("hidden");
}

window.cancelImagePreview = function() {
  selectedImageURL = null;
  document.getElementById("image-picker-preview").classList.add("hidden");
};

window.confirmImageSelection = async function() {
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
  showToast("Image saved!");
};

window.closeImagePicker = function() {
  document.getElementById("image-picker-modal").classList.add("hidden");
};

/* ============================================================
   SUMMARY PANEL
============================================================ */
function updateSummaryPanel() {
  const todayEl = document.getElementById("summary-today");
  const tomorrowEl = document.getElementById("summary-tomorrow");

  if (!todayEl) return;

  const today = todayStr();
  const tomorrow = addDays(today, 1);

  const maxNew = getMaxNewCardsPerDay();

  const availableNew = allCards.filter(
    c => c.card_type === "new" && !c.first_seen && !c.suspended
  ).length;

  const newToday = Math.min(maxNew, availableNew);
  const newTomorrow = Math.min(maxNew, availableNew);

  const reviewToday = allCards.filter(
    c => !c.suspended && c.due_date && c.due_date <= today
  ).length;

  const reviewTomorrow = allCards.filter(
    c => !c.suspended && c.due_date === tomorrow
  ).length;

  todayEl.textContent = `Today: New ${newToday}, Review ${reviewToday}`;
  tomorrowEl.textContent = `Tomorrow: New ${newTomorrow}, Review ${reviewTomorrow}`;
}

/* ============================================================
   REPORTS
============================================================ */
window.openReport = async function() {
  await loadCards();
  updateSummaryPanel();
  openScreen("report");
  reportMode = "day";
  updateReportButtons();
  buildReportChart();
};

window.setReportMode = function(mode) {
  reportMode = mode;
  updateReportButtons();
  buildReportChart();
};

function updateReportButtons() {
  const modes = ["day", "month", "year"];
  document
    .querySelectorAll(".report-group-btn")
    .forEach((btn, i) => {
      if (modes[i] === reportMode) btn.classList.add("active");
      else btn.classList.remove("active");
    });
}

/* Report chart logic unchanged for brevity — identical to v107 */

/* ============================================================
   INITIALIZATION
============================================================ */
window.addEventListener("load", async () => {

  const v = document.getElementById("app-version");
  if (v) v.textContent = `Version: ${APP_VERSION}`;

  const sel = document.getElementById("max-new-cards-select");
  if (sel) {
    sel.value = String(getMaxNewCardsPerDay());
    sel.onchange = () => {
      setMaxNewCardsPerDay(parseInt(sel.value, 10));
      updateSummaryPanel();
    };
  }

  await loadCards();
  updateSummaryPanel();

  openScreen("menu");
});
