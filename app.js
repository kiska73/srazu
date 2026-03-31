// ====================== APP.JS COMPLETO E DEFINITIVO (31 MARZO 2026) ======================

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

let emaPeriods = [5, 10, 60, 223];
let emaEnabled = true;
let bbEnabled = false;
let bbPeriod = 20;
let bbDev = 2;
let symbolPricePrecision = 2;

let favorites = JSON.parse(localStorage.getItem('favoriteSymbols') || '[]');
let savedHorizPrices = JSON.parse(localStorage.getItem('favoriteHorizPrices') || '{}');
let alertPrices = JSON.parse(localStorage.getItem('alertPrices') || '{}');

let customIntervals = { "chart-5m": "5", "chart-30m": "30", "chart-4h": "240", "chart-1d": "D" };
let customLabels = { "1": "1m", "3": "3m", "5": "5m", "15": "15m", "30": "30m", "60": "1h", "240": "4h", "D": "1d" };

let currentSort = "volume";
let allPairsData = [];

let personalTGToken = localStorage.getItem('personalTGToken') || '';
let personalTGChatID = localStorage.getItem('personalTGChatID') || '';

const SERVER_URL = "https://srazu-bot.onrender.com";

let deviceId = localStorage.getItem('deviceId') || crypto.randomUUID();
localStorage.setItem('deviceId', deviceId);

const EMA_COLORS = ["#FFD700", "#FF9800", "#40C4FF", "#E040FB"];
const BB_COLORS = { middle: "#FFFF00", upper: "#888888", lower: "#888888" };
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ==================== UTILITY ====================
function getDisplaySymbol(symbol) {
    if (window.innerWidth <= 768) return symbol.replace(/USDT$|USDC$|USD$/, '') || symbol;
    return symbol;
}

function setRealViewportHeight() {
    document.documentElement.style.setProperty('--real-vh', `${window.innerHeight}px`);
}

function formatPrice(price) {
    const num = parseFloat(price);
    if (isNaN(num)) return "0";
    return num.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
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

// ==================== HORIZONTAL LINES & RULER ====================
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
    updateRulerPercentage();
}

function saveHorizIfFavorite() {
    if (favorites.includes(currentSymbol)) {
        if (activeHorizPrice !== null) {
            savedHorizPrices[currentSymbol] = activeHorizPrice;
        } else {
            delete savedHorizPrices[currentSymbol];
        }
        localStorage.setItem('favoriteHorizPrices', JSON.stringify(savedHorizPrices));
    }
}

function toggleFavorite(symbol) {
    const wasFavorite = favorites.includes(symbol);
    if (wasFavorite) {
        favorites = favorites.filter(s => s !== symbol);
        delete savedHorizPrices[symbol];
        if (alertPrices[symbol] !== undefined) delete alertPrices[symbol];
    } else {
        favorites.push(symbol);
        saveHorizIfFavorite();
    }
    localStorage.setItem('favoriteSymbols', JSON.stringify(favorites));
    localStorage.setItem('favoriteHorizPrices', JSON.stringify(savedHorizPrices));
    populateList(currentSort);

    if (wasFavorite && symbol === currentSymbol) {
        activeHorizPrice = null;
        rulerPrice = null;
        syncHorizLines();
    }
}

function updatePriceLineOnSeries(series, key) {
    if (priceLines[key]) { series.removePriceLine(priceLines[key]); delete priceLines[key]; }
    if (activeHorizPrice == null) return;

    const line = series.createPriceLine({
        price: activeHorizPrice,
        color: "#FFFF00",
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Solid,
        axisLabelVisible: true,
        axisLabelColor: "#FFFF00",
        axisLabelBackgroundColor: "#161a25",
        title: "",
        draggable: true
    });
    line.applyOptions({
        onDrag: l => {
            activeHorizPrice = l.price;
            syncHorizLines();
            saveHorizIfFavorite();
        }
    });
    priceLines[key] = line;
}

function updateAlertLineOnSeries(series, key) {
    if (alertLines[key]) { series.removePriceLine(alertLines[key]); delete alertLines[key]; }
    const alertPrice = alertPrices[currentSymbol];
    if (alertPrice == null) return;

    const line = series.createPriceLine({
        price: alertPrice,
        color: "#FFD700",
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: false,
        title: "",
        draggable: false
    });
    alertLines[key] = line;
}

