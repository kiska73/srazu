// CONFIGURAZIONE GLOBALE
let currentSymbol = "BTCUSDT";
let currentExchange = localStorage.getItem('currentExchange') || "bybit";
const spaceBarsCount = 3; // Lo spazio che volevi tu

// STATO APP
let charts = {};
let candleSeries = {};
let seriesData = {};
let activeHorizPrice = null;
let rulerMode = false;
let rulerPrice = null;
let fullscreenChart = null;

// TIMEFRAMES
const customIntervals = { "chart-5m": "5", "chart-30m": "30", "chart-4h": "240", "chart-1d": "D" };
const customLabels = { "1": "1m", "3": "3m", "5": "5m", "15": "15m", "30": "30m", "60": "1h", "240": "4h", "D": "1d" };

// --- UTILI ---
function formatPrice(price) {
    const n = parseFloat(price);
    return n < 1 ? n.toFixed(6) : n.toFixed(2);
}

// --- FETCH DATI ---
async function fetchKlines(symbol, interval) {
    let url = "";
    if (currentExchange === "bybit") {
        url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=500`;
    } else {
        const bMap = {"1":"1m","3":"3m","5":"5m","15":"15m","30":"30m","60":"1h","240":"4h","D":"1d"};
        url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${bMap[interval]||interval}&limit=500`;
    }
    try {
        const res = await fetch(url);
        const json = await res.json();
        let raw = currentExchange === "bybit" ? (json.result?.list || []) : json;
        const klines = raw.map(c => ({
            time: Number(c[0]) / 1000,
            open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4])
        }));
        return currentExchange === "bybit" ? klines.reverse() : klines;
    } catch (e) { return []; }
}

// --- CREAZIONE GRAFICO ---
async function createChart(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    const data = await fetchKlines(currentSymbol, customIntervals[containerId]);
    if (!data.length) return;

    const chart = LightweightCharts.createChart(container, {
        layout: { background: { color: '#0f1117' }, textColor: '#d1d4dc' },
        grid: { vertLines: { color: '#1f222d' }, horzLines: { color: '#1f222d' } },
        timeScale: { rightOffset: spaceBarsCount, timeVisible: true, borderVisible: false },
        rightPriceScale: { borderVisible: false },
        width: container.clientWidth,
        height: container.clientHeight,
    });

    const series = chart.addCandlestickSeries({
        upColor: '#00ff85', downColor: '#ff4444', 
        borderVisible: false, wickUpColor: '#00ff85', wickDownColor: '#ff4444'
    });

    series.setData(data);
    
    // Salvataggio per uso futuro
    charts[containerId] = chart;
    candleSeries[containerId] = series;
    seriesData[containerId] = data;

    // Click per linea gialla
    chart.subscribeClick(param => {
        if (!param.point) return;
        const price = series.coordinateToPrice(param.point.y);
        if (rulerMode) { rulerPrice = price; } else { activeHorizPrice = price; }
        syncAllLines();
    });

    // Doppio click per pulire
    container.addEventListener('dblclick', () => {
        activeHorizPrice = null;
        rulerPrice = null;
        syncAllLines();
    });

    // Titolo
    const idSuffix = containerId.replace("chart-", "");
    const titleText = document.querySelector(`#title-${idSuffix} .title-text`);
    if(titleText) titleText.textContent = `${currentSymbol} (${customLabels[customIntervals[containerId]]})`;
    
    syncAllLines();
}

// --- FULLSCREEN CORRETTO ---
function openFullscreen(containerId) {
    const overlay = document.getElementById("fullscreen-overlay");
    const fsContainer = document.getElementById("fullscreen-chart");
    overlay.style.display = "block";
    fsContainer.innerHTML = "";

    // Diamo tempo al browser di mostrare il div prima di calcolare le misure
    setTimeout(() => {
        const chart = LightweightCharts.createChart(fsContainer, {
            layout: { background: { color: '#0f1117' }, textColor: '#d1d4dc' },
            grid: { vertLines: { color: '#1f222d' }, horzLines: { color: '#1f222d' } },
            timeScale: { rightOffset: spaceBarsCount, timeVisible: true },
            width: fsContainer.clientWidth,
            height: fsContainer.clientHeight,
        });

        const series = chart.addCandlestickSeries({
            upColor: '#00ff85', downColor: '#ff4444', borderVisible: false
        });

        if (seriesData[containerId]) series.setData(seriesData[containerId]);
        
        fullscreenChart = { chart, series, id: "fs" };
        
        chart.subscribeClick(param => {
            if (!param.point) return;
            activeHorizPrice = series.coordinateToPrice(param.point.y);
            syncAllLines();
        });

        syncAllLines();
    }, 100);
}

function closeFullscreen() {
    document.getElementById("fullscreen-overlay").style.display = "none";
    if (fullscreenChart) {
        fullscreenChart.chart.remove();
        fullscreenChart = null;
    }
}

