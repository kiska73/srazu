// ====================== APP.JS COMPLETO E DEFINITIVO (30 MARZO 2026) ======================

let currentSymbol = "ETHUSDT";
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
let fullscreenContainerId = null;
let fullscreenEMA = [];

let lastFetchTimes = {};

let emaPeriods = [5, 10, 60, 223];
let emaEnabled = true;
let symbolPricePrecision = 2;

let favorites = JSON.parse(localStorage.getItem('favoriteSymbols') || '[]');
let savedHorizPrices = JSON.parse(localStorage.getItem('favoriteHorizPrices') || '{}');

let customIntervals = { "chart-5m": "5", "chart-30m": "30", "chart-4h": "240", "chart-1d": "D" };
let customLabels = { "5": "5m", "30": "30m", "240": "4h", "D": "1d" };

let allPairsData = [];

const visibleBarsCount = 35;
const spaceBarsCount = 10;           // ← Più spazio a destra (regolalo se serve)
const EMA_COLORS = ["#FFD700", "#FF9800", "#40C4FF", "#E040FB"];

const SERVER_URL = "https://srazu-bot.onrender.com";

// ==================== UTILITY ====================
function setRealViewportHeight() {
    document.documentElement.style.setProperty('--real-vh', `${window.innerHeight}px`);
}