function toggleRulerMode() {
    rulerMode = !rulerMode;
    document.querySelectorAll('.title-ruler').forEach(el => {
        rulerMode ? el.classList.add('active') : el.classList.remove('active');
    });
    if (!rulerMode) rulerPrice = null;
    syncHorizLines();
}

function updateRulerLineOnSeries(series, key) {
    if (rulerLines[key]) { series.removePriceLine(rulerLines[key]); delete rulerLines[key]; }
    if (rulerPrice === null) return;

    const line = series.createPriceLine({
        price: rulerPrice,
        color: "#00FF00",
        lineWidth: 2,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        axisLabelColor: "#00FF00",
        axisLabelBackgroundColor: "#161a25",
        title: "",
        draggable: false
    });
    rulerLines[key] = line;
}

function updateRulerPercentage() {
    const text = (rulerMode && rulerPrice !== null && activeHorizPrice !== null)
        ? `${((rulerPrice - activeHorizPrice) / activeHorizPrice * 100).toFixed(2)}%`.replace(/^-/, '–')
        : '';

    document.querySelectorAll('.title-pct').forEach(el => el.textContent = text);
    const fsPct = document.querySelector('#fullscreen-title .title-pct');
    if (fsPct) fsPct.textContent = text;
}

// ==================== INDICATORS ====================
function createEMA(emaArr, chart, klines, period, color) {
    const series = chart.addLineSeries({ color, lineWidth: 1.2, priceLineVisible: false, lastValueVisible: false });
    let data = [];
    let lastEma = klines[0].close;
    for (let i = 0; i < klines.length; i++) {
        lastEma = nextEMA(lastEma, klines[i].close, period);
        data.push({ time: klines[i].time, value: lastEma });
    }
    series.setData(data);
    emaArr.push({ series, period, last: lastEma, data });
}