// --- SINCRONIZZAZIONE LINEE ---
function syncAllLines() {
    // Lista di tutte le serie attive (4 mini + 1 eventuale full)
    const allSeries = Object.values(candleSeries);
    if (fullscreenChart) allSeries.push(fullscreenChart.series);

    allSeries.forEach(s => {
        // Rimuovi vecchie
        if (s._priceLine) s.removePriceLine(s._priceLine);
        if (s._rulerLine) s.removePriceLine(s._rulerLine);

        // Aggiungi Gialla (Sync)
        if (activeHorizPrice) {
            s._priceLine = s.createPriceLine({
                price: activeHorizPrice, color: '#FFFF00', lineWidth: 1,
                lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true, title: ''
            });
        }
        // Aggiungi Verde (Ruler)
        if (rulerMode && rulerPrice) {
            s._rulerLine = s.createPriceLine({
                price: rulerPrice, color: '#00ff85', lineWidth: 1,
                lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: ''
            });
        }
    });

    // Calcolo %
    if (activeHorizPrice && rulerPrice && rulerMode) {
        const diff = ((rulerPrice - activeHorizPrice) / activeHorizPrice * 100).toFixed(2);
        document.querySelectorAll(".title-pct").forEach(el => el.textContent = diff + "%");
    } else {
        document.querySelectorAll(".title-pct").forEach(el => el.textContent = "");
    }
}

// --- LISTA CRYPTO ---
async function updatePairs() {
    try {
        const url = currentExchange === "bybit" 
            ? "https://api.bybit.com/v5/market/tickers?category=linear" 
            : "https://fapi.binance.com/fapi/v1/ticker/24hr";
        const res = await fetch(url);
        const data = await res.json();
        const raw = currentExchange === "bybit" ? data.result.list : data;

        let pairs = raw.map(t => ({
            s: t.symbol,
            p: t.lastPrice,
            c: currentExchange === "bybit" ? (parseFloat(t.price24hPcnt)*100) : parseFloat(t.priceChangePercent),
            v: currentExchange === "bybit" ? parseFloat(t.turnover24h) : parseFloat(t.quoteVolume)
        })).filter(x => x.s.endsWith("USDT"));

        const sortVal = document.getElementById("sort-select").value;
        if (sortVal === "gainers") pairs.sort((a,b) => b.c - a.c);
        else if (sortVal === "losers") pairs.sort((a,b) => a.c - b.c);
        else pairs.sort((a,b) => b.v - a.v);

        const list = document.getElementById("pairs-list");
        list.innerHTML = "";
        pairs.slice(0, 50).forEach(pair => {
            const div = document.createElement("div");
            div.className = `pair ${pair.s === currentSymbol ? 'active' : ''}`;
            div.innerHTML = `<span>${pair.s.replace("USDT","")}</span><span>${formatPrice(pair.p)}</span><span style="color:${pair.c>=0?'#00ff85':'#ff4444'}">${pair.c.toFixed(2)}%</span>`;
            div.onclick = () => loadAll(pair.s);
            list.appendChild(div);
        });
    } catch(e) {}
}

async function loadAll(symbol) {
    currentSymbol = symbol;
    for (const id in customIntervals) await createChart(id);
    updatePairs();
}

// --- EVENTI ---
function init() {
    // Tasti Exchange
    document.getElementById("exchange-select").onchange = (e) => {
        currentExchange = e.target.value;
        localStorage.setItem('currentExchange', currentExchange);
        loadAll(currentSymbol);
    };

    // Ordinamento
    document.getElementById("sort-select").onchange = updatePairs;

    // Modali
    document.getElementById("settings-btn").onclick = () => document.getElementById("settings-modal").style.display = "block";
    document.getElementById("info-btn").onclick = () => document.getElementById("info-modal").style.display = "block";
    document.querySelectorAll(".close").forEach(b => b.onclick = () => {
        document.getElementById("settings-modal").style.display = "none";
        document.getElementById("info-modal").style.display = "none";
    });

    // Fullscreen Tasti
    document.querySelectorAll(".title-fullscreen").forEach(btn => {
        btn.onclick = () => {
            const containerId = btn.closest(".chart-wrapper").querySelector(".chart-container").id;
            openFullscreen(containerId);
        };
    });
    document.getElementById("close-fullscreen").onclick = closeFullscreen;

    // Ruler
    document.querySelectorAll(".title-ruler").forEach(btn => {
        btn.onclick = () => {
            rulerMode = !rulerMode;
            rulerPrice = null;
            document.querySelectorAll(".title-ruler").forEach(r => r.style.opacity = rulerMode ? "1" : "0.5");
            syncAllLines();
        };
    });

    loadAll(currentSymbol);
    setInterval(updatePairs, 10000);
}

window.onload = init;
window.onresize = () => {
    Object.values(charts).forEach(c => c.resize(c._container.clientWidth, c._container.clientHeight));
};
