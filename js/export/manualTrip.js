// Träwelling Manual Trip Export & Template Generator
// Implements the official Träwelling CSV Importer format & JSON Manual Trip schema
import { escapeHtml } from '../utils/format.js';

/**
 * Format a Date or ISO string into Träwelling CSV format: 'YYYY-MM-DD HH:mm'
 * @param {Date|string} dateInput
 * @returns {string}
 */
export function formatTraewellingDateTime(dateInput) {
    if (!dateInput) return '';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const min = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/**
 * Extract normalized manual trip structure from a Check-in feature or Status object
 * @param {Object} rawItem Feature or Status object
 * @returns {Object} Normalized trip definition
 */
export function extractTripTemplateData(rawItem) {
    const props = rawItem?.properties || rawItem || {};
    let train = props.train || props.checkin || {};
    if (typeof train === 'string') {
        try { train = JSON.parse(train); } catch (e) { train = {}; }
    }

    const lineName = train.lineName || train.number || train.name || 'Unknown Line';
    const category = train.category || props.category || 'regional';
    const journeyNumber = train.journeyNumber || train.manualJourneyNumber || '';

    // Operator
    const operator = train.operator || {};
    const operatorName = operator.name || train.provider?.name || train.provider || '';
    const operatorUuid = operator.uuid || '';
    const operatorId = operator.id || null;

    // Origin
    const orig = train.origin || {};
    const origStation = orig.station || {};
    const originId = origStation.id || orig.id || orig.stationId || '';
    const originUuid = origStation.uuid || orig.uuid || '';
    const originName = origStation.name || orig.name || 'Origin Station';
    const originDepPlanned = orig.departurePlanned || orig.departureReal || train.departure || train.plannedDeparture || '';
    const originPlatform = orig.departurePlatformReal || orig.departurePlatformPlanned || orig.platform || '';

    // Destination
    const dest = train.destination || {};
    const destStation = dest.station || {};
    const destId = destStation.id || dest.id || dest.stationId || '';
    const destUuid = destStation.uuid || dest.uuid || '';
    const destName = destStation.name || dest.name || 'Destination Station';
    const destArrPlanned = dest.arrivalPlanned || dest.arrivalReal || train.arrival || train.plannedArrival || '';
    const destPlatform = dest.arrivalPlatformReal || dest.arrivalPlatformPlanned || dest.platform || '';

    // Stopovers (if present)
    const rawStopovers = Array.isArray(train.stopovers) ? train.stopovers : [];
    const stopovers = rawStopovers.map(s => {
        const station = s.station || {};
        return {
            stationId: station.id || s.id || s.stationId || '',
            stationUuid: station.uuid || s.uuid || '',
            stationName: station.name || s.name || '',
            arrivalPlanned: s.arrivalPlanned || s.arrival || '',
            departurePlanned: s.departurePlanned || s.departure || '',
            platform: s.platform || s.arrivalPlatformPlanned || s.departurePlatformPlanned || ''
        };
    });

    return {
        lineName,
        category,
        journeyNumber,
        operator: {
            name: operatorName,
            uuid: operatorUuid,
            id: operatorId
        },
        origin: {
            id: originId,
            uuid: originUuid,
            name: originName,
            departurePlanned: originDepPlanned,
            platform: originPlatform
        },
        destination: {
            id: destId,
            uuid: destUuid,
            name: destName,
            arrivalPlanned: destArrPlanned,
            platform: destPlatform
        },
        stopovers,
        statusId: props.statusId || rawItem.id || null
    };
}

/**
 * Generate CSV rows adhering strictly to Träwelling CsvImporterDrawer.vue:
 * Format: stationId,arrivalPlanned,departurePlanned
 * @param {Object} tripTemplate Output of extractTripTemplateData
 * @param {number} timeOffsetMs Optional offset in milliseconds to shift times
 * @returns {string} CSV text
 */
export function buildTraewellingImporterCSV(tripTemplate, timeOffsetMs = 0) {
    const shift = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return formatTraewellingDateTime(new Date(d.getTime() + timeOffsetMs));
    };

    const rows = [];

    // 1. Origin row
    const origId = tripTemplate.origin.id || tripTemplate.origin.uuid || tripTemplate.origin.name;
    const origDep = shift(tripTemplate.origin.departurePlanned);
    // Origin arrival is identical to departure or empty
    rows.push(`${origId},${origDep},${origDep}`);

    // 2. Intermediate stopovers
    if (Array.isArray(tripTemplate.stopovers) && tripTemplate.stopovers.length > 0) {
        for (const s of tripTemplate.stopovers) {
            const sId = s.stationId || s.stationUuid || s.stationName;
            const arr = shift(s.arrivalPlanned);
            const dep = shift(s.departurePlanned);
            rows.push(`${sId},${arr},${dep}`);
        }
    }

    // 3. Destination row
    const destId = tripTemplate.destination.id || tripTemplate.destination.uuid || tripTemplate.destination.name;
    const destArr = shift(tripTemplate.destination.arrivalPlanned);
    // Destination departure is identical to arrival or empty
    rows.push(`${destId},${destArr},${destArr}`);

    return rows.join('\n');
}

