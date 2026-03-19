/* ============================================================
   FunctionMath — app.js
   Function analysis engine + UI controller
   ============================================================ */

const GEMINI_API_KEY = "AIzaSyDAOHv_a7dV6mcj7o0ID2-vt39PvKcfMTE";

window.addEventListener('load', () => {
    if (typeof math === 'undefined' || typeof katex === 'undefined') {
        setTimeout(() => init(), 500);
    } else { init(); }
});

/* ============================================================
   1. LATEX PARSER — MathLive LaTeX → math.js expression
   ============================================================ */
function findMatchingBrace(s, openPos) {
    let depth = 0;
    for (let i = openPos; i < s.length; i++) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}') { depth--; if (depth === 0) return i; }
    }
    return s.length - 1;
}

function extractBraceArg(s, pos) {
    while (pos < s.length && s[pos] === ' ') pos++;
    if (s[pos] !== '{') return { arg: s[pos] || '', end: pos + 1 };
    const close = findMatchingBrace(s, pos);
    return { arg: s.substring(pos + 1, close), end: close + 1 };
}

function latexToExpr(latex) {
    if (!latex) return '';
    let s = latex.trim();
    s = s.replace(/\\left\|/g, 'ABS_OPEN').replace(/\\right\|/g, 'ABS_CLOSE');
    s = s.replace(/\\left/g, '').replace(/\\right/g, '');
    s = s.replace(/\\bigl/g, '').replace(/\\bigr/g, '');
    s = processLatex(s);
    s = s.replace(/\{/g, '(').replace(/\}/g, ')');
    s = addImplicitMult(s);
    s = s.replace(/\s+/g, '');
    return s;
}

function processLatex(s) {
    let result = '', i = 0;
    while (i < s.length) {
        if (s[i] === '\\') {
            const cmd = readCommand(s, i); i = cmd.end;
            switch (cmd.name) {
                case 'frac': { const a1 = extractBraceArg(s, i); i = a1.end; const a2 = extractBraceArg(s, i); i = a2.end; result += `((${processLatex(a1.arg)})/(${processLatex(a2.arg)}))`; break; }
                case 'sqrt': {
                    if (s[i] === '[') { const cb = s.indexOf(']', i); const n = s.substring(i + 1, cb); i = cb + 1; const a1 = extractBraceArg(s, i); i = a1.end; result += `((${processLatex(a1.arg)})^(1/${processLatex(n)}))`; }
                    else { const a1 = extractBraceArg(s, i); i = a1.end; result += `sqrt(${processLatex(a1.arg)})`; }
                    break;
                }
                case 'sin': result += 'sin'; break;
                case 'cos': result += 'cos'; break;
                case 'tan': result += 'tan'; break;
                case 'arcsin': result += 'asin'; break;
                case 'arccos': result += 'acos'; break;
                case 'arctan': result += 'atan'; break;
                case 'ln': result += 'log'; break;
                case 'log': result += 'log10'; break;
                case 'exp': result += 'exp'; break;
                case 'pi': result += '(pi)'; break;
                case 'cdot': case 'times': result += '*'; break;
                case 'div': result += '/'; break;
                case 'infty': result += 'Infinity'; break;
                case 'operatorname': { const a1 = extractBraceArg(s, i); i = a1.end; result += a1.arg; break; }
                default: result += cmd.name; break;
            }
        } else if (s.substring(i, i + 8) === 'ABS_OPEN') {
            const closeIdx = s.indexOf('ABS_CLOSE', i + 8);
            if (closeIdx !== -1) { result += `abs(${processLatex(s.substring(i + 8, closeIdx))})`; i = closeIdx + 9; }
            else { result += 'abs('; i += 8; }
        } else if (s[i] === '^') {
            i++;
            if (s[i] === '{') { const a1 = extractBraceArg(s, i); i = a1.end; result += `^(${processLatex(a1.arg)})`; }
            else { result += '^' + s[i]; i++; }
        } else if (s[i] === '_') {
            i++;
            if (s[i] === '{') { const a1 = extractBraceArg(s, i); i = a1.end; }
            else { i++; }
        } else { result += s[i]; i++; }
    }
    return result;
}

function readCommand(s, pos) {
    let i = pos + 1, name = '';
    while (i < s.length && /[a-zA-Z]/.test(s[i])) { name += s[i]; i++; }
    return { name, end: i };
}

function addImplicitMult(s) {
    let r = '';
    for (let i = 0; i < s.length; i++) {
        r += s[i];
        if (i + 1 < s.length) {
            const c = s[i], n = s[i + 1];
            if (/[0-9a-zA-Z\)π]/.test(c) && /[a-zA-Z\(π]/.test(n)) {
                if (/[0-9]/.test(c) && /[a-zA-Z]/.test(n)) {
                    const rest = s.substring(i + 1);
                    if (/^(sin|cos|tan|log|log10|sqrt|abs|exp|asin|acos|atan|pi)\b/.test(rest) || /^[a-zA-Z](?![a-zA-Z])/.test(rest)) r += '*';
                } else if (c === ')' && (n === '(' || /[a-zA-Z0-9]/.test(n))) {
                    r += '*';
                } else if (/[a-zA-Z]/.test(c) && n === '(') {
                    const funcsBefore = ['sin', 'cos', 'tan', 'log', 'log10', 'sqrt', 'abs', 'exp', 'asin', 'acos', 'atan'];
                    if (!funcsBefore.some(fn => r.endsWith(fn))) r += '*';
                }
            }
        }
    }
    return r;
}

