// ====================== APP.JS COMPLETO E DEFINITIVO (MARZO 2026) ======================

let currentSymbol = "BTCUSDT";
let currentExchange = localStorage.getItem('currentExchange') || "bybit";
let charts = {};
let candleSeries = {};
let seriesData = {};                    
let emaSeries = {};
let bbSeries = {};
let lastCandleTime = {};
let priceLines = {};
let alertLines = {};
let rulerLines = {};
let activeHorizPrice = null;
let rulerMode = false;
let rulerPrice = null;
let fullscreenActive = false;
let fullscreenChart = null;
let fullscreenContainerId = null;

let lastFetchTimes = {};
let listScrollPosition = 0;

let emaPeriods = [5, 10, 60, 223];
let emaEnabled = true;
let bbEnabled = false;
let bbPeriod = 20;
let bbDev = 2;
let symbolPricePrecision = 2;

let favorites = JSON.parse(localStorage.getItem('favoriteSymbols') || '[]');
let savedHorizPrices = JSON.parse(localStorage.getItem('favoriteHorizPrices') || '{}');
let alertPrices = JSON.parse(localStorage.getItem('alertPrices') || '{}');
let syncPrices = JSON.parse(localStorage.getItem('syncPrices') || '{}');

let customIntervals = { "chart-5m": "5", "chart-30m": "30", "chart-4h": "240", "chart-1d": "D" };
let customLabels = { "1": "1m", "3": "3m", "5": "5m", "15": "15m", "30": "30m", "60": "1h", "240": "4h", "D": "1d" };

let currentSort = "volume";
let allPairsData = [];

let personalTGToken = localStorage.getItem('personalTGToken') || '';
let personalTGChatID = localStorage.getItem('personalTGChatID') || '';

const SERVER_URL = "https://srazu-bot.onrender.com";
const spaceBarsCount = 8; // Spazio a destra per vedere la candela in corso
const visibleBarsCount = 40;

const EMA_COLORS = ["#FFD700", "#FF9800", "#40C4FF", "#E040FB"];
const BB_COLORS = { middle: "#FFFF00", upper: "#888888", lower: "#888888" };
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

let deviceId = localStorage.getItem('deviceId') || (function() {
    const id = crypto.randomUUID();
    localStorage.setItem('deviceId', id);
    return id;
})();

// ==================== FUNZIONI UTILITY ====================
function setRealViewportHeight() {
    document.documentElement.style.setProperty('--real-vh', `${window.innerHeight}px`);
}

function formatPrice(price) {
    const num = parseFloat(price);
    if (isNaN(num)) return "0";
    return num < 1 ? num.toFixed(6) : num.toFixed(2);
}

function getPricePrecision(priceStr) {
    if (!priceStr || !priceStr.includes('.')) return 2;
    return priceStr.split('.')[1].length;
}

function getTimeFormatter(interval) {
    return t => {
        const d = new Date(t * 1000);
        if (interval === "D") return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
        return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    };
}

function nextEMA(prev, price, period) {
    const k = 2 / (period + 1);
    return price * k + prev * (1 - k);
}

// ==================== CORE CHART LOGIC ====================
function applyVisibleRange(chart, series) {
    const data = seriesData[Object.keys(seriesData).find(k => candleSeries[k] === series)] || [];
    if (data.length === 0) return;
    const logicalRange = chart.timeScale().getVisibleLogicalRange();
    if (logicalRange) return; // Non resettare se l'utente ha già zoomato

    chart.timeScale().setVisibleLogicalRange({
        from: data.length - visibleBarsCount,
        to: data.length + spaceBarsCount
    });
}

async function fetchKlines(symbol, interval, limit = 500) {
    let baseUrl = "";
    const binanceMap = {"1":"1m","3":"3m","5":"5m","15":"15m","30":"30m","60":"1h","240":"4h","D":"1d"};
    if (currentExchange === "bybit") {
        baseUrl = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`;
    } else {
        const bInterval = binanceMap[interval] || interval;
        baseUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${bInterval}&limit=${limit}`;
    }
    try {
        const response = await fetch(baseUrl);
        const data = await response.json();
        let raw = currentExchange === "bybit" ? (data.result?.list || []) : data;
        const klines = raw.map(c => ({
            time: Number(c[0]) / 1000,
            open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4])
        }));
        return currentExchange === "bybit" ? klines.reverse() : klines;
    } catch (e) { return []; }
}

