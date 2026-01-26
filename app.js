// Registrazione del Service Worker per PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('SW registered: ', registration);
      })
      .catch(registrationError => {
        console.log('SW registration failed: ', registrationError);
      });
  });
}

let currentSymbol = "BTCUSDT";
let currentExchange = localStorage.getItem('currentExchange') || "bybit";
let charts = {};
let candleSeries = {};
let emaSeries = {};
let bbSeries = {};
let lastCandleTime = {};
let priceLines = {};
let alertLines = {};
let rulerLines = {};
let alertTriggeredSymbols = new Set();

let activeHorizPrice = null;
let rulerMode = false;
let rulerPrice = null;

let fullscreenActive = false;
let fullscreenChart = null;
let fullscreenContainerId = null;

let emaPeriods = [5, 10, 60, 223];
let emaEnabled = true;

let bbEnabled = false;
let bbPeriod = 20;
let bbDev = 2;

let symbolPricePrecision = 2;

let favorites = JSON.parse(localStorage.getItem('favoriteSymbols') || '[]');
let savedHorizPrices = JSON.parse(localStorage.getItem('favoriteHorizPrices') || '{}');
let alertPrices = JSON.parse(localStorage.getItem('alertPrices') || '{}');

let customIntervals = {
    "chart-5m": "5",
    "chart-30m": "30",
    "chart-4h": "240",
    "chart-1d": "D"
};

let customLabels = {
    "1": "1m", "3": "3m", "5": "5m", "15": "15m",
    "30": "30m", "60": "1h", "240": "4h", "D": "1d"
};

let currentSort = "volume";
let allPairsData = [];

// Personal Telegram
let personalTGToken = localStorage.getItem('personalTGToken') || '';
let personalTGChatID = localStorage.getItem('personalTGChatID') || '';

// Server URL - Il tuo Render
const SERVER_URL = "https://srazu-bot.onrender.com";

// Device ID unico
let deviceId = localStorage.getItem('deviceId') || (function() {
  const id = crypto.randomUUID();
  localStorage.setItem('deviceId', id);
  return id;
})();

const visibleBarsCount = 38;
const spaceBarsCount = 1;

const EMA_COLORS = ["#FFD700", "#FF9800", "#2196F3", "#E040FB"];
const BB_COLORS = { middle: "#FFFF00", upper: "#888888", lower: "#888888" };
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

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

function applyVisibleRange(chart, series) {
    const data = series.data();
    if (!data || data.length === 0) return;
    const len = data.length;
    const from = Math.max(0, len - visibleBarsCount);
    chart.timeScale().setVisibleLogicalRange({ from: from, to: len + spaceBarsCount });
}

function syncHorizLines() {
    Object.keys(candleSeries).forEach(k => {
        updatePriceLineOnSeries(candleSeries[k], k);
        updateAlertLineOnSeries(candleSeries[k], k);
        if (rulerMode && rulerPrice !== null && activeHorizPrice !== null) updateRulerLineOnSeries(candleSeries[k], k);
    });
    if (fullscreenActive) {
        updatePriceLineOnSeries(fullscreenChart.series, "fullscreen");
        updateAlertLineOnSeries(fullscreenChart.series, "fullscreen");
        if (rulerMode && rulerPrice !== null && activeHorizPrice !== null) updateRulerLineOnSeries(fullscreenChart.series, "fullscreen");
    }
}

function saveHorizIfFavorite() {
    if (favorites.includes(currentSymbol)) {
        if (activeHorizPrice !== null) savedHorizPrices[currentSymbol] = activeHorizPrice;
        else delete savedHorizPrices[currentSymbol];
        localStorage.setItem('favoriteHorizPrices', JSON.stringify(savedHorizPrices));
    }
}