function formatPrice(price) {
    return parseFloat(price).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

function getTimeFormatter(interval) {
    return t => {
        const d = new Date(t * 1000);
        return interval === "D" 
            ? `${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]}`
            : `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    };
}

function nextEMA(prev, price, period) {
    const k = 2 / (period + 1);
    return price * k + prev * (1 - k);
}

function applyVisibleRange(chart, data) {
    if (!chart || !data || data.length === 0) return;
    if (chart.timeScale().getVisibleLogicalRange()) return;

    const len = data.length;
    chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, len - visibleBarsCount),
        to: len + spaceBarsCount
    });
}

// ==================== LINES ====================
function syncHorizLines() {
    Object.keys(candleSeries).forEach(k => {
        updatePriceLineOnSeries(candleSeries[k], k);
        updateAlertLineOnSeries(candleSeries[k], k);
        if (rulerMode && rulerPrice !== null) updateRulerLineOnSeries(candleSeries[k], k);
    });
    if (fullscreenActive && fullscreenChart) {
        updatePriceLineOnSeries(fullscreenChart.series, "fullscreen");
        updateAlertLineOnSeries(fullscreenChart.series, "fullscreen");
        if (rulerMode && rulerPrice !== null) updateRulerLineOnSeries(fullscreenChart.series, "fullscreen");
    }
}

function updatePriceLineOnSeries(series, key) {
    if (priceLines[key]) { series.removePriceLine(priceLines[key]); delete priceLines[key]; }
    if (activeHorizPrice == null) return;
    const line = series.createPriceLine({ price: activeHorizPrice, color: "#FFFF00", lineWidth: 1, draggable: true });
    line.applyOptions({ onDrag: l => { activeHorizPrice = l.price; syncHorizLines(); } });
    priceLines[key] = line;
}

function updateAlertLineOnSeries(series, key) {
    if (alertLines[key]) { series.removePriceLine(alertLines[key]); delete alertLines[key]; }
    const p = alertPrices[currentSymbol];
    if (p == null) return;
    series.createPriceLine({ price: p, color: "#FFD700", lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed });
}

function updateRulerLineOnSeries(series, key) {
    if (rulerLines[key]) { series.removePriceLine(rulerLines[key]); delete rulerLines[key]; }
    if (rulerPrice === null) return;
    series.createPriceLine({ price: rulerPrice, color: "#00FF00", lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dashed });
}

// ==================== CREATE CHART ====================
async function createChart(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    const interval = customIntervals[containerId];
    const label = customLabels[interval] || interval;

    const klines = await fetchKlines(currentSymbol, interval);
    if (!klines.length) return;

    symbolPricePrecision = (klines.at(-1).close.toString().split('.')[1] || '').length || 2;

    const chart = LightweightCharts.createChart(container, {
        layout: { background: { type: 'solid', color: '#0f1117' }, textColor: '#d1d4dc' },
        grid: { horzLines: { color: '#222' }, vertLines: { color: '#222' } },
        timeScale: { timeVisible: true, tickMarkFormatter: getTimeFormatter(interval) }
    });

    const series = chart.addCandlestickSeries({
        upColor: '#ffffff',
        downColor: '#0051D4',
        wickUpColor: '#cccccc',
        wickDownColor: '#0051D4'
    });

    series.setData(klines);
    seriesData[containerId] = [...klines];
    lastCandleTime[containerId] = klines.at(-1).time;
    emaSeries[containerId] = [];

    if (emaEnabled) {
        emaPeriods.forEach((p, i) => {
            const s = chart.addLineSeries({ color: EMA_COLORS[i], lineWidth: 1.2 });
            let ema = null;
            const data = [];
            klines.forEach((c, idx) => {
                if (idx === p - 1) ema = klines.slice(0, p).reduce((a,b)=>a+b.close,0)/p;
                else if (idx >= p) ema = nextEMA(ema, c.close, p);
                if (ema != null) data.push({time: c.time, value: ema});
            });
            s.setData(data);
            emaSeries[containerId].push({series: s, period: p, last: ema, data});
        });
    }

    updatePriceLineOnSeries(series, containerId);
    updateAlertLineOnSeries(series, containerId);

    applyVisibleRange(chart, seriesData[containerId]);

    chart.subscribeClick(p => {
        if (p?.point) {
            const price = series.coordinateToPrice(p.point.y);
            if (rulerMode) rulerPrice = price;
            else activeHorizPrice = price;
            syncHorizLines();
        }
    });

    charts[containerId] = chart;
    candleSeries[containerId] = series;
}

// ==================== FULLSCREEN ====================
function openFullscreen(containerId, tfLabel) {
    const overlay = document.getElementById("fullscreen-overlay");
    const fsDiv = document.getElementById("fullscreen-chart");
    fsDiv.innerHTML = "";

    const fsTitle = document.getElementById("fullscreen-title");
    fsTitle.querySelector('.title-text').textContent = `${currentSymbol} - ${tfLabel}`;

    const chart = LightweightCharts.createChart(fsDiv, {
        layout: { background: { type: 'solid', color: '#0f1117' } },
        grid: { horzLines: { color: '#222' }, vertLines: { color: '#222' } },
        timeScale: { timeVisible: true }
    });

    const series = chart.addCandlestickSeries(candleSeries[containerId].options());
    series.setData(seriesData[containerId]);

    fullscreenEMA = [];
    if (emaEnabled && emaSeries[containerId]) {
        emaSeries[containerId].forEach((e, i) => {
            const s = chart.addLineSeries({ color: EMA_COLORS[i], lineWidth: 1.2 });
            s.setData(e.data);
            fullscreenEMA.push({series: s, period: e.period, last: e.last});
        });
    }

    updatePriceLineOnSeries(series, "fullscreen");
    updateAlertLineOnSeries(series, "fullscreen");
    if (rulerMode && rulerPrice !== null) updateRulerLineOnSeries(series, "fullscreen");

    applyVisibleRange(chart, seriesData[containerId]);

    chart.subscribeClick(p => {
        if (p?.point) {
            const price = series.coordinateToPrice(p.point.y);
            if (rulerMode) rulerPrice = price;
            else activeHorizPrice = price;
            syncHorizLines();
        }
    });

    overlay.style.display = "block";
    fullscreenActive = true;
    fullscreenChart = { chart, series };
    fullscreenContainerId = containerId;
}

function closeFullscreen() {
    if (fullscreenChart?.chart) fullscreenChart.chart.remove();
    document.getElementById("fullscreen-overlay").style.display = "none";
    fullscreenActive = false;
    fullscreenChart = null;
    fullscreenEMA = [];
}

// ==================== FETCH ====================
async function fetchKlines(symbol, interval, limit = 500) {
    const url = currentExchange === "bybit" 
        ? `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`
        : `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

    try {
        const res = await fetch(url);
        const json = await res.json();
        const list = currentExchange === "bybit" ? (json.result?.list || []) : json;
        return list.map(c => ({
            time: Number(c[0])/1000,
            open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4])
        })).reverse();
    } catch (e) {
        console.error("Klines error:", e);
        return [];
    }
}

