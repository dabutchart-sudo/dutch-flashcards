// ===================================================================
// app.js — FINAL VERSION (matches your Supabase schema exactly)
// ===================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY, UNSPLASH_ACCESS_KEY, CONFIG_MAX_NEW, APP_VERSION } from "./constants.js";
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
    function toggleLoading(show, msg = "Loading...") {
        const el = document.getElementById("loading-overlay");
        const txt = document.getElementById("loading-msg");

        if (show) {
            txt.textContent = msg;
            el.classList.remove("hidden");
            el.style.display = "flex";
        } else {
            el.classList.add("hidden");
            setTimeout(() => (el.style.display = "none"), 250);
        }
    }

    // -------------------------------------------------------------
    // INIT
    // -------------------------------------------------------------
    async function init() {
        toggleLoading(true, "Loading…");

        // Set Version Display
        const verEl = document.getElementById("version-display");
        if (verEl) verEl.textContent = "Version " + APP_VERSION;

        const maxNew = localStorage.getItem(CONFIG_MAX_NEW) || "10";
        document.getElementById("setting-max-new").value = maxNew;

        // Load cards
        let { data: cards } = await supabase.from("cards").select("*");
        allCards = cards || [];

        // Load review history
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
        allCards = data || [];

        calcProgress();

        document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
        document.getElementById("screen-menu").classList.add("active");

        toggleLoading(false);
    }

    // -------------------------------------------------------------
    // Progress Counters
    // -------------------------------------------------------------
    function calcProgress() {
        const today = new Date().toISOString().slice(0, 10);
        const maxNew = parseInt(localStorage.getItem(CONFIG_MAX_NEW) || 10);

        const introducedToday = allCards.filter(c => !c.suspended && c.first_seen?.slice(0,10) === today).length;

        const remainingNew = Math.max(0, maxNew - introducedToday);

        const newAvailable = allCards.filter(c => !c.suspended && c.type === "new").length;

        const due = allCards.filter(c =>
            !c.suspended &&
            c.type !== "new" &&
            c.due_date &&
            c.due_date.slice(0, 10) <= today
        ).length;

        document.getElementById("stat-new").textContent = Math.min(remainingNew, newAvailable);
        document.getElementById("stat-review").textContent = due;
    }

    // -------------------------------------------------------------
    // Start Learning Session
    // -------------------------------------------------------------
    function startSession() {
        const today = new Date().toISOString().slice(0, 10);

        const maxNew = parseInt(localStorage.getItem(CONFIG_MAX_NEW) || 10);
        const introducedToday = allCards.filter(c => !c.suspended && c.first_seen?.slice(0,10) === today).length;

        const dueCards = allCards.filter(c =>
            !c.suspended &&
            c.type !== "new" &&
            c.due_date &&
            c.due_date.slice(0,10) <= today
        );

        const newLimit = Math.max(0, maxNew - introducedToday);

        let newCards = allCards.filter(c => !c.suspended && c.type === "new");
        newCards.sort(() => Math.random() - 0.5);
        newCards = newCards.slice(0, newLimit);

        todayQueue = [...dueCards, ...newCards];
        todayQueue.sort(() => Math.random() - 0.5);

        currentCardIndex = 0;
        isFlipped = false;

        renderCard();
    }

    // -------------------------------------------------------------
    // Render Flashcard
    // -------------------------------------------------------------
    function renderCard() {
        const card = todayQueue[currentCardIndex];

        const elCard = document.getElementById("flashcard-el");
        const elEmpty = document.getElementById("learn-empty");
        const elActions = document.getElementById("review-actions");

        elActions.classList.add("hidden");

        if (!card) {
            elCard.style.display = "none";
            elEmpty.classList.remove("hidden");
            return;
        }

        elCard.style.display = "block";
        elEmpty.classList.add("hidden");

        document.getElementById("fc-dutch").textContent = card.dutch;
        document.getElementById("fc-english").textContent = card.english;

        const status = card.type === "new" ? "NEW" : "REVIEW";
        document.getElementById("fc-status-front").textContent = status;
        document.getElementById("fc-status-back").textContent = status;

        const imgEl = document.getElementById("fc-image");
        const btnReveal = document.getElementById("btn-reveal-img");

        imgEl.classList.add("hidden");

        if (card.image_url) {
            imgEl.src = card.image_url;
            btnReveal.classList.remove("hidden");
        } else {
            btnReveal.classList.add("hidden");
        }
    }

    function toggleHintImage() {
        document.getElementById("fc-image").classList.toggle("hidden");
    }

    function flipCard() {
        const elCard = document.getElementById("flashcard-el");
        const actions = document.getElementById("review-actions");

        elCard.classList.toggle("flipped");
        isFlipped = elCard.classList.contains("flipped");

        if (isFlipped) actions.classList.remove("hidden");
        else actions.classList.add("hidden");
    }

    // -------------------------------------------------------------
    // TTS
    // -------------------------------------------------------------
    function speakTTS() {
        const card = todayQueue[currentCardIndex];
        if (!card) return;

        const clean = card.dutch.replace(/\(.*\)/g, "").trim();

        if ("speechSynthesis" in window) {
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(clean);
            u.lang = "nl-NL";
            window.speechSynthesis.speak(u);
        }
    }

    // -------------------------------------------------------------
    // Rating (Again / Hard / Good / Easy)
    // -------------------------------------------------------------
    function rate(rating) {
        if (isProcessing) return;
        isProcessing = true;

        const card = todayQueue[currentCardIndex];
        const now = new Date().toISOString();

        const review = {
            cardid: card.id,
            rating,
            timestamp: now,
            reps: (card.reps || 0) + 1,
            lapses: card.lapses || 0,
            interval: card.interval,
            ease: card.ease
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
    // SM-2 Scheduling (Matches your schema)
    // -------------------------------------------------------------
    function applyScheduling(card, rating) {
        const today = new Date().toISOString().slice(0, 10);

        if (card.type === "new") {
            card.type = "review";
            card.ease = 2.5;
            card.interval = 1;
            card.first_seen = today;
        }

        if (rating === "again") {
            card.interval = 1;
            card.ease = Math.max(1.3, card.ease - 0.2);
        } else if (rating === "hard") {
            card.interval = Math.max(1, Math.round(card.interval * 1.2));
            card.ease = Math.max(1.3, card.ease - 0.1);
        } else if (rating === "good") {
            card.interval = Math.round(card.interval * card.ease);
        } else if (rating === "easy") {
            card.interval = Math.round(card.interval * (card.ease + 0.15));
            card.ease += 0.1;
        }

        const due = new Date();
        due.setDate(due.getDate() + card.interval);

        card.due_date = due.toISOString();
        card.last_reviewed = today;
    }

    // -------------------------------------------------------------
    // Save Review History (Your schema)
    // -------------------------------------------------------------
    async function flushReviewHistory(list) {
        if (!list || list.length === 0) return;

        const rows = list.map(item => ({
            cardid: item.cardid,
            rating: item.rating,
            timestamp: item.timestamp,
            reps: item.reps,
            lapses: item.lapses,
            interval: item.interval,
            ease: item.ease
        }));

        await supabase.from("reviewhistory").insert(rows);
    }

    // -------------------------------------------------------------
    // Update Scheduled Cards
    // -------------------------------------------------------------
    async function updateScheduledCards(list) {
        for (const r of list) {
            const card = allCards.find(c => c.id === r.cardid);
            if (!card) continue;

            await supabase.from("cards")
                .update({
                    type: card.type,
                    interval: card.interval,
                    ease: card.ease,
                    last_reviewed: card.last_reviewed,
                    due_date: card.due_date,
                    first_seen: card.first_seen
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

        document.getElementById("img-search-input").value = currentImageCard.english;

        document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
        document.getElementById("screen-selectImage").classList.add("active");

        searchImages();
    }

    function exitImageSelector() {
        if (currentImageScreen === "learn") {
            nav("learn");
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

        if (!json.results?.length) {
            grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;">No results found.</div>`;
            return;
        }

        json.results.forEach(img => {
            const div = document.createElement("div");
            div.className = "image-item";
            div.innerHTML = `<img src="${img.urls.thumb}" />`;
            div.onclick = () => {
                document.querySelectorAll(".image-item").forEach(x => x.classList.remove("selected"));
                div.classList.add("selected");
                selectedImageUrl = img.urls.regular;
                document.getElementById("btn-save-img").disabled = false;
            };
            grid.appendChild(div);
        });
    }

    async function saveSelectedImage() {
        if (!selectedImageUrl || !currentImageCard) return;

        await supabase.from("cards")
            .update({ image_url: selectedImageUrl })
            .eq("id", currentImageCard.id);

        currentImageCard.image_url = selectedImageUrl;

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
            let va = a[col] ?? "";
            let vb = b[col] ?? "";
            return dir === "asc" ? (va > vb ? 1 : -1) : (vb > va ? 1 : -1);
        });

        const today = new Date().toISOString().slice(0, 10);

        sorted.forEach(c => {
            const item = document.createElement("div");
            item.className = "review-item";

            item.innerHTML = `
                <div class="r-row-main">
                    <span class="r-dutch">${c.dutch}</span>
                    <span class="r-english">${c.english}</span>
                </div>
                <div class="r-meta">
                    <span>Last: ${c.last_reviewed || "-"}</span>
                    <span style="color:${c.due_date && c.due_date.slice(0,10) <= today ? "#d9534f" : "#999"}">
                        Due: ${c.due_date ? c.due_date.slice(0,10) : "-"}
                    </span>
                </div>
                <div class="r-actions">
                    <button class="chip-btn" onclick="App.toggleSuspend(${c.id}, ${!c.suspended})">
                        ${c.suspended ? "Unsuspend" : "Suspend"}
                    </button>
                    <button class="chip-btn" onclick="App.openImageSelector('wordReview', App.getCard(${c.id}))">
                        ${c.image_url ? "Edit Image" : "Add Image"}
                    </button>
                </div>
            `;

            list.appendChild(item);
        });
    }

    // -------------------------------------------------------------
    async function toggleSuspend(id, state) {
        const card = allCards.find(c => c.id === id);
        if (card) card.suspended = state;

        await supabase.from("cards").update({ suspended: state }).eq("id", id);

        renderWordTable();
    }

    function getCard(id) {
        return allCards.find(c => c.id === id);
    }

    function saveSettings() {
        const val = document.getElementById("setting-max-new").value;
        localStorage.setItem(CONFIG_MAX_NEW, val);
    }

    // -------------------------------------------------------------
    // Charts
    // -------------------------------------------------------------
    function drawChart() {
        if (!reviewHistory.length) {
            document.getElementById("report-summary").textContent = "No history available.";
            return;
        }

        const group = document.getElementById("report-group").value;
        const dataMap = {};

        reviewHistory.forEach(h => {
            let key = h.timestamp.slice(0, 10);

            if (group === "month") key = key.slice(0, 7);
            if (group === "year") key = key.slice(0, 4);

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
            const [y, m, d] = k.split("-").map(Number);
            const dt = new Date(y, (m || 1) - 1, d || 1);
            data.addRow([dt, dataMap[k].new, dataMap[k].rev]);
            ticks.push(dt);
        });

        const options = {
            isStacked: true,
            legend: { position: "bottom" },
            colors: ["#FF9F1C", "#2EC4B6"],
            chartArea: { width: "85%", height: "70%" }
        };

        const chart = new google.visualization.ColumnChart(document.getElementById("chart-div"));
        chart.draw(data, options);
    }

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

window.App = App;
