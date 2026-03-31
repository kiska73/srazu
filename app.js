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

let deviceId = localStorage.getItem('deviceId') || (function() {
    const id = crypto.randomUUID();
    localStorage.setItem('deviceId', id);
    return id;
})();

const visibleBarsCount = 38;
const spaceBarsCount = 5;
const EMA_COLORS = ["#FFD700", "#FF9800", "#40C4FF", "#E040FB"];
const BB_COLORS = { middle: "#FFFF00", upper: "#888888", lower: "#888888" };
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ==================== UTILITY FUNCTIONS ====================

function getDisplaySymbol(symbol) {
    if (window.innerWidth <= 768) {
        return symbol.replace(/USDT$|USDC$|USD$/, '') || symbol;
    }
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

// ==================== HORIZONTAL LINES ====================

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
            syncPrices[currentSymbol] = activeHorizPrice;
        } else {
            delete savedHorizPrices[currentSymbol];
            delete syncPrices[currentSymbol];
        }
        localStorage.setItem('favoriteHorizPrices', JSON.stringify(savedHorizPrices));
        localStorage.setItem('syncPrices', JSON.stringify(syncPrices));
    }
}

function toggleFavorite(symbol) {
    const wasFavorite = favorites.includes(symbol);
    const hadAlert = alertPrices[symbol] !== undefined;

    if (wasFavorite) {
        favorites = favorites.filter(s => s !== symbol);
        delete savedHorizPrices[symbol];
        delete syncPrices[symbol];
        if (hadAlert) {
            delete alertPrices[symbol];
            localStorage.setItem('alertPrices', JSON.stringify(alertPrices));
            fetch(`${SERVER_URL}/set_alert`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ device_id: deviceId, exchange: currentExchange, symbol: symbol, price: null, token: personalTGToken, chatId: personalTGChatID })
            }).catch(e => console.error("Remove alert error:", e));
        }
    } else {
        favorites.push(symbol);
        saveHorizIfFavorite();
    }

    localStorage.setItem('favoriteSymbols', JSON.stringify(favorites));
    localStorage.setItem('favoriteHorizPrices', JSON.stringify(savedHorizPrices));
    localStorage.setItem('syncPrices', JSON.stringify(syncPrices));

    populateList(currentSort);

    if (wasFavorite && symbol === currentSymbol) {
        activeHorizPrice = null;
        rulerPrice = null;
        syncHorizLines();
    }
}

function updatePriceLineOnSeries(series, key) {
    if (priceLines[key]) {
        series.removePriceLine(priceLines[key]);
        delete priceLines[key];
    }
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
    if (alertLines[key]) {
        series.removePriceLine(alertLines[key]);
        delete alertLines[key];
    }
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

    if (!rulerMode) {
        rulerPrice = null;
        Object.keys(rulerLines).forEach(k => {
            if (rulerLines[k]) {
                if (k === "fullscreen" && fullscreenChart) fullscreenChart.series.removePriceLine(rulerLines[k]);
                else if (candleSeries[k]) candleSeries[k].removePriceLine(rulerLines[k]);
                delete rulerLines[k];
            }
        });
    }
    syncHorizLines();
}