/* ============================================================
   2. NUMERICAL ANALYSIS ENGINE
   ============================================================ */
const SCAN_MIN = -50, SCAN_MAX = 50, SCAN_POINTS = 20000;

function createEvalFn(exprStr) {
    const compiled = math.compile(exprStr);
    return (x) => {
        try { const r = compiled.evaluate({ x, e: Math.E, pi: Math.PI }); return typeof r === 'number' ? r : NaN; }
        catch { return NaN; }
    };
}

function roundNice(v, decimals = 6) {
    if (!isFinite(v)) return v;
    const r = Math.round(v * 10 ** decimals) / 10 ** decimals;
    return Math.abs(r) < 1e-12 ? 0 : r;
}

function numToLatex(v) {
    if (v === Infinity) return '+\\infty';
    if (v === -Infinity) return '-\\infty';
    if (isNaN(v)) return '\\nexists';
    return String(roundNice(v, 4));
}

function bisect(f, a, b, tol = 1e-10, maxIter = 80) {
    let fa = f(a), fb = f(b);
    if (fa * fb > 0) return null;
    for (let i = 0; i < maxIter; i++) {
        const m = (a + b) / 2, fm = f(m);
        if (Math.abs(fm) < tol || (b - a) / 2 < tol) return m;
        if (fa * fm < 0) { b = m; fb = fm; } else { a = m; fa = fm; }
    }
    return (a + b) / 2;
}

function findRoots(f, xMin = SCAN_MIN, xMax = SCAN_MAX, n = SCAN_POINTS) {
    const roots = [];
    const dx = (xMax - xMin) / n;
    for (let i = 0; i < n; i++) {
        const x1 = xMin + i * dx, x2 = x1 + dx;
        const y1 = f(x1), y2 = f(x2);
        if (Math.abs(y1) < 1e-12 && isFinite(y1)) {
            if (!roots.length || Math.abs(x1 - roots[roots.length - 1]) > 0.001) roots.push(roundNice(x1));
            continue;
        }
        if (isFinite(y1) && isFinite(y2) && y1 * y2 < 0 && Math.abs(y1 - y2) < 1e6) {
            const r = bisect(f, x1, x2);
            if (r !== null && (!roots.length || Math.abs(r - roots[roots.length - 1]) > 0.001)) roots.push(roundNice(r));
        }
    }
    return roots;
}

function findDiscontinuities(f, xMin = SCAN_MIN, xMax = SCAN_MAX, n = SCAN_POINTS) {
    const discs = [], dx = (xMax - xMin) / n;
    for (let i = 0; i < n; i++) {
        const x = xMin + i * dx, y = f(x);
        if (!isFinite(y) && isFinite(f(x - dx)) && isFinite(f(x + dx))) discs.push(roundNice(x));
        if (isFinite(y) && isFinite(f(x + dx)) && Math.abs(f(x + dx) - y) > 1e5 * dx) {
            const mid = x + dx / 2;
            if (!isFinite(f(mid))) discs.push(roundNice(mid));
        }
    }
    const clustered = [];
    for (const d of discs) { if (!clustered.length || Math.abs(d - clustered[clustered.length - 1]) > 0.05) clustered.push(d); }
    return clustered;
}

function findDomainBoundaries(f) {
    const bounds = [], dx = (SCAN_MAX - SCAN_MIN) / SCAN_POINTS;
    let prevDefined = isFinite(f(SCAN_MIN));
    for (let i = 1; i <= SCAN_POINTS; i++) {
        const x = SCAN_MIN + i * dx, curDefined = isFinite(f(x));
        if (prevDefined !== curDefined) {
            let a = x - dx, b = x;
            for (let j = 0; j < 60; j++) { const m = (a + b) / 2; if (isFinite(f(m)) === prevDefined) a = m; else b = m; }
            bounds.push({ x: roundNice((a + b) / 2), entersDefined: curDefined });
        }
        prevDefined = curDefined;
    }
    return bounds;
}

function limitAtInf(f, sign) {
    const xs = [10, 50, 100, 500, 1000, 5000, 10000];
    const vals = xs.map(x => f(sign * x)).filter(v => !isNaN(v));
    if (!vals.length) return NaN;
    const last = vals[vals.length - 1];
    if (Math.abs(last) > 1e12) return last > 0 ? Infinity : -Infinity;
    if (vals.length >= 4) {
        const diffs = [];
        for (let i = 1; i < vals.length; i++) diffs.push(Math.abs(vals[i] - vals[i - 1]));
        if (diffs.slice(-3).every(d => d < 0.001)) return roundNice(last);
        if (Math.abs(last) > 100 && diffs.slice(-3).every(d => d > 1) && diffs.length >= 2 && diffs[diffs.length - 1] / (diffs[diffs.length - 2] || 1) > 0.5)
            return last > 0 ? Infinity : -Infinity;
    }
    if (Math.abs(last) > 1000) {
        const v1 = f(sign * 1000), v2 = f(sign * 10000);
        if (isFinite(v1) && isFinite(v2) && Math.abs(v2) > Math.abs(v1) * 1.5)
            return last > 0 ? Infinity : -Infinity;
    }
    return roundNice(last);
}

