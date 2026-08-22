/**
 * Internet Test
 * Real-time connectivity testing, disconnection detection & diagnostics
 */

(function () {
    'use strict';

    // ========================================
    // Configuration
    // ========================================
    const CONFIG = {
        CHECK_INTERVAL: 3000,        // ms between connectivity checks
        PING_TARGETS: [
            'https://www.google.com/generate_204',
            'https://www.cloudflare.com/cdn-cgi/trace',
            'https://connectivitycheck.gstatic.com/generate_204',
        ],
        CHART_MAX_POINTS: 60,
        TIMELINE_DURATION: 30 * 60 * 1000,  // 30 minutes in ms
        TOAST_DURATION: 4000,
        MAX_LOG_ENTRIES: 100,
        STORAGE_KEY: 'internet-monitor-data',
        SAVE_INTERVAL: 5,  // save every N checks
    };

    // ========================================
    // State
    // ========================================
    const state = {
        isOnline: null,
        lastOnline: null,
        lastOffline: null,
        statusSince: null,
        monitorStart: new Date(),
        disconnectCount: 0,
        totalDowntimeMs: 0,
        latencyHistory: [],
        allLatencies: [],
        events: [],
        timelineSegments: [],
        checkTimer: null,
        uptimeTimer: null,
        clockTimer: null,
        checkCount: 0,
    };

    // ========================================
    // DOM References
    // ========================================
    const dom = {
        statusCard: document.getElementById('statusCard'),
        statusGlow: document.getElementById('statusGlow'),
        statusLabel: document.getElementById('statusLabel'),
        statusDetail: document.getElementById('statusDetail'),
        iconConnected: document.getElementById('iconConnected'),
        iconDisconnected: document.getElementById('iconDisconnected'),
        pulseRing: document.getElementById('pulseRing'),
        uptimeValue: document.getElementById('uptimeValue'),
        latencyValue: document.getElementById('latencyValue'),
        latencyBar: document.getElementById('latencyBar'),
        disconnectCount: document.getElementById('disconnectCount'),
        totalDowntime: document.getElementById('totalDowntime'),
        headerRight: document.querySelector('.header-right'),
        avgLatency: document.getElementById('avgLatency'),
        chartOverlay: document.getElementById('chartOverlay'),
        latencyChart: document.getElementById('latencyChart'),
        timelineBar: document.getElementById('timelineBar'),
        timelineStart: document.getElementById('timelineStart'),
        timelineEnd: document.getElementById('timelineEnd'),
        logContainer: document.getElementById('logContainer'),
        logEmpty: document.getElementById('logEmpty'),
        eventCount: document.getElementById('eventCount'),
        monitorStart: document.getElementById('monitorStart'),
        btnClear: document.getElementById('btnClear'),
        bgParticles: document.getElementById('bgParticles'),
        diagSection: document.getElementById('diagSection'),
        diagStatusBadge: document.getElementById('diagStatusBadge'),
        diagVerdictIcon: document.getElementById('diagVerdictIcon'),
        diagVerdictTitle: document.getElementById('diagVerdictTitle'),
        diagVerdictDesc: document.getElementById('diagVerdictDesc'),
        diagTests: document.getElementById('diagTests'),
        diagInfo: document.getElementById('diagInfo'),
        btnClearLog: document.getElementById('btnClearLog'),
        speedTestStatus: document.getElementById('speedTestStatus'),
        gaugeFill: document.getElementById('gaugeFill'),
        gaugeValue: document.getElementById('gaugeValue'),
        gaugeUnit: document.getElementById('gaugeUnit'),
        btnStartSpeedTest: document.getElementById('btnStartSpeedTest'),
        speedDownload: document.getElementById('speedDownload'),
        speedUpload: document.getElementById('speedUpload'),
        speedPing: document.getElementById('speedPing'),
        speedJitter: document.getElementById('speedJitter'),
        metricDownload: document.getElementById('metricDownload'),
        metricUpload: document.getElementById('metricUpload'),
        metricPing: document.getElementById('metricPing'),
        metricJitter: document.getElementById('metricJitter'),
        speedGauge: document.getElementById('speedGauge'),
    };

    // ========================================
    // Canvas Chart
    // ========================================
    const chart = {
        ctx: null,
        width: 0,
        height: 0,
        dpr: window.devicePixelRatio || 1,

        init() {
            this.ctx = dom.latencyChart.getContext('2d');
            this.resize();
            window.addEventListener('resize', () => this.resize());
        },

        resize() {
            const container = dom.latencyChart.parentElement;
            this.width = container.clientWidth;
            this.height = container.clientHeight;
            dom.latencyChart.width = this.width * this.dpr;
            dom.latencyChart.height = this.height * this.dpr;
            dom.latencyChart.style.width = this.width + 'px';
            dom.latencyChart.style.height = this.height + 'px';
            this.ctx.scale(this.dpr, this.dpr);
            this.draw();
        },

        draw() {
            const ctx = this.ctx;
            const w = this.width;
            const h = this.height;
            const data = state.latencyHistory;

            ctx.clearRect(0, 0, w, h);

            if (data.length < 2) return;

            const padding = { top: 20, right: 16, bottom: 28, left: 50 };
            const chartW = w - padding.left - padding.right;
            const chartH = h - padding.top - padding.bottom;

            // Calculate max latency
            const validData = data.filter(d => d.latency !== null);
            let maxLatency = validData.length > 0
                ? Math.max(...validData.map(d => d.latency))
                : 100;
            maxLatency = Math.max(maxLatency * 1.2, 50);

            // Draw grid lines
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
            ctx.lineWidth = 1;
            const gridLines = 4;
            for (let i = 0; i <= gridLines; i++) {
                const y = padding.top + (chartH / gridLines) * i;
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(w - padding.right, y);
                ctx.stroke();

                // Y-axis labels
                const val = Math.round(maxLatency - (maxLatency / gridLines) * i);
                ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
                ctx.font = '11px Inter, sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(val + 'ms', padding.left - 8, y + 4);
            }

            // Draw data
            const stepX = chartW / (CONFIG.CHART_MAX_POINTS - 1);

            // Build path
            const points = [];
            for (let i = 0; i < data.length; i++) {
                const x = padding.left + stepX * (CONFIG.CHART_MAX_POINTS - data.length + i);
                if (data[i].latency === null) {
                    points.push({ x, y: null, offline: true });
                } else {
                    const y = padding.top + chartH * (1 - data[i].latency / maxLatency);
                    points.push({ x, y, offline: false });
                }
            }

            // Draw offline regions
            for (let i = 0; i < points.length; i++) {
                if (points[i].offline) {
                    ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
                    ctx.fillRect(
                        points[i].x - stepX / 2,
                        padding.top,
                        stepX,
                        chartH
                    );
                }
            }

            // Draw line and gradient
            const validPoints = points.filter(p => !p.offline);
            if (validPoints.length >= 2) {
                // Gradient fill
                const gradient = ctx.createLinearGradient(0, padding.top, 0, h - padding.bottom);
                gradient.addColorStop(0, 'rgba(59, 130, 246, 0.2)');
                gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');

                ctx.beginPath();
                let started = false;
                let firstX = 0, lastX = 0;
                for (let i = 0; i < points.length; i++) {
                    if (points[i].offline) continue;
                    if (!started) {
                        ctx.moveTo(points[i].x, points[i].y);
                        firstX = points[i].x;
                        started = true;
                    } else {
                        // Smooth curve
                        if (i > 0 && !points[i - 1].offline) {
                            const prevP = points[i - 1];
                            const cpx = (prevP.x + points[i].x) / 2;
                            ctx.bezierCurveTo(cpx, prevP.y, cpx, points[i].y, points[i].x, points[i].y);
                        } else {
                            ctx.lineTo(points[i].x, points[i].y);
                        }
                    }
                    lastX = points[i].x;
                }

                // Stroke line
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = 2.5;
                ctx.lineJoin = 'round';
                ctx.lineCap = 'round';
                ctx.stroke();

                // Fill area
                ctx.lineTo(lastX, padding.top + chartH);
                ctx.lineTo(firstX, padding.top + chartH);
                ctx.closePath();
                ctx.fillStyle = gradient;
                ctx.fill();

                // Draw dots on last few points
                const lastN = Math.min(5, validPoints.length);
                for (let i = validPoints.length - lastN; i < validPoints.length; i++) {
                    const p = validPoints[i];
                    const alpha = 0.3 + 0.7 * ((i - (validPoints.length - lastN)) / lastN);
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(59, 130, 246, ${alpha})`;
                    ctx.fill();
                }
            }
        }
    };

    // ========================================
    // Background Particles
    // ========================================
    function createParticles() {
        const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#06b6d4'];
        for (let i = 0; i < 20; i++) {
            const particle = document.createElement('div');
            particle.className = 'bg-particle';
            const size = Math.random() * 4 + 2;
            const color = colors[Math.floor(Math.random() * colors.length)];
            particle.style.cssText = `
                width: ${size}px;
                height: ${size}px;
                left: ${Math.random() * 100}%;
                background: ${color};
                animation-duration: ${Math.random() * 20 + 15}s;
                animation-delay: ${Math.random() * 10}s;
            `;
            dom.bgParticles.appendChild(particle);
        }
    }

    // ========================================
    // Connectivity Check
    // ========================================
    async function checkConnectivity() {
        const startTime = performance.now();
        let online = false;
        let latency = null;

        // Try multiple targets
        for (const url of CONFIG.PING_TARGETS) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);

                const response = await fetch(url, {
                    method: 'HEAD',
                    mode: 'no-cors',
                    cache: 'no-store',
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);
                latency = Math.round(performance.now() - startTime);
                online = true;
                break;
            } catch (e) {
                continue;
            }
        }

        // Fallback to navigator.onLine
        if (!online && navigator.onLine) {
            // navigator.onLine says we're connected but fetch failed
            // Treat as disconnected (more reliable)
            online = false;
        }

        processResult(online, latency);
    }

    function processResult(online, latency) {
        const now = new Date();
        const wasOnline = state.isOnline;

        // First check
        if (state.isOnline === null) {
            state.isOnline = online;
            state.statusSince = now;
            addTimelineSegment(online, now);
        }

        // Status change: went offline
        if (wasOnline === true && !online) {
            state.isOnline = false;
            state.statusSince = now;
            state.lastOffline = now;
            state.disconnectCount++;

            // Run diagnostics and add event with results
            runDiagnostics().then(diag => {
                // Find the down event we just added and attach diagnostics
                const downEvent = state.events.find(e => e.type === 'down' && e.time.getTime() === now.getTime());
                if (downEvent) {
                    downEvent.diagnostics = diag;
                    renderEvents();
                    saveState();
                }
            });

            addEvent('down', now);
            addTimelineSegment(false, now);
            showToast('İnternet bağlantısı kesildi!', 'error');
            updateUIDisconnected(now);
        }

        // Status change: came back online
        if (wasOnline === false && online) {
            const downDuration = state.lastOffline ? (now - state.lastOffline) : 0;
            state.totalDowntimeMs += downDuration;
            state.isOnline = true;
            state.statusSince = now;
            state.lastOnline = now;

            addEvent('up', now, downDuration);
            addTimelineSegment(true, now);
            showToast('İnternet bağlantısı geri geldi!', 'success');
            updateUIConnected(now, latency);

            // Hide diagnostics panel after recovery
            setTimeout(() => {
                dom.diagSection.style.display = 'none';
            }, 5000);
        }

        // Still online
        if (online) {
            state.isOnline = true;
            if (wasOnline === null || wasOnline) {
                updateUIConnected(now, latency);
            }
        }

        // Still offline
        if (!online && (wasOnline === false || wasOnline === null)) {
            state.isOnline = false;
            updateUIDisconnected(now);
        }

        // Record latency
        state.latencyHistory.push({
            time: now,
            latency: online ? latency : null,
        });

        if (state.latencyHistory.length > CONFIG.CHART_MAX_POINTS) {
            state.latencyHistory.shift();
        }

        if (latency !== null) {
            state.allLatencies.push(latency);
        }

        // Update UI elements
        updateLatencyUI(latency);
        updateStatsUI();
        updateTimelineUI();
        chart.draw();

        if (state.latencyHistory.length >= 2) {
            dom.chartOverlay.classList.add('hidden');
        }

        // Save to localStorage periodically
        state.checkCount++;
        if (state.checkCount % CONFIG.SAVE_INTERVAL === 0) {
            saveState();
        }
    }

    // ========================================
    // UI Updates
    // ========================================
    function updateUIConnected(now, latency) {
        dom.statusCard.className = 'status-card connected';
        dom.statusLabel.textContent = 'Bağlı';
        dom.statusDetail.textContent = latency
            ? `Son kontrol: ${formatTime(now)} · Gecikme: ${latency}ms`
            : `Son kontrol: ${formatTime(now)}`;
        dom.iconConnected.classList.remove('hidden');
        dom.iconDisconnected.classList.add('hidden');
    }

    function updateUIDisconnected(now) {
        dom.statusCard.className = 'status-card disconnected';
        dom.statusLabel.textContent = 'Bağlantı Kesildi';
        dom.statusDetail.textContent = `Kopma zamanı: ${formatTime(state.lastOffline || now)}`;
        dom.iconConnected.classList.add('hidden');
        dom.iconDisconnected.classList.remove('hidden');
    }

    function updateLatencyUI(latency) {
        if (latency !== null) {
            dom.latencyValue.textContent = latency + ' ms';
            // Bar: 0-300ms range
            const pct = Math.min(latency / 300 * 100, 100);
            dom.latencyBar.style.width = pct + '%';
        } else {
            dom.latencyValue.textContent = '-- ms';
            dom.latencyBar.style.width = '0%';
        }
    }

    function updateStatsUI() {
        dom.disconnectCount.textContent = state.disconnectCount;

        let totalDown = state.totalDowntimeMs;
        // If currently offline, add ongoing downtime
        if (!state.isOnline && state.lastOffline) {
            totalDown += Date.now() - state.lastOffline.getTime();
        }
        dom.totalDowntime.textContent = formatDuration(totalDown);

        if (state.allLatencies.length > 0) {
            const avg = Math.round(
                state.allLatencies.reduce((a, b) => a + b, 0) / state.allLatencies.length
            );
            dom.avgLatency.textContent = avg + ' ms';
        }

        dom.eventCount.textContent = state.events.length + ' olay';
    }

    function updateUptime() {
        if (state.statusSince) {
            const elapsed = Date.now() - state.statusSince.getTime();
            dom.uptimeValue.textContent = formatDuration(elapsed);
        }

        // Also update total downtime if currently offline
        if (!state.isOnline && state.lastOffline) {
            let totalDown = state.totalDowntimeMs + (Date.now() - state.lastOffline.getTime());
            dom.totalDowntime.textContent = formatDuration(totalDown);
        }
    }

    // updateClock removed since headerClock is removed in the new UI

    // ========================================
    // Timeline
    // ========================================
    function addTimelineSegment(online, time) {
        state.timelineSegments.push({
            online,
            time: time.getTime(),
        });
    }

    function updateTimelineUI() {
        const now = Date.now();
        const start = now - CONFIG.TIMELINE_DURATION;

        dom.timelineStart.textContent = formatTime(new Date(start));
        dom.timelineEnd.textContent = formatTime(new Date(now));

        // Build segments
        const segments = state.timelineSegments.filter(s => s.time >= start);

        // If no segments in range, show current state
        if (segments.length === 0) {
            dom.timelineBar.innerHTML = '';
            const seg = document.createElement('div');
            seg.className = `timeline-segment ${state.isOnline ? 'connected' : 'disconnected'}`;
            seg.style.width = '100%';
            dom.timelineBar.appendChild(seg);
            return;
        }

        dom.timelineBar.innerHTML = '';

        // Add initial segment if first segment doesn't start at the beginning
        let prevTime = start;
        let prevState = segments.length > 0 ? !segments[0].online : state.isOnline;

        // Check if there are segments before our window
        const beforeSegments = state.timelineSegments.filter(s => s.time < start);
        if (beforeSegments.length > 0) {
            prevState = beforeSegments[beforeSegments.length - 1].online;
        }

        for (const seg of segments) {
            // Fill gap before this segment
            if (seg.time > prevTime) {
                const pct = ((seg.time - prevTime) / CONFIG.TIMELINE_DURATION) * 100;
                const el = document.createElement('div');
                el.className = `timeline-segment ${prevState ? 'connected' : 'disconnected'}`;
                el.style.width = pct + '%';
                dom.timelineBar.appendChild(el);
            }
            prevTime = seg.time;
            prevState = seg.online;
        }

        // Fill remaining
        if (prevTime < now) {
            const pct = ((now - prevTime) / CONFIG.TIMELINE_DURATION) * 100;
            const el = document.createElement('div');
            el.className = `timeline-segment ${prevState ? 'connected' : 'disconnected'}`;
            el.style.width = pct + '%';
            dom.timelineBar.appendChild(el);
        }
    }

    // ========================================
    // Diagnostics Engine
    // ========================================
    const DIAG_TESTS = [
        {
            id: 'navigator',
            label: 'Ağ Adaptörü Durumu',
            desc: 'Donanım bağlantısı (WiFi/Ethernet)',
            run: async () => {
                return {
                    pass: navigator.onLine,
                    detail: navigator.onLine ? 'Adaptör bağlı' : 'Adaptör bağlantısı yok',
                };
            }
        },
        {
            id: 'dns_google',
            label: 'DNS Çözümleme (Google)',
            desc: 'google.com alan adı çözümlemesi',
            run: async () => {
                try {
                    const t0 = performance.now();
                    await fetch('https://dns.google/resolve?name=google.com&type=A', {
                        mode: 'cors', cache: 'no-store',
                        signal: AbortSignal.timeout(4000),
                    });
                    const ms = Math.round(performance.now() - t0);
                    return { pass: true, detail: `${ms}ms` };
                } catch {
                    return { pass: false, detail: 'Zaman aşımı' };
                }
            }
        },
        {
            id: 'cdn_cloudflare',
            label: 'Cloudflare CDN',
            desc: '1.1.1.1 erişim testi',
            run: async () => {
                try {
                    const t0 = performance.now();
                    await fetch('https://1.1.1.1/cdn-cgi/trace', {
                        mode: 'no-cors', cache: 'no-store',
                        signal: AbortSignal.timeout(4000),
                    });
                    const ms = Math.round(performance.now() - t0);
                    return { pass: true, detail: `${ms}ms` };
                } catch {
                    return { pass: false, detail: 'Erişilemedi' };
                }
            }
        },
        {
            id: 'cdn_google',
            label: 'Google Sunucuları',
            desc: 'google.com erişim testi',
            run: async () => {
                try {
                    const t0 = performance.now();
                    await fetch('https://www.google.com/generate_204', {
                        mode: 'no-cors', cache: 'no-store',
                        signal: AbortSignal.timeout(4000),
                    });
                    const ms = Math.round(performance.now() - t0);
                    return { pass: true, detail: `${ms}ms` };
                } catch {
                    return { pass: false, detail: 'Erişilemedi' };
                }
            }
        },
        {
            id: 'cdn_microsoft',
            label: 'Microsoft Sunucuları',
            desc: 'microsoft.com erişim testi',
            run: async () => {
                try {
                    const t0 = performance.now();
                    await fetch('https://www.msftconnecttest.com/connecttest.txt', {
                        mode: 'no-cors', cache: 'no-store',
                        signal: AbortSignal.timeout(4000),
                    });
                    const ms = Math.round(performance.now() - t0);
                    return { pass: true, detail: `${ms}ms` };
                } catch {
                    return { pass: false, detail: 'Erişilemedi' };
                }
            }
        },
        {
            id: 'cdn_amazon',
            label: 'Amazon AWS',
            desc: 'AWS altyapı erişim testi',
            run: async () => {
                try {
                    const t0 = performance.now();
                    await fetch('https://aws.amazon.com/favicon.ico', {
                        mode: 'no-cors', cache: 'no-store',
                        signal: AbortSignal.timeout(4000),
                    });
                    const ms = Math.round(performance.now() - t0);
                    return { pass: true, detail: `${ms}ms` };
                } catch {
                    return { pass: false, detail: 'Erişilemedi' };
                }
            }
        },
    ];

    async function runDiagnostics() {
        // Show diagnostics panel
        dom.diagSection.style.display = '';
        dom.diagStatusBadge.textContent = 'Çalışıyor...';
        dom.diagStatusBadge.className = 'diag-status-badge running';
        dom.diagVerdictIcon.textContent = '🔍';
        dom.diagVerdictTitle.textContent = 'Tanılama çalışıyor...';
        dom.diagVerdictDesc.textContent = 'Bağlantı sorunlarının kaynağı tespit ediliyor';

        // Render initial test rows (waiting state)
        dom.diagTests.innerHTML = DIAG_TESTS.map(test => `
            <div class="diag-test-row" id="diag-row-${test.id}">
                <div class="diag-test-status wait">⏳</div>
                <div class="diag-test-label">${test.label}</div>
                <div class="diag-test-result">${test.desc}</div>
            </div>
        `).join('');

        // Get connection info
        const connInfo = getConnectionInfo();
        renderConnectionInfo(connInfo);

        // Run tests sequentially for visual effect
        const results = {};
        for (const test of DIAG_TESTS) {
            const result = await test.run();
            results[test.id] = result;

            // Update the row
            const row = document.getElementById(`diag-row-${test.id}`);
            if (row) {
                const statusEl = row.querySelector('.diag-test-status');
                const resultEl = row.querySelector('.diag-test-result');
                statusEl.className = `diag-test-status ${result.pass ? 'pass' : 'fail'}`;
                statusEl.textContent = result.pass ? '✓' : '✗';
                resultEl.textContent = result.detail;
            }
        }

        // Analyze results and determine verdict
        const verdict = analyzeResults(results, connInfo);

        // Update verdict UI
        dom.diagVerdictIcon.textContent = verdict.icon;
        dom.diagVerdictTitle.textContent = verdict.title;
        dom.diagVerdictDesc.textContent = verdict.description;
        dom.diagStatusBadge.textContent = 'Tamamlandı';
        dom.diagStatusBadge.className = 'diag-status-badge done';

        return {
            results,
            connInfo,
            verdict,
            timestamp: Date.now(),
        };
    }

    function getConnectionInfo() {
        const info = {
            type: 'Bilinmiyor',
            effectiveType: 'Bilinmiyor',
            downlink: 'Bilinmiyor',
            rtt: 'Bilinmiyor',
            saveData: false,
            navigatorOnline: navigator.onLine,
        };

        if ('connection' in navigator) {
            const conn = navigator.connection;
            const typeMap = {
                'wifi': 'WiFi',
                'cellular': 'Mobil Veri',
                'ethernet': 'Ethernet',
                'bluetooth': 'Bluetooth',
                'wimax': 'WiMAX',
                'none': 'Bağlantı Yok',
                'unknown': 'Bilinmiyor',
            };
            info.type = typeMap[conn.type] || conn.type || 'Bilinmiyor';
            info.effectiveType = conn.effectiveType ? conn.effectiveType.toUpperCase() : 'Bilinmiyor';
            info.downlink = conn.downlink != null ? conn.downlink + ' Mbps' : 'Bilinmiyor';
            info.rtt = conn.rtt != null ? conn.rtt + ' ms' : 'Bilinmiyor';
            info.saveData = conn.saveData || false;
        }

        return info;
    }

    function renderConnectionInfo(info) {
        dom.diagInfo.innerHTML = `
            <div class="diag-info-item">
                <span class="diag-info-label">Bağlantı Türü</span>
                <span class="diag-info-value">${info.type}</span>
            </div>
            <div class="diag-info-item">
                <span class="diag-info-label">Etkin Tür</span>
                <span class="diag-info-value">${info.effectiveType}</span>
            </div>
            <div class="diag-info-item">
                <span class="diag-info-label">İndirme Hızı</span>
                <span class="diag-info-value">${info.downlink}</span>
            </div>
            <div class="diag-info-item">
                <span class="diag-info-label">Gecikme (RTT)</span>
                <span class="diag-info-value">${info.rtt}</span>
            </div>
            <div class="diag-info-item">
                <span class="diag-info-label">Adaptör Durumu</span>
                <span class="diag-info-value">${info.navigatorOnline ? 'Çevrimiçi' : 'Çevrimdışı'}</span>
            </div>
        `;
    }

    function analyzeResults(results, connInfo) {
        const allFailed = Object.values(results).every(r => !r.pass);
        const allPassed = Object.values(results).every(r => r.pass);
        const navigatorOff = !results.navigator?.pass;
        const dnsFailed = !results.dns_google?.pass;
        const somePassed = Object.values(results).some(r => r.pass);
        const someServers = [results.cdn_cloudflare, results.cdn_google, results.cdn_microsoft, results.cdn_amazon];
        const serverPassCount = someServers.filter(r => r?.pass).length;
        const serverFailCount = someServers.filter(r => !r?.pass).length;

        // WiFi/Ethernet adapter disconnected
        if (navigatorOff && allFailed) {
            return {
                icon: '📡',
                title: 'Ağ Adaptörü Bağlantısı Kesildi',
                description: 'WiFi veya Ethernet kablonuz bağlı değil. Bilgisayarınız hiçbir ağa bağlı değil. WiFi ayarlarınızı kontrol edin veya Ethernet kablonuzu takın.',
                cause: 'adapter',
            };
        }

        // Adapter says online but everything fails - likely router/modem issue
        if (!navigatorOff && allFailed && dnsFailed) {
            return {
                icon: '🔌',
                title: 'Modem/Yönlendirici Sorunu',
                description: 'Bilgisayarınız yerel ağa bağlı ama internet erişimi yok. Modem veya yönlendiricinizi (router) yeniden başlatmayı deneyin. ISP (internet sağlayıcınız) kaynaklı da olabilir.',
                cause: 'router',
            };
        }

        // DNS fails but some servers work (DNS specific issue)
        if (dnsFailed && serverPassCount > 0) {
            return {
                icon: '🌐',
                title: 'DNS Çözümleme Sorunu',
                description: 'İnternet bağlantınız var ancak DNS sunucuları yanıt vermiyor. DNS ayarlarınızı değiştirmeyi deneyin (8.8.8.8 veya 1.1.1.1 önerilir).',
                cause: 'dns',
            };
        }

        // Only some servers fail - partial connectivity / ISP routing
        if (somePassed && serverFailCount > 0 && serverPassCount > 0) {
            return {
                icon: '🔀',
                title: 'Kısmi Bağlantı Sorunu',
                description: 'Bazı sunuculara erişilebiliyor, bazılarına erişilemiyor. Bu genellikle ISP yönlendirme sorununa veya geçici bir ağ problemine işaret eder.',
                cause: 'partial',
            };
        }

        // Everything works (transient issue)
        if (allPassed) {
            return {
                icon: '⚡',
                title: 'Geçici Bağlantı Kesintisi',
                description: 'Tanılama sırasında bağlantı geri geldi. Kısa süreli bir mikro kopma yaşanmış olabilir. Sık tekrarlanıyorsa ISP\'nize bildirin.',
                cause: 'transient',
            };
        }

        // Default: full outage
        return {
            icon: '🚫',
            title: 'Tam İnternet Kesintisi',
            description: 'Hiçbir sunucuya erişilemiyor. ISP (internet sağlayıcınız) kaynaklı bir sorun olabilir. Modeminizi yeniden başlatın, sorun devam ederse ISP\'nizi arayın.',
            cause: 'full_outage',
        };
    }

    // ========================================
    // Event Log
    // ========================================
    function addEvent(type, time, duration, diagnostics) {
        const event = {
            type,
            time: time instanceof Date ? time : new Date(time),
            duration,
            diagnostics: diagnostics || null,
        };
        state.events.unshift(event);

        if (state.events.length > CONFIG.MAX_LOG_ENTRIES) {
            state.events.pop();
        }

        renderEvents();
        saveState();
    }

    function renderEvents() {
        if (state.events.length === 0) {
            dom.logEmpty.style.display = '';
            return;
        }

        dom.logEmpty.style.display = 'none';

        // Remove old entries except logEmpty
        const existingEntries = dom.logContainer.querySelectorAll('.log-entry');
        existingEntries.forEach(e => e.remove());

        for (const event of state.events) {
            const entry = document.createElement('div');
            entry.className = 'log-entry';

            if (event.type === 'down') {
                let diagHTML = '';
                if (event.diagnostics && event.diagnostics.verdict) {
                    const v = event.diagnostics.verdict;
                    const r = event.diagnostics.results || {};
                    const tags = Object.entries(r).map(([key, val]) => {
                        const names = {
                            navigator: 'Adaptör',
                            dns_google: 'DNS',
                            cdn_cloudflare: 'Cloudflare',
                            cdn_google: 'Google',
                            cdn_microsoft: 'Microsoft',
                            cdn_amazon: 'AWS',
                        };
                        return `<span class="log-diag-tag ${val.pass ? 'pass' : 'fail'}">${names[key] || key}: ${val.pass ? '✓' : '✗'}</span>`;
                    }).join('');

                    diagHTML = `
                        <div class="log-diag-summary">
                            <div class="log-diag-title">${v.icon} ${v.title}</div>
                            <div class="log-diag-cause">${v.description}</div>
                            <div class="log-diag-tests-mini">${tags}</div>
                        </div>
                    `;
                }

                entry.innerHTML = `
                    <div class="log-dot down"></div>
                    <div class="log-content">
                        <div class="log-title down">⚠ İnternet bağlantısı kesildi</div>
                        <div class="log-meta">Bağlantı kopması tespit edildi</div>
                        ${diagHTML}
                    </div>
                    <div class="log-time">${formatEventTime(event.time)}</div>
                `;
            } else {
                let detailsHTML = '';
                // Sanitize duration to prevent displaying corrupt/epoch duration values (outages > 24 hours)
                if (event.duration && event.duration < 24 * 60 * 60 * 1000) {
                    const disconnectTime = new Date(event.time.getTime() - event.duration);
                    detailsHTML = `
                        <div class="log-meta">
                            Kopma: <strong>${formatTime(disconnectTime)}</strong> ➔ Geri Gelme: <strong>${formatTime(event.time)}</strong>
                            <span class="log-duration" style="margin-left: 8px;">Süre: ${formatDurationFriendly(event.duration)}</span>
                        </div>
                    `;
                } else {
                    detailsHTML = `
                        <div class="log-meta">Bağlantı yeniden kuruldu</div>
                    `;
                }

                entry.innerHTML = `
                    <div class="log-dot up"></div>
                    <div class="log-content">
                        <div class="log-title up">✓ Bağlantı geri geldi</div>
                        ${detailsHTML}
                    </div>
                    <div class="log-time">${formatEventTime(event.time)}</div>
                `;
            }

            dom.logContainer.appendChild(entry);
        }
    }

    // ========================================
    // Internet Speed Test Engine
    // ========================================
    let speedTestEngine = null;
    let liveTickerInterval = null;
    let animFrameId = null;
    let currentDisplayValue = 0;
    let targetDisplayValue = 0;
    let currentPhaseType = '';
    let phasePeakSpeed = 0;        // Peak speed in current phase (never goes down)
    let smoothedSpeed = 0;          // EMA smoothed speed value
    let lastEntryCount = 0;         // Track new resource entries

    // Helper to calculate gauge SVG dashoffset dynamically up to 1000 Mbps
    function calcSpeedGaugeOffset(valMbps) {
        const val = parseFloat(valMbps) || 0;
        let max = 100;
        if (val > 100 && val <= 500) max = 500;
        if (val > 500) max = 1000;
        const percent = Math.min(val / max, 1);
        return Math.max(0, Math.min(408, 408 * (1 - percent)));
    }

    function setTargetGaugeValue(val) {
        targetDisplayValue = parseFloat(val) || 0;
    }

    function startGaugeAnimation() {
        function tick() {
            if (!speedTestEngine || !speedTestEngine.isRunning) {
                animFrameId = null;
                return;
            }
            const diff = targetDisplayValue - currentDisplayValue;
            if (Math.abs(diff) > 0.05) {
                currentDisplayValue += diff * 0.06;
            } else {
                currentDisplayValue = targetDisplayValue;
            }
            if (currentPhaseType !== 'latency') {
                dom.gaugeValue.textContent = currentDisplayValue.toFixed(1);
                dom.gaugeFill.style.strokeDashoffset = calcSpeedGaugeOffset(currentDisplayValue);
            } else {
                dom.gaugeValue.textContent = '...';
                dom.gaugeFill.style.strokeDashoffset = '408';
            }
            animFrameId = requestAnimationFrame(tick);
        }
        if (animFrameId) cancelAnimationFrame(animFrameId);
        animFrameId = requestAnimationFrame(tick);
    }

    function startLiveSpeedometer() {
        if (liveTickerInterval) clearInterval(liveTickerInterval);
        phasePeakSpeed = 0;
        smoothedSpeed = 0;
        lastEntryCount = 0;

        liveTickerInterval = setInterval(() => {
            if (!speedTestEngine || !speedTestEngine.isRunning) return;

            const currentPhase = currentPhaseType;
            if (currentPhase !== 'download' && currentPhase !== 'upload') return;

            const entries = performance.getEntriesByType('resource');
            const keyword = currentPhase === 'download' ? '__down' : '__up';
            const filtered = entries.filter(e => e.name.includes(keyword));

            // Only process if we have new entries
            if (filtered.length === lastEntryCount) return;
            lastEntryCount = filtered.length;

            // Take last 6 completed entries for a stable reading
            const recent = filtered.slice(-6);
            let totalBytes = 0;
            let totalDurationMs = 0;

            recent.forEach(entry => {
                const dur = entry.duration;
                if (dur > 10 && entry.transferSize > 0) {
                    totalBytes += entry.transferSize;
                    totalDurationMs += dur;
                }
            });

            if (totalDurationMs > 0 && totalBytes > 0) {
                const rawMbps = (totalBytes * 8) / (totalDurationMs / 1000) / 1000000;

                // Exponential moving average for stability
                if (smoothedSpeed === 0) {
                    smoothedSpeed = rawMbps;
                } else {
                    smoothedSpeed = smoothedSpeed * 0.6 + rawMbps * 0.4;
                }

                // Only go UP — never let the gauge drop during a phase
                if (smoothedSpeed > phasePeakSpeed) {
                    phasePeakSpeed = smoothedSpeed;
                }

                // Gradually climb toward peak (the gauge always trends upward)
                const displaySpeed = phasePeakSpeed;
                const displayMbps = displaySpeed.toFixed(1);

                setTargetGaugeValue(displayMbps);

                if (currentPhase === 'download') {
                    dom.speedDownload.textContent = `${displayMbps} Mbps`;
                } else {
                    dom.speedUpload.textContent = `${displayMbps} Mbps`;
                }
            }
        }, 150); // Check every 150ms for new data
    }

    function stopLiveSpeedometer() {
        if (liveTickerInterval) {
            clearInterval(liveTickerInterval);
            liveTickerInterval = null;
        }
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
    }

    async function startSpeedTest() {
        if (speedTestEngine && speedTestEngine.isRunning) {
            return;
        }

        // Reset UI
        dom.btnStartSpeedTest.disabled = true;
        dom.btnStartSpeedTest.textContent = 'Test Yapılıyor...';
        dom.speedTestStatus.textContent = 'Bağlanıyor...';
        dom.speedTestStatus.className = 'section-badge';
        if (dom.speedGauge) dom.speedGauge.className = 'speed-gauge running';

        dom.speedDownload.textContent = '-- Mbps';
        dom.speedUpload.textContent = '-- Mbps';
        dom.speedPing.textContent = '-- ms';
        dom.speedJitter.textContent = '-- ms';

        dom.gaugeValue.textContent = '0.0';
        dom.gaugeUnit.textContent = 'Mbps';
        dom.gaugeFill.style.strokeDashoffset = '408';
        dom.gaugeFill.className.baseVal = 'gauge-ring-fill';

        currentDisplayValue = 0;
        targetDisplayValue = 0;
        currentPhaseType = '';

        // Clear active classes
        const cards = [dom.metricDownload, dom.metricUpload, dom.metricPing, dom.metricJitter];
        cards.forEach(c => c.className = 'speed-metric-card');

        try {
            // Dynamically import Cloudflare SpeedTest SDK
            dom.speedTestStatus.textContent = 'SDK Yükleniyor...';
            const module = await import('https://esm.sh/@cloudflare/speedtest');
            const SpeedTestClass = module.default;

            speedTestEngine = new SpeedTestClass({
                autoStart: false,
                bandwidthPercentile: 0.98,
                measurements: [
                    { type: "latency", numPackets: 10 },
                    { type: "download", bytes: 1e7, count: 4 },
                    { type: "download", bytes: 5e7, count: 6 },
                    { type: "download", bytes: 1e8, count: 8 },
                    { type: "upload", bytes: 1e7, count: 4 },
                    { type: "upload", bytes: 5e7, count: 6 }
                ]
            });

            // Start live speedometer ticker and continuous gauge animation
            startLiveSpeedometer();
            startGaugeAnimation();

            // 1. Phase change handler
            let previousPhaseType = '';
            speedTestEngine.onPhaseChange = (phase) => {
                const newPhaseType = phase.measurement ? phase.measurement.type : '';
                
                // Only reset gauge when phase TYPE changes (latency→download, download→upload)
                // NOT when a new measurement of the same type starts (10MB→50MB→100MB downloads)
                const typeChanged = (newPhaseType !== previousPhaseType);
                previousPhaseType = newPhaseType;
                currentPhaseType = newPhaseType;

                // Clear active states
                cards.forEach(c => c.className = 'speed-metric-card');

                if (currentPhaseType === 'latency') {
                    dom.speedTestStatus.textContent = 'Gecikme Ölçülüyor...';
                    dom.metricPing.classList.add('active');
                    dom.metricJitter.classList.add('active');
                    dom.gaugeUnit.textContent = 'ms';
                    dom.gaugeValue.textContent = '...';
                } else if (currentPhaseType === 'download') {
                    dom.speedTestStatus.textContent = 'İndirme Ölçülüyor...';
                    dom.metricDownload.classList.add('active');
                    dom.gaugeUnit.textContent = 'Mbps';
                    if (typeChanged) {
                        currentDisplayValue = 0;
                        targetDisplayValue = 0;
                        dom.gaugeValue.textContent = '0.0';
                        phasePeakSpeed = 0;
                        smoothedSpeed = 0;
                        lastEntryCount = 0;
                    }
                } else if (currentPhaseType === 'upload') {
                    dom.speedTestStatus.textContent = 'Yükleme Ölçülüyor...';
                    dom.metricUpload.classList.add('active-upload');
                    dom.gaugeUnit.textContent = 'Mbps';
                    if (typeChanged) {
                        currentDisplayValue = 0;
                        targetDisplayValue = 0;
                        phasePeakSpeed = 0;
                        smoothedSpeed = 0;
                        lastEntryCount = 0;
                    }
                }
            };

            // 2. Real-time results update handler
            speedTestEngine.onResultsChange = () => {
                const summary = speedTestEngine.results.getSummary();

                // Latency & Jitter
                if (summary.latency !== undefined) {
                    dom.speedPing.textContent = `${Math.round(summary.latency)} ms`;
                    if (currentPhaseType === 'latency') {
                        setTargetGaugeValue(Math.round(summary.latency));
                    }
                }
                if (summary.jitter !== undefined) {
                    dom.speedJitter.textContent = `${Math.round(summary.jitter)} ms`;
                }

                // Download Bandwidth (only update side card, gauge is handled by live ticker)
                if (summary.download) {
                    const dlMbps = (summary.download / 1000000).toFixed(1);
                    dom.speedDownload.textContent = `${dlMbps} Mbps`;
                }

                // Upload Bandwidth (only update side card, gauge is handled by live ticker)
                if (summary.upload) {
                    const ulMbps = (summary.upload / 1000000).toFixed(1);
                    dom.speedUpload.textContent = `${ulMbps} Mbps`;
                }
            };

            // 3. Test completed handler
            speedTestEngine.onFinish = (results) => {
                stopLiveSpeedometer();
                const summary = results.getSummary();

                dom.speedTestStatus.textContent = 'Tamamlandı';
                dom.btnStartSpeedTest.disabled = false;
                dom.btnStartSpeedTest.textContent = 'Yeniden Başlat';
                if (dom.speedGauge) dom.speedGauge.className = 'speed-gauge completed';

                // Display final summary values
                const dlMbps = (summary.download / 1000000).toFixed(1);
                const ulMbps = (summary.upload / 1000000).toFixed(1);

                dom.speedDownload.textContent = `${dlMbps} Mbps`;
                dom.speedUpload.textContent = `${ulMbps} Mbps`;
                dom.speedPing.textContent = `${Math.round(summary.latency)} ms`;
                dom.speedJitter.textContent = `${Math.round(summary.jitter)} ms`;

                // Set final green gauge position smoothly to download speed
                dom.gaugeUnit.textContent = 'Mbps';
                setTargetGaugeValue(dlMbps);
                dom.gaugeFill.className.baseVal = 'gauge-ring-fill completed';

                // Clear all active card pulses
                cards.forEach(c => c.className = 'speed-metric-card');

                showToast('Hız testi başarıyla tamamlandı!', 'success');
            };

            // Start the test
            speedTestEngine.play();

        } catch (error) {
            stopLiveSpeedometer();
            console.error('Speed test failed:', error);
            dom.speedTestStatus.textContent = 'Hata Oluştu';
            dom.btnStartSpeedTest.disabled = false;
            dom.btnStartSpeedTest.textContent = 'Hız Testini Başlat';
            if (dom.speedGauge) dom.speedGauge.className = 'speed-gauge';
            showToast(`Hız testi başlatılamadı: ${error.message || error}`, 'error');
        }
    }

    // ========================================
    // Toast Notifications
    // ========================================
    function showToast(message, type) {
        // Remove existing toasts
        document.querySelectorAll('.toast').forEach(t => t.remove());

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icon = type === 'error'
            ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';

        toast.innerHTML = icon + `<span>${message}</span>`;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('out');
            setTimeout(() => toast.remove(), 300);
        }, CONFIG.TOAST_DURATION);
    }

    // ========================================
    // Utility Functions
    // ========================================
    function formatTime(date) {
        return date.toLocaleTimeString('tr-TR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    }

    function formatEventTime(date) {
        const now = new Date();
        const isToday = date.getDate() === now.getDate() &&
                        date.getMonth() === now.getMonth() &&
                        date.getFullYear() === now.getFullYear();
        
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const isYesterday = date.getDate() === yesterday.getDate() &&
                            date.getMonth() === yesterday.getMonth() &&
                            date.getFullYear() === yesterday.getFullYear();
        
        const timeStr = date.toLocaleTimeString('tr-TR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
        
        if (isToday) {
            return `Bugün ${timeStr}`;
        } else if (isYesterday) {
            return `Dün ${timeStr}`;
        } else {
            const dateStr = date.toLocaleDateString('tr-TR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
            return `${dateStr} ${timeStr}`;
        }
    }

    function formatDateTime(date) {
        return date.toLocaleString('tr-TR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        });
    }

    function formatDurationFriendly(ms) {
        if (ms < 0) ms = 0;
        const totalSec = Math.floor(ms / 1000);
        if (totalSec < 60) {
            return `${totalSec} saniye`;
        }
        const minutes = Math.floor(totalSec / 60);
        const seconds = totalSec % 60;
        if (seconds === 0) {
            return `${minutes} dakika`;
        }
        return `${minutes} dk ${seconds} sn`;
    }

    function formatDuration(ms) {
        if (ms < 0) ms = 0;
        const totalSec = Math.floor(ms / 1000);
        const hours = Math.floor(totalSec / 3600);
        const minutes = Math.floor((totalSec % 3600) / 60);
        const seconds = totalSec % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    // ========================================
    // Clear History
    // ========================================
    function clearHistory() {
        state.disconnectCount = 0;
        state.totalDowntimeMs = 0;
        state.latencyHistory = [];
        state.allLatencies = [];
        state.events = [];
        state.timelineSegments = [];
        state.statusSince = new Date();
        state.monitorStart = new Date();

        addTimelineSegment(state.isOnline, new Date());
        renderEvents();
        updateStatsUI();
        updateTimelineUI();
        chart.draw();
        dom.chartOverlay.classList.remove('hidden');

        dom.monitorStart.textContent = formatDateTime(state.monitorStart);
        dom.avgLatency.textContent = '-- ms';

        // Clear saved data
        try { localStorage.removeItem(CONFIG.STORAGE_KEY); } catch (e) {}

        showToast('Geçmiş temizlendi', 'success');
    }

    // ========================================
    // LocalStorage Persistence
    // ========================================
    function saveState() {
        try {
            const data = {
                monitorStart: state.monitorStart.getTime(),
                disconnectCount: state.disconnectCount,
                totalDowntimeMs: state.totalDowntimeMs,
                events: state.events.map(e => ({
                    type: e.type,
                    time: e.time instanceof Date ? e.time.getTime() : e.time,
                    duration: e.duration || null,
                    diagnostics: e.diagnostics || null,
                })),
                timelineSegments: state.timelineSegments,
                allLatencies: state.allLatencies.slice(-200),
                latencyHistory: state.latencyHistory.map(l => ({
                    time: l.time instanceof Date ? l.time.getTime() : l.time,
                    latency: l.latency,
                })),
                lastOffline: state.lastOffline ? state.lastOffline.getTime() : null,
                lastOnline: state.lastOnline ? state.lastOnline.getTime() : null,
                isOnline: state.isOnline,
                lastSaved: Date.now(),
            };
            localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            // Storage full or unavailable
        }
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
            if (!raw) return false;

            const data = JSON.parse(raw);
            if (!data || !data.lastSaved) return false;

            // Only restore if saved within the last 24 hours
            if (Date.now() - data.lastSaved > 24 * 60 * 60 * 1000) {
                localStorage.removeItem(CONFIG.STORAGE_KEY);
                return false;
            }

            state.monitorStart = new Date(data.monitorStart);
            state.disconnectCount = data.disconnectCount || 0;
            state.totalDowntimeMs = data.totalDowntimeMs || 0;
            state.allLatencies = data.allLatencies || [];

            state.events = (data.events || []).map(e => ({
                type: e.type,
                time: new Date(e.time),
                duration: e.duration || null,
                diagnostics: e.diagnostics || null,
            }));

            state.timelineSegments = data.timelineSegments || [];
            state.lastOffline = data.lastOffline ? new Date(data.lastOffline) : null;
            state.lastOnline = data.lastOnline ? new Date(data.lastOnline) : null;
            state.isOnline = data.isOnline !== undefined ? data.isOnline : null;

            state.latencyHistory = (data.latencyHistory || []).map(l => ({
                time: new Date(l.time),
                latency: l.latency,
            }));

            return true;
        } catch (e) {
            return false;
        }
    }

    // ========================================
    // Browser online/offline events
    // ========================================
    function setupBrowserEvents() {
        window.addEventListener('online', () => {
            // Browser detected connection - do immediate check
            checkConnectivity();
        });

        window.addEventListener('offline', () => {
            // Browser detected disconnection - process immediately
            processResult(false, null);
        });
    }

    // ========================================
    // Initialization
    // ========================================
    function init() {
        // Create background particles
        createParticles();

        // Initialize chart
        chart.init();

        // Load saved state from localStorage
        const restored = loadState();
        if (restored) {
            // Restore UI from saved data
            renderEvents();
            updateStatsUI();
            updateTimelineUI();
            chart.draw();
            if (state.latencyHistory.length >= 2) {
                dom.chartOverlay.classList.add('hidden');
            }
        }

        // Set monitor start time
        dom.monitorStart.textContent = formatDateTime(state.monitorStart);

        // Setup FAQ Accordion
        const faqQuestions = document.querySelectorAll('.faq-question');
        faqQuestions.forEach(btn => {
            btn.addEventListener('click', () => {
                const item = btn.parentElement;
                item.classList.toggle('active');
            });
        });

        // Setup Smart Assistant Modal
        const btnAssistant = document.getElementById('btnAssistant');
        const modal = document.getElementById('assistantModal');
        const btnClose = document.getElementById('btnCloseAssistant');
        const btnStartAnalysis = document.getElementById('btnStartAnalysis');
        const viewWelcome = document.getElementById('assistantWelcome');
        const viewRunning = document.getElementById('assistantRunning');
        const viewResult = document.getElementById('assistantResult');
        const btnCopyScript = document.getElementById('btnCopyScript');

        if (btnAssistant && modal) {
            btnAssistant.addEventListener('click', () => {
                modal.classList.remove('hidden');
                viewWelcome.classList.remove('hidden');
                viewRunning.classList.add('hidden');
                viewResult.classList.add('hidden');
            });

            btnClose.addEventListener('click', () => modal.classList.add('hidden'));
            
            btnStartAnalysis.addEventListener('click', () => {
                viewWelcome.classList.add('hidden');
                viewRunning.classList.remove('hidden');
                
                // Simulate analysis
                const steps = document.querySelectorAll('.progress-step');
                let step = 0;
                
                const interval = setInterval(() => {
                    if (step > 0 && step <= steps.length) {
                        steps[step - 1].classList.remove('active');
                        steps[step - 1].style.color = '#10b981'; // Green check
                        steps[step - 1].innerHTML = '✓ ' + steps[step - 1].innerHTML.replace('✓ ', '');
                    }
                    if (step < steps.length) {
                        steps[step].classList.add('active');
                    } else {
                        clearInterval(interval);
                        setTimeout(() => {
                            viewRunning.classList.add('hidden');
                            viewResult.classList.remove('hidden');
                        }, 500);
                    }
                    step++;
                }, 1500);
            });

            btnCopyScript.addEventListener('click', () => {
                const scriptText = document.querySelector('.script-box').textContent.trim();
                navigator.clipboard.writeText(scriptText);
                btnCopyScript.textContent = 'Kopyalandı!';
                setTimeout(() => btnCopyScript.textContent = 'Metni Kopyala', 2000);
            });
        }

        // Start periodic checks
        checkConnectivity();
        state.checkTimer = setInterval(checkConnectivity, CONFIG.CHECK_INTERVAL);
        state.uptimeTimer = setInterval(updateUptime, 1000);

        // Setup browser events
        setupBrowserEvents();

        // Clear button
        dom.btnClear.addEventListener('click', clearHistory);
        if (dom.btnClearLog) {
            dom.btnClearLog.addEventListener('click', clearHistory);
        }

        // Speed Test button
        if (dom.btnStartSpeedTest) {
            dom.btnStartSpeedTest.addEventListener('click', startSpeedTest);
        }

        // Page visibility: check immediately when page becomes visible
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                checkConnectivity();
            }
        });

        // Save state before page unload
        window.addEventListener('beforeunload', saveState);

        // Register service worker for PWA
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js').catch(() => {});
        }
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
