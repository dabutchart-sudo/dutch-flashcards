// ===================================================================
// app.js — VERSION 1.22 (Anti-Cheat Fix + Mastery/Activity Views)
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
    let sessionTotal = 0;
    let reviewBuffer = [];
    let reviewHistory = [];
    let currentCardIndex = 0;
    let isFlipped = false;
    let isProcessing = false;

    let currentImageCard = null;
    let currentImageScreen = "learn";
    let selectedImageUrl = null;

    let wordFilter = 'all'; 
    let wordSearch = '';

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

        const verEl = document.getElementById("version-display");
        if (verEl) verEl.textContent = "Version " + APP_VERSION;

        const maxNew = localStorage.getItem(CONFIG_MAX_NEW) || "10";
        document.getElementById("setting-max-new").value = maxNew;

        // Load cards
        let { data: cards } = await supabase
            .from("cards")
            .select("*")
            .range(0, 9999);
            
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
        
        if (id === "report") {
            drawChart();
            drawStatusChart();
            drawMasteryHistoryChart();
        }
    }

    async function handleReturnToMenu() {
        toggleLoading(true, "Saving progress…");

        if (reviewBuffer.length > 0) {
            const toSend = [...reviewBuffer];
            reviewHistory.push(...toSend);
            reviewBuffer = [];

            await flushReviewHistory(toSend);
            await updateScheduledCards(toSend);
        }

        // Re-fetch all cards to ensure the most up-to-date schedule is loaded
        const { data } = await supabase
            .from("cards")
            .select("*")
            .range(0, 9999);

        allCards = data || [];

        calcProgress(); // IMPORTANT: Recalculate stats for the menu screen

        document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
        document.getElementById("screen-menu").classList.add("active");

        toggleLoading(false);
    }

    // -------------------------------------------------------------
    // Progress Counters
    // -------------------------------------------------------------
    function calcProgress() {
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        const tomorrowDateStr = tomorrow.toISOString().slice(0, 10);

        const maxNew = parseInt(localStorage.getItem(CONFIG_MAX_NEW) || 10);

        // --- Stats Done Today (for the text above the table) ---
        
        // Count all cards marked as 'first_seen' today
        const newDone = allCards.filter(c => 
            !c.suspended && 
            c.first_seen && 
            c.first_seen.slice(0, 10) === today
        ).length;

        const historyToday = reviewHistory.filter(h => h.timestamp.startsWith(today));
        const bufferToday = reviewBuffer.filter(h => h.timestamp.startsWith(today));
        const allTodayLogs = [...historyToday, ...bufferToday];

        const reviewDone = allTodayLogs.filter(log => log.review_type === 'review').length;
        
        // --- Due Today Logic ---
        
        // Max new cards remaining to introduce today
        const newDueToday = Math.max(0, maxNew - newDone);
        
        // Review cards DUE TODAY (due_date <= today)
        const reviewDueToday = allCards.filter(c =>
            !c.suspended &&
            c.type !== "new" &&
            c.due_date &&
            c.due_date.slice(0, 10) <= today
        ).length;

        // --- Due Tomorrow Logic ---

        // If the user hasn't started learning tomorrow yet, the full quota is available.
        const newDueTomorrow = maxNew; 

        // Review cards DUE TOMORROW (due_date = tomorrow)
        const reviewDueTomorrow = allCards.filter(c => 
            !c.suspended &&
            c.type !== "new" &&
            c.due_date &&
            c.due_date.slice(0, 10) === tomorrowDateStr
        ).length;

        const setStat = (id, val) => {
            const el = document.getElementById(id);
            if(el) el.textContent = val;
        };

        // Done Stats (Text above table)
        setStat("stat-done-new", newDone);
        setStat("stat-done-review", reviewDone);
        
        // Table Stats (Due Today / Due Tomorrow)
        setStat("stat-due-new", newDueToday);
        setStat("stat-due-review", reviewDueToday);
        
        setStat("stat-due-tomorrow-new", newDueTomorrow);
        setStat("stat-due-tomorrow-review", reviewDueTomorrow);
    }

    // -------------------------------------------------------------
    // Start Learning Session
    // -------------------------------------------------------------
    function startSession() {
        const today = new Date().toISOString().slice(0, 10);
        const maxNew = parseInt(localStorage.getItem(CONFIG_MAX_NEW) || 10);
        
        // This relies on allCards being up-to-date, which is now ensured in rate()
        const introducedToday = allCards.filter(c => 
            !c.suspended && 
            c.first_seen && 
            c.first_seen.slice(0, 10) === today
        ).length;

        const dueCards = allCards.filter(c =>
            !c.suspended &&
            c.type !== "new" &&
            c.due_date &&
            c.due_date.slice(0, 10) <= today
        );

        const newLimit = Math.max(0, maxNew - introducedToday);

        let newCards = allCards.filter(c => !c.suspended && c.type === "new");
        newCards.sort(() => Math.random() - 0.5);
        newCards = newCards.slice(0, newLimit);

        todayQueue = [...dueCards, ...newCards];
        todayQueue.sort(() => Math.random() - 0.5);

        sessionTotal = todayQueue.length;
        updateProgressBar();

        currentCardIndex = 0;
        isFlipped = false;

        renderCard();
    }

    function updateProgressBar() {
        const bar = document.getElementById("learn-progress-fill");
        const txt = document.getElementById("learn-progress-text");

        if (!sessionTotal || sessionTotal === 0) {
            if(bar) bar.style.width = "0%";
            if(txt) txt.textContent = "0 / 0";
            return;
        }

        const remaining = todayQueue.length;
        const completed = sessionTotal - remaining;
        const pct = (completed / sessionTotal) * 100;

        if(bar) bar.style.width = pct + "%";

        let currentNum = completed + 1;
        if (currentNum > sessionTotal) currentNum = sessionTotal;

        if(txt) txt.textContent = `${currentNum} / ${sessionTotal}`;
    }

    // -------------------------------------------------------------
    // Render Flashcard
    // -------------------------------------------------------------
    function renderCard() {
        const card = todayQueue[currentCardIndex];
        const elCard = document.getElementById("flashcard-el");
        const elEmpty = document.getElementById("learn-empty");
        const elActions = document.getElementById("review-actions");

        // --- RESET CARD FLIP INSTANTLY ---
        // We disable transitions to snap the card back to "front" immediately.
        // This prevents revealing the answer (English) of the NEW card while it rotates.
        if (elCard) {
            elCard.style.transition = 'none';
            elCard.classList.remove("flipped");
            void elCard.offsetWidth; // Force reflow
            elCard.style.transition = ''; // Restore transition for user interaction
        }

        isFlipped = false;
        if (elActions) elActions.classList.add("hidden");

        if (!card) {
            if (elCard) elCard.style.display = "none";
            if (elEmpty) elEmpty.classList.remove("hidden");
            document.getElementById("learn-progress-fill").style.width = "100%";
            document.getElementById("learn-progress-text").textContent = `${sessionTotal} / ${sessionTotal}`;
            return;
        }

        if (elCard) elCard.style.display = "block";
        if (elEmpty) elEmpty.classList.add("hidden");

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
    // TTS & Rating
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

    async function rate(rating) {
        if (isProcessing) return;
        isProcessing = true;

        const card = todayQueue[currentCardIndex];
        const now = new Date().toISOString();
        const typeAtReview = card.type; 

        card.reps = (card.reps || 0) + 1;

        const review = {
            cardid: card.id,
            rating,
            timestamp: now,
            reps: card.reps,
            lapses: card.lapses || 0,
            interval: card.interval,
            ease: card.ease,
            review_type: typeAtReview 
        };

        if (rating === "again") review.lapses++;

        reviewBuffer.push(review);
        todayQueue.splice(currentCardIndex, 1);
        
        updateProgressBar();
        applyScheduling(card, rating);
        
        // Immediately update the main allCards state locally
        const cardIndex = allCards.findIndex(c => c.id === card.id);
        if (cardIndex !== -1) {
            allCards[cardIndex] = { ...card }; 
        }

        renderCard();
        isProcessing = false;

        if (reviewBuffer.length >= 5) {
            const toSend = [...reviewBuffer];
            reviewBuffer = [];
            
            await Promise.all([
                flushReviewHistory(toSend),
                updateScheduledCards(toSend)
            ]);
        }
        
        // Recalculate progress after rating, showing immediate change on the menu screen
        calcProgress();
    }

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

    async function flushReviewHistory(list) {
        if (!list || list.length === 0) return;
        const rows = list.map(item => ({
            cardid: item.cardid,
            rating: item.rating,
            timestamp: item.timestamp,
            reps: item.reps,
            lapses: item.lapses,
            interval: item.interval,
            ease: item.ease,
            review_type: item.review_type 
        }));
        await supabase.from("reviewhistory").insert(rows);
    }

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
                    first_seen: card.first_seen,
                    reps: card.reps 
                })
                .eq("id", card.id);
        }
    }

    // -------------------------------------------------------------
    // Image & Search
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
            document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
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
        await supabase.from("cards").update({ image_url: selectedImageUrl }).eq("id", currentImageCard.id);
        currentImageCard.image_url = selectedImageUrl;
        exitImageSelector();
    }

    // -------------------------------------------------------------
    // Word Review Dashboard
    // -------------------------------------------------------------
    function handleSearch(val) {
        wordSearch = val.toLowerCase().trim();
        const clearBtn = document.getElementById("wr-clear-search");
        if (wordSearch.length > 0) clearBtn.classList.remove("hidden");
        else clearBtn.classList.add("hidden");
        renderWordTable();
    }

    function clearSearch() {
        document.getElementById("wr-search").value = "";
        handleSearch("");
    }

    function setFilter(type, btnEl) {
        wordFilter = type;
        document.querySelectorAll(".filter-pill").forEach(el => el.classList.remove("active"));
        btnEl.classList.add("active");
        renderWordTable();
    }

    function renderWordTable() {
        const list = document.getElementById("word-list");
        const countEl = document.getElementById("wr-count");
        list.innerHTML = "";

        const col = document.getElementById("sort-col").value;
        const today = new Date().toISOString().slice(0, 10);

        let filtered = allCards.filter(c => {
            const matchText = (c.dutch.toLowerCase().includes(wordSearch) || 
                               c.english.toLowerCase().includes(wordSearch));
            if (!matchText) return false;

            if (wordFilter === 'suspended') return c.suspended;
            if (c.suspended) return false; 

            if (wordFilter === 'new') return c.type === 'new';
            if (wordFilter === 'due') {
                return (c.type !== 'new' && c.due_date && c.due_date.slice(0,10) <= today);
            }
            return true; 
        });

        filtered.sort((a, b) => {
            let va = a[col] ?? "";
            let vb = b[col] ?? "";
            if (col === 'dutch' || col === 'english') {
                return va.localeCompare(vb);
            }
            return va > vb ? 1 : -1;
        });

        countEl.textContent = `${filtered.length} Words`;

        if (filtered.length === 0) {
            list.innerHTML = `<div class="center-msg">No words found.</div>`;
            return;
        }

        filtered.forEach(c => {
            const item = document.createElement("div");
            item.className = "review-item";

            let badgeHtml = "";
            if (c.suspended) badgeHtml = `<span class="ri-badge bg-susp">Frozen</span>`;
            else if (c.type === 'new') badgeHtml = `<span class="ri-badge bg-new">New</span>`;
            else if (c.due_date && c.due_date.slice(0,10) <= today) badgeHtml = `<span class="ri-badge bg-due">Due</span>`;
            else badgeHtml = `<span class="ri-badge bg-ok">${c.due_date ? c.due_date.slice(5,10) : '-'}</span>`;

            item.innerHTML = `
                <div class="ri-text">
                    <div class="ri-dutch">${c.dutch}</div>
                    <div class="ri-eng">${c.english}</div>
                    <div class="ri-meta">
                        ${badgeHtml}
                        <span style="color:#ccc">•</span>
                        <span>Ease: ${Math.round((c.ease || 2.5)*100)}%</span>
                    </div>
                </div>
                <div class="ri-actions">
                    <button class="icon-btn ${c.image_url ? 'img-active' : ''}" 
                        onclick="App.openImageSelector('wordReview', App.getCard(${c.id}))">
                        🖼
                    </button>
                    <button class="icon-btn" style="${c.suspended ? 'background:#ffebee; color:red;' : ''}" 
                        onclick="App.toggleSuspend(${c.id}, ${!c.suspended})">
                        ${c.suspended ? '❄️' : '🚫'}
                    </button>
                </div>
            `;
            list.appendChild(item);
        });
    }

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
    
    // 1. Mastery Status Pie Chart
    function drawStatusChart() {
        if (!allCards || allCards.length === 0) return;

        let stats = {
            new: 0,
            learning: 0,
            reviewing: 0,
            mastered: 0
        };

        allCards.forEach(c => {
            if (c.suspended) return; 

            if (c.type === 'new') {
                stats.new++;
            } else {
                const ivl = c.interval || 0;
                if (ivl <= 3) stats.learning++;
                else if (ivl <= 21) stats.reviewing++;
                else stats.mastered++;
            }
        });

        const data = google.visualization.arrayToDataTable([
            ['Status', 'Count'],
            ['New', stats.new],
            ['Learning', stats.learning],
            ['Reviewing', stats.reviewing],
            ['Mastered', stats.mastered]
        ]);

        const options = {
            pieHole: 0.4,
            colors: ['#ADB5BD', '#FFCA3A', '#1982C4', '#8AC926'], 
            chartArea: { width: "90%", height: "85%" },
            legend: { position: 'bottom' },
            fontSize: 14,
            fontName: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto'
        };

        const chart = new google.visualization.PieChart(document.getElementById('status-chart-div'));
        chart.draw(data, options);
    }

    // 2. Mastery HISTORY Area Chart
    function drawMasteryHistoryChart() {
        if (!reviewHistory || reviewHistory.length === 0) return;
        
        // --- 1. PREPARE REPLAY ---
        // Identify all cards and initialize their status from the current 'allCards' data.
        // This prevents previously reviewed cards from starting as 'new' in the historical replay.
        const cardMap = new Map();
        
        // Map card IDs to their CURRENT state in allCards
        allCards.forEach(c => {
            if (!c.suspended) {
                cardMap.set(c.id, { 
                    status: c.type, 
                    interval: c.interval || 0, 
                    ease: c.ease || 2.5,
                    first_seen: c.first_seen 
                });
            }
        });

        // Sort history chronological
        const sortedHistory = [...reviewHistory].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        
        if (sortedHistory.length === 0) return;

        // --- 2. REPLAY LOOP ---
        const dailyStats = []; // { date, new, learning, reviewing, mastered }
        let currentDate = sortedHistory[0].timestamp.slice(0, 10);
        const today = new Date().toISOString().slice(0, 10);

        // Helper to take a snapshot of current map state
        const takeSnapshot = (dateStr) => {
            let s = { new:0, learning:0, reviewing:0, mastered:0 };
            
            for (const [id, state] of cardMap.entries()) {
                if (state.status === 'new') s.new++;
                else if (state.interval <= 3) s.learning++;
                else if (state.interval <= 21) s.reviewing++;
                else s.mastered++;
            }
            
            const [y, m, d] = dateStr.split("-").map(Number);
            dailyStats.push([new Date(y, m-1, d), s.new, s.learning, s.reviewing, s.mastered]);
        };

        let historyIdx = 0;
        
        while (currentDate <= today) {
            // Process all events for this currentDate
            while (historyIdx < sortedHistory.length) {
                const event = sortedHistory[historyIdx];
                const evtDate = event.timestamp.slice(0, 10);

                if (evtDate > currentDate) break; 
                
                if (cardMap.has(event.cardid)) {
                    const cardState = cardMap.get(event.cardid);
                    
                    if (event.review_type === 'new') {
                        cardState.status = 'review';
                        cardState.interval = 1;
                        cardState.ease = 2.5;
                    }

                    if (event.rating === "again") {
                        cardState.interval = 1;
                        cardState.ease = Math.max(1.3, cardState.ease - 0.2);
                    } else if (event.rating === "hard") {
                        cardState.interval = Math.max(1, Math.round(cardState.interval * 1.2));
                        cardState.ease = Math.max(1.3, cardState.ease - 0.1);
                    } else if (event.rating === "good") {
                        cardState.interval = Math.round(cardState.interval * cardState.ease);
                    } else if (event.rating === "easy") {
                        cardState.interval = Math.round(cardState.interval * (cardState.ease + 0.15));
                        cardState.ease += 0.1;
                    }
                }
                
                historyIdx++;
            }

            if (dailyStats.length > 0 || historyIdx > 0 || currentDate === today) {
                takeSnapshot(currentDate);
            }

            const d = new Date(currentDate);
            d.setDate(d.getDate() + 1);
            currentDate = d.toISOString().slice(0, 10);
        }

        const data = new google.visualization.DataTable();
        data.addColumn('date', 'Date');
        data.addColumn('number', 'New');
        data.addColumn('number', 'Learning');
        data.addColumn('number', 'Reviewing');
        data.addColumn('number', 'Mastered');

        data.addRows(dailyStats);

        const options = {
            isStacked: true,
            colors: ['#ADB5BD', '#FFCA3A', '#1982C4', '#8AC926'], 
            chartArea: { width: "85%", height: "70%" },
            legend: { position: 'bottom' },
            hAxis: { format: 'MMM d' },
            vAxis: { textPosition: 'none', gridlines: { count: 0 } },
            areaOpacity: 0.9
        };

        const chart = new google.visualization.AreaChart(document.getElementById('mastery-history-chart'));
        chart.draw(data, options);
    }

    // 3. Activity History Column Chart (Updated for Day/Month View)
    function drawChart() {
        if (!reviewHistory) return;

        const group = document.getElementById("report-group").value;
        const data = new google.visualization.DataTable();
        data.addColumn("date", "Date");
        data.addColumn("number", "New");
        data.addColumn("number", "Review");

        let options = {
            isStacked: true,
            legend: { position: "bottom" },
            colors: ["#FF9F1C", "#1a80d9"],
            chartArea: { width: "85%", height: "70%" },
            vAxis: { viewWindow: { min: 0 } }
        };

        // --- SPECIAL LOGIC FOR "DAY" VIEW (Current Month Calendar) ---
        if (group === "day") {
            const today = new Date();
            const year = today.getFullYear();
            const month = today.getMonth(); // 0-indexed

            // 1. Determine start and end of current month
            const startDate = new Date(year, month, 1);
            const endDate = new Date(year, month + 1, 0); 

            // 2. Pre-fill map for every day in the month
            const dailyMap = new Map();
            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                const key = d.toISOString().slice(0, 10);
                dailyMap.set(key, { new: 0, rev: 0, dateObj: new Date(d) });
            }

            // 3. Populate with history data
            reviewHistory.forEach(h => {
                const key = h.timestamp.slice(0, 10);
                if (dailyMap.has(key)) {
                    const entry = dailyMap.get(key);
                    if (h.review_type === 'new') entry.new++;
                    else entry.rev++;
                }
            });

            // 4. Convert to rows
            for (const [key, val] of dailyMap.entries()) {
                data.addRow([val.dateObj, val.new, val.rev]);
            }

            options.hAxis = { 
                format: 'd', // Show only day number
                gridlines: { color: 'transparent' },
                ticks: [] 
            };
            
            // Remove gaps between bars
            options.bar = { groupWidth: '90%' }; 
            
        } else {
            // --- STANDARD LOGIC FOR WEEK/MONTH/YEAR ---
            const dataMap = {};

            reviewHistory.forEach(h => {
                let key = h.timestamp.slice(0, 10);
                if (group === "month") key = key.slice(0, 7); 
                if (group === "year") key = key.slice(0, 4);  

                if (!dataMap[key]) dataMap[key] = { new: 0, rev: 0 };

                if (h.review_type === 'new') dataMap[key].new++;
                else dataMap[key].rev++;
            });

            const keys = Object.keys(dataMap).sort();
            keys.forEach(k => {
                const parts = k.split("-").map(Number);
                const dt = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
                data.addRow([dt, dataMap[k].new, dataMap[k].rev]);
            });

            let format = "MMM d";
            if (group === "month") format = "MMM";
            if (group === "year") format = "yyyy";
            
            options.hAxis = { format: format };
            options.bar = { groupWidth: '60%' }; 
        }

        const chart = new google.visualization.ColumnChart(document.getElementById("chart-div"));
        chart.draw(data, options);
        
        document.getElementById("report-summary").textContent = `Total Reviews: ${reviewHistory.length}`;
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
        drawChart,
        drawStatusChart,
        drawMasteryHistoryChart,
        handleSearch,
        clearSearch,
        setFilter
    };
})();

window.App = App;