function toggleFavorite(symbol) {
    const wasFavorite = favorites.includes(symbol);
    const hadAlert = alertPrices[symbol] !== undefined;

    if (wasFavorite) {
        favorites = favorites.filter(s => s !== symbol);
        delete savedHorizPrices[symbol];

        if (hadAlert) {
            delete alertPrices[symbol];
            localStorage.setItem('alertPrices', JSON.stringify(alertPrices));
            alertTriggeredSymbols.delete(symbol);

            // Remove dal server
            fetch(`${SERVER_URL}/remove_alert`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    device_id: deviceId,
                    exchange: currentExchange,
                    symbol: symbol
                })
            }).catch(e => console.error("Server remove error:", e));

            if (personalTGToken && personalTGChatID) {
                sendTelegramAlert(`❌ <b>Alert CANCELLED</b>\n<b>${symbol}</b>`);
            }
        }
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
    if (priceLines[key]) {
        series.removePriceLine(priceLines[key]);
        delete priceLines[key];
    }
    if (activeHorizPrice == null) return;

    const line = series.createPriceLine({
        price: activeHorizPrice,
        color: "#ffffff",
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Solid,
        axisLabelVisible: true,
        axisLabelColor: "#ffffff",
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

    if (alertTriggeredSymbols.has(currentSymbol)) return;

    const alertPrice = alertPrices[currentSymbol];
    if (alertPrice == null) return;

    const line = series.createPriceLine({
        price: alertPrice,
        color: "#FFD700",
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dotted,
        axisLabelVisible: false,
        title: "",
        draggable: false
    });

    alertLines[key] = line;
}

function toggleRulerMode() {
    rulerMode = !rulerMode;
    document.querySelectorAll('.title-ruler').forEach(el => {
        el.style.opacity = rulerMode ? '1' : '0.5';
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
}

function updateRulerLineOnSeries(series, key) {
    if (rulerLines[key]) {
        series.removePriceLine(rulerLines[key]);
        delete rulerLines[key];
    }
    if (rulerPrice === null || activeHorizPrice === null) return;

    const diff = ((rulerPrice - activeHorizPrice) / activeHorizPrice * 100);
    const sign = diff >= 0 ? '+' : '';
    const title = `${sign}${diff.toFixed(2)}%`;

    const line = series.createPriceLine({
        price: rulerPrice,
        color: "#00FF00",
        lineWidth: 2,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        axisLabelColor: "#00FF00",
        axisLabelBackgroundColor: "#161a25",
        title: title,
        draggable: false
    });
    rulerLines[key] = line;
}

function createEMA(seriesArray, chart, klines, period, color) {
    const s = chart.addLineSeries({
        color: color,
        lineWidth: 1.2,
        priceLineVisible: false,
        lastValueVisible: false
    });

    let ema = null;
    const data = [];
    klines.forEach((c, i) => {
        if (i === period - 1) ema = klines.slice(0, period).reduce((a,b) => a + b.close, 0) / period;
        else if (i >= period) ema = nextEMA(ema, c.close, period);
        if (ema != null) data.push({ time: c.time, value: ema });
    });

    s.setData(data);
    const lastEma = ema || klines.at(-1)?.close || 0;
    seriesArray.push({ series: s, period, last: lastEma });
}

function createBollinger(chart, klines, period, dev) {
    const middle = chart.addLineSeries({ color: BB_COLORS.middle, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
    const upper = chart.addLineSeries({ color: BB_COLORS.upper, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const lower = chart.addLineSeries({ color: BB_COLORS.lower, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });

    const dataMiddle = [], dataUpper = [], dataLower = [];

    for (let i = period - 1; i < klines.length; i++) {
        const slice = klines.slice(i - period + 1, i + 1);
        const closes = slice.map(c => c.close);
        const sma = closes.reduce((a,b) => a + b, 0) / period;
        const variance = closes.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
        const stdDev = Math.sqrt(variance);
        const upperVal = sma + dev * stdDev;
        const lowerVal = sma - dev * stdDev;
        const time = klines[i].time;
        dataMiddle.push({ time, value: sma });
        dataUpper.push({ time, value: upperVal });
        dataLower.push({ time, value: lowerVal });
    }

    middle.setData(dataMiddle);
    upper.setData(dataUpper);
    lower.setData(dataLower);

    const lastSma = dataMiddle.at(-1)?.value || 0;
    return { middle: { series: middle, last: lastSma },
             upper: { series: upper, last: dataUpper.at(-1)?.value || 0 },
             lower: { series: lower, last: dataLower.at(-1)?.value || 0 } };
}

async function fetchKlines(symbol, interval, limit = 1000) {
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
        const response = await fetch(baseUrl);
        if (!response.ok) {
            console.error(`HTTP error! status: ${response.status}`);
            return [];
        }
        const data = await response.json();

        let rawList = [];
        if (currentExchange === "bybit") {
            if (data.retCode !== 0) {
                console.error("Bybit error:", data.retMsg);
                return [];
            }
            rawList = data.result?.list || [];
        } else {
            rawList = data;
        }

        if (!Array.isArray(rawList)) return [];

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
    const k = await fetchKlines(symbol, interval, 2);
    return k.length > 0 ? k[k.length - 1] : null;
}

async function fetchPairs() {
    let baseUrl = "";
    let tickerUrl = "";
    if (currentExchange === "bybit") {
        baseUrl = "https://api.bybit.com/v5/market/tickers?category=linear";
    } else if (currentExchange === "binance") {
        baseUrl = "https://fapi.binance.com/fapi/v1/exchangeInfo";
        tickerUrl = "https://fapi.binance.com/fapi/v1/ticker/24hr";
    }

    try {
        let activeSymbols = [];

        if (currentExchange === "binance") {
            const infoRes = await fetch(baseUrl);
            if (!infoRes.ok) return;
            const info = await infoRes.json();

            activeSymbols = info.symbols
                .filter(s => s.contractType === "PERPETUAL" && s.status === "TRADING" && s.symbol.endsWith("USDT"))
                .map(s => s.symbol);
        }

        const tickerRes = await fetch(currentExchange === "bybit" ? baseUrl : tickerUrl);
        if (!tickerRes.ok) return;
        const tickerData = await tickerRes.json();

        let rawList = currentExchange === "bybit" ? (tickerData.result?.list || []) : tickerData;

        const filtered = rawList.filter(t => 
            currentExchange === "bybit" ? true : activeSymbols.includes(t.symbol)
        );

        allPairsData = filtered.map(t => ({
            s: t.symbol || "",
            price: t.lastPrice || "0",
            p: currentExchange === "bybit" ? Number(t.price24hPcnt || 0) * 100 : Number(t.priceChangePercent || 0),
            v: currentExchange === "bybit" ? Number(t.turnover24h || 0) : Number(t.quoteVolume || 0)
        }));

        populateList(currentSort);
    } catch (e) {
        console.error("Fetch pairs error:", e);
    }
}

function populateList(sort = "volume") {
    const list = document.getElementById("pairs-list");
    if (allPairsData.length === 0) {
        list.innerHTML = "<div class='loading'>No pairs loaded</div>";
        return;
    }

    let sorted = [...allPairsData];
    if (sort === "gainers") sorted.sort((a, b) => b.p - a.p);
    else if (sort === "losers") sorted.sort((a, b) => a.p - b.p);
    else sorted.sort((a, b) => b.v - a.v);

    const favoritesInList = sorted.filter(p => favorites.includes(p.s));
    const others = sorted.filter(p => !favorites.includes(p.s));

    const display = favoritesInList.concat(others.slice(0, 80));

    list.innerHTML = "";

    display.forEach(p => {
        const isFav = favorites.includes(p.s);
        const div = document.createElement("div");
        div.className = "pair" + (p.s === currentSymbol ? " active" : "");
        div.innerHTML = `
            <span class="pair-symbol">
                <span class="star${isFav ? ' favorite' : ''}" data-symbol="${p.s}">${isFav ? '★' : '☆'}</span>
                <span>${p.s}</span>
            </span>
            <span>${formatPrice(p.price)}</span>
            <span class="${p.p >= 0 ? "green" : "red"}">${p.p >= 0 ? "+" : ""}${p.p.toFixed(2)}%</span>`;
        div.onclick = (e) => {
            if (e.target.classList.contains('star')) return;
            loadAllCharts(p.s);
        };
        list.appendChild(div);
    });

    document.querySelectorAll('.star').forEach(starEl => {
        starEl.onclick = (e) => {
            e.stopPropagation();
            toggleFavorite(starEl.dataset.symbol);
        };
    });
}

async function createChart(containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";

    const interval = customIntervals[containerId];
    const label = customLabels[interval] || interval;

    const klines = await fetchKlines(currentSymbol, interval, 1000);

    const titleEl = document.getElementById(`title-${containerId.split("-")[1]}`);
    const bellSpan = titleEl.querySelector('.title-bell');
    const rulerSpan = titleEl.querySelector('.title-ruler');
    const fsSpan = titleEl.querySelector('.title-fullscreen');
    const textSpan = titleEl.querySelector('.title-text');

    bellSpan.onclick = () => openAlertSetup();
    rulerSpan.onclick = toggleRulerMode;
    fsSpan.onclick = () => openFullscreen(containerId, label);

    textSpan.textContent = klines.length ? `${currentSymbol} - ${label}` : "No data";
    titleEl.className = "chart-title neutral";

    if (!klines.length) return;

    symbolPricePrecision = getPricePrecision(klines.at(-1).close.toString());

    const chart = LightweightCharts.createChart(container, {
        layout: { background: { type: 'solid', color: '#0f1117' }, textColor: '#d1d4dc' },
        grid: { horzLines: { color: '#222' }, vertLines: { color: '#222' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        timeScale: { timeVisible: true, tickMarkFormatter: getTimeFormatter(interval) },
        rightPriceScale: { borderColor: '#222' },
        width: container.clientWidth,
        height: container.clientHeight
    });

    const series = chart.addCandlestickSeries({
        priceFormat: { type: "price", precision: symbolPricePrecision, minMove: 10 ** -symbolPricePrecision }
    });

    series.setData(klines);
    lastCandleTime[containerId] = klines.at(-1).time;

    emaSeries[containerId] = [];
    if (emaEnabled) {
        emaPeriods.forEach((p, i) => createEMA(emaSeries[containerId], chart, klines, p, EMA_COLORS[i]));
    }

    if (bbEnabled && klines.length >= bbPeriod) {
        bbSeries[containerId] = createBollinger(chart, klines, bbPeriod, bbDev);
    } else {
        bbSeries[containerId] = null;
    }

    updatePriceLineOnSeries(series, containerId);
    updateAlertLineOnSeries(series, containerId);
    if (rulerMode && rulerPrice !== null && activeHorizPrice !== null) updateRulerLineOnSeries(series, containerId);

    const totalSlots = visibleBarsCount + spaceBarsCount;
    const barSpacing = container.clientWidth / totalSlots;
    chart.timeScale().applyOptions({ barSpacing: barSpacing });
    applyVisibleRange(chart, series);

    chart.subscribeClick(p => {
        if (p?.point) {
            const price = series.coordinateToPrice(p.point.y);
            if (rulerMode && activeHorizPrice !== null) {
                rulerPrice = price;
                syncHorizLines();
            } else {
                activeHorizPrice = price;
                syncHorizLines();
                saveHorizIfFavorite();
            }
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

    alertTriggeredSymbols.delete(symbol);
    syncHorizLines();

    const totalSlots = visibleBarsCount + spaceBarsCount;
    Object.keys(charts).forEach(id => {
        const el = document.getElementById(id);
        if (charts[id] && el) {
            charts[id].applyOptions({ width: el.clientWidth, height: el.clientHeight });
            const newSpacing = el.clientWidth / totalSlots;
            charts[id].timeScale().applyOptions({ barSpacing: newSpacing });
            applyVisibleRange(charts[id], candleSeries[id]);
        }
    });
}

function openFullscreen(containerId, tfLabel) {
    const overlay = document.getElementById("fullscreen-overlay");
    const fsDiv = document.getElementById("fullscreen-chart");
    fsDiv.innerHTML = "";

    const fsTitle = document.getElementById("fullscreen-title");
    const fsBell = fsTitle.querySelector('.title-bell');
    const fsRuler = fsTitle.querySelector('.title-ruler');
    const fsText = fsTitle.querySelector('.title-text');
    const fsFs = fsTitle.querySelector('.title-fullscreen');

    fsBell.onclick = () => openAlertSetup();
    fsRuler.onclick = toggleRulerMode;
    fsFs.onclick = closeFullscreen;
    fsText.textContent = `${currentSymbol} - ${tfLabel}`;

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
    newSeries.setData(candleSeries[containerId].data());

    if (emaEnabled) {
        emaSeries[containerId]?.forEach((e, i) => {
            const s = newChart.addLineSeries({ color: EMA_COLORS[i], lineWidth: 1.2, priceLineVisible: false, lastValueVisible: false });
            s.setData(e.series.data());
        });
    }

    if (bbEnabled && bbSeries[containerId]) {
        ['middle', 'upper', 'lower'].forEach(key => {
            const s = newChart.addLineSeries({
                color: BB_COLORS[key],
                lineWidth: key === 'middle' ? 1.5 : 1,
                priceLineVisible: false,
                lastValueVisible: false
            });
            s.setData(bbSeries[containerId][key].series.data());
        });
    }

    updatePriceLineOnSeries(newSeries, "fullscreen");
    updateAlertLineOnSeries(newSeries, "fullscreen");
    if (rulerMode && rulerPrice !== null && activeHorizPrice !== null) updateRulerLineOnSeries(newSeries, "fullscreen");

    const totalSlots = visibleBarsCount + spaceBarsCount;
    const barSpacing = window.innerWidth / totalSlots;
    newChart.timeScale().applyOptions({ barSpacing: barSpacing });
    applyVisibleRange(newChart, newSeries);

    newChart.subscribeClick(p => {
        if (p?.point) {
            const price = newSeries.coordinateToPrice(p.point.y);
            if (rulerMode && activeHorizPrice !== null) {
                rulerPrice = price;
                syncHorizLines();
            } else {
                activeHorizPrice = price;
                syncHorizLines();
                saveHorizIfFavorite();
            }
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
    document.getElementById("fullscreen-overlay").style.display = "none";
    if (fullscreenChart) fullscreenChart.chart.remove();
    fullscreenActive = false;
    fullscreenChart = null;
    fullscreenContainerId = null;
    delete rulerLines["fullscreen"];
}

document.getElementById("close-fullscreen").onclick = closeFullscreen;

async function sendTelegramAlert(text, photoDataUrl = null) {
    if (!personalTGToken || !personalTGChatID) return;

    const baseUrl = `https://api.telegram.org/bot${personalTGToken}`;

    if (photoDataUrl) {
        const formData = new FormData();
        const blob = await (await fetch(photoDataUrl)).blob();
        formData.append('photo', blob, 'alert.png');
        formData.append('chat_id', personalTGChatID);
        formData.append('caption', text);
        formData.append('parse_mode', 'HTML');

        try {
            await fetch(`${baseUrl}/sendPhoto`, { method: 'POST', body: formData });
        } catch (e) {
            console.error("Telegram photo error:", e);
        }
    } else {
        const url = `${baseUrl}/sendMessage?chat_id=${personalTGChatID}&text=${encodeURIComponent(text)}&parse_mode=HTML`;
        try {
            await fetch(url);
        } catch (e) {
            console.error("Telegram text error:", e);
        }
    }
}

function openAlertSetup() {
    document.getElementById("alert-symbol").textContent = currentSymbol;
    const latestClose = candleSeries["chart-5m"]?.data()?.at(-1)?.close || 0;
    const prefill = activeHorizPrice !== null ? activeHorizPrice : latestClose;
    document.getElementById("alert-price-input").value = prefill.toFixed(symbolPricePrecision);
    document.getElementById("alert-setup").style.display = "block";
}

document.getElementById("close-alert-setup").onclick = () => {
    document.getElementById("alert-setup").style.display = "none";
};

document.getElementById("set-local-alert").onclick = () => {
    const price = Number(document.getElementById("alert-price-input").value);
    if (isNaN(price) || price <= 0) return alert("Invalid price");

    if (!personalTGToken || !personalTGChatID) {
        alert("Please configure your personal Telegram bot in Settings to receive alerts.");
        document.getElementById("alert-setup").style.display = "none";
        return;
    }

    const oldPrice = alertPrices[currentSymbol];
    alertPrices[currentSymbol] = price;
    localStorage.setItem('alertPrices', JSON.stringify(alertPrices));

    // Aggiungi automaticamente ai preferiti se non c'è già
    if (!favorites.includes(currentSymbol)) toggleFavorite(currentSymbol);

    alertTriggeredSymbols.delete(currentSymbol);
    syncHorizLines();

    document.getElementById("alert-setup").style.display = "none";

    const tradeLink = currentExchange === "bybit" 
        ? `https://www.bybit.com/trade/usdt/${currentSymbol}`
        : `https://www.binance.com/en/futures/${currentSymbol}`;

    let message;
    if (oldPrice === undefined) {
        message = `✅ <b>Alert ACTIVATED</b>\n<b>${currentSymbol}</b>\nTarget price: <b>${price.toFixed(symbolPricePrecision)}</b>`;
    } else {
        message = `🔄 <b>Alert UPDATED</b>\n<b>${currentSymbol}</b>\nNew target price: <b>${price.toFixed(symbolPricePrecision)}</b>`;
    }

    sendTelegramAlert(message);
};

document.getElementById("open-in-exchange").onclick = () => {
    const price = Number(document.getElementById("alert-price-input").value);
    if (isNaN(price) || price <= 0) return alert("Invalid price");

    const tradeLink = currentExchange === "bybit" 
        ? `https://www.bybit.com/trade/usdt/${currentSymbol}`
        : `https://www.binance.com/en/futures/${currentSymbol}`;

    window.open(tradeLink, '_blank');

    document.getElementById("alert-setup").style.display = "none";
};

async function updateLive() {
    for (const id in customIntervals) {
        const interval = customIntervals[id];
        const latest = await fetchLatestCandle(currentSymbol, interval);
        if (!latest || !candleSeries[id]) continue;

        candleSeries[id].update(latest);

        if (latest.time > (lastCandleTime[id] || 0)) {
            lastCandleTime[id] = latest.time;

            if (emaEnabled) {
                emaSeries[id]?.forEach(e => {
                    e.last = nextEMA(e.last, latest.close, e.period);
                    e.series.update({ time: latest.time, value: e.last });
                });
            }

            if (bbEnabled && bbSeries[id]) {
                const bb = bbSeries[id];
                bb.middle.last = (bb.middle.last * (bbPeriod - 1) + latest.close) / bbPeriod;
                bb.middle.series.update({ time: latest.time, value: bb.middle.last });
            }

            applyVisibleRange(charts[id], candleSeries[id]);
        }
    }

    if (fullscreenActive && fullscreenChart && fullscreenContainerId) {
        const interval = customIntervals[fullscreenContainerId];
        const latest = await fetchLatestCandle(currentSymbol, interval);
        if (latest) {
            fullscreenChart.series.update(latest);
            if (latest.time > (lastCandleTime[fullscreenContainerId] || 0)) {
                lastCandleTime[fullscreenContainerId] = latest.time;
                applyVisibleRange(fullscreenChart.chart, fullscreenChart.series);
            }
        }
    }

    const btcLatest = await fetchLatestCandle("BTCUSDT", "30");
    if (btcLatest) {
        let colorClass = "neutral";
        if (btcLatest.close > btcLatest.open) colorClass = "green";
        else if (btcLatest.close < btcLatest.open) colorClass = "red";
        document.querySelectorAll('.chart-title').forEach(t => t.className = "chart-title " + colorClass);
    }

    if (alertPrices[currentSymbol] && candleSeries["chart-5m"]) {
        const data = candleSeries["chart-5m"].data();
        if (data.length >= 2) {
            const prev = data.at(-2);
            const last = data.at(-1);
            const alertPrice = alertPrices[currentSymbol];

            const crossedUp = prev.close < alertPrice && last.close >= alertPrice;
            const crossedDown = prev.close > alertPrice && last.close <= alertPrice;

            if ((crossedUp || crossedDown) && !alertTriggeredSymbols.has(currentSymbol)) {
                const tradeLink = currentExchange === "bybit" 
                    ? `https://www.bybit.com/trade/usdt/${currentSymbol}`
                    : `https://www.binance.com/en/futures/${currentSymbol}`;

                const alertText = `🚨 <b>PRICE ALERT!</b>\n<b>${currentSymbol}</b> reached ${alertPrice.toFixed(symbolPricePrecision)}\nCurrent price: <b>${last.close.toFixed(symbolPricePrecision)}</b>\nExchange: ${currentExchange.toUpperCase()}\n<a href="${tradeLink}">Open trade now</a>`;

                const chartContainer = document.getElementById("chart-30m");
                if (chartContainer) {
                    html2canvas(chartContainer, {backgroundColor: "#0f1117"}).then(canvas => {
                        const dataUrl = canvas.toDataURL("image/png");
                        sendTelegramAlert(alertText, dataUrl);
                    });
                } else {
                    sendTelegramAlert(alertText);
                }

                alertTriggeredSymbols.add(currentSymbol);
                syncHorizLines();
            }
        }
    }
}

setInterval(updateLive, 2000);
setInterval(fetchPairs, 6000);

document.getElementById("settings-btn").onclick = () => document.getElementById("settings-modal").style.display = "flex";
document.querySelector("#settings-modal .close").onclick = () => document.getElementById("settings-modal").style.display = "none";

document.getElementById("toggle-ema").onclick = () => {
    emaEnabled = !emaEnabled;
    const btn = document.getElementById("toggle-ema");
    btn.textContent = emaEnabled ? "EMA: On" : "EMA: Off";
    btn.classList.toggle("active", emaEnabled);
    document.getElementById("ema-periods-section").style.display = emaEnabled ? "block" : "none";
};

document.getElementById("toggle-bb").onclick = () => {
    bbEnabled = !bbEnabled;
    const btn = document.getElementById("toggle-bb");
    btn.textContent = bbEnabled ? "Bollinger Bands: On" : "Bollinger Bands: Off";
    btn.classList.toggle("active", bbEnabled);
    document.getElementById("bb-periods-section").style.display = bbEnabled ? "block" : "none";
};

document.getElementById("apply-settings").onclick = async () => {
    emaPeriods = [
        Math.max(1, Number(document.getElementById("ema1").value || 5)),
        Math.max(1, Number(document.getElementById("ema2").value || 10)),
        Math.max(1, Number(document.getElementById("ema3").value || 60)),
        Math.max(1, Number(document.getElementById("ema4").value || 223))
    ];

    bbPeriod = Math.max(1, Number(document.getElementById("bb-period").value || 20));
    bbDev = Number(document.getElementById("bb-dev").value || 2);

    customIntervals["chart-5m"] = document.getElementById("tf-chart-5m").value;
    customIntervals["chart-30m"] = document.getElementById("tf-chart-30m").value;
    customIntervals["chart-4h"] = document.getElementById("tf-chart-4h").value;
    customIntervals["chart-1d"] = document.getElementById("tf-chart-1d").value;

    localStorage.setItem('customIntervals', JSON.stringify(customIntervals));

    personalTGToken = document.getElementById("personal-tg-token").value.trim();
    personalTGChatID = document.getElementById("personal-tg-chatid").value.trim();

    localStorage.setItem('personalTGToken', personalTGToken);
    localStorage.setItem('personalTGChatID', personalTGChatID);

    await loadAllCharts(currentSymbol);
    document.getElementById("settings-modal").style.display = "none";
};

document.getElementById("sort-select").onchange = e => {
    currentSort = e.target.value;
    populateList(currentSort);
};

document.getElementById("exchange-select").onchange = async (e) => {
    const oldSymbol = currentSymbol;
    currentExchange = e.target.value;
    localStorage.setItem('currentExchange', currentExchange);

    allPairsData = [];
    document.getElementById("pairs-list").innerHTML = "<div class='loading'>Loading pairs...</div>";

    await fetchPairs();

    if (!allPairsData.some(p => p.s === oldSymbol)) {
        currentSymbol = "BTCUSDT";
    }

    await loadAllCharts(currentSymbol);
};

document.getElementById("info-btn").onclick = () => {
    document.getElementById("info-modal").style.display = "flex";
};

document.querySelector("#info-modal .close").onclick = () => {
    document.getElementById("info-modal").style.display = "none";
};

window.onclick = (event) => {
    const infoModal = document.getElementById("info-modal");
    const settingsModal = document.getElementById("settings-modal");
    if (event.target === infoModal) infoModal.style.display = "none";
    if (event.target === settingsModal) settingsModal.style.display = "none";
};

document.getElementById('open-botfather-btn').onclick = () => {
    window.open('https://t.me/BotFather', '_blank');
};

window.onload = async () => {
    favorites = JSON.parse(localStorage.getItem('favoriteSymbols') || '[]');
    savedHorizPrices = JSON.parse(localStorage.getItem('favoriteHorizPrices') || '{}');
    alertPrices = JSON.parse(localStorage.getItem('alertPrices') || '{}');
    const savedIntervals = localStorage.getItem('customIntervals');
    if (savedIntervals) customIntervals = JSON.parse(savedIntervals);

    personalTGToken = localStorage.getItem('personalTGToken') || '';
    personalTGChatID = localStorage.getItem('personalTGChatID') || '';

    document.getElementById("personal-tg-token").value = personalTGToken;
    document.getElementById("personal-tg-chatid").value = personalTGChatID;

    Object.keys(customIntervals).forEach(id => {
        const select = document.getElementById("tf-" + id);
        if (select) select.value = customIntervals[id];
    });

    document.getElementById("exchange-select").value = currentExchange;

    document.getElementById("toggle-ema").textContent = emaEnabled ? "EMA: On" : "EMA: Off";
    document.getElementById("toggle-ema").classList.toggle("active", emaEnabled);
    document.getElementById("ema-periods-section").style.display = emaEnabled ? "block" : "none";

    document.getElementById("toggle-bb").textContent = bbEnabled ? "Bollinger Bands: On" : "Bollinger Bands: Off";
    document.getElementById("toggle-bb").classList.toggle("active", bbEnabled);
    document.getElementById("bb-periods-section").style.display = bbEnabled ? "block" : "none";

    document.querySelectorAll('.title-ruler').forEach(el => {
        el.style.opacity = '0.5';
    });

    await loadAllCharts("BTCUSDT");
    await fetchPairs();

    window.addEventListener("resize", () => {
        const totalSlots = visibleBarsCount + spaceBarsCount;
        for (const id in charts) {
            const el = document.getElementById(id);
            if (charts[id] && el) {
                charts[id].applyOptions({ width: el.clientWidth, height: el.clientHeight });
                const newSpacing = el.clientWidth / totalSlots;
                charts[id].timeScale().applyOptions({ barSpacing: newSpacing });
                applyVisibleRange(charts[id], candleSeries[id]);
            }
        }
        if (fullscreenActive && fullscreenChart) {
            fullscreenChart.chart.applyOptions({ width: window.innerWidth, height: window.innerHeight - 60 });
            const newSpacing = window.innerWidth / totalSlots;
            fullscreenChart.chart.timeScale().applyOptions({ barSpacing: newSpacing });
            applyVisibleRange(fullscreenChart.chart, fullscreenChart.series);
        }
    });
};