/**
 * Generate a complete JSON Manual Trip Template
 * @param {Object} tripTemplate
 * @param {number} timeOffsetMs
 * @returns {Object} JSON schema object
 */
export function buildTraewellingTripJSON(tripTemplate, timeOffsetMs = 0) {
    const shiftIso = (iso) => {
        if (!iso) return null;
        const d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        return new Date(d.getTime() + timeOffsetMs).toISOString();
    };

    const origDep = shiftIso(tripTemplate.origin.departurePlanned);
    const destArr = shiftIso(tripTemplate.destination.arrivalPlanned);

    const stopovers = (tripTemplate.stopovers || []).map(s => ({
        stationId: s.stationId,
        stationUuid: s.stationUuid,
        stationName: s.stationName,
        arrivalPlanned: shiftIso(s.arrivalPlanned),
        departurePlanned: shiftIso(s.departurePlanned),
        platform: s.platform || null
    }));

    return {
        $schema: 'https://traewelling.de/schema/manual-trip-v1.json',
        exportedAt: new Date().toISOString(),
        generator: 'Traewelling-Maps Manual Trip Exporter',
        lineName: tripTemplate.lineName,
        category: tripTemplate.category,
        journeyNumber: tripTemplate.journeyNumber || null,
        operator: tripTemplate.operator?.name ? tripTemplate.operator : null,
        origin: {
            id: tripTemplate.origin.id || null,
            uuid: tripTemplate.origin.uuid || null,
            name: tripTemplate.origin.name,
            departurePlanned: origDep,
            platform: tripTemplate.origin.platform || null
        },
        destination: {
            id: tripTemplate.destination.id || null,
            uuid: tripTemplate.destination.uuid || null,
            name: tripTemplate.destination.name,
            arrivalPlanned: destArr,
            platform: tripTemplate.destination.platform || null
        },
        stopovers,
        csvImport: buildTraewellingImporterCSV(tripTemplate, timeOffsetMs)
    };
}

/**
 * Open the interactive Manual Trip Export modal
 * @param {Object} rawTrip Checkin or Status object
 */
