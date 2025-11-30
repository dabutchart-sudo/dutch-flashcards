/* =========================================================
   app.js  —  Version 110  (Full, Updated)
   Includes:
   - Openverse via Cloudflare Worker Proxy
   - Browse View Fixes
   - A–Z Picker
   - Sorting
   - Multi-load
============================================================ */

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

let browseData = [];
let browseIndex = 0;

let selectedImageURL = null;

let sortColumn = null;
let sortDirection = null;

let reportChart = null; // Initialized for Chart.js instance
let reportMode = "day"; // Initialized for report grouping mode

/* ============================================================\
   UTILITIES
============================================================ */
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
  setTimeout(() => {
    t.classList.add("hidden");
  }, 3000);
}

function openScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => {
    s.classList.add("hidden");
    s.classList.remove("visible");
  });
  const screen = document.getElementById(`${id}-screen`);
  if (screen) {
    screen.classList.remove("hidden");
    screen.classList.add("visible");
    window.scrollTo(0, 0); // Reset scroll on screen change
  }
}

function getMaxNewCardsPerDay() {
  // Use localStorage, default to 10
  const max = localStorage.getItem("maxNewCardsPerDay");
  return max ? parseInt(max, 10) : 10;
}

function setMaxNewCardsPerDay(value) {
  localStorage.setItem("maxNewCardsPerDay", value);
}

/* ============================================================\
   CRUD OPERATIONS (Supabase)
============================================================ */

async function loadCards() {
  const { data, error } = await supabaseClient.from("cards").select("*");

  if (error) {
    console.error("Card load error:", error);
    showToast("Error loading cards.");
    return;
  }
  allCards = data;
}

async function saveCard(card) {
  if (card.id) {
    // Update existing card
    const { error } = await supabaseClient
      .from("cards")
      .update({
        dutch: card.dutch,
        english: card.english,
        hint: card.hint,
        image_url: card.image_url,
      })
      .eq("id", card.id);

    if (error) {
      console.error("Card update error:", error);
      showToast("Error updating card.");
      return;
    }
  } else {
    // Insert new card
    const { data, error } = await supabaseClient.from("cards").insert([
      {
        dutch: card.dutch,
        english: card.english,
        hint: card.hint,
        image_url: card.image_url,
        next_review_date: todayStr(), // New cards start reviewing today
        leitner_level: 0,
        last_review_date: null,
      },
    ]).select();

    if (error) {
      console.error("Card insert error:", error);
      showToast("Error inserting card.");
      return;
    }
    // Add the newly created card (with its new ID) to the local array
    if (data && data.length > 0) {
      allCards.push(data[0]);
    }
  }
  // Reload and update all views
  await loadCards();
  showToast("Card saved successfully!");
  openBrowse();
}

async function deleteCard(id) {
  const { error } = await supabaseClient.from("cards").delete().eq("id", id);

  if (error) {
    console.error("Card delete error:", error);
    showToast("Error deleting card.");
    return;
  }
  showToast("Card deleted successfully!");
  await loadCards(); // Reload all cards
  openBrowse(); // Return to browse view
}

async function recordReview(card, success) {
  const today = todayStr();

  // 1. Calculate new Leitner level and next review date
  let newLevel = card.leitner_level;
  if (success) {
    newLevel = Math.min(newLevel + 1, 7); // Max level 7
  } else {
    newLevel = Math.max(newLevel - 1, 0); // Min level 0
  }

  // Define review intervals in days (Leitner Box System)
  const intervals = [0, 1, 3, 7, 14, 30, 90, 180];
  const nextReviewDate = addDays(today, intervals[newLevel]);

  // 2. Update card in database
  const { error: updateError } = await supabaseClient
    .from("cards")
    .update({
      leitner_level: newLevel,
      next_review_date: nextReviewDate,
      last_review_date: today,
    })
    .eq("id", card.id);

  if (updateError) {
    console.error("Card update error during review:", updateError);
    return;
  }

  // 3. Record the review event in the 'reviews' history table
  const { error: reviewError } = await supabaseClient.from("reviews").insert([
    {
      card_id: card.id,
      success: success,
      event_date: today,
      leitner_level: newLevel,
    },
  ]);

  if (reviewError) {
    console.error("Review history insert error:", reviewError);
    // Continue even if history logging fails
  }

  // 4. Update local state
  card.leitner_level = newLevel;
  card.next_review_date = nextReviewDate;
  card.last_review_date = today;
}

/* ============================================================\
   REVIEW SESSION
============================================================ */

