/**
 * SRAZU - Crypto Price Action Engine
 * Versione Integrale Corretta - Marzo 2026
 */

// --- CONFIGURAZIONE E STATO ---
let currentSymbol = "BTCUSDT";
let currentExchange = localStorage.getItem('currentExchange') || "bybit";
let charts = {};
let candleSeries = {};
let seriesData = {};
let emaSeries = {};
let lastCandleTime = {};
let priceLines = {};
let alertLines = {};
let rulerLines = {};

let activeHorizPrice = null;
let rulerMode = false;
let rulerPrice = null;
let fullscreenActive = false;
let fullscreenChart = null;

let emaEnabled = true;
let emaPeriods = [5, 10, 60, 223];
const EMA_COLORS = ["#FFD700", "#FF9800", "#40C4FF", "#E040FB"];

let favorites = JSON.parse(localStorage.getItem('favoriteSymbols') || '[]');
let savedHorizPrices = JSON.parse(localStorage.getItem('favoriteHorizPrices') || '{}');
let alertPrices = JSON.parse(localStorage.getItem('alertPrices') || '{}');

let customIntervals = { "chart-5m": "5", "chart-30m": "30", "chart-4h": "240", "chart-1d": "D" };
let customLabels = { "1": "1m", "3": "3m", "5": "5m", "15": "15m", "30": "30m", "60": "1h", "240": "4h", "D": "1d" };

const spaceBarsCount = 3; // Richiesto: spazio ridotto
const visibleBarsCount = 60;

// --- UTILS ---
function formatPrice(price) {
    const num = parseFloat(price);
    if (isNaN(num)) return "0";
    return num < 1 ? num.toFixed(6) : num.toFixed(2);
}

function getTimeFormatter(interval) {
    return t => {
        const d = new Date(t * 1000);
        if (interval === "D") return `${d.getDate()}/${d.getMonth()+1}`;
        return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    };
}

// --- FETCH DATA ---
async function fetchKlines(symbol, interval, limit = 500) {
    let url = "";
    if (currentExchange === "bybit") {
        url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`;
    } else {
        const bMap = {"1":"1m","3":"3m","5":"5m","15":"15m","30":"30m","60":"1h","240":"4h","D":"1d"};
        url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${bMap[interval] || interval}&limit=${limit}`;
    }
    try {
        const response = await fetch(url);
        const data = await response.json();
        let raw = currentExchange === "bybit" ? (data.result?.list || []) : data;
        const klines = raw.map(c => ({
            time: Number(c[0]) / 1000,
            open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4])
        }));
        return currentExchange === "bybit" ? klines.reverse() : klines;
    } catch (e) { return []; }
}

