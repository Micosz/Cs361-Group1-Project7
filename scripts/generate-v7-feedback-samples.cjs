/* Deterministic generator for #264 sample Excel (.xlsx) and CSV (.csv) feedback files. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('../public/vendor/sheetjs/xlsx.mini.min.js');

const outDir = path.resolve(__dirname, '../tests/fixtures/v7-feedback');
fs.mkdirSync(outDir, { recursive: true });

const sheets = [
    {
        sheetName: '1_กิจกรรม_MoU1',
        csvFile: 'v7-activity-mou1-feedback.csv',
        rows: [
            [
                'ประทับเวลา',
                'อีเมลผู้ตอบ',
                'ความพึงพอใจต่อกิจกรรม (1-5)',
                'สิ่งที่ได้รับจากการเข้าร่วมกิจกรรม',
                'ข้อเสนอแนะเพื่อพัฒนาความร่วมมือ'
            ],
            [
                '2026-09-15 16:10:00',
                'student01@example.invalid',
                '5',
                'ได้ฝึกโจทย์ AI จากกรณีศึกษาจริงร่วมกับทีมวิศวกรของคู่ความร่วมมือ',
                'ควรเพิ่มเวลาช่วงลงมือปฏิบัติอีก 1 ชั่วโมงในรอบถัดไป'
            ],
            [
                '2026-09-15 16:18:25',
                'student02@example.invalid',
                '4',
                'เข้าใจการนำโมเดลไปใช้งานจริงและแนวทางเตรียมสหกิจศึกษา',
                'อยากให้จัดกิจกรรมต่อเนื่องทุกภาคการศึกษาภายใต้ข้อตกลงเดิม'
            ],
            [
                '2026-09-15 16:24:09',
                'mentor01@partner.example.invalid',
                '5',
                'นักศึกษามีพื้นฐานดีและร่วมแลกเปลี่ยนโจทย์วิจัยต่อยอดได้ชัดเจน',
                ''
            ],
            ['2026-09-15 16:30:00', 'blank@example.invalid', '', '', '']
        ]
    },
    {
        sheetName: '2_แลกเปลี่ยน_MoU2',
        csvFile: 'v7-exchange-mou2-feedback.csv',
        rows: [
            [
                'ประทับเวลา',
                'อีเมลผู้ตอบ',
                'ความพึงพอใจต่อโครงการแลกเปลี่ยน (1-5)',
                'ทักษะและผลลัพธ์จากการแลกเปลี่ยน',
                'ประเด็นที่หลักสูตรควรติดตามต่อ'
            ],
            [
                '2026-10-20 10:05:12',
                'exchange01@example.invalid',
                '5',
                'ได้ร่วมทำวิจัยในห้องปฏิบัติการต่างประเทศและสรุปผลร่วมกับอาจารย์ที่ปรึกษา',
                'ควรเตรียมคู่มือการเทียบโอนรายวิชาล่วงหน้าก่อนเดินทาง'
            ],
            [
                '2026-10-21 14:42:00',
                'host-supervisor@partner.example.invalid',
                '5',
                'ผู้เข้าร่วมแลกเปลี่ยนส่งมอบต้นแบบงานวิจัยได้ตามแผนความร่วมมือ',
                'เสนอขยายโควตาผู้เข้าร่วมในปีถัดไปภายใต้ข้อตกลงฉบับที่สอง'
            ]
        ]
    },
    {
        sheetName: '3_ผลตอบรับเก่า_คู่ความร่วมมือ',
        csvFile: 'v7-legacy-partner-only-feedback.csv',
        rows: [
            [
                'ประทับเวลา',
                'อีเมลผู้ตอบ',
                'องค์กรคู่ความร่วมมือที่ประเมิน',
                'ภาพรวมความร่วมมือที่ผ่านมา',
                'ข้อเสนอแนะจากข้อมูลย้อนหลัง'
            ],
            [
                '2024-11-12 09:30:00',
                'legacy01@partner.example.invalid',
                'สถาบันพันธมิตรเทคโนโลยีดิจิทัล (สมมติ)',
                'การประสานงานภาพรวมกับสาขาเป็นไปด้วยดี แต่แบบฟอร์มเดิมไม่ได้ระบุชื่อกิจกรรมหรือข้อตกลง',
                'ควรระบุช่องทางผู้ประสานงานหลักของหลักสูตรให้ชัดเจน'
            ],
            [
                '2024-11-14 11:15:00',
                'legacy02@partner.example.invalid',
                'สถาบันพันธมิตรเทคโนโลยีดิจิทัล (สมมติ)',
                'บัณฑิตและนักศึกษาที่เคยร่วมงานมีทักษะการแก้ปัญหาดีมาก',
                'สนใจหารือความร่วมมือระยะยาวเพิ่มเติม'
            ],
            [
                '2024-11-18 15:00:00',
                'legacy03@example.invalid',
                'สถาบันพันธมิตรเทคโนโลยีดิจิทัล (สมมติ)',
                'ผลสำรวจย้อนหลังระดับองค์กรก่อนแยกเก็บตามข้อตกลงรายฉบับ',
                ''
            ]
        ]
    }
];

function toCsv(rows) {
    const escapeCell = value => {
        const str = String(value ?? '');
        return /[",\r\n]/.test(str) ? '"' + str.replaceAll('"', '""') + '"' : str;
    };
    return '\uFEFF' + rows.map(row => row.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}

const workbook = XLSX.utils.book_new();
workbook.Props = {
    Title: 'CSTUHub V7 Sample Feedback Import (#264)',
    Author: 'CSTUHub Test Fixture',
    CreatedDate: new Date('2026-11-28T00:00:00Z')
};

for (const entry of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(entry.rows);
    XLSX.utils.book_append_sheet(workbook, ws, entry.sheetName);
    fs.writeFileSync(path.join(outDir, entry.csvFile), toCsv(entry.rows), 'utf8');
}

const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
fs.writeFileSync(path.join(outDir, 'v7-partner-feedback-sample.xlsx'), xlsxBuffer);
console.log('Generated sample files in', outDir);