function getReviewQueue() {
  const today = todayStr();
  const maxNewCards = getMaxNewCardsPerDay();

  // 1. Get cards that are due for review (level > 0)
  const dueCards = allCards
    .filter((c) => c.next_review_date <= today && c.leitner_level > 0)
    .sort((a, b) => new Date(a.next_review_date) - new Date(b.next_review_date)); // oldest due first

  // 2. Get unlearned cards (level 0) and limit them
  const newCards = allCards
    .filter((c) => c.leitner_level === 0)
    .slice(0, maxNewCards); // Only take the max allowed for today

  // 3. Combine and shuffle the queue
  const queue = [...dueCards, ...newCards].sort(() => Math.random() - 0.5);
  return queue;
}

window.startReviewSession = async function () {
  await loadCards();
  reviewQueue = getReviewQueue();
  currentReviewIndex = 0;

  if (reviewQueue.length === 0) {
    showToast("🎉 All cards reviewed! Come back tomorrow.");
    return;
  }

  document.getElementById("review-total").textContent = reviewQueue.length;
  document.getElementById("review-remaining").textContent = reviewQueue.length;

  openScreen("review");
  showReviewCard(reviewQueue[currentReviewIndex]);
};

function showReviewCard(card) {
  const cardElement = document.getElementById("review-card");
  const levelDisplay = document.getElementById("review-level");

  // Reset state
  cardElement.classList.remove("flip-to-back");
  document.getElementById("review-front").textContent = card.dutch;
  document.getElementById("review-back").textContent = card.english;
  levelDisplay.textContent = `Lvl: ${card.leitner_level}`;

  // Update progress
  document.getElementById("review-current-index").textContent = currentReviewIndex + 1;
  document.getElementById("review-remaining").textContent = reviewQueue.length - currentReviewIndex;

  // Preload image for hint
  if (card.image_url) {
    const img = new Image();
    img.src = card.image_url;
  }
}

window.flipCard = function () {
  const cardElement = document.getElementById("review-card");
  cardElement.classList.toggle("flip-to-back");
};

window.answerReview = async function (success) {
  const card = reviewQueue[currentReviewIndex];
  await recordReview(card, success);

  currentReviewIndex++;
  if (currentReviewIndex < reviewQueue.length) {
    showReviewCard(reviewQueue[currentReviewIndex]);
  } else {
    showToast("Session complete! Updating summary...");
    updateSummaryPanel();
    openScreen("menu");
  }
};

window.showHint = function () {
  const card = reviewQueue[currentReviewIndex];
  const modal = document.getElementById("hint-modal");
  const imgElement = document.getElementById("hint-image");

  if (card.image_url) {
    imgElement.src = card.image_url;
    imgElement.onerror = () => {
      imgElement.src = "https://placehold.co/400x300/CCCCCC/333333?text=Image+Failed";
    };
  } else {
    imgElement.src = "https://placehold.co/400x300/CCCCCC/333333?text=No+Image+Available";
  }

  modal.classList.remove("hidden");
};

window.closeHintModal = function () {
  document.getElementById("hint-modal").classList.add("hidden");
};

/* ============================================================\
   CARD CREATION/EDITING
============================================================ */

window.openCreate = function () {
  openScreen("create");
  document.getElementById("card-form-title").textContent = "Create New Card";
  document.getElementById("card-id").value = "";
  document.getElementById("card-dutch").value = "";
  document.getElementById("card-english").value = "";
  document.getElementById("card-hint").value = "";
  document.getElementById("selected-image-url").value = "";
  updateSelectedImagePreview("");
};

window.editCard = function (cardId) {
  const card = allCards.find((c) => c.id === cardId);
  if (!card) return;

  openScreen("create");
  document.getElementById("card-form-title").textContent = "Edit Card";
  document.getElementById("card-id").value = card.id;
  document.getElementById("card-dutch").value = card.dutch;
  document.getElementById("card-english").value = card.english;
  document.getElementById("card-hint").value = card.hint;
  document.getElementById("selected-image-url").value = card.image_url || "";
  updateSelectedImagePreview(card.image_url || "");
};

window.submitCard = async function () {
  const id = document.getElementById("card-id").value;
  const dutch = document.getElementById("card-dutch").value.trim();
  const english = document.getElementById("card-english").value.trim();
  const hint = document.getElementById("card-hint").value.trim();
  const imageUrl = document.getElementById("selected-image-url").value.trim();

  if (!dutch || !english) {
    showToast("Dutch and English fields are required.");
    return;
  }

  await saveCard({
    id: id ? parseInt(id, 10) : null,
    dutch: dutch,
    english: english,
    hint: hint,
    image_url: imageUrl,
  });
};