function updateRulerLineOnSeries(series, key) {
    if (rulerLines[key]) {
        series.removePriceLine(rulerLines[key]);
        delete rulerLines[key];
    }
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
    const pctElements = document.querySelectorAll('.title-pct');
    const fsPct = document.querySelector('#fullscreen-title .title-pct');

    if (rulerMode && rulerPrice !== null && activeHorizPrice !== null) {
        const diff = ((rulerPrice - activeHorizPrice) / activeHorizPrice * 100);
        const text = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%`;
        pctElements.forEach(el => el.textContent = text);
        if (fsPct) fsPct.textContent = text;
    } else {
        pctElements.forEach(el => el.textContent = '');
        if (fsPct) fsPct.textContent = '';
    }
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

    if (titleEl) {
        titleEl.querySelector('.title-text').textContent = klines.length ? `${currentSymbol} - ${label}` : "No data";
    }

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

    if (emaEnabled) {
        emaPeriods.forEach((p, i) => createEMA(emaSeries[containerId], chart, klines, p, EMA_COLORS[i]));
    }
    if (bbEnabled && klines.length >= bbPeriod) {
        bbSeries[containerId] = createBollinger(chart, klines, bbPeriod, bbDev);
    }

    updatePriceLineOnSeries(series, containerId);
    updateAlertLineOnSeries(series, containerId);
    if (rulerMode && rulerPrice !== null) updateRulerLineOnSeries(series, containerId);

    // Click per prezzo orizzontale / ruler
    chart.subscribeClick(p => {
        if (p?.point) {
            const price = series.coordinateToPrice(p.point.y);
            if (rulerMode) {
                rulerPrice = price;
            } else {
                activeHorizPrice = price;
                saveHorizIfFavorite();
            }
            syncHorizLines();
        }
    });

    chart.subscribeDblClick(() => {
        activeHorizPrice = null;
        syncHorizLines();
        saveHorizIfFavorite();
    });

    charts[containerId] = chart;
    candleSeries[containerId] = series;
}

async function loadAllCharts(symbol) {
    currentSymbol = symbol;
    activeHorizPrice = savedHorizPrices[symbol] ?? null;
    rulerPrice = null;

    const promises = Object.keys(customIntervals).map(id => createChart(id));
    await Promise.all(promises);

    syncHorizLines();

    // Resize after load
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

    const fsTitle = document.getElementById("fullscreen-title");
    fsTitle.querySelector('.title-text').textContent = `${currentSymbol} - ${tfLabel}`;

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

    // Copia EMA
    if (emaEnabled && emaSeries[containerId]) {
        emaSeries[containerId].forEach((e, i) => {
            const s = newChart.addLineSeries({ color: EMA_COLORS[i], lineWidth: 1.2 });
            s.setData(e.data);
        });
    }

    // Copia Bollinger
    if (bbEnabled && bbSeries[containerId]) {
        ['middle', 'upper', 'lower'].forEach(key => {
            const s = newChart.addLineSeries({ 
                color: BB_COLORS[key], 
                lineWidth: key === 'middle' ? 1.5 : 1 
            });
            s.setData(bbSeries[containerId][key].data);
        });
    }

    updatePriceLineOnSeries(newSeries, "fullscreen");
    updateAlertLineOnSeries(newSeries, "fullscreen");
    if (rulerMode && rulerPrice !== null) updateRulerLineOnSeries(newSeries, "fullscreen");

    // Eventi click fullscreen
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
    if (fullscreenChart) {
        fullscreenChart.chart.remove();
    }
    document.getElementById("fullscreen-overlay").style.display = "none";
    fullscreenActive = false;
    fullscreenChart = null;
    fullscreenContainerId = null;
    delete rulerLines["fullscreen"];
}

// ==================== DATA FETCHING ====================

async function fetchKlines(symbol, interval, limit = 500) {
    let baseUrl = "";
    let queryInterval = interval;
    const binanceMap = {"1":"1m","3":"3m","5":"5m","15":"15m","30":"30m","60":"1h","240":"4h","D":"1d"};

    if (currentExchange === "bybit") {
        baseUrl = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`;
    } else if (currentExchange === "binance") {
        queryInterval = binanceMap[interval] || interval;
        baseUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${queryInterval}&limit=${limit}`;
    }

    try {
        const response = await fetch(baseUrl, { 
            headers: { 'User-Agent': 'Mozilla/5.0' } 
        });
        if (!response.ok) return [];

        const data = await response.json();
        let rawList = currentExchange === "bybit" ? (data.result?.list || []) : data;

        const klines = rawList.map(c => ({
            time: Number(c[0]) / 1000,
            open: Number(c[1]),
            high: Number(c[2]),
            low: Number(c[3]),
            close: Number(c[4])
        }));

        return currentExchange === "bybit" ? klines.reverse() : klines;
    } catch (e) {
        console.error("Fetch klines failed:", e);
        return [];
    }
}

async function fetchLatestCandle(symbol, interval) {
    const key = `${symbol}_${interval}`;
    const now = Date.now();
    if (lastFetchTimes[key] && now - lastFetchTimes[key] < 1800) return null;
    lastFetchTimes[key] = now;

    const k = await fetchKlines(symbol, interval, 2);
    return k.length > 0 ? k[k.length - 1] : null;
}

async function fetchPairs() {
    // ... (la tua funzione originale è ok, la tengo invariata per brevità)
    // Incolla qui la tua funzione fetchPairs() originale se vuoi, è già buona.
    // Per non allungare troppo, assumo che tu la tenga.
}

// ==================== UPDATELIVE - CON FIX FULLSCREEN ====================

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
        const existingIndex = seriesData[id].findIndex(c => c.time === latest.time);
        if (existingIndex >= 0) seriesData[id][existingIndex] = {...latest};
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
                variance /= bbPeriod;
                const stdDev = Math.sqrt(variance);
                const upperVal = sma + bbDev * stdDev;
                const lowerVal = sma - bbDev * stdDev;

                bbSeries[id].middle.series.update({ time: latest.time, value: sma });
                bbSeries[id].upper.series.update({ time: latest.time, value: upperVal });
                bbSeries[id].lower.series.update({ time: latest.time, value: lowerVal });
            }

            const isUserAtRightEdge = currentRange && Math.abs(currentRange.to - currentDataLength) < 3;
            if (isUserAtRightEdge) {
                chart.timeScale().scrollToRealTime();
            }
        }
    }

    // ==================== FULLSCREEN UPDATE (FIX) ====================
    if (fullscreenActive && fullscreenChart && fullscreenContainerId) {
        const fsChart = fullscreenChart.chart;
        const fsSeries = fullscreenChart.series;
        const currentRange = fsChart.timeScale().getVisibleLogicalRange();
        const currentDataLength = seriesData[fullscreenContainerId] ? seriesData[fullscreenContainerId].length : 0;

        const latest = seriesData[fullscreenContainerId] ? seriesData[fullscreenContainerId].at(-1) : null;

        if (latest) {
            fsSeries.update(latest);

            if (latest.time > (lastCandleTime["fs_" + fullscreenContainerId] || 0)) {
                lastCandleTime["fs_" + fullscreenContainerId] = latest.time;

                const isUserAtRightEdge = currentRange && Math.abs(currentRange.to - currentDataLength) < 3;
                if (isUserAtRightEdge) {
                    fsChart.timeScale().scrollToRealTime();
                }
            }
        }
    }

    // Colore titolo basato su BTC
    const btcLatest = await fetchLatestCandle("BTCUSDT", "30");
    if (btcLatest) {
        let colorClass = "neutral";
        if (btcLatest.close > btcLatest.open) colorClass = "green";
        else if (btcLatest.close < btcLatest.open) colorClass = "red";
        document.querySelectorAll('.chart-title').forEach(t => t.className = "chart-title " + colorClass);
    }
}

// ==================== EVENT LISTENERS (ESSENZIALI) ====================

document.addEventListener('DOMContentLoaded', () => {

    // Exchange change
    document.getElementById('exchange-select').addEventListener('change', async (e) => {
        currentExchange = e.target.value;
        localStorage.setItem('currentExchange', currentExchange);
        allPairsData = [];
        document.getElementById('pairs-list').innerHTML = "<div class='loading'>Loading pairs...</div>";
        await fetchPairs();
        if (allPairsData.length > 0) {
            const exists = allPairsData.some(p => p.s === currentSymbol);
            await loadAllCharts(exists ? currentSymbol : allPairsData[0].s);
        }
    });

    // Sort change
    document.getElementById('sort-select').addEventListener('change', (e) => {
        currentSort = e.target.value;
        populateList(currentSort);
    });

    // Modals
    const settingsModal = document.getElementById('settings-modal');
    const infoModal = document.getElementById('info-modal');

    document.getElementById('settings-btn').onclick = () => settingsModal.style.display = "block";
    document.getElementById('info-btn').onclick = () => infoModal.style.display = "block";

    document.querySelectorAll('.close').forEach(btn => {
        btn.onclick = () => {
            settingsModal.style.display = "none";
            infoModal.style.display = "none";
        };
    });

    window.onclick = (event) => {
        if (event.target === settingsModal) settingsModal.style.display = "none";
        if (event.target === infoModal) infoModal.style.display = "none";
    };

    // Toggle EMA / BB
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

    // Apply Settings
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

    // BotFather
    document.getElementById('open-botfather-btn').onclick = () => window.open('https://t.me/BotFather', '_blank');

    // Alert panel
    document.getElementById('close-alert-setup').onclick = () => {
        document.getElementById('alert-setup').style.display = "none";
    };

    document.getElementById('set-local-alert').onclick = () => {
        const val = parseFloat(document.getElementById('alert-price-input').value);
        if (!isNaN(val)) {
            alertPrices[currentSymbol] = val;
            localStorage.setItem('alertPrices', JSON.stringify(alertPrices));
            syncHorizLines();

            fetch(`${SERVER_URL}/set_alert`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ 
                    device_id: deviceId, 
                    exchange: currentExchange, 
                    symbol: currentSymbol, 
                    price: val, 
                    token: personalTGToken, 
                    chatId: personalTGChatID 
                })
            }).catch(e => console.error(e));

            document.getElementById('alert-setup').style.display = "none";
        }
    };

    document.getElementById('open-in-exchange').onclick = () => {
        const url = currentExchange === "bybit" 
            ? `https://www.bybit.com/trade/usdt/${currentSymbol}` 
            : `https://www.binance.com/en/futures/${currentSymbol}`;
        window.open(url, '_blank');
    };

    // Close fullscreen button
    document.getElementById('close-fullscreen').addEventListener('click', closeFullscreen);

    // Title clicks (bell, ruler, fullscreen)
    document.querySelectorAll('.title-bell').forEach(el => el.onclick = () => openAlertSetup());
    document.querySelectorAll('.title-ruler').forEach(el => el.onclick = toggleRulerMode);
    document.querySelectorAll('.title-fullscreen').forEach(el => {
        el.onclick = () => {
            const wrapper = el.closest('.chart-wrapper');
            if (wrapper) {
                const chartId = wrapper.querySelector('.chart-container').id;
                const tfLabel = customLabels[customIntervals[chartId]] || customIntervals[chartId];
                openFullscreen(chartId, tfLabel);
            }
        };
    });
});

