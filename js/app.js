// ===================================================================
// app.js — Final Version (Matches Your Supabase Schema Exactly)
// ===================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY, UNSPLASH_ACCESS_KEY, CONFIG_MAX_NEW } from "./constants.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const App = (function () {
    "use strict";

    // -------------------------------------------------------------
    // State
    // -------------------------------------------------------------
    let allCards = [];
    let todayQueue = [];
    let reviewBuffer = [];
    let reviewHistory = [];
    let currentCardIndex = 0;
    let isFlipped = false;
    let isProcessing = false;

    let currentImageCard = null;
    let currentImageScreen = "learn";
    let selectedImageUrl = null;

    // -------------------------------------------------------------
    // UI Loading Overlay
    // -------------------------------------------------------------
    function toggleLoading(show, msg = "Loading...") {
        const el = document.getElementById("loading-overlay");
        const txt = document.getElementById("loading-msg");

        if (show) {
            txt.textContent = msg;
            el.classList.remove("hidden");
            el.style.display = "flex";
        } else {
            el.classList.add("hidden");
            setTimeout(() => { el.style.display = "none"; }, 300);
        }
    }

    // -------------------------------------------------------------
    // Init (load cards + history)
    // -------------------------------------------------------------
    async function init() {
        toggleLoading(true, "Loading…");

        const maxNew = localStorage.getItem(CONFIG_MAX_NEW) || "10";
        document.getElementById("setting-max-new").value = maxNew;

        // --- Load cards (MATCHES YOUR SCHEMA) ---
        let { data: cards } = await supabase.from("cards").select("*");
        allCards = cards || [];

        // --- Load review history ---
        let { data: hist } = await supabase.from("reviewhistory").select("*");
        reviewHistory = hist || [];

        calcProgress();

        google?.charts?.load("current", { packages: ["corechart"] });

        toggleLoading(false);
    }

    // -------------------------------------------------------------
    // Navigation
    // -------------------------------------------------------------
    function nav(id) {
        if (id === "menu") {
            handleReturnToMenu();
            return;
        }

        document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
        document.getElementById("screen-" + id).classList.add("active");

        if (id === "learn") startSession();
        if (id === "wordReview") renderWordTable();
        if (id === "report") drawChart();
    }

    async function handleReturnToMenu() {
        toggleLoading(true, "Saving progress…");

        if (reviewBuffer.length > 0) {
            const toSend = [...reviewBuffer];
            reviewBuffer = [];

            await flushReviewHistory(toSend);
            await updateScheduledCards(toSend);
        }

        const { data } = await supabase.from("cards").select("*");
        allCards = data;

        calcProgress();
        document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
        document.getElementById("screen-menu").classList.add("active");

        toggleLoading(false);
    }

    // -------------------------------------------------------------
    // Calculate Progress Counts
    // -------------------------------------------------------------
    function calcProgress() {
        const today = new Date().toISOString().slice(0, 10);
        const maxNew = parseInt(localStorage.getItem(CONFIG_MAX_NEW) || "10");

        const introducedToday = allCards.filter(c => !c.Suspended && c.FirstSeen === today).length;
        const remainingNew = Math.max(0, maxNew - introducedToday);

        const newAvailable = allCards.filter(c => !c.Suspended && c.Type === "new").length;
        const due = allCards.filter(c => !c.Suspended && c.Type !== "new" && c.DueDate && c.DueDate.slice(0,10) <= today).length;

        document.getElementById("stat-new").textContent = Math.min(remainingNew, newAvailable);
        document.getElementById("stat-review").textContent = due;
    }

    // -------------------------------------------------------------
    // Start Review Session
    // -------------------------------------------------------------
    function startSession() {
        const today = new Date().toISOString().slice(0, 10);

        const maxNew = parseInt(localStorage.getItem(CONFIG_MAX_NEW) || 10);
        const introducedToday = allCards.filter(c => !c.Suspended && c.FirstSeen === today).length;

        const dueCards = allCards.filter(c =>
            !c.Suspended &&
            c.Type !== "new" &&
            c.DueDate &&
            c.DueDate.slice(0,10) <= today
        );

        const newLimit = Math.max(0, maxNew - introducedToday);
        let newCards = allCards.filter(c => !c.Suspended && c.Type === "new");
        newCards.sort(() => Math.random() - 0.5);
        newCards = newCards.slice(0, newLimit);

        todayQueue = [...dueCards, ...newCards];
        todayQueue.sort(() => Math.random() - 0.5);

        currentCardIndex = 0;
        isFlipped = false;

        renderCard();
    }

    // -------------------------------------------------------------
    // Render Card
    // -------------------------------------------------------------
    function renderCard() {
        const card = todayQueue[currentCardIndex];
        const elCard = document.getElementById("flashcard-el");
        const elEmpty = document.getElementById("learn-empty");
        const elActions = document.getElementById("review-actions");

        elActions.classList.add("hidden");
        isFlipped = false;

        if (!card) {
            elCard.style.display = "none";
            elEmpty.classList.remove("hidden");
            if (reviewBuffer.length > 0) flushReviewHistory(reviewBuffer);
            return;
        }

        elCard.style.display = "block";
        elEmpty.classList.add("hidden");

        elCard.classList.remove("flipped");

        document.getElementById("fc-dutch").textContent = card.Dutch;
        document.getElementById("fc-english").textContent = card.English;

        const status = card.Type === "new" ? "NEW" : "REVIEW";
        document.getElementById("fc-status-front").textContent = status;
        document.getElementById("fc-status-back").textContent = status;

        const imgEl = document.getElementById("fc-image");
        const btnReveal = document.getElementById("btn-reveal-img");

        imgEl.classList.add("hidden");

        if (card.ImageUrl) {
            imgEl.src = card.ImageUrl;
            btnReveal.classList.remove("hidden");
        } else {
            btnReveal.classList.add("hidden");
        }
    }

    // -------------------------------------------------------------
    // Toggle Hint Image
    // -------------------------------------------------------------
    function toggleHintImage() {
        const imgEl = document.getElementById("fc-image");
        imgEl.classList.toggle("hidden");
    }

    // -------------------------------------------------------------
    // Flip Card
    // -------------------------------------------------------------
    function flipCard() {
        const elCard = document.getElementById("flashcard-el");
        const actions = document.getElementById("review-actions");

        elCard.classList.toggle("flipped");
        isFlipped = elCard.classList.contains("flipped");

        if (isFlipped) actions.classList.remove("hidden");
        else actions.classList.add("hidden");
    }

    // -------------------------------------------------------------
    // Text to Speech
    // -------------------------------------------------------------
    function speakTTS() {
        const card = todayQueue[currentCardIndex];
        if (!card) return;

        const clean = card.Dutch.replace(/\(.*\)/g, "").trim();

        if ("speechSynthesis" in window) {
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(clean);
            u.lang = "nl-NL";
            window.speechSynthesis.speak(u);
        }
    }

    // -------------------------------------------------------------
    // Rate Card
    // -------------------------------------------------------------
    function rate(rating) {
        if (isProcessing) return;
        isProcessing = true;

        const card = todayQueue[currentCardIndex];

        const review = {
            cardId: card.id,
            rating,
            timestamp: new Date().toISOString(),
            reps: (card.Reps || 0) + 1,
            lapses: card.Lapses || 0,
            interval: card.Interval,
            ease: card.Ease
        };

        if (rating === "again") review.lapses++;

        reviewBuffer.push(review);

        todayQueue.splice(currentCardIndex, 1);

        applyScheduling(card, rating);

        renderCard();
        isProcessing = false;

        if (reviewBuffer.length >= 5) flushReviewHistory(reviewBuffer);
    }

    // -------------------------------------------------------------
    // Apply SM2 Scheduling (MATCHED TO YOUR DB COLUMN NAMES)
    // -------------------------------------------------------------
    function applyScheduling(card, rating) {
        const today = new Date().toISOString().slice(0, 10);

        if (card.Type === "new") {
            card.Type = "review";
            card.Ease = 2.5;
            card.Interval = 1;
            card.FirstSeen = today;
        }

        if (rating === "again") {
            card.Interval = 1;
            card.Ease = Math.max(1.3, card.Ease - 0.2);
        } else if (rating === "hard") {
            card.Interval = Math.max(1, Math.round(card.Interval * 1.2));
            card.Ease = Math.max(1.3, card.Ease - 0.1);
        } else if (rating === "good") {
            card.Interval = Math.round(card.Interval * card.Ease);
        } else if (rating === "easy") {
            card.Interval = Math.round(card.Interval * (card.Ease + 0.15));
            card.Ease += 0.1;
        }

        const due = new Date();
        due.setDate(due.getDate() + card.Interval);

        card.DueDate = due.toISOString();
        card.LastReviewed = today;
    }

    // -------------------------------------------------------------
    // Save ReviewHistory rows to Supabase (MATCHES YOUR SCHEMA)
    // -------------------------------------------------------------
    async function flushReviewHistory(list) {
        if (!list || list.length === 0) return;

        const rows = list.map(item => ({
            card_id: item.cardId,
            rating: item.rating,
            created_at: item.timestamp,
            reps: item.reps,
            lapses: item.lapses,
            interval: item.interval,
            ease: item.ease
        }));

        await supabase.from("reviewhistory").insert(rows);
    }

    // -------------------------------------------------------------
    // Update Scheduled Cards in Supabase
    // -------------------------------------------------------------
    async function updateScheduledCards(list) {
        for (const r of list) {
            const card = allCards.find(c => c.id === r.cardId);
            if (!card) continue;

            await supabase.from("cards")
                .update({
                    Type: card.Type,
                    Interval: card.Interval,
                    Ease: card.Ease,
                    LastReviewed: card.LastReviewed,
                    DueDate: card.DueDate,
                    FirstSeen: card.FirstSeen
                })
                .eq("id", card.id);
        }
    }

    // -------------------------------------------------------------
    // Image Selector
    // -------------------------------------------------------------
    function openImageSelector(fromScreen, cardOverride) {
        currentImageScreen = fromScreen;
        currentImageCard = cardOverride || todayQueue[currentCardIndex];

        document.getElementById("img-search-input").value = currentImageCard.English;
        document.getElementById("img-results").innerHTML = "";
        document.getElementById("btn-save-img").disabled = true;
        selectedImageUrl = null;

        document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
        document.getElementById("screen-selectImage").classList.add("active");

        searchImages();
    }

    function exitImageSelector() {
        if (currentImageScreen === "learn") {
            document.getElementById("screen-learn").classList.add("active");
            renderCard();
        } else {
            nav("wordReview");
        }
    }

    async function searchImages() {
        const query = document.getElementById("img-search-input").value;
        const grid = document.getElementById("img-results");
        const loader = document.getElementById("img-loading");

        if (!query) return;

        grid.innerHTML = "";
        loader.classList.remove("hidden");

        const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=12&client_id=${UNSPLASH_ACCESS_KEY}`;

        const res = await fetch(url);
        const json = await res.json();

        loader.classList.add("hidden");

        if (!json.results || json.results.length === 0) {
            grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;">No results found.</div>`;
            return;
        }

        json.results.forEach(img => {
            const div = document.createElement("div");
            div.className = "image-item";
            div.innerHTML = `<img src="${img.urls.thumb}" />`;
            div.onclick = () => selectImage(div, img.urls.regular);
            grid.appendChild(div);
        });
    }

    function selectImage(el, url) {
        document.querySelectorAll(".image-item").forEach(x => x.classList.remove("selected"));
        el.classList.add("selected");
        selectedImageUrl = url;
        document.getElementById("btn-save-img").disabled = false;
    }

    async function saveSelectedImage() {
        if (!selectedImageUrl || !currentImageCard) return;

        await supabase.from("cards")
            .update({ ImageUrl: selectedImageUrl })
            .eq("id", currentImageCard.id);

        currentImageCard.ImageUrl = selectedImageUrl;
        exitImageSelector();
    }

    // -------------------------------------------------------------
    // Word Review Table
    // -------------------------------------------------------------
    function renderWordTable() {
        const list = document.getElementById("word-list");
        list.innerHTML = "";

        const col = document.getElementById("sort-col").value;
        const dir = document.getElementById("sort-dir").value;

        let sorted = [...allCards];

        sorted.sort((a, b) => {
            let va = a[col] || "";
            let vb = b[col] || "";
            return dir === "asc" ? (va > vb ? 1 : -1) : (vb > va ? 1 : -1);
        });

        const today = new Date().toISOString().slice(0, 10);

        sorted.forEach(c => {
            const item = document.createElement("div");
            item.className = "review-item";

            item.innerHTML = `
                <div class="r-row-main">
                    <span class="r-dutch">${c.Dutch}</span>
                    <span class="r-english">${c.English}</span>
                </div>
                <div class="r-meta">
                    <span>Last: ${c.LastReviewed || "-"}</span>
                    <span style="color:${c.DueDate && c.DueDate.slice(0,10) <= today ? "#d9534f" : "#999"}">
                        Due: ${c.DueDate ? c.DueDate.slice(0,10) : "-"}
                    </span>
                </div>
                <div class="r-actions">
                    <button class="chip-btn" onclick="App.toggleSuspend(${c.id}, ${!c.Suspended})">
                        ${c.Suspended ? "Unsuspend" : "Suspend"}
                    </button>
                    <button class="chip-btn" onclick="App.openImageSelector('wordReview', App.getCard(${c.id}))">
                        ${c.ImageUrl ? "Edit Image" : "Add Image"}
                    </button>
                </div>
            `;

            list.appendChild(item);
        });
    }

    // -------------------------------------------------------------
    // Toggle Suspend
    // -------------------------------------------------------------
    async function toggleSuspend(id, state) {
        const card = allCards.find(c => c.id === id);
        if (card) card.Suspended = state;

        await supabase.from("cards")
            .update({ Suspended: state })
            .eq("id", id);

        renderWordTable();
    }

    // -------------------------------------------------------------
    // Get Card by ID
    // -------------------------------------------------------------
    function getCard(id) {
        return allCards.find(c => c.id === id);
    }

    // -------------------------------------------------------------
    // Save Settings
    // -------------------------------------------------------------
    function saveSettings() {
        const val = document.getElementById("setting-max-new").value;
        localStorage.setItem(CONFIG_MAX_NEW, val);
    }

    // -------------------------------------------------------------
    // Reports (chart)
    // -------------------------------------------------------------
    function drawChart() {
        if (!reviewHistory.length) {
            document.getElementById("report-summary").textContent = "No history available.";
            return;
        }

        const group = document.getElementById("report-group").value;
        const dataMap = {};

        reviewHistory.forEach(h => {
            let key = h.created_at.slice(0, 10);

            if (group === "month") key = key.slice(0, 7);
            if (group === "year") key = key.slice(0, 4);

            if (group === "week") {
                const d = new Date(h.created_at);
                const dow = d.getDay();
                d.setDate(d.getDate() - dow);
                key = d.toISOString().slice(0, 10);
            }

            if (!dataMap[key]) dataMap[key] = { new: 0, rev: 0 };
            if (h.rating === "again") dataMap[key].rev++;
            else dataMap[key].new++;
        });

        const data = new google.visualization.DataTable();
        data.addColumn("date", "Date");
        data.addColumn("number", "New");
        data.addColumn("number", "Review");

        const keys = Object.keys(dataMap).sort();
        const ticks = [];

        keys.forEach(k => {
            const parts = k.split("-").map(Number);
            let d = new Date(parts[0], parts[1] - 1, parts[2]);
            data.addRow([d, dataMap[k].new, dataMap[k].rev]);
            ticks.push(d);
        });

        const options = {
            isStacked: true,
            legend: { position: "bottom" },
            colors: ["#FF9F1C", "#2EC4B6"],
            chartArea: { width: "85%", height: "70%" }
        };

        const chart = new google.visualization.ColumnChart(
            document.getElementById("chart-div")
        );
        chart.draw(data, options);
    }

    // -------------------------------------------------------------
    // Expose Public API
    // -------------------------------------------------------------
    window.addEventListener("load", init);

    return {
        nav,
        flipCard,
        speakTTS,
        rate,
        toggleHintImage,
        openImageSelector,
        exitImageSelector,
        searchImages,
        saveSelectedImage,
        renderWordTable,
        toggleSuspend,
        getCard,
        saveSettings,
        drawChart
    };
})();

// Make App available to onclick="App.nav()"
window.App = App;