function createBollinger(chart, klines, period, stdDev) {
    const mid = chart.addLineSeries({ color: BB_COLORS.middle, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
    const up  = chart.addLineSeries({ color: BB_COLORS.upper,  lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const low = chart.addLineSeries({ color: BB_COLORS.lower, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });

    let midData = [], upData = [], lowData = [];
    for (let i = period - 1; i < klines.length; i++) {
        const slice = klines.slice(i - period + 1, i + 1);
        const closes = slice.map(c => c.close);
        const sma = closes.reduce((a, b) => a + b, 0) / period;
        let variance = 0;
        for (let val of closes) variance += Math.pow(val - sma, 2);
        const dev = Math.sqrt(variance / period) * stdDev;
        const time = klines[i].time;

        midData.push({ time, value: sma });
        upData.push({ time, value: sma + dev });
        lowData.push({ time, value: sma - dev });
    }
    mid.setData(midData);
    up.setData(upData);
    low.setData(lowData);

    return {
        middle: { series: mid, data: midData },
        upper:  { series: up,  data: upData },
        lower:  { series: low, data: lowData }
    };
}

// ==================== CHART CREATION ====================
async function createChart(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    const interval = customIntervals[containerId];
    const label = customLabels[interval] || interval;
    const klines = await fetchKlines(currentSymbol, interval, 500);

    const titleEl = document.getElementById(`title-${containerId.split("-")[1]}`);
    if (titleEl) titleEl.querySelector('.title-text').textContent = klines.length ? `${currentSymbol} - ${label}` : "No data";

    if (!klines.length) return;

    symbolPricePrecision = getPricePrecision(klines.at(-1).close.toString());

    const chart = LightweightCharts.createChart(container, {
        layout: { background: { type: 'solid', color: '#0f1117' }, textColor: '#d1d4dc' },
        grid: { horzLines: { color: '#222' }, vertLines: { color: '#222' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        timeScale: { 
            timeVisible: true, 
            tickMarkFormatter: getTimeFormatter(interval),
            lockVisibleTimeRangeOnResize: true 
        },
        rightPriceScale: { borderColor: '#222' },
        width: container.clientWidth,
        height: container.clientHeight
    });

    const series = chart.addCandlestickSeries({
        priceFormat: { type: "price", precision: symbolPricePrecision, minMove: 10 ** -symbolPricePrecision },
        upColor: '#ffffff',
        downColor: '#0051D4',
        wickUpColor: '#cccccc',
        wickDownColor: '#0051D4',
        borderVisible: false,
        wickVisible: true
    });

    series.setData(klines);
    seriesData[containerId] = klines.map(c => ({...c}));
    lastCandleTime[containerId] = klines.at(-1).time;
    emaSeries[containerId] = [];

    if (emaEnabled) emaPeriods.forEach((p, i) => createEMA(emaSeries[containerId], chart, klines, p, EMA_COLORS[i]));
    if (bbEnabled && klines.length >= bbPeriod) bbSeries[containerId] = createBollinger(chart, klines, bbPeriod, bbDev);

    candleSeries[containerId] = series;
    charts[containerId] = chart;

    updatePriceLineOnSeries(series, containerId);
    updateAlertLineOnSeries(series, containerId);
    if (rulerMode && rulerPrice !== null) updateRulerLineOnSeries(series, containerId);

    chart.subscribeClick(p => {
        if (p?.point) {
            const price = series.coordinateToPrice(p.point.y);
            if (rulerMode) rulerPrice = price;
            else activeHorizPrice = price;
            syncHorizLines();
            if (!rulerMode) saveHorizIfFavorite();
        }
    });

    chart.subscribeDblClick(() => {
        activeHorizPrice = null;
        syncHorizLines();
        saveHorizIfFavorite();
    });
}

async function loadAllCharts(symbol) {
    currentSymbol = symbol;
    activeHorizPrice = savedHorizPrices[symbol] ?? null;
    rulerPrice = null;

    const promises = Object.keys(customIntervals).map(id => createChart(id));
    await Promise.all(promises);
    syncHorizLines();

    // Resize iniziale
    Object.keys(charts).forEach(id => {
        const el = document.getElementById(id);
        if (charts[id] && el) charts[id].resize(el.clientWidth, el.clientHeight);
    });
}

// ==================== FULLSCREEN ====================
function openFullscreen(containerId, tfLabel) {
    const overlay = document.getElementById("fullscreen-overlay");
    const fsDiv = document.getElementById("fullscreen-chart");
    fsDiv.innerHTML = "";

    document.getElementById("fullscreen-title").querySelector('.title-text').textContent = `${currentSymbol} - ${tfLabel}`;

    const newChart = LightweightCharts.createChart(fsDiv, {
        layout: { background: { type: 'solid', color: '#0f1117' }, textColor: '#d1d4dc' },
        grid: { horzLines: { color: '#222' }, vertLines: { color: '#222' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        timeScale: { timeVisible: true, tickMarkFormatter: getTimeFormatter(customIntervals[containerId]) },
        rightPriceScale: { borderColor: '#222' },
        width: window.innerWidth,
        height: window.innerHeight - 60
    });

    const newSeries = newChart.addCandlestickSeries(candleSeries[containerId].options());
    newSeries.setData(seriesData[containerId] || []);

    if (emaEnabled && emaSeries[containerId]) {
        emaSeries[containerId].forEach((e, i) => {
            const s = newChart.addLineSeries({ color: EMA_COLORS[i], lineWidth: 1.2 });
            s.setData(e.data);
        });
    }
    if (bbEnabled && bbSeries[containerId]) {
        ['middle','upper','lower'].forEach(key => {
            const s = newChart.addLineSeries({ color: BB_COLORS[key], lineWidth: key === 'middle' ? 1.5 : 1 });
            s.setData(bbSeries[containerId][key].data);
        });
    }

    updatePriceLineOnSeries(newSeries, "fullscreen");
    updateAlertLineOnSeries(newSeries, "fullscreen");
    if (rulerMode && rulerPrice !== null) updateRulerLineOnSeries(newSeries, "fullscreen");

    newChart.subscribeClick(p => {
        if (p?.point) {
            const price = newSeries.coordinateToPrice(p.point.y);
            if (rulerMode) rulerPrice = price;
            else activeHorizPrice = price;
            syncHorizLines();
            if (!rulerMode) saveHorizIfFavorite();
        }
    });

    newChart.subscribeDblClick(() => {
        activeHorizPrice = null;
        syncHorizLines();
        saveHorizIfFavorite();
    });

    overlay.style.display = "block";
    fullscreenActive = true;
    fullscreenChart = { chart: newChart, series: newSeries };
    fullscreenContainerId = containerId;
}

function closeFullscreen() {
    if (fullscreenChart) fullscreenChart.chart.remove();
    document.getElementById("fullscreen-overlay").style.display = "none";
    fullscreenActive = false;
    fullscreenChart = null;
    fullscreenContainerId = null;
    delete rulerLines["fullscreen"];
}

// ==================== DATA FETCHING ====================
async function fetchKlines(symbol, interval, limit = 500) {
    let baseUrl = currentExchange === "bybit" 
        ? `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`
        : `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

    try {
        const res = await fetch(baseUrl);
        if (!res.ok) return [];
        const data = await res.json();
        let raw = currentExchange === "bybit" ? (data.result?.list || []) : data;
        return raw.map(c => ({
            time: Number(c[0]) / 1000,
            open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4])
        })).reverse();
    } catch (e) {
        console.error("Klines error", e);
        return [];
    }
}

async function fetchLatestCandle(symbol, interval) {
    const key = `${symbol}_${interval}`;
    const now = Date.now();
    if (lastFetchTimes[key] && now - lastFetchTimes[key] < 1800) return null;
    lastFetchTimes[key] = now;

    const k = await fetchKlines(symbol, interval, 2);
    return k.length ? k[k.length - 1] : null;
}

async function fetchPairs() {
    let url = currentExchange === "bybit" 
        ? "https://api.bybit.com/v5/market/tickers?category=linear" 
        : "https://fapi.binance.com/fapi/v1/ticker/24hr";

    try {
        const res = await fetch(url);
        const data = await res.json();
        let raw = currentExchange === "bybit" ? data.result.list : data;

        allPairsData = raw.filter(p => (p.symbol || p.s).endsWith("USDT")).map(p => ({
            s: p.symbol || p.s,
            lp: p.lastPrice || p.last,
            pc: p.price24hPcnt || p.priceChangePercent,
            v: p.volume24h || p.quoteVolume
        }));

        populateList(currentSort);
    } catch (e) { console.error("List fetch error", e); }
}

function populateList(sortType) {
    const list = document.getElementById('pairs-list');
    if (!list) return;
    const currentScroll = list.scrollTop;

    let sorted = [...allPairsData];
    if (sortType === "volume") sorted.sort((a, b) => b.v - a.v);
    else if (sortType === "gainers") sorted.sort((a, b) => b.pc - a.pc);
    else if (sortType === "losers") sorted.sort((a, b) => a.pc - b.pc);   // ← CORREZIONE QUI

    const favs = sorted.filter(p => favorites.includes(p.s));
    const others = sorted.filter(p => !favorites.includes(p.s));
    const final = [...favs, ...others];

    list.innerHTML = final.map(p => {
        const isFav = favorites.includes(p.s);
        const change = parseFloat(p.pc || 0).toFixed(2);
        const color = change >= 0 ? "var(--green)" : "var(--red)";
        const activeClass = p.s === currentSymbol ? "active" : "";

        return `
            <div class="pair-item ${activeClass}" onclick="loadAllCharts('${p.s}')">
                <div class="pair-info">
                    <span class="pair-name">${getDisplaySymbol(p.s)}</span>
                    <span class="pair-price">${formatPrice(p.lp)}</span>
                </div>
                <div class="pair-stats">
                    <span class="pair-change" style="color:${color}">${change}%</span>
                    <span class="star-icon ${isFav ? 'active' : ''}" onclick="event.stopPropagation(); toggleFavorite('${p.s}')">
                        ${isFav ? '★' : '☆'}
                    </span>
                </div>
            </div>
        `;
    }).join('');

    list.scrollTop = currentScroll;
}

// ==================== ALERT ====================
function openAlertSetup() {
    const panel = document.getElementById('alert-setup');
    const input = document.getElementById('alert-price-input');
    panel.style.display = "block";
    input.value = activeHorizPrice 
        ? activeHorizPrice.toFixed(symbolPricePrecision) 
        : (seriesData["chart-5m"]?.at(-1)?.close || 0).toFixed(symbolPricePrecision);
}

// ==================== UPDATELIVE ====================
async function updateLive() {
    for (const id in customIntervals) {
        const chart = charts[id];
        const series = candleSeries[id];
        if (!chart || !series) continue;

        const currentRange = chart.timeScale().getVisibleLogicalRange();
        const currentDataLength = seriesData[id] ? seriesData[id].length : 0;

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

            if (bbEnabled && bbSeries[id] && seriesData[id].length >= bbPeriod) {
                const slice = seriesData[id].slice(-bbPeriod);
                const closes = slice.map(c => c.close);
                const sma = closes.reduce((a,b) => a + b, 0) / bbPeriod;
                let variance = 0;
                for (let val of closes) variance += Math.pow(val - sma, 2);
                const dev = Math.sqrt(variance / bbPeriod) * bbDev;

                bbSeries[id].middle.series.update({time: latest.time, value: sma});
                bbSeries[id].upper.series.update({time: latest.time, value: sma + dev});
                bbSeries[id].lower.series.update({time: latest.time, value: sma - dev});
            }

            const isUserAtRightEdge = currentRange && Math.abs(currentRange.to - currentDataLength) < 3;
            if (isUserAtRightEdge) chart.timeScale().scrollToRealTime();
        }
    }

    // Fullscreen update (senza nuova chiamata API)
    if (fullscreenActive && fullscreenChart && fullscreenContainerId) {
        const latest = seriesData[fullscreenContainerId]?.at(-1);
        if (latest) fullscreenChart.series.update(latest);
    }

    // BTC title color (ottimizzato)
    const btc = await fetchLatestCandle("BTCUSDT", "30");
    if (btc) {
        const cls = btc.close > btc.open ? "green" : (btc.close < btc.open ? "red" : "neutral");
        document.querySelectorAll('.chart-title').forEach(t => {
            t.classList.remove('green', 'red', 'neutral');
            t.classList.add(cls);
        });
    }
}

// ==================== EVENT LISTENERS ====================
document.addEventListener('DOMContentLoaded', () => {
    // Exchange
    document.getElementById('exchange-select').addEventListener('change', async e => {
        currentExchange = e.target.value;
        localStorage.setItem('currentExchange', currentExchange);
        allPairsData = [];
        document.getElementById('pairs-list').innerHTML = "<div class='loading'>Loading pairs...</div>";
        await fetchPairs();
        if (allPairsData.length) await loadAllCharts(allPairsData[0].s);
    });

    // Sort
    document.getElementById('sort-select').addEventListener('change', e => {
        currentSort = e.target.value;
        populateList(currentSort);
    });

    // Modals
    const settingsModal = document.getElementById('settings-modal');
    const infoModal = document.getElementById('info-modal');
    document.getElementById('settings-btn').onclick = () => settingsModal.style.display = "block";
    document.getElementById('info-btn').onclick = () => infoModal.style.display = "block";

    document.querySelectorAll('.close').forEach(b => b.onclick = () => {
        settingsModal.style.display = "none";
        infoModal.style.display = "none";
    });

    window.onclick = e => {
        if (e.target === settingsModal) settingsModal.style.display = "none";
        if (e.target === infoModal) infoModal.style.display = "none";
    };

    // Toggles
    document.getElementById('toggle-ema').onclick = function() {
        emaEnabled = !emaEnabled;
        this.textContent = emaEnabled ? "EMA: On" : "EMA: Off";
        this.classList.toggle("active", emaEnabled);
        document.getElementById("ema-periods-section").style.display = emaEnabled ? "block" : "none";
    };

    document.getElementById('toggle-bb').onclick = function() {
        bbEnabled = !bbEnabled;
        this.textContent = bbEnabled ? "Bollinger Bands: On" : "Bollinger Bands: Off";
        this.classList.toggle("active", bbEnabled);
        document.getElementById("bb-periods-section").style.display = bbEnabled ? "block" : "none";
    };

    // Apply settings
    document.getElementById('apply-settings').onclick = async () => {
        emaPeriods = [
            parseInt(document.getElementById('ema1').value) || 5,
            parseInt(document.getElementById('ema2').value) || 10,
            parseInt(document.getElementById('ema3').value) || 60,
            parseInt(document.getElementById('ema4').value) || 223
        ];
        bbPeriod = parseInt(document.getElementById('bb-period').value) || 20;
        bbDev = parseFloat(document.getElementById('bb-dev').value) || 2;

        customIntervals = {
            "chart-5m": document.getElementById('tf-chart-5m').value,
            "chart-30m": document.getElementById('tf-chart-30m').value,
            "chart-4h": document.getElementById('tf-chart-4h').value,
            "chart-1d": document.getElementById('tf-chart-1d').value
        };
        localStorage.setItem('customIntervals', JSON.stringify(customIntervals));

        personalTGToken = document.getElementById('personal-tg-token').value.trim();
        personalTGChatID = document.getElementById('personal-tg-chatid').value.trim();
        localStorage.setItem('personalTGToken', personalTGToken);
        localStorage.setItem('personalTGChatID', personalTGChatID);

        settingsModal.style.display = "none";
        await loadAllCharts(currentSymbol);
    };

    document.getElementById('open-botfather-btn').onclick = () => window.open('https://t.me/BotFather', '_blank');

    // Alert panel
    document.getElementById('close-alert-setup').onclick = () => document.getElementById('alert-setup').style.display = "none";

    document.getElementById('set-local-alert').onclick = () => {
        const val = parseFloat(document.getElementById('alert-price-input').value);
        if (!isNaN(val)) {
            alertPrices[currentSymbol] = val;
            localStorage.setItem('alertPrices', JSON.stringify(alertPrices));
            syncHorizLines();
            document.getElementById('alert-setup').style.display = "none";

            fetch(`${SERVER_URL}/set_alert`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ device_id: deviceId, exchange: currentExchange, symbol: currentSymbol, price: val, token: personalTGToken, chatId: personalTGChatID })
            }).catch(() => {});
        }
    };

    document.getElementById('open-in-exchange').onclick = () => {
        const url = currentExchange === "bybit" 
            ? `https://www.bybit.com/trade/usdt/${currentSymbol}` 
            : `https://www.binance.com/en/futures/${currentSymbol}`;
        window.open(url, '_blank');
    };

    document.getElementById('close-fullscreen').addEventListener('click', closeFullscreen);

    // Title icons
    document.querySelectorAll('.title-bell').forEach(el => el.onclick = openAlertSetup);
    document.querySelectorAll('.title-ruler').forEach(el => el.onclick = toggleRulerMode);
    document.querySelectorAll('.title-fullscreen').forEach(el => {
        el.onclick = () => {
            const container = el.closest('.chart-wrapper').querySelector('.chart-container').id;
            const label = customLabels[customIntervals[container]] || customIntervals[container];
            openFullscreen(container, label);
        };
    });
});

// ==================== RESIZE (importante su mobile) ====================
window.addEventListener('resize', () => {
    setRealViewportHeight();
    Object.keys(charts).forEach(id => {
        const container = document.getElementById(id);
        if (charts[id] && container) {
            charts[id].resize(container.clientWidth, container.clientHeight);
        }
    });
    if (fullscreenActive && fullscreenChart) {
        fullscreenChart.chart.resize(window.innerWidth, window.innerHeight - 60);
    }
});

window.addEventListener('orientationchange', () => {
    setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
});

// ==================== ONLOAD ====================
window.onload = async () => {
    setRealViewportHeight();

    favorites = JSON.parse(localStorage.getItem('favoriteSymbols') || '[]');
    savedHorizPrices = JSON.parse(localStorage.getItem('favoriteHorizPrices') || '{}');
    alertPrices = JSON.parse(localStorage.getItem('alertPrices') || '{}');

    const savedInt = localStorage.getItem('customIntervals');
    if (savedInt) customIntervals = JSON.parse(savedInt);

    document.getElementById("exchange-select").value = currentExchange;

    await loadAllCharts("BTCUSDT");
    await fetchPairs();

    setInterval(updateLive, 2000);
    setInterval(fetchPairs, 5000);
};

// Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