function numLimitDirectional(f, x0, dir) {
    const hs = [1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8];
    const sign = dir === 'left' ? -1 : 1;
    const vals = hs.map(h => f(x0 + sign * h));
    const finiteVals = vals.filter(isFinite);
    if (!finiteVals.length) {
        if (vals.some(v => v === Infinity)) return Infinity;
        if (vals.some(v => v === -Infinity)) return -Infinity;
        return NaN;
    }
    if (finiteVals.length >= 3) {
        const absVals = finiteVals.map(Math.abs);
        let growing = true;
        for (let i = 1; i < absVals.length; i++) { if (absVals[i] < absVals[i - 1] * 0.9) { growing = false; break; } }
        if (growing && absVals[absVals.length - 1] > 1000) return finiteVals[finiteVals.length - 1] > 0 ? Infinity : -Infinity;
    }
    const last = finiteVals[finiteVals.length - 1];
    if (Math.abs(last) > 1e6) return last > 0 ? Infinity : -Infinity;
    return roundNice(last);
}

function numLimit(f, x0) {
    const hs = [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8];
    const valsR = hs.map(h => f(x0 + h)).filter(isFinite);
    const valsL = hs.map(h => f(x0 - h)).filter(isFinite);
    if (!valsR.length && !valsL.length) return NaN;
    if (valsR.length && valsL.length) {
        const lr = valsR[valsR.length - 1], ll = valsL[valsL.length - 1];
        if (Math.abs(lr - ll) < 0.001) return (lr + ll) / 2;
        return NaN;
    }
    return (valsR.length ? valsR : valsL).pop();
}

/* ============================================================
   3. FULL ANALYSIS
   ============================================================ */
function analyzeFunction(exprStr) {
    const f = createEvalFn(exprStr);
    let fPrimeExpr, fPrimePrimeExpr, fPrimeStr, fPrimePrimeStr;
    let fPrime, fPrimePrime;

    try {
        const node = math.parse(exprStr);
        const d1 = math.derivative(node, 'x');
        fPrimeStr = d1.toString();
        fPrimeExpr = math.simplify(d1).toTex();
        fPrime = createEvalFn(fPrimeStr);
        const d2 = math.derivative(d1, 'x');
        fPrimePrimeStr = d2.toString();
        fPrimePrimeExpr = math.simplify(d2).toTex();
        fPrimePrime = createEvalFn(fPrimePrimeStr);
    } catch (e) {
        console.warn('Derivative error:', e);
        fPrime = (x) => (f(x + 1e-7) - f(x - 1e-7)) / (2e-7);
        fPrimePrime = (x) => (f(x + 1e-5) - 2 * f(x) + f(x - 1e-5)) / (1e-10);
        fPrimeExpr = '\\text{(calcolata numericamente)}';
        fPrimePrimeExpr = '\\text{(calcolata numericamente)}';
        fPrimeStr = null; fPrimePrimeStr = null;
    }

    const discs = findDiscontinuities(f);
    const domBounds = findDomainBoundaries(f);
    const y0 = f(0);
    const xRoots = findRoots(f);
    const signIntervals = computeSign(f, xRoots, discs, domBounds);
    const limits = computeLimits(f, discs, domBounds);
    const criticalPts = findRoots(fPrime);
    const extrema = classifyExtrema(f, fPrime, fPrimePrime, criticalPts);
    const inflCandidates = findRoots(fPrimePrime);
    const inflections = classifyInflections(f, fPrimePrime, inflCandidates);

    return {
        exprStr, f, fPrime, fPrimePrime,
        fPrimeExpr, fPrimePrimeExpr, fPrimeStr, fPrimePrimeStr,
        discs, domBounds, yIntercept: y0, xRoots,
        signIntervals, limits, criticalPts, extrema,
        inflCandidates, inflections
    };
}

function computeSign(f, roots, discs, domBounds) {
    const breakpoints = [...roots, ...discs, ...domBounds.map(b => b.x)].filter(isFinite).sort((a, b) => a - b);
    const unique = [];
    for (const p of breakpoints) { if (!unique.length || Math.abs(p - unique[unique.length - 1]) > 0.001) unique.push(p); }
    const intervals = [], testPoints = [];
    if (!unique.length) { testPoints.push(0); intervals.push({ from: '-∞', to: '+∞' }); }
    else {
        testPoints.push(unique[0] - 1); intervals.push({ from: '-∞', to: numToLatex(unique[0]) });
        for (let i = 0; i < unique.length - 1; i++) { testPoints.push((unique[i] + unique[i + 1]) / 2); intervals.push({ from: numToLatex(unique[i]), to: numToLatex(unique[i + 1]) }); }
        testPoints.push(unique[unique.length - 1] + 1); intervals.push({ from: numToLatex(unique[unique.length - 1]), to: '+∞' });
    }
    return intervals.map((int, i) => {
        const val = f(testPoints[i]);
        return { ...int, sign: isFinite(val) ? (val > 0 ? '+' : val < 0 ? '-' : '0') : '?' };
    });
}

function computeLimits(f, discs, domBounds) {
    const limits = [];
    limits.push({ point: '+\\infty', value: limitAtInf(f, 1) });
    limits.push({ point: '-\\infty', value: limitAtInf(f, -1) });
    for (const d of discs) {
        limits.push({ point: `${numToLatex(d)}^-`, value: numLimitDirectional(f, d, 'left') });
        limits.push({ point: `${numToLatex(d)}^+`, value: numLimitDirectional(f, d, 'right') });
    }
    for (const b of domBounds) {
        if (!discs.some(d => Math.abs(d - b.x) < 0.01))
            limits.push({ point: numToLatex(b.x), value: numLimit(f, b.x) });
    }
    return limits;
}

