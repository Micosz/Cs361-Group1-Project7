/* Workflow rules for the labelled, tab-local prototype. */
(() => {
    'use strict';
    const labels = {
        draft:'ร่าง', open:'เปิดรับความสนใจ', review:'รอพิจารณา',
        signing:'เตรียมลงนาม', signed:'ลงนามแล้ว', changes:'ขอแก้ไข', closed:'ยุติข้อเสนอ'
    };
    const steps = ['draft','open','review','signing','signed'];
    const executive = (row,current) => current.session.grants.some(grant =>
        grant.active !== false && grant.scopeId === row.scopeId && grant.role === 'executive');
    const owner = (row,current) => row.createdBy === current.session.user.id;
    function actions(row,current) {
        const result = [];
        if (row.status === 'draft' && owner(row,current)) {
            result.push({key:'open',label:'เปิดรับความสนใจ'});
        }
        if (row.status === 'open') {
            if (owner(row,current)) result.push({key:'review',label:'ส่งให้ Executive พิจารณา'});
            result.push({key:'simulate',label:'จำลองครบกำหนด'});
        }
        if (row.status === 'review' && executive(row,current)) {
            result.push({key:'signing',label:'อนุมัติให้ดำเนินการ'},
                {key:'changes',label:'ส่งกลับแก้ไข'}, {key:'closed',label:'ยุติข้อเสนอ'});
        }
        if (row.status === 'signing' && executive(row,current)) {
            result.push({key:'signed',label:'บันทึกว่าลงนามแล้ว'});
        }
        return result;
    }
    function waiting(row) {
        return {
            draft:'รอผู้เสนอเปิดรับความสนใจ',
            open:'รอบุคลากรภายในแสดงความสนใจ',
            review:'รอ Executive พิจารณา',
            signing:'รอการจัดเตรียมและลงนาม MoU',
            signed:'ลงนามแล้ว พร้อมนำไปบันทึกข้อตกลง',
            changes:'รอผู้เสนอแก้ไขและเปิดรับใหม่',
            closed:'ยุติข้อเสนอแล้ว'
        }[row.status];
    }
    const editable = (row,current) => owner(row,current) && ['draft','changes'].includes(row.status);
    function event(row,to,actor,note = '') {
        return {...row,status:to,history:[...(row.history || []),{
            status:to,at:new Date().toISOString(),actor,note
        }]};
    }
    function initialize(row,current,today) {
        let saved = {...row};
        if (!saved.status) {
            saved.status='open';
            if (saved.id !== 'example') saved.createdBy=current.session.user.id;
        }
        if (!saved.history) saved.history=[{status:saved.status,at:saved.createdAt,actor:saved.creator,note:''}];
        if (saved.status === 'open' && saved.deadline < today) {
            saved=event(saved,'review','ระบบต้นแบบ','ครบกำหนดเปิดรับความสนใจ');
        }
        return saved;
    }
    function transition(row,key,current,today,note) {
        if (!actions(row,current).some(action=>action.key===key)) throw Error('สถานะหรือสิทธิ์เปลี่ยนแล้ว กรุณาเปิดรายละเอียดอีกครั้ง');
        if (key === 'open' && row.deadline < today) throw Error('กรุณาแก้วันปิดรับให้เป็นวันนี้หรือหลังจากวันนี้');
        if (['changes','closed'].includes(key) && !note.trim()) throw Error('กรุณาระบุเหตุผล');
        return event(row,key === 'simulate' ? 'review' : key,current.name,
            key === 'simulate' ? 'จำลองครบกำหนดเปิดรับความสนใจ' : note.trim());
    }
    window.CstuProposalFlow = {labels,steps,actions,waiting,editable,event,initialize,transition};
})();
