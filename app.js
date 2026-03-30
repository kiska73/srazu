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
            rightOffset: 3, // Spazio ridotto
            tickMarkFormatter: getTimeFormatter(interval) 
        },
        width: container.clientWidth,
        height: container.clientHeight
    });
    // ... resto della funzione uguale ...
}
