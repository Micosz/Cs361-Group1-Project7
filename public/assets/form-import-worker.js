/* Read locally off the main thread; never execute formulas or contact a service. */
importScripts('form-import-data.js');
self.onmessage = event => {
    try {
        const {buffer, name} = event.data;
        if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > 5 * 1024 * 1024) throw Error('ไฟล์ต้องไม่เกิน 5 MiB');
        let sheets;
        if (/\.csv$/i.test(name)) {
            let text;
            try { text = new TextDecoder('utf-8', {fatal: true}).decode(buffer); }
            catch { throw Error('กรุณาบันทึก CSV เป็น UTF-8 หรือใช้ไฟล์ .xlsx'); }
            sheets = [{name: 'CSV', rows: self.CstuFormImportData.parseCSV(text)}];
        } else if (/\.xlsx$/i.test(name)) {
            const signature = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4));
            if (signature[0] !== 80 || signature[1] !== 75) throw Error('ไฟล์นี้ไม่ใช่ Excel .xlsx ที่รองรับ');
            importScripts('../vendor/sheetjs/xlsx.mini.min.js');
            const workbook = XLSX.read(buffer, {type: 'array', cellFormula: false, cellHTML: false, sheetRows: 2002});
            if (workbook.SheetNames.length > 30) throw Error('ไฟล์มีมากกว่า 30 ชีต กรุณาแยกไฟล์');
            sheets = workbook.SheetNames.map(name => {
                const sheet = workbook.Sheets[name];
                const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1');
                if (range.e.r > 2000 || range.e.c >= 100) throw Error('ไฟล์มีมากกว่า 2,000 แถวข้อมูลหรือ 100 คอลัมน์ กรุณาแบ่งไฟล์');
                return {name, rows: XLSX.utils.sheet_to_json(sheet, {header: 1, raw: false, defval: '', blankrows: true, range: 0})};
            });
        } else throw Error('รองรับเฉพาะไฟล์ .xlsx และ .csv');
        if (!sheets.some(sheet => sheet.rows.length > 1)) throw Error('ไม่พบหัวคำถามและแถวคำตอบในไฟล์');
        self.postMessage({sheets});
    } catch (error) { self.postMessage({error: error.message || 'อ่านไฟล์ไม่ได้ กรุณาตรวจไฟล์อีกครั้ง'}); }
};