function classifyExtrema(f, fPrime, fPrimePrime, criticalPts) {
    return criticalPts.map(x => {
        const y = f(x);
        if (!isFinite(y)) return { x, y, type: 'undefined' };
        const d2 = fPrimePrime(x);
        let type;
        if (d2 > 0.001) type = 'minimo';
        else if (d2 < -0.001) type = 'massimo';
        else {
            const ls = fPrime(x - 0.001), rs = fPrime(x + 0.001);
            if (ls > 0 && rs < 0) type = 'massimo';
            else if (ls < 0 && rs > 0) type = 'minimo';
            else type = 'flesso a tangente orizzontale';
        }
        return { x: roundNice(x), y: roundNice(y), type };
    }).filter(e => e.type !== 'undefined');
}

function classifyInflections(f, fPrimePrime, candidates) {
    return candidates.filter(x => {
        const y = f(x);
        if (!isFinite(y)) return false;
        const left = fPrimePrime(x - 0.01), right = fPrimePrime(x + 0.01);
        return isFinite(left) && isFinite(right) && left * right < 0;
    }).map(x => ({ x: roundNice(x), y: roundNice(f(x)) }));
}

/* ============================================================
   4. RENDERING — Build HTML for each analysis step
   ============================================================ */
function renderKatex(latex, displayMode = false) {
    try { return katex.renderToString(latex, { throwOnError: false, displayMode }); }
    catch { return `<code>${latex}</code>`; }
}

function renderStep1(data) {
    const { discs, domBounds } = data;
    if (!discs.length && !domBounds.length) {
        return `<div class="math-line">${renderKatex('D = \\mathbb{R}', true)}</div><p class="info-text">La funzione è definita su tutto l'asse reale.</p>`;
    }
    let domainStr = '\\mathbb{R}';
    if (discs.length) domainStr += ` \\setminus \\{${discs.map(numToLatex).join(', \\; ')}\\}`;
    let html = '';
    if (domBounds.length) html += '<p class="info-text">La funzione ha restrizioni di dominio nei punti indicati.</p>';
    html += `<div class="math-line">${renderKatex('D = ' + domainStr, true)}</div>`;
    if (discs.length) html += `<p class="info-text">Punti esclusi: ${discs.map(d => renderKatex(`x = ${numToLatex(d)}`)).join(', ')}</p>`;
    return html;
}

function renderStep2(data) {
    const { yIntercept, xRoots } = data;
    let html = '<p class="sub-title">Intersezione con l\'asse Y</p>';
    if (isFinite(yIntercept)) {
        html += `<div class="math-line">${renderKatex(`f(0) = ${numToLatex(yIntercept)}`, true)}</div>`;
        html += `<p class="info-text">Punto: ${renderKatex(`(0, \\; ${numToLatex(yIntercept)})`)}</p>`;
    } else {
        html += '<p class="info-text">La funzione non è definita in x = 0.</p>';
    }
    html += '<p class="sub-title">Intersezioni con l\'asse X</p>';
    if (!xRoots.length) { html += '<p class="info-text">Nessuna intersezione trovata nell\'intervallo analizzato.</p>'; }
    else {
        html += `<div class="math-line">${renderKatex('f(x) = 0', true)}</div><ul class="result-list">`;
        for (const r of xRoots) html += `<li>${renderKatex(`x = ${numToLatex(r)}`)} → ${renderKatex(`(${numToLatex(r)}, \\; 0)`)}</li>`;
        html += '</ul>';
    }
    return html;
}

function renderStep3(data) {
    let html = '<table><thead><tr><th>Intervallo</th><th>Segno di f(x)</th></tr></thead><tbody>';
    for (const int of data.signIntervals) {
        const cls = int.sign === '+' ? 'sign-positive' : int.sign === '-' ? 'sign-negative' : 'sign-zero';
        html += `<tr><td>${renderKatex(`(${int.from}, \\; ${int.to})`)}</td><td class="${cls}">${int.sign === '+' ? '+ (positivo)' : int.sign === '-' ? '− (negativo)' : '0'}</td></tr>`;
    }
    return html + '</tbody></table>';
}

function renderStep4(data) {
    let html = '<table><thead><tr><th>Punto</th><th>Limite</th></tr></thead><tbody>';
    for (const lim of data.limits) html += `<tr><td>${renderKatex(`x \\to ${lim.point}`)}</td><td>${renderKatex(numToLatex(lim.value))}</td></tr>`;
    return html + '</tbody></table>';
}

function renderStep5(data) {
    let html = `<div class="math-line">${renderKatex("f'(x) = " + data.fPrimeExpr, true)}</div>`;
    if (data.fPrimeStr) html += `<p class="info-text">Espressione: <code>${data.fPrimeStr}</code></p>`;
    return html;
}

function renderStep6(data) {
    if (!data.extrema.length) return '<p class="info-text">Nessun punto di massimo o minimo trovato nell\'intervallo analizzato.</p>';
    let html = '<ul class="result-list">';
    for (const e of data.extrema) {
        const label = e.type === 'massimo' ? '🔺 Massimo relativo' : e.type === 'minimo' ? '🔻 Minimo relativo' : '↔️ ' + e.type;
        html += `<li><strong>${label}</strong> in ${renderKatex(`(${numToLatex(e.x)}, \\; ${numToLatex(e.y)})`)}</li>`;
    }
    return html + '</ul>';
}

function renderStep7(data) {
    let html = `<div class="math-line">${renderKatex("f''(x) = " + data.fPrimePrimeExpr, true)}</div>`;
    if (data.fPrimePrimeStr) html += `<p class="info-text">Espressione: <code>${data.fPrimePrimeStr}</code></p>`;
    return html;
}