async function fetchLatestCandle(symbol, interval) {
    const k = await fetchKlines(symbol, interval, 2);
    return k.length ? k[0] : null;
}

// ==================== UPDATE LIVE ====================
async function updateLive() {
    // Grafici normali
    for (const id in customIntervals) {
        const series = candleSeries[id];
        if (!series) continue;

        const latest = await fetchLatestCandle(currentSymbol, customIntervals[id]);
        if (!latest) continue;

        series.update(latest);

        if (!seriesData[id]) seriesData[id] = [];
        const idx = seriesData[id].findIndex(c => c.time === latest.time);
        if (idx >= 0) seriesData[id][idx] = {...latest};
        else seriesData[id].push(latest);

        if (latest.time > (lastCandleTime[id] || 0)) {
            lastCandleTime[id] = latest.time;

            if (emaEnabled && emaSeries[id]) {
                emaSeries[id].forEach(e => {
                    e.last = nextEMA(e.last, latest.close, e.period);
                    e.series.update({ time: latest.time, value: e.last });
                });
            }
        }

        // Mantieni spazio a destra
        const chart = charts[id];
        if (chart) applyVisibleRange(chart, seriesData[id]);
    }

    // Fullscreen
    if (fullscreenActive && fullscreenChart && fullscreenContainerId) {
        const fsSeries = fullscreenChart.series;
        const id = fullscreenContainerId;

        const latest = await fetchLatestCandle(currentSymbol, customIntervals[id]);
        if (!latest) return;

        fsSeries.update(latest);

        if (!seriesData[id]) seriesData[id] = [];
        const idx = seriesData[id].findIndex(c => c.time === latest.time);
        if (idx >= 0) seriesData[id][idx] = {...latest};
        else seriesData[id].push(latest);

        if (latest.time > (lastCandleTime[id] || 0)) {
            lastCandleTime[id] = latest.time;

            if (emaEnabled && fullscreenEMA.length) {
                fullscreenEMA.forEach(e => {
                    e.last = nextEMA(e.last, latest.close, e.period);
                    e.series.update({ time: latest.time, value: e.last });
                });
            }
        }

        if (fullscreenChart.chart) applyVisibleRange(fullscreenChart.chart, seriesData[id]);
    }
}

// ==================== ONLOAD ====================
window.onload = async () => {
    setRealViewportHeight();

    await loadAllCharts(currentSymbol);
    // fetchPairs() se hai la lista
};

async function loadAllCharts(symbol) {
    currentSymbol = symbol;
    activeHorizPrice = savedHorizPrices[symbol] ?? null;

    const promises = Object.keys(customIntervals).map(id => createChart(id));
    await Promise.all(promises);
    syncHorizLines();
}

setInterval(updateLive, 2500);
setInterval(() => window.dispatchEvent(new Event("resize")), 5000);

// Resize
window.addEventListener("resize", () => {
    setRealViewportHeight();
    setTimeout(() => {
        Object.keys(charts).forEach(id => {
            const el = document.getElementById(id);
            if (charts[id] && el) charts[id].resize(el.clientWidth, el.clientHeight);
        });
        if (fullscreenActive && fullscreenChart?.chart) {
            fullscreenChart.chart.resize(window.innerWidth, window.innerHeight - 60);
        }
    }, 150);
});