// --- CORE CHART CREATION ---
async function createChart(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    
    const interval = customIntervals[containerId];
    const klines = await fetchKlines(currentSymbol, interval);
    if (!klines.length) return;

    const chart = LightweightCharts.createChart(container, {
        layout: { background: { type: 'solid', color: '#0f1117' }, textColor: '#d1d4dc' },
        grid: { horzLines: { color: '#222' }, vertLines: { color: '#222' } },
        timeScale: { 
            timeVisible: true, 
            rightOffset: spaceBarsCount, 
            tickMarkFormatter: getTimeFormatter(interval) 
        },
        width: container.clientWidth,
        height: container.clientHeight
    });

    const series = chart.addCandlestickSeries({
        upColor: '#ffffff', downColor: '#0051D4', borderVisible: false,
        wickUpColor: '#cccccc', wickDownColor: '#0051D4'
    });

    series.setData(klines);
    seriesData[containerId] = klines;
    candleSeries[containerId] = series;
    charts[containerId] = chart;
    lastCandleTime[containerId] = klines.at(-1).time;

    // EMA
    if (emaEnabled) {
        emaPeriods.forEach((p, i) => {
            const line = chart.addLineSeries({ color: EMA_COLORS[i], lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
            let emaVal = null;
            const emaData = [];
            klines.forEach((c, idx) => {
                if (idx === p - 1) emaVal = klines.slice(0, p).reduce((a,b)=>a+b.close,0)/p;
                else if (idx >= p) emaVal = c.close * (2/(p+1)) + emaVal * (1-(2/(p+1)));
                if (emaVal) emaData.push({ time: c.time, value: emaVal });
            });
            line.setData(emaData);
        });
    }

    // Interaction
    chart.subscribeClick(p => {
        if (!p.point) return;
        const price = series.coordinateToPrice(p.point.y);
        if (rulerMode) rulerPrice = price; else activeHorizPrice = price;
        syncHorizLines();
    });

    chart.subscribeDblClick(() => { activeHorizPrice = null; syncHorizLines(); });

    // Titolo
    const titleEl = document.querySelector(`#title-${containerId.split('-')[1]} .title-text`);
    if(titleEl) titleEl.textContent = `${currentSymbol} - ${customLabels[interval]}`;

    syncHorizLines();
}

// --- FULLSCREEN LOGIC (FIXED) ---
function openFullscreen(containerId) {
    const overlay = document.getElementById("fullscreen-overlay");
    const fsDiv = document.getElementById("fullscreen-chart");
    
    fsDiv.innerHTML = "";
    overlay.style.display = "block"; // Mostra prima per calcolare i pixel

    setTimeout(() => {
        const interval = customIntervals[containerId];
        document.querySelector("#fullscreen-title .title-text").textContent = `${currentSymbol} - ${customLabels[interval]}`;

        const chart = LightweightCharts.createChart(fsDiv, {
            layout: { background: { type: 'solid', color: '#0f1117' }, textColor: '#d1d4dc' },
            timeScale: { timeVisible: true, rightOffset: spaceBarsCount },
            width: fsDiv.clientWidth,
            height: fsDiv.clientHeight
        });

        const series = chart.addCandlestickSeries({ upColor: '#ffffff', downColor: '#0051D4', borderVisible: false });
        series.setData(seriesData[containerId]);

        fullscreenChart = { chart, series, containerId };
        fullscreenActive = true;
        
        syncHorizLines();

        chart.subscribeClick(p => {
            if (!p.point) return;
            const price = series.coordinateToPrice(p.point.y);
            if (rulerMode) rulerPrice = price; else activeHorizPrice = price;
            syncHorizLines();
        });
    }, 50);
}

function closeFullscreen() {
    document.getElementById("fullscreen-overlay").style.display = "none";
    fullscreenActive = false;
    if (fullscreenChart) {
        fullscreenChart.chart.remove();
        fullscreenChart = null;
    }
}

// --- SYNC LINES ---
function syncHorizLines() {
    const targets = [...Object.keys(candleSeries)];
    if (fullscreenActive && fullscreenChart) targets.push("fullscreen");

    targets.forEach(key => {
        const s = (key === "fullscreen") ? fullscreenChart.series : candleSeries[key];
        if (!s) return;

        if (priceLines[key]) s.removePriceLine(priceLines[key]);
        if (activeHorizPrice) {
            priceLines[key] = s.createPriceLine({
                price: activeHorizPrice, color: '#FFFF00', lineWidth: 1, axisLabelVisible: true
            });
        }

        if (rulerLines[key]) s.removePriceLine(rulerLines[key]);
        if (rulerMode && rulerPrice) {
            rulerLines[key] = s.createPriceLine({
                price: rulerPrice, color: '#00FF00', lineWidth: 1, lineStyle: 2, axisLabelVisible: true
            });
        }
    });

    // Update Percentage
    const pct = (rulerMode && rulerPrice && activeHorizPrice) 
        ? `${(((rulerPrice - activeHorizPrice) / activeHorizPrice) * 100).toFixed(2)}%` 
        : "";
    document.querySelectorAll('.title-pct').forEach(el => el.textContent = pct);
}

// --- LIST & UI ---
async function fetchPairs() {
    try {
        let url = currentExchange === "bybit" ? "https://api.bybit.com/v5/market/tickers?category=linear" : "https://fapi.binance.com/fapi/v1/ticker/24hr";
        const res = await fetch(url);
        const data = await res.json();
        const raw = currentExchange === "bybit" ? data.result.list : data;
        
        const list = document.getElementById("pairs-list");
        list.innerHTML = "";
        
        const pairs = raw.map(t => ({
            s: t.symbol,
            p: t.lastPrice,
            c: currentExchange === "bybit" ? (parseFloat(t.price24hPcnt)*100) : parseFloat(t.priceChangePercent),
            v: currentExchange === "bybit" ? parseFloat(t.turnover24h) : parseFloat(t.quoteVolume)
        })).filter(x => x.s.endsWith("USDT"));

        // Sorting
        const sortVal = document.getElementById("sort-select").value;
        if (sortVal === "gainers") pairs.sort((a,b)=>b.c - a.c);
        else if (sortVal === "losers") pairs.sort((a,b)=>a.c - b.c);
        else pairs.sort((a,b)=>b.v - a.v);

        pairs.slice(0, 50).forEach(pair => {
            const div = document.createElement("div");
            div.className = `pair ${pair.s === currentSymbol ? 'active' : ''}`;
            div.innerHTML = `<span>${pair.s.replace("USDT","")}</span> <span>${formatPrice(pair.p)}</span> <span style="color:${pair.c>=0?'#00ff85':'#ff4444'}">${pair.c.toFixed(2)}%</span>`;
            div.onclick = () => loadAllCharts(pair.s);
            list.appendChild(div);
        });
    } catch(e) {}
}

async function loadAllCharts(symbol) {
    currentSymbol = symbol;
    for (const id in customIntervals) await createChart(id);
    fetchPairs();
}

// --- INITIALIZATION ---
function setupListeners() {
    document.getElementById("exchange-select").onchange = (e) => {
        currentExchange = e.target.value;
        localStorage.setItem('currentExchange', currentExchange);
        loadAllCharts(currentSymbol);
    };

    document.getElementById("sort-select").onchange = fetchPairs;

    document.getElementById("settings-btn").onclick = () => document.getElementById("settings-modal").style.display = "block";
    document.getElementById("info-btn").onclick = () => document.getElementById("info-modal").style.display = "block";
    
    document.querySelectorAll(".close").forEach(btn => {
        btn.onclick = () => {
            document.getElementById("settings-modal").style.display = "none";
            document.getElementById("info-modal").style.display = "none";
        };
    });

    document.getElementById("apply-settings").onclick = () => {
        customIntervals["chart-5m"] = document.getElementById("tf-chart-5m").value;
        customIntervals["chart-30m"] = document.getElementById("tf-chart-30m").value;
        customIntervals["chart-4h"] = document.getElementById("tf-chart-4h").value;
        customIntervals["chart-1d"] = document.getElementById("tf-chart-1d").value;
        document.getElementById("settings-modal").style.display = "none";
        loadAllCharts(currentSymbol);
    };

    document.querySelectorAll(".title-fullscreen").forEach(btn => {
        btn.onclick = () => openFullscreen(btn.closest('.chart-wrapper').querySelector('.chart-container').id);
    });

    document.getElementById("close-fullscreen").onclick = closeFullscreen;

    document.querySelectorAll(".title-ruler").forEach(btn => {
        btn.onclick = () => {
            rulerMode = !rulerMode;
            rulerPrice = null;
            document.querySelectorAll(".title-ruler").forEach(r => r.style.opacity = rulerMode ? "1" : "0.5");
            syncHorizLines();
        };
    });
}

window.onload = () => {
    setupListeners();
    loadAllCharts(currentSymbol);
    setInterval(fetchPairs, 10000);
};

window.onresize = () => {
    Object.keys(charts).forEach(id => {
        const c = document.getElementById(id);
        if (charts[id] && c) charts[id].resize(c.clientWidth, c.clientHeight);
    });
};