function renderStep8(data) {
    if (!data.inflections.length) return '<p class="info-text">Nessun punto di flesso trovato nell\'intervallo analizzato.</p>';
    let html = '<ul class="result-list">';
    for (const p of data.inflections) html += `<li>↩️ Punto di flesso in ${renderKatex(`(${numToLatex(p.x)}, \\; ${numToLatex(p.y)})`)}</li>`;
    return html + '</ul>';
}

/* ============================================================
   5. PLOTLY GRAPH
   ============================================================ */
function plotGraph(data) {
    const isDark = document.body.classList.contains('dark-mode');
    const { f, discs, xRoots, yIntercept, extrema, inflections } = data;
    const traces = [], xMin = -12, xMax = 12;
    const breakpoints = [...discs].sort((a, b) => a - b);
    const segments = [];
    let start = xMin;
    for (const bp of breakpoints) { if (bp > start && bp < xMax) { segments.push([start, bp - 0.01]); start = bp + 0.01; } }
    segments.push([start, xMax]);

    const lineColor = '#2563eb';

    for (const [a, b] of segments) {
        const xs = [], ys = [], n = 2000, dx = (b - a) / n;
        for (let i = 0; i <= n; i++) {
            const x = a + i * dx, y = f(x);
            if (isFinite(y) && Math.abs(y) < 1e6) { xs.push(x); ys.push(y); }
            else if (xs.length) { traces.push({ x: [...xs], y: [...ys], type: 'scatter', mode: 'lines', line: { color: lineColor, width: 3 }, showlegend: false, hovertemplate: 'x: %{x:.4f}<br>y: %{y:.4f}<extra></extra>' }); xs.length = 0; ys.length = 0; }
        }
        if (xs.length) traces.push({ x: xs, y: ys, type: 'scatter', mode: 'lines', line: { color: lineColor, width: 3 }, showlegend: !traces.length, name: 'f(x)', hovertemplate: 'x: %{x:.4f}<br>y: %{y:.4f}<extra></extra>' });
    }

    if (xRoots.length) traces.push({ x: xRoots, y: xRoots.map(() => 0), type: 'scatter', mode: 'markers', marker: { color: '#059669', size: 10, symbol: 'circle' }, name: 'Zeri' });
    if (isFinite(yIntercept)) traces.push({ x: [0], y: [yIntercept], type: 'scatter', mode: 'markers', marker: { color: '#3b82f6', size: 10, symbol: 'diamond' }, name: 'Int. asse Y' });

    const maxPts = extrema.filter(e => e.type === 'massimo'), minPts = extrema.filter(e => e.type === 'minimo');
    if (maxPts.length) traces.push({ x: maxPts.map(p => p.x), y: maxPts.map(p => p.y), type: 'scatter', mode: 'markers', marker: { color: '#d97706', size: 12, symbol: 'triangle-up' }, name: 'Massimi' });
    if (minPts.length) traces.push({ x: minPts.map(p => p.x), y: minPts.map(p => p.y), type: 'scatter', mode: 'markers', marker: { color: '#dc2626', size: 12, symbol: 'triangle-down' }, name: 'Minimi' });
    if (inflections.length) traces.push({ x: inflections.map(p => p.x), y: inflections.map(p => p.y), type: 'scatter', mode: 'markers', marker: { color: '#0891b2', size: 10, symbol: 'star' }, name: 'Flessi' });

    const textColor = isDark ? '#f1f5f9' : '#0f172a';
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    const zeroColor = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)';
    const plotBg = isDark ? 'rgba(15,23,42,0.9)' : '#ffffff';

    const layout = {
        paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: plotBg,
        font: { family: 'Inter', color: textColor },
        xaxis: { zeroline: true, zerolinecolor: zeroColor, gridcolor: gridColor, title: 'x' },
        yaxis: { zeroline: true, zerolinecolor: zeroColor, gridcolor: gridColor, title: 'f(x)' },
        margin: { t: 30, r: 30, b: 50, l: 50 },
        legend: { bgcolor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.8)', font: { size: 11 } },
        dragmode: 'pan',
    };
    Plotly.newPlot('plot-container', traces, layout, { responsive: true, scrollZoom: true });
}

/* ============================================================
   6. MATH ANIMATION — Looping canvas particle system
   ============================================================ */
let animationState = { running: false, cancelled: false, animId: null };