async function createChart(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    const interval = customIntervals[containerId];
    const klines = await fetchKlines(currentSymbol, interval);
    if (!klines.length) return;

    symbolPricePrecision = getPricePrecision(klines.at(-1).close.toString());

    const chart = LightweightCharts.createChart(container, {
        layout: { background: { type: 'solid', color: '#0f1117' }, textColor: '#d1d4dc' },
        grid: { horzLines: { color: '#222' }, vertLines: { color: '#222' } },
        timeScale: { timeVisible: true, rightOffset: spaceBarsCount, tickMarkFormatter: getTimeFormatter(interval) },
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

    // EMA & Bollinger
    if (emaEnabled) {
        emaSeries[containerId] = [];
        emaPeriods.forEach((p, i) => createEMA(emaSeries[containerId], chart, klines, p, EMA_COLORS[i]));
    }
    
    applyVisibleRange(chart, series);
    syncHorizLines();

    // Click per linea orizzontale
    chart.subscribeClick(p => {
        if (!p.point) return;
        const price = series.coordinateToPrice(p.point.y);
        if (rulerMode) { rulerPrice = price; } else { activeHorizPrice = price; saveHorizIfFavorite(); }
        syncHorizLines();
    });

    chart.subscribeDblClick(() => {
        activeHorizPrice = null;
        saveHorizIfFavorite();
        syncHorizLines();
    });
}

function createEMA(seriesArray, chart, klines, period, color) {
    const s = chart.addLineSeries({ color: color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    let ema = null;
    const data = [];
    klines.forEach((c, i) => {
        if (i === period - 1) ema = klines.slice(0, period).reduce((a,b) => a + b.close, 0) / period;
        else if (i >= period) ema = nextEMA(ema, c.close, period);
        if (ema != null) data.push({ time: c.time, value: ema });
    });
    s.setData(data);
    seriesArray.push({ series: s, period, last: ema, data });
}

// ==================== LINE SYNC & RULER ====================
function syncHorizLines() {
    const all = [...Object.keys(candleSeries)];
    if (fullscreenActive) all.push("fullscreen");

    all.forEach(key => {
        const s = key === "fullscreen" ? fullscreenChart.series : candleSeries[key];
        if (!s) return;

        // Linea Gialla (Prezzo Sync)
        if (priceLines[key]) { s.removePriceLine(priceLines[key]); }
        if (activeHorizPrice) {
            priceLines[key] = s.createPriceLine({
                price: activeHorizPrice, color: '#FFFF00', lineWidth: 1,
                lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true
            });
        }

        // Linea Ruler (Verde)
        if (rulerLines[key]) { s.removePriceLine(rulerLines[key]); }
        if (rulerMode && rulerPrice) {
            rulerLines[key] = s.createPriceLine({
                price: rulerPrice, color: '#00FF00', lineWidth: 1,
                lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true
            });
        }
        
        // Alert Line (Gold)
        if (alertLines[key]) { s.removePriceLine(alertLines[key]); }
        if (alertPrices[currentSymbol]) {
            alertLines[key] = s.createPriceLine({
                price: alertPrices[currentSymbol], color: '#FFD700', lineWidth: 1,
                lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true
            });
        }
    });
    updateRulerPercentage();
}

function updateRulerPercentage() {
    const text = (rulerMode && rulerPrice && activeHorizPrice) 
        ? `${(((rulerPrice - activeHorizPrice) / activeHorizPrice) * 100).toFixed(2)}%` 
        : "";
    document.querySelectorAll('.title-pct').forEach(el => el.textContent = text);
}

function saveHorizIfFavorite() {
    if (favorites.includes(currentSymbol)) {
        if (activeHorizPrice) savedHorizPrices[currentSymbol] = activeHorizPrice;
        else delete savedHorizPrices[currentSymbol];
        localStorage.setItem('favoriteHorizPrices', JSON.stringify(savedHorizPrices));
    }
}

// ==================== UI & MODALS ====================
function setupUIListeners() {
    // Exchange e Sort
    document.getElementById("exchange-select").onchange = (e) => {
        currentExchange = e.target.value;
        localStorage.setItem('currentExchange', currentExchange);
        loadAllCharts(currentSymbol);
        fetchPairs();
    };

    document.getElementById("sort-select").onchange = (e) => {
        currentSort = e.target.value;
        populateList(currentSort);
    };

    // Modali
    const settingsModal = document.getElementById("settings-modal");
    document.getElementById("settings-btn").onclick = () => settingsModal.style.display = "block";
    
    const infoModal = document.getElementById("info-modal");
    document.getElementById("info-btn").onclick = () => infoModal.style.display = "block";

    document.querySelectorAll(".close").forEach(btn => {
        btn.onclick = () => {
            settingsModal.style.display = "none";
            infoModal.style.display = "none";
        };
    });

    // Toggle EMA/BB
    document.getElementById("toggle-ema").onclick = (e) => {
        emaEnabled = !emaEnabled;
        e.target.textContent = `EMA: ${emaEnabled ? 'On' : 'Off'}`;
        document.getElementById("ema-periods-section").style.display = emaEnabled ? "block" : "none";
    };

    // Apply Settings
    document.getElementById("apply-settings").onclick = () => {
        customIntervals["chart-5m"] = document.getElementById("tf-chart-5m").value;
        customIntervals["chart-30m"] = document.getElementById("tf-chart-30m").value;
        customIntervals["chart-4h"] = document.getElementById("tf-chart-4h").value;
        customIntervals["chart-1d"] = document.getElementById("tf-chart-1d").value;
        
        personalTGToken = document.getElementById("personal-tg-token").value;
        personalTGChatID = document.getElementById("personal-tg-chatid").value;
        localStorage.setItem('personalTGToken', personalTGToken);
        localStorage.setItem('personalTGChatID', personalTGChatID);
        
        settingsModal.style.display = "none";
        loadAllCharts(currentSymbol);
    };

    // Fullscreen
    document.querySelectorAll(".title-fullscreen").forEach(btn => {
        btn.onclick = () => {
            const wrapper = btn.closest('.chart-wrapper');
            const containerId = wrapper.querySelector('.chart-container').id;
            openFullscreen(containerId);
        };
    });

    document.getElementById("close-fullscreen").onclick = closeFullscreen;

    // Ruler Toggle
    document.querySelectorAll(".title-ruler").forEach(btn => {
        btn.onclick = () => {
            rulerMode = !rulerMode;
            rulerPrice = null;
            document.querySelectorAll(".title-ruler").forEach(r => r.style.opacity = rulerMode ? "1" : "0.5");
            syncHorizLines();
        };
    });

    // Alert Panel
    document.querySelectorAll(".title-bell").forEach(btn => {
        btn.onclick = () => {
            document.getElementById("alert-symbol").textContent = currentSymbol;
            document.getElementById("alert-price-input").value = activeHorizPrice || "";
            document.getElementById("alert-setup").style.display = "block";
        };
    });
    document.getElementById("close-alert-setup").onclick = () => document.getElementById("alert-setup").style.display = "none";
    
    document.getElementById("set-local-alert").onclick = () => {
        const price = parseFloat(document.getElementById("alert-price-input").value);
        if (price) {
            alertPrices[currentSymbol] = price;
            localStorage.setItem('alertPrices', JSON.stringify(alertPrices));
            syncHorizLines();
            // Qui andrebbe la chiamata al tuo SERVER_URL per l'alert TG
            alert("Alert set at " + price);
        }
        document.getElementById("alert-setup").style.display = "none";
    };
}

// ==================== FULLSCREEN LOGIC ====================
function openFullscreen(containerId) {
    const overlay = document.getElementById("fullscreen-overlay");
    const fsDiv = document.getElementById("fullscreen-chart");
    fsDiv.innerHTML = "";
    
    const interval = customIntervals[containerId];
    document.querySelector("#fullscreen-title .title-text").textContent = `${currentSymbol} - ${customLabels[interval]}`;

    const chart = LightweightCharts.createChart(fsDiv, {
        layout: { background: { type: 'solid', color: '#0f1117' }, textColor: '#d1d4dc' },
        timeScale: { timeVisible: true, rightOffset: spaceBarsCount },
        width: fsDiv.clientWidth, height: fsDiv.clientHeight
    });

    const series = chart.addCandlestickSeries({ upColor: '#ffffff', downColor: '#0051D4', borderVisible: false });
    series.setData(seriesData[containerId]);

    fullscreenChart = { chart, series, containerId };
    fullscreenActive = true;
    overlay.style.display = "block";
    
    syncHorizLines();

    chart.subscribeClick(p => {
        if (!p.point) return;
        const price = series.coordinateToPrice(p.point.y);
        if (rulerMode) { rulerPrice = price; } else { activeHorizPrice = price; saveHorizIfFavorite(); }
        syncHorizLines();
    });
}

function closeFullscreen() {
    document.getElementById("fullscreen-overlay").style.display = "none";
    fullscreenActive = false;
    if (fullscreenChart) {
        fullscreenChart.chart.remove();
        fullscreenChart = null;
    }
}

// ==================== LIVE DATA & PAIRS ====================
async function fetchPairs() {
    try {
        let url = currentExchange === "bybit" 
            ? "https://api.bybit.com/v5/market/tickers?category=linear" 
            : "https://fapi.binance.com/fapi/v1/ticker/24hr";
        const res = await fetch(url);
        const data = await res.json();
        const raw = currentExchange === "bybit" ? data.result.list : data;
        
        allPairsData = raw.map(t => ({
            s: t.symbol,
            price: t.lastPrice,
            p: currentExchange === "bybit" ? (parseFloat(t.price24hPcnt)*100) : parseFloat(t.priceChangePercent),
            v: currentExchange === "bybit" ? parseFloat(t.turnover24h) : parseFloat(t.quoteVolume)
        })).filter(p => p.s.endsWith("USDT"));

        populateList(currentSort);
    } catch(e) {}
}

function populateList(sort) {
    const list = document.getElementById("pairs-list");
    list.innerHTML = "";
    
    let sorted = [...allPairsData];
    if (sort === "gainers") sorted.sort((a,b) => b.p - a.p);
    else if (sort === "losers") sorted.sort((a,b) => a.p - b.p);
    else sorted.sort((a,b) => b.v - a.v);

    sorted.slice(0, 100).forEach(p => {
        const div = document.createElement("div");
        div.className = `pair ${p.s === currentSymbol ? 'active' : ''}`;
        div.innerHTML = `
            <span>${p.s.replace("USDT", "")}</span>
            <span>${formatPrice(p.price)}</span>
            <span style="color:${p.p >= 0 ? '#00ff85' : '#ff4444'}">${p.p.toFixed(2)}%</span>
        `;
        div.onclick = () => loadAllCharts(p.s);
        list.appendChild(div);
    });
}

async function updateLive() {
    for (const id in customIntervals) {
        if (!candleSeries[id]) continue;
        const k = await fetchKlines(currentSymbol, customIntervals[id], 2);
        if (k.length) {
            const candle = k[k.length-1];
            candleSeries[id].update(candle);
            if (fullscreenActive && fullscreenChart && fullscreenChart.containerId === id) {
                fullscreenChart.series.update(candle);
            }
        }
    }
}

async function loadAllCharts(symbol) {
    currentSymbol = symbol;
    activeHorizPrice = savedHorizPrices[symbol] || null;
    const tasks = Object.keys(customIntervals).map(id => createChart(id));
    await Promise.all(tasks);
    document.querySelectorAll(".pair").forEach(el => el.classList.remove("active"));
}

// ==================== INIT ====================
window.onload = async () => {
    setRealViewportHeight();
    setupUIListeners();
    await fetchPairs();
    await loadAllCharts(currentSymbol);
    setInterval(updateLive, 3000);
    setInterval(fetchPairs, 10000);
};

window.onresize = () => {
    setRealViewportHeight();
    Object.keys(charts).forEach(id => {
        const c = document.getElementById(id);
        if (charts[id] && c) charts[id].resize(c.clientWidth, c.clientHeight);
    });
};
