/* Shared navigation and optional form adapters. Server still authorizes every API. */
(() => {
    'use strict';
    const kinds = {
        partners: {label:'คู่ความร่วมมือ', create:'เพิ่มคู่ความร่วมมือ', entity:'partner'},
        activities: {label:'กิจกรรม', create:'เพิ่มกิจกรรม', entity:'activity'},
        agreements: {label:'ข้อตกลง MoU/MoA', create:'เพิ่มข้อตกลง', entity:'agreement'},
        exchanges: {label:'การแลกเปลี่ยน', create:'เพิ่มการแลกเปลี่ยน', entity:'exchange'}
    };
    const forms = new Map();
    function roles(session, scopeId) {
        return (session?.grants || []).filter(g => (!scopeId || g.scopeId === scopeId) && g.active !== false).map(g => g.role);
    }
    function canCreate(session, kind) {
        const grants = roles(session);
        return Boolean(session?.user && kinds[kind] && (grants.includes('staff') || (kind !== 'partners' && grants.includes('coordinator'))));
    }
    function canEdit(session, record) {
        if (!session?.user || !record?.scopeId) return false;
        const grants = roles(session, record.scopeId);
        return grants.includes('staff') || (grants.includes('coordinator') && Array.isArray(record.responsibleUserIds) && record.responsibleUserIds.includes(session.user.id));
    }
    function menu(session) {
        const grants = roles(session), items = [];
        if (grants.some(role => ['coordinator','staff','executive'].includes(role))) {
            for (const [kind, config] of Object.entries(kinds)) {
                items.push({label:config.label, href:`records.html?kind=${kind}`, description:'เปิดรายการและรายละเอียดตามสิทธิ์'});
                if (canCreate(session, kind)) items.push({label:config.create, href:`records.html?kind=${kind}&action=create`, description:'ใช้ฟอร์มร่วมของรายการนี้'});
            }
        }
        if (grants.includes('executive')) items.push({label:'ภาพรวมความร่วมมือ', href:'records.html?view=overview', description:'จำนวนรายการในขอบเขตที่มีสิทธิ์อ่าน'});
        if (grants.includes('student')) items.push({label:'My Exchange', href:'workspace.html?view=student', description:'รายการและเอกสารของตนเอง'});
        return items;
    }
    async function attachDetailAction(container, kind, id) {
        if (!kinds[kind] || !window.CstuAuth?.enabled()) return;
        try {
            const session = await window.CstuAuth.refresh();
            if (!session?.user || !roles(session).some(role => ['staff','coordinator'].includes(role))) return;
            const record = (await window.CstuAuth.request('/'+kind+'/'+encodeURIComponent(id))).data;
            if (!container.isConnected || !canEdit(session,record)) return;
            const link = document.createElement('a');
            link.href = `records.html?kind=${kind}&id=${encodeURIComponent(id)}`;
            link.textContent = 'จัดการรายการนี้'; container.appendChild(link);
        } catch { /* Public detail stays readable when the protected API is unavailable. */ }
    }
    window.CstuWork = {kinds, roles, menu, canCreate, canEdit, attachDetailAction,
        register(kind, handlers) {
            if (!kinds[kind] || !handlers || Object.keys(handlers).some(key => !['create','edit','status','documents'].includes(key) || typeof handlers[key] !== 'function')) throw Error('INVALID_FORM_ADAPTER');
            forms.set(kind, Object.freeze({...handlers}));
        },
        handler: (kind, action) => forms.get(kind)?.[action]
    };
})();