function startMathAnimation(panelRight) {
    const overlay = document.getElementById('math-animation-overlay');
    const canvas = document.getElementById('math-canvas');
    const cancelBtn = document.getElementById('cancel-analysis-btn');
    const ctx = canvas.getContext('2d');

    animationState.running = true;
    animationState.cancelled = false;
    overlay.classList.remove('hidden');
    cancelBtn.classList.add('hidden');

    const rect = panelRight.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.scale(dpr, dpr);

    const W = rect.width, H = rect.height;
    const isDark = document.body.classList.contains('dark-mode');

    const symbols = ['∫', 'π', 'Σ', '√', '∞', 'dx', 'Δ', 'θ', 'φ', 'λ', '∂', 'ε', 'lim', 'sin', 'cos', 'f(x)', 'dy', '∇', 'α', 'β', '≈', '∈', '∀', '∃'];
    const blueShades = [
        'rgba(37,99,235,',   // accent
        'rgba(59,130,246,',  // lighter
        'rgba(96,165,250,',  // light
        'rgba(29,78,216,',   // darker
        'rgba(8,145,178,',   // cyan
        'rgba(99,102,241,',  // indigo
    ];

    // Particles
    const particles = [];
    const PARTICLE_COUNT = 50;

    function createParticle() {
        return {
            symbol: symbols[Math.floor(Math.random() * symbols.length)],
            x: Math.random() * W,
            y: H + 30 + Math.random() * 80,
            targetY: Math.random() * H * 0.85 + H * 0.05,
            size: 14 + Math.random() * 26,
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.03,
            color: blueShades[Math.floor(Math.random() * blueShades.length)],
            alpha: 0,
            targetAlpha: 0.12 + Math.random() * 0.45,
            wobbleAmp: Math.random() * 25,
            wobbleFreq: 0.008 + Math.random() * 0.015,
            wobblePhase: Math.random() * Math.PI * 2,
            born: performance.now(),
            lifespan: 3000 + Math.random() * 4000,
            riseTime: 600 + Math.random() * 600,
        };
    }

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p = createParticle();
        p.born = performance.now() - Math.random() * 2000; // stagger
        particles.push(p);
    }

    // Connections
    function drawConnections(now) {
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 130) {
                    const alpha = (1 - dist / 130) * 0.06 * Math.min(particles[i].alpha, particles[j].alpha);
                    if (alpha > 0.003) {
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.strokeStyle = `rgba(37,99,235,${alpha})`;
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }
                }
            }
        }
    }

    function animate(now) {
        if (!animationState.running) return;

        ctx.clearRect(0, 0, W, H);
        drawConnections(now);

        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            const age = now - p.born;

            // Rise
            const riseProg = Math.min(1, age / p.riseTime);
            const ease = 1 - Math.pow(1 - riseProg, 3);
            const startY = H + 30;
            p.y = startY + (p.targetY - startY) * ease;

            // Wobble
            p.x += Math.sin(p.wobblePhase + age * p.wobbleFreq) * 0.3;
            p.rotation += p.rotSpeed;

            // Fade lifecycle
            const fadeIn = Math.min(1, age / 600);
            const fadeOut = age > p.lifespan - 800 ? Math.max(0, (p.lifespan - age) / 800) : 1;
            p.alpha = p.targetAlpha * fadeIn * fadeOut;

            // Recycle dead particles
            if (age > p.lifespan) {
                particles[i] = createParticle();
                particles[i].born = now;
                continue;
            }

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.font = `${Math.round(p.size)}px 'Inter', sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = p.color + p.alpha + ')';
            ctx.shadowColor = p.color + (p.alpha * 0.5) + ')';
            ctx.shadowBlur = isDark ? 16 : 10;
            ctx.fillText(p.symbol, 0, 0);
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // Central pulsing ring
        const ringPhase = now * 0.002;
        const ringRadius = 50 + Math.sin(ringPhase) * 10;
        const ringAlpha = 0.15 + Math.sin(ringPhase * 1.3) * 0.1;
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(37,99,235,${ringAlpha})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Rotating inner arc
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, ringRadius * 0.65, ringPhase, ringPhase + Math.PI * 1.4);
        ctx.strokeStyle = `rgba(96,165,250,${ringAlpha * 0.6})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        animationState.animId = requestAnimationFrame(animate);
    }

    // Check for prefers-reduced-motion
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion) {
        animationState.animId = requestAnimationFrame(animate);
    }

    // Show cancel button after 4 seconds
    setTimeout(() => {
        if (animationState.running && !animationState.cancelled) {
            cancelBtn.classList.remove('hidden');
        }
    }, 4000);
}

function stopMathAnimation() {
    animationState.running = false;
    if (animationState.animId) {
        cancelAnimationFrame(animationState.animId);
        animationState.animId = null;
    }
    const overlay = document.getElementById('math-animation-overlay');
    const cancelBtn = document.getElementById('cancel-analysis-btn');
    const canvas = document.getElementById('math-canvas');
    const ctx = canvas.getContext('2d');

    // Quick fade out
    overlay.style.transition = 'opacity 0.4s ease';
    overlay.style.opacity = '0';
    setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.style.opacity = '';
        overlay.style.transition = '';
        cancelBtn.classList.add('hidden');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }, 400);
}

/* ============================================================
   7. UI CONTROLLER
   ============================================================ */
