/* Write-only feedback on publicly visible partners and activities. */
(() => {
    'use strict';
    function mount(container, record, kind) {
        if (!record?.id || !['partners','activities'].includes(kind)) return;
        const heading=document.createElement('h3'); heading.textContent='แสดงความคิดเห็น';
        const intro=document.createElement('p'); intro.textContent='ส่งความคิดเห็นโดยไม่ต้องระบุชื่อ โปรดหลีกเลี่ยงข้อมูลส่วนบุคคล';
        const form=document.createElement('form');
        const label=document.createElement('label'); label.textContent='คุณเป็น';
        const category=document.createElement('select'); category.required=true;
        for (const [value,text] of [['','เลือกประเภทผู้ตอบ'],['student','นักศึกษา'],['teacher','อาจารย์'],['partner','คู่ความร่วมมือ'],['participant','ผู้เข้าร่วม'],['other','อื่น ๆ']]) {
            const option=document.createElement('option'); option.value=value; option.textContent=text; category.append(option);
        }
        label.append(category);
        const commentLabel=document.createElement('label'); commentLabel.textContent='ความคิดเห็น';
        const comment=document.createElement('textarea'); comment.required=true; comment.maxLength=5000;
        commentLabel.append(comment);
        const send=document.createElement('button'); send.type='submit'; send.textContent='ส่งความคิดเห็น';
        const status=document.createElement('p'); status.setAttribute('role','status');
        form.append(label,commentLabel,send,status); container.append(heading,intro,form);
        let key=null, fingerprint=null;
        form.onsubmit=async event=>{
            event.preventDefault(); if(send.disabled) return;
            const payload={respondentType:category.value,comment:comment.value.trim()};
            if (!payload.comment) { status.textContent='กรุณากรอกความคิดเห็น'; return; }
            const current=JSON.stringify(payload);
            if (fingerprint!==current) { fingerprint=current; key=crypto.randomUUID(); }
            send.disabled=true; status.textContent='กำลังส่งความคิดเห็น';
            try {
                await window.CstuAuth.createPublicFeedback('/public/'+kind+'/'+encodeURIComponent(record.id)+'/feedback',payload,key);
                comment.value=''; fingerprint=null; key=null;
                status.textContent='ส่งความคิดเห็นแล้ว ขอบคุณค่ะ';
            } catch(error) {
                status.textContent=error.status===429?'ส่งบ่อยเกินไป กรุณาลองใหม่ภายหลัง':
                    error.status===404?'รายการนี้ไม่เปิดรับความคิดเห็นแล้ว':'ส่งความคิดเห็นไม่ได้ กรุณาลองใหม่';
            } finally { send.disabled=false; }
        };
    }
    window.CstuPublicFeedback={mount};
})();
