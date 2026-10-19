/* Relationship controls inside the existing Activity form, using authorized API options. */
(() => {
    'use strict';
    let revision=0;
    async function choices(kind,scope){
        if(kind==='responsible')return (await window.CstuAuth.request('/selection-users?scopeId='+encodeURIComponent(scope)+'&kind=responsible')).data;
        if(kind==='partners')return (await window.CstuAuth.request('/selection-partners?scopeId='+encodeURIComponent(scope))).data;
        const rows=[];let cursor=null;
        do{const result=await window.CstuAuth.request('/'+kind+'?scopeId='+encodeURIComponent(scope)+'&limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));rows.push(...result.data);cursor=result.page.nextCursor;}while(cursor);
        return rows;
    }
    async function picker(form,record,setComplete){
        const current=++revision;
        document.getElementById('activity-link-picker')?.remove();
        const box=document.createElement('fieldset');box.id='activity-link-picker';
        const legend=document.createElement('legend');legend.textContent='คู่ความร่วมมือและข้อตกลง';box.appendChild(legend);
        const scope=document.getElementById('activity-scope'),save=document.getElementById('activity-submit-btn'),message=document.getElementById('activity-status');
        const primary=document.getElementById('activity-partner-id'),cohosts=document.getElementById('activity-cohost-ids'),agreements=document.getElementById('activity-agreement-ids');
        for(const field of [primary,cohosts,agreements])field.closest('p').hidden=true;
        primary.required=false;
        function select(label,multiple=false){const p=document.createElement('p'),title=document.createElement('label'),input=document.createElement('select');title.textContent=label+' ';input.multiple=multiple;input.style.width='100%';if(multiple)input.size=4;title.appendChild(input);p.appendChild(title);box.appendChild(p);return input;}
        const partner=select('คู่ความร่วมมือหลัก'),partners=select('ผู้จัดร่วม (เลือกได้หลายรายการ)',true),linked=select('ข้อตกลงที่เกี่ยวข้อง (เลือกได้หลายรายการ)',true);
        const responsibleInput=document.getElementById('activity-responsible-users');
        responsibleInput.closest('p').hidden=true;
        const responsible=select('ผู้รับผิดชอบกิจกรรม (เลือกได้หลายคน)',true);
        const responsibleRow=responsible.closest('p');
        responsible.onchange=()=>{responsibleInput.value=[...responsible.selectedOptions].map(o=>o.value).join(', ');};
        const clearLabel=document.createElement('label'),clear=document.createElement('input');clear.type='checkbox';clearLabel.append(clear,document.createTextNode(' ถอดผู้จัดร่วมและข้อตกลงทั้งหมด'));box.appendChild(clearLabel);
        const hint=document.createElement('p');hint.textContent='ใช้ Ctrl/Command เพื่อเลือกหลายรายการ หรือเลือกถอดทั้งหมดโดยไม่ลบข้อมูลต้นทาง';box.appendChild(hint);
        form.insertBefore(box,document.getElementById('staff-activity-fields'));
        const complete=!record || record.relationshipsComplete===true;
        const readOnly=Boolean(record?.publication==='public' && !(window.CstuAuth.state()?.grants||[]).some(g=>g.active!==false&&g.scopeId===scope.value&&g.role==='staff'));
        function values(){primary.value=partner.value;cohosts.value=[...partners.selectedOptions].map(o=>o.value).join(', ');agreements.value=[...linked.selectedOptions].map(o=>o.value).join(', ');}
        partner.onchange=values;partners.onchange=values;linked.onchange=values;
        clear.onchange=()=>{if(clear.checked){for(const item of [...partners.options,...linked.options])item.selected=false;values();}setComplete(complete||clear.checked);partners.disabled=readOnly||!complete||clear.checked;linked.disabled=readOnly||!complete||clear.checked;};
        async function load(){
            const selectedScope=scope.value;
            save.disabled=true;message.textContent='กำลังโหลดตัวเลือกตามสิทธิ์';
            try{
                const canAssign=(window.CstuAuth.state()?.grants||[]).some(g=>g.active!==false&&g.scopeId===selectedScope&&g.role==='staff');
                responsibleRow.hidden=!canAssign;
                responsible.disabled=true;
                const [pRows,aRows,userRows]=await Promise.all([choices('partners',selectedScope),choices('agreements',selectedScope),canAssign?choices('responsible',selectedScope):Promise.resolve([])]);
                if(current!==revision||!box.isConnected||scope.value!==selectedScope)return;
                const oldPrimary=primary.value,oldPartners=cohosts.value.split(',').map(s=>s.trim()).filter(Boolean),oldAgreements=agreements.value.split(',').map(s=>s.trim()).filter(Boolean);
                // A strong-read detail can precede the GSI. Preserve its authorized labels.
                const existingP=[record?.relationships?.partner,...(record?.relationships?.coHosts||[])].filter(Boolean);
                const existingA=record?.relationships?.agreements||[];
                for(const item of existingP)if(!pRows.some(row=>row.id===item.id))pRows.push(item);
                for(const item of existingA)if(!aRows.some(row=>row.id===item.id))aRows.push(item);
                const selectedUsers=responsibleInput.value.split(',').map(v=>v.trim()).filter(Boolean);
                responsible.replaceChildren();
                for(const row of userRows){const option=document.createElement('option');option.value=row.id;option.textContent=row.displayName;option.selected=selectedUsers.includes(row.id);responsible.appendChild(option);}
                if(canAssign&&selectedUsers.some(id=>!userRows.some(row=>row.id===id)))throw Error('รายชื่อผู้รับผิดชอบเดิมบางรายการไม่พร้อม กรุณาเปิดฟอร์มใหม่');
                responsible.disabled=!canAssign;
                partner.replaceChildren();partners.replaceChildren();linked.replaceChildren();
                const empty=document.createElement('option');empty.value='';empty.textContent='เลือกคู่ความร่วมมือ';partner.appendChild(empty);
                for(const row of pRows){for(const target of [partner,partners]){const option=document.createElement('option');option.value=row.id;option.textContent=row.name||row.id;option.selected=target===partner?row.id===oldPrimary:oldPartners.includes(row.id);target.appendChild(option);}}
                for(const row of aRows){const option=document.createElement('option');option.value=row.id;option.textContent=row.title||row.id;option.selected=oldAgreements.includes(row.id);linked.appendChild(option);}
                partner.value=oldPrimary;partner.disabled=readOnly;partners.disabled=readOnly||!complete;linked.disabled=readOnly||!complete;
                clear.disabled=readOnly;setComplete(complete);save.disabled=readOnly;
                message.textContent=complete?'':'มีความสัมพันธ์ที่อ่านไม่ได้ การบันทึกจะคงลิงก์เดิมไว้ เลือกถอดทั้งหมดได้หากต้องการ';
            }catch(error){message.textContent='โหลดตัวเลือกไม่ได้: '+error.message;}
        }
        scope.onchange=()=>{responsibleInput.value='';primary.value='';cohosts.value='';agreements.value='';const staff=(window.CstuAuth.state()?.grants||[]).some(g=>g.scopeId===scope.value&&g.role==='staff'&&g.active!==false);document.getElementById('staff-activity-fields').hidden=!staff;load();};
        await load();
    }
    function render(container,record){
        const relationships=record.relationships;if(!relationships)return;
        const title=document.createElement('h3');title.textContent='รายการที่เชื่อม';container.appendChild(title);
        const list=document.createElement('ul');
        for(const [kind,rows] of [['partners',[relationships.partner,...relationships.coHosts].filter(Boolean)],['agreements',relationships.agreements]]){
            for(const row of rows){const li=document.createElement('li');
                if(kind==='agreements'&&window.AgreementComponent){const button=document.createElement('button');button.type='button';button.textContent=row.title;button.onclick=()=>window.AgreementComponent.openDetail(row.id);li.appendChild(button);}
                else{const link=document.createElement('a');link.textContent=row.name||row.title;link.href='index.html?kind='+kind+'&id='+encodeURIComponent(row.id);li.appendChild(link);}
                list.appendChild(li);
            }
        }
        if(!list.children.length){const empty=document.createElement('p');empty.textContent='ไม่มีรายการที่เชื่อมและมีสิทธิ์อ่าน';container.appendChild(empty);}else container.appendChild(list);
    }
    window.ActivityLinks={picker,render};
})();