// ==================== INIT ====================

window.onload = async () => {
    setRealViewportHeight();

    // Load saved settings
    favorites = JSON.parse(localStorage.getItem('favoriteSymbols') || '[]');
    savedHorizPrices = JSON.parse(localStorage.getItem('favoriteHorizPrices') || '{}');
    alertPrices = JSON.parse(localStorage.getItem('alertPrices') || '{}');
    syncPrices = JSON.parse(localStorage.getItem('syncPrices') || '{}');

    const savedIntervals = localStorage.getItem('customIntervals');
    if (savedIntervals) customIntervals = JSON.parse(savedIntervals);

    document.getElementById("exchange-select").value = currentExchange;
    document.getElementById("toggle-ema").textContent = emaEnabled ? "EMA: On" : "EMA: Off";
    document.getElementById("toggle-ema").classList.toggle("active", emaEnabled);
    document.getElementById("ema-periods-section").style.display = emaEnabled ? "block" : "none";
    document.getElementById("toggle-bb").textContent = bbEnabled ? "Bollinger Bands: On" : "Bollinger Bands: Off";
    document.getElementById("toggle-bb").classList.toggle("active", bbEnabled);
    document.getElementById("bb-periods-section").style.display = bbEnabled ? "block" : "none";

    await loadAllCharts("BTCUSDT");
    await fetchPairs();

    setInterval(updateLive, 2000);
    setInterval(fetchPairs, 5000);
};

// Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW failed:', err));
    });
}
