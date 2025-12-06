// =========================================================
// app.js — FULL APP LOGIC + SUPABASE BACKEND + SCHEDULING
// =========================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY, UNSPLASH_ACCESS_KEY, CONFIG_MAX_NEW } from "./constants.js";

// Load Supabase client
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const App = (function() {
    "use strict";

    // ---------------------------
    // STATE
    // ---------------------------
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

    // ---------------------------
    // LOADING SCREEN HANDLER
    // ---------------------------
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

    // ---------------------------
    // INIT
    // ---------------------------
    async function init() {
        toggleLoading(true, "Loading your library...");

        const maxNew = localStorage.getItem(CONFIG_MAX_NEW) || "10";
        document.getElementById("setting-max-new").value = maxNew;

        // Load Cards
        let { data: cards, error: cardsErr } = await supabase.from("cards").select("*");
        if (cardsErr) console.error(cardsErr);
        allCards = cards || [];

        // Load review history
        let { data: hist, error: histErr } = await supabase.from("reviewHistory").select("*");
        if (histErr) console.error(histErr);
        reviewHistory = hist || [];

        calcProgress();

        google?.charts?.load("current", { packages: ["corechart"] });

        toggleLoading(false);
    }

    // ---------------------------
    // NAVIGATION
    // ---------------------------
    function nav(id) {
        if (id === "menu") {
            handleReturnToMenu();
            return;
        }
        setActiveScreen(id);

        if (id === "learn") startSession();
        if (id === "wordReview") renderWordTable();
        if (id === "report") drawChart();
    }

    function setActiveScreen(id) {
        document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
        document.getElementById("screen-" + id).classList.add("active");
    }

    // ---------------------------
    // SAVE PROGRESS WHEN RETURNING HOME
    // ---------------------------
    async function handleReturnToMenu() {
        toggleLoading(true, "Saving progress...");

        if (reviewBuffer.length > 0) {
            const toSend = [...reviewBuffer];
            reviewBuffer = [];

            await supabase.from("reviewHistory").insert(toSend);
            await updateScheduledCards(toSend);
        }

        const { data } = await supabase.from("cards").select("*");
        allCards = data;

        calcProgress();
        setActiveScreen("menu");
        toggleLoading(false);
    }

    // ---------------------------
    // PROGRESS COUNTERS
    // ---------------------------
    function calcProgress() {
        const today = new Date().toISOString().slice(0, 10);
        const maxNew = parseInt(localStorage.getItem(CONFIG_MAX_NEW) || 10);

        const introducedToday = allCards.filter(c => !c.suspended && c.firstSeen === today).length;
        const newAvailable = allCards.filter(c => !c.suspended && c.type === "new").length;
        const remainingNew = Math.max(0, maxNew - introducedToday);

        const due = allCards.filter(c => {
            if (c.suspended || c.type === "new" || !c.dueDate) return false;
            return c.dueDate <= today;
        }).length;

        document.getElementById("stat-new").textContent = Math.min(remainingNew, newAvailable);
        document.getElementById("stat-review").textContent = due;
    }

    // ---------------------------
    // START REVIEW SESSION
    // ---------------------------
    function startSession() {
        const today = new Date().toISOString().slice(0,10);
        const maxNew = parseInt(localStorage.getItem(CONFIG_MAX_NEW) || 10);
        const introducedToday = allCards.filter(c => !c.suspended && c.firstSeen === today).length;

        const dueCards = allCards.filter(c =>
            !c.suspended && c.type !== "new" && c.dueDate && c.dueDate <= today
        );

        const newLimit = Math.max(0, maxNew - introducedToday);
        let newCards = allCards.filter(c => !c.suspended && c.type === "new");
        newCards.sort(() => Math.random() - 0.5);
        newCards = newCards.slice(0, newLimit);

        todayQueue = [...dueCards, ...newCards].map(c => ({
            ...c,
            isNew: c.type === "new"
        }));

        todayQueue.sort(() => Math.random() - 0.5);
        currentCardIndex = 0;
        isFlipped = false;
        renderCard();
    }

    // ---------------------------
    // CARD UI RENDERING
    // ---------------------------
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
            if (reviewBuffer.length > 0) flushBuffer();
            return;
        }

        elCard.style.transition = "none";
        elCard.classList.remove("flipped");
        void elCard.offsetWidth;
        elCard.style.transition = "";

        elCard.style.display = "block";
        elEmpty.classList.add("hidden");

        document.getElementById("fc-dutch").textContent = card.dutch;
        document.getElementById("fc-english").textContent = card.english;

        const status = card.isNew ? "NEW" : "REVIEW";
        document.getElementById("fc-status-front").textContent = status;
        document.getElementById("fc-status-back").textContent = status;

        const imgEl = document.getElementById("fc-image");
        const btnReveal = document.getElementById("btn-reveal-img");

        imgEl.classList.add("hidden");

        if (card.imageUrl) {
            imgEl.src = card.imageUrl;
            btnReveal.classList.remove("hidden");
        } else {
            btnReveal.classList.add("hidden");
        }
    }

    // ---------------------------
    // SHOW/HIDE HINT IMAGE
    // ---------------------------
    function toggleHintImage() {
        const imgEl = document.getElementById("fc-image");
        if (imgEl.classList.contains("hidden")) imgEl.classList.remove("hidden");
        else imgEl.classList.add("hidden");
    }

    // ---------------------------
    // FLIP CARD
    // ---------------------------
    function flipCard() {
        const card = todayQueue[currentCardIndex];
        if (!card) return;

        const el = document.getElementById("flashcard-el");
        const actions = document.getElementById("review-actions");

        el.classList.toggle("flipped");
        isFlipped = el.classList.contains("flipped");
        if (isFlipped) actions.classList.remove("hidden");
        else actions.classList.add("hidden");
    }

    // ---------------------------
    // TEXT-TO-SPEECH
    // ---------------------------
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

    // ---------------------------
    // RATE CARD
    // ---------------------------
    function rate(rating) {
        if (isProcessing) return;
        isProcessing = true;

        const card = todayQueue[currentCardIndex];

        reviewBuffer.push({
            cardId: card.id,
            rating,
            timestamp: new Date().toISOString(),
            type: card.isNew ? "new" : "review"
        });

        todayQueue.splice(currentCardIndex, 1);

        renderCard();
        isProcessing = false;

        if (reviewBuffer.length >= 5) flushBuffer();
    }

    // ---------------------------
    // CALCULATE SCHEDULING + UPDATE CARDS
    // ---------------------------
    async function updateScheduledCards(reviews) {
        for (const r of reviews) {
            const card = allCards.find(c => c.id === r.cardId);
            if (!card) continue;

            applyScheduling(card, r.rating);

            await supabase.from("cards")
                .update({
                    type: card.type,
                    interval: card.interval,
                    ease: card.ease,
                    lastReviewed: card.lastReviewed,
                    dueDate: card.dueDate,
                    firstSeen: card.firstSeen
                })
                .eq("id", card.id);
        }
    }

    // ---------------------------
    // SIMPLE ANKI-LIKE SCHEDULER
    // ---------------------------
    function applyScheduling(card, rating) {
        const today = new Date().toISOString().slice(0,10);

        if (card.type === "new") {
            card.type = "review";
            card.ease = 250;
            card.interval = 1;
            card.firstSeen = today;
        }

        if (rating === "again") {
            card.interval = 1;
            card.ease = Math.max(130, card.ease - 20);
        } else if (rating === "hard") {
            card.interval = Math.max(1, Math.round(card.interval * 1.2));
            card.ease = Math.max(130, card.ease - 10);
        } else if (rating === "good") {
            card.interval = Math.round(card.interval * (card.ease / 100));
        } else if (rating === "easy") {
            card.interval = Math.round(card.interval * (card.ease / 80));
            card.ease += 10;
        }

        const due = new Date();
        due.setDate(due.getDate() + card.interval);
        card.dueDate = due.toISOString().slice(0, 10);
        card.lastReviewed = today;
    }

    // ---------------------------
    // FLUSH BUFFER TO SUPABASE
    // ---------------------------
    async function flushBuffer() {
        if (reviewBuffer.length === 0) return;

        const toSend = [...reviewBuffer];
        reviewBuffer = [];

        await supabase.from("reviewHistory").insert(toSend);

        await updateScheduledCards(toSend);
    }

    // ---------------------------
    // IMAGE SELECTOR — OPEN
    // ---------------------------
    function openImageSelector(fromScreen, cardOverride) {
        currentImageScreen = fromScreen;
        currentImageCard = cardOverride ?? todayQueue[currentCardIndex];

        if (!currentImageCard) return;

        document.getElementById("img-search-input").value = currentImageCard.english;
        document.getElementById("img-results").innerHTML = "";
        document.getElementById("btn-save-img").disabled = true;
        selectedImageUrl = null;

        nav("selectImage");
        searchImages();
    }

    // ---------------------------
    // IMAGE SELECTOR — EXIT
    // ---------------------------
    function exitImageSelector() {
        if (currentImageScreen === "learn") {
            setActiveScreen("learn");
            renderCard();
            toggleHintImage();
        } else {
            nav("wordReview");
        }
    }

    // ---------------------------
    // SEARCH UNSPLASH IMAGES CLIENT-SIDE
    // ---------------------------
    async function searchImages() {
        const query = document.getElementById("img-search-input").value;
        const grid = document.getElementById("img-results");
        const loader = document.getElementById("img-loading");

        if (!query) return;

        grid.innerHTML = "";
        loader.classList.remove("hidden");

        const url =
            `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=12&client_id=${UNSPLASH_ACCESS_KEY}`;

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

    // ---------------------------
    // SELECT IMAGE
    // ---------------------------
    function selectImage(el, url) {
        document.querySelectorAll(".image-item").forEach(x => x.classList.remove("selected"));
        el.classList.add("selected");
        selectedImageUrl = url;
        document.getElementById("btn-save-img").disabled = false;
    }

    // ---------------------------
    // SAVE IMAGE
    // ---------------------------
    async function saveSelectedImage() {
        if (!selectedImageUrl || !currentImageCard) return;

        const btn = document.getElementById("btn-save-img");
        btn.textContent = "Saving...";
        btn.disabled = true;

        await supabase.from("cards")
            .update({ imageUrl: selectedImageUrl })
            .eq("id", currentImageCard.id);

        currentImageCard.imageUrl = selectedImageUrl;

        exitImageSelector();
    }

    // ---------------------------
    // WORD LIST SCREEN
    // ---------------------------
    function renderWordTable() {
        const list = document.getElementById("word-list");
        list.innerHTML = "";

        const col = document.getElementById("sort-col").value;
        const dir = document.getElementById("sort-dir").value;

        let sorted = [...allCards];

        sorted.sort((a, b) => {
            let va = a[col] || "";
            let vb = b[col] || "";
            if (col === "dutch" || col === "english") {
                return dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
            }
            return dir === "asc" ? (va > vb ? 1 : -1) : (vb > va ? 1 : -1);
        });

        const today = new Date().toISOString().slice(0,10);

        sorted.forEach(c => {
            const item = document.createElement("div");
            item.className = "review-item";
            const last = c.lastReviewed || "-";
            const due = c.dueDate || "-";
            const suspended = c.suspended;

            item.innerHTML = `
                <div class="r-row-main">
                    <span class="r-dutch">${c.dutch}</span>
                    <span class="r-english">${c.english}</span>
                </div>
                <div class="r-meta">
                    <span>Last: ${last}</span>
                    <span style="color:${c.dueDate <= today ? "#d9534f" : "#999"}">Due: ${due}</span>
                </div>
                <div class="r-actions">
                    <button class="chip-btn" onclick="App.toggleSuspend(${c.id}, ${!suspended})">
                        ${suspended ? "Unsuspend" : "Suspend"}
                    </button>
                    <button class="chip-btn" onclick="App.openImageSelector('wordReview', App.getCard(${c.id}))">
                        ${c.imageUrl ? "Edit Image" : "Add Image"}
                    </button>
                </div>
            `;
            list.appendChild(item);
        });
    }

    // ---------------------------
    // GET CARD BY ID
    // ---------------------------
    function getCard(id) {
        return allCards.find(c => c.id === id);
    }

    // ---------------------------
    // TOGGLE SUSPEND
    // ---------------------------
    async function toggleSuspend(id, state) {
        const card = getCard(id);
        if (card) card.suspended = state;

        await supabase.from("cards").update({ suspended: state }).eq("id", id);

        renderWordTable();
    }

    // ---------------------------
    // SAVE SETTINGS
    // ---------------------------
    function saveSettings() {
        const val = document.getElementById("setting-max-new").value;
        localStorage.setItem(CONFIG_MAX_NEW, val);
    }

    // ---------------------------
    // REPORT CHART
    // ---------------------------
    function drawChart() {
        if (!reviewHistory.length) {
            document.getElementById("report-summary").textContent = "No history available.";
            return;
        }

        const group = document.getElementById("report-group").value;
        const dataMap = {};

        reviewHistory.forEach(h => {
            let key = h.timestamp.slice(0,10);

            if (group === "month") key = key.slice(0,7);
            if (group === "year") key = key.slice(0,4);

            if (group === "week") {
                const d = new Date(h.timestamp);
                const dow = d.getDay();
                d.setDate(d.getDate() - dow);
                key = d.toISOString().slice(0,10);
            }

            if (!dataMap[key]) dataMap[key] = { new:0, rev:0 };
            dataMap[key][h.type]++;
        });

        const data = new google.visualization.DataTable();
        data.addColumn("date", "Date");
        data.addColumn("number", "New");
        data.addColumn("number", "Review");

        const keys = Object.keys(dataMap).sort();
        const ticks = [];

        keys.forEach(k => {
            const parts = k.split("-").map(Number);
            let d;

            if (group === "year") d = new Date(parts[0], 0, 1);
            else if (group === "month") d = new Date(parts[0], parts[1] - 1, 1);
            else d = new Date(parts[0], parts[1] - 1, parts[2]);

            data.addRow([d, dataMap[k].new, dataMap[k].rev]);
            ticks.push(d);
        });

        let format = "MMM d";
        if (group === "month") format = "MMM yyyy";
        if (group === "year") format = "yyyy";

        const options = {
            isStacked: true,
            legend: { position: "bottom" },
            colors: ["#FF9F1C", "#2EC4B6"],
            chartArea: { width: "85%", height: "70%" },
            vAxis: { gridlines: { count: 4 }},
            hAxis: { format, ticks }
        };

        const chart = new google.visualization.ColumnChart(document.getElementById("chart-div"));
        chart.draw(data, options);
    }

    // ---------------------------
    // PUBLIC API
    // ---------------------------
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
        saveSettings
    };

})();