export function openManualTripExportDialog(rawTrip) {
    const template = extractTripTemplateData(rawTrip);
    let modal = document.getElementById('manualTripExportModal');

    if (!modal) {
        modal = document.createElement('dialog');
        modal.id = 'manualTripExportModal';
        modal.className = 'manual-trip-modal';
        document.body.appendChild(modal);
    }

    const origDepDate = template.origin.departurePlanned ? new Date(template.origin.departurePlanned) : new Date();
    // Format for datetime-local input: 'YYYY-MM-DDTHH:mm'
    const toLocalInputFormat = (d) => {
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const initialInputValue = toLocalInputFormat(origDepDate);

    modal.innerHTML = `
        <div class="modal-box manual-export-box">
            <div class="modal-header">
                <div class="modal-title-wrap">
                    <span class="manual-badge">Manual Trip Builder</span>
                    <h3 class="manual-title">Export Check-in Template</h3>
                </div>
                <button type="button" class="modal-close-icon" id="closeManualExportBtn" aria-label="Close dialog">✕</button>
            </div>

            <p class="manual-subtitle">
                Turn this check-in into a reusable template for <strong>Träwelling's Manual Trip / Checkin Dialog</strong>. You can shift the date & time if you traveled the same route on a different day!
            </p>

            <div class="manual-trip-summary">
                <div class="summary-line-badge">${escapeHtml(template.lineName)} (${escapeHtml(template.category)})</div>
                <div class="summary-route">
                    <strong>${escapeHtml(template.origin.name)}</strong>
                    <span class="route-arrow">➔</span>
                    <strong>${escapeHtml(template.destination.name)}</strong>
                </div>
            </div>

            <!-- Time Shifter Tool -->
            <div class="manual-shifter-card">
                <div class="shifter-header">
                    <label for="manualTargetDateTime"><strong>📅 New Departure Date & Time</strong></label>
                    <span class="shifter-hint">Preserves transit duration & stopover intervals</span>
                </div>
                <div class="shifter-controls">
                    <input type="datetime-local" id="manualTargetDateTime" value="${initialInputValue}" class="shifter-input" />
                    <button type="button" class="shifter-btn" id="manualResetTimeBtn">Reset to Original</button>
                </div>
                <div class="shifter-preview" id="manualShifterPreview">
                    <span>Shift: <strong>None (original time)</strong></span>
                </div>
            </div>

            <!-- CSV Importer Output -->
            <div class="manual-output-section">
                <div class="output-header">
                    <label><strong>Träwelling CSV Importer Text</strong> (stationId, arrival, departure)</label>
                    <button type="button" class="copy-csv-btn" id="manualCopyCsvBtn">📋 Copy CSV to Clipboard</button>
                </div>
                <textarea id="manualCsvOutput" class="manual-csv-textarea" readonly rows="4"></textarea>
                <span class="output-note">💡 In Träwelling, click <em>Create journey</em> ➔ <em>Import stops (CSV)</em> and paste this text.</span>
            </div>

            <!-- Modal Action Buttons -->
            <div class="modal-actions manual-actions">
                <a href="https://traewelling.de/trips/new" target="_blank" rel="noopener noreferrer" class="manual-action-btn external">
                    🚀 Open Träwelling Manual Trip Dialog ↗
                </a>
                <button type="button" class="manual-action-btn secondary" id="manualDownloadJsonBtn">
                    ⬇️ Download JSON Template
                </button>
                <button type="button" class="manual-action-btn ghost" id="manualDismissBtn">
                    Done
                </button>
            </div>
        </div>
    `;

    if (typeof modal.showModal === 'function') {
        modal.showModal();
    } else {
        modal.setAttribute('open', '');
    }

    const csvTextarea = modal.querySelector('#manualCsvOutput');
    const timeInput = modal.querySelector('#manualTargetDateTime');
    const previewEl = modal.querySelector('#manualShifterPreview');
    const copyBtn = modal.querySelector('#manualCopyCsvBtn');
    const downloadBtn = modal.querySelector('#manualDownloadJsonBtn');
    const resetBtn = modal.querySelector('#manualResetTimeBtn');
    const closeBtn = modal.querySelector('#closeManualExportBtn');
    const dismissBtn = modal.querySelector('#manualDismissBtn');

    let currentOffsetMs = 0;

    const updateOutput = () => {
        const newDate = new Date(timeInput.value);
        if (!isNaN(newDate.getTime()) && !isNaN(origDepDate.getTime())) {
            currentOffsetMs = newDate.getTime() - origDepDate.getTime();
        } else {
            currentOffsetMs = 0;
        }

        const deltaMinutes = Math.round(currentOffsetMs / 60000);
        if (deltaMinutes === 0) {
            previewEl.innerHTML = `<span>Shift: <strong>None (original times)</strong></span>`;
        } else {
            const sign = deltaMinutes > 0 ? '+' : '';
            const hrs = (deltaMinutes / 60).toFixed(1);
            previewEl.innerHTML = `<span>Shift: <strong>${sign}${deltaMinutes} minutes (${sign}${hrs} hrs)</strong></span>`;
        }

        const csvContent = buildTraewellingImporterCSV(template, currentOffsetMs);
        if (csvTextarea) csvTextarea.value = csvContent;
    };

    updateOutput();

    if (timeInput) {
        timeInput.addEventListener('input', updateOutput);
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            timeInput.value = initialInputValue;
            updateOutput();
        });
    }

    if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(csvTextarea.value);
                const originalText = copyBtn.textContent;
                copyBtn.textContent = '✅ Copied to Clipboard!';
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.textContent = originalText;
                    copyBtn.classList.remove('copied');
                }, 2000);
            } catch (err) {
                csvTextarea.select();
                document.execCommand('copy');
                copyBtn.textContent = '✅ Copied!';
                setTimeout(() => { copyBtn.textContent = '📋 Copy CSV to Clipboard'; }, 2000);
            }
        });
    }

    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            const jsonObj = buildTraewellingTripJSON(template, currentOffsetMs);
            const blob = new Blob([JSON.stringify(jsonObj, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const safeLine = (template.lineName || 'trip').replace(/[^a-zA-Z0-9-_]/g, '_');
            a.href = url;
            a.download = `traewelling-manual-template-${safeLine}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    }

    const closeModal = () => {
        if (typeof modal.close === 'function') {
            modal.close();
        } else {
            modal.removeAttribute('open');
        }
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (dismissBtn) dismissBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
}
