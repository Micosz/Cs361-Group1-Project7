/* Deterministic data conversion shared by the import preview and worker. */
((root) => {
    'use strict';
    const MAX_BYTES = 200 * 1024, MAX_ROWS = 1000, MAX_COLUMNS = 100;
    function parseCSV(input) {
        const text = input.replace(/^\uFEFF/, '');
        // Detect only outside quoted fields in the first logical record.
        const counts = {',': 0, ';': 0, '\t': 0}; let quoted = false;
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '"') { if (quoted && text[i + 1] === '"') i++; else quoted = !quoted; }
            else if (!quoted && /[\r\n]/.test(text[i])) break;
            else if (!quoted && text[i] in counts) counts[text[i]]++;
        }
        const delimiter = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        const rows = []; let row = [], value = '', inQuote = false, afterQuote = false;
        const cell = () => { row.push(value); value = ''; afterQuote = false; if (row.length > MAX_COLUMNS) throw Error('ไฟล์มีมากกว่า 100 คอลัมน์'); };
        const line = () => { cell(); rows.push(row); row = []; if (rows.length > 2001) throw Error('ไฟล์มีมากกว่า 2,000 แถวข้อมูล กรุณาแบ่งไฟล์'); };
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (inQuote) {
                if (ch === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { inQuote = false; afterQuote = true; } }
                else value += ch;
            } else if (ch === delimiter) cell();
            else if (ch === '\r' || ch === '\n') { line(); if (ch === '\r' && text[i + 1] === '\n') i++; }
            else if (ch === '"' && !value && !afterQuote) inQuote = true;
            else if (ch === '"' || afterQuote) throw Error('รูปแบบ CSV ไม่ถูกต้อง โปรดดาวน์โหลดใหม่จากแบบฟอร์ม');
            else value += ch;
            if (value.length > 10000) throw Error('คำตอบยาวเกิน 10,000 ตัวอักษร');
        }
        if (inQuote) throw Error('CSV มีเครื่องหมายคำพูดไม่ครบ');
        if (value || row.length || afterQuote) line();
        return rows;
    }
    function prepare(matrix, headerIndex, selected, dateColumn = -1) {
        if (!Number.isInteger(headerIndex) || headerIndex < 0 || headerIndex >= Math.min(matrix.length, 100))
            throw Error('เลือกแถวหัวคำถามที่มีอยู่ในชีต');
        const header = matrix[headerIndex] || [];
        if (!selected.length) throw Error('เลือกคำถามอย่างน้อย 1 คอลัมน์');
        const columns = selected.map(index => String(header[index] ?? ''));
        if (columns.some(title => !title.trim() || title.length > 500)) throw Error('คอลัมน์ที่เลือกต้องมีหัวคำถาม และยาวไม่เกิน 500 ตัวอักษร');
        let skipped = 0; const rows = [];
        matrix.slice(headerIndex + 1).forEach((source, index) => {
            const answers = selected.map(column => String(source[column] ?? ''));
            if (!answers.some(answer => answer.trim())) { skipped++; return; }
            if (answers.some(answer => answer.length > 10000)) throw Error('คำตอบยาวเกิน 10,000 ตัวอักษร');
            const respondedAt = dateColumn < 0 ? '' : String(source[dateColumn] ?? '');
            if (respondedAt.length > 200) throw Error('คอลัมน์เวลาตอบมีข้อความยาวเกินไป กรุณาตรวจคอลัมน์ที่เลือก');
            rows.push({sourceRow: headerIndex + index + 2, answers, respondedAt});
        });
        if (!rows.length) throw Error('ไม่พบคำตอบในคอลัมน์ที่เลือก');
        if (rows.length > MAX_ROWS) throw Error('นำเข้าได้ครั้งละ 1,000 คำตอบ กรุณาแบ่งไฟล์');
        return {columns, rows, skipped};
    }
    function assertSize(payload) {
        // Same compact UTF-8 JSON bound as the server, including Thai text.
        if (new TextEncoder().encode(JSON.stringify(payload)).length > MAX_BYTES)
            throw Error('ข้อมูลที่เลือกเกิน 200 KiB กรุณาลดคอลัมน์หรือแบ่งไฟล์ก่อนนำเข้า');
    }
    const api = {parseCSV, prepare, assertSize, MAX_ROWS, MAX_COLUMNS};
    if (typeof module !== 'undefined') module.exports = api;
    root.CstuFormImportData = api;
})(typeof self !== 'undefined' ? self : globalThis);