function init() {
    const mathField = document.getElementById('math-input');
    const analyzeBtn = document.getElementById('analyze-btn');
    const results = document.getElementById('results');
    const placeholder = document.getElementById('placeholder');
    const panelRight = document.querySelector('.panel-right');
    const cancelBtn = document.getElementById('cancel-analysis-btn');
    const TOTAL_STEPS = 9;

    // ---- Accessibility toggles ----
    const contrastBtn = document.getElementById('toggle-contrast');

    contrastBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        contrastBtn.classList.toggle('active');
        const isActive = document.body.classList.contains('dark-mode');
        contrastBtn.setAttribute('aria-label', isActive ? 'Disattiva modalità scura' : 'Attiva modalità scura');
        contrastBtn.setAttribute('aria-pressed', isActive);

        // Sync keyboard theme
        if (window.mathVirtualKeyboard) {
            window.mathVirtualKeyboard.theme = isActive ? 'dark' : 'light';
            // Force container theme update
            if (window.mathVirtualKeyboard.container) {
                window.mathVirtualKeyboard.container.setAttribute('data-theme', isActive ? 'dark' : 'light');
            }
        }
        mathField.setOptions({ virtualKeyboardTheme: isActive ? 'dark' : 'light' });
    });

    // ---- Home / Reset ----
    const appReset = document.getElementById('app-reset');
    if (appReset) {
        appReset.addEventListener('click', () => {
            // Clear input
            mathField.setValue('');
            analyzeBtn.disabled = true;

            // Cancel any analysis
            animationState.cancelled = true;
            stopMathAnimation();

            // Clear results and show placeholder
            results.innerHTML = '';
            results.classList.add('hidden');
            placeholder.classList.remove('hidden');

            // Scroll to top
            panelRight.scrollTo({ top: 0, behavior: 'smooth' });

            // Focus and show keyboard
            mathField.focus();
        });
    }

    // ---- More Functions Keyboard Toggle ----
    const moreBtn = document.getElementById('more-functions-btn');
    if (moreBtn) {
        moreBtn.addEventListener('click', () => {
            mathField.executeCommand('toggleVirtualKeyboard');
            mathField.focus();
        });
    }

    // ---- Restore Keyboard Floating Button ----
    const restoreKbBtn = document.getElementById('restore-kb-btn');
    if (restoreKbBtn) {
        restoreKbBtn.addEventListener('click', () => {
            if (window.mathVirtualKeyboard) {
                window.mathVirtualKeyboard.show();
                mathField.focus();
            }
        });

        // Listen for keyboard visibility changes to show/hide the restore button
        if (window.mathVirtualKeyboard) {
            window.mathVirtualKeyboard.addEventListener('geometrychange', () => {
                const isVisible = window.mathVirtualKeyboard.visible;
                restoreKbBtn.classList.toggle('hidden', isVisible);
            });
        }
    }

    // Configure MathLive Virtual Keyboard Layout & Theme
    if (window.mathVirtualKeyboard) {
        // Ensure theme is set based on current mode
        const isDark = document.body.classList.contains('dark-mode');
        window.mathVirtualKeyboard.theme = isDark ? 'dark' : 'light';
        if (window.mathVirtualKeyboard.container) {
            window.mathVirtualKeyboard.container.setAttribute('data-theme', isDark ? 'dark' : 'light');
        }

        // Apply custom toolbar globally and locally
        const toolbarConfig = [
            '123', 'symbols', 'abc', 'greek', 'separator', 'undo', 'redo', 'separator',
            { label: 'Nascondi', command: 'hideVirtualKeyboard', class: 'hide-kb-btn' }
        ];

        window.mathVirtualKeyboard.toolbar = toolbarConfig;
        mathField.setOptions({ virtualKeyboardToolbar: toolbarConfig });
    }

    // Enable keyboard on start
    setTimeout(() => {
        mathField.focus();
        mathField.executeCommand('showVirtualKeyboard');
    }, 300);

    // ---- Math field input ----
    mathField.addEventListener('input', () => {
        analyzeBtn.disabled = !(mathField.getValue('latex') || '').trim();
    });

    // ---- Example buttons ----
    document.querySelectorAll('.example-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            mathField.setValue(btn.getAttribute('data-latex'));
            analyzeBtn.disabled = false;
        });
    });

    // ---- Cancel button ----
    cancelBtn.addEventListener('click', () => {
        animationState.cancelled = true;
        stopMathAnimation();
        placeholder.classList.remove('hidden');
        results.classList.add('hidden');
    });

    // ---- Analyze button ----
    analyzeBtn.addEventListener('click', () => {
        const latex = mathField.getValue('latex');
        if (!latex) return;

        let exprStr;
        try {
            exprStr = latexToExpr(latex);
            math.parse(exprStr);
        } catch (e) {
            alert('Errore nella formula.\n\n' + e.message + '\n\nEspressione: ' + exprStr);
            return;
        }

        console.log('LaTeX:', latex, '→ Expression:', exprStr);

        // Hide placeholder and previous results
        placeholder.classList.add('hidden');
        results.classList.add('hidden');
        for (let i = 1; i <= TOTAL_STEPS; i++) {
            const card = document.getElementById(`step-${i}`);
            card.classList.add('hidden');
            const aiBox = card.querySelector('.ai-explanation-box');
            if (aiBox) { aiBox.classList.add('hidden'); aiBox.innerHTML = ''; }
        }

        // Scroll right panel to top
        panelRight.scrollTo({ top: 0 });

        // Start looping animation
        startMathAnimation(panelRight);

        // Run analysis in next macro-task so animation can start
        setTimeout(() => {
            if (animationState.cancelled) return;

            try {
                const data = analyzeFunction(exprStr);

                // Stop animation with fade
                stopMathAnimation();

                // Show results after fade
                setTimeout(() => {
                    if (animationState.cancelled) return;
                    results.classList.remove('hidden');

                    const renderers = [renderStep1, renderStep2, renderStep3, renderStep4, renderStep5, renderStep6, renderStep7, renderStep8];
                    renderers.forEach((fn, idx) => {
                        setTimeout(() => {
                            const card = document.getElementById(`step-${idx + 1}`);
                            card.querySelector('.step-content').innerHTML = fn(data);
                            card.classList.remove('hidden');
                        }, idx * 150);
                    });

                    // Graph (step 9)
                    setTimeout(() => {
                        document.getElementById(`step-${TOTAL_STEPS}`).classList.remove('hidden');
                        plotGraph(data);
                    }, 8 * 150);

                    setTimeout(() => {
                        panelRight.scrollTo({ top: 0, behavior: 'smooth' });
                    }, 200);
                }, 450);

            } catch (e) {
                stopMathAnimation();
                setTimeout(() => {
                    placeholder.classList.remove('hidden');
                    alert('Errore durante l\'analisi: ' + e.message);
                    console.error(e);
                }, 450);
            }
        }, 100);
    });

    // ---- Keyboard shortcut: Ctrl+Enter to analyze ----
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !analyzeBtn.disabled) {
            analyzeBtn.click();
        }
    });

    // ---- Gemini API Integration: Generate Function ----
    const aiPromptInput = document.getElementById('ai-prompt');
    const aiGenerateBtn = document.getElementById('ai-generate-btn');
    if (aiGenerateBtn && aiPromptInput) {
        aiGenerateBtn.addEventListener('click', async () => {
            const prompt = aiPromptInput.value.trim();
            if (!prompt) return;

            if (GEMINI_API_KEY === "INSERISCI_QUI_LA_TUA_CHIAVE_API" || !GEMINI_API_KEY) {
                alert("Per usare le funzionalità IA, devi inserire la tua API Key Gemini in app.js (variabile GEMINI_API_KEY).");
                return;
            }

            aiGenerateBtn.disabled = true;
            aiGenerateBtn.textContent = 'Generazione...';

            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        system_instruction: {
                            parts: [{ text: "Sei un assistente matematico per un'app di esplorazione funzioni. L'utente ti chiederà di generare una funzione matematica descrivendola a parole. Devi rispondere SOLO ed ESCLUSIVAMENTE con la formula matematica in formato LaTeX, senza blocchi di codice, senza markdown, senza testo aggiuntivo. Nessuna spiegazione. Esempio di output valido: x^2 - 4. \n\nSE la richiesta dell'utente NON riguarda in alcun modo la generazione di una funzione matematica (ad esempio, fa domande generiche, di programmazione, ricette, saluti o altro), devi rispondere ESATTAMENTE con la stringa: 'ERRORE: Posso solo generare funzioni matematiche.'" }]
                        },
                        contents: [{ parts: [{ text: prompt }] }]
                    })
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error?.message || "Errore API");

                const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

                if (resultText.includes("ERRORE:")) {
                    alert(resultText);
                } else {
                    const cleanLatex = resultText.replace(/`/g, '').replace(/^latex/i, '').trim();
                    mathField.setValue(cleanLatex);
                    analyzeBtn.disabled = false;
                    analyzeBtn.click();
                }

            } catch (err) {
                alert("Errore durante la connessione a Gemini: " + err.message);
            } finally {
                aiGenerateBtn.disabled = false;
                aiGenerateBtn.textContent = 'Genera';
            }
        });

        aiPromptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') aiGenerateBtn.click();
        });
    }

    // ---- Gemini API Integration: Explain Step ----
    document.querySelectorAll('.ask-ai-step-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (GEMINI_API_KEY === "INSERISCI_QUI_LA_TUA_CHIAVE_API" || !GEMINI_API_KEY) {
                alert("Per usare le funzionalità IA, devi inserire la tua API Key Gemini in app.js (variabile GEMINI_API_KEY).");
                return;
            }

            const stepCard = btn.closest('.result-card');
            const stepContentHTML = stepCard.querySelector('.step-content').innerHTML;
            const stepTitle = stepCard.querySelector('h3').textContent;
            const explanationBox = stepCard.querySelector('.ai-explanation-box');
            const latex = mathField.getValue('latex');

            btn.disabled = true;
            btn.textContent = '⏳';
            explanationBox.classList.add('hidden');
            explanationBox.innerHTML = '';

            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        system_instruction: {
                            parts: [{ text: "Sei un tutor d'eccellenza per la matematica. Ti verranno dati la formula di una funzione, il nome del passaggio di studio in cui ci troviamo, e i risultati esatti calcolati dall'app (in HTML). Spiega all'utente finale (in italiano, in modo discorsivo, chiaro e semplice) PERCHÉ si ottengono questi risultati (ad esempio 'il dominio è $\\mathbb{R}$ tranne $2$ perché il denominatore si annulla in $2$'). \nUsa poche decine di parole e rispondi direttamente, senza preamboli inutili, spiegando solo i calcoli e il collegamento logico. IMPORTANTE: scrivi SEMPRE le formule matematiche, le variabili individuali e i numeri all'interno del simbolo del dollaro in formato LaTeX (es. $x^2$, $f(x)$, $\\infty$, $2$) in modo che l'app possa renderizzarli." }]
                        },
                        contents: [{ parts: [{ text: `Funzione: ${latex}\nPassaggio: ${stepTitle}\nRisultati Calcolati:\n${stepContentHTML}` }] }]
                    })
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error?.message || "Errore API");

                let resultText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

                // Render LaTeX blocks before replacing newlines
                resultText = resultText.replace(/\$\$([\s\S]*?)\$\$/g, (m, p1) => renderKatex(p1.trim(), true));
                resultText = resultText.replace(/\\\[([\s\S]*?)\\\]/g, (m, p1) => renderKatex(p1.trim(), true));
                resultText = resultText.replace(/\$([^\$\n]+)\$/g, (m, p1) => renderKatex(p1.trim(), false));
                resultText = resultText.replace(/\\\((.*?)\\\)/g, (m, p1) => renderKatex(p1.trim(), false));
                resultText = resultText.replace(/`([^`\n]+)`/g, (m, p1) => renderKatex(p1.trim(), false)); // Parse backticks as math too

                resultText = resultText.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
                resultText = resultText.replace(/\n/g, '<br>');

                explanationBox.innerHTML = `<p>✨ <b>L'IA dice:</b><br>${resultText}</p>`;
                explanationBox.classList.remove('hidden');

            } catch (err) {
                alert("Errore durante la richiesta all'IA: " + err.message);
            } finally {
                btn.disabled = false;
                btn.textContent = "Chiedi all'IA ✨";
            }
        });
    });
}