/* ============================================================\
   IMAGE SEARCH/PICKER (Openverse)
============================================================ */

window.openImagePicker = function () {
  document.getElementById("image-picker-grid").innerHTML = "";
  document.getElementById("image-picker-preview").classList.add("hidden");
  document.getElementById("image-search-input").value = "";
  document.getElementById("image-picker-modal").classList.remove("hidden");
};

window.closeImagePickerModal = function () {
  document.getElementById("image-picker-modal").classList.add("hidden");
};

window.runImageSearch = async function () {
  const query = document.getElementById("image-search-input").value.trim();
  if (!query) {
    showToast("Please enter a search term.");
    return;
  }

  const grid = document.getElementById("image-picker-grid");
  grid.innerHTML = "Searching...";

  // Use a proxy URL to avoid CORS/API key issues, assumes a Cloudflare Worker is set up
  const API_URL = `https://workers.flashcard-app-proxy.workers.dev/search?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error("Search failed.");

    const data = await response.json();
    const images = data.results || [];

    grid.innerHTML = "";

    if (images.length === 0) {
      grid.innerHTML = "No images found. Try a different query.";
      return;
    }

    images.slice(0, 15).forEach((item) => {
      const img = document.createElement("img");
      // Use the thumbnail or a small version for the grid
      img.src = item.thumbnail || item.url;
      img.alt = item.title;
      img.onclick = () => selectImage(item.url); // Use the original URL for selection
      grid.appendChild(img);
    });
  } catch (error) {
    console.error("Image search error:", error);
    grid.innerHTML = "Error during image search. (Is proxy configured?)";
  }
};

function updateSelectedImagePreview(url) {
  const preview = document.getElementById("selected-card-image");
  if (url) {
    preview.src = url;
    preview.classList.remove("hidden");
    preview.onerror = () => {
      preview.src = "https://placehold.co/200x150/CCCCCC/333333?text=Image+Load+Fail";
    };
  } else {
    preview.classList.add("hidden");
    preview.src = "";
  }
}

window.selectImage = function (url) {
  selectedImageURL = url;
  // Update the input field on the create screen
  document.getElementById("selected-image-url").value = url;
  updateSelectedImagePreview(url);
  closeImagePickerModal();
};

/* ============================================================\
   BROWSE VIEW
============================================================ */

window.openBrowse = async function () {
  await loadCards();
  browseData = allCards;
  sortColumn = "dutch";
  sortDirection = "asc";
  applySortAndRenderBrowse();
  openScreen("browse");
};

function sortBrowseData() {
  if (!sortColumn) return;

  browseData.sort((a, b) => {
    let aVal = a[sortColumn];
    let bVal = b[sortColumn];

    if (sortColumn === "leitner_level") {
      aVal = parseInt(aVal, 10);
      bVal = parseInt(bVal, 10);
    } else if (sortColumn.includes("date")) {
      // Treat null dates as the oldest possible date for sorting
      aVal = aVal || "0000-01-01";
      bVal = bVal || "0000-01-01";
    } else {
      aVal = String(aVal).toLowerCase();
      bVal = String(bVal).toLowerCase();
    }

    if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
    return 0;
  });
}

function renderBrowseCards() {
  const list = document.getElementById("browse-list");
  list.innerHTML = "";

  browseData.forEach((card) => {
    const item = document.createElement("div");
    item.className = "card-list-item";
    item.dataset.id = card.id;

    item.innerHTML = `
      <div class="card-text">
        <div class="card-dutch">${card.dutch}</div>
        <div class="card-english">${card.english}</div>
      </div>
      <div class="card-meta">
        <span class="card-level">Lvl: ${card.leitner_level}</span>
        <span class="card-next-review">Next: ${card.next_review_date}</span>
      </div>
      <div class="card-actions">
        <button class="edit-btn" onclick="editCard(${card.id})">✏️</button>
        <button class="delete-btn" onclick="promptDelete(${card.id})">🗑️</button>
      </div>
    `;
    list.appendChild(item);
  });

  document.getElementById("browse-count").textContent = `Showing ${browseData.length} cards`;
}

window.sortBy = function (column) {
  if (sortColumn === column) {
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
  } else {
    sortColumn = column;
    sortDirection = "asc";
  }
  applySortAndRenderBrowse();
  updateSortIndicators();
};

function updateSortIndicators() {
  document.querySelectorAll(".sort-header").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
    const col = th.dataset.sort;
    if (col === sortColumn) {
      th.classList.add(`sort-${sortDirection}`);
    }
  });
}

function applySortAndRenderBrowse() {
  sortBrowseData();
  renderBrowseCards();
}

window.promptDelete = function (cardId) {
  const card = allCards.find((c) => c.id === cardId);
  const confirmation = document.getElementById("delete-confirmation");
  document.getElementById("delete-card-name").textContent = card.dutch;
  document.getElementById("confirm-delete-btn").onclick = () => {
    deleteCard(cardId);
    confirmation.classList.add("hidden");
  };
  confirmation.classList.remove("hidden");
};

window.cancelDelete = function () {
  document.getElementById("delete-confirmation").classList.add("hidden");
};

window.updateFilter = function () {
  const levelFilter = document.getElementById("level-filter").value;
  const searchInput = document.getElementById("search-input").value.toLowerCase();

  browseData = allCards.filter((card) => {
    // Level filter
    if (levelFilter !== "all" && card.leitner_level !== parseInt(levelFilter, 10)) {
      return false;
    }

    // Search filter
    if (searchInput) {
      const dutchMatch = card.dutch.toLowerCase().includes(searchInput);
      const englishMatch = card.english.toLowerCase().includes(searchInput);
      if (!dutchMatch && !englishMatch) {
        return false;
      }
    }

    return true;
  });

  applySortAndRenderBrowse();
};

/* ============================================================\
   SUMMARY
============================================================ */

function updateSummaryPanel() {
  const today = todayStr();
  const tomorrow = addDays(today, 1);
  const maxNewCards = getMaxNewCardsPerDay();

  const ReviewToday = allCards.filter((c) => c.next_review_date <= today && c.leitner_level > 0).length;
  const NewToday = allCards.filter((c) => c.leitner_level === 0).slice(0, maxNewCards).length;

  // The total queue is reviews + new cards
  const totalToday = ReviewToday + NewToday;
  document.getElementById("summary-today").textContent = `Today: ${totalToday} cards ready (${ReviewToday} Review, ${NewToday} New)`;

  // Tomorrow's review count only includes cards already learned (level > 0)
  const ReviewTomorrow = allCards.filter((c) => c.next_review_date === tomorrow && c.leitner_level > 0).length;
  document.getElementById("summary-tomorrow").textContent = `Tomorrow: Review ${ReviewTomorrow}`;
}

/* ============================================================\
   REPORTS (Chart Logic)
============================================================ */

// Functions provided by user start here.

async function loadReviewHistory() {
  const { data, error } = await supabaseClient
    .from("reviews")
    .select("event_date")
    .order("event_date");

  if (error) {
    console.error("Review history load error:", error);
    return [];
  }

  return data;
}

async function buildReportChart() {
  const ctx = document.getElementById("report-chart").getContext("2d");

  // Destroy old chart if exists
  if (reportChart) {
    reportChart.destroy();
    reportChart = null;
  }

  // Load rows from Supabase
  const rows = await loadReviewHistory();
  if (!rows || rows.length === 0) {
    console.warn("⚠ No review data found");
  }

  // Group by day, month, or year
  const buckets = {};

  rows.forEach(row => {
    const d = new Date(row.event_date);
    let key;

    if (reportMode === "day") {
      key = row.event_date; // YYYY-MM-DD

    } else if (reportMode === "month") {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    } else if (reportMode === "year") {
      key = `${d.getFullYear()}`;
    }

    if (!buckets[key]) buckets[key] = 0;
    buckets[key]++;
  });

  const labels = Object.keys(buckets).sort();
  const values = labels.map(k => buckets[k]);

  // Build chart
  reportChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Reviews Completed",
          data: values,
          borderWidth: 1,
          backgroundColor: '#ff8800' // Use the app's accent color
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      scales: {
        x: {
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: {
            stepSize: 1, // Ensure integer ticks for count data
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false }
      }
    }
  });
}

/* ============================================================\
   REPORTS (Screen Logic)
============================================================ */
window.openReport = async function () {
  await loadCards(); // Ensure card data is current for summary panel
  updateSummaryPanel();
  openScreen("report");
  reportMode = "day"; // Default to day view
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

/* ============================================================\
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

  // Initial load
  await loadCards();
  updateSummaryPanel();
  // Ensure we are on the menu screen when the app starts
  if (document.querySelector(".screen.visible") === null) {
    openScreen("menu");
  }
});
